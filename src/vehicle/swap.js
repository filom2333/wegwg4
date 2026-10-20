// Parts from another kind of car. Any part fits the slot of the same name on any car: body
// panels are stretched to the opening they bolt into, mechanical parts keep their proportions
// (shrunk if they would not fit), wheels are scaled to the hub. An engine brings its own torque,
// revs and voice; the gearbox stays with the car.

import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PANELS = /^(door_|hood|trunk|fender_|bumper_|headlight_|taillight_)/;

// The source part's meshes at rest in its own car space (shared geometry and materials).
function sourceMeshes(srcModel, id) {
  const src = srcModel.parts[id];
  const out = [];
  if (!src) return out;
  srcModel.root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(srcModel.root.matrixWorld).invert();
  const savedQ = src.pivot.quaternion.clone();
  src.pivot.quaternion.identity();
  src.pivot.updateMatrixWorld(true);
  src.inner.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Mesh(o.geometry, o.material);
    m.applyMatrix4(rootInv.clone().multiply(o.matrixWorld));
    m.castShadow = o.castShadow;
    m.receiveShadow = o.receiveShadow;
    m.renderOrder = o.renderOrder;
    m.userData.shared = true;
    out.push(m);
  });
  src.pivot.quaternion.copy(savedQ);
  src.pivot.updateMatrixWorld(true);
  return out;
}

// Scale (and drop) that takes a part of size `src` centred at the origin into a slot of size
// `dst` centred at the origin: panels fill the opening, mechanical parts keep their proportions
// (shrunk if they would not fit) and sit on its floor.
export function fitMatrix(id, src, dst) {
  const ss = src.clone().max(V(0.01, 0.01, 0.01));
  const k = dst.clone().divide(ss);
  if (PANELS.test(id)) return new THREE.Matrix4().makeScale(k.x, k.y, k.z);
  const u = Math.min(1, k.x, k.y, k.z);
  return new THREE.Matrix4().makeTranslation(0, (ss.y * u - dst.y) / 2, 0).multiply(new THREE.Matrix4().makeScale(u, u, u));
}

// A group in the slot's car space holding the foreign part fitted to the slot's box.
export function fittedPart(car, id, srcModel) {
  const slot = car.model.parts[id];
  const meshes = sourceMeshes(srcModel, id);
  const g = new THREE.Group();
  g.name = 'foreign:' + id;
  if (!meshes.length) return g;
  const sb = srcModel.parts[id].bbox,
    db = slot.nativeBox || slot.bbox;
  const sc = sb.getCenter(V(0, 0, 0)),
    dc = db.getCenter(V(0, 0, 0));
  const m = new THREE.Matrix4()
    .makeTranslation(dc.x, dc.y, dc.z)
    .multiply(fitMatrix(id, sb.getSize(V(0, 0, 0)), db.getSize(V(0, 0, 0))))
    .multiply(new THREE.Matrix4().makeTranslation(-sc.x, -sc.y, -sc.z));
  for (const mesh of meshes) {
    mesh.applyMatrix4(m);
    g.add(mesh);
  }
  return g;
}

// Puts a part of type `fromType` (or the car's own, null) into slot `id` of `car`'s model.
export function setPartSource(car, id, srcModel, fromType) {
  const mp = car.model.parts[id];
  if (!mp) return;
  const wheel = car.model.wheels && car.model.wheels[id];
  if (wheel) return setWheelSource(car, wheel, srcModel, fromType);
  if (!mp.native) {
    mp.native = [...mp.inner.children];
    mp.nativeBox = mp.bbox.clone();
  }
  mp.inner.clear();
  if (!fromType || fromType === car.type.id) {
    for (const o of mp.native) mp.inner.add(o);
    mp.bbox = mp.nativeBox.clone();
  } else {
    // content is in car space, as the inner group of every part is
    const fit = fittedPart(car, id, srcModel);
    mp.inner.add(fit);
    const box = new THREE.Box3();
    for (const m of fit.children) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      m.updateMatrix();
      box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrix));
    }
    mp.bbox = box;
  }
  mp.foreign = fromType && fromType !== car.type.id ? fromType : null;
}

function setWheelSource(car, wheel, srcModel, fromType) {
  const spin = wheel.spin;
  if (!wheel.native) wheel.native = [...spin.children];
  spin.clear();
  if (!fromType || fromType === car.type.id) {
    for (const o of wheel.native) spin.add(o);
    return;
  }
  // the other car's wheel from the same corner, scaled to this hub
  const id = Object.keys(car.model.wheels).find((k) => car.model.wheels[k] === wheel);
  const src = srcModel.wheels && (srcModel.wheels[id] || srcModel.wheels.wheel_RL);
  if (!src) return;
  const g = new THREE.Group();
  src.spin.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(src.spin.matrixWorld).invert();
  src.spin.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Mesh(o.geometry, o.material);
    m.applyMatrix4(inv.clone().multiply(o.matrixWorld));
    m.castShadow = m.receiveShadow = true;
    m.userData.shared = true;
    g.add(m);
  });
  const r0 = srcModel.type ? srcModel.type.SPEC.wheelR : car.type.SPEC.wheelR;
  g.scale.setScalar(car.type.SPEC.wheelR / r0);
  spin.add(g);
}

// What an installed engine changes about the car.
export function applyEngine(car, engineType) {
  const T = engineType || car.type;
  const p = car.dyn.p;
  for (const k of ['torqueCurve', 'redline', 'idleRpm', 'engineInertia', 'engineFriction']) p[k] = T.DYNAMICS[k];
  car.engineType = T;
}
