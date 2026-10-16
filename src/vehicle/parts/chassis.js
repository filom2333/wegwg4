// Rolling chassis: ladder frame, front subframe with lower arms and McPherson struts, rear
// twist-beam axle with shocks and springs, steering rack, exhaust line and the fuel tank.

import * as THREE from 'three';
import { loftSections, superSection, roundedBox, latheY, tubeAlong } from '../../gfx/geom.js';
import { applyWeathering, weatheringUniforms } from '../carMaterials.js';
import { cached } from '../../gfx/textures.js';
import { SPEC } from '../body/shape.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function mesh(geo, mat, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function beam(points, w, h, mat) {
  const pts = points.map((p) => (p.isVector3 ? p : V(...p)));
  const secs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)],
      b = pts[Math.min(pts.length - 1, i + 1)];
    const dir = b.clone().sub(a).normalize();
    let side = V(0, 1, 0).cross(dir);
    if (side.lengthSq() < 1e-6) side = V(1, 0, 0);
    side.normalize();
    const up = dir.clone().cross(side).normalize();
    secs.push(superSection(pts[i], side, up, w / 2, h / 2, 6, 12));
  }
  return mesh(loftSections(secs, { capStart: true, capEnd: true }), mat);
}

function helix(center, r, h, turns, wire, axis = 'y') {
  const pts = [];
  const N = Math.round(turns * 14);
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * turns * Math.PI * 2;
    const t = i / N;
    pts.push(V(Math.cos(a) * r, t * h, Math.sin(a) * r).add(center));
  }
  void axis;
  return tubeAlong(pts, wire, 6, { closedEnds: true });
}

