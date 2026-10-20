// Worker: places vegetation and rocks per cell off the main thread.

import { WorldGen } from './worldGen.js';
import { cellInstances } from './scatterGen.js';

let gen = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    gen = new WorldGen(msg.seed);
    self.postMessage({ type: 'ready' });
    return;
  }
  if (msg.type === 'cells') {
    for (const [ci, cj] of msg.cells) {
      const data = cellInstances(gen, ci, cj);
      self.postMessage({ type: 'cell', ci, cj, data }, [data.buffer]);
    }
  }
};
