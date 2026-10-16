// Part catalogue: mass, mounting dependencies, labels and functional role of every
// removable component of the sedan.

export const PARTS = {
  chassis: { label: 'Chassis', mass: 165, requires: [], fixed: true, desc: 'Ladder frame, suspension and steering rack.' },
  body: { label: 'Body shell', mass: 215, requires: ['chassis'], desc: 'Welded shell with fixed glass. Everything else bolts to it.' },
  door_FL: { label: 'Front door (left)', mass: 24, requires: ['body'], desc: 'Driver door with window and mirror.' },
  door_FR: { label: 'Front door (right)', mass: 24, requires: ['body'] },
  door_RL: { label: 'Rear door (left)', mass: 21, requires: ['body'] },
  door_RR: { label: 'Rear door (right)', mass: 21, requires: ['body'] },
  hood: { label: 'Hood', mass: 14, requires: ['body'] },
  trunk: { label: 'Trunk lid', mass: 12, requires: ['body'] },
  fender_L: { label: 'Front fender (left)', mass: 4, requires: ['body'] },
  fender_R: { label: 'Front fender (right)', mass: 4, requires: ['body'] },
  bumper_F: { label: 'Front bumper', mass: 6, requires: ['body'], desc: 'Absorbs frontal impacts before they reach the radiator.' },
  bumper_R: { label: 'Rear bumper', mass: 6, requires: ['body'] },
  headlight_L: { label: 'Headlight (left)', mass: 2.5, requires: ['bumper_F', 'fender_L'] },
  headlight_R: { label: 'Headlight (right)', mass: 2.5, requires: ['bumper_F', 'fender_R'] },
  taillight_L: { label: 'Tail light (left)', mass: 1.5, requires: ['body'] },
  taillight_R: { label: 'Tail light (right)', mass: 1.5, requires: ['body'] },
  fuelflap: { label: 'Fuel flap', mass: 0.3, requires: ['body'], fixed: true },
  engine: { label: 'Engine 1.6 16V', mass: 128, requires: ['chassis'], needsHoodOpen: true, desc: 'Transverse four-cylinder with 5-speed gearbox.' },
  battery: { label: 'Battery 12 V', mass: 15, requires: ['body'], needsHoodOpen: true, desc: 'Starts the engine and powers the lights.' },
  radiator: { label: 'Radiator', mass: 7, requires: ['body'], needsHoodOpen: true, desc: 'Without it the engine overheats within minutes.' },
  airfilter: { label: 'Air filter box', mass: 2, requires: ['engine'], needsHoodOpen: true, desc: 'Keeps dust out of the engine.' },
  exhaust: { label: 'Exhaust', mass: 14, requires: ['chassis'], desc: 'Muffles the engine.' },
  fueltank: { label: 'Fuel tank 50 l', mass: 12, requires: ['chassis'], desc: 'Holds the fuel.' },
  seat_FL: { label: 'Driver seat', mass: 17, requires: ['body'], desc: 'You need it to drive.' },
  seat_FR: { label: 'Passenger seat', mass: 17, requires: ['body'] },
  seat_R: { label: 'Rear bench', mass: 24, requires: ['body'] },
  steeringWheel: { label: 'Steering wheel', mass: 2.5, requires: ['body'], desc: 'Needed to steer.' },
  wheel_FL: { label: 'Wheel (front left)', mass: 18, requires: ['chassis'] },
  wheel_FR: { label: 'Wheel (front right)', mass: 18, requires: ['chassis'] },
  wheel_RL: { label: 'Wheel (rear left)', mass: 18, requires: ['chassis'] },
  wheel_RR: { label: 'Wheel (rear right)', mass: 18, requires: ['chassis'] },
};

// Parts that are interchangeable: a spare wheel fits any wheel slot, etc.
export const PART_FAMILY = {
  wheel_FL: 'wheel',
  wheel_FR: 'wheel',
  wheel_RL: 'wheel',
  wheel_RR: 'wheel',
};

// Order in which an unassembled car is presented / assembled.
export const ASSEMBLY_ORDER = [
  'chassis',
  'wheel_FL',
  'wheel_FR',
  'wheel_RL',
  'wheel_RR',
  'fueltank',
  'exhaust',
  'engine',
  'body',
  'radiator',
  'battery',
  'airfilter',
  'fender_L',
  'fender_R',
  'bumper_F',
  'bumper_R',
  'headlight_L',
  'headlight_R',
  'taillight_L',
  'taillight_R',
  'door_FL',
  'door_FR',
  'door_RL',
  'door_RR',
  'hood',
  'trunk',
  'seat_FL',
  'seat_FR',
  'seat_R',
  'steeringWheel',
];

export function dependentsOf(id) {
  return Object.entries(PARTS)
    .filter(([, p]) => p.requires.includes(id))
    .map(([k]) => k);
}
