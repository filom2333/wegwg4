// World items: physical props the player can pick up, carry, use, stow in the car and install
// (for car parts). Handles loot spawning per POI, persistence, and physics sync.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { ITEMS, LOOT, SPOT_CHANCE, initialState, itemMass, itemLabel } from './itemDefs.js';
import { MODEL_BUILDERS } from './itemModels.js';
import { carType } from '../vehicle/types.js';
import { tunedLabel, tuneVisual } from '../vehicle/tuning.js';
import { cargoZone, cargoDeck } from '../vehicle/accessories.js';
import { mulberry32 } from '../core/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
let NEXT_ID = 1;

const _up = new THREE.Vector3();
const _d = new THREE.Vector3(),
  _down = new THREE.Vector3(0, -1, 0),
  _yAxis = new THREE.Vector3(0, 1, 0),
  _qs = new THREE.Quaternion(),
  _qi = new THREE.Quaternion(),
  _wp = new THREE.Vector3(),
  _ax = new THREE.Vector3(),
  _perp = new THREE.Vector3();
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// the vials of a spirit level: axis, centre, how far the bubble can run, and how keenly it does
const VIALS = { bubbleX: { a: V(1, 0, 0), c: V(0, 0, 0), run: 0.021, gain: 0.32, lift: 0.0035 }, bubbleY: { a: V(0, 1, 0), c: V(0.15, 0, 0), run: 0.0075, gain: 0.2, lift: 0.0035 } };

export class Item {
  constructor(sys, { id, part = null, state = {}, mesh }) {
    this.sys = sys;
    this.uid = NEXT_ID++;
    this.id = id; // item definition id, or 'part:<partId>'
    this.part = part; // car part id if this is a removed car part
    this.def = part ? null : ITEMS[id];
    this.state = state;
    this.mesh = mesh;
    this.body = null;
    this.collider = null;
    this.stowed = null; // { car, local: Matrix4, collider }
    this.held = false;
    this.size = mesh.userData.size ? mesh.userData.size.clone() : new THREE.Box3().setFromObject(mesh).getSize(V(0, 0, 0));
    this.poiKey = null;
    this.spot = null;
    this.ownerTag = { kind: 'item', item: this };
  }

  get name() {
    if (this.part) return tunedLabel(carType(this.state.carType), this.part, this.state.tune);
    return itemLabel(this.id, this.state);
  }

  get mass() {
    if (this.part) return (carType(this.state.carType).PARTS[this.part] || { mass: 10 }).mass;
    return itemMass(this.id, this.state);
  }

  worldPosition(out = V(0, 0, 0)) {
    return this.mesh.getWorldPosition(out);
  }
}

export class ItemSystem {
  constructor(game) {
    this.game = game;
    this.items = new Set();
    this.group = new THREE.Group();
    this.group.name = 'items';
    game.worldGroup.add(this.group);
    this.saved = new Map(); // poi key -> [{id, part, state, pos, quat}] items left at a POI
    this.loose = []; // serialized items far from any POI
  }

