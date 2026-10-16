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
  if (msg.type === 'tile') {
    const t = buildTerrainTile(gen, msg.x0, msg.z0, msg.size, msg.N, true);
    const transfer = [t.position.buffer, t.normal.buffer, t.mat.buffer, t.mat2.buffer, t.tint.buffer, t.uv.buffer, t.index.buffer, t.heights.buffer];
    self.postMessage({ type: 'tile', id: msg.id, data: t }, transfer);
  }
};
