import { buildCarBody } from '../../src/vehicle/body/carBody.js';
for (const res of [0.06, 0.08]) {
  const t0 = performance.now();
  const r = buildCarBody({ res, lowDetail: true });
  let tri = 0; for (const p of Object.values(r.panels)) tri += p.geometry.index.count / 3;
  console.log('res', res, 'ms', (performance.now() - t0).toFixed(0), 'tris', tri);
}
