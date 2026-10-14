// Raycast vehicle with a combined-slip tyre model, coupled engine / clutch / gearbox, open
// differential, anti-roll bars, aerodynamic drag and surface-dependent grip.
// The chassis is a Rapier rigid body; suspension and tyre forces are applied as impulses at the
// contact points every fixed step (with sub-stepped wheel spin integration).

import * as THREE from 'three';
import { RAPIER, GROUPS } from './physics.js';

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

// Simplified Pacejka "magic formula" (normalised to peak = 1).
function magic(x, B, C, E) {
  const bx = B * x;
  return Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
}

export const SURFACES = {
  asphalt: { mu: 1.0, roll: 0.012, wetMu: 0.72, noise: 0.15, dust: 0.05 },
  concrete: { mu: 0.95, roll: 0.012, wetMu: 0.7, noise: 0.15, dust: 0.05 },
  gravel: { mu: 0.72, roll: 0.03, wetMu: 0.62, noise: 0.6, dust: 0.6 },
  dirt: { mu: 0.75, roll: 0.025, wetMu: 0.5, noise: 0.4, dust: 0.8 },
  sand: { mu: 0.6, roll: 0.06, wetMu: 0.6, noise: 0.35, dust: 1.0 },
  grass: { mu: 0.7, roll: 0.03, wetMu: 0.45, noise: 0.3, dust: 0.2 },
  rock: { mu: 0.85, roll: 0.02, wetMu: 0.6, noise: 0.5, dust: 0.2 },
  salt: { mu: 0.8, roll: 0.015, wetMu: 0.5, noise: 0.2, dust: 0.4 },
  wood: { mu: 0.7, roll: 0.015, wetMu: 0.5, noise: 0.4, dust: 0.0 },
};

