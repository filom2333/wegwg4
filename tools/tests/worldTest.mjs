import { WorldGen } from '../../src/world/worldGen.js';
const w = new WorldGen(1234);
let t0 = performance.now();
let n = 0, acc = 0;
for (let z = -200; z < 20000; z += 3) for (let x = -300; x < 300; x += 30) { acc += w.height(x + w.roadX(z), z); n++; }
console.log('height calls', n, ((performance.now() - t0) / n * 1000).toFixed(2), 'us/call');
for (let k = 0; k < 20; k++) { const p = w.poiSlot(k); if (p) console.log(k, p.type, p.biome, 'x', p.x.toFixed(0), 'z', p.z.toFixed(0), 'side', p.side, 'rot', p.rot.toFixed(2)); }
// road grade stats
let maxGrade = 0, maxCurv = 0;
for (let z = 0; z < 30000; z += 10) { const g = Math.abs(w.roadY(z + 10) - w.roadY(z)) / 10; if (g > maxGrade) maxGrade = g;
  const a = w.roadX(z - 20), b = w.roadX(z), c = w.roadX(z + 20); const curv = Math.abs(a - 2 * b + c) / 400; if (curv > maxCurv) maxCurv = curv; }
console.log('max grade', (maxGrade * 100).toFixed(1) + '%', 'min radius', (1 / maxCurv).toFixed(0), 'm');
for (let z = 0; z < 26000; z += 2600) console.log('z', z, w.dominantBiome(w.roadX(z), z));
