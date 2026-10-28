// Wind-down door glass for any car model: each door's own glass mesh slides down its own slope
// into the door, and a crank on the door card (a chrome rosette, the arm turning on its spindle,
// a knob to turn it by) goes round with it. car.js moves both from car.windowT.

import * as THREE from 'three';
import { roundedBox } from '../gfx/geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// model.windows[door] = { mesh, drop, dir }: the glass, how far it winds down and the way it goes
// (down the pane's slope, so a tumblehome pane stays between the door skins).
export function findWindows(model) {
  model.windows = {};
  for (const id of ['door_FL', 'door_FR', 'door_RL', 'door_RR']) {
    const part = model.parts[id];
    const glass = part && part.inner.children.find((m) => m.name === id + ':glass');
    if (!glass) continue;
    glass.geometry.computeBoundingBox();
    const b = glass.geometry.boundingBox;
    // x against y over the pane: its lean
    const p = glass.geometry.attributes.position;
    let sy = 0,
      sx = 0,
      syy = 0,
      sxy = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i);
      sy += y;
      sx += x;
      syy += y * y;
      sxy += x * y;
    }
    const n = p.count;
    const den = n * syy - sy * sy;
    const k = den > 1e-9 ? (n * sxy - sx * sy) / den : 0;
    model.windows[id] = { mesh: glass, drop: (b.max.y - b.min.y) * 0.95, dir: V(-k, -1, 0).normalize() };
  }
}

// A crank on each door card at cranks[door] (car space, on the card's face), +z of its frame into
// the cabin; model.cranks[door] is the part that turns.
export function addCranks(model, cranks, mats) {
  model.cranks = {};
  const M = mats;
  M.crankChrome = M.crankChrome || M.chrome || new THREE.MeshStandardMaterial({ color: 0xd9dcde, metalness: 1, roughness: 0.12 });
  M.crankKnob = M.crankKnob || new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45 });
  for (const [door, at] of Object.entries(cranks || {})) {
    const part = model.parts[door];
    if (!part || !model.windows[door]) continue;
    const sx = Math.sign(at[0]);
    const g = new THREE.Group();
    g.position.set(...at);
    g.quaternion.copy(faceInward(sx));
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.008, 20).rotateX(Math.PI / 2).translate(0, 0, 0.004), M.crankChrome);
    const spin = new THREE.Group();
    spin.position.z = 0.012;
    const arm = new THREE.Mesh(roundedBox(0.075, 0.016, 0.008, 0.004, 1).translate(0.03, 0, 0), M.crankChrome);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 14).rotateX(Math.PI / 2), M.crankChrome);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.035, 14).rotateX(Math.PI / 2).translate(0.062, 0, 0.02), M.crankKnob);
    spin.add(arm, hub, knob);
    g.add(rose, spin);
    part.inner.add(g);
    model.cranks[door] = spin;
  }
}

// a frame whose +z points into the cabin from a door on side sx (+1 the car's left)
function faceInward(sx) {
  const z = V(-sx, 0, 0);
  const y = V(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// Drops the triangles of a mesh whose centres fall in a car-space box (a source's own fixed
// winder handle, so a working one can take its place). The geometry is copied first.
export function stripBox(mesh, min, max) {
  const box = new THREE.Box3(V(...min), V(...max));
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  const p = src.attributes.position;
  const keep = [];
  const c = V(0, 0, 0);
  for (let t = 0; t < p.count / 3; t++) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.x += p.getX(t * 3 + k) / 3, c.y += p.getY(t * 3 + k) / 3, c.z += p.getZ(t * 3 + k) / 3;
    if (!box.containsPoint(c)) keep.push(t);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const arr = new a.array.constructor(keep.length * 3 * a.itemSize);
    keep.forEach((t, i) => arr.set(a.array.subarray(t * 3 * a.itemSize, (t + 1) * 3 * a.itemSize), i * 3 * a.itemSize));
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  mesh.geometry = out;
}
