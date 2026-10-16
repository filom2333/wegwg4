// Points of interest: layouts (which structures go where) and the streaming manager that
// builds them near the player with static colliders, doors, lights, pumps and loot spots.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { mulberry32 } from '../core/noise.js';
import { Builder } from './buildings/builder.js';
import { archMaterials, signMaterial } from './buildings/materials.js';
import { buildHouse } from './buildings/house.js';
import * as ST from './buildings/structures.js';
import * as FUR from './buildings/furniture.js';
import { POI_SPACING } from './worldGen.js';
import { applyWeathering, weatheringUniforms } from '../vehicle/carMaterials.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ layouts
function props(fn) {
  const b = new Builder('props');
  fn(b);
  return { builder: b };
}

export const LAYOUTS = {
  homestead(rnd) {
    const house = buildHouse(rnd, { style: 'siding', abandoned: 0.1 });
    const garage = ST.buildGarage(rnd, { w: 6.5, d: 7.5, open: true });
    const out = [
      { ...house, x: -6.5, z: -2, rot: 0 },
      { ...garage, x: 8.5, z: -1.5, rot: 0, tag: 'garage' },
      {
        ...props((b) => {
          ST.mailbox(b, -3, 12, 0);
          ST.fence(b, [
            [-14, 9],
            [-4, 9],
          ]);
          ST.fence(b, [
            [-14, 9],
            [-14, -9],
          ]);
          FUR.place(b, FUR.barrel(rnd), 12.8, 0, 3.5, 0);
          FUR.place(b, FUR.crate(rnd), 12.8, 0, 4.6, 0.2);
        }),
        x: 0,
        z: 0,
        rot: 0,
      },
    ];
    return out;
  },
  house(rnd) {
    const h = buildHouse(rnd, {});
    const list = [{ ...h, x: 0, z: 0, rot: 0 }];
    if (rnd() < 0.5) list.push({ ...ST.buildGarage(rnd, { w: 5, d: 6, open: rnd() < 0.7 }), x: h.plan.W / 2 + 5, z: -1, rot: 0 });
    list.push({ ...props((b) => ST.mailbox(b, 2, h.plan.D / 2 + 6, 0)), x: 0, z: 0, rot: 0 });
    return list;
  },
  houses(rnd) {
    const n = 2 + (rnd() < 0.5 ? 1 : 0);
    const list = [];
    let x = -((n - 1) * 15) / 2;
    for (let i = 0; i < n; i++) {
      const h = buildHouse(rnd, {});
      list.push({ ...h, x: x + (rnd() - 0.5) * 2, z: (rnd() - 0.5) * 4, rot: (rnd() - 0.5) * 0.1 });
      x += 15;
    }
    return list;
  },
  gasStation(rnd) {
    return [{ ...ST.buildGasStation(rnd), x: 0, z: 0, rot: 0 }];
  },
  motel(rnd) {
    return [{ ...ST.buildMotel(rnd), x: 3, z: -2, rot: 0 }];
  },
  diner(rnd) {
    return [{ ...ST.buildDiner(rnd), x: 0, z: -2, rot: 0 }];
  },
  ranch(rnd) {
    const h = buildHouse(rnd, { style: rnd() < 0.5 ? 'siding' : 'brick' });
    return [
      { ...h, x: -9, z: 2, rot: 0 },
      { ...ST.buildBarn(rnd), x: 10, z: -4, rot: Math.PI / 2 },
      { ...ST.buildWindmill(rnd), x: 2, z: -14, rot: rnd() * 6 },
      {
        ...props((b) =>
          ST.fence(b, [
            [16, 10],
            [26, 10],
            [26, -16],
            [16, -16],
          ])
        ),
        x: 0,
        z: 0,
        rot: 0,
      },
    ];
  },
  waterTower(rnd) {
    return [{ ...ST.buildWaterTower(rnd), x: 0, z: 0, rot: rnd() * 6 }];
  },
  radioTower(rnd) {
    return [{ ...ST.buildRadioTower(rnd), x: 0, z: 0, rot: rnd() * 6 }];
  },
  trailers(rnd) {
    const n = 2 + Math.floor(rnd() * 2);
    const list = [];
    for (let i = 0; i < n; i++) list.push({ ...ST.buildTrailer(rnd), x: (i - (n - 1) / 2) * 9, z: (rnd() - 0.5) * 6, rot: Math.PI / 2 + (rnd() - 0.5) * 0.3 });
    list.push({ ...props((b) => ST.tent(b, rnd, 0, 12, 0.4, archMaterials().canvasOrange, 2.4, 2, 1.4)), x: 0, z: 0, rot: 0 });
    return list;
  },
  outpost(rnd) {
    return [{ ...ST.buildOutpost(rnd), x: 0, z: 0, rot: 0 }];
  },
  ruins(rnd) {
    const list = [{ ...ST.buildRuins(rnd), x: 0, z: 0, rot: rnd() * 6 }];
    if (rnd() < 0.5) list.push({ ...ST.buildRuins(rnd), x: 10, z: -6, rot: rnd() * 6 });
    return list;
  },
  camp(rnd) {
    return [{ ...ST.buildCamp(rnd), x: 0, z: 0, rot: 0 }];
  },
  junkyard(rnd) {
    const shack = ST.buildGarage(rnd, { w: 5, d: 5, open: true });
    return [
      { ...shack, x: -9, z: -8, rot: 0 },
      {
        ...props((b) => {
          const M = archMaterials();
          // corrugated perimeter with a gap for the gate
          const wall = (x0, z0, x1, z1) => {
            const L = Math.hypot(x1 - x0, z1 - z0);
            const rot = Math.atan2(-(z1 - z0), x1 - x0);
            b.box((x0 + x1) / 2, 1.1, (z0 + z1) / 2, L, 2.2, 0.06, M.corrugatedRust, { rotY: rot, surface: 'metal' });
          };
          wall(-14, 13, -3, 13);
          wall(3, 13, 14, 13);
          wall(-14, 13, -14, -13);
          wall(14, 13, 14, -13);
          wall(-14, -13, 14, -13);
          for (let i = 0; i < 6; i++) FUR.place(b, FUR.tirePile(rnd), -6 + i * 2.5, 0, -10.5 + (i % 2), 0);
          for (let i = 0; i < 4; i++) FUR.place(b, FUR.barrel(rnd), 10 + (i % 2) * 0.7, 0, -9 + Math.floor(i / 2) * 0.7, 0);
          ST.signBoard(b, 0, 3.0, 13.2, 4, 0.8, signMaterial(['SALVAGE · PARTS'], { w: 512, h: 96, bg: '#d8c9a2', fg: '#3a2a1a' }), 0, { posts: 2 });
        }),
        x: 0,
        z: 0,
        rot: 0,
      },
    ];
  },
  wreck() {
    return [];
  },
};

