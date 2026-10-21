// Thin wrapper around Rapier: world creation, fixed stepping, collision groups and queries.

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

export const G = {
  WORLD: 1 << 0,
  CAR: 1 << 1,
  ITEM: 1 << 2,
  PLAYER: 1 << 3,
  NPC: 1 << 4,
  HELD: 1 << 5,
  DEBRIS: 1 << 6,
  WHEEL_PROBE: 1 << 7,
  TRAILER: 1 << 8,
};

// Rapier interaction groups: 16-bit membership << 16 | 16-bit filter.
export function groups(member, filter) {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

export const GROUPS = {
  world: groups(G.WORLD, 0xffff),
  car: groups(G.CAR, G.WORLD | G.CAR | G.ITEM | G.NPC | G.DEBRIS),
  item: groups(G.ITEM, G.WORLD | G.CAR | G.ITEM | G.PLAYER | G.NPC | G.DEBRIS | G.TRAILER),
  held: groups(G.HELD, G.WORLD | G.CAR | G.ITEM | G.TRAILER),
  // the player capsule is kinematic: if it took part in contacts with the car, a moving car
  // would stop dead against it like a wall. Car <-> player is resolved by hand instead
  // (Player.carContact) while the character controller still sees the car (playerQuery).
  player: groups(G.PLAYER, G.WORLD | G.ITEM | G.NPC),
  playerQuery: groups(G.PLAYER, G.WORLD | G.CAR | G.ITEM | G.NPC | G.TRAILER),
  npc: groups(G.NPC, G.WORLD | G.CAR | G.PLAYER | G.ITEM | G.TRAILER),
  debris: groups(G.DEBRIS, G.WORLD | G.CAR | G.ITEM),
  // queries
  wheelRay: groups(G.WHEEL_PROBE, G.WORLD),
  look: groups(0xffff, G.WORLD | G.CAR | G.ITEM | G.NPC | G.TRAILER),
  shoot: groups(0xffff, G.WORLD | G.CAR | G.ITEM | G.NPC | G.TRAILER),
  ground: groups(0xffff, G.WORLD | G.CAR | G.ITEM | G.TRAILER),
};

export class Physics {
  static async create() {
    await RAPIER.init();
    return new Physics();
  }

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 120;
    this.world.numSolverIterations = 4;
    this.fixedDt = 1 / 120;
    this.acc = 0;
    this.beforeStep = [];
    this.afterStep = [];
    this.colliderOwner = new Map(); // collider handle -> owner object
    this.time = 0;
    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    // bodies drawn between their last two physics states, so they move smoothly at any frame
    // rate (the world steps at 120 Hz, the screen does not)
    this.smooth = new Set();
    this.alpha = 1;
  }

  // Starts interpolating a body; read its pose with pose().
  track(body) {
    const s = { body, p0: new THREE.Vector3(), p1: new THREE.Vector3(), q0: new THREE.Quaternion(), q1: new THREE.Quaternion() };
    this.snap(s);
    this.smooth.add(s);
    return s;
  }

  untrack(s) {
    if (s) this.smooth.delete(s);
  }

  // Forget the motion so far (after a teleport).
  snap(s) {
    const t = s.body.translation(),
      r = s.body.rotation();
    s.p0.set(t.x, t.y, t.z);
    s.p1.copy(s.p0);
    s.q0.set(r.x, r.y, r.z, r.w);
    s.q1.copy(s.q0);
  }

  snapAll() {
    for (const s of this.smooth) this.snap(s);
  }

  // The interpolated pose of a tracked body into a position and a quaternion.
  pose(s, pos, quat) {
    pos.lerpVectors(s.p0, s.p1, this.alpha);
    quat.slerpQuaternions(s.q0, s.q1, this.alpha);
    // a jump (teleport, righting) is shown at once
    if (s.p0.distanceToSquared(s.p1) > 4) {
      pos.copy(s.p1);
      quat.copy(s.q1);
    }
  }

  // Advances in fixed steps; returns interpolation alpha.
  update(dt) {
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < 8) {
      for (const f of this.beforeStep) f(this.fixedDt);
      for (const s of this.smooth) {
        const t = s.body.translation(),
          r = s.body.rotation();
        s.p0.set(t.x, t.y, t.z);
        s.q0.set(r.x, r.y, r.z, r.w);
      }
      // no event queue: nothing reads collision events, and collecting them costs every step
      this.world.step();
      this.time += this.fixedDt;
      for (const f of this.afterStep) f(this.fixedDt);
      this.acc -= this.fixedDt;
      steps++;
    }
    if (steps === 8) this.acc = 0;
    if (steps)
      for (const s of this.smooth) {
        const t = s.body.translation(),
          r = s.body.rotation();
        s.p1.set(t.x, t.y, t.z);
        s.q1.set(r.x, r.y, r.z, r.w);
      }
    this.alpha = Math.min(1, this.acc / this.fixedDt);
    return this.alpha;
  }

  setOwner(collider, owner) {
    this.colliderOwner.set(collider.handle, owner);
  }

  ownerOf(collider) {
    return collider ? this.colliderOwner.get(collider.handle) : null;
  }

  removeCollider(c) {
    if (!c) return;
    this.colliderOwner.delete(c.handle);
    this.world.removeCollider(c, true);
  }

  removeBody(b) {
    if (!b) return;
    const n = b.numColliders();
    for (let i = 0; i < n; i++) this.colliderOwner.delete(b.collider(i).handle);
    this.world.removeRigidBody(b);
  }

  // Ray cast; returns { point, normal, distance, collider, owner } or null.
  raycast(origin, dir, maxDist, groupsMask = GROUPS.look, excludeBody = null, predicate = null) {
    const r = this._ray;
    r.origin.x = origin.x;
    r.origin.y = origin.y;
    r.origin.z = origin.z;
    r.dir.x = dir.x;
    r.dir.y = dir.y;
    r.dir.z = dir.z;
    const hit = this.world.castRayAndGetNormal(r, maxDist, true, undefined, groupsMask, undefined, excludeBody || undefined, predicate || undefined);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
      normal: hit.normal,
      distance: t,
      collider: hit.collider,
      owner: this.colliderOwner.get(hit.collider.handle) || null,
    };
  }
}
