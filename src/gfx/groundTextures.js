// Procedural, tileable ground textures packed into 2D texture arrays:
// layer 0 sand, 1 dirt, 2 rock, 3 salt crust, 4 gravel, 5 asphalt, 6 grass, 7 snow, 8 forest floor.
// Albedo array stores height in alpha (used for height-based blending); normal array is RGB.

import * as THREE from 'three';
import { RENDER_CAPS } from './caps.js';
import { mulberry32 } from '../core/noise.js';

const S = 512;

// ---- tileable noise helpers ----
function makeLattice(P, rnd) {
  const g = new Float32Array(P * P);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return g;
}
function vnoiseT(lat, P, x, y) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const fx = x - xi,
    fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const i0 = ((xi % P) + P) % P,
    j0 = ((yi % P) + P) % P;
  const i1 = (i0 + 1) % P,
    j1 = (j0 + 1) % P;
  const a = lat[j0 * P + i0],
    b = lat[j0 * P + i1],
    c = lat[j1 * P + i0],
    d = lat[j1 * P + i1];
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbmT(lats, x, y, oct, basePeriod) {
  let s = 0,
    a = 0.5,
    f = 1,
    n = 0;
  for (let o = 0; o < oct; o++) {
    const P = basePeriod * f;
    s += a * vnoiseT(lats[o], P, (x * P) / S, (y * P) / S);
    n += a;
    a *= 0.5;
    f *= 2;
  }
  return s / n;
}
function lattices(seed, basePeriod, oct) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let o = 0; o < oct; o++) out.push(makeLattice(basePeriod * (1 << o), rnd));
  return out;
}

