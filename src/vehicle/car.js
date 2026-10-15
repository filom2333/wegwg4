// The drivable car: visual model + physics + part installation state + vehicle systems
// (fuel, oil, coolant, battery, engine temperature and condition, tyres) + lights.

import * as THREE from 'three';
import { VehicleDynamics } from '../physics/vehicleDynamics.js';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { PARTS, dependentsOf } from './carParts.js';
import { SPEC } from './body/shape.js';
import { setNeedle, DRIVER } from './parts/interior.js';
import { clamp, lerp } from '../core/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Compound collision boxes: [partRequired, center, halfExtents, {rotX, tag, closedOnly}]
const BOXES = [
  ['chassis', [0, 0.2, 0.1], [0.5, 0.04, 2.05]],
  ['body', [0, 0.25, -0.12], [0.76, 0.035, 1.08], { tag: 'floor' }],
  ['body', [0.8, 0.33, -0.05], [0.07, 0.1, 0.9]],
  ['body', [-0.8, 0.33, -0.05], [0.07, 0.1, 0.9]],
  ['body', [0, 0.58, 1.55], [0.8, 0.31, 0.62], { tag: 'bay' }],
  ['body', [0, 0.78, 0.72], [0.76, 0.2, 0.24], { tag: 'dash' }],
  ['body', [0, 1.425, -0.25], [0.66, 0.035, 0.66], { tag: 'roof' }],
  ['body', [0, 1.17, 0.66], [0.7, 0.02, 0.46], { rotX: -0.97, tag: 'windshield' }],
  ['body', [0, 1.2, -1.2], [0.68, 0.02, 0.34], { rotX: 1.06, tag: 'rearglass' }],
  ['body', [0, 0.66, -1.27], [0.72, 0.36, 0.03], { tag: 'partition' }],
  ['body', [0, 0.43, -1.78], [0.66, 0.02, 0.45], { tag: 'trunkFloor' }],
  ['body', [0.76, 0.72, -1.78], [0.1, 0.3, 0.45]],
  ['body', [-0.76, 0.72, -1.78], [0.1, 0.3, 0.45]],
  ['body', [0, 0.62, -2.2], [0.8, 0.3, 0.06], { tag: 'rearPanel' }],
  ['body', [0.74, 1.12, -0.12], [0.06, 0.28, 0.06]],
  ['body', [-0.74, 1.12, -0.12], [0.06, 0.28, 0.06]],
  ['door_FL', [0.82, 0.66, 0.36], [0.06, 0.34, 0.46], { closedOnly: true }],
  ['door_FR', [-0.82, 0.66, 0.36], [0.06, 0.34, 0.46], { closedOnly: true }],
  ['door_RL', [0.82, 0.66, -0.55], [0.06, 0.34, 0.42], { closedOnly: true }],
  ['door_RR', [-0.82, 0.66, -0.55], [0.06, 0.34, 0.42], { closedOnly: true }],
  ['door_FL', [0.72, 1.18, 0.25], [0.04, 0.17, 0.4], { closedOnly: true }],
  ['door_FR', [-0.72, 1.18, 0.25], [0.04, 0.17, 0.4], { closedOnly: true }],
  ['door_RL', [0.72, 1.18, -0.5], [0.04, 0.17, 0.33], { closedOnly: true }],
  ['door_RR', [-0.72, 1.18, -0.5], [0.04, 0.17, 0.33], { closedOnly: true }],
  ['hood', [0, 0.9, 1.6], [0.78, 0.02, 0.55], { closedOnly: true }],
  ['trunk', [0, 1.02, -1.92], [0.68, 0.03, 0.32], { closedOnly: true }],
  ['bumper_F', [0, 0.5, 2.1], [0.84, 0.24, 0.12]],
  ['bumper_R', [0, 0.52, -2.2], [0.84, 0.22, 0.08]],
  ['seat_FL', [0.37, 0.48, -0.14], [0.24, 0.06, 0.24], { tag: 'seat' }],
  ['seat_FR', [-0.37, 0.48, -0.14], [0.24, 0.06, 0.24], { tag: 'seat' }],
  ['seat_FL', [0.37, 0.8, -0.42], [0.24, 0.3, 0.06], { rotX: 0.35 }],
  ['seat_FR', [-0.37, 0.8, -0.42], [0.24, 0.3, 0.06], { rotX: 0.35 }],
  ['seat_R', [0, 0.43, -0.9], [0.62, 0.06, 0.24], { tag: 'seat' }],
  ['engine', [-0.08, 0.55, 1.5], [0.36, 0.22, 0.2], { tag: 'engine' }],
];

