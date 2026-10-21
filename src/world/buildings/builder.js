// Geometry builder for architecture: boxes with continuous metre UVs, walls with openings,
// windows, doors, floors, roofs. Collects colliders, interactive doors, lights and loot spots.

import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Box geometry with metre-based UVs in the builder's local frame (continuous across pieces).
export function uvBox(cx, cy, cz, sx, sy, sz, rotY = 0, { uvOffset = [0, 0, 0], uvScale = 1 } = {}) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const pos = g.attributes.position,
    nrm = g.attributes.normal,
    uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx + uvOffset[0],
      y = pos.getY(i) + cy + uvOffset[1],
      z = pos.getZ(i) + cz + uvOffset[2];
    const ax = Math.abs(nrm.getX(i)),
      ay = Math.abs(nrm.getY(i));
    let u, v;
    if (ax > 0.5) {
      u = z * Math.sign(nrm.getX(i));
      v = y;
    } else if (ay > 0.5) {
      u = x;
      v = z;
    } else {
      u = -x * Math.sign(nrm.getZ(i));
      v = y;
    }
    uv.setXY(i, u * uvScale, v * uvScale);
  }
  if (rotY) g.rotateY(rotY);
  g.translate(cx, cy, cz);
  return g;
}

// Growable vertex arrays (position, normal, uv) for one material.
class VertexBuffer {
  constructor(cap = 1024) {
    this.len = 0;
    this.cap = cap;
    this.p = new Float32Array(this.cap * 3);
    this.n = new Float32Array(this.cap * 3);
    this.u = new Float32Array(this.cap * 2);
  }
  reserve(extra) {
    if (this.len + extra <= this.cap) return;
    let cap = this.cap;
    while (cap < this.len + extra) cap *= 2;
    const grow = (a, k) => {
      const b = new Float32Array(cap * k);
      b.set(a.subarray(0, this.len * k));
      return b;
    };
    this.p = grow(this.p, 3);
    this.n = grow(this.n, 3);
    this.u = grow(this.u, 2);
    this.cap = cap;
  }
}

const BOX_FACES = [
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [2, 1],
  [2, -1],
];

// 0..1 UVs per face scaled by the face size in metres (like BoxGeometry's, but metre-sized).
function faceUV(sx, sy, sz) {
  return (lx, ly, lz, nx, ny) => (nx !== 0 ? [lz + sz / 2, ly + sy / 2] : ny !== 0 ? [lx + sx / 2, lz + sz / 2] : [lx + sx / 2, ly + sy / 2]);
}

// The faces of a BoxGeometry by group (+x, -x, +y, -y, +z, -z) as their own geometry.
function faces(box, groups) {
  const g = box.clone();
  const idx = [];
  for (const gi of groups) {
    const gr = box.groups[gi];
    for (let k = 0; k < gr.count; k++) idx.push(box.index.array[gr.start + k]);
  }
  g.setIndex(idx);
  g.clearGroups();
  return g;
}

export class Builder {
  constructor(name = 'building') {
    this.name = name;
    this.byMat = new Map();
    this.colliders = []; // { c:[x,y,z], h:[hx,hy,hz], rotY, surface }
    this.doors = []; // interactive door leaves
    this.lights = []; // { pos, color, intensity, distance }
    this.loot = []; // { pos, kind, room }
    this.extra = []; // ready-made Object3D (e.g. instanced furniture)
    this.subs = []; // { builder, pivot: [x,y,z], anim } separately transformed parts (rotors)
    this.sensors = [];
  }

