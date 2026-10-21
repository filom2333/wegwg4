// Bolt-on accessories: things fitted to a car's roof, nose or tail. Each weighs what it weighs
// where it sits (whatever goes on the roof lifts the centre of gravity and makes the car easier to
// roll), has a collider, and does a job: a roof rack and a rear carrier take cargo strapped on,
// a roof box is a lockable boot on the roof, a bull bar takes the brunt of a head-on hit.
// Models are built to the car they go on: rack feet reach down to that car's roof.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roundedBox, tubeAlong } from '../gfx/geom.js';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { Container } from '../items/inventory.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const ACCESSORIES = {
  roofRack: { label: 'Roof rack', mount: 'roof', mass: 14, cargo: true, desc: 'Bolts to the roof gutters. Strap things on top, but mind the centre of gravity.' },
  roofBox: { label: 'Roof box', mount: 'roof', mass: 17, storage: { slots: 12, capacity: 50 }, desc: 'A boot on the roof: 50 kg of room, high up.' },
  bullBar: { label: 'Bull bar', mount: 'front', mass: 26, guard: 0.45, desc: 'Steel tube across the nose. Takes the worst of a head-on hit.' },
  winchBar: { label: 'Winch bar', mount: 'front', mass: 44, guard: 0.45, winch: true, desc: 'A bull bar with an electric winch: hook the cable round a tree and pull yourself out.' },
  rearRack: { label: 'Rear carrier', mount: 'rear', mass: 11, cargo: true, desc: 'A tray behind the rear bumper for cans and crates.' },
};
export const MOUNT_LABEL = { roof: 'roof', front: 'nose', rear: 'tail' };

// Default mount frames (for the loose item model).
const DEFAULT_MOUNT = {
  roof: { z: 0, l: 1.1, w: 1.05, top: 0.09 },
  front: { z: 0, y0: 0, y1: 0.66, w: 0.95 },
  rear: { z: 0, y: 0.12, w: 0.95, d: 0.5 },
};

let MAT = null;
function mats() {
  if (MAT) return MAT;
  MAT = {
    black: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.55, metalness: 0.55 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.18, metalness: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0f0f0f, roughness: 0.9 }),
    box: new THREE.MeshPhysicalMaterial({ color: 0x2a2d31, roughness: 0.32, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
    boxTrim: new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.6 }),
    zinc: new THREE.MeshStandardMaterial({ color: 0x8f9396, roughness: 0.45, metalness: 0.9 }),
  };
  return MAT;
}

function mesh(g, m) {
  const x = new THREE.Mesh(g, m);
  x.castShadow = true;
  x.receiveShadow = true;
  return x;
}

const tube = (pts, r, m, seg = 8) => mesh(tubeAlong(pts, r, seg), m);
const bar = (a, b, r, m) => tube([a, b], r, m);

// ------------------------------------------------------------------ models
// Each builder gets the mount frame (car space) and `feet(x, z)`: the roof height under a point.

function roofRack(M, f, feet) {
  const g = new THREE.Group();
  const hw = f.w / 2,
    hl = f.l / 2,
    y = f.top;
  // perimeter basket rail and its floor bars
  const r = 0.012;
  const c = [V(hw, y + 0.06, f.z + hl), V(-hw, y + 0.06, f.z + hl), V(-hw, y + 0.06, f.z - hl), V(hw, y + 0.06, f.z - hl)];
  for (let i = 0; i < 4; i++) g.add(bar(c[i], c[(i + 1) % 4], r, M.black));
  for (let i = 0; i < 4; i++) g.add(mesh(new THREE.SphereGeometry(r * 1.02, 8, 6).translate(c[i].x, c[i].y, c[i].z), M.black));
  for (const s of [1, -1]) g.add(bar(V(s * hw, y, f.z + hl - 0.04), V(s * hw, y, f.z - hl + 0.04), r, M.black));
  const n = 5;
  for (let i = 0; i < n; i++) {
    const z = f.z - hl + 0.04 + ((f.l - 0.08) * i) / (n - 1);
    g.add(bar(V(hw, y, z), V(-hw, y, z), 0.009, M.black));
  }
  // uprights from the floor to the rail
  for (const s of [1, -1]) for (const z of [f.z + hl, f.z, f.z - hl]) g.add(bar(V(s * hw, y - 0.005, z - Math.sign(z - f.z) * 0.04), V(s * hw, y + 0.06, z), 0.008, M.black));
  // four feet with rubber pads, clamped to the gutters
  for (const s of [1, -1])
    for (const z of [f.z + hl - 0.12, f.z - hl + 0.12]) {
      const x = s * (hw - 0.04);
      const fy = feet(x, z);
      g.add(bar(V(s * hw, y, z), V(x, fy + 0.025, z), 0.011, M.black));
      g.add(mesh(roundedBox(0.07, 0.025, 0.09, 0.008, 2).translate(x, fy + 0.012, z), M.rubber));
    }
  return g;
}

