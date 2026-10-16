// Samples the implicit body into a structured half-grid of surface nodes.
// Rows run from the rear pole, along a capsule spine, to the front pole; columns run around the
// section from bottom centre (x=0) through the +X side to the top centre (x=0).

import { bodyField, bodyGradient } from './shape.js';

const SPINE = { y: 0.64, z0: -1.0, z1: 0.9 };

function rayDir(s, phi, out) {
  // s in [0, 2 + L] meridian parameter: [0,1] rear cap alpha 0..90deg, [1, 1+L] cylinder, [1+L, 2+L] front cap.
  // Returns origin and direction.
  const L = SPINE.z1 - SPINE.z0;
  const sp = Math.sin(phi),
    cp = Math.cos(phi);
  if (s <= 1) {
    const a = (s * Math.PI) / 2;
    out.ox = 0;
    out.oy = SPINE.y;
    out.oz = SPINE.z0;
    out.dx = Math.sin(a) * sp;
    out.dy = -Math.sin(a) * cp;
    out.dz = -Math.cos(a);
  } else if (s <= 1 + L) {
    out.ox = 0;
    out.oy = SPINE.y;
    out.oz = SPINE.z0 + (s - 1);
    out.dx = sp;
    out.dy = -cp;
    out.dz = 0;
  } else {
    const a = ((2 + L - s) * Math.PI) / 2;
    out.ox = 0;
    out.oy = SPINE.y;
    out.oz = SPINE.z1;
    out.dx = Math.sin(a) * sp;
    out.dy = -Math.sin(a) * cp;
    out.dz = Math.cos(a);
  }
  return out;
}

const tmpRay = {};
export function castSurface(s, phi, out) {
  rayDir(s, phi, tmpRay);
  const { ox, oy, oz, dx, dy, dz } = tmpRay;
  let t = 0;
  let f = bodyField(ox, oy, oz);
  let tIn = 0;
  // March outward until outside.
  for (let k = 0; k < 400 && f < 0; k++) {
    tIn = t;
    const step = Math.max(-f * 0.6, 0.002);
    t += step;
    f = bodyField(ox + dx * t, oy + dy * t, oz + dz * t);
  }
  let a = tIn,
    b = t;
  for (let k = 0; k < 26; k++) {
    const m = (a + b) * 0.5;
    const fm = bodyField(ox + dx * m, oy + dy * m, oz + dz * m);
    if (fm < 0) a = m;
    else b = m;
  }
  const tt = (a + b) * 0.5;
  out[0] = ox + dx * tt;
  out[1] = oy + dy * tt;
  out[2] = oz + dz * tt;
  return out;
}

