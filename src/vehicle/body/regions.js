// Panel layout of the body skin. Every region is a scalar field over car space, positive inside,
// roughly a distance in meters near its boundary. Panels are cut in priority order: a panel's
// final field is its own shape minus every higher-priority panel, so each seam is defined once.

import { GLASS_FRAMES, profiles, SPEC } from './shape.js';
import { makePoly, polyRegion, roundPolygon, smaxR, sminR, clamp } from './curves.js';

const { WS_P0, WS_E2, WS_N, RW_P0, RW_E2, RW_N } = GLASS_FRAMES;
const { Tside, RoofY } = profiles;

// Region boolean helpers (positive inside).
export const rint = (a, b, r = 0) => -smaxR(-a, -b, r);
export const runi = (a, b, r = 0) => -sminR(-a, -b, r);
const minN = (...v) => Math.min(...v);

// ---------- coordinate helpers ----------

// Unwrapped horizontal coordinate around the front corner (plan arc length from the centreline).
const FC = { xc: 0.52, zc: 1.93, R: 0.33 };
export function unwrapFront(ax, z) {
  if (ax <= FC.xc) return ax;
  if (z >= FC.zc) return FC.xc + FC.R * Math.atan2(ax - FC.xc, z - FC.zc);
  return FC.xc + FC.R * (Math.PI / 2) + (FC.zc - z);
}
const RC = { xc: 0.52, zc: -1.98, R: 0.32 };
export function unwrapRear(ax, z) {
  if (ax <= RC.xc) return ax;
  if (z <= RC.zc) return RC.xc + RC.R * Math.atan2(ax - RC.xc, RC.zc - z);
  return RC.xc + RC.R * (Math.PI / 2) + (z - RC.zc);
}

function wsCoords(x, y, z) {
  const dx = x - WS_P0[0],
    dy = y - WS_P0[1],
    dz = z - WS_P0[2];
  const b = dy * WS_E2[1] + dz * WS_E2[2];
  const c = dy * WS_N[1] + dz * WS_N[2] + 0.11 * x * x + 0.05 * x * x * x * x;
  return [x, b, c];
}
function rwCoords(x, y, z) {
  const dx = x - RW_P0[0],
    dy = y - RW_P0[1],
    dz = z - RW_P0[2];
  const b = dy * RW_E2[1] + dz * RW_E2[2];
  const c = dy * RW_N[1] + dz * RW_N[2] + 0.1 * x * x + 0.04 * x * x * x * x;
  return [x, b, c];
}

// Roof rail seam height (door frame top) along the length.
export const yRail = (z) => RoofY(z) - 0.094;
// Beltline (bottom of side glass).
export const yBelt = (z) => Tside(z) + 0.018;

// Side-view (z, y) polygon builder with sampled curve edges.
function sideView(points, r = 0.02, segs = 6) {
  return makePoly(roundPolygon(points, r, segs));
}

function sampleCurve(fn, z0, z1, n = 10) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    pts.push([z, fn(z)]);
  }
  return pts;
}

// ---------- shapes (raw, before priority cutting) ----------

const archF = { z: SPEC.axleF, y: SPEC.wheelY, R: SPEC.archR };
const archR = { z: SPEC.axleR, y: SPEC.wheelY, R: SPEC.archRr };

function archShape(a, X, y, z) {
  const d = a.R - Math.hypot(z - a.z, y - a.y);
  return Math.min(d, X - 0.5);
}

// Windshield: in windshield plane coords.
const wsHalf = (b) => 0.762 - 0.193 * b;
const wsPoly = makePoly(
  roundPolygon(
    [
      [-wsHalf(0.045), 0.045],
      [wsHalf(0.045), 0.045],
      [wsHalf(0.83), 0.83],
      [-wsHalf(0.83), 0.83],
    ],
    [0.06, 0.06, 0.09, 0.09],
    10
  )
);
function windshieldShape(x, y, z) {
  const [a, b, c] = wsCoords(x, y, z);
  // base edge curves upward toward the corners (follows the cowl)
  const bb = b - 0.05 * (a / 0.75) * (a / 0.75);
  return Math.min(polyRegion(wsPoly, a, bb, 0.2), 0.1 - Math.abs(c), y - 0.85);
}

const rwHalf = (b) => 0.722 - 0.143 * b;
const rwPoly = makePoly(
  roundPolygon(
    [
      [-rwHalf(0.05), 0.05],
      [rwHalf(0.05), 0.05],
      [rwHalf(0.7), 0.7],
      [-rwHalf(0.7), 0.7],
    ],
    [0.07, 0.07, 0.1, 0.1],
    10
  )
);
function rearGlassShape(x, y, z) {
  const [a, b, c] = rwCoords(x, y, z);
  const bb = b - 0.04 * (a / 0.7) * (a / 0.7);
  return Math.min(polyRegion(rwPoly, a, bb, 0.2), 0.1 - Math.abs(c), y - 0.9);
}