function roofBox(M, f, feet) {
  const g = new THREE.Group();
  const w = f.w * 0.82,
    l = f.l * 1.12,
    h = 0.34,
    y0 = f.top + 0.02;
  // two load bars it clamps to
  for (const dz of [-0.28, 0.28]) {
    const z = f.z + dz * f.l;
    g.add(mesh(roundedBox(f.w, 0.03, 0.05, 0.01, 2).translate(0, f.top - 0.01, z), M.black));
    for (const s of [1, -1]) {
      const x = s * (f.w / 2 - 0.04);
      const fy = feet(x, z);
      g.add(mesh(roundedBox(0.05, Math.max(0.02, f.top - 0.02 - fy), 0.06, 0.01, 1).translate(x, (f.top - 0.02 + fy) / 2, z), M.black));
      g.add(mesh(roundedBox(0.07, 0.02, 0.09, 0.006, 1).translate(x, fy + 0.01, z), M.rubber));
    }
  }
  // the shell: a rounded box tapered to a low wedge at the front, lid seam and lock
  const shell = roundedBox(w, h, l, 0.12, 4);
  const p = shell.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const zz = p.getZ(i) / (l / 2),
      yy = p.getY(i) / (h / 2);
    const nose = Math.max(0, zz - 0.25) / 0.75;
    // the front drops and narrows, the top crowns a little
    p.setY(i, p.getY(i) * (1 - 0.45 * nose * nose * (yy > 0 ? 1 : 0.2)) + (yy > 0 ? 0.03 * (1 - Math.abs(p.getX(i) / (w / 2)) ** 2) : 0));
    p.setX(i, p.getX(i) * (1 - 0.12 * nose * nose));
  }
  shell.computeVertexNormals();
  g.add(mesh(shell.translate(0, y0 + h / 2, f.z), M.box));
  g.add(mesh(roundedBox(w + 0.006, 0.012, l * 0.9, 0.005, 1).translate(0, y0 + h * 0.42, f.z - l * 0.02), M.boxTrim));
  g.add(mesh(roundedBox(0.012, 0.04, 0.06, 0.004, 1).translate(w / 2 + 0.002, y0 + h * 0.5, f.z - l * 0.1), M.zinc));
  return g;
}

function bullBar(M, f) {
  const g = new THREE.Group();
  const z = f.z + 0.06,
    hw = f.w / 2,
    up = 0.32; // uprights stand this far either side of the centre
  const r = 0.03;
  // two uprights with a hoop over the top
  const hoop = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    hoop.push(V(Math.cos(a) * up, f.y1 - 0.12 + Math.sin(a) * 0.12, z + 0.02 * Math.sin(a)));
  }
  g.add(tube([V(up, f.y0 + 0.02, z - 0.02), V(up, f.y1 - 0.12, z), ...hoop.slice(1, -1), V(-up, f.y1 - 0.12, z), V(-up, f.y0 + 0.02, z - 0.02)], r, M.chrome, 10));
  // the wide lower bar with wings sweeping back round the corners
  const yb = f.y0 + (f.y1 - f.y0) * 0.35;
  g.add(tube([V(hw, yb, z - 0.16), V(hw - 0.06, yb, z - 0.02), V(-hw + 0.06, yb, z - 0.02), V(-hw, yb, z - 0.16)], r * 0.85, M.chrome, 10));
  g.add(bar(V(up, f.y1 - 0.2, z + 0.005), V(-up, f.y1 - 0.2, z + 0.005), r * 0.7, M.chrome));
  // mounting brackets back to the chassis
  for (const s of [1, -1]) g.add(mesh(roundedBox(0.06, 0.08, 0.22, 0.01, 1).translate(s * up, f.y0 + 0.08, z - 0.13), M.black));
  return g;
}

