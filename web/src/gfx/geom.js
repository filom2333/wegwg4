// Geometry construction helpers shared by all procedural models.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export { mergeGeometries, mergeVertices };

// Shapes a builder makes the same way every time (every car of a type, the same fitting): the
// first build makes them, later builds get the same geometries back, in the order they ask.
// `make` must hold everything done to the geometry, since later builds skip it.
const SHAPE_RUNS = new Map();
export function shapeRun(key) {
  let list = SHAPE_RUNS.get(key);
  if (!list) SHAPE_RUNS.set(key, (list = []));
  let i = 0;
  return (make) => {
    if (i === list.length) list.push(make());
    return list[i++];
  };
}

// Catmull-Rom resample of a 2D polyline (open) to a dense smooth list.
export function smoothPath2(points, perSeg = 6, closed = false) {
  const v = points.map((p) => new THREE.Vector2(p[0], p[1]));
  const curve = new THREE.SplineCurve(closed ? [...v, v[0]] : v);
  const n = Math.max(2, (points.length - 1) * perSeg);
  return curve.getPoints(n).map((p) => [p.x, p.y]);
}

/**
 * Lathe around the X axis. profile: [[r, x], ...] (radius, axial position).
 * Returns geometry with uv: u = angle/2PI, v = profile arc-length fraction.
 */
export function latheX(profile, segments = 48, phiStart = 0, phiLength = Math.PI * 2, { smooth = true } = {}) {
  const pts = profile.map((p) => new THREE.Vector2(p[0], p[1]));
  const g = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  // Lathe revolves around Y with (x=r, y=height). Map Y -> X axis.
  g.rotateZ(-Math.PI / 2);
  if (!smooth) {
    const ng = g.toNonIndexed();
    ng.computeVertexNormals();
    return ng;
  }
  return g;
}

// Lathe around Y axis (standard), points [[r, y], ...].
export function latheY(profile, segments = 48, phiStart = 0, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(
    profile.map((p) => new THREE.Vector2(Math.max(p[0], 0), p[1])),
    segments,
    phiStart,
    phiLength
  );
}

// Rounded box (beveled cuboid) centered at origin.
export function roundedBox(w, h, d, r = 0.01, seg = 3) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const g = new THREE.BoxGeometry(w, h, d, seg * 2 + 1, seg * 2 + 1, seg * 2 + 1);
  const a = g.attributes.position.array;
  const hw = w / 2 - r,
    hh = h / 2 - r,
    hd = d / 2 - r;
  for (let i = 0; i < a.length; i += 3) {
    const x = a[i],
      y = a[i + 1],
      z = a[i + 2];
    const cx = x < -hw ? -hw : x > hw ? hw : x,
      cy = y < -hh ? -hh : y > hh ? hh : y,
      cz = z < -hd ? -hd : z > hd ? hd : z;
    let dx = x - cx,
      dy = y - cy,
      dz = z - cz;
    const l2 = dx * dx + dy * dy + dz * dz;
    if (l2 > 1e-12) {
      const k = r / Math.sqrt(l2);
      dx *= k;
      dy *= k;
      dz *= k;
    }
    a[i] = cx + dx;
    a[i + 1] = cy + dy;
    a[i + 2] = cz + dz;
  }
  g.computeVertexNormals();
  return g;
}

// A soft cushion: a rounded block whose faces swell out by `puff`, its top pressed in by `sag`.
export function cushionBox(w, h, d, { r = 0.04, puff = 0.02, sag = 0, seg = 3 } = {}) {
  const g = roundedBox(w, h, d, r, seg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2),
      y = p.getY(i) / (h / 2),
      z = p.getZ(i) / (d / 2);
    const fx = Math.max(0, 1 - x * x),
      fy = Math.max(0, 1 - y * y),
      fz = Math.max(0, 1 - z * z);
    p.setXYZ(i, p.getX(i) + x * puff * 0.5 * fy * fz, p.getY(i) + y * puff * fx * fz - (y > 0 ? sag * fx * fz : 0), p.getZ(i) + z * puff * 0.5 * fx * fy);
  }
  g.computeVertexNormals();
  return g;
}

// Extrude a 2D shape (THREE.Shape) along +Z with bevel; centered on z.
export function extrudeShape(shape, depth, bevel = 0.003, curveSegments = 12, bevelSegments = 2) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2 + bevel);
  return g;
}

