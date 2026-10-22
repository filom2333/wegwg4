// The '04 Kronberg C200: a German rear-drive saloon with a supercharged 1.8 four and a five-speed
// stick. Model: "Mercedes-Benz C-class W203 2007" by szymonpasterczyk734, CC-BY-4.0, converted by
// tools/cars/w203.py (measurements in w203Meta.json). The source has no engine bay: the engine and
// everything on it (pump, alternator, belt, starter, filters, coils) and the radiator are the
// game's own, the battery lives in the boot as on the real car.

import * as THREE from 'three';
import META from './w203Meta.json';
import { wheelSpec, hardpoints, driverOf, autoBoxes } from '../imported/specKit.js';
import { frontEngineParts } from '../imported/frontEngineParts.js';
import { loadImportedAsset, createImportedMaterials, buildImportedModel, buildImportedWreck } from '../imported/importedCar.js';
import * as PP from '../imported/procParts.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

const SPEC = wheelSpec(META);
const sw = META.steeringWheel;
const STEER_SCALE = 0.84; // the measured rim takes in the column stalks
const DRIVER = driverOf(META, { eyeY: 1.13, eyeZ: -0.24, shoulderY: 0.86, shoulderZ: -0.3, shoulderHalf: 0.2, steerScale: STEER_SCALE });
const COLUMN = V(...sw.axis).normalize();
const CONTROLS = {
  key: V(0.21, 0.757, 0.43),
  stalk: V(0.53, 0.848, 0.415),
  shifter: V(0.02, 0.62, 0.33), // floor lever on the centre console
  handbrake: V(0.695, 0.47, 0.56), // foot-operated parking brake, far left of the footwell
  horn: V(...sw.center).addScaledVector(COLUMN, 0.04),
};
const SEATS = {
  driver: { pos: DRIVER.eye.clone(), door: 'door_FL', part: 'seat_FL', exit: V(1.45, 0.0, 0.15) },
  passenger: { pos: V(-sw.center[0], 1.13, -0.24), door: 'door_FR', part: 'seat_FR', exit: V(-1.45, 0.0, 0.15) },
  rearL: { pos: V(0.36, 1.1, -1.05), door: 'door_RL', part: 'seat_R', exit: V(1.45, 0.0, -0.85) },
  rearR: { pos: V(-0.36, 1.1, -1.05), door: 'door_RR', part: 'seat_R', exit: V(-1.45, 0.0, -0.85) },
};
// the head unit's display window, in front of the source's own
const STEREO = { center: [0.001, 0.721, 0.449], normal: [0, 0.25, -1], w: 0.074, h: 0.022 };
const FRONT = ['driver', 'passenger'];
// Inside ones are worked from a seat (seats) with one hand (hand; none for the parking brake
// pedal); door handles ride on their doors. Each sits on the control itself.
const HOTSPOTS = [
  { id: 'fuel', label: 'Fuel filler', pos: V(-0.88, 0.84, -1.62), r: 0.12, part: 'fueltank' },
  { id: 'oil', label: 'Oil filler', pos: V(0.0, 0.84, 1.3), r: 0.1, part: 'engine', lid: 'hood' },
  { id: 'coolant', label: 'Radiator cap', pos: V(0.3, 0.74, 1.72), r: 0.1, part: 'radiator', lid: 'hood' },
  { id: 'battery', label: 'Battery', pos: V(-0.48, 0.66, -1.95), r: 0.13, part: 'battery', lid: 'trunk' },
  { id: 'ignition', label: 'Ignition key', pos: CONTROLS.key.clone(), r: 0.035, part: 'body', inside: true, seats: ['driver'], hand: 'right' },
  { id: 'indicator', label: 'Turn signal', pos: CONTROLS.stalk.clone(), r: 0.035, part: 'body', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'wipers', label: 'Wipers', pos: V(0.505, 0.727, 0.385), r: 0.03, part: 'body', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'lights', label: 'Headlights', pos: V(0.636, 0.728, 0.455), r: 0.03, part: 'body', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'handbrake', label: 'Parking brake', pos: CONTROLS.handbrake.clone(), r: 0.035, part: 'body', inside: true, seats: ['driver'] },
  { id: 'radio', label: 'Stereo', pos: V(0.001, 0.715, 0.448), r: 0.05, part: 'body', inside: true, seats: FRONT, hand: 'right' },
  { id: 'hazard', label: 'Hazard lights', pos: V(0.001, 0.782, 0.486), r: 0.022, part: 'body', inside: true, seats: FRONT, hand: 'right' },
  { id: 'heater', label: 'Heater', pos: V(0.081, 0.581, 0.35), r: 0.025, part: 'body', inside: true, seats: FRONT, hand: 'right' },
  { id: 'dome', label: 'Cabin light', pos: V(0, 1.283, 0.06), r: 0.04, part: 'body', inside: true, hand: 'right' },
  { id: 'doorFL', label: 'Door', pos: V(0.728, 0.797, 0.235), r: 0.035, part: 'door_FL', door: 'door_FL', inside: true, seats: ['driver'], hand: 'left' },
  { id: 'doorFR', label: 'Door', pos: V(-0.728, 0.797, 0.235), r: 0.035, part: 'door_FR', door: 'door_FR', inside: true, seats: ['passenger', 'driver'], hand: 'right' },
];
// The controls that move (pieces split out of the source as x_<id>, the parking brake pedal
// made here): pivot and axis in car space. The key turns about its lock, the stalk and the
// lever under it flick about the column, knobs turn, the hazard button goes in, door handles
// are pulled, the pedal goes down.
const MOVING = {
  key: { pivot: V(0.211, 0.753, 0.47), axis: V(0, 0.15, 1), angles: [0, 0.9, 1.35] },
  stalk: { pivot: V(0.425, 0.812, 0.42), axis: COLUMN, angle: 0.14 },
  lever: { pivot: V(0.435, 0.737, 0.395), axis: COLUMN, angle: 0.13 },
  lightKnob: { pivot: V(0.636, 0.728, 0.47), axis: V(0, 0.2, 1), angles: [0, 0.65, 1.2] },
  heater: { pivot: V(0.081, 0.581, 0.361), axis: V(0, 0.4, 1), angle: 1.6 },
  hazard: { pivot: V(0.001, 0.782, 0.495), axis: V(0, 0.1, 1), push: 0.004 },
  handleFL: { pivot: V(0.735, 0.797, 0.307), axis: V(0, 1, 0), angle: 0.35, door: 'door_FL' },
  handleFR: { pivot: V(-0.735, 0.797, 0.307), axis: V(0, -1, 0), angle: 0.35, door: 'door_FR' },
  park: { make: 'pedal', pivot: V(0.695, 0.58, 0.68), at: CONTROLS.handbrake.clone(), axis: V(-1, 0, 0), angle: 0.3 },
};
const POINTS = {
  exhaust: V(...META.exhaust),
  exhaust2: null,
  engine: V(0, 0.6, 1.2),
  engineLidTop: V(0, 0.92, 1.3),
  headlampGlare: V(0, 0.63, 2.1),
  frontTrunk: V(0, 0.85, -2.75), // stand behind the car to reach into the boot
  tailLights: V(0, 0.75, -2.35),
  cabin: V(0, 1.0, -0.4),
  dome: V(0, 1.33, -0.25),
};
const BOXES = autoBoxes(META, {
  floorY: 0.28,
  trunkFloorY: 0.5,
  extra: [['engine', [0, 0.5, 1.2], [0.16, 0.19, 0.29], { tag: 'engine' }]],
});