function rearRack(M, f) {
  const g = new THREE.Group();
  const hw = f.w / 2,
    d = f.d,
    z0 = f.z,
    z1 = f.z - d,
    y = f.y;
  const r = 0.015;
  // tray frame, slats and a low lip around it
  const c = [V(hw, y, z0), V(-hw, y, z0), V(-hw, y, z1), V(hw, y, z1)];
  for (let i = 0; i < 4; i++) g.add(bar(c[i], c[(i + 1) % 4], r, M.black));
  for (let i = 1; i < 6; i++) {
    const x = -hw + (f.w * i) / 6;
    g.add(mesh(new THREE.BoxGeometry(0.035, 0.01, d - 0.02).translate(x, y + 0.004, (z0 + z1) / 2), M.zinc));
  }
  for (const s of [1, -1]) g.add(bar(V(s * hw, y + 0.06, z0 - 0.02), V(s * hw, y + 0.06, z1), 0.01, M.black));
  g.add(bar(V(hw, y + 0.06, z1), V(-hw, y + 0.06, z1), 0.01, M.black));
  for (const s of [1, -1]) for (const z of [z0 - 0.02, z1]) g.add(bar(V(s * hw, y, z), V(s * hw, y + 0.06, z), 0.008, M.black));
  // the hitch arm reaching forward under the bumper
  g.add(mesh(new THREE.BoxGeometry(0.07, 0.07, 0.5).translate(0, y - 0.1, z0 + 0.1), M.black));
  g.add(mesh(new THREE.BoxGeometry(0.07, 0.11, 0.06).translate(0, y - 0.05, z0 - 0.08), M.black));
  return g;
}

// The bull bar with a winch drum and its motor on a cradle between the uprights.
function winchBar(M, f) {
  const g = bullBar(M, f);
  const z = f.z + 0.1,
    y = f.y0 + 0.13;
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.05, 0.16).translate(0, y - 0.07, z - 0.02), M.black));
  g.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.26, 18).rotateZ(Math.PI / 2).translate(0.04, y, z), M.black));
  for (let i = 0; i < 9; i++) g.add(mesh(new THREE.TorusGeometry(0.06, 0.006, 5, 16).rotateY(Math.PI / 2).translate(-0.07 + i * 0.027, y, z), M.zinc));
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.13, 14).rotateZ(Math.PI / 2).translate(-0.19, y, z), M.black));
  g.add(mesh(new THREE.BoxGeometry(0.08, 0.05, 0.03).translate(0, y, z + 0.08), M.chrome));
  return g;
}

const BUILD = { roofRack, roofBox, bullBar, rearRack, winchBar };

// Collision box [centre, half extents] in car space, and where the cargo sits.
function boxOf(id, f) {
  if (id === 'roofRack') return [V(0, f.top, f.z), V(f.w / 2, 0.012, f.l / 2)];
  if (id === 'roofBox') return [V(0, f.top + 0.19, f.z), V(f.w * 0.41, 0.17, f.l * 0.56)];
  if (id === 'bullBar' || id === 'winchBar') return [V(0, (f.y0 + f.y1) / 2, f.z + 0.06), V(f.w / 2, (f.y1 - f.y0) / 2, 0.06)];
  return [V(0, f.y, f.z - f.d / 2), V(f.w / 2, 0.015, f.d / 2)];
}

function frameOf(car, mount) {
  const m = car && car.type.MOUNTS && car.type.MOUNTS[mount];
  return m ? { ...DEFAULT_MOUNT[mount], ...m } : DEFAULT_MOUNT[mount];
}

// Roof height under a car-space point, from the body panels' own meshes.
function roofFeet(car, f) {
  if (!car) return () => f.top - 0.07;
  const body = car.model.parts.body;
  const ray = new THREE.Raycaster();
  const M = car.root.matrixWorld,
    inv = new THREE.Matrix4().copy(M).invert();
  const down = V(0, -1, 0).transformDirection(M);
  car.root.updateMatrixWorld(true);
  return (x, z) => {
    ray.set(V(x, f.top + 0.3, z).applyMatrix4(M), down);
    ray.far = 0.8;
    const hit = ray.intersectObject(body.inner, true)[0];
    return hit ? Math.min(f.top - 0.02, hit.point.applyMatrix4(inv).y) : f.top - 0.07;
  };
}

// One mesh per material: the builders make dozens of tubes.
function merged(src) {
  const by = new Map();
  for (const m of src.children) {
    if (!by.has(m.material)) by.set(m.material, []);
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    by.get(m.material).push(geo);
  }
  const g = new THREE.Group();
  for (const [mat, list] of by) g.add(mesh(mergeGeometries(list, false), mat));
  return g;
}

// The accessory model in car space (or for a loose item, around its own frame).
export function buildAccessory(id, car = null) {
  const def = ACCESSORIES[id];
  const f = frameOf(car, def.mount);
  const g = merged(BUILD[id](mats(), f, roofFeet(car, f)));
  g.name = 'accessory:' + id;
  g.userData.box = boxOf(id, f);
  // where the winch cable leaves the fairlead (car space)
  if (def.winch) g.userData.drum = V(0, f.y0 + 0.13, f.z + 0.2);
  return g;
}