// Hood: rear edge near the windshield, side seams on top, leading edge on the front face.
function hoodShape(x, y, z) {
  const ax = Math.abs(x);
  const rear = z - (1.115 - 0.17 * x * x);
  const side = 0.79 - 0.035 * (z - 1.0) - ax;
  const front = y - (0.768 + 0.035 * (ax / 0.8) * (ax / 0.8));
  let m = rint(rear, side, 0.03);
  m = rint(m, front, 0.05);
  return Math.min(m, y - 0.55);
}

// Trunk lid: front edge behind the rear glass, side seams on the deck, narrows between the lamps.
function trunkShape(x, y, z) {
  const ax = Math.abs(x);
  const front = -1.665 + 0.1 * x * x - z;
  const t = clamp((y - 0.972) / 0.028, 0, 1);
  const halfW = 0.49 + (0.715 - 0.49) * t * t * (3 - 2 * t);
  const side = halfW - ax;
  const bottom = y - 0.78;
  let m = rint(front, side, 0.03);
  m = rint(m, bottom, 0.035);
  return Math.min(m, -1.3 - z);
}

// Headlight in front-unwrapped (U, y) space.
const headPoly = makePoly(
  roundPolygon(
    [
      [0.335, 0.655],
      [0.335, 0.9],
      [1.2, 0.95],
      [1.36, 0.9],
      [1.36, 0.84],
      [1.12, 0.735],
      [0.86, 0.672],
      [0.6, 0.65],
    ],
    [0.03, 0, 0, 0, 0.03, 0.06, 0.06, 0.06],
    8
  )
);
function headlightShape(X, y, z) {
  if (X < 0.2 || z < 1.4) return -0.2;
  const U = unwrapFront(X, z);
  return polyRegion(headPoly, U, y, 0.2);
}

// Tail lamp in rear-unwrapped (U, y) space.
const tailPoly = makePoly(
  roundPolygon(
    [
      [0.4, 0.808],
      [0.4, 0.948],
      [0.95, 0.948],
      [1.07, 0.937],
      [1.04, 0.87],
      [0.86, 0.81],
    ],
    [0, 0, 0.03, 0.03, 0.05, 0.05],
    8
  )
);
function taillightShape(X, y, z) {
  if (X < 0.2 || z > -1.6) return -0.2;
  const U = unwrapRear(X, z);
  return polyRegion(tailPoly, U, y, 0.2);
}

// Door outlines in side view (left side; X is |x| on the panel's side).
const pillarSeam = (y) => 0.788 - (y - 1.001) / 0.58; // z of A-pillar seam at height y
const frontDoorPoly = sideView(
  [
    [0.842, 0.305],
    [0.842, 0.95],
    [pillarSeam(0.985), 0.985],
    [pillarSeam(1.26), 1.26],
    [0.165, yRail(0.165)],
    ...sampleCurve(yRail, 0.1, -0.11, 6),
    [-0.1225, yRail(-0.1225)],
    [-0.1225, 0.305],
  ],
  0.025
);
const cSeam = (y) => -1.0 + (y - 1.0) * 0.85; // z of C-pillar door seam at height y
const rearDoorPoly = sideView(
  [
    [-0.1225, 0.305],
    [-0.1225, yRail(-0.1225)],
    ...sampleCurve(yRail, -0.2, -0.66, 6),
    [cSeam(yRail(-0.72)), yRail(-0.72)],
    [cSeam(1.012), 1.012],
    [-0.985, 0.985],
    [-0.985, 0.4],
    [-0.88, 0.305],
  ],
  0.025
);
function frontDoorShape(X, y, z) {
  if (X < 0.35) return -0.2;
  return polyRegion(frontDoorPoly, z, y, 0.2);
}
function rearDoorShape(X, y, z) {
  if (X < 0.35) return -0.2;
  const arch = Math.hypot(z - archR.z, y - archR.y) - (archR.R + 0.045);
  return Math.min(polyRegion(rearDoorPoly, z, y, 0.2), arch);
}

