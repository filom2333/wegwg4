// Geometry builder for architecture: boxes with continuous metre UVs, walls with openings,
// windows, doors, floors, roofs. Collects colliders, interactive doors, lights and loot spots.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

export class Builder {
  constructor(name = 'building') {
    this.name = name;
    this.byMat = new Map();
    this.colliders = []; // { c:[x,y,z], h:[hx,hy,hz], rotY, surface }
    this.doors = []; // interactive door leaves
    this.lights = []; // { pos, color, intensity, distance }
    this.loot = []; // { pos, kind, room }
    this.extra = []; // ready-made Object3D (e.g. instanced furniture)
    this.sensors = [];
  }

  add(geo, mat) {
    if (!this.byMat.has(mat)) this.byMat.set(mat, []);
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    this.byMat.get(mat).push(g);
    return g;
  }

  collider(cx, cy, cz, sx, sy, sz, rotY = 0, surface = 'wood', rotX = 0) {
    this.colliders.push({ c: [cx, cy, cz], h: [sx / 2, sy / 2, sz / 2], rotY, rotX, surface });
  }

  box(cx, cy, cz, sx, sy, sz, mat, { collide = true, rotY = 0, surface = 'wood', uvScale = 1 } = {}) {
    this.add(uvBox(cx, cy, cz, sx, sy, sz, rotY, { uvScale }), mat);
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
        const g = new THREE.BoxGeometry(len, hh, half);
        // metre uvs along the wall
        const pos = g.attributes.position,
          nr = g.attributes.normal,
          uv = g.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
          const lx = pos.getX(i),
            ly = pos.getY(i),
            lz = pos.getZ(i);
          const along = cs + lx;
          const ax = Math.abs(nr.getX(i)),
            ay = Math.abs(nr.getY(i));
          if (ay > 0.5) uv.setXY(i, along, lz);
          else if (ax > 0.5) uv.setXY(i, lz, y + y0 + hh / 2 + ly);
          else uv.setXY(i, along * (nr.getZ(i) > 0 ? 1 : -1), y + y0 + hh / 2 + ly);
        }
        g.rotateY(rot);
        g.translate(gx, cy, gz);
        this.add(g, mats[k]);
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
    const put = (lx, ly, sx, sy, sz, mat, lz = 0) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      g.translate(lx, ly, lz);
      g.rotateY(rot);
      g.translate(cx, cy, cz);
      this.add(g, mat);
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
    const put = (lx, ly, sx, sy, sz, mat) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      g.translate(lx, ly, 0);
      g.rotateY(rot);
      g.translate(cx, y, cz);
      this.add(g, mat);
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
      this.add(slab, mat);
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
        const shape = new THREE.Shape();
        shape.moveTo(-span / 2, 0);
        shape.lineTo(span / 2, 0);
        shape.lineTo(0, rise);
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

  // Merge into meshes (one per material).
  build() {
    const group = new THREE.Group();
    group.name = this.name;
    for (const [mat, list] of this.byMat) {
      const g = mergeGeometries(list, false);
      if (!g) continue;
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = !mat.transparent;
      m.receiveShadow = true;
      group.add(m);
    }
    for (const o of this.extra) group.add(o);
    return group;
  }
}
