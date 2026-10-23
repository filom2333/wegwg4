// Procedural components for imported cars whose source model lacks them: battery, radiator,
// accessory belt, air filter box, an inline-four engine, fuel tank and spare wheel. Positions are
// in car space; each returns a Group to hand to model.addPart().

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roundedBox, tubeAlong } from '../../gfx/geom.js';
import { makeCanvas, canvasTexture } from '../../gfx/textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// shared by every car's ancillaries
const RED_CABLE = new THREE.MeshStandardMaterial({ color: 0xa52219, roughness: 0.5 });
const PORCELAIN = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.35 });
const CASE_BLACK = new THREE.MeshStandardMaterial({ color: 0x1b1c1d, metalness: 0.4, roughness: 0.5 });

// One mesh per material: a part built from dozens of little pieces draws in a few calls.
function bake(g) {
  const byMat = new Map();
  for (const c of g.children) {
    if (!c.isMesh) continue;
    c.updateMatrix();
    let geo = c.geometry.clone().applyMatrix4(c.matrix);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(geo);
  }
  const out = new THREE.Group();
  out.position.copy(g.position);
  out.rotation.copy(g.rotation);
  for (const [mat, geos] of byMat) {
    const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0];
    if (!merged) return g;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = m.receiveShadow = true;
    out.add(m);
  }
  return out;
}

function mesh(g, geo, mat, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

let batteryLabel = null;
export function battery(M, at, { rotY = 0, size = [0.175, 0.19, 0.24], brand = 'VOLTEX', spec = '12V  55Ah' } = {}) {
  if (!batteryLabel) {
    const c = makeCanvas(256, 128);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#2a64c8';
    ctx.fillRect(0, 0, 256, 24);
    ctx.fillStyle = '#e8e2d4';
    ctx.font = 'bold 34px Arial';
    ctx.fillText(brand, 14, 70);
    ctx.font = '20px Arial';
    ctx.fillText(spec, 14, 104);
    const t = canvasTexture(c, { wrap: false });
    t.colorSpace = THREE.SRGBColorSpace;
    batteryLabel = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 });
  }
  const g = new THREE.Group();
  const [w, h, d] = size;
  const body = roundedBox(w, h, d, 0.007, 2);
  const uv = body.attributes.uv,
    ps = body.attributes.position;
  for (let i = 0; i < ps.count; i++) uv.setXY(i, -ps.getZ(i) / d + 0.5, ps.getY(i) / h + 0.5);
  mesh(g, body, batteryLabel);
  mesh(g, roundedBox(w + 0.002, 0.02, d + 0.002, 0.006, 2).translate(0, h / 2, 0), M.plastic);
  const red = new THREE.MeshStandardMaterial({ color: 0xb3261b, roughness: 0.5 });
  for (const [dz, mat] of [
    [d * 0.32, red],
    [-d * 0.32, M.plastic],
  ]) {
    mesh(g, new THREE.CylinderGeometry(0.01, 0.012, 0.022, 12).translate(-w * 0.25, h / 2 + 0.018, dz), M.steel, false);
    mesh(g, roundedBox(0.03, 0.018, 0.032, 0.005, 2).translate(-w * 0.25, h / 2 + 0.028, dz), mat, false);
  }
  mesh(g, tubeAlong([V(-w * 0.25, h / 2 + 0.035, d * 0.32), V(-w * 0.3, h / 2 + 0.08, d * 0.2), V(-w * 0.6, h / 2 + 0.02, -d * 0.1)], 0.007, 8), red, false);
  g.rotation.y = rotY;
  g.position.copy(at);
  return bake(g);
}

