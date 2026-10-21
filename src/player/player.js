// First-person player: kinematic character controller, seated mode, needs and damage.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { input } from '../core/input.js';
import { settings } from '../core/settings.js';
import { clamp, lerp } from '../core/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const RADIUS = 0.3;
const HALF = 0.6; // capsule half height (cylinder part)
const EYE = 1.64;

export class Player {
  constructor(game, pos) {
    this.game = game;
    const ph = game.physics;
    this.body = ph.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + HALF + RADIUS, pos.z));
    this.collider = ph.world.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS).setCollisionGroups(GROUPS.player).setFriction(0), this.body);
    ph.setOwner(this.collider, { kind: 'player', player: this });
    this.cc = ph.world.createCharacterController(0.02);
    this.cc.enableAutostep(0.38, 0.15, false);
    this.cc.enableSnapToGround(0.4);
    this.cc.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    this.cc.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(80);
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.grounded = false;
    this.crouch = 0;
    this.bob = 0;
    this.bobAmp = 0;
    this.velocity = new THREE.Vector3();
    this.seat = null;
    this.seatYaw = 0;
    this.seatPitch = 0;
    this.eye = new THREE.Vector3();
    this.lookDir = new THREE.Vector3(0, 0, 1);
    // needs
    this.health = 100;
    this.food = 85;
    this.water = 80;
    this.energy = 90;
    // body warmth 0..100 (comfortable above ~60) and how soaked the clothes are 0..1
    this.warmth = 80;
    this.wet = 0;
    this.shelterT = 0;
    this.stamina = 100;
    this.bleeding = 0;
    this.dead = false;
    this.damageFlash = 0;
    this.fallStartY = null;
    this.stepAcc = 0;
    this.headlamp = new THREE.SpotLight(0xfff0d8, 0, 26, 0.55, 0.6, 1.6);
    game.scene.add(this.headlamp, this.headlamp.target);
    game.lights.add(this.headlamp);
    this.headlampOn = false;
    this.lastSurface = 'dirt';
    this.carryMass = 0;
  }

  get position() {
    const t = this.body.translation();
    return V(t.x, t.y - HALF - RADIUS, t.z);
  }

  setPosition(p) {
    this.body.setTranslation({ x: p.x, y: p.y + HALF + RADIUS, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + HALF + RADIUS, z: p.z });
    this.vy = 0;
    this.fallStartY = null;
  }

  // ------------------------------------------------------------------ seats
  enterSeat(car, seat) {
    this.seat = seat;
    this.car = car;
    car.owned = true;
    this.seatYaw = 0;
    this.seatPitch = -0.08;
    this.collider.setEnabled(false);
    car.updateMass();
  }

  exitSeat() {
    const car = this.car;
    if (!car) return false;
    const s = car.type.SEATS[this.seat];
    // find a free spot beside the door
    const candidates = [s.exit, s.exit.clone().setX(-s.exit.x), V(0, 0, 3.2), V(0, 0, -3.4), V(0, 2.0, 0)];
    for (const c of candidates) {
      const wp = c.clone().add(V(0, 0.1, 0)).applyMatrix4(car.root.matrixWorld);
      const ground = this.game.groundHeightAt(wp.x, wp.z, wp.y + 2.5);
      const p = V(wp.x, Math.max(ground, wp.y - 1.5), wp.z);
      if (this.isFree(p)) {
        const door = s.door;
        if (car.isInstalled(door) && car.model.parts[door].openT < 0.5) car.toggleOpen(door);
        this.seat = null;
        this.car = null;
        this.collider.setEnabled(true);
        this.setPosition(p);
        const cv = car.dyn.body.linvel();
        const sp = Math.hypot(cv.x, cv.z);
        this.velocity.set(cv.x * 0.8, 0, cv.z * 0.8);
        if (sp > 4) {
          this.vy = 1.5;
          this.grounded = false;
          this.damage((sp - 4) * (sp - 4) * 0.55, 'fall');
        }
        const e = new THREE.Euler().setFromQuaternion(car.root.quaternion, 'YXZ');
        this.yaw = e.y + (c.x > 0 ? Math.PI / 2 : c.x < 0 ? -Math.PI / 2 : 0);
        this.pitch = 0;
        car.updateMass();
        return true;
      }
    }
    return false;
  }

  isFree(p) {
    const shape = new RAPIER.Capsule(HALF, RADIUS);
    let hit = false;
    this.game.physics.world.intersectionsWithShape(
      { x: p.x, y: p.y + HALF + RADIUS + 0.02, z: p.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      () => {
        hit = true;
        return false;
      },
      undefined,
      GROUPS.playerQuery,
      this.collider
    );
    return !hit;
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    if (this.dead) return;
    const sens = 0.0022 * settings.data.sensitivity;
    const inv = settings.data.invertY ? -1 : 1;
    const look = !this.game.ui || !this.game.ui.blocksLook;
    const rotating = this.game.interaction && this.game.interaction.rotating;
    if (look && !rotating) {
      if (this.seat) {
        this.seatYaw = clamp(this.seatYaw - input.mouse.dx * sens, -2.3, 2.3);
        this.seatPitch = clamp(this.seatPitch - input.mouse.dy * sens * inv, -1.2, 1.0);
      } else {
        this.yaw -= input.mouse.dx * sens;
        this.pitch = clamp(this.pitch - input.mouse.dy * sens * inv, -1.5, 1.5);
      }
    }
    if (this.seat) this.updateSeated(dt);
    else this.updateOnFoot(dt);
    this.updateNeeds(dt);
  }

  updateOnFoot(dt) {
    const g = this.game;
    const canMove = !g.ui || !g.ui.blocksMove;
    let fx = 0,
      fz = 0;
    if (canMove) {
      if (input.isDown('forward')) fz += 1;
      if (input.isDown('back')) fz -= 1;
      if (input.isDown('left')) fx += 1;
      if (input.isDown('right')) fx -= 1;
    }
    const crouching = canMove && input.isDown('crouch');
    this.crouch = lerp(this.crouch, crouching ? 1 : 0, Math.min(1, dt * 10));
    const moving = fx !== 0 || fz !== 0;
    let speed = 3.1;
    const wantSprint = canMove && input.isDown('sprint') && fz > 0 && !crouching;
    if (wantSprint && this.stamina > 2) {
      speed = 5.8;
      this.stamina = Math.max(0, this.stamina - dt * 14);
    } else this.stamina = Math.min(100, this.stamina + dt * (moving ? 8 : 16));
    if (crouching) speed = 1.6;
    // carrying heavy things slows you down
    const m = this.carryMass;
    if (m > 12) speed *= clamp(1 - (m - 12) / 160, 0.35, 1);
    if (this.health < 25) speed *= 0.75;
    if (this.energy < 10) speed *= 0.8;
    const l = Math.hypot(fx, fz) || 1;
    const sin = Math.sin(this.yaw),
      cos = Math.cos(this.yaw);
    const dirX = (fx * cos + fz * sin) / l,
      dirZ = (-fx * sin + fz * cos) / l;
    const target = V(dirX * speed, 0, dirZ * speed);
    const accel = this.grounded ? 14 : 2.5;
    this.velocity.x = lerp(this.velocity.x, moving ? target.x : 0, Math.min(1, dt * accel));
    this.velocity.z = lerp(this.velocity.z, moving ? target.z : 0, Math.min(1, dt * accel));
    // gravity / jump
    if (this.grounded) {
      this.vy = -1.0;
      if (canMove && input.wasPressed('jump') && this.stamina > 8 && m < 40) {
        this.vy = 4.6;
        this.stamina -= 8;
        this.grounded = false;
      }
    } else this.vy -= 9.81 * dt;
    const desired = { x: this.velocity.x * dt, y: this.vy * dt, z: this.velocity.z * dt };
    this.cc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, GROUPS.playerQuery);
    const mv = this.cc.computedMovement();
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);
    this.body.setTranslation(next, true);
    const wasGrounded = this.grounded;
    this.grounded = this.cc.computedGrounded();
    // fall damage
    if (!this.grounded) {
      if (this.fallStartY === null) this.fallStartY = next.y;
      this.fallStartY = Math.max(this.fallStartY, next.y);
    } else if (!wasGrounded && this.fallStartY !== null) {
      const h = this.fallStartY - next.y;
      if (h > 3.2) this.damage((h - 3.2) * 18, 'fall');
      if (h > 0.6) g.audio && g.audio.play('land', { volume: clamp(h / 3, 0.2, 1) });
      this.fallStartY = null;
    }
    if (this.grounded && mv.y > -0.0001 && this.vy > 0) this.vy = 0;
    // safety: never fall through the world
    const gy = g.groundHeightAt(next.x, next.z, next.y + 1);
    if (next.y - HALF - RADIUS < gy - 1.5) this.setPosition(V(next.x, gy + 0.2, next.z));
    this.carContact(dt);
    // footsteps & head bob
    const hs = Math.hypot(mv.x, mv.z) / Math.max(dt, 1e-4);
    if (this.grounded && hs > 0.5) {
      this.bob += dt * hs * 2.1;
      this.bobAmp = lerp(this.bobAmp, Math.min(1, hs / 5), dt * 6);
      this.stepAcc += hs * dt;
      const stride = hs > 4.5 ? 1.55 : 1.15;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        const p = this.position;
        const surf = g.surfaceUnder(p);
        this.lastSurface = surf;
        g.audio && g.audio.play('step', { surface: surf, volume: crouching ? 0.35 : hs > 4.5 ? 1 : 0.7 });
        // loose ground kicks up a little dust, more when running
        if (g.effects && (surf === 'sand' || surf === 'dirt' || surf === 'gravel') && !crouching) g.effects.footDust(V(p.x, p.y + 0.05, p.z), hs > 4.5 ? 1 : 0.45);
      }
    } else this.bobAmp = lerp(this.bobAmp, 0, dt * 6);
  }

  // A moving car meeting the player: push the player clear of its footprint and hurt them in
  // proportion to the closing speed. (The capsule itself does not collide with the car.)
  carContact(dt) {
    for (const car of this.game.fleet ? this.game.fleet.cars : []) if (car.active !== false) this.carContactWith(car, dt);
  }

  carContactWith(car, dt) {
    const g = this.game;
    if (!car || !car.dyn) return;
    const pos = this.position;
    const cp = car.root.position;
    const dx = pos.x - cp.x,
      dz = pos.z - cp.z;
    if (dx * dx + dz * dz > 16) return;
    const inv = car.root.matrixWorld.clone().invert();
    const l = V(pos.x, pos.y + 0.9, pos.z).applyMatrix4(inv);
    const sp = car.type.SPEC;
    const hx = sp.halfWidth + 0.1 + RADIUS,
      hz = (sp.frontTip - sp.rearTip) / 2 + RADIUS;
    l.z -= (sp.frontTip + sp.rearTip) / 2; // footprint centre
    if (Math.abs(l.x) > hx || Math.abs(l.z) > hz || l.y < -0.4 || l.y > 1.9) return;
    // standing on the roof / hood: let the controller handle it
    if (pos.y > car.root.position.y + 1.25) return;
    const v = car.dyn.body.linvel();
    const vRel = Math.hypot(v.x - this.velocity.x, v.z - this.velocity.z);
    // push out along the shallowest side
    const px = hx - Math.abs(l.x),
      pz = hz - Math.abs(l.z);
    // a moving car shoves people aside (never carries them on the bumper)
    const moving = Math.hypot(v.x, v.z) > 1;
    const out = px < pz || moving ? V((Math.sign(l.x) || 1) * (px + 0.02), 0, 0) : V(0, 0, Math.sign(l.z) * (pz + 0.02));
    out.applyQuaternion(car.root.quaternion);
    const np = { x: pos.x + out.x, y: pos.y, z: pos.z + out.z };
    if (this.isFree(np)) this.setPosition(np);
    // carried along with the car's velocity, knocked off the ground when hit fast
    this.velocity.x = v.x;
    this.velocity.z = v.z;
    if (vRel > 3) {
      if (!this._carHitT || g.time - this._carHitT > 0.6) {
        this._carHitT = g.time;
        this.damage((vRel - 3) * (vRel - 3) * 1.1 + 4, 'crash');
        this.vy = Math.min(6, 1.5 + vRel * 0.25);
        this.grounded = false;
        // thrown clear to the side rather than carried on the bumper
        const side = V(1, 0, 0).applyQuaternion(car.root.quaternion).multiplyScalar(Math.sign(l.x || 1) * (2 + vRel * 0.35));
        this.velocity.x += side.x;
        this.velocity.z += side.z;
        g.audio && g.audio.play(vRel > 9 ? 'crashHeavy' : 'hitFlesh', { at: pos, volume: Math.min(1, vRel / 12) });
        g.effects && g.effects.bloodHit && vRel > 8 && g.effects.bloodHit(V(pos.x, pos.y + 1, pos.z), V(v.x, 0, v.z).normalize(), 1);
        // the car feels the impact too
        car.dyn.body.applyImpulse({ x: -v.x * 40, y: 0, z: -v.z * 40 }, true);
      }
    }
  }

  updateSeated(dt) {
    const car = this.car;
    if (!car) return;
    const t = car.seatWorld(this.seat);
    const p = { x: t.x, y: t.y - EYE + 0.0, z: t.z };
    // keep the (disabled) capsule with the car so queries make sense
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + HALF + RADIUS, z: p.z });
    this.body.setTranslation({ x: p.x, y: p.y + HALF + RADIUS, z: p.z }, true);
    // crash injuries
    if (car.lastImpact && car.lastImpact.time !== this._lastImpactSeen) {
      this._lastImpactSeen = car.lastImpact.time;
      const s = car.lastImpact.severity;
      if (s > 7) this.damage((s - 7) * 7, 'crash');
    }
  }

  updateCamera(dt) {
    // `eye` is the first-person view used for aiming, reach and the viewmodel; the rendered
    // camera either copies it or orbits behind the body (third person).
    const g = this.game;
    const cam = g.eyeCam;
    if (input.wasPressed('view') && !(g.ui && g.ui.blocksMove)) this.thirdPerson = !this.thirdPerson;
    if (this.seat && this.car) {
      const car = this.car;
      const seatPos = car.seatWorld(this.seat);
      cam.position.copy(seatPos);
      const q = car.root.quaternion.clone();
      const e = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.seatPitch, this.seatYaw + Math.PI, 0, 'YXZ'));
      // car faces +z; camera looks down -z, so add PI
      cam.quaternion.copy(q).multiply(e);
      // look back key
      if (input.isDown('lookBack')) cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, 0, 0, 'YXZ')));
    } else if (this.dead) {
      // collapse: the view drops to the ground and rolls
      this.deathT = Math.min(1, (this.deathT || 0) + dt * 1.4);
      const t = this.deathT * this.deathT;
      const p = this.position;
      cam.position.set(p.x, p.y + lerp(EYE, 0.22, t), p.z);
      cam.quaternion.setFromEuler(new THREE.Euler(lerp(this.pitch, -0.15, t), this.yaw + Math.PI, t * 1.1, 'YXZ'));
    } else {
      const p = this.position;
      const eyeH = lerp(EYE, 1.05, this.crouch);
      const bob = settings.data.headBob ? Math.sin(this.bob * 2) * 0.035 * this.bobAmp : 0;
      const sway = settings.data.headBob ? Math.cos(this.bob) * 0.025 * this.bobAmp : 0;
      // shivering when cold
      const shiver = this.warmth < 30 ? (30 - this.warmth) / 30 : 0;
      const sh = shiver ? Math.sin(performance.now() * 0.06) * 0.004 * shiver : 0;
      cam.position.set(p.x + sh, p.y + eyeH + bob, p.z);
      cam.quaternion.setFromEuler(new THREE.Euler(this.pitch + sh * 0.8, this.yaw + Math.PI, sway * 0.4, 'YXZ'));
      const right = V(1, 0, 0).applyQuaternion(cam.quaternion);
      cam.position.addScaledVector(right, sway);
    }
    cam.updateMatrixWorld();
    this.eye.copy(cam.position);
    this.lookDir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.applyView(dt);
    // headlamp
    this.headlamp.intensity = this.headlampOn ? 9 : 0;
    this.headlamp.position.copy(cam.position).add(V(0, -0.08, 0));
    this.headlamp.target.position.copy(cam.position).addScaledVector(this.lookDir, 10);
  }

  // Rendered camera: first person = the eye; third person = orbit behind the body / car,
  // pulled in front of anything solid between it and the character.
  applyView(dt) {
    const g = this.game;
    const eye = g.eyeCam;
    const cam = g.renderer.camera;
    const avatar = g.npcs && g.npcs.ensureAvatar();
    const third = this.thirdPerson && avatar && !this.dead;
    this.tpBlend = lerp(this.tpBlend || 0, third ? 1 : 0, Math.min(1, dt * 8));
    if (avatar) {
      avatar.root.visible = this.tpBlend > 0.05 || !!(g.remoteView);
      if (avatar.root.visible) avatar.sync(dt, this);
    }
    if (g.interaction) g.interaction.viewRoot.visible = this.tpBlend < 0.5;
    if (this.tpBlend < 0.001) {
      cam.position.copy(eye.position);
      cam.quaternion.copy(eye.quaternion);
      return;
    }
    let pivot, dist;
    if (this.seat && this.car) {
      pivot = this.car.root.position.clone().add(V(0, 1.2, 0));
      dist = 6.5;
    } else {
      pivot = this.position.clone().add(V(0, 1.62 - this.crouch * 0.5, 0));
      dist = 2.3;
    }
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.seat ? this.seatPitch - 0.18 : this.pitch, this.seat ? new THREE.Euler().setFromQuaternion(this.car.root.quaternion, 'YXZ').y + this.seatYaw + Math.PI : this.yaw + Math.PI, 0, 'YXZ'));
    const back = V(0, 0, 1).applyQuaternion(q);
    const shoulder = this.seat ? V(0, 0, 0) : V(0.5, 0, 0).applyQuaternion(q);
    const origin = pivot.clone().add(shoulder);
    const hit = g.physics.raycast(origin, back, dist + 0.3, GROUPS.look, this.body, (c) => {
      const o = g.physics.ownerOf(c);
      return !(this.seat && o && o.kind === 'car');
    });
    const d = hit ? Math.max(0.4, hit.distance - 0.3) : dist;
    this.tpDist = Math.min(d, lerp(this.tpDist || d, d, Math.min(1, dt * 5)));
    const tp = origin.clone().addScaledVector(back, this.tpDist);
    cam.position.copy(eye.position).lerp(tp, this.tpBlend);
    cam.quaternion.copy(eye.quaternion).slerp(q, this.tpBlend);
  }

  // ------------------------------------------------------------------ needs
  updateNeeds(dt) {
    const g = this.game;
    const diff = g.difficulty || { hunger: 1, thirst: 1 };
    const hours = g.gameHoursDelta || 0;
    const env = g.env;
    const heat = env ? env.daylight * (1 - env.w.overcast * 0.6) : 0.5;
    const exertion = this.seat ? 0.6 : 1 + Math.hypot(this.velocity.x, this.velocity.z) / 6;
    this.food = Math.max(0, this.food - hours * 2.4 * diff.hunger * exertion);
    this.water = Math.max(0, this.water - hours * (3.4 + heat * 2.2) * diff.thirst * exertion);
    this.energy = Math.max(0, this.energy - hours * 2.6 * exertion * (diff.fatigue || 1));
    if (this.food <= 0) this.damage(hours * 6, 'starvation', true);
    if (this.water <= 0) this.damage(hours * 10, 'dehydration', true);
    if (this.energy <= 0) this.damage(hours * 2, 'exhaustion', true);
    if (this.poison > 0) {
      this.damage(this.poison * dt * 0.35, 'venom', true);
      this.poison = Math.max(0, this.poison - dt * 0.004);
    }
    if (this.bleeding > 0) {
      this.damage(this.bleeding * dt * 0.6, 'bleeding', true);
      this.bleeding = Math.max(0, this.bleeding - dt * 0.05);
    }
    this.updateWarmth(dt, hours, diff);
    if (this.food > 45 && this.water > 45 && this.warmth > 35 && this.bleeding <= 0) this.health = Math.min(100, this.health + hours * 4);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);
  }

  // Warmth drifts toward what the air, shelter, a heater or a fire allow. Rain soaks you outdoors;
  // wet clothes chill. Cold makes you shiver and tire, then hurts.
  updateWarmth(dt, hours, diff) {
    const g = this.game;
    const env = g.env;
    if (!env) return;
    // shelter: a roof overhead (checked twice a second) or a car's cabin
    this.shelterT -= dt;
    if (this.shelterT <= 0) {
      this.shelterT = 0.5;
      const p = this.position;
      const hit = !this.seat && g.physics.raycast({ x: p.x, y: p.y + 1.8, z: p.z }, { x: 0, y: 1, z: 0 }, 8, GROUPS.look, this.body);
      const o = hit && g.physics.ownerOf(hit.collider);
      this.indoors = !!(o && o.kind === 'structure');
    }
    let air = env.airTemp();
    this.wrapCooldown = Math.max(0, (this.wrapCooldown || 0) - hours);
    if (this.wrapCooldown > 0) air += 8;
    const car = this.seat && this.car;
    if (car) {
      // a closed cabin keeps the wind off; a warm engine runs the heater
      air = air + 6;
      if (car.dyn.engine.running && car.engineTemp > 55) air = Math.max(air, 22);
    } else if (this.indoors) air = air + 7;
    // asleep under a blanket (in the backpack or the car): snug whatever the night does
    if (g.sleepHours > 0 && this.hasBlanket()) air = Math.max(air, 18);
    // fires and lamps close by
    const fire = g.campfires ? g.campfires.heatAt(this.position) : 0;
    air += fire;
    const sheltered = !!car || this.indoors;
    if (!sheltered && env.w.rain > 0.05) this.wet = Math.min(1, this.wet + dt * 0.012 * env.w.rain);
    else this.wet = Math.max(0, this.wet - dt * (0.002 + Math.max(0, air - 10) * 0.0004 + fire * 0.001));
    air -= this.wet * 9;
    const target = clamp((air + 6) * 3.2, 0, 100);
    const rate = target < this.warmth ? 0.006 * (1 + this.wet * 2) * (diff.cold || 1) : 0.012 + fire * 0.004;
    this.warmth += (target - this.warmth) * Math.min(1, dt * rate);
    this.airTemp = air;
    if (this.warmth < 30) this.energy = Math.max(0, this.energy - hours * 2.5);
    if (this.warmth < 12) this.damage(hours * 9, 'hypothermia', true);
    // heat: sun on bare ground dries you out faster
    if (!sheltered && air > 32) this.water = Math.max(0, this.water - hours * (air - 32) * 0.35 * diff.thirst);
  }

  hasBlanket() {
    const g = this.game;
    const inBag = g.inventory && g.inventory.slots.some((e) => e && e.id === 'blanket');
    const st = this.car && this.car.storage;
    const inCar = st && Object.values(st).some((c) => c.slots && c.slots.some((e) => e && e.id === 'blanket'));
    return !!(inBag || inCar || (g.interaction && g.interaction.held && g.interaction.held.id === 'blanket'));
  }

  damage(amount, cause, silent = false) {
    if (this.dead || amount <= 0) return;
    const diff = this.game.difficulty || { damage: 1 };
    this.health -= amount * (diff.playerDamage || 1);
    if (!silent) {
      this.damageFlash = Math.min(1, this.damageFlash + amount / 30 + 0.2);
      this.game.audio && this.game.audio.play('hurt');
    }
    this.lastDamageCause = cause;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.game.onPlayerDeath && this.game.onPlayerDeath(cause);
    }
  }

  // shoved by an attacker
  knock(v) {
    if (this.seat) return;
    this.velocity.x += v.x;
    this.velocity.z += v.z;
    this.vy = Math.max(this.vy, 1.2);
    this.grounded = false;
  }

  // eat / drink / heal
  consume({ food = 0, water = 0, health = 0, energy = 0, bleeding = 0, warmth = 0, poison = 0 } = {}) {
    if (poison) this.poison = Math.max(0, (this.poison || 0) - poison);
    this.warmth = clamp(this.warmth + warmth, 0, 100);
    this.food = clamp(this.food + food, 0, 100);
    this.water = clamp(this.water + water, 0, 100);
    this.health = clamp(this.health + health, 0, 100);
    this.energy = clamp(this.energy + energy, 0, 100);
    if (bleeding) this.bleeding = Math.max(0, this.bleeding - bleeding);
  }
}
