// Implicit definition of the sedan's outer skin.
// Car space: +Z forward, +Y up, +X = left side of the car (driver side, LHD). Origin: ground, mid-wheelbase.
// The body is the intersection of smooth constraint fields (each ~signed distance, negative inside),
// combined with circular fillets, then united with the greenhouse (cabin glass house).

import { pchip, smaxR, sminR, smoothstep } from './curves.js';

export const SPEC = {
  wheelbase: 2.6,
  axleF: 1.3,
  axleR: -1.3,
  wheelR: 0.316,
  wheelY: 0.316,
  trackHalf: 0.745,
  archR: 0.372,
  archRr: 0.366,
  frontTip: 2.24,
  rearTip: -2.29,
  roofY: 1.465,
};

// ---------- lower body ----------

// Plan half-width at the widest height, along the length.
const W0 = pchip([
  [-2.3, 0.82],
  [-2.1, 0.852],
  [-1.7, 0.872],
  [-1.3, 0.88],
  [-0.6, 0.884],
  [0.4, 0.884],
  [1.0, 0.881],
  [1.4, 0.876],
  [1.8, 0.862],
  [2.05, 0.842],
  [2.3, 0.815],
]);

// Shoulder (top edge of the lower body at the side) – the wedge beltline.
const Tside = pchip([
  [-2.33, 0.995],
  [-2.25, 1.03],
  [-2.15, 1.046],
  [-1.95, 1.052],
  [-1.6, 1.044],
  [-1.2, 1.026],
  [-0.6, 1.006],
  [0.0, 0.986],
  [0.5, 0.966],
  [1.0, 0.944],
  [1.2, 0.928],
  [1.6, 0.89],
  [1.95, 0.85],
  [2.15, 0.818],
  [2.3, 0.76],
]);

// Height of crown (centre above shoulder edge) along the length.
const crownH = pchip([
  [-2.3, 0.022],
  [-1.9, 0.032],
  [-1.4, 0.03],
  [1.0, 0.03],
  [1.3, 0.04],
  [1.9, 0.038],
  [2.3, 0.024],
]);

// Front face z(y) at the centreline (side profile of bumper / grille).
const F0 = pchip([
  [0.19, 2.0],
  [0.24, 2.12],
  [0.29, 2.18],
  [0.37, 2.208],
  [0.48, 2.22],
  [0.58, 2.224],
  [0.67, 2.215],
  [0.74, 2.196],
  [0.8, 2.165],
  [0.845, 2.11],
  [0.89, 2.0],
  [0.95, 1.75],
]);

// Rear face z(y) at the centreline.
const R0 = pchip([
  [0.24, -2.02],
  [0.3, -2.16],
  [0.36, -2.235],
  [0.45, -2.27],
  [0.58, -2.278],
  [0.72, -2.272],
  [0.85, -2.26],
  [0.95, -2.25],
  [1.0, -2.244],
  [1.04, -2.236],
  [1.08, -2.222],
  [1.14, -2.17],
  [1.25, -2.0],
]);

// Underbody height along the length.
const B0 = pchip([
  [-2.32, 0.37],
  [-2.1, 0.33],
  [-1.85, 0.25],
  [-1.6, 0.215],
  [1.55, 0.215],
  [1.8, 0.245],
  [2.0, 0.272],
  [2.25, 0.295],
]);

const ARCHES = [
  { z: SPEC.axleF, y: SPEC.wheelY },
  { z: SPEC.axleR, y: SPEC.wheelY },
];

function softplus(x) {
  return x > 20 ? x : Math.log1p(Math.exp(x));
}

function halfWidth(y, z) {
  let w = W0(z);
  // Section: tuck under below the bulge, taper toward the shoulder above.
  const ym = 0.56;
  if (y < ym) {
    const t = (ym - y) / 0.36;
    w -= 0.046 * t * t;
  } else {
    const t = (y - ym) / 0.4;
    w -= 0.026 * t * t;
  }
  // Wheel-arch haunches.
  for (const a of ARCHES) {
    const dz = (z - a.z) / 0.5;
    const band = smoothstep(0.25, 0.5, y) * (1 - smoothstep(0.78, 0.9, y));
    w += 0.012 * Math.exp(-dz * dz * 2.2) * band;
  }
  // Shoulder feature line: a fold where the upper shoulder starts leaning inward.
  const ycl = Tside(z) - (0.078 - 0.012 * z);
  const u = (y - ycl) / 0.02;
  w -= 0.17 * 0.02 * softplus(u);
  const dl = (y - ycl) / 0.024;
  w += 0.002 * Math.exp(-dl * dl);
  // Lower sculpt: shallow concave band rising toward the rear between the arches.
  const between = smoothstep(-1.0, -0.78, z) * (1 - smoothstep(0.78, 0.98, z));
  const ylow = 0.43 + (0.8 - z) * 0.045;
  const dr = (y - ylow) / 0.055;
  w -= 0.0075 * Math.exp(-dr * dr) * between;
  return w;
}

function dsmooth(a, b, x) {
  const t = (x - a) / (b - a);
  if (t <= 0 || t >= 1) return 0;
  return (6 * t * (1 - t)) / (b - a);
}

