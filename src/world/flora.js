// Procedural desert flora and rocks: geometry builders (vertex coloured, with baked AO-ish
// darkening) and a shared wind-sway material.

import * as THREE from 'three';
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

// ------------------------------------------------------------------ species
export function sagebrush(seed, { lod = 0, palette = null } = {}) {
  const rnd = mulberry32(seed);
  const noise = new SimplexNoise(seed);
  const parts = [];
  const R = 0.45 + rnd() * 0.35;
  const H = 0.5 + rnd() * 0.35;
  const base = palette ? palette.slice() : [0.4 + rnd() * 0.06, 0.4 + rnd() * 0.05, 0.3];
  // woody stems (near only)
  for (let i = 0; i < (lod ? 0 : 5); i++) {
    const a = rnd() * Math.PI * 2;
    const r = R * (0.3 + rnd() * 0.5);
    const pts = [V(0, -0.05, 0), V(Math.cos(a) * r * 0.3, H * 0.3, Math.sin(a) * r * 0.3), V(Math.cos(a) * r * 0.8, H * (0.55 + rnd() * 0.3), Math.sin(a) * r * 0.8)];
    parts.push(colorize(branch(pts, 0.025, 0.008, 4), () => [0.26, 0.2, 0.15]));
  }
  // foliage clumps: fewer, bigger and coarser in the distance
  const n = lod ? 5 : 9 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * R * 0.8;
    const y = H * (0.35 + rnd() * 0.6) * (1 - (rr / R) * 0.4);
    const s = (0.14 + rnd() * 0.13) * (lod ? 1.45 : 1);
    const b = blob(s, s * 0.8, s, lod ? 0 : 1, rnd, 0.3, noise);
    b.translate(Math.cos(a) * rr, y, Math.sin(a) * rr);
    const tint = 0.85 + rnd() * 0.3;
    parts.push(
      colorize(b, (v) => {
        const ao = 0.55 + 0.45 * Math.min(1, (v.y / H) * 1.1);
        return [base[0] * tint * ao, base[1] * tint * ao, base[2] * tint * ao];
      })
    );
  }
  return merge(parts);
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

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Smooth "crown" normals: point away from an axis/centre and upward, so foliage shades as a
// soft volume instead of flat facets.
function crownNormals(g, centre, { up = 0.55, axis = false } = {}) {
  const p = g.attributes.position;
  const n = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(centre);
    if (axis) v.y = 0;
    v.normalize();
    v.y += up;
    v.normalize();
    n[i * 3] = v.x;
    n[i * 3 + 1] = v.y;
    n[i * 3 + 2] = v.z;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

// Conifer (pine / spruce): a tapered trunk inside stacked, drooping tiers of branches whose rims
// are star-shaped (branch tips), smooth-shaded as a volume. Snow is added by the snow material.
export function conifer(seed, { spruce = false, scale = 1 } = {}) {
  const rnd = mulberry32(seed);
  const noise = new SimplexNoise(seed);
  const parts = [];
  const H = (spruce ? 10 + rnd() * 6 : 9 + rnd() * 6) * scale;
  const R = H * (spruce ? 0.17 : 0.2);
  const bark = spruce ? [0.24, 0.18, 0.14] : [0.36, 0.24, 0.16];
  const trunk = branch([V(0, -0.2, 0), V((rnd() - 0.5) * 0.15, H * 0.5, (rnd() - 0.5) * 0.15), V(0, H * 0.98, 0)], 0.14 * scale + H * 0.013, 0.025, 7);
  parts.push(colorize(trunk, (v) => bark.map((c) => c * (0.7 + 0.3 * Math.min(1, v.y / 2)) * (0.85 + 0.3 * (noise.noise3(v.x * 9, v.y * 3, v.z * 9) * 0.5 + 0.5)))));
  const deep = spruce ? [0.035, 0.08, 0.05] : [0.05, 0.1, 0.045];
  const mid = spruce ? [0.08, 0.16, 0.1] : [0.12, 0.2, 0.08];
  const tipC = spruce ? [0.15, 0.26, 0.16] : [0.26, 0.33, 0.14];
  const tiers = spruce ? 13 : 10;
  const seg = 14;
  const y0 = H * (spruce ? 0.08 : 0.3);
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const yb = y0 + (H * 0.95 - y0) * Math.pow(t, 0.92);
    const r = R * Math.pow(1 - t * 0.93, spruce ? 1.0 : 0.8) * (0.85 + rnd() * 0.3) + 0.2;
    const h = Math.max(0.45, r * (spruce ? 0.85 : 0.6));
    const rot = rnd() * Math.PI * 2;
    const pos = [],
      col = [],
      idx = [];
    const vert = (x, y, z, c) => {
      pos.push(x, y, z);
      col.push(...c);
      return pos.length / 3 - 1;
    };
    const shade = (base, x, y, z) => {
      const nn = 0.82 + 0.36 * (noise.noise3(x * 0.9 + i, y * 0.9, z * 0.9) * 0.5 + 0.5);
      return base.map((c) => c * nn);
    };
    const apex = vert(0, yb + h, 0, shade(deep, 0, yb + h, 0));
    const ringA = [],
      ringB = [];
    for (let k = 0; k < seg; k++) {
      const a = rot + (k / seg) * Math.PI * 2;
      const ca = Math.cos(a),
        sa = Math.sin(a);
      const rm = r * (0.5 + rnd() * 0.1);
      const ym = yb + h * 0.42 - rnd() * 0.08 * r;
      ringA.push(vert(ca * rm, ym, sa * rm, shade(mid, ca * rm, ym, sa * rm)));
      // star rim: long drooping branch tips alternate with short raised ones
      const tip = k % 2 === 0;
      const rr = r * (tip ? 0.95 + rnd() * 0.25 : 0.62 + rnd() * 0.12);
      const yy = yb - (tip ? (0.12 + rnd() * 0.2) * r : -0.05 * h);
      ringB.push(vert(ca * rr, yy, sa * rr, shade(tip ? tipC : mid, ca * rr, yy, sa * rr)));
    }
    for (let k = 0; k < seg; k++) {
      const k2 = (k + 1) % seg;
      idx.push(apex, ringA[k2], ringA[k]);
      idx.push(ringA[k], ringA[k2], ringB[k2]);
      idx.push(ringA[k], ringB[k2], ringB[k]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    crownNormals(g, V(0, yb - h * 0.4, 0), { up: 0.7, axis: true });
    parts.push(g.toNonIndexed());
  }
  return merge(parts);
}

// Birch: white trunk with dark marks, a few rising limbs and many loose leaf clusters shaded as
// one soft crown (or bare twigs in winter).
export function broadleaf(seed, { autumn = 0, bare = false } = {}) {
  const rnd = mulberry32(seed);
  const noise = new SimplexNoise(seed);
  const parts = [];
  const H = 7 + rnd() * 5;
  const barkC = (v) => {
    const n = noise.noise3(v.x * 7, v.y * 11, v.z * 7);
    const mark = n > 0.42 ? 0.22 : 1;
    const base = v.y < 0.7 ? 0.5 : 1;
    return [0.8 * mark * base, 0.79 * mark * base, 0.75 * mark * base];
  };
  const lean = V((rnd() - 0.5) * 0.7, 0, (rnd() - 0.5) * 0.7);
  const top = V(lean.x, H, lean.z);
  parts.push(colorize(branch([V(0, -0.15, 0), V(lean.x * 0.3, H * 0.45, lean.z * 0.3), top], 0.15, 0.035, 7), barkC));
  const limbs = bare ? 9 : 6;
  const ends = [];
  for (let i = 0; i < limbs; i++) {
    const y = H * (0.38 + 0.5 * (i / limbs));
    const a = rnd() * Math.PI * 2;
    const L = H * (0.2 + rnd() * 0.16) * (1 - (i / limbs) * 0.45);
    const p0 = V(lean.x * (y / H), y, lean.z * (y / H));
    const p1 = p0.clone().add(V(Math.cos(a) * L * 0.5, L * 0.5, Math.sin(a) * L * 0.5));
    const p2 = p0.clone().add(V(Math.cos(a) * L, L * 0.85, Math.sin(a) * L));
    parts.push(colorize(branch([p0, p1, p2], 0.045, 0.01, 4), () => [0.4, 0.36, 0.33]));
    ends.push(p2, p1.clone().lerp(p2, 0.4));
    if (bare)
      for (let k = 0; k < 3; k++) {
        const b = rnd() * Math.PI * 2;
        const q = p2.clone().add(V(Math.cos(b) * L * 0.35, L * 0.3, Math.sin(b) * L * 0.35));
        parts.push(colorize(branch([p1.clone().lerp(p2, 0.6), q], 0.012, 0.004, 3), () => [0.36, 0.32, 0.3]));
      }
  }
  if (!bare) {
    const leaf = lerp3([0.3, 0.42, 0.12], [0.85, 0.6, 0.12], autumn);
    const leafDeep = lerp3([0.1, 0.18, 0.05], [0.42, 0.24, 0.05], autumn);
    const crownC = V(lean.x * 0.8, H * 0.72, lean.z * 0.8);
    const cr = H * 0.28;
    const clumps = [...ends, top, top.clone().add(V(0, -0.8, 0))];
    for (const e of clumps)
      for (let k = 0; k < 2; k++) {
        const s = 0.55 + rnd() * 0.55;
        const b = blob(s, s * 0.75, s, 1, rnd, 0.55, noise);
        b.translate(e.x + (rnd() - 0.5) * 1.1, e.y - 0.1 + (rnd() - 0.5) * 0.8, e.z + (rnd() - 0.5) * 1.1);
        const tint = 0.8 + rnd() * 0.35;
        colorize(b, (v) => {
          const outside = Math.min(1, v.distanceTo(crownC) / cr);
          const nn = 0.8 + 0.4 * (noise.noise3(v.x * 1.7, v.y * 1.7, v.z * 1.7) * 0.5 + 0.5);
          return lerp3(leafDeep, leaf, outside * 0.8 + Math.max(0, v.y - crownC.y) / cr * 0.3).map((c) => c * tint * nn);
        });
        crownNormals(b, crownC, { up: 0.45 });
        parts.push(b);
      }
  }
  return merge(parts);
}

// Fern: arching fronds from one crown.
export function fern(seed) {
  const rnd = mulberry32(seed);
  const pos = [],
    col = [];
  const n = 6 + Math.floor(rnd() * 3);
  const L = 0.5 + rnd() * 0.35;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
    const dx = Math.cos(a),
      dz = Math.sin(a);
    const px = -dz,
      pz = dx;
    const seg = 5;
    let prev = null;
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const r = t * L;
      const y = Math.sin(t * Math.PI * 0.8) * L * 0.55;
      const w = Math.sin(t * Math.PI) * 0.09 * (0.8 + rnd() * 0.3);
      const c = [r * dx, y, r * dz];
      const cur = [
        [c[0] - px * w, c[1], c[2] - pz * w],
        [c[0] + px * w, c[1], c[2] + pz * w],
      ];
      if (prev) {
        for (const tri of [
          [prev[0], prev[1], cur[1]],
          [prev[0], cur[1], cur[0]],
        ])
          for (const v of tri) {
            pos.push(...v);
            const f = v[1] / (L * 0.55);
            col.push(0.1 + 0.12 * f, 0.22 + 0.16 * f, 0.07 + 0.05 * f);
          }
      }
      prev = cur;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// A patch of wildflowers: thin stems with coloured heads.
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

// Low tundra shrub (dwarf willow, heather): flat reddish-olive mounds.
export function tundraShrub(seed) {
  const rnd = mulberry32(seed);
  const noise = new SimplexNoise(seed);
  const parts = [];
  const n = 4 + Math.floor(rnd() * 3);
  const pal = [
    [0.36, 0.24, 0.16],
    [0.42, 0.36, 0.2],
    [0.3, 0.3, 0.16],
  ];
  for (let i = 0; i < n; i++) {
    const s = 0.22 + rnd() * 0.25;
    const b = blob(s, s * 0.45, s, 1, rnd, 0.35, noise);
    b.translate((rnd() - 0.5) * 0.7, s * 0.3, (rnd() - 0.5) * 0.7);
    const c = pal[Math.floor(rnd() * pal.length)];
    parts.push(colorize(b, (v) => c.map((x) => x * (0.7 + 0.5 * Math.min(1, v.y / 0.25)))));
  }
  return merge(parts);
}

// Reeds at the water's edge.
export function reeds(seed) {
  return grassTuft(seed, { blades: 22, height: 3.2, base: [0.25, 0.28, 0.14], tip: [0.62, 0.58, 0.3], spread: 3 });
}

// ------------------------------------------------------------------ materials
export function createFloraMaterial({ sway = 0, roughness = 0.9, snow = false, doubleSide = null } = {}) {
  const two = doubleSide ?? sway > 0;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, side: two ? THREE.DoubleSide : THREE.FrontSide });
  m.userData.uniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };
  if (sway > 0 || snow) {
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, m.userData.uniforms);
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
    m.customProgramCacheKey = () => 'sway' + sway + (snow ? 's' : '');
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
