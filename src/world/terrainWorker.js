// Worker: builds terrain tiles off the main thread.

import { WorldGen } from './worldGen.js';
import { buildTerrainTile } from './terrainMesh.js';

let gen = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    gen = new WorldGen(msg.seed);
    self.postMessage({ type: 'ready' });
    return;
  }
  // the heights of a physics tile (n x n cells of `size` metres), row by row in x
  if (msg.type === 'hf') {
    const n = msg.n,
      T = msg.size;
    const H = new Float32Array((n + 1) * (n + 1));
    for (let ix = 0; ix <= n; ix++) for (let iz = 0; iz <= n; iz++) H[ix * (n + 1) + iz] = gen.height(msg.x0 + (ix * T) / n, msg.z0 + (iz * T) / n);
    self.postMessage({ type: 'hf', key: msg.key, x0: msg.x0, z0: msg.z0, H }, [H.buffer]);
    return;
  }
  if (msg.type === 'tile') {
    const t = buildTerrainTile(gen, msg.x0, msg.z0, msg.size, msg.N, true);
    const transfer = [t.position.buffer, t.normal.buffer, t.mat.buffer, t.mat2.buffer, t.tint.buffer, t.tree.buffer, t.uv.buffer, t.index.buffer, t.heights.buffer];
    self.postMessage({ type: 'tile', id: msg.id, data: t }, transfer);
  }
};