// Tileable Voronoi: returns [F1, F2, cellId] for point (x,y) in pixel space.
function makeVoronoi(seed, cells) {
  const rnd = mulberry32(seed);
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + rnd()) / cells, (j + rnd()) / cells, rnd()]);
  return (x, y) => {
    const u = x / S,
      v = y / S;
    const ci = Math.floor(u * cells),
      cj = Math.floor(v * cells);
    let f1 = 9,
      f2 = 9,
      id = 0;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const ii = ci + di,
          jj = cj + dj;
        const wi = ((ii % cells) + cells) % cells,
          wj = ((jj % cells) + cells) % cells;
        const p = pts[wj * cells + wi];
        const px = (ii + (p[0] * cells - wi)) / cells,
          py = (jj + (p[1] * cells - wj)) / cells;
        const d = Math.hypot(px - u, py - v);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = p[2];
        } else if (d < f2) f2 = d;
      }
    return [f1 * cells, f2 * cells, id];
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Each generator returns { r,g,b, h } per pixel.
const GEN = {
  sand(seed) {
    const L = lattices(seed, 8, 5);
    const G = lattices(seed + 9, 64, 2);
    return (x, y) => {
      const warp = fbmT(L, x, y, 3, 4) * 40;
      const rip = 0.5 + 0.5 * Math.sin(((y + warp) / S) * Math.PI * 2 * 22 + Math.sin((x / S) * Math.PI * 2 * 3) * 2.5);
      const ripple = Math.pow(rip, 1.6);
      const grain = fbmT(G, x, y, 2, 64);
      const macro = fbmT(L, x, y, 5, 8);
      const h = 0.55 * ripple + 0.3 * grain + 0.15 * macro;
      const t = 0.82 + 0.18 * macro + (grain - 0.5) * 0.18;
      return [0.86 * t, 0.71 * t, 0.52 * t, h];
    };
  },
  dirt(seed) {
    // desert floor: mottled compact soil, fine grain, sparse small stones, faint crack network
    const L = lattices(seed, 8, 6);
    const G = lattices(seed + 1, 64, 2);
    const W = lattices(seed + 2, 4, 3);
    const V = makeVoronoi(seed + 3, 13);
    const P = makeVoronoi(seed + 5, 64);
    return (x, y) => {
      const n = fbmT(L, x, y, 6, 8);
      const g = fbmT(G, x, y, 2, 64);
      const wx = (fbmT(W, x, y, 3, 4) - 0.5) * 60,
        wy = (fbmT(W, y, x, 3, 4) - 0.5) * 60;
      const [f1, f2] = V((((x + wx) % S) + S) % S, (((y + wy) % S) + S) % S);
      let crack = 1 - clamp01((f2 - f1) * 18);
      crack *= clamp01((fbmT(W, x, y, 3, 4) - 0.42) * 4);
      const [p1, , pid] = P(x, y);
      const pebble = pid > 0.8 ? clamp01(1 - p1 * (2.2 + (1 - pid) * 10)) : 0;
      const h = 0.5 + 0.3 * (n - 0.5) + 0.2 * (g - 0.5) - 0.3 * crack * crack + 0.5 * Math.sqrt(pebble);
      const t = 0.84 + 0.28 * (n - 0.5) + 0.1 * (g - 0.5) - 0.12 * crack;
      let r = 0.62 * t,
        gg = 0.52 * t,
        b = 0.4 * t;
      if (pebble > 0) {
        const pc = 0.45 + 0.35 * ((pid * 7.3) % 1);
        const k = Math.min(1, pebble * 3);
        r += (pc * 0.95 - r) * k;
        gg += (pc * 0.88 - gg) * k;
        b += (pc * 0.8 - b) * k;
      }
      return [r, gg, b, h];
    };
  },
  rock(seed) {
    // weathered bedrock: fine layering, irregular joints at two scales (warped and broken up so
    // no tiling pattern shows), pitting and pale lichen
    const L = lattices(seed, 4, 6);
    const W = lattices(seed + 3, 3, 3);
    const G = lattices(seed + 5, 32, 2);
    const V = makeVoronoi(seed + 7, 7);
    const V2 = makeVoronoi(seed + 19, 19);
    return (x, y) => {
      const n = fbmT(L, x, y, 6, 4);
      const g = fbmT(G, x, y, 2, 32);
      const wx = (fbmT(W, x, y, 3, 3) - 0.5) * 140,
        wy = (fbmT(W, y, x, 3, 3) - 0.5) * 140;
      const px = (((x + wx) % S) + S) % S,
        py = (((y + wy) % S) + S) % S;
      const [a1, a2] = V(px, py);
      const [b1, b2] = V2(px, py);
      // joints: only some cell edges open up
      const j1 = (1 - clamp01((a2 - a1) * 26)) * clamp01((fbmT(W, x, y, 3, 3) - 0.38) * 3);
      const j2 = (1 - clamp01((b2 - b1) * 40)) * clamp01((n - 0.45) * 3) * 0.6;
      const layer = 0.5 + 0.5 * Math.sin(((y + n * 90 + g * 6) / S) * Math.PI * 2 * 14);
      const pit = clamp01((0.32 - g) * 6);
      const lichen = clamp01((g - 0.66) * 6) * clamp01((n - 0.4) * 4);
      const crack = Math.max(j1, j2);
      const h = clamp01(0.22 + 0.48 * n + 0.18 * layer + 0.12 * g - 0.55 * crack * crack - 0.15 * pit);
      const t = 0.7 + 0.32 * (n - 0.5) + 0.1 * layer + 0.08 * (g - 0.5) - 0.32 * crack - 0.1 * pit;
      const k = lichen * 0.5;
      return [0.6 * t + (0.72 - 0.6 * t) * k, 0.55 * t + (0.7 - 0.55 * t) * k, 0.5 * t + (0.6 - 0.5 * t) * k, h];
    };
  },
  salt(seed) {
    const V = makeVoronoi(seed + 11, 7);
    const L = lattices(seed, 16, 4);
    return (x, y) => {
      const [f1, f2] = V(x, y);
      const ridge = 1 - clamp01((f2 - f1) * 8);
      const n = fbmT(L, x, y, 4, 16);
      const h = 0.4 + 0.5 * Math.pow(ridge, 2) + 0.1 * n;
      const t = 0.9 + 0.1 * n - 0.06 * (1 - ridge);
      return [0.93 * t, 0.92 * t, 0.89 * t, h];
    };
  },
  gravel(seed) {
    const P = makeVoronoi(seed + 13, 46);
    const L = lattices(seed, 16, 4);
    return (x, y) => {
      const [f1, f2, id] = P(x, y);
      const stone = clamp01(1 - f1 * 1.6) * (0.6 + 0.4 * id);
      const edge = clamp01((f2 - f1) * 4);
      const n = fbmT(L, x, y, 4, 16);
      const h = 0.25 + 0.65 * stone * edge + 0.1 * n;
      const t = 0.55 + 0.45 * id * stone + 0.1 * n;
      return [0.55 * t, 0.51 * t, 0.46 * t, h];
    };
  },
  asphalt(seed) {
    const P = makeVoronoi(seed + 17, 90);
    const L = lattices(seed, 16, 5);
    return (x, y) => {
      const [f1, , id] = P(x, y);
      const agg = clamp01(1 - f1 * 1.9) * id;
      const n = fbmT(L, x, y, 5, 16);
      const h = 0.4 + 0.4 * agg + 0.2 * n;
      const t = 0.24 + 0.14 * agg + 0.06 * n;
      return [t, t, t * 0.98, h];
    };
  },
  grass(seed) {
    // meadow: dense blades leaning with the wind, mixed green and straw, darker gaps at the roots
    const L = lattices(seed, 8, 5);
    const B = lattices(seed + 3, 128, 2);
    const C = lattices(seed + 4, 16, 3);
    const rnd = mulberry32(seed + 9);
    // blade strokes splatted into a height buffer
    const hb = new Float32Array(S * S);
    const cb = new Float32Array(S * S);
    for (let i = 0; i < 26000; i++) {
      let x = rnd() * S,
        y = rnd() * S;
      const len = 6 + rnd() * 16;
      const a = -Math.PI / 2 + (rnd() - 0.5) * 0.9;
      const dx = Math.cos(a),
        dy = Math.sin(a);
      const shade = rnd();
      for (let t = 0; t < len; t++) {
        const xi = ((Math.floor(x) % S) + S) % S,
          yi = ((Math.floor(y) % S) + S) % S;
        const k = yi * S + xi;
        const h = t / len;
        if (h > hb[k]) {
          hb[k] = h * (0.7 + 0.3 * shade);
          cb[k] = shade;
        }
        x += dx;
        y += dy;
      }
    }
    return (x, y) => {
      const k = y * S + x;
      const macro = fbmT(L, x, y, 5, 8);
      const dry = clamp01((fbmT(C, x, y, 3, 16) - 0.45) * 2.2);
      const fine = fbmT(B, x, y, 2, 128);
      const h = clamp01(hb[k] * 0.85 + 0.15 * fine);
      const t = 0.55 + 0.45 * h + 0.12 * (macro - 0.5);
      const g = [0.36, 0.48, 0.2];
      const st = [0.66, 0.6, 0.36];
      const m = clamp01(dry * 0.8 + cb[k] * 0.25);
      return [(g[0] + (st[0] - g[0]) * m) * t, (g[1] + (st[1] - g[1]) * m) * t, (g[2] + (st[2] - g[2]) * m) * t, h];
    };
  },
  snow(seed) {
    // wind-packed snow: soft drifts, fine sastrugi ripples, cold blue in the hollows
    const L = lattices(seed, 4, 6);
    const R = lattices(seed + 2, 16, 3);
    const G = lattices(seed + 5, 128, 2);
    return (x, y) => {
      const n = fbmT(L, x, y, 6, 4);
      const warp = (fbmT(R, x, y, 3, 16) - 0.5) * 50;
      const rip = 0.5 + 0.5 * Math.sin(((x + warp) / S) * Math.PI * 2 * 14);
      const g = fbmT(G, x, y, 2, 128);
      const drift = fbmT(L, x * 0.5, y * 0.5, 3, 4);
      const h = clamp01(0.6 * n + 0.25 * drift + 0.06 * rip * rip + 0.12 * g);
      const t = 0.9 + 0.1 * h;
      const blue = (1 - h) * 0.06;
      return [0.93 * t - blue, 0.95 * t - blue * 0.6, 0.99 * t, h];
    };
  },
  forest(seed) {
    // pine floor: a mat of brown needles, twigs, cones and patches of moss
    const L = lattices(seed, 8, 5);
    const M = lattices(seed + 2, 16, 3);
    const rnd = mulberry32(seed + 7);
    const hb = new Float32Array(S * S);
    const cb = new Float32Array(S * S);
    const stroke = (n, lenA, lenB, hBase, col) => {
      for (let i = 0; i < n; i++) {
        let x = rnd() * S,
          y = rnd() * S;
        const len = lenA + rnd() * (lenB - lenA);
        const a = rnd() * Math.PI * 2;
        const dx = Math.cos(a),
          dy = Math.sin(a);
        const hh = hBase + rnd() * 0.25;
        for (let t = 0; t < len; t++) {
          const xi = ((Math.floor(x) % S) + S) % S,
            yi = ((Math.floor(y) % S) + S) % S;
          const k = yi * S + xi;
          if (hh > hb[k]) {
            hb[k] = hh;
            cb[k] = col + rnd() * 0.2;
          }
          x += dx;
          y += dy;
        }
      }
    };
    stroke(30000, 5, 12, 0.35, 0.0); // needles
    stroke(90, 14, 40, 0.6, 0.15); // twigs
    const V = makeVoronoi(seed + 11, 22);
    return (x, y) => {
      const k = y * S + x;
      const macro = fbmT(L, x, y, 5, 8);
      const moss = clamp01((fbmT(M, x, y, 3, 16) - 0.55) * 3);
      const [f1, , id] = V(x, y);
      const cone = id > 0.93 ? clamp01(1 - f1 * 3.2) : 0;
      const h = clamp01(Math.max(hb[k], cone * 0.9) * 0.8 + 0.2 * macro);
      const t = 0.6 + 0.5 * h + 0.15 * (macro - 0.5);
      let r = (0.5 + cb[k] * 0.14) * t,
        g = (0.39 + cb[k] * 0.1) * t,
        b = (0.26 + cb[k] * 0.06) * t;
      if (cone > 0) {
        r = 0.5 * t;
        g = 0.34 * t;
        b = 0.2 * t;
      }
      r += (0.38 * t - r) * moss;
      g += (0.46 * t - g) * moss;
      b += (0.22 * t - b) * moss;
      return [r, g, b, h];
    };
  },
};

