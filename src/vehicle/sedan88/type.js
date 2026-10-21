// The '88 sedan: a big front-drive American four-door with a 3.0 V6 and an automatic box.
// Model: "88 American Sedan - Low poly model" by Daniel Zhabotinsky, CC-BY-4.0, converted by
// tools/cars/sedan88.py (measurements in sedan88Meta.json).

import * as THREE from 'three';
import META from './sedan88Meta.json';
import { wheelSpec, hardpoints, driverOf, autoBoxes } from '../imported/specKit.js';
import { frontEngineParts } from '../imported/frontEngineParts.js';
import { loadImportedAsset, createImportedMaterials, buildImportedModel, buildImportedWreck } from '../imported/importedCar.js';
import * as PP from '../imported/procParts.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

const SPEC = wheelSpec(META);
const DRIVER = driverOf(META, { eyeY: 1.12, eyeZ: -0.1, shoulderY: 0.87, shoulderZ: -0.17, shoulderHalf: 0.2 });
const sw = META.steeringWheel;
const CONTROLS = {
  key: V(0.21, 0.74, 0.55),
  stalk: V(sw.center[0] + 0.12, 0.8, 0.5),
  shifter: V(sw.center[0] - 0.13, 0.84, 0.47), // column selector
  handbrake: V(0.56, 0.42, 0.72), // foot-operated parking brake
  horn: V(...sw.center).addScaledVector(V(...sw.axis).normalize(), 0.04),
};
const SEATS = {
  driver: { pos: DRIVER.eye.clone(), door: 'door_FL', part: 'seat_FL', exit: V(1.45, 0.0, 0.15) },
  passenger: { pos: V(-sw.center[0], 1.12, -0.1), door: 'door_FR', part: 'seat_FR', exit: V(-1.45, 0.0, 0.15) },
  rearL: { pos: V(0.36, 1.1, -0.82), door: 'door_RL', part: 'seat_R', exit: V(1.45, 0.0, -0.75) },
  rearR: { pos: V(-0.36, 1.1, -0.82), door: 'door_RR', part: 'seat_R', exit: V(-1.45, 0.0, -0.75) },
};
const STEREO = { center: [0, 0.745, 0.77], normal: [0, 0.2, -1], w: 0.08, h: 0.018 };
const HOTSPOTS = [
  { id: 'fuel', label: 'Fuel filler', pos: V(0.86, 0.86, -1.6), r: 0.12, part: 'fueltank' },
  { id: 'oil', label: 'Oil filler', pos: V(0.2, 0.86, 1.35), r: 0.1, part: 'engine', lid: 'hood' },
  { id: 'coolant', label: 'Radiator cap', pos: V(0.33, 0.76, 1.95), r: 0.1, part: 'radiator', lid: 'hood' },
  { id: 'battery', label: 'Battery', pos: V(0.5, 0.78, 1.74), r: 0.13, part: 'battery', lid: 'hood' },
  { id: 'ignition', label: 'Ignition', pos: CONTROLS.key.clone(), r: 0.06, part: 'steeringWheel', inside: true },
  { id: 'lights', label: 'Light switch', pos: V(0.6, 0.82, 0.62), r: 0.05, part: 'body', inside: true },
  { id: 'wipers', label: 'Wiper switch', pos: V(0.12, 0.8, 0.64), r: 0.05, part: 'body', inside: true },
  { id: 'radio', label: 'Radio', pos: V(...STEREO.center), r: 0.08, part: 'body', inside: true },
  { id: 'hazard', label: 'Hazard lights', pos: V(0.0, 0.82, 0.74), r: 0.035, part: 'body', inside: true },
  { id: 'heater', label: 'Heater', pos: V(0.0, 0.68, 0.76), r: 0.05, part: 'body', inside: true },
  { id: 'dome', label: 'Cabin light', pos: V(0, 1.27, -0.12), r: 0.06, part: 'body', inside: true },
];
const POINTS = {
  exhaust: V(...META.exhaust),
  exhaust2: null,
  engine: V(0, 0.72, 1.4),
  engineLidTop: V(0, 0.98, 1.45),
  headlampGlare: V(0, 0.65, 2.3),
  frontTrunk: V(0, 0.85, -2.5), // stand behind the car to reach into the boot
  tailLights: V(0, 0.71, -2.25),
  cabin: V(0, 1.0, -0.3),
  dome: V(0, 1.295, -0.12),
};
const BOXES = autoBoxes(META, { floorY: 0.3, trunkFloorY: 0.5 });

const DYNAMICS = {
  restLength: 0.3,
  maxCompression: 0.2,
  springF: 26000,
  springR: 21000,
  damperBump: 1800,
  damperRebound: 2400,
  arbF: 6500,
  arbR: 1800,
  wheelRadius: SPEC.wheelR,
  wheelInertia: 1.3,
  maxSteer: (34 * Math.PI) / 180,
  wheelbase: SPEC.wheelbase,
  track: SPEC.trackHalf * 2,
  brakeTorque: 2300,
  brakeRear: 0.55,
  handbrakeTorque: 1400,
  // four-speed automatic with overdrive
  gears: [-2.1, 0, 2.69, 1.55, 1.0, 0.69],
  finalDrive: 3.02,
  idleRpm: 700,
  redline: 5800,
  engineInertia: 0.2,
  engineFriction: 0.007,
  clutchMaxTorque: 420,
  drag: 0.5 * 1.2 * 0.38 * 2.15,
  torqueCurve: [
    [0, 0],
    [600, 120],
    [1000, 170],
    [1600, 205],
    [2200, 225],
    [2800, 232],
    [3600, 226],
    [4400, 214],
    [5000, 200],
    [5600, 178],
    [6200, 120],
  ],
  shiftUp: [3000, 2000],
  shiftDown: [1500, 900],
};

