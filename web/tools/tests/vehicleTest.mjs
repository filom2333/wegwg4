// Headless vehicle dynamics tests: acceleration, braking, steady-state cornering, slalom, rollover checks.
import * as THREE from 'three';
import { Physics, RAPIER, GROUPS } from '../../src/physics/physics.js';
import { VehicleDynamics } from '../../src/physics/vehicleDynamics.js';

const physics = await Physics.create();
const ground = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
physics.world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0).setCollisionGroups(GROUPS.world), ground);

function makeCar(opts = {}) {
  const v = new VehicleDynamics(physics, {
    position: new THREE.Vector3(0, 0.05, 0),
    hardpoints: [
      { id: 'wheel_FL', x: 0.745, z: 1.3, steer: true, drive: true },
      { id: 'wheel_FR', x: -0.745, z: 1.3, steer: true, drive: true },
      { id: 'wheel_RL', x: 0.745, z: -1.3 },
      { id: 'wheel_RR', x: -0.745, z: -1.3 },
    ],
    massProps: { mass: 1180, com: new THREE.Vector3(0, 0.52, 0.2) },
    colliders: [
      { box: [0.85, 0.3, 2.2], pos: [0, 0.6, 0] },
      { box: [0.7, 0.25, 1.1], pos: [0, 1.15, -0.3] },
    ],
  });
  v.surfaceAt = () => opts.surface || 'asphalt';
  v.wet = opts.wet || 0;
  return v;
}

function run(v, seconds, ctrl) {
  const n = Math.round(seconds * 120);
  const log = [];
  for (let i = 0; i < n; i++) {
    const t = i / 120;
    Object.assign(v.controls, ctrl(t, v));
    physics.update(1 / 120);
    const r = v.body.rotation();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    if (i % 60 === 0) log.push({ t: +t.toFixed(2), kmh: +(v.forwardSpeed * 3.6).toFixed(1), rpm: Math.round(v.engine.rpm), gear: v.gearLabel(), upY: +up.y.toFixed(3), y: +v.body.translation().y.toFixed(3) });
    if (up.y < 0.3) return { rolled: true, t, log };
  }
  return { rolled: false, log };
}

function reset(v, speedKmh = 0, heading = 0) {
  v.body.setTranslation({ x: 0, y: 0.02, z: 0 }, true);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
  v.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(speedKmh / 3.6);
  v.body.setLinvel({ x: f.x, y: 0, z: f.z }, true);
  v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  for (const w of v.wheels) {
    w.omega = speedKmh / 3.6 / 0.316;
    w.compression = 0.098;
    w.prevCompression = 0.098;
  }
}

const car = makeCar();
car.startEngine();
// settle
run(car, 1.5, () => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0 }));
console.log('rest height y', car.body.translation().y.toFixed(3), 'compressions', car.wheels.map((w) => w.compression.toFixed(3)).join(' '));

// 0-100
let t100 = null;
let res = run(car, 25, (t, v) => {
  if (t100 === null && v.forwardSpeed * 3.6 >= 100) t100 = t;
  return { throttle: 1, brake: 0, steer: 0 };
});
console.log('0-100 km/h:', t100 && t100.toFixed(1) + ' s', 'speed after 25s', (car.forwardSpeed * 3.6).toFixed(0), 'km/h');
// braking from current speed
const v0 = car.forwardSpeed;
const z0 = car.body.translation().z;
let stopT = null;
run(car, 8, (t, v) => {
  if (stopT === null && v.forwardSpeed < 0.3) stopT = t;
  return { throttle: 0, brake: 1, steer: 0 };
});
console.log('braking from', (v0 * 3.6).toFixed(0), 'km/h: distance', (car.body.translation().z - z0).toFixed(1), 'm time', stopT && stopT.toFixed(2));

// steady state full-lock steering at several speeds (keyboard style: steer=1)
for (const surface of ['asphalt', 'dirt']) {
  for (const wet of [0, 1]) {
    const c2 = makeCar({ surface, wet });
    c2.startEngine();
    for (const kmh of [40, 60, 90, 120]) {
      reset(c2, kmh);
      c2.gear = kmh > 100 ? 6 : kmh > 70 ? 5 : 4;
      const r = run(c2, 5, (t) => ({ throttle: 0.5, brake: 0, steer: t > 0.2 ? 1 : 0 }));
      const latA = c2.wheels.reduce((a, w) => a + w.latForce, 0) / c2.mass;
      console.log(`${surface}${wet ? ' wet' : ''} full-steer @${kmh}: rolled=${r.rolled} final speed=${(c2.forwardSpeed * 3.6).toFixed(0)} latG=${(latA / 9.81).toFixed(2)} upY=${r.log[r.log.length - 1].upY}`);
    }
    // aggressive slalom at 100
    reset(c2, 100);
    c2.gear = 5;
    const r2 = run(c2, 6, (t) => ({ throttle: 0.6, steer: Math.sign(Math.sin(t * Math.PI * 1.2)), brake: 0 }));
    console.log(`${surface}${wet ? ' wet' : ''} slalom @100: rolled=${r2.rolled} upY min=${Math.min(...r2.log.map((l) => l.upY))}`);
    c2.dispose();
  }
}
