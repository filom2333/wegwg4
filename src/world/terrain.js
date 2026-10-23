// Streams terrain tiles (quadtree LOD, built in a worker), road segments and physics
// heightfields around the player. All scene positions are relative to the floating origin.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { ROAD, TRACK } from './worldGen.js';

const ROOT = 2048;
const MIN_TILE = 64;
const VIEW_RADIUS = 5600; // far enough to see the mountain ranges
const SEG = 128; // road segment length (m along z): fewer, longer road meshes = fewer draw calls
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
    this.wantedTiles = [];
    this.roadSegs = new Map();
    this.trackMeshes = new Map(); // side track index -> mesh
    this.colliders = new Map();
    this.nextId = 1;
    this.viewRadius = quality === 'low' ? 3000 : VIEW_RADIUS;
    // the far edge fades into the haze instead of ending against the sky
    if (terrainMaterial.userData.uniforms) terrainMaterial.userData.uniforms.uFadeFar.value = this.viewRadius;
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
    g.setAttribute('matB', new THREE.BufferAttribute(d.mat2, 4));
    g.setAttribute('tint', new THREE.BufferAttribute(d.tint, 4));
    g.setAttribute('tree', new THREE.BufferAttribute(d.tree, 1));
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
      for (const t of sel) t.key = this.key(t);
      this.wanted = new Set(sel.map((t) => t.key));
      this.wantedTiles = sel;
      const asked = new Set([...this.pending.values()].map((p) => p.key));
      this.queue = sel.filter((t) => !this.tiles.has(t.key) && !asked.has(t.key));
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
    const missing = this.wantedTiles.filter((w) => !this.tiles.has(w.key));
    for (const [k, t] of this.tiles) {
      if (this.wanted.has(k)) continue;
      // covered once no wanted tile overlapping it is still missing
      let covered = true;
      for (const w of missing)
        if (w.x0 < t.x0 + t.size && w.x0 + w.size > t.x0 && w.z0 < t.z0 + t.size && w.z0 + w.size > t.z0) {
          covered = false;
          break;
        }
      if (covered) {
        this.group.remove(t.mesh);
        t.mesh.geometry.dispose();
        this.tiles.delete(k);
      }
    }
    this.ready = missing.length <= this.wanted.size * 0.02;
  }

  isReadyNear(px, pz, r = 150) {
    for (const t of this.wantedTiles) {
      const dx = Math.max(Math.abs(px - (t.x0 + t.size / 2)) - t.size / 2, 0);
      const dz = Math.max(Math.abs(pz - (t.z0 + t.size / 2)) - t.size / 2, 0);
      if (Math.hypot(dx, dz) < r && !this.tiles.has(t.key)) return false;
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
    // building a segment samples the road profile ~900 times: spread the work over frames
    // (everything at once only while the road near the player is still missing)
    const t0 = performance.now();
    const urgent = !this.roadSegs.has(k0);
    for (const k of [...want].sort((a, b) => Math.abs(a - k0) - Math.abs(b - k0))) {
      if (this.roadSegs.has(k)) continue;
      if (!urgent && performance.now() - t0 > 2.5) break;
      this.roadSegs.set(k, this.buildRoadSegment(k));
    }
    for (const [k, m] of this.roadSegs) {
      if (!want.has(k)) {
        this.group.remove(m);
        m.geometry.dispose();
        this.roadSegs.delete(k);
      }
    }
    // dirt side tracks near the player (one built a frame)
    const t0k = Math.floor(pz / TRACK.every);
    const wantT = new Set();
    for (let t = t0k - 2; t <= t0k + 2; t++) {
      const tr = this.gen.track(t);
      if (!tr || pz < tr.z0 - 1800 || pz > tr.z1 + 1800) continue;
      wantT.add(t);
    }
    for (const t of wantT) {
      if (this.trackMeshes.has(t)) continue;
      this.trackMeshes.set(t, this.buildTrack(this.gen.track(t)));
      break;
    }
    for (const [t, m] of this.trackMeshes) {
      if (wantT.has(t)) continue;
      this.group.remove(m);
      m.geometry.dispose();
      this.trackMeshes.delete(t);
    }
  }

  // A dirt track as a strip following its centre line, from where it leaves the asphalt to where
  // it meets it again.
  buildTrack(tr) {
    const gen = this.gen;
    const hw = TRACK.halfWidth;
    const W = (hw + 0.4) * 2;
    const across = [-W / 2 - 0.5, -W / 2, -hw * 0.75, -hw * 0.35, 0, hw * 0.35, hw * 0.75, W / 2, W / 2 + 0.5];
    const na = across.length;
    const step = 2;
    // from where its edge first leaves the asphalt: the strip is pinched against the asphalt edge
    // there, so the track opens out of the shoulder like a real turn-off
    const start = ROAD.halfWidth * 0.5;
    const rows = [];
    for (let z = tr.z0; z <= tr.z1; z += step) if (Math.abs(gen.trackOffset(tr, z)) >= start) rows.push(z);
    const nz = rows.length;
    const pos = new Float32Array(nz * na * 3);
    const uv = new Float32Array(nz * na * 2);
    const road = new Float32Array(nz * na * 4);
    const env = new Float32Array(nz * na * 2);
    const ox = gen.roadX(tr.z0),
      oz = tr.z0;
    let along = 0,
      px0 = null;
    rows.forEach((z, j) => {
      const cx = gen.trackX(tr, z);
      const sl = (gen.trackX(tr, z + 1) - gen.trackX(tr, z - 1)) / 2;
      const l = Math.hypot(sl, 1);
      const nx = 1 / l,
        nzz = -sl / l; // perpendicular
      if (px0) along += Math.hypot(cx - px0[0], z - px0[1]);
      px0 = [cx, z];
      const snow = gen.roadInfo(z).snow || 0;
      for (let i = 0; i < na; i++) {
        const a = across[i];
        let x = cx + nx * a;
        const zz = z + nzz * a;
        const rx = gen.roadX(zz);
        if ((x - rx) * tr.side < ROAD.halfWidth) x = rx + tr.side * ROAD.halfWidth;
        let y = gen.height(x, zz) + 0.03;
        if (Math.abs(a) > W / 2 + 0.01) y -= 0.3;
        const k2 = j * na + i;
        pos[k2 * 3] = x - ox;
        pos[k2 * 3 + 1] = y;
        pos[k2 * 3 + 2] = zz - oz;
        uv[k2 * 2] = (Math.max(-W / 2, Math.min(W / 2, a)) + W / 2) / W;
        uv[k2 * 2 + 1] = along;
        road[k2 * 4] = 0.8;
        road[k2 * 4 + 1] = 1;
        road[k2 * 4 + 2] = W;
        road[k2 * 4 + 3] = 0;
        env[k2 * 2] = snow;
        env[k2 * 2 + 1] = 0;
      }
    });
    const idx = [];
    for (let j = 0; j < nz - 1; j++) {
      // a gap where the track crosses back over the highway corridor (never, but be safe)
      if (rows[j + 1] - rows[j] > step * 1.5) continue;
      for (let i = 0; i < na - 1; i++) {
        const a = j * na + i,
          b = a + 1,
          c = a + na + 1,
          d = a + na;
        idx.push(a, d, b, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('road', new THREE.BufferAttribute(road, 4));
    g.setAttribute('env', new THREE.BufferAttribute(env, 2));
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
    const env = new Float32Array((nz + 1) * na * 2);
    const ox = gen.roadX(z0),
      oz = z0;
    for (let j = 0; j <= nz; j++) {
      const z = z0 + j * step;
      const rx = gen.roadX(z);
      const s = gen.roadS(z);
      const [dx, dz] = gen.roadDir(z);
      const px = dz,
        pz = -dx; // perpendicular
      const info = gen.roadInfo(z);
      const br = gen.bridgeNear(z);
      const onBridge = br && Math.abs(z - br.r.zr) < br.r.w + 12 + br.r.w * 0.6 + 4 ? 1 : 0;
      for (let i = 0; i < na; i++) {
        const a = across[i];
        const x = rx + px * a,
          zz = z + pz * a;
        // over a river the road keeps its own profile: the bridge deck
        let y = gen.roadSurfaceY(x, zz) + 0.012;
        if (Math.abs(a) > W / 2 + 0.01) y -= 0.3;
        const k2 = j * na + i;
        pos[k2 * 3] = x - ox;
        pos[k2 * 3 + 1] = y;
        pos[k2 * 3 + 2] = zz - oz;
        uv[k2 * 2] = (Math.max(-W / 2, Math.min(W / 2, a)) + W / 2) / W;
        uv[k2 * 2 + 1] = s;
        road[k2 * 4] = info.wear;
        road[k2 * 4 + 1] = info.dirt ? 1 : 0;
        road[k2 * 4 + 2] = W;
        road[k2 * 4 + 3] = 1;
        env[k2 * 2] = info.snow || 0;
        env[k2 * 2 + 1] = onBridge;
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
    g.setAttribute('env', new THREE.BufferAttribute(env, 2));
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

  // Builds (now) the collider tiles that touch the square of `radius` around a point.
  ensureCollidersAround(px, pz, radius = 40) {
    const T = COLLIDER_TILE;
    const i0 = Math.floor((px - radius) / T),
      i1 = Math.floor((px + radius) / T);
    const j0 = Math.floor((pz - radius) / T),
      j1 = Math.floor((pz + radius) / T);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x0 = i * T,
          z0 = j * T;
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
