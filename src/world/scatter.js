// Biome-driven scattering of flora and rocks around the player with instanced meshes.
//
// Placement runs in a worker (scatterGen.js) per 64 m cell. Near the player (the 3x3 cells
// around them) every species uses its full model and casts shadows; further out trees and cacti
// become baked billboard impostors, rocks and shrubs a coarser mesh, and ground cover thins out
// and stops. Static colliders are built for solid objects close by.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import * as F from './flora.js';
import { bakeImpostors, createImpostorMaterial } from '../gfx/impostor.js';
import { SPECIES, CELL, STRIDE, BIOME_LIST, sinkOf, cellInstances } from './scatterGen.js';
import { settings } from '../core/settings.js';

const ROCK_TINT = {
  scrub: [0.82, 0.74, 0.64],
  dunes: [0.95, 0.82, 0.66],
  badlands: [0.98, 0.62, 0.45],
  saltflat: [0.85, 0.83, 0.8],
  highland: [0.72, 0.7, 0.68],
  prairie: [0.76, 0.74, 0.68],
  forest: [0.66, 0.66, 0.62],
  taiga: [0.74, 0.75, 0.77],
  tundra: [0.72, 0.73, 0.75],
};

const FLOWER_PALETTES = [
  [[0.62, 0.32, 0.72], [0.52, 0.28, 0.66]],
  [[0.92, 0.78, 0.18], [0.95, 0.66, 0.12]],
  [[0.94, 0.92, 0.88], [0.86, 0.84, 0.9]],
  [[0.86, 0.26, 0.2], [0.92, 0.5, 0.18]],
];

// instance capacity per variant: [near model, far stand-in]
const CAP = {
  grass: [5000, 0],
  meadow: [6000, 0],
  snowgrass: [2500, 0],
  shrub: [1600, 2400],
  tundrashrub: [1200, 2000],
  fern: [3500, 0],
  flowers: [1200, 0],
  reeds: [1500, 0],
  pebble: [800, 0],
  barrel: [300, 0],
  boulder: [400, 1500],
  snowrock: [400, 1500],
  slab: [250, 800],
  saguaro: [200, 900],
  joshua: [200, 900],
  deadtree: [120, 500],
  hoodoo: [60, 240],
  pine: [900, 9000],
  snowpine: [900, 9000],
  birch: [300, 2500],
  birchbare: [200, 1500],
  stump: [200, 0],
  log: [120, 0],
};

const FAR_BY_QUALITY = { low: 520, medium: 700, high: 880, ultra: 1000 };

export class Scatter {
  constructor(game, tex) {
    this.game = game;
    this.gen = game.gen;
    this.group = new THREE.Group();
    this.group.name = 'scatter';
    game.worldGroup.add(this.group);
    this.grassMat = F.createFloraMaterial({ sway: 0.6 });
    this.swayMat = F.createFloraMaterial({ sway: 0.12 });
    this.treeMat = F.createFloraMaterial({ sway: 0.0024 });
    this.snowTreeMat = F.createFloraMaterial({ sway: 0.0024, snow: true });
    this.solidMat = F.createFloraMaterial({});
    this.snowSolidMat = F.createFloraMaterial({ snow: true, doubleSide: true });
    this.rockMat = F.createRockMaterial(tex);
    this.snowRockMat = F.createRockMaterial(tex, { snow: true });
    this.meshes = []; // [species][variant] -> [lod0, lod1|null]
    this.cells = new Map(); // key -> { ci, cj, data: Float32Array|null, colliders }
    this.lastCell = null;
    this.farRadius = FAR_BY_QUALITY[settings.data.quality] || 880;
    this.dirty = false;
    this.lastRebuild = 0;
    this.buildVariants();
    this.startWorker();
  }

