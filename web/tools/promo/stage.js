// Staging for promo shots and menu pictures (loaded into the page by tools/promo/shoot.mjs from
// the dev server; not part of the game). Friends are copies of the player's rigged body, dressed
// differently and posed by hand on top of the idle/walk clips: standing, walking, seated in a
// car, sitting on the ground, pushing, waving, holding things. Cars and items are placed in the
// world; the camera is set with look().

import * as THREE from 'three';
import { GlbAvatar } from '/src/player/glbAvatar.js';
import { initialState } from '/src/items/itemDefs.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// clothes: tints over the coat/jeans/boots texture, hat and beard on or off, skin tone
export const LOOKS = {
  drifter: { top: 0xffffff, bottom: 0xffffff, shoes: 0xffffff, hat: true, beard: true, skin: 0xffffff },
  flannel: { top: 0xff7a66, bottom: 0x8fa0c8, shoes: 0x9a8a7a, hat: false, beard: false, skin: 0xfff0e6 },
  ranger: { top: 0x9fb58a, bottom: 0xa69a86, shoes: 0x8a7a6a, hat: true, beard: true, skin: 0xe8c9b0 },
  denim: { top: 0x8aa6e0, bottom: 0x6f7a8a, shoes: 0xffffff, hat: false, beard: true, skin: 0xd9b49a },
  mustard: { top: 0xf2c86a, bottom: 0x7d6f62, shoes: 0x7a6a5a, hat: false, beard: false, skin: 0xffe2cc },
};

export class Stage {
  constructor(game) {
    this.g = game;
    this.friends = [];
    this.things = [];
  }

  // global x, z (and y) to the scene's local frame
  L(x, y, z) {
    return V(x - this.g.origin.x, y, z - this.g.origin.z);
  }

  // the ground under a local point (the terrain, not whatever stands on it)
  ground(lx, lz) {
    return this.g.gen.height(lx + this.g.origin.x, lz + this.g.origin.z);
  }

  // A spot on the road at global z: lane metres to the right of the centre line (driving north).
  road(z, lane = 0) {
    const gen = this.g.gen;
    const x = gen.roadX(z);
    const dx = gen.roadX(z + 2) - gen.roadX(z - 2);
    const yaw = Math.atan2(dx, 4);
    const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
    const right = V(-Math.cos(yaw), 0, Math.sin(yaw));
    const p = this.L(x, 0, z).addScaledVector(right, lane);
    p.y = this.ground(p.x, p.z);
    return { p, yaw, fwd, right };
  }

