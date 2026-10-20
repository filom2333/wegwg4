// Every car in the world: the one the player starts with and the ones found along the road.
// Cars the player has driven stay for good; untouched ones belong to the place they were found
// and come and go with it (their state is remembered). The fleet picks the "current" car (the
// one being driven, else the nearest) that most systems act on, simulates cars near the player
// and parks the rest.

import * as THREE from 'three';
import { Car } from './car.js';
import { CAR_TYPES, carType } from './types.js';
import { Container } from '../items/inventory.js';
import { hash01 } from '../core/noise.js';
import { RAPIER } from '../physics/physics.js';
import { ACCESSORIES, fitAccessory, serializeAccessories } from './accessories.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// cars further than this sleep (their bodies off): terrain colliders only exist near the player
const SIM_RADIUS = 85;
const SHOW_RADIUS = 650;

export class Fleet {
  constructor(game) {
    this.game = game;
    this.cars = [];
    this.assets = {};
    this.records = new Map(); // poi key -> state of an untouched car found there
    this.nextId = 1;
  }

  // Loads every type's asset once (and warms its materials), so cars found later appear without
  // a hitch.
  async preload(renderer) {
    for (const t of Object.values(CAR_TYPES)) this.assets[t.id] = await t.load(renderer);
  }

  build(typeId, { color } = {}) {
    const type = carType(typeId);
    const asset = this.assets[type.id];
    const mats = type.materials(asset, { color: color ?? type.defaultColor });
    // paint stays paint on whatever car the part ends up on
    for (const m of mats.paintables || []) m.userData.paint = true;
    const model = type.build(asset, mats);
    return { type, mats, model };
  }

  // A parked-nowhere model of a type, for meshes of parts whose car is gone.
  template(typeId) {
    this.templates = this.templates || {};
    if (!this.templates[typeId]) {
      const { model } = this.build(typeId);
      model.root.updateMatrixWorld(true);
      this.templates[typeId] = { model, root: model.root };
    }
    return this.templates[typeId];
  }

  // A model of a type to take part meshes from (never altered, so its parts are all native).
  modelOf(typeId) {
    return this.template(typeId).model;
  }

  // A car at a local position. opts: color, poiKey, owned, state (saved car state).
  create(typeId, position, quaternion, opts = {}) {
    const g = this.game;
    const { type, mats, model } = this.build(typeId, { color: opts.state && opts.state.paintColor ? opts.state.paintColor : opts.color });
    const car = new Car(g, type, model, { position, quaternion, ...(opts.init || {}) });
    car.mats = mats;
    car.id = opts.id || this.nextId++;
    this.nextId = Math.max(this.nextId, car.id + 1);
    car.poiKey = opts.poiKey ?? null;
    car.owned = !!opts.owned;
    car.dyn.automatic = type.automaticOnly || (!type.manualOnly && g.settingsTransmission !== 'manual');
    const T = type.trunk;
    car.storage = {
      trunk: new Container('trunk', T.label, T.slots, { capacity: T.capacity, bulky: true }),
      glovebox: new Container('glovebox', 'Glovebox', 6, { capacity: 5 }),
    };
    if (opts.color !== undefined && type.repaintable) car.paintColor = opts.color;
    if (opts.state) applyCarState(car, opts.state, g);
    // asleep until the player comes near (see update)
    car.active = false;
    car.dyn.body.setEnabled(false);
    this.cars.push(car);
    return car;
  }

  remove(car) {
    const g = this.game;
    car.dispose();
    this.cars = this.cars.filter((c) => c !== car);
    if (g.car === car) g.car = this.cars[0] || null;
  }

