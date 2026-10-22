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
    src.inner.traverse((o) => {
      if (!o.isMesh || o.userData.tuneMesh) return;
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
        const m = wheel ? rootInv.clone().multiply(wheel.spin.matrixWorld) : new THREE.Matrix4();
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
    if (!state.carType) state.carType = this.game.car ? this.game.car.type.id : 'w203';
    const mesh = this.buildPartMesh(partId, state.carType, state.tune);
    const it = new Item(this, { id: 'part:' + partId, part: partId, state, mesh });
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
    const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setMass(Math.max(0.05, it.mass)).setFriction(0.75).setRestitution(0.12).setCollisionGroups(GROUPS.item);
    if (it.part) cd.setFriction(0.9);
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
    const cd = RAPIER.ColliderDesc.cuboid(Math.max(0.012, s.x / 2), Math.max(0.012, s.y / 2), Math.max(0.012, s.z / 2))
      .setTranslation(p.x, p.y, p.z)
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

  // ------------------------------------------------------------------ holding
  take(it) {
    if (it.stowed) this.unstow(it, false);
    this.removeBody(it);
    it.held = true;
    if (it.poiKey !== null && it.spot !== null) {
      const st = this.game.pois.state.get(it.poiKey);
      if (st) st.taken.add(it.spot);
      this.game.stats.itemsLooted++;
      it.poiKey = null;
    }
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
    const spots = inst.loot.filter((l) => l.kind !== 'wreck');
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
      if (it.held || it.stowed) continue;
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
    for (const it of this.items) {
      if (it.held || it.stowed || !it.body) continue;
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
        s.collider.setTranslationWrtParent({ x: s.p.x, y: s.p.y, z: s.p.z });
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
      const fill = it.mesh.getObjectByName('fill');
      if (fill) {
        const f = Math.max(0.001, (it.state.liquid || 0) / it.def.liquid.cap);
        fill.scale.y = f;
        fill.visible = f > 0.01;
      }
    }
    if (it.def.light) {
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
      if (it.held || it.stowed) continue;
      it.mesh.position.x -= dx;
      it.mesh.position.z -= dz;
    }
  }

  // Serialize every item (for save games).
  serialize() {
    const o = this.game.origin;
    const out = [];
    for (const it of this.items) {
      if (it.held) continue;
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      it.mesh.getWorldPosition(p);
      it.mesh.getWorldQuaternion(q);
      out.push({ id: it.id, part: it.part, state: it.state, pos: [p.x + o.x, p.y, p.z + o.z], quat: q.toArray(), stowed: it.stowed ? it.stowed.car.id || true : false, poi: it.poiKey, spot: it.spot });
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
