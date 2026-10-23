// The far forest's trees for one 256 m cell: one tree card every ~13 m where the groves are
// (treeCover.js), each standing for the few trees around it, so the woods run on past the
// scatter's ring towards the horizon. Pure: runs in the far forest worker.
//
// Per tree, 6 floats: kind (TREES index), variant, x and z within the cell, ground y, scale.

import { hashInts, mulberry32 } from '../core/noise.js';
import { TREES, treeParts, treeRoom } from './treeCover.js';

export const FCELL = 256;
export const FSTRIDE = 6;
const N = 20;
const STEP = FCELL / N;

export function farForestCell(gen, ci, cj) {
  const x0 = ci * FCELL,
    z0 = cj * FCELL;
  const rnd = mulberry32(hashInts(gen.seed, ci, cj, 913));
  // heights on the grid (one row and column over, for the slope)
  const W = N + 2;
  const H = new Float32Array(W * W);
  // (grid points in the middle of each 12.8 m square, so neighbouring cells tile)
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) H[j * W + i] = gen.height(x0 + (i - 0.5) * STEP, z0 + (j - 0.5) * STEP);
  const pois = gen.poisNear(z0 + FCELL / 2, 1);
  // only cells near a river or a lake look for water under each tree
  const cx = x0 + FCELL / 2,
    cz = z0 + FCELL / 2;
  const rv = gen.riverAt(cx, cz);
  const water = (rv && !rv.r.dry && rv.d < rv.r.w + FCELL) || gen.lakesNear(cz, 1).some((l) => Math.hypot(l.x - cx, l.z - cz) < Math.max(l.rx, l.rz) + FCELL);
  const parts = new Float32Array(TREES.length);
  const bw = {};
  const out = [];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const jx = (rnd() - 0.5) * STEP * 0.9,
        jz = (rnd() - 0.5) * STEP * 0.9;
      const x = x0 + (i + 0.5) * STEP + jx,
        z = z0 + (j + 0.5) * STEP + jz;
      const pick = rnd(),
        r2 = rnd(),
        r3 = rnd();
      const gx = (H[(j + 1) * W + i + 2] - H[(j + 1) * W + i]) / (2 * STEP),
        gz = (H[(j + 2) * W + i + 1] - H[j * W + i + 1]) / (2 * STEP);
      const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      gen.biomeWeights(x, z, bw);
      const cov = treeParts(gen, x, z, bw, ny, parts);
      if (cov <= 0.02) continue;
      const room = treeRoom(gen, x, z, pois);
      // groves dense inside, ragged at the edges
      if (pick > Math.min(0.92, cov * 1.1) * room) continue;
      if (water && gen.waterAt(x, z)) continue;
      // which tree: by each species' share here
      let t = r2 * cov,
        k = 0;
      while (k < TREES.length - 1 && t > parts[k]) t -= parts[k++];
      const y = H[(j + 1) * W + i + 1] + gx * jx + gz * jz;
      out.push(k, Math.floor(r3 * TREES[k].variants), x - x0, y, z - z0, 1.05 + rnd() * 0.45);
    }
  return new Float32Array(out);
}