  nearest(pos, maxD = Infinity, filter = null) {
    let best = null,
      bd = maxD;
    for (const c of this.cars) {
      if (filter && !filter(c)) continue;
      const d = c.root.position.distanceTo(pos);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  // The current car: the one the player sits in, else the closest within reach (sticky).
  updateCurrent() {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    if (p.seat && p.car) {
      this.setCurrent(p.car);
      return;
    }
    const cur = g.car;
    const dCur = cur ? cur.root.position.distanceTo(p.position) : Infinity;
    const near = this.nearest(p.position, 9);
    if (near && near !== cur && near.root.position.distanceTo(p.position) < dCur - 1.5) this.setCurrent(near);
  }

  setCurrent(car) {
    const g = this.game;
    if (g.car === car) return;
    g.car = car;
    g.carMats = car.mats;
    g.audio && g.audio.setCarType && g.audio.setCarType(car.type);
  }

  // Simulation for cars near the player, parking (hidden, bodies off) for the far ones.
  update(dt, controls) {
    const g = this.game;
    this.wake();
    for (const car of this.cars) if (car.active) car.update(dt, car === g.car ? controls : null);
  }

  // Bodies on for cars near the player (on solid ground), off for the rest.
  wake() {
    const g = this.game;
    const focus = g.focusPoint();
    for (const car of this.cars) {
      const d = car.root.position.distanceTo(focus);
      const active = d < SIM_RADIUS || car === g.car;
      if (active !== car.active) {
        car.active = active;
        // wake at rest
        car.dyn.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        car.dyn.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
        // the ground under a waking car must be solid before its body is
        if (active) {
          const o = g.origin;
          g.terrain.ensureCollidersAround(car.root.position.x + o.x, car.root.position.z + o.z, 8);
        }
        car.dyn.body.setEnabled(active);
      }
      car.root.visible = d < SHOW_RADIUS || car === g.car;
    }
  }

  syncVisual() {
    for (const car of this.cars) if (car.active !== false) car.syncVisual();
  }

  rebase(dx, dz) {
    for (const car of this.cars) {
      car.syncVisual();
      car.prevPos.set(car.prevPos.x - dx, car.prevPos.y, car.prevPos.z - dz);
    }
  }

  // ---------------------------------------------------------------- cars found in the world
  // Which car (if any) waits at a POI: the two types the player did not start with turn up in
  // the first places with a garage or a parking lot, then now and then another one.
  carForPoi(poi) {
    const g = this.game;
    const hosts = ['house', 'houses', 'gasStation', 'motel', 'diner', 'farm', 'ranch', 'cabin', 'sawmill', 'lodge', 'outpost'];
    if (!hosts.includes(poi.type) || poi.k < 1) return null;
    const others = Object.keys(CAR_TYPES).filter((t) => t !== g.startCarType);
    // the first host slots after the start get one each of the other types
    const order = this.hostOrder || (this.hostOrder = this.firstHosts(hosts, others.length));
    const i = order.indexOf(poi.k);
    if (i >= 0) return others[i];
    if (poi.k > Math.max(...order) && hash01(g.seed, poi.k, 911) < 0.22) return Object.keys(CAR_TYPES)[Math.floor(hash01(g.seed, poi.k, 912) * 3)];
    return null;
  }

  firstHosts(hosts, n) {
    const out = [];
    for (let k = 1; out.length < n && k < 40; k++) {
      const p = this.game.gen.poiSlot(k);
      if (p && hosts.includes(p.type) && (out.length === 0 || k - out[out.length - 1] >= 2)) out.push(k);
    }
    return out;
  }

  onPoiLoaded(inst) {
    const g = this.game;
    const k = inst.k;
    if (this.cars.some((c) => c.poiKey === k)) return;
    const rec = this.records.get(k);
    const typeId = rec ? rec.type : this.carForPoi(inst.poi);
    if (!typeId || (rec && rec.gone)) return;
    const spot = this.parkingSpot(inst, carType(typeId));
    if (!spot) return;
    const car = this.create(typeId, spot.pos, spot.quat, {
      poiKey: k,
      color: rec ? undefined : this.randomColor(typeId, k),
      state: rec ? rec.state : null,
      init: rec ? {} : abandonedState(g.seed, k),
    });
    if (!rec) {
      neglect(car, g.seed, k);
      outfit(car, g.seed, k);
    }
    car.syncVisual();
  }

  onPoiUnloaded(inst) {
    const k = inst.k;
    for (const car of [...this.cars]) {
      if (car.poiKey !== k || car.owned || car === this.game.car) continue;
      this.records.set(k, { type: car.type.id, state: serializeCar(car, this.game.origin) });
      this.remove(car);
    }
  }

  randomColor(typeId, k) {
    const t = carType(typeId);
    if (!t.repaintable || !t.colors.length) return undefined;
    return t.colors[Math.floor(hash01(this.game.seed, k, 913) * t.colors.length)];
  }

  // A clear spot for a car at a POI: the garage if there is one, else beside the buildings
  // facing along the road.
  parkingSpot(inst, type) {
    const g = this.game;
    inst.root.updateMatrixWorld(true);
    const m = inst.root.matrixWorld;
    const len = type.SPEC.frontTip - type.SPEC.rearTip;
    const cands = [];
    if (inst.carSpot) cands.push([inst.carSpot.x, inst.carSpot.z, Math.PI]);
    for (const [x, z, a] of [
      [-11, 9, Math.PI / 2],
      [11, 9, -Math.PI / 2],
      [-14, 2, 0.2],
      [14, 2, -0.2],
      [0, 13, Math.PI / 2],
      [-16, -8, 0],
      [16, -8, 0],
    ])
      cands.push([x, z, a]);
    const ph = g.physics;
    const shape = new RAPIER.Cuboid(type.SPEC.halfWidth + 0.15, 0.7, len / 2 + 0.2);
    for (const [x, z, a] of cands) {
      const wp = V(x, 0, z).applyMatrix4(m);
      const gy = g.gen.height(wp.x + g.origin.x, wp.z + g.origin.z);
      const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), inst.poi.rot + a);
      let blocked = false;
      ph.world.intersectionsWithShape({ x: wp.x, y: gy + 0.95, z: wp.z }, { x: q.x, y: q.y, z: q.z, w: q.w }, shape, () => {
        blocked = true;
        return false;
      });
      if (!blocked) return { pos: V(wp.x, gy + 0.05, wp.z), quat: q };
    }
    return null;
  }

