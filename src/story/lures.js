// Every few kilometres one place along the road calls you in: smoke rising behind it (a flare
// at night), a board painted by hand at its turn-off, or a voice on the CB. Inside there is a
// cache worth the stop — fuel, a battery, food, medicine — and now and then whoever lit the fire
// is still there and does not want company.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { hash01, mulberry32 } from '../core/noise.js';
import { POI_SPACING } from '../world/worldGen.js';
import { archMaterials } from '../world/buildings/materials.js';
import { makeCanvas, canvasTexture } from '../gfx/textures.js';
import { placeProp } from '../world/props.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const EVERY = 4800; // metres between lures (jittered)
const HOSTS = ['house', 'houses', 'farm', 'ranch', 'cabin', 'lodge', 'motel', 'diner', 'gasStation', 'church', 'sawmill', 'outpost'];
const PLACE = { house: 'the house', houses: 'the houses', farm: 'the farm', ranch: 'the ranch', cabin: 'the cabin', lodge: 'the lodge', motel: 'the motel', diner: 'the diner', gasStation: 'the gas station', church: 'the church', sawmill: 'the sawmill', outpost: 'the checkpoint' };

// what each cache holds: [item id, chance]; part:<id> is a car part
const CACHES = {
  fuel: [['jerryCan', 1], ['jerryCan', 0.6], ['oilBottle', 0.8], ['coolantJug', 0.4], ['waterBottle', 0.6]],
  food: [['waterJug', 1], ['mre', 1], ['cannedMeat', 0.8], ['cannedPeaches', 0.6], ['waterBottle', 0.7], ['coffee', 0.4]],
  parts: [['part:battery', 1], ['part:fanbelt', 0.8], ['part:sparkplugs', 0.5], ['part:alternator', 0.35], ['part:starter', 0.3], ['tyreKit', 0.7], ['repairKit', 0.7], ['part:wheel_FL', 0.35], ['oilBottle', 0.6]],
  aid: [['medkit', 1], ['bandage', 0.8], ['painkillers', 0.7], ['ammo38', 0.6], ['revolver', 0.3], ['waterBottle', 0.8]],
};
const SIGNS = [
  { lines: ['GAS', 'INSIDE'], cache: 'fuel' },
  { lines: ['WATER', 'FOOD'], cache: 'food' },
  { lines: ['PARTS', 'TOOLS'], cache: 'parts' },
  { lines: ['HELP', 'US'], cache: 'aid' },
  { lines: ['FREE', 'TAKE IT'], cache: 'fuel' },
];
const CALLS = {
  fuel: (p, side, km) => `...anyone on the 9, this is Walt. ${p} on the ${side}, kilometre ${km}. I left two cans of gas inside, I can't carry them. Take them before somebody else does.`,
  food: (p, side, km) => `...if you can hear this: ${p}, ${side} side of the 9 near kilometre ${km}. There's water and food in the kitchen. We're not coming back for it.`,
  parts: (p, side, km) => `...repeat, ${p}, ${side} side, kilometre ${km}. Charged battery and a fan belt on the bench inside. My truck's beyond saving. Somebody should get some use out of them.`,
  aid: (p, side, km) => `...please, anyone. ${p} at kilometre ${km}, ${side} side. My husband's hurt. We have medicine to trade, we have bullets. Please hurry...`,
};

export class Lures {
  constructor(game) {
    this.game = game;
    this.cache = new Map(); // lure index -> lure or null
    this.heard = new Set(); // lure indices whose call was heard
    this.signs = new Map();
    this.group = new THREE.Group();
    this.group.name = 'lures';
    game.worldGroup.add(this.group);
    this.flareT = 0;
    this.smokeAcc = 0;
  }

  // Lure j: the first place that can host one at or past its distance.
  lure(j) {
    if (this.cache.has(j)) return this.cache.get(j);
    const g = this.game;
    const target = (j + 1) * EVERY + (hash01(g.seed, j, 1301) - 0.5) * 1400;
    let res = null;
    const k0 = Math.max(2, Math.round(target / POI_SPACING));
    for (let k = k0; k < k0 + 6; k++) {
      const p = g.gen.poiSlot(k);
      if (!p || !HOSTS.includes(p.type)) continue;
      const r = (i) => hash01(g.seed, j, 1310 + i);
      const kind = ['smoke', 'sign', 'radio'][Math.floor(r(0) * 3)];
      const sign = SIGNS[Math.floor(r(1) * SIGNS.length)];
      const cacheKind = kind === 'sign' ? sign.cache : ['fuel', 'food', 'parts', 'aid'][Math.floor(r(2) * 4)];
      // a call for help is the likeliest to be bait
      const enemies = (g.difficulty && g.difficulty.enemies) || 1;
      const trap = r(3) < (cacheKind === 'aid' ? 0.45 : 0.2) * enemies;
      res = { j, k, poi: p, kind, sign, cacheKind, trap };
      break;
    }
    this.cache.set(j, res);
    return res;
  }

