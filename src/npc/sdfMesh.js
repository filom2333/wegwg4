// Signed-distance modelling for organic characters, polygonised with naive surface nets.
// Every primitive belongs to a bone and a material region; the mesher outputs positions,
// gradient normals, per-vertex colours/roughness and smooth skin weights derived from how much
// each bone's primitives contribute at that point.

import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ primitives
export function sdRoundCone(px, py, pz, a, b, r1, r2) {
  // Inigo Quilez: round cone between spheres (a, r1) and (b, r2)
  const bax = b.x - a.x,
    bay = b.y - a.y,
    baz = b.z - a.z;
  const l2 = bax * bax + bay * bay + baz * baz;
  if (l2 < 1e-10) return Math.hypot(px - a.x, py - a.y, pz - a.z) - Math.max(r1, r2);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - a.x,
    pay = py - a.y,
    paz = pz - a.z;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const xx = pax * l2 - bax * y,
    xy = pay * l2 - bay * y,
    xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

export function sdEllipsoid(px, py, pz, c, r, rot) {
  let x = px - c.x,
    y = py - c.y,
    z = pz - c.z;
  if (rot) {
    const e = rot.elements;
    const ix = e[0] * x + e[1] * y + e[2] * z,
      iy = e[3] * x + e[4] * y + e[5] * z,
      iz = e[6] * x + e[7] * y + e[8] * z;
    x = ix;
    y = iy;
    z = iz;
  }
  const k0 = Math.sqrt((x / r.x) ** 2 + (y / r.y) ** 2 + (z / r.z) ** 2);
  const k1 = Math.sqrt((x / (r.x * r.x)) ** 2 + (y / (r.y * r.y)) ** 2 + (z / (r.z * r.z)) ** 2);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r.x, r.y, r.z);
}

export function sdRoundBox(px, py, pz, c, h, rad, rot) {
  let x = px - c.x,
    y = py - c.y,
    z = pz - c.z;
  if (rot) {
    const e = rot.elements;
    const ix = e[0] * x + e[1] * y + e[2] * z,
      iy = e[3] * x + e[4] * y + e[5] * z,
      iz = e[6] * x + e[7] * y + e[8] * z;
    x = ix;
    y = iy;
    z = iz;
  }
  const qx = Math.abs(x) - h.x + rad,
    qy = Math.abs(y) - h.y + rad,
    qz = Math.abs(z) - h.z + rad;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rad;
}

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a, b, k) {
  return -smin(-a, -b, k);
}

// ------------------------------------------------------------------ model
/**
 * Model: list of shapes { type:'cone'|'ell', ..., bone, mat, blend, sub? }
 * Materials: { name: { color:[r,g,b], rough, noise } }
 */
export class SDFModel {
  constructor() {
    this.shapes = [];
    this.mats = {};
    this.attachments = [];
    this.layerBias = 0.004; // how strongly outer layers win material ties (m per layer)
    this.colorBlend = 0; // >0: blend material colours over this distance (m) instead of hard switching
    this.bbox = new THREE.Box3();
  }

