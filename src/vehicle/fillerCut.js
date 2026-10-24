// A fuel filler set into the body, not laid on it: the body's paint mesh gets an opening the shape
// of the flap (its triangles split finer only along the outline, so the opening follows the flap
// however coarse the source mesh is), and behind it a pocket: walls and a floor in black, a rubber
// lip round the edge, the neck with its steel ring and the screw cap. The flap has thickness, sits
// flush with the paint and swings out on a little gooseneck hinge.
//
// The cut works on a copy of the body's geometry (the source's is shared by every car of the type).

import * as THREE from 'three';
import { tubeAlong } from '../gfx/geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Points round a rounded rectangle (centred, w x h, corner radius r), counter-clockwise.
function outline(w, h, r, per = 6) {
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= per; i++) {
      const a = a0 + (i / per) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  };
  corner(w / 2 - r, -h / 2 + r, -Math.PI / 2);
  corner(w / 2 - r, h / 2 - r, 0);
  corner(-w / 2 + r, h / 2 - r, Math.PI / 2);
  corner(-w / 2 + r, -h / 2 + r, Math.PI);
  return pts;
}

function shapeOf(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

// Is (u, v) inside the rounded rectangle?
function inside(u, v, w, h, r) {
  const ax = Math.abs(u) - (w / 2 - r),
    ay = Math.abs(v) - (h / 2 - r);
  if (ax <= 0 && Math.abs(v) <= h / 2) return true;
  if (ay <= 0 && Math.abs(u) <= w / 2) return true;
  return ax > 0 && ay > 0 && ax * ax + ay * ay <= r * r;
}

// Cut the opening into a copy of `geometry` (car space). frame: { p, x, y, n } of the filler.
export function cutOpening(geometry, frame, w, h, r) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const names = Object.keys(src.attributes);
  const attrs = names.map((k) => src.attributes[k]);
  const out = names.map(() => []);
  const P = frame.p,
    X = frame.x,
    Y = frame.y,
    N = frame.n;
  const tmp = V(0, 0, 0);
  // a corner of a triangle: every attribute's values, and where it is on the filler's plane
  const vert = (i) => {
    const vals = attrs.map((a) => {
      const o = [];
      for (let k = 0; k < a.itemSize; k++) o.push(a.array[i * a.itemSize + k]);
      return o;
    });
    const pos = vals[names.indexOf('position')];
    tmp.set(pos[0], pos[1], pos[2]).sub(P);
    return { vals, u: tmp.dot(X), v: tmp.dot(Y), d: tmp.dot(N), p: V(pos[0], pos[1], pos[2]) };
  };
  const mid = (a, b) => {
    const vals = a.vals.map((av, j) => av.map((x, k) => (x + b.vals[j][k]) / 2));
    return { vals, u: (a.u + b.u) / 2, v: (a.v + b.v) / 2, d: (a.d + b.d) / 2, p: a.p.clone().add(b.p).multiplyScalar(0.5) };
  };
  const emit = (t) => {
    for (const c of t) c.vals.forEach((vv, j) => out[j].push(...vv));
  };
  const reach = Math.max(w, h) / 2 + 0.01;
  const proc = (t, depth) => {
    const us = t.map((c) => c.u),
      vs = t.map((c) => c.v);
    // nowhere near the opening, or not on this side of the body: as it is
    if (Math.min(...us) > reach || Math.max(...us) < -reach || Math.min(...vs) > reach || Math.max(...vs) < -reach || Math.min(...t.map((c) => Math.abs(c.d))) > 0.05) return emit(t);
    const ins = t.map((c) => inside(c.u, c.v, w, h, r));
    if (ins[0] && ins[1] && ins[2]) return; // wholly in the opening (it is convex): gone
    const e = Math.max(t[0].p.distanceTo(t[1].p), t[1].p.distanceTo(t[2].p), t[2].p.distanceTo(t[0].p));
    if (e < 0.004 || depth > 9) {
      const c = { u: (t[0].u + t[1].u + t[2].u) / 3, v: (t[0].v + t[1].v + t[2].v) / 3 };
      if (!inside(c.u, c.v, w, h, r)) emit(t);
      return;
    }
    const [a, b, c] = t;
    const ab = mid(a, b),
      bc = mid(b, c),
      ca = mid(c, a);
    proc([a, ab, ca], depth + 1);
    proc([ab, b, bc], depth + 1);
    proc([ca, bc, c], depth + 1);
    proc([ab, bc, ca], depth + 1);
  };
  const n = src.attributes.position.count;
  for (let i = 0; i < n; i += 3) proc([vert(i), vert(i + 1), vert(i + 2)], 0);
  const g = new THREE.BufferGeometry();
  names.forEach((k, j) => g.setAttribute(k, new THREE.Float32BufferAttribute(out[j], attrs[j].itemSize, attrs[j].normalized)));
  for (const grp of src.groups || []) g.addGroup(grp.start, grp.count, grp.materialIndex);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// The pocket, the neck and cap, and the flap on its hinge, in the filler's own frame (+z out of
// the body). side: +1 when the hinge is at +x. Returns the parts the car moves.
export function buildFiller(w, h, r, side, paint) {
  const g = new THREE.Group();
  const depth = 0.045;
  const black = new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: 0.6, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9a9da0, metalness: 0.85, roughness: 0.35 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x151516, roughness: 0.45 });
  // walls: the outline at the paint and again at the floor, a little smaller (a drawn pocket)
  const top = outline(w - 0.004, h - 0.004, Math.max(0.003, r - 0.002));
  const bot = outline(w - 0.016, h - 0.016, Math.max(0.003, r - 0.008));
  const pos = [];
  for (let i = 0; i < top.length; i++) {
    const j = (i + 1) % top.length;
    const a = [top[i].x, top[i].y, 0.0],
      b = [top[j].x, top[j].y, 0.0],
      c = [bot[j].x, bot[j].y, -depth],
      d = [bot[i].x, bot[i].y, -depth];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  walls.computeVertexNormals();
  g.add(new THREE.Mesh(walls, black));
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(w - 0.016, h - 0.016, Math.max(0.003, r - 0.008)), 6), black);
  floor.position.z = -depth;
  g.add(floor);
  // the rubber lip round the opening (it also hides the cut's edge)
  const lipPts = outline(w - 0.002, h - 0.002, Math.max(0.003, r - 0.001), 8).map((p) => V(p.x, p.y, -0.001));
  lipPts.push(lipPts[0].clone());
  g.add(new THREE.Mesh(tubeAlong(lipPts, 0.0022, 6), rubber));
  // the neck: a steel ring on the floor, the dark mouth, and the cap screwed in
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.004, 8, 32), steel);
  ring.position.z = -depth + 0.006;
  g.add(ring);
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.026, 24), new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.9 }));
  mouth.position.z = -depth + 0.004;
  g.add(mouth);
  const cap = new THREE.Group();
  cap.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.031, 0.014, 32).rotateX(Math.PI / 2), capMat));
  cap.add(new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.01, 0.012).translate(0, 0, 0.011), capMat));
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    cap.add(new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.012).translate(Math.cos(a) * 0.031, Math.sin(a) * 0.031, 0), capMat));
  }
  cap.position.z = -depth + 0.012;
  g.add(cap);
  // the flap: a painted panel with thickness, flush with the paint, on a gooseneck from the
  // pocket's hinge side
  const hinge = new THREE.Group();
  hinge.position.set((side * (w - 0.012)) / 2, 0, -0.012);
  const fw = w - 0.005,
    fh = h - 0.005;
  const flapGeo = new THREE.ExtrudeGeometry(shapeOf(fw, fh, Math.max(0.002, r - 0.0025)), { depth: 0.0018, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0008, bevelSegments: 2, curveSegments: 8 });
  // (the flap's outer face at the paint, measured from the hinge)
  flapGeo.translate((-side * (w - 0.012)) / 2, 0, 0.012 - 0.0024);
  const flap = new THREE.Mesh(flapGeo, paint);
  flap.castShadow = true;
  hinge.add(flap);
  const arm = tubeAlong([V(0, 0, 0), V(-side * 0.008, 0, 0.004), V(-side * 0.016, 0, 0.009), V(-side * 0.026, 0, 0.0095)], 0.0022, 6);
  hinge.add(new THREE.Mesh(arm, steel));
  g.add(hinge);
  return { group: g, hinge, cap, mouth, inside: [] };
}
