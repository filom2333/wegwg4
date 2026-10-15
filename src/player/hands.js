// First-person hands: anatomically proportioned hand + forearm + jacket sleeve, built for a set
// of poses (relaxed, grip, pistol, carry, pinch). Finger joints are posed with forward kinematics
// and skinned as smooth tapered tubes so knuckles bend without breaking the surface.

import * as THREE from 'three';
import { loftSections, superSection } from '../gfx/geom.js';
import { addSurfaceDetail } from '../gfx/triplanar.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Hand frame (right hand, palm facing -X / left, fingers along -Z / forward, back of hand +Y).
// Finger base points on the knuckle line and segment lengths (metres).
const FINGERS = {
  index: { base: V(0.027, 0.002, -0.088), len: [0.037, 0.022, 0.018], r: 0.0088, splay: 0.07 },
  middle: { base: V(0.008, 0.003, -0.092), len: [0.041, 0.025, 0.019], r: 0.0091, splay: 0.0 },
  ring: { base: V(-0.011, 0.002, -0.088), len: [0.038, 0.024, 0.018], r: 0.0085, splay: -0.05 },
  pinky: { base: V(-0.029, -0.002, -0.079), len: [0.03, 0.018, 0.016], r: 0.0074, splay: -0.12 },
};
const THUMB = { base: V(0.036, -0.011, -0.028), len: [0.034, 0.028, 0.024], r: 0.0102 };

// Pose = curl angles per finger joint [mcp, pip, dip] (radians), thumb [cmc yaw, mcp, ip], wrist tilt.
export const POSES = {
  relax: { fingers: { index: [0.25, 0.35, 0.25], middle: [0.3, 0.45, 0.3], ring: [0.35, 0.5, 0.3], pinky: [0.4, 0.55, 0.3] }, thumb: [0.6, 0.15, 0.2] },
  grip: { fingers: { index: [0.95, 1.3, 0.7], middle: [1.0, 1.35, 0.7], ring: [1.05, 1.35, 0.7], pinky: [1.1, 1.3, 0.7] }, thumb: [1.0, 0.45, 0.35] },
  pistol: { fingers: { index: [0.5, 0.75, 0.25], middle: [1.15, 1.45, 0.8], ring: [1.2, 1.45, 0.8], pinky: [1.25, 1.4, 0.8] }, thumb: [0.85, 0.25, 0.15] },
  carry: { fingers: { index: [0.55, 0.65, 0.35], middle: [0.6, 0.7, 0.35], ring: [0.62, 0.7, 0.35], pinky: [0.65, 0.7, 0.35] }, thumb: [0.4, 0.1, 0.1] },
  pinch: { fingers: { index: [0.7, 0.9, 0.5], middle: [0.85, 1.1, 0.6], ring: [1.05, 1.3, 0.7], pinky: [1.15, 1.3, 0.7] }, thumb: [1.15, 0.35, 0.3] },
};

function fingerPoints(f, curl) {
  const pts = [];
  // start a little inside the palm so the root blends with the palm surface
  const dir = V(Math.sin(f.splay) * 0.2, 0, -1).normalize();
  const up = V(0, 1, 0);
  let p = f.base.clone().addScaledVector(dir, -0.012);
  pts.push(p.clone());
  p = f.base.clone();
  pts.push(p.clone());
  let d = dir.clone();
  const side = d.clone().cross(up).normalize();
  for (let j = 0; j < 3; j++) {
    d.applyAxisAngle(side, -curl[j]); // curl toward the palm (-Y)
    p = p.clone().addScaledVector(d, f.len[j]);
    pts.push(p.clone());
  }
  return { pts, tipDir: d };
}

function tubeFromJoints(pts, r0, r1, radial = 12) {
  // smooth path through joints, tapered radius, rounded tip
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const N = 26;
  const frames = curve.computeFrenetFrames(N, false);
  const secs = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const c = curve.getPointAt(t);
    const tipT = Math.max(0, (t - 0.86) / 0.14);
    let r = r0 + (r1 - r0) * t;
    r *= Math.sqrt(Math.max(0.02, 1 - tipT * tipT));
    // knuckle bulges
    const kn = Math.exp(-Math.pow((t - 0.12) / 0.06, 2)) * 0.15 + Math.exp(-Math.pow((t - 0.55) / 0.05, 2)) * 0.08;
    r *= 1 + kn;
    // slightly flattened section (fingers are wider than deep)
    secs.push(superSection(c, frames.binormals[i], frames.normals[i], r * 1.08, r * 0.92, 2.2, radial));
  }
  return loftSections(secs, { capStart: true, capEnd: true });
}