const DYNAMICS = {
  restLength: 0.3,
  maxCompression: 0.19,
  springF: 30000,
  springR: 33000,
  damperBump: 2100,
  damperRebound: 2900,
  arbF: 8000,
  arbR: 4200,
  wheelRadius: SPEC.wheelR,
  wheelInertia: 1.2,
  maxSteer: (36 * Math.PI) / 180,
  wheelbase: SPEC.wheelbase,
  track: SPEC.trackHalf * 2,
  brakeTorque: 2600,
  brakeRear: 0.6,
  handbrakeTorque: 1500,
  // five-speed manual
  gears: [-3.58, 0, 3.86, 2.18, 1.38, 1.0, 0.8],
  finalDrive: 3.27,
  idleRpm: 750,
  redline: 6400,
  engineInertia: 0.16,
  engineFriction: 0.006,
  clutchMaxTorque: 420,
  drag: 0.5 * 1.2 * 0.3 * 2.12,
  torqueCurve: [
    [0, 0],
    [600, 100],
    [1000, 150],
    [1600, 190],
    [2400, 220],
    [3200, 230],
    [4000, 230],
    [4800, 222],
    [5500, 205],
    [6100, 180],
    [6700, 120],
  ],
  shiftUp: [3200, 2200],
  shiftDown: [1600, 1000],
};

