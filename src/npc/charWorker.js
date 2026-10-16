// Builds character meshes off the main thread: SDF definition -> surface nets arrays.
import { DEFINE } from './characters.js';
import { polygonizeArrays } from './sdfMesh.js';
import { handArrays } from '../player/handShape.js';

self.onmessage = (e) => {
  const { id, type, seed } = e.data;
  if (type === 'hand') {
    const a = handArrays(e.data.pose);
    self.postMessage({ id, type, pose: e.data.pose, arrays: a }, [a.P.buffer, a.N.buffer, a.C.buffer, a.I.buffer]);
    return;
  }
  try {
    const def = DEFINE[type](seed);
    const a = polygonizeArrays(def.model, def.cell, def.defs.map((d) => d[0]));
    const transfer = [a.P.buffer, a.N.buffer, a.C.buffer, a.R.buffer, a.SI.buffer, a.SW.buffer, a.I.buffer, a.MI.buffer];
    self.postMessage({ id, type, seed, arrays: a, defs: def.defs, attachments: def.attachments, height: def.height, kind: def.kind, hitboxes: def.hitboxes }, transfer);
  } catch (err) {
    self.postMessage({ id, type, seed, error: String(err && err.stack ? err.stack : err) });
  }
};