const P = frontEngineParts({
  chassisMass: 330,
  bodyMass: 290,
  doorMass: 24,
  engineLabel: 'Engine 3.0 V6',
  engineMass: 170,
  engineDesc: 'Mitsubishi-built 3.0 V6, 141 hp, mated to a four-speed automatic.',
  tank: 60,
  wheelMass: 19,
});

export const SEDAN88 = {
  id: 'sedan88',
  name: "'88 Riverside sedan",
  short: 'Riverside',
  year: 1988,
  blurb: 'Six cylinders, a column shifter and a sofa for a front seat. Floats over broken asphalt, drinks like a sailor, and the boot takes a month of supplies.',
  stats: { power: 141, torque: 232, mass: 1420, top: 175, drive: 'FWD', gearbox: '4-speed automatic', engine: '3.0 V6, water-cooled' },
  META,
  SPEC,
  STEER_SCALE: 1,
  DRIVER,
  CONTROLS,
  SEATS,
  HOTSPOTS,
  POINTS,
  BOXES,
  DYNAMICS,
  HARDPOINTS: hardpoints(SPEC, 'front'),
  SPEEDO_MAX: 160,
  ...P,
  HINGES: {
    door_FL: { axis: [-0.04, 1, 0], max: -1.15 },
    door_FR: { axis: [0.04, 1, 0], max: 1.15 },
    door_RL: { axis: [-0.04, 1, 0], max: -1.1 },
    door_RR: { axis: [0.04, 1, 0], max: 1.1 },
    hood: { axis: [1, 0, 0], max: -0.95 },
    trunk: { axis: [1, 0, 0], max: 1.1 },
  },
  MATERIAL_ROLES: { paint: 'paint', under: 'trim', lens: 'lens', tail: 'tail', wheel: 'tyre', glass: 'glass', interior: 'interior', plate: 'trim', badge: 'trim' },
  // our own dial over the texture's speedometer (its painted needle would never move)
  GAUGES: { speedo: { center: [0.376, 0.848, 0.668], normal: [0, 0.25, -1], radius: 0.066, face: true, odo: '0 9 8 6 4 2' } },
  STEREO,
  WRECK_PARTS: ['chassis', 'body', 'door_FR', 'door_RL', 'bumper_R', 'hood', 'trunk', 'seat_FL', 'seat_R', 'engine'],
  fuelCap: 60,
  oilCap: 4.3,
  coolantCap: 9,
  cooling: 'water',
  automaticOnly: true,
  crash: { front: 'engine', rear: 'tank' },
  lids: { hood: 'bonnet', trunk: 'boot lid' },
  trunk: { label: 'Boot', slots: 20, capacity: 200, com: [0, 0.62, -1.9] },
  cabin: { hw: 0.78, y0: 0.25, y1: 1.22, z0: -2.28, z1: 0.8 },
  MOUNTS: {
    roof: { z: -0.55, l: 1.3, w: 1.12, top: 1.42 },
    front: { z: 2.47, y0: 0.24, y1: 0.95, w: 1.02 },
    rear: { z: -2.47, y: 0.47, w: 1.0, d: 0.5 },
  },
  massSize: [1.8, 1.3, 4.9],
  fuelCom: [0, 0.35, -0.65],
  lights: { head: [0, 0.65, 2.2], headX: 0.56, reverse: [0, 0.6, -2.35] },
  glassOpacity: 0.28,
  sound: { fires: 3, harmonics: [0, 1, 0.7, 0.35, 0.22, 0.12, 0.08, 0.05, 0.04, 0.03, 0.02, 0.02, 0.01, 0.01, 0.01, 0.01], odd: 0.7, even: 1, sub: 0.7, tone: 140, toneRpm: 0.12, gain: 0.75, drive: 1.6, intake: 0.7 },
  defaultColor: 0xcbb994,
  colors: [0xcbb994, 0x6b1f22, 0x1b2f3a, 0xc8c2b0, 0x2b3b2a, 0x8f8a80, 0x5b4a3a, 0x9a3a1e],
  repaintable: true,
  load(renderer) {
    return loadImportedAsset(this, renderer);
  },
  materials(asset, opts) {
    return createImportedMaterials(this, asset, opts);
  },
  build(asset, mats) {
    return buildImportedModel(this, asset, mats);
  },
  wreck(asset) {
    return buildImportedWreck(this, asset);
  },
  // the source has no battery, radiator, belt, filter, tank or spare
  extras(model, M) {
    // over the battery moulded into the left inner wing
    model.addPart('battery', PP.battery(M, V(0.5, 0.645, 1.74), { spec: '12V  60Ah', size: [0.2, 0.2, 0.27] }));
    model.addPart('radiator', PP.radiator(M, V(0, 0.56, 1.95), { w: 0.62, h: 0.28 }));
    model.addPart('fanbelt', PP.belt({ c: V(0.58, 0.62, 1.42), r: 0.07 }, { c: V(0.58, 0.78, 1.5), r: 0.045 }, { plane: 'x' }));
    model.addPart('airfilter', PP.airFilter(M, V(-0.3, 0.78, 1.55), { h: 0.08 }));
    model.addPart('fueltank', PP.fuelTank(V(0, 0.27, -0.65), { w: 0.85, h: 0.2, d: 0.5 }));
    model.addPart('spare', PP.spareWheel(model, V(0, 0.55, -1.85)));
  },
};
