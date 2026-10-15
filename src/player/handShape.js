// Sculpted first-person hand as a signed-distance model (worker-safe: no DOM, no materials).
// Hand frame: palm facing -Y, fingers along -Z, back of the hand +Y, thumb on +X (left hand).

import * as THREE from 'three';
import { SDFModel, polygonizeArrays } from '../npc/sdfMesh.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Hand frame (right hand, palm facing -X / left, fingers along -Z / forward, back of hand +Y).
// Finger base points on the knuckle line and segment lengths (metres).
export const FINGERS = {
  index: { base: V(0.027, 0.002, -0.088), len: [0.037, 0.022, 0.018], r: 0.0088, splay: 0.07 },
  middle: { base: V(0.008, 0.003, -0.092), len: [0.041, 0.025, 0.019], r: 0.0091, splay: 0.0 },
  ring: { base: V(-0.011, 0.002, -0.088), len: [0.038, 0.024, 0.018], r: 0.0085, splay: -0.05 },
  pinky: { base: V(-0.029, -0.002, -0.079), len: [0.03, 0.018, 0.016], r: 0.0074, splay: -0.12 },
};
export const THUMB = { base: V(0.036, -0.011, -0.028), len: [0.034, 0.028, 0.024], r: 0.0102 };

// Pose = curl angles per finger joint [mcp, pip, dip] (radians), thumb [cmc yaw, mcp, ip], wrist tilt.
export const POSES = {
  relax: { fingers: { index: [0.25, 0.35, 0.25], middle: [0.3, 0.45, 0.3], ring: [0.35, 0.5, 0.3], pinky: [0.4, 0.55, 0.3] }, thumb: [0.6, 0.15, 0.2] },
  grip: { fingers: { index: [0.95, 1.3, 0.7], middle: [1.0, 1.35, 0.7], ring: [1.05, 1.35, 0.7], pinky: [1.1, 1.3, 0.7] }, thumb: [1.0, 0.45, 0.35] },
  pistol: { fingers: { index: [0.5, 0.75, 0.25], middle: [1.15, 1.45, 0.8], ring: [1.2, 1.45, 0.8], pinky: [1.25, 1.4, 0.8] }, thumb: [0.85, 0.25, 0.15] },
  carry: { fingers: { index: [0.55, 0.65, 0.35], middle: [0.6, 0.7, 0.35], ring: [0.62, 0.7, 0.35], pinky: [0.65, 0.7, 0.35] }, thumb: [0.4, 0.1, 0.1] },
  pinch: { fingers: { index: [0.7, 0.9, 0.5], middle: [0.85, 1.1, 0.6], ring: [1.05, 1.3, 0.7], pinky: [1.15, 1.3, 0.7] }, thumb: [1.15, 0.35, 0.3] },
};

