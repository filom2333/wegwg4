// Character definitions: skeletons + SDF bodies for the vagrant, the night creature, the jackrabbit
// and the coyote. Each builder returns { mesh: SkinnedMesh, bones, rig, height, hitboxes }.

import * as THREE from 'three';
import { SDFModel, polygonizeArrays, geometryFromArrays, characterMaterial, eyeMaterial } from './sdfMesh.js';
import { mulberry32 } from '../core/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Build a bone hierarchy from world-space joint positions.
function skeleton(defs) {
  // defs: [name, parentName|null, [x,y,z]]
  const bones = {};
  const world = {};
  const list = [];
  for (const [name, parent, p] of defs) {
    const b = new THREE.Bone();
    b.name = name;
    world[name] = V(...p);
    if (parent) {
      b.position.copy(world[name]).sub(world[parent]);
      bones[parent].add(b);
    } else b.position.copy(world[name]);
    bones[name] = b;
    list.push(b);
  }
  return { bones, world, list, defs };
}

function finish(model, sk, cell) {
  return { model, defs: sk.defs, cell, attachments: model.attachments };
}

const eyeGeo = new THREE.SphereGeometry(1, 16, 12);

let sharedMaterial = null;
// Turn polygonised arrays + joint definitions into a skinned mesh with its own skeleton.
export function assembleCharacter(arrays, defs, attachments = []) {
  const sk = skeleton(defs);
  const geo = arrays.isBufferGeometry ? arrays : geometryFromArrays(arrays);
  const skel = new THREE.Skeleton(sk.list);
  sharedMaterial = sharedMaterial || characterMaterial();
  const mesh = new THREE.SkinnedMesh(geo, sharedMaterial);
  mesh.add(sk.list[0]);
  mesh.bind(skel);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  for (const b of sk.list) {
    b.userData.rest = b.quaternion.clone();
    b.userData.restPos = b.position.clone();
  }
  for (const a of attachments) {
    if (a.type !== 'eye') continue;
    const e = new THREE.Mesh(eyeGeo, eyeMaterial(a.color, a.glow || 0));
    e.scale.setScalar(a.r);
    e.position.set(a.pos[0], a.pos[1], a.pos[2]).sub(sk.world[a.bone]);
    if (a.look) e.rotation.set(a.look[0], a.look[1], 0);
    sk.bones[a.bone].add(e);
  }
  return { mesh, bones: sk.bones, world: sk.world };
}

// Synchronous build (inspector, fallback when workers are unavailable).
export function buildCharacter(type, seed = 1) {
  const def = DEFINE[type](seed);
  const arrays = polygonizeArrays(def.model, def.cell, def.defs.map((d) => d[0]));
  return { ...assembleCharacter(arrays, def.defs, def.attachments), type, height: def.height, kind: def.kind, hitboxes: def.hitboxes, arrays };
}

// ------------------------------------------------------------------ humanoid skeleton
function humanJoints(h = 1, { hunch = 0, armLen = 1, legLen = 1 } = {}) {
  const s = (v) => v * h;
  return [
    ['hips', null, [0, s(0.98) * legLen, 0]],
    ['spine', 'hips', [0, s(0.98) * legLen + s(0.15), -0.005 - hunch * 0.04]],
    ['chest', 'spine', [0, s(0.98) * legLen + s(0.35), 0.0 + hunch * 0.04]],
    ['neck', 'chest', [0, s(0.98) * legLen + s(0.54), 0.01 + hunch * 0.16]],
    ['head', 'neck', [0, s(0.98) * legLen + s(0.64), 0.02 + hunch * 0.22]],
    ['clavL', 'chest', [s(0.03), s(0.98) * legLen + s(0.47), hunch * 0.06]],
    ['upperArmL', 'clavL', [s(0.19), s(0.98) * legLen + s(0.47), hunch * 0.06]],
    ['foreArmL', 'upperArmL', [s(0.22), s(0.98) * legLen + s(0.47) - s(0.29) * armLen, hunch * 0.06 - 0.02]],
    ['handL', 'foreArmL', [s(0.24), s(0.98) * legLen + s(0.47) - s(0.55) * armLen, hunch * 0.06 + 0.02]],
    ['clavR', 'chest', [-s(0.03), s(0.98) * legLen + s(0.47), hunch * 0.06]],
    ['upperArmR', 'clavR', [-s(0.19), s(0.98) * legLen + s(0.47), hunch * 0.06]],
    ['foreArmR', 'upperArmR', [-s(0.22), s(0.98) * legLen + s(0.47) - s(0.29) * armLen, hunch * 0.06 - 0.02]],
    ['handR', 'foreArmR', [-s(0.24), s(0.98) * legLen + s(0.47) - s(0.55) * armLen, hunch * 0.06 + 0.02]],
    ['thighL', 'hips', [s(0.1), s(0.94) * legLen, 0]],
    ['shinL', 'thighL', [s(0.11), s(0.52) * legLen, 0.02]],
    ['footL', 'shinL', [s(0.11), s(0.09), -0.01]],
    ['thighR', 'hips', [-s(0.1), s(0.94) * legLen, 0]],
    ['shinR', 'thighR', [-s(0.11), s(0.52) * legLen, 0.02]],
    ['footR', 'shinR', [-s(0.11), s(0.09), -0.01]],
  ];
}

