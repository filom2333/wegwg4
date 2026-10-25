// Scissor jack: set it on the ground under a car's sill beside a wheel and crank it up, and its
// pad (a kinematic body) lifts that corner off the ground, so a wheel carrying the car's weight
// can come off. Cranked down it can be picked up again.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const JACK_LOW = 0.11; // pad top above the ground, collapsed
export const JACK_MAX = 0.36; // pad top above the ground, fully up
const ARM = 0.13; // scissor arm length

let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    paint: new THREE.MeshStandardMaterial({ color: 0x9a2a1e, metalness: 0.3, roughness: 0.55 }),
    rod: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.95, roughness: 0.25 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
  };
  return MATS;
}

// The jack: a base plate, a diamond of four arms (bottom and top corners on the base and the
// pad, side corners on the screw) and a crank eye. pose(h) sets the pad top h above the base.
export function jackModel() {
  const M = mats();
  const g = new THREE.Group();
  const mesh = (geo, m) => {
    const x = new THREE.Mesh(geo, m);
    x.castShadow = x.receiveShadow = true;
    g.add(x);
    return x;
  };
  // the base: a pressed plate with its edges turned up, the bottom pivots on it
  mesh(new THREE.BoxGeometry(0.3, 0.006, 0.11).translate(0, 0.003, 0), M.paint);
  for (const z of [-0.052, 0.052]) mesh(new THREE.BoxGeometry(0.3, 0.026, 0.005).translate(0, 0.013, z), M.paint);
  for (const x of [-0.145, 0.145]) mesh(new THREE.BoxGeometry(0.008, 0.016, 0.1).translate(x, 0.008, 0), M.paint);
  mesh(new THREE.BoxGeometry(0.06, 0.02, 0.07).translate(0, 0.016, 0), M.paint);
  // a group whose meshes move together (the pad, an arm)
  const part = (list) => {
    const o = new THREE.Group();
    for (const [geo, m] of list) {
      const x = new THREE.Mesh(geo, m);
      x.castShadow = x.receiveShadow = true;
      o.add(x);
    }
    g.add(o);
    return o;
  };
  // the saddle: a channel with a notch for the sill seam, rubber in it
  const pad = part([
    [new THREE.BoxGeometry(0.12, 0.008, 0.07).translate(0, -0.008, 0), M.paint],
    [new THREE.BoxGeometry(0.12, 0.022, 0.006).translate(0, 0.0, -0.032), M.paint],
    [new THREE.BoxGeometry(0.12, 0.022, 0.006).translate(0, 0.0, 0.032), M.paint],
    [new THREE.BoxGeometry(0.11, 0.008, 0.05).translate(0, 0.0, 0), M.rubber],
    [new THREE.BoxGeometry(0.06, 0.016, 0.07).translate(0, -0.016, 0), M.paint],
  ]);
  // arms: pressed channels (a web and two flanges), a pin through each end
  const arms = [];
  for (const sx of [-1, 1])
    for (const lower of [true, false]) {
      const a = part([
        [new THREE.BoxGeometry(ARM, 0.004, 0.04).translate(ARM / 2, lower ? -0.008 : 0.008, 0), M.paint],
        [new THREE.BoxGeometry(ARM, 0.02, 0.004).translate(ARM / 2, 0, -0.02), M.paint],
        [new THREE.BoxGeometry(ARM, 0.02, 0.004).translate(ARM / 2, 0, 0.02), M.paint],
        [new THREE.CylinderGeometry(0.006, 0.006, 0.05, 10).rotateX(Math.PI / 2), M.rod],
        [new THREE.CylinderGeometry(0.006, 0.006, 0.05, 10).rotateX(Math.PI / 2).translate(ARM, 0, 0), M.rod],
      ]);
      a.userData = { sx, lower };
      arms.push(a);
    }
  // the screw: a threaded rod through the side pivots, a crank eye at one end
  const thread = new THREE.CylinderGeometry(0.0065, 0.0065, 0.38, 10, 120).rotateZ(Math.PI / 2);
  const tp = thread.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const k = 1 + 0.16 * Math.sin((tp.getX(i) / 0.0035) * Math.PI * 2);
    tp.setY(i, tp.getY(i) * k);
    tp.setZ(i, tp.getZ(i) * k);
  }
  thread.computeVertexNormals();
  const rod = mesh(thread.translate(0.03, 0, 0), M.rod);
  const eye = mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 14).rotateY(Math.PI / 2).translate(0.23, 0, 0), M.rod);
  const pose = (h) => {
    const y0 = 0.02,
      y1 = h - 0.025;
    const half = Math.min(ARM * 0.97, Math.max(0.01, (y1 - y0) / 2));
    const mid = y0 + half;
    const reach = Math.sqrt(ARM * ARM - half * half);
    pad.position.set(0, h - 0.0125, 0);
    rod.position.set(0, mid, 0);
    eye.position.set(0, mid, 0);
    for (const a of arms) {
      const { sx, lower } = a.userData;
      a.position.set(0, lower ? y0 : y1, 0);
      a.rotation.set(0, 0, Math.atan2(lower ? half : -half, sx * reach));
    }
  };
  pose(JACK_LOW);
  g.userData.pose = pose;
  return g;
}