// Rounded rectangle 2D shape.
export function roundRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2,
    y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function shapeFromPoints(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/**
 * Loft through a sequence of closed cross-sections (arrays of Vector3, same count).
 * Optionally caps ends. Smooth normals.
 */
export function loftSections(sections, { capStart = false, capEnd = false, closed = true } = {}) {
  const ns = sections.length;
  const nv = sections[0].length;
  // Orient every ring counter-clockwise about the loft direction so side faces point outward.
  const ringNormal = (sec) => {
    const n = new THREE.Vector3();
    for (let j = 0; j < sec.length; j++) {
      const a = sec[j],
        b = sec[(j + 1) % sec.length];
      n.x += (a.y - b.y) * (a.z + b.z);
      n.y += (a.z - b.z) * (a.x + b.x);
      n.z += (a.x - b.x) * (a.y + b.y);
    }
    return n;
  };
  const centroid = (sec) => {
    const c = new THREE.Vector3();
    sec.forEach((p) => c.add(p));
    return c.multiplyScalar(1 / sec.length);
  };
  let k = 1;
  const c0 = centroid(sections[0]);
  let dir = centroid(sections[Math.min(ns - 1, 1)]).sub(c0);
  while (dir.lengthSq() < 1e-12 && k < ns - 1) dir = centroid(sections[++k]).sub(c0);
  // pick the ring with the clearest normal (the first may be degenerate, e.g. a pointed cap)
  let rn = ringNormal(sections[0]);
  for (let i = 1; i < ns && rn.lengthSq() < 1e-10; i++) rn = ringNormal(sections[i]);
  const reverse = closed && rn.dot(dir) < 0;
  const secs = reverse ? sections.map((sec) => [sec[0], ...sec.slice(1).reverse()]) : sections;
  const pos = [];
  const uv = [];
  for (let i = 0; i < ns; i++) {
    for (let j = 0; j < nv; j++) {
      const p = secs[i][j];
      pos.push(p.x, p.y, p.z);
      uv.push(j / (nv - (closed ? 0 : 1)), i / (ns - 1));
    }
  }
  const idx = [];
  const cols = closed ? nv : nv - 1;
  for (let i = 0; i < ns - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * nv + j,
        b = i * nv + ((j + 1) % nv),
        c = (i + 1) * nv + ((j + 1) % nv),
        d = (i + 1) * nv + j;
      idx.push(a, b, d, b, c, d);
    }
  }
  const addCap = (sec, isStart) => {
    const c = centroid(sec);
    const base = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    uv.push(0.5, 0.5);
    for (const p of sec) {
      pos.push(p.x, p.y, p.z);
      uv.push(0.5, 0.5);
    }
    for (let j = 0; j < sec.length; j++) {
      const a = base + 1 + j,
        b = base + 1 + ((j + 1) % sec.length);
      // rings run CCW about the loft direction: the start cap faces backwards
      if (isStart) idx.push(base, b, a);
      else idx.push(base, a, b);
    }
  };
  if (capStart) addCap(secs[0], true);
  if (capEnd) addCap(secs[ns - 1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Superellipse cross-section points in a local frame (center, right axis, up axis).
export function superSection(center, right, up, a, b, n = 2.5, count = 24, rot = 0) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const t = rot + (k / count) * Math.PI * 2;
    const c = Math.cos(t),
      s = Math.sin(t);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * a;
    const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * b;
    out.push(center.clone().addScaledVector(right, x).addScaledVector(up, y));
  }
  return out;
}

// Tube along a 3D polyline with circular (or custom radius fn) cross-section.
export function tubeAlong(points, radius = 0.01, radial = 8, { radiusFn = null, closedEnds = true } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
  const segs = Math.max(4, points.length * 6);
  const frames = curve.computeFrenetFrames(segs, false);
  const sections = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPointAt(t);
    const r = radiusFn ? radiusFn(t) : radius;
    const N = frames.normals[i],
      B = frames.binormals[i];
    const sec = [];
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      sec.push(p.clone().addScaledVector(N, Math.cos(a) * r).addScaledVector(B, Math.sin(a) * r));
    }
    sections.push(sec);
  }
  return loftSections(sections, { capStart: closedEnds, capEnd: closedEnds });
}

// Apply a transform to a geometry (returns same geometry).
export function xform(g, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale)
  );
  g.applyMatrix4(m);
  return g;
}

// Merge geometries, dropping attributes not shared by all; tags material groups.
export function mergeWithGroups(list) {
  // list: [{ geo, mat }] -> geometry with groups; returns { geometry, materials }
  const mats = [];
  const geos = [];
  for (const { geo, mat } of list) {
    let idx = mats.indexOf(mat);
    if (idx < 0) {
      idx = mats.length;
      mats.push(mat);
    }
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.userData.matIndex = idx;
    geos.push(g);
  }
  // sort by material for fewer groups
  geos.sort((a, b) => a.userData.matIndex - b.userData.matIndex);
  const merged = mergeGeometries(geos, true);
  // groups from mergeGeometries are per input; remap material indices
  merged.groups.forEach((gr, i) => (gr.materialIndex = geos[i].userData.matIndex));
  // collapse consecutive groups with same material
  const groups = [];
  for (const gr of merged.groups) {
    const last = groups[groups.length - 1];
    if (last && last.materialIndex === gr.materialIndex && last.start + last.count === gr.start) last.count += gr.count;
    else groups.push({ ...gr });
  }
  merged.clearGroups();
  groups.forEach((gr) => merged.addGroup(gr.start, gr.count, gr.materialIndex));
  return { geometry: merged, materials: mats };
}

// Builds a mesh from a list of { geo, mat } entries.
export function meshFromParts(list, { castShadow = true, receiveShadow = true } = {}) {
  const { geometry, materials } = mergeWithGroups(list);
  geometry.computeBoundingSphere();
  const m = new THREE.Mesh(geometry, materials);
  m.castShadow = castShadow;
  m.receiveShadow = receiveShadow;
  return m;
}

// Closed Catmull-Rom resampling of a 2D polygon (points [[a,b],...]) into n points.
export function smoothClosed2(points, n = 32, tension = 0.5) {
  const v = points.map((p) => new THREE.Vector3(p[0], p[1], 0));
  const curve = new THREE.CatmullRomCurve3(v, true, 'catmullrom', tension);
  return curve.getSpacedPoints(n).slice(0, n).map((p) => [p.x, p.y]);
}

// Open Catmull-Rom resampling of a 3D polyline.
export function smoothOpen3(points, n = 24) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), false, 'centripetal');
  return curve.getSpacedPoints(n);
}

// Loft a 2D profile (in a local plane spanned by axes U, V) along a list of origins.
// profileFn(i) -> [[u,v],...] closed; origins[i] Vector3; axes { u: Vector3, v: Vector3 }
export function loftProfiles(origins, profileFn, axes, opts = {}) {
  const sections = origins.map((o, i) =>
    profileFn(i).map(([a, b]) => o.clone().addScaledVector(axes.u, a).addScaledVector(axes.v, b))
  );
  return loftSections(sections, { capStart: true, capEnd: true, ...opts });
}