export const SEATS = {
  driver: { pos: V(0.37, 1.165, -0.34), door: 'door_FL', part: 'seat_FL', exit: V(1.4, 0.0, 0.0) },
  passenger: { pos: V(-0.37, 1.13, -0.3), door: 'door_FR', part: 'seat_FR', exit: V(-1.4, 0.0, 0.0) },
  rearL: { pos: V(0.34, 1.08, -1.0), door: 'door_RL', part: 'seat_R', exit: V(1.4, 0.0, -0.9) },
  rearR: { pos: V(-0.34, 1.08, -1.0), door: 'door_RR', part: 'seat_R', exit: V(-1.4, 0.0, -0.9) },
};

// Hotspots for interactions (car space), with the part that must be present.
export const HOTSPOTS = [
  { id: 'fuel', label: 'Fuel filler', pos: V(-0.87, 0.86, -1.63), r: 0.18, part: 'fueltank', needs: 'fuelflap' },
  { id: 'oil', label: 'Oil filler', pos: V(0.04, 0.84, 1.55), r: 0.12, part: 'engine', hood: true },
  { id: 'coolant', label: 'Coolant reservoir', pos: V(-0.5, 0.79, 1.22), r: 0.12, part: 'radiator', hood: true },
  { id: 'battery', label: 'Battery', pos: V(0.36, 0.84, 1.72), r: 0.16, part: 'battery', hood: true },
  { id: 'ignition', label: 'Ignition', pos: V(0.31, 0.88, 0.35), r: 0.08, part: 'steeringWheel', inside: true },
  { id: 'lights', label: 'Light switch', pos: V(0.62, 0.87, 0.56), r: 0.06, part: 'body', inside: true },
  { id: 'radio', label: 'Radio', pos: V(0, 0.86, 0.49), r: 0.1, part: 'body', inside: true },
];

export class Car {
  constructor(game, model, opts = {}) {
    this.game = game;
    this.model = model;
    this.root = model.root;
    game.worldGroup.add(this.root);
    this.parts = {};
    for (const id of Object.keys(model.parts)) {
      this.parts[id] = { installed: true, condition: 1, item: null };
    }
    // systems
    this.fuel = opts.fuel ?? 22; // litres
    this.fuelCap = 50;
    this.oil = opts.oil ?? 3.4; // litres
    this.oilCap = 3.6;
    this.coolant = opts.coolant ?? 4.6;
    this.coolantCap = 5;
    this.battery = opts.battery ?? 0.85;
    this.engineTemp = 22;
    this.engineCondition = opts.engineCondition ?? 0.85;
    this.radiatorCondition = 0.9;
    this.odometer = opts.odometer ?? 184213;
    this.trip = 0;
    this.lightsOn = 0; // 0 off, 1 low, 2 high
    this.ignition = false;
    this.cranking = 0;
    this.radioOn = false;
    this.fire = 0;
    this.smoke = 0;
    this.dirt = 0.35;
    this.horn = false;
    this.wipers = false;
    this.wiperPhase = 0;
    this.cabinLight = false;
    // physics
    const pos = opts.position || V(0, 0.5, 0);
    const q = opts.quaternion || new THREE.Quaternion();
    this.dyn = new VehicleDynamics(game.physics, {
      position: pos,
      quaternion: q,
      hardpoints: [
        { id: 'wheel_FL', x: SPEC.trackHalf, z: SPEC.axleF, steer: true, drive: true },
        { id: 'wheel_FR', x: -SPEC.trackHalf, z: SPEC.axleF, steer: true, drive: true },
        { id: 'wheel_RL', x: SPEC.trackHalf, z: SPEC.axleR },
        { id: 'wheel_RR', x: -SPEC.trackHalf, z: SPEC.axleR },
      ],
    });
    this.dyn.surfaceAt = (p, collider) => {
      const owner = game.physics.ownerOf(collider);
      if (owner && owner.surface) return owner.surface;
      const o = game.origin;
      return game.gen.surfaceAt(p.x + o.x, p.z + o.z);
    };
    this.dyn.onImpact = (imp) => this.onImpact(imp);
    this.dyn.onStall = () => {
      this.game.audio && this.game.audio.play('stall', { at: this.root.position });
    };
    this.ownerTag = { kind: 'car', car: this };
    this.colliderParts = [];
    this.rebuildColliders();
    this.updateMass();
    this.setupLights();
    this.prevPos = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.attached = []; // items stowed in the car
    this.wheelDust = [0, 0, 0, 0];
    this.syncVisual();
  }