// ------------------------------------------------------------------ vagrant
export function defineVagrant(seed = 1) {
  const r = mulberry32(seed);
  const m = new SDFModel();
  const sk = skeleton(humanJoints(1, { hunch: 0.15 }));
  const J = sk.world;
  const skinTone = [
    [0.62, 0.45, 0.35],
    [0.45, 0.31, 0.23],
    [0.72, 0.55, 0.44],
  ][Math.floor(r() * 3)];
  m.material('skin', skinTone, 0.55, 0.07);
  m.material('lip', skinTone.map((c) => c * 0.78), 0.45, 0.0);
  m.material('eye', [0.08, 0.07, 0.06], 0.15, 0);
  m.material('white', [0.78, 0.74, 0.68], 0.25, 0);
  const coatCols = [
    [0.36, 0.31, 0.22],
    [0.27, 0.29, 0.24],
    [0.4, 0.28, 0.2],
    [0.22, 0.22, 0.24],
  ];
  m.material('coat', coatCols[Math.floor(r() * coatCols.length)], 0.95, 0.16);
  m.material('lining', [0.5, 0.46, 0.38], 0.95, 0.12);
  m.material('pants', [0.18, 0.2, 0.24].map((c) => c * (0.85 + r() * 0.3)), 0.95, 0.12);
  m.material('boot', [0.2, 0.14, 0.09], 0.65, 0.12);
  m.material('sole', [0.08, 0.07, 0.06], 0.8, 0.05);
  const hatCols = [
    [0.42, 0.14, 0.1],
    [0.25, 0.27, 0.2],
    [0.18, 0.18, 0.2],
  ];
  m.material('hat', hatCols[Math.floor(r() * 3)], 0.98, 0.18);
  m.material('beard', [0.3, 0.22, 0.16].map((c) => c * (0.6 + r() * 0.8)), 1.0, 0.4);
  m.material('canvas', [0.36, 0.34, 0.24], 0.95, 0.15);
  m.material('roll', [0.24, 0.27, 0.2], 0.95, 0.14);
  m.material('strap', [0.12, 0.1, 0.08], 0.6, 0.05);
  m.material('button', [0.06, 0.05, 0.04], 0.4, 0);
  const P = (n) => J[n].clone();
  // --- head & face
  const hc = P('head').add(V(0, 0.07, 0.01));
  m.ell(hc, V(0.08, 0.102, 0.095), 'head', 'skin', { blend: 0.02 });
  const jawC = hc.clone().add(V(0, -0.058, 0.032));
  const jawR = V(0.064, 0.05, 0.068);
  m.ell(jawC, jawR, 'head', 'skin', { blend: 0.03 });
  m.ell(hc.clone().add(V(0, 0.03, 0.068)), V(0.072, 0.019, 0.028), 'head', 'skin', { blend: 0.02 }); // brow ridge
  for (const s of [-1, 1]) m.ell(hc.clone().add(V(0.045 * s, -0.018, 0.064)), V(0.024, 0.018, 0.02), 'head', 'skin', { blend: 0.02 }); // cheekbones
  m.cone(hc.clone().add(V(0, 0.016, 0.088)), hc.clone().add(V(0, -0.021, 0.108)), 0.01, 0.015, 'head', 'skin', { blend: 0.012 }); // nose
  for (const s of [-1, 1]) {
    m.ell(hc.clone().add(V(0.033 * s, 0.01, 0.084)), V(0.018, 0.011, 0.011), 'head', 'skin', { sub: true, blend: 0.01 }); // socket
    m.ell(hc.clone().add(V(0.033 * s, 0.021, 0.08)), V(0.017, 0.006, 0.01), 'head', 'skin', { blend: 0.006 }); // upper lid / heavy brow
    m.attach({ type: 'eye', bone: 'head', pos: hc.clone().add(V(0.033 * s, 0.009, 0.071)).toArray(), r: 0.0118, color: [0.32, 0.24, 0.14] });
    m.ell(hc.clone().add(V(0.08 * s, 0.0, -0.004)), V(0.012, 0.028, 0.02), 'head', 'skin', { blend: 0.01 }); // ear
  }
  // beard shell hugs the jaw just outside it; lips and nose stay on top
  m.ell(jawC.clone().add(V(0, -0.006, 0.002)), jawR.clone().addScalar(0.006), 'head', 'beard', { blend: 0.02, layer: 1 });
  m.ell(hc.clone().add(V(0, -0.033, 0.094)), V(0.03, 0.008, 0.012), 'head', 'beard', { blend: 0.008, layer: 1 }); // moustache
  m.ell(hc.clone().add(V(0, -0.048, 0.093)), V(0.021, 0.0055, 0.008), 'head', 'lip', { blend: 0.005, layer: 3 });
  // beanie with folded cuff, a fringe of hair at the nape
  m.ell(hc.clone().add(V(0, 0.07, -0.008)), V(0.088, 0.072, 0.1), 'head', 'hat', { blend: 0.01, layer: 2 });
  m.ell(hc.clone().add(V(0, 0.062, -0.008)), V(0.091, 0.017, 0.103), 'head', 'hat', { blend: 0.012, layer: 2 });
  m.ell(hc.clone().add(V(0, -0.02, -0.06)), V(0.07, 0.04, 0.045), 'head', 'beard', { blend: 0.02, layer: 1 });
  // neck + scarf
  m.cone(P('neck'), P('head').add(V(0, 0.02, 0.01)), 0.052, 0.048, 'neck', 'skin', { blend: 0.03 });
  // --- torso: jacket
  const chest = P('chest');
  m.ell(chest.clone().add(V(0, -0.015, 0.0)), V(0.172, 0.19, 0.112), 'chest', 'coat', { blend: 0.06, layer: 1 });
  m.ell(P('spine').add(V(0, -0.02, 0.008)), V(0.155, 0.16, 0.108), 'spine', 'coat', { blend: 0.06, layer: 1 });
  m.ell(P('hips').add(V(0, -0.01, 0.0)), V(0.162, 0.1, 0.112), 'hips', 'coat', { blend: 0.05, layer: 1 });
  m.ell(P('hips').add(V(0, -0.075, 0.0)), V(0.168, 0.04, 0.118), 'hips', 'coat', { blend: 0.02, layer: 1 }); // hem
  // raised collar, open at the front
  m.cone(P('neck').add(V(0, -0.035, -0.012)), P('neck').add(V(0, 0.025, -0.03)), 0.078, 0.07, 'neck', 'coat', { blend: 0.03, layer: 1 });

  m.cone(P('upperArmL').add(V(-0.04, 0.0, 0)), P('upperArmR').add(V(0.04, 0, 0)), 0.064, 0.064, 'chest', 'coat', { blend: 0.05, layer: 1 }); // shoulders
  // buttons, pocket flaps
  const front = (x, y) => {
    // point on the chest/spine ellipsoids' front surface
    const c = y > P('spine').y + 0.05 ? chest.clone().add(V(0, -0.015, 0)) : P('spine').add(V(0, -0.02, 0.008));
    const rr = y > P('spine').y + 0.05 ? V(0.172, 0.19, 0.112) : V(0.155, 0.16, 0.108);
    const u = Math.max(0, 1 - (x / rr.x) ** 2 - ((y - c.y) / rr.y) ** 2);
    return V(x, y, c.z + rr.z * Math.sqrt(u));
  };
  for (let i = 0; i < 4; i++) m.ell(front(0.012, chest.y + 0.05 - i * 0.1).add(V(0, 0, 0.004)), V(0.009, 0.009, 0.004), 'chest', 'button', { blend: 0.002, layer: 3 });
  for (const s of [-1, 1]) {
    m.ell(front(0.085 * s, P('spine').y - 0.04).add(V(0, 0, 0.0)), V(0.05, 0.012, 0.012), 'spine', 'coat', { blend: 0.006, layer: 1 });
    m.ell(front(0.08 * s, chest.y + 0.06).add(V(0, 0, 0.0)), V(0.04, 0.01, 0.01), 'chest', 'coat', { blend: 0.006, layer: 1 });
  }
  // arms
  for (const s of ['L', 'R']) {
    const sg = s === 'L' ? 1 : -1;
    m.cone(P('upperArm' + s), P('foreArm' + s), 0.06, 0.05, 'upperArm' + s, 'coat', { blend: 0.03, layer: 1 });
    m.ell(P('foreArm' + s), V(0.05, 0.045, 0.05), 'foreArm' + s, 'coat', { blend: 0.03, layer: 1 }); // elbow bunching
    m.cone(P('foreArm' + s), P('hand' + s).add(V(0, 0.04, 0)), 0.05, 0.045, 'foreArm' + s, 'coat', { blend: 0.025, layer: 1 });
    m.ell(P('hand' + s).add(V(0, 0.042, 0)), V(0.048, 0.02, 0.048), 'foreArm' + s, 'coat', { blend: 0.01, layer: 1 }); // cuff
    // hand: palm, four fingers held together, thumb
    const hp = P('hand' + s);
    m.ell(hp.clone().add(V(0.004 * sg, -0.04, 0.0)), V(0.02, 0.046, 0.041), 'hand' + s, 'skin', { blend: 0.02 });
    for (let f = 0; f < 4; f++) {
      const z = -0.026 + f * 0.0175;
      m.cone(hp.clone().add(V(0.003 * sg, -0.08, z)), hp.clone().add(V(-0.004 * sg, -0.135 + Math.abs(f - 1.5) * 0.008, z + 0.006)), 0.0095, 0.0075, 'hand' + s, 'skin', { blend: 0.006 });
    }
    m.cone(hp.clone().add(V(-0.008 * sg, -0.035, 0.032)), hp.clone().add(V(-0.016 * sg, -0.08, 0.05)), 0.011, 0.0085, 'hand' + s, 'skin', { blend: 0.01 });
    // legs: trousers + boots
    m.cone(P('thigh' + s), P('shin' + s), 0.084, 0.06, 'thigh' + s, 'pants', { blend: 0.04, layer: 1 });
    m.ell(P('shin' + s).add(V(0, 0.01, 0.012)), V(0.058, 0.055, 0.056), 'shin' + s, 'pants', { blend: 0.03, layer: 1 }); // knee
    m.cone(P('shin' + s), P('foot' + s).add(V(0, 0.07, 0)), 0.058, 0.052, 'shin' + s, 'pants', { blend: 0.03, layer: 1 });
    m.cone(P('foot' + s).add(V(0, 0.09, -0.01)), P('foot' + s).add(V(0, -0.02, -0.015)), 0.056, 0.052, 'foot' + s, 'boot', { blend: 0.02, layer: 2 });
    m.box(P('foot' + s).add(V(0, -0.035, 0.05)), V(0.05, 0.04, 0.12), 0.035, 'foot' + s, 'boot', { blend: 0.03, layer: 2 });
    m.cone(P('foot' + s).add(V(0, -0.075, -0.06)), P('foot' + s).add(V(0, -0.075, 0.16)), 0.018, 0.018, 'foot' + s, 'sole', { blend: 0.035, layer: 3 });
  }
  // backpack (with flap and side pocket), bedroll, shoulder straps following the jacket
  const pack = chest.clone().add(V(0, -0.05, -0.2));
  const tilt = new THREE.Euler(0.12, 0, 0);
  m.box(pack, V(0.15, 0.2, 0.075), 0.045, 'chest', 'canvas', { blend: 0.02, layer: 3, rot: tilt });
  m.box(pack.clone().add(V(0, 0.13, -0.012)), V(0.152, 0.07, 0.085), 0.03, 'chest', 'canvas', { blend: 0.008, layer: 3, rot: tilt }); // lid flap
  m.box(pack.clone().add(V(0, -0.06, -0.085)), V(0.1, 0.08, 0.03), 0.02, 'chest', 'canvas', { blend: 0.008, layer: 3, rot: tilt }); // front pocket
  for (const s of [-1, 1]) {
    m.box(pack.clone().add(V(0.155 * s, -0.04, 0)), V(0.025, 0.09, 0.05), 0.018, 'chest', 'canvas', { blend: 0.008, layer: 3, rot: tilt }); // side pockets
    m.box(pack.clone().add(V(0.06 * s, 0.11, -0.095)), V(0.012, 0.06, 0.006), 0.004, 'chest', 'strap', { blend: 0.004, layer: 4, rot: tilt }); // lid straps
    m.cone(chest.clone().add(V(0.115 * s, 0.17, -0.2)), chest.clone().add(V(0.125 * s, 0.17, -0.2)), 0.059, 0.059, 'chest', 'strap', { blend: 0.002, layer: 4 }); // bedroll ties
  }
  m.cone(chest.clone().add(V(-0.16, 0.17, -0.2)), chest.clone().add(V(0.16, 0.17, -0.2)), 0.055, 0.055, 'chest', 'roll', { blend: 0.01, layer: 3 });
  for (const s of [-1, 1]) {
    const top = V(0.095 * s, chest.y + 0.2, chest.z - 0.02);
    const mid = front(0.095 * s, chest.y + 0.06).add(V(0, 0, 0.012));
    const low = front(0.11 * s, chest.y - 0.12).add(V(0, 0, 0.008));
    m.cone(V(0.095 * s, chest.y + 0.14, chest.z - 0.14), top, 0.012, 0.012, 'chest', 'strap', { blend: 0.004, layer: 3 });
    m.cone(top, mid, 0.012, 0.012, 'chest', 'strap', { blend: 0.004, layer: 3 });
    m.cone(mid, low, 0.012, 0.012, 'chest', 'strap', { blend: 0.004, layer: 3 });
  }
  return { ...finish(m, sk, 0.0105), height: 1.78, kind: 'human', hitboxes: humanHitboxes() };
}

