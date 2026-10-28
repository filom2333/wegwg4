// Worker: generates POI geometry (layouts, buildings, furniture) off the main thread. Materials
// are tokens here; the main thread swaps in the real ones.

import { useMaterialTokens } from './buildings/materials.js';
import { LAYOUTS } from './poiLayouts.js';
import { mulberry32 } from '../core/noise.js';

useMaterialTokens(true);

self.onmessage = (e) => {
  const m = e.data;
  if (m.type !== 'poi') return;
  const base = mulberry32(m.poi.seed);
  let calls = 0;
  const rnd = () => {
    calls++;
    return base();
  };
  const transfer = [];
  let entries;
  try {
    const layout = (LAYOUTS[m.poi.type] || LAYOUTS.house)(rnd, m.poi);
    entries = layout.map((en) => ({ x: en.x, z: en.z, rot: en.rot || 0, tag: en.tag || null, data: en.builder.serialize(transfer) }));
  } catch (err) {
    self.postMessage({ type: 'poi', k: m.k, error: String(err && err.stack ? err.stack : err) });
    return;
  }
  self.postMessage({ type: 'poi', k: m.k, entries, calls }, transfer);
};
