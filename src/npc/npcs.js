// NPCs: vagrants, the night creature, coyotes and jackrabbits.
// Meshes are polygonised in a worker; each NPC gets its own skeleton driven by procedural
// gait/idle/attack/death animation, per-bone capsule hitboxes (head zone => headshots) and a
// small state machine. Wildlife and the creature are spawned around the player by biome and
// time of day; vagrants also live at camps and other POIs.

import * as THREE from 'three';
import { RAPIER, GROUPS, G, groups } from '../physics/physics.js';
import { assembleCharacter, DEFINE } from './characters.js';
import { geometryFromArrays, polygonizeArrays } from './sdfMesh.js';
import { mulberry32, clamp, lerp } from '../core/noise.js';
import { initialState } from '../items/itemDefs.js';
import { registerHandArrays, HAND_POSES } from '../player/hands.js';
import { handArrays } from '../player/handShape.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = V(),
  _v2 = V(),
  _q = new THREE.Quaternion(),
  _m = new THREE.Matrix4();
const UP = V(0, 1, 0);
const HITBOX_GROUPS = groups(G.NPC, G.WHEEL_PROBE); // hit by queries only, never pushes bodies
const OBSTACLE = groups(0xffff, G.WORLD | G.CAR);

const TYPES = {
  vagrant: { name: 'Vagrant', hp: 70, walk: 1.25, run: 4.3, turn: 4, reach: 1.45, deathLift: 0.15, seeds: [1, 2, 3], radius: 0.3 },
  creature: { name: 'Pale thing', hp: 150, walk: 1.5, run: 7.2, turn: 6, reach: 1.9, deathLift: 0.12, seeds: [7], radius: 0.35 },
  coyote: { name: 'Coyote', hp: 40, walk: 1.3, run: 9.5, turn: 7, reach: 1.1, deathLift: 0.11, seeds: [5], radius: 0.3 },
  rabbit: { name: 'Jackrabbit', hp: 8, walk: 1.2, run: 9, turn: 9, reach: 0.3, deathLift: 0.06, seeds: [3, 4], radius: 0.12 },
};

const VAGRANT_LOOT = [
  ['cannedBeans', 1],
  ['jerky', 1],
  ['waterBottle', 1.2],
  ['ammo38', 0.6],
  ['bandage', 0.6],
  ['sodaCan', 0.6],
  ['pillBottle', 0.3],
  ['revolver', 0.12],
];

function pick(table, r) {
  let tot = 0;
  for (const [, w] of table) tot += w;
  let x = r() * tot;
  for (const [k, w] of table) {
    x -= w;
    if (x <= 0) return k;
  }
  return table[0][0];
}

const ease = (t) => t * t * (3 - 2 * t);
function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ------------------------------------------------------------------ NPC
export class NPC {
  constructor(mgr, proto, type, pos, opts = {}) {
    this.mgr = mgr;
    this.g = mgr.g;
    this.type = type;
    this.T = TYPES[type];
    this.kind = proto.kind;
    this.proto = proto;
    const inst = assembleCharacter(proto.geo, proto.defs, proto.attachments);
    this.mesh = inst.mesh;
    this.bones = inst.bones;
    this.root = new THREE.Group();
    this.root.add(this.mesh);
    this.root.userData.npc = this;
    this.pos = pos.clone();
    this.root.position.copy(pos);
    this.yaw = opts.yaw ?? Math.random() * Math.PI * 2;
    this.desiredYaw = this.yaw;
    this.speed = 0;
    this.desiredSpeed = 0;
    const diff = this.g.difficulty || { enemies: 1 };
    this.maxHp = this.T.hp * (type === 'creature' || opts.hostile ? 0.85 + 0.15 * diff.enemies : 1);
    this.hp = this.maxHp;
    this.dead = false;
    this.lootable = false;
    this.hostile = !!opts.hostile;
    this.home = opts.home ? opts.home.clone() : pos.clone();
    this.poi = opts.poi || null;
    this.poiIndex = opts.poiIndex ?? -1;
    this.state = opts.state || 'idle';
    this.stateT = Math.random() * 3;
    this.think = Math.random() * 0.3;
    this.target = null;
    this.alert = 0;
    this.cooldown = 0;
    this.seed = opts.seed ?? (Math.random() * 1e9) | 0;
    this.rnd = mulberry32(this.seed);
    this.displayName = type === 'vagrant' ? (this.hostile ? 'Vagrant' : 'Stranger') : this.T.name;
    this.loot = [];
    if (type === 'vagrant') {
      const n = 1 + Math.floor(this.rnd() * 3);
      for (let i = 0; i < n; i++) this.loot.push(pick(VAGRANT_LOOT, this.rnd));
    }
    if (type === 'rabbit') this.loot.push('meat');
    // animation state
    this.anim = { phase: this.rnd() * 6, crouch: 0, attack: -1, attackKind: 0, flinch: V(), death: -1, deathDir: 1, look: V(), lookW: 0, hop: -1, hopLen: 1, hopDur: 0.4, t: this.rnd() * 10, jaw: 0, ear: 0 };
    this.avoid = 0;
    this.avoidT = 0;
    this.probeT = 0;
    this.blocked = 0;
    this.fling = null;
    this.corpseT = 0;
    this.hitT = 0;
    this.lastSeen = -1;
    this.lightFear = 0;
    this.orbit = this.rnd() < 0.5 ? 1 : -1;
    this.hitboxes = [];
    this.buildHitboxes();
    this.ground();
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  get position() {
    return this.pos;
  }

  buildHitboxes() {
    const ph = this.g.physics;
    for (const h of this.proto.hitboxes) {
      const a = V(...h.a),
        b = V(...h.b);
      const len = a.distanceTo(b);
      const desc = len > 1e-4 ? RAPIER.ColliderDesc.capsule(len / 2, h.r) : RAPIER.ColliderDesc.ball(h.r);
      desc.setCollisionGroups(HITBOX_GROUPS).setSolverGroups(HITBOX_GROUPS);
      const col = ph.world.createCollider(desc);
      ph.setOwner(col, { kind: 'npc', npc: this, zone: h.zone });
      const dir = len > 1e-4 ? b.clone().sub(a).normalize() : UP.clone();
      this.hitboxes.push({ col, bone: this.bones[h.bone], mid: a.clone().add(b).multiplyScalar(0.5), q: new THREE.Quaternion().setFromUnitVectors(UP, dir) });
    }
  }

  syncHitboxes() {
    for (const h of this.hitboxes) {
      const bw = h.bone.matrixWorld;
      _v.copy(h.mid).applyMatrix4(bw);
      h.bone.getWorldQuaternion(_q).multiply(h.q);
      h.col.setTranslation({ x: _v.x, y: _v.y, z: _v.z });
      h.col.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    }
  }

  dispose() {
    for (const h of this.hitboxes) this.g.physics.removeCollider(h.col);
    this.hitboxes = [];
    this.root.parent && this.root.parent.remove(this.root);
  }

  // ---------------------------------------------------------------- perception
  playerTarget() {
    const p = this.g.player;
    if (!p || p.dead) return null;
    const inCar = !!p.seat;
    const pos = inCar ? this.g.car.root.position : p.position;
    return { pos, inCar, dist: Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z) };
  }