  // ---------------------------------------------------------------- saving
  restore(d) {
    const o = this.game.origin;
    this.nextId = d.nextId || 1;
    for (const [k, rec] of d.records || []) this.records.set(+k, rec);
    for (const c of d.cars || []) {
      const s = c.state;
      const car = this.create(c.type, V(s.pos[0] - o.x, s.pos[1], s.pos[2] - o.z), new THREE.Quaternion(...s.quat), { id: c.id, poiKey: c.poiKey, owned: c.owned, state: s });
      if (c.id === d.current) this.setCurrent(car);
    }
    if (!this.game.car && this.cars.length) this.setCurrent(this.cars[0]);
  }

  serialize() {
    const o = this.game.origin;
    return {
      cars: this.cars.filter((c) => c.owned || c.poiKey === null || c === this.game.car).map((c) => ({ type: c.type.id, id: c.id, poiKey: c.poiKey, owned: c.owned, state: serializeCar(c, o) })),
      current: this.game.car ? this.game.car.id : null,
      records: [...this.records.entries()],
      nextId: this.nextId,
    };
  }
}

// A car left standing for years: some fuel, a tired battery, worn fluids.
function abandonedState(seed, k) {
  const r = (i) => hash01(seed, k, 920 + i);
  return { fuel: 2 + r(0) * 14, oil: 1.6 + r(1) * 1.8, battery: r(2) < 0.5 ? 0.02 + r(3) * 0.1 : 0.3 + r(3) * 0.4, engineCondition: 0.45 + r(4) * 0.4, fanbeltCondition: 0.2 + r(5) * 0.6 };
}