  // ---------------------------------------------------------------- parts
  isInstalled(id) {
    return !!(this.parts[id] && this.parts[id].installed);
  }

  canInstall(id) {
    const def = PARTS[id];
    if (!def || this.isInstalled(id)) return { ok: false, reason: 'Already installed' };
    for (const r of def.requires) if (!this.isInstalled(r)) return { ok: false, reason: `Needs ${PARTS[r].label.toLowerCase()} first` };
    if (def.needsHoodOpen && this.isInstalled('hood') && this.model.parts.hood.openT < 0.5) return { ok: false, reason: 'Open the hood first' };
    return { ok: true };
  }

  canRemove(id) {
    const def = PARTS[id];
    if (!def || def.fixed) return { ok: false, reason: 'Cannot be removed' };
    if (!this.isInstalled(id)) return { ok: false, reason: 'Not installed' };
    const deps = dependentsOf(id).filter((d) => this.isInstalled(d) && !PARTS[d].fixed);
    if (deps.length) return { ok: false, reason: `Remove ${PARTS[deps[0]].label.toLowerCase()} first` };
    if (def.needsHoodOpen && this.isInstalled('hood') && this.model.parts.hood.openT < 0.5) return { ok: false, reason: 'Open the hood first' };
    if (this.game.player && this.game.player.seat) return { ok: false, reason: 'Get out of the car first' };
    return { ok: true };
  }

  setInstalled(id, on) {
    this.parts[id].installed = on;
    this.model.setInstalled(id, on);
    const w = this.dyn.wheels.find((x) => x.id === id);
    if (w) w.installed = on;
    if (id === 'engine') this.dyn.engineInstalled = on;
    if (id === 'steeringWheel') this.dyn.steeringInstalled = on;
    if (id === 'body') for (const f of ['fuelflap']) this.model.setInstalled(f, on);
    if ((id === 'engine' || id === 'battery' || id === 'fueltank') && !on) this.setIgnition(false);
    this.rebuildColliders();
    this.updateMass();
  }

  // Bounding box of a part in car space (rest pose).
  partBox(id) {
    return this.model.parts[id].bbox;
  }

