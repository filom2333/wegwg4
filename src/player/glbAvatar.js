// The player's body for the third-person camera, from a real rigged model: a Ready Player Me
// avatar (three.js examples) moved by the Soldier's Mixamo clips, retargeted onto it once at load.
// Idle, walk and run blend by speed; on the seat the legs reach for the pedals and the hands hold
// the rim (two-bone IK, so nothing goes through the floor or the wheel); big carried things are
// held at their sides; the head follows the view; a fall when you die. Same surface as
// PlayerAvatar (root, pos, bones.handR, sync, handWorld), so the rest of the game does not care
// which it gets.

import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const Y = V(0, 1, 0);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();

// Clips made for a Mixamo rig (bones 'mixamorig' + name) re-expressed for another rig with the
// same bone names: each bone takes the source's world-space turn away from its T-pose. Rest
// postures may differ (A-pose against T-pose): every target bone is first swung to point where
// the source's does in its T-pose. Hip height scales with leg length; the rest is rotation only.
export function retargetClips(srcRoot, clips, dstRoot, { names = ['Idle', 'Walk', 'Run'], rest = 'TPose', fps = 30 } = {}) {
  const mixer = new THREE.AnimationMixer(srcRoot);
  const tpose = clips.find((c) => c.name === rest);
  if (tpose) mixer.clipAction(tpose).play();
  mixer.setTime(0);
  srcRoot.updateMatrixWorld(true);
  dstRoot.updateMatrixWorld(true);
  const S = (n) => srcRoot.getObjectByName('mixamorig' + n);
  const pos = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  const rot = (o) => {
    o.matrixWorld.decompose(_a, _q2, _s);
    return _q2.clone();
  };
  // which way each rig faces, from the left foot to its toes
  const fwd = (root, pre) => {
    const f = root.getObjectByName(pre + 'LeftFoot'),
      t = root.getObjectByName(pre + 'LeftToeBase');
    return f && t ? pos(t).sub(pos(f)) : V(0, 0, 1);
  };
  const fs = fwd(srcRoot, 'mixamorig'),
    fd = fwd(dstRoot, '');
  const A = new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(fd.x, fd.z) - Math.atan2(fs.x, fs.z));
  const Ai = A.clone().invert();
  const list = [];
  const index = new Map();
  dstRoot.traverse((d) => {
    if (!d.isBone) return;
    const s = S(d.name);
    if (!s) return;
    index.set(d, list.length);
    list.push({ d, s });
  });
  const lead = (d) => {
    const kids = d.children.filter((c) => c.isBone && S(c.name));
    return kids.find((c) => /Spine|Neck|Head$|Middle1|LeftLeg$|RightLeg$|Foot$|ToeBase$|Arm$|ForeArm$|Hand$/.test(c.name)) || kids[0];
  };
  for (const b of list) {
    b.Rs = rot(b.s);
    b.Rt = rot(b.d);
    // swing the target bone onto the source's rest direction
    const k = lead(b.d);
    if (k) {
      const ds = pos(S(k.name)).sub(pos(b.s)).applyQuaternion(A).normalize();
      const dt = pos(k).sub(pos(b.d)).normalize();
      b.Rt.premultiply(new THREE.Quaternion().setFromUnitVectors(dt, ds));
    }
    b.RsI = b.Rs.clone().invert();
    const pi = index.get(b.d.parent);
    b.parent = pi === undefined ? -1 : pi;
    if (b.parent < 0) b.Pw = rot(b.d.parent);
  }
  // hips: height above the toes sets the stride scale
  const hipS = S('Hips'),
    hipD = dstRoot.getObjectByName('Hips');
  const toeS = S('LeftToeBase'),
    toeD = dstRoot.getObjectByName('LeftToeBase');
  const restS = pos(hipS),
    restD = pos(hipD);
  const ratio = (restD.y - pos(toeD).y) / Math.max(1e-4, restS.y - pos(toeS).y);
  const hipParentInv = hipD.parent.matrixWorld.clone().invert();

  const out = [];
  const W = list.map(() => new THREE.Quaternion());
  for (const name of names) {
    const clip = clips.find((c) => c.name === name);
    if (!clip) continue;
    mixer.stopAllAction();
    mixer.clipAction(clip).play();
    const n = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(n);
    const vals = list.map(() => new Float32Array(n * 4));
    const hp = [];
    for (let i = 0; i < n; i++) {
      const t = Math.min(clip.duration, i / fps);
      times[i] = t;
      mixer.setTime(t);
      srcRoot.updateMatrixWorld(true);
      list.forEach((b, j) => {
        // world turn away from the T-pose, carried into the target's facing
        const D = rot(b.s).multiply(b.RsI);
        const Wt = A.clone().multiply(D).multiply(Ai).multiply(b.Rt);
        W[j].copy(Wt);
        const P = b.parent >= 0 ? W[b.parent] : b.Pw;
        const L = P.clone().invert().multiply(Wt);
        const v = vals[j];
        // keep neighbouring keys on the same side of the sphere
        if (i > 0 && L.x * v[i * 4 - 4] + L.y * v[i * 4 - 3] + L.z * v[i * 4 - 2] + L.w * v[i * 4 - 1] < 0) L.set(-L.x, -L.y, -L.z, -L.w);
        v.set([L.x, L.y, L.z, L.w], i * 4);
      });
      hp.push(pos(hipS).sub(restS).applyQuaternion(A).multiplyScalar(ratio));
    }
    // in place: the clip's mean drift across the ground comes out
    const mean = hp.reduce((m, p) => m.add(p), V(0, 0, 0)).multiplyScalar(1 / hp.length);
    const pv = new Float32Array(n * 3);
    hp.forEach((p, i) => {
      const w = restD.clone().add(V(p.x - mean.x, p.y, p.z - mean.z)).applyMatrix4(hipParentInv);
      pv.set([w.x, w.y, w.z], i * 3);
    });
    const tracks = list.map((b, j) => new THREE.QuaternionKeyframeTrack(b.d.name + '.quaternion', times, vals[j]));
    tracks.push(new THREE.VectorKeyframeTrack(hipD.name + '.position', times, pv));
    out.push(new THREE.AnimationClip(name, clip.duration, tracks));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(srcRoot);
  return out;
}

