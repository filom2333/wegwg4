// Sheets of steel, boards and plastic panels bolted anywhere on a car: over a window, across
// the nose, onto the roof. A plate rides on the part it is bolted to (it swings with a door, comes
// off with it), weighs what it weighs where it is, and steel takes some of the sting out of a
// crash on that end of the car.

import * as THREE from 'three';
import { roundedBox } from '../gfx/geom.js';
import { makeCanvas, canvasTexture, cached, noiseCanvas } from '../gfx/textures.js';
import { RAPIER, GROUPS } from '../physics/physics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// w across, l along, t thick (metres); the model lies flat, thickness along Y
export const PLATES = {
  steelPlate: { name: 'Steel plate', mat: 'steel', w: 0.6, l: 0.45, t: 0.004, mass: 8.5 },
  steelSheet: { name: 'Steel sheet', mat: 'steel', w: 1.1, l: 0.6, t: 0.003, mass: 15.5 },
  plank: { name: 'Plank', mat: 'wood', w: 1.2, l: 0.15, t: 0.025, mass: 2.3 },
  plankWide: { name: 'Wide board', mat: 'wood', w: 0.9, l: 0.26, t: 0.025, mass: 2.8 },
  plywood: { name: 'Plywood sheet', mat: 'ply', w: 0.8, l: 0.6, t: 0.012, mass: 3.4 },
  plasticPanel: { name: 'Plastic panel', mat: 'plastic', w: 0.6, l: 0.5, t: 0.006, mass: 1.7 },
  plasticSheet: { name: 'Plastic sheet', mat: 'plastic', w: 1.0, l: 0.7, t: 0.005, mass: 3.2 },
};
export const PLASTIC_COLORS = [0x2f5d8a, 0xd8d4c8, 0x3a3d40, 0xc79a2a, 0x8a2f2a];
// parts a plate cannot go on (they spin or steer)
const NO_PLATE = /^(wheel_|steeringWheel|spare)/;

// ------------------------------------------------------------------ materials
function steelTex() {
  return cached('plate:steel', () => {
    const c = noiseCanvas(256, 256, {
      scale: 5,
      seed: 31,
      mapper: (v, x, y) => {
        // mill-scale grey, rust blooming where the noise is high, a few scratches
        const rust = Math.max(0, Math.min(1, (v - 0.58) * 5));
        const g = 96 + v * 40;
        const s = (x * 7 + y * 3) % 97 < 1 ? 30 : 0;
        return [g * (1 - rust) + 122 * rust + s, g * (1 - rust) + 66 * rust + s, g * (1 - rust) + 38 * rust + s];
      },
    });
    return canvasTexture(c);
  });
}

