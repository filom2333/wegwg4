// First-person hands: anatomically proportioned hand + forearm + jacket sleeve, built for a set
// of poses (relaxed, grip, pistol, carry, pinch). Finger joints are posed with forward kinematics
// and skinned as smooth tapered tubes so knuckles bend without breaking the surface.

import * as THREE from 'three';
import { loftSections, superSection } from '../gfx/geom.js';
import { addSurfaceDetail } from '../gfx/triplanar.js';
import { POSES, FINGERS, THUMB, fingerPoints, wrapFingerPoints, wrapThumbPoints, handArrays, WRIST, gripCenter, PALM_CONTACT } from './handShape.js';
export { POSES, WRIST, gripCenter, PALM_CONTACT };

// Arm segment lengths (wrist to elbow, elbow to shoulder) and the wrist's range of motion.
export const FOREARM = 0.255;
export const UPPER = 0.29;
// The wrist bends back a long way (a palm laid flat on something), forward less and hardly at all
// to the sides; past that the forearm follows the hand instead (an elbow out of place is off
// screen, a wrist bent too far is in the middle of it). Radians, in the hand's frame.
const WRIST_BACK = 1.1,
  WRIST_FWD = 0.75,
  WRIST_SIDE = 0.35;

const V = (x, y, z) => new THREE.Vector3(x, y, z);

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