  canSee(pos, range) {
    const d = Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z);
    if (d > range) return false;
    const eye = _v2.set(this.pos.x, this.pos.y + this.T.radius * 2 + (this.kind === 'human' ? 1.3 : 0.3), this.pos.z);
    const dir = V(pos.x - eye.x, pos.y + 1.0 - eye.y, pos.z - eye.z);
    const l = dir.length();
    dir.divideScalar(l);
    const hit = this.g.physics.raycast(eye, dir, l - 0.6, groups(0xffff, G.WORLD));
    return !hit;
  }

  faceTo(pos) {
    this.desiredYaw = Math.atan2(pos.x - this.pos.x, pos.z - this.pos.z);
  }

  goTo(pos, speed) {
    this.faceTo(pos);
    this.desiredSpeed = speed;
  }

  fleeFrom(pos, speed) {
    this.desiredYaw = Math.atan2(this.pos.x - pos.x, this.pos.z - pos.z) + Math.sin(this.anim.t * 1.7 + this.seed) * 0.5;
    this.desiredSpeed = speed;
  }

  // ---------------------------------------------------------------- AI
  updateAI(dt) {
    this.stateT += dt;
    this.cooldown -= dt;
    const tgt = this.playerTarget();
    const env = this.g.env;
    const night = env.isNight;
    const diff = this.g.difficulty || { enemies: 1 };
    switch (this.type) {
      case 'rabbit':
        return this.aiRabbit(dt, tgt);
      case 'coyote':
        return this.aiCoyote(dt, tgt, night, diff);
      case 'creature':
        return this.aiCreature(dt, tgt, night, diff);
      default:
        return this.aiVagrant(dt, tgt, night, diff);
    }
  }

  wander(dt, radius, speed, pause = [2, 6]) {
    if (this.state !== 'wander' && this.state !== 'idle') {
      this.state = 'idle';
      this.stateT = 0;
    }
    if (this.state === 'idle') {
      this.desiredSpeed = 0;
      if (this.stateT > (this.idleFor ?? 3)) {
        const a = this.rnd() * Math.PI * 2,
          r = this.rnd() * radius;
        this.wanderTo = V(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
        this.state = 'wander';
        this.stateT = 0;
      }
    } else {
      const d = Math.hypot(this.wanderTo.x - this.pos.x, this.wanderTo.z - this.pos.z);
      this.goTo(this.wanderTo, speed);
      if (d < 0.8 || this.stateT > 25 || this.blocked > 1.5) {
        this.state = 'idle';
        this.stateT = 0;
        this.blocked = 0;
        this.idleFor = pause[0] + this.rnd() * (pause[1] - pause[0]);
      }
    }
  }

  aiRabbit(dt, tgt) {
    if (this.state === 'flee') {
      if (this.stateT > 4 && (!tgt || tgt.dist > 30)) {
        this.state = 'idle';
        this.stateT = 0;
      } else if (tgt) this.fleeFrom(tgt.pos, this.T.run);
      else this.desiredSpeed = this.T.run;
      return;
    }
    if (tgt && (tgt.dist < 11 || (tgt.inCar && tgt.dist < 22 && Math.abs(this.g.car.speedKmh) > 20))) {
      this.state = 'flee';
      this.stateT = 0;
      return;
    }
    this.wander(dt, 10, this.T.walk, [1.5, 5]);
  }

  aiCoyote(dt, tgt, night, diff) {
    const aggressive = (night || this.hostile) && tgt && !tgt.inCar;
    if (this.state === 'flee') {
      if (tgt && tgt.dist < 70) this.fleeFrom(tgt.pos, this.T.run * 0.9);
      else {
        this.state = 'idle';
        this.stateT = 0;
      }
      if (this.stateT > 12) this.mgr.despawnLater(this);
      return;
    }
    if (this.hp < this.maxHp * 0.45) {
      this.state = 'flee';
      this.stateT = 0;
      return;
    }
    if (aggressive && tgt.dist < 45 * (0.8 + diff.enemies * 0.2)) {
      if (this.state !== 'chase' && this.state !== 'attack' && this.state !== 'circle') {
        this.state = 'circle';
        this.stateT = 0;
        this.g.audio && this.g.audio.play('growl', { at: this.pos, volume: 0.7 });
      }
      if (this.state === 'circle') {
        // keep ~9 m off and circle, then commit
        const a = Math.atan2(this.pos.x - tgt.pos.x, this.pos.z - tgt.pos.z) + 0.6;
        const p = V(tgt.pos.x + Math.sin(a) * 9, 0, tgt.pos.z + Math.cos(a) * 9);
        this.goTo(p, this.T.run * 0.45);
        if (this.stateT > 2.5 + this.rnd() * 3) {
          this.state = 'chase';
          this.stateT = 0;
        }
      } else if (this.state === 'chase') {
        this.goTo(tgt.pos, this.T.run * 0.85);
        if (tgt.dist < this.T.reach + 0.4 && this.cooldown <= 0) this.startAttack(1);
        if (this.stateT > 10) {
          this.state = 'circle';
          this.stateT = 0;
        }
      } else if (this.state === 'attack') this.updateAttack(dt, tgt);
      return;
    }
    if (tgt && !tgt.inCar && tgt.dist < 22 && !night) {
      // wary in daylight: trot away
      this.fleeFrom(tgt.pos, this.T.run * 0.5);
      this.state = 'wander';
      this.wanderTo = this.pos.clone().addScaledVector(V(Math.sin(this.desiredYaw), 0, Math.cos(this.desiredYaw)), 12);
      return;
    }
    if (this.state === 'attack') return this.updateAttack(dt, tgt);
    if (night && this.rnd() < dt * 0.01) this.g.audio && this.g.audio.play('howl', { at: this.pos, volume: 1 });
    this.wander(dt, 25, this.T.walk * 1.1, [2, 7]);
  }

  aiCreature(dt, tgt, night, diff) {
    // flees at dawn and is removed out of sight
    if (!night && this.state !== 'leave') {
      this.state = 'leave';
      this.stateT = 0;
    }
    if (this.state === 'leave') {
      if (tgt) this.fleeFrom(tgt.pos, this.T.run * 0.8);
      if (!tgt || tgt.dist > 90 || this.stateT > 20) this.mgr.despawnLater(this);
      return;
    }
    if (!tgt) return this.wander(dt, 20, this.T.walk);
    // light aversion: headlights or flashlight on it
    const lit = this.mgr.litBy(this);
    this.lightFear = clamp(this.lightFear + (lit ? dt * 1.5 : -dt * 0.4), 0, 1.5);
    if (this.state === 'recoil') {
      this.fleeFrom(tgt.pos, this.T.run * 0.55);
      this.anim.crouch = 0.6;
      if (this.stateT > 2.4 && this.lightFear < 0.6) {
        this.state = 'stalk';
        this.stateT = 0;
      }
      return;
    }
    if (this.lightFear > 0.9 && this.state !== 'attack') {
      this.state = 'recoil';
      this.stateT = 0;
      this.g.audio && this.g.audio.play('screech', { at: this.pos, volume: 0.9 });
      return;
    }
    if (this.state === 'retreat') {
      this.fleeFrom(tgt.pos, this.T.run * 0.7);
      if (this.stateT > 2 + this.rnd()) {
        this.state = 'stalk';
        this.stateT = 0;
      }
      return;
    }
    if (this.state === 'attack') return this.updateAttack(dt, tgt);
    const carStill = tgt.inCar && Math.abs(this.g.car.speedKmh) < 12;
    if (this.state === 'charge') {
      this.goTo(tgt.pos, this.T.run * (0.85 + diff.enemies * 0.1));
      this.anim.crouch = 0.25;
      const reach = tgt.inCar ? 2.6 : this.T.reach;
      if (tgt.dist < reach && this.cooldown <= 0) this.startAttack(tgt.inCar ? 2 : 0);
      if (tgt.inCar && !carStill) {
        this.state = 'stalk';
        this.stateT = 0;
      }
      return;
    }
    // stalk: circle at 18-30 m in a crouch, then charge
    this.anim.crouch = 0.8;
    if (this.state !== 'stalk') {
      this.state = 'stalk';
      this.stateT = 0;
      this.orbit = this.rnd() < 0.5 ? 1 : -1;
    }
    if (tgt.dist > 34) this.goTo(tgt.pos, this.T.walk * 1.3);
    else {
      const a = Math.atan2(this.pos.x - tgt.pos.x, this.pos.z - tgt.pos.z) + 0.35 * this.orbit;
      const r = 22;
      this.goTo(V(tgt.pos.x + Math.sin(a) * r, 0, tgt.pos.z + Math.cos(a) * r), this.T.walk * 1.1);
    }
    if ((this.stateT > 6 + this.rnd() * 6 && (!tgt.inCar || carStill)) || (tgt.dist < 12 && !tgt.inCar)) {
      this.state = 'charge';
      this.stateT = 0;
      this.g.audio && this.g.audio.play('screech', { at: this.pos, volume: 1 });
    }
  }

  aiVagrant(dt, tgt, night, diff) {
    if (this.state === 'flee') {
      if (tgt && tgt.dist < 60) this.fleeFrom(tgt.pos, this.T.run * 0.9);
      else {
        this.state = 'idle';
        this.stateT = 0;
      }
      return;
    }
    if (this.state === 'attack') return this.updateAttack(dt, tgt);
    if (this.hostile && tgt && !tgt.inCar) {
      if (this.hp < this.maxHp * 0.25) {
        this.state = 'flee';
        this.stateT = 0;
        return;
      }
      const sight = night ? 18 : 38;
      if (this.state === 'chase' || (tgt.dist < sight && (this.alert > 0 || this.canSeeCached(tgt.pos, sight)))) {
        if (this.state !== 'chase') {
          this.state = 'chase';
          this.stateT = 0;
          this.g.audio && this.g.audio.play('vagrant', { at: this.pos, volume: 1 });
        }
        this.goTo(tgt.pos, tgt.dist > 4 ? this.T.run * (0.85 + diff.enemies * 0.1) : this.T.walk * 1.6);
        if (tgt.dist < this.T.reach && this.cooldown <= 0) this.startAttack(0);
        if (tgt.dist > 70) {
          this.state = 'idle';
          this.stateT = 0;
        }
        return;
      }
    }
    // neutral: face the player when close, otherwise potter about camp
    if (tgt && tgt.dist < 7 && !tgt.inCar) {
      this.desiredSpeed = 0;
      this.faceTo(tgt.pos);
      this.state = 'idle';
      if (!this.greeted) {
        this.greeted = true;
        this.g.audio && this.g.audio.play('vagrant', { at: this.pos, volume: 0.6 });
      }
      return;
    }
    // dodge cars bearing down
    if (tgt && tgt.inCar && tgt.dist < 22 && Math.abs(this.g.car.speedKmh) > 25) {
      const car = this.g.car;
      const fwd = V(0, 0, 1).applyQuaternion(car.root.quaternion);
      const rel = this.pos.clone().sub(car.root.position);
      const ahead = rel.dot(fwd);
      const side = rel.clone().addScaledVector(fwd, -ahead);
      if (ahead > 0 && side.length() < 2.5) {
        const away = side.lengthSq() > 0.01 ? side.normalize() : V(fwd.z, 0, -fwd.x);
        this.desiredYaw = Math.atan2(away.x, away.z);
        this.desiredSpeed = this.T.run;
        return;
      }
    }
    this.wander(dt, this.poi ? 9 : 16, this.T.walk, [3, 9]);
  }

  canSeeCached(pos, range) {
    this.seeT = (this.seeT || 0) - 1;
    if (this.seeT > 0) return this.seeCache;
    this.seeT = 10;
    this.seeCache = this.canSee(pos, range);
    return this.seeCache;
  }

  startAttack(kind) {
    this.state = 'attack';
    this.stateT = 0;
    this.anim.attack = 0;
    this.anim.attackKind = kind;
    this.struck = false;
    this.desiredSpeed = 0;
    if (this.type === 'coyote') this.g.audio && this.g.audio.play('growl', { at: this.pos, volume: 0.9 });
    if (this.type === 'vagrant') this.g.audio && this.g.audio.play('swing', { at: this.pos, volume: 0.8 });
  }

  updateAttack(dt, tgt) {
    const dur = this.type === 'coyote' ? 0.55 : this.type === 'creature' ? 0.8 : 0.9;
    this.anim.attack = this.stateT / dur;
    if (tgt) this.faceTo(tgt.pos);
    this.desiredSpeed = this.type === 'coyote' && this.anim.attack < 0.5 ? 3 : 0;
    const hitAt = this.type === 'coyote' ? 0.45 : 0.55;
    if (!this.struck && this.anim.attack >= hitAt) {
      this.struck = true;
      if (tgt) this.strike(tgt);
    }
    if (this.anim.attack >= 1) {
      this.anim.attack = -1;
      this.cooldown = this.type === 'creature' ? 0.6 : this.type === 'coyote' ? 1.2 : 1.1;
      this.state = this.type === 'creature' ? 'retreat' : this.type === 'coyote' ? 'circle' : 'chase';
      this.stateT = 0;
    }
  }

  strike(tgt) {
    const g = this.g;
    const diff = g.difficulty || { enemies: 1 };
    const fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const rel = V(tgt.pos.x - this.pos.x, 0, tgt.pos.z - this.pos.z);
    const facing = rel.length() < 0.5 || rel.normalize().dot(fwd) > 0.3;
    if (tgt.inCar) {
      // claws on the bodywork: dents panels, breaks lights, rocks the car
      const car = g.car;
      if (tgt.dist > 3.4) return;
      g.audio && g.audio.play('hitMetal', { at: this.pos, volume: 1 });
      const ids = Object.keys(car.parts).filter((id) => car.isInstalled(id) && car.parts[id].condition !== undefined);
      const id = ids[Math.floor(this.rnd() * ids.length)];
      if (id) car.parts[id].condition = Math.max(0, car.parts[id].condition - 0.08);
      const imp = fwd.clone().multiplyScalar(500);
      car.dyn.body.applyImpulseAtPoint({ x: imp.x, y: 150, z: imp.z }, { x: this.pos.x, y: car.root.position.y + 0.8, z: this.pos.z }, true);
      g.player.damageFlash = Math.min(1, g.player.damageFlash + 0.25);
      return;
    }
    const reach = this.T.reach + 0.5;
    if (tgt.dist > reach || !facing) {
      g.audio && g.audio.play('swing', { at: this.pos, volume: 0.6 });
      return;
    }
    const base = this.type === 'creature' ? 18 : this.type === 'coyote' ? 7 : 10;
    const dmg = base * (0.8 + this.rnd() * 0.4) * (0.75 + 0.25 * diff.enemies);
    g.player.damage(dmg, this.type);
    if (this.type !== 'vagrant' || this.rnd() < 0.3) g.player.bleeding = Math.min(3, (g.player.bleeding || 0) + (this.type === 'creature' ? 0.8 : 0.35));
    g.audio && g.audio.play('hitFlesh', { at: g.player.position, volume: 0.9 });
    // shove
    if (g.player.knock) g.player.knock(fwd.clone().multiplyScalar(this.type === 'creature' ? 5 : 2.5));
  }

  // ---------------------------------------------------------------- damage
  damage(amount, zone, point, dir) {
    const g = this.g;
    if (this.dead) {
      g.effects && point && g.effects.bloodHit(V(point.x, point.y, point.z), (dir || V(0, 0, 1)).clone(), 0.5);
      return;
    }
    const mult = zone === 'head' ? 3.2 : zone === 'limb' ? 0.6 : 1;
    this.hp -= amount * mult;
    this.lastHitZone = zone;
    if (point && g.effects) g.effects.bloodHit(V(point.x, point.y, point.z), (dir || V(0, 0, 1)).clone().normalize(), this.type === 'rabbit' ? 0.4 : 1);
    g.audio && g.audio.play('hitFlesh', { at: this.pos, volume: 0.8 });
    if (dir) this.anim.flinch.add(V(dir.x, 0, dir.z).normalize().multiplyScalar(zone === 'head' ? 0.5 : 0.35));
    this.alert = 10;
    if (this.hp <= 0) return this.die(dir, zone);
    if (this.type === 'vagrant') {
      if (!this.hostile) {
        this.hostile = this.rnd() < 0.6;
        this.displayName = 'Vagrant';
        this.state = this.hostile ? 'chase' : 'flee';
        this.stateT = 0;
      }
      g.audio && g.audio.play('vagrant', { at: this.pos, volume: 1 });
    } else if (this.type === 'rabbit') {
      this.state = 'flee';
      this.stateT = 0;
    } else if (this.type === 'coyote') {
      this.state = this.rnd() < 0.5 ? 'flee' : 'chase';
      this.stateT = 0;
    } else if (this.type === 'creature') {
      g.audio && g.audio.play('screech', { at: this.pos, volume: 1 });
      if (this.state !== 'attack') {
        this.state = this.hp < this.maxHp * 0.35 ? 'retreat' : 'charge';
        this.stateT = 0;
      }
    }
  }

  die(dir, zone, fling = null) {
    if (this.dead) return;
    const g = this.g;
    this.dead = true;
    this.state = 'dead';
    this.hp = 0;
    this.speed = 0;
    this.desiredSpeed = 0;
    this.lootable = this.loot.length > 0;
    this.anim.death = 0;
    this.anim.attack = -1;
    // fall away from the hit
    if (dir) {
      const fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.anim.deathDir = V(dir.x, 0, dir.z).dot(fwd) > 0 ? 1 : -1;
    } else this.anim.deathDir = this.rnd() < 0.5 ? 1 : -1;
    this.anim.deathSide = this.rnd() < 0.5 ? 1 : -1;
    this.fling = fling;
    g.stats.kills++;
    if (zone === 'head') g.stats.headshots++;
    if (this.type === 'creature') g.audio && g.audio.play('screech', { at: this.pos, volume: 1, rate: 0.7 });
    if (this.poi && this.poiIndex >= 0) {
      const st = this.poi.state;
      st.npcDead = st.npcDead || [];
      if (!st.npcDead.includes(this.poiIndex)) st.npcDead.push(this.poiIndex);
    }
  }

  // ---------------------------------------------------------------- locomotion
  ground() {
    const g = this.g;
    const hit = g.physics.raycast({ x: this.pos.x, y: this.pos.y + 1.3, z: this.pos.z }, { x: 0, y: -1, z: 0 }, 6, GROUPS.ground);
    if (hit && (!hit.owner || hit.owner.kind !== 'car')) return hit.point.y;
    return g.gen.height(this.pos.x + g.origin.x, this.pos.z + g.origin.z);
  }

  move(dt) {
    const T = this.T;
    // steering + obstacle probing
    this.probeT -= dt;
    if (this.probeT <= 0 && this.desiredSpeed > 0.2) {
      this.probeT = 0.25;
      const look = Math.max(1.2, this.speed * 0.5 + 0.6);
      const ph = this.g.physics;
      const from = { x: this.pos.x, y: this.pos.y + (this.kind === 'rabbit' ? 0.15 : 0.55), z: this.pos.z };
      const dy = this.desiredYaw + this.avoid;
      const d = { x: Math.sin(dy), y: 0, z: Math.cos(dy) };
      const hit = ph.raycast(from, d, look, OBSTACLE);
      if (hit && Math.abs(hit.normal.y) < 0.7) {
        const l = { x: Math.sin(dy + 0.9), y: 0, z: Math.cos(dy + 0.9) },
          r = { x: Math.sin(dy - 0.9), y: 0, z: Math.cos(dy - 0.9) };
        const hl = ph.raycast(from, l, look, OBSTACLE),
          hr = ph.raycast(from, r, look, OBSTACLE);
        this.avoid += !hl ? 0.9 : !hr ? -0.9 : 1.8;
        this.avoidT = 1.2;
      }
    }
    this.avoidT -= dt;
    if (this.avoidT <= 0) this.avoid *= Math.max(0, 1 - dt * 2);
    const want = this.desiredYaw + this.avoid;
    const turn = T.turn * (this.speed > 3 ? 0.7 : 1);
    this.yaw += clamp(angDiff(this.yaw, want), -turn * dt, turn * dt);
    // rabbits move in hops
    let target = this.desiredSpeed;
    if (this.kind === 'rabbit') target = this.anim.hop >= 0 ? this.anim.hopSpeed : 0;
    const acc = target > this.speed ? (this.speed > 3 ? 6 : 4) : 8;
    this.speed += clamp(target - this.speed, -acc * dt, acc * dt);
    if (this.speed > 0.01) {
      const nx = this.pos.x + Math.sin(this.yaw) * this.speed * dt,
        nz = this.pos.z + Math.cos(this.yaw) * this.speed * dt;
      const ox = this.pos.x,
        oz = this.pos.z;
      this.pos.x = nx;
      this.pos.z = nz;
      const gy = this.ground();
      if (gy > this.pos.y + 0.5) {
        // wall / ledge: stay put
        this.pos.x = ox;
        this.pos.z = oz;
        this.blocked += dt;
        this.avoid += dt * 2;
      } else {
        this.blocked = Math.max(0, this.blocked - dt);
        this.groundY = gy;
      }
    }
    if (this.groundY === undefined) this.groundY = this.ground();
    // occasional re-ground when standing (things move under us)
    this.groundT = (this.groundT || 0) - dt;
    if (this.groundT <= 0 && this.speed <= 0.01) {
      this.groundT = 0.5;
      this.groundY = this.ground();
    }
    this.pos.y += (this.groundY - this.pos.y) * Math.min(1, dt * 14);
    // keep a little personal space from the player
    const p = this.g.player;
    if (p && !p.seat && !this.dead) {
      const dx = this.pos.x - p.position.x,
        dz = this.pos.z - p.position.z;
      const d = Math.hypot(dx, dz);
      const min = T.radius + 0.35;
      if (d < min && d > 1e-3) {
        this.pos.x += (dx / d) * (min - d);
        this.pos.z += (dz / d) * (min - d);
      }
    }
  }

  // ---------------------------------------------------------------- update
  update(dt, near) {
    const a = this.anim;
    a.t += dt;
    if (this.dead) {
      this.updateCorpse(dt);
    } else {
      this.think -= dt;
      this.updateAI(dt);
      this.alert = Math.max(0, this.alert - dt);
      this.move(dt);
      this.checkCar();
      if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.yaw)) {
        console.warn('npc state went non-finite', this.type, this.state);
        this.pos.copy(this.home);
        this.yaw = 0;
        this.desiredYaw = 0;
        this.avoid = 0;
        this.speed = 0;
      }
    }
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.yaw, 0);
    if (near || (this.frameSkip = ((this.frameSkip || 0) + 1) % 3) === 0) {
      if (this.kind === 'human') this.animHuman(near ? dt : dt * 3);
      else if (this.kind === 'quad') this.animQuad(near ? dt : dt * 3);
      else this.animRabbit(near ? dt : dt * 3);
      this.applyDeathPose();
    }
    this.root.updateMatrixWorld(true);
    if (near) this.syncHitboxes();
  }

  // Car vs. pedestrian: anything in the car's footprint at speed gets hit.
  checkCar() {
    const car = this.g.car;
    if (!car || !car.dyn) return;
    const cp = car.root.position;
    const dx = this.pos.x - cp.x,
      dz = this.pos.z - cp.z;
    if (dx * dx + dz * dz > 16) return;
    const v = car.dyn.body.linvel();
    const sp = Math.hypot(v.x, v.z);
    _m.copy(car.root.matrixWorld).invert();
    const l = _v.copy(this.pos).setY(this.pos.y + 0.4).applyMatrix4(_m);
    const hx = 0.98 + this.T.radius * 0.5,
      hz = 2.4 + this.T.radius * 0.5;
    if (Math.abs(l.x) > hx || Math.abs(l.z) > hz || l.y < -0.6 || l.y > 1.7) return;
    if (sp < 2.2) {
      // slow contact: nudged aside, never overlapped
      const px = hx - Math.abs(l.x),
        pz = hz - Math.abs(l.z);
      const out = px < pz ? new THREE.Vector3(Math.sign(l.x) * (px + 0.02), 0, 0) : new THREE.Vector3(0, 0, Math.sign(l.z) * (pz + 0.02));
      out.applyQuaternion(car.root.quaternion);
      this.pos.x += out.x;
      this.pos.z += out.z;
      return;
    }
    const dir = V(v.x, 0, v.z).normalize();
    const dmg = sp * sp * 0.9;
    const g = this.g;
    g.audio && g.audio.play(this.kind === 'rabbit' ? 'hitFlesh' : 'crash', { at: this.pos, volume: clamp(sp / 15, 0.3, 1) });
    g.effects && g.effects.bloodHit(this.pos.clone().setY(this.pos.y + 0.6), dir, this.kind === 'rabbit' ? 0.4 : 1.2);
    // momentum exchange: the car slows a little
    const mass = this.type === 'rabbit' ? 2 : this.type === 'coyote' ? 18 : 75;
    car.dyn.body.applyImpulse({ x: -v.x * mass * 0.5, y: 0, z: -v.z * mass * 0.5 }, true);
    if (this.type === 'creature' || this.type === 'vagrant') car.onImpact({ dv: sp * 0.2, dir: dir.clone().negate() });
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.die(dir, 'torso', { vel: V(v.x * 0.75, Math.min(5, sp * 0.35), v.z * 0.75) });
    } else {
      // knocked aside
      const side = V(l.x >= 0 ? 1 : -1, 0, 0).applyQuaternion(car.root.quaternion);
      this.pos.addScaledVector(side, 1.2);
      this.anim.flinch.add(dir.multiplyScalar(0.6));
      this.alert = 10;
      if (this.type === 'vagrant') {
        this.hostile = true;
        this.displayName = 'Vagrant';
      }
    }
  }

  updateCorpse(dt) {
    const a = this.anim;
    a.death = Math.min(1, a.death + dt / (this.fling ? 1.4 : 0.85));
    if (this.fling) {
      const f = this.fling;
      f.vel.y -= 9.81 * dt;
      this.pos.addScaledVector(f.vel, dt);
      const gy = this.ground();
      if (this.pos.y <= gy) {
        this.pos.y = gy;
        f.vel.y = Math.abs(f.vel.y) * 0.25;
        f.vel.x *= 0.55;
        f.vel.z *= 0.55;
        if (Math.hypot(f.vel.x, f.vel.z) < 0.4 && f.vel.y < 0.6) this.fling = null;
      }
    } else {
      this.groundT = (this.groundT || 0) - dt;
      if (this.groundT <= 0) {
        this.groundT = 1;
        this.groundY = this.ground();
      }
      this.pos.y += (this.groundY - this.pos.y) * Math.min(1, dt * 8);
    }
    this.corpseT += dt;
  }

  // ---------------------------------------------------------------- animation
  lookTarget() {
    const tgt = this.playerTarget();
    if (!tgt || tgt.dist > 25) return null;
    const p = this.g.player;
    return p.seat ? this.g.car.root.position.clone().setY(this.g.car.root.position.y + 1.1) : p.position.clone().setY(p.position.y + 1.6);
  }

  headLook(neck, head, dt, maxYaw = 1.1, weight = 1) {
    const a = this.anim;
    const t = this.dead ? null : this.lookTarget();
    let yaw = 0,
      pitch = 0;
    if (t && (this.state !== 'wander' || this.type !== 'rabbit')) {
      const hp = _v.setFromMatrixPosition(head.matrixWorld);
      const d = t.sub(hp);
      const local = d.applyAxisAngle(UP, -this.yaw);
      yaw = clamp(Math.atan2(local.x, local.z), -maxYaw, maxYaw);
      pitch = clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.6, 0.6);
      if (Math.abs(Math.atan2(local.x, local.z)) > 2.2) yaw = pitch = 0;
    } else {
      // idle glances
      yaw = Math.sin(a.t * 0.37 + this.seed) * 0.5 * Math.max(0, Math.sin(a.t * 0.11 + this.seed * 0.3));
    }
    a.look.x += (yaw * weight - a.look.x) * Math.min(1, dt * 4);
    a.look.y += (pitch * weight - a.look.y) * Math.min(1, dt * 4);
    neck.rotation.y += a.look.x * 0.4;
    head.rotation.y += a.look.x * 0.6;
    neck.rotation.x += a.look.y * 0.4;
    head.rotation.x += a.look.y * 0.6;
  }

  animHuman(dt) {
    const B = this.bones,
      a = this.anim;
    const creature = this.type === 'creature';
    const sp = this.speed;
    const run = clamp((sp - 2.0) / 2.4, 0, 1);
    const walkW = clamp(sp / 1.1, 0, 1);
    const stride = creature ? lerp(1.7, 3.6, run) : lerp(1.45, 2.5, run);
    a.phase += (sp / stride) * Math.PI * 2 * dt;
    const crouchT = this.dead ? 0 : creature ? (this.state === 'stalk' ? 0.8 : this.state === 'recoil' ? 0.6 : this.state === 'charge' ? 0.3 : 0.35) : 0;
    a.crouch += (crouchT - a.crouch) * Math.min(1, dt * 3);
    const cr = a.crouch;
    const ph = a.phase;
    for (const b of Object.values(B)) b.rotation.set(0, 0, 0);
    // flinch decays
    a.flinch.multiplyScalar(Math.max(0, 1 - dt * 5));
    const legA = walkW * lerp(0.42, 0.8, run);
    const kneeA = walkW * lerp(0.65, 1.4, run);
    const armA = walkW * lerp(0.32, 0.85, run) * (creature ? 0.6 : 1);
    const crTh = cr * 0.75;
    for (const [side, sg] of [
      ['L', 1],
      ['R', -1],
    ]) {
      const s = Math.sin(ph) * sg,
        c = Math.cos(ph) * sg;
      const thigh = -s * legA - crTh;
      const knee = 0.06 + kneeA * Math.pow(Math.max(0, c), 1.3) + run * 0.25 + crTh * 1.7;
      B['thigh' + side].rotation.x = thigh;
      B['thigh' + side].rotation.z = sg * (0.03 + cr * 0.08);
      B['shin' + side].rotation.x = knee;
      B['foot' + side].rotation.x = -(thigh + knee) * 0.8 + Math.max(0, s) * 0.3 * walkW;
      // arms swing against the legs
      const arm = B['upperArm' + side];
      arm.rotation.x = s * armA - run * 0.2 - (creature ? cr * 0.5 : 0);
      arm.rotation.z = sg * (0.1 + run * 0.1 + (creature ? 0.12 : 0));
      B['foreArm' + side].rotation.x = -(0.15 + run * 1.05 + armA * 0.35 * Math.max(0, -s)) * (creature ? 0.5 : 1);
      B['hand' + side].rotation.x = creature ? 0.3 : 0.1;
    }
    // hips drop for crouch + gait bob, spine lean and counter-twist
    const legLen = Math.abs(B.shinL.position.y) + Math.abs(B.footL.position.y);
    const drop = legLen * (1 - Math.cos(crTh)) * 0.9 + walkW * (0.012 + run * 0.035) * Math.abs(Math.sin(ph));
    B.hips.position.copy(B.hips.userData.restPos).setY(B.hips.userData.restPos.y - drop);
    B.hips.rotation.y = Math.sin(ph) * 0.12 * walkW;
    B.hips.rotation.z = Math.cos(ph) * 0.04 * walkW + Math.sin(a.t * 0.5 + this.seed) * 0.02 * (1 - walkW);
    B.spine.rotation.x = run * 0.16 + cr * 0.45 + a.flinch.length() * 0.3;
    B.chest.rotation.x = run * 0.06 + cr * 0.2 + Math.sin(a.t * (creature ? 2.2 : 1.5)) * 0.018;
    B.chest.rotation.y = -Math.sin(ph) * 0.2 * walkW;
    B.neck.rotation.x = -(run * 0.15 + cr * 0.5);
    // flinch: push torso away from the hit direction (local)
    if (a.flinch.lengthSq() > 1e-4) {
      const f = a.flinch.clone().applyAxisAngle(UP, -this.yaw);
      B.spine.rotation.x += f.z * 0.6;
      B.spine.rotation.z -= f.x * 0.6;
      B.head.rotation.x += f.z * 0.5;
    }
    // attack
    if (a.attack >= 0) {
      const t = a.attack;
      const wind = ease(clamp(t / 0.45, 0, 1)),
        strike = ease(clamp((t - 0.45) / 0.2, 0, 1)),
        rec = ease(clamp((t - 0.7) / 0.3, 0, 1));
      const k = (1 - rec) * 1;
      if (creature) {
        for (const [side, sg] of [
          ['L', 1],
          ['R', -1],
        ]) {
          B['upperArm' + side].rotation.x = lerp(B['upperArm' + side].rotation.x, lerp(-2.3, -0.2, strike), k * wind);
          B['upperArm' + side].rotation.z = lerp(B['upperArm' + side].rotation.z, sg * lerp(0.9, 0.2, strike), k * wind);
          B['foreArm' + side].rotation.x = lerp(B['foreArm' + side].rotation.x, lerp(-0.9, -0.1, strike), k * wind);
        }
        B.spine.rotation.x += k * (lerp(-0.25, 0.5, strike) * wind);
        B.neck.rotation.x += k * wind * -0.4;
      } else {
        B.upperArmR.rotation.x = lerp(B.upperArmR.rotation.x, lerp(-2.6, -0.4, strike), k * wind);
        B.upperArmR.rotation.z = lerp(B.upperArmR.rotation.z, lerp(-0.5, 0.25, strike), k * wind);
        B.foreArmR.rotation.x = lerp(B.foreArmR.rotation.x, lerp(-1.4, -0.2, strike), k * wind);
        B.chest.rotation.y += k * lerp(-0.35, 0.4, strike) * wind;
        B.spine.rotation.x += k * lerp(-0.05, 0.25, strike) * wind;
      }
    }
    this.headLook(B.neck, B.head, dt, 1.1, this.dead ? 0 : 1);
  }

  animQuad(dt) {
    const B = this.bones,
      a = this.anim;
    const sp = this.speed;
    const gallop = clamp((sp - 3.5) / 3, 0, 1);
    const walkW = clamp(sp / 1, 0, 1);
    const stride = lerp(1.1, 2.4, gallop);
    a.phase += (sp / stride) * Math.PI * 2 * dt;
    const ph = a.phase;
    for (const b of Object.values(B)) b.rotation.set(0, 0, 0);
    a.flinch.multiplyScalar(Math.max(0, 1 - dt * 5));
    const legs = {
      FL: [0, lerp(0, 0, gallop)],
      FR: [Math.PI, lerp(Math.PI, 0.5, gallop)],
      HL: [Math.PI, lerp(Math.PI, Math.PI + 1.0, gallop)],
      HR: [0, lerp(0, Math.PI + 1.5, gallop)],
    };
    const A = walkW * lerp(0.35, 0.7, gallop);
    for (const [leg, [, off]] of Object.entries(legs)) {
      const front = leg[0] === 'F';
      const s = Math.sin(ph + off),
        c = Math.cos(ph + off);
      const swing = Math.max(0, c);
      B['upper' + leg].rotation.x = -s * A;
      B['lower' + leg].rotation.x = (front ? 1 : -1) * swing * walkW * lerp(0.55, 1.0, gallop);
      B['paw' + leg].rotation.x = (front ? 0.6 : -0.5) * swing * walkW;
    }
    const bob = walkW * lerp(0.012, 0.05, gallop);
    B.hips.position.copy(B.hips.userData.restPos).setY(B.hips.userData.restPos.y - Math.abs(Math.sin(ph)) * bob);
    B.hips.rotation.x = Math.sin(ph) * 0.1 * gallop;
    B.chest.rotation.x = -Math.sin(ph) * 0.12 * gallop;
    B.neck.rotation.x = 0.08 * walkW + Math.sin(ph * 2) * 0.04 * walkW;
    B.tail.rotation.x = -0.25 * walkW - 0.35 * gallop + Math.sin(a.t * 1.3) * 0.05;
    B.tail.rotation.y = Math.sin(a.t * (walkW > 0.2 ? 2 : 0.8)) * 0.12;
    // jaw: open when attacking / panting when tired
    const jawT = a.attack >= 0 ? Math.sin(clamp(a.attack, 0, 1) * Math.PI) * 0.55 : 0.08 + gallop * 0.15;
    a.jaw += (jawT - a.jaw) * Math.min(1, dt * 12);
    B.jaw.rotation.x = a.jaw;
    if (a.attack >= 0) {
      const t = a.attack;
      const lunge = Math.sin(clamp(t, 0, 1) * Math.PI);
      B.neck.rotation.x += lunge * 0.4;
      B.head.rotation.x += -lunge * 0.3;
      B.upperFL.rotation.x -= lunge * 0.6;
      B.upperFR.rotation.x -= lunge * 0.5;
    }
    if (!this.dead && (this.state === 'circle' || this.state === 'chase')) B.neck.rotation.x += 0.25; // head low, stalking
    this.headLook(B.neck, B.head, dt, 0.9, this.dead ? 0 : 1);
  }

  animRabbit(dt) {
    const B = this.bones,
      a = this.anim;
    for (const b of Object.values(B)) b.rotation.set(0, 0, 0);
    // hop scheduling (AI sets desiredSpeed; hops realise it)
    if (a.hop < 0 && !this.dead && this.desiredSpeed > 0.2 && !(a.restT > 0)) {
      const fast = this.desiredSpeed > 3;
      a.hop = 0;
      a.hopDur = fast ? 0.3 : 0.42;
      a.hopLen = fast ? 1.6 + this.rnd() * 0.8 : 0.35 + this.rnd() * 0.3;
      a.hopSpeed = a.hopLen / a.hopDur;
      a.hopH = fast ? 0.22 : 0.08;
      if (fast) this.yaw += (this.rnd() - 0.5) * 0.5; // zig-zag
    }
    let up = 0,
      pitch = 0,
      hind = 0,
      frontA = 0;
    if (a.hop >= 0) {
      a.hop += dt / a.hopDur;
      const t = Math.min(1, a.hop);
      up = Math.sin(t * Math.PI) * a.hopH;
      pitch = lerp(-0.35, 0.3, t) * Math.sin(t * Math.PI);
      hind = t < 0.4 ? lerp(0.2, 1.1, t / 0.4) : lerp(1.1, -0.5, (t - 0.4) / 0.6);
      frontA = -Math.sin(t * Math.PI) * 0.9;
      if (a.hop >= 1) {
        a.hop = -1;
        a.restT = this.desiredSpeed > 3 ? 0 : 0.15 + this.rnd() * 0.3;
      }
    } else if (a.restT > 0) a.restT -= dt;
    B.body.position.copy(B.body.userData.restPos).setY(B.body.userData.restPos.y + up);
    B.body.rotation.x = pitch;
    B.hindL.rotation.x = hind;
    B.hindR.rotation.x = hind;
    B.hindFootL.rotation.x = -hind * 0.8;
    B.hindFootR.rotation.x = -hind * 0.8;
    B.frontL.rotation.x = frontA;
    B.frontR.rotation.x = frontA;
    const flee = this.state === 'flee' ? 1 : 0;
    a.ear += (flee - a.ear) * Math.min(1, dt * 5);
    const tw = Math.sin(a.t * 7 + this.seed) > 0.97 ? 0.3 : 0;
    B.earL.rotation.x = -0.1 + a.ear * 0.9 + tw;
    B.earR.rotation.x = -0.1 + a.ear * 0.9 + (Math.sin(a.t * 5.3 + this.seed * 2) > 0.97 ? 0.3 : 0);
    B.earL.rotation.z = -0.1;
    B.earR.rotation.z = 0.1;
    B.head.rotation.x = Math.sin(a.t * 0.7) * 0.05 + (this.speed < 0.1 && this.state === 'idle' ? 0.25 * Math.max(0, Math.sin(a.t * 0.4 + this.seed)) : 0);
    B.tail.rotation.x = -0.3;
  }

  // Root-level fall: humans fall forward/backward, animals topple onto a side.
  applyDeathPose() {
    const a = this.anim;
    if (a.death < 0) return;
    const t = a.death;
    const fall = Math.min(1, t * t * 1.15);
    const B = this.bones;
    if (this.kind === 'human') {
      const ang = (Math.PI / 2) * fall * (a.deathDir > 0 ? 1 : -1);
      this.root.rotateX(ang * 0.98);
      this.root.position.y += this.T.deathLift * Math.sin(fall * Math.PI * 0.5) + (a.deathDir < 0 && this.type === 'vagrant' ? 0.12 * fall : 0);
      const k = fall;
      for (const [side, sg] of [
        ['L', 1],
        ['R', -1],
      ]) {
        B['upperArm' + side].rotation.z = lerp(B['upperArm' + side].rotation.z, sg * (0.9 + a.deathSide * 0.2 * sg), k);
        B['upperArm' + side].rotation.x = lerp(B['upperArm' + side].rotation.x, -0.4 * a.deathDir, k);
        B['foreArm' + side].rotation.x = lerp(B['foreArm' + side].rotation.x, -0.5, k);
        B['thigh' + side].rotation.z = lerp(B['thigh' + side].rotation.z, sg * 0.18, k);
        B['thigh' + side].rotation.x = lerp(B['thigh' + side].rotation.x, side === 'L' ? -0.25 : 0.05, k);
        B['shin' + side].rotation.x = lerp(B['shin' + side].rotation.x, side === 'L' ? 0.45 : 0.1, k);
        B['foot' + side].rotation.x = lerp(B['foot' + side].rotation.x, a.deathDir > 0 ? 0.6 : -0.3, k);
      }
      B.head.rotation.y = lerp(B.head.rotation.y, a.deathSide * 0.9, k);
      B.head.rotation.x = lerp(B.head.rotation.x, -0.2 * a.deathDir, k);
      B.hips.position.copy(B.hips.userData.restPos);
      B.spine.rotation.x = lerp(B.spine.rotation.x, 0, k);
    } else {
      const ang = (Math.PI / 2) * fall * a.deathSide;
      this.root.rotateZ(ang);
      this.root.position.y += this.T.deathLift * Math.sin(fall * Math.PI * 0.5);
      if (this.kind === 'quad') {
        for (const leg of ['FL', 'FR', 'HL', 'HR']) {
          B['upper' + leg].rotation.x = lerp(B['upper' + leg].rotation.x, leg[0] === 'F' ? -0.3 : 0.3, fall);
          B['lower' + leg].rotation.x = lerp(B['lower' + leg].rotation.x, leg[0] === 'F' ? 0.3 : -0.2, fall);
        }
        B.jaw.rotation.x = 0.25 * fall;
        B.neck.rotation.x = lerp(B.neck.rotation.x, 0.2, fall);
      }
    }
  }
}

