// What closes the highway where a side track goes round: spruces down across both lanes, a
// rockslide, a semi-trailer on its side; striped barricades either side of it, an orange DETOUR
// board at the turn-off. Open side tracks get a wooden fingerpost instead. Streamed with the
// player, solid to cars and people.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { TRACK } from './worldGen.js';
import { mulberry32 } from '../core/noise.js';
import { archMaterials, signMaterial } from './buildings/materials.js';
import { texturedConifer, texturedBroadleaf, treeMaterials } from './trees.js';
import { uvBox } from './buildings/builder.js';
import { rock, createRockMaterial } from './flora.js';
import { makeCanvas, canvasTexture } from '../gfx/textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

export class Obstacles {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    this.group.name = 'obstacles';
    game.worldGroup.add(this.group);
    this.sites = new Map(); // track index -> { root, body }
  }

  mats() {
    if (this._m) return this._m;
    const g = this.g;
    const T = g.scatter && g.scatter.treeTex;
    const tex = g.scatter && g.scatter.tex;
    const M = archMaterials();
    this._m = {
      tree: T ? treeMaterials(T, { bark: 'pine', leaf: 'pine', tint: 0xb9c4ae, sway: 0 }) : [M.woodDark, M.woodDark],
      snowTree: T ? treeMaterials(T, { bark: 'pine', leaf: 'pine', tint: 0xb8c4b4, snow: true, sway: 0 }) : [M.woodDark, M.woodDark],
      birch: T ? treeMaterials(T, { bark: 'birch', leaf: 'aspen_green', tint: 0xa9b892, sway: 0 }) : [M.woodDark, M.woodDark],
      rock: tex ? createRockMaterial(tex) : M.concrete,
      snowRock: tex ? createRockMaterial(tex, { snow: true }) : M.concrete,
      stripes: new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.6 }),
    };
    return this._m;
  }

  update() {
    const g = this.g;
    const f = g.focusPoint();
    const gz = f.z + g.origin.z;
    const t0 = Math.floor(gz / TRACK.every);
    const want = new Set();
    for (let t = t0 - 1; t <= t0 + 2; t++) {
      const tr = g.gen.track(t);
      if (!tr || gz < tr.z0 - 1700 || gz > tr.z1 + 900) continue;
      want.add(t);
      if (!this.sites.has(t)) {
        this.sites.set(t, this.build(tr));
        break; // one a frame
      }
    }
    // knocked-about barricades and cones follow their bodies
    for (const s of this.sites.values())
      for (const l of s.loose) {
        if (l.body.isSleeping()) continue;
        const t = l.body.translation(),
          r = l.body.rotation();
        l.obj.position.set(t.x - s.root.position.x, t.y, t.z - s.root.position.z);
        l.obj.quaternion.set(r.x, r.y, r.z, r.w);
      }
    for (const [t, s] of this.sites) {
      if (want.has(t)) continue;
      this.group.remove(s.root);
      g.physics.removeBody(s.body);
      for (const l of s.loose) g.physics.removeBody(l.body);
      s.root.traverse((o) => o.geometry && o.geometry.dispose());
      this.sites.delete(t);
    }
  }

  // World point beside the highway at z, `a` metres across it (+ toward +x), and the road heading.
  roadPoint(z, a) {
    const gen = this.g.gen;
    const [dx, dz] = gen.roadDir(z);
    const x = gen.roadX(z) + dz * a,
      zz = z - dx * a;
    return { x, z: zz, y: gen.height(x, zz), heading: Math.atan2(dx, dz) };
  }

  build(tr) {
    const g = this.g;
    const root = new THREE.Group();
    const o = g.origin;
    root.position.set(-o.x, 0, -o.z); // children in global coordinates
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-o.x, 0, -o.z));
    const site = { root, body, loose: [], add: (desc, surface) => g.physics.setOwner(g.physics.world.createCollider(desc.setCollisionGroups(GROUPS.world), body), { kind: 'prop', surface }) };
    const rnd = mulberry32(tr.t * 7919 + 13);
    if (tr.block) {
      const zb = tr.block.z;
      const snow = g.gen.roadInfo(zb).snow > 0.4;
      if (tr.block.kind === 'trees') this.fallenTrees(site, zb, rnd, snow);
      else if (tr.block.kind === 'rocks') this.rockslide(site, zb, rnd, snow);
      else this.trailer(site, zb, rnd);
      for (const dz of [-34, 34]) this.barricade(site, zb + dz, dz < 0 ? 0 : Math.PI);
      // the board at the turn-off, for the northbound driver, and one for the southbound
      this.board(site, tr.z0 - 70, -6.2, ['DETOUR', tr.side > 0 ? '←' : '→'], { bg: '#e2781c', fg: '#141414', border: '#141414' }, 0);
      this.board(site, tr.z1 + 70, 6.2, ['DETOUR', tr.side > 0 ? '→' : '←'], { bg: '#e2781c', fg: '#141414', border: '#141414' }, Math.PI);
      this.board(site, zb - 260, -6.2, ['ROAD', 'CLOSED'], { bg: '#f1eee6', fg: '#b01c14', border: '#b01c14' }, 0);
    } else {
      this.board(site, tr.z0 - 25, tr.side * 6.4, ['OLD ROAD', tr.side > 0 ? '←' : '→'], { bg: '#5a3d22', fg: '#eadcc0', border: '#eadcc0' }, 0, true);
    }
    this.group.add(root);
    root.updateMatrixWorld(true);
    return site;
  }

  // Three or four spruces down across both lanes, fallen from the same side.
  fallenTrees(site, zb, rnd, snow) {
    // spruce in the snow and the deep forest, birch and aspen on the open grassland
    const biome = this.g.gen.dominantBiome(this.g.gen.roadX(zb), zb);
    const broad = !snow && biome !== 'forest';
    const [bark, leaf] = snow ? this.mats().snowTree : broad ? this.mats().birch : this.mats().tree;
    const from = rnd() < 0.5 ? -1 : 1;
    const n = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const z = zb + (i - (n - 1) / 2) * 4.2 + (rnd() - 0.5) * 2;
      const base = this.roadPoint(z, from * (7 + rnd() * 5));
      const seed = 4001 + i * 31 + Math.floor(rnd() * 1000);
      const geo = broad ? texturedBroadleaf(seed, { lod: 0 }) : texturedConifer(seed, { spruce: true, lod: 0 });
      geo.computeBoundingBox();
      const H = geo.boundingBox.max.y;
      // lying across the road, a little askew, the crown on the far side
      const ang = base.heading + (from > 0 ? -Math.PI / 2 : Math.PI / 2) + (rnd() - 0.5) * 0.7;
      const dir = V(Math.sin(ang), 0, Math.cos(ang));
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, rnd() * Math.PI * 2));
      const m = new THREE.InstancedMesh(geo, [bark, leaf], 1);
      const r0 = H * (broad ? 0.014 : 0.017) + 0.05;
      const pos = V(base.x, base.y + r0 * 0.9, base.z);
      m.setMatrixAt(0, new THREE.Matrix4().compose(pos, q, V(1, 1, 1)));
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      site.root.add(m);
      // the trunk and the springy mass of the crown
      const along = (a, b, r) => {
        const c = pos.clone().addScaledVector(dir, (a + b) / 2);
        const qc = new THREE.Quaternion().setFromUnitVectors(UP, dir);
        site.add(RAPIER.ColliderDesc.capsule((b - a) / 2, r).setTranslation(c.x, c.y + r * 0.4, c.z).setRotation(qc), 'wood');
      };
      along(0, H * 0.75, Math.max(0.32, r0));
      along(H * 0.2, H * 0.8, 0.95);
    }
  }

  // Boulders come down off the slope and spread across the road, with rubble round them.
  rockslide(site, zb, rnd, snow) {
    const mat = snow ? this.mats().snowRock : this.mats().rock;
    const geo = rock(911, 'boulder');
    // a wall of boulders from shoulder to shoulder (two staggered rows, no gap a car fits
    // through), more strewn about, rubble round them
    const rows = [];
    for (let row = 0; row < 2; row++) for (let a = -13; a <= 13; a += 2.3) rows.push({ a: a + (row ? 1.15 : 0) + (rnd() - 0.5) * 0.6, dz: (row ? 2.2 : -2.2) + (rnd() - 0.5) * 1.5 });
    const big = rows.length + 10,
      small = 40;
    const m = new THREE.InstancedMesh(geo, mat, big + small);
    const from = rnd() < 0.5 ? -1 : 1;
    const c = new THREE.Color();
    for (let i = 0; i < big + small; i++) {
      const isBig = i < big;
      const inRow = i < rows.length;
      // spread across the road and thicker on the side it came from
      const a = inRow ? rows[i].a : (rnd() - 0.5) * 26 + from * rnd() * 6;
      const p = this.roadPoint(zb + (inRow ? rows[i].dz : (rnd() - 0.5) * (isBig ? 16 : 24)), a);
      const r = inRow ? 1.25 + rnd() * 0.9 : isBig ? 0.9 + rnd() * 1.6 : 0.2 + rnd() * 0.35;
      const s = V(r * (0.9 + rnd() * 0.4), r * (0.7 + rnd() * 0.4), r * (0.9 + rnd() * 0.4));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 0.6, rnd() * 6.28, rnd() * 0.6));
      const pos = V(p.x, p.y + s.y * 0.35, p.z);
      m.setMatrixAt(i, new THREE.Matrix4().compose(pos, q, s));
      const sh = 0.55 + rnd() * 0.25;
      m.setColorAt(i, c.setRGB(sh * 1.05, sh * 0.95, sh * 0.85));
      if (isBig) site.add(RAPIER.ColliderDesc.ball(r * 0.8).setTranslation(pos.x, pos.y + r * 0.1, pos.z), 'rock');
    }
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    site.root.add(m);
  }

  // A semi-trailer on its side across both lanes, the tractor unit nose-down in the ditch.
  trailer(site, zb, rnd) {
    const M = archMaterials();
    const p = this.roadPoint(zb, (rnd() - 0.5) * 2);
    const yaw = p.heading + Math.PI / 2 + (rnd() - 0.5) * 0.5;
    const L = 13,
      Hh = 2.7,
      Wd = 2.5;
    const box = new THREE.Group();
    box.position.set(p.x, p.y + Wd / 2, p.z);
    box.rotation.set(0, yaw, Math.PI / 2, 'YXZ');
    const shell = new THREE.Mesh(uvBox(0, 0, 0, Hh, Wd, L), M.corrugated);
    shell.castShadow = shell.receiveShadow = true;
    box.add(shell);
    // the floor and its frame show now it lies on its side
    const frame = new THREE.Mesh(uvBox(0, 0, 0, 0.3, Wd * 0.9, L * 0.98), M.blackMatte || M.metal);
    frame.position.set(-Hh / 2 - 0.15, 0, 0);
    box.add(frame);
    for (const zz of [-L / 2 + 1.2, -L / 2 + 2.5]) {
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 16), M.rubber);
        w.rotation.z = Math.PI / 2;
        w.position.set(-Hh / 2 - 0.55, s * (Wd / 2 - 0.3), zz);
        w.rotation.set(0, 0, 0);
        w.castShadow = true;
        box.add(w);
      }
    }
    site.root.add(box);
    const qb = box.quaternion.clone();
    site.add(RAPIER.ColliderDesc.cuboid(Hh / 2 + 0.3, Wd / 2, L / 2).setTranslation(box.position.x, box.position.y, box.position.z).setRotation(qb), 'metal');
    // the cars that ran into it, skewed across the lanes, one on its side
    const protos = this.g.pois && this.g.pois.wreckProtos;
    const paints = [0x6d7a7f, 0x7a2e24, 0x2f4a5c, 0xb9b2a0, 0x4b5a3a, 0x8b6d3c];
    for (let i = 0; protos && protos.length && i < 2 + (rnd() < 0.5 ? 1 : 0); i++) {
      const proto = protos[Math.floor(rnd() * protos.length)];
      const w = proto.group.clone();
      const q = this.roadPoint(zb + (i % 2 ? 1 : -1) * (5 + rnd() * 4), (rnd() - 0.5) * 6);
      const rot = q.heading + (rnd() - 0.5) * 2.4;
      const tilt = i === 1 ? Math.PI / 2 : (rnd() - 0.5) * 0.08;
      const H = proto.half;
      w.position.set(q.x, q.y + (tilt > 1 ? H.x : -0.04), q.z);
      w.rotation.set(0, rot, tilt);
      const base = proto.group.wreckPaint;
      if (base) {
        const hex = paints[Math.floor(rnd() * paints.length)];
        const pm = base.userData.make ? base.userData.make(hex) : base.clone();
        pm.color.setHex(hex);
        w.traverse((o) => o.isMesh && o.material === base && (o.material = pm));
      }
      site.root.add(w);
      const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, tilt, 'YXZ'));
      site.add(RAPIER.ColliderDesc.cuboid(H.x * 0.92, H.y * 0.8, H.z * 0.95).setTranslation(q.x, q.y + (tilt > 1 ? H.x : proto.cy + 0.05), q.z).setRotation(qq), 'metal');
    }
    // spilled cargo
    for (let i = 0; i < 7; i++) {
      const q = this.roadPoint(zb + (rnd() - 0.5) * 12, (rnd() - 0.5) * 12);
      const s = 0.6 + rnd() * 0.5;
      const c = new THREE.Mesh(uvBox(0, 0, 0, s, s * 0.8, s), M.cardboard);
      c.position.set(q.x, q.y + s * 0.4, q.z);
      c.rotation.y = rnd() * 6.28;
      c.castShadow = true;
      site.root.add(c);
    }
  }

  // A free body for a light object standing at its place (scene coordinates from the site's).
  loose(site, obj, desc, mass, surface) {
    const g = this.g;
    const p = obj.position.clone().add(site.root.position);
    const q = obj.quaternion;
    const b = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setLinearDamping(0.3).setAngularDamping(0.5).setSleeping(true));
    const col = g.physics.world.createCollider(desc.setMass(mass).setFriction(0.7).setCollisionGroups(GROUPS.item), b);
    g.physics.setOwner(col, { kind: 'prop', surface });
    site.loose.push({ body: b, obj });
  }

  // A striped barricade across the lanes with a few cones: light, they go flying when hit.
  barricade(site, z, turn) {
    const M = archMaterials();
    const st = this.mats().stripes;
    for (const a of [-2.6, 0, 2.6]) {
      const p = this.roadPoint(z, a);
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.heading + turn;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.28, 0.04), st);
      bar.position.y = 0.95;
      g.add(bar);
      for (const sx of [-0.95, 0.95])
        for (const sz of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), M.metalWhite);
          leg.position.set(sx, 0.52, sz * 0.18);
          leg.rotation.x = sz * 0.3;
          g.add(leg);
        }
      g.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.position.y -= 0.55; // about the body's centre
      });
      g.position.y += 0.55;
      site.root.add(g);
      this.loose(site, g, RAPIER.ColliderDesc.cuboid(1.1, 0.55, 0.22), 16, 'wood');
      const lib = this.g.props;
      if (lib && lib.ready('trafficCone')) {
        const c = lib.instance('trafficCone');
        const cp = this.roadPoint(z - Math.cos(turn) * 1.6, a + 1.3);
        const h = lib.sizeOf('trafficCone').y;
        for (const ch of c.children) ch.position.y -= h / 2;
        c.position.set(cp.x, cp.y + h / 2, cp.z);
        site.root.add(c);
        this.loose(site, c, RAPIER.ColliderDesc.cylinder(h / 2, 0.16), 3, 'plastic');
      }
    }
  }

  // A sign board on two posts beside the road (rot: 0 faces the northbound driver).
  board(site, z, a, lines, colors, rot, wooden = false) {
    const M = archMaterials();
    const p = this.roadPoint(z, a);
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.heading + Math.PI + rot;
    const mat = signMaterial(lines.map((t, i) => ({ text: t, size: i === 0 ? 92 : 120 })), { w: 512, h: 340, worn: 0.35, ...colors });
    const post = wooden ? M.wood : M.metal;
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 0.04), [post, post, post, post, mat, post]);
    b.position.y = 2.0;
    g.add(b);
    for (const px of [-0.55, 0.55]) {
      const pm = new THREE.Mesh(wooden ? new THREE.BoxGeometry(0.09, 2.5, 0.09) : new THREE.CylinderGeometry(0.04, 0.04, 2.5, 8), post);
      pm.position.set(px, 1.25, -0.05);
      g.add(pm);
    }
    g.traverse((o) => o.isMesh && (o.castShadow = true));
    site.root.add(g);
    for (const px of [-0.55, 0.55]) {
      const c = V(px, 1.25, -0.05).applyQuaternion(g.quaternion);
      site.add(RAPIER.ColliderDesc.cylinder(1.25, 0.06).setTranslation(p.x + c.x, p.y + c.y, p.z + c.z), 'metal');
    }
  }

  rebase(dx, dz) {
    // the game moves every physics body itself
    for (const s of this.sites.values()) {
      s.root.position.x -= dx;
      s.root.position.z -= dz;
      s.root.updateMatrixWorld(true);
    }
  }
}

// Red and white diagonal stripes for barricade boards.
function stripeTexture() {
  const c = makeCanvas(256, 32);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#efece4';
  ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = '#c42a1c';
  for (let x = -32; x < 288; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 32);
    ctx.lineTo(x + 24, 32);
    ctx.lineTo(x + 48, 0);
    ctx.lineTo(x + 24, 0);
    ctx.fill();
  }
  return canvasTexture(c, { wrap: false });
}