function nail(f, curlPts) {
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

// Forearm skin in the arm frame (origin at the wrist joint, +Z toward the elbow), coloured like
// the sculpted hand's skin so the two read as one surface.
const SKIN_RGB = [0.74, 0.53, 0.42];
function forearm() {
  const secs = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const z = -0.014 + t * 0.2;
    const k = Math.pow(t, 0.75);
    secs.push(superSection(V(0, 0, z), V(1, 0, 0), V(0, 1, 0), 0.0238 + 0.0115 * k, 0.0158 + 0.0092 * k, 2.2, 22));
  }
  const g = loftSections(secs, { capStart: true, capEnd: true });
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  // same colour space as the sculpted hand's vertex colours (authored in sRGB)
  const lin = new THREE.Color().setRGB(SKIN_RGB[0], SKIN_RGB[1], SKIN_RGB[2], THREE.SRGBColorSpace);
  const p = g.attributes.position;
  for (let i = 0; i < n; i++) {
    // a little redder over the wrist, paler on the inside of the forearm
    const z = p.getZ(i),
      y = p.getY(i);
    const k = 1 + 0.04 * Math.sin(z * 90) * 0.5 - (y < 0 ? 0.05 : 0);
    c[i * 3] = lin.r * k;
    c[i * 3 + 1] = lin.g * (k - 0.02);
    c[i * 3 + 2] = lin.b * (k - 0.03);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

// Turned-back jacket cuff at the wrist (arm frame); the sleeve itself is laid along the solved arm
// each frame (below).
function cuff() {
  const secs = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const z = 0.034 + t * 0.026;
    const r = 0.0395 + 0.0035 * Math.sin(t * Math.PI);
    secs.push(superSection(V(0, 0.002, z), V(1, 0, 0), V(0, 1, 0), r, r * 0.88, 2.0, 28));
  }
  return loftSections(secs, { capStart: true, capEnd: true });
}

// Jacket sleeve: one tube from inside the cuff, round the elbow and on past the shoulder, rebuilt
// along the arm every frame. (Jointed pieces, a forearm sleeve, an elbow ball and an upper sleeve,
// showed the joints as kinks and the arm read as bent wherever it was.)
// Sections along the forearm, round the elbow and along the upper arm; around the tube.
const SLEEVE_SEGS = [7, 8, 9];
const SLEEVE_N = SLEEVE_SEGS[0] + SLEEVE_SEGS[1] + SLEEVE_SEGS[2];
const SLEEVE_R = 20;
// the bend starts this far before the elbow and ends as far after it
const ELBOW_R = 0.055;

function sleeveGeometry() {
  const ring = SLEEVE_R + 1;
  const n = (SLEEVE_N + 1) * ring + 1;
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal']) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i < SLEEVE_N; i++)
    for (let k = 0; k < SLEEVE_R; k++) {
      const a = i * ring + k,
        b = a + ring;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  // closed at the shoulder end
  const L = SLEEVE_N * ring;
  for (let k = 0; k < SLEEVE_R; k++) idx.push(L + k, L + k + 1, n - 1);
  g.setIndex(idx);
  return g;
}

// Lays the sleeve (hand-frame space) from the wrist `W` down the forearm `f` to the elbow `E`, round
// it and up the upper arm `du` to the shoulder `S` and a little past; `side` is the forearm's
// sideways axis (the cuff's wide side).
function laySleeve(geo, W, f, E, du, S, side) {
  const P = geo.attributes.position.array,
    Nm = geo.attributes.normal.array;
  const [nA, nB, nC] = SLEEVE_SEGS;
  const e0 = _s0.copy(E).addScaledVector(f, -ELBOW_R);
  const e1 = _s1.copy(E).addScaledVector(du, ELBOW_R);
  const end = _s2.copy(S).addScaledVector(du, 0.12);
  const c = _s3,
    T = _s4,
    N = _s5.copy(side),
    B = _s6;
  const ring = SLEEVE_R + 1;
  let o = 0;
  for (let i = 0; i <= SLEEVE_N; i++) {
    let r, bunch;
    if (i <= nA) {
      // forearm: from inside the cuff, widening toward the elbow
      const t = i / nA;
      c.copy(W).addScaledVector(f, 0.05).lerp(e0, t);
      T.copy(f);
      r = 0.0385 + 0.0095 * t;
      bunch = t * t;
    } else if (i <= nA + nB) {
      // round the elbow (a quadratic curve: it leaves the forearm and meets the upper arm tangent)
      const t = (i - nA) / nB;
      const a = (1 - t) * (1 - t),
        b = 2 * (1 - t) * t,
        d = t * t;
      c.set(e0.x * a + E.x * b + e1.x * d, e0.y * a + E.y * b + e1.y * d, e0.z * a + E.z * b + e1.z * d);
      const tx = (1 - t) * (E.x - e0.x) + t * (e1.x - E.x),
        ty = (1 - t) * (E.y - e0.y) + t * (e1.y - E.y),
        tz = (1 - t) * (E.z - e0.z) + t * (e1.z - E.z);
      // (folded right back the curve stops: keep the last direction)
      if (tx * tx + ty * ty + tz * tz > 1e-8) T.set(tx, ty, tz).normalize();
      r = 0.048 + 0.0035 * Math.sin(t * Math.PI) + 0.0015 * t;
      bunch = 1;
    } else {
      // upper arm, filling out toward the shoulder
      const t = (i - nA - nB) / nC;
      c.copy(e1).lerp(end, t);
      T.copy(du);
      r = 0.05 + 0.01 * Math.min(1, t * 2.2);
      bunch = Math.max(0, 1 - t * 3);
    }
    // carry the cross-section's orientation along the tube without twisting it
    N.addScaledVector(T, -N.dot(T));
    if (N.lengthSq() < 1e-8) {
      N.set(Math.abs(T.y) > 0.9 ? 1 : 0, Math.abs(T.y) > 0.9 ? 0 : 1, 0);
      N.addScaledVector(T, -N.dot(T));
    }
    N.normalize();
    B.crossVectors(T, N);
    // cloth folds round the tube, bunched up toward the elbow; the cuff end stays plain
    const amp = (0.012 + 0.05 * bunch) * Math.min(1, i / 2);
    const ph1 = i * 2.1,
      ph2 = i * 1.3 + 0.7;
    r *= 1 + 0.03 * bunch * Math.sin(i * 2.4) ** 2;
    for (let k = 0; k <= SLEEVE_R; k++) {
      const th = (k / SLEEVE_R) * Math.PI * 2;
      const cs = Math.cos(th),
        sn = Math.sin(th);
      const fold = amp * (0.6 * Math.sin(3 * th + ph1) + 0.4 * Math.sin(5 * th + ph2));
      const dfold = amp * (1.8 * Math.cos(3 * th + ph1) + 2.0 * Math.cos(5 * th + ph2));
      const rx = r * (1 + fold),
        ry = rx * 0.9;
      P[o] = c.x + N.x * cs * rx + B.x * sn * ry;
      P[o + 1] = c.y + N.y * cs * rx + B.y * sn * ry;
      P[o + 2] = c.z + N.z * cs * rx + B.z * sn * ry;
      // outward normal of the folded, flattened section (the section's tangent turned a quarter)
      const nx = 0.9 * ((1 + fold) * cs + dfold * sn),
        ny = (1 + fold) * sn - dfold * cs;
      const ex = N.x * nx + B.x * ny,
        ey = N.y * nx + B.y * ny,
        ez = N.z * nx + B.z * ny;
      const il = 1 / Math.hypot(ex, ey, ez);
      Nm[o] = ex * il;
      Nm[o + 1] = ey * il;
      Nm[o + 2] = ez * il;
      o += 3;
    }
  }
  // the shoulder end's cap
  P[o] = end.x + du.x * 0.03;
  P[o + 1] = end.y + du.y * 0.03;
  P[o + 2] = end.z + du.z * 0.03;
  Nm[o] = du.x;
  Nm[o + 1] = du.y;
  Nm[o + 2] = du.z;
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
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

// ------------------------------------------------------------------ SDF hand
// Sculpted geometry per pose arrives from the character worker (handShape.js); until then the
// lofted fallback hand is shown.
const handGeos = new Map();
const handListeners = new Set();

export function registerHandArrays(pose, a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(a.C, 3));
  g.setIndex(new THREE.BufferAttribute(a.I, 1));
  g.computeBoundingSphere();
  handGeos.set(pose, g);
  for (const f of handListeners) f(pose);
}

export function buildHandGeometry(pose) {
  if (!handGeos.has(pose)) registerHandArrays(pose, handArrays(pose));
  return handGeos.get(pose);
}

export const HAND_POSES = Object.keys(POSES);

// Mirror across X (left hand -> right hand) keeping triangles front-facing.
function mirrorGeometry(src) {
  let geo = src.clone();
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.scale(-1, 1, 1); // also mirrors the normals (normal matrix)
  if (geo.index) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
  } else {
    for (const a of Object.values(geo.attributes)) {
      const arr = a.array,
        k = a.itemSize;
      for (let i = 0; i < arr.length; i += 3 * k)
        for (let c = 0; c < k; c++) {
          const t = arr[i + k + c];
          arr[i + k + c] = arr[i + 2 * k + c];
          arr[i + 2 * k + c] = t;
        }
    }
  }
  return geo;
}

let HAND_MAT = null;
function handMaterial() {
  if (HAND_MAT) return HAND_MAT;
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.56, sheen: 0.35, sheenColor: new THREE.Color(0xb0503c), sheenRoughness: 0.55 });
  HAND_MAT = addSurfaceDetail(mat, 'grain', 0.45);
  return HAND_MAT;
}