// wrecks per type (car bodies placed by the manager)
const WRECKS = { junkyard: 7, wreck: 1, homestead: 0, trailers: 1, ranch: 1, houses: 1, house: 0, gasStation: 1, motel: 1, diner: 2, outpost: 1, ruins: 0, camp: 1 };

// ------------------------------------------------------------------ manager
export class POIManager {
  constructor(game) {
    this.game = game;
    this.loaded = new Map(); // k -> instance
    this.queue = [];
    this.state = new Map(); // persistent per-POI state (loot taken, door states, fuel reserve)
    this.group = new THREE.Group();
    this.group.name = 'pois';
    game.worldGroup.add(this.group);
    this.loadRadius = 700;
    this.unloadRadius = 950;
    this.wreckProto = null;
  }

  setWreckPrototype(group) {
    this.wreckProto = group;
  }

  update(gx, gz) {
    const gen = this.game.gen;
    const k0 = Math.round(gz / POI_SPACING);
    for (let k = k0 - 2; k <= k0 + 2; k++) {
      const p = gen.poiSlot(k);
      if (!p) continue;
      const d = Math.hypot(p.x - gx, p.z - gz);
      if (d < this.loadRadius && !this.loaded.has(k) && !this.queue.includes(k)) this.queue.push(k);
    }
    for (const [k, inst] of this.loaded) {
      if (Math.hypot(inst.poi.x - gx, inst.poi.z - gz) > this.unloadRadius) this.unload(k);
    }
    // build at most one POI per frame, nearest first
    if (this.queue.length) {
      this.queue.sort((a, b) => {
        const pa = gen.poiSlot(a),
          pb = gen.poiSlot(b);
        return Math.hypot(pa.x - gx, pa.z - gz) - Math.hypot(pb.x - gx, pb.z - gz);
      });
      const k = this.queue.shift();
      if (!this.loaded.has(k)) this.load(k);
    }
  }

