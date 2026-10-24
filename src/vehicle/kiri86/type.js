// The '86 Kiri: a mid-80s Japanese family saloon, front drive, a 2.0 four and a five-speed stick.
// Model: "Kiri '86 - Low poly model" by Daniel Zhabotinsky, CC-BY-4.0, converted by
// tools/cars/kiri86.py (measurements in kiri86Meta.json). The same build as the '88 sedan: every
// door, the bonnet, boot lid, wings and bumpers come apart, the seats come out whole.

import * as THREE from 'three';
import META from './kiri86Meta.json';
import { wheelSpec, hardpoints, driverOf, autoBoxes } from '../imported/specKit.js';
import { frontEngineParts } from '../imported/frontEngineParts.js';
import { loadImportedAsset, createImportedMaterials, buildImportedModel, buildImportedWreck } from '../imported/importedCar.js';
import * as PP from '../imported/procParts.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

const SPEC = wheelSpec(META);
const DRIVER = driverOf(META, { eyeY: 1.08, eyeZ: -0.22, shoulderY: 0.83, shoulderZ: -0.29, shoulderHalf: 0.2 });
const sw = META.steeringWheel;
const COLUMN = V(...sw.axis).normalize();
const lever = META.controls.x_gearLever;
const CONTROLS = {
  key: V(0.205, 0.665, 0.538),
  stalk: V(0.461, 0.76, 0.385),
  shifter: V((lever.min[0] + lever.max[0]) / 2, lever.max[1], (lever.min[2] + lever.max[2]) / 2), // floor lever
  handbrake: V(0.036, 0.505, 0.1), // the grip of the hand lever between the front seats
  horn: V(...sw.center).addScaledVector(COLUMN, 0.04),
};
const SEATS = {
  driver: { pos: DRIVER.eye.clone(), door: 'door_FL', part: 'seat_FL', exit: V(1.4, 0.0, 0.1) },
  passenger: { pos: V(-0.27, 1.08, -0.22), door: 'door_FR', part: 'seat_FR', exit: V(-1.4, 0.0, 0.1) },
  rearL: { pos: V(0.34, 1.05, -0.95), door: 'door_RL', part: 'seat_R', exit: V(1.4, 0.0, -0.75) },
  rearR: { pos: V(-0.3, 1.05, -0.95), door: 'door_RR', part: 'seat_R', exit: V(-1.4, 0.0, -0.75) },
};
// on the face of the centre stack
const STEREO = { center: [0.0, 0.655, 0.562], normal: [0, -0.45, -1], w: 0.08, h: 0.018 };
const FRONT = ['driver', 'passenger'];
// The low-poly source has no switches to speak of: the key, stalk, knobs, buttons, door handles
// and the parking brake lever are made here (MOVING), each hotspot on its control.
const HOTSPOTS = [
  { id: 'fuel', label: 'Fuel filler', pos: V(0.745, 0.8, -1.55), r: 0.08, part: 'fueltank' },
  { id: 'oil', label: 'Oil filler', pos: V(0.1, 0.83, 1.4), r: 0.1, part: 'engine', lid: 'hood' },
  { id: 'coolant', label: 'Radiator cap', pos: V(0.3, 0.72, 1.72), r: 0.1, part: 'radiator', lid: 'hood' },
  { id: 'battery', label: 'Battery', pos: V(-0.395, 0.78, 1.6), r: 0.12, part: 'battery', lid: 'hood' },
  { id: 'ignition', label: 'Ignition key', pos: CONTROLS.key.clone(), r: 0.035, part: 'body', inside: true, seats: ['driver'], hand: 'right' },
  { id: 'indicator', label: 'Turn signal', pos: CONTROLS.stalk.clone(), r: 0.035, part: 'body', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'lights', label: 'Headlights', pos: V(0.545, 0.715, 0.53), r: 0.03, part: 'body', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'wipers', label: 'Wipers', pos: V(0.12, 0.715, 0.53), r: 0.03, part: 'body', inside: true, seats: ['driver'], hand: 'right' },
  { id: 'handbrake', label: 'Parking brake', pos: CONTROLS.handbrake.clone(), r: 0.045, part: 'body', inside: true, seats: ['driver'], hand: 'right' },
  { id: 'radio', label: 'Stereo', pos: V(0.0, 0.655, 0.555), r: 0.05, part: 'body', inside: true, seats: FRONT, hand: 'right' },
  { id: 'hazard', label: 'Hazard lights', pos: V(-0.03, 0.725, 0.53), r: 0.022, part: 'body', inside: true, seats: FRONT, hand: 'right' },
  { id: 'heater', label: 'Heater', pos: V(0.06, 0.725, 0.53), r: 0.025, part: 'body', inside: true, seats: FRONT, hand: 'right' },
  { id: 'dome', label: 'Cabin light', pos: V(0, 1.29, -0.42), r: 0.045, part: 'body', inside: true, hand: 'right' },
  { id: 'doorFL', label: 'Door', pos: V(0.632, 0.8, 0.38), r: 0.035, part: 'door_FL', door: 'door_FL', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'doorFR', label: 'Door', pos: V(-0.632, 0.8, 0.38), r: 0.035, part: 'door_FR', door: 'door_FR', inside: true, seats: ['passenger', 'driver'], hand: 'right' },
  // window switches on the driver's armrest
  { id: 'windowFL', label: 'Window switch', pos: V(0.624, 0.676, -0.02), r: 0.02, part: 'door_FL', door: 'door_FL', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'windowFR', label: 'Window switch', pos: V(0.624, 0.676, -0.065), r: 0.02, part: 'door_FL', door: 'door_FL', inside: true, seats: ['driver'], hand: 'left' },
];
const MOVING = {
  key: { make: 'key', pivot: V(0.205, 0.665, 0.548), axis: V(0, 0.33, 1), angles: [0, 0.9, 1.35] },
  stalk: { make: 'stalk', pivot: V(0.366, 0.74, 0.4), dir: V(1, 0.22, -0.1), length: 0.1, axis: COLUMN, angle: 0.14 },
  lightKnob: { make: 'knob', pivot: V(0.545, 0.715, 0.543), axis: V(0, 0, 1), angles: [0, 0.65, 1.2] },
  lever: { make: 'knob', pivot: V(0.12, 0.715, 0.543), axis: V(0, 0, 1), angle: 0.9 },
  heater: { make: 'knob', pivot: V(0.06, 0.725, 0.543), axis: V(0, 0, 1), angle: 1.6 },
  hazard: { make: 'button', pivot: V(-0.03, 0.725, 0.543), axis: V(0, 0, 1), push: 0.004 },
  handleFL: { make: 'handle', pivot: V(0.632, 0.8, 0.42), at: V(0.632, 0.8, 0.38), axis: V(0, 1, 0), angle: 0.35, door: 'door_FL' },
  handleFR: { make: 'handle', pivot: V(-0.632, 0.8, 0.42), at: V(-0.632, 0.8, 0.38), axis: V(0, -1, 0), angle: 0.35, door: 'door_FR' },
  park: { make: 'handbrake', pivot: V(0.036, 0.485, -0.17), at: V(0.036, 0.5, 0.1), floor: 0.331, axis: V(-1, 0, 0), angle: 0.42 },
};
const POINTS = {
  exhaust: V(...META.exhaust),
  exhaust2: null,
  engine: V(0, 0.68, 1.4),
  engineLidTop: V(0, 0.92, 1.4),
  headlampGlare: V(0, 0.64, 2.05),
  frontTrunk: V(0, 0.85, -2.6), // stand behind the car to reach into the boot
  tailLights: V(0, 0.73, -2.2),
  cabin: V(0, 0.95, -0.4),
  dome: V(0, 1.297, -0.42), // on the headliner behind the sunroof
};
const BOXES = autoBoxes(META, { floorY: 0.3, trunkFloorY: 0.5 });

