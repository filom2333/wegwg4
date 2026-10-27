// Points of interest: layouts (which structures go where) and the streaming manager that
// builds them near the player with static colliders, doors, lights, pumps and loot spots.

import * as THREE from 'three';
import { placeProp } from './props.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { mulberry32 } from '../core/noise.js';
import { Builder } from './buildings/builder.js';
import { archMaterials, resolveMaterial } from './buildings/materials.js';
import { LAYOUTS } from './poiLayouts.js';
import { POI_SPACING } from './worldGen.js';
import { applyWeathering, weatheringUniforms } from '../vehicle/weathering.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// abandoned cars (real cars of the game's types, put there by the fleet: see Fleet.placeHulk):
// how many a place may hold and the chance of each being there. A scrapyard keeps one or two, a
// roadside wreck is always its car, elsewhere one now and then.
const WRECKS = { junkyard: [2, 0.6], wreck: [1, 1], homestead: [0, 0], trailers: [1, 0.15], ranch: [1, 0.15], houses: [1, 0.1], house: [0, 0], gasStation: [1, 0.12], motel: [1, 0.15], diner: [1, 0.15], outpost: [1, 0.15], ruins: [0, 0], camp: [1, 0.1] };

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
    const inst = { k, poi, root, body, doors: [], pumps: [], lights: [], lamps: [], animated: [], loot: [], beacons: [], propList: [], state: st, powered: rnd() < 0.5 };
    const tmpQ = new THREE.Quaternion();
    // a place is hundreds of boxes for physics; added all in one frame, the next physics step spent
    // a long time sorting them in. Streamed in, they go in by the hundred, before anything is set
    // down in the place.
    const colJobs = [];
    const flushColliders = (max = Infinity) => {
      for (let n = 0; colJobs.length && n < max; n++) colJobs.shift()();
    };
    const colliderStep = () => {
      flushColliders(100);
      if (colJobs.length) inst.pending.unshift(colliderStep);
    };
    // one building of the layout: its meshes, colliders, doors, pumps, loot spots, props, lights
    const buildEntry = (e) => {
      const b = e.builder;
      const em0 = new THREE.Matrix4().compose(V(e.x, 0, e.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), e.rot || 0), V(1, 1, 1));
      if (b.snaps && b.snaps.length) this.snapToGround(root, b, em0);
      const g = b.build(resolve);
      g.position.set(e.x, 0, e.z);
      g.rotation.y = e.rot || 0;
      root.add(g);
      const em = new THREE.Matrix4().compose(V(e.x, 0, e.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), e.rot || 0), V(1, 1, 1));
      // static colliders (queued: see flushColliders)
      for (const c of b.colliders)
        colJobs.push(() => {
          const p = V(...c.c).applyMatrix4(em);
          tmpQ.setFromEuler(new THREE.Euler(c.rotX || 0, (e.rot || 0) + (c.rotY || 0), 0, 'YXZ'));
          const desc = RAPIER.ColliderDesc.cuboid(Math.max(0.01, c.h[0]), Math.max(0.01, c.h[1]), Math.max(0.01, c.h[2]))
            .setTranslation(p.x, p.y, p.z)
            .setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w })
            .setCollisionGroups(GROUPS.world)
            .setFriction(0.8);
          const col = ph.world.createCollider(desc, body);
          ph.setOwner(col, { kind: 'structure', surface: c.surface === 'roof' ? 'wood' : c.surface, poi: inst });
        });
      // doors
      b.doors.forEach((d, i) => this.makeDoor(inst, { ...d, mat: resolve(d.mat) }, em, e, i));
      // pumps
      for (const p of b.pumps || []) inst.pumps.push({ local: V(...p.pos).applyMatrix4(em), inst, kind: p.kind || 'fuel' });
      if (b.fuelReserve !== undefined && st.fuel === null) st.fuel = b.fuelReserve;
      // loot spots
      for (const l of b.loot) inst.loot.push({ pos: V(...l.pos).applyMatrix4(em), kind: l.kind, rot: (l.rot || 0) + (e.rot || 0), item: l.item, variant: l.variant });
      // real models, placed once the place is registered (and their files have loaded)
      for (const p of b.props || []) {
        const v = V(...p.pos).applyMatrix4(em);
        inst.propList.push({ ...p, pos: [v.x, v.y, v.z], rot: (p.rot || 0) + (e.rot || 0) });
      }
      // light fixtures: positions only; a shared pool of lights visits the nearest ones
      for (const l of b.lights) {
        if (!(l.powered || l.beacon)) continue;
        if (inst.lights.length >= 3) break;
        inst.lights.push({ local: V(...l.pos).applyMatrix4(em), def: l });
      }
      for (const a of b.animated || []) inst.animated.push(a);
      if (e.tag === 'garage' && b.carSpot) inst.carSpot = V(b.carSpot.x, 0, b.carSpot.z).applyMatrix4(em);
      this.addFootings(inst, b, em);
    };
    // then the wrecks, and the real models once the place is registered
    const finish = () => {
      const [nW, pW] = WRECKS[poi.type] ?? [0, 0];
      for (let i = 0; i < nW; i++) if (rnd() < pW) this.addWreck(inst, rnd, i, poi.type);
      for (const p of inst.propList) placeProp(this.game, inst, p);
    };
    // what lives in the place (loot, animals, a parked car, a trailer) follows in the next frames,
    // one kind a frame, so a place streaming in never costs one long frame; the start is built
    // at once
    const g = this.game;
    const hooks = [
      () => {
        g.items && g.items.onPoiLoaded && g.items.onPoiLoaded(inst, rnd);
        g.lures && g.lures.onPoiLoaded(inst);
      },
      () => g.npcs && g.npcs.onPoiLoaded && g.npcs.onPoiLoaded(inst, rnd),
      () => g.fleet && g.fleet.onPoiLoaded(inst),
      () => g.trailers && g.trailers.onPoiLoaded(inst),
    ];
    if (!tokens) {
      // the start: built at once
      for (const e of layout) buildEntry(e);
      flushColliders();
      this.group.add(root);
      this.loaded.set(k, inst);
      finish();
      for (const h of hooks) h();
      return;
    }
    // streamed in: hidden, one building a frame (a farm or a motel is several), then shown once
    // its shaders are ready, then what lives in it, one kind a frame
    root.visible = false;
    this.group.add(root);
    this.loaded.set(k, inst);
    inst.pending = [...layout.map((e) => () => buildEntry(e)), colliderStep, () => (finish(), this.game.prepare(root)), ...hooks];
  }

  // Junk out in the open set down onto the land where it lies (the place is built level; the
  // ground round it is not): its vertices and boxes go up or down by the difference.
  snapToGround(root, b, em) {
    const gen = this.game.gen;
    const o = this.game.origin;
    const baseY = root.position.y;
    const p = V(0, 0, 0);
    for (const s of b.snaps) {
      p.set(s.x, 0, s.z).applyMatrix4(em).applyMatrix4(root.matrixWorld);
      const dy = gen.height(p.x + o.x, p.z + o.z) - baseY - s.y;
      if (Math.abs(dy) < 0.005 || Math.abs(dy) > 2.5) continue;
      for (const r of s.ranges) {
        const acc = b.byMat.get(r.mat);
        if (!acc) continue;
        for (let i = r.start; i < r.end; i++) acc.p[i * 3 + 1] += dy;
        acc.bs = null;
      }
      for (let i = s.c0; i < s.c1; i++) b.colliders[i].c[1] += dy;
    }
  }

  // Where the land falls away under a building (the edge of its level pad, a slope, a bank), its
  // floors, slabs and posts would hang in the air: run a concrete footing down from each of them
  // to the real ground. One merged mesh per building.
  addFootings(inst, b, em) {
    const gen = this.game.gen;
    const o = this.game.origin;
    const rootM = inst.root.matrixWorld;
    const baseY = inst.root.position.y;
    const geos = [];
    const p = V(0, 0, 0);
    for (const c of b.colliders) {
      const bottom = c.c[1] - c.h[1];
      if (bottom > 0.5 || c.rotX || c.surface === 'roof') continue;
      const hx = c.h[0],
        hz = c.h[2];
      if (hx * hz * 4 < 0.03) continue;
      const cs = Math.cos(c.rotY || 0),
        sn = Math.sin(c.rotY || 0);
      let low = Infinity;
      for (const [ax, az] of [
        [0, 0],
        [-hx, -hz],
        [hx, -hz],
        [-hx, hz],
        [hx, hz],
      ]) {
        p.set(c.c[0] + ax * cs + az * sn, 0, c.c[2] - ax * sn + az * cs).applyMatrix4(em).applyMatrix4(rootM);
        low = Math.min(low, gen.height(p.x + o.x, p.z + o.z) - baseY);
      }
      const gap = bottom - low;
      if (gap < 0.08) continue;
      const depth = gap + 0.35;
      const g = new THREE.BoxGeometry(Math.max(0.1, hx * 2 - 0.04), depth, Math.max(0.1, hz * 2 - 0.04));
      g.rotateY(c.rotY || 0);
      g.translate(c.c[0], bottom - depth / 2 + 0.01, c.c[2]);
      g.applyMatrix4(em);
      geos.push(g.index ? g.toNonIndexed() : g);
    }
    if (!geos.length) return;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) return;
    const m = new THREE.Mesh(merged, archMaterials().concrete);
    m.castShadow = m.receiveShadow = true;
    m.name = 'footings';
    inst.root.add(m);
  }

  // Where an abandoned car stands (in the place's own frame): the fleet puts a real one there,
  // stripped, rusted and every part of it still to be had.
  addWreck(inst, rnd, i, type) {
    let x, z, rot;
    if (type === 'junkyard') {
      x = -8 + (i % 3) * 7;
      z = -2 + Math.floor(i / 3) * 7 + (rnd() - 0.5);
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
    // a roadside wreck is now and then on its side or its roof
    const roll = type === 'wreck' && rnd() < 0.5 ? (rnd() < 0.7 ? Math.PI / 2 : Math.PI) : 0;
    (inst.hulkSpots = inst.hulkSpots || []).push({ x, z, rot, roll, i });
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
    // a door stands either shut or wide open: one left ajar only blocks the way
    const open = (inst.state.doors[key] ?? d.open) > 0.3 ? 1 : 0;
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
