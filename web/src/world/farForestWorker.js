// Worker: places the far forest's tree cards per 256 m cell off the main thread.

import { WorldGen } from './worldGen.js';
import { farForestCell } from './farForestGen.js';

let gen = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    gen = new WorldGen(msg.seed);
    return;
  }
  if (msg.type === 'cells') {
    for (const [ci, cj] of msg.cells) {
      const data = farForestCell(gen, ci, cj);
      self.postMessage({ type: 'cell', ci, cj, data }, [data.buffer]);
    }
  }
};