  byPoi(k) {
    const j0 = Math.floor((k * POI_SPACING) / EVERY) - 2;
    for (let j = Math.max(0, j0); j < j0 + 4; j++) {
      const l = this.lure(j);
      if (l && l.k === k) return l;
    }
    return null;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game;
    if (!g.env) return;
    const f = g.focusPoint();
    const gx = f.x + g.origin.x,
      gz = f.z + g.origin.z;
    const j0 = Math.floor(gz / EVERY) - 1;
    const want = new Set();
    for (let j = Math.max(0, j0); j <= j0 + 2; j++) {
      const l = this.lure(j);
      if (!l) continue;
      const p = l.poi;
      const ahead = p.z - gz;
      const dist = Math.hypot(p.x - gx, p.z - gz);
      const st = g.pois.state.get(l.k);
      const visited = st && st.visited;
      // the smoke keeps going until you have been there; the fire in the drum burns on
      if (l.kind === 'smoke' && dist < 2600 && (!visited || dist < 260)) this.beacon(l, dt, dist, visited);
      if (l.kind === 'sign' && dist < 1500) {
        want.add(j);
        if (!this.signs.has(j)) this.signs.set(j, this.buildSign(l));
      }
      if (l.kind === 'radio' && !this.heard.has(j) && ahead > 250 && ahead < 1700) this.call(l);
    }
    this.updateFlares(dt);
    if (this.drumLight && !this.drumSeen) this.drumLight.intensity = 0;
    this.drumSeen = false;
    for (const [j, s] of this.signs) {
      if (want.has(j)) continue;
      this.group.remove(s.root);
      g.physics.removeBody(s.body);
      this.signs.delete(j);
    }
  }

  // Where the signal fire burns: an oil drum in the yard on the road side of the buildings.
  firePoint(l) {
    if (l.fire) return l.fire;
    const p = l.poi;
    const tx = Math.sin(p.rot),
      tz = Math.cos(p.rot); // toward the road
    const side = hash01(this.game.seed, l.j, 1350) < 0.5 ? -1 : 1;
    const out = p.padR * 0.5;
    l.fire = { x: p.x + tx * out + tz * 8 * side, z: p.z + tz * out - tx * 8 * side };
    return l.fire;
  }