function woodTex(ply) {
  return cached('plate:wood:' + ply, () => {
    const W = 512,
      H = 64;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = ply ? '#b89466' : '#9c7347';
    ctx.fillRect(0, 0, W, H);
    // grain: long wavy lines and a knot or two
    for (let i = 0; i < 60; i++) {
      const y0 = Math.random() * H,
        a = 1 + Math.random() * 3,
        f = 0.004 + Math.random() * 0.01,
        ph = Math.random() * 6;
      ctx.strokeStyle = `rgba(${ply ? 120 : 70},${ply ? 86 : 44},${ply ? 50 : 24},${0.15 + Math.random() * 0.25})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.4;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) ctx.lineTo(x, y0 + Math.sin(x * f + ph) * a);
      ctx.stroke();
    }
    if (!ply)
      for (let k = 0; k < 2; k++) {
        const x = 60 + Math.random() * (W - 120),
          y = 10 + Math.random() * (H - 20);
        const g = ctx.createRadialGradient(x, y, 1, x, y, 9);
        g.addColorStop(0, 'rgba(60,34,16,0.9)');
        g.addColorStop(1, 'rgba(60,34,16,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, 12, 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    return canvasTexture(c);
  });
}

const MATS = {};
export function plateMaterial(kind, color = null) {
  const key = kind + ':' + (color ?? '');
  if (MATS[key]) return MATS[key];
  let m;
  if (kind === 'steel') m = new THREE.MeshStandardMaterial({ map: steelTex(), color: color ?? 0xffffff, roughness: 0.62, metalness: 0.75 });
  else if (kind === 'wood' || kind === 'ply') m = new THREE.MeshStandardMaterial({ map: woodTex(kind === 'ply'), color: color ?? 0xffffff, roughness: 0.9 });
  else m = new THREE.MeshStandardMaterial({ color: color ?? PLASTIC_COLORS[0], roughness: 0.45, metalness: 0 });
  m.userData.plate = true;
  MATS[key] = m;
  return m;
}

const BOLT = new THREE.MeshStandardMaterial({ color: 0x55585b, roughness: 0.4, metalness: 0.9 });

// The plate, centred, thickness along Y. Bolt heads at the corners when it is fitted.
export function plateModel(id, variant = 0, { bolts = false, color = null } = {}) {
  const d = PLATES[id];
  const g = new THREE.Group();
  const geo = cached(`plategeo:${id}`, () => roundedBox(d.w, d.t, d.l, Math.min(0.008, d.t * 0.45), 1));
  const col = color ?? (d.mat === 'plastic' ? PLASTIC_COLORS[variant % PLASTIC_COLORS.length] : null);
  const m = new THREE.Mesh(geo, plateMaterial(d.mat, col));
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  if (bolts) {
    const bg = cached('plate:bolt', () => new THREE.CylinderGeometry(0.009, 0.009, 0.006, 6));
    const ix = d.w / 2 - 0.04,
      iz = d.l / 2 - Math.min(0.04, d.l / 4);
    for (const [x, z] of [[ix, iz], [-ix, iz], [ix, -iz], [-ix, -iz]]) {
      const b = new THREE.Mesh(bg, BOLT);
      b.position.set(x, d.t / 2 + 0.003, z);
      g.add(b);
    }
  }
  g.userData.size = V(d.w, d.t, d.l);
  return g;
}

// ------------------------------------------------------------------ on the car
function partOf(o) {
  for (; o; o = o.parent) if (o.userData.partId) return o.userData.partId;
  return null;
}

function tagParts(car) {
  if (car.model._partsTagged) return;
  for (const [id, mp] of Object.entries(car.model.parts)) mp.pivot.userData.partId = id;
  car.model._partsTagged = true;
}

// Tilts a spot: the plate swings up off the surface about its near edge (toward the viewer) by
// `tilt` radians, so a sheet on the ground becomes a ramp or, at 90 degrees, a wall.
export function tiltSpot(id, spot, tilt, viewDir) {
  const d = PLATES[id];
  const e = V(0, 0, 0);
  const x = V(0, 0, 0),
    n = V(0, 0, 0),
    z = V(0, 0, 0);
  spot.basis.extractBasis(x, n, z);
  // the near edge is the one facing the viewer
  if (z.dot(viewDir) < 0) {
    z.negate();
    x.negate();
  }
  const ct = Math.cos(tilt),
    st = Math.sin(tilt);
  const z2 = z.clone().multiplyScalar(ct).addScaledVector(n, st);
  const n2 = n.clone().multiplyScalar(ct).addScaledVector(z, -st);
  const base = spot.point.clone().addScaledVector(spot.normal, d.t / 2 + 0.002);
  e.copy(base).addScaledVector(z, -d.l / 2);
  const centre = e.clone().addScaledVector(z2, d.l / 2).addScaledVector(n2, 0);
  const basis = new THREE.Matrix4().makeBasis(x, n2, z2);
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);
  return { ...spot, matrix: new THREE.Matrix4().compose(centre, q, V(1, 1, 1)) };
}

// A spot on anything solid in the world (a wall, a fence, a rock, the ground) from a physics ray
// hit: lying flat on it, the long side following the view's horizontal, turned by spin.
export function worldSpot(hit, dir, spin, camRight) {
  const n = V(hit.normal.x, hit.normal.y, hit.normal.z).normalize();
  if (n.dot(dir) > 0) n.negate();
  const x = camRight.clone().addScaledVector(n, -camRight.dot(n));
  if (x.lengthSq() < 1e-4) x.set(1, 0, 0).addScaledVector(n, -n.x);
  x.normalize().applyAxisAngle(n, spin);
  const z = x.clone().cross(n).normalize();
  return { host: 'world', point: V(hit.point.x, hit.point.y, hit.point.z), normal: n, basis: new THREE.Matrix4().makeBasis(x, n, z), dist: hit.distance };
}

// Where a plate would go: the surface point under the crosshair on any part of the car, with the
// plate lying flat against it. spin turns it about the surface normal.
const _ray = new THREE.Raycaster();
export function plateSpot(car, origin, dir, maxDist, spin, camRight, dims = null) {
  tagParts(car);
  // candidate parts by their boxes first; then the real surface
  const inv = new THREE.Matrix4();
  const lray = new THREE.Ray();
  const objs = [];
  for (const [id, mp] of Object.entries(car.model.parts)) {
    if (!car.isInstalled(id) || NO_PLATE.test(id) || !mp.bbox || mp.bbox.isEmpty()) continue;
    // part boxes are in car space, as the content of every part's inner group is
    inv.copy(mp.inner.matrixWorld).invert();
    lray.origin.copy(origin).applyMatrix4(inv);
    lray.direction.copy(dir).transformDirection(inv);
    if (lray.intersectsBox(mp.bbox)) objs.push(mp.pivot);
  }
  if (!objs.length) return null;
  _ray.set(origin, dir);
  _ray.far = maxDist;
  const hits = _ray.intersectObjects(objs, true).filter((h) => h.face && visibleChain(h.object));
  const h = hits[0];
  if (!h) return null;
  const part = partOf(h.object);
  if (!part || NO_PLATE.test(part)) return null;
  let n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
  if (n.dot(dir) > 0) n.negate();
  // the plate's long side follows the view's horizontal, turned by spin
  const frame = (nn) => {
    const x = camRight.clone().addScaledVector(nn, -camRight.dot(nn));
    if (x.lengthSq() < 1e-4) x.set(1, 0, 0).addScaledVector(nn, -nn.x);
    x.normalize().applyAxisAngle(nn, spin);
    return [x, x.clone().cross(nn).normalize()];
  };
  let [x, z] = frame(n);
  let point = h.point.clone();
  // settle it on the surface: feel for the panel under its corners and lie on what is there,
  // never sinking into it (a flat sheet on a curved wing touches at its high points)
  if (dims) {
    const near = nearParts(car, h.point, Math.hypot(dims.w, dims.l) / 2 + 0.1);
    const pts = [];
    for (const [a, b] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const c = h.point.clone().addScaledVector(x, a * dims.w * 0.45).addScaledVector(z, b * dims.l * 0.45);
      _ray.set(c.addScaledVector(n, 0.3), n.clone().negate());
      _ray.far = 0.6;
      const hh = _ray.intersectObjects(near, true).find((q) => q.face && visibleChain(q.object));
      if (hh) pts.push(hh.point);
    }
    if (pts.length === 4) {
      const n2 = pts[0].clone().sub(pts[3]).cross(pts[1].clone().sub(pts[2])).normalize();
      if (n2.dot(n) < 0) n2.negate();
      if (n2.dot(n) > 0.5) {
        n = n2;
        [x, z] = frame(n);
      }
    }
    let lift = 0;
    for (const q of [h.point, ...pts]) lift = Math.max(lift, q.clone().sub(h.point).dot(n));
    point = h.point.clone().addScaledVector(n, lift);
  }
  const basis = new THREE.Matrix4().makeBasis(x, n, z);
  return { host: 'car', car, part, point, normal: n, basis, dist: h.distance };
}

// Pivots of the parts whose boxes come within r of a world point.
function nearParts(car, wp, r) {
  const out = [];
  const inv = new THREE.Matrix4();
  for (const [id, mp] of Object.entries(car.model.parts)) {
    if (!car.isInstalled(id) || NO_PLATE.test(id) || !mp.bbox || mp.bbox.isEmpty()) continue;
    inv.copy(mp.inner.matrixWorld).invert();
    if (mp.bbox.distanceToPoint(wp.clone().applyMatrix4(inv)) < r) out.push(mp.pivot);
  }
  return out;
}

function visibleChain(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

// World matrix of a plate of type `id` at a spot (a spot may carry its own, already tilted).
export function plateWorldMatrix(id, spot) {
  if (spot.matrix) return spot.matrix.clone();
  const d = PLATES[id];
  const p = spot.point.clone().addScaledVector(spot.normal, d.t / 2 + 0.002);
  const q = new THREE.Quaternion().setFromRotationMatrix(spot.basis);
  return new THREE.Matrix4().compose(p, q, V(1, 1, 1));
}

// Bolts a plate on. local: its matrix in the part pivot's space (from a spot: pivot^-1 * world).
export function attachPlate(car, { id, state = {}, part, local }) {
  tagParts(car);
  const mp = car.model.parts[part];
  if (!mp) return null;
  const d = PLATES[id];
  const mesh = plateModel(id, state.variant || 0, { bolts: true, color: state.color ?? null });
  mesh.matrixAutoUpdate = true;
  local.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.userData.plate = true;
  mp.pivot.add(mesh);
  const plate = { id, state, part, local: local.clone(), mesh, collider: null, mass: d.mass, car };
  car.plates = car.plates || [];
  car.plates.push(plate);
  plateColliders(car);
  car.updateMass();
  return plate;
}

export function detachPlate(car, plate) {
  plate.mesh.parent && plate.mesh.parent.remove(plate.mesh);
  if (plate.collider) car.game.physics.removeCollider(plate.collider);
  car.plates = car.plates.filter((p) => p !== plate);
  car.updateMass();
}

// Car-space rest transform of a plate (part closed).
export function plateRest(car, plate) {
  const mp = car.model.parts[plate.part];
  const q = mp.pivot.quaternion.clone();
  mp.pivot.quaternion.identity();
  car.root.updateMatrixWorld(true);
  const m = new THREE.Matrix4().copy(car.root.matrixWorld).invert().multiply(mp.pivot.matrixWorld).multiply(plate.local);
  mp.pivot.quaternion.copy(q);
  car.root.updateMatrixWorld(true);
  return m;
}

// Colliders for plates on fixed parts and on closed lids and doors.
export function plateColliders(car) {
  for (const p of car.plates || []) {
    if (p.collider) car.game.physics.removeCollider(p.collider);
    p.collider = null;
    const mp = car.model.parts[p.part];
    if (!car.isInstalled(p.part) || (mp.hinge && mp.openT > 0.08)) continue;
    const d = PLATES[p.id];
    const pos = V(0, 0, 0),
      q = new THREE.Quaternion(),
      s = V(0, 0, 0);
    plateRest(car, p).decompose(pos, q, s);
    pos.multiplyScalar(car.k || 1);
    const desc = RAPIER.ColliderDesc.cuboid(d.w / 2, Math.max(0.01, d.t / 2), d.l / 2)
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setDensity(0)
      .setFriction(0.6)
      .setCollisionGroups(GROUPS.car);
    p.collider = car.game.physics.world.createCollider(desc, car.dyn.body);
    car.game.physics.setOwner(p.collider, car.ownerTag);
  }
}

export function plateMass(car, com) {
  let m = 0;
  const c = V(0, 0, 0);
  for (const p of car.plates || []) {
    c.setFromMatrixPosition(plateRest(car, p));
    com.addScaledVector(c, p.mass);
    m += p.mass;
  }
  return m;
}

// How much of a crash on one end steel plating soaks up (1 = none).
export function plateArmour(car, end) {
  const S = car.type.SPEC;
  let area = 0;
  const c = V(0, 0, 0);
  for (const p of car.plates || []) {
    const d = PLATES[p.id];
    if (d.mat !== 'steel') continue;
    c.setFromMatrixPosition(plateRest(car, p));
    if (end === 'front' ? c.z > S.axleF - 0.4 : c.z < S.axleR + 0.4) area += d.w * d.l;
  }
  return Math.max(0.45, 1 - area * 0.6);
}

// Which plate the ray hits first (its own box), and how far.
export function plateUnderRay(car, origin, dir, maxDist) {
  let best = null;
  const inv = new THREE.Matrix4();
  const r = new THREE.Ray();
  const hit = V(0, 0, 0);
  for (const p of car.plates || []) {
    if (!visibleChain(p.mesh)) continue;
    const d = PLATES[p.id];
    inv.copy(p.mesh.matrixWorld).invert();
    r.origin.copy(origin).applyMatrix4(inv);
    r.direction.copy(dir).transformDirection(inv);
    const box = new THREE.Box3(V(-d.w / 2, -d.t / 2 - 0.006, -d.l / 2), V(d.w / 2, d.t / 2 + 0.006, d.l / 2));
    if (!r.intersectBox(box, hit)) continue;
    const dist = hit.applyMatrix4(p.mesh.matrixWorld).distanceTo(origin);
    if (dist < maxDist && (!best || dist < best.dist)) best = { plate: p, dist };
  }
  return best;
}

export function paintPlate(plate, hex) {
  plate.state.color = hex;
  const m = plate.mesh.children[0];
  m.material = plateMaterial(PLATES[plate.id].mat, hex);
}

export function serializePlates(car) {
  return (car.plates || []).map((p) => ({ id: p.id, state: p.state, part: p.part, m: p.local.toArray() }));
}

export function restorePlates(car, list) {
  for (const p of list || []) if (PLATES[p.id] && car.model.parts[p.part] && car.isInstalled(p.part)) attachPlate(car, { id: p.id, state: p.state || {}, part: p.part, local: new THREE.Matrix4().fromArray(p.m) });
}