// ------------------------------------------------------------------ manager
export class NPCManager {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    this.group.name = 'npcs';
    game.worldGroup.add(this.group);
    this.list = [];
    this.protos = {}; // type -> [proto]
    this.pending = 0;
    this.spawnT = 2;
    this.toRemove = new Set();
    this.workers = [];
    this.queue = [];
    this.nextId = 1;
    this.callbacks = new Map();
    this.poiNpcs = new Map(); // poi key -> [npc]
    this.rnd = mulberry32((game.seed || 1) * 31 + 7);
    this.hornT = 0;
  }

  // Build all prototypes in the background (two workers); spawns wait for them.
  startBuilding() {
    const jobs = [];
    for (const [type, T] of Object.entries(TYPES)) for (const seed of T.seeds) jobs.push({ type, seed });
    // the most common first
    const order = { rabbit: 0, vagrant: 1, coyote: 2, creature: 3 };
    jobs.sort((a, b) => order[a.type] - order[b.type]);
    // first-person hand poses go first: they are on screen from the first frame
    const hands = HAND_POSES.map((pose) => ({ type: 'hand', pose, seed: 0 }));
    hands.sort((a, b) => (a.pose === 'relax' ? -1 : b.pose === 'relax' ? 1 : 0));
    jobs.unshift(...hands);
    this.pending = jobs.length;
    let workersOk = true;
    try {
      for (let i = 0; i < 2; i++) {
        const w = new Worker(new URL('./charWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this.onBuilt(e.data, w);
        w.onerror = (e) => {
          console.warn('character worker failed, building on the main thread', e.message);
          for (const x of this.workers) x.terminate();
          this.workers = [];
          if (!this.fellBack) {
            this.fellBack = true;
            this.buildSyncFallback();
          }
        };
        w.busy = false;
        this.workers.push(w);
      }
    } catch (e) {
      workersOk = false;
    }
    this.queue = jobs;
    if (!workersOk || !this.workers.length) return this.buildSyncFallback();
    for (const w of this.workers) this.feed(w);
  }

  feed(w) {
    const job = this.queue.shift();
    if (!job) {
      w.terminate();
      return;
    }
    w.busy = true;
    w.postMessage({ id: this.nextId++, ...job });
  }

  onBuilt(d, w) {
    if (d.type === 'hand') {
      registerHandArrays(d.pose, d.arrays);
      this.pending--;
      if (w) this.feed(w);
      return;
    }
    if (d.error) {
      console.warn('character build failed', d.type, d.error);
    } else {
      const geo = geometryFromArrays(d.arrays);
      const proto = { type: d.type, seed: d.seed, geo, defs: d.defs, attachments: d.attachments, height: d.height, kind: d.kind, hitboxes: d.hitboxes };
      (this.protos[d.type] = this.protos[d.type] || []).push(proto);
    }
    this.pending--;
    if (w) this.feed(w);
  }

  // No workers (or they failed): polygonise on the main thread, one character per tick.
  buildSyncFallback() {
    const step = () => {
      const job = this.queue.shift();
      if (!job) return;
      if (job.type === 'hand') {
        this.onBuilt({ type: 'hand', pose: job.pose, arrays: handArrays(job.pose) }, null);
        setTimeout(step, 30);
        return;
      }
      const def = DEFINE[job.type](job.seed);
      const arrays = polygonizeArrays(def.model, def.cell, def.defs.map((x) => x[0]));
      this.onBuilt({ type: job.type, seed: job.seed, arrays, defs: def.defs, attachments: def.attachments, height: def.height, kind: def.kind, hitboxes: def.hitboxes }, null);
      setTimeout(step, 30);
    };
    setTimeout(step, 30);
  }

  ready(type) {
    return this.protos[type] && this.protos[type].length > 0;
  }

  spawn(type, pos, opts = {}) {
    const list = this.protos[type];
    if (!list || !list.length) return null;
    const proto = list[Math.floor(this.rnd() * list.length)];
    const npc = new NPC(this, proto, type, pos, opts);
    this.group.add(npc.root);
    this.list.push(npc);
    return npc;
  }

  remove(npc) {
    npc.dispose();
    const i = this.list.indexOf(npc);
    if (i >= 0) this.list.splice(i, 1);
  }

  despawnLater(npc) {
    // only when the player can't see it
    const cam = this.g.renderer.camera;
    const d = npc.pos.clone().sub(cam.position);
    const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion);
    if (d.length() > 60 || d.normalize().dot(fwd) < 0.3) this.toRemove.add(npc);
  }

  // Is this NPC inside a headlight beam or the player's flashlight cone?
  litBy(npc) {
    const g = this.g;
    const p = npc.pos.clone().setY(npc.pos.y + 1);
    const car = g.car;
    if (car && car.lightsOn > 0 && car.isInstalled('battery') && car.battery > 0.05) {
      const fwd = V(0, 0, 1).applyQuaternion(car.root.quaternion);
      const rel = p.clone().sub(car.root.position);
      const d = rel.length();
      const range = car.lightsOn === 2 ? 60 : 32;
      if (d < range && rel.normalize().dot(fwd) > Math.cos(0.42) && (car.isInstalled('headlight_L') || car.isInstalled('headlight_R'))) return true;
    }
    const pl = g.player;
    if (pl && pl.headlampOn && !pl.seat) {
      const cam = g.renderer.camera;
      const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion);
      const rel = p.clone().sub(cam.position);
      const d = rel.length();
      if (d < 28 && rel.normalize().dot(fwd) > Math.cos(0.3)) return true;
    }
    return false;
  }

  noise(pos, radius) {
    for (const n of this.list) {
      if (n.dead) continue;
      const d = n.pos.distanceTo(pos);
      if (d > radius) continue;
      n.alert = 10;
      if (n.type === 'rabbit' || (n.type === 'coyote' && !this.g.env.isNight)) {
        n.state = 'flee';
        n.stateT = 0;
      } else if (n.type === 'coyote' && this.rnd() < 0.5) {
        n.state = 'flee';
        n.stateT = 0;
      } else if (n.type === 'vagrant' && !n.hostile) {
        n.state = 'flee';
        n.stateT = 0;
      } else if (n.type === 'creature' && n.state === 'stalk' && d < 40) {
        n.state = 'charge';
        n.stateT = 0;
      }
    }
  }

  // Closest lootable corpse whose body passes within ~0.45 m of the ray.
  corpseNear(origin, dir, maxDist) {
    let best = null;
    for (const n of this.list) {
      if (!n.dead || !n.lootable || !n.hitboxes.length) continue;
      const t = n.hitboxes[0].col.translation();
      _v.set(t.x - origin.x, t.y - origin.y, t.z - origin.z);
      const along = _v.dot(dir);
      if (along < 0 || along > maxDist) continue;
      const miss = Math.sqrt(Math.max(0, _v.lengthSq() - along * along));
      if (miss < 0.45 && (!best || along < best.dist)) best = { npc: n, dist: along };
    }
    return best;
  }

  lootCorpse(npc) {
    if (!npc.dead || !npc.lootable) return;
    const g = this.g;
    npc.lootable = false;
    const base = npc.pos.clone();
    const r = npc.rnd;
    let n = 0;
    for (const id of npc.loot) {
      const a = r() * Math.PI * 2;
      const p = V(base.x + Math.cos(a) * 0.4, base.y + 0.35 + n * 0.1, base.z + Math.sin(a) * 0.4);
      const q = new THREE.Quaternion().setFromAxisAngle(UP, r() * 6.28);
      g.items.spawn(id, p, q, initialState(id, r));
      n++;
    }
    g.audio && g.audio.play(npc.type === 'rabbit' ? 'remove' : 'pocket', { at: base });
    g.hud && g.hud.toast(npc.type === 'rabbit' ? 'You dress the rabbit' : n ? `Found ${n} item${n > 1 ? 's' : ''}` : 'Nothing useful');
    if (npc.type === 'rabbit') this.remove(npc);
    npc.loot = [];
  }

  // ---------------------------------------------------------------- POI residents
  onPoiLoaded(inst, rnd) {
    const type = inst.poi.type;
    const counts = { camp: [1, 2], ruins: [0, 1], trailers: [0, 2], outpost: [1, 1], junkyard: [0, 1], motel: [0, 1], houses: [0, 1] };
    const c = counts[type];
    if (!c) return;
    const r = mulberry32(inst.poi.seed + 4242);
    const n = c[0] + Math.floor(r() * (c[1] - c[0] + 1));
    const dead = new Set(inst.state.npcDead || []);
    const hostileP = 0.35 * (this.g.difficulty.enemies || 1);
    const list = [];
    inst.root.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) {
      if (dead.has(i)) continue;
      const a = r() * Math.PI * 2,
        rad = 3 + r() * 5;
      const lp = V(Math.cos(a) * rad, 0, Math.sin(a) * rad).applyMatrix4(inst.root.matrixWorld);
      const hostile = r() < hostileP;
      list.push({ i, lp, hostile, seed: (inst.poi.seed + i * 17) | 0 });
    }
    if (!list.length) return;
    this.poiNpcs.set(inst.k, { inst, list, spawned: [] });
  }

  onPoiUnloaded(inst) {
    const e = this.poiNpcs.get(inst.k);
    if (!e) return;
    for (const n of e.spawned) if (this.list.includes(n)) this.remove(n);
    this.poiNpcs.delete(inst.k);
  }

  spawnPoiResidents() {
    if (!this.ready('vagrant')) return;
    for (const e of this.poiNpcs.values()) {
      if (e.done) continue;
      e.done = true;
      for (const s of e.list) {
        const y = this.g.gen.height(s.lp.x + this.g.origin.x, s.lp.z + this.g.origin.z);
        const npc = this.spawn('vagrant', V(s.lp.x, y + 0.5, s.lp.z), { hostile: s.hostile, poi: e.inst, poiIndex: s.i, home: s.lp, seed: s.seed });
        if (npc) e.spawned.push(npc);
      }
    }
  }

  // ---------------------------------------------------------------- wildlife / creature spawning
  spawnTick() {
    const g = this.g;
    const f = g.focusPoint();
    const gx = f.x + g.origin.x,
      gz = f.z + g.origin.z;
    const env = g.env;
    const night = env.isNight;
    const biome = g.gen.dominantBiome(gx, gz);
    const diff = g.difficulty || { enemies: 1 };
    const count = (t) => this.list.filter((n) => n.type === t && !n.dead && !n.poi).length;
    const driving = g.player.seat && Math.abs(g.car.speedKmh) > 30;
    const heading = driving ? Math.atan2(g.car.dyn.body.linvel().x, g.car.dyn.body.linvel().z) : this.rnd() * Math.PI * 2;
    const spot = (minR, maxR, spread = Math.PI) => {
      for (let k = 0; k < 6; k++) {
        const a = heading + (this.rnd() - 0.5) * 2 * spread;
        const r = minR + this.rnd() * (maxR - minR);
        const x = f.x + Math.sin(a) * r,
          z = f.z + Math.cos(a) * r;
        const wx = x + g.origin.x,
          wz = z + g.origin.z;
        if (Math.abs(wx - g.gen.roadX(wz)) < 7) continue;
        if (g.gen.poisNear(wz, 1).some((q) => Math.hypot(q.x - wx, q.z - wz) < (q.padR || 20) + 25)) continue;
        return V(x, g.gen.height(wx, wz) + 0.3, z);
      }
      return null;
    };
    // jackrabbits by day in the brush
    const rabbitTarget = night ? 1 : { scrub: 4, dunes: 1, badlands: 2, saltflat: 0, highland: 3 }[biome] ?? 2;
    if (this.ready('rabbit') && count('rabbit') < rabbitTarget) {
      const p = spot(35, 85, driving ? 0.5 : Math.PI);
      if (p) this.spawn('rabbit', p);
    }
    // coyotes: packs at dusk/night, sometimes by day in the rough country
    const coyoteTarget = night ? Math.round(2 * diff.enemies) : biome === 'badlands' || biome === 'highland' ? 1 : 0;
    if (this.ready('coyote') && count('coyote') < coyoteTarget && this.rnd() < 0.25) {
      const p = spot(80, 140);
      if (p) {
        const n = night ? 2 + Math.floor(this.rnd() * 2) : 1;
        for (let i = 0; i < n; i++) this.spawn('coyote', p.clone().add(V(this.rnd() * 3, 0, this.rnd() * 3)), { hostile: night });
      }
    }
    // the creature hunts at night, away from the lights of settlements
    const deep = env.time > 21.5 || env.time < 4.5;
    const creatureTarget = night && deep ? (diff.enemies >= 1.5 ? 2 : diff.enemies < 1 ? (this.rnd() < 0.5 ? 1 : 0) : 1) : 0;
    if (this.ready('creature') && count('creature') < creatureTarget && this.rnd() < 0.08) {
      const p = spot(75, 115);
      if (p) this.spawn('creature', p, { hostile: true, state: 'stalk' });
    }
    // drifters walking the roadside
    if (this.ready('vagrant') && count('vagrant') < (night ? 0 : 1) && this.rnd() < 0.04) {
      const z = f.z + (driving ? Math.sign(g.car.dyn.body.linvel().z || 1) * (150 + this.rnd() * 80) : (this.rnd() - 0.5) * 200);
      const wz = z + g.origin.z;
      const x = g.gen.roadX(wz) - g.origin.x + (this.rnd() < 0.5 ? -1 : 1) * (5 + this.rnd() * 4);
      const p = V(x, g.gen.height(x + g.origin.x, wz) + 0.3, z);
      if (p.distanceTo(f) > 70) this.spawn('vagrant', p, { hostile: this.rnd() < 0.3 * diff.enemies });
    }
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    const g = this.g;
    if (!g.player) return;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 1.5;
      this.spawnPoiResidents();
      this.spawnTick();
    }
    // horn scares wildlife
    this.hornT -= dt;
    if (g.car && g.car.horn && this.hornT <= 0) {
      this.hornT = 0.5;
      this.noise(g.car.root.position, 45);
    }
    const f = g.focusPoint();
    for (const n of this.list) {
      const d = Math.hypot(n.pos.x - f.x, n.pos.z - f.z);
      const far = d > 230 && !n.poi;
      if (far || (n.dead && n.corpseT > 600 && d > 40)) {
        this.toRemove.add(n);
        continue;
      }
      n.root.visible = d < 320;
      n.update(dt, d < 70);
    }
    for (const n of this.toRemove) this.remove(n);
    this.toRemove.clear();
  }

  rebase(dx, dz) {
    for (const n of this.list) {
      n.pos.x -= dx;
      n.pos.z -= dz;
      n.home.x -= dx;
      n.home.z -= dz;
      if (n.wanderTo) {
        n.wanderTo.x -= dx;
        n.wanderTo.z -= dz;
      }
      n.root.position.copy(n.pos);
    }
    for (const e of this.poiNpcs.values())
      for (const s of e.list) {
        s.lp.x -= dx;
        s.lp.z -= dz;
      }
  }

  // Nearby NPCs summarised for the HUD/compass, debugging and tests.
  debugList() {
    return this.list.map((n) => ({ type: n.type, state: n.state, hp: Math.round(n.hp), dead: n.dead, x: +n.pos.x.toFixed(1), z: +n.pos.z.toFixed(1) }));
  }
}
