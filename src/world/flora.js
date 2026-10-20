// Procedural desert flora and rocks: geometry builders (vertex coloured, with baked AO-ish
// darkening) and a shared wind-sway material.

import * as THREE from 'three';
import { RENDER_CAPS } from '../gfx/caps.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, SimplexNoise } from '../core/noise.js';
import { NOISE_GLSL } from '../gfx/glsl.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function colorize(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const c = fn(v, i);
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
function clean(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'color'].includes(k)) n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}

function merge(list) {
  return mergeGeometries(list.map(clean), false);
}

// noise-displaced blob (ellipsoid)
function blob(rx, ry, rz, detail, rnd, rough = 0.18, noise) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const off = rnd() * 100;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise.noise3(v.x * 1.7 + off, v.y * 1.7, v.z * 1.7) * rough + noise.noise3(v.x * 4 + off, v.y * 4, v.z * 4) * rough * 0.4;
    v.multiplyScalar(1 + n);
    p.setXYZ(i, v.x * rx, v.y * ry, v.z * rz);
  }
  g.computeVertexNormals();
  return g;
}

// tapered tube along points
function branch(points, r0, r1, radial = 5) {
  const curve = new THREE.CatmullRomCurve3(points);
  const segs = Math.max(2, points.length * 3);
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  // scale radius along the curve: TubeGeometry builds rings of (radial+1) verts
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}
export function grassTuft(seed, { blades: nBlades = 0, height = 1, base = null, tip = null, spread = 1 } = {}) {
  const rnd = mulberry32(seed);
  const pos = [],
    col = [];
  const blades = nBlades || 18 + Math.floor(rnd() * 12);
  const H = (0.3 + rnd() * 0.3) * height;
  const dry = rnd();
  for (let i = 0; i < blades; i++) {
    const a = rnd() * Math.PI * 2;
    const lean = 0.15 + rnd() * 0.45;
    const h = H * (0.6 + rnd() * 0.6);
    const w = 0.012 + rnd() * 0.008;
    const bx = Math.cos(a) * 0.04 * spread * rnd(),
      bz = Math.sin(a) * 0.04 * spread * rnd();
    const tx = bx + Math.cos(a) * h * lean,
      tz = bz + Math.sin(a) * h * lean;
    const px = -Math.sin(a) * w,
      pz = Math.cos(a) * w;
    const mx = (bx + tx) / 2 + Math.cos(a) * h * 0.06,
      mz = (bz + tz) / 2 + Math.sin(a) * h * 0.06;
    // two segments per blade
    const pts = [
      [bx - px, 0, bz - pz],
      [bx + px, 0, bz + pz],
      [mx + px * 0.7, h * 0.55, mz + pz * 0.7],
      [mx - px * 0.7, h * 0.55, mz - pz * 0.7],
      [tx, h, tz],
    ];
    const tris = [
      [0, 1, 2],
      [0, 2, 3],
      [3, 2, 4],
    ];
    const cBase = base || [0.36, 0.32, 0.2],
      cTip = tip ? tip.map((c) => c * (0.88 + 0.24 * rnd())) : dry > 0.4 ? [0.86, 0.76, 0.5] : [0.66, 0.64, 0.4];
    for (const t of tris)
      for (const k of t) {
        pos.push(...pts[k]);
        const f = pts[k][1] / h;
        col.push(cBase[0] + (cTip[0] - cBase[0]) * f, cBase[1] + (cTip[1] - cBase[1]) * f, cBase[2] + (cTip[2] - cBase[2]) * f);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // blades: point normals mostly up for soft lighting
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    const nx = n.getX(i) * 0.3,
      ny = 1,
      nz = n.getZ(i) * 0.3;
    const l = Math.hypot(nx, ny, nz);
    n.setXYZ(i, nx / l, ny / l, nz / l);
  }
  return g;
}

// Textured grass clump: three crossed cards around the stem point carrying a painted clump
// (grey, tinted per vertex). Normals point up so the cards light like the ground under them.
export function grassClump(seed, { height = 0.7, width = 0.9, tint = [0.6, 0.62, 0.36], cards = 3 } = {}) {
  const rnd = mulberry32(seed);
  const pos = [],
    nor = [],
    uv = [],
    col = [],
    idx = [];
  const h = height * (0.75 + rnd() * 0.5),
    w = width * (0.8 + rnd() * 0.4);
  const a0 = rnd() * Math.PI;
  for (let c = 0; c < cards; c++) {
    const a = a0 + (c / cards) * Math.PI + (rnd() - 0.5) * 0.3;
    const dx = Math.cos(a) * w * 0.5,
      dz = Math.sin(a) * w * 0.5;
    const lean = (rnd() - 0.5) * 0.25 * h;
    const lx = -Math.sin(a) * lean,
      lz = Math.cos(a) * lean;
    const base = pos.length / 3;
    const v = 0.85 + rnd() * 0.3;
    const quad = [
      [-dx, 0, -dz, 0, 0],
      [dx, 0, dz, 1, 0],
      [dx + lx, h, dz + lz, 1, 1],
      [-dx + lx, h, -dz + lz, 0, 1],
    ];
    for (const [x, y, z, u, t] of quad) {
      pos.push(x, y, z);
      nor.push(x * 0.7, 0.75, z * 0.7);
      uv.push(u, t);
      col.push(tint[0] * v, tint[1] * v, tint[2] * v);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.normalizeNormals();
  return g;
}

// Fern: fronds arching out from the crown, each a bent strip carrying the frond texture.
export function fernClump(seed, { tint = [1, 1, 1] } = {}) {
  const rnd = mulberry32(seed);
  const pos = [],
    nor = [],
    uv = [],
    col = [],
    idx = [];
  const n = 7 + Math.floor(rnd() * 4);
  const L = 0.7 + rnd() * 0.45;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
    const dx = Math.cos(a),
      dz = Math.sin(a);
    const px = -dz,
      pz = dx;
    const rise = 0.55 + rnd() * 0.35;
    const len = L * (0.75 + rnd() * 0.4);
    const w = len * 0.42;
    const seg = 4;
    const base = pos.length / 3;
    const v = 0.85 + rnd() * 0.3;
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      // arch: up, then out and down at the tip
      const r = Math.sin(t * Math.PI * 0.5) * len * 0.9;
      const y = Math.sin(t * Math.PI * 0.85) * len * rise * 0.6;
      const roll = 0.25;
      for (const sx of [-0.5, 0.5]) {
        pos.push(r * dx + px * sx * w, y + sx * w * roll * 0.3, r * dz + pz * sx * w);
        nor.push(dx * 0.2, 1, dz * 0.2);
        uv.push(sx + 0.5, t);
        col.push(tint[0] * v, tint[1] * v, tint[2] * v);
      }
    }
    for (let k = 0; k < seg; k++) {
      const a0 = base + k * 2;
      idx.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.normalizeNormals();
  return g;
}

function ribbedLathe(profile, ribs, ribDepth, radial = 32) {
  const g = new THREE.LatheGeometry(
    profile.map((p) => new THREE.Vector2(p[0], p[1])),
    radial
  );
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const r = Math.hypot(v.x, v.z);
    const k = 1 - ribDepth * (0.5 - 0.5 * Math.cos(a * ribs));
    pos.setXYZ(i, (v.x / (r || 1)) * r * k, v.y, (v.z / (r || 1)) * r * k);
  }
  g.computeVertexNormals();
  return g;
}

export function saguaro(seed) {
  const rnd = mulberry32(seed);
  const H = 3 + rnd() * 3.5;
  const R = 0.2 + rnd() * 0.08;
  const prof = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const y = t * H;
    const r = t < 0.92 ? R * (1 - 0.1 * t) : R * 0.9 * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.92) / 0.08, 2)));
    prof.push([Math.max(0.001, r), y]);
  }
  prof.push([0.0, H]);
  const green = [0.29 + rnd() * 0.05, 0.38 + rnd() * 0.05, 0.22];
  const parts = [];
  const trunk = ribbedLathe(prof, 14, 0.12, 28);
  parts.push(colorize(trunk, (v) => {
    const ao = 0.55 + 0.45 * Math.min(1, v.y / 1.5);
    return [green[0] * ao, green[1] * ao, green[2] * ao];
  }));
  const arms = Math.floor(rnd() * 3.2);
  for (let i = 0; i < arms; i++) {
    const a = rnd() * Math.PI * 2;
    const y0 = H * (0.35 + rnd() * 0.3);
    const out = 0.45 + rnd() * 0.25;
    const up = H * (0.25 + rnd() * 0.2);
    const r = R * 0.72;
    const dx = Math.cos(a),
      dz = Math.sin(a);
    const pts = [V(dx * R * 0.6, y0, dz * R * 0.6), V(dx * out * 0.75, y0 + 0.05, dz * out * 0.75), V(dx * out, y0 + 0.35, dz * out), V(dx * out, y0 + up, dz * out)];
    const b = branch(pts, r, r * 0.92, 10);
    parts.push(colorize(b, () => green.map((c) => c * 0.92)));
    const tip = new THREE.SphereGeometry(r * 0.92, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    tip.translate(dx * out, y0 + up, dz * out);
    parts.push(colorize(tip, () => green.map((c) => c * 0.95)));
  }
  return { geometry: merge(parts), height: H, radius: R };
}

