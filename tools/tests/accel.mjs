import * as THREE from 'three';
import { Physics, RAPIER, GROUPS } from '../../src/physics/physics.js';
import { VehicleDynamics } from '../../src/physics/vehicleDynamics.js';
const physics = await Physics.create();
const ground = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
physics.world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0).setCollisionGroups(GROUPS.world), ground);
const v = new VehicleDynamics(physics, { position: new THREE.Vector3(0, 0.05, 0), hardpoints: [
  { id: 'wheel_FL', x: 0.745, z: 1.3, steer: true, drive: true }, { id: 'wheel_FR', x: -0.745, z: 1.3, steer: true, drive: true },
  { id: 'wheel_RL', x: 0.745, z: -1.3 }, { id: 'wheel_RR', x: -0.745, z: -1.3 }],
  massProps: { mass: 1180, com: new THREE.Vector3(0, 0.52, 0.2) }, colliders: [{ box: [0.85, 0.3, 2.2], pos: [0, 0.6, 0] }] });
v.startEngine();
for (let i=0;i<180;i++) physics.update(1/120);
for (let i=0;i<120*40;i++){ v.controls.throttle=1; physics.update(1/120); if(i%60===0){ const fl=v.wheels[0]; console.log((i/120).toFixed(1),'kmh',(v.forwardSpeed*3.6).toFixed(1),'rpm',Math.round(v.engine.rpm),'gear',v.gearLabel(),'clutch',v.clutch.toFixed(2),'slip',fl.slipRatio.toFixed(3),'Fx',(fl.longForce).toFixed(0),'Te',v.engine.torqueOut.toFixed(0)); } }