const DYNAMICS = {
  restLength: 0.28,
  maxCompression: 0.18,
  springF: 24000,
  springR: 20000,
  damperBump: 1700,
  damperRebound: 2300,
  arbF: 6500,
  arbR: 2600,
  wheelRadius: SPEC.wheelR,
  wheelInertia: 1.0,
  maxSteer: (36 * Math.PI) / 180,
  wheelbase: SPEC.wheelbase,
  track: SPEC.trackHalf * 2,
  brakeTorque: 2000,
  brakeRear: 0.5,
  handbrakeTorque: 1300,
  // five-speed manual
  gears: [-3.25, 0, 3.29, 1.96, 1.29, 0.94, 0.75],
  finalDrive: 3.94,
  idleRpm: 750,
  redline: 6200,
  engineInertia: 0.13,
  engineFriction: 0.006,
  clutchMaxTorque: 320,
  drag: 0.5 * 1.2 * 0.36 * 1.95,
  torqueCurve: [
    [0, 0],
    [600, 80],
    [1000, 115],
    [1600, 140],
    [2400, 155],
    [3200, 163],
    [4000, 165],
    [4800, 158],
    [5400, 148],
    [6000, 130],
    [6600, 90],
  ],
  shiftUp: [3200, 2200],
  shiftDown: [1600, 1000],
};

