// Vegetation and rock placement: species table and the deterministic per-cell instance list.
// Pure (no THREE): runs in the scatter worker.
//
// Per instance, 8 floats: species index, variant, x and z within the cell, ground y, scale,
// yaw, and a random 0..1 used for distance thinning / tinting.

import { hashInts, mulberry32 } from '../core/noise.js';
import { ROAD, TRACK } from './worldGen.js';

export const CELL = 64;
export const STRIDE = 8;

// dens: instances per 1000 m² by biome. near: only drawn close by (ring = cells around the
// player's cell). lod1: what stands in further out ('impostor' cards, a coarser 'mesh', or none).
// solid: collider shape near the player. cluster: noise threshold that groups them (forests,
// meadows); slope: steepest ground (normal y) they grow on.
export const SPECIES = [
  { id: 'grass', variants: 4, near: 2, dens: { scrub: 165, dunes: 16, badlands: 34, saltflat: 0.8, highland: 85 }, scale: [1.0, 1.9], sway: 'grass', shadow: false, cluster: -0.25 },
  { id: 'meadow', variants: 4, near: 2, dens: { prairie: 330, forest: 45, highland: 14 }, scale: [1.0, 1.7], sway: 'grass', shadow: false, cluster: -0.45 },
  { id: 'snowgrass', variants: 3, near: 2, dens: { taiga: 9, tundra: 22 }, scale: [0.8, 1.4], sway: 'grass', shadow: false, cluster: -0.2 },
  { id: 'shrub', variants: 4, near: 4, lod1: 'mesh', dens: { scrub: 30, dunes: 6, badlands: 11, saltflat: 0.3, highland: 17, prairie: 4.5 }, scale: [0.6, 1.7], sway: 'shrub', cluster: -0.15 },
  { id: 'yucca', variants: 3, near: 3, dens: { scrub: 1.4, dunes: 0.5, badlands: 0.5, highland: 2.2, prairie: 0.3 }, scale: [0.8, 1.3], cluster: -0.05 },
  { id: 'tundrashrub', variants: 3, near: 3, lod1: 'mesh', dens: { tundra: 8, taiga: 1.6 }, scale: [0.8, 1.6], cluster: -0.25 },
  { id: 'fern', variants: 3, near: 2, dens: { forest: 34 }, scale: [0.8, 1.5], sway: 'shrub', shadow: false, cluster: -0.2 },
  { id: 'flowers', variants: 4, near: 2, dens: { prairie: 26, forest: 3, highland: 1.5 }, scale: [0.8, 1.3], sway: 'grass', shadow: false, cluster: 0.05 },
  { id: 'reeds', variants: 3, near: 2, dens: {}, shore: 260, scale: [0.8, 1.3], sway: 'grass', shadow: false },
  { id: 'pebble', variants: 3, near: 2, dens: { scrub: 2, dunes: 0.3, badlands: 5, saltflat: 0.2, highland: 7, prairie: 0.8, forest: 1, tundra: 2.5 }, scale: [0.12, 0.35], rock: true, shadow: false },
  { id: 'barrel', variants: 2, near: 3, dens: { scrub: 0.4, dunes: 0.05, badlands: 0.6, highland: 0.2 }, scale: [0.8, 1.3] },
  { id: 'boulder', variants: 4, lod1: 'mesh', dens: { scrub: 0.25, dunes: 0.04, badlands: 1.1, saltflat: 0.02, highland: 1.6, prairie: 0.05, forest: 0.12 }, scale: [0.6, 2.2], rock: true, solid: 'ball' },
  // photographed, mossy boulders in the green country (real models)
  { id: 'mossrock', variants: 3, lod1: 'mesh', glb: 'rockMoss', dens: { forest: 0.6, prairie: 0.12, taiga: 0.3, tundra: 0.15 }, scale: [0.6, 2.0], rock: true, solid: 'ball' },
  { id: 'snowrock', variants: 3, lod1: 'mesh', dens: { taiga: 0.55, tundra: 1.3 }, scale: [0.6, 2.4], rock: true, solid: 'ball' },
  { id: 'slab', variants: 3, lod1: 'mesh', dens: { scrub: 0.1, dunes: 0.02, badlands: 0.4, saltflat: 0.01, highland: 0.5, tundra: 0.15 }, scale: [0.8, 2.4], rock: true, solid: 'ball' },
  { id: 'saguaro', variants: 3, lod1: 'impostor', dens: { scrub: 0.3, dunes: 0.05, badlands: 0.35, highland: 0.12 }, scale: [0.85, 1.25], solid: 'trunk', cluster: -0.1 },
  { id: 'ocotillo', variants: 3, lod1: 'impostor', dens: { scrub: 0.16, badlands: 0.22, highland: 0.1 }, scale: [0.85, 1.2], cluster: 0.0 },
  { id: 'joshua', variants: 3, lod1: 'impostor', dens: { scrub: 0.34, dunes: 0.01, badlands: 0.05, highland: 0.55 }, scale: [0.9, 1.5], solid: 'trunk', cluster: -0.1 },
  { id: 'deadtree', variants: 3, lod1: 'impostor', dens: { scrub: 0.05, dunes: 0.02, badlands: 0.06, saltflat: 0.01, highland: 0.1, prairie: 0.02, tundra: 0.04 }, scale: [0.8, 1.4], solid: 'trunk' },
  // hoodoos: only in groups at the feet of the mesas, well off the road
  { id: 'hoodoo', variants: 3, lod1: 'mesh', dens: { badlands: 0.9 }, scale: [0.7, 1.5], rock: true, solid: 'trunkWide', place: (gen, x, z, dRoad) => {
    if (dRoad < 120) return false;
    const mm = gen.mesaNoise(x, z);
    return mm > 0.17 && mm < 0.29;
  } },
  { id: 'pine', mid: 3, variants: 4, lod1: 'impostor', dens: { forest: 20, prairie: 0.45, highland: 0.25 }, scale: [0.8, 1.25], sway: 'tree', solid: 'trunk', cluster: -0.15, slope: 0.78, far: 0.85 },
  { id: 'snowpine', mid: 3, variants: 4, lod1: 'impostor', snow: true, dens: { taiga: 15, tundra: 0.35 }, scale: [0.7, 1.25], sway: 'tree', solid: 'trunk', cluster: -0.2, slope: 0.78, far: 0.85 },
  { id: 'birch', mid: 3, variants: 3, lod1: 'impostor', dens: { forest: 3.4, prairie: 0.6 }, scale: [0.85, 1.2], sway: 'tree', solid: 'trunk', cluster: 0.1 },
  { id: 'birchbare', mid: 3, variants: 3, lod1: 'impostor', snow: true, dens: { taiga: 0.9, tundra: 0.06 }, scale: [0.85, 1.2], solid: 'trunk', cluster: 0.1 },
  { id: 'stump', variants: 3, near: 3, dens: { forest: 0.8, taiga: 0.4 }, scale: [0.8, 1.3], solid: 'stump' },
  { id: 'log', variants: 3, near: 3, dens: { forest: 0.35, taiga: 0.25 }, scale: [0.9, 1.2], solid: 'log' },
];
export const SPECIES_INDEX = Object.fromEntries(SPECIES.map((s, i) => [s.id, i]));
export const BIOME_LIST = ['scrub', 'dunes', 'badlands', 'saltflat', 'highland', 'prairie', 'forest', 'taiga', 'tundra'];

