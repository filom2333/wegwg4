// Points of interest: layouts (which structures go where) and the streaming manager that
// builds them near the player with static colliders, doors, lights, pumps and loot spots.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { mulberry32 } from '../core/noise.js';
import { Builder } from './buildings/builder.js';
import { archMaterials, resolveMaterial } from './buildings/materials.js';
import { LAYOUTS } from './poiLayouts.js';
import { POI_SPACING } from './worldGen.js';
import { applyWeathering, weatheringUniforms } from '../vehicle/weathering.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

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
    this.wreckProtos = [];
    this.inflight = new Set();
    this.ready = new Map();
    // a fixed pool of lights for powered fixtures and beacons: adding and removing lights with
    // every POI would change the light count and recompile every shader in the scene
    this.lightPool = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffd9a0, 0, 14, 1.6);
      this.group.add(l);
      this.lightPool.push(game.lights.add(l));
    }
    this.startWorker();
  }

  // One roadside wreck per car type; boxes for their colliders.
  setWreckPrototypes(groups) {
    this.wreckProtos = groups.map((g) => {
      const b = new THREE.Box3().setFromObject(g);
      return { group: g, half: b.getSize(V(0, 0, 0)).multiplyScalar(0.5), cy: (b.min.y + b.max.y) / 2 };
    });
  }

  update(gx, gz) {
    const gen = this.game.gen;
    const k0 = Math.round(gz / POI_SPACING);
    for (let k = k0 - 2; k <= k0 + 2; k++) {
      const p = gen.poiSlot(k);
      if (!p) continue;
      const d = Math.hypot(p.x - gx, p.z - gz);
      if (d < this.loadRadius && !this.loaded.has(k) && !this.queue.includes(k) && !this.inflight.has(k) && !this.ready.has(k)) this.queue.push(k);
    }
    for (const [k, inst] of this.loaded) {
      if (Math.hypot(inst.poi.x - gx, inst.poi.z - gz) > this.unloadRadius) this.unload(k);
    }
    if (this.queue.length) {
      this.queue.sort((a, b) => {
        const pa = gen.poiSlot(a),
          pb = gen.poiSlot(b);
        return Math.hypot(pa.x - gx, pa.z - gz) - Math.hypot(pb.x - gx, pb.z - gz);
      });
      if (this.worker) {
        // geometry is generated in the worker; at most two requests in flight
        while (this.queue.length && this.inflight.size < 2) {
          const k = this.queue.shift();
          if (this.loaded.has(k)) continue;
          this.inflight.add(k);
          this.worker.postMessage({ type: 'poi', k, poi: gen.poiSlot(k) });
        }
      } else {
        const k = this.queue.shift();
        if (!this.loaded.has(k)) this.load(k);
      }
    }
    // finish one waiting place, or else assemble at most one finished POI per frame
    for (const inst of this.loaded.values())
      if (inst.pending) {
        inst.pending.shift()();
        if (!inst.pending.length) inst.pending = null;
        return;
      }
    for (const [k, msg] of this.ready) {
      this.ready.delete(k);
      const p = gen.poiSlot(k);
      if (this.loaded.has(k) || !p || Math.hypot(p.x - gx, p.z - gz) > this.unloadRadius) continue;
      if (msg.error) {
        console.warn('POI worker failed, building on the main thread', msg.error);
        this.load(k);
      } else this.assemble(k, msg.entries.map((en) => ({ ...en, builder: Builder.fromData(en.data) })), msg.calls, true);
      break;
    }
  }

  startWorker() {
    try {
      this.worker = new Worker(new URL('./poiWorker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type !== 'poi') return;
        this.inflight.delete(m.k);
        this.ready.set(m.k, m);
      };
      this.worker.onerror = () => {
        this.worker = null;
        for (const k of this.inflight) this.queue.push(k);
        this.inflight.clear();
      };
    } catch (err) {
      this.worker = null;
    }
  }

  ensureLoaded(k) {
    if (!this.loaded.has(k)) this.load(k);
    return this.loaded.get(k);
  }

  // Synchronous build on the main thread (the spawn point must exist at once).
  load(k) {
    const poi = this.game.gen.poiSlot(k);
    if (!poi) return;
    const rnd = mulberry32(poi.seed);
    let calls = 0;
    const counted = () => {
      calls++;
      return rnd();
    };
    const layout = (LAYOUTS[poi.type] || LAYOUTS.house)(counted, poi);
    this.assemble(k, layout, calls, false);
  }

  // Scene objects, colliders, doors, lights and loot from built layout entries. `calls` is how
  // many random numbers the layout used, so the sequence continues identically either way.
  assemble(k, layout, calls, tokens) {
    const gen = this.game.gen;
    const poi = gen.poiSlot(k);
    const rnd = mulberry32(poi.seed);
    for (let i = 0; i < calls; i++) rnd();
    const resolve = tokens ? resolveMaterial : (m) => m;
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
      const g = b.build(resolve);
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
      b.doors.forEach((d, i) => this.makeDoor(inst, { ...d, mat: resolve(d.mat) }, em, e, i));
      // pumps
      for (const p of b.pumps || []) inst.pumps.push({ local: V(...p.pos).applyMatrix4(em), inst });
      if (b.fuelReserve !== undefined && st.fuel === null) st.fuel = b.fuelReserve;
      // loot spots
      for (const l of b.loot) inst.loot.push({ pos: V(...l.pos).applyMatrix4(em), kind: l.kind });
      // light fixtures: positions only; a shared pool of lights visits the nearest ones
      for (const l of b.lights) {
        if (!(l.powered || l.beacon)) continue;
        if (inst.lights.length >= 3) break;
        inst.lights.push({ local: V(...l.pos).applyMatrix4(em), def: l });
      }
      for (const a of b.animated || []) inst.animated.push(a);
      if (e.tag === 'garage' && b.carSpot) inst.carSpot = V(b.carSpot.x, 0, b.carSpot.z).applyMatrix4(em);
    }
    // wrecks
    const nW = WRECKS[poi.type] ?? 0;
    for (let i = 0; i < nW && this.wreckProtos.length; i++) this.addWreck(inst, rnd, i, poi.type);
    this.group.add(root);
    this.loaded.set(k, inst);
    // what lives in the place (loot, animals, a parked car, a trailer) follows in the next frames,
    // one kind a frame, so a place streaming in never costs one long frame; the start is built
    // at once
    const g = this.game;
    const hooks = [
      () => g.items && g.items.onPoiLoaded && g.items.onPoiLoaded(inst, rnd),
      () => g.npcs && g.npcs.onPoiLoaded && g.npcs.onPoiLoaded(inst, rnd),
      () => g.fleet && g.fleet.onPoiLoaded(inst),
      () => g.trailers && g.trailers.onPoiLoaded(inst),
    ];
    if (tokens) inst.pending = hooks;
    else for (const h of hooks) h();
  }

  addWreck(inst, rnd, i, type) {
    const proto = this.wreckProtos[Math.floor(rnd() * this.wreckProtos.length)];
    const w = proto.group.clone();
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
    // rest on the ground where it actually is (the pad fades out away from the centre)
    const wp = V(x, 0, z).applyMatrix4(inst.root.matrixWorld);
    const o = this.game.origin;
    const gy = this.game.gen.height(wp.x + o.x, wp.z + o.z) - inst.poi.y;
    const H = proto.half;
    // on its side the car rests on its half width
    w.position.set(x, gy + (tilt > 1 ? H.x : -0.04), z);
    w.rotation.set(0, rot, tilt);
    // random paint per wreck
    const paints = [0x6d7a7f, 0x7a2e24, 0x2f4a5c, 0xb9b2a0, 0x4b5a3a, 0x8b6d3c];
    // (clone() deep-copies userData through JSON, so the shared material comes from the prototype)
    const base = proto.group.wreckPaint;
    const hex = paints[Math.floor(rnd() * paints.length)];
    if (base) {
      const pm = base.userData.make ? base.userData.make(hex) : base.clone();
      pm.color.setHex(hex);
      w.traverse((o) => {
        if (o.isMesh && o.material === base) o.material = pm;
      });
    }
    inst.root.add(w);
    // collider (box)
    const c = V(x, gy + (tilt > 1 ? H.x : proto.cy + 0.05), z);
    const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, tilt, 'YXZ'));
    const desc = RAPIER.ColliderDesc.cuboid(H.x * 0.92, H.y * 0.8, H.z * 0.95).setTranslation(c.x, c.y, c.z).setRotation({ x: qq.x, y: qq.y, z: qq.z, w: qq.w }).setCollisionGroups(GROUPS.world);
    const col = this.game.physics.world.createCollider(desc, inst.body);
    this.game.physics.setOwner(col, { kind: 'wreck', surface: 'metal', poi: inst });
    inst.loot.push({ pos: V(x, gy + 0.6, z), kind: 'wreck', wreck: true });
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
    this.game.fleet && this.game.fleet.onPoiUnloaded(inst);
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
    this.updateLightPool(night, t);
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
    }
  }

  // The pool's lights go to the fixtures nearest the camera that are lit right now.
  updateLightPool(night, t) {
    const cam = this.game.renderer && this.game.renderer.camera;
    const cands = [];
    if (night > 0.3 && cam)
      for (const inst of this.loaded.values())
        for (const l of inst.lights) {
          const lit = l.def.beacon ? Math.sin(t * 3) > 0.6 : inst.powered && night > 0.4;
          if (!lit) continue;
          const w = l.local.clone().applyMatrix4(inst.root.matrixWorld);
          const d = w.distanceTo(cam.position);
          if (d < 160) cands.push({ w, d, l });
        }
    cands.sort((a, b) => a.d - b.d);
    this.lightPool.forEach((pl, i) => {
      const c = cands[i];
      if (!c) {
        pl.intensity = 0;
        return;
      }
      pl.position.copy(c.w);
      pl.userData.beacon = !!c.l.def.beacon;
      pl.color.set(c.l.def.color);
      pl.distance = c.l.def.distance;
      pl.intensity = c.l.def.beacon ? 25 : 14 * (0.92 + 0.08 * Math.sin(t * 40 + c.w.x));
    });
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

  // The nearest bed (its loot spot on the mattress) to a point, within maxDist.
  nearestBed(pos, maxDist = 1.2) {
    let best = null,
      bd = maxDist;
    for (const inst of this.loaded.values()) {
      if (inst.root.position.distanceToSquared(pos) > 3600) continue;
      for (const l of inst.loot) {
        if (l.kind !== 'bed') continue;
        const w = l.pos.clone().applyMatrix4(inst.root.matrixWorld);
        const d = w.distanceTo(pos);
        if (d < bd) {
          bd = d;
          best = { world: w, inst };
        }
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
