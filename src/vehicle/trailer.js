// Utility trailer: a steel-framed plank bed on a single axle, A-frame drawbar with a ball coupler
// and a jockey wheel. Physics: a chassis body with two wheels on revolute joints (they roll and
// grip sideways like real tyres) and, when hitched, a ball joint to the car's tow point. Loose
// things put on the bed ride along on its collider. Unhitched, it can be pulled by the drawbar.

import * as THREE from 'three';
import { RAPIER, G, groups } from '../physics/physics.js';
import { roundedBox, latheY } from '../gfx/geom.js';
import { addSurfaceDetail } from '../gfx/triplanar.js';
import { hash01 } from '../core/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// trailer space: +z toward the drawbar (forward), +y up; the axle sits at z = 0
const BED = { w: 1.42, l: 2.2, y: 0.62, z0: -1.05 };
const WHEEL = { r: 0.31, w: 0.17, x: 0.86, y: 0.31 };
const COUPLER = V(0, 0.45, 2.15);
const MASS = 260;
export const TRAILER_GROUP = groups(G.TRAILER, G.WORLD | G.ITEM | G.NPC | G.TRAILER);

let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    frame: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x2e3a33, roughness: 0.55, metalness: 0.6 }), 'cast', 0.35),
    planks: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x7a6043, roughness: 0.92 }), 'grain', 0.5),
    tyre: new THREE.MeshStandardMaterial({ color: 0x161514, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xbdb8ad, roughness: 0.35, metalness: 0.85 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.2, metalness: 1 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x5a0a06, emissive: 0xff2a10, emissiveIntensity: 0, roughness: 0.3 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xc87a10, roughness: 0.3 }),
  };
  return MATS;
}

function box(w, h, d, x, y, z, m) {
  const mesh = new THREE.Mesh(roundedBox(w, h, d, Math.min(w, h, d) * 0.2, 1), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function buildBody() {
  const M = mats();
  const g = new THREE.Group();
  const { w, l, y, z0 } = BED;
  const z1 = z0 + l;
  // frame rails and cross members
  for (const s of [-1, 1]) g.add(box(0.06, 0.08, l, s * (w / 2 - 0.03), y - 0.08, z0 + l / 2, M.frame));
  for (let i = 0; i < 5; i++) g.add(box(w, 0.06, 0.05, 0, y - 0.09, z0 + 0.05 + (i * (l - 0.1)) / 4, M.frame));
  // plank bed
  const n = 9;
  for (let i = 0; i < n; i++) g.add(box(w - 0.02, 0.03, l / n - 0.012, 0, y - 0.03, z0 + (i + 0.5) * (l / n), M.planks));
  // low side and front boards on steel posts
  for (const s of [-1, 1]) {
    g.add(box(0.03, 0.22, l, s * (w / 2 + 0.005), y + 0.12, z0 + l / 2, M.planks));
    for (let i = 0; i < 4; i++) g.add(box(0.035, 0.26, 0.035, s * (w / 2 + 0.02), y + 0.1, z0 + 0.06 + (i * (l - 0.12)) / 3, M.frame));
  }
  g.add(box(w + 0.04, 0.22, 0.03, 0, y + 0.12, z1, M.planks));
  g.add(box(w + 0.04, 0.12, 0.03, 0, y + 0.07, z0, M.planks));
  // A-frame drawbar to the coupler
  const tip = COUPLER;
  for (const s of [-1, 1]) {
    const a = V(s * (w / 2 - 0.05), y - 0.1, z1 - 0.1);
    const b = V(s * 0.04, tip.y + 0.02, tip.z - 0.22);
    const len = a.distanceTo(b);
    const bar = box(0.06, 0.06, len, 0, 0, 0, M.frame);
    bar.position.copy(a).lerp(b, 0.5);
    bar.lookAt(b.clone().add(g.position));
    g.add(bar);
  }
  g.add(box(0.07, 0.07, 0.3, 0, tip.y + 0.02, tip.z - 0.14, M.frame));
  const ball = new THREE.Mesh(latheY([[0, -0.03], [0.055, -0.03], [0.06, 0.0], [0.05, 0.05], [0, 0.06]], 16), M.chrome);
  ball.position.copy(tip).add(V(0, -0.02, 0.02));
  g.add(ball);
  // jockey wheel post and wheel
  g.add(box(0.05, 0.24, 0.05, 0.12, tip.y - 0.06, tip.z - 0.42, M.frame));
  const jw = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16).rotateZ(Math.PI / 2), M.tyre);
  jw.position.set(0.12, 0.2, tip.z - 0.42);
  g.add(jw);
  // mudguards over the wheels
  for (const s of [-1, 1]) {
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL.r + 0.06, WHEEL.r + 0.06, WHEEL.w + 0.06, 20, 1, true, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2), M.frame);
    guard.material = M.frame;
    guard.position.set(s * (WHEEL.x), WHEEL.y + 0.02, 0);
    guard.castShadow = true;
    g.add(guard);
  }
  // tail lights and side reflectors
  const lamps = [];
  for (const s of [-1, 1]) {
    const lamp = box(0.12, 0.07, 0.03, s * (w / 2 - 0.12), y - 0.12, z0 - 0.02, M.lens);
    lamps.push(lamp);
    g.add(lamp);
    g.add(box(0.05, 0.03, 0.01, s * (w / 2 + 0.03), y + 0.12, z1 - 0.2, M.amber));
  }
  g.userData.lamps = lamps;
  return g;
}