const P = frontEngineParts({
  chassisMass: 260,
  bodyMass: 230,
  doorMass: 20,
  engineLabel: 'Engine 2.0 four',
  engineMass: 135,
  engineDesc: 'A 2.0 single-cam four, 105 hp, mounted across the nose and driving the front wheels through a five-speed box.',
  tank: 55,
  wheelMass: 15,
  plugs: 4,
});
// the front wings come off too
P.PARTS.fender_FL = { label: 'Front wing (left)', mass: 5, requires: ['body'] };
P.PARTS.fender_FR = { label: 'Front wing (right)', mass: 5, requires: ['body'] };
P.ASSEMBLY_ORDER.splice(P.ASSEMBLY_ORDER.indexOf('bumper_F'), 0, 'fender_FL', 'fender_FR');

export const KIRI86 = {
  id: 'kiri86',
  name: "'86 Kiri saloon",
  short: 'Kiri',
  year: 1986,
  blurb: 'A plain Japanese four-door that refuses to die: a two-litre four, a five-speed stick, light enough to push out of a ditch and simple enough to fix with what you find.',
  stats: { power: 105, torque: 165, mass: 1120, top: 178, drive: 'FWD', gearbox: '5-speed manual', engine: '2.0 four, water-cooled' },
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
  SPEEDO_MAX: 180,
  ...P,
  HINGES: {
    door_FL: { axis: [-0.04, 1, 0], max: -1.15 },
    door_FR: { axis: [0.04, 1, 0], max: 1.15 },
    door_RL: { axis: [-0.04, 1, 0], max: -1.1 },
    door_RR: { axis: [0.04, 1, 0], max: 1.1 },
    hood: { axis: [1, 0, 0], max: -1.0 },
    trunk: { axis: [1, 0, 0], max: 1.15 },
  },
  // (lever positions for the gears: [sideways, fore-aft] tilt)
  SHIFT_PATTERN: { 0: [0, 0.18], 1: [0, 0], 2: [0.16, -0.2], 3: [0.16, 0.2], 4: [0, -0.2], 5: [0, 0.2], 6: [-0.16, -0.2] },
  // the source's cabin is near black: its textures brought up a little
  interiorLift: 1.8,
  MATERIAL_ROLES: { paint: 'paint', under: 'trim', motor: 'trim', lens: 'lens', tail: 'tail', wheel: 'tyre', glass: 'glass', interior: 'interior', plate: 'trim', badge: 'trim' },
  // the mirrors' glass over the source's own (door mirrors and the one inside): plain silvered
  // glass that only catches the sky
  MIRROR_GLASS: [
    { part: 'door_FL', center: [0.78, 0.93, 0.474], normal: [-0.17, 0.0, -0.98], size: [0.14, 0.085], round: 0.2 },
    { part: 'door_FR', center: [-0.78, 0.93, 0.474], normal: [0.17, 0.0, -0.98], size: [0.14, 0.085], round: 0.2 },
    { part: 'body', center: [0.0, 1.23, 0.057], normal: [0.1, -0.13, -0.99], size: [0.19, 0.05], round: 0.4 },
  ],
  // the fuel filler flap on the left rear wing
  // (on the wing's surface, which leans in a good deal here)
  FILLER: { pos: [0.739, 0.8, -1.55], normal: [0.89, 0.45, -0.04], size: [0.11, 0.1], corner: 0.012, hinge: -1 },
  GAUGES: {
    // laid out as the model's own (measured on its binnacle face, z = 0.513): the speedometer ahead
    // of the driver, the rev counter beside it, fuel and temperature to the left, oil pressure and
    // volts to the right, on a fascia that fills the whole recess
    speedo: { center: [0.362, 0.832, 0.513], normal: [0, 0.3, -1], radius: 0.054, face: true, lcd: true },
    panel: [0.5, 0.155, 0.052, -0.01],
    curve: 0.25,
    tacho: { offset: [0.15, 0], radius: 0.054 },
    small: [
      { kind: 'fuel', offset: [-0.116, 0.033], radius: 0.024 },
      { kind: 'temp', offset: [-0.116, -0.033], radius: 0.024 },
      { kind: 'oil', offset: [0.257, 0.033], radius: 0.024 },
      { kind: 'volt', offset: [0.257, -0.033], radius: 0.024 },
    ],
  },
  STEREO,
  WRECK_PARTS: ['chassis', 'body', 'door_FR', 'door_RL', 'bumper_R', 'hood', 'trunk', 'fender_FL', 'seat_FL', 'seat_R', 'engine'],
  fuelCap: 55,
  oilCap: 4.0,
  coolantCap: 7,
  cooling: 'water',
  crash: { front: 'engine', rear: 'tank' },
  lids: { hood: 'bonnet', trunk: 'boot lid' },
  trunk: { label: 'Boot', slots: 16, capacity: 160, com: [0, 0.6, -1.85] },
  cabin: { hw: 0.74, y0: 0.24, y1: 1.24, z0: -1.4, z1: 0.6 },
  MOUNTS: {
    roof: { z: -0.45, l: 1.2, w: 1.06, top: 1.33 },
    front: { z: 2.08, y0: 0.22, y1: 0.85, w: 0.98 },
    rear: { z: -2.27, y: 0.42, w: 0.98, d: 0.5 },
  },
  massSize: [1.68, 1.32, 4.31],
  fuelCom: [0, 0.32, -0.95],
  lights: { head: [0, 0.64, 1.95], headX: 0.6, reverse: [0, 0.72, -2.2] },
  glassOpacity: 0.26,
  sound: { fires: 2, pitch: 1.08, bright: 0.85, gain: 0.85, bite: 0.5 },
  defaultColor: 0x7a1c1c,
  colors: [0x7a1c1c, 0xd8d2c4, 0x2d3a4c, 0x9aa0a4, 0x3c4a34, 0x1d1f22, 0xb08a4e, 0x5c6e7a],
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
  // the source has the engine, its battery and its air box (parts of their own); no radiator, belt,
  // pump, alternator, starter, oil filter, plugs, tank or spare: those are made here, round the
  // block where the source leaves room (the belt end under the air box, the starter behind)
  extras(model, M) {
    model.addPart('radiator', PP.radiator(M, V(0, 0.52, 1.78), { w: 0.6, h: 0.28 }));
    model.addPart('waterpump', PP.waterPump(M, V(0.33, 0.56, 1.36), { face: 'x' }));
    model.addPart('alternator', PP.alternator(M, V(0.3, 0.58, 1.56), { face: 'x', pulleyR: 0.035 }));
    model.addPart('fanbelt', PP.beltLoop([{ c: V(0.36, 0.45, 1.42), r: 0.065 }, { c: V(0.36, 0.56, 1.36), r: 0.045 }, { c: V(0.36, 0.58, 1.56), r: 0.035 }], { plane: 'x' }));
    model.addPart('starter', PP.starter(M, V(-0.28, 0.5, 1.2), { face: '-x' }));
    model.addPart('oilfilter', PP.oilFilter(M, V(-0.12, 0.5, 1.6)));
    // (the boots and leads stay under the bonnet, which comes down to 0.83 over the head)
    model.addPart('sparkplugs', PP.plugLeads(M, [-0.18, -0.06, 0.06, 0.18].map((x) => V(x, 0.71, 1.4)), { to: V(-0.3, 0.72, 1.3), up: 0, arch: 0 }));
    model.addPart('fueltank', PP.fuelTank(V(0, 0.27, -0.95), { w: 0.8, h: 0.2, d: 0.45 }));
    model.addPart('spare', PP.spareWheel(model, V(0, 0.52, -1.8)));
    const bay = PP.bayDetails(M, { coolant: V(-0.58, 0.64, 1.3), brake: V(0.38, 0.72, 1.24), washer: V(-0.57, 0.6, 1.78), fuses: V(0.58, 0.7, 1.12), dipstick: V(-0.08, 0.77, 1.55) });
    model.parts.body.inner.add(bay.group);
    model.bay = bay.refs;
  },
};
