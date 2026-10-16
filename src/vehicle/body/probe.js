// Surface probes on the implicit body: find skin points along axis-aligned rays.

import { bodyField, bodyGradient } from './shape.js';

function bisect(f, a, b, it = 40) {
  // assumes f(a) < 0 (inside), f(b) > 0
  for (let k = 0; k < it; k++) {
    const m = (a + b) * 0.5;
    if (f(m) < 0) a = m;
    else b = m;
  }
  return (a + b) * 0.5;
}

// z of the front-facing skin at (x, y), searching from z0 (inside) forward.
export function skinFrontZ(x, y, z0 = 1.2, z1 = 2.6) {
  return bisect((z) => bodyField(x, y, z), z0, z1);
}

export function skinRearZ(x, y, z0 = -1.2, z1 = -2.6) {
  return bisect((z) => bodyField(x, y, z), z0, z1);
}

export function skinSideX(y, z, x0 = 0, x1 = 1.2, sign = 1) {
  return sign * bisect((x) => bodyField(sign * x, y, z), x0, x1);
}

export function skinTopY(x, z, y0 = 0.5, y1 = 2) {
  return bisect((y) => bodyField(x, y, z), y0, y1);
}

export function skinNormal(p) {
  const g = [0, 0, 0];
  bodyGradient(p[0], p[1], p[2], g);
  return g;
}

// Generic: from an inside point o along direction d.
export function skinAlong(o, d, tMax = 2) {
  const t = bisect((t) => bodyField(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t), 0, tMax);
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}