export function barrelCactus(seed) {
  const rnd = mulberry32(seed);
  const H = 0.4 + rnd() * 0.4,
    R = 0.22 + rnd() * 0.12;
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    prof.push([Math.max(0.001, R * Math.sin(0.25 + t * 2.6) * 1.05), t * H]);
  }
  prof.push([0, H]);
  const g = ribbedLathe(prof, 18, 0.14, 36);
  return colorize(g, (v) => {
    const top = v.y > H * 0.9 ? 1 : 0;
    return top ? [0.75, 0.55, 0.2] : [0.3, 0.4, 0.22];
  });
}

export function joshuaTree(seed) {
  const rnd = mulberry32(seed);
  const noise = new SimplexNoise(seed);
  const parts = [];
  const bark = [0.33, 0.28, 0.22];
  const leaf = [0.42, 0.46, 0.3];
  const grow = (p, dir, len, r, depth) => {
    const end = p.clone().addScaledVector(dir, len);
    const mid = p.clone().lerp(end, 0.5).add(V((rnd() - 0.5) * 0.2, 0, (rnd() - 0.5) * 0.2));
    parts.push(colorize(branch([p, mid, end], r, r * 0.78, 6), () => bark));
    if (depth <= 0) {
      // spiky leaf cluster
      const n = 18;
      for (let i = 0; i < n; i++) {
        const u = rnd() * 2 - 1,
          th = rnd() * Math.PI * 2;
        const d = V(Math.sqrt(1 - u * u) * Math.cos(th), Math.abs(u) * 0.8 + 0.2, Math.sqrt(1 - u * u) * Math.sin(th)).normalize();
        const tipP = end.clone().addScaledVector(d, 0.32 + rnd() * 0.1);
        const s = V(-d.z, 0, d.x).normalize().multiplyScalar(0.018);
        const g = new THREE.BufferGeometry();
        const a = end.clone().add(s),
          b = end.clone().sub(s);
        g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, tipP.x, tipP.y, tipP.z, b.x, b.y, b.z, a.x, a.y, a.z, tipP.x, tipP.y, tipP.z], 3));
        g.computeVertexNormals();
        parts.push(colorize(g, (v) => (v.distanceTo(end) > 0.2 ? leaf : leaf.map((c) => c * 0.6))));
      }
      const core = blob(0.12, 0.16, 0.12, 1, rnd, 0.2, noise);
      core.translate(end.x, end.y, end.z);
      parts.push(colorize(core, () => leaf.map((c) => c * 0.7)));
      return;
    }
    const k = 2 + (rnd() < 0.4 ? 1 : 0);
    for (let i = 0; i < k; i++) {
      const a = rnd() * Math.PI * 2;
      const nd = dir.clone().multiplyScalar(0.5).add(V(Math.cos(a), 0.6 + rnd() * 0.5, Math.sin(a))).normalize();
      grow(end, nd, len * (0.6 + rnd() * 0.2), r * 0.72, depth - 1);
    }
  };
  grow(V(0, 0, 0), V(0, 1, 0), 1.4 + rnd() * 0.8, 0.13, 2);
  return merge(parts);
}

