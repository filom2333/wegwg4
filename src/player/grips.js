// How things sit in the hands. Every holdable model carries a grip frame in its own space
// (userData.grip: where the fist closes, which way the thumb points, which way the back of the
// hand faces). A hold places that frame in camera space; the item and the posed hand are both
// derived from it, so the fingers always close on the handle whatever the item's shape.

import * as THREE from 'three';
import { POSES, gripCenter, PALM_CONTACT } from './hands.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Orthonormal frame: X toward the thumb side of the fist, Y toward the back of the hand, Z = X x Y.
export function frameQ(thumb, back) {
  const x = thumb.clone().normalize();
  const y = back.clone().addScaledVector(x, -back.dot(x)).normalize();
  const z = x.clone().cross(y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// The grip frame in hand space. The base hand model is a left hand (thumb +X); the right hand is
// its mirror image, so its thumb side is -X.
const HAND_Q = {
  right: frameQ(V(-1, 0, 0), V(0, 1, 0)),
  left: new THREE.Quaternion(),
};
export function handGrip(side, pose) {
  const P = POSES[pose] || {};
  return { p: P.wrap ? gripCenter(P.wrap) : PALM_CONTACT.clone(), q: HAND_Q[side] };
}

// Hand transform (camera space) that puts its grip frame on `anchor` ({p, q}).
export function handFromAnchor(side, pose, anchor, out = { p: V(0, 0, 0), q: new THREE.Quaternion() }) {
  const g = handGrip(side, pose);
  out.q.copy(anchor.q).multiply(g.q.clone().invert());
  out.p.copy(anchor.p).sub(g.p.clone().applyQuaternion(out.q));
  return out;
}

// Item transform that puts its grip frame on `anchor`.
export function itemFromAnchor(grip, anchor, out = { p: V(0, 0, 0), q: new THREE.Quaternion() }) {
  out.q.copy(anchor.q).multiply(grip.q.clone().invert());
  out.p.copy(anchor.p).sub(grip.p.clone().applyQuaternion(out.q));
  return out;
}

// Anchor (grip frame in camera space) of an item placed at {p, q}.
export function anchorFromItem(grip, item, out = { p: V(0, 0, 0), q: new THREE.Quaternion() }) {
  out.q.copy(item.q).multiply(grip.q);
  out.p.copy(item.p).add(grip.p.clone().applyQuaternion(item.q));
  return out;
}

// Anchor rotation from the direction the thumb side of the fist points and the direction the
// forearm leaves the wrist (right hand): keeping the wrist pointed back toward the elbow is what
// makes the arm come up naturally from the bottom of the view.
export function anchorQ(thumb, wrist) {
  const t = thumb.clone().normalize();
  const back = wrist.clone().normalize().negate().cross(t);
  return frameQ(t, back);
}

// The same for either hand. The left hand's frame is the mirror image, so its back of the hand is
// the other cross product; with anchorQ alone a left wrist would point away from its elbow.
export function anchorQFor(side, thumb, wrist) {
  if (side === 'right') return anchorQ(thumb, wrist);
  const t = thumb.clone().normalize();
  return frameQ(t, wrist.clone().normalize().cross(t));
}

// Where the right hand holds each kind of item in view (camera space: +X right, +Y up, -Z ahead).
// wrap: bottles and cans upright; palm: flat things lying on the open palm; side: carried by a
// handle, hanging from the fist; tool: a handle held upright like a torch.
export const ANCHORS = {
  wrap: { p: V(0.15, -0.19, -0.4), q: anchorQ(V(-0.12, 1, 0.2), V(0.45, -0.25, 0.85)) },
  palm: { p: V(0.1, -0.2, -0.4), q: anchorQ(V(1, 0.15, 0), V(0.25, -0.45, 0.85)) },
  // held up a little so the can or lantern hanging from the fist stays in view
  // (the wrist leaves the fist down and back toward the elbow, so it does not bend over the handle)
  side: { p: V(0.19, -0.17, -0.47), q: anchorQ(V(-1, 0, 0.1), V(0.22, -0.42, 0.88)) },
  tool: { p: V(0.18, -0.21, -0.38), q: anchorQ(V(-0.15, 0.95, -0.25), V(0.4, -0.05, 0.9)) },
};

// Weapon placements (item transforms, camera space): from the hip and aimed down the sights.
const TURN = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI);
export const WEAPON_POSE = {
  pistol: {
    hip: { p: V(0.13, -0.15, -0.4), q: TURN.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.14, -0.06))) },
    aim: { p: V(0, -0.068, -0.5), q: TURN.clone() },
  },
  rifle: {
    hip: { p: V(0.1, -0.235, -0.36), q: TURN.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.1, -0.08))) },
    aim: { p: V(0.0, -0.058, -0.37), q: TURN.clone() },
  },
};