  // A fire in a drum by day, its smoke climbing high enough to be seen from kilometres off; a red
  // flare going up now and then at night.
  beacon(l, dt, dist, visited = false) {
    const g = this.game;
    const fx = g.effects;
    if (!fx || !fx.column) return;
    const fp = this.firePoint(l);
    const base = V(fp.x - g.origin.x, g.gen.height(fp.x, fp.z) + 1.0, fp.z - g.origin.z);
    const wind = g.env.w ? g.env.w.wind || 0.3 : 0.3;
    const night = g.env.daylight < 0.22;
    // the flames themselves, when near enough to see them, and their glow on the yard
    if (!this.drumLight) {
      this.drumLight = new THREE.PointLight(0xff8a3a, 0, 16, 1.6);
      this.group.add(this.drumLight);
      g.lights.add(this.drumLight);
    }
    this.drumT = (this.drumT || 0) + dt;
    this.drumLight.position.copy(base).add(V(0, 0.7, 0));
    this.drumLight.intensity = dist < 200 ? 10 * (0.85 + 0.15 * Math.sin(this.drumT * 13) * Math.sin(this.drumT * 7.3)) : 0;
    this.drumSeen = true;
    if (dist < 260) {
      this.fireAcc = (this.fireAcc || 0) + dt * 22;
      while (this.fireAcc >= 1) {
        this.fireAcc -= 1;
        fx.fire.emit({ pos: base.clone().add(V((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)), vel: V((Math.random() - 0.5) * 0.3, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3), size: 0.35, grow: 0.1, life: 0.5 + Math.random() * 0.4, color: [1, 0.55 + Math.random() * 0.2, 0.2], alpha: 0.9, drag: 0.5 });
      }
    }
    if (visited) return;
    if (!night) {
      this.smokeAcc += dt * 7;
      while (this.smokeAcc >= 1) {
        this.smokeAcc -= 1;
        const sh = 0.2 + Math.random() * 0.12;
        fx.column.emit({
          pos: base.clone().add(V((Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5)),
          vel: V(wind * 0.5 + (Math.random() - 0.5) * 0.5, 2.6 + Math.random() * 0.9, wind * 0.25 + (Math.random() - 0.5) * 0.5),
          size: 1.2,
          grow: 24 + Math.random() * 12,
          life: 24 + Math.random() * 8,
          color: [sh, sh * 0.96, sh * 0.92],
          alpha: 0.5,
          drag: 0.03,
          grav: -0.015,
          fadeIn: 0.03,
          spin: 0.2,
        });
      }
    } else {
      this.flareT -= dt;
      if (this.flareT <= 0) {
        this.flareT = 28 + Math.random() * 18;
        this.flare(base);
      }
    }
  }

  // A signal flare: a red star that climbs on a trail of smoke, hangs and drifts down under its
  // little parachute, lighting the land red around it.
  flare(at) {
    const g = this.game;
    if (!this.flareLight) {
      this.flareLight = new THREE.PointLight(0xff3a24, 0, 220, 1.3);
      this.group.add(this.flareLight);
      g.lights.add(this.flareLight);
    }
    this.flares = this.flares || [];
    this.flares.push({ p: at.clone().add(V(0, 1, 0)), vy: 46, t: 0 });
    g.audio && g.audio.play('revolver', { at, volume: 0.12 });
  }

  updateFlares(dt) {
    const fx = this.game.effects;
    if (!this.flares || !this.flares.length) {
      if (this.flareLight) this.flareLight.intensity = 0;
      return;
    }
    let bright = 0;
    for (const f of this.flares) {
      f.t += dt;
      // burn-out of the rocket, then the parachute
      if (f.vy > -1.6) f.vy -= dt * (f.t < 2.2 ? 20 : 4);
      else f.vy = -1.6;
      f.p.y += f.vy * dt;
      f.p.x += dt * 0.8;
      const burning = f.t < 11;
      const k = burning ? Math.min(1, f.t * 3) * (0.8 + 0.2 * Math.sin(f.t * 31) * Math.sin(f.t * 17)) : 0;
      if (burning && fx) {
        // the burning star and its halo
        fx.sparks.emit({ pos: f.p.clone(), vel: V(0, 0, 0), size: 3.5 * k + 0.5, grow: 0.5, life: 0.1, color: [1, 0.35, 0.22], alpha: 1, drag: 0 });
        fx.sparks.emit({ pos: f.p.clone(), vel: V(0, 0, 0), size: 16 * k, grow: 2, life: 0.1, color: [0.5, 0.08, 0.05], alpha: 0.5, drag: 0 });
        if (Math.random() < dt * 30) fx.sparks.emit({ pos: f.p.clone(), vel: V((Math.random() - 0.5) * 1.5, -1 - Math.random(), (Math.random() - 0.5) * 1.5), size: 0.35, grow: 0.1, life: 0.8 + Math.random() * 0.6, color: [1, 0.45, 0.25], alpha: 1, drag: 0.5, grav: 3 });
        if (Math.random() < dt * 12) fx.column.emit({ pos: f.p.clone(), vel: V(0.3, 0, 0), size: 0.8, grow: 6, life: 7, color: [0.5, 0.42, 0.42], alpha: 0.25, drag: 0.3, grav: -0.05 });
      }
      if (k > bright) {
        bright = k;
        this.flareLight.position.copy(f.p);
      }
    }
    this.flareLight.intensity = bright * 200;
    this.flares = this.flares.filter((f) => f.t < 12);
  }

  // The CB crackles into life when you are near enough.
  call(l) {
    const g = this.game;
    const car = g.car;
    if (!car || !g.player.seat || !car.ignition || !car.isInstalled('battery') || car.battery < 0.05) return;
    this.heard.add(l.j);
    const p = l.poi;
    // the road runs north: the +x side is on the left
    const side = p.side > 0 ? 'left' : 'right';
    const km = Math.round(p.z / 100) / 10;
    const text = CALLS[l.cacheKind](PLACE[p.type] || 'the house', side, km);
    g.hud && g.hud.subtitle && g.hud.subtitle('CB · channel 19', text, 13);
    g.audio && g.audio.play('click');
    g.atlas && g.atlas.addNote(p.x, p.z, `CB call: ${l.cacheKind === 'aid' ? 'someone asking for help' : 'supplies left'} at ${PLACE[p.type] || 'a house'}`);
  }

  // A sheet of plywood nailed to a post at the turn-off, painted with whatever was to hand.
  buildSign(l) {
    const g = this.game;
    const p = l.poi;
    const z = p.z - 75;
    const side = p.side;
    const x = g.gen.roadX(z) + side * 6.4;
    const y = g.gen.height(x, z);
    const root = new THREE.Group();
    root.position.set(x - g.origin.x, y, z - g.origin.z);
    // face the oncoming (northbound) driver, turned a little toward the road
    root.rotation.y = Math.PI - side * 0.35;
    const M = archMaterials();
    const arrow = side > 0 ? '←' : '→';
    const mat = paintedBoard([...l.sign.lines, arrow], l.j);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.03), [M.wood, M.wood, M.wood, M.wood, mat, M.wood]);
    board.position.set(0, 1.45, 0);
    board.rotation.z = (hash01(g.seed, l.j, 1340) - 0.5) * 0.12;
    board.castShadow = true;
    root.add(board);
    for (const px of [-0.5, 0.45]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.1, 0.09), M.wood);
      post.position.set(px, 0.95, -0.06);
      post.rotation.z = (px > 0 ? 1 : -1) * 0.03;
      post.castShadow = true;
      root.add(post);
    }
    this.group.add(root);
    root.updateMatrixWorld(true);
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(root.position.x, root.position.y, root.position.z));
    for (const px of [-0.5, 0.45]) {
      const c = V(px, 0.95, -0.06).applyQuaternion(root.quaternion);
      const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.05, 1.05, 0.05).setTranslation(c.x, c.y, c.z).setCollisionGroups(GROUPS.world), body);
      g.physics.setOwner(col, { kind: 'prop', surface: 'wood' });
    }
    return { root, body };
  }

  // ---------------------------------------------------------------- what waits inside
  // The cache, on the place's first load: in the kitchen, on the bench, on the shelves.
  onPoiLoaded(inst) {
    const l = this.byPoi(inst.k);
    if (!l) return;
    if (l.kind === 'smoke') {
      const g = this.game;
      const fp = this.firePoint(l);
      // step toward the road until the drum stands clear of walls and porches
      const p = l.poi;
      const shape = new RAPIER.Cuboid(0.6, 0.8, 0.6);
      for (let i = 0; i < 6; i++) {
        const x = fp.x - g.origin.x,
          z = fp.z - g.origin.z;
        let hit = false;
        g.physics.world.intersectionsWithShape({ x, y: g.gen.height(fp.x, fp.z) + 1, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, () => {
          hit = true;
          return false;
        });
        if (!hit) break;
        fp.x += Math.sin(p.rot) * 3;
        fp.z += Math.cos(p.rot) * 3;
      }
      inst.root.updateMatrixWorld(true);
      const lp = V(fp.x - g.origin.x, 0, fp.z - g.origin.z).applyMatrix4(inst.root.matrixWorld.clone().invert());
      placeProp(g, inst, { id: 'oilDrum', pos: [lp.x, 0, lp.z], rot: 0, fuel: false });
    }
    if (inst.state.cache) return;
    inst.state.cache = true;
    const g = this.game;
    const rnd = mulberry32(inst.poi.seed + 1777);
    const indoor = ['kitchen', 'table', 'storage', 'tools', 'counter', 'shelf', 'office', 'desk', 'crate', 'cupboard', 'small', 'shop', 'bed', 'gear'];
    let spots = inst.loot.filter((s) => indoor.includes(s.kind));
    if (!spots.length) spots = inst.loot.filter((s) => s.kind !== 'wreck');
    if (!spots.length) return;
    inst.root.updateMatrixWorld(true);
    let n = 0;
    for (const [id, chance] of CACHES[l.cacheKind]) {
      if (rnd() > chance) continue;
      const sp = spots[(n * 5 + Math.floor(rnd() * spots.length)) % spots.length];
      const wp = sp.pos.clone().applyMatrix4(inst.root.matrixWorld).add(V((rnd() - 0.5) * 0.3, 0.18 + n * 0.02, (rnd() - 0.5) * 0.3));
      const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rnd() * Math.PI * 2);
      let it = null;
      if (id.startsWith('part:')) {
        const part = id.slice(5);
        if (!g.car || !g.car.model.parts[part]) continue;
        const st = { condition: 0.75 + rnd() * 0.25 };
        if (part === 'battery') st.charge = 0.8 + rnd() * 0.2;
        it = g.items.spawnPart(part, wp, q, st);
      } else {
        const st = {};
        if (id === 'jerryCan') Object.assign(st, { liquid: Math.round(12 + rnd() * 8), liquidType: 'fuel' });
        it = g.items.spawn(id, wp, q, Object.keys(st).length ? st : null, { sleep: true });
      }
      if (it) {
        it.poiKey = inst.k;
        n++;
      }
    }
  }

  // Bait: whoever called you in is waiting inside.
  ambushers(inst) {
    const l = this.byPoi(inst.k);
    if (!l || !l.trap) return [];
    const r = mulberry32(inst.poi.seed + 1999);
    const spots = inst.loot.filter((s) => s.kind !== 'wreck');
    const n = 1 + (r() < 0.45 ? 1 : 0);
    const out = [];
    for (let i = 0; i < n; i++) {
      const sp = spots.length ? spots[Math.floor(r() * spots.length)].pos : V((r() - 0.5) * 8, 0, 4);
      out.push(sp.clone().applyMatrix4(inst.root.matrixWorld));
    }
    return out;
  }

  rebase(dx, dz) {
    // (the game moves every physics body itself)
    for (const s of this.signs.values()) {
      s.root.position.x -= dx;
      s.root.position.z -= dz;
    }
    for (const f of this.flares || []) {
      f.p.x -= dx;
      f.p.z -= dz;
    }
  }

  serialize() {
    return { heard: [...this.heard] };
  }

  restore(d) {
    if (d && d.heard) this.heard = new Set(d.heard);
  }
}