export function fingerPoints(f, curl) {
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


// One smooth surface for palm, fingers, thumb, wrist and forearm (signed-distance primitives
// blended together, then polygonised), with nails and skin variation as vertex colours.

function segFrame(a, b, upHint) {
  const d = b.clone().sub(a).normalize();
  const side = d.clone().cross(upHint).normalize();
  const up = side.clone().cross(d).normalize();
  return { d, side, up };
}

export function handArrays(poseName) {
  const pose = POSES[poseName] || POSES.relax;
  const m = new SDFModel();
  m.colorBlend = 0.0012;
  m.layerBias = 0.0005;
  m.material('skin', [0.74, 0.53, 0.42], 0.55, 0.05);
  m.material('palm', [0.79, 0.58, 0.48], 0.6, 0.04);
  m.material('knuckle', [0.71, 0.49, 0.39], 0.55, 0.05);
  m.material('nail', [0.86, 0.7, 0.64], 0.3, 0.02);
  m.material('nailTip', [0.92, 0.86, 0.8], 0.35, 0.02);
  const B = 'hand';
  // palm block with a domed back, cupped hollow and the two muscle pads
  m.box(V(0.002, -0.003, -0.03), V(0.04, 0.0125, 0.052), 0.011, B, 'skin', { blend: 0.012 });
  m.ell(V(0.0, 0.003, -0.045), V(0.037, 0.011, 0.047), B, 'skin', { blend: 0.012 });
  m.ell(V(0.026, -0.012, -0.012), V(0.019, 0.012, 0.03), B, 'palm', { blend: 0.012 });
  m.ell(V(-0.027, -0.011, -0.03), V(0.013, 0.01, 0.036), B, 'palm', { blend: 0.012 });
  m.ell(V(0.0, -0.011, -0.075), V(0.04, 0.007, 0.014), B, 'palm', { blend: 0.01 }); // pad under the knuckles
  m.ell(V(0.002, -0.021, -0.045), V(0.02, 0.007, 0.024), B, 'palm', { sub: true, blend: 0.012 });
  // wrist and forearm: oval section widening toward the elbow
  m.ell(V(0.0, -0.003, 0.045), V(0.026, 0.0165, 0.04), B, 'skin', { blend: 0.02 });
  m.ell(V(0.0, -0.003, 0.11), V(0.029, 0.02, 0.06), B, 'skin', { blend: 0.02 });
  m.ell(V(0.0, -0.002, 0.17), V(0.033, 0.024, 0.05), B, 'skin', { blend: 0.02 });
  m.ell(V(-0.024, 0.006, 0.04), V(0.006, 0.005, 0.007), B, 'skin', { blend: 0.006 }); // wrist bone
  // fingers
  for (const [name, f] of Object.entries(FINGERS)) {
    const { pts } = fingerPoints(f, pose.fingers[name]);
    const [, mcp, pip, dip, tip] = pts;
    const r = f.r;
    // metacarpal ridge on the back of the hand + knuckle bump
    m.cone(f.base.clone().add(V(0, 0.004, 0.07)), mcp.clone().add(V(0, 0.003, 0)), 0.005, 0.007, B, 'skin', { blend: 0.012 });
    m.ell(mcp.clone().add(V(0, 0.0045, 0.003)), V(r * 1.05, r * 0.75, r * 0.95), B, 'knuckle', { blend: 0.006 });
    const segs = [
      [mcp, pip, r * 1.02, r * 0.93],
      [pip, dip, r * 0.92, r * 0.84],
      [dip, tip, r * 0.83, r * 0.7],
    ];
    segs.forEach(([a, b, r0, r1], j) => {
      m.cone(a, b, r0, r1, B, j === 0 ? 'skin' : 'skin', { blend: 0.004 });
      const fr = segFrame(a, b, V(0, 1, 0));
      const len = a.distanceTo(b);
      // pad on the palm side of each phalanx
      const padC = a.clone().addScaledVector(fr.d, len * 0.55).addScaledVector(fr.up, -r0 * 0.35);
      m.ell(padC, V(r0 * 0.85, r0 * 0.7, len * 0.42), B, 'palm', { blend: 0.004, basis: new THREE.Matrix4().makeBasis(fr.side, fr.up, fr.d) });
      if (j < 2) m.ell(b.clone().addScaledVector(fr.up, r1 * 0.25), V(r1 * 1.08, r1 * 0.9, r1 * 0.95), B, 'knuckle', { blend: 0.004 }); // joint
      if (j === 2) {
        // nail plate sitting on the back of the last segment, free edge at the tip
        const nb = new THREE.Matrix4().makeBasis(fr.side, fr.up, fr.d);
        const nc = a.clone().addScaledVector(fr.d, len * 0.56).addScaledVector(fr.up, r1 * 0.8);
        m.ell(nc, V(r1 * 0.74, r1 * 0.17, len * 0.36), B, 'nail', { blend: 0.0015, basis: nb, layer: 2 });
        m.ell(nc.clone().addScaledVector(fr.d, len * 0.3), V(r1 * 0.66, r1 * 0.16, len * 0.07), B, 'nailTip', { blend: 0.001, basis: nb, layer: 3 });
      }
    });
  }
  // thumb: metacarpal inside the thenar pad, then two phalanges
  {
    const [yaw, j1, j2] = pose.thumb;
    const dir = V(0.75, -0.35, -0.55).normalize().applyAxisAngle(V(0, 0, 1), -yaw * 0.6).applyAxisAngle(V(0, 1, 0), yaw * 0.45);
    const root = THUMB.base.clone().add(V(-0.014, 0.002, 0.024));
    let p = THUMB.base.clone(),
      d = dir.clone();
    const axis = d.clone().cross(V(0, 1, 0)).normalize();
    const pts = [p.clone()];
    for (let j = 0; j < 3; j++) {
      if (j > 0) d.applyAxisAngle(axis, -(j === 1 ? j1 : j2) * 1.1);
      p = p.clone().addScaledVector(d, THUMB.len[j]);
      pts.push(p.clone());
    }
    const r = THUMB.r;
    m.cone(root, pts[0], r * 1.5, r * 1.35, B, 'skin', { blend: 0.012 });
    m.cone(pts[0], pts[1], r * 1.35, r * 1.12, B, 'skin', { blend: 0.008 });
    m.cone(pts[1], pts[2], r * 1.08, r * 1.0, B, 'skin', { blend: 0.004 });
    m.cone(pts[2], pts[3], r * 0.98, r * 0.82, B, 'skin', { blend: 0.004 });
    m.ell(pts[1], V(r * 1.15, r * 1.05, r * 1.1), B, 'knuckle', { blend: 0.005 });
    m.ell(pts[2], V(r * 1.02, r * 0.95, r * 1.0), B, 'knuckle', { blend: 0.004 });
    const fr = segFrame(pts[2], pts[3], V(0, 0, 1).cross(axis).lengthSq() > 0.1 ? axis.clone().cross(d).normalize().negate() : V(0, 1, 0));
    const len = pts[2].distanceTo(pts[3]);
    const nb = new THREE.Matrix4().makeBasis(fr.side, fr.up, fr.d);
    const nc = pts[2].clone().addScaledVector(fr.d, len * 0.55).addScaledVector(fr.up, r * 0.72);
    m.ell(nc, V(r * 0.7, r * 0.17, len * 0.36), B, 'nail', { blend: 0.0015, basis: nb, layer: 2 });
    const padC = pts[2].clone().addScaledVector(fr.d, len * 0.5).addScaledVector(fr.up, -r * 0.4);
    m.ell(padC, V(r * 0.85, r * 0.65, len * 0.42), B, 'palm', { blend: 0.004, basis: nb });
  }
  const a = polygonizeArrays(m, 0.002, [B]);
  return { P: a.P, N: a.N, C: a.C, I: a.I };
}