// Grip of an item mesh, as frames ready for the functions above (cached on the mesh).
export function itemGrip(mesh, which = 'grip') {
  const key = '_' + which;
  if (mesh.userData[key] !== undefined) return mesh.userData[key];
  const s = mesh.userData[which];
  const g = s ? { p: s.p.clone(), q: frameQ(s.thumb, s.back), pose: s.pose, cls: s.cls, aimOnly: !!s.aimOnly, thumb: s.thumb.clone() } : null;
  mesh.userData[key] = g;
  return g;
}

// Fallback grip from the item's size when the model declares none.
export function sizeGrip(size) {
  const r = Math.min(size.x, size.z) / 2;
  if (size.y > Math.max(size.x, size.z) * 1.2 && r < 0.045) return { p: V(0, 0, 0), q: frameQ(V(0, 1, 0), V(1, 0, 0)), pose: wrapPose(r), cls: 'wrap' };
  return { p: V(0, -size.y / 2, 0), q: frameQ(V(1, 0, 0), V(0, -1, 0)), pose: 'palm', cls: 'palm' };
}

export function wrapPose(r) {
  const opts = [
    ['wrap12', 0.012],
    ['grip', 0.016],
    ['wrap24', 0.024],
    ['wrap33', 0.033],
    ['wrap40', 0.04],
  ];
  let best = opts[0];
  for (const o of opts) if (Math.abs(o[1] - r) < Math.abs(best[1] - r)) best = o;
  return best[0];
}

const _rot = (ax, a) => new THREE.Quaternion().setFromAxisAngle(ax, a);
const AX = V(1, 0, 0),
  AY = V(0, 1, 0),
  AZ = V(0, 0, 1);

// Full camera-space pose of a held item and the hands holding it.
// st: { aim, recoil, reload (0..1 progress, 0 = none), use (0..1), useKind, raise (0..1), sway, bob }
export function holdPose(mesh, st) {
  const grip = itemGrip(mesh) || sizeGrip(mesh.userData.size || V(0.1, 0.1, 0.1));
  const cls = grip.cls || 'wrap';
  let anchor, item;
  const k = st.use || 0;
  if (st.topDist === undefined && mesh.userData.size) st.topDist = mesh.userData.size.y / 2 - grip.p.y;
  const arms = defaultArms();
  if (cls === 'pistol' || cls === 'rifle') {
    const P = WEAPON_POSE[cls];
    item = { p: P.hip.p.clone().lerp(P.aim.p, st.aim), q: P.hip.q.clone().slerp(P.aim.q, st.aim) };
    if (st.recoil > 0) {
      const r = st.recoil;
      item.p.add(V(0, 0.012 * r, (cls === 'rifle' ? 0.07 : 0.045) * r));
      item.q.premultiply(_rot(AX, (cls === 'rifle' ? 0.16 : 0.26) * r));
    }
    if (st.reload > 0) {
      // bring the gun in toward the middle, muzzle tipped up and rolled over to load
      const r = Math.sin(Math.min(1, st.reload) * Math.PI);
      item.p.add(V(-0.07, 0.01, 0.07).multiplyScalar(r));
      item.q.premultiply(_rot(AZ, 0.7 * r)).premultiply(_rot(AX, 0.5 * r));
    }
    if (k > 0 && st.useKind === 'swing') item.q.premultiply(_rot(AX, -0.9 * k));
    item.p.add(st.sway || V(0, 0, 0));
    if (st.bob) item.p.add(st.bob);
    if (st.raise < 1) {
      const d = 1 - st.raise;
      item.p.add(V(0.03, -0.22 * d, 0.05 * d));
      item.q.premultiply(_rot(AX, -0.5 * d));
    }
    anchor = anchorFromItem(grip, item);
    if (cls === 'rifle') {
      // the right elbow comes up and out when the stock goes to the shoulder
      arms.right.pole.lerp(V(1, -0.3, 0.1), st.aim);
      arms.right.shoulder.lerp(V(0.15, -0.21, 0.02), st.aim);
      arms.left.pole.set(-0.3, -1, 0);
    } else if (st.aim > 0) {
      arms.right.pole.lerp(V(0.25, -1, 0), st.aim);
      arms.left.pole.set(-0.2, -1, 0);
    }
  } else {
    const A = ANCHORS[cls] || ANCHORS.wrap;
    anchor = { p: A.p.clone(), q: A.q.clone() };
    if (k > 0) {
      switch (st.useKind) {
        case 'drink': {
          // up under the chin, opening tipped toward the mouth
          const q = anchor.q.clone().premultiply(_rot(AX, 1.25)).premultiply(_rot(AZ, 0.25));
          const axis = V(1, 0, 0).applyQuaternion(q);
          const top = (st.topDist || 0.07) + 0.01;
          const p = V(0.02, -0.12, -0.1).addScaledVector(axis, -top);
          anchor.p.lerp(p, k);
          anchor.q.slerp(q, k);
          break;
        }
        case 'eat':
          anchor.p.lerp(V(0.04, -0.16, -0.24), k);
          anchor.q.premultiply(_rot(AX, 0.5 * k));
          break;
        case 'pour':
          // forward and tipped so the spout points down
          anchor.p.lerp(V(0.1, -0.2, -0.52), k);
          anchor.q.premultiply(_rot(AX, -0.7 * k)).premultiply(_rot(AZ, 0.3 * k));
          break;
        case 'swing':
          anchor.p.add(V(-0.12, -0.03, -0.16).multiplyScalar(k));
          anchor.q.premultiply(_rot(AX, -0.75 * k)).premultiply(_rot(AY, 0.35 * k));
          break;
        case 'wipe': {
          const t = st.time || 0;
          anchor.p.add(V(-0.04 + 0.05 * Math.cos(t * 9), 0.06 + 0.04 * Math.sin(t * 9), -0.16).multiplyScalar(k));
          anchor.q.premultiply(_rot(AX, -0.9 * k));
          break;
        }
        case 'spray':
          anchor.p.add(V(-0.06, 0.06, -0.12).multiplyScalar(k));
          anchor.q.premultiply(_rot(AY, 0.3 * k));
          break;
        default:
          anchor.p.lerp(V(0.0, -0.12, -0.22), k);
          anchor.q.premultiply(_rot(AX, 0.35 * k));
      }
    }
    anchor.p.add(st.sway || V(0, 0, 0));
    if (st.bob) anchor.p.add(st.bob);
    if (st.raise < 1) {
      const d = 1 - st.raise;
      anchor.p.add(V(0.03, -0.22 * d, 0.05 * d));
      anchor.q.premultiply(_rot(AX, -0.6 * d));
    }
    item = itemFromAnchor(grip, anchor);
    if (cls === 'side') item.hang = hang(item, anchor, st.up || AY, st.swing || 0);
  }
  return { item, grip, cls, arms };
}