function humanHitboxes() {
  return [
    { bone: 'head', zone: 'head', r: 0.11, a: [0, 0.03, 0.02], b: [0, 0.12, 0.02] },
    { bone: 'chest', zone: 'torso', r: 0.17, a: [0, -0.1, 0], b: [0, 0.12, 0] },
    { bone: 'hips', zone: 'torso', r: 0.15, a: [0, -0.05, 0], b: [0, 0.12, 0] },
    { bone: 'thighL', zone: 'limb', r: 0.08, a: [0, -0.05, 0], b: [0, -0.38, 0] },
    { bone: 'thighR', zone: 'limb', r: 0.08, a: [0, -0.05, 0], b: [0, -0.38, 0] },
    { bone: 'shinL', zone: 'limb', r: 0.06, a: [0, -0.03, 0], b: [0, -0.4, 0] },
    { bone: 'shinR', zone: 'limb', r: 0.06, a: [0, -0.03, 0], b: [0, -0.4, 0] },
    { bone: 'upperArmL', zone: 'limb', r: 0.06, a: [0, 0, 0], b: [0, -0.26, 0] },
    { bone: 'upperArmR', zone: 'limb', r: 0.06, a: [0, 0, 0], b: [0, -0.26, 0] },
    { bone: 'foreArmL', zone: 'limb', r: 0.05, a: [0, 0, 0], b: [0, -0.26, 0] },
    { bone: 'foreArmR', zone: 'limb', r: 0.05, a: [0, 0, 0], b: [0, -0.26, 0] },
  ];
}