// ... and a few parts gone missing (scavenged, or never there).
function neglect(car, seed, k) {
  const r = (i) => hash01(seed, k, 940 + i);
  const pool = ['battery', 'wheel_RR', 'spare', 'seat_FR', 'headlight_R', 'fanbelt', 'airfilter'];
  const n = Math.floor(r(0) * 3);
  for (let i = 0; i < n; i++) {
    const id = pool[Math.floor(r(1 + i) * pool.length)];
    if (car.parts[id] && car.isInstalled(id) && car.canRemove(id).ok) car.setInstalled(id, false);
  }
  car.dirt = 0.7 + r(5) * 0.3;
  car.coolant = car.type.coolantCap ? car.type.coolantCap * (0.2 + r(6) * 0.6) : 0;
}

// ... and some came with gear bolted on, there for the taking.
function outfit(car, seed, k) {
  const r = (i) => hash01(seed, k, 960 + i);
  if (r(0) < 0.32) fitAccessory(car, r(1) < 0.35 ? 'roofBox' : 'roofRack');
  if (r(2) < 0.14) fitAccessory(car, 'bullBar');
  if (r(3) < 0.12) fitAccessory(car, 'rearRack');
}

// ------------------------------------------------------------------- car state
export function serializeCar(car, o) {
  const cp = car.root.position,
    cq = car.root.quaternion;
  const parts = {};
  for (const [id, st] of Object.entries(car.parts)) parts[id] = { installed: !!st.installed, condition: st.condition ?? 1, from: st.from || null };
  return {
    pos: [cp.x + o.x, cp.y, cp.z + o.z],
    quat: [cq.x, cq.y, cq.z, cq.w],
    model: car.type.id,
    fuel: car.fuel,
    oil: car.oil,
    coolant: car.coolant,
    battery: car.battery,
    engineCondition: car.engineCondition,
    fanbeltCondition: car.fanbeltCondition,
    odometer: car.odometer,
    trip: car.trip,
    dirt: car.dirt,
    lightsOn: car.lightsOn,
    paintColor: car.paintColor ?? null,
    partColors: car.partColors || null,
    stereo: car.stereo ? { disc: car.stereo.disc, track: car.stereo.track, mode: car.stereo.mode } : null,
    accessories: serializeAccessories(car),
    storage: car.storage ? Object.fromEntries(Object.entries(car.storage).map(([k, c]) => [k, c.serialize()])) : null,
    parts,
    open: Object.fromEntries(Object.values(car.model.parts).filter((m) => m.hinge).map((m) => [m.id, m.openT > 0.5 ? 1 : 0])),
  };
}

export function applyCarState(car, c, g) {
  for (const k of ['fuel', 'oil', 'coolant', 'battery', 'engineCondition', 'fanbeltCondition', 'odometer', 'trip', 'dirt', 'lightsOn']) if (c[k] !== undefined && c[k] !== null) car[k] = c[k];
  const same = (c.model || 'beetle') === car.type.id;
  if (c.paintColor && car.type.repaintable) {
    car.paintColor = c.paintColor;
    car.mats.color.setHex(c.paintColor);
  }
  for (const [id, st] of Object.entries(same ? c.parts || {} : {})) {
    if (!car.parts[id]) continue;
    if (!!car.parts[id].installed !== st.installed || (st.from || null) !== (car.parts[id].from || null)) car.setInstalled(id, st.installed, st.from || null);
    car.parts[id].condition = st.condition;
  }
  for (const [id, t] of Object.entries(same ? c.open || {} : {})) if (car.model.parts[id] && car.isInstalled(id)) car.model.setOpen(id, t);
  for (const [id, hex] of Object.entries(same ? c.partColors || {} : {})) car.paintPart(id, hex);
  car.rebuildColliders();
  if (c.stereo && car.stereo) Object.assign(car.stereo, c.stereo, { pos: 0 });
  for (const id of Object.values(c.accessories || {})) if (ACCESSORIES[id]) fitAccessory(car, id);
  if (c.storage && car.storage) for (const [k, list] of Object.entries(c.storage)) car.storage[k] && car.storage[k].restore(list);
  void g;
}
