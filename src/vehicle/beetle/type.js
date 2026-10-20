// The Beetle as a car type: spec, parts and model builders behind the common car-type interface
// (see ../types.js).

import * as SPECS from './spec.js';
import { PARTS, PART_FAMILY, ASSEMBLY_ORDER } from './parts.js';
import { loadBeetleAsset, buildBeetleModel, buildBeetleWreck } from './beetleModel.js';
import { createBeetleMaterials } from './beetleMaterials.js';

export const BEETLE = {
  id: 'beetle',
  name: 'Volkswagen Beetle 1300',
  short: 'Beetle',
  year: 1967,
  blurb: 'Air-cooled flat four in the back, four-speed box, nothing to go wrong that a fan belt and a spanner cannot fix. Slow, honest, loud.',
  stats: { power: 50, torque: 106, mass: 820, top: 120, drive: 'RWD', gearbox: '4-speed manual', engine: '1.6 flat-four, air-cooled' },
  ...SPECS,
  PARTS,
  PART_FAMILY,
  ASSEMBLY_ORDER,
  fuelCap: 40,
  oilCap: 3.6,
  coolantCap: 0,
  cooling: 'air',
  manualOnly: false,
  automaticOnly: false,
  // front impacts reach the fuel tank behind the luggage space, rear ones the engine
  crash: { front: 'tank', rear: 'engine' },
  lids: { hood: 'engine lid', trunk: 'front lid' },
  trunk: { label: 'Front trunk', slots: 14, capacity: 120, com: [0, 0.62, 1.3] },
  // things dropped in through the doors ride in here (car space)
  cabin: { hw: 0.72, y0: 0.22, y1: 1.35, z0: -2.15, z1: 0.85 },
  // accessory mounts: roof (gutters to rack top), nose and tail
  MOUNTS: {
    roof: { z: -0.33, l: 1.0, w: 1.0, top: 1.635 },
    front: { z: 1.92, y0: 0.3, y1: 0.98, w: 0.95 },
    rear: { z: -2.05, y: 0.5, w: 0.95, d: 0.48 },
  },
  massSize: [1.55, 1.1, 4.0],
  fuelCom: [0, 0.62, 0.85],
  lights: { head: [0, 0.7, 1.72], headX: 0.53, reverse: [0, 0.6, -2.0] },
  // engine sound: firing pulses per crank turn, harmonic recipe, tone and level
  sound: { fires: 2, harmonics: [0, 1, 0.55, 0.42, 0.3, 0.26, 0.18, 0.15, 0.1, 0.09, 0.06, 0.05, 0.04, 0.03, 0.02, 0.02], odd: 1, even: 0.8, sub: 0.5, tone: 180, toneRpm: 0.18, gain: 1, drive: 2.2, intake: 1 },
  defaultColor: 0xa8502c,
  colors: [0xa8502c, 0x6f8a7a, 0xd8cfb4, 0x2f4a5c, 0x8a2a20, 0x5a5a2e, 0xc9a23a],
  repaintable: true,
  load: (renderer) => loadBeetleAsset(renderer),
  materials: (asset, opts) => createBeetleMaterials(asset.textures, opts),
  build: (asset, mats) => buildBeetleModel(asset, mats),
  wreck: (asset) => buildBeetleWreck(asset),
};