  material(name, color, rough = 0.8, noise = 0.08) {
    // authored as sRGB, stored linear (vertex colours are in the working colour space)
    this.mats[name] = { color: new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace), rough, noise };
    return name;
  }

  cone(a, b, r1, r2, bone, mat, { blend = 0.03, sub = false, layer = 0 } = {}) {
    this.shapes.push({ type: 'cone', a: a.clone(), b: b.clone(), r1, r2, bone, mat, blend, sub, layer });
    this.grow(a, Math.max(r1, r2));
    this.grow(b, Math.max(r1, r2));
  }

  // `basis`: optional Matrix4 whose columns are the ellipsoid's local axes in model space.
  ell(c, r, bone, mat, { blend = 0.03, sub = false, rot = null, basis = null, layer = 0 } = {}) {
    let m = null;
    if (rot) m = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot)).transpose();
    // the evaluator computes (m^T p), so an explicit basis is stored as-is to get local = R^T p
    if (basis) m = new THREE.Matrix3().setFromMatrix4(basis);
    this.shapes.push({ type: 'ell', c: c.clone(), r: r.clone(), rot: m, bone, mat, blend, sub, layer });
    this.grow(c, Math.max(r.x, r.y, r.z));
  }

  box(c, h, rad, bone, mat, { blend = 0.02, sub = false, rot = null, layer = 0 } = {}) {
    let m = null;
    if (rot) m = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot)).transpose();
    this.shapes.push({ type: 'box', c: c.clone(), h: h.clone(), rad, rot: m, bone, mat, blend, sub, layer });
    this.grow(c, h.length());
  }

  // Separate meshes rigidly attached to a bone (eyes): { type, bone, pos:[x,y,z] world rest, r, color }
  attach(a) {
    this.attachments.push(a);
  }

  grow(p, r) {
    this.bbox.expandByPoint(V(p.x - r, p.y - r, p.z - r));
    this.bbox.expandByPoint(V(p.x + r, p.y + r, p.z + r));
  }

  dist(s, x, y, z) {
    if (s.type === 'cone') return sdRoundCone(x, y, z, s.a, s.b, s.r1, s.r2);
    if (s.type === 'box') return sdRoundBox(x, y, z, s.c, s.h, s.rad, s.rot);
    return sdEllipsoid(x, y, z, s.c, s.r, s.rot);
  }

  // Field value; also fills `info` with per-shape distances (for weights / materials).
  field(x, y, z, dists) {
    let f = 1e9;
    for (let i = 0; i < this.shapes.length; i++) {
      const s = this.shapes[i];
      const d = this.dist(s, x, y, z);
      if (dists) dists[i] = d;
      if (s.sub) f = smax(f, -d, s.blend);
      else f = smin(f, d, s.blend);
    }
    return f;
  }

  // Field over a subset of shapes (block-local); fills dl[q] for list[q].
  fieldList(list, x, y, z, dl) {
    let f = 1e9;
    for (let q = 0; q < list.length; q++) {
      const s = list[q];
      const d = this.dist(s, x, y, z);
      if (dl) dl[q] = d;
      if (s.sub) f = smax(f, -d, s.blend);
      else f = smin(f, d, s.blend);
    }
    return f;
  }

  // Coarse culling: shapes whose bounding sphere intersects a cell block.
  buildAccel() {
    for (const s of this.shapes) {
      if (s.type === 'cone') {
        s.cx = (s.a.x + s.b.x) / 2;
        s.cy = (s.a.y + s.b.y) / 2;
        s.cz = (s.a.z + s.b.z) / 2;
        s.brad = s.a.distanceTo(s.b) / 2 + Math.max(s.r1, s.r2);
      } else if (s.type === 'box') {
        s.cx = s.c.x;
        s.cy = s.c.y;
        s.cz = s.c.z;
        s.brad = s.h.length();
      } else {
        s.cx = s.c.x;
        s.cy = s.c.y;
        s.cz = s.c.z;
        s.brad = Math.max(s.r.x, s.r.y, s.r.z);
      }
    }
  }
}

// ------------------------------------------------------------------ surface nets
export function polygonize(model, cell, bones) {
  return geometryFromArrays(polygonizeArrays(model, cell, bones));
}

export function geometryFromArrays(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(a.C, 3));
  g.setAttribute('rough', new THREE.BufferAttribute(a.R, 1));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(a.SI, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(a.SW, 4));
  g.setIndex(new THREE.BufferAttribute(a.I, 1));
  g.computeBoundingSphere();
  return g;
}