const P = frontEngineParts({
  chassisMass: 340,
  bodyMass: 300,
  doorMass: 26,
  engineLabel: 'Engine 1.8 Kompressor',
  engineMass: 150,
  engineDesc: 'Supercharged 1.8 four, 143 hp, driving the rear wheels through a five-speed box.',
  tank: 62,
  wheelMass: 20,
});
// front wings come off too; the battery sits in the boot
P.PARTS.fender_FL = { label: 'Front wing (left)', mass: 5, requires: ['body'] };
P.PARTS.fender_FR = { label: 'Front wing (right)', mass: 5, requires: ['body'] };
P.PARTS.battery = { ...P.PARTS.battery, needsOpen: 'trunk', desc: 'Under the boot floor on the right, as Kronberg put it.' };
P.ASSEMBLY_ORDER.splice(P.ASSEMBLY_ORDER.indexOf('bumper_F'), 0, 'fender_FL', 'fender_FR');
// the plastic shroud over the engine: the coils are under it
P.PARTS.enginecover = { label: 'Engine cover', mass: 3, requires: ['engine'], needsOpen: 'hood', desc: 'The plastic shroud with the star. The coils and plugs are under it.' };
P.PARTS.sparkplugs = { ...P.PARTS.sparkplugs, needsOpen: 'enginecover' };
P.ASSEMBLY_ORDER.splice(P.ASSEMBLY_ORDER.indexOf('fanbelt') + 1, 0, 'enginecover');