export function deadTree(seed) {
  const rnd = mulberry32(seed);
  const parts = [];
  const wood = [0.42, 0.39, 0.35];
  const grow = (p, dir, len, r, depth) => {
    const end = p.clone().addScaledVector(dir, len);
    const mid = p.clone().lerp(end, 0.5).add(V((rnd() - 0.5) * len * 0.15, 0, (rnd() - 0.5) * len * 0.15));
    parts.push(colorize(branch([p, mid, end], r, r * 0.65, 6), (v) => wood.map((c) => c * (0.8 + 0.2 * Math.min(1, v.y / 3)))));
    if (depth <= 0 || r < 0.02) return;
    const k = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < k; i++) {
      const a = rnd() * Math.PI * 2;
      const nd = dir.clone().add(V(Math.cos(a) * 0.9, 0.3 + rnd() * 0.6, Math.sin(a) * 0.9)).normalize();
      grow(end, nd, len * (0.55 + rnd() * 0.25), r * 0.62, depth - 1);
    }
  };
  grow(V(0, -0.1, 0), V(rnd() * 0.2 - 0.1, 1, rnd() * 0.2 - 0.1).normalize(), 1.6 + rnd() * 1.2, 0.14, 3);
  return merge(parts);
}

export function rock(seed, kind = 'boulder', { lod = 0 } = {}) {
  const rnd = mulberry32(seed);
  const noise = new SimplexNoise(seed);
  let g;
  const d = lod ? 1 : 2;
  if (kind === 'slab') g = blob(1, 0.35, 0.8, d, rnd, 0.25, noise);
  else if (kind === 'pebble') g = blob(1, 0.6, 0.85, 1, rnd, 0.25, noise);
  else g = blob(1, 0.75 + rnd() * 0.3, 0.9, d, rnd, 0.32, noise);
  // flatten the bottom, facet the top a little
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.2;
    const q = 0.08;
    v.x = Math.round(v.x / q) * q * 0.25 + v.x * 0.75;
    v.y = Math.round(v.y / q) * q * 0.25 + v.y * 0.75;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return colorize(g, (vv) => {
    const n = noise.noise3(vv.x * 3, vv.y * 3, vv.z * 3) * 0.5 + 0.5;
    const strata = 0.5 + 0.5 * Math.sin(vv.y * 18 + n * 2);
    const ao = vv.y < -0.15 ? 0.6 : 1;
    const t = (0.75 + 0.25 * n) * (0.92 + 0.08 * strata) * ao;
    return [t, t, t];
  });
}