// Hand mesh for a pose (hand frame); the forearm and sleeves are separate jointed meshes.
export function buildHand(poseName, mirror = false, { sync = true } = {}) {
  if (!handGeos.has(poseName) && !sync) return buildHandLegacy(poseName, mirror);
  let geo = buildHandGeometry(poseName);
  if (mirror) geo = mirrorGeometry(geo);
  const hand = new THREE.Mesh(geo, handMaterial());
  // a viewmodel this small cannot be resolved by the sun's shadow map (it only produces acne)
  hand.castShadow = false;
  hand.receiveShadow = false;
  return hand;
}

// Forearm and cuff (arm frame, hinged at the wrist) and the sleeve (hand frame, laid by solveArm).
export function buildArm() {
  const M = materials();
  const arm = new THREE.Group();
  arm.add(new THREE.Mesh(forearm(), handMaterial()), new THREE.Mesh(cuff(), M.cuff));
  const sleeve = new THREE.Mesh(sleeveGeometry(), M.sleeve);
  // (rebuilt every frame: its bounds are never current)
  sleeve.frustumCulled = false;
  for (const o of [...arm.children, sleeve]) {
    o.castShadow = false;
    o.receiveShadow = false;
  }
  return { arm, sleeve };
}

export function buildHandLegacy(poseName, mirror = false) {
  const pose = POSES[poseName] || POSES.relax;
  const M = materials();
  const g = new THREE.Group();
  const skin = [palm()];
  const nails = [];
  for (const [name, f] of Object.entries(FINGERS)) {
    const wrap = pose.wrap && !(pose.trigger && name === 'index');
    const pts = wrap ? wrapFingerPoints(f, pose.wrap) : fingerPoints(f, pose.trigger && name === 'index' ? pose.trigger : pose.fingers[name]).pts;
    skin.push(tubeFromJoints(pts, f.r * 1.05, f.r * 0.82));
    nails.push(nail(f, pts));
  }
  // thumb: rotates out of the palm plane
  {
    const pts = [THUMB.base.clone().add(V(-0.012, 0.004, 0.02))];
    if (pose.wrap) pts.push(...wrapThumbPoints(pose.wrap));
    else {
      const [yaw, j1, j2] = pose.thumb;
      const dir = V(0.75, -0.35, -0.55).normalize().applyAxisAngle(V(0, 0, 1), -yaw * 0.6).applyAxisAngle(V(0, 1, 0), yaw * 0.45);
      pts.push(THUMB.base.clone());
      let p = THUMB.base.clone(),
        d = dir.clone();
      const axis = d.clone().cross(V(0, 1, 0)).normalize();
      for (let j = 0; j < 3; j++) {
        if (j > 0) d.applyAxisAngle(axis, -(j === 1 ? j1 : j2) * 1.1);
        p = p.clone().addScaledVector(d, THUMB.len[j]);
        pts.push(p.clone());
      }
    }
    skin.push(tubeFromJoints(pts, THUMB.r * 1.25, THUMB.r * 0.9));
    nails.push(nail(THUMB, pts));
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
  return g;
}

// Two-armed viewmodel rig. Each side is a hand frame (positioned in camera space by the caller)
// holding the posed hand mesh, with a forearm hinged at the wrist and an upper arm hinged at the
// elbow; solveArm() bends them toward the shoulder so arms always come from the body.
export class Hands {
  constructor(camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    this.poses = {};
    this.right = new THREE.Group();
    this.left = new THREE.Group();
    this.root.add(this.right, this.left);
    this.rig = {};
    for (const side of ['right', 'left']) {
      const holder = new THREE.Group();
      const { arm, sleeve } = buildArm();
      arm.position.copy(WRIST);
      this[side].add(holder, arm, sleeve);
      this.rig[side] = { holder, arm, sleeve };
      this.resetArm(side);
    }
    this.cur = { right: null, left: null };
    this.setPose('right', 'relax');
    this.setPose('left', 'carry');
    this.left.visible = false;
    this._listener = (pose) => this.onSculpted(pose);
    handListeners.add(this._listener);
  }

  meshFor(pose, mirror) {
    const key = pose + (mirror ? 'L' : 'R');
    if (!this.poses[key]) {
      this.poses[key] = buildHand(pose, mirror, { sync: false });
      this.poses[key].userData.sculpted = handGeos.has(pose);
    }
    return this.poses[key];
  }

  // A sculpted pose arrived: drop the fallback meshes for it and re-apply the current poses.
  onSculpted(pose) {
    for (const k of [pose + 'L', pose + 'R']) if (this.poses[k] && !this.poses[k].userData.sculpted) delete this.poses[k];
    for (const side of ['right', 'left']) {
      if (this.cur[side] !== pose) continue;
      this.cur[side] = null;
      this.setPose(side, pose);
    }
  }

  setPose(side, pose) {
    if (this.cur[side] === pose) return;
    const holder = this.rig[side].holder;
    holder.clear();
    // the base model is a left hand (thumb on +X with the back of the hand up); mirror it for the right
    holder.add(this.meshFor(pose, side === 'right'));
    this.cur[side] = pose;
  }

  // Places a hand frame in camera space.
  place(side, pos, quat) {
    this[side].position.copy(pos);
    this[side].quaternion.copy(quat);
  }

  // Two-bone IK in camera space: the elbow sits where an upper arm from `shoulder` meets a
  // forearm from the wrist, bent toward `pole`; the wrist only bends within its range, and the
  // sleeve is laid from the cuff round that elbow to the shoulder.
  solveArm(side, shoulder, pole) {
    const grp = this[side];
    const { arm, sleeve } = this.rig[side];
    const q = grp.quaternion;
    const W = _v1.copy(WRIST).applyQuaternion(q).add(grp.position);
    const a = UPPER,
      b = FOREARM;
    // leaning in: a hand further off than the arm reaches brings the shoulder forward and down
    // first (up to 25 cm: it stays below the bottom of the picture), then the upper arm runs on
    // further to it
    const over = W.distanceTo(shoulder) - (a + b - 0.002);
    if (over > 0) {
      const lean = Math.min(0.25, over * 1.2);
      shoulder = _v5.set(shoulder.x, shoulder.y - lean * 0.5, shoulder.z - lean);
    }
    const u = _v2.copy(W).sub(shoulder);
    let d = u.length();
    u.multiplyScalar(1 / Math.max(d, 1e-6));
    d = Math.min(Math.max(d, Math.abs(a - b) + 0.02), a + b - 0.002);
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const v = _v3.copy(pole).addScaledVector(u, -pole.dot(u));
    if (v.lengthSq() < 1e-8) v.set(0, -1, 0);
    v.normalize();
    const E = _v4.copy(shoulder).addScaledVector(u, x).addScaledVector(v, h);
    // forearm toward the elbow, limited to the wrist's range (hand frame: +Z runs back up the
    // forearm, +Y is the back of the hand, X the sideways bend)
    const qi = _q1.copy(q).invert();
    const dl = E.sub(W).applyQuaternion(qi).normalize();
    const pitch = Math.min(WRIST_BACK, Math.max(-WRIST_FWD, Math.atan2(dl.y, dl.z)));
    const yaw = Math.min(WRIST_SIDE, Math.max(-WRIST_SIDE, Math.asin(Math.min(1, Math.max(-1, dl.x)))));
    dl.set(Math.sin(yaw), Math.cos(yaw) * Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const qa = _q2.setFromUnitVectors(_Z, dl);
    arm.quaternion.copy(qa);
    // the rest in the hand's frame: the forearm as far as it goes, then the upper arm from where
    // it ends to the shoulder (further than an upper arm is long when the hand is out of reach:
    // the sleeve always runs on out of the picture instead of ending in mid-air)
    const f = _v2.copy(_Z).applyQuaternion(qa);
    const Wl = _v3.copy(WRIST);
    const El = _v4.copy(Wl).addScaledVector(f, b);
    const Sl = _v5.copy(shoulder).sub(grp.position).applyQuaternion(qi);
    const du = _v6.copy(Sl).sub(El);
    if (du.lengthSq() < 1e-8) du.copy(f);
    du.normalize();
    laySleeve(sleeve.geometry, Wl, f, El, du, Sl, _v7.set(1, 0, 0).applyQuaternion(qa));
  }

  // Straight wrist and elbow (for hands placed without a body, e.g. on the inspection stand).
  resetArm(side) {
    this.rig[side].arm.quaternion.identity();
    const E = _v4.copy(WRIST).addScaledVector(_Z, FOREARM);
    laySleeve(this.rig[side].sleeve.geometry, WRIST, _Z, E, _Z, _v5.copy(E).addScaledVector(_Z, UPPER), _v7.set(1, 0, 0));
  }
}

const _Z = new THREE.Vector3(0, 0, 1);
const _v1 = new THREE.Vector3(),
  _v2 = new THREE.Vector3(),
  _v3 = new THREE.Vector3(),
  _v4 = new THREE.Vector3(),
  _v5 = new THREE.Vector3(),
  _v6 = new THREE.Vector3(),
  _v7 = new THREE.Vector3();
// sleeve temporaries
const _s0 = new THREE.Vector3(),
  _s1 = new THREE.Vector3(),
  _s2 = new THREE.Vector3(),
  _s3 = new THREE.Vector3(),
  _s4 = new THREE.Vector3(),
  _s5 = new THREE.Vector3(),
  _s6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(),
  _q2 = new THREE.Quaternion();