  // ------------------------------------------------------------------ creation
  // Item models are built once per kind/variant and cloned: clones share geometry and materials
  // (only a lantern's glow gets its own material, since its brightness follows the item's state).
  buildMesh(id, state = {}) {
    const d = ITEMS[id];
    const variant = d.variants ? state.variant || 0 : null;
    const key = variant === null ? id : id + ':' + variant;
    this.protos = this.protos || new Map();
    let proto = this.protos.get(key);
    if (!proto) {
      const [fn, ...args] = d.model;
      proto = MODEL_BUILDERS[fn](...args, ...(variant === null ? [] : [variant]));
      if (!proto.userData.size) {
        const b = new THREE.Box3().setFromObject(proto);
        const c = b.getCenter(V(0, 0, 0));
        for (const ch of proto.children) ch.position.sub(c);
        if (proto.userData.muzzle) proto.userData.muzzle.sub(c);
        for (const k of ['grip', 'grip2']) if (proto.userData[k]) proto.userData[k].p.sub(c);
        proto.userData.size = b.getSize(V(0, 0, 0));
      }
      proto.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.userData.shared = true;
        }
      });
      this.protos.set(key, proto);
    }
    const g = proto.clone();
    // clone() copies userData through JSON, which turns vectors into plain objects
    g.userData = cloneUserData(proto.userData);
    const glow = g.getObjectByName('glow');
    if (glow && glow.material) glow.material = glow.material.clone();
    return g;
  }

  // Mesh for a removed car part: shares the geometry of a car of its type (the current car if
  // it is one, else any in the fleet, else the type's template model).
  buildPartMesh(partId, typeId = null, tune = null) {
    const g0 = this.game;
    const tid = carType(typeId || (g0.car && g0.car.type.id)).id;
    let car = g0.car && g0.car.type.id === tid ? g0.car : g0.fleet.cars.find((c) => c.type.id === tid) || g0.fleet.template(tid);
    // a slot holding another car's part no longer shows this type's own
    if (car.model.parts[partId].foreign) car = g0.fleet.template(tid);
    const src = car.model.parts[partId];
    const g = new THREE.Group();
    const bbox = src.bbox;
    const c = bbox.getCenter(V(0, 0, 0));
    // clone the part's content at its rest pose relative to its bbox centre
    const inv = new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z);
    src.pivot.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(car.root.matrixWorld).invert();
    const pivotRest = new THREE.Matrix4();
    // rest pose of the pivot (closed) in car space
    const savedQ = src.pivot.quaternion.clone();
    src.pivot.quaternion.identity();
    src.pivot.updateMatrixWorld(true);
    // (another steering wheel on the column takes the place of the car's own)
    const swapWheel = tune && (car.type.PART_FAMILY && car.type.PART_FAMILY[partId] ? car.type.PART_FAMILY[partId] : partId) === 'steeringWheel';
    const spinner = swapWheel ? src.inner.getObjectByName('steeringSpin') : null;
    const swapSeat = tune && (partId === 'seat_FL' || partId === 'seat_FR');
    src.inner.traverse((o) => {
      if (!o.isMesh || o.userData.tuneMesh) return;
      if (spinner || swapSeat) return;
      const m = new THREE.Mesh(o.geometry, o.material);
      const local = rootInv.clone().multiply(o.matrixWorld);
      m.applyMatrix4(inv.clone().multiply(local));
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.shared = true;
      g.add(m);
    });
    // its tune: a wheel's tread rides its spin group, the rest is built in car space
    if (tune) {
      const wheel = car.model.wheels && car.model.wheels[partId];
      const v = tuneVisual(car, partId, tune, wheel ? wheel.spin : null);
      if (v) {
        v.updateMatrix();
        const m = wheel ? rootInv.clone().multiply(wheel.spin.matrixWorld) : spinner ? rootInv.clone().multiply(spinner.matrixWorld) : new THREE.Matrix4();
        v.applyMatrix4(inv.clone().multiply(m));
        g.add(v);
      }
    }
    src.pivot.quaternion.copy(savedQ);
    src.pivot.updateMatrixWorld(true);
    void pivotRest;
    g.userData.size = bbox.getSize(V(0, 0, 0));
    g.userData.partCenter = c;
    return g;
  }

  spawn(id, pos, quat = new THREE.Quaternion(), state = null, { sleep = false } = {}) {
    state = state || initialState(id, Math.random);
    const mesh = this.buildMesh(id, state);
    const it = new Item(this, { id, state, mesh });
    this.group.add(mesh);
    this.items.add(it);
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    this.makeBody(it, pos, quat, sleep);
    this.refreshVisual(it);
    return it;
  }

  spawnPart(partId, pos, quat = new THREE.Quaternion(), state = {}) {
    if (!state.carType) state.carType = this.game.car ? this.game.car.type.id : 'kiri86';
    const mesh = this.buildPartMesh(partId, state.carType, state.tune);
    const it = new Item(this, { id: 'part:' + partId, part: partId, state, mesh });
    // a panel carries its own rust (a wire brush works on it lying loose too)
    if (state.rust !== undefined) {
      it.rustU = { value: state.rust };
      const own = new Map();
      mesh.traverse((o) => {
        const base = o.isMesh && o.material;
        if (!base || !base.userData.weathered) return;
        if (!own.has(base)) {
          const m = base.clone();
          m.color = base.color;
          m.onBeforeCompile = (shader, r) => {
            base.onBeforeCompile(shader, r);
            if (shader.uniforms.uRust) shader.uniforms.uRust = it.rustU;
          };
          m.customProgramCacheKey = base.customProgramCacheKey;
          own.set(base, m);
        }
        o.material = own.get(base);
      });
    }
    this.group.add(mesh);
    this.items.add(it);
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    this.makeBody(it, pos, quat, false);
    return it;
  }

  makeBody(it, pos, quat, sleep) {
    const ph = this.game.physics;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinearDamping(0.15)
      .setAngularDamping(0.4)
      .setCcdEnabled(it.mass < 5);
    if (sleep) desc.setSleeping(true);
    it.body = ph.world.createRigidBody(desc);
    const s = it.size;
    const hx = Math.max(0.012, s.x / 2),
      hy = Math.max(0.012, s.y / 2),
      hz = Math.max(0.012, s.z / 2);
    // a ball is round, light on its feet and bouncy
    const cd = (it.def && it.def.ball ? RAPIER.ColliderDesc.ball(Math.max(hx, hy, hz)).setRestitution(0.72).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max).setFriction(0.6) : RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.75).setRestitution(0.12)).setMass(Math.max(0.05, it.mass)).setCollisionGroups(GROUPS.item);
    if (it.part) cd.setFriction(0.9);
    if (it.def && it.def.ball) it.body.setAngularDamping(0.08);
    it.collider = ph.world.createCollider(cd, it.body);
    ph.setOwner(it.collider, it.ownerTag);
  }

  removeBody(it) {
    if (it.body) this.game.physics.removeBody(it.body);
    it.body = null;
    it.collider = null;
  }

  destroy(it) {
    this.removeBody(it);
    if (it.light) this.game.lights.remove(it.light);
    if (it.stowed) this.unstow(it, false);
    if (it.mounted) this.unmount(it, false);
    it.mesh.parent && it.mesh.parent.remove(it.mesh);
    this.items.delete(it);
    if (it.poiKey !== null && it.spot !== null) {
      const st = this.game.pois.state.get(it.poiKey);
      if (st) st.taken.add(it.spot);
    }
  }

  // ------------------------------------------------------------------ car storage
  // Attach an item to the car (no own body; collider becomes part of the car compound).
  stow(it, car) {
    this.removeBody(it);
    const inv = new THREE.Matrix4().copy(car.root.matrixWorld).invert();
    const local = inv.multiply(it.mesh.matrixWorld.clone());
    car.root.attach(it.mesh);
    const p = V(0, 0, 0),
      q = new THREE.Quaternion(),
      sc = V(0, 0, 0);
    local.decompose(p, q, sc);
    const s = it.size;
    const bp = car.toBody(p);
    const cd = RAPIER.ColliderDesc.cuboid(Math.max(0.012, s.x / 2), Math.max(0.012, s.y / 2), Math.max(0.012, s.z / 2))
      .setTranslation(bp.x, bp.y, bp.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setDensity(0)
      .setCollisionGroups(GROUPS.item);
    const col = this.game.physics.world.createCollider(cd, car.dyn.body);
    this.game.physics.setOwner(col, it.ownerTag);
    // car-space state for the cargo simulation: it rests where it was put down
    const zone = cargoZone(car, p, it.size) || 'cabin';
    it.stowed = { car, zone, collider: col, rest: p.clone(), p: p.clone(), v: V(0, 0, 0), q: q.clone(), spin: 0, air: false, tumble: V(0, 0, 0) };
    car.attached.push(it);
    car.owned = true; // a car with your things in it stays where you left it
    car.updateMass();
    it.poiKey = null;
  }

  unstow(it, makeBody = true) {
    const car = it.stowed.car;
    this.game.physics.removeCollider(it.stowed.collider);
    car.attached = car.attached.filter((x) => x !== it);
    it.stowed = null;
    this.group.attach(it.mesh);
    if (makeBody) this.makeBody(it, it.mesh.position, it.mesh.quaternion, false);
    car.updateMass();
  }

  // ------------------------------------------------------------------ bolted to a car
  // An item bolted to a part of a car (the roof, a door, a wing): it rides on the part, swings
  // with a door and comes off with it; a box on the car's body keeps it solid and in reach.
  // local: its matrix in the part pivot's space.
  // hang: a decoration on the mirror, hung from that point (part space) and left to swing.
  mount(it, car, part, local, { hang = null } = {}) {
    const mp = car.model.parts[part];
    if (!mp) return false;
    this.removeBody(it);
    if (it.stowed) this.unstow(it, false);
    mp.pivot.add(it.mesh);
    local.decompose(it.mesh.position, it.mesh.quaternion, it.mesh.scale);
    it.mounted = { car, part, local: local.clone(), collider: null, rest: V(0, 0, 0), openT: -1 };
    if (hang) {
      const h = it.mesh.userData.hangTop || { x: 0, y: it.size.y / 2, z: 0 };
      it.mounted.hang = { at: hang.clone(), top: V(h.x, h.y, h.z), tx: 0, tz: 0, vx: 0, vz: 0, spin: Math.random() * 6 };
      this.swing(it, it.mounted.hang, V(0, -9.81, 0), 0);
    }
    car.attached.push(it);
    this.mountCollider(it);
    car.owned = true;
    car.updateMass();
    it.poiKey = null;
    return true;
  }

  // The item's box on the car's body where its part holds it now.
  mountCollider(it) {
    const M = it.mounted,
      car = M.car;
    if (M.collider) this.game.physics.removeCollider(M.collider);
    car.root.updateMatrixWorld(true);
    const m = new THREE.Matrix4().copy(car.root.matrixWorld).invert().multiply(it.mesh.matrixWorld);
    const p = V(0, 0, 0),
      q = new THREE.Quaternion(),
      sc = V(0, 0, 0);
    m.decompose(p, q, sc);
    if (M.openT < 0) M.rest.copy(p);
    M.openT = car.model.parts[M.part].openT || 0;
    const s = it.size;
    const bp = car.toBody(p);
    const cd = RAPIER.ColliderDesc.cuboid(Math.max(0.012, s.x / 2), Math.max(0.012, s.y / 2), Math.max(0.012, s.z / 2))
      .setTranslation(bp.x, bp.y, bp.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setDensity(0)
      .setCollisionGroups(GROUPS.item);
    M.collider = this.game.physics.world.createCollider(cd, car.dyn.body);
    this.game.physics.setOwner(M.collider, it.ownerTag);
  }

  unmount(it, makeBody = true) {
    const M = it.mounted;
    if (M.collider) this.game.physics.removeCollider(M.collider);
    M.car.attached = M.car.attached.filter((x) => x !== it);
    it.mounted = null;
    this.group.attach(it.mesh);
    if (makeBody) this.makeBody(it, it.mesh.position, it.mesh.quaternion, false);
    M.car.updateMass();
  }

  // Boxes of things bolted to a door or a lid follow it as it swings; what hangs from the mirror
  // swings with the car's every lurch, and the toys on the dash nod and sway.
  updateMounted(dt) {
    for (const c of (this.game.fleet && this.game.fleet.cars) || [this.game.car]) {
      if (!c || !c.attached || !c.attached.length) continue;
      // what the car's occupants feel: gravity less the car's acceleration, in the car's frame
      const v = c.dyn.body.linvel();
      const pv = c._pv || (c._pv = V(v.x, v.y, v.z));
      if (dt > 0) {
        const a = V((v.x - pv.x) / dt, (v.y - pv.y) / dt, (v.z - pv.z) / dt);
        c._acc = (c._acc || V(0, 0, 0)).lerp(a.clampLength(0, 60), Math.min(1, dt * 15));
      }
      pv.set(v.x, v.y, v.z);
      const feel = V(0, -9.81, 0)
        .sub(c._acc || V(0, 0, 0))
        .applyQuaternion(c.root.quaternion.clone().invert());
      for (const it of c.attached) {
        const M = it.mounted;
        if (!M) continue;
        if (Math.abs((c.model.parts[M.part].openT || 0) - M.openT) > 0.02) this.mountCollider(it);
        if (dt <= 0) continue;
        if (M.hang) this.swing(it, M.hang, feel, dt);
        else if (it.def && it.def.bobble) this.bobble(it, feel, dt);
      }
    }
  }

  // A pendulum from the mirror: it leans to where the felt gravity points and swings about it.
  swing(it, H, feel, dt) {
    const up = Math.max(1, -feel.y);
    const ex = THREE.MathUtils.clamp(feel.x / up, -1.5, 1.5),
      ez = THREE.MathUtils.clamp(feel.z / up, -1.5, 1.5);
    const L = Math.max(0.04, H.top.length());
    const k = 9.81 / L,
      c = 2.2;
    for (let s = 0, n = Math.ceil(dt / 0.008); s < n; s++) {
      const h = dt / n;
      H.vx += (k * (ex - H.tx) - c * H.vx) * h;
      H.vz += (k * (ez - H.tz) - c * H.vz) * h;
      H.tx += H.vx * h;
      H.tz += H.vz * h;
    }
    H.spin += dt * (H.vx * 0.6 - H.vz * 0.4);
    const d = _d.set(H.tx, -1, H.tz).normalize();
    const q = it.mesh.quaternion.setFromUnitVectors(_down, d).multiply(_qs.setFromAxisAngle(_yAxis, Math.sin(H.spin) * 0.6));
    it.mesh.position.copy(H.at).sub(_d.copy(H.top).applyQuaternion(q).multiplyScalar(it.mesh.scale.x));
  }

  // A toy on a spring (its 'bob' part): nods with the bumps and braking, sways in the bends.
  bobble(it, feel, dt) {
    const bob = it.bob || (it.bob = it.mesh.getObjectByName('bob'));
    if (!bob) return;
    const B = it.bobS || (it.bobS = { x: 0, z: 0, vx: 0, vz: 0, fy: -9.81 });
    const f = _d.copy(feel).applyQuaternion(_qs.copy(it.mesh.quaternion).invert());
    const up = Math.max(1, -f.y);
    // a jolt up or down sets it going; the spring and the felt lean set where it settles
    const jolt = (f.y - B.fy) * 0.9;
    B.fy = f.y;
    const k = it.def.bobble === 'nod' ? 70 : 45,
      c = 1.6;
    B.vx += (k * (-f.z / up) * 0.5 - k * B.x - c * B.vx) * dt + jolt * (it.def.bobble === 'nod' ? 1 : 0.4);
    B.vz += (k * (f.x / up) * 0.6 - k * B.z - c * B.vz) * dt + jolt * 0.2 * Math.sign(B.vz || 1);
    B.x = THREE.MathUtils.clamp(B.x + B.vx * dt, -0.7, 0.7);
    B.z = THREE.MathUtils.clamp(B.z + B.vz * dt, -0.7, 0.7);
    bob.rotation.set(B.x, 0, B.z);
  }

  // ------------------------------------------------------------------ holding
  take(it) {
    if (it.stowed) this.unstow(it, false);
    if (it.mounted) this.unmount(it, false);
    this.removeBody(it);
    it.held = true;
    if (it.poiKey !== null && it.spot !== null) {
      const st = this.game.pois.state.get(it.poiKey);
      if (st) st.taken.add(it.spot);
      this.game.stats.itemsLooted++;
      it.poiKey = null;
    }
  }

  // Put on (a hat, sunglasses): no body; the mesh rides on the player's head (player.syncWorn).
  wear(it, slot) {
    if (it.stowed) this.unstow(it, false);
    if (it.mounted) this.unmount(it, false);
    this.removeBody(it);
    it.held = false;
    it.worn = slot;
    it.wornOn = null;
    it.mesh.visible = false;
  }

  // Taken off again: back among the loose things (the caller takes it into the hand).
  unwear(it) {
    it.worn = null;
    it.wornOn = null;
    this.group.attach(it.mesh);
    it.mesh.scale.setScalar(1);
    it.mesh.visible = true;
  }

  release(it, pos, quat, vel = null) {
    it.held = false;
    if (it.mesh.parent !== this.group) this.group.attach(it.mesh);
    it.mesh.position.copy(pos);
    it.mesh.quaternion.copy(quat);
    this.makeBody(it, pos, quat, false);
    if (vel) it.body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
  }

  // Things promised to a place before it was ever loaded (car parts left at the neighbours').
  addPending(k, list) {
    if (!this.pending) this.pending = new Map();
    this.pending.set(k, [...(this.pending.get(k) || []), ...list]);
  }

  placePending(inst) {
    const list = this.pending && this.pending.get(inst.k);
    if (!list) return;
    this.pending.delete(inst.k);
    inst.root.updateMatrixWorld(true);
    const spots = inst.loot.filter((l) => l.kind !== 'wreck' && l.kind !== 'item');
    list.forEach((e, i) => {
      const sp = spots.length ? spots[(i * 7 + 3) % spots.length].pos : V(0, 0.2, 4);
      const wp = sp.clone().applyMatrix4(inst.root.matrixWorld).add(V(0, 0.12, 0));
      const it = this.spawnPart(e.part, wp, new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), i * 2.1), { condition: e.condition ?? 0.7, carType: e.carType });
      it.poiKey = inst.k;
    });
  }

  // ------------------------------------------------------------------ loot
  onPoiLoaded(inst, rnd) {
    const key = inst.k;
    this.placePending(inst);
    const saved = this.saved.get(key);
    const o = this.game.origin;
    if (saved) {
      for (const s of saved) {
        const pos = V(s.pos[0] - o.x, s.pos[1], s.pos[2] - o.z);
        const q = new THREE.Quaternion(...s.quat);
        const it = s.part ? this.spawnPart(s.part, pos, q, s.state) : this.spawn(s.id, pos, q, s.state, { sleep: true });
        it.poiKey = key;
        it.spot = s.spot ?? null;
      }
      this.saved.delete(key);
      return;
    }
    const lrnd = mulberry32(inst.poi.seed + 991);
    const lootMul = this.game.difficulty.loot;
    inst.root.updateMatrixWorld(true);
    // a story note in most places that have somewhere to leave one
    const story = this.game.story;
    if (story && inst.loot.length && !inst.state.noteSpawned && (inst.poi.type === 'homestead' || lrnd() < 0.75)) {
      const nid = story.nextNote();
      const spots = inst.loot.map((sp, i) => [sp, i]).filter(([sp]) => ['table', 'desk', 'counter', 'small', 'office', 'kitchen', 'wreck', 'camp', 'tent', 'shelf'].includes(sp.kind));
      if (nid && spots.length) {
        const [sp] = spots[Math.floor(lrnd() * spots.length)];
        const wp = sp.pos.clone().applyMatrix4(inst.root.matrixWorld);
        const it = this.spawn('note', V(wp.x, wp.y + 0.05, wp.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), lrnd() * 6.28), { note: nid }, { sleep: true });
        it.poiKey = null;
        inst.state.noteSpawned = true;
        story.pendingSpawn = story.pendingSpawn || new Set();
        story.pendingSpawn.add(nid);
      }
    }
    inst.loot.forEach((spot, i) => {
      if (inst.state.taken.has(i)) return;
      // a thing that stands in its place (a chair at a table), most of them still there
      if (spot.kind === 'item') {
        if (lrnd() > 0.85 || !ITEMS[spot.item]) return;
        const wp = spot.pos.clone().applyMatrix4(inst.root.matrixWorld);
        const st = initialState(spot.item, lrnd);
        if (spot.variant !== undefined) st.variant = spot.variant;
        const mesh = this.buildMesh(spot.item, st);
        const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), inst.poi.rot + (spot.rot || 0));
        const it = new Item(this, { id: spot.item, state: st, mesh });
        this.group.add(mesh);
        this.items.add(it);
        const pos = wp.add(V(0, mesh.userData.size.y / 2 + 0.01, 0));
        mesh.position.copy(pos);
        mesh.quaternion.copy(q);
        this.makeBody(it, pos, q, true);
        this.refreshVisual(it);
        it.poiKey = key;
        it.spot = i;
        return;
      }
      // most places were picked over long ago
      const chance = (SPOT_CHANCE[spot.kind] ?? 0.3) * lootMul * 0.7;
      if (lrnd() > chance) return;
      const table = LOOT[spot.kind] || LOOT.any;
      let tot = 0;
      for (const [, w] of table) tot += w;
      let r = lrnd() * tot;
      let id = table[0][0];
      for (const [k, w] of table) {
        r -= w;
        if (r <= 0) {
          id = k;
          break;
        }
      }
      const wp = spot.pos.clone().applyMatrix4(inst.root.matrixWorld);
      if (id.startsWith('part:')) {
        // spare car parts on shelves: used, but serviceable
        // 'part:<id>' or 'part:<id>:<tune>' (a tuned part: mud tyres, a sport muffler)
        const [part, tune] = id.slice(5).split(':');
        if (!this.game.car || !this.game.car.model.parts[part]) return;
        const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), lrnd() * Math.PI * 2);
        const st = { condition: 0.55 + lrnd() * 0.45 };
        if (tune) st.tune = tune;
        const it = this.spawnPart(part, wp.clone().add(V(0, 0.08, 0)), q, st);
        it.poiKey = key;
        it.spot = i;
        return;
      }
      const st = initialState(id, lrnd);
      const mesh = this.buildMesh(id, st);
      const h = mesh.userData.size.y;
      const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), lrnd() * Math.PI * 2);
      const it = new Item(this, { id, state: st, mesh });
      this.group.add(mesh);
      this.items.add(it);
      const pos = wp.clone().add(V((lrnd() - 0.5) * 0.15, h / 2 + 0.01, (lrnd() - 0.5) * 0.15));
      mesh.position.copy(pos);
      mesh.quaternion.copy(q);
      this.makeBody(it, pos, q, true);
      this.refreshVisual(it);
      it.poiKey = key;
      it.spot = i;
    });
  }

  onPoiUnloaded(inst) {
    const key = inst.k;
    const keep = [];
    const center = V(0, 0, 0);
    inst.root.getWorldPosition(center);
    const o = this.game.origin;
    for (const it of [...this.items]) {
      if (it.held || it.stowed || it.mounted || it.worn) continue;
      const p = it.mesh.position;
      if (Math.hypot(p.x - center.x, p.z - center.z) > 60) continue;
      keep.push({ id: it.id, part: it.part, state: it.state, pos: [p.x + o.x, p.y, p.z + o.z], quat: it.mesh.quaternion.toArray(), spot: it.poiKey === key ? it.spot : null });
      this.removeBody(it);
      it.mesh.parent && it.mesh.parent.remove(it.mesh);
      this.items.delete(it);
    }
    if (keep.length) this.saved.set(key, keep);
  }

  // ------------------------------------------------------------------ update
  update(dt = 0) {
    const ph = this.game.physics;
    if (dt > 0) this.updateCargo(dt);
    if (dt > 0) this.updateSpills(dt);
    this.updateMounted(dt);
    if (dt > 0) this.updateInstruments(dt);
    this.updateDetail();
    for (const it of this.items) {
      if (it.held || it.stowed || it.mounted || !it.body) continue;
      // a resting body is copied once more as it goes to sleep: things that fell onto a shelf
      // while the place was loading went to sleep before the first update ever saw them, and
      // their meshes stayed hanging where they appeared (aiming at them missed the collider)
      if (it.body.isSleeping()) {
        if (it.restSynced) continue;
        it.restSynced = true;
      } else it.restSynced = false;
      const t = it.body.translation(),
        r = it.body.rotation();
      it.mesh.position.set(t.x, t.y, t.z);
      it.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      // fell through the world: put it back on the ground
      if (t.y < -200 || (t.y < this.game.gen.height(t.x + this.game.origin.x, t.z + this.game.origin.z) - 3 && !it.body.isSleeping())) {
        const gy = this.game.groundHeightAt(t.x, t.z);
        it.body.setTranslation({ x: t.x, y: gy + 0.5, z: t.z }, true);
        it.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    void ph;
  }

  // Things with working insides, near the eye: the compass needle swings round to north, the
  // clock keeps the time (plus whatever it was set wrong by), the level's bubbles float to the
  // high side; flashlights run their batteries down.
  updateInstruments(dt) {
    const g = this.game;
    const eye = g.renderer && g.renderer.camera ? g.renderer.camera.position : null;
    for (const it of this.items) {
      const d = it.def;
      if (!d) continue;
      if (d.battery && it.state.on) {
        it.state.charge = Math.max(0, (it.state.charge ?? 1) - dt / (60 * 30));
        if (it.state.charge <= 0) {
          it.state.on = false;
          this.refreshVisual(it);
        } else if (it.light) {
          // weak batteries: dimmer and yellower, and the bulb flickers
          const c = it.state.charge;
          const k = Math.min(1, c / 0.2) * (c < 0.1 && Math.random() < 0.15 ? 0.3 : 1);
          it.light.intensity = 22 * k;
          const glow = it.mesh.getObjectByName('glow');
          if (glow) glow.material.emissiveIntensity = 2.5 * k;
          // in the hand it lights where you look, a little below the middle of the view
          if (it.held && g.renderer && g.renderer.camera) {
            const cam = g.renderer.camera;
            _ax.set(0, -0.06, -1).applyQuaternion(cam.quaternion).multiplyScalar(8).add(cam.position);
            it.mesh.updateWorldMatrix(true, false);
            it.light.target.position.copy(it.mesh.worldToLocal(_ax));
          } else if (it.mesh.userData.beam) it.light.target.position.copy(it.mesh.userData.lens || V(0, 0, 0)).addScaledVector(it.mesh.userData.beam, 4);
        }
      }
      if (!d.instrument || !eye) continue;
      it.mesh.getWorldPosition(_wp);
      if (_wp.distanceToSquared(eye) > 144) continue;
      it.mesh.getWorldQuaternion(_qi).invert();
      if (d.instrument === 'compass') {
        const n = it.mesh.getObjectByName('needle');
        if (!n) continue;
        // north (+z) in the compass's own frame; edge-on, the needle just hangs where it is
        _ax.set(0, 0, 1).applyQuaternion(_qi);
        const st = (it.needle = it.needle || { a: Math.random() * 6.28, v: 0 });
        if (_ax.x * _ax.x + _ax.z * _ax.z > 0.04) {
          const want = Math.atan2(_ax.x, _ax.z);
          st.v += (wrapPi(want - st.a) * 40 - st.v * 3.2) * Math.min(dt, 0.05);
        } else st.v *= 1 - Math.min(1, dt * 2);
        st.a = wrapPi(st.a + st.v * Math.min(dt, 0.05));
        n.rotation.y = st.a;
      } else if (d.instrument === 'clock') {
        const h = ((((g.env ? g.env.time : 12) + (it.state.offset || 0)) % 12) + 12) % 12;
        const hh = it.mesh.getObjectByName('hourHand'),
          mh = it.mesh.getObjectByName('minHand');
        if (hh) hh.rotation.z = -(h / 12) * Math.PI * 2;
        if (mh) mh.rotation.z = -(h % 1) * Math.PI * 2;
      } else if (d.instrument === 'level') {
        // world up in the level's frame
        _up.set(0, 1, 0).applyQuaternion(_qi);
        for (const [name, v] of Object.entries(VIALS)) {
          const b = it.mesh.getObjectByName(name);
          if (!b) continue;
          const t = _up.dot(v.a);
          const along = Math.max(-v.run, Math.min(v.run, t * (v.run / v.gain) * 4.5));
          _perp.copy(_up).addScaledVector(v.a, -t);
          if (_perp.lengthSq() > 0.01) _perp.normalize().multiplyScalar(v.lift);
          else _perp.set(0, 0, 0);
          // (the model was centred after it was built: the vials moved with it)
          if (!b.userData.shift) {
            const o = b.userData.orig || [0, 0, 0];
            b.userData.shift = [b.position.x - o[0], b.position.y - o[1], b.position.z - o[2]];
          }
          const o = b.userData.shift;
          const tx = v.c.x + v.a.x * along + _perp.x,
            ty = v.c.y + v.a.y * along + _perp.y,
            tz = v.c.z + v.a.z * along + _perp.z;
          const k = Math.min(1, dt * 7);
          b.position.x += (tx + o[0] - b.position.x) * k;
          b.position.y += (ty + o[1] - b.position.y) * k;
          b.position.z += (tz + o[2] - b.position.z) * k;
        }
      }
    }
  }

  // Small things out of the picture (and the shadows) once they are a few pixels across: a thing
  // of radius r goes at about r x 300 m (a can at 20 m, a jerry can at 55 m). Checked a slice of
  // the list each frame; layer 1 is skipped by the camera and the shadow pass.
  updateDetail() {
    const g = this.game;
    if (!g.renderer || !this.items.size) return;
    const eye = g.renderer.camera.position;
    const list = (this._detailList = this.items.size !== (this._detailN || 0) || !this._detailList ? [...this.items] : this._detailList);
    this._detailN = this.items.size;
    const n = Math.max(1, Math.ceil(list.length / 8));
    for (let k = 0; k < n; k++) {
      this._detailI = ((this._detailI || 0) + 1) % list.length;
      const it = list[this._detailI];
      if (!it || !it.mesh || !this.items.has(it)) continue;
      // (shown again a little nearer than it goes: at the edge itself the camera's bob as you
      // walk put it in and out of the picture every few frames)
      const reach = Math.max(it.size.x, it.size.y, it.size.z) * 150 + 8;
      const near = it.held || it.worn || it.state.on ? true : it.mesh.getWorldPosition(_wp).distanceTo(eye) < reach * (it.detailShown === false ? 0.92 : 1);
      if (near === it.detailShown) continue;
      it.detailShown = near;
      it.mesh.traverse((o) => (o.layers.mask = near ? 1 : 2));
    }
  }

  // An open container lying on its side or upside down runs out.
  updateSpills(dt) {
    for (const it of this.items) {
      if (it.held || it.stowed || it.mounted || !it.def || !it.def.capped || !it.state.capOff || !(it.state.liquid > 0)) continue;
      const up = _up.set(0, 1, 0).applyQuaternion(it.mesh.quaternion).y;
      if (up > 0.3) continue;
      // glugging out of the open neck: faster the further over it is
      it.state.liquid = Math.max(0, it.state.liquid - dt * (0.3 + 0.8 * (0.3 - up)));
      this.refreshVisual(it);
      it.glug = (it.glug || 0) - dt;
      if (it.glug <= 0) {
        it.glug = 0.7 + Math.random() * 0.3;
        this.game.audio && this.game.audio.play('pour', { at: it.mesh.position, volume: 0.35 });
      }
    }
  }

  // ------------------------------------------------------------------ cargo
  // Things riding in the car stay attached to it but feel its motion: they slide across seats and
  // the trunk floor under hard braking, cornering and crashes, hop over bumps, and come to rest
  // again, always inside the car (bounded around where they were put down and by the cabin/trunk).
  updateCargo(dt) {
    const car = this.game.car;
    if (!car || !car.attached || !car.attached.length || !car.dyn) return;
    const body = car.dyn.body;
    const lv = body.linvel();
    const v = V(lv.x, lv.y, lv.z);
    const cs = (this._cargo = this._cargo || { v: v.clone(), a: V(0, 0, 0) });
    // the car's acceleration, smoothed over a couple of physics steps
    const a = v.clone().sub(cs.v).multiplyScalar(1 / Math.max(dt, 1e-3));
    cs.v.copy(v);
    cs.a.lerp(a, Math.min(1, dt / 0.04));
    // what the cargo feels in the car's frame: gravity minus the car's acceleration
    const qi = car.root.quaternion.clone().invert();
    const f = V(0, -9.81, 0).sub(cs.a).applyQuaternion(qi);
    const MU_S = 0.7,
      MU_K = 0.45;
    const tipped = 1 - 2 * (car.root.quaternion.x ** 2 + car.root.quaternion.z ** 2) < 0.2;
    const loose = [];
    for (const it of car.attached) {
      const s = it.stowed;
      if (!s || !s.rest) continue;
      const load = -f.y; // pressing it onto the surface
      const tang = V(f.x, 0, f.z);
      const speed = Math.hypot(s.v.x, s.v.z);
      if (!s.air) {
        if (load < 3.5) {
          // the car dropped away underneath (crest, crash): it floats free
          s.air = true;
          s.tumble.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
        } else if (speed > 0.01 || tang.length() > MU_S * load) {
          // sliding: pushed by the in-plane force, held back by friction
          const acc = tang.clone();
          const dir = speed > 0.01 ? V(s.v.x, 0, s.v.z).normalize() : tang.clone().normalize();
          acc.addScaledVector(dir, -MU_K * load);
          s.v.x += acc.x * dt;
          s.v.z += acc.z * dt;
          if (speed > 0.01 && V(s.v.x, 0, s.v.z).dot(dir) < 0) s.v.set(0, 0, 0); // friction stopped it
          s.spin += (Math.random() - 0.5) * speed * dt * 8;
        }
        s.v.y = 0;
        s.p.y = s.rest.y;
      } else {
        s.v.addScaledVector(f, dt);
        s.v.multiplyScalar(1 - 0.4 * dt);
        if (s.p.y + s.v.y * dt <= s.rest.y && s.v.y < 0) {
          // landing
          s.p.y = s.rest.y;
          s.v.y = -s.v.y * 0.25;
          s.v.x *= 0.6;
          s.v.z *= 0.6;
          if (Math.abs(s.v.y) < 0.4) {
            s.air = false;
            s.v.y = 0;
            s.tumble.multiplyScalar(0);
            // settle flat again about its own vertical
            const e = new THREE.Euler().setFromQuaternion(s.q, 'YXZ');
            s.q.setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ')).multiply(s.flat || new THREE.Quaternion());
          }
          if (Math.abs(s.v.y) > 0.6) this.game.audio && this.game.audio.play('land', { at: it.mesh.getWorldPosition(V(0, 0, 0)), volume: 0.25 });
        }
      }
      s.p.addScaledVector(s.v, dt);
      // stay inside: near where it was put down, below the roof, inside the cabin or trunk
      const R = 0.32;
      for (const k of ['x', 'z']) {
        const lo = s.rest[k] - R,
          hi = s.rest[k] + R;
        if (s.p[k] < lo || s.p[k] > hi) {
          s.p[k] = Math.min(hi, Math.max(lo, s.p[k]));
          if ((s.v[k] < 0 && s.p[k] === lo) || (s.v[k] > 0 && s.p[k] === hi)) {
            if (Math.abs(s.v[k]) > 1.2) this.game.audio && this.game.audio.play('land', { at: it.mesh.getWorldPosition(V(0, 0, 0)), volume: 0.2 });
            s.v[k] *= -0.3;
          }
        }
      }
      const sp = car.type.SPEC;
      if (s.zone === 'cabin') {
        const inTrunk = s.rest.z < sp.axleR - 0.1 || s.rest.z > sp.axleF - 0.2;
        const roof = inTrunk ? 0.95 : sp.roofY - 0.3;
        if (s.p.y > roof) {
          s.p.y = roof;
          if (s.v.y > 0) s.v.y *= -0.3;
        }
        s.p.x = Math.max(-(sp.halfWidth - 0.13), Math.min(sp.halfWidth - 0.13, s.p.x));
      } else {
        // strapped down: it shifts a little in the straps, and comes off when the car goes over
        const deck = cargoDeck(car, s.zone);
        if (deck) s.p.x = Math.max(-deck.hw, Math.min(deck.hw, s.p.x));
        if (tipped) {
          loose.push(it);
          continue;
        }
      }
      // orientation: spins while sliding, tumbles in the air
      if (!s.flat) s.flat = s.q.clone().premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -new THREE.Euler().setFromQuaternion(s.q, 'YXZ').y, 0, 'YXZ')));
      if (s.air) {
        const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.tumble.x * dt, s.tumble.y * dt, s.tumble.z * dt));
        s.q.premultiply(tq);
      } else if (s.spin) {
        s.q.premultiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), s.spin * dt));
        s.spin *= Math.max(0, 1 - dt * 4);
      }
      if (s.air || speed > 0.005 || s.spin) {
        it.mesh.position.copy(s.p);
        it.mesh.quaternion.copy(s.q);
        const k = car.k || 1;
        s.collider.setTranslationWrtParent({ x: s.p.x * k, y: s.p.y * k, z: s.p.z * k });
        s.collider.setRotationWrtParent({ x: s.q.x, y: s.q.y, z: s.q.z, w: s.q.w });
      }
    }
    for (const it of loose) {
      this.unstow(it, true);
      const cv = body.linvel();
      it.body && it.body.setLinvel({ x: cv.x + (Math.random() - 0.5), y: cv.y + 1, z: cv.z + (Math.random() - 0.5) }, true);
    }
  }

  // Liquid level visuals etc.
  refreshVisual(it) {
    if (!it.def) return;
    if (it.def.liquid) {
      // the cap in place or off
      const cap = it.mesh.getObjectByName('cap');
      if (cap && it.def.capped) cap.visible = !it.state.capOff;
      const fill = it.mesh.getObjectByName('fill');
      if (fill) {
        const f = Math.max(0.001, (it.state.liquid || 0) / it.def.liquid.cap);
        fill.scale.y = f;
        fill.visible = f > 0.01;
      }
    }
    if (it.def.light === 'torch') {
      // a flashlight throws a beam from its lens (along userData.beam)
      const glow = it.mesh.getObjectByName('glow');
      if (glow) glow.material.emissiveIntensity = it.state.on ? 2.5 : 0;
      if (it.state.on && !it.light) {
        const lens = it.mesh.userData.lens || V(0, 0, 0);
        const beam = it.mesh.userData.beam || V(1, 0, 0);
        it.light = new THREE.SpotLight(0xfff0d6, 22, 26, 0.36, 0.55, 1.6);
        it.light.position.copy(lens);
        it.light.target.position.copy(lens).addScaledVector(beam, 4);
        it.mesh.add(it.light, it.light.target);
        this.game.lights.add(it.light);
      } else if (!it.state.on && it.light) {
        it.mesh.remove(it.light, it.light.target);
        this.game.lights.remove(it.light);
        it.light = null;
      }
    } else if (it.def.light) {
      const glow = it.mesh.getObjectByName('glow');
      if (glow) glow.material.emissiveIntensity = it.state.on ? 3 : 0;
      if (it.state.on && !it.light) {
        it.light = new THREE.PointLight(0xffc477, 6, 9, 1.6);
        it.light.position.set(0, 0.03, 0);
        it.mesh.add(it.light);
        this.game.lights.add(it.light);
      } else if (!it.state.on && it.light) {
        it.mesh.remove(it.light);
        this.game.lights.remove(it.light);
        it.light = null;
      }
    }
  }

  rebase(dx, dz) {
    // bodies were shifted with all others; meshes of resting items follow their (sleeping) bodies
    for (const it of this.items) {
      if (it.held || it.stowed || it.mounted || it.worn) continue;
      it.mesh.position.x -= dx;
      it.mesh.position.z -= dz;
    }
  }

  // Serialize every item (for save games).
  serialize() {
    const o = this.game.origin;
    const out = [];
    for (const it of this.items) {
      // (held and worn things are saved with the player)
      if (it.held || it.worn) continue;
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      it.mesh.getWorldPosition(p);
      it.mesh.getWorldQuaternion(q);
      out.push({ id: it.id, part: it.part, state: it.state, pos: [p.x + o.x, p.y, p.z + o.z], quat: q.toArray(), stowed: it.stowed ? it.stowed.car.id || true : false, mounted: it.mounted ? { car: it.mounted.car.id || true, part: it.mounted.part, m: it.mounted.local.toArray(), hang: it.mounted.hang ? it.mounted.hang.at.toArray() : null } : null, poi: it.poiKey, spot: it.spot });
    }
    return out;
  }
}

function cloneUserData(v) {
  if (v && v.isVector3) return v.clone();
  if (Array.isArray(v)) return v.map(cloneUserData);
  if (v && typeof v === 'object' && v.constructor === Object) {
    const o = {};
    for (const k in v) o[k] = cloneUserData(v[k]);
    return o;
  }
  return v;
}