// Build a half grid with approximately uniform spacing `res` (meters).
export function buildSkinGrid(res = 0.02, opts = {}) {
  const L = SPINE.z1 - SPINE.z0;
  const S = 2 + L;
  const p = [0, 0, 0];
  const q = [0, 0, 0];

  // --- choose row parameters: max over several meridians of max(arc/res, turn/thetaMax) ---
  const thetaMax = opts.thetaRows ?? 0.22;
  const thetaCols = opts.thetaCols ?? 0.09;
  const fineN = 1400;
  const phis = [Math.PI * 0.15, Math.PI * 0.3, Math.PI * 0.42, Math.PI * 0.5, Math.PI * 0.58, Math.PI * 0.68, Math.PI * 0.8, Math.PI * 0.9, Math.PI - 0.001];
  const cum = new Float64Array(fineN + 1);
  const prev = phis.map(() => null);
  const prevN = phis.map(() => null);
  const gg = [0, 0, 0];
  for (let k = 0; k <= fineN; k++) {
    const s = (k / fineN) * S;
    let maxStep = 0;
    phis.forEach((phi, idx) => {
      castSurface(s, phi, p);
      bodyGradient(p[0], p[1], p[2], gg);
      if (prev[idx]) {
        const d = Math.hypot(p[0] - prev[idx][0], p[1] - prev[idx][1], p[2] - prev[idx][2]);
        const pn = prevN[idx];
        const turn = Math.acos(Math.min(1, Math.max(-1, pn[0] * gg[0] + pn[1] * gg[1] + pn[2] * gg[2])));
        const rs = gg[1] < -0.6 ? 2.6 : 1;
        const m = Math.max(d / (res * rs), turn / thetaMax);
        if (m > maxStep) maxStep = m;
      }
      prev[idx] = [p[0], p[1], p[2]];
      prevN[idx] = [gg[0], gg[1], gg[2]];
    });
    cum[k] = k === 0 ? 0 : cum[k - 1] + maxStep;
  }
  const total = cum[fineN];
  const rows = Math.max(40, Math.round(total));
  const rowS = new Float64Array(rows + 1);
  {
    let k = 0;
    for (let r = 0; r <= rows; r++) {
      const target = (r / rows) * total;
      while (k < fineN && cum[k + 1] < target) k++;
      const c0 = cum[k],
        c1 = cum[Math.min(k + 1, fineN)];
      const t = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
      rowS[r] = ((k + t) / fineN) * S;
    }
  }
  const Nr = rows + 1;

  // --- columns: per row, nodes placed by max(arc/res, turn/thetaMax) metric ---
  const fineC = 420;
  const rowsOut = [];
  const g = [0, 0, 0];
  let totalNodes = 0;
  for (let r = 0; r < Nr; r++) {
    const s = rowS[r];
    const cc = new Float64Array(fineC + 1);
    let last = null,
      lastN = null;
    for (let k = 0; k <= fineC; k++) {
      const phi = (k / fineC) * Math.PI;
      castSurface(s, phi, p);
      bodyGradient(p[0], p[1], p[2], g);
      if (last) {
        const d = Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]);
        const turn = Math.acos(Math.min(1, Math.max(-1, lastN[0] * g[0] + lastN[1] * g[1] + lastN[2] * g[2])));
        const rs = g[1] < -0.6 ? 2.6 : 1;
        cc[k] = cc[k - 1] + Math.max(d / (res * rs), turn / thetaCols);
      }
      last = [p[0], p[1], p[2]];
      lastN = [g[0], g[1], g[2]];
    }
    const tot = cc[fineC] * res;
    const isPole = r === 0 || r === Nr - 1;
    const n = isPole ? 1 : Math.max(6, Math.round(tot / res)) + 1;
    const pos = new Float64Array(n * 3);
    const nrm = new Float32Array(n * 3);
    const tpar = new Float64Array(n);
    let k = 0;
    for (let c = 0; c < n; c++) {
      let phi;
      if (isPole) phi = Math.PI / 2;
      else {
        const target = (c / (n - 1)) * cc[fineC];
        while (k < fineC && cc[k + 1] < target) k++;
        const c0 = cc[k],
          c1 = cc[Math.min(k + 1, fineC)];
        const t = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
        phi = ((k + t) / fineC) * Math.PI;
        if (c === 0) phi = 0;
        if (c === n - 1) phi = Math.PI;
      }
      tpar[c] = isPole ? 0.5 : c / (n - 1);
      castSurface(s, phi, q);
      if (isPole || c === 0 || c === n - 1) q[0] = 0;
      pos[c * 3] = q[0];
      pos[c * 3 + 1] = q[1];
      pos[c * 3 + 2] = q[2];
      bodyGradient(q[0], q[1], q[2], g);
      if (isPole || c === 0 || c === n - 1) {
        g[0] = 0;
        const l = Math.hypot(g[1], g[2]) || 1;
        g[1] /= l;
        g[2] /= l;
      }
      nrm[c * 3] = g[0];
      nrm[c * 3 + 1] = g[1];
      nrm[c * 3 + 2] = g[2];
    }
    rowsOut.push({ n, pos, nrm, t: tpar });
    totalNodes += n;
  }
  return { rows: rowsOut, Nr, totalNodes, res };
}

// Project a point onto the level set bodyField = level using Newton steps along the gradient.
export function projectToLevel(p, level = 0, iters = 4) {
  const g = [0, 0, 0];
  for (let k = 0; k < iters; k++) {
    const f = bodyField(p[0], p[1], p[2]) - level;
    if (Math.abs(f) < 1e-6) break;
    const gl = bodyGradient(p[0], p[1], p[2], g);
    const step = f / Math.max(gl, 0.2);
    p[0] -= g[0] * step;
    p[1] -= g[1] * step;
    p[2] -= g[2] * step;
  }
  return p;
}