export const W203 = {
  id: 'w203',
  name: "'04 Kronberg C200",
  short: 'Kronberg',
  year: 2004,
  blurb: 'A German saloon built like a bank vault: rear drive, a supercharged four, a five-speed stick and a cabin that still smells of leather. Thirsty for parts, stubborn to kill.',
  stats: { power: 143, torque: 230, mass: 1450, top: 223, drive: 'RWD', gearbox: '5-speed manual', engine: '1.8 supercharged four, water-cooled' },
  META,
  SPEC,
  STEER_SCALE,
  DRIVER,
  CONTROLS,
  SEATS,
  HOTSPOTS,
  MOVING,
  SIGNAL_KEY: 'amber',
  tailTint: 0xff2412,
  POINTS,
  BOXES,
  DYNAMICS,
  HARDPOINTS: hardpoints(SPEC, 'rear'),
  SPEEDO_MAX: 260,
  ...P,
  HINGES: {
    door_FL: { axis: [-0.03, 1, 0], max: -1.15 },
    door_FR: { axis: [0.03, 1, 0], max: 1.15 },
    door_RL: { axis: [-0.03, 1, 0], max: -1.1 },
    door_RR: { axis: [0.03, 1, 0], max: 1.1 },
    hood: { axis: [1, 0, 0], max: -1.0 },
    trunk: { axis: [1, 0, 0], max: 1.15 },
  },
  MATERIAL_ROLES: { paint: 'paint', under: 'trim', lens: 'lens', tail: 'tail', tyre: 'tyre', glass: 'glass', interior: 'interior', cabin: 'interior', dash: 'interior', trim: 'trim', chrome: 'trim', rim: 'trim', amber: 'trim' },
  GAUGES: { speedo: { center: [0.381, 0.848, 0.5], normal: [0, 0.3, -1], radius: 0.056, face: true, odo: '1 8 4 3 0 7' } },
  STEREO,
  WRECK_PARTS: ['chassis', 'body', 'door_FR', 'door_RL', 'bumper_R', 'hood', 'trunk', 'fender_FL', 'seat_FL', 'seat_FR'],
  fuelCap: 62,
  oilCap: 5.5,
  coolantCap: 8.5,
  cooling: 'water',
  crash: { front: 'engine', rear: 'tank' },
  lids: { hood: 'bonnet', trunk: 'boot lid', enginecover: 'engine cover' },
  trunk: { label: 'Boot', slots: 18, capacity: 180, com: [0, 0.62, -1.95] },
  cabin: { hw: 0.78, y0: 0.25, y1: 1.3, z0: -1.55, z1: 0.75 },
  MOUNTS: {
    roof: { z: -0.5, l: 1.2, w: 1.08, top: 1.41 },
    front: { z: 2.22, y0: 0.2, y1: 0.9, w: 1.0 },
    rear: { z: -2.5, y: 0.46, w: 1.0, d: 0.5 },
  },
  massSize: [1.78, 1.35, 4.6],
  fuelCom: [0, 0.32, -0.95],
  lights: { head: [0, 0.63, 2.04], headX: 0.62, reverse: [0, 0.75, -2.38] },
  glassOpacity: 0.26,
  sound: { fires: 2, harmonics: [0, 0.6, 1, 0.3, 0.5, 0.15, 0.2, 0.08, 0.06, 0.04, 0.03, 0.02, 0.02, 0.01, 0.01, 0.01], odd: 0.5, even: 1, sub: 0.4, tone: 180, toneRpm: 0.16, gain: 0.7, drive: 1.9, intake: 1.1 },
  defaultColor: 0xb4b8bc,
  colors: [0xb4b8bc, 0x1c1e22, 0x24324a, 0xe6e4de, 0x3a4636, 0x6a2a26, 0x8c8676, 0x4e5458],
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
  // the engine bay is empty in the source: a longitudinal four, radiator, belt and filter; the
  // battery, tank and spare as on the real car
  extras(model, M) {
    model.addPart('engine', PP.inlineFour(M, V(0, 0.47, 1.2), { len: 0.56, rot: -Math.PI / 2 }));
    model.addPart('radiator', PP.radiator(M, V(0, 0.5, 1.78), { w: 0.64, h: 0.36 }));
    // on the nose: water pump over the crank, alternator up on the exhaust side, one belt round all
    model.addPart('waterpump', PP.waterPump(M, V(0, 0.56, 1.495), { face: 'z' }));
    model.addPart('alternator', PP.alternator(M, V(0.2, 0.62, 1.473), { face: 'z' }));
    model.addPart('fanbelt', PP.beltLoop([{ c: V(0, 0.39, 1.58), r: 0.07 }, { c: V(0, 0.56, 1.58), r: 0.05 }, { c: V(0.2, 0.62, 1.58), r: 0.035 }], { plane: 'z' }));
    // starter low on the intake side, its pinion into the bell housing; the filter up front
    model.addPart('starter', PP.starter(M, V(-0.17, 0.36, 1.0), { face: '-z' }));
    model.addPart('oilfilter', PP.oilFilter(M, V(-0.27, 0.79, 1.56)));
    model.addPart('sparkplugs', PP.plugLeads(M, [-0.2, -0.067, 0.067, 0.2].map((dz) => V(-0.04, 0.77, 1.2 + dz)), { coils: true }));
    model.addPart('airfilter', PP.airFilter(M, V(-0.3, 0.68, 1.4), { h: 0.09 }));
    model.addPart('battery', PP.battery(M, V(-0.5, 0.52, -1.95), { spec: '12V  74Ah', size: [0.19, 0.19, 0.28] }));
    model.addPart('fueltank', PP.fuelTank(V(0, 0.3, -0.98), { w: 0.82, h: 0.22, d: 0.46 }));
    model.addPart('spare', PP.spareWheel(model, V(0.15, 0.44, -1.95)));
  },
};