function buildWheel() {
  const M = mats();
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.TorusGeometry(WHEEL.r - 0.06, 0.065, 12, 28).rotateY(Math.PI / 2), M.tyre);
  t.scale.set(WHEEL.w / 0.13, 1, 1);
  g.add(t);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL.r - 0.1, WHEEL.r - 0.1, WHEEL.w * 0.8, 20).rotateZ(Math.PI / 2), M.rim);
  g.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, WHEEL.w, 10).rotateZ(Math.PI / 2), M.chrome);
  g.add(hub);
  g.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
  return g;
}

export class Trailer {
  constructor(mgr, pos, quat) {
    this.mgr = mgr;
    const game = (this.game = mgr.game);
    const W = game.physics.world;
    this.root = buildBody();
    game.worldGroup.add(this.root);
    // chassis: bed, side boards, drawbar and a jockey wheel to stand on when unhitched
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }).setLinearDamping(0.05).setAngularDamping(0.4);
    this.body = W.createRigidBody(desc);
    const owner = { kind: 'trailer', trailer: this };
    const add = (c) => {
      c.setCollisionGroups(TRAILER_GROUP);
      const col = W.createCollider(c, this.body);
      game.physics.setOwner(col, owner);
      return col;
    };
    const { w, l, y, z0 } = BED;
    add(RAPIER.ColliderDesc.cuboid(w / 2, 0.06, l / 2).setTranslation(0, y - 0.06, z0 + l / 2).setMass(MASS * 0.7).setFriction(0.9));
    for (const s of [-1, 1]) add(RAPIER.ColliderDesc.cuboid(0.02, 0.12, l / 2).setTranslation(s * (w / 2 + 0.01), y + 0.12, z0 + l / 2).setMass(8));
    add(RAPIER.ColliderDesc.cuboid(w / 2, 0.12, 0.02).setTranslation(0, y + 0.12, z0 + l).setMass(5));
    add(RAPIER.ColliderDesc.cuboid(0.06, 0.05, 0.55).setTranslation(0, COUPLER.y - 0.02, COUPLER.z - 0.55).setMass(MASS * 0.15));
    add(RAPIER.ColliderDesc.ball(0.07).setTranslation(0.12, 0.2, COUPLER.z - 0.42).setMass(4).setFriction(0.15));
    // wheels on revolute joints across the axle
    this.wheels = [];
    for (const s of [-1, 1]) {
      const wp = V(s * WHEEL.x, WHEEL.y, 0).applyQuaternion(quat).add(pos);
      const wb = W.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(wp.x, wp.y, wp.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }).setAngularDamping(0.15));
      const wc = W.createCollider(RAPIER.ColliderDesc.cylinder(WHEEL.w / 2, WHEEL.r).setRotation(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2)).setMass(18).setFriction(1.1).setCollisionGroups(TRAILER_GROUP), wb);
      game.physics.setOwner(wc, owner);
      const j = RAPIER.JointData.revolute({ x: s * WHEEL.x, y: WHEEL.y, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
      W.createImpulseJoint(j, this.body, wb, true);
      const mesh = buildWheel();
      game.worldGroup.add(mesh);
      this.wheels.push({ body: wb, mesh });
    }
    this.hitch = null;
    this.sync();
  }

  // Tow point of a car in its own space (behind the rear bumper, at bumper height).
  static towPoint(car) {
    const S = car.type.SPEC;
    return V(0, 0.44, S.rearTip - 0.08);
  }

  couplerWorld() {
    return COUPLER.clone().applyMatrix4(this.root.matrixWorld);
  }

  // The car whose tow point is close enough to drop the coupler onto, or null.
  hitchableCar() {
    const c = this.couplerWorld();
    for (const car of this.game.fleet.cars) {
      if (car.trailer && car.trailer !== this) continue;
      const tp = Trailer.towPoint(car).applyMatrix4(car.root.matrixWorld);
      if (tp.distanceTo(c) < 0.9) return car;
    }
    return null;
  }

  hitchTo(car) {
    const W = this.game.physics.world;
    const tp = Trailer.towPoint(car);
    const j = RAPIER.JointData.spherical({ x: tp.x, y: tp.y, z: tp.z }, { x: COUPLER.x, y: COUPLER.y, z: COUPLER.z });
    this.hitch = { car, joint: W.createImpulseJoint(j, car.dyn.body, this.body, true) };
    car.trailer = this;
    this.game.audio && this.game.audio.play('install', { at: this.couplerWorld(), volume: 0.8 });
  }

  unhitch() {
    if (!this.hitch) return;
    this.game.physics.world.removeImpulseJoint(this.hitch.joint, true);
    this.hitch.car.trailer = null;
    this.hitch = null;
    this.game.audio && this.game.audio.play('remove', { at: this.couplerWorld(), volume: 0.8 });
  }

  // Pulled by hand: the coupler is drawn toward `target` (world), only sideways and along.
  pull(target, dt) {
    const c = this.couplerWorld();
    const d = target.clone().sub(c);
    d.y = Math.max(0, d.y) * 0.5;
    const v = this.body.linvel();
    const k = Math.min(1, dt * 8);
    const want = d.multiplyScalar(2.5);
    const len = want.length();
    if (len > 2.2) want.multiplyScalar(2.2 / len);
    const imp = V((want.x - v.x) * k, (want.y - Math.min(0, v.y)) * k * 0.3, (want.z - v.z) * k).multiplyScalar(MASS * 0.35);
    this.body.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: c.x, y: c.y, z: c.z }, true);
  }

  sync() {
    // drawn between physics steps, like the cars
    const ph = this.game.physics;
    if (!this.smooth) this.smooth = ph.track(this.body);
    ph.pose(this.smooth, this.root.position, this.root.quaternion);
    this.root.updateMatrixWorld(true);
    for (const w of this.wheels) {
      if (!w.smooth) w.smooth = ph.track(w.body);
      ph.pose(w.smooth, w.mesh.position, w.mesh.quaternion);
    }
    // tail lights follow the car's
    const car = this.hitch && this.hitch.car;
    const on = car ? car.emissive.tail.emissiveIntensity : 0;
    for (const l of this.root.userData.lamps) l.material.emissiveIntensity = on;
  }

  serialize(origin) {
    const t = this.body.translation(),
      r = this.body.rotation();
    return { pos: [t.x + origin.x, t.y, t.z + origin.z], quat: [r.x, r.y, r.z, r.w], hitchedTo: this.hitch ? this.hitch.car.id : null };
  }

  dispose() {
    this.unhitch();
    const W = this.game.physics.world;
    this.game.physics.untrack(this.smooth);
    for (const w of this.wheels) {
      this.game.physics.untrack(w.smooth);
      W.removeRigidBody(w.body);
      this.game.worldGroup.remove(w.mesh);
    }
    W.removeRigidBody(this.body);
    this.game.worldGroup.remove(this.root);
  }
}

