// Biome-driven scattering of flora and rocks around the player using instanced meshes,
// with static colliders for solid objects near the player.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { hashInts, mulberry32, smoothstep } from '../core/noise.js';
import { ROAD, POI_SPACING } from './worldGen.js';
import * as F from './flora.js';

const CELL = 64;

// density per 1000 m² for each biome
const SPECIES = {
  grass: { variants: 5, near: true, dens: { scrub: 55, dunes: 5, badlands: 7, saltflat: 0.3, highland: 30 }, scale: [1.0, 1.8], sway: true },
  shrub: { variants: 5, near: true, dens: { scrub: 12, dunes: 1.2, badlands: 2.5, saltflat: 0.05, highland: 6 }, scale: [0.7, 1.5], sway: true },
  pebble: { variants: 4, near: true, dens: { scrub: 2, dunes: 0.3, badlands: 5, saltflat: 0.2, highland: 7 }, scale: [0.12, 0.35], rock: true },
  barrel: { variants: 2, near: true, dens: { scrub: 0.4, dunes: 0.05, badlands: 0.6, saltflat: 0, highland: 0.2 }, scale: [0.8, 1.3] },
  boulder: { variants: 6, dens: { scrub: 0.25, dunes: 0.04, badlands: 1.1, saltflat: 0.02, highland: 1.6 }, scale: [0.6, 2.2], rock: true, solid: 'ball' },
  slab: { variants: 3, dens: { scrub: 0.1, dunes: 0.02, badlands: 0.4, saltflat: 0.01, highland: 0.5 }, scale: [0.8, 2.4], rock: true, solid: 'ball' },
  saguaro: { variants: 4, dens: { scrub: 0.12, dunes: 0.02, badlands: 0.25, saltflat: 0, highland: 0.12 }, scale: [0.85, 1.2], solid: 'trunk' },
  joshua: { variants: 3, dens: { scrub: 0.18, dunes: 0, badlands: 0.04, saltflat: 0, highland: 0.3 }, scale: [0.9, 1.5], solid: 'trunk' },
  deadtree: { variants: 3, dens: { scrub: 0.05, dunes: 0.02, badlands: 0.06, saltflat: 0.01, highland: 0.1 }, scale: [0.8, 1.4], solid: 'trunk' },
  hoodoo: { variants: 3, dens: { scrub: 0, dunes: 0, badlands: 0.06, saltflat: 0, highland: 0.02 }, scale: [1, 2.2], rock: true, solid: 'trunkWide' },
};

const ROCK_TINT = {
  scrub: [0.82, 0.74, 0.64],
  dunes: [0.95, 0.82, 0.66],
  badlands: [0.98, 0.62, 0.45],
  saltflat: [0.85, 0.83, 0.8],
  highland: [0.72, 0.7, 0.68],
};

export class Scatter {
  constructor(game, tex) {
    this.game = game;
    this.gen = game.gen;
    this.group = new THREE.Group();
    this.group.name = 'scatter';
    game.worldGroup.add(this.group);
    this.swayMat = F.createFloraMaterial({ sway: 0.12 });
    this.grassMat = F.createFloraMaterial({ sway: 0.6 });
    this.solidMat = F.createFloraMaterial({});
    this.rockMat = F.createRockMaterial(tex);
    this.meshes = {}; // species -> [InstancedMesh per variant]
    this.cells = new Map(); // key -> { instances: [...], colliders: body|null }
    this.lastCell = null;
    this.nearRadius = 230;
    this.farRadius = 900;
    this.buildVariants();
  }