  // ---------------------------------------------------------------- cars
  // Puts a car at a local spot facing yaw (radians, 0 = +z), lets it settle on its springs.
  async placeCar(car, p, yaw, { roll = 0, settle = 1.5 } = {}) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, roll, 'YXZ'));
    const b = car.dyn.body;
    b.setEnabled(true);
    car.active = true;
    b.setTranslation({ x: p.x, y: p.y + (roll ? 2.2 : 0.75), z: p.z }, true);
    b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    car.parkBrake = true;
    car.syncVisual();
    await this.settle(settle);
    return car;
  }

  async newCar(type, p, yaw, opts = {}) {
    const car = this.g.fleet.create(type, p.clone(), new THREE.Quaternion().setFromAxisAngle(UP, yaw), { color: opts.color });
    car.owned = true;
    await this.placeCar(car, p, yaw, opts);
    return car;
  }

  // The top of an object (a car's bonnet or roof) under a world point, or null.
  topOf(obj, p) {
    obj.updateMatrixWorld(true);
    const rc = new THREE.Raycaster(V(p.x, p.y + 6, p.z), V(0, -1, 0), 0, 12);
    const hit = rc.intersectObject(obj, true).find((h) => h.object.visible && h.object.isMesh);
    return hit ? hit.point.y : null;
  }

  // A car-local point (x left, y up, z forward) in the world.
  on(car, x, y, z) {
    car.root.updateMatrixWorld(true);
    return V(x, y, z).applyMatrix4(car.root.matrixWorld);
  }

  open(car, id, t = 1) {
    const part = car.model.parts[id];
    if (!part || !part.hinge) return;
    car.model.setOpen(id, t);
    part.openT = t;
    part.targetOpen = t;
    car.rebuildColliders();
  }

  // A real prop from the library (tyre, oilDrum, trafficCone, ...) standing at p.
  prop(id, p, { yaw = 0, pitch = 0, roll = 0, scale = 1 } = {}) {
    const o = this.g.props.instance(id);
    if (!o) return null;
    o.position.copy(p);
    o.rotation.set(pitch, yaw, roll, 'YXZ');
    o.scale.multiplyScalar(scale);
    o.traverse((m) => {
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
    this.g.worldGroup.add(o);
    this.things.push(o);
    return o;
  }

  // Lets the world run a little (physics, streaming) without rendering; yields so the workers
  // can deliver.
  async settle(sec = 1, dt = 0.05) {
    const n = Math.max(1, Math.round(sec / 0.1));
    for (let i = 0; i < n; i++) {
      this.g.debugSimulate(0.1, dt);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  // ---------------------------------------------------------------- people
  friend(look = 'drifter') {
    const av = new GlbAvatar(this.g);
    if (!av.ok) throw new Error('avatar not loaded');
    // nothing of the player's (what they hold) leaks onto a friend
    av.g = Object.assign(Object.create(this.g), { interaction: null });
    dress(av.model, LOOKS[look] || LOOKS.drifter);
    this.g.worldGroup.add(av.root);
    const f = new Friend(this, av);
    this.friends.push(f);
    return f;
  }

  // An item mesh (no physics) placed in the world.
  item(id, p, { yaw = 0, pitch = 0, roll = 0, scale = 1, state = null } = {}) {
    const m = this.g.items.buildMesh(id, state || initialState(id, Math.random));
    m.position.copy(p);
    m.rotation.set(pitch, yaw, roll, 'YXZ');
    m.scale.setScalar(scale);
    m.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.g.worldGroup.add(m);
    this.things.push(m);
    return m;
  }

  // A piece of the scatter's scenery (a fallen log, a stump, a boulder) placed by hand.
  scenery(id, p, { yaw = 0, scale = 1, v = 0 } = {}) {
    const sc = this.g.scatter;
    const S = this._species || (this._species = import('/src/world/scatterGen.js'));
    return S.then(({ SPECIES }) => {
      const d = SPECIES.find((x) => x.id === id);
      const m = new THREE.Mesh(sc.geometryFor(d, v, 0), sc.materialFor(d, v));
      m.position.copy(p);
      m.rotation.y = yaw;
      m.scale.setScalar(scale);
      m.castShadow = m.receiveShadow = true;
      this.g.worldGroup.add(m);
      this.things.push(m);
      return m;
    });
  }

  // ---------------------------------------------------------------- the camera
  // Camera at `from` looking at `to` (local), vertical fov in degrees; hides the player's view.
  look(from, to, fov = 42, roll = 0) {
    const g = this.g;
    g.debugFov = fov;
    g.debugView = (cam) => {
      cam.position.copy(from);
      cam.up.set(0, 1, 0);
      cam.lookAt(to);
      if (roll) cam.rotateZ(roll);
      g.interaction.viewRoot.visible = false;
      if (g.npcs && g.npcs.avatar) g.npcs.avatar.root.visible = false;
    };
    g.hud && g.hud.show(false);
  }
}

function dress(model, look) {
  model.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name;
    const tint = (hex) => {
      o.material = o.material.clone();
      o.material.color.multiply(new THREE.Color(hex));
    };
    if (/Outfit_Top/.test(n)) tint(look.top);
    else if (/Outfit_Bottom/.test(n)) tint(look.bottom);
    else if (/Footwear/.test(n)) tint(look.shoes);
    else if (/Head$|Body$/.test(n)) tint(look.skin);
    else if (/Beard/.test(n)) o.visible = !!look.beard;
    else if (n === 'Mesh') o.visible = !!look.hat;
  });
}

class Friend {
  constructor(stage, av) {
    this.s = stage;
    this.av = av;
    this.B = av.bones;
  }

  frame() {
    const q = this.av.root.quaternion;
    return { up: UP.clone(), fwd: V(0, 0, 1).applyQuaternion(q), right: V(-1, 0, 0).applyQuaternion(q) };
  }

  // Standing at a local spot (feet), facing yaw. walk: 0 idle .. 1 walking .. 2 running; t: the
  // moment of the clip (a stride, a breath).
  stand(p, yaw, { walk = 0, t = 0, crouch = 0, pitch = 0 } = {}) {
    const av = this.av;
    av.yaw = yaw;
    av.speed = walk <= 0 ? 0 : walk <= 1 ? 1.5 * walk : 1.5 + (walk - 1) * 4;
    for (const a of Object.values(av.act)) a.time = t % a.getClip().duration;
    av.sync(0, { seat: null, position: p, velocity: V(Math.sin(yaw) * av.speed, 0, Math.cos(yaw) * av.speed), yaw, pitch, crouch, dead: false });
    return this;
  }

  // In a car's seat (driver: hands on the wheel).
  seat(car, seat, { yaw = 0, pitch = -0.05 } = {}) {
    const av = this.av;
    for (const a of Object.values(av.act)) a.time = 0.4;
    car.root.updateMatrixWorld(true);
    av.sync(0, { seat, car, seatYaw: yaw, seatPitch: pitch });
    return this;
  }

  // Sitting on something `h` m above the ground at local p (where the seat is), facing yaw.
  // feet: how far ahead they rest; hands: 'knees' or 'back' (leaning back on them).
  sit(p, yaw, { h = 0.42, feet = 0.55, spread = 0.2, lean = 0.12, hands = 'knees', groundY = null } = {}) {
    this.stand(p, yaw);
    const av = this.av,
      B = this.B;
    const { up, fwd, right } = this.frame();
    av.root.updateMatrixWorld(true);
    const hip = B.hips.getWorldPosition(V());
    const gy = groundY ?? p.y;
    av.root.position.y += gy + h - hip.y;
    av.root.updateMatrixWorld(true);
    // (a turn about the body's right with a negative angle bends it forward, as GlbAvatar's
    // crouch does)
    this.turn(B.spine, right, -lean);
    const H = B.hips.getWorldPosition(V());
    for (const [s, sg] of [
      ['L', -1],
      ['R', 1],
    ]) {
      const foot = H.clone()
        .addScaledVector(fwd, feet)
        .addScaledVector(right, sg * spread);
      foot.y = gy + 0.09;
      av.reach(B['thigh' + s], B['shin' + s], B['foot' + s], foot, up.clone().addScaledVector(fwd, 0.7));
      av.aim(B['foot' + s], B['toe' + s], fwd.clone().addScaledVector(up, -0.3));
    }
    if (hands === 'knees') {
      for (const [s, sg] of [
        ['L', -1],
        ['R', 1],
      ]) {
        const knee = B['shin' + s].getWorldPosition(V());
        this.hand(s, knee.addScaledVector(up, 0.06).addScaledVector(fwd, -0.04), right.clone().multiplyScalar(sg).addScaledVector(up, -0.6));
      }
    } else if (hands === 'back') {
      for (const [s, sg] of [
        ['L', -1],
        ['R', 1],
      ]) {
        const t = H.clone().addScaledVector(fwd, -0.32).addScaledVector(right, sg * 0.28);
        t.y = gy + h + 0.02;
        this.hand(s, t, right.clone().multiplyScalar(sg).addScaledVector(fwd, -1));
      }
    }
    return this;
  }

  turn(bone, axis, angle) {
    this.av.turnAxis(bone, axis, angle);
    return this;
  }

  // A hand (s: 'L' or 'R') to a world point, the elbow towards `pole`.
  hand(s, target, pole) {
    const B = this.B,
      av = this.av;
    av.reach(B['upperArm' + s], B['foreArm' + s], B['hand' + s], target, pole);
    // the hand carries on along the forearm
    const e = B['hand' + s].getWorldPosition(V()),
      w = B['foreArm' + s].getWorldPosition(V());
    av.aim(B['hand' + s], B['finger' + s], e.sub(w));
    return this;
  }

  // Hand up in a wave (or pointing at `at`).
  wave(s = 'R', at = null) {
    const B = this.B;
    const { up, fwd, right } = this.frame();
    const sg = s === 'R' ? 1 : -1;
    const sh = B['upperArm' + s].getWorldPosition(V());
    const t = at ? sh.clone().add(at.clone().sub(sh).setLength(0.62)) : sh.clone().addScaledVector(up, 0.5).addScaledVector(right, sg * 0.28).addScaledVector(fwd, 0.12);
    return this.hand(s, t, right.clone().multiplyScalar(sg).addScaledVector(up, -0.5));
  }

  // Both hands flat on a surface ahead (pushing a car, leaning on a bonnet).
  push(left, right2, lean = 0.45) {
    const { right } = this.frame();
    this.turn(this.B.spine, right, -lean);
    this.hand('L', left, right.clone().negate().addScaledVector(UP, -1));
    this.hand('R', right2, right.clone().addScaledVector(UP, -1));
    return this;
  }

  // Head (and a little of the neck) turned to look at a world point.
  lookAt(target) {
    const B = this.B;
    const { up, fwd, right } = this.frame();
    const head = B.head.getWorldPosition(V());
    const d = target.clone().sub(head);
    const yaw = Math.atan2(d.dot(right) * -1, d.dot(fwd));
    const flat = Math.hypot(d.dot(right), d.dot(fwd));
    const pitch = Math.atan2(d.y, flat);
    const y = Math.max(-1.1, Math.min(1.1, yaw));
    this.turn(B.neck, up, y * 0.35);
    this.turn(B.head, up, y * 0.55);
    // up and down about the body's right, as the player's own head is turned (GlbAvatar.sync)
    const p = Math.max(-0.8, Math.min(0.8, pitch));
    const side = right.clone().applyAxisAngle(up, y * 0.9);
    this.turn(B.neck, side, p * 0.35);
    this.turn(B.head, side, p * 0.5);
    return this;
  }

  // The palm of a hand (between the wrist and the knuckles), world.
  palm(s = 'R') {
    return this.B['hand' + s].getWorldPosition(V()).lerp(this.B['finger' + s].getWorldPosition(V()), 0.55);
  }

  // Something held: an item mesh at the palm, upright (or turned by opts).
  hold(id, s = 'R', opts = {}) {
    const p = this.palm(s).add(opts.offset || V());
    return this.s.item(id, p, opts);
  }
}