export class GlbAvatar {
  constructor(game) {
    this.g = game;
    this.root = new THREE.Group();
    this.root.name = 'playerAvatar';
    this.model = game.props.instance('survivor');
    this.ok = false;
    if (!this.model) return;
    // the model faces +z, as the player's yaw 0 and the car's nose do
    this.root.add(this.model);
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.death = -1;
    const b = (n) => this.model.getObjectByName(n);
    this.bones = {
      hips: b('Hips'),
      spine: b('Spine1'),
      chest: b('Spine2'),
      neck: b('Neck'),
      head: b('Head'),
      eye: b('LeftEye'),
      upperArmL: b('LeftArm'),
      upperArmR: b('RightArm'),
      foreArmL: b('LeftForeArm'),
      foreArmR: b('RightForeArm'),
      handL: b('LeftHand'),
      handR: b('RightHand'),
      fingerL: b('LeftHandMiddle1'),
      fingerR: b('RightHandMiddle1'),
      thighL: b('LeftUpLeg'),
      thighR: b('RightUpLeg'),
      shinL: b('LeftLeg'),
      shinR: b('RightLeg'),
      footL: b('LeftFoot'),
      footR: b('RightFoot'),
      toeL: b('LeftToeBase'),
      toeR: b('RightToeBase'),
    };
    const B = this.bones;
    if (Object.values(B).some((x) => !x)) return;
    // rest measurements, in metres in the root's frame
    this.root.updateMatrixWorld(true);
    const wp = (o) => o.getWorldPosition(V());
    this.hipsY = wp(B.hips).y;
    this.eyeY = wp(B.eye).y;
    this.len = new Map();
    for (const [u, l] of [
      ['upperArm', 'foreArm'],
      ['foreArm', 'hand'],
      ['thigh', 'shin'],
      ['shin', 'foot'],
    ])
      for (const s of ['L', 'R']) this.len.set(B[u + s], wp(B[l + s]).distanceTo(wp(B[u + s])));
    // the motion: retargeted once per game from the Soldier's clips
    const proto = game.props.protos.get('survivor');
    const anim = game.props.protos.get('survivorAnim');
    if (proto && !proto.retargeted) proto.retargeted = anim ? retargetClips(anim.root, anim.clips, this.model) : [];
    this.mixer = new THREE.AnimationMixer(this.model);
    this.act = {};
    for (const c of proto ? proto.retargeted : []) {
      const a = this.mixer.clipAction(c);
      a.play();
      a.setEffectiveWeight(c.name === 'Idle' ? 1 : 0);
      this.act[c.name] = a;
    }
    this.ok = !!this.act.Idle;
  }

