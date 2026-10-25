// Terrain tile mesher (pure, worker-safe). Vertices are relative to the tile origin.

import { BIOMES, BIOME_INFO, ROAD } from './worldGen.js';
import { treeCover } from './treeCover.js';

export function buildTerrainTile(gen, x0, z0, size, N, withSkirt = true) {
  const step = size / N;
  const W = N + 1;
  // heights with a 1-vertex border for normals
  const HW = N + 3;
  const H = new Float32Array(HW * HW);
  for (let j = 0; j < HW; j++) {
    for (let i = 0; i < HW; i++) {
      const x = x0 + (i - 1) * step,
        z = z0 + (j - 1) * step;
      H[j * HW + i] = gen.height(x, z);
    }
  }
  // The road lies on top at every distance: near it no vertex stands above the lowest road surface
  // within a cell along it. (On a far, coarse tile the triangles across the road join points a
  // cell apart: in a dip, or between the banks of a cutting, they would pass over the asphalt and
  // the ground would show through it.) Coarse tiles also lower the points a cell beyond the
  // shoulder, whose triangles reach over its edge.
  const corridor = ROAD.halfWidth + ROAD.shoulder;
  const reach = corridor + (step > 2 ? step : 0);
  const ds = Math.max(1, step / 4);
  for (let j = 0; j < HW; j++) {
    const z = z0 + (j - 1) * step;
    const rx = gen.roadX(z);
    for (let i = 0; i < HW; i++) {
      const x = x0 + (i - 1) * step;
      if (Math.abs(x - rx) > reach) continue;
      let lo = Infinity;
      for (let s = -step; s <= step + 1e-6; s += ds) lo = Math.min(lo, gen.roadSurfaceY(gen.roadX(z + s), z + s));
      const cap = lo - 0.03;
      if (H[j * HW + i] > cap) H[j * HW + i] = cap;
    }
  }
  const vCount = W * W + (withSkirt ? 4 * W : 0);
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const mat = new Float32Array(vCount * 4); // sand, dirt, rock, salt
  const mat2 = new Float32Array(vCount * 4); // grass, snow, forest floor, gravel
  const tint = new Float32Array(vCount * 4); // biome colour, shrub cover
  const tree = new Float32Array(vCount); // tree crown cover (far canopy)
  const pois = gen.poisNear(z0 + size / 2, Math.ceil(size / 1200) + 1);
  const uv = new Float32Array(vCount * 2);
  const bw = {};
  let minY = Infinity,
    maxY = -Infinity;
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const x = x0 + i * step,
        z = z0 + j * step;
      const h = H[(j + 1) * HW + (i + 1)];
      pos[k * 3] = i * step;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = j * step;
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
      const hx = H[(j + 1) * HW + (i + 2)] - H[(j + 1) * HW + i];
      const hz = H[(j + 2) * HW + (i + 1)] - H[j * HW + (i + 1)];
      let nx = -hx,
        ny = 2 * step,
        nz = -hz;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      nrm[k * 3] = nx;
      nrm[k * 3 + 1] = ny;
      nrm[k * 3 + 2] = nz;
      gen.biomeWeights(x, z, bw);
      const m = gen.groundMaterial(x, z, ny, bw);
      mat[k * 4] = m[0];
      mat[k * 4 + 1] = m[1];
      mat[k * 4 + 2] = m[2];
      mat[k * 4 + 3] = m[3];
      mat2[k * 4] = m[4];
      mat2[k * 4 + 1] = m[5];
      mat2[k * 4 + 2] = m[6];
      mat2[k * 4 + 3] = m[7];
      let r = 0,
        g = 0,
        b = 0,
        veg = 0;
      for (const bb of BIOMES) {
        const w = bw[bb];
        if (!w) continue;
        const c = BIOME_INFO[bb].ground;
        r += c[0] * w;
        g += c[1] * w;
        b += c[2] * w;
        veg += (BIOME_INFO[bb].shrubs || 0) * w;
      }
      // broad colour drift across the land: redder, yellower and greyer stretches
      const cv = gen.tintDrift(x, z);
      tint[k * 4] = r * cv[0];
      tint[k * 4 + 1] = g * cv[1];
      tint[k * 4 + 2] = b * cv[2];
      tint[k * 4 + 3] = veg * (0.55 + 0.9 * Math.max(0, gen.nC.noise2(x * 0.004 + 3, z * 0.004 - 8) * 0.5 + 0.5 - 0.2));
      tree[k] = treeCover(gen, x, z, bw, ny, pois);
      // world-space texture coordinates wrapped to keep float precision
      uv[k * 2] = ((x % 2048) + 2048) % 2048;
      uv[k * 2 + 1] = ((z % 2048) + 2048) % 2048;
    }
  }
  const idx = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * W + i,
        b = a + 1,
        c = a + W + 1,
        d = a + W;
      // alternate diagonal for better shape following
      if ((i + j) % 2 === 0) idx.push(a, d, b, b, d, c);
      else idx.push(a, d, c, a, c, b);
    }
  }
  if (withSkirt) {
    // skirts drop below each edge to hide LOD cracks
    const drop = Math.max(1.5, step * 1.2);
    const edges = [
      Array.from({ length: W }, (_, i) => i), // z0 edge
      Array.from({ length: W }, (_, i) => N * W + i), // z1 edge
      Array.from({ length: W }, (_, j) => j * W), // x0 edge
      Array.from({ length: W }, (_, j) => j * W + N), // x1 edge
    ];
    let base = W * W;
    edges.forEach((edge, e) => {
      for (let t = 0; t < W; t++) {
        const src = edge[t];
        const k = base + t;
        pos[k * 3] = pos[src * 3];
        pos[k * 3 + 1] = pos[src * 3 + 1] - drop;
        pos[k * 3 + 2] = pos[src * 3 + 2];
        nrm.set(nrm.subarray(src * 3, src * 3 + 3), k * 3);
        mat.set(mat.subarray(src * 4, src * 4 + 4), k * 4);
        mat2.set(mat2.subarray(src * 4, src * 4 + 4), k * 4);
        tint.set(tint.subarray(src * 4, src * 4 + 4), k * 4);
        tree[k] = tree[src];
        uv.set(uv.subarray(src * 2, src * 2 + 2), k * 2);
      }
      for (let t = 0; t < W - 1; t++) {
        const a = edge[t],
          b = edge[t + 1],
          c = base + t + 1,
          d = base + t;
        // winding so skirts face outward
        if (e === 0 || e === 3) idx.push(a, b, d, b, c, d);
        else idx.push(a, d, b, b, d, c);
      }
      base += W;
    });
  }
  return {
    position: pos,
    normal: nrm,
    mat,
    mat2,
    tint,
    tree,
    uv,
    index: new Uint32Array(idx),
    minY,
    maxY,
    heights: H,
    HW,
    step,
  };
}