function nail(f, curlPts, tipDir) {
  const tip = curlPts[curlPts.length - 1];
  const prev = curlPts[curlPts.length - 2];
  const along = tip.clone().sub(prev).normalize();
  const side = along.clone().cross(V(0, 1, 0)).normalize();
  const up = side.clone().cross(along).normalize();
  const c = tip.clone().addScaledVector(along, -0.0085).addScaledVector(up, f.r * 0.72);
  const g = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.4);
  g.scale(f.r * 0.72, 0.0016, 0.0075);
  const m = new THREE.Matrix4().makeBasis(side, up, along.clone().negate()).setPosition(c);
  g.applyMatrix4(m);
  void tipDir;
  return g;
}

// Palm: one smooth loft from the wrist to a rounded knuckle front the fingers grow out of.
function palm() {
  const rows = [
    // z, half-width, half-height, centre x, centre y
    [0.05, 0.0235, 0.0155, 0.0, -0.002],
    [0.03, 0.029, 0.0175, 0.001, -0.002],
    [0.005, 0.036, 0.0185, 0.003, -0.003],
    [-0.025, 0.042, 0.018, 0.003, -0.003],
    [-0.055, 0.044, 0.0162, 0.001, -0.002],
    [-0.075, 0.0445, 0.0135, 0.0, -0.001],
    [-0.087, 0.043, 0.0106, -0.001, 0.0],
    [-0.094, 0.038, 0.0078, -0.001, 0.0006],
    [-0.0985, 0.03, 0.0045, -0.001, 0.0009],
  ];
  const secs = rows.map(([z, w, h, cx, cy]) => {
    const ring = superSection(V(cx, cy, z), V(1, 0, 0), V(0, 1, 0), w, h, 2.6, 28);
    // thenar pad: thicken the palm side toward the thumb, flatten the back
    for (const p of ring) {
      const lx = (p.x - cx) / w,
        ly = (p.y - cy) / h;
      if (ly < 0) p.y -= 0.004 * Math.max(0, lx) * (-ly) * (z > -0.06 ? 1 : 0.3);
      if (ly > 0.6) p.y -= 0.0015 * (ly - 0.6);
    }
    return ring;
  });
  return loftSections(secs, { capStart: true, capEnd: true });
}

function forearm() {
  const secs = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const z = 0.035 + t * 0.32;
    const w = 0.024 + 0.013 * Math.pow(t, 0.8);
    const h = 0.0165 + 0.012 * Math.pow(t, 0.8);
    secs.push(superSection(V(0, -0.002, z), V(1, 0, 0), V(0, 1, 0), w, h, 2.2, 22));
  }
  return loftSections(secs, { capStart: true, capEnd: true });
}

function sleeve() {
  const secs = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const z = 0.13 + t * 0.32;
    const r = 0.042 + 0.012 * t;
    const c = V(0, -0.002, z);
    const g = superSection(c, V(1, 0, 0), V(0, 1, 0), r, r * 0.86, 2.0, 26);
    // soft fabric folds
    g.forEach((p, k) => p.addScaledVector(p.clone().sub(c).normalize(), 0.0025 * Math.sin(k * 1.3 + i * 2.1) * Math.sin(t * Math.PI + 0.3)));
    secs.push(g);
  }
  // rolled cuff
  const cuff = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const z = 0.115 + t * 0.03;
    const r = 0.044 + 0.004 * Math.sin(t * Math.PI);
    cuff.push(superSection(V(0, -0.002, z), V(1, 0, 0), V(0, 1, 0), r, r * 0.86, 2.0, 26));
  }
  return [loftSections(secs, { capStart: true, capEnd: true }), loftSections(cuff, { capStart: true, capEnd: true })];
}

let SKIN = null;
function materials() {
  if (SKIN) return SKIN;
  SKIN = {
    skin: addSurfaceDetail(
      new THREE.MeshPhysicalMaterial({ color: 0xb98466, roughness: 0.62, sheen: 0.3, sheenColor: new THREE.Color(0xb0503c), sheenRoughness: 0.6 }),
      'grain',
      0.5
    ),
    nail: new THREE.MeshPhysicalMaterial({ color: 0xd4a08c, roughness: 0.25, clearcoat: 0.4 }),
    sleeve: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 0.95 }), 'weave', 0.5),
    cuff: new THREE.MeshStandardMaterial({ color: 0x3a3529, roughness: 0.9 }),
  };
  return SKIN;
}

