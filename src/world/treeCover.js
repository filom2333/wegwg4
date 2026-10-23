// Where the trees are, as a smooth field: the groves the scatter grows (its species densities by
// biome, its clustering noise, the expected share of trees kept at each threshold), for what
// stands in for them far away - the far tree cards (farForestGen.js) and the canopy the terrain
// shader paints (terrainMesh.js). Pure: runs in the workers.

import { ROAD } from './worldGen.js';
import { SPECIES } from './scatterGen.js';

// crown area one tree shades (m²)
const CROWN = { pine: 34, snowpine: 30, birch: 24, birchbare: 16 };
export const TREES = SPECIES.filter((s) => CROWN[s.id]).map((s) => ({ id: s.id, variants: s.variants, dens: s.dens, cluster: s.cluster ?? -1, slope: s.slope || 0.86, crown: CROWN[s.id] }));

// Each tree species' share of the ground under crowns at (x, z) into `out` (by TREES index);
// returns the total (can exceed 1 where groves are dense). bw: biome weights, ny: ground normal y.
export function treeParts(gen, x, z, bw, ny, out) {
  const n = gen.nC.noise2(x * 0.011, z * 0.011);
  let cov = 0;
  for (let i = 0; i < TREES.length; i++) {
    const t = TREES[i];
    out[i] = 0;
    if (ny < t.slope - 0.04) continue;
    let d = 0;
    for (const b in bw) d += (t.dens[b] || 0) * bw[b];
    if (d <= 0) continue;
    const keep = Math.min(1, Math.max(0, (n - t.cluster) / 0.2));
    out[i] = (d / 1000) * keep * t.crown;
    cov += out[i];
  }
  return cov;
}

// How much of that the road and the places' yards leave (0..1).
export function treeRoom(gen, x, z, pois) {
  let k = Math.min(1, Math.max(0, (gen.roadDist(x, z) - ROAD.halfWidth - 8) / 16));
  for (const p of pois) {
    const dp = Math.hypot(x - p.x, z - p.z);
    if (dp < p.padR + 30) k *= Math.max(0, (dp - p.padR) / 30);
  }
  return k;
}

const PARTS = new Float32Array(TREES.length);

// Fraction of the ground under tree crowns (0..1).
export function treeCover(gen, x, z, bw, ny, pois) {
  const cov = treeParts(gen, x, z, bw, ny, PARTS);
  if (cov <= 0) return 0;
  return Math.min(1, cov * treeRoom(gen, x, z, pois));
}
