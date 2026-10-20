// Procedural components for imported cars whose source model lacks them: battery, radiator,
// accessory belt, air filter box, an inline-four engine, fuel tank and spare wheel. Positions are
// in car space; each returns a Group to hand to model.addPart().

import * as THREE from 'three';
import { roundedBox, tubeAlong } from '../../gfx/geom.js';
import { makeCanvas, canvasTexture } from '../../gfx/textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

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
  return g;
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
  return g;
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
  return g;
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
  // pulley end
  mesh(g, new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24).rotateZ(Math.PI / 2).translate(len / 2 + 0.02, -0.08, 0.02), M.steel);
  mesh(g, new THREE.CylinderGeometry(0.045, 0.045, 0.03, 20).rotateZ(Math.PI / 2).translate(len / 2 + 0.02, 0.12, 0.12), M.steel);
  mesh(g, roundedBox(0.1, 0.12, 0.12, 0.03, 2).translate(len / 2 - 0.06, 0.12, 0.12), M.alu);
  g.rotation.y = rot;
  g.position.copy(at);
  return g;
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
