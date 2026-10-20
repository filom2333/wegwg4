// Dimensions, seats, controls, hotspots and collision boxes of the Beetle, in car space
// (metres; +Z forward, +X to the car's left, ground at y = 0). Measured values come from the
// import tool (beetleMeta.json); the rest is laid out against the model.

import * as THREE from 'three';
import META from './beetleMeta.json';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export { META };

const wr = META.wheel.radius;
export const SPEC = {
  wheelbase: META.wheel.front[2] - META.wheel.rearZ,
  axleF: META.wheel.front[2],
  axleR: META.wheel.rearZ,
  wheelR: wr,
  wheelY: wr,
  trackHalf: Math.abs(META.wheel.front[0]),
  trackHalfR: Math.abs(META.wheel.front[0]) + 0.016,
  frontTip: META.parts.bumper_F.max[2],
  rearTip: META.parts.bumper_R.min[2],
  roofY: META.parts.body.max[1],
  halfWidth: 0.79,
};

// Steering wheel: the source wheel is undersized; it is scaled about its hub to a period-correct
// 380 mm rim.
export const STEER_SCALE = 1.32;
const sw = META.steeringWheel;
export const DRIVER = {
  x: sw.center[0],
  seatZ: 0.16,
  hip: V(sw.center[0], 0.6, -0.02),
  eye: V(sw.center[0], 1.19, -0.05),
  wheelCenter: V(...sw.center),
  wheelNormal: V(...sw.axis).normalize(), // from the hub toward the driver
  rimRadius: (sw.radius - 0.012) * STEER_SCALE,
  shoulder: V(sw.center[0], 0.95, -0.1), // between the shoulders, car space
  shoulderHalf: 0.19,
};

// Points the driver's hand reaches for.
export const CONTROLS = {
  key: V(0.255, 0.915, 0.5), // ignition lock on the right of the steering column
  stalk: V(sw.center[0] + 0.1, 0.95, 0.47), // indicator / light stalk left of the column
  shifter: V(0, 0.73, 0.45), // gear lever knob
  handbrake: V(0, 0.6, 0.16),
  horn: V(...sw.center).addScaledVector(V(...sw.axis).normalize(), 0.04),
};

export const SEATS = {
  driver: { pos: DRIVER.eye.clone(), door: 'door_FL', part: 'seat_FL', exit: V(1.35, 0.0, 0.05) },
  passenger: { pos: V(-sw.center[0], 1.17, -0.04), door: 'door_FR', part: 'seat_FR', exit: V(-1.35, 0.0, 0.05) },
  rearL: { pos: V(0.3, 1.13, -0.68), door: 'door_FL', part: 'seat_R', exit: V(1.35, 0.0, 0.05) },
  rearR: { pos: V(-0.3, 1.13, -0.68), door: 'door_FR', part: 'seat_R', exit: V(-1.35, 0.0, 0.05) },
};

// Interaction hotspots: `lid` must be open (or removed) to reach them.
export const HOTSPOTS = [
  { id: 'fuel', label: 'Fuel filler', pos: V(-0.22, 0.83, 0.86), r: 0.12, part: 'fueltank', lid: 'trunk' },
  { id: 'oil', label: 'Oil filler', pos: V(0.21, 0.79, -1.46), r: 0.1, part: 'engine', lid: 'hood' },
  { id: 'battery', label: 'Battery', pos: V(0.36, 0.73, 0.86), r: 0.13, part: 'battery', lid: 'trunk' },
  { id: 'ignition', label: 'Ignition', pos: CONTROLS.key.clone(), r: 0.06, part: 'steeringWheel', inside: true },
  { id: 'lights', label: 'Light switch', pos: V(0.0707, 1.076, 0.528), r: 0.04, part: 'body', inside: true },
  { id: 'wipers', label: 'Wiper switch', pos: V(-0.081, 1.076, 0.528), r: 0.04, part: 'body', inside: true },
  { id: 'radio', label: 'Radio', pos: V(...META.dash.radio.center), r: 0.08, part: 'body', inside: true },
];

// Where things happen around the car (effects, sounds, reach checks).
export const POINTS = {
  exhaust: V(0.17, 0.32, -2.05), // right tail pipe (two pipes; smoke from both)
  exhaust2: V(-0.17, 0.32, -2.05),
  engine: V(0, 0.75, -1.55),
  engineLidTop: V(0, 1.02, -1.5),
  headlampGlare: V(0, 0.68, 1.9),
  frontTrunk: V(0, 0.85, 1.9), // stand here to reach into the front trunk
  tailLights: V(0, 0.63, -1.75),
  cabin: V(0, 1.2, -0.25),
  dome: V(0, 1.5, -0.62),
};