// Deterministic instances for one cell (global cell indices).
export function cellInstances(gen, ci, cj) {
  const out = [];
  const x0 = ci * CELL,
    z0 = cj * CELL;
  const bw = gen.biomeWeights(x0 + CELL / 2, z0 + CELL / 2);
  let topB = 'scrub',
    topW = -1;
  for (const b in bw)
    if (bw[b] > topW) {
      topW = bw[b];
      topB = b;
    }
  const biomeIdx = BIOME_LIST.indexOf(topB);
  const rnd = mulberry32(hashInts(gen.seed, ci, cj, 77));
  const pois = gen.poisNear(z0 + CELL / 2, 1);
  // shoreline band for reeds: only if a river or lake is close to this cell
  const water = gen.waterAt(x0 + CELL / 2, z0 + CELL / 2);
  const rv = gen.riverAt(x0 + CELL / 2, z0 + CELL / 2);
  const lakes = gen.lakesNear(z0 + CELL / 2, 1);
  const nearWater = !!water || (rv && !rv.r.dry && rv.d < rv.r.w + CELL) || lakes.some((l) => Math.hypot(l.x - x0 - CELL / 2, l.z - z0 - CELL / 2) < Math.max(l.rx, l.rz) + CELL);
  for (let si = 0; si < SPECIES.length; si++) {
    const def = SPECIES[si];
    let dens = 0;
    for (const b in bw) dens += (def.dens[b] || 0) * bw[b];
    if (def.shore && nearWater) dens = def.shore * (1 - (bw.dunes + bw.saltflat + bw.badlands) * 0.9) * (1 - (bw.taiga + bw.tundra) * 0.7);
    if (dens <= 0) continue;
    const expected = (dens * CELL * CELL) / 1000;
    let n = Math.floor(expected);
    if (rnd() < expected - n) n++;
    for (let i = 0; i < n; i++) {
      const x = x0 + rnd() * CELL,
        z = z0 + rnd() * CELL;
      const r1 = rnd(),
        r2 = rnd(),
        r3 = rnd(),
        r4 = rnd();
      // clustering: groves, clearings and patches instead of an even sprinkle
      if (def.cluster !== undefined && gen.nC.noise2(x * (def.sway === 'tree' ? 0.011 : 0.03), z * (def.sway === 'tree' ? 0.011 : 0.03)) < def.cluster + r3 * 0.2) continue;
      const rx = gen.roadX(z);
      const dRoad = Math.abs(x - rx);
      if (dRoad < ROAD.halfWidth + ROAD.shoulder + (def.solid ? 6 : 1.5)) continue;
      const tn = gen.trackNear(x, z);
      if (tn && tn.d < TRACK.halfWidth + TRACK.shoulder + (def.solid ? 4 : 0.8)) continue;
      if (def.place && !def.place(gen, x, z, dRoad)) continue;
      let blocked = false;
      for (const p of pois) if (Math.hypot(x - p.x, z - p.z) < p.padR + (def.solid ? 8 : 2)) blocked = true;
      if (blocked) continue;
      if (def.shore) {
        // reeds: in the band just outside the water's edge
        const w = gen.waterAt(x, z);
        if (w) continue;
        let edge = false;
        for (const [dx, dz] of [
          [3, 0],
          [-3, 0],
          [0, 3],
          [0, -3],
          [5, 5],
          [-5, -5],
        ])
          if (gen.waterAt(x + dx, z + dz)) edge = true;
        if (!edge) continue;
      } else if (nearWater && gen.waterAt(x, z)) continue;
      const y = gen.height(x, z);
      if (!def.rock) {
        const nrm = gen.normal(x, z, 1.0);
        if (nrm[1] < (def.slope || 0.86)) continue;
      }
      const s = def.scale[0] + (def.scale[1] - def.scale[0]) * r1 * r1;
      out.push(si, Math.floor(r2 * def.variants), x - x0, y, z - z0, s, rnd() * Math.PI * 2, def.rock ? biomeIdx + r4 * 0.5 : r4);
    }
  }
  return new Float32Array(out);
}

// Rock sink into the ground (so boulders sit in the soil rather than on it).
export function sinkOf(def, s) {
  return def.rock ? s * 0.18 : def.id === 'log' ? 0.02 : 0.02;
}