  updateMass() {
    let m = 0;
    const com = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const [id, st] of Object.entries(this.parts)) {
      if (!st.installed || !PARTS[id]) continue;
      const mass = PARTS[id].mass;
      const b = this.model.parts[id].bbox;
      if (!b || b.isEmpty()) continue;
      b.getCenter(c);
      com.addScaledVector(c, mass);
      m += mass;
    }
    // fuel
    const fuelMass = this.isInstalled('fueltank') ? this.fuel * 0.74 : 0;
    com.addScaledVector(V(0, 0.2, -0.98), fuelMass);
    m += fuelMass;
    // driver
    if (this.game.player && this.game.player.seat) {
      com.addScaledVector(SEATS[this.game.player.seat].pos.clone().setY(0.6), 80);
      m += 80;
    }
    com.multiplyScalar(1 / Math.max(1, m));
    // pull COM a little lower: shell mass sits low in sills and floor
    com.y = Math.min(com.y, 0.55);
    this.totalMass = m;
    this.dyn.setMassProperties({ mass: Math.max(m, 120), com });
  }

  rebuildColliders() {
    const list = [];
    this.colliderParts = [];
    for (const [part, c, h, o = {}] of BOXES) {
      if (!this.isInstalled(part)) continue;
      if (o.closedOnly && this.model.parts[part].openT > 0.08) continue;
      list.push({ part, c, h, o });
    }
    const dyn = this.dyn;
    for (const col of dyn.colliders) this.game.physics.removeCollider(col);
    dyn.colliders = [];
    for (const b of list) {
      let desc = RAPIER.ColliderDesc.cuboid(b.h[0], b.h[1], b.h[2]).setTranslation(b.c[0], b.c[1], b.c[2]);
      if (b.o.rotX) {
        const q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), b.o.rotX);
        desc = desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      }
      desc.setDensity(0).setFriction(0.6).setRestitution(0.05).setCollisionGroups(GROUPS.car);
      const col = this.game.physics.world.createCollider(desc, dyn.body);
      this.game.physics.setOwner(col, { kind: 'car', car: this, part: b.part, tag: b.o.tag || null });
      dyn.colliders.push(col);
    }
  }

  // ---------------------------------------------------------------- doors etc.
  toggleOpen(id) {
    const p = this.model.parts[id];
    if (!p || !p.hinge || !this.isInstalled(id)) return;
    p.targetOpen = p.openT > 0.5 ? 0 : 1;
    const snd = id.startsWith('door') ? (p.targetOpen ? 'doorOpen' : 'doorClose') : id === 'hood' ? 'hood' : 'trunk';
    this.game.audio && this.game.audio.play(snd, { at: this.worldPointOf(p.hinge.origin) });
  }

  worldPointOf(local) {
    return local.clone().applyMatrix4(this.root.matrixWorld);
  }

  localPointOf(world) {
    return world.clone().applyMatrix4(new THREE.Matrix4().copy(this.root.matrixWorld).invert());
  }

  // ---------------------------------------------------------------- lights
  setupLights() {
    const M = this.model.mats;
    const head = new THREE.SpotLight(0xfff1dc, 0, 70, 0.62, 0.55, 1.3);
    head.position.set(0, 0.74, 2.05);
    head.target.position.set(0, 0.0, 14);
    head.castShadow = true;
    head.shadow.mapSize.set(1024, 1024);
    head.shadow.camera.near = 0.3;
    head.shadow.camera.far = 70;
    head.shadow.bias = -0.0008;
    head.shadow.normalBias = 0.03;
    this.root.add(head, head.target);
    this.headLight = head;
    // a wide, dim fill so the roadside isn't pitch black
    const fill = new THREE.SpotLight(0xffe9d0, 0, 28, 1.15, 0.9, 1.6);
    fill.position.set(0, 0.7, 2.1);
    fill.target.position.set(0, 0, 8);
    this.root.add(fill, fill.target);
    this.headFill = fill;
    const tail = new THREE.PointLight(0xff2010, 0, 6, 2);
    tail.position.set(0, 0.85, -2.45);
    this.root.add(tail);
    this.tailLight = tail;
    const reverse = new THREE.SpotLight(0xffffff, 0, 12, 0.9, 0.8, 1.8);
    reverse.position.set(0, 0.8, -2.35);
    reverse.target.position.set(0, 0, -8);
    this.root.add(reverse, reverse.target);
    this.reverseLight = reverse;
    const cabin = new THREE.PointLight(0xffeccc, 0, 2.6, 1.5);
    cabin.position.set(0, 1.3, -0.1);
    this.root.add(cabin);
    this.cabinLamp = cabin;
    // emissive materials (cloned so this car owns them)
    this.emissive = {
      lens: M.slots[10],
      red: M.lensRed,
      amber: M.lensAmber,
      bulb: M.bulb,
      projector: M.projector,
      drl: M.drl,
      redChrome: M.redChrome,
      dome: this.model.interiorMats.domeLens,
      gauge: this.model.interiorMats.gauge,
      needle: this.model.interiorMats.needle,
      display: this.model.interiorMats.display,
      brake3: this.model.interiorMats.brakeLight,
    };
  }

  updateLights(braking, reversing) {
    const powered = this.isInstalled('battery') && this.battery > 0.03;
    const on = powered && this.lightsOn > 0;
    const hiBeam = this.lightsOn === 2;
    const leftH = this.isInstalled('headlight_L'),
      rightH = this.isInstalled('headlight_R');
    const hcount = (leftH ? 1 : 0) + (rightH ? 1 : 0);
    const dim = clamp(this.battery * 3, 0.2, 1) * (this.dyn.engine.running ? 1 : 0.8);
    this.headLight.intensity = on ? (hiBeam ? 260 : 150) * (hcount / 2) * dim : 0;
    this.headLight.distance = hiBeam ? 120 : 70;
    this.headLight.angle = hiBeam ? 0.5 : 0.62;
    this.headLight.target.position.y = hiBeam ? 0.6 : 0.0;
    this.headLight.position.x = leftH && !rightH ? 0.55 : rightH && !leftH ? -0.55 : 0;
    this.headFill.intensity = on ? 30 * (hcount / 2) * dim : 0;
    const e = this.emissive;
    e.bulb.emissiveIntensity = on ? 6 : 0;
    e.projector.emissiveIntensity = on ? 3 : 0;
    e.drl.emissiveIntensity = powered && (this.ignition || on) ? 2.2 : 0;
    const tailOn = on || braking;
    e.redChrome.emissiveIntensity = tailOn && powered ? (braking ? 4 : 1.5) : 0;
    e.red.emissiveIntensity = powered ? (braking ? 1.4 : on ? 0.5 : 0) : 0;
    e.brake3.emissiveIntensity = powered && braking ? 3 : 0;
    this.tailLight.intensity = powered ? (braking ? 2.2 : on ? 0.8 : 0) : 0;
    this.reverseLight.intensity = powered && reversing ? 18 : 0;
    e.lens.emissive = e.lens.emissive || new THREE.Color();
    // dashboard backlight
    e.gauge.emissiveIntensity = powered && this.ignition ? (on ? 1.4 : 0.8) : 0.25;
    e.needle.emissiveIntensity = powered && this.ignition ? 1.5 : 0;
    e.display.emissiveIntensity = powered && this.radioOn ? 1.6 : 0;
    // cabin lamp: on while a front door is open or toggled
    const doorOpen = ['door_FL', 'door_FR', 'door_RL', 'door_RR'].some((d) => this.isInstalled(d) && this.model.parts[d].openT > 0.2);
    const cabinOn = powered && (this.cabinLight || doorOpen);
    this.cabinLamp.intensity = cabinOn ? 2.2 : 0;
    e.dome.emissiveIntensity = cabinOn ? 2 : 0;
  }

  // ---------------------------------------------------------------- driving controls
  setIgnition(on) {
    if (on) {
      if (!this.isInstalled('battery') || this.battery < 0.05) {
        this.game.hud && this.game.hud.toast('Battery is dead');
        this.game.audio && this.game.audio.play('click');
        return false;
      }
      this.ignition = true;
      return true;
    }
    this.ignition = false;
    this.dyn.stopEngine();
    this.cranking = 0;
    return true;
  }

  // Hold-to-crank start: returns current state text.
  crank(dt) {
    if (!this.ignition || this.dyn.engine.running) return;
    if (!this.isInstalled('battery') || this.battery < 0.05) return;
    this.cranking += dt;
    this.battery = Math.max(0, this.battery - dt * 0.012);
    this.dyn.engine.omega = Math.max(this.dyn.engine.omega, (260 * 2 * Math.PI) / 60);
    const canRun = this.isInstalled('engine') && this.isInstalled('fueltank') && this.fuel > 0.05 && this.oil > 0.1 && this.engineCondition > 0.03;
    const chance = this.engineCondition * (this.battery > 0.25 ? 1 : 0.4);
    if (canRun && this.cranking > 0.6 + (1 - chance) * 1.6) {
      this.dyn.startEngine();
      this.cranking = 0;
      this.game.audio && this.game.audio.play('engineStart');
    }
  }

  // ---------------------------------------------------------------- simulation
  update(dt, controls) {
    const d = this.dyn;
    // hinge animation
    let collidersDirty = false;
    for (const [id, p] of Object.entries(this.model.parts)) {
      if (!p.hinge || p.targetOpen === undefined) continue;
      const before = p.openT;
      const speed = id.startsWith('door') ? 2.6 : 1.6;
      const t = p.openT + Math.sign(p.targetOpen - p.openT) * Math.min(Math.abs(p.targetOpen - p.openT), dt * speed);
      if (t !== before) {
        // ease
        this.model.setOpen(id, t);
        if ((before <= 0.08) !== (t <= 0.08)) collidersDirty = true;
      }
    }
    if (collidersDirty) this.rebuildColliders();

    // controls -> dynamics
    const running = d.engine.running;
    const c = controls || { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    const hasDriver = !!controls;
    let throttle = c.throttle,
      brake = c.brake;
    // automatic: reverse when stopped and braking
    if (d.automatic && hasDriver) {
      const v = d.forwardSpeed;
      if (c.reverse) {
        // S pressed: brake while moving forward, reverse when nearly stopped
        if (d.gear >= 2 && v > 0.8) {
          brake = 1;
          throttle = 0;
        } else {
          if (d.gear !== 0 && v < 0.8) d.gear = 0;
          if (d.gear === 0) throttle = c.reverse * 0.6;
        }
      } else if (c.throttle > 0 && d.gear === 0) {
        if (v < -0.8) {
          brake = 1;
          throttle = 0;
        } else d.gear = 2;
      }
    }
    d.controls.throttle = running ? throttle : 0;
    d.controls.brake = brake;
    d.controls.steer = c.steer;
    // nobody at the wheel: the car rolls on (engine braking only) and the parking brake only
    // holds it once it has nearly stopped, so leaving a moving car never stops it dead
    const slow = Math.abs(d.forwardSpeed) < 0.8;
    d.controls.handbrake = c.handbrake || (!hasDriver && !running && slow ? 0.6 : 0);
    if (!hasDriver && slow) d.controls.brake = Math.max(d.controls.brake, 0.3);
    const fuelOk = this.isInstalled('fueltank') && this.fuel > 0;
    d.powerScale = (0.4 + 0.6 * this.engineCondition) * (this.isInstalled('airfilter') ? 1 : 1.03) * (this.engineTemp > 125 ? 0.6 : 1);
    if (running && (!fuelOk || this.oil <= 0.02 || this.engineCondition <= 0.01 || !this.ignition)) {
      d.stopEngine();
      this.game.audio && this.game.audio.play('stall');
    }
    // grip from weather
    const env = this.game.env;
    d.wet = env ? env.w.rain * 0.9 : 0;

    // ---- systems ----
    const rpm = d.engine.rpm;
    const powerKw = running ? Math.max(0, (d.engine.torqueOut * rpm * 2 * Math.PI) / 60 / 1000) : 0;
    const diff = this.game.difficulty || { consumption: 1, wear: 1 };
    if (running) {
      const lph = 0.75 + powerKw * 0.36;
      const burn = Math.min(this.fuel, (lph / 3600) * dt * diff.consumption);
      this.fuel -= burn;
      if (this.game.stats) this.game.stats.fuelUsed += burn;
      this.oil = Math.max(0, this.oil - (0.004 + powerKw * 0.00006) * (dt / 60) * diff.wear * (this.engineCondition < 0.5 ? 2 : 1));
      // engine temperature
      const coolantFrac = this.isInstalled('radiator') ? clamp(this.coolant / this.coolantCap, 0, 1) : 0;
      const coolingCap = coolantFrac * this.radiatorCondition * (0.6 + Math.min(1, d.speed / 15) * 0.6 + 0.25); // fan
      const heat = 6 + powerKw * 0.55;
      const target = 88 + Math.max(0, heat - coolingCap * 70) * 1.6 + (env ? (env.daylight * 6) : 0);
      this.engineTemp += (target - this.engineTemp) * Math.min(1, dt * 0.05);
      if (this.engineTemp > 108 && coolantFrac > 0) this.coolant = Math.max(0, this.coolant - dt * 0.002 * (this.engineTemp - 108));
      // wear & damage
      let wear = 0.0000012 * (1 + powerKw / 40) * diff.wear;
      if (this.engineTemp > 115) wear += 0.00025 * (this.engineTemp - 115) * diff.wear;
      if (this.oil < 0.8) wear += 0.0002 * (0.8 - this.oil) * diff.wear;
      if (!this.isInstalled('airfilter')) wear += 0.000004 * (1 + (env ? env.w.dust * 20 : 0));
      if (env && env.w.dust > 0.3 && this.isInstalled('airfilter')) wear += 0.0000015 * env.w.dust;
      this.engineCondition = Math.max(0, this.engineCondition - wear * dt);
      // battery charges while running
      if (this.isInstalled('battery')) this.battery = Math.min(1, this.battery + dt * 0.0012 * (rpm > 1200 ? 1 : 0.3));
      // misfires / backfires at low condition
      if (this.engineCondition < 0.35 && Math.random() < dt * (0.35 - this.engineCondition) * 3) {
        this.game.effects && this.game.effects.backfire(this);
        this.game.audio && this.game.audio.play('backfire', { at: this.root.position });
      }
    } else {
      this.engineTemp += (22 + (env ? env.daylight * 14 : 0) - this.engineTemp) * Math.min(1, dt * 0.004);
    }
    // electrical drain
    if (this.isInstalled('battery')) {
      let drain = 0;
      if (this.lightsOn) drain += this.lightsOn === 2 ? 0.00006 : 0.00004;
      if (this.radioOn) drain += 0.000012;
      if (this.ignition) drain += 0.000008;
      if (!running) this.battery = Math.max(0, this.battery - drain * dt);
    }
    // smoke / fire from a failing engine
    this.smoke = running ? clamp((0.3 - this.engineCondition) * 3, 0, 1) + clamp((this.engineTemp - 112) / 20, 0, 1) : clamp((this.engineTemp - 110) / 20, 0, 1) * 0.6;
    if (this.engineCondition < 0.05 && running && Math.random() < dt * 0.05) this.fire = 1;
    if (this.fire > 0) {
      this.engineCondition = Math.max(0, this.engineCondition - dt * 0.01);
      this.fire = Math.min(1, this.fire + dt * 0.02);
    }
    // odometer
    const p = this.dyn.body.translation();
    const moved = Math.hypot(p.x - this.prevPos.x, p.z - this.prevPos.z);
    if (moved < 5) {
      this.odometer += moved / 1000;
      this.trip += moved / 1000;
    }
    this.prevPos.set(p.x, p.y, p.z);
    // tyre wear from skidding
    for (const w of d.wheels) {
      if (!w.installed) continue;
      const st = this.parts[w.id];
      st.condition = Math.max(0, st.condition - w.skid * dt * 0.0008 * diff.wear);
      w.tyreCondition = st.condition;
      if (st.condition < 0.02) w.flat = true;
    }
    // dust builds up off the asphalt; rain washes it off; drives the paint weathering shader
    const env2 = this.game.env;
    const spd = Math.abs(d.forwardSpeed);
    const surf = (d.wheels[0] && d.wheels[0].surface) || 'asphalt';
    if (spd > 2) this.dirt = Math.min(1, this.dirt + dt * spd * (surf === 'asphalt' ? 0.000004 : 0.00004));
    if (env2 && env2.w.rain > 0.3) this.dirt = Math.max(0.05, this.dirt - dt * 0.004 * env2.w.rain);
    const wu = this.game.carMats && this.game.carMats.weather;
    if (wu && wu.uDirt) wu.uDirt.value = this.dirt;
    // wipers
    if (this.wipers && this.isInstalled('battery') && this.battery > 0.03) this.wiperPhase += dt * 2.4;
    else if (this.wiperPhase % (Math.PI * 2) > 0.05) this.wiperPhase += dt * 2.4;
    this.updateLights(d.controls.brake > 0.1 && hasDriver, d.gear === 0 && running);
    this.syncVisual();
  }

  onImpact(imp) {
    // imp.dv in m/s within one physics step
    const severity = imp.dv;
    if (severity < 2.2) return;
    const q = this.root.quaternion.clone().invert();
    const dirLocal = imp.dir.clone().applyQuaternion(q); // direction of velocity change (away from the obstacle)
    const front = dirLocal.z < -0.5; // pushed backwards => hit the front
    const rear = dirLocal.z > 0.5;
    const dmg = (severity - 2.2) * 0.04 * (this.game.difficulty ? this.game.difficulty.damage : 1);
    if (front) {
      const absorb = this.isInstalled('bumper_F') ? 0.5 : 1;
      if (this.isInstalled('radiator')) this.radiatorCondition = Math.max(0, this.radiatorCondition - dmg * absorb * 1.2);
      this.engineCondition = Math.max(0, this.engineCondition - dmg * absorb * 0.6);
      for (const h of ['headlight_L', 'headlight_R']) if (this.isInstalled(h)) this.parts[h].condition = Math.max(0, this.parts[h].condition - dmg * 2);
      this.coolant = Math.max(0, this.coolant - dmg * 4 * (this.radiatorCondition < 0.4 ? 1 : 0));
    } else if (rear) {
      for (const h of ['taillight_L', 'taillight_R']) if (this.isInstalled(h)) this.parts[h].condition = Math.max(0, this.parts[h].condition - dmg * 2);
    }
    this.lastImpact = { severity, time: performance.now() };
    this.game.audio && this.game.audio.play(severity > 6 ? 'crashHeavy' : 'crash', { at: this.root.position, volume: clamp(severity / 10, 0.2, 1) });
    this.game.effects && this.game.effects.impactDebris(this, imp, severity);
    this.game.onCarImpact && this.game.onCarImpact(severity);
  }

  // Copy physics state to the visual model.
  syncVisual() {
    const b = this.dyn.body;
    const t = b.translation(),
      r = b.rotation();
    this.root.position.set(t.x, t.y, t.z);
    this.root.quaternion.set(r.x, r.y, r.z, r.w);
    this.root.updateMatrixWorld(true);
    const mw = this.model.wheels;
    for (const w of this.dyn.wheels) {
      const v = mw[w.id];
      if (!v) continue;
      const vis = this.dyn.wheelVisual(w);
      v.pivot.position.y = vis.y;
      v.knuckle.rotation.y = vis.steer;
      v.spin.rotation.x = v.side > 0 ? vis.spin : -vis.spin;
      if (w.flat) v.spin.scale.set(1, 0.97, 0.97);
    }
    // steering wheel rotates with the road wheels (15:1)
    if (this.model.steeringWheel) {
      const sw = this.model.steeringWheel.children[0];
      if (sw) sw.rotation.z = this.dyn.steerSmoothed * 14;
    }
    // wipers
    if (this.model.wipers && this.model.wipers.userData.wipers) {
      const a = (1 - Math.cos(this.wiperPhase)) * 0.5 * 1.45;
      for (const wg of this.model.wipers.userData.wipers) {
        const piv = wg.userData.pivot,
          ax = wg.userData.axis;
        wg.position.set(0, 0, 0);
        wg.quaternion.setFromAxisAngle(ax, -a);
        // rotate about the pivot point
        const off = piv.clone().sub(piv.clone().applyQuaternion(wg.quaternion));
        wg.position.copy(off);
      }
    }
    // gauges
    const needles = this.model.cluster && this.model.cluster.userData.needles;
    if (needles) {
      const powered = this.ignition && this.isInstalled('battery') && this.battery > 0.03;
      const spd = Math.abs(this.dyn.forwardSpeed) * 3.6;
      setNeedle(needles, 'speed', spd / 220);
      setNeedle(needles, 'rpm', this.dyn.engine.rpm / 8000);
      setNeedle(needles, 'fuel', powered ? this.fuel / this.fuelCap : 0);
      setNeedle(needles, 'temp', powered ? clamp((this.engineTemp - 40) / 90, 0, 1) : 0);
    }
    // pedals
    if (this.model.pedals) {
      const pd = this.model.pedals.userData.pedals;
      pd.gas.rotation.x = -this.dyn.controls.throttle * 0.3;
      pd.brake.rotation.x = -this.dyn.controls.brake * 0.25;
    }
  }

  get speedKmh() {
    return this.dyn.forwardSpeed * 3.6;
  }

  get position() {
    return this.root.position;
  }

  // World transform of a seat camera.
  seatWorld(seat) {
    return SEATS[seat].pos.clone().applyMatrix4(this.root.matrixWorld);
  }

  dispose() {
    this.dyn.dispose();
    this.root.parent && this.root.parent.remove(this.root);
  }
}

export { DRIVER };