  // ---------------------------------------------------------------- posing helpers
  // Turn a bone by `q` about world axes, on top of what the animation gave it.
  turnWorld(bone, q) {
    bone.parent.getWorldQuaternion(_q2);
    const t = _q2.clone().invert().multiply(q).multiply(_q2);
    bone.quaternion.premultiply(t);
    bone.updateMatrixWorld(true);
  }

  turnAxis(bone, axis, angle) {
    this.turnWorld(bone, _q.setFromAxisAngle(axis, angle));
  }

  // Swing a bone so that its child lies along `dir` (world).
  aim(bone, child, dir) {
    bone.updateWorldMatrix(true, false);
    const p = bone.getWorldPosition(_a);
    const cur = child.getWorldPosition(_b).sub(p).normalize();
    this.turnWorld(bone, _q.setFromUnitVectors(cur, _c.copy(dir).normalize()));
  }

  // Two-bone reach: upper -> lower -> end onto `target`, the middle joint bending toward `pole`.
  reach(upper, lower, end, target, pole) {
    upper.updateWorldMatrix(true, false);
    const S = upper.getWorldPosition(V());
    const a = this.len.get(upper),
      b = this.len.get(lower);
    const d = target.clone().sub(S);
    const dist = Math.min(Math.max(d.length(), Math.abs(a - b) + 0.01), (a + b) * 0.999);
    const n = d.normalize();
    const x = (a * a - b * b + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const p = pole.clone().addScaledVector(n, -pole.dot(n)).normalize();
    const E = S.clone().addScaledVector(n, x).addScaledVector(p, h);
    this.aim(upper, lower, E.clone().sub(S));
    this.aim(lower, end, S.addScaledVector(n, dist).sub(E));
  }

  // ---------------------------------------------------------------- frame
  sync(dt, player) {
    if (!this.ok) return;
    const A = this.act;
    if (player.seat && player.car) {
      const car = player.car;
      const q = car.root.quaternion;
      // the pelvis on the cushion, 0.6 m under the eye point and a little behind it
      const hip = car.seatWorld(player.seat).add(V(0, -0.62, -0.02).applyQuaternion(q));
      this.pos.copy(hip).addScaledVector(V(0, 1, 0).applyQuaternion(q), -this.hipsY);
      this.root.position.copy(this.pos);
      this.root.quaternion.copy(q);
      this.root.updateMatrixWorld(true);
      this.speed = 0;
      this.weights(1, 0, 0);
      this.mixer.update(dt);
      this.model.updateMatrixWorld(true);
      this.seatedPose(player, car);
    } else {
      const p = player.position;
      const v = player.velocity;
      const s = Math.hypot(v.x, v.z);
      this.speed += (s - this.speed) * Math.min(1, dt * 8);
      this.pos.set(p.x, p.y - player.crouch * 0.25, p.z);
      const want = player.yaw;
      this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * Math.min(1, dt * 8);
      this.root.position.copy(this.pos);
      this.root.quaternion.setFromAxisAngle(Y, this.yaw);
      this.root.updateMatrixWorld(true);
      const run = smooth(3.4, 5.2, this.speed),
        walk = smooth(0.25, 1.4, this.speed) * (1 - run);
      this.weights(1 - walk - run, walk, run);
      if (A.Walk) A.Walk.timeScale = Math.max(0.6, this.speed / 1.5);
      if (A.Run) A.Run.timeScale = Math.max(0.7, this.speed / 5.4);
      this.mixer.update(dt);
      this.model.updateMatrixWorld(true);
      const B = this.bones;
      const side = V(-1, 0, 0).applyQuaternion(this.root.quaternion);
      // crouching: knees bent, back forward
      if (player.crouch > 0.05) {
        const c = player.crouch;
        this.turnAxis(B.thighL, side, 0.9 * c);
        this.turnAxis(B.thighR, side, 0.9 * c);
        this.turnAxis(B.shinL, side, -1.3 * c);
        this.turnAxis(B.shinR, side, -1.3 * c);
        this.turnAxis(B.spine, side, -0.35 * c);
      }
      // head follows the view up and down
      this.turnAxis(B.neck, side, player.pitch * 0.3);
      this.turnAxis(B.head, side, player.pitch * 0.4);
      this.holdPose(player);
      if (player.dead) {
        if (this.death < 0) this.death = 0;
        this.death = Math.min(1, this.death + dt / 0.9);
        const t = this.death * this.death;
        this.root.rotateX(-t * Math.PI * 0.5);
        this.root.position.y += t * 0.15;
      } else this.death = -1;
    }
    this.root.updateMatrixWorld(true);
  }

  weights(idle, walk, run) {
    const A = this.act;
    A.Idle && A.Idle.setEffectiveWeight(Math.max(0, idle));
    A.Walk && A.Walk.setEffectiveWeight(Math.max(0, walk));
    A.Run && A.Run.setEffectiveWeight(Math.max(0, run));
  }

  // On the seat: feet on the floor ahead (pedals for the driver), back against the seat, hands
  // on the rim at ten-to-two turning with it, or resting on the thighs.
  seatedPose(player, car) {
    const B = this.bones;
    const q = car.root.quaternion;
    const up = V(0, 1, 0).applyQuaternion(q),
      fwd = V(0, 0, 1).applyQuaternion(q),
      right = V(-1, 0, 0).applyQuaternion(q);
    const front = player.seat === 'driver' || player.seat === 'passenger';
    const floorY = (car.type.cabin ? car.type.cabin.y0 : 0.25) + 0.1;
    this.turnAxis(B.spine, right, 0.08);
    for (const [s, sg] of [
      ['L', -1],
      ['R', 1],
    ]) {
      const hipW = B['thigh' + s].getWorldPosition(V());
      const hipL = car.root.worldToLocal(hipW.clone());
      const foot = car.root.localToWorld(V(hipL.x - sg * 0.04, floorY, hipL.z + (front ? 0.82 : 0.55)));
      this.reach(B['thigh' + s], B['shin' + s], B['foot' + s], foot, up.clone().addScaledVector(fwd, 0.6));
      // sole flat, toes ahead
      this.aim(B['foot' + s], B['toe' + s], fwd.clone().addScaledVector(up, -0.35));
    }
    const driving = player.seat === 'driver' && car.isInstalled('steeringWheel') && car.model.steeringWheel;
    if (driving) {
      const sw = car.model.steeringWheel;
      const wheelObj = sw.children[0];
      sw.updateMatrixWorld(true);
      const R = car.type.DRIVER.rimRadius;
      const turn = Math.max(-0.85, Math.min(0.85, wheelObj ? wheelObj.rotation.z : 0));
      for (const [s, a0] of [
        ['L', Math.PI - 0.5],
        ['R', 0.5],
      ]) {
        const a = a0 + turn;
        const grip = V(Math.cos(a) * R, Math.sin(a) * R, 0).applyMatrix4(sw.matrixWorld);
        const sh = B['upperArm' + s].getWorldPosition(V());
        // the wrist sits a hand's width short of the rim, toward the shoulder
        const wrist = grip.clone().addScaledVector(sh.clone().sub(grip).normalize(), 0.07);
        const out = s === 'L' ? right.clone().negate() : right.clone();
        this.reach(B['upperArm' + s], B['foreArm' + s], B['hand' + s], wrist, out.addScaledVector(up, -1));
        this.aim(B['hand' + s], B['finger' + s], grip.clone().sub(wrist));
      }
    } else {
      for (const [s, sg] of [
        ['L', -1],
        ['R', 1],
      ]) {
        // hands on the thighs
        const knee = B['shin' + s].getWorldPosition(V());
        const hipW = B['thigh' + s].getWorldPosition(V());
        const rest = hipW.lerp(knee, 0.62).addScaledVector(up, 0.07).addScaledVector(right, sg * 0.02);
        const out = s === 'L' ? right.clone().negate() : right.clone();
        this.reach(B['upperArm' + s], B['foreArm' + s], B['hand' + s], rest, out.addScaledVector(up, -1).addScaledVector(fwd, -0.4));
        this.aim(B['hand' + s], B['finger' + s], fwd.clone().addScaledVector(up, -0.3));
      }
    }
    this.turnAxis(B.head, up, player.seatYaw * 0.7);
    this.turnAxis(B.head, right, player.seatPitch * 0.5);
  }

  // Something carried: big things held at their sides in front, small ones in the right hand
  // ahead of the chest, guns brought up to the eye when aiming.
  holdPose(player) {
    const ia = this.g.interaction;
    const it = ia && ia.held;
    if (!it && ia && ia.fists && !player.seat) return this.fistPose(ia);
    if (!it) return;
    const B = this.bones;
    const qr = this.root.quaternion;
    const up = V(0, 1, 0),
      fwd = V(0, 0, 1).applyQuaternion(qr),
      right = V(-1, 0, 0).applyQuaternion(qr);
    const weapon = it.def && it.def.weapon;
    const big = it.part || (it.size && Math.max(it.size.x, it.size.y, it.size.z) > 0.55 && !weapon);
    const chest = B.chest.getWorldPosition(V());
    if (big && it.mesh) {
      // palms on the item's flanks, at its centre height
      const c = it.mesh.getWorldPosition(V());
      const toItem = c.clone().sub(chest);
      if (toItem.length() > 1.2) toItem.setLength(1.2);
      c.copy(chest).add(toItem);
      const half = Math.min(0.32, Math.max(0.14, (it.size ? Math.max(it.size.x, it.size.z) : 0.4) * 0.5));
      for (const [s, sg] of [
        ['L', -1],
        ['R', 1],
      ]) {
        const t = c.clone().addScaledVector(right, sg * (half + 0.03));
        this.reach(B['upperArm' + s], B['foreArm' + s], B['hand' + s], t, right.clone().multiplyScalar(sg).addScaledVector(up, -1));
        this.aim(B['hand' + s], B['finger' + s], fwd.clone().addScaledVector(right, -sg * 0.6));
      }
    } else if (weapon) {
      const aim = ia.aim || 0;
      const look = fwd.clone().applyAxisAngle(right, player.pitch * aim);
      const t = chest.clone().addScaledVector(up, 0.12 * aim).addScaledVector(look, 0.38 + 0.12 * aim).addScaledVector(right, 0.12 - 0.08 * aim);
      this.reach(B.upperArmR, B.foreArmR, B.handR, t, right.clone().addScaledVector(up, -1));
      this.aim(B.handR, B.fingerR, look);
      if (it.def.weapon.ammo === '12' || aim > 0.5) {
        const t2 = t.clone().addScaledVector(look, 0.3).addScaledVector(right, -0.1).addScaledVector(up, -0.05);
        this.reach(B.upperArmL, B.foreArmL, B.handL, t2, right.clone().negate().addScaledVector(up, -1));
      }
    } else {
      // held out in front (wheel), the arm goes with it, so others see where it is
      const out = ia.floating ? Math.min(1, Math.max(0, (ia.holdDist - 0.38) / 0.34)) : 0;
      const t = chest
        .clone()
        .addScaledVector(fwd, 0.34 + 0.24 * out)
        .addScaledVector(up, -0.22 + 0.14 * out)
        .addScaledVector(right, 0.16 - 0.08 * out);
      this.reach(B.upperArmR, B.foreArmR, B.handR, t, right.clone().addScaledVector(up, -1));
      this.aim(B.handR, B.fingerR, fwd.clone().addScaledVector(up, -0.2));
    }
  }

  // Fists up in front of the chest; the punching one goes out at the face height of whoever is in
  // front and comes back.
  fistPose(ia) {
    const B = this.bones;
    const qr = this.root.quaternion;
    const up = V(0, 1, 0),
      fwd = V(0, 0, 1).applyQuaternion(qr),
      right = V(-1, 0, 0).applyQuaternion(qr);
    const chest = B.chest.getWorldPosition(V());
    const P = ia.punch;
    const out = P.t < 0.32 ? 1 - Math.pow(1 - P.t / 0.32, 2) : P.t < 0.42 ? 1 : Math.max(0, 1 - (P.t - 0.42) / 0.58);
    for (const [s, sg, side] of [
      ['L', -1, 'left'],
      ['R', 1, 'right'],
    ]) {
      const k = P.side === side && P.t < 1 ? out : 0;
      const t = chest
        .clone()
        .addScaledVector(fwd, 0.28 + 0.3 * k)
        .addScaledVector(up, 0.06 + 0.06 * k)
        .addScaledVector(right, sg * (0.14 - 0.1 * k));
      this.reach(B['upperArm' + s], B['foreArm' + s], B['hand' + s], t, right.clone().multiplyScalar(sg).addScaledVector(up, -1));
      this.aim(B['hand' + s], B['finger' + s], fwd.clone().addScaledVector(up, 0.15));
    }
  }

  handWorld(out = V()) {
    return this.bones.handR.getWorldPosition(out);
  }
}