// Radiator core with tanks and a filler cap; `at` is the core centre, facing +Z.
export function radiator(M, at, { w = 0.6, h = 0.36 } = {}) {
  const g = new THREE.Group();
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x2a2c2d, metalness: 0.6, roughness: 0.6 });
  mesh(g, new THREE.BoxGeometry(w, h, 0.03), coreMat);
  // fins: a few horizontal ribs read as a core at a glance
  for (let i = 0; i < 9; i++) mesh(g, new THREE.BoxGeometry(w - 0.02, 0.004, 0.034).translate(0, -h / 2 + ((i + 0.5) * h) / 9, 0), M.alu, false);
  for (const s of [1, -1]) mesh(g, roundedBox(0.05, h + 0.04, 0.06, 0.01, 2).translate(s * (w / 2 + 0.02), 0, 0), M.plastic);
  mesh(g, new THREE.CylinderGeometry(0.02, 0.022, 0.03, 14).translate(w / 2 + 0.02, h / 2 + 0.035, 0), M.steel);
  mesh(g, new THREE.CylinderGeometry(0.03, 0.03, 0.012, 16).translate(w / 2 + 0.02, h / 2 + 0.055, 0), M.chrome);
  // hoses back to the engine
  const hose = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.75 });
  mesh(g, tubeAlong([V(w / 2 - 0.05, h / 2 - 0.05, -0.02), V(w / 2 - 0.1, h / 2, -0.15), V(w / 2 - 0.25, h / 2 - 0.02, -0.3)], 0.018, 8), hose, false);
  mesh(g, tubeAlong([V(-w / 2 + 0.05, -h / 2 + 0.05, -0.02), V(-w / 2 + 0.1, -h / 2, -0.18), V(-w / 2 + 0.3, -h / 2 + 0.05, -0.35)], 0.018, 8), hose, false);
  g.position.copy(at);
  return bake(g);
}

// Accessory belt round two pulleys in the plane x = const (crank and alternator).
export function belt(a, b, { plane = 'x' } = {}) {
  const pts = [];
  const d = b.c.clone().sub(a.c);
  const L = d.length();
  const ang = Math.atan2(d.y, plane === 'x' ? d.z : d.x);
  const beta = Math.acos((a.r - b.r) / L);
  const put = (cc, r, t) => (plane === 'x' ? V(cc.x, cc.y + Math.sin(t) * r, cc.z + Math.cos(t) * r) : V(cc.x + Math.cos(t) * r, cc.y + Math.sin(t) * r, cc.z));
  for (let i = 0; i <= 18; i++) pts.push(put(a.c, a.r, ang + beta + ((Math.PI * 2 - 2 * beta) * i) / 18));
  for (let i = 0; i <= 10; i++) pts.push(put(b.c, b.r, ang - beta + (2 * beta * i) / 10));
  pts.push(pts[0].clone());
  const g = new THREE.Group();
  mesh(g, tubeAlong(pts, 0.006, 6, { closedEnds: false }), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 }));
  return g;
}

export function airFilter(M, at, { w = 0.3, h = 0.1, d = 0.22 } = {}) {
  const g = new THREE.Group();
  mesh(g, roundedBox(w, h, d, 0.02, 3), M.plastic);
  mesh(g, roundedBox(w * 0.9, 0.012, d * 0.9, 0.006, 2).translate(0, h / 2, 0), M.black, false);
  mesh(g, tubeAlong([V(-w / 2, 0, 0), V(-w / 2 - 0.08, -0.02, -0.04), V(-w / 2 - 0.12, -0.06, -0.16)], 0.035, 12), M.rubber, false);
  g.position.copy(at);
  return bake(g);
}

// Transverse inline four: block, head, cam cover, intake and exhaust manifolds, pulleys.
export function inlineFour(M, at, { len = 0.5, rot = 0 } = {}) {
  const g = new THREE.Group();
  const block = new THREE.MeshStandardMaterial({ color: 0x4a4d50, metalness: 0.45, roughness: 0.6 });
  mesh(g, roundedBox(len, 0.3, 0.26, 0.02, 2).translate(0, 0, 0), block);
  mesh(g, roundedBox(len * 0.98, 0.1, 0.24, 0.02, 2).translate(0, 0.2, -0.01), M.alu);
  mesh(g, roundedBox(len * 0.9, 0.06, 0.2, 0.03, 3).translate(0, 0.28, -0.01), new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.3, roughness: 0.45 }));
  // oil filler cap on the cam cover
  mesh(g, new THREE.CylinderGeometry(0.025, 0.025, 0.02, 16).translate(len * 0.25, 0.32, -0.02), M.plastic);
  for (let i = 0; i < 4; i++) {
    const x = -len * 0.36 + (i * len * 0.72) / 3;
    mesh(g, tubeAlong([V(x, 0.2, -0.13), V(x, 0.14, -0.22), V(x * 0.5, 0.0, -0.26)], 0.02, 8), M.steel, false);
    mesh(g, tubeAlong([V(x, 0.2, 0.13), V(x, 0.28, 0.22), V(x * 0.7, 0.32, 0.24)], 0.022, 8), M.alu, false);
  }
  mesh(g, roundedBox(len * 0.8, 0.07, 0.07, 0.02, 2).translate(0, 0.33, 0.24), M.alu);
  mesh(g, roundedBox(len * 0.95, 0.12, 0.22, 0.02, 2).translate(0, -0.21, 0), block);
  // crank pulley and timing cover (the alternator and water pump are parts of their own)
  mesh(g, new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24).rotateZ(Math.PI / 2).translate(len / 2 + 0.1, -0.08, 0.0), M.steel);
  mesh(g, new THREE.CylinderGeometry(0.03, 0.03, 0.09, 14).rotateZ(Math.PI / 2).translate(len / 2 + 0.05, -0.08, 0.0), M.steel, false);
  mesh(g, roundedBox(0.03, 0.34, 0.22, 0.02, 2).translate(len / 2 + 0.005, 0.02, 0), block);
  g.rotation.y = rot;
  g.position.copy(at);
  return bake(g);
}