export const LAYERS = ['sand', 'dirt', 'rock', 'salt', 'gravel', 'asphalt', 'grass', 'snow', 'forest'];

export function buildGroundTextures(seed = 7) {
  const n = LAYERS.length;
  const albedo = new Uint8Array(S * S * 4 * n);
  const normal = new Uint8Array(S * S * 4 * n);
  const hbuf = new Float32Array(S * S);
  LAYERS.forEach((name, li) => {
    const g = GEN[name](seed + li * 101);
    const off = li * S * S * 4;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const [r, gg, b, h] = g(x, y);
        const k = off + (y * S + x) * 4;
        albedo[k] = Math.round(clamp01(r) * 255);
        albedo[k + 1] = Math.round(clamp01(gg) * 255);
        albedo[k + 2] = Math.round(clamp01(b) * 255);
        albedo[k + 3] = Math.round(clamp01(h) * 255);
        hbuf[y * S + x] = h;
      }
    }
    const strength = { sand: 2.2, dirt: 4.5, rock: 7, salt: 3.5, gravel: 4, asphalt: 3, grass: 3.5, snow: 2.4, forest: 4 }[name];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const hx = hbuf[y * S + ((x + 1) % S)] - hbuf[y * S + ((x - 1 + S) % S)];
        const hy = hbuf[((y + 1) % S) * S + x] - hbuf[((y - 1 + S) % S) * S + x];
        let nx = -hx * strength,
          ny = -hy * strength,
          nz = 1;
        const l = Math.hypot(nx, ny, nz);
        const k = off + (y * S + x) * 4;
        normal[k] = Math.round((nx / l * 0.5 + 0.5) * 255);
        normal[k + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
        normal[k + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
        normal[k + 3] = 255;
      }
    }
  });
  const mk = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, S, S, n);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = RENDER_CAPS.aniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(albedo, true), normal: mk(normal, false), size: S, layers: LAYERS };
}
