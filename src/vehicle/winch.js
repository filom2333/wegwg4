// Winch: a bull bar with an electric winch drum on a car's nose. Pull the cable out, walk it to a
// tree, a rock, a building, a wreck or another car and hook it on, then wind in: from the
// driver's seat (hold the winch key) or standing at the drum (hold LMB). The cable pulls the car
// toward the anchor, and a car or trailer on the other end toward this one, with up to ~18 kN; it
// sags when slack, the motor whines and draws on the battery, and it stalls under too much load.

import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const CABLE_MAX = 32; // m of cable on the drum
const MAX_FORCE = 18000; // N
const STIFF = 60000; // N per metre of stretch
const SEGMENTS = 14;

const _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _q = new THREE.Quaternion();

// Labels for what the hook can go round.
export function anchorLabel(owner) {
  if (!owner) return null;
  if (owner.kind === 'scenery') return owner.surface === 'rock' ? 'the rock' : 'the tree';
  if (owner.kind === 'structure') return 'the building';
  if (owner.kind === 'wreck') return 'the wreck';
  if (owner.kind === 'car') return 'the car';
  if (owner.kind === 'trailer') return 'the trailer';
  return null;
}

export class Winches {
  constructor(game) {
    this.game = game;
    this.cable = null; // one cable out at a time (the player's)
    this.group = new THREE.Group();
    this.group.name = 'winch';
    game.worldGroup.add(this.group);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.8, roughness: 0.45 });
    const geo = new THREE.CylinderGeometry(0.0065, 0.0065, 1, 6).translate(0, 0.5, 0);
    this.segs = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.visible = false;
      this.group.add(m);
      this.segs.push(m);
    }
    const hookMat = new THREE.MeshStandardMaterial({ color: 0x8a8f94, metalness: 0.9, roughness: 0.35 });
    this.hook = new THREE.Group();
    const h1 = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 14, Math.PI * 1.4), hookMat);
    h1.rotation.z = -Math.PI * 0.2;
    h1.position.y = -0.04;
    const h2 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6), hookMat);
    h2.position.y = 0.02;
    this.hook.add(h1, h2);
    this.hook.visible = false;
    this.group.add(this.hook);
    game.physics.beforeStep.push((dt) => this.step(dt));
  }

  // Drum position (scene coords) of a car with a winch bar fitted, or null.
  drumOf(car, out = V(0, 0, 0)) {
    const a = car && car.accessories && car.accessories.front;
    if (!a || a.id !== 'winchBar' || !a.group.userData.drum) return null;
    return out.copy(a.group.userData.drum).applyMatrix4(car.root.matrixWorld);
  }

  hasWinch(car) {
    const a = car && car.accessories && car.accessories.front;
    return !!(a && a.id === 'winchBar');
  }

  // Pull the hook off the drum into the player's hand.
  takeHook(car) {
    this.cable = { car, anchor: null, length: CABLE_MAX, reel: false, tension: 0 };
    this.game.audio && this.game.audio.play('ratchet', { at: this.drumOf(car) });
  }

  // Hook onto what a ray hit: a static thing at a point, or a body (car, trailer) at a point on it.
  attach(hit) {
    const c = this.cable;
    if (!c) return;
    const ph = this.game.physics;
    const body = hit.collider.parent();
    const p = V(hit.point.x, hit.point.y, hit.point.z);
    if (body && body.isDynamic()) {
      const t = body.translation(),
        r = body.rotation();
      _q.set(r.x, r.y, r.z, r.w).invert();
      c.anchor = { body, local: p.clone().sub(V(t.x, t.y, t.z)).applyQuaternion(_q) };
    } else c.anchor = { point: p };
    const d = this.drumOf(c.car, _a);
    c.length = Math.min(CABLE_MAX, d ? d.distanceTo(p) + 0.3 : CABLE_MAX);
    this.game.audio && this.game.audio.play('click', { at: p, volume: 0.8 });
    void ph;
  }

  // Unhook and wind the cable back onto the drum.
  release() {
    if (!this.cable) return;
    const d = this.drumOf(this.cable.car);
    this.cable = null;
    for (const s of this.segs) s.visible = false;
    this.hook.visible = false;
    this.setMotor(0);
    d && this.game.audio && this.game.audio.play('ratchet', { at: d });
  }

  anchorPoint(out) {
    const a = this.cable.anchor;
    if (a.point) return out.copy(a.point);
    const t = a.body.translation(),
      r = a.body.rotation();
    return out.copy(a.local).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(V(t.x, t.y, t.z));
  }

  // Physics: a taut cable pulls the car at its drum toward the anchor (and the anchor back).
  step(dt) {
    const c = this.cable;
    if (!c || !c.anchor) return;
    const car = c.car;
    const body = car.dyn.body;
    if (!body.isEnabled()) return;
    // the drum in world space from the body pose this step
    const a = car.accessories && car.accessories.front;
    if (!a || a.id !== 'winchBar') return this.release();
    const t = body.translation(),
      r = body.rotation();
    const drum = _a.copy(a.group.userData.drum).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(V(t.x, t.y, t.z));
    const anchor = this.anchorPoint(_b);
    const dir = anchor.clone().sub(drum);
    const dist = dir.length();
    if (dist < 1e-3) return;
    dir.divideScalar(dist);
    // winding in shortens the cable unless the motor stalls under the load
    const powered = car.isInstalled('battery') && car.battery > 0.05;
    if (c.reel && powered && c.tension < MAX_FORCE * 0.97) c.length = Math.max(1.2, c.length - 0.45 * dt);
    const stretch = dist - c.length;
    if (stretch <= 0) {
      c.tension = 0;
      return;
    }
    // damped spring along the cable, capped
    const lv = body.linvel();
    const rel = -(lv.x * dir.x + lv.y * dir.y + lv.z * dir.z);
    const F = Math.min(MAX_FORCE, STIFF * stretch + 4000 * Math.max(0, rel));
    c.tension = F;
    const J = F * dt;
    body.applyImpulseAtPoint({ x: dir.x * J, y: dir.y * J, z: dir.z * J }, { x: drum.x, y: drum.y, z: drum.z }, true);
    const ab = c.anchor.body;
    if (ab && ab.isDynamic() && ab.isEnabled()) ab.applyImpulseAtPoint({ x: -dir.x * J, y: -dir.y * J, z: -dir.z * J }, { x: anchor.x, y: anchor.y, z: anchor.z }, true);
  }

  // Per frame: the cable mesh (sagging when slack), the hook, the motor sound and the battery.
  update(dt, handPoint) {
    const c = this.cable;
    if (!c) return;
    const car = c.car;
    const drum = this.drumOf(car, _a);
    if (!drum) return this.release();
    const end = c.anchor ? this.anchorPoint(_b) : _b.copy(handPoint);
    const dist = drum.distanceTo(end);
    // walking off with the hook: the cable runs out
    if (!c.anchor && dist > CABLE_MAX) {
      this.release();
      this.game.hud && this.game.hud.toast('The winch cable has run out: the hook springs back to the drum');
      return;
    }
    const slack = Math.max(0, (c.anchor ? c.length : dist + 0.6) - dist);
    const sag = Math.min(2.5, Math.sqrt(slack * dist) * 0.45);
    let prev = drum.clone();
    for (let i = 1; i <= SEGMENTS; i++) {
      const u = i / SEGMENTS;
      const p = drum.clone().lerp(end, u);
      p.y -= sag * 4 * u * (1 - u);
      const s = this.segs[i - 1];
      s.visible = true;
      s.position.copy(prev);
      const d = p.clone().sub(prev);
      const l = d.length();
      s.scale.set(1, Math.max(0.001, l), 1);
      s.quaternion.setFromUnitVectors(V(0, 1, 0), d.divideScalar(l || 1));
      prev = p;
    }
    this.hook.visible = true;
    this.hook.position.copy(end);
    // the motor
    const reeling = c.reel && c.anchor && car.isInstalled('battery') && car.battery > 0.05;
    if (reeling) car.battery = Math.max(0, car.battery - dt * (0.002 + (c.tension / MAX_FORCE) * 0.004));
    this.setMotor(reeling ? 0.4 + (c.tension / MAX_FORCE) * 0.6 : 0, drum);
  }

  // Motor whine: the starter motor's recording, dropping in pitch as the load comes on.
  setMotor(load, at = null) {
    const au = this.game.audio;
    if (!au || !au.ready) return;
    const ctx = au.ctx;
    if (!this.motor) {
      const src = ctx.createBufferSource();
      src.buffer = au.sample('starter');
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2600;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createPanner();
      p.refDistance = 2;
      src.connect(f).connect(g).connect(p).connect(au.sfx);
      src.start();
      this.motor = { src, g, p };
    }
    const m = this.motor,
      now = ctx.currentTime;
    m.g.gain.setTargetAtTime(load > 0 ? (0.25 + load * 0.2) * au.trim('starter') : 0, now, 0.08);
    m.src.playbackRate.setTargetAtTime(1.3 - load * 0.4, now, 0.1);
    if (at) {
      m.p.positionX.value = at.x;
      m.p.positionY.value = at.y;
      m.p.positionZ.value = at.z;
    }
  }

  rebase(dx, dz) {
    const a = this.cable && this.cable.anchor;
    if (a && a.point) {
      a.point.x -= dx;
      a.point.z -= dz;
    }
  }
}