export function fuelTank(at, { w = 0.7, h = 0.2, d = 0.42 } = {}) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2d2f2c, metalness: 0.55, roughness: 0.55 });
  mesh(g, roundedBox(w, h, d, 0.05, 3), mat);
  mesh(g, roundedBox(w + 0.02, 0.012, d + 0.015, 0.005, 1), mat, false);
  g.position.copy(at);
  return g;
}

// Spare wheel lying flat in the boot well.
export function spareWheel(model, at) {
  const g = new THREE.Group();
  for (const { geometry, mat } of model.asset.parts.tyre || []) {
    const m = new THREE.Mesh(geometry, model.mats.byName[mat] || model.mats.tyre);
    m.rotation.z = Math.PI / 2;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  g.position.copy(at);
  return g;
}

// Ancillaries are built along +X with the pulley at the +X end; `face` turns that end to the
// belt side: 'x' (a transverse engine's left end), 'z' (a longitudinal engine's nose), '-x', '-z'.
function facing(g, face) {
  if (face === 'z') g.rotation.y = -Math.PI / 2;
  else if (face === '-z') g.rotation.y = Math.PI / 2;
  else if (face === '-x') g.rotation.y = Math.PI;
  return g;
}
const alongX = (geo) => geo.rotateZ(-Math.PI / 2);

function pulley(g, M, x, r, w = 0.022) {
  mesh(g, alongX(new THREE.CylinderGeometry(r, r, w, 28)).translate(x, 0, 0), M.steel);
  // the groove reads as a darker band
  mesh(g, alongX(new THREE.CylinderGeometry(r * 0.86, r * 0.86, w * 0.5, 24)).translate(x, 0, 0), M.black, false);
  mesh(g, alongX(new THREE.CylinderGeometry(r * 0.3, r * 0.3, w + 0.008, 12)).translate(x, 0, 0), M.alu, false);
}

// Alternator: ribbed aluminium case, cooling fan behind the pulley, the B+ terminal in a red boot.
export function alternator(M, at, { face = 'x', r = 0.062, len = 0.13, pulleyR = 0.035 } = {}) {
  const g = new THREE.Group();
  mesh(g, alongX(new THREE.CylinderGeometry(r, r, len, 28)), M.alu);
  for (let i = 0; i < 5; i++) mesh(g, alongX(new THREE.CylinderGeometry(r + 0.004, r + 0.004, 0.008, 28)).translate(-len * 0.35 + (i * len * 0.7) / 4, 0, 0), M.steel, false);
  mesh(g, alongX(new THREE.CylinderGeometry(r * 0.82, r, 0.025, 24)).translate(-len / 2 - 0.012, 0, 0), M.plastic, false);
  // fan: a disc of blades between the case and the pulley
  mesh(g, alongX(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.012, 20)).translate(len / 2 + 0.01, 0, 0), M.steel, false);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    mesh(g, new THREE.BoxGeometry(0.012, 0.004, r * 0.8).translate(0, 0, r * 0.45).rotateX(a).translate(len / 2 + 0.02, 0, 0), M.steel, false);
  }
  pulley(g, M, len / 2 + 0.042, pulleyR);
  // mounting ears and the terminal
  mesh(g, roundedBox(0.03, 0.03, 0.05, 0.008, 2).translate(-len * 0.2, -r - 0.012, 0), M.alu, false);
  mesh(g, roundedBox(0.03, 0.03, 0.05, 0.008, 2).translate(len * 0.25, r + 0.01, 0), M.alu, false);
  mesh(g, new THREE.CylinderGeometry(0.009, 0.012, 0.03, 10).rotateX(Math.PI / 2).translate(-len / 2 - 0.02, r * 0.4, 0.02), RED_CABLE, false);
  mesh(g, tubeAlong([V(-len / 2 - 0.02, r * 0.4, 0.035), V(-len / 2 - 0.05, r * 0.6, 0.08), V(-len / 2 - 0.12, r * 0.2, 0.12)], 0.006, 6), M.black, false);
  g.position.copy(at);
  return bake(facing(g, face));
}