  buildVariants() {
    const cap = { grass: 16000, shrub: 4500, pebble: 3000, barrel: 600, boulder: 2500, slab: 1200, saguaro: 1200, joshua: 1200, deadtree: 600, hoodoo: 300 };
    for (const [sp, def] of Object.entries(SPECIES)) {
      this.meshes[sp] = [];
      for (let v = 0; v < def.variants; v++) {
        const seed = 1000 + v * 37 + sp.length * 101;
        let geo;
        switch (sp) {
          case 'grass':
            geo = F.grassTuft(seed);
            break;
          case 'shrub':
            geo = F.sagebrush(seed);
            break;
          case 'pebble':
            geo = F.rock(seed, 'pebble');
            break;
          case 'barrel':
            geo = F.barrelCactus(seed);
            break;
          case 'boulder':
            geo = F.rock(seed, 'boulder');
            break;
          case 'slab':
            geo = F.rock(seed, 'slab');
            break;
          case 'saguaro':
            geo = F.saguaro(seed).geometry;
            break;
          case 'joshua':
            geo = F.joshuaTree(seed);
            break;
          case 'deadtree':
            geo = F.deadTree(seed);
            break;
          case 'hoodoo':
            geo = F.hoodoo(seed).geometry;
            break;
        }
        geo.computeBoundingSphere();
        const mat = def.rock ? this.rockMat : sp === 'grass' ? this.grassMat : def.sway ? this.swayMat : this.solidMat;
        const per = Math.ceil(cap[sp] / def.variants);
        const im = new THREE.InstancedMesh(geo, mat, per);
        im.count = 0;
        im.castShadow = sp !== 'grass' && sp !== 'pebble';
        im.receiveShadow = true;
        im.frustumCulled = false;
        if (def.rock) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(per * 3), 3);
        this.group.add(im);
        this.meshes[sp].push(im);
      }
    }
  }

  // Deterministic instances for one cell.
  cellInstances(ci, cj) {
    const gen = this.gen;
    const out = [];
    const x0 = ci * CELL,
      z0 = cj * CELL;
    const bw = gen.biomeWeights(x0 + CELL / 2, z0 + CELL / 2);
    const rnd = mulberry32(hashInts(gen.seed, ci, cj, 77));
    const pois = gen.poisNear(z0 + CELL / 2, 1);
    for (const [sp, def] of Object.entries(SPECIES)) {
      let dens = 0;
      for (const b in bw) dens += (def.dens[b] || 0) * bw[b];
      const expected = (dens * CELL * CELL) / 1000;
      let n = Math.floor(expected);
      if (rnd() < expected - n) n++;
      for (let i = 0; i < n; i++) {
        // clustered placement for grass/shrubs via noise acceptance
        const x = x0 + rnd() * CELL,
          z = z0 + rnd() * CELL;
        const r1 = rnd(),
          r2 = rnd(),
          r3 = rnd();
        if (def.near && gen.nC.noise2(x * 0.03, z * 0.03) < -0.35 + r3 * 0.2) continue;
        const rx = gen.roadX(z);
        const dRoad = Math.abs(x - rx);
        if (dRoad < ROAD.halfWidth + ROAD.shoulder + (def.solid ? 6 : 1.5)) continue;
        let blocked = false;
        for (const p of pois) if (Math.hypot(x - p.x, z - p.z) < p.padR + (def.solid ? 8 : 2)) blocked = true;
        if (blocked) continue;
        const y = gen.height(x, z);
        if (!def.rock) {
          const nrm = gen.normal(x, z, 1.0);
          if (nrm[1] < 0.86) continue;
        }
        const s = def.scale[0] + (def.scale[1] - def.scale[0]) * r1 * r1;
        out.push({ sp, v: Math.floor(r2 * def.variants), x, y, z, s, rot: rnd() * Math.PI * 2, biome: Object.entries(bw).sort((a, b) => b[1] - a[1])[0][0], sink: def.rock ? s * 0.18 : 0.02 });
      }
    }
    return out;
  }

  update(px, pz) {
    // px, pz are global coordinates
    const ci = Math.floor(px / CELL),
      cj = Math.floor(pz / CELL);
    const key = ci + ',' + cj;
    if (key === this.lastCell) {
      this.updateColliders(px, pz);
      return;
    }
    this.lastCell = key;
    const R = Math.ceil(this.farRadius / CELL);
    const want = new Set();
    for (let j = -R; j <= R; j++)
      for (let i = -R; i <= R; i++) {
        const cx = (ci + i) * CELL + CELL / 2,
          cz = (cj + j) * CELL + CELL / 2;
        const d = Math.hypot(cx - px, cz - pz);
        if (d > this.farRadius + CELL) continue;
        // only cells near the road corridor matter for far objects
        const k = ci + i + ',' + (cj + j);
        want.add(k);
        if (!this.cells.has(k)) this.cells.set(k, { instances: this.cellInstances(ci + i, cj + j), colliders: null, ci: ci + i, cj: cj + j });
      }
    for (const [k, c] of this.cells)
      if (!want.has(k)) {
        if (c.colliders) this.game.physics.removeBody(c.colliders);
        this.cells.delete(k);
      }
    this.rebuildInstances(px, pz);
    this.updateColliders(px, pz);
  }

  rebuildInstances(px, pz) {
    const counts = {};
    for (const sp of Object.keys(this.meshes)) counts[sp] = this.meshes[sp].map(() => 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const o = this.game.origin;
    const col = new THREE.Color();
    for (const c of this.cells.values()) {
      for (const it of c.instances) {
        const def = SPECIES[it.sp];
        const d = Math.hypot(it.x - px, it.z - pz);
        if (def.near && d > this.nearRadius) continue;
        if (!def.near && d > this.farRadius) continue;
        const im = this.meshes[it.sp][it.v];
        const idx = counts[it.sp][it.v];
        if (idx >= im.instanceMatrix.count) continue;
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, it.rot);
        if (def.rock) {
          const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((it.rot % 0.3) - 0.15, 0, ((it.rot * 7) % 0.3) - 0.15));
          q.multiply(tilt);
        }
        sc.setScalar(it.s);
        p.set(it.x - o.x, it.y - it.sink, it.z - o.z);
        m.compose(p, q, sc);
        im.setMatrixAt(idx, m);
        if (im.instanceColor) {
          const t = ROCK_TINT[it.biome] || ROCK_TINT.scrub;
          const v = 0.9 + ((it.rot * 13) % 0.2);
          col.setRGB(t[0] * v, t[1] * v, t[2] * v);
          im.setColorAt(idx, col);
        }
        counts[it.sp][it.v]++;
      }
    }
    for (const [sp, list] of Object.entries(this.meshes))
      list.forEach((im, v) => {
        im.count = counts[sp][v];
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      });
  }

  updateColliders(px, pz) {
    const o = this.game.origin;
    let built = 0;
    for (const c of this.cells.values()) {
      const cx = c.ci * CELL + CELL / 2,
        cz = c.cj * CELL + CELL / 2;
      const d = Math.hypot(cx - px, cz - pz);
      if (d < 120 && !c.colliders && built < 2) {
        built++;
        const body = this.game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
        for (const it of c.instances) {
          const def = SPECIES[it.sp];
          if (!def.solid) continue;
          let desc;
          const x = it.x - o.x,
            z = it.z - o.z;
          if (def.solid === 'ball') desc = RAPIER.ColliderDesc.ball(it.s * 0.75).setTranslation(x, it.y - it.sink + it.s * 0.2, z);
          else if (def.solid === 'trunkWide') desc = RAPIER.ColliderDesc.cylinder(3 * it.s, 1.1 * it.s).setTranslation(x, it.y + 3 * it.s, z);
          else desc = RAPIER.ColliderDesc.cylinder(1.5 * it.s, 0.22 * it.s).setTranslation(x, it.y + 1.5 * it.s, z);
          desc.setCollisionGroups(GROUPS.world).setFriction(0.8);
          const col = this.game.physics.world.createCollider(desc, body);
          this.game.physics.setOwner(col, { kind: 'scenery', surface: def.rock ? 'rock' : 'wood', species: it.sp });
        }
        c.colliders = body;
      } else if (d > 170 && c.colliders) {
        this.game.physics.removeBody(c.colliders);
        c.colliders = null;
      }
    }
  }

  setTime(t, wind) {
    for (const m of [this.swayMat, this.grassMat]) {
      m.userData.uniforms.uTime.value = t;
      m.userData.uniforms.uWind.value = wind;
    }
  }

  rebase() {
    // instances are rebuilt relative to the new origin; colliders were shifted with all bodies
    this.lastCell = null;
    for (const c of this.cells.values()) {
      if (c.colliders) {
        // static bodies were shifted with all others; nothing else to do
      }
    }
  }
}