export function hoodoo(seed) {
  const rnd = mulberry32(seed);
  const noise = new SimplexNoise(seed);
  const parts = [];
  let y = 0;
  const n = 3 + Math.floor(rnd() * 3);
  let r = 1.2 + rnd() * 0.6;
  for (let i = 0; i < n; i++) {
    const h = 1.2 + rnd() * 1.6;
    const b = blob(r, h * 0.55, r * (0.8 + rnd() * 0.3), 2, rnd, 0.22, noise);
    b.translate((rnd() - 0.5) * 0.3, y + h * 0.5, (rnd() - 0.5) * 0.3);
    const band = i % 2;
    parts.push(colorize(b, () => (band ? [0.9, 0.62, 0.45] : [0.78, 0.47, 0.32])));
    y += h * 0.85;
    r *= 0.72 + rnd() * 0.2;
  }
  // cap rock
  const cap = blob(r * 1.8, 0.45, r * 1.6, 2, rnd, 0.2, noise);
  cap.translate(0, y + 0.2, 0);
  parts.push(colorize(cap, () => [0.55, 0.45, 0.38]));
  return { geometry: merge(parts), height: y + 0.6, radius: 1.4 };
}

// ------------------------------------------------------------------ green and snowy country
export function flowers(seed, palette = [[0.62, 0.32, 0.72]]) {
  const rnd = mulberry32(seed);
  const parts = [];
  const n = 7 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * 0.5,
      z = (rnd() - 0.5) * 0.5;
    const h = 0.25 + rnd() * 0.3;
    const stem = new THREE.PlaneGeometry(0.012, h, 1, 1);
    stem.translate(x, h / 2, z);
    stem.rotateY(rnd() * Math.PI);
    parts.push(colorize(stem, () => [0.22, 0.34, 0.12]));
    const head = new THREE.OctahedronGeometry(0.03 + rnd() * 0.02, 0);
    head.scale(1, 0.6, 1);
    head.translate(x, h, z);
    const c = palette[Math.floor(rnd() * palette.length)];
    parts.push(colorize(head, () => c.map((v) => v * (0.85 + rnd() * 0.3))));
  }
  return merge(parts);
}

// Cut stump with a pale face and growth rings.
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function stump(seed, { snow = 0 } = {}) {
  const rnd = mulberry32(seed);
  const r = 0.22 + rnd() * 0.16,
    h = 0.3 + rnd() * 0.35;
  const g = new THREE.CylinderGeometry(r * 0.95, r * 1.25, h, 9, 1, false);
  g.translate(0, h / 2 - 0.04, 0);
  const n = g.toNonIndexed();
  n.computeVertexNormals();
  const nr = n.attributes.normal;
  return colorize(n, (v, i) => {
    if (nr.getY(i) > 0.6) {
      if (snow > 0) return [0.86, 0.88, 0.92];
      const rr = Math.hypot(v.x, v.z) / r;
      const ring = 0.5 + 0.5 * Math.sin(rr * 30);
      return [0.55 + 0.1 * ring, 0.42 + 0.08 * ring, 0.28];
    }
    return [0.26, 0.2, 0.15];
  });
}

