// World items: physical props the player can pick up, carry, use, stow in the car and install
// (for car parts). Handles loot spawning per POI, persistence, and physics sync.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { ITEMS, LOOT, SPOT_CHANCE, initialState, itemMass } from './itemDefs.js';
import { MODEL_BUILDERS } from './itemModels.js';
import { PARTS } from '../vehicle/carParts.js';
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
    if (this.part) return PARTS[this.part].label;
    return this.def.name;
  }

  get mass() {
    if (this.part) return PARTS[this.part].mass;
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
  buildMesh(id, state = {}) {
    const d = ITEMS[id];
    const [fn, ...args] = d.model;
    const extra = d.variants ? [state.variant || 0] : [];
    const g = MODEL_BUILDERS[fn](...args, ...extra);
    if (!g.userData.size) {
      const b = new THREE.Box3().setFromObject(g);
      const c = b.getCenter(V(0, 0, 0));
      for (const ch of g.children) ch.position.sub(c);
      if (g.userData.muzzle) g.userData.muzzle.sub(c);
      g.userData.size = b.getSize(V(0, 0, 0));
    }
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return g;
  }

  // Mesh for a removed car part: shares the car's geometry.
  buildPartMesh(partId) {
    const car = this.game.car;
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
      if (!o.isMesh) return;
      const m = new THREE.Mesh(o.geometry, o.material);
      const local = rootInv.clone().multiply(o.matrixWorld);
      m.applyMatrix4(inv.clone().multiply(local));
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.shared = true;
      g.add(m);
    });
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
    const mesh = this.buildPartMesh(partId);
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
    it.stowed = { car, collider: col };
    car.attached.push(it);
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

  // ------------------------------------------------------------------ loot
  onPoiLoaded(inst, rnd) {
    const key = inst.k;
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
    inst.loot.forEach((spot, i) => {
      if (inst.state.taken.has(i)) return;
      const chance = (SPOT_CHANCE[spot.kind] ?? 0.3) * lootMul;
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
  update() {
    const ph = this.game.physics;
    for (const it of this.items) {
      if (it.held || it.stowed || !it.body) continue;
      if (it.body.isSleeping()) continue;
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
      } else if (!it.state.on && it.light) {
        it.mesh.remove(it.light);
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
      out.push({ id: it.id, part: it.part, state: it.state, pos: [p.x + o.x, p.y, p.z + o.z], quat: q.toArray(), stowed: !!it.stowed, poi: it.poiKey, spot: it.spot });
    }
    return out;
  }
}