// ------------------------------------------------------------------ night creature
export function defineCreature(seed = 7) {
  const r = mulberry32(seed);
  const m = new SDFModel();
  const H = 1.22;
  const sk = skeleton(humanJoints(H, { hunch: 0.55, armLen: 1.35, legLen: 1.05 }));
  const J = sk.world;
  m.material('hide', [0.33, 0.3, 0.28].map((c) => c * (0.85 + r() * 0.2)), 0.5, 0.3);
  m.material('dark', [0.12, 0.1, 0.1], 0.5, 0.2);
  m.material('claw', [0.1, 0.085, 0.07], 0.3, 0.05);
  m.material('teeth', [0.66, 0.6, 0.48], 0.35, 0.1);
  m.material('maw', [0.22, 0.05, 0.05], 0.4, 0.05);
  m.material('eye', [1.0, 0.92, 0.62], 0.2, 0.0);
  const P = (n) => J[n].clone();
  // elongated skull with a long jaw and deep eye pits
  const hc = P('head').add(V(0, 0.05, 0.05));
  m.ell(hc, V(0.075, 0.1, 0.13), 'head', 'hide', { blend: 0.02, rot: new THREE.Euler(-0.4, 0, 0) });
  m.ell(hc.clone().add(V(0, -0.08, 0.08)), V(0.06, 0.04, 0.1), 'head', 'hide', { blend: 0.03, rot: new THREE.Euler(-0.2, 0, 0) });
  m.ell(hc.clone().add(V(0, -0.09, 0.13)), V(0.045, 0.014, 0.06), 'head', 'maw', { sub: true, blend: 0.01 });
  m.ell(hc.clone().add(V(0, -0.095, 0.11)), V(0.035, 0.008, 0.05), 'head', 'maw', { blend: 0.004, layer: 1 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 5 - 0.5) * 1.6;
    const p = hc.clone().add(V(Math.sin(a) * 0.04, -0.077, 0.1 + Math.cos(a) * 0.065));
    m.cone(p, p.clone().add(V(0, -0.016, 0.003)), 0.0045, 0.0008, 'head', 'teeth', { blend: 0.002, layer: 2 });
  }
  m.ell(hc.clone().add(V(0, 0.06, -0.02)), V(0.02, 0.05, 0.11), 'head', 'hide', { blend: 0.03, rot: new THREE.Euler(-0.5, 0, 0) }); // crest
  for (const s of [-1, 1]) {
    m.ell(hc.clone().add(V(0.035 * s, 0.01, 0.11)), V(0.02, 0.016, 0.02), 'head', 'dark', { sub: true, blend: 0.012 });
    m.attach({ type: 'eye', bone: 'head', pos: hc.clone().add(V(0.035 * s, 0.01, 0.1)).toArray(), r: 0.009, color: [1.0, 0.85, 0.45], glow: 2.5 });
  }
  m.cone(P('neck'), P('head').add(V(0, 0.02, 0.03)), 0.045, 0.04, 'neck', 'hide', { blend: 0.03 });
  // ribcage, sunken belly, spine ridge
  m.ell(P('chest').add(V(0, -0.03, 0.0)), V(0.15, 0.19, 0.11), 'chest', 'hide', { blend: 0.05 });
  for (let i = 0; i < 5; i++) m.ell(P('chest').add(V(0, -0.13 + i * 0.045, 0.105)), V(0.11, 0.005, 0.008), 'chest', 'hide', { sub: true, blend: 0.018 });
  m.cone(P('spine'), P('hips'), 0.075, 0.09, 'spine', 'hide', { blend: 0.06 });
  m.ell(P('hips').add(V(0, 0, 0)), V(0.13, 0.09, 0.09), 'hips', 'hide', { blend: 0.04 });
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const p = P('hips').lerp(P('neck'), t).add(V(0, 0, -0.1 - Math.sin(t * Math.PI) * 0.03));
    m.ell(p, V(0.015, 0.025, 0.02), t < 0.5 ? 'spine' : 'chest', 'hide', { blend: 0.02 });
  }
  m.cone(P('upperArmL').add(V(-0.03, 0, 0)), P('upperArmR').add(V(0.03, 0, 0)), 0.05, 0.05, 'chest', 'hide', { blend: 0.05 });
  for (const s of ['L', 'R']) {
    const sg = s === 'L' ? 1 : -1;
    m.cone(P('upperArm' + s), P('foreArm' + s), 0.045, 0.032, 'upperArm' + s, 'hide', { blend: 0.025 });
    m.cone(P('foreArm' + s), P('hand' + s), 0.034, 0.024, 'foreArm' + s, 'hide', { blend: 0.02 });
    const hp = P('hand' + s);
    m.ell(hp.clone().add(V(0, -0.03, 0)), V(0.02, 0.04, 0.035), 'hand' + s, 'hide', { blend: 0.015 });
    for (let f = 0; f < 4; f++) {
      const z = -0.025 + f * 0.017;
      const base = hp.clone().add(V(0, -0.06, z));
      const tip = hp.clone().add(V(0.01 * sg, -0.2, z + 0.03));
      m.cone(base, tip, 0.008, 0.004, 'hand' + s, 'hide', { blend: 0.01 });
      m.cone(tip, tip.clone().add(V(0.004 * sg, -0.07, 0.04)), 0.0065, 0.0008, 'hand' + s, 'claw', { blend: 0.004, layer: 1 });
    }
    m.cone(P('thigh' + s), P('shin' + s), 0.065, 0.04, 'thigh' + s, 'hide', { blend: 0.035 });
    m.ell(P('shin' + s), V(0.04, 0.045, 0.045), 'shin' + s, 'hide', { blend: 0.03 }); // knee
    m.cone(P('shin' + s), P('foot' + s), 0.04, 0.026, 'shin' + s, 'hide', { blend: 0.025 });
    m.cone(P('foot' + s), P('foot' + s).add(V(0, -0.05, 0.17)), 0.03, 0.02, 'foot' + s, 'hide', { blend: 0.02 });
    for (let f = -1; f <= 1; f++) m.cone(P('foot' + s).add(V(f * 0.02, -0.06, 0.17)), P('foot' + s).add(V(f * 0.025, -0.08, 0.22)), 0.007, 0.001, 'foot' + s, 'claw', { blend: 0.004, layer: 1 });
  }
  const hb = humanHitboxes().map((h) => ({ ...h, r: h.r * 0.85 }));
  return { ...finish(m, sk, 0.0115), height: 2.1, kind: 'human', hitboxes: hb };
}