// Fallen log lying along X.
export function fallenLog(seed, { snow = 0 } = {}) {
  const rnd = mulberry32(seed);
  const L = 2.2 + rnd() * 2.6,
    r = 0.16 + rnd() * 0.12;
  const g = new THREE.CylinderGeometry(r * 0.85, r, L, 8, 3, false);
  g.rotateZ(Math.PI / 2);
  g.translate(0, r * 0.8, 0);
  const n = g.toNonIndexed();
  n.computeVertexNormals();
  const nr = n.attributes.normal;
  const noise = new SimplexNoise(seed);
  return colorize(n, (v, i) => {
    const end = Math.abs(nr.getX(i)) > 0.7;
    if (end) return [0.5, 0.38, 0.24];
    if (snow > 0 && nr.getY(i) > 0.45) return [0.86, 0.88, 0.92];
    const m = 0.75 + 0.25 * noise.noise3(v.x * 3, v.y * 8, v.z * 8);
    const moss = nr.getY(i) > 0.3 && snow === 0 ? 0.4 : 0;
    return lerp3([0.3 * m, 0.23 * m, 0.17 * m], [0.24, 0.3, 0.12], moss);
  });
}
export function reeds(seed) {
  return grassTuft(seed, { blades: 22, height: 3.2, base: [0.25, 0.28, 0.14], tip: [0.62, 0.58, 0.3], spread: 3 });
}

// ------------------------------------------------------------------ materials
export function createFloraMaterial({ sway = 0, roughness = 0.9, snow = false, doubleSide = null, map = null, alphaTest = 0 } = {}) {
  const two = doubleSide ?? sway > 0;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, side: two ? THREE.DoubleSide : THREE.FrontSide, map, alphaTest, alphaToCoverage: alphaTest > 0 && RENDER_CAPS.msaa > 0 });
  m.userData.uniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };
  if (sway > 0 || snow || map) {
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, m.userData.uniforms);
      // cards: the up-pointing normals hold on back faces too
      if (map) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize( vNormal );');
      if (snow) {
        // snow lies on whatever faces up: the true facet normal from screen derivatives, turned
        // toward the viewer, so the underside of a branch stays green
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vSnowWP;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSnowWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vSnowWP;\nfloat gSnow;')
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
{
  vec3 fn = normalize(cross(dFdx(vSnowWP), dFdy(vSnowWP)));
  if (dot(fn, cameraPosition - vSnowWP) < 0.0) fn = -fn;
  gSnow = smoothstep(0.18, 0.55, fn.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), gSnow * 0.92);
}`
          )
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.75, gSnow);');
      }
      if (!(sway > 0)) return;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uWind;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
{
  vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float ph = wp.x * 0.37 + wp.z * 0.21;
  float h = max(position.y, 0.0);
  float bend = h * h * ${sway.toFixed(3)} * (0.4 + uWind) * (sin(uTime * (1.3 + uWind) + ph) * 0.6 + sin(uTime * 3.1 + ph * 2.0) * 0.25 + uWind * 0.8);
  transformed.x += bend;
  transformed.z += bend * 0.4;
}`
        );
    };
    m.customProgramCacheKey = () => 'sway' + sway + (snow ? 's' : '') + (map ? 'm' : '');
  }
  return m;
}

export function createRockMaterial(tex, { snow = false } = {}) {
  // rock: vertex colour * biome tint (instance colour) * triplanar rock texture from the ground array
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  m.userData.uniforms = { uAlb: { value: tex.albedo }, uNrm: { value: tex.normal } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRP;\nvarying vec3 vRN;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vRP = (instanceMatrix * vec4(position, 1.0)).xyz;
vRN = normalize(mat3(instanceMatrix) * normal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uAlb;
varying vec3 vRP;
varying vec3 vRN;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 w = pow(abs(normalize(vRN)), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec3 p = vRP * 0.45;
  vec3 c = texture(uAlb, vec3(p.yz, 2.0)).rgb * w.x + texture(uAlb, vec3(p.xz, 2.0)).rgb * w.y + texture(uAlb, vec3(p.xy, 2.0)).rgb * w.z;
  diffuseColor.rgb *= c * 1.9;
  ${snow ? 'float sn = smoothstep(0.45, 0.75, normalize(vRN).y + (c.r - 0.3) * 0.4); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.9, 0.94), sn);' : ''}
}`
      );
  };
  m.customProgramCacheKey = () => 'rocktri' + (snow ? 's' : '');
  return m;
}

export { blob, branch, colorize, merge, ribbedLathe };