// Plywood with brushed letters: uneven strokes, runs of paint, a crooked arrow.
function paintedBoard(lines, seed) {
  const w = 512,
    h = 384;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const r = mulberry32(seed * 31 + 7);
  // plywood: warm veneer with grain and a weathered grey cast
  ctx.fillStyle = '#9a7d5a';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    const y = r() * h;
    ctx.strokeStyle = `rgba(${90 + r() * 40},${64 + r() * 30},${40 + r() * 20},${0.12 + r() * 0.2})`;
    ctx.lineWidth = 1 + r() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 + (r() - 0.5) * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(150,150,145,0.18)';
  ctx.fillRect(0, 0, w, h);
  // paint
  const paint = r() < 0.5 ? '#7a1a14' : '#1a1714';
  ctx.fillStyle = paint;
  ctx.strokeStyle = paint;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((t, i) => {
    const size = (h / n) * 0.78;
    // the arrow: three strokes of the brush
    if (t === '\u2190' || t === '\u2192') {
      const dir = t === '\u2192' ? 1 : -1;
      const cy = (h * (i + 0.5)) / n;
      const x0 = w / 2 - dir * w * 0.3,
        x1 = w / 2 + dir * w * 0.3;
      ctx.lineCap = 'round';
      ctx.lineWidth = size * 0.2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(x0, cy + (r() - 0.5) * 8);
      ctx.lineTo(x1, cy + (r() - 0.5) * 8);
      ctx.moveTo(x1 - dir * size * 0.5, cy - size * 0.38);
      ctx.lineTo(x1 + dir * 4, cy);
      ctx.lineTo(x1 - dir * size * 0.5, cy + size * 0.38);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.font = `bold ${size}px Impact, 'Arial Black', sans-serif`;
    const cy = (h * (i + 0.55)) / n;
    ctx.save();
    ctx.translate(w / 2 + (r() - 0.5) * 20, cy);
    ctx.rotate((r() - 0.5) * 0.08);
    // a few passes slightly apart: a brush, not a font
    for (let k = 0; k < 3; k++) {
      ctx.globalAlpha = 0.55 + r() * 0.3;
      ctx.fillText(t, (r() - 0.5) * 3, (r() - 0.5) * 3);
    }
    ctx.restore();
    // runs
    ctx.globalAlpha = 0.7;
    for (let k = 0; k < 3 + Math.floor(r() * 3); k++) {
      const x = w / 2 + (r() - 0.5) * w * 0.5,
        y = cy + size * 0.3;
      ctx.lineWidth = 2 + r() * 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 2, y + 8 + r() * 26);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
  const tex = canvasTexture(c, { wrap: false });
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 });
}
