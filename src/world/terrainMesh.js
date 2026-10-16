// Terrain tile mesher (pure, worker-safe). Vertices are relative to the tile origin.

import { BIOMES, BIOME_INFO } from './worldGen.js';

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
  const vCount = W * W + (withSkirt ? 4 * W : 0);
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const mat = new Float32Array(vCount * 4); // sand, dirt, rock, salt
  const tint = new Float32Array(vCount * 3);
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
      let r = 0,
        g = 0,
        b = 0;
      for (const bb of BIOMES) {
        const w = bw[bb];
        if (!w) continue;
        const c = BIOME_INFO[bb].ground;
        r += c[0] * w;
        g += c[1] * w;
        b += c[2] * w;
      }
      tint[k * 3] = r;
      tint[k * 3 + 1] = g;
      tint[k * 3 + 2] = b;
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
        tint.set(tint.subarray(src * 3, src * 3 + 3), k * 3);
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
    tint,
    uv,
    index: new Uint32Array(idx),
    minY,
    maxY,
    heights: H,
    HW,
    step,
  };
}
