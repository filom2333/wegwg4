// Utility trailer: a steel-framed plank bed on a single axle, A-frame drawbar with a ball coupler
// and a jockey wheel. Physics: one chassis body riding on two sprung wheels (a ray down from each
// hub, like the cars: a spring and damper, tyres that grip sideways and roll along) and, when
// hitched, a ball joint to the car's tow point. Loose things put on the bed ride along on its
// collider. Unhitched, it can be pulled by the drawbar.

import * as THREE from 'three';
import { RAPIER, G, groups, GROUPS } from '../physics/physics.js';
import { roundedBox, latheY } from '../gfx/geom.js';
import { addSurfaceDetail } from '../gfx/triplanar.js';
import { hash01 } from '../core/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// trailer space: +z toward the drawbar (forward), +y up; the axle sits at z = 0
const BED = { w: 1.42, l: 2.2, y: 0.62, z0: -1.05 };
const WHEEL = { r: 0.31, w: 0.17, x: 0.86, y: 0.31 };
const COUPLER = V(0, 0.45, 2.15);
const MASS = 260;
// the springs: the ray starts `top` above the hub; at rest the spring is `sag` in; past `stop` in
// it meets the bump stop. N/m and N per m/s.
const SUSP = { top: 0.1, sag: 0.045, stop: 0.13, k: 26000, bump: 1200, rebound: 1800, grip: 0.95 };
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _fw = new THREE.Vector3();
const _sd = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _v = new THREE.Vector3();
const _r = new THREE.Vector3();
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
    // the wheels: sprung on rays (physStep); a hard tyre on the chassis at each hub, smaller than
    // the wheel, takes over only if a spring bottoms out or the trailer goes over on its side.
    // (Wheels of their own on hinge joints wobbled at speed and threw the trailer over.)
    this.wheels = [];
    for (const s of [-1, 1]) {
      add(RAPIER.ColliderDesc.cylinder(WHEEL.w / 2, WHEEL.r - 0.07).setRotation(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2)).setTranslation(s * WHEEL.x, WHEEL.y, 0).setMass(18).setFriction(0.4));
      const mesh = buildWheel();
      this.root.add(mesh);
      mesh.position.set(s * WHEEL.x, WHEEL.y, 0);
      this.wheels.push({ side: s, mesh, comp: SUSP.sag, prevComp: SUSP.sag, contact: false, spin: 0, roll: 0 });
    }
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.preStep = (dt) => this.physStep(dt);
    game.physics.beforeStep.push(this.preStep);
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
    const tp = car.toBody(Trailer.towPoint(car));
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

  // Each physics step: the springs hold the bed up over the ground under each wheel, the tyres
  // keep it from sliding sideways and roll freely along (a little drag; more when unhitched, so a
  // trailer left on a slope does not run away).
  physStep(dt) {
    const b = this.body;
    if (!b.isEnabled() || b.isSleeping()) return;
    const t = b.translation(),
      r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const up = _up.set(0, 1, 0).applyQuaternion(_q);
    const ray = this.ray;
    ray.dir.x = -up.x;
    ray.dir.y = -up.y;
    ray.dir.z = -up.z;
    const len = SUSP.top + WHEEL.r + SUSP.sag;
    const com = b.worldCom(),
      lv = b.linvel(),
      av = b.angvel();
    const share = b.mass() / 2;
    const drag = this.hitch ? 25 : 120;
    // rolled far over, the ground's reaction (along its normal) takes over from the spring's axis
    const tilt = Math.min(1, Math.max(0, (0.9 - up.y) / 0.25));
    for (const w of this.wheels) {
      w.prevComp = w.comp;
      _p.set(w.side * WHEEL.x, WHEEL.y + SUSP.top, 0).applyQuaternion(_q);
      ray.origin.x = t.x + _p.x;
      ray.origin.y = t.y + _p.y;
      ray.origin.z = t.z + _p.z;
      const hit = this.game.physics.world.castRayAndGetNormal(ray, len, true, undefined, GROUPS.wheelRay, undefined, b);
      w.contact = !!hit;
      if (!hit) {
        w.comp = 0;
        w.roll = 0;
        continue;
      }
      const d = hit.timeOfImpact;
      w.comp = len - d;
      const vComp = (w.comp - w.prevComp) / dt;
      let F = SUSP.k * w.comp + (vComp > 0 ? SUSP.bump : SUSP.rebound) * vComp;
      if (w.comp > SUSP.stop) F += (w.comp - SUSP.stop) * 300000;
      F = Math.max(0, F);
      const n = _n.set(hit.normal.x, hit.normal.y, hit.normal.z);
      const cp = _p.set(ray.origin.x - up.x * d, ray.origin.y - up.y * d, ray.origin.z - up.z * d);
      const dir = tilt > 0 ? _r.copy(up).lerp(n, tilt).normalize() : _r.copy(up);
      const load = F * Math.max(0.2, n.dot(up));
      b.applyImpulseAtPoint({ x: dir.x * F * dt, y: dir.y * F * dt, z: dir.z * F * dt }, { x: cp.x + up.x * 0.05, y: cp.y + up.y * 0.05, z: cp.z + up.z * 0.05 }, false);
      // the tyre: velocity of the bed at the contact, along and across the wheel on the ground
      _r.set(cp.x - com.x, cp.y - com.y, cp.z - com.z);
      const v = _v.set(av.y * _r.z - av.z * _r.y + lv.x, av.z * _r.x - av.x * _r.z + lv.y, av.x * _r.y - av.y * _r.x + lv.z);
      const fw = _fw.set(0, 0, 1).applyQuaternion(_q);
      fw.addScaledVector(n, -fw.dot(n)).normalize();
      const sd = _sd.crossVectors(n, fw);
      const vs = v.dot(sd),
        vf = v.dot(fw);
      const cap = SUSP.grip * load * dt;
      const js = Math.max(-cap, Math.min(cap, -vs * share * 0.6));
      const jf = Math.max(-cap, Math.min(cap, -vf * drag * dt));
      b.applyImpulseAtPoint({ x: sd.x * js + fw.x * jf, y: sd.y * js + fw.y * jf, z: sd.z * js + fw.z * jf }, { x: cp.x, y: cp.y, z: cp.z }, false);
      w.roll = vf / WHEEL.r;
    }
  }

  sync() {
    // drawn between physics steps, like the cars
    const ph = this.game.physics;
    if (!this.smooth) this.smooth = ph.track(this.body);
    ph.pose(this.smooth, this.root.position, this.root.quaternion);
    // the wheels on their springs, turning with the ground going by
    const dt = Math.min(0.1, ph.time - (this.syncedAt ?? ph.time));
    this.syncedAt = ph.time;
    for (const w of this.wheels) {
      const drop = w.contact ? SUSP.sag - w.comp : SUSP.sag + 0.04;
      w.mesh.position.y += (WHEEL.y - drop - w.mesh.position.y) * Math.min(1, dt * 30);
      w.spin = (w.spin + w.roll * dt) % (Math.PI * 2);
      w.mesh.rotation.x = w.spin;
    }
    this.root.updateMatrixWorld(true);
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
    const pre = this.game.physics.beforeStep;
    if (pre.includes(this.preStep)) pre.splice(pre.indexOf(this.preStep), 1);
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