// ------------------------------------------------------------------ jackrabbit
export function defineRabbit(seed = 3) {
  const r = mulberry32(seed);
  const m = new SDFModel();
  const sk = skeleton([
    ['body', null, [0, 0.16, 0]],
    ['chest', 'body', [0, 0.17, 0.09]],
    ['head', 'chest', [0, 0.24, 0.16]],
    ['earL', 'head', [0.022, 0.29, 0.15]],
    ['earR', 'head', [-0.022, 0.29, 0.15]],
    ['frontL', 'chest', [0.035, 0.12, 0.12]],
    ['frontR', 'chest', [-0.035, 0.12, 0.12]],
    ['hindL', 'body', [0.05, 0.13, -0.06]],
    ['hindFootL', 'hindL', [0.05, 0.03, -0.06]],
    ['hindR', 'body', [-0.05, 0.13, -0.06]],
    ['hindFootR', 'hindR', [-0.05, 0.03, -0.06]],
    ['tail', 'body', [0, 0.16, -0.13]],
  ]);
  const J = sk.world;
  const P = (n) => J[n].clone();
  const fur = [0.56, 0.45, 0.32].map((c) => c * (0.9 + r() * 0.2));
  m.material('fur', fur, 1, 0.18);
  m.material('belly', [0.78, 0.74, 0.66], 1, 0.1);
  m.material('earIn', [0.75, 0.55, 0.5], 0.8, 0.05);
  m.material('eye', [0.04, 0.03, 0.02], 0.15, 0);
  m.material('nose', [0.35, 0.25, 0.22], 0.5, 0);
  m.ell(P('body').add(V(0, 0.0, -0.03)), V(0.075, 0.08, 0.12), 'body', 'fur', { blend: 0.04 });
  m.ell(P('body').add(V(0, -0.03, 0.0)), V(0.06, 0.05, 0.1), 'body', 'belly', { blend: 0.03, layer: 0 });
  m.ell(P('chest'), V(0.06, 0.065, 0.07), 'chest', 'fur', { blend: 0.04 });
  const hc = P('head');
  m.ell(hc, V(0.04, 0.042, 0.055), 'head', 'fur', { blend: 0.03, rot: new THREE.Euler(0.3, 0, 0) });
  m.ell(hc.clone().add(V(0, -0.012, 0.045)), V(0.025, 0.024, 0.026), 'head', 'fur', { blend: 0.02 });
  m.ell(hc.clone().add(V(0, -0.006, 0.07)), V(0.008, 0.006, 0.005), 'head', 'nose', { blend: 0.005, layer: 1 });
  for (const s of [-1, 1]) {
    m.attach({ type: 'eye', bone: 'head', pos: hc.clone().add(V(0.031 * s, 0.01, 0.016)).toArray(), r: 0.0095, color: [0.12, 0.07, 0.03], look: [0, 1.25 * s] });
    const e = P(s > 0 ? 'earL' : 'earR');
    m.ell(e.clone().add(V(0.01 * s, 0.075, -0.02)), V(0.018, 0.085, 0.007), s > 0 ? 'earL' : 'earR', 'fur', { blend: 0.01, rot: new THREE.Euler(-0.25, 0, -0.2 * s) });
    m.ell(e.clone().add(V(0.01 * s, 0.075, -0.014)), V(0.012, 0.07, 0.003), s > 0 ? 'earL' : 'earR', 'earIn', { blend: 0.004, layer: 1, rot: new THREE.Euler(-0.25, 0, -0.2 * s) });
    const fs = s > 0 ? 'L' : 'R';
    m.cone(P('front' + fs), P('front' + fs).add(V(0, -0.11, 0.015)), 0.014, 0.01, 'front' + fs, 'fur', { blend: 0.015 });
    m.ell(P('hind' + fs).add(V(0, -0.01, 0.01)), V(0.035, 0.06, 0.06), 'hind' + fs, 'fur', { blend: 0.03 });
    m.cone(P('hindFoot' + fs), P('hindFoot' + fs).add(V(0, -0.018, 0.11)), 0.016, 0.012, 'hindFoot' + fs, 'fur', { blend: 0.015 });
  }
  m.ell(P('tail'), V(0.025, 0.025, 0.022), 'tail', 'belly', { blend: 0.02, layer: 1 });
  return { ...finish(m, sk, 0.0045), height: 0.3, kind: 'rabbit', hitboxes: [{ bone: 'body', zone: 'torso', r: 0.09, a: [0, 0, -0.08], b: [0, 0.05, 0.1] }, { bone: 'head', zone: 'head', r: 0.045, a: [0, 0, 0], b: [0, 0, 0.05] }] };
}

