// Bridges where Route 9 crosses a river or a dry wash: a concrete deck that follows the road's
// own profile, parapets with steel rails, piers standing in the water, abutments into the banks,
// and on wide northern rivers a steel through-truss. Colliders for the deck and parapets keep the
// car up while the river valley is carved out underneath.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { ROAD } from './worldGen.js';
import { archMaterials } from './buildings/materials.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const RANGE = 1300;

export class Bridges {
  constructor() {
    this.items = new Map();
  }

  init(game) {
    this.g = game;
    this.group = new THREE.Group();
    this.group.name = 'bridges';
    game.worldGroup.add(this.group);
  }

  update(dt) {
    const g = this.g;
    if (!g || !g.gen) return;
    this.acc = (this.acc || 0) + dt;
    if (this.acc < 0.5 && this.items.size) return;
    this.acc = 0;
    const f = g.focusPoint();
    const gz = f.z + g.origin.z;
    const want = new Set();
    for (const r of g.gen.riversNear(gz, 1)) {
      if (Math.abs(r.zr - gz) > RANGE) continue;
      want.add(r.k);
      if (!this.items.has(r.k)) this.items.set(r.k, this.build(r));
    }
    for (const [k, it] of this.items) {
      if (want.has(k)) continue;
      this.group.remove(it.root);
      it.root.traverse((o) => o.isMesh && o.geometry.dispose());
      g.physics.removeBody(it.body);
      this.items.delete(k);
    }
  }

  build(r) {
    const g = this.g;
    const gen = g.gen;
    const M = archMaterials();
    const span = r.w + 12 + r.w * 0.6 + 4;
    const z0 = r.zr - span,
      z1 = r.zr + span;
    const ox = gen.roadX(r.zr),
      oz = r.zr;
    const root = new THREE.Group();
    root.position.set(ox - g.origin.x, 0, oz - g.origin.z);
    const halfW = ROAD.halfWidth + ROAD.shoulder + 0.35;
    // centreline samples (local to the root)
    const step = 3;
    const n = Math.ceil((z1 - z0) / step);
    const C = [];
    for (let i = 0; i <= n; i++) {
      const z = z0 + ((z1 - z0) * i) / n;
      const [dx, dz] = gen.roadDir(z);
      C.push({ p: V(gen.roadX(z) - ox, gen.roadY(z), z - oz), t: V(dx, 0, dz), s: V(dz, 0, -dx) });
    }
    const truss = r.w > 9.5 && !r.dry && (r.frozen || gen.dominantBiome(ox, oz) === 'forest');
    const parts = { concrete: [], steel: [], paint: [] };
    // deck slab with fascia beams
    parts.concrete.push(loftRect(C, -halfW, halfW, -0.75, -0.04));
    parts.concrete.push(loftRect(C, -halfW - 0.05, -halfW + 0.3, -1.1, -0.04));
    parts.concrete.push(loftRect(C, halfW - 0.3, halfW + 0.05, -1.1, -0.04));
    // parapets: concrete kerb, steel posts and two rails
    for (const sd of [-1, 1]) {
      const a = sd * (halfW - 0.18);
      parts.concrete.push(loftRect(C, a - 0.18, a + 0.18, -0.04, 0.42));
      for (let i = 0; i <= n; i++) {
        if (i % 1) continue;
        const c = C[i];
        const p = c.p.clone().addScaledVector(c.s, a);
        const post = new THREE.BoxGeometry(0.1, 0.62, 0.1);
        post.translate(p.x, p.y + 0.42 + 0.31, p.z);
        parts.steel.push(post);
      }
      for (const h of [0.72, 1.0]) parts.steel.push(tubeAlongLine(C.map((c) => c.p.clone().addScaledVector(c.s, a).add(V(0, h, 0))), 0.045));
    }
    // piers in the channel and abutments in the banks
    const pierEvery = 16;
    const len = z1 - z0;
    const np = Math.max(1, Math.floor(len / pierEvery) - 1);
    for (let k = 1; k <= np; k++) {
      const t = k / (np + 1);
      const c = C[Math.round(t * n)];
      const wx = c.p.x + ox,
        wz = c.p.z + oz;
      const ground = gen.height(wx, wz);
      const top = c.p.y - 0.75;
      if (top - ground < 0.8) continue;
      for (const sd of [-0.55, 0.55]) {
        const q = c.p.clone().addScaledVector(c.s, sd * halfW);
        const col = new THREE.CylinderGeometry(0.42, 0.5, top - ground + 1.2, 14);
        col.translate(q.x, ground - 1.2 + (top - ground + 1.2) / 2, q.z);
        parts.concrete.push(col);
      }
      const cap = new THREE.BoxGeometry(halfW * 1.7, 0.6, 1.1);
      cap.applyMatrix4(new THREE.Matrix4().makeBasis(c.s, V(0, 1, 0), c.t).setPosition(c.p.x, top - 0.3, c.p.z));
      parts.concrete.push(cap);
    }
    for (const c of [C[0], C[n]]) {
      const wx = c.p.x + ox,
        wz = c.p.z + oz;
      const ground = gen.height(wx, wz);
      const h = Math.max(1.2, c.p.y - ground + 1.5);
      const wall = new THREE.BoxGeometry(halfW * 2 + 0.6, h, 1.2);
      wall.applyMatrix4(new THREE.Matrix4().makeBasis(c.s, V(0, 1, 0), c.t).setPosition(c.p.x, c.p.y - 0.4 - h / 2 + 0.2, c.p.z));
      parts.concrete.push(wall);
    }
    // steel through-truss on wide northern rivers
    if (truss) {
      const H = 5.2;
      const sideOff = halfW + 0.25;
      const panel = 4;
      for (const sd of [-1, 1]) {
        const chordB = [],
          chordT = [];
        for (let i = 0; i <= n; i++) {
          const c = C[i];
          const b = c.p.clone().addScaledVector(c.s, sd * sideOff).add(V(0, 0.2, 0));
          chordB.push(b);
          // top chord rises in a shallow arch, dropping to the portals at the ends
          const u = i / n;
          const hh = H * Math.min(1, Math.sin(u * Math.PI) * 1.6);
          chordT.push(b.clone().add(V(0, Math.max(1.2, hh), 0)));
        }
        parts.paint.push(tubeAlongLine(chordB, 0.16, 6));
        parts.paint.push(tubeAlongLine(chordT, 0.18, 6));
        for (let i = 0; i <= n; i += Math.max(1, Math.round(panel / step))) {
          parts.paint.push(strut(chordB[i], chordT[i], 0.09));
          const j = Math.min(n, i + Math.max(1, Math.round(panel / step)));
          if (j !== i) parts.paint.push(strut(i % 2 ? chordB[i] : chordT[i], i % 2 ? chordT[j] : chordB[j], 0.07));
        }
      }
      // top lateral bracing
      for (let i = Math.round(n * 0.18); i <= n * 0.82; i += 3) {
        const c = C[i];
        const u = i / n;
        const hh = Math.max(1.2, H * Math.min(1, Math.sin(u * Math.PI) * 1.6));
        const a = c.p.clone().addScaledVector(c.s, -sideOff).add(V(0, 0.2 + hh, 0));
        const b = c.p.clone().addScaledVector(c.s, sideOff).add(V(0, 0.2 + hh, 0));
        parts.paint.push(strut(a, b, 0.07));
      }
    }
    const paint = r.frozen ? M.metalGreen : M.metalPainted;
    for (const [k, list] of Object.entries(parts)) {
      if (!list.length) continue;
      const geo = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)).map(strip), false);
      const mesh = new THREE.Mesh(geo, k === 'concrete' ? M.concrete : k === 'steel' ? M.metal : paint);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    this.group.add(root);
    // colliders: deck and parapets per segment
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(root.position.x, 0, root.position.z));
    for (let i = 0; i < n; i++) {
      const a = C[i],
        b = C[i + 1];
      const mid = a.p.clone().add(b.p).multiplyScalar(0.5);
      const dir = b.p.clone().sub(a.p);
      const L = dir.length();
      dir.normalize();
      const side = V(dir.z, 0, -dir.x).normalize();
      const up = dir.clone().cross(side).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, dir));
      const add = (hx, hy, hz, off) => {
        const c = mid.clone().add(off.applyQuaternion(q));
        const col = g.physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(hx, hy, hz + 0.05)
            .setTranslation(c.x, c.y, c.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setFriction(0.9)
            .setCollisionGroups(GROUPS.world),
          body
        );
        g.physics.setOwner(col, { kind: 'terrain', surface: 'concrete' });
      };
      add(halfW, 0.35, L / 2, V(0, -0.35 + 0.012, 0));
      add(0.2, 0.5, L / 2, V(halfW - 0.18, 0.3, 0));
      add(0.2, 0.5, L / 2, V(-(halfW - 0.18), 0.3, 0));
    }
    return { root, body };
  }

  rebase(dx, dz) {
    for (const it of this.items.values()) {
      it.root.position.x -= dx;
      it.root.position.z -= dz;
    }
  }
}