  // Appends a geometry's triangles (indexed or not) straight into growable per-material
  // buffers, optionally transformed by a Matrix4 (furniture placement) - no clones, no merges.
  add(geo, mat, matrix = null) {
    const acc = this.acc(mat);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const P = geo.attributes.position.array,
      N = geo.attributes.normal.array,
      U = geo.attributes.uv ? geo.attributes.uv.array : null;
    const idx = geo.index ? geo.index.array : null;
    const count = idx ? idx.length : geo.attributes.position.count;
    acc.reserve(count);
    const p = acc.p,
      n = acc.n,
      u = acc.u;
    let o3 = acc.len * 3,
      o2 = acc.len * 2;
    const e = matrix ? matrix.elements : null;
    for (let i = 0; i < count; i++) {
      const v = idx ? idx[i] : i;
      const v3 = v * 3;
      const x = P[v3],
        y = P[v3 + 1],
        z = P[v3 + 2];
      const nx = N[v3],
        ny = N[v3 + 1],
        nz = N[v3 + 2];
      if (e) {
        p[o3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        p[o3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        p[o3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        // rotation + translation only (no scale): normals rotate with the upper 3x3
        n[o3] = e[0] * nx + e[4] * ny + e[8] * nz;
        n[o3 + 1] = e[1] * nx + e[5] * ny + e[9] * nz;
        n[o3 + 2] = e[2] * nx + e[6] * ny + e[10] * nz;
      } else {
        p[o3] = x;
        p[o3 + 1] = y;
        p[o3 + 2] = z;
        n[o3] = nx;
        n[o3 + 1] = ny;
        n[o3 + 2] = nz;
      }
      if (U) {
        u[o2] = U[v * 2];
        u[o2 + 1] = U[v * 2 + 1];
      } else u[o2] = u[o2 + 1] = 0;
      o3 += 3;
      o2 += 2;
    }
    acc.len += count;
    return geo;
  }

  // A part that moves on its own (built in coordinates relative to `pivot`).
  sub(name, pivot, anim = null) {
    const b = new Builder(name);
    this.subs.push({ builder: b, pivot, anim });
    return b;
  }

  acc(mat) {
    let acc = this.byMat.get(mat);
    if (!acc) {
      acc = new VertexBuffer();
      this.byMat.set(mat, acc);
    }
    return acc;
  }

  // Box with metre UVs written directly (no BoxGeometry): uvFn(lx, ly, lz, nx, ny, nz) -> [u, v]
  // in the box's local frame; then rotated about Y and moved to (cx, cy, cz).
  pushBox(mat, cx, cy, cz, sx, sy, sz, rotY, uvFn) {
    const acc = this.acc(mat);
    acc.reserve(36);
    const hx = sx / 2,
      hy = sy / 2,
      hz = sz / 2;
    const c = Math.cos(rotY),
      s = Math.sin(rotY);
    const { p, n, u } = acc;
    let o3 = acc.len * 3,
      o2 = acc.len * 2;
    for (const [ax, sign] of BOX_FACES) {
      // face basis: normal along axis ax with sign; two in-plane axes
      const a1 = (ax + 1) % 3,
        a2 = (ax + 2) % 3;
      const H = [hx, hy, hz];
      const corner = (i, j) => {
        const v = [0, 0, 0];
        v[ax] = sign * H[ax];
        v[a1] = i * H[a1];
        v[a2] = j * H[a2];
        return v;
      };
      // winding so the face points along +normal
      const quad = sign > 0 ? [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] : [corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1)];
      const nl = [0, 0, 0];
      nl[ax] = sign;
      const nwx = nl[0] * c + nl[2] * s,
        nwz = -nl[0] * s + nl[2] * c;
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const v = quad[k];
        const uv = uvFn(v[0], v[1], v[2], nl[0], nl[1], nl[2]);
        p[o3] = cx + v[0] * c + v[2] * s;
        p[o3 + 1] = cy + v[1];
        p[o3 + 2] = cz - v[0] * s + v[2] * c;
        n[o3] = nwx;
        n[o3 + 1] = nl[1];
        n[o3 + 2] = nwz;
        u[o2] = uv[0];
        u[o2 + 1] = uv[1];
        o3 += 3;
        o2 += 2;
      }
    }
    acc.len += 36;
  }

  collider(cx, cy, cz, sx, sy, sz, rotY = 0, surface = 'wood', rotX = 0) {
    this.colliders.push({ c: [cx, cy, cz], h: [sx / 2, sy / 2, sz / 2], rotY, rotX, surface });
  }

  box(cx, cy, cz, sx, sy, sz, mat, { collide = true, rotY = 0, surface = 'wood', uvScale = 1 } = {}) {
    // same metre UVs as uvBox(): continuous across pieces in the builder's frame
    this.pushBox(mat, cx, cy, cz, sx, sy, sz, rotY, (lx, ly, lz, nx, ny, nz) => {
      const x = lx + cx,
        y = ly + cy,
        z = lz + cz;
      if (nx !== 0) return [z * nx * uvScale, y * uvScale];
      if (ny !== 0) return [x * uvScale, z * uvScale];
      return [-x * nz * uvScale, y * uvScale];
    });
    if (collide) this.collider(cx, cy, cz, sx, sy, sz, rotY, surface);
  }

  // Axis-aligned wall from a to b ([x,z]) at base y, with openings along it.
  // side: which normal side is "outside" for outMat (+1 = left of a->b direction, -1 right); null = both inMat.
  wall(a, b, y, h, t, { outMat, inMat, openings = [], surface = 'wood', outSide = 1, collide = true } = {}) {
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    const ux = dx / L,
      uz = dz / L;
    // left normal of the direction
    const nx = -uz,
      nz = ux;
    const ops = [...openings].sort((p, q) => p.at - q.at);
    const pieces = []; // [s0, s1, y0, y1]
    let s = 0;
    for (const o of ops) {
      const s0 = o.at - o.w / 2,
        s1 = o.at + o.w / 2;
      if (s0 > s + 0.001) pieces.push([s, s0, 0, h]);
      if (o.bottom > 0.001) pieces.push([s0, s1, 0, o.bottom]);
      if (o.top < h - 0.001) pieces.push([s0, s1, o.top, h]);
      s = s1;
    }
    if (s < L - 0.001) pieces.push([s, L, 0, h]);
    const half = t / 2;
    for (const [s0, s1, y0, y1] of pieces) {
      const cs = (s0 + s1) / 2,
        len = s1 - s0,
        hh = y1 - y0;
      const cx = a[0] + ux * cs,
        cz = a[1] + uz * cs;
      const cy = y + (y0 + y1) / 2;
      const rot = Math.atan2(-uz, ux); // box local x along the wall
      // two slabs: outer (exterior material) and inner
      const mats = outSide === null ? [inMat, inMat] : outSide > 0 ? [outMat, inMat] : [inMat, outMat];
      for (let k = 0; k < 2; k++) {
        const off = (k === 0 ? 1 : -1) * (half / 2);
        const gx = cx + nx * off,
          gz = cz + nz * off;
        // metre uvs along the wall
        this.pushBox(mats[k], gx, cy, gz, len, hh, half, rot, (lx, ly, lz, nx, ny, nz) => {
          const along = cs + lx;
          if (ny !== 0) return [along, lz];
          if (nx !== 0) return [lz, y + y0 + hh / 2 + ly];
          return [along * (nz > 0 ? 1 : -1), y + y0 + hh / 2 + ly];
        });
      }
      if (collide) this.collider(cx, cy, cz, len, hh, t, rot, surface);
    }
    // window/door trims
    return { ux, uz, nx, nz, L };
  }

  // Window: frame + panes in an opening on a wall (axis given by wall info).
  window(info, a, y, o, t, { frameMat, glassMat, broken = 0, sillMat = null, mullions = 1, rnd = Math.random } = {}) {
    const { ux, uz, nx, nz } = info;
    const cx = a[0] + ux * o.at,
      cz = a[1] + uz * o.at;
    const rot = Math.atan2(-uz, ux);
    const w = o.w,
      h = o.top - o.bottom;
    const cy = y + (o.bottom + o.top) / 2;
    const fw = 0.06;
    const c = Math.cos(rot),
      s = Math.sin(rot);
    const put = (lx, ly, sx, sy, sz, mat, lz = 0) => {
      this.pushBox(mat, cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c, sx, sy, sz, rot, faceUV(sx, sy, sz));
    };
    // frame
    put(0, h / 2 - fw / 2, w, fw, t * 0.6, frameMat);
    put(0, -h / 2 + fw / 2, w, fw, t * 0.6, frameMat);
    put(-w / 2 + fw / 2, 0, fw, h, t * 0.6, frameMat);
    put(w / 2 - fw / 2, 0, fw, h, t * 0.6, frameMat);
    for (let i = 1; i <= mullions; i++) put(-w / 2 + (w * i) / (mullions + 1), 0, 0.04, h - fw, t * 0.3, frameMat);
    put(0, 0, w - fw, 0.035, t * 0.3, frameMat);
    // sill (outside)
    if (sillMat) put(0, -h / 2 - 0.03, w + 0.12, 0.05, 0.06, sillMat, t / 2 + 0.02);
    // glass: some panes broken
    const panes = (mullions + 1) * 2;
    for (let p = 0; p < panes; p++) {
      const col = p % (mullions + 1),
        row = Math.floor(p / (mullions + 1));
      if (rnd() < broken) continue;
      const pw = (w - fw * 2) / (mullions + 1),
        ph = (h - fw * 2) / 2;
      put(-w / 2 + fw + pw * (col + 0.5), -h / 2 + fw + ph * (row + 0.5), pw, ph, 0.006, glassMat);
    }
  }

  // Door frame trims; returns a door leaf descriptor to be made interactive.
  doorway(info, a, y, o, t, { frameMat, leafMat, leaf = true, open = 0, hingeSide = 1, lock = false, kind = 'door' } = {}) {
    const { ux, uz } = info;
    const cx = a[0] + ux * o.at,
      cz = a[1] + uz * o.at;
    const rot = Math.atan2(-uz, ux);
    const w = o.w,
      h = o.top;
    const fw = 0.07;
    const c = Math.cos(rot),
      s = Math.sin(rot);
    const put = (lx, ly, sx, sy, sz, mat) => {
      this.pushBox(mat, cx + lx * c, y + ly, cz - lx * s, sx, sy, sz, rot, faceUV(sx, sy, sz));
    };
    put(0, h - fw / 2, w + fw * 2, fw, t + 0.02, frameMat);
    put(-w / 2 - fw / 2, h / 2, fw, h, t + 0.02, frameMat);
    put(w / 2 + fw / 2, h / 2, fw, h, t + 0.02, frameMat);
    if (!leaf) return null;
    const d = {
      kind,
      // hinge point in builder space and rotation of the closed leaf
      hinge: V(cx - ux * (w / 2) * hingeSide, y, cz - uz * (w / 2) * hingeSide),
      rot,
      w: w - 0.02,
      h: h - 0.02,
      t: 0.045,
      hingeSide,
      mat: leafMat,
      open,
      lock,
    };
    this.doors.push(d);
    return d;
  }

  floor(x0, z0, x1, z1, y, th, mat, surface = 'wood') {
    this.box((x0 + x1) / 2, y - th / 2, (z0 + z1) / 2, x1 - x0, th, z1 - z0, mat, { surface });
  }

  // Gable roof over [x0,x1]x[z0,z1] with ridge along x (or z), pitch in radians.
  gableRoof(x0, z0, x1, z1, y, pitch, { mat, under, fascia, overhang = 0.4, th = 0.12, ridgeAlong = 'x', gableMat }) {
    const alongX = ridgeAlong === 'x';
    const span = alongX ? z1 - z0 : x1 - x0;
    const len = (alongX ? x1 - x0 : z1 - z0) + overhang * 2;
    const half = span / 2 + overhang;
    const rise = (span / 2) * Math.tan(pitch);
    const slopeLen = half / Math.cos(pitch);
    const cxm = (x0 + x1) / 2,
      czm = (z0 + z1) / 2;
    for (const s of [-1, 1]) {
      // plane centre
      const off = (half / 2) * s;
      const yC = y + rise - (half / 2) * Math.tan(pitch) + (th / 2) / Math.cos(pitch);
      // build as slab in local (len x th x slopeLen) then rotate about the ridge axis
      const slab = new THREE.BoxGeometry(len, th, slopeLen);
      const pos = slab.attributes.position,
        uv = slab.attributes.uv,
        nr = slab.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const ay = Math.abs(nr.getY(i));
        if (ay > 0.5) uv.setXY(i, pos.getX(i), pos.getZ(i) * s);
        else uv.setXY(i, pos.getX(i) + pos.getZ(i), pos.getY(i));
      }
      slab.rotateX(pitch * s);
      if (!alongX) slab.rotateY(Math.PI / 2);
      if (alongX) slab.translate(cxm, yC, czm + off);
      else slab.translate(cxm + off, yC, czm);
      // roofing only on top: boards underneath (seen from inside and under the eaves), trim on the edges
      this.add(faces(slab, [2]), mat);
      this.add(faces(slab, [3]), under || mat);
      this.add(faces(slab, [0, 1, 4, 5]), fascia || under || mat);
      // underside soffit for the overhang parts handled by slab underside
      if (alongX) this.collider(cxm, yC, czm + off, len, th, slopeLen, 0, 'roof', pitch * s);
      else this.collider(cxm + off, yC, czm, len, th, slopeLen, Math.PI / 2, 'roof', pitch * s);
    }
    // ridge cap
    const ridge = new THREE.BoxGeometry(alongX ? len + 0.02 : 0.22, 0.08, alongX ? 0.22 : len + 0.02);
    ridge.translate(cxm, y + rise + th * 1.1, czm);
    this.add(ridge, fascia || mat);
    // gable end walls (triangles) on both ends
    const gm = gableMat;
    if (gm) {
      for (const e of [-1, 1]) {
        // the gable reaches 0.3 m down into the wall below, so no underside shows at the joint
        const shape = new THREE.Shape();
        shape.moveTo(-span / 2, -0.3);
        shape.lineTo(span / 2, -0.3);
        shape.lineTo(span / 2, 0);
        shape.lineTo(0, rise);
        shape.lineTo(-span / 2, 0);
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
        // uv in metres
        const p = geo.attributes.position,
          uv = geo.attributes.uv;
        for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getY(i) + y);
        geo.translate(0, 0, -0.09);
        if (alongX) {
          geo.rotateY(Math.PI / 2);
          geo.translate(e > 0 ? x1 - 0.09 : x0 + 0.09, y, czm);
        } else geo.translate(cxm, y, e > 0 ? z1 - 0.09 : z0 + 0.09);
        this.add(geo, gm);
        // seen from inside (no ceiling) the gable is boarded like the roof, not sided
        if (under) {
          const tri = new THREE.Shape();
          tri.moveTo(-span / 2, -0.3);
          tri.lineTo(span / 2, -0.3);
          tri.lineTo(span / 2, 0);
          tri.lineTo(0, rise);
          tri.lineTo(-span / 2, 0);
          tri.closePath();
          const inner = new THREE.ShapeGeometry(tri);
          const ip = inner.attributes.position,
            iu = inner.attributes.uv;
          for (let i = 0; i < ip.count; i++) iu.setXY(i, ip.getX(i), ip.getY(i) + y);
          const d = 0.184;
          if (alongX) {
            inner.rotateY(e > 0 ? -Math.PI / 2 : Math.PI / 2);
            inner.translate(e > 0 ? x1 - d : x0 + d, y, czm);
          } else {
            if (e > 0) inner.rotateY(Math.PI);
            inner.translate(cxm, y, e > 0 ? z1 - d : z0 + d);
          }
          this.add(inner, under);
        }
      }
    }
    // fascia boards along eaves
    if (fascia) {
      for (const s of [-1, 1]) {
        const g = new THREE.BoxGeometry(alongX ? len : 0.04, 0.18, alongX ? 0.04 : len);
        const eaveY = y - overhang * Math.tan(pitch) + 0.02;
        if (alongX) g.translate(cxm, eaveY, czm + s * (half + 0.02 / Math.cos(pitch)));
        else g.translate(cxm + s * half, eaveY, czm);
        this.add(g, fascia);
      }
    }
    return { rise };
  }

  flatRoof(x0, z0, x1, z1, y, { mat, parapetMat, parapet = 0.5, th = 0.2 }) {
    this.box((x0 + x1) / 2, y + th / 2, (z0 + z1) / 2, x1 - x0, th, z1 - z0, mat, { surface: 'concrete' });
    if (parapet > 0) {
      const t = 0.2;
      this.box((x0 + x1) / 2, y + th + parapet / 2, z0 + t / 2, x1 - x0, parapet, t, parapetMat);
      this.box((x0 + x1) / 2, y + th + parapet / 2, z1 - t / 2, x1 - x0, parapet, t, parapetMat);
      this.box(x0 + t / 2, y + th + parapet / 2, (z0 + z1) / 2, t, parapet, z1 - z0 - 2 * t, parapetMat);
      this.box(x1 - t / 2, y + th + parapet / 2, (z0 + z1) / 2, t, parapet, z1 - z0 - 2 * t, parapetMat);
    }
  }

  // One mesh per material (materials may be worker tokens: resolve maps them to real ones).
  build(resolve = (m) => m) {
    const group = new THREE.Group();
    group.name = this.name;
    this.animated = this.animated || [];
    for (const [mat, acc] of this.byMat) {
      if (!acc.len) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(acc.p.length === acc.len * 3 ? acc.p : acc.p.slice(0, acc.len * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(acc.n.length === acc.len * 3 ? acc.n : acc.n.slice(0, acc.len * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(acc.u.length === acc.len * 2 ? acc.u : acc.u.slice(0, acc.len * 2), 2));
      const bs = acc.bs || sphereOf(g.attributes.position.array);
      g.boundingSphere = new THREE.Sphere(V(bs[0], bs[1], bs[2]), bs[3]);
      const real = resolve(mat);
      const m = new THREE.Mesh(g, real);
      m.castShadow = !real.transparent;
      m.receiveShadow = true;
      group.add(m);
    }
    for (const o of this.extra) group.add(o);
    for (const s of this.subs) {
      const piv = new THREE.Group();
      piv.position.set(...s.pivot);
      piv.add(s.builder.build(resolve));
      group.add(piv);
      if (s.anim) this.animated.push({ obj: piv, ...s.anim });
    }
    return group;
  }

  // Plain data for postMessage (geometry buffers listed in `transfer`).
  serialize(transfer = []) {
    const meshes = [];
    for (const [mat, acc] of this.byMat) {
      if (!acc.len) continue;
      const p = acc.p.slice(0, acc.len * 3),
        n = acc.n.slice(0, acc.len * 3),
        u = acc.u.slice(0, acc.len * 2);
      transfer.push(p.buffer, n.buffer, u.buffer);
      meshes.push({ mat, p, n, u, bs: sphereOf(p) });
    }
    return {
      name: this.name,
      meshes,
      colliders: this.colliders,
      doors: this.doors.map((d) => ({ ...d, hinge: [d.hinge.x, d.hinge.y, d.hinge.z] })),
      lights: this.lights,
      loot: this.loot,
      pumps: this.pumps || [],
      fuelReserve: this.fuelReserve,
      carSpot: this.carSpot ? { x: this.carSpot.x, z: this.carSpot.z } : null,
      subs: this.subs.map((s) => ({ pivot: s.pivot, anim: s.anim, data: s.builder.serialize(transfer) })),
    };
  }

  // Rebuilds a builder from serialize() output (main thread).
  static fromData(d) {
    const b = new Builder(d.name);
    for (const m of d.meshes) {
      const acc = new VertexBuffer(0);
      acc.p = m.p;
      acc.n = m.n;
      acc.u = m.u;
      acc.len = m.p.length / 3;
      acc.cap = acc.len;
      acc.bs = m.bs;
      b.byMat.set(m.mat, acc);
    }
    b.colliders = d.colliders;
    b.doors = d.doors.map((x) => ({ ...x, hinge: V(...x.hinge) }));
    b.lights = d.lights;
    b.loot = d.loot;
    b.pumps = d.pumps;
    b.fuelReserve = d.fuelReserve;
    b.carSpot = d.carSpot;
    b.subs = d.subs.map((s) => ({ pivot: s.pivot, anim: s.anim, builder: Builder.fromData(s.data) }));
    return b;
  }
}

// Bounding sphere [x, y, z, r] of packed positions: box centre, farthest vertex.
function sphereOf(p) {
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i],
      y = p[i + 1],
      z = p[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    cz = (z0 + z1) / 2;
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - cx,
      dy = p[i + 1] - cy,
      dz = p[i + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  return [cx, cy, cz, Math.sqrt(r2)];
}
