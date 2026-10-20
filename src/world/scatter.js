// Biome-driven scattering of flora and rocks around the player with instanced meshes.
//
// Placement runs in a worker (scatterGen.js) per 64 m cell. Near the player (the 3x3 cells
// around them) every species uses its full model and casts shadows; further out trees and cacti
// become baked billboard impostors, rocks and shrubs a coarser mesh, and ground cover thins out
// and stops. Static colliders are built for solid objects close by.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import * as F from './flora.js';
import { texturedConifer, texturedBroadleaf, texturedShrub, treeMaterials } from './trees.js';
import { bakeImpostors, createImpostorMaterial } from '../gfx/impostor.js';
import { SPECIES, CELL, STRIDE, BIOME_LIST, sinkOf, cellInstances } from './scatterGen.js';
import { BIOME_INFO } from './worldGen.js';
import { settings } from '../core/settings.js';

// Loose rock takes the same tint the terrain shader gives exposed rock in that biome, so boulders,
// hoodoos and cliffs read as one stone.
const ROCK_TINT = Object.fromEntries(
  Object.entries(BIOME_INFO).map(([b, { ground: g }]) => {
    const lum = Math.max((g[0] + g[1] + g[2]) / 3, 0.01);
    return [b, g.map((c) => (1 + (c / lum - 1) * 0.55) * 0.7)];
  })
);

const FLOWER_PALETTES = [
  [[0.62, 0.32, 0.72], [0.52, 0.28, 0.66]],
  [[0.92, 0.78, 0.18], [0.95, 0.66, 0.12]],
  [[0.94, 0.92, 0.88], [0.86, 0.84, 0.9]],
  [[0.86, 0.26, 0.2], [0.92, 0.5, 0.18]],
];

// instance capacity per variant: [near model, far stand-in]
const CAP = {
  grass: [9000, 0],
  meadow: [24000, 0],
  snowgrass: [2500, 0],
  shrub: [1600, 3600],
  yucca: [500, 0],
  ocotillo: [150, 600],
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
  pine: [900, 9000, 2400],
  snowpine: [900, 9000, 2400],
  birch: [300, 2500, 800],
  birchbare: [200, 1500, 600],
  stump: [200, 0],
  log: [120, 0],
};

const FAR_BY_QUALITY = { low: 520, medium: 700, high: 880, ultra: 1000 };

