// Reference values from the browser version's WorldGen, for the C# port to be checked against.
import { WorldGen, BIOMES } from '../../../web/src/world/worldGen.js';
import { cellInstances, CELL } from '../../../web/src/world/scatterGen.js';
import { writeFileSync } from 'fs';
const out = {};
for (const seed of [1234, 482913]) {
  const g = new WorldGen(seed);
  const pts = [];
  // deterministic sample points: along the road and out to 3 km either side, up to 120 km north
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 4000; i++) {
    const z = -800 + rnd() * 120800;
    const off = (rnd() < 0.4 ? (rnd() - 0.5) * 40 : (rnd() - 0.5) * 6000);
    const x = g.roadX(z) + off;
    const bw = g.biomeWeights(x, z, {});
    const n = g.normal(x, z);
    pts.push({ x, z, roadX: g.roadX(z), // (a fresh generator: the browser version caches roadY by the half metre, keeping whichever z
    // came first, so a used one answers a few cm off depending on what it was asked before)
    roadY: new WorldGen(seed).roadY(Math.round(z * 2) / 2), h: g.height(x, z), nat: g.naturalHeight(x, z), mtn: g.mountain(x, z), bw: BIOMES.map((b) => bw[b]), mat: g.groundMaterial(x, z, n[1], bw), surf: g.surfaceAt(x, z) });
  }
  const pois = [];
  for (let k = 0; k <= 200; k++) { const p = g.poiSlot(k); pois.push(p ? { k, type: p.type, x: p.x, z: p.z, rot: p.rot, side: p.side, seed: p.seed } : null); }
  const rivers = [], lakes = [], tracks = [], cells = [];
  for (let k = 0; k <= 30; k++) { const r = g.river(k); rivers.push(r ? { zr: r.zr, w: r.w, dry: r.dry, level: r.level } : null); }
  for (let k = 0; k <= 70; k++) { const l = g.lake(k); lakes.push(l ? { x: l.x, z: l.z, level: l.level } : null); }
  for (let t = 0; t <= 35; t++) { const r = g.track(t); tracks.push(r ? { z0: r.z0, len: r.len, side: r.side, block: r.block ? r.block.kind : null } : null); }
  for (let k = 0; k <= 60; k++) cells.push(g._cellCached(k));
  // scatter: cells across the road every 1.7 km (a fresh generator each, see roadY above)
  const scatter = [];
  for (let z = 300; z < 120000; z += 1700) {
    const cj = Math.floor(z / CELL), c0 = Math.floor(g.roadX(z) / CELL);
    for (let i = -3; i <= 3; i += 1.5) {
      const ci = c0 + Math.round(i * (1 + (z % 7)));
      scatter.push({ ci, cj, data: Array.from(cellInstances(new WorldGen(seed), ci, cj)) });
    }
  }
  out[seed] = { pts, pois, rivers, lakes, tracks, cells, scatter };
}
writeFileSync(process.argv[2], JSON.stringify(out));
console.log('ok');