  ensureLoaded(k) {
    if (!this.loaded.has(k)) this.load(k);
    return this.loaded.get(k);
  }

  load(k) {
    const gen = this.game.gen;
    const poi = gen.poiSlot(k);
    if (!poi) return;
    const rnd = mulberry32(poi.seed);
    const layout = (LAYOUTS[poi.type] || LAYOUTS.house)(rnd, poi);
    const o = this.game.origin;
    const root = new THREE.Group();
    root.name = 'poi_' + poi.type + '_' + k;
    root.position.set(poi.x - o.x, poi.y, poi.z - o.z);
    root.rotation.y = poi.rot;
    root.updateMatrixWorld(true);
    const ph = this.game.physics;
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), poi.rot);
    const body = ph.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(root.position.x, root.position.y, root.position.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    const st = this.state.get(k) || { taken: new Set(), doors: {}, fuel: null, visited: false };
    this.state.set(k, st);
    const inst = { k, poi, root, body, doors: [], pumps: [], lights: [], lamps: [], animated: [], loot: [], beacons: [], state: st, powered: rnd() < 0.5 };
    const tmpQ = new THREE.Quaternion();
    for (const e of layout) {
      const b = e.builder;
      const g = b.build();
      g.position.set(e.x, 0, e.z);
      g.rotation.y = e.rot || 0;
      root.add(g);
      const em = new THREE.Matrix4().compose(V(e.x, 0, e.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), e.rot || 0), V(1, 1, 1));
      // static colliders
      for (const c of b.colliders) {
        const p = V(...c.c).applyMatrix4(em);
        tmpQ.setFromEuler(new THREE.Euler(c.rotX || 0, (e.rot || 0) + (c.rotY || 0), 0, 'YXZ'));
        const desc = RAPIER.ColliderDesc.cuboid(Math.max(0.01, c.h[0]), Math.max(0.01, c.h[1]), Math.max(0.01, c.h[2]))
          .setTranslation(p.x, p.y, p.z)
          .setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w })
          .setCollisionGroups(GROUPS.world)
          .setFriction(0.8);
        const col = ph.world.createCollider(desc, body);
        ph.setOwner(col, { kind: 'structure', surface: c.surface === 'roof' ? 'wood' : c.surface, poi: inst });
      }
      // doors
      b.doors.forEach((d, i) => this.makeDoor(inst, d, em, e, i));
      // pumps
      for (const p of b.pumps || []) inst.pumps.push({ local: V(...p.pos).applyMatrix4(em), inst });
      if (b.fuelReserve !== undefined && st.fuel === null) st.fuel = b.fuelReserve;
      // loot spots
      for (const l of b.loot) inst.loot.push({ pos: V(...l.pos).applyMatrix4(em), kind: l.kind });
      // lights: only powered fixtures / beacons become real lights (budgeted)
      for (const l of b.lights) {
        if (!(l.powered || l.beacon)) continue;
        if (inst.lights.length >= 3) break;
        const light = new THREE.PointLight(l.color, 0, l.distance, 1.6);
        light.position.copy(V(...l.pos).applyMatrix4(em));
        root.add(light);
        inst.lights.push({ light, def: l });
      }
      for (const a of b.animated || []) inst.animated.push(a);
      if (e.tag === 'garage' && b.carSpot) inst.carSpot = V(b.carSpot.x, 0, b.carSpot.z).applyMatrix4(em);
    }
    // wrecks
    const nW = WRECKS[poi.type] ?? 0;
    for (let i = 0; i < nW && this.wreckProto; i++) this.addWreck(inst, rnd, i, poi.type);
    this.group.add(root);
    this.loaded.set(k, inst);
    this.game.items && this.game.items.onPoiLoaded && this.game.items.onPoiLoaded(inst, rnd);
    this.game.npcs && this.game.npcs.onPoiLoaded && this.game.npcs.onPoiLoaded(inst, rnd);
  }

  addWreck(inst, rnd, i, type) {
    const w = this.wreckProto.clone();
    let x, z, rot;
    if (type === 'junkyard') {
      x = -8 + (i % 4) * 5.2;
      z = -2 + Math.floor(i / 4) * 6 + (rnd() - 0.5);
      rot = (rnd() - 0.5) * 0.6 + Math.PI / 2;
    } else if (type === 'wreck') {
      x = 0;
      z = 0;
      rot = rnd() * 6;
    } else {
      x = (rnd() - 0.5) * 18;
      z = 10 + rnd() * 4;
      rot = rnd() * 6;
    }
    const tilt = type === 'wreck' && rnd() < 0.5 ? Math.PI / 2 : (rnd() - 0.5) * 0.08;
    w.position.set(x, tilt > 1 ? 0.88 : -0.04, z);
    w.rotation.set(0, rot, tilt);
    // random paint per wreck
    const paints = [0x6d7a7f, 0x7a2e24, 0x2f4a5c, 0xb9b2a0, 0x4b5a3a, 0x8b6d3c];
    // (clone() deep-copies userData through JSON, so the shared material comes from the prototype)
    const base = this.wreckProto.userData.paint;
    const hex = paints[Math.floor(rnd() * paints.length)];
    const pm = base.userData.make ? base.userData.make(hex) : base.clone();
    pm.color.setHex(hex);
    w.traverse((o) => {
      if (o.isMesh && o.material === base) o.material = pm;
    });
    inst.root.add(w);
    // collider (box)
    const c = V(x, tilt > 1 ? 0.88 : 0.7, z);
    const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, tilt, 'YXZ'));
    const desc = RAPIER.ColliderDesc.cuboid(0.78, 0.55, 2.0).setTranslation(c.x, c.y, c.z).setRotation({ x: qq.x, y: qq.y, z: qq.z, w: qq.w }).setCollisionGroups(GROUPS.world);
    const col = this.game.physics.world.createCollider(desc, inst.body);
    this.game.physics.setOwner(col, { kind: 'wreck', surface: 'metal', poi: inst });
    inst.loot.push({ pos: V(x, 0.6, z).applyMatrix4(new THREE.Matrix4()), kind: 'wreck', wreck: true });
  }

  makeDoor(inst, d, em, e, i) {
    const ph = this.game.physics;
    const pivot = new THREE.Group();
    const hingeLocal = d.hinge.clone().applyMatrix4(em);
    pivot.position.copy(hingeLocal);
    const baseRot = (e.rot || 0) + d.rot + (d.hingeSide > 0 ? 0 : Math.PI);
    pivot.rotation.y = baseRot;
    const geo = new THREE.BoxGeometry(d.w, d.h, d.t);
    // metre UVs
    const uv = geo.attributes.uv,
      p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) uv.setXY(k, p.getX(k) + d.w / 2, p.getY(k) + d.h / 2);
    geo.translate(d.w / 2, d.h / 2, 0);
    const leaf = new THREE.Mesh(geo, d.mat);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    pivot.add(leaf);
    // handle
    const M = archMaterials();
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), M.metal);
    knob.position.set(d.w - 0.08, 1.0, 0.04);
    pivot.add(knob);
    const knob2 = knob.clone();
    knob2.position.z = -0.04;
    pivot.add(knob2);
    inst.root.add(pivot);
    const key = e.x.toFixed(1) + ':' + e.z.toFixed(1) + ':' + i;
    const open = inst.state.doors[key] ?? d.open;
    const door = { pivot, baseRot, open, target: open, w: d.w, h: d.h, t: d.t, key, inst, body: null };
    // kinematic body for the leaf
    door.body = ph.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const col = ph.world.createCollider(RAPIER.ColliderDesc.cuboid(d.w / 2, d.h / 2, d.t / 2).setTranslation(d.w / 2, d.h / 2, 0).setCollisionGroups(GROUPS.world), door.body);
    ph.setOwner(col, { kind: 'door', door, surface: 'wood' });
    this.applyDoor(door, true);
    inst.doors.push(door);
  }

  applyDoor(door, teleport = false) {
    door.pivot.rotation.y = door.baseRot + door.open * 1.55;
    door.pivot.updateMatrixWorld(true);
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion();
    door.pivot.getWorldPosition(p);
    door.pivot.getWorldQuaternion(q);
    // the scene root may be offset from physics origin: worldGroup is at 0 so world == physics
    if (teleport) {
      door.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      door.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    } else {
      door.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      door.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }

  toggleDoor(door) {
    door.target = door.open > 0.5 ? 0 : 1;
    door.inst.state.doors[door.key] = door.target;
    this.game.audio && this.game.audio.play(door.target ? 'doorCreak' : 'doorShut', { at: door.pivot.getWorldPosition(new THREE.Vector3()) });
  }

  unload(k) {
    const inst = this.loaded.get(k);
    if (!inst) return;
    this.game.items && this.game.items.onPoiUnloaded && this.game.items.onPoiUnloaded(inst);
    this.game.npcs && this.game.npcs.onPoiUnloaded && this.game.npcs.onPoiUnloaded(inst);
    for (const d of inst.doors) this.game.physics.removeBody(d.body);
    this.game.physics.removeBody(inst.body);
    this.group.remove(inst.root);
    inst.root.traverse((o) => {
      if (o.isMesh && o.geometry && !o.userData.shared) o.geometry.dispose();
    });
    this.loaded.delete(k);
  }

  update2(dt) {
    const env = this.game.env;
    const night = env ? 1 - env.daylight : 0;
    const t = this.game.time;
    for (const inst of this.loaded.values()) {
      for (const d of inst.doors) {
        if (Math.abs(d.open - d.target) > 1e-3) {
          d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), dt * 1.8);
          this.applyDoor(d);
        }
      }
      for (const a of inst.animated) {
        if (a.kind === 'spin') a.obj.rotation.z += dt * a.speed * (0.4 + (env ? env.w.wind : 0.3));
      }
      for (const l of inst.lights) {
        if (l.def.beacon) l.light.intensity = night > 0.3 ? (Math.sin(t * 3) > 0.6 ? 25 : 0) : 0;
        else l.light.intensity = inst.powered && night > 0.4 ? 14 * (0.92 + 0.08 * Math.sin(t * 40 + l.light.position.x)) : 0;
      }
    }
  }

  // nearest pump (world position) to a point
  nearestPump(pos, maxDist = 3) {
    let best = null,
      bd = maxDist;
    for (const inst of this.loaded.values())
      for (const p of inst.pumps) {
        const w = p.local.clone().applyMatrix4(inst.root.matrixWorld);
        const d = w.distanceTo(pos);
        if (d < bd) {
          bd = d;
          best = { pump: p, world: w, inst };
        }
      }
    return best;
  }

  rebase(dx, dz) {
    for (const inst of this.loaded.values()) {
      inst.root.position.x -= dx;
      inst.root.position.z -= dz;
      inst.root.updateMatrixWorld(true);
      for (const d of inst.doors) this.applyDoor(d, true);
    }
  }
}

// Build a low-detail wreck prototype from a coarse body (no glass, rusty paint, some panels missing).
