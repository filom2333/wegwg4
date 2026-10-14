// Streams terrain tiles (quadtree LOD, built in a worker), road segments and physics
// heightfields around the player. All scene positions are relative to the floating origin.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { ROAD } from './worldGen.js';

const ROOT = 2048;
const MIN_TILE = 64;
const VIEW_RADIUS = 3200;
const SEG = 64; // road segment length (m along z)
const COLLIDER_TILE = 48;
const COLLIDER_RADIUS = 110;

export class Terrain {
  constructor({ gen, scene, physics, terrainMaterial, roadMaterial, origin, quality = 'high' }) {
    this.gen = gen;
    this.scene = scene;
    this.physics = physics;
    this.material = terrainMaterial;
    this.roadMaterial = roadMaterial;
    this.origin = origin; // { x, z } shared object
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.tiles = new Map(); // key -> { mesh, x0, z0, size }
    this.pending = new Map(); // id -> request
    this.wanted = new Set();
    this.roadSegs = new Map();
    this.colliders = new Map();
    this.nextId = 1;
    this.viewRadius = quality === 'low' ? 1800 : VIEW_RADIUS;
    this.ready = false;
    this.worker = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onWorker(e.data);
    this.workerReady = new Promise((res) => (this._resolveReady = res));
    this.worker.postMessage({ type: 'init', seed: gen.seed });
    this.lastKeySet = '';
    this.queue = [];
    this.inflight = 0;
  }

  onWorker(msg) {
    if (msg.type === 'ready') {
      this._resolveReady();
      return;
    }
    if (msg.type === 'tile') {
      this.inflight--;
      const req = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (!req) return;
      if (!this.wanted.has(req.key)) return; // no longer needed
      const mesh = this.makeTileMesh(msg.data, req);
      this.tiles.set(req.key, { mesh, x0: req.x0, z0: req.z0, size: req.size, building: false });
      this.pump();
      this.retireCovered();
    }
  }