// ------------------------------------------------------------------ coyote
export function defineCoyote(seed = 5) {
  const r = mulberry32(seed);
  const m = new SDFModel();
  const sk = skeleton([
    ['hips', null, [0, 0.55, -0.32]],
    ['chest', 'hips', [0, 0.58, 0.18]],
    ['neck', 'chest', [0, 0.66, 0.32]],
    ['head', 'neck', [0, 0.74, 0.44]],
    ['jaw', 'head', [0, 0.71, 0.48]],
    ['tail', 'hips', [0, 0.55, -0.42]],
    ['upperFL', 'chest', [0.09, 0.5, 0.24]],
    ['lowerFL', 'upperFL', [0.09, 0.3, 0.22]],
    ['pawFL', 'lowerFL', [0.09, 0.05, 0.24]],
    ['upperFR', 'chest', [-0.09, 0.5, 0.24]],
    ['lowerFR', 'upperFR', [-0.09, 0.3, 0.22]],
    ['pawFR', 'lowerFR', [-0.09, 0.05, 0.24]],
    ['upperHL', 'hips', [0.09, 0.5, -0.36]],
    ['lowerHL', 'upperHL', [0.09, 0.3, -0.28]],
    ['pawHL', 'lowerHL', [0.09, 0.05, -0.36]],
    ['upperHR', 'hips', [-0.09, 0.5, -0.36]],
    ['lowerHR', 'upperHR', [-0.09, 0.3, -0.28]],
    ['pawHR', 'lowerHR', [-0.09, 0.05, -0.36]],
  ]);
  const J = sk.world;
  const P = (n) => J[n].clone();
  const fur = [0.6, 0.46, 0.3].map((c) => c * (0.9 + r() * 0.2));
  m.material('fur', fur, 1, 0.2);
  m.material('dark', fur.map((c) => c * 0.62), 1, 0.2);
  m.material('light', [0.82, 0.77, 0.68], 1, 0.1);
  m.material('eye', [0.12, 0.08, 0.03], 0.15, 0);
  m.material('nose', [0.06, 0.05, 0.05], 0.4, 0);
  m.ell(P('chest').add(V(0, -0.02, 0)), V(0.12, 0.15, 0.17), 'chest', 'fur', { blend: 0.06 });
  m.ell(P('hips').add(V(0, 0, 0.06)), V(0.1, 0.11, 0.15), 'hips', 'fur', { blend: 0.06 });
  m.cone(P('hips').add(V(0, 0.02, 0.1)), P('chest').add(V(0, 0.02, -0.08)), 0.1, 0.11, 'hips', 'fur', { blend: 0.05 });
  m.ell(P('chest').add(V(0, -0.1, 0.05)), V(0.08, 0.06, 0.12), 'chest', 'light', { blend: 0.03, layer: 1 });
  m.cone(P('chest').add(V(0, 0.04, 0.08)), P('head').add(V(0, -0.02, -0.04)), 0.09, 0.06, 'neck', 'fur', { blend: 0.05 });
  // dark saddle along the back
  m.ell(P('hips').lerp(P('chest'), 0.5).add(V(0, 0.085, 0)), V(0.06, 0.035, 0.26), 'hips', 'dark', { blend: 0.04, layer: 1 });
  const hc = P('head');
  m.ell(hc, V(0.065, 0.06, 0.075), 'head', 'fur', { blend: 0.03 });
  m.cone(hc.clone().add(V(0, -0.005, 0.04)), hc.clone().add(V(0, -0.025, 0.15)), 0.04, 0.018, 'head', 'fur', { blend: 0.03 });
  m.ell(hc.clone().add(V(0, -0.02, 0.155)), V(0.014, 0.011, 0.01), 'head', 'nose', { blend: 0.006, layer: 1 });
  m.cone(P('jaw').add(V(0, -0.015, 0.0)), P('jaw').add(V(0, -0.035, 0.09)), 0.025, 0.012, 'jaw', 'light', { blend: 0.02 });
  for (const s of [-1, 1]) {
    m.ell(hc.clone().add(V(0.033 * s, 0.022, 0.056)), V(0.013, 0.009, 0.008), 'head', 'dark', { sub: true, blend: 0.006 });
    m.attach({ type: 'eye', bone: 'head', pos: hc.clone().add(V(0.033 * s, 0.022, 0.05)).toArray(), r: 0.0085, color: [0.62, 0.45, 0.14], look: [0, 0.35 * s] });
    m.cone(hc.clone().add(V(0.04 * s, 0.04, -0.01)), hc.clone().add(V(0.05 * s, 0.13, -0.02)), 0.028, 0.004, 'head', 'fur', { blend: 0.015 });
  }
  for (const leg of ['FL', 'FR', 'HL', 'HR']) {
    const front = leg[0] === 'F';
    m.cone(P('upper' + leg), P('lower' + leg), front ? 0.045 : 0.06, 0.03, 'upper' + leg, 'fur', { blend: 0.04 });
    m.cone(P('lower' + leg), P('paw' + leg), 0.026, 0.02, 'lower' + leg, 'fur', { blend: 0.02 });
    m.ell(P('paw' + leg).add(V(0, -0.02, 0.03)), V(0.025, 0.018, 0.04), 'paw' + leg, 'dark', { blend: 0.015 });
  }
  // bushy tail with a dark tip
  const t0 = P('tail');
  m.cone(t0, t0.clone().add(V(0, -0.2, -0.22)), 0.04, 0.06, 'tail', 'fur', { blend: 0.03 });
  m.cone(t0.clone().add(V(0, -0.2, -0.22)), t0.clone().add(V(0, -0.32, -0.3)), 0.06, 0.02, 'tail', 'dark', { blend: 0.03 });
  return {
    ...finish(m, sk, 0.009),
    height: 0.75,
    kind: 'quad',
    hitboxes: [
      { bone: 'chest', zone: 'torso', r: 0.15, a: [0, 0, -0.1], b: [0, 0, 0.1] },
      { bone: 'hips', zone: 'torso', r: 0.12, a: [0, 0, 0], b: [0, 0, 0.25] },
      { bone: 'head', zone: 'head', r: 0.07, a: [0, 0, 0], b: [0, -0.02, 0.12] },
    ],
  };
}

export const DEFINE = { vagrant: defineVagrant, creature: defineCreature, rabbit: defineRabbit, coyote: defineCoyote };
export const CHARACTER_BUILDERS = Object.fromEntries(Object.keys(DEFINE).map((k) => [k, (seed) => buildCharacter(k, seed)]));
