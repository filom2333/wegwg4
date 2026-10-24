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
const COLUMN = V(...sw.axis).normalize();
const CONTROLS = {
  key: V(0.25, 0.695, 0.655),
  stalk: V(0.48, 0.795, 0.525),
  shifter: V(sw.center[0] - 0.13, 0.84, 0.47), // column selector
  handbrake: V(0.535, 0.43, 0.83), // foot-operated parking brake
  horn: V(...sw.center).addScaledVector(COLUMN, 0.04),
};
const SEATS = {
  driver: { pos: DRIVER.eye.clone(), door: 'door_FL', part: 'seat_FL', exit: V(1.45, 0.0, 0.15) },
  passenger: { pos: V(-sw.center[0], 1.12, -0.1), door: 'door_FR', part: 'seat_FR', exit: V(-1.45, 0.0, 0.15) },
  rearL: { pos: V(0.36, 1.1, -0.82), door: 'door_RL', part: 'seat_R', exit: V(1.45, 0.0, -0.75) },
  rearR: { pos: V(-0.36, 1.1, -0.82), door: 'door_RR', part: 'seat_R', exit: V(-1.45, 0.0, -0.75) },
};
// on the face of the centre stack
const STEREO = { center: [0, 0.75, 0.651], normal: [0, 0, -1], w: 0.08, h: 0.018 };
const FRONT = ['driver', 'passenger'];
// The low-poly source has no switches to speak of: the key, stalk, knobs, buttons, door handles
// and the parking brake pedal are made here (MOVING), each hotspot on its control.
const HOTSPOTS = [
  { id: 'fuel', label: 'Fuel filler', pos: V(0.804, 0.86, -1.6), r: 0.08, part: 'fueltank' },
  { id: 'oil', label: 'Oil filler', pos: V(0.2, 0.86, 1.35), r: 0.1, part: 'engine', lid: 'hood' },
  { id: 'coolant', label: 'Radiator cap', pos: V(0.33, 0.76, 1.95), r: 0.1, part: 'radiator', lid: 'hood' },
  { id: 'battery', label: 'Battery', pos: V(0.5, 0.78, 1.74), r: 0.13, part: 'battery', lid: 'hood' },
  { id: 'ignition', label: 'Ignition key', pos: CONTROLS.key.clone(), r: 0.035, part: 'body', inside: true, seats: ['driver'], hand: 'right' },
  { id: 'indicator', label: 'Turn signal', pos: CONTROLS.stalk.clone(), r: 0.035, part: 'body', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'lights', label: 'Headlights', pos: V(0.6, 0.8, 0.638), r: 0.03, part: 'body', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'wipers', label: 'Wipers', pos: V(0.13, 0.8, 0.62), r: 0.03, part: 'body', inside: true, seats: ['driver'], hand: 'right' },
  { id: 'handbrake', label: 'Parking brake', pos: CONTROLS.handbrake.clone(), r: 0.035, part: 'body', inside: true, seats: ['driver'] },
  { id: 'radio', label: 'Stereo', pos: V(0, 0.75, 0.648), r: 0.05, part: 'body', inside: true, seats: FRONT, hand: 'right' },
  { id: 'hazard', label: 'Hazard lights', pos: V(0, 0.83, 0.646), r: 0.022, part: 'body', inside: true, seats: FRONT, hand: 'right' },
  { id: 'heater', label: 'Heater', pos: V(0.06, 0.7, 0.656), r: 0.025, part: 'body', inside: true, seats: FRONT, hand: 'right' },
  { id: 'dome', label: 'Cabin light', pos: V(0, 1.285, -0.12), r: 0.04, part: 'body', inside: true, hand: 'right' },
  { id: 'doorFL', label: 'Door', pos: V(0.694, 0.85, 0.42), r: 0.035, part: 'door_FL', door: 'door_FL', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'doorFR', label: 'Door', pos: V(-0.694, 0.85, 0.42), r: 0.035, part: 'door_FR', door: 'door_FR', inside: true, seats: ['passenger', 'driver'], hand: 'right' },
  // the mirrors, aimed from the seat
  { id: 'mirrorL', label: 'Mirror', pos: V(0.858, 0.937, 0.49), r: 0.05, part: 'door_FL', door: 'door_FL', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'mirrorR', label: 'Mirror', pos: V(-0.858, 0.937, 0.49), r: 0.05, part: 'door_FR', door: 'door_FR', inside: true, seats: ['driver'], hand: 'right' },
  { id: 'mirrorC', label: 'Mirror', pos: V(0.0, 1.21, 0.204), r: 0.05, part: 'body', inside: true, seats: ['driver'], hand: 'right' },
  // window switches on the driver's armrest
  { id: 'windowFL', label: 'Window switch', pos: V(0.706, 0.8, 0.07), r: 0.02, part: 'door_FL', door: 'door_FL', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'windowFR', label: 'Window switch', pos: V(0.706, 0.8, 0.02), r: 0.02, part: 'door_FL', door: 'door_FL', inside: true, seats: ['driver'], hand: 'left' },
];
const MOVING = {
  key: { make: 'key', pivot: V(0.25, 0.69, 0.676), axis: V(0, 0.1, 1), angles: [0, 0.9, 1.35] },
  stalk: { make: 'stalk', pivot: V(0.385, 0.775, 0.54), dir: V(1, 0.22, -0.1), length: 0.13, axis: COLUMN, angle: 0.14 },
  lightKnob: { make: 'knob', pivot: V(0.6, 0.8, 0.653), axis: V(0, 0, 1), angles: [0, 0.65, 1.2] },
  lever: { make: 'knob', pivot: V(0.13, 0.8, 0.636), axis: V(0, 0, 1), angle: 0.9 },
  heater: { make: 'knob', pivot: V(0.06, 0.7, 0.671), axis: V(0, 0.3, 1), angle: 1.6 },
  hazard: { make: 'button', pivot: V(0, 0.83, 0.653), axis: V(0, 0, 1), push: 0.004 },
  handleFL: { make: 'handle', pivot: V(0.696, 0.85, 0.463), at: V(0.696, 0.85, 0.42), axis: V(0, 1, 0), angle: 0.35, door: 'door_FL' },
  handleFR: { make: 'handle', pivot: V(-0.696, 0.85, 0.463), at: V(-0.696, 0.85, 0.42), axis: V(0, -1, 0), angle: 0.35, door: 'door_FR' },
  park: { make: 'pedal', pivot: V(0.535, 0.53, 0.92), at: CONTROLS.handbrake.clone(), axis: V(-1, 0, 0), angle: 0.3 },
};
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
  plugs: 6,
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
  MOVING,
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
  // the mirrors' glass (found from the driver's eye): the door mirrors and the one inside
  MIRRORS: [
    { id: 'L', part: 'door_FL', center: [0.858, 0.937, 0.49], normal: [-0.4, 0.09, -0.91], size: [0.15, 0.09], round: 0.2, look: [0.16, 0.01, -1], wide: 2.2 },
    { id: 'R', part: 'door_FR', center: [-0.858, 0.937, 0.49], normal: [0.4, 0.09, -0.91], size: [0.15, 0.09], round: 0.2, look: [-0.16, 0.01, -1], wide: 2.2 },
    { id: 'C', part: 'body', center: [0.0, 1.21, 0.204], normal: [0.12, -0.13, -0.99], size: [0.22, 0.055], round: 0.4, res: [320, 80], look: [0, -0.02, -1], wide: 1.25 },
  ],
  // the fuel filler flap on the left rear wing
  FILLER: { pos: [0.802, 0.86, -1.6], normal: [0.96, 0.29, -0.05], size: [0.12, 0.1], corner: 0.01, hinge: -1 },
  GAUGES: {
    // (in front of the model's dash face, which sits nearer the driver than its painted dials)
    // (low in the binnacle: its brow hides the top of anything higher)
    speedo: { center: [0.376, 0.842, 0.638], normal: [0, 0.25, -1], radius: 0.055, face: true, lcd: true },
    panel: [0.29, 0.12, 0, -0.002],
    tacho: { offset: [-0.094, -0.002], radius: 0.041 },
    small: [
      { kind: 'fuel', offset: [0.09, 0.016], radius: 0.026 },
      { kind: 'temp', offset: [0.09, -0.032], radius: 0.026 },
    ],
  },
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
  sound: { fires: 3, pitch: 0.86, bright: 0.75, gain: 0.9, bite: 0.55 },
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
    // the V6's left end: crank, water pump behind it, alternator ahead, one belt; the starter on
    // the gearbox end, six plugs with leads to the distributor
    model.addPart('waterpump', PP.waterPump(M, V(0.495, 0.73, 1.28), { face: 'x' }));
    model.addPart('alternator', PP.alternator(M, V(0.473, 0.772, 1.53), { face: 'x', pulleyR: 0.04 }));
    model.addPart('fanbelt', PP.beltLoop([{ c: V(0.58, 0.62, 1.42), r: 0.07 }, { c: V(0.58, 0.73, 1.28), r: 0.05 }, { c: V(0.58, 0.772, 1.53), r: 0.04 }], { plane: 'x' }));
    model.addPart('starter', PP.starter(M, V(-0.32, 0.6, 1.12), { face: '-x' }));
    model.addPart('oilfilter', PP.oilFilter(M, V(-0.42, 0.63, 1.76)));
    // rear bank behind the plenum, front bank between it and the manifold, the distributor at
    // the back of the head
    const plugs = [...[-0.2, 0, 0.2].map((x) => V(x, 0.8, 1.2)), ...[-0.04, 0.12, 0.28].map((x) => V(x, 0.77, 1.56))];
    // (the leads lie low: the bonnet comes down close over the plenum at the back)
    model.addPart('sparkplugs', PP.plugLeads(M, plugs, { to: V(-0.12, 0.8, 1.12), up: 0, arch: 0.03 }));
    model.addPart('airfilter', PP.airFilter(M, V(-0.3, 0.78, 1.55), { h: 0.08 }));
    model.addPart('fueltank', PP.fuelTank(V(0, 0.27, -0.65), { w: 0.85, h: 0.2, d: 0.5 }));
    model.addPart('spare', PP.spareWheel(model, V(0, 0.55, -1.85)));
    // the reservoirs, fuse box and dipstick round the engine
    const bay = PP.bayDetails(M, { coolant: V(-0.55, 0.66, 1.3), brake: V(0.42, 0.72, 1.12), washer: V(-0.55, 0.6, 1.82), fuses: V(0.6, 0.68, 1.2), dipstick: V(0.15, 0.74, 1.35) });
    model.parts.body.inner.add(bay.group);
    model.bay = bay.refs;
    // the scuttle panel under the windscreen: the source leaves a gap there between the glass
    // and the bonnet's back edge, and from the seat you looked through it into the engine bay
    const cowl = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35).rotateX(-Math.PI / 2), M.black);
    cowl.position.set(0, 0.9, 1.045);
    model.parts.body.inner.add(cowl);
  },
};