// Starter motor: black can, the solenoid riding on top, aluminium nose with the pinion.
export function starter(M, at, { face = 'x', len = 0.17 } = {}) {
  const g = new THREE.Group();
  mesh(g, alongX(new THREE.CylinderGeometry(0.043, 0.043, len, 22)), CASE_BLACK);
  mesh(g, alongX(new THREE.CylinderGeometry(0.036, 0.043, 0.02, 22)).translate(-len / 2 - 0.01, 0, 0), M.steel, false);
  mesh(g, alongX(new THREE.CylinderGeometry(0.03, 0.04, 0.07, 18)).translate(len / 2 + 0.035, -0.008, 0), M.alu);
  mesh(g, alongX(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10)).translate(len / 2 + 0.078, -0.008, 0), M.steel, false);
  mesh(g, alongX(new THREE.CylinderGeometry(0.026, 0.026, 0.1, 18)).translate(len * 0.12, 0.062, 0), M.steel);
  mesh(g, new THREE.CylinderGeometry(0.008, 0.008, 0.02, 8).translate(len * 0.05, 0.095, 0), M.chrome, false);
  // flange bolting it to the bell housing
  mesh(g, roundedBox(0.012, 0.11, 0.09, 0.01, 2).translate(len / 2 + 0.002, 0, 0), M.alu, false);
  mesh(g, tubeAlong([V(len * 0.05, 0.1, 0), V(len * 0.05, 0.14, 0.05), V(-len * 0.3, 0.12, 0.12)], 0.007, 6), RED_CABLE, false);
  g.position.copy(at);
  return bake(facing(g, face));
}

// Water pump on the block's front: cast housing, outlet stub to the radiator hose, the pulley.
export function waterPump(M, at, { face = 'x', pulleyR = 0.05 } = {}) {
  const g = new THREE.Group();
  mesh(g, roundedBox(0.05, 0.11, 0.11, 0.02, 3), M.alu);
  mesh(g, alongX(new THREE.CylinderGeometry(0.022, 0.03, 0.05, 16)).translate(0.045, 0, 0), M.alu, false);
  mesh(g, new THREE.CylinderGeometry(0.016, 0.016, 0.05, 12).rotateX(Math.PI / 2).translate(0, 0.035, 0.07), M.alu, false);
  mesh(g, tubeAlong([V(0, 0.035, 0.09), V(0.01, 0.06, 0.15), V(0.0, 0.1, 0.2)], 0.017, 8), M.rubber, false);
  for (const [y, z] of [
    [0.045, 0.045],
    [-0.045, 0.045],
    [0.045, -0.045],
    [-0.045, -0.045],
  ])
    mesh(g, alongX(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 6)).translate(0.028, y, z), M.steel, false);
  pulley(g, M, 0.085, pulleyR, 0.02);
  g.position.copy(at);
  return bake(facing(g, face));
}

// Spin-on oil filter: painted can with a label band, standing on its housing.
let filterMat = null;
export function oilFilter(M, at, { r = 0.042, h = 0.11, tilt = 0 } = {}) {
  if (!filterMat) {
    const c = makeCanvas(128, 64);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1f4f9a';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#e9e4d8';
    ctx.fillRect(0, 22, 128, 20);
    ctx.fillStyle = '#1f4f9a';
    ctx.font = 'bold 15px Arial';
    for (let x = 4; x < 128; x += 64) ctx.fillText('FILTRO', x, 37);
    const t = canvasTexture(c, { wrap: true });
    t.colorSpace = THREE.SRGBColorSpace;
    filterMat = new THREE.MeshStandardMaterial({ map: t, metalness: 0.35, roughness: 0.4 });
  }
  const g = new THREE.Group();
  mesh(g, new THREE.CylinderGeometry(r, r, h, 24, 1, false), filterMat);
  mesh(g, new THREE.CylinderGeometry(r * 0.94, r, 0.012, 24).translate(0, -h / 2 - 0.006, 0), M.steel, false);
  mesh(g, new THREE.CylinderGeometry(r * 0.7, r * 0.94, 0.012, 20).translate(0, h / 2 + 0.006, 0), M.steel, false);
  mesh(g, new THREE.CylinderGeometry(r * 1.1, r * 1.1, 0.025, 6).translate(0, h / 2 + 0.024, 0), M.alu, false);
  g.rotation.z = tilt;
  g.position.copy(at);
  return bake(g);
}

