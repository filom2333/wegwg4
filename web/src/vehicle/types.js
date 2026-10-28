// Every drivable car type. A type bundles the measured spec (seats, controls, hotspots, collision
// boxes, dynamics), its part table, engine sound recipe and the functions that load the asset and
// build materials, the scene graph and a roadside wreck from it.

import { BEETLE } from './beetle/type.js';
import { SEDAN88 } from './sedan88/type.js';
import { W203 } from './w203/type.js';
import { KIRI86 } from './kiri86/type.js';

// every type a save may hold; the Beetle is retired (old saves still drive theirs)
export const CAR_TYPES = { beetle: BEETLE, sedan88: SEDAN88, w203: W203, kiri86: KIRI86 };
// the cars a new run starts with or finds along the road (the '04 Kronberg is retired: old saves
// still drive theirs)
export const CAR_TYPE_LIST = [KIRI86, SEDAN88];

export function carType(id) {
  return CAR_TYPES[id] || KIRI86;
}
