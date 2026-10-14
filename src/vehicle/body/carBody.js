// Builds every skin panel of the sedan as THREE geometry with material slots.

import * as THREE from 'three';
import { buildSkinGrid } from './skinGrid.js';
import { SkinNodes, extractSurface, thicken } from './mesher.js';
import { buildPanelDefs, yBelt } from './regions.js';
import { smoothstep } from './curves.js';

export const SLOT = {
  paint: 0,
  inner: 1,
  trim: 2,
  chrome: 3,
  interior: 4,
  headliner: 5,
  carpet: 6,
  trunk: 7,
  under: 8,
  glass: 9,
  lens: 10,
  rubber: 11,
  lampHousing: 12,
  primer: 13,
  lensRed: 14,
  lensAmber: 15,
};

export const GAP_HALF = 0.0022;

function bodyDepth(x, y, z) {
  // Thickness of the body shell from outer skin to interior trim / structure.
  const belt = yBelt(z);
  let d;
  if (y < 0.27) d = 0.06;
  else if (y < 0.34) d = 0.06 + (0.12 - 0.06) * smoothstep(0.27, 0.34, y);
  else d = 0.12;
  // above the belt: pillars and roof
  const up = smoothstep(belt - 0.03, belt + 0.02, y);
  d = d * (1 - up) + 0.055 * up;
  if (y > 1.33) d = 0.055 - 0.008 * smoothstep(1.33, 1.42, y);
  // rear quarters / trunk sides and the front A-pillar base region are shallower
  const rear = smoothstep(-1.0, -1.25, z);
  if (y > 0.34 && y < belt) d = d * (1 - rear) + 0.075 * rear;
  const front = smoothstep(0.85, 1.0, z);
  if (y > 0.34) d = d * (1 - front) + 0.04 * front;
  return d;
}

function doorDepth(x, y, z) {
  const belt = yBelt(z);
  const t = smoothstep(belt - 0.035, belt - 0.005, y);
  return 0.105 * (1 - t) + 0.034 * t;
}

function bodyInnerSlot(pos, tris, t) {
  const a = tris[t],
    b = tris[t + 1],
    c = tris[t + 2];
  const x = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
  const y = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
  const z = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
  if (z > 0.95) return SLOT.under;
  if (z < -1.28) return y < 0.3 ? SLOT.under : SLOT.trunk;
  if (y < 0.3) return SLOT.carpet;
  if (y > 1.33 && Math.abs(x) < 0.62) return SLOT.headliner;
  return SLOT.interior;
}

const KIND = {
  panel: { depth: 0.012, edgeR: 0.0052, inner: SLOT.inner, rim: SLOT.paint },
  bumper: { depth: 0.018, edgeR: 0.006, inner: SLOT.under, rim: SLOT.paint },
  door: { depth: doorDepth, edgeR: 0.005, inner: SLOT.interior, rim: SLOT.paint },
  body: { depth: bodyDepth, edgeR: 0.005, inner: bodyInnerSlot, rim: SLOT.paint },
};

function toGeometry(data) {
  const { position, normal, edge, index, mats } = data;
  // Sort triangles by material for contiguous groups.
  const T = index.length / 3;
  const order = Array.from({ length: T }, (_, i) => i).sort((a, b) => mats[a] - mats[b]);
  const idx = new Uint32Array(index.length);
  const geo = new THREE.BufferGeometry();
  let cur = -1,
    start = 0;
  for (let k = 0; k < T; k++) {
    const t = order[k];
    idx[k * 3] = index[t * 3];
    idx[k * 3 + 1] = index[t * 3 + 1];
    idx[k * 3 + 2] = index[t * 3 + 2];
    const m = mats[t];
    if (m !== cur) {
      if (cur >= 0) geo.addGroup(start * 3, (k - start) * 3, cur);
      cur = m;
      start = k;
    }
  }
  if (cur >= 0) geo.addGroup(start * 3, (T - start) * 3, cur);
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('edge', new THREE.BufferAttribute(edge, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function buildCarBody({ res = 0.02, onProgress } = {}) {
  const t0 = performance.now();
  const grid = buildSkinGrid(res);
  const nodes = new SkinNodes(grid);
  onProgress && onProgress('grid', performance.now() - t0);
  const defs = buildPanelDefs();

  // Raw fields
  const raw = defs.map((d) => (d.complement ? null : nodes.evalField(d.shape)));
  const count = nodes.count;
  const near = (f, band = 0.06) => {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) out[i] = f[i] > -band ? 1 : 0;
    return out;
  };
  const nearMasks = raw.map((r) => (r ? near(r) : null));
  onProgress && onProgress('fields', performance.now() - t0);

  const panels = {};
  for (let k = 0; k < defs.length; k++) {
    const d = defs[k];
    if (d.hole) continue;
    const kd = KIND[d.kind] || KIND.panel;
    let iso;
    if (d.kind === 'glass') iso = -0.008;
    else if (d.kind === 'lamp') iso = GAP_HALF * 0.6;
    else iso = GAP_HALF + kd.edgeR;
    // Constraints: own shape, minus every higher-priority region touching it.
    const cons = [];
    if (!d.complement) cons.push({ field: raw[k], iso, sign: 1 });
    const own = d.complement ? null : nearMasks[k];
    const upto = d.complement ? defs.length : k;
    for (let j = 0; j < upto; j++) {
      if (!raw[j] || j === k) continue;
      let touches = false;
      if (!own) touches = true;
      else {
        const m = nearMasks[j];
        for (let i = 0; i < count; i++) {
          if (own[i] && m[i]) {
            touches = true;
            break;
          }
        }
      }
      if (touches) cons.push({ field: raw[j], iso: d.kind === 'glass' ? GAP_HALF + 0.005 : iso, sign: -1 });
    }
    const subs = (d.subs || []).map((s) => ({ field: nodes.evalField(s.shape), mat: s.mat }));
    let data;
    if (d.kind === 'glass') {
      const surf = extractSurface(nodes, cons, []);
      data = thicken(surf, { depth: 0.01, innerMode: 'offset', skipInner: true });
      const P = data.position,
        N = data.normal;
      for (let i = 0; i < P.length; i += 3) {
        P[i] -= N[i] * 0.009;
        P[i + 1] -= N[i + 1] * 0.009;
        P[i + 2] -= N[i + 2] * 0.009;
      }
      data.mats = data.mats.map(() => SLOT.glass);
    } else if (d.kind === 'lamp') {
      const surf = extractSurface(nodes, cons, subs);
      const tail = d.id.startsWith('tail');
      data = thicken(surf, {
        depth: tail ? 0.045 : 0.06,
        innerMode: 'offset',
        edgeR: 0.002,
        innerMat: SLOT.lampHousing,
        rimMat: SLOT.lampHousing,
        outerMats: (m) => (m === 3 ? SLOT.lens : m === 4 ? SLOT.lensAmber : tail ? SLOT.lensRed : SLOT.lens),
      });
    } else {
      const surf = extractSurface(nodes, cons, subs);
      data = thicken(surf, {
        depth: kd.depth,
        edgeR: kd.edgeR,
        innerMat: kd.inner,
        rimMat: kd.rim,
        outerMats: (m) => (m === 2 ? SLOT.trim : SLOT.paint),
      });
    }
    if (data.index.length === 0) continue;
    panels[d.id] = { id: d.id, kind: d.kind, geometry: toGeometry(data) };
  }
  onProgress && onProgress('panels', performance.now() - t0);
  return { panels, grid, nodes, defs, raw, buildMs: performance.now() - t0 };
}