export function createChassisMaterials() {
  return cached('chassisMats', () => {
    const grime = weatheringUniforms({ dirt: 0.9, dust: 0.6, rust: 0.35, fade: 0 });
    return {
      frame: applyWeathering(new THREE.MeshStandardMaterial({ color: 0x1d1e1f, metalness: 0.5, roughness: 0.65 }), grime),
      arm: applyWeathering(new THREE.MeshStandardMaterial({ color: 0x2a2b2c, metalness: 0.6, roughness: 0.6 }), grime),
      spring: new THREE.MeshStandardMaterial({ color: 0x3b5a8a, metalness: 0.5, roughness: 0.45 }),
      damper: new THREE.MeshStandardMaterial({ color: 0x8c8f92, metalness: 0.85, roughness: 0.3 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
      exhaust: applyWeathering(new THREE.MeshStandardMaterial({ color: 0x6b6058, metalness: 0.7, roughness: 0.6 }), weatheringUniforms({ rust: 0.75, dirt: 0.5 })),
      tank: applyWeathering(new THREE.MeshStandardMaterial({ color: 0x232323, metalness: 0.3, roughness: 0.7 }), grime),
    };
  });
}

export function buildChassisFrame(M) {
  const g = new THREE.Group();
  // Longitudinal rails (kick up over the rear axle)
  for (const s of [1, -1]) {
    g.add(
      beam(
        // ends tuck up behind the bumper covers so no frame shows below them
        [V(0.46 * s, 0.3, 1.8), V(0.455, 0.2, 1.45).setX(0.455 * s), V(0.45 * s, 0.175, 1.1), V(0.47 * s, 0.172, 0.5), V(0.5 * s, 0.172, -0.75), V(0.5 * s, 0.23, -1.0), V(0.5 * s, 0.25, -1.3), V(0.5 * s, 0.3, -1.7), V(0.5 * s, 0.37, -1.98)],
        0.06,
        0.05,
        M.frame
      )
    );
  }
  // Cross members
  for (const [z, y] of [
    [1.8, 0.3],
    [1.05, 0.175],
    [-0.3, 0.172],
    [-1.6, 0.285],
    [-1.98, 0.37],
  ]) {
    g.add(beam([V(-0.48, y, z), V(0.48, y, z)], 0.05, 0.05, M.frame));
  }
  // Front subframe (engine cradle) with lower control arms
  g.add(beam([V(-0.42, 0.22, 1.12), V(-0.42, 0.22, 1.62), V(0.42, 0.22, 1.62), V(0.42, 0.22, 1.12)], 0.05, 0.05, M.frame));
  for (const s of [1, -1]) {
    // lower arm: A-shape from the subframe to the knuckle ball joint
    const bj = V(0.64 * s, 0.2, SPEC.axleF);
    g.add(beam([V(0.42 * s, 0.22, SPEC.axleF + 0.12), bj], 0.035, 0.03, M.arm));
    g.add(beam([V(0.42 * s, 0.22, SPEC.axleF - 0.22), bj], 0.035, 0.03, M.arm));
    // McPherson strut: damper tube + spring + top mount (toward the strut tower)
    const bot = V(0.62 * s, 0.38, SPEC.axleF - 0.03);
    const top = V(0.53 * s, 0.84, SPEC.axleF - 0.02);
    const dir = top.clone().sub(bot);
    const len = dir.length();
    const strut = new THREE.Group();
    const tube = new THREE.CylinderGeometry(0.026, 0.026, len * 0.55, 14);
    tube.translate(0, len * 0.275, 0);
    strut.add(mesh(tube, M.damper));
    const rod = new THREE.CylinderGeometry(0.01, 0.01, len * 0.5, 8);
    rod.translate(0, len * 0.75, 0);
    strut.add(mesh(rod, M.damper, false));
    strut.add(mesh(helix(V(0, len * 0.4, 0), 0.06, len * 0.36, 4.5, 0.008), M.spring));
    const seat = latheY(
      [
        [0.02, 0.0],
        [0.075, 0.0],
        [0.078, 0.01],
      ],
      20
    );
    seat.translate(0, len * 0.4, 0);
    strut.add(mesh(seat, M.arm));
    strut.position.copy(bot);
    strut.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
    g.add(strut);
    // Anti-roll bar link
    g.add(mesh(tubeAlong([V(0.38 * s, 0.25, 1.62), V(0.55 * s, 0.26, SPEC.axleF + 0.12)], 0.009, 6), M.arm, false));
  }
  // Anti-roll bar
  g.add(mesh(tubeAlong([V(-0.38, 0.25, 1.62), V(0, 0.24, 1.66), V(0.38, 0.25, 1.62)], 0.011, 8), M.arm, false));
  // Steering rack
  const rack = new THREE.CylinderGeometry(0.03, 0.03, 0.62, 14);
  rack.rotateZ(Math.PI / 2);
  rack.translate(0, 0.3, SPEC.axleF - 0.18);
  g.add(mesh(rack, M.damper));
  for (const s of [1, -1]) {
    const boot = latheY(
      [
        [0.025, 0.0],
        [0.034, 0.02],
        [0.026, 0.04],
        [0.034, 0.06],
        [0.026, 0.08],
        [0.012, 0.1],
      ],
      14
    );
    boot.rotateZ((-Math.PI / 2) * s);
    boot.translate(0.31 * s, 0.3, SPEC.axleF - 0.18);
    g.add(mesh(boot, M.rubber, false));
    g.add(mesh(tubeAlong([V(0.4 * s, 0.3, SPEC.axleF - 0.18), V(0.66 * s, 0.31, SPEC.axleF - 0.12)], 0.009, 6), M.damper, false));
  }
  // Rear twist beam with trailing arms, shocks and springs
  const rz = SPEC.axleR;
  g.add(beam([V(-0.58, 0.27, rz + 0.12), V(0.58, 0.27, rz + 0.12)], 0.09, 0.06, M.arm));
  for (const s of [1, -1]) {
    g.add(beam([V(0.6 * s, 0.25, rz + 0.45), V(0.62 * s, 0.28, rz + 0.12), V(0.66 * s, SPEC.wheelY, rz)], 0.05, 0.07, M.arm));
    g.add(mesh(helix(V(0.52 * s, 0.265, rz + 0.06), 0.055, 0.12, 4, 0.008), M.spring));
    const shock = new THREE.Group();
    const bot = V(0.62 * s, 0.26, rz - 0.08),
      top = V(0.61 * s, 0.56, rz - 0.15);
    const dir = top.clone().sub(bot);
    const len = dir.length();
    const tube = new THREE.CylinderGeometry(0.022, 0.022, len * 0.6, 12);
    tube.translate(0, len * 0.3, 0);
    shock.add(mesh(tube, M.damper));
    const rod = new THREE.CylinderGeometry(0.009, 0.009, len * 0.45, 8);
    rod.translate(0, len * 0.78, 0);
    shock.add(mesh(rod, M.damper, false));
    shock.position.copy(bot);
    shock.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
    g.add(shock);
  }
  return g;
}

export function buildExhaustLine(M) {
  const g = new THREE.Group();
  // Downpipe from the manifold, catalytic converter, centre pipe, rear muffler, tail pipe.
  const pipe = [V(-0.12, 0.25, 1.26), V(-0.08, 0.17, 1.0), V(-0.05, 0.16, 0.6)];
  g.add(mesh(tubeAlong(pipe, 0.024, 10), M.exhaust));
  const cat = latheY(
    [
      [0.03, 0.0],
      [0.07, 0.06],
      [0.07, 0.3],
      [0.03, 0.36],
    ],
    16
  );
  cat.rotateX(-Math.PI / 2);
  cat.translate(-0.05, 0.16, 0.6);
  g.add(mesh(cat, M.exhaust));
  g.add(mesh(tubeAlong([V(-0.05, 0.16, 0.24), V(-0.06, 0.16, -0.5), V(-0.12, 0.2, -1.1), V(-0.16, 0.24, -1.58), V(-0.2, 0.26, -1.72)], 0.024, 10), M.exhaust));
  // Rear muffler (transverse oval can)
  const secs = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    secs.push(superSection(V(-0.15 - 0.4 * t, 0.26, -1.78), V(0, 0, 1), V(0, 1, 0), 0.13, 0.07, 2.2, 20));
  }
  g.add(mesh(loftSections(secs, { capStart: true, capEnd: true }), M.exhaust));
  // heat shield above the muffler
  const hs = roundedBox(0.5, 0.008, 0.3, 0.004, 1);
  hs.translate(-0.35, 0.345, -1.78);
  g.add(mesh(hs, M.damper, false));
  // hangers
  for (const [x, z] of [
    [-0.06, -0.4],
    [-0.2, -1.78],
    [-0.5, -1.78],
  ]) {
    g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8).translate(x, 0.215, z), M.rubber, false));
  }
  return g;
}

export function buildFuelTank(M) {
  const g = new THREE.Group();
  const secs = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    secs.push(superSection(V(-0.32 + 0.64 * t, 0.205, -0.98), V(0, 0, 1), V(0, 1, 0), 0.25, 0.05, 3.5, 20));
  }
  g.add(mesh(loftSections(secs, { capStart: true, capEnd: true }), M.tank));
  // straps
  for (const z of [-0.85, -1.11]) {
    const st = roundedBox(0.7, 0.006, 0.03, 0.002, 1);
    st.translate(0, 0.153, z);
    g.add(mesh(st, M.frame, false));
  }
  // filler neck toward the right-rear filler
  g.add(mesh(tubeAlong([V(-0.3, 0.24, -1.1), V(-0.55, 0.4, -1.4), V(-0.74, 0.8, -1.62)], 0.022, 8), M.rubber));
  return g;
}