// Side glass (daylight openings).
const frontGlassPoly = sideView(
  [
    [0.715, yBelt(0.715)],
    [pillarSeam(1.24) - 0.055, 1.24],
    [0.16, yRail(0.16) - 0.024],
    ...sampleCurve((z) => yRail(z) - 0.024, 0.1, -0.08, 6),
    [-0.088, yRail(-0.088) - 0.024],
    ...sampleCurve(yBelt, -0.088, 0.68, 8),
  ],
  [0.02, 0.03, 0.05, 0, 0, 0, 0, 0, 0, 0, 0.025, 0.012],
  6
);
// Rear door glass: one pane running back to the slanted C-pillar seam (no fixed quarter light).
const rgRearBelt = cSeam(yBelt(-1.0)) - 0.03;
const rearGlassMainPoly = sideView(
  [
    ...sampleCurve(yBelt, rgRearBelt, -0.165, 7),
    [-0.165, yRail(-0.165) - 0.024],
    ...sampleCurve((z) => yRail(z) - 0.024, -0.22, -0.62, 5),
    [cSeam(yRail(-0.72) - 0.034) - 0.03, yRail(-0.72) - 0.034],
  ],
  [0.014, 0, 0, 0, 0, 0, 0, 0, 0.025, 0.03, 0, 0, 0, 0, 0.035],
  6
);
function glassShape(poly, X, y, z) {
  if (X < 0.35 || y < 0.85) return -0.2;
  return polyRegion(poly, z, y, 0.2);
}

// Front bumper cover: everything forward of the bumper/fender seam on the front, below the hood/lamps.
function bumperFShape(X, y, z) {
  if (z < 1.3) return -0.2;
  const U = unwrapFront(X, z);
  // seam from the arch (about 10 o'clock) up to the lamp's rear lower corner
  const seamU = 1.44 - (y - 0.6) * 0.33;
  const side = seamU - U;
  // underside: lip ends a little behind the nose (only matters on the bottom face)
  const under = Math.max(z - 1.86, y - 0.272);
  return Math.min(side, under, 0.95 - y);
}

function bumperRShape(X, y, z) {
  if (z > -1.3) return -0.2;
  const U = unwrapRear(X, z);
  // side seam runs from the lamp's lower outer corner down and forward to the arch
  const side = Math.min(1.47, 1.06 + Math.max(0, 0.81 - y) * 1.3) - U;
  const under = Math.max(-1.92 - z, y - 0.33);
  const top = 0.805 - y;
  return Math.min(side, under, top);
}

function fenderShape(X, y, z) {
  if (X < 0.25 || z < 0.7) return -0.2;
  const rear = z - 0.8; // generous: the front door defines this seam
  const sill = y - 0.305;
  // Up to the base of the A-pillar (top edge of the lower body there). Further forward the hood
  // seam bounds the fender, so the limit rises away smoothly (a step here tore the seam).
  // Ahead of the hood's rear edge the hood seam bounds the fender; behind it the fender stops at
  // the A-pillar base. The step is blended over a few centimetres so the corner stays clean.
  const zHood = 1.115 - 0.17 * X * X;
  const top = Tside(z) + 0.012 + 3 * Math.max(0, z - zHood + 0.01) - y;
  // inboard edge continues the hood side seam straight back to the A-pillar
  const inboard = X - (0.79 - 0.035 * (z - 1.0)) + 0.004;
  return Math.min(rear, sill, Math.max(inboard, X - 0.84), top);
}

function fuelFlapShape(X, y, z) {
  if (X < 0.6) return -0.2;
  const dz = Math.abs(z + 1.63) - 0.075,
    dy = Math.abs(y - 0.86) - 0.06;
  const r = 0.022;
  const qx = Math.max(dz + r, 0),
    qy = Math.max(dy + r, 0);
  const sd = Math.hypot(qx, qy) + Math.min(Math.max(dz + r, dy + r), 0) - r;
  return -sd;
}

function cowlShape(x, y, z) {
  return Math.min(z - 0.9, 1.2 - z, y - 0.86, 0.8 - Math.abs(x));
}

// ---------- assembled panel table ----------

const sideOf = (fn, s) => (x, y, z) => fn(x * s, y, z);
const L = 1,
  R = -1;

// Sub-region (material) helpers
const beltMolding = (x, y, z) => {
  const yb = yBelt(z) - 0.012;
  return Math.min(y - (yb - 0.016), yb + 0.004 - y);
};