// Engine torque curve (N·m at full throttle) for a 1.6 l 16V.
const TORQUE_CURVE = [
  [0, 0],
  [600, 70],
  [1000, 105],
  [2000, 128],
  [3000, 140],
  [4000, 150],
  [4800, 148],
  [5600, 138],
  [6200, 124],
  [6800, 100],
  [7200, 60],
];
function torqueAt(rpm) {
  if (rpm <= 0) return 0;
  for (let i = 1; i < TORQUE_CURVE.length; i++) {
    if (rpm <= TORQUE_CURVE[i][0]) {
      const [r0, t0] = TORQUE_CURVE[i - 1],
        [r1, t1] = TORQUE_CURVE[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return 0;
}

export const DEFAULT_PARAMS = {
  restLength: 0.3,
  maxCompression: 0.19,
  springF: 31000,
  springR: 27000,
  damperBump: 2600,
  damperRebound: 3600,
  arbF: 9000,
  arbR: 5500,
  wheelRadius: 0.316,
  wheelInertia: 1.1,
  maxSteer: (34 * Math.PI) / 180,
  brakeTorque: 1900, // per front wheel, rear gets 60 %
  handbrakeTorque: 1600,
  // drivetrain
  gears: [-3.42, 0, 3.64, 1.95, 1.36, 1.03, 0.82],
  finalDrive: 4.06,
  idleRpm: 850,
  redline: 6600,
  engineInertia: 0.16,
  engineFriction: 0.0045, // N·m per rpm
  clutchMaxTorque: 320,
  drag: 0.5 * 1.2 * 0.33 * 2.1,
  driveEfficiency: 0.9,
  tyre: {
    latB: 9.5,
    latC: 1.35,
    latE: 0.2,
    longB: 11,
    longC: 1.6,
    longE: 0.1,
    peakSlip: 0.12, // longitudinal
    peakAngle: 0.14, // rad
  },
};

export class VehicleDynamics {
  /**
   * @param physics Physics wrapper
   * @param opts { position, quaternion, hardpoints: [{id,x,z,steer,drive}], massProps, colliders }
   */
  constructor(physics, opts) {
    this.physics = physics;
    this.p = { ...DEFAULT_PARAMS, ...(opts.params || {}) };
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(opts.position.x, opts.position.y, opts.position.z)
      .setRotation(opts.quaternion || { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(0.0)
      .setAngularDamping(0.05)
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = physics.world.createRigidBody(desc);
    this.colliders = [];
    this.wheels = opts.hardpoints.map((h) => ({
      id: h.id,
      local: new THREE.Vector3(h.x, 0, h.z),
      front: h.z > 0,
      steer: !!h.steer,
      drive: !!h.drive,
      installed: true,
      tyreCondition: 1,
      flat: false,
      compression: 0,
      prevCompression: 0,
      contact: false,
      contactPoint: new THREE.Vector3(),
      contactNormal: new THREE.Vector3(0, 1, 0),
      surface: 'asphalt',
      load: 0,
      omega: 0,
      spin: 0,
      steerAngle: 0,
      slipRatio: 0,
      slipAngle: 0,
      longForce: 0,
      latForce: 0,
      skid: 0,
      vLong: 0,
      vLat: 0,
    }));
    this.topY = this.p.restLength + this.p.wheelRadius - 0.098;
    // drivetrain state
    this.engine = { rpm: 0, running: false, omega: 0, load: 0, torqueOut: 0, stallTimer: 0 };
    this.gear = 1; // index into gears (0 = reverse, 1 = neutral)
    this.clutch = 1;
    this.automatic = true;
    this.tcs = true;
    this.shiftTimer = 0;
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.steerSmoothed = 0;
    this.gripScale = 1;
    this.wet = 0;
    this.powerScale = 1; // engine condition multiplier
    this.engineInstalled = true;
    this.steeringInstalled = true;
    this.speed = 0;
    this.forwardSpeed = 0;
    this.lastLinvel = new THREE.Vector3();
    this.impact = null; // last collision {dv, dir}
    this.surfaceAt = opts.surfaceAt || (() => 'asphalt');
    this.setMassProperties(opts.massProps || { mass: 1150, com: new THREE.Vector3(0, 0.52, 0.2) });
    if (opts.colliders) this.setColliders(opts.colliders);
    this._preStep = (dt) => this.step(dt);
    physics.beforeStep.push(this._preStep);
    this._postStep = () => this.postStep();
    physics.afterStep.push(this._postStep);
  }

  dispose() {
    const i = this.physics.beforeStep.indexOf(this._preStep);
    if (i >= 0) this.physics.beforeStep.splice(i, 1);
    const j = this.physics.afterStep.indexOf(this._postStep);
    if (j >= 0) this.physics.afterStep.splice(j, 1);
    this.physics.removeBody(this.body);
  }

  setMassProperties({ mass, com, size = new THREE.Vector3(1.6, 1.0, 4.2) }) {
    this.mass = mass;
    this.com = com.clone();
    const k = 0.75;
    const ix = (mass / 12) * (size.y * size.y + size.z * size.z) * k;
    const iy = (mass / 12) * (size.x * size.x + size.z * size.z) * k;
    const iz = (mass / 12) * (size.x * size.x + size.y * size.y) * k;
    this.body.setAdditionalMassProperties(mass, { x: com.x, y: com.y, z: com.z }, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 }, true);
  }

  // colliders: [{ points: Float32Array }] convex hulls in car space, or { box: [hx,hy,hz], pos:[x,y,z] }
  setColliders(list, owner) {
    for (const c of this.colliders) this.physics.removeCollider(c);
    this.colliders = [];
    for (const def of list) {
      let desc;
      if (def.points) desc = RAPIER.ColliderDesc.convexHull(def.points);
      else desc = RAPIER.ColliderDesc.cuboid(...def.box).setTranslation(...def.pos);
      if (!desc) continue;
      desc.setDensity(0).setFriction(0.5).setRestitution(0.05).setCollisionGroups(GROUPS.car);
      const c = this.physics.world.createCollider(desc, this.body);
      if (owner) this.physics.setOwner(c, owner);
      this.colliders.push(c);
    }
  }

  get position() {
    return this.body.translation();
  }

  get rotation() {
    return this.body.rotation();
  }

  gearRatio() {
    return this.p.gears[this.gear];
  }

  gearLabel() {
    if (this.gear === 0) return 'R';
    if (this.gear === 1) return 'N';
    return String(this.gear - 1);
  }

  shift(dir) {
    const ng = Math.max(0, Math.min(this.p.gears.length - 1, this.gear + dir));
    if (ng !== this.gear) {
      this.gear = ng;
      this.shiftTimer = 0.25;
    }
  }

  // ---------------------------------------------------------------- simulation
  step(dt) {
    const body = this.body;
    const p = this.p;
    const t = body.translation();
    const r = body.rotation();
    const q = tmpQ.set(r.x, r.y, r.z, r.w);
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    const lv = body.linvel();
    const av = body.angvel();
    const linvel = new THREE.Vector3(lv.x, lv.y, lv.z);
    const angvel = new THREE.Vector3(av.x, av.y, av.z);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(q); // car +X is left
    const comWorld = this.com.clone().applyQuaternion(q).add(pos);
    this.forwardSpeed = linvel.dot(fwd);
    this.speed = linvel.length();
    const speedKmh = Math.abs(this.forwardSpeed) * 3.6;

    // ---- controls / steering ----
    const c = this.controls;
    const steerLimit = p.maxSteer * (1 / (1 + Math.max(0, speedKmh - 20) / 60)) * (this.steeringInstalled ? 1 : 0);
    const target = -c.steer * steerLimit;
    const rate = 2.6; // rad/s
    const dS = target - this.steerSmoothed;
    this.steerSmoothed += Math.max(-rate * dt, Math.min(rate * dt, dS));
    // Ackermann
    const wb = 2.6,
      tw = 1.49;
    for (const w of this.wheels) {
      if (!w.steer) {
        w.steerAngle = 0;
        continue;
      }
      const a = this.steerSmoothed;
      if (Math.abs(a) < 1e-4) w.steerAngle = 0;
      else {
        const R = wb / Math.tan(Math.abs(a));
        const inner = (w.local.x > 0) === a > 0; // turning toward +X (left) => left wheel is inner
        w.steerAngle = Math.sign(a) * Math.atan(wb / (R + (inner ? -tw / 2 : tw / 2)));
      }
    }

    // ---- suspension raycasts ----
    const rayDir = up.clone().negate();
    const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: rayDir.x, y: rayDir.y, z: rayDir.z });
    const maxLen = p.restLength + p.wheelRadius;
    for (const w of this.wheels) {
      w.prevCompression = w.compression;
      w.contact = false;
      if (!w.installed) {
        w.compression = 0;
        continue;
      }
      const top = new THREE.Vector3(w.local.x, this.topY, w.local.z).applyQuaternion(q).add(pos);
      w.top = top;
      ray.origin.x = top.x;
      ray.origin.y = top.y;
      ray.origin.z = top.z;
      const hit = this.physics.world.castRayAndGetNormal(ray, maxLen, true, undefined, GROUPS.wheelRay, undefined, body);
      const radius = p.wheelRadius * (w.flat ? 0.82 : 1);
      if (hit) {
        const d = hit.timeOfImpact;
        let comp = p.restLength + radius - d;
        if (comp > 0) {
          w.contact = true;
          w.compression = Math.min(comp, p.maxCompression + 0.04);
          w.contactPoint.set(top.x + rayDir.x * d, top.y + rayDir.y * d, top.z + rayDir.z * d);
          w.contactNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
          w.surface = this.surfaceAt(w.contactPoint, hit.collider);
          if (w.compression > p.maxCompression) {
            // bump stop: very stiff
            w.bump = (w.compression - p.maxCompression) * 400000;
          } else w.bump = 0;
        } else w.compression = 0;
      } else w.compression = 0;
    }

    // ---- suspension forces ----
    const impulses = [];
    const antiRoll = (a, b, k) => {
      const wa = this.wheels.find((w) => w.id === a),
        wb2 = this.wheels.find((w) => w.id === b);
      if (!wa || !wb2) return;
      const diff = (wa.contact ? wa.compression : 0) - (wb2.contact ? wb2.compression : 0);
      wa.arb = diff * k;
      wb2.arb = -diff * k;
    };
    for (const w of this.wheels) w.arb = 0;
    antiRoll('wheel_FL', 'wheel_FR', p.arbF);
    antiRoll('wheel_RL', 'wheel_RR', p.arbR);
    for (const w of this.wheels) {
      w.load = 0;
      if (!w.contact) continue;
      const k = w.front ? p.springF : p.springR;
      const vComp = (w.compression - w.prevCompression) / dt;
      const damp = vComp > 0 ? p.damperBump : p.damperRebound;
      let F = k * w.compression + damp * vComp + w.arb + (w.bump || 0);
      F = Math.max(0, F);
      // only the component along the contact normal supports the car
      const ndot = Math.max(0.2, w.contactNormal.dot(up));
      w.load = F * ndot;
      impulses.push([up.clone().multiplyScalar(F * dt), w.contactPoint.clone().addScaledVector(up, 0.05)]);
    }

    // ---- tyres + drivetrain (sub-stepped) ----
    const mu0 = this.gripScale;
    const tyre = p.tyre;
    const nSub = 6;
    const h = dt / nSub;
    // contact frames
    for (const w of this.wheels) {
      if (!w.contact) {
        w.vLong = 0;
        w.vLat = 0;
        continue;
      }
      const n = w.contactNormal;
      const wf = fwd.clone().applyAxisAngle(up, w.steerAngle);
      w.f = wf.addScaledVector(n, -wf.dot(n)).normalize();
      w.s = new THREE.Vector3().crossVectors(n, w.f).normalize(); // points to car +X side (left)
      const rp = w.contactPoint.clone().sub(comWorld);
      const vel = linvel.clone().add(new THREE.Vector3().crossVectors(angvel, rp));
      w.vLong = vel.dot(w.f);
      w.vLat = vel.dot(w.s);
    }
    const ratio = this.gearRatio() * p.finalDrive;
    const driven = this.wheels.filter((w) => w.drive && w.installed);
    // automatic clutch
    const engaged = this.gear !== 1 && this.shiftTimer <= 0;
    const engRpm = this.engine.rpm;
    let clutchTarget;
    if (!engaged || !this.engineInstalled) clutchTarget = 0;
    else {
      const wheelRpm = driven.length ? (Math.abs(driven.reduce((a, w) => a + w.omega, 0) / driven.length) * Math.abs(ratio) * 60) / (2 * Math.PI) : 0;
      if (wheelRpm > p.idleRpm + 250) clutchTarget = 1;
      else clutchTarget = Math.min(1, Math.max(0, (engRpm - 1000) / 900)) * (c.throttle > 0.02 || wheelRpm > 300 ? 1 : 0);
      if (!this.engine.running) clutchTarget = c.throttle > 0 ? 1 : 0; // push-start / engine braking off
    }
    this.clutch += (clutchTarget - this.clutch) * Math.min(1, dt * 8);
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);

    const fx = new Map(),
      fy = new Map();
    for (const w of this.wheels) {
      fx.set(w, 0);
      fy.set(w, 0);
    }
    for (let sI = 0; sI < nSub; sI++) {
      // engine torque
      const e = this.engine;
      const rpm = (e.omega * 60) / (2 * Math.PI);
      let throttle = c.throttle;
      if (e.running && rpm < p.idleRpm) throttle = Math.max(throttle, Math.min(1, (p.idleRpm - rpm) / 300) * 0.35);
      if (rpm > p.redline) throttle = 0; // limiter
      // traction control: trim throttle when the driven wheels spin up
      if (this.tcs && driven.length && this.gear !== 1) {
        const slipMax = Math.max(...driven.map((w) => (w.contact ? Math.abs(w.slipRatio) : 0)));
        const cut = Math.min(1, Math.max(0, (slipMax - 0.18) / 0.25));
        this.tcsCut = (this.tcsCut || 0) + (cut - (this.tcsCut || 0)) * 0.2;
        throttle *= 1 - 0.85 * this.tcsCut;
      }
      const Te = e.running && this.engineInstalled ? torqueAt(Math.max(rpm, 500)) * throttle * this.powerScale : 0;
      // the torque curve is net at the flywheel; internal friction shows up as engine braking off-throttle
      const Tf = (p.engineFriction * Math.max(rpm, 0) + (e.running ? 8 : 18) * (rpm > 50 ? 1 : 0)) * (e.running ? 1 - throttle * 0.95 : 1);
      e.torqueOut = Te;
      // clutch coupling
      const wOmega = driven.length ? driven.reduce((a, w) => a + w.omega, 0) / driven.length : 0;
      const transOmega = wOmega * ratio;
      let Tc = 0;
      if (this.clutch > 0.001 && ratio !== 0) {
        const cap = p.clutchMaxTorque * this.clutch;
        // implicit-ish: torque needed to equalise speeds this substep, clamped by capacity
        const Ieq = 1 / (1 / p.engineInertia + (ratio * ratio) / Math.max(0.5, driven.length * p.wheelInertia));
        const need = ((e.omega - transOmega) * Ieq) / h;
        Tc = Math.max(-cap, Math.min(cap, need));
      }
      e.omega += ((Te - Tf - Tc) / p.engineInertia) * h;
      if (!e.running && e.omega < 0) e.omega = 0;
      if (e.omega < 0) e.omega = 0;
      // wheels
      for (const w of this.wheels) {
        if (!w.installed) continue;
        let Tdrive = 0;
        if (w.drive && driven.length) Tdrive = (Tc * ratio * p.driveEfficiency) / driven.length;
        let Tbrake = c.brake * p.brakeTorque * (w.front ? 1 : 0.6);
        let Fx = 0,
          Fy = 0;
        if (w.contact && w.load > 0) {
          const surf = this.surfaces(w.surface);
          const mu = surf.mu * mu0 * (1 - this.wet * (1 - surf.wetMu / surf.mu)) * (w.flat ? 0.55 : 1) * (0.75 + 0.25 * w.tyreCondition);
          const Fz = w.load;
          const loadSens = 1 - 0.08 * (Fz / 3000 - 1);
          const D = mu * Fz * loadSens;
          const vRef = Math.max(Math.abs(w.vLong), 1.5);
          const slip = (w.omega * p.wheelRadius - w.vLong) / vRef;
          const alpha = Math.atan2(w.vLat, Math.max(Math.abs(w.vLong), 2.5));
          w.slipRatio = slip;
          w.slipAngle = alpha;
          // combined slip (normalised)
          const sx = slip / tyre.peakSlip;
          const sy = Math.tan(alpha) / Math.tan(tyre.peakAngle);
          const sl = Math.hypot(sx, sy);
          if (sl > 1e-6) {
            const fLong = magic(sl * tyre.peakSlip, tyre.longB, tyre.longC, tyre.longE);
            const fLat = magic(sl * tyre.peakAngle, tyre.latB, tyre.latC, tyre.latE);
            Fx = D * fLong * (sx / sl);
            Fy = -D * fLat * (sy / sl) * 1.0;
          }
          // rolling resistance
          Fx -= Math.sign(w.vLong) * Math.min(Math.abs(w.vLong) * 2, 1) * surf.roll * Fz;
          w.skid = Math.max(0, Math.min(1, (sl - 1.2) / 2.5)) * Math.min(1, Math.hypot(w.vLong, w.vLat) / 3);
          // local longitudinal stiffness dFx/domega for the semi-implicit spin update
          w.kLong = D * tyre.longB * tyre.longC * (p.wheelRadius / vRef) * Math.max(0.05, 1 - Math.min(1, Math.abs(sx)));
          // ABS: release brake pressure when the wheel starts to lock
          w.abs = (w.abs ?? 1) + ((slip < -0.16 && Math.abs(w.vLong) > 2 ? 0.25 : 1) - (w.abs ?? 1)) * 0.35;
        } else {
          w.slipRatio = 0;
          w.slipAngle = 0;
          w.skid = 0;
          w.kLong = 0;
        }
        Tbrake *= w.abs ?? 1;
        if (!w.front) Tbrake = Math.max(Tbrake, c.handbrake * p.handbrakeTorque);
        // semi-implicit spin integration (tyre force linearised in omega), brake as an implicit stop
        const a = (h / p.wheelInertia) * p.wheelRadius * w.kLong;
        const omega0 = w.omega;
        let omega = (omega0 + (h / p.wheelInertia) * (Tdrive - Fx * p.wheelRadius) + a * omega0) / (1 + a);
        const brakeDw = (Tbrake / p.wheelInertia) * h;
        if (Math.abs(omega) <= brakeDw) omega = 0;
        else omega -= Math.sign(omega) * brakeDw;
        Fx += w.kLong * (omega - omega0);
        w.omega = omega;
        fx.set(w, fx.get(w) + Fx / nSub);
        fy.set(w, fy.get(w) + Fy / nSub);
      }
      e.rpm = (e.omega * 60) / (2 * Math.PI);
    }
    // stall
    if (this.engine.running && this.engine.rpm < 380) {
      this.engine.stallTimer += dt;
      if (this.engine.stallTimer > 0.25) {
        this.engine.running = false;
        this.onStall && this.onStall();
      }
    } else this.engine.stallTimer = 0;

    // apply tyre forces
    for (const w of this.wheels) {
      if (!w.contact) continue;
      let Fx = fx.get(w),
        Fy = fy.get(w);
      // low speed static friction: kill creeping when nearly stopped
      const vAbs = Math.hypot(w.vLong, w.vLat);
      if (vAbs < 0.6 && Math.abs(c.throttle) < 0.05) {
        const holdLat = (-w.vLat * this.mass) / 4 / dt;
        const maxF = w.load * 0.9;
        Fy = Math.max(-maxF, Math.min(maxF, holdLat * 0.6));
        if (c.brake > 0.1 || c.handbrake > 0.1 || (this.gear === 1 && vAbs < 0.15)) {
          const holdLong = (-w.vLong * this.mass) / 4 / dt;
          Fx = Math.max(-maxF, Math.min(maxF, holdLong * 0.6));
        }
      }
      w.longForce = Fx;
      w.latForce = Fy;
      const F = w.f.clone().multiplyScalar(Fx).addScaledVector(w.s, Fy);
      // apply slightly above the contact point (reduces roll jacking from the tyre model)
      const at = w.contactPoint.clone().addScaledVector(up, 0.08);
      impulses.push([F.multiplyScalar(dt), at]);
    }
    // aerodynamic drag
    const v2 = linvel.lengthSq();
    if (v2 > 0.01) {
      const drag = linvel.clone().normalize().multiplyScalar(-this.p.drag * v2 * dt);
      impulses.push([drag, comWorld.clone().addScaledVector(up, 0.1)]);
    }
    for (const [imp, at] of impulses) body.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: at.x, y: at.y, z: at.z }, true);

    // wheel visual spin
    for (const w of this.wheels) {
      if (!w.contact && Math.abs(w.omega) > 0) w.omega *= 0.995;
      w.spin += w.omega * dt;
    }

    // automatic gearbox
    if (this.automatic && this.engine.running) this.autoShift(dt);
    const lv2 = body.linvel();
    this.lastLinvel.set(lv2.x, lv2.y, lv2.z);
    this.lastDt = dt;
  }

  postStep() {
    const lv = this.body.linvel();
    const v = new THREE.Vector3(lv.x, lv.y, lv.z);
    const dv = v.clone().sub(this.lastLinvel);
    dv.y += 9.81 * (this.lastDt || 1 / 120); // remove gravity
    const mag = dv.length();
    if (mag > 0.9) {
      this.impact = { dv: mag, dir: dv.clone().normalize(), time: performance.now() };
      this.onImpact && this.onImpact(this.impact);
    }
  }

  autoShift(dt) {
    if (this.shiftTimer > 0) return;
    const rpm = this.engine.rpm;
    const c = this.controls;
    if (this.gear === 1) {
      // neutral -> first when throttle applied
      if (c.throttle > 0.05) this.gear = 2;
      return;
    }
    if (this.gear === 0) return; // reverse handled by controller
    const top = this.p.gears.length - 1;
    const upRpm = 2600 + 2800 * c.throttle;
    if (rpm > upRpm && this.gear < top && this.clutch > 0.9) this.shift(1);
    else if (rpm < 1400 + 600 * c.throttle && this.gear > 2) this.shift(-1);
  }

  surfaces(name) {
    return SURFACES[name] || SURFACES.asphalt;
  }

  // Interpolated visual state of each wheel (in car-local space): centre y offset, steer, spin.
  wheelVisual(w) {
    const c = w.contact ? w.compression : Math.max(0, w.compression);
    return { y: this.topY - this.p.restLength + c, steer: w.steerAngle, spin: w.spin };
  }

  startEngine() {
    this.engine.running = true;
    this.engine.omega = Math.max(this.engine.omega, (this.p.idleRpm * 2 * Math.PI) / 60);
  }

  stopEngine() {
    this.engine.running = false;
  }
}

export { torqueAt };
