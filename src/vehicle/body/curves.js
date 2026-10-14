// Small curve / SDF helpers used by the body modeller.

// Monotone piecewise cubic (PCHIP / Fritsch-Carlson) interpolation through key points.
// Points: [[x, y], ...] sorted by x. Returns f(x) with constant extrapolation.
export function pchip(points, lutStep = 0.002) {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const h = new Float64Array(n - 1);
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    d[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  const m = new Float64Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  const exact = (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0,
      hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const t = (x - xs[lo]) / h[lo];
    const t2 = t * t,
      t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * ys[lo] + h10 * h[lo] * m[lo] + h01 * ys[lo + 1] + h11 * h[lo] * m[lo + 1];
  };
  // Dense lookup table (values + derivatives) for fast evaluation.
  const x0 = xs[0],
    x1 = xs[n - 1];
  const N = Math.max(8, Math.ceil((x1 - x0) / lutStep));
  const step = (x1 - x0) / N;
  const inv = 1 / step;
  const lut = new Float64Array(N + 2);
  const dlut = new Float64Array(N + 2);
  for (let i = 0; i <= N + 1; i++) lut[i] = exact(x0 + i * step);
  for (let i = 0; i <= N + 1; i++) {
    const a = lut[Math.max(0, i - 1)],
      b = lut[Math.min(N + 1, i + 1)];
    dlut[i] = (b - a) / (step * (Math.min(N + 1, i + 1) - Math.max(0, i - 1)));
  }
  dlut[0] = 0;
  dlut[N] = 0;
  dlut[N + 1] = 0;
  const f = (x) => {
    if (x <= x0) return ys[0];
    if (x >= x1) return ys[n - 1];
    const u = (x - x0) * inv;
    const i = u | 0;
    const t = u - i;
    return lut[i] + (lut[i + 1] - lut[i]) * t;
  };
  f.deriv = (x) => {
    if (x <= x0 || x >= x1) return 0;
    const u = (x - x0) * inv;
    const i = u | 0;
    const t = u - i;
    return dlut[i] + (dlut[i + 1] - dlut[i]) * t;
  };
  f.exact = exact;
  return f;
}

// Rounded intersection of two signed fields (negative inside). r = fillet radius.
export function smaxR(a, b, r) {
  if (r <= 0) return a > b ? a : b;
  const ua = r + a > 0 ? r + a : 0;
  const ub = r + b > 0 ? r + b : 0;
  const m = a > b ? a : b;
  return (m < -r ? m : -r) + Math.sqrt(ua * ua + ub * ub);
}

// Rounded union of two signed fields.
export function sminR(a, b, r) {
  if (r <= 0) return a < b ? a : b;
  const ua = r - a > 0 ? r - a : 0;
  const ub = r - b > 0 ? r - b : 0;
  const m = a < b ? a : b;
  return (m > r ? m : r) - Math.sqrt(ua * ua + ub * ub);
}

// Polynomial smooth min (soft blend) — used for gentle transitions.
export function sminP(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smoothstep(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// ---- 2D polygons ----

// Fillet every corner of a polygon with radius r (or per-corner radii array), returns dense point list.
export function roundPolygon(pts, r, segs = 8) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const rr = Array.isArray(r) ? r[i] : r;
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    if (!rr || rr <= 0) {
      out.push([p1[0], p1[1]]);
      continue;
    }
    let ax = p0[0] - p1[0],
      ay = p0[1] - p1[1];
    let bx = p2[0] - p1[0],
      by = p2[1] - p1[1];
    const la = Math.hypot(ax, ay),
      lb = Math.hypot(bx, by);
    ax /= la;
    ay /= la;
    bx /= lb;
    by /= lb;
    const cosA = clamp(ax * bx + ay * by, -1, 1);
    const ang = Math.acos(cosA);
    if (ang < 1e-3 || Math.PI - ang < 1e-3) {
      out.push([p1[0], p1[1]]);
      continue;
    }
    let t = rr / Math.tan(ang / 2);
    t = Math.min(t, la * 0.49, lb * 0.49);
    const rad = t * Math.tan(ang / 2);
    const s = [p1[0] + ax * t, p1[1] + ay * t];
    const e = [p1[0] + bx * t, p1[1] + by * t];
    // center along bisector
    let bxs = ax + bx,
      bys = ay + by;
    const bl = Math.hypot(bxs, bys);
    bxs /= bl;
    bys /= bl;
    const cd = rad / Math.sin(ang / 2);
    const c = [p1[0] + bxs * cd, p1[1] + bys * cd];
    let a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
    let a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= segs; k++) {
      const a = a0 + (da * k) / segs;
      out.push([c[0] + Math.cos(a) * rad, c[1] + Math.sin(a) * rad]);
    }
  }
  return out;
}

// Signed distance to polygon (negative inside). Inigo Quilez's formulation.
export function sdPolygon(pts, px, py) {
  const n = pts.length;
  let d = (px - pts[0][0]) ** 2 + (py - pts[0][1]) ** 2;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const vi = pts[i],
      vj = pts[j];
    const ex = vj[0] - vi[0],
      ey = vj[1] - vi[1];
    const wx = px - vi[0],
      wy = py - vi[1];
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const bx = wx - ex * t,
      by = wy - ey * t;
    const dd = bx * bx + by * by;
    if (dd < d) d = dd;
    const c1 = py >= vi[1],
      c2 = py < vj[1],
      c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

// Precompute a polygon with bounding box for fast rejection.
export function makePoly(pts) {
  let minx = Infinity,
    miny = Infinity,
    maxx = -Infinity,
    maxy = -Infinity;
  for (const p of pts) {
    if (p[0] < minx) minx = p[0];
    if (p[1] < miny) miny = p[1];
    if (p[0] > maxx) maxx = p[0];
    if (p[1] > maxy) maxy = p[1];
  }
  return { pts, minx, miny, maxx, maxy };
}

// Region value (positive inside, ~distance) for a polygon; far outside returns a bounded negative.
export function polyRegion(poly, px, py, margin = 0.15) {
  if (px < poly.minx - margin || px > poly.maxx + margin || py < poly.miny - margin || py > poly.maxy + margin) {
    return -margin;
  }
  return -sdPolygon(poly.pts, px, py);
}

export function sdCircle2(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

export function sdSegment2(px, py, ax, ay, bx, by) {
  const pax = px - ax,
    pay = py - ay,
    bax = bx - ax,
    bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}