export function buildPanelDefs() {
  const defs = [];
  const add = (d) => {
    defs.push(d);
    return d;
  };

  // Holes first (not meshed, only cut).
  add({ id: 'arch_FL', hole: true, shape: (x, y, z) => archShape(archF, x, y, z) });
  add({ id: 'arch_FR', hole: true, shape: (x, y, z) => archShape(archF, -x, y, z) });
  add({ id: 'arch_RL', hole: true, shape: (x, y, z) => archShape(archR, x, y, z) });
  add({ id: 'arch_RR', hole: true, shape: (x, y, z) => archShape(archR, -x, y, z) });

  add({ id: 'windshield', kind: 'glass', shape: windshieldShape });
  add({ id: 'rearglass', kind: 'glass', shape: rearGlassShape });
  add({ id: 'hood', kind: 'panel', shape: hoodShape });
  add({ id: 'trunk', kind: 'panel', shape: trunkShape });
  for (const [s, n] of [
    [L, 'L'],
    [R, 'R'],
  ]) {
    add({ id: 'headlight_' + n, kind: 'lamp', shape: sideOf(headlightShape, s) });
    add({
      id: 'taillight_' + n,
      kind: 'lamp',
      shape: sideOf(taillightShape, s),
      subs: [
        { id: 'reverse', mat: 3, shape: sideOf((X, y, z) => Math.min(0.66 - unwrapRear(X, z), 0.858 - y), s) },
        {
          id: 'indicator',
          mat: 4,
          shape: sideOf((X, y, z) => Math.min(unwrapRear(X, z) - 0.9, 0.9 - y), s),
        },
      ],
    });
  }
  for (const [s, n] of [
    [L, 'L'],
    [R, 'R'],
  ]) {
    add({ id: 'glass_F' + n, kind: 'glass', shape: sideOf((X, y, z) => glassShape(frontGlassPoly, X, y, z), s) });
    add({ id: 'glass_R' + n, kind: 'glass', shape: sideOf((X, y, z) => glassShape(rearGlassMainPoly, X, y, z), s) });
  }
  for (const [s, n] of [
    [L, 'L'],
    [R, 'R'],
  ]) {
    add({
      id: 'door_F' + n,
      kind: 'door',
      shape: sideOf(frontDoorShape, s),
      subs: [
        { id: 'trim', mat: 2, shape: sideOf((X, y, z) => Math.min(-0.03 - z, y - yBelt(z) + 0.004), s) },
        { id: 'sail', mat: 2, shape: sideOf((X, y, z) => Math.min(z - 0.70, y - yBelt(z) + 0.004, 1.06 - y), s) },
        { id: 'belt', mat: 2, shape: sideOf((X, y, z) => beltMolding(X, y, z), s) },
      ],
    });
    add({
      id: 'door_R' + n,
      kind: 'door',
      shape: sideOf(rearDoorShape, s),
      subs: [
        { id: 'trim', mat: 2, shape: sideOf((X, y, z) => Math.min(z + 0.2, y - yBelt(z) + 0.004), s) },
        { id: 'belt', mat: 2, shape: sideOf((X, y, z) => beltMolding(X, y, z), s) },
      ],
    });
  }
  add({
    id: 'grilleHole',
    hole: true,
    shape: (x, y, z) => {
      if (z < 1.9) return -0.2;
      const ax = Math.abs(x);
      const hw = 0.305 - (0.752 - y) * 0.35;
      return rint(rint(hw - ax, 0.752 - y, 0.025), y - 0.674, 0.025);
    },
  });
  add({
    id: 'intakeHole',
    hole: true,
    shape: (x, y, z) => {
      if (z < 1.9) return -0.2;
      const ax = Math.abs(x);
      const hw = 0.44 + (0.47 - y) * 0.2;
      return rint(rint(hw - ax, 0.468 - y, 0.04), y - 0.3, 0.035);
    },
  });
  for (const s2 of [1, -1]) {
    add({
      id: 'fogHole' + (s2 > 0 ? 'L' : 'R'),
      hole: true,
      shape: (x, y, z) => {
        const X = x * s2;
        if (X < 0.3 || z < 1.75) return -0.2;
        const U = unwrapFront(X, z);
        return 0.042 - Math.hypot((U - 0.655) * 0.95, y - 0.395);
      },
    });
  }
  add({
    id: 'bumper_F',
    kind: 'bumper',
    shape: (x, y, z) => bumperFShape(Math.abs(x), y, z),
    subs: [
      // black lower lip / splitter band
      { id: 'lip', mat: 2, shape: (x, y, z) => Math.min(0.285 - y, z - 1.9) },
      // fog lamp surrounds (black)
      {
        id: 'fog',
        mat: 2,
        shape: (x, y, z) => {
          const X = Math.abs(x);
          if (X < 0.3) return -0.2;
          const U = unwrapFront(X, z);
          return rint(rint(0.06 - Math.abs(U - 0.655), 0.055 - Math.abs(y - 0.395), 0.03), z - 1.75, 0);
        },
      },
    ],
  });
  add({
    id: 'bumper_R',
    kind: 'bumper',
    shape: (x, y, z) => bumperRShape(Math.abs(x), y, z),
    subs: [{ id: 'diffuser', mat: 2, shape: (x, y, z) => Math.min(0.43 - y, -1.6 - z) }],
  });
  add({ id: 'fender_L', kind: 'panel', shape: sideOf(fenderShape, L) });
  add({ id: 'fender_R', kind: 'panel', shape: sideOf(fenderShape, R) });
  add({ id: 'fuelflap', kind: 'panel', shape: sideOf(fuelFlapShape, R) });
  add({
    id: 'body',
    kind: 'body',
    complement: true,
    subs: [
      { id: 'cowl', mat: 2, shape: cowlShape },
      { id: 'underseal', mat: 5, shape: (x, y, z) => 0.255 - y },
    ],
  });
  return defs;
}