// Compound collision boxes: [part, centre, half extents, { rotX, tag, closedOnly }]
// Rotations: rotX turns the box's local +Z up (negative) or down (positive) about the X axis.
export const BOXES = [
  // platform: floor pan with tunnel, front beam, rear frame horns
  ['chassis', [0, 0.32, -0.15], [0.62, 0.05, 0.85], { tag: 'floor' }],
  ['chassis', [0, 0.43, -0.12], [0.07, 0.06, 0.78]],
  ['chassis', [0, 0.3, 1.35], [0.5, 0.06, 0.2]],
  ['chassis', [0, 0.33, -1.35], [0.4, 0.05, 0.3]],
  // body shell
  ['body', [0.69, 0.42, -0.15], [0.07, 0.1, 0.72]],
  ['body', [-0.69, 0.42, -0.15], [0.07, 0.1, 0.72]],
  ['body', [0, 0.47, 1.2], [0.52, 0.03, 0.45], { tag: 'trunkFloor' }],
  ['body', [0, 0.72, 1.68], [0.56, 0.24, 0.05]],
  ['body', [0.52, 0.75, 1.15], [0.04, 0.28, 0.48]],
  ['body', [-0.52, 0.75, 1.15], [0.04, 0.28, 0.48]],
  ['body', [0, 0.75, 0.66], [0.6, 0.3, 0.03]],
  ['body', [0, 0.97, 0.58], [0.66, 0.09, 0.07], { tag: 'dash' }],
  ['body', [0, 1.27, 0.485], [0.55, 0.02, 0.26], { rotX: 0.775, tag: 'windshield' }],
  ['body', [0, 1.555, -0.3], [0.56, 0.03, 0.56], { tag: 'roof' }],
  ['body', [0, 1.29, -1.08], [0.44, 0.02, 0.24], { rotX: -0.72, tag: 'rearglass' }],
  ['body', [0, 1.0, -1.12], [0.55, 0.03, 0.18], { tag: 'parcel' }],
  ['body', [0, 0.72, -1.33], [0.6, 0.3, 0.03], { tag: 'partition' }],
  ['body', [0.62, 1.15, -0.95], [0.05, 0.3, 0.3]],
  ['body', [-0.62, 1.15, -0.95], [0.05, 0.3, 0.3]],
  ['body', [0.6, 1.25, 0.62], [0.04, 0.24, 0.05]],
  ['body', [-0.6, 1.25, 0.62], [0.04, 0.24, 0.05]],
  // panels
  ['door_FL', [0.68, 0.7, 0.17], [0.05, 0.3, 0.44], { closedOnly: true }],
  ['door_FR', [-0.68, 0.7, 0.17], [0.05, 0.3, 0.44], { closedOnly: true }],
  ['door_FL', [0.6, 1.2, 0.15], [0.03, 0.2, 0.38], { closedOnly: true }],
  ['door_FR', [-0.6, 1.2, 0.15], [0.03, 0.2, 0.38], { closedOnly: true }],
  ['trunk', [0, 0.92, 1.2], [0.56, 0.03, 0.58], { rotX: 0.395, closedOnly: true }],
  ['hood', [0, 0.76, -1.63], [0.46, 0.03, 0.38], { rotX: -1.02, closedOnly: true }],
  ['fender_FL', [0.62, 0.62, 1.2], [0.14, 0.2, 0.48]],
  ['fender_FR', [-0.62, 0.62, 1.2], [0.14, 0.2, 0.48]],
  ['fender_RL', [0.64, 0.62, -1.2], [0.13, 0.22, 0.5]],
  ['fender_RR', [-0.64, 0.62, -1.2], [0.13, 0.22, 0.5]],
  ['bumper_F', [0, 0.5, 1.8], [0.72, 0.1, 0.1]],
  ['bumper_R', [0, 0.5, -1.86], [0.72, 0.1, 0.12]],
  // seats
  ['seat_FL', [0.3, 0.57, 0.18], [0.24, 0.06, 0.2], { tag: 'seat' }],
  ['seat_FR', [-0.3, 0.57, 0.18], [0.24, 0.06, 0.2], { tag: 'seat' }],
  ['seat_FL', [0.3, 0.8, -0.08], [0.23, 0.22, 0.05], { rotX: 0.3 }],
  ['seat_FR', [-0.3, 0.8, -0.08], [0.23, 0.22, 0.05], { rotX: 0.3 }],
  ['seat_R', [0, 0.55, -0.5], [0.54, 0.06, 0.2], { tag: 'seat' }],
  ['seat_R', [0, 0.8, -0.78], [0.54, 0.24, 0.05], { rotX: 0.2 }],
  ['engine', [0, 0.6, -1.53], [0.36, 0.24, 0.17], { tag: 'engine' }],
];

// Physical setup: 1600 cc air-cooled flat four, four-speed transaxle, rear drive, torsion bars.
export const DYNAMICS = {
  restLength: 0.26,
  maxCompression: 0.17,
  springF: 16500,
  springR: 22500,
  damperBump: 1700,
  damperRebound: 2500,
  arbF: 4200,
  arbR: 1600,
  wheelRadius: wr,
  wheelInertia: 1.0,
  maxSteer: (36 * Math.PI) / 180,
  wheelbase: META.wheel.front[2] - META.wheel.rearZ,
  track: 1.32,
  brakeTorque: 1350,
  brakeRear: 0.8,
  handbrakeTorque: 1300,
  gears: [-3.88, 0, 3.8, 2.06, 1.32, 0.89],
  finalDrive: 4.125,
  idleRpm: 850,
  redline: 4800,
  engineInertia: 0.13,
  engineFriction: 0.006,
  clutchMaxTorque: 230,
  drag: 0.5 * 1.2 * 0.48 * 1.8,
  torqueCurve: [
    [0, 0],
    [600, 52],
    [1000, 76],
    [1600, 92],
    [2200, 102],
    [2800, 106],
    [3400, 103],
    [4000, 95],
    [4400, 85],
    [4800, 68],
    [5200, 40],
  ],
  shiftUp: [2300, 1700],
  shiftDown: [1150, 500],
};

// Drive wheels and steering.
export const HARDPOINTS = [
  { id: 'wheel_FL', x: SPEC.trackHalf, z: SPEC.axleF, steer: true },
  { id: 'wheel_FR', x: -SPEC.trackHalf, z: SPEC.axleF, steer: true },
  { id: 'wheel_RL', x: SPEC.trackHalfR, z: SPEC.axleR, drive: true },
  { id: 'wheel_RR', x: -SPEC.trackHalfR, z: SPEC.axleR, drive: true },
];

export const SPEEDO_MAX = 140; // km/h on the dial