  makeTileMesh(d, req) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
    g.setAttribute('mat', new THREE.BufferAttribute(d.mat, 4));
    g.setAttribute('tint', new THREE.BufferAttribute(d.tint, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, d.minY - 3, 0), new THREE.Vector3(req.size, d.maxY, req.size));
    g.boundingSphere = new THREE.Sphere();
    g.boundingBox.getBoundingSphere(g.boundingSphere);
    const m = new THREE.Mesh(g, this.material);
    m.position.set(req.x0 - this.origin.x, 0, req.z0 - this.origin.z);
    m.receiveShadow = true;
    m.castShadow = req.size <= 128;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.userData.tile = req;
    this.group.add(m);
    return m;
  }

  // Quadtree selection of leaf tiles around (px, pz).
  selectTiles(px, pz) {
    const out = [];
    const r0 = Math.ceil(this.viewRadius / ROOT);
    const cx = Math.floor(px / ROOT),
      cz = Math.floor(pz / ROOT);
    const visit = (x0, z0, size) => {
      const cxm = x0 + size / 2,
        czm = z0 + size / 2;
      const dx = Math.max(Math.abs(px - cxm) - size / 2, 0),
        dz = Math.max(Math.abs(pz - czm) - size / 2, 0);
      const d = Math.hypot(dx, dz);
      if (d > this.viewRadius) return;
      if (size > MIN_TILE && d < size * 1.25) {
        const h = size / 2;
        visit(x0, z0, h);
        visit(x0 + h, z0, h);
        visit(x0, z0 + h, h);
        visit(x0 + h, z0 + h, h);
      } else out.push({ x0, z0, size, d });
    };
    for (let j = -r0; j <= r0; j++) for (let i = -r0; i <= r0; i++) visit((cx + i) * ROOT, (cz + j) * ROOT, ROOT);
    return out;
  }

  key(t) {
    return t.x0 + ',' + t.z0 + ',' + t.size;
  }

  update(px, pz) {
    // terrain tiles (re-select when the player crosses half a minimum tile)
    const qx = Math.round(px / (MIN_TILE / 2)),
      qz = Math.round(pz / (MIN_TILE / 2));
    const sig = qx + ':' + qz;
    if (sig !== this.lastKeySet) {
      this.lastKeySet = sig;
      const sel = this.selectTiles(px, pz);
      this.wanted = new Set(sel.map((t) => this.key(t)));
      this.queue = sel.filter((t) => !this.tiles.has(this.key(t)) && ![...this.pending.values()].some((p) => p.key === this.key(t)));
      this.queue.sort((a, b) => a.d - b.d);
      this.pump();
      this.retireCovered();
    }
    this.updateRoad(px, pz);
    this.updateColliders(px, pz);
  }

  pump() {
    while (this.inflight < 3 && this.queue.length) {
      const t = this.queue.shift();
      const key = this.key(t);
      if (this.tiles.has(key) || !this.wanted.has(key)) continue;
      const id = this.nextId++;
      const N = t.size <= MIN_TILE ? 64 : 32;
      this.pending.set(id, { ...t, key, N });
      this.inflight++;
      this.worker.postMessage({ type: 'tile', id, x0: t.x0, z0: t.z0, size: t.size, N });
    }
  }

  // Remove tiles that are no longer wanted once the wanted tiles covering them are present.
  retireCovered() {
    let allPresent = true;
    for (const k of this.wanted) if (!this.tiles.has(k)) allPresent = false;
    for (const [k, t] of this.tiles) {
      if (this.wanted.has(k)) continue;
      // check coverage by present wanted tiles
      let covered = allPresent;
      if (!covered) {
        covered = true;
        for (const wk of this.wanted) {
          const [x0, z0, size] = wk.split(',').map(Number);
          const overlap = x0 < t.x0 + t.size && x0 + size > t.x0 && z0 < t.z0 + t.size && z0 + size > t.z0;
          if (overlap && !this.tiles.has(wk)) {
            covered = false;
            break;
          }
        }
      }
      if (covered) {
        this.group.remove(t.mesh);
        t.mesh.geometry.dispose();
        this.tiles.delete(k);
      }
    }
    this.ready = [...this.wanted].filter((k) => this.tiles.has(k)).length >= this.wanted.size * 0.98;
  }

  isReadyNear(px, pz, r = 150) {
    for (const k of this.wanted) {
      const [x0, z0, size] = k.split(',').map(Number);
      const dx = Math.max(Math.abs(px - (x0 + size / 2)) - size / 2, 0);
      const dz = Math.max(Math.abs(pz - (z0 + size / 2)) - size / 2, 0);
      if (Math.hypot(dx, dz) < r && !this.tiles.has(k)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ road
  updateRoad(px, pz) {
    const k0 = Math.floor(pz / SEG);
    const range = Math.ceil(Math.min(this.viewRadius, 2400) / SEG);
    const want = new Set();
    for (let k = k0 - range; k <= k0 + range; k++) {
      const z = k * SEG;
      const rx = this.gen.roadX(z + SEG / 2);
      if (Math.hypot(rx - px, z + SEG / 2 - pz) > this.viewRadius) continue;
      want.add(k);
    }
    let built = 0;
    for (const k of [...want].sort((a, b) => Math.abs(a - k0) - Math.abs(b - k0))) {
      if (this.roadSegs.has(k)) continue;
      if (built++ > 6) break;
      this.roadSegs.set(k, this.buildRoadSegment(k));
    }
    for (const [k, m] of this.roadSegs) {
      if (!want.has(k)) {
        this.group.remove(m);
        m.geometry.dispose();
        this.roadSegs.delete(k);
      }
    }
  }

  buildRoadSegment(k) {
    const gen = this.gen;
    const z0 = k * SEG;
    const step = 2;
    const nz = SEG / step;
    const W = (ROAD.halfWidth + ROAD.shoulder) * 2;
    const across = [-W / 2 - 0.5, -W / 2, -ROAD.halfWidth - 0.6, -ROAD.halfWidth, -2.4, -1.2, 0, 1.2, 2.4, ROAD.halfWidth, ROAD.halfWidth + 0.6, W / 2, W / 2 + 0.5];
    const na = across.length;
    const pos = new Float32Array((nz + 1) * na * 3);
    const uv = new Float32Array((nz + 1) * na * 2);
    const road = new Float32Array((nz + 1) * na * 4);
    const ox = gen.roadX(z0),
      oz = z0;
    for (let j = 0; j <= nz; j++) {
      const z = z0 + j * step;
      const rx = gen.roadX(z);
      const [dx, dz] = gen.roadDir(z);
      const px = dz,
        pz = -dx; // perpendicular
      const info = gen.roadInfo(z);
      for (let i = 0; i < na; i++) {
        const a = across[i];
        const x = rx + px * a,
          zz = z + pz * a;
        let y = gen.height(x, zz) + 0.012;
        if (Math.abs(a) > W / 2 + 0.01) y -= 0.3;
        const k2 = j * na + i;
        pos[k2 * 3] = x - ox;
        pos[k2 * 3 + 1] = y;
        pos[k2 * 3 + 2] = zz - oz;
        uv[k2 * 2] = (Math.max(-W / 2, Math.min(W / 2, a)) + W / 2) / W;
        uv[k2 * 2 + 1] = z;
        road[k2 * 4] = info.wear;
        road[k2 * 4 + 1] = info.dirt ? 1 : 0;
        road[k2 * 4 + 2] = W;
        road[k2 * 4 + 3] = 1;
      }
    }
    const idx = [];
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < na - 1; i++) {
        const a = j * na + i,
          b = a + 1,
          c = a + na + 1,
          d = a + na;
        idx.push(a, d, b, b, d, c);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('road', new THREE.BufferAttribute(road, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.roadMaterial);
    m.position.set(ox - this.origin.x, 0, oz - this.origin.z);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.userData.origin = { x: ox, z: oz };
    this.group.add(m);
    return m;
  }

  // ------------------------------------------------------------------ physics
  updateColliders(px, pz) {
    const T = COLLIDER_TILE;
    const r = Math.ceil(COLLIDER_RADIUS / T);
    const ci = Math.floor(px / T),
      cj = Math.floor(pz / T);
    const want = new Set();
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        const x0 = (ci + i) * T,
          z0 = (cj + j) * T;
        const dx = Math.max(Math.abs(px - (x0 + T / 2)) - T / 2, 0),
          dz = Math.max(Math.abs(pz - (z0 + T / 2)) - T / 2, 0);
        if (Math.hypot(dx, dz) <= COLLIDER_RADIUS) want.add(x0 + ',' + z0);
      }
    let built = 0;
    // nearest first
    const list = [...want].map((k) => {
      const [x0, z0] = k.split(',').map(Number);
      return { k, x0, z0, d: Math.hypot(px - (x0 + T / 2), pz - (z0 + T / 2)) };
    });
    list.sort((a, b) => a.d - b.d);
    for (const t of list) {
      if (this.colliders.has(t.k)) continue;
      if (built++ >= (t.d < 40 ? 4 : 1)) break;
      this.colliders.set(t.k, this.buildCollider(t.x0, t.z0));
    }
    for (const [k, c] of this.colliders) {
      if (!want.has(k)) {
        this.physics.removeBody(c.body);
        this.colliders.delete(k);
      }
    }
  }

  ensureCollidersAround(px, pz, radius = 40) {
    const T = COLLIDER_TILE;
    const r = Math.ceil(radius / T) + 1;
    const ci = Math.floor(px / T),
      cj = Math.floor(pz / T);
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        const x0 = (ci + i) * T,
          z0 = (cj + j) * T;
        const k = x0 + ',' + z0;
        if (!this.colliders.has(k)) this.colliders.set(k, this.buildCollider(x0, z0));
      }
  }

  buildCollider(x0, z0) {
    const T = COLLIDER_TILE;
    const n = T; // 1 m resolution
    const H = new Float32Array((n + 1) * (n + 1));
    for (let ix = 0; ix <= n; ix++)
      for (let iz = 0; iz <= n; iz++) H[ix * (n + 1) + iz] = this.gen.height(x0 + (ix * T) / n, z0 + (iz * T) / n);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x0 + T / 2 - this.origin.x, 0, z0 + T / 2 - this.origin.z)
    );
    const c = this.physics.world.createCollider(
      RAPIER.ColliderDesc.heightfield(n, n, H, { x: T, y: 1, z: T }).setFriction(0.9).setCollisionGroups(GROUPS.world),
      body
    );
    this.physics.setOwner(c, { kind: 'terrain' });
    return { body, collider: c };
  }

  // Shift all streamed content when the floating origin moves (dx, dz in metres).
  rebase(dx, dz) {
    for (const m of this.group.children) {
      m.position.x -= dx;
      m.position.z -= dz;
      m.updateMatrix();
    }
  }

  dispose() {
    this.worker.terminate();
    for (const c of this.colliders.values()) this.physics.removeBody(c.body);
    this.scene.remove(this.group);
  }
}