// Spark plugs with their leads: a boot on each plug point, leads looping to `to` where a
// distributor cap sits (or, `coils`: a coil on each plug and a loom along the top).
// arch: how much higher a lead rises per metre of its length (kept low under a flat bonnet)
export function plugLeads(M, plugs, { to = null, coils = false, up = 0.03, arch = 0.12 } = {}) {
  const g = new THREE.Group();
  const boot = new THREE.MeshStandardMaterial({ color: coils ? 0x3a3c3f : 0x8a1c14, roughness: coils ? 0.45 : 0.55 });
  const plugTop = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.5 });
  const lead = new THREE.MeshStandardMaterial({ color: coils ? 0x111111 : 0x262626, roughness: 0.7 });
  for (const p of plugs) {
    // the white insulator just shows under the boot
    mesh(g, new THREE.CylinderGeometry(0.008, 0.009, 0.025, 10).translate(p.x, p.y + 0.008, p.z), PORCELAIN, false);
    if (coils) {
      mesh(g, new THREE.CylinderGeometry(0.014, 0.012, 0.06, 12).translate(p.x, p.y + 0.045, p.z), boot, false);
      mesh(g, roundedBox(0.045, 0.028, 0.05, 0.008, 2).translate(p.x, p.y + 0.085, p.z), boot);
      mesh(g, roundedBox(0.018, 0.014, 0.024, 0.004, 1).translate(p.x + 0.025, p.y + 0.09, p.z), plugTop, false);
    } else {
      mesh(g, new THREE.CylinderGeometry(0.011, 0.013, 0.05, 12).translate(p.x, p.y + 0.04, p.z), boot, false);
    }
  }
  if (coils) {
    // the loom runs along the coils' plug sides
    const pts = plugs.map((p) => V(p.x + 0.03, p.y + 0.095, p.z));
    mesh(g, tubeAlong([pts[0].clone().add(V(0, 0, -0.05)), ...pts, pts[pts.length - 1].clone().add(V(0.02, -0.02, 0.08))], 0.009, 8), lead, false);
  } else if (to) {
    for (const [i, p] of plugs.entries()) {
      const a = V(p.x, p.y + 0.065, p.z);
      const b = to.clone().add(V(Math.cos((i / plugs.length) * Math.PI * 2) * 0.022, 0.03, Math.sin((i / plugs.length) * Math.PI * 2) * 0.022));
      // longer leads arch higher over what lies between
      const mid = a.clone().lerp(b, 0.5).add(V(0, up + arch * a.distanceTo(b), 0));
      mesh(g, tubeAlong([a, a.clone().add(V(0, 0.03, 0)), mid, b.clone().add(V(0, 0.03, 0)), b], 0.0045, 6), lead, false);
    }
    // distributor: cap and body on the head
    mesh(g, new THREE.CylinderGeometry(0.036, 0.04, 0.045, 20).translate(to.x, to.y + 0.01, to.z), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5 }));
    mesh(g, new THREE.CylinderGeometry(0.028, 0.028, 0.05, 16).translate(to.x, to.y - 0.035, to.z), M.alu, false);
  }
  return bake(g);
}

// A belt round any number of pulleys ({c, r}) in one plane: the convex outline they make.
export function beltLoop(pulleys, { plane = 'x' } = {}) {
  const P = [];
  const u = (v) => (plane === 'x' ? v.z : v.x);
  for (const p of pulleys)
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      P.push([u(p.c) + Math.cos(t) * p.r, p.c.y + Math.sin(t) * p.r]);
    }
  // monotone chain hull
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [],
    hi = [];
  for (const p of P) {
    while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (const p of P.slice().reverse()) {
    while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop();
    hi.push(p);
  }
  const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
  const k = plane === 'x' ? pulleys[0].c.x : pulleys[0].c.z;
  const pts = hull.map(([a, y]) => (plane === 'x' ? V(k, y, a) : V(a, y, k)));
  pts.push(pts[0].clone());
  const g = new THREE.Group();
  mesh(g, tubeAlong(pts, 0.006, 6, { closedEnds: false }), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 }));
  return g;
}