export function buildHand(poseName, mirror = false) {
  const pose = POSES[poseName] || POSES.relax;
  const M = materials();
  const g = new THREE.Group();
  const skin = [palm(), forearm()];
  const nails = [];
  for (const [name, f] of Object.entries(FINGERS)) {
    const { pts, tipDir } = fingerPoints(f, pose.fingers[name]);
    skin.push(tubeFromJoints(pts, f.r * 1.05, f.r * 0.82));
    nails.push(nail(f, pts, tipDir));
  }
  // thumb: rotates out of the palm plane
  {
    const [yaw, j1, j2] = pose.thumb;
    const dir = V(0.75, -0.35, -0.55).normalize().applyAxisAngle(V(0, 0, 1), -yaw * 0.6).applyAxisAngle(V(0, 1, 0), yaw * 0.45);
    const pts = [THUMB.base.clone().add(V(-0.012, 0.004, 0.02)), THUMB.base.clone()];
    let p = THUMB.base.clone(),
      d = dir.clone();
    const axis = d.clone().cross(V(0, 1, 0)).normalize();
    for (let j = 0; j < 3; j++) {
      if (j > 0) d.applyAxisAngle(axis, -(j === 1 ? j1 : j2) * 1.1);
      p = p.clone().addScaledVector(d, THUMB.len[j]);
      pts.push(p.clone());
    }
    skin.push(tubeFromJoints(pts, THUMB.r * 1.25, THUMB.r * 0.9));
    nails.push(nail(THUMB, pts, d));
  }
  const mergeMesh = (list, mat) => {
    const geos = list.map((x) => {
      const y = x.index ? x.toNonIndexed() : x;
      for (const k of Object.keys(y.attributes)) if (!['position', 'normal'].includes(k)) y.deleteAttribute(k);
      return y;
    });
    let count = 0;
    for (const x of geos) count += x.attributes.position.count;
    const pos = new Float32Array(count * 3),
      nrm = new Float32Array(count * 3);
    let o = 0;
    for (const x of geos) {
      if (!x.attributes.normal) x.computeVertexNormals();
      pos.set(x.attributes.position.array, o * 3);
      nrm.set(x.attributes.normal.array, o * 3);
      o += x.attributes.position.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    if (mirror) {
      geo.scale(-1, 1, 1);
      const n = geo.attributes.normal.array;
      for (let i = 0; i < n.length; i += 3) n[i] = -n[i];
      const p = geo.attributes.position.array;
      for (let i = 0; i < p.length; i += 9)
        for (let k = 0; k < 3; k++) {
          const t = p[i + 3 + k];
          p[i + 3 + k] = p[i + 6 + k];
          p[i + 6 + k] = t;
          const u = n[i + 3 + k];
          n[i + 3 + k] = n[i + 6 + k];
          n[i + 6 + k] = u;
        }
    }
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    m.receiveShadow = true;
    return m;
  };
  g.add(mergeMesh(skin, M.skin));
  g.add(mergeMesh(nails, M.nail));
  g.add(mergeMesh(sleeve(), M.sleeve));
  return g;
}

// Hand rig with cached poses; positions itself in camera space.
export class Hands {
  constructor(camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    this.poses = {};
    this.right = new THREE.Group();
    this.left = new THREE.Group();
    this.root.add(this.right, this.left);
    this.cur = { right: null, left: null };
    this.setPose('right', 'relax');
    this.setPose('left', 'carry');
    this.left.visible = false;
    this.bob = 0;
  }

  meshFor(pose, mirror) {
    const key = pose + (mirror ? 'L' : 'R');
    if (!this.poses[key]) this.poses[key] = buildHand(pose, mirror);
    return this.poses[key];
  }

  setPose(side, pose) {
    if (this.cur[side] === pose) return;
    const grp = side === 'right' ? this.right : this.left;
    grp.clear();
    // the base model is a left hand (thumb on +X with the back of the hand up); mirror it for the right
    grp.add(this.meshFor(pose, side === 'right'));
    this.cur[side] = pose;
  }
}