function strip(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

// A rectangle section [a0..a1] across x [y0..y1] lofted along the centreline samples.
function loftRect(C, a0, a1, y0, y1) {
  const pos = [],
    uv = [],
    idx = [];
  const ring = (c) => [
    c.p.clone().addScaledVector(c.s, a0).add(V(0, y0, 0)),
    c.p.clone().addScaledVector(c.s, a1).add(V(0, y0, 0)),
    c.p.clone().addScaledVector(c.s, a1).add(V(0, y1, 0)),
    c.p.clone().addScaledVector(c.s, a0).add(V(0, y1, 0)),
  ];
  let along = 0;
  for (let i = 0; i < C.length; i++) {
    if (i) along += C[i].p.distanceTo(C[i - 1].p);
    const r = ring(C[i]);
    // duplicate corners for hard edges: 4 faces x 2 verts
    for (let f = 0; f < 4; f++) {
      const p0 = r[f],
        p1 = r[(f + 1) % 4];
      pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      uv.push(along * 0.5, 0, along * 0.5, p0.distanceTo(p1) * 0.5);
    }
  }
  for (let i = 0; i < C.length - 1; i++)
    for (let f = 0; f < 4; f++) {
      const a = i * 8 + f * 2,
        b = a + 1,
        c = a + 8 + 1,
        d = a + 8;
      idx.push(a, b, d, b, c, d);
    }
  // end caps
  for (const [i, flip] of [
    [0, true],
    [C.length - 1, false],
  ]) {
    const r = ring(C[i]);
    const base = pos.length / 3;
    for (const p of r) {
      pos.push(p.x, p.y, p.z);
      uv.push(0, 0);
    }
    if (flip) idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tubeAlongLine(pts, r, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, Math.max(4, pts.length * 2), r, radial, false);
}

function strut(a, b, r) {
  const d = b.clone().sub(a);
  const L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, 6);
  g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