export class Scatter {
  constructor(game, tex, treeTex) {
    this.game = game;
    this.gen = game.gen;
    this.group = new THREE.Group();
    this.group.name = 'scatter';
    game.worldGroup.add(this.group);
    this.grassMat = F.createFloraMaterial({ sway: 0.6 });
    // painted card ground cover
    this.grassTallMat = F.createFloraMaterial({ sway: 0.32, map: treeTex.flora.grass_tall, alphaTest: 0.38, roughness: 0.95 });
    this.grassShortMat = F.createFloraMaterial({ sway: 0.32, map: treeTex.flora.grass_short, alphaTest: 0.38, roughness: 0.95 });
    this.fernMat = F.createFloraMaterial({ sway: 0.12, map: treeTex.flora.fern, alphaTest: 0.4, roughness: 0.85 });
    this.swayMat = F.createFloraMaterial({ sway: 0.12 });
    this.solidMat = F.createFloraMaterial({});
    this.snowSolidMat = F.createFloraMaterial({ snow: true, doubleSide: true });
    this.rockMat = F.createRockMaterial(tex);
    this.snowRockMat = F.createRockMaterial(tex, { snow: true });
    // textured trees: [bark, foliage] pairs
    const T = treeTex;
    this.treeMats = {
      pine: treeMaterials(T, { bark: 'pine', leaf: 'pine', tint: 0xc9d4bf }),
      snowpine: treeMaterials(T, { bark: 'pine', leaf: 'pine', tint: 0xb8c4b4, snow: true }),
      birch: treeMaterials(T, { bark: 'birch', leaf: 'aspen_green', tint: 0xa9b892 }),
      birchAutumn: treeMaterials(T, { bark: 'birch', leaf: 'aspen_autumn', tint: 0xe0d0b8 }),
      birchbare: treeMaterials(T, { bark: 'birch', leaf: null, snow: true }),
      shrub: treeMaterials(T, { bark: 'oak', leaf: 'pine', tint: 0xd6dac8, sway: 0.05, sat: 0.22 }),
      tundrashrub: treeMaterials(T, { bark: 'oak', leaf: 'oak', tint: 0xb07850, sway: 0.05, sat: 0.4 }),
    };
    this.treeTex = T;
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
        return F.grassClump(seed, { height: 0.42, width: 0.8, tint: [[0.24, 0.19, 0.11], [0.19, 0.17, 0.1], [0.27, 0.22, 0.13], [0.16, 0.16, 0.09]][v % 4] });
      case 'meadow':
        return F.grassClump(seed, { height: 0.75, width: 0.85, tint: [[0.1, 0.17, 0.045], [0.15, 0.19, 0.06], [0.085, 0.15, 0.04], [0.2, 0.19, 0.075]][v % 4] });
      case 'snowgrass':
        return F.grassClump(seed, { height: 0.5, width: 0.7, tint: [0.3, 0.25, 0.16] });
      case 'shrub':
        return texturedShrub(seed, { lod, height: 1.0 });
      case 'tundrashrub':
        return texturedShrub(seed, { lod, height: 0.7, spread: 1.4 });
      case 'fern':
        return F.fernClump(seed, { tint: [[0.42, 0.5, 0.36], [0.5, 0.52, 0.38], [0.36, 0.44, 0.32]][v % 3] });
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
      case 'yucca':
        return F.yucca(seed);
      case 'ocotillo':
        return F.ocotillo(seed);
      case 'deadtree':
        return F.deadTree(seed);
      case 'hoodoo':
        return F.hoodoo(seed).geometry;
      case 'pine':
        return texturedConifer(seed, { spruce: v % 2 === 0, lod });
      case 'snowpine':
        return texturedConifer(seed, { spruce: v !== 3, lod });
      case 'birch':
        return texturedBroadleaf(seed, { lod });
      case 'birchbare':
        return texturedBroadleaf(seed, { bare: true, lod });
      case 'stump':
        return F.stump(seed);
      case 'log':
        return F.fallenLog(seed);
    }
    return F.rock(seed, 'pebble');
  }

  materialFor(def, v = 0) {
    if (def.id === 'birch') return v === 2 ? this.treeMats.birchAutumn : this.treeMats.birch;
    if (this.treeMats[def.id]) return this.treeMats[def.id];
    if (def.rock) return def.id === 'snowrock' ? this.snowRockMat : this.rockMat;
    if (def.id === 'meadow') return this.grassTallMat;
    if (def.id === 'grass' || def.id === 'snowgrass') return this.grassShortMat;
    if (def.id === 'fern') return this.fernMat;
    if (def.sway === 'grass') return this.grassMat;
    if (def.sway === 'shrub') return this.swayMat;
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
        const mat = this.materialFor(def, v);
        const m0 = this.instanced(g0, mat, cap[0], def);
        m0.castShadow = def.shadow !== false;
        let m1 = null,
          m2 = null;
        if (def.lod1 === 'mesh') {
          const g1 = def.id === 'hoodoo' ? g0 : this.geometryFor(def, v, 1);
          g1.computeBoundingSphere();
          m1 = this.instanced(g1, mat, cap[1], def);
        } else if (def.lod1 === 'impostor') impostorSrc.push({ def, v, geo: g0, mats: Array.isArray(mat) ? mat : null, cap: cap[1] });
        // textured trees have a coarser mesh between the full model and the billboard
        if (def.mid) {
          const g2 = this.geometryFor(def, v, 1);
          g2.computeBoundingSphere();
          m2 = this.instanced(g2, mat, cap[2] || cap[0] * 2, def);
          m2.castShadow = def.shadow !== false && settings.data.quality !== 'low';
        }
        list.push([m0, m1, m2]);
      }
      this.meshes.push(list);
    }
    // bake every tree and cactus into one atlas of billboard cards
    if (impostorSrc.length) {
      const baked = bakeImpostors(
        this.game.renderer.renderer,
        impostorSrc.map((s) => s.geo),
        { snow: impostorSrc.map((s) => !!s.def.snow), materials: impostorSrc.map((s) => s.mats) }
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
          lod = ring <= 1 || !def.lod1 ? 0 : def.mid && ring <= def.mid ? 2 : 1;
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
          const tilt = def.id === 'hoodoo' ? 0.2 : 1;
          qt.setFromEuler(e.set(((rot % 0.3) - 0.15) * tilt, 0, (((rot * 7) % 0.3) - 0.15) * tilt));
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
          else if (def.solid === 'trunkWide') desc = RAPIER.ColliderDesc.cylinder(1.6 * s, 1.0 * s).setTranslation(x, y + 1.6 * s, z);
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
    for (const m of [this.swayMat, this.grassMat, this.grassTallMat, this.grassShortMat, this.fernMat, ...Object.values(this.treeMats).flat()]) {
      m.userData.uniforms.uTime.value = t;
      m.userData.uniforms.uWind.value = wind;
    }
  }

  rebase() {
    // instances are rebuilt relative to the new origin; colliders were shifted with all bodies
    this.lastCell = null;
  }
}