export class Trailers {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(pos, yaw = 0) {
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
    const t = new Trailer(this, pos, q);
    this.list.push(t);
    return t;
  }

  // Farms, ranches and junkyards sometimes have an old trailer standing about (once per place;
  // after that it is an ordinary saved trailer).
  onPoiLoaded(inst) {
    if (!['farm', 'ranch', 'junkyard'].includes(inst.poi.type) || inst.state.trailerChecked) return;
    inst.state.trailerChecked = true;
    if (hash01(this.game.seed, inst.k, 611) > 0.55) return;
    inst.root.updateMatrixWorld(true);
    const w = V(-9, 0, 9).applyMatrix4(inst.root.matrixWorld);
    w.y = this.game.groundHeightAt(w.x, w.z) + 0.05;
    this.spawn(w, inst.poi.rot + 2.2);
  }

  update() {
    for (const t of this.list) t.sync();
  }

  serialize() {
    return this.list.map((t) => t.serialize(this.game.origin));
  }

  restore(list) {
    const o = this.game.origin;
    for (const s of list || []) {
      const t = new Trailer(this, V(s.pos[0] - o.x, s.pos[1] + 0.05, s.pos[2] - o.z), new THREE.Quaternion(...s.quat));
      this.list.push(t);
      if (s.hitchedTo !== null && s.hitchedTo !== undefined) {
        const car = this.game.fleet.cars.find((c) => c.id === s.hitchedTo);
        if (car) t.hitchTo(car);
      }
    }
  }
}