export class Jacks {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    this.group.name = 'jacks';
    game.worldGroup.add(this.group);
  }

  // Where a jack would stand to lift the corner of `car` nearest a world point: the ground under
  // the floor pan beside that wheel. Returns { pos (ground, scene coords), yaw, wheel } or null.
  spotFor(car, worldPoint) {
    const lp = car.localPointOf(worldPoint);
    const K = car.k || 1;
    let wheel = null,
      bd = 1.6;
    for (const w of car.dyn.wheels) {
      const d = Math.hypot(lp.x - w.local.x / K, lp.z - w.local.z / K);
      if (d < bd) {
        bd = d;
        wheel = w;
      }
    }
    if (!wheel) return null;
    // the floor pan: the widest chassis box
    let floor = null,
      fa = 0;
    for (const [part, c, h] of car.type.BOXES)
      if (part === 'chassis' && h[0] * h[2] > fa) {
        fa = h[0] * h[2];
        floor = { c, h };
      }
    if (!floor) return null;
    const wl = wheel.local.clone().divideScalar(K);
    const sx = Math.sign(wl.x) || 1;
    const x = sx * Math.min(floor.h[0] - 0.1, Math.abs(wl.x) - 0.12);
    const z = THREE.MathUtils.clamp(wl.z + (wl.z > 0 ? -0.38 : 0.38), floor.c[2] - floor.h[2] + 0.1, floor.c[2] + floor.h[2] - 0.1);
    const top = car.worldPointOf(V(x, floor.c[1] - floor.h[1], z));
    const hit = this.game.physics.raycast({ x: top.x, y: top.y + 0.05, z: top.z }, { x: 0, y: -1, z: 0 }, 2.5, GROUPS.ground, car.dyn.body);
    if (!hit) return null;
    const gap = top.y - hit.point.y;
    if (gap < JACK_LOW + 0.005) return { blocked: 'Too low to get a jack under' };
    if (gap > JACK_MAX - 0.03) return { blocked: 'The sill is out of the jack’s reach' };
    const fwd = V(0, 0, 1).applyQuaternion(car.root.quaternion);
    return { pos: V(hit.point.x, hit.point.y, hit.point.z), yaw: Math.atan2(fwd.x, fwd.z), wheel, car };
  }

  place(spot) {
    const ph = this.game.physics;
    const root = jackModel();
    root.position.copy(spot.pos);
    root.rotation.y = spot.yaw;
    this.group.add(root);
    const body = ph.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spot.pos.x, spot.pos.y + JACK_LOW - 0.015, spot.pos.z));
    const col = ph.world.createCollider(RAPIER.ColliderDesc.cuboid(0.06, 0.015, 0.045).setFriction(1.2).setCollisionGroups(GROUPS.world), body);
    const j = { root, body, col, h: JACK_LOW, base: spot.pos.clone(), car: spot.car, crank: 0 };
    ph.setOwner(col, { kind: 'jack', jack: j });
    this.list.push(j);
    this.game.audio && this.game.audio.play('pickupHeavy', { at: spot.pos });
    return j;
  }

  remove(j) {
    const ph = this.game.physics;
    ph.removeBody(j.body);
    this.group.remove(j.root);
    this.list = this.list.filter((x) => x !== j);
  }

  // Crank: dir +1 up, -1 down.
  crank(j, dir, dt) {
    const before = j.h;
    // going up under load is slower
    const loaded = j.h > JACK_LOW + 0.04;
    j.h = THREE.MathUtils.clamp(j.h + dir * dt * (dir > 0 ? (loaded ? 0.045 : 0.08) : 0.07), JACK_LOW, JACK_MAX);
    if (j.h !== before) {
      j.crank += dt * 6;
      if (Math.floor(j.crank) !== Math.floor(j.crank - dt * 6)) this.game.audio && this.game.audio.play('ratchet', { at: j.base, volume: 0.6 });
    }
  }

  update() {
    for (const j of this.list) {
      j.root.userData.pose(j.h);
      j.body.setNextKinematicTranslation({ x: j.base.x, y: j.base.y + j.h - 0.015, z: j.base.z });
    }
  }

  rebase(dx, dz) {
    for (const j of this.list) {
      j.base.x -= dx;
      j.base.z -= dz;
      j.root.position.copy(j.base);
    }
  }
}