// Lower-body top surface height and its partial derivatives (written to out).
function topHeight(ax, z, out) {
  const s = Math.min(ax / 0.88, 1);
  const ts = Tside(z),
    ch = crownH(z);
  let t = ts + ch * (1 - s * s);
  let dx = s < 1 ? (ch * -2 * s) / 0.88 : 0;
  let dz = Tside.deriv(z) + crownH.deriv(z) * (1 - s * s);
  // Hood: two subtle raised creases running toward the windshield.
  const hs0 = smoothstep(1.0, 1.2, z),
    hs1 = 1 - smoothstep(2.0, 2.15, z);
  const hood = hs0 * hs1;
  if (hood > 0) {
    const dc = (ax - 0.42) / 0.06;
    const e = 0.006 * Math.exp(-dc * dc);
    t += e * hood;
    dx += e * hood * ((-2 * dc) / 0.06);
    dz += e * (dsmooth(1.0, 1.2, z) * hs1 - hs0 * dsmooth(2.0, 2.15, z));
  }
  if (out) {
    out[0] = dx;
    out[1] = dz;
  }
  return t;
}

const tdTmp = [0, 0];

function lowerBody(x, y, z) {
  const ax = Math.abs(x);
  const cSide = ax - halfWidth(y, z);

  const x2 = ax * ax;
  const ff = F0(y) - 0.19 * x2 - 0.08 * x2 * x2;
  const fdx = -0.38 * ax - 0.32 * x2 * ax;
  const fdy = F0.deriv(y);
  const cFront = (z - ff) / Math.sqrt(1 + fdx * fdx + fdy * fdy);

  const rr = R0(y) + 0.15 * x2 + 0.06 * x2 * x2;
  const rdx = 0.3 * ax + 0.24 * x2 * ax;
  const rdy = R0.deriv(y);
  const cRear = (rr - z) / Math.sqrt(1 + rdx * rdx + rdy * rdy);

  const tt = topHeight(ax, z, tdTmp);
  const cTop = (y - tt) / Math.sqrt(1 + tdTmp[0] * tdTmp[0] + tdTmp[1] * tdTmp[1]);

  const bdz = B0.deriv(z);
  const cBot = (B0(z) - y) / Math.sqrt(1 + bdz * bdz);

  let plan = smaxR(cSide, cFront, 0.19);
  plan = smaxR(plan, cRear, 0.18);
  let f = smaxR(plan, cTop, 0.034);
  f = smaxR(f, cBot, 0.035);
  return f;
}

// ---------- greenhouse ----------

const WgBelt = pchip([
  [-1.85, 0.74],
  [-1.3, 0.78],
  [-0.5, 0.793],
  [0.4, 0.795],
  [0.9, 0.785],
  [1.2, 0.765],
]);

const RoofY = pchip([
  [-1.3, 1.4],
  [-0.9, 1.436],
  [-0.5, 1.458],
  [-0.15, 1.466],
  [0.15, 1.462],
  [0.45, 1.445],
  [0.8, 1.41],
]);

// Windshield: base centre at the cowl, raked ~58 deg from vertical.
const WS_P0 = [0, 0.97, 1.07];
const WS_E2 = norm3([0, 0.53, -0.77]);
const WS_N = [0, -WS_E2[2], WS_E2[1]]; // outward (up/forward)
// Rear window.
const RW_P0 = [0, 1.05, -1.62];
const RW_E2 = norm3([0, 0.42, 0.78]);
const RW_N = [0, RW_E2[2], -RW_E2[1]]; // outward (up/back)

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

export const GLASS_FRAMES = { WS_P0, WS_E2, WS_N, RW_P0, RW_E2, RW_N };

function greenhouseWidth(y, z) {
  const dy = y - 0.97;
  return WgBelt(z) - 0.27 * dy - 0.4 * dy * Math.abs(dy);
}

function greenhouse(x, y, z) {
  const ax = Math.abs(x);
  const cSide = ax - greenhouseWidth(y, z);
  const s = ax / 0.66;
  const ry = RoofY(z) - 0.075 * s * s;
  const cRoof = y - ry;
  // windshield with wrap-around curvature
  const dx = x - WS_P0[0],
    dy = y - WS_P0[1],
    dz = z - WS_P0[2];
  const cWs = dx * WS_N[0] + dy * WS_N[1] + dz * WS_N[2] + 0.11 * x * x + 0.05 * x * x * x * x;
  const ex = x - RW_P0[0],
    ey = y - RW_P0[1],
    ez = z - RW_P0[2];
  const cRw = ex * RW_N[0] + ey * RW_N[1] + ez * RW_N[2] + 0.1 * x * x + 0.04 * x * x * x * x;
  const cBot = 0.85 - y;
  const cLen = Math.max(z - 1.25, -1.78 - z);
  let top = smaxR(cRoof, cWs, 0.13);
  top = smaxR(top, cRw, 0.17);
  let f = smaxR(top, cSide, 0.065);
  f = smaxR(f, cBot, 0);
  f = Math.max(f, cLen);
  return f;
}

export function bodyField(x, y, z) {
  const a = lowerBody(x, y, z);
  const b = greenhouse(x, y, z);
  return sminR(a, b, 0.014);
}

export function bodyGradient(x, y, z, out) {
  const e = 2e-4;
  const gx = bodyField(x + e, y, z) - bodyField(x - e, y, z);
  const gy = bodyField(x, y + e, z) - bodyField(x, y - e, z);
  const gz = bodyField(x, y, z + e) - bodyField(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  out[0] = gx / l;
  out[1] = gy / l;
  out[2] = gz / l;
  return l / (2 * e);
}

export const profiles = { W0, Tside, crownH, F0, R0, B0, WgBelt, RoofY, halfWidth, topHeight, greenhouseWidth };
export { topHeight };