export function polygonizeArrays(model, cell, bones) {
  model.buildAccel();
  const pad = cell * 2;
  const min = model.bbox.min.clone().subScalar(pad),
    max = model.bbox.max.clone().addScalar(pad);
  const nx = Math.ceil((max.x - min.x) / cell) + 1,
    ny = Math.ceil((max.y - min.y) / cell) + 1,
    nz = Math.ceil((max.z - min.z) / cell) + 1;
  const F = new Float32Array(nx * ny * nz);
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  // evaluate in blocks with per-block shape lists
  const B = 8;
  const S = model.shapes;
  const blockList = [];
  let maxBlend = 0;
  for (const sh of S) maxBlend = Math.max(maxBlend, sh.blend);
  const margin = cell * 2 + maxBlend * 1.5;
  const nbx = Math.ceil(nx / B),
    nby = Math.ceil(ny / B);
  for (let bk = 0; bk < nz; bk += B)
    for (let bj = 0; bj < ny; bj += B)
      for (let bi = 0; bi < nx; bi += B) {
        const cx = min.x + (bi + B / 2) * cell,
          cy = min.y + (bj + B / 2) * cell,
          cz = min.z + (bk + B / 2) * cell;
        const half = (B / 2) * cell * 1.75 + margin;
        const list = [];
        let anyAdd = false;
        for (let s = 0; s < S.length; s++) {
          const sh = S[s];
          const d = Math.hypot(sh.cx - cx, sh.cy - cy, sh.cz - cz) - sh.brad;
          if (d < half) {
            list.push(sh);
            if (!sh.sub) anyAdd = true;
          }
        }
        blockList.push({ bi, bj, bk, list: anyAdd ? list : null });
      }
  for (const blk of blockList) {
    for (let k = blk.bk; k < Math.min(nz, blk.bk + B); k++)
      for (let j = blk.bj; j < Math.min(ny, blk.bj + B); j++)
        for (let i = blk.bi; i < Math.min(nx, blk.bi + B); i++) {
          if (!blk.list) {
            F[idx(i, j, k)] = cell * 4;
            continue;
          }
          const x = min.x + i * cell,
            y = min.y + j * cell,
            z = min.z + k * cell;
          let f = 1e9;
          for (const s of blk.list) {
            const d = model.dist(s, x, y, z);
            if (s.sub) f = smax(f, -d, s.blend);
            else f = smin(f, d, s.blend);
          }
          F[idx(i, j, k)] = f;
        }
  }
  // vertices: one per cell crossing the surface
  const vid = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const vblk = [];
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const edges = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, d] = corners[c];
          cv[c] = F[idx(i + a, j + b, k + d)];
          if (cv[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0,
          sy = 0,
          sz = 0,
          n = 0;
        for (const [e0, e1] of edges) {
          const a = cv[e0],
            b = cv[e1];
          if (a < 0 !== b < 0) {
            const t = a / (a - b);
            const p0 = corners[e0],
              p1 = corners[e1];
            sx += p0[0] + (p1[0] - p0[0]) * t;
            sy += p0[1] + (p1[1] - p0[1]) * t;
            sz += p0[2] + (p1[2] - p0[2]) * t;
            n++;
          }
        }
        vid[idx(i, j, k)] = pos.length / 3;
        pos.push(min.x + (i + sx / n) * cell, min.y + (j + sy / n) * cell, min.z + (k + sz / n) * cell);
        vblk.push((Math.floor(k / B) * nby + Math.floor(j / B)) * nbx + Math.floor(i / B));
      }
  // quads across crossing edges
  const tris = [];
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const f0 = F[idx(i, j, k)];
        const inside = f0 < 0;
        // x edge (i,j,k)-(i+1,j,k): quad of cells sharing it: (i, j-1..j, k-1..k)
        const test = (f1, cells) => {
          if (inside === f1 < 0) return;
          const q = cells.map(([a, b, c]) => vid[idx(a, b, c)]);
          if (q.some((v) => v < 0)) return;
          if (inside) tris.push(q[0], q[1], q[2], q[0], q[2], q[3]);
          else tris.push(q[0], q[2], q[1], q[0], q[3], q[2]);
        };
        if (i < nx - 1)
          test(F[idx(i + 1, j, k)], [
            [i, j - 1, k - 1],
            [i, j, k - 1],
            [i, j, k],
            [i, j - 1, k],
          ]);
        if (j < ny - 1)
          test(F[idx(i, j + 1, k)], [
            [i - 1, j, k - 1],
            [i - 1, j, k],
            [i, j, k],
            [i, j, k - 1],
          ]);
        if (k < nz - 1)
          test(F[idx(i, j, k + 1)], [
            [i - 1, j - 1, k],
            [i, j - 1, k],
            [i, j, k],
            [i - 1, j, k],
          ]);
      }
  // project vertices exactly onto the surface, normals, materials and weights
  const nv = pos.length / 3;
  const P = new Float32Array(pos);
  const N = new Float32Array(nv * 3);
  const C = new Float32Array(nv * 3);
  const R = new Float32Array(nv);
  const SI = new Uint16Array(nv * 4);
  const SW = new Float32Array(nv * 4);
  const MI = new Uint16Array(nv);
  const dl = new Float32Array(S.length);
  const e = cell * 0.25;
  const boneIndex = new Map(bones.map((b, i) => [b, i]));
  const shapeIndex = new Map(S.map((sh, i) => [sh, i]));
  const boneD = new Float32Array(bones.length);
  for (let v = 0; v < nv; v++) {
    const blk = blockList[vblk[v]];
    const L = blk && blk.list ? blk.list : S;
    const F = (x, y, z, out) => model.fieldList(L, x, y, z, out);
    let x = P[v * 3],
      y = P[v * 3 + 1],
      z = P[v * 3 + 2];
    for (let it = 0; it < 3; it++) {
      const f = F(x, y, z);
      const gx = F(x + e, y, z) - F(x - e, y, z);
      const gy = F(x, y + e, z) - F(x, y - e, z);
      const gz = F(x, y, z + e) - F(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) / (2 * e) || 1;
      const s = f / gl / gl / (2 * e);
      x -= gx * s;
      y -= gy * s;
      z -= gz * s;
    }
    P[v * 3] = x;
    P[v * 3 + 1] = y;
    P[v * 3 + 2] = z;
    const gx = F(x + e, y, z) - F(x - e, y, z);
    const gy = F(x, y + e, z) - F(x, y - e, z);
    const gz = F(x, y, z + e) - F(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    N[v * 3] = gx / gl;
    N[v * 3 + 1] = gy / gl;
    N[v * 3 + 2] = gz / gl;
    F(x, y, z, dl);
    // material: the shape whose boundary passes closest to this surface point (carved surfaces
    // take the carving shape's material); outer layers (clothes, beard, lips) win near-ties
    let best = 0,
      bd = 1e9;
    for (let q = 0; q < L.length; q++) {
      const d = Math.abs(dl[q]) - L[q].layer * model.layerBias;
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    const m = model.mats[L[best].mat];
    MI[v] = shapeIndex.get(L[best]);
    const nn = (Math.sin(x * 91.7 + y * 37.3) * Math.sin(z * 71.1 - y * 13.7) + Math.sin(x * 23.1 - z * 41.9)) * 0.5;
    if (model.colorBlend > 0) {
      // soft transitions: every shape near the surface contributes its material colour
      let wr = 0,
        wg = 0,
        wb = 0,
        wro = 0,
        wn = 0,
        ws = 0;
      for (let q = 0; q < L.length; q++) {
        const sc = Math.abs(dl[q]) - L[q].layer * model.layerBias - bd;
        if (sc > model.colorBlend * 4) continue;
        const w = Math.exp(-sc / model.colorBlend);
        const mm = model.mats[L[q].mat];
        wr += mm.color.r * w;
        wg += mm.color.g * w;
        wb += mm.color.b * w;
        wro += mm.rough * w;
        wn += mm.noise * w;
        ws += w;
      }
      const k = 1 + (nn * wn) / ws;
      C[v * 3] = (wr / ws) * k;
      C[v * 3 + 1] = (wg / ws) * k;
      C[v * 3 + 2] = (wb / ws) * k;
      R[v] = wro / ws;
    } else {
      C[v * 3] = m.color.r * (1 + nn * m.noise);
      C[v * 3 + 1] = m.color.g * (1 + nn * m.noise);
      C[v * 3 + 2] = m.color.b * (1 + nn * m.noise);
      R[v] = m.rough;
    }
    // weights: exp falloff by distance per bone (min over the bone's shapes)
    boneD.fill(1e9);
    for (let q = 0; q < L.length; q++) {
      if (L[q].sub) continue;
      const bi = boneIndex.get(L[q].bone);
      if (dl[q] < boneD[bi]) boneD[bi] = dl[q];
    }
    const arr = [];
    for (let bi = 0; bi < boneD.length; bi++) if (boneD[bi] < 1e8) arr.push([bi, Math.exp(-Math.max(0, boneD[bi]) / 0.012)]);
    arr.sort((a, b) => b[1] - a[1]);
    arr.length = Math.min(arr.length, 4);
    let sum = 0;
    for (const [, w] of arr) sum += w;
    for (let q = 0; q < 4; q++) {
      SI[v * 4 + q] = arr[q] ? arr[q][0] : 0;
      SW[v * 4 + q] = arr[q] ? arr[q][1] / sum : 0;
    }
  }
  const I = nv > 65535 ? new Uint32Array(tris) : new Uint16Array(tris);
  return { P, N, C, R, SI, SW, I, MI };
}

// Material: vertex colours + per-vertex roughness + fine fabric/skin detail.
export function characterMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rough;\nvarying float vRough;\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = rough;\nvLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRough;\nvarying vec3 vLocal;\nfloat hh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }')
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = vRough;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // fabric weave / skin pores breakup
  vec3 q = vLocal * 260.0;
  float fade = clamp(1.6 - length(fwidth(q)) * 0.9, 0.0, 1.0);
  float w = 0.5 + 0.5 * sin(q.x) * sin(q.y + q.z);
  float grain = hh(floor(vLocal * 600.0));
  diffuseColor.rgb *= 1.0 + fade * (0.08 * (w - 0.5) * step(0.7, vRough) + 0.05 * (grain - 0.5));
}`
      );
  };
  m.customProgramCacheKey = () => 'charmat';
  return m;
}


// Eyeball: sclera, iris ring and pupil from the local position (forward = +z), wet highlight.
const eyeMats = new Map();
export function eyeMaterial(iris = [0.3, 0.22, 0.12], glow = 0) {
  const key = iris.join(',') + glow;
  if (eyeMats.has(key)) return eyeMats.get(key);
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  const ic = new THREE.Color().setRGB(iris[0], iris[1], iris[2], THREE.SRGBColorSpace);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uIris = { value: ic };
    sh.uniforms.uGlow = { value: glow };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vEyeP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeP = normalize(position);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEyeP;\nuniform vec3 uIris;\nuniform float uGlow;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float rr = length(vEyeP.xy) * step(0.0, vEyeP.z);
vec3 sclera = mix(vec3(0.42, 0.36, 0.32), vec3(0.62, 0.58, 0.52), smoothstep(0.9, 0.2, rr));
float iris = smoothstep(0.47, 0.43, rr) * step(0.0, vEyeP.z);
float pupil = smoothstep(0.2, 0.17, rr) * step(0.0, vEyeP.z);
vec3 ir = uIris * (0.7 + 0.5 * smoothstep(0.43, 0.2, rr));
diffuseColor.rgb = mix(mix(sclera, ir, iris), vec3(0.01), pupil);`
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * uIris * iris * (1.0 - pupil);');
  };
  m.customProgramCacheKey = () => 'eye' + key;
  eyeMats.set(key, m);
  return m;
}