  geometryFor(def, v, lod) {
    const seed = 1000 + v * 37 + def.id.length * 101 + SPECIES.indexOf(def) * 7;
    switch (def.id) {
      case 'grass':
        return F.grassTuft(seed);
      case 'meadow':
        return F.grassTuft(seed, { blades: 24, height: 1.15, base: [0.18, 0.24, 0.09], tip: v % 2 ? [0.62, 0.62, 0.28] : [0.42, 0.55, 0.2], spread: 1.6 });
      case 'snowgrass':
        return F.grassTuft(seed, { blades: 12, height: 1.1, base: [0.42, 0.38, 0.26], tip: [0.8, 0.72, 0.5] });
      case 'shrub':
        return F.sagebrush(seed, { lod });
      case 'tundrashrub':
        return lod ? F.sagebrush(seed, { lod: 1, palette: [0.36, 0.28, 0.17] }) : F.tundraShrub(seed);
      case 'fern':
        return F.fern(seed);
      case 'flowers':
        return F.flowers(seed, FLOWER_PALETTES[v % FLOWER_PALETTES.length]);
      case 'reeds':
        return F.reeds(seed);
      case 'pebble':
        return F.rock(seed, 'pebble');
      case 'barrel':
        return F.barrelCactus(seed);
      case 'boulder':
        return F.rock(seed, 'boulder', { lod });
      case 'snowrock':
        return F.rock(seed + 5, 'boulder', { lod });
      case 'slab':
        return F.rock(seed, 'slab', { lod });
      case 'saguaro':
        return F.saguaro(seed).geometry;
      case 'joshua':
        return F.joshuaTree(seed);
      case 'deadtree':
        return F.deadTree(seed);
      case 'hoodoo':
        return F.hoodoo(seed).geometry;
      case 'pine':
        return F.conifer(seed);
      case 'snowpine':
        return F.conifer(seed, { snow: 1, spruce: v % 2 === 0 });
      case 'birch':
        return F.broadleaf(seed, { autumn: v === 2 ? 0.85 : v * 0.15 });
      case 'birchbare':
        return F.broadleaf(seed, { bare: true, snow: 1 });
      case 'stump':
        return F.stump(seed);
      case 'log':
        return F.fallenLog(seed);
    }
    return F.rock(seed, 'pebble');
  }

  materialFor(def) {
    if (def.rock) return def.id === 'snowrock' ? this.snowRockMat : this.rockMat;
    if (def.sway === 'grass') return this.grassMat;
    if (def.sway === 'shrub') return this.swayMat;
    if (def.sway === 'tree') return def.snow ? this.snowTreeMat : this.treeMat;
    return def.snow ? this.snowSolidMat : this.solidMat;
  }

  buildVariants() {
    const impostorSrc = [];
    for (const def of SPECIES) {
      const list = [];
      for (let v = 0; v < def.variants; v++) {
        const g0 = this.geometryFor(def, v, 0);
        g0.computeBoundingSphere();
        g0.computeBoundingBox();
        const cap = CAP[def.id] || [500, 1000];
        const m0 = this.instanced(g0, this.materialFor(def), cap[0], def);
        m0.castShadow = def.shadow !== false;
        let m1 = null;
        if (def.lod1 === 'mesh') {
          const g1 = def.id === 'hoodoo' ? g0 : this.geometryFor(def, v, 1);
          g1.computeBoundingSphere();
          m1 = this.instanced(g1, this.materialFor(def), cap[1], def);
        } else if (def.lod1 === 'impostor') impostorSrc.push({ def, v, geo: g0, cap: cap[1] });
        list.push([m0, m1]);
      }
      this.meshes.push(list);
    }
    // bake every tree and cactus into one atlas of billboard cards
    if (impostorSrc.length) {
      const baked = bakeImpostors(
        this.game.renderer.renderer,
        impostorSrc.map((s) => s.geo),
        { snow: impostorSrc.map((s) => !!s.def.snow) }
      );
      this.impostorTex = baked.texture;
      this.impostorMat = createImpostorMaterial(baked.texture);
      impostorSrc.forEach((s, i) => {
        const m1 = this.instanced(baked.quads[i], this.impostorMat, s.cap, s.def);
        this.meshes[SPECIES.indexOf(s.def)][s.v][1] = m1;
      });
    }
  }