// Where the shoulders are and which way the elbows bend (camera space, body upright).
export function defaultArms() {
  return {
    right: { shoulder: V(0.19, -0.25, 0.06), pole: V(0.3, -1, 0.15) },
    left: { shoulder: V(-0.19, -0.25, 0.06), pole: V(-0.3, -1, 0.15) },
  };
}

// An item carried by a handle swings about the handle until it hangs plumb (plus `swing`).
function hang(item, anchor, up, swing) {
  const axis = V(1, 0, 0).applyQuaternion(anchor.q);
  const iu = V(0, 1, 0).applyQuaternion(item.q);
  const a = iu.clone().addScaledVector(axis, -iu.dot(axis));
  const b = up.clone().addScaledVector(axis, -up.dot(axis));
  if (a.lengthSq() < 1e-6 || b.lengthSq() < 1e-6) return 0;
  a.normalize();
  b.normalize();
  const ang = Math.atan2(a.clone().cross(b).dot(axis), a.dot(b)) + swing;
  const r = _rot(axis, ang);
  item.p.sub(anchor.p).applyQuaternion(r).add(anchor.p);
  item.q.premultiply(r);
  return ang;
}

// Hands for an item at its actual camera-space transform (so they never drift off it).
// `hang`: the angle the item swung about the handle (the fist does not turn with it).
export function handsOnItem(mesh, itemLocal, hang = 0, aim = 0) {
  const grip = itemGrip(mesh) || sizeGrip(mesh.userData.size || V(0.1, 0.1, 0.1));
  const anchor = anchorFromItem(grip, itemLocal);
  if (hang) anchor.q.premultiply(_rot(V(1, 0, 0).applyQuaternion(anchor.q), -hang));
  const right = handFromAnchor('right', grip.pose, anchor);
  right.pose = grip.pose;
  let left = null;
  const g2 = itemGrip(mesh, 'grip2');
  if (g2 && (!g2.aimOnly || aim > 0.35)) {
    const a2 = anchorFromItem(g2, itemLocal);
    if (g2.aimOnly && aim < 1) {
      // the support hand comes in from below as the gun comes up
      const d = 1 - (aim - 0.35) / 0.65;
      a2.p.add(V(-0.06, -0.12, 0.08).multiplyScalar(d));
    }
    left = handFromAnchor('left', g2.pose, a2);
    left.pose = g2.pose;
  }
  return { right, left };
}
