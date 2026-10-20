// Every drivable car type. A type bundles the measured spec (seats, controls, hotspots, collision
// boxes, dynamics), its part table, engine sound recipe and the functions that load the asset and
// build materials, the scene graph and a roadside wreck from it.

import { BEETLE } from './beetle/type.js';
import { SEDAN88 } from './sedan88/type.js';

export const CAR_TYPES = { beetle: BEETLE, sedan88: SEDAN88 };
export const CAR_TYPE_LIST = [BEETLE, SEDAN88];

export function carType(id) {
  return CAR_TYPES[id] || BEETLE;
}