  instanced(geo, mat, cap, def) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, cap));
    im.count = 0;
    im.visible = false;
    im.castShadow = false;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (def.rock) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
    this.group.add(im);
    return im;
  }

  // ------------------------------------------------------------------ cell data
  startWorker() {
    try {
      this.worker = new Worker(new URL('./scatterWorker.js', import.meta.url), { type: 'module' });
      this.worker.postMessage({ type: 'init', seed: this.gen.seed });
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type !== 'cell') return;
        const c = this.cells.get(m.ci + ',' + m.cj);
        if (!c || c.data) return;
        c.data = m.data;
        this.dirty = true;
      };
    } catch (err) {
      this.worker = null;
    }
  }

  update(px, pz) {
    // px, pz are global coordinates
    const ci = Math.floor(px / CELL),
      cj = Math.floor(pz / CELL);
    const key = ci + ',' + cj;
    const now = performance.now();
    if (key !== this.lastCell) {
      const first = this.lastCell === null && this.cells.size === 0;
      this.lastCell = key;
      this.pc = [ci, cj];
      const R = Math.ceil(this.farRadius / CELL);
      const want = new Set();
      const ask = [];
      for (let j = -R; j <= R; j++)
        for (let i = -R; i <= R; i++) {
          const cx = (ci + i) * CELL + CELL / 2,
            cz = (cj + j) * CELL + CELL / 2;
          if (Math.hypot(cx - px, cz - pz) > this.farRadius + CELL) continue;
          const k = ci + i + ',' + (cj + j);
          want.add(k);
          if (this.cells.has(k)) continue;
          const c = { ci: ci + i, cj: cj + j, data: null, colliders: null };
          this.cells.set(k, c);
          // the ground around the player can't wait for the worker (or there is none)
          if (!this.worker || (first && Math.max(Math.abs(i), Math.abs(j)) <= 2)) c.data = cellInstances(this.gen, c.ci, c.cj);
          else ask.push([c.ci, c.cj, Math.max(Math.abs(i), Math.abs(j))]);
        }
      if (ask.length) {
        ask.sort((a, b) => a[2] - b[2]);
        this.worker.postMessage({ type: 'cells', cells: ask.map((a) => [a[0], a[1]]) });
      }
      for (const [k, c] of this.cells)
        if (!want.has(k)) {
          if (c.colliders) this.game.physics.removeBody(c.colliders);
          this.cells.delete(k);
        }
      this.rebuildInstances(px, pz);
      this.lastRebuild = now;
      this.dirty = false;
    } else if (this.dirty && now - this.lastRebuild > 250) {
      this.rebuildInstances(px, pz);
      this.lastRebuild = now;
      this.dirty = false;
    }
    this.updateColliders(px, pz);
  }

  rebuildInstances(px, pz) {
    const [pci, pcj] = this.pc || [Math.floor(px / CELL), Math.floor(pz / CELL)];
    const o = this.game.origin;
    for (const list of this.meshes) for (const pair of list) for (const im of pair) if (im) im.userData.n = 0;
    const order = [];
    for (const c of this.cells.values()) {
      if (!c.data || !c.data.length) continue;
      const ring = Math.max(Math.abs(c.ci - pci), Math.abs(c.cj - pcj));
      const d = Math.hypot((c.ci + 0.5) * CELL - px, (c.cj + 0.5) * CELL - pz);
      order.push({ c, ring, d });
    }
    order.sort((a, b) => a.ring - b.ring || a.d - b.d);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qt = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sv = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const col = new THREE.Color();
    const farR = this.farRadius;
    for (const { c, ring, d } of order) {
      const data = c.data;
      const x0 = c.ci * CELL - o.x,
        z0 = c.cj * CELL - o.z;
      for (let k = 0; k < data.length; k += STRIDE) {
        const si = data[k];
        const def = SPECIES[si];
        const aux = data[k + 7];
        let lod;
        if (def.near) {
          if (ring > def.near) continue;
          if (ring === def.near && !def.rock && aux > 0.5) continue;
          lod = ring <= 1 ? 0 : def.lod1 ? 1 : 0;
        } else {
          if (d > farR * (def.far || 1) + CELL * 0.5) continue;
          lod = ring <= 1 || !def.lod1 ? 0 : 1;
        }
        const im = this.meshes[si][data[k + 1]][lod];
        if (!im) continue;
        const idx = im.userData.n;
        if (idx >= im.instanceMatrix.count) continue;
        im.userData.n = idx + 1;
        const s = data[k + 5],
          rot = data[k + 6];
        const tx = x0 + data[k + 2],
          ty = data[k + 3] - sinkOf(def, s),
          tz = z0 + data[k + 4];
        const arr = im.instanceMatrix.array;
        const off = idx * 16;
        if (def.rock) {
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot);
          qt.setFromEuler(e.set((rot % 0.3) - 0.15, 0, ((rot * 7) % 0.3) - 0.15));
          q.multiply(qt);
          m4.compose(pv.set(tx, ty, tz), q, sv.setScalar(s));
          m4.toArray(arr, off);
          const bi = Math.floor(aux);
          const t = ROCK_TINT[BIOME_LIST[bi]] || ROCK_TINT.scrub;
          const vv = 0.9 + (aux - bi) * 0.4;
          col.setRGB(t[0] * vv, t[1] * vv, t[2] * vv);
          im.setColorAt(idx, col);
        } else {
          const cs = Math.cos(rot) * s,
            sn = Math.sin(rot) * s;
          arr[off] = cs;
          arr[off + 1] = 0;
          arr[off + 2] = -sn;
          arr[off + 3] = 0;
          arr[off + 4] = 0;
          arr[off + 5] = s;
          arr[off + 6] = 0;
          arr[off + 7] = 0;
          arr[off + 8] = sn;
          arr[off + 9] = 0;
          arr[off + 10] = cs;
          arr[off + 11] = 0;
          arr[off + 12] = tx;
          arr[off + 13] = ty;
          arr[off + 14] = tz;
          arr[off + 15] = 1;
        }
      }
    }
    for (const list of this.meshes)
      for (const pair of list)
        for (const im of pair) {
          if (!im) continue;
          const n = im.userData.n;
          im.count = n;
          im.visible = n > 0;
          if (!n) continue;
          // upload only the part in use
          im.instanceMatrix.clearUpdateRanges();
          im.instanceMatrix.addUpdateRange(0, n * 16);
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) {
            im.instanceColor.clearUpdateRanges();
            im.instanceColor.addUpdateRange(0, n * 3);
            im.instanceColor.needsUpdate = true;
          }
        }
  }

  updateColliders(px, pz) {
    const o = this.game.origin;
    let built = 0;
    for (const c of this.cells.values()) {
      const cx = c.ci * CELL + CELL / 2,
        cz = c.cj * CELL + CELL / 2;
      const d = Math.hypot(cx - px, cz - pz);
      if (d < 120 && !c.colliders && c.data && built < 2) {
        built++;
        const body = this.game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
        const data = c.data;
        const x0 = c.ci * CELL - o.x,
          z0 = c.cj * CELL - o.z;
        for (let k = 0; k < data.length; k += STRIDE) {
          const def = SPECIES[data[k]];
          if (!def.solid) continue;
          const s = data[k + 5];
          const x = x0 + data[k + 2],
            z = z0 + data[k + 4],
            y = data[k + 3] - sinkOf(def, s);
          let desc;
          if (def.solid === 'ball') desc = RAPIER.ColliderDesc.ball(s * 0.75).setTranslation(x, y + s * 0.2, z);
          else if (def.solid === 'trunkWide') desc = RAPIER.ColliderDesc.cylinder(3 * s, 1.1 * s).setTranslation(x, y + 3 * s, z);
          else if (def.solid === 'stump') desc = RAPIER.ColliderDesc.cylinder(0.3 * s, 0.3 * s).setTranslation(x, y + 0.3 * s, z);
          else if (def.solid === 'log') {
            const rot = data[k + 6];
            const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, Math.PI / 2, 'YXZ'));
            desc = RAPIER.ColliderDesc.capsule(1.4 * s, 0.22 * s)
              .setTranslation(x, y + 0.22 * s, z)
              .setRotation({ x: qq.x, y: qq.y, z: qq.z, w: qq.w });
          } else desc = RAPIER.ColliderDesc.cylinder(1.5 * s, 0.22 * s).setTranslation(x, y + 1.5 * s, z);
          desc.setCollisionGroups(GROUPS.world).setFriction(0.8);
          const col = this.game.physics.world.createCollider(desc, body);
          this.game.physics.setOwner(col, { kind: 'scenery', surface: def.rock ? 'rock' : 'wood', species: def.id });
        }
        c.colliders = body;
      } else if (d > 170 && c.colliders) {
        this.game.physics.removeBody(c.colliders);
        c.colliders = null;
      }
    }
  }

  setTime(t, wind) {
    for (const m of [this.swayMat, this.grassMat, this.treeMat, this.snowTreeMat]) {
      m.userData.uniforms.uTime.value = t;
      m.userData.uniforms.uWind.value = wind;
    }
  }

  rebase() {
    // instances are rebuilt relative to the new origin; colliders were shifted with all bodies
    this.lastCell = null;
  }
}