// A loose accessory, centred on its bounding box, for the item system.
export function accessoryItemModel(id) {
  const g = buildAccessory(id);
  const b = new THREE.Box3().setFromObject(g);
  const c = b.getCenter(V(0, 0, 0));
  for (const ch of g.children) ch.position.sub(c);
  g.userData.size = b.getSize(V(0, 0, 0));
  return g;
}

// ------------------------------------------------------------------ on the car
export function fitAccessory(car, id, { storage = null } = {}) {
  const def = ACCESSORIES[id];
  car.accessories = car.accessories || {};
  if (car.accessories[def.mount]) removeAccessory(car, def.mount);
  const group = buildAccessory(id, car);
  // what you aim at to take it off: the whole thing
  const box = new THREE.Box3().setFromObject(group);
  car.root.add(group);
  const [c, h] = group.userData.box;
  const desc = RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setTranslation(c.x, c.y, c.z).setDensity(0).setFriction(0.6).setRestitution(0.05).setCollisionGroups(GROUPS.car);
  const collider = car.game.physics.world.createCollider(desc, car.dyn.body);
  car.game.physics.setOwner(collider, car.ownerTag);
  car.accessories[def.mount] = { id, group, collider, box, center: c.clone() };
  if (def.storage) {
    const s = new Container('roofbox', def.label, def.storage.slots, { capacity: def.storage.capacity, bulky: true });
    if (storage) s.restore(storage);
    car.storage.roofbox = s;
  }
  car.updateMass();
  return car.accessories[def.mount];
}

export function removeAccessory(car, mount) {
  const a = car.accessories && car.accessories[mount];
  if (!a) return null;
  a.group.parent && a.group.parent.remove(a.group);
  car.game.physics.removeCollider(a.collider);
  delete car.accessories[mount];
  if (ACCESSORIES[a.id].storage) delete car.storage.roofbox;
  car.updateMass();
  return a;
}

export function canRemoveAccessory(car, mount) {
  const a = car.accessories && car.accessories[mount];
  if (!a) return { ok: false, reason: 'Nothing fitted' };
  if (car.game.player && car.game.player.seat) return { ok: false, reason: 'Get out of the car first' };
  if (ACCESSORIES[a.id].storage && car.storage.roofbox && car.storage.roofbox.weight() > 0) return { ok: false, reason: 'Empty it first' };
  return { ok: true };
}

// Where cargo strapped to a rack rests: [floor y, half width, z min, z max] in car space.
export function cargoDeck(car, mount) {
  const a = car.accessories && car.accessories[mount];
  if (!a || !ACCESSORIES[a.id].cargo) return null;
  const f = frameOf(car, mount);
  if (mount === 'roof') return { y: f.top + 0.01, hw: f.w / 2 - 0.04, z0: f.z - f.l / 2 + 0.03, z1: f.z + f.l / 2 - 0.03 };
  return { y: f.y + 0.01, hw: f.w / 2 - 0.03, z0: f.z - f.d + 0.02, z1: f.z - 0.02 };
}

// Which part of a car a dropped item came to rest in (car space): the cabin and boot, or the
// deck of a roof rack or rear carrier.
export function cargoZone(car, lp, size = null) {
  const C = car.type.cabin;
  if (C && Math.abs(lp.x) < C.hw && lp.y > C.y0 && lp.y < C.y1 && lp.z > C.z0 && lp.z < C.z1) return 'cabin';
  for (const mount of ['roof', 'rear']) {
    const d = cargoDeck(car, mount);
    const h = size ? size.y / 2 : 0.1;
    if (d && Math.abs(lp.x) < d.hw + 0.05 && lp.z > d.z0 - 0.05 && lp.z < d.z1 + 0.05 && lp.y > d.y - 0.05 && lp.y < d.y + h + 0.35) return mount;
  }
  return null;
}

// Total mass and first moment of everything fitted, for the car's mass properties.
export function accessoryMass(car, com) {
  let m = 0;
  for (const a of Object.values(car.accessories || {})) {
    const k = ACCESSORIES[a.id].mass;
    com.addScaledVector(a.center, k);
    m += k;
  }
  return m;
}

export function serializeAccessories(car) {
  const out = {};
  for (const [mount, a] of Object.entries(car.accessories || {})) out[mount] = a.id;
  return out;
}
