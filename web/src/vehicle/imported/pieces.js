// Moving whole pieces of a converted car from one part to another at load: the connected pieces
// (triangles joined through shared corners) of a part's meshes, taken by where their bounds lie.
// For what the converter could not sort, e.g. a rear bench that came merged into the cabin trim:
// the bench's cushion, back and headrests go to seat_R, so the seat comes out whole.

import * as THREE from 'three';

// Connected pieces of a geometry: an array of triangle-index lists with their bounds.
export function piecesOf(geometry) {
  const pos = geometry.attributes.position;
  const idx = geometry.index ? geometry.index.array : null;
  const nTri = (idx ? idx.length : pos.count) / 3;
  const corner = (t, k) => (idx ? idx[t * 3 + k] : t * 3 + k);
  // corners welded by position (the source splits them at UV and normal seams)
  const key = new Map();
  const weld = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getX(i) * 2000) + ',' + Math.round(pos.getY(i) * 2000) + ',' + Math.round(pos.getZ(i) * 2000);
    let w = key.get(k);
    if (w === undefined) key.set(k, (w = key.size));
    weld[i] = w;
  }
  const parent = new Int32Array(key.size).map((_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let t = 0; t < nTri; t++) {
    const a = find(weld[corner(t, 0)]);
    for (let k = 1; k < 3; k++) {
      const b = find(weld[corner(t, k)]);
      if (a !== b) parent[b] = a;
    }
  }
  const byRoot = new Map();
  for (let t = 0; t < nTri; t++) {
    const r = find(weld[corner(t, 0)]);
    let p = byRoot.get(r);
    if (!p) byRoot.set(r, (p = { tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
    p.tris.push(t);
    for (let k = 0; k < 3; k++) {
      const i = corner(t, k);
      const v = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      for (let j = 0; j < 3; j++) {
        if (v[j] < p.min[j]) p.min[j] = v[j];
        if (v[j] > p.max[j]) p.max[j] = v[j];
      }
    }
  }
  return [...byRoot.values()];
}

// A geometry of only the given triangles (attributes and all).
function subset(geometry, tris) {
  const src = geometry.index ? geometry : null;
  const out = new THREE.BufferGeometry();
  const idx = src ? geometry.index.array : null;
  if (idx) {
    const ni = new (idx.length > 65535 ? Uint32Array : Uint16Array)(tris.length * 3);
    tris.forEach((t, j) => {
      ni[j * 3] = idx[t * 3];
      ni[j * 3 + 1] = idx[t * 3 + 1];
      ni[j * 3 + 2] = idx[t * 3 + 2];
    });
    for (const [k, a] of Object.entries(geometry.attributes)) out.setAttribute(k, a);
    out.setIndex(new THREE.BufferAttribute(ni, 1));
  } else {
    for (const [k, a] of Object.entries(geometry.attributes)) {
      const arr = new a.array.constructor(tris.length * 3 * a.itemSize);
      tris.forEach((t, j) => arr.set(a.array.subarray(t * 3 * a.itemSize, (t * 3 + 3) * a.itemSize), j * 3 * a.itemSize));
      out.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
    }
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// rules: [{ from, to, mats: [material names] | null, box: [[x0, y0, z0], [x1, y1, z1]], tris }]; a
// piece moves when its bounds lie wholly inside the box. With `tris`, single triangles move by
// where their middles are (for a seat the source modelled in one with the cabin's floor and sides);
// `steep` takes only those standing up (a cushion's front, not the floor in front of it).
export function movePieces(parts, rules) {
  for (const r of rules) {
    const from = parts[r.from];
    if (!from) continue;
    const to = (parts[r.to] = parts[r.to] || []);
    for (let e = 0; e < from.length; e++) {
      const ent = from[e];
      if (r.mats && !r.mats.includes(ent.mat)) continue;
      const take = [],
        keep = [];
      if (r.tris) {
        const pos = ent.geometry.attributes.position;
        const idx = ent.geometry.index ? ent.geometry.index.array : null;
        const n = (idx ? idx.length : pos.count) / 3;
        for (let t = 0; t < n; t++) {
          const c = [0, 0, 0];
          for (let k = 0; k < 3; k++) {
            const i = idx ? idx[t * 3 + k] : t * 3 + k;
            c[0] += pos.getX(i) / 3;
            c[1] += pos.getY(i) / 3;
            c[2] += pos.getZ(i) / 3;
          }
          let ok = c.every((v, j) => v >= r.box[0][j] && v <= r.box[1][j]);
          if (ok && r.steep) {
            const i0 = idx ? idx[t * 3] : t * 3,
              i1 = idx ? idx[t * 3 + 1] : t * 3 + 1,
              i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
            const a = new THREE.Vector3().fromBufferAttribute(pos, i0);
            const e1 = new THREE.Vector3().fromBufferAttribute(pos, i1).sub(a);
            const e2 = new THREE.Vector3().fromBufferAttribute(pos, i2).sub(a);
            ok = Math.abs(e1.cross(e2).normalize().y) < 0.6;
          }
          (ok ? take : keep).push(t);
        }
      } else {
        const inBox = (p) => p.min.every((v, j) => v >= r.box[0][j]) && p.max.every((v, j) => v <= r.box[1][j]);
        for (const p of piecesOf(ent.geometry)) (inBox(p) ? take : keep).push(...p.tris);
      }
      if (!take.length) continue;
      to.push({ geometry: subset(ent.geometry, take.sort((a, b) => a - b)), mat: ent.mat });
      ent.geometry = subset(ent.geometry, keep.sort((a, b) => a - b));
    }
  }
}
