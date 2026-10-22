// Deterministic world description: road centre line and profile, biomes, terrain height and
// ground materials. Pure functions (no THREE), safe to run inside a worker.

import { SimplexNoise, hash01, clamp, smoothstep, lerp } from '../core/noise.js';

export const BIOMES = ['scrub', 'dunes', 'badlands', 'saltflat', 'highland', 'prairie', 'forest', 'taiga', 'tundra'];
export const BIOME_INFO = {
  scrub: { name: 'Sagebrush steppe', ground: [0.56, 0.47, 0.36], shrubs: 0.85 },
  dunes: { name: 'Dune sea', ground: [0.8, 0.64, 0.44], shrubs: 0.16 },
  badlands: { name: 'Red badlands', ground: [0.62, 0.43, 0.32], shrubs: 0.34 },
  saltflat: { name: 'Salt flats', ground: [0.86, 0.84, 0.8], shrubs: 0.02 },
  highland: { name: 'Stone highlands', ground: [0.5, 0.47, 0.43], shrubs: 0.55 },
  prairie: { name: 'Grass prairie', ground: [0.52, 0.53, 0.36], shrubs: 0.3 },
  forest: { name: 'Pine forest', ground: [0.42, 0.42, 0.32] },
  taiga: { name: 'Snowy taiga', ground: [0.86, 0.88, 0.92] },
  tundra: { name: 'Frozen tundra', ground: [0.84, 0.86, 0.9], shrubs: 0.18 },
};
const DESERT = ['scrub', 'dunes', 'badlands', 'saltflat', 'highland'];
const SNOWY = ['taiga', 'tundra'];
// Biomes appear by distance north along Route 9: desert first, then grass and pine country,
// then snow toward Haven. Weights per biome at a distance in km.
function biomeOdds(km) {
  const ramp = (a, b, v0, v1) => v0 + (v1 - v0) * clamp((km - a) / (b - a), 0, 1);
  const desert = km < 7 ? 1 : ramp(7, 70, 1, 0.12);
  return {
    scrub: desert * 1.1,
    dunes: desert,
    badlands: desert,
    saltflat: desert * 0.6,
    highland: desert * 0.9 + ramp(30, 80, 0, 0.25),
    prairie: km < 6 ? 0 : ramp(6, 20, 0.3, 1.1) - ramp(70, 120, 0, 0.5),
    forest: km < 9 ? 0 : ramp(9, 30, 0.3, 1.2),
    taiga: km < 26 ? 0 : ramp(26, 75, 0.25, 1.1),
    tundra: km < 40 ? 0 : ramp(40, 95, 0.2, 0.7),
  };
}
export const RIVER_SPACING = 4300;
export const LAKE_CELL = 1700;

export const ROAD = { halfWidth: 3.6, shoulder: 1.6, laneMark: 0.12 };
// dirt side tracks: one may leave the highway in every stretch of TRACK.every metres
export const TRACK = { halfWidth: 2.4, shoulder: 1.1, every: 3400 };
// The road's character changes every few kilometres (see WorldGen.windSeg), and now and then the
// land itself rises onto a plateau, over a ridge or down into a basin (WorldGen.liftEvent).
const WIND_SEG = 2600;
const LIFT_CELL = 16000;
const BIOME_CELL = 2600;

// Value noise with its analytic derivatives: [value -1..1, d/dx, d/dy].
const _nd = [0, 0, 0];
function latticeHash(ix, iy, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
}
function noised(x, y, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10),
    uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx * (fx - 2) + 1),
    duy = 30 * fy * fy * (fy * (fy - 2) + 1);
  const a = latticeHash(ix, iy, seed),
    b = latticeHash(ix + 1, iy, seed),
    c = latticeHash(ix, iy + 1, seed),
    d = latticeHash(ix + 1, iy + 1, seed);
  const k1 = b - a,
    k2 = c - a,
    k4 = a - b - c + d;
  _nd[0] = a + k1 * ux + k2 * uy + k4 * ux * uy;
  _nd[1] = dux * (k1 + k4 * uy);
  _nd[2] = duy * (k2 + k4 * ux);
  return _nd;
}

// 0 -> 1 over t in 0..1 at a steady grade, eased in and out over the first and last quarter.
function rampEase(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const e = 0.25,
    a = 1 / (1 - e);
  if (t < e) return (0.5 * a * t * t) / e;
  if (t > 1 - e) return 1 - (0.5 * a * (1 - t) * (1 - t)) / e;
  return a * (t - e / 2);
}

// Mountain relief: fBm whose every octave is damped where the octaves below are steep. Ridges
// stay sharp, valley floors smooth out and gullies run down the flanks, the way water and frost
// shape real ranges. Returns about 0..1.
function erodedFbm(x, y, seed, octaves = 9) {
  let a = 0,
    b = 0.5,
    dx = 0,
    dy = 0,
    px = x,
    py = y;
  for (let i = 0; i < octaves; i++) {
    const n = noised(px, py, seed + i * 1013);
    dx += n[1];
    dy += n[2];
    a += (b * (n[0] * 0.5 + 0.5)) / (1 + dx * dx + dy * dy);
    b *= 0.5;
    // rotate and double: no octave lines up with the one below
    const qx = 1.6 * px - 1.2 * py,
      qy = 1.2 * px + 1.6 * py;
    px = qx;
    py = qy;
  }
  return a;
}
export const POI_SPACING = 620;

export const POI_INFO = {
  homestead: { offset: [24, 28], pad: 30 },
  gasStation: { offset: [22, 26], pad: 30 },
  motel: { offset: [26, 34], pad: 32 },
  diner: { offset: [20, 26], pad: 22 },
  houses: { offset: [34, 50], pad: 46 },
  house: { offset: [24, 42], pad: 23 },
  ranch: { offset: [42, 62], pad: 40 },
  waterTower: { offset: [18, 30], pad: 12 },
  radioTower: { offset: [30, 60], pad: 14 },
  junkyard: { offset: [24, 36], pad: 26 },
  trailers: { offset: [24, 40], pad: 28 },
  outpost: { offset: [30, 50], pad: 26 },
  ruins: { offset: [18, 40], pad: 16 },
  camp: { offset: [16, 30], pad: 12 },
  wreck: { offset: [6, 9], pad: 6 },
  farm: { offset: [36, 54], pad: 42 },
  cabin: { offset: [22, 36], pad: 16 },
  church: { offset: [24, 36], pad: 26 },
  sawmill: { offset: [30, 46], pad: 36 },
  lodge: { offset: [28, 44], pad: 30 },
  lookout: { offset: [24, 40], pad: 12 },
};

const POI_TABLE = {
  scrub: [
    ['gasStation', 3],
    ['house', 2.5],
    ['houses', 1.6],
    ['ranch', 1.6],
    ['diner', 1.2],
    ['motel', 1.0],
    ['waterTower', 0.9],
    ['trailers', 0.9],
    ['camp', 0.6],
    ['wreck', 1.0],
    ['radioTower', 0.6],
  ],
  dunes: [
    ['gasStation', 2.4],
    ['camp', 1.4],
    ['ruins', 1.2],
    ['wreck', 1.6],
    ['outpost', 0.7],
    ['diner', 0.8],
    ['radioTower', 0.8],
  ],
  badlands: [
    ['gasStation', 2.2],
    ['ruins', 1.6],
    ['house', 1.4],
    ['motel', 1.1],
    ['junkyard', 1.1],
    ['outpost', 0.8],
    ['wreck', 1.2],
    ['waterTower', 0.8],
  ],
  saltflat: [
    ['gasStation', 2.5],
    ['diner', 1.4],
    ['motel', 1.3],
    ['radioTower', 1.0],
    ['wreck', 1.5],
    ['trailers', 0.8],
    ['outpost', 0.6],
  ],
  prairie: [
    ['gasStation', 2.6],
    ['farm', 2.6],
    ['house', 1.6],
    ['houses', 1.4],
    ['church', 1.0],
    ['diner', 1.0],
    ['motel', 0.8],
    ['waterTower', 0.8],
    ['wreck', 0.9],
    ['trailers', 0.5],
  ],
  forest: [
    ['gasStation', 2.4],
    ['cabin', 2.6],
    ['sawmill', 1.4],
    ['lookout', 1.0],
    ['house', 1.2],
    ['church', 0.6],
    ['camp', 1.0],
    ['motel', 0.8],
    ['wreck', 0.8],
  ],
  taiga: [
    ['gasStation', 2.6],
    ['cabin', 2.4],
    ['lodge', 1.6],
    ['sawmill', 1.0],
    ['lookout', 0.8],
    ['church', 0.6],
    ['outpost', 0.8],
    ['wreck', 0.8],
  ],
  tundra: [
    ['gasStation', 2.8],
    ['outpost', 1.4],
    ['cabin', 1.4],
    ['lodge', 1.0],
    ['radioTower', 1.0],
    ['ruins', 0.8],
    ['wreck', 1.0],
  ],
  highland: [
    ['gasStation', 2.4],
    ['house', 1.8],
    ['houses', 1.2],
    ['ranch', 1.0],
    ['waterTower', 0.9],
    ['radioTower', 1.0],
    ['junkyard', 0.9],
    ['camp', 0.8],
    ['wreck', 1.0],
  ],
};
const BIOME_BLEND = 450;

export class WorldGen {
  constructor(seed = 1234) {
    this.seed = seed;
    this.nA = new SimplexNoise(seed);
    this.nB = new SimplexNoise(seed * 7 + 3);
    this.nC = new SimplexNoise(seed * 13 + 5);
    this._roadYCache = new Map();
  }

  // ---------------------------------------------------------------- biomes
  biomeOfCell(k) {
    if (!(k > 0)) return 'scrub';
    if (!this._cells) this._cells = new Map();
    // avoid repeating the previous cell's biome (walk forward from the last cached cell)
    let start = k - 1;
    while (start > 0 && !this._cells.has(start)) start--;
    for (let j = start + 1; j < k; j++) this._cellCached(j);
    const prev = k - 1 > 0 ? this._cellCached(k - 1) : 'scrub';
    const odds = biomeOdds((k * BIOME_CELL) / 1000);
    // no jump straight from sand to snow (or back): something green or stony in between
    const desertPrev = DESERT.includes(prev) && prev !== 'highland',
      snowPrev = SNOWY.includes(prev);
    let tot = 0;
    const list = [];
    for (const b of BIOMES) {
      let w = odds[b] || 0;
      if (b === prev) w = 0;
      if (desertPrev && SNOWY.includes(b)) w = 0;
      if (snowPrev && DESERT.includes(b) && b !== 'highland') w = 0;
      if (w > 0) {
        list.push([b, w]);
        tot += w;
      }
    }
    if (!list.length) return 'scrub';
    let r = hash01(this.seed, k, 91) * tot;
    for (const [b, w] of list) {
      r -= w;
      if (r <= 0) return b;
    }
    return list[list.length - 1][0];
  }

  // How snowy the ground is at (x, z): 0..1 (snow biomes, plus high ground in the north).
  snowAt(x, z, bw) {
    bw = bw || this.biomeWeights(x, z);
    return clamp(bw.taiga + bw.tundra, 0, 1);
  }

  // Weights per biome at (x, z): object { biome: w }
  biomeWeights(x, z, out = {}) {
    for (const b of BIOMES) out[b] = 0;
    const zz = z + this.nC.noise2(x * 0.0009, z * 0.0004) * 260;
    const k = Math.floor(zz / BIOME_CELL);
    const f = zz - k * BIOME_CELL;
    const cur = this._cellCached(k);
    if (f < BIOME_BLEND / 2 && k > -1000) {
      const prev = this._cellCached(k - 1);
      const t = smoothstep(-BIOME_BLEND / 2, BIOME_BLEND / 2, f);
      out[prev] += 1 - t;
      out[cur] += t;
    } else if (f > BIOME_CELL - BIOME_BLEND / 2) {
      const next = this._cellCached(k + 1);
      const t = smoothstep(BIOME_CELL - BIOME_BLEND / 2, BIOME_CELL + BIOME_BLEND / 2, f);
      out[cur] += 1 - t;
      out[next] += t;
    } else out[cur] += 1;
    return out;
  }

  _cellCached(k) {
    if (!this._cells) this._cells = new Map();
    let b = this._cells.get(k);
    if (!b) {
      b = this.biomeOfCell(k);
      this._cells.set(k, b);
    }
    return b;
  }

  dominantBiome(x, z) {
    const w = this.biomeWeights(x, z);
    let best = 'scrub',
      bw = -1;
    for (const b of BIOMES)
      if (w[b] > bw) {
        bw = w[b];
        best = b;
      }
    return best;
  }

  // ---------------------------------------------------------------- road
  // Long sweeps across the country, and on top of them, stretch by stretch, the road's own
  // character: S-bends every few hundred metres on winding stretches, tighter ones up the passes.
  roadX(z) {
    // the terrain asks for whole rows of the same z: a small cache on the exact value
    const ci = (Math.floor(z * 4) & 4095) >>> 0;
    if (this._rxK && this._rxK[ci] === z) return this._rxV[ci];
    const n = this.nA;
    let x = n.noise2(z * 0.00032, 7.1) * 240 + n.noise2(z * 0.001, 3.3) * 55 + n.noise2(z * 0.0028, 9.9) * 7;
    x += this.windAt(z);
    // keep the start area straight-ish
    const s = smoothstep(150, 900, Math.abs(z));
    const v = x * s;
    if (!this._rxK) {
      this._rxK = new Float64Array(4096).fill(NaN);
      this._rxV = new Float64Array(4096);
    }
    this._rxK[ci] = z;
    this._rxV[ci] = v;
    return v;
  }

  roadDir(z) {
    const e = 1;
    const dx = this.roadX(z + e) - this.roadX(z - e);
    const l = Math.hypot(dx, 2 * e);
    return [dx / l, (2 * e) / l];
  }

  // dx/dz of the road line at z.
  roadSlope(z) {
    return (this.roadX(z + 0.5) - this.roadX(z - 0.5)) / 1;
  }

  // Distance from (x, z) to the road measured across it (not along x: on a bend the two differ).
  roadDist(x, z) {
    const sl = this.roadSlope(z);
    return Math.abs(x - this.roadX(z)) / Math.sqrt(1 + sl * sl);
  }

  // The stretch of road around segment s: calm (only the long sweeps), winding (S-bends every
  // 340-600 m), tight (every 220-340 m) or a pass (tight bends climbing onto high ground). The
  // bend radius never drops below what a car takes at a sensible speed.
  windSeg(s) {
    if (!this._wind) this._wind = new Map();
    let w = this._wind.get(s);
    if (w) return w;
    const r = (i) => hash01(this.seed, s, 1701 + i);
    const zc = (s + 0.5) * WIND_SEG;
    let type = 'calm';
    if (s >= 1) {
      const ramp = this.rampNear(zc, 0);
      if (ramp && r(0) < 0.75) type = 'pass';
      else type = r(1) < 0.26 ? 'calm' : r(1) < 0.68 ? 'winding' : 'tight';
    }
    const P = { calm: [0, 0, 0, 1e9], winding: [340, 260, 30 + r(3) * 45, 75], tight: [220, 120, 22 + r(3) * 30, 48], pass: [240, 100, 28 + r(3) * 28, 40] }[type];
    const L = P[0] + r(2) * P[1];
    // (with a margin for the slow swell of the amplitude and the fades at the ends)
    const A = type === 'calm' ? 0 : Math.min(P[2], (0.8 * L * L) / (4 * Math.PI * Math.PI * P[3]));
    w = { type, L, A, phase: r(4) * Math.PI * 2, z0: s * WIND_SEG, z1: (s + 1) * WIND_SEG };
    this._wind.set(s, w);
    return w;
  }

  windAt(z) {
    const s = Math.floor(z / WIND_SEG);
    const w = this.windSeg(s);
    if (!w.A) return 0;
    // a straight bit at either end, and calm water: no bends across a river or beside a lake
    let env = smoothstep(w.z0, w.z0 + 420, z) * smoothstep(w.z1, w.z1 - 420, z);
    if (env <= 0) return 0;
    env *= this.calmWater(z);
    if (env <= 0) return 0;
    const a = w.A * (0.8 + 0.2 * this.nC.noise2(z * 0.0007, 41.7));
    return a * env * Math.sin(((z - w.z0) / w.L) * Math.PI * 2 + w.phase);
  }

  // 0 near a river crossing or a lake (where the road keeps straight), 1 elsewhere. Uses the
  // places' nominal positions only (they are worked out from the road, so not from this).
  calmWater(z) {
    let k = 1;
    const kr = Math.round(z / RIVER_SPACING);
    for (let i = kr - 1; i <= kr + 1; i++) {
      if (i <= 0) continue;
      const z0 = i * RIVER_SPACING + (hash01(this.seed, i, 301) - 0.5) * 1400;
      k *= smoothstep(380, 760, Math.abs(z - z0));
    }
    const kl = Math.round(z / LAKE_CELL);
    for (let i = kl - 1; i <= kl + 1; i++) {
      if (i <= 1) continue;
      const zl = i * LAKE_CELL + (hash01(this.seed, i, 401) - 0.5) * 600;
      if (Math.abs(z - zl) > 600) continue;
      const b = this._cellCached(Math.floor(zl / BIOME_CELL));
      const p = { forest: 0.55, taiga: 0.5, tundra: 0.45, prairie: 0.35, highland: 0.15 }[b] || 0;
      if (hash01(this.seed, i, 402) >= p) continue;
      k *= smoothstep(260, 600, Math.abs(z - zl));
    }
    return k;
  }

  // ---------------------------------------------------------------- high ground
  // Every 16 km or so the land rises: onto a plateau the road climbs to and runs along for a few
  // kilometres, over a ridge it crosses at a saddle and drops down from, or down into a basin.
  // Grades on the road stay near 8%; away from the road the slopes are steeper and the crest
  // line wanders, so it reads as country, not as a ramp.
  liftEvent(j) {
    if (!this._lift) this._lift = new Map();
    if (this._lift.has(j)) return this._lift.get(j);
    const r = (i) => hash01(this.seed, j, 1801 + i);
    let e = null;
    if (j >= 1 && r(0) < 0.85) {
      const k = r(1);
      const kind = k < 0.45 ? 'plateau' : k < 0.78 ? 'ridge' : 'basin';
      const H = kind === 'basin' ? -(70 + r(2) * 90) : kind === 'ridge' ? 170 + r(2) * 210 : 120 + r(2) * 200;
      const R = Math.max(1600, (Math.abs(H) * 1.333) / 0.08);
      let P = kind === 'ridge' ? 150 + r(3) * 500 : 1800 + r(3) * 4200;
      const zs = j * LIFT_CELL + 600 + r(4) * 1200;
      P = Math.max(100, Math.min(P, LIFT_CELL - 2 * R - 1600));
      e = { kind, H, R, P, zs, up: zs + R / 2, down: zs + R + P + R / 2, seed: r(5) * 100 };
    }
    this._lift.set(j, e);
    return e;
  }

  // 1 on a climb or descent of the high ground, fading to 0 within 800 m of it (smooth in z).
  rampWeight(z) {
    const j = Math.floor(z / LIFT_CELL);
    let w = 0;
    for (let i = j - 1; i <= j; i++) {
      const e = this.liftEvent(i);
      if (!e) continue;
      for (const c of [e.up, e.down]) w = Math.max(w, smoothstep(e.R / 2 + 800, e.R / 2, Math.abs(z - c)));
    }
    return w;
  }

  // An event whose climb or descent is within `range` of z.
  rampNear(z, range) {
    const j = Math.floor(z / LIFT_CELL);
    for (let i = j - 1; i <= j; i++) {
      const e = this.liftEvent(i);
      if (!e) continue;
      if (Math.abs(z - e.up) < e.R / 2 + range || Math.abs(z - e.down) < e.R / 2 + range) return e;
    }
    return null;
  }

  liftAt(x, z) {
    const j = Math.floor(z / LIFT_CELL);
    let h = 0;
    let dRoad = -1;
    for (let i = j - 1; i <= j; i++) {
      const e = this.liftEvent(i);
      if (!e || z < e.zs - 6000 || z > e.down + e.R + 6000) continue;
      if (dRoad < 0) dRoad = Math.abs(x - this.roadX(z));
      const near = Math.exp(-((dRoad / 1100) ** 2));
      // the edge wanders across the country; steeper away from the road the road's ramp
      const zz = z + this.nB.noise2(x * 0.00035 + e.seed, 7.7) * 1400 * (1 - near * 0.8);
      const R = e.R * (0.45 + 0.55 * near);
      const t = rampEase((zz - e.up) / R + 0.5) - rampEase((zz - e.down) / R + 0.5);
      if (t === 0) continue;
      // the crest is higher off to the sides: the road takes the saddle
      const n = this.nC.noise2(x * 0.0006 + e.seed, 3.1);
      const H = e.H * (e.H > 0 ? 1 + (0.25 + 0.55 * Math.abs(n)) * (1 - near) : 1 + 0.3 * n * (1 - near));
      h += H * t;
    }
    return h;
  }

  macroHeight(x, z) {
    const n = this.nB;
    // hill country comes and goes along the way: long climbs and steep drops for the road
    // (calmer where the land is already climbing onto high ground: the grades would add up)
    const calm = 1 - 0.7 * this.rampWeight(z);
    const hilly = smoothstep(-0.05, 0.45, this.nA.noise2(z * 0.000085 + 40, 1.7)) * calm;
    const hills = hilly > 0 ? hilly * (n.noise2(x * 0.0007 + 11, z * 0.0007 - 4) * 26 + n.noise2(x * 0.0019 - 7, z * 0.0019 + 2) * 6) : 0;
    return (n.noise2(x * 0.00045, z * 0.00045) * 26 + n.noise2(x * 0.0012 + 31, z * 0.0012) * 7) * calm + hills + this.liftAt(x, z);
  }

  // Distance along the road from z = 0 to z (for the road's texture: lane dashes keep their
  // length on bends). Integrated in 20 m steps, kept in a table.
  roadS(z) {
    const STEP = 20;
    if (!this._sTab) this._sTab = { pos: [0], neg: [0] };
    const tab = z >= 0 ? this._sTab.pos : this._sTab.neg;
    const dir = z >= 0 ? 1 : -1;
    const i = Math.floor(Math.abs(z) / STEP);
    while (tab.length <= i + 1) {
      const k = tab.length - 1;
      const a = dir * k * STEP,
        b = dir * (k + 1) * STEP;
      let len = 0;
      for (let q = 0; q < 4; q++) {
        const z0 = a + ((b - a) * q) / 4,
          z1 = a + ((b - a) * (q + 1)) / 4;
        len += Math.hypot(this.roadX(z1) - this.roadX(z0), z1 - z0);
      }
      tab.push(tab[k] + len);
    }
    const f = (Math.abs(z) - i * STEP) / STEP;
    return dir * lerp(tab[i], tab[i + 1], f);
  }

  // ---------------------------------------------------------------- side tracks
  // Every few kilometres a dirt track may leave the highway, swing a few hundred metres out over
  // the open country (up and over whatever is there) and come back to it. On over half of them
  // the highway between their ends is blocked — trees down across it, a rockslide, a trailer on
  // its side — and the track is the way round.
  track(t) {
    if (!this._tracks) this._tracks = new Map();
    if (this._tracks.has(t)) return this._tracks.get(t);
    let res = null;
    const r = (i) => hash01(this.seed, t, 1401 + i);
    if (t >= 1 && r(0) < 0.85) {
      const len = 900 + r(1) * 700;
      const z0 = t * TRACK.every + (r(2) - 0.5) * 700;
      res = { t, z0, z1: z0 + len, len, side: r(3) < 0.5 ? -1 : 1, D: 130 + r(4) * 190, wob: r(6) * 6.28 };
      const blocked = z0 > 1800 && r(5) < 0.6;
      if (blocked) {
        const zb = z0 + len * 0.5 + (r(8) - 0.5) * len * 0.2;
        // what comes down depends on the country right there
        const bw = this.biomeWeights(this.roadX(zb), zb);
        const wooded = bw.forest + bw.taiga + bw.tundra * 0.6;
        const rocky = bw.highland + bw.badlands + bw.scrub * 0.3;
        const kind = wooded > 0.45 ? 'trees' : rocky > 0.45 || r(7) < 0.3 ? 'rocks' : 'trailer';
        res.block = { kind, z: zb };
      }
      // no fords, no lakes, nowhere near the start
      if (z0 < 1500) res = null;
      for (let z = z0; res && z <= z0 + len; z += 30) {
        const x = this.trackX(res, z);
        if (this.waterAt(x, z) || this.waterAt(this.roadX(z), z)) res = null;
        else {
          const rv = this.riverAt(x, z);
          if (rv && rv.d < rv.r.w + 30) res = null;
        }
      }
      if (res && this.bridgeNear(res.z0) && this.bridgeNear(res.z1)) res = null;
    }
    this._tracks.set(t, res);
    return res;
  }

  // The track whose span contains z, if any.
  trackAt(z) {
    const t0 = Math.floor(z / TRACK.every);
    for (let t = t0 + 1; t >= t0 - 1; t--) {
      const tr = this.track(t);
      if (tr && z > tr.z0 && z < tr.z1) return tr;
    }
    return null;
  }

  // Sideways offset of the track from the highway at z (0 at both junctions).
  trackOffset(tr, z) {
    const u = (z - tr.z0) / tr.len;
    if (u <= 0 || u >= 1) return 0;
    const b = Math.sin(Math.PI * u);
    return tr.side * tr.D * b * (1 + 0.18 * Math.sin(u * 9.4 + tr.wob) * b);
  }

  trackX(tr, z) {
    return this.roadX(z) + this.trackOffset(tr, z);
  }

  // Along-track profile: the lie of the land, smoothed a little; the highway's level at the ends.
  trackY(tr, z) {
    const key = tr.t * 1e6 + Math.round(z);
    if (!this._trackYCache) this._trackYCache = new Map();
    const c = this._trackYCache.get(key);
    if (c !== undefined) return c;
    let s = 0,
      w = 0;
    for (let k = -5; k <= 5; k++) {
      const zz = Math.round(z) + k * 9;
      const g = Math.exp(-(k * k) / 8);
      s += this.naturalHeight(this.trackX(tr, zz), zz) * g;
      w += g;
    }
    const u = (z - tr.z0) / tr.len;
    const e = smoothstep(0.02, 0.2, u) * smoothstep(0.98, 0.8, u);
    const y = lerp(this.roadY(z), s / w, e);
    if (this._trackYCache.size > 300000) this._trackYCache.clear();
    this._trackYCache.set(key, y);
    return y;
  }

  // Distance across the nearest track at (x, z) and the track: { d, tr } or null.
  trackNear(x, z) {
    const tr = this.trackAt(z);
    if (!tr) return null;
    const e = 1;
    const sl = (this.trackX(tr, z + e) - this.trackX(tr, z - e)) / (2 * e);
    const d = Math.abs(x - this.trackX(tr, z)) / Math.sqrt(1 + sl * sl);
    return { d, tr };
  }

  // Is the highway blocked at z? (where the obstacle of a detour stands)
  blockAt(z, margin = 0) {
    const tr = this.trackAt(z);
    return tr && tr.block && Math.abs(z - tr.block.z) < 14 + margin ? tr : null;
  }

  // Road elevation: Gaussian-smoothed macro height sampled along the road.
  roadY(z) {
    const key = Math.round(z * 2);
    const c = this._roadYCache.get(key);
    if (c !== undefined) return c;
    let s = 0,
      w = 0;
    for (let k = -8; k <= 8; k++) {
      const zz = z + k * 22;
      const g = Math.exp(-(k * k) / 18);
      s += this.macroHeight(this.roadX(zz), zz) * g;
      w += g;
    }
    const y = s / w;
    if (this._roadYCache.size > 200000) this._roadYCache.clear();
    this._roadYCache.set(key, y);
    return y;
  }

  // Road condition 0 (fresh) .. 1 (broken), dirt sections flagged.
  roadInfo(z) {
    const seg = Math.floor(z / 900);
    const h = hash01(this.seed, seg, 17);
    const biome = this._cellCached(Math.floor(z / BIOME_CELL));
    const dirt = seg > 2 && h < (biome === 'badlands' || biome === 'highland' || biome === 'forest' ? 0.16 : 0.06);
    const wear = clamp(0.25 + 0.6 * hash01(this.seed, seg, 23) + 0.15 * this.nA.noise2(z * 0.01, 1.7), 0, 1);
    const snow = this.snowAt(this.roadX(z), z);
    return { dirt, wear, snow };
  }

  // ---------------------------------------------------------------- terrain
  // Ground shape per biome. dx: distance from the road. The country along the road is mostly calm
  // (plains, long swells, washes); the bolder shapes (dune fields, mesas, wooded hills) stand
  // further back, and how hilly it gets changes from region to region.
  // Dry washes draining across the plain toward the road (shallow, meandering).
  wash(x, z) {
    const w = Math.abs(this.nB.noise2(x * 0.0006 + this.nC.noise2(x * 0.003, z * 0.003) * 0.25, z * 0.0019 + 5));
    return -1.3 * (1 - smoothstep(0.0, 0.045, w));
  }

  biomeDetail(b, x, z, dx = Math.abs(x - this.roadX(z))) {
    const n = this.nB,
      m = this.nC;
    const back = smoothstep(60, 520, dx);
    const hilly = smoothstep(-0.25, 0.45, this.nA.noise2(z * 0.00009 + 4, x * 0.00009 - 2));
    switch (b) {
      case 'dunes': {
        // sand sheet by the road, an erg further out: transverse dunes across the wind (+x) with a
        // long gentle windward slope and a short steep slip face, broken into crescents
        const sheet = n.noise2(x * 0.0012, z * 0.0012) * 1.6 + n.noise2(x * 0.006, z * 0.006) * 0.25;
        // the erg covers most of the biome; by the road the dunes are low drifts, growing to full
        // size a few hundred metres out
        const field = smoothstep(-0.85, -0.25, m.noise2(x * 0.00032 + 11, z * 0.00032)) * smoothstep(16, 50, dx) * (0.35 + 0.65 * smoothstep(50, 280, dx));
        if (field <= 0) return sheet;
        const lambda = 130;
        const warp = m.noise2(x * 0.0009, z * 0.0017) * 38 + n.noise2(x * 0.00035, z * 0.0004) * 150;
        const ph = (x + warp) / lambda;
        const saw = ph - Math.floor(ph);
        const prof = saw < 0.76 ? Math.pow(saw / 0.76, 1.35) : 0.5 + 0.5 * Math.cos(((saw - 0.76) / 0.24) * Math.PI);
        const crest = smoothstep(-0.45, 0.2, n.noise2(x * 0.0018 + 3, z * 0.0024));
        const H = 8 + 16 * (m.noise2(x * 0.0009 + 7, z * 0.0009) * 0.5 + 0.5);
        const draa = (n.noise2(x * 0.0007 + 9, z * 0.0007) * 0.5 + 0.5) * 9;
        return sheet + field * (prof * crest * H + draa);
      }
      case 'badlands': {
        // flats and washes by the road; mesas and buttes with terraced cliffs further back
        const flat = n.noise2(x * 0.0013, z * 0.0013) * 2.2 + this.wash(x, z);
        const mm = this.mesaNoise(x, z);
        // each mesa its own height; terraced cliffs over a talus apron
        const top = 22 + 26 * (m.noise2(x * 0.0011 - 5, z * 0.0011 + 8) * 0.5 + 0.5);
        let h = smoothstep(0.28, 0.42, mm) * top;
        const step = 5.5 + 2.5 * (n.noise2(x * 0.0017, z * 0.0017 + 2) * 0.5 + 0.5);
        const tq = Math.floor(h / step);
        const fr = h / step - tq;
        h = (tq + smoothstep(0.55, 1.0, fr)) * step;
        const talus = Math.pow(smoothstep(0.12, 0.3, mm), 1.6) * (5 + 0.12 * top);
        // erosion notches and gullies cut into the cliff faces
        const notch = Math.pow(1 - Math.abs(n.noise2(x * 0.016 + 3, z * 0.016)), 6) * 7 * smoothstep(0.26, 0.31, mm) * (1 - smoothstep(0.35, 0.42, mm));
        const gully = Math.abs(n.noise2(x * 0.01, z * 0.01)) * 2.2;
        // low rounded clay hills, banded, in patches closer in
        const cp = smoothstep(0.05, 0.4, m.noise2(x * 0.0016 + 21, z * 0.0016 - 9));
        const clay = Math.pow(Math.max(0, n.noise2(x * 0.011 + 6, z * 0.011 - 1) - 0.15) / 0.85, 1.4) * 10 * cp * smoothstep(35, 140, dx);
        return flat + clay + Math.max(0, Math.max(h, talus) - gully - notch) * smoothstep(140, 600, dx);
      }
      case 'saltflat':
        return n.noise2(x * 0.003, z * 0.003) * 0.35;
      case 'highland': {
        // high desert plateau: long swells, rocky knolls and a butte now and then
        const swell = n.noise2(x * 0.0011 + 2, z * 0.0011) * 6 + n.noise2(x * 0.004, z * 0.004) * 1.2;
        const knoll = Math.pow(Math.max(0, n.noise2(x * 0.0045 + 5, z * 0.0045) - 0.35) / 0.65, 1.6) * 22;
        return swell + this.wash(x, z) + knoll * back * (0.4 + 0.6 * hilly);
      }
      case 'prairie':
        // long gentle swells
        return (n.noise2(x * 0.0018 + 7, z * 0.0018) * 7 + n.noise2(x * 0.007, z * 0.007 + 3) * 1.4) * (0.45 + 0.55 * back) + n.noise2(x * 0.04, z * 0.04) * 0.15;
      case 'forest': {
        // wooded hills with soft ridges, a broad valley along the road
        const r = 1 - Math.abs(n.noise2(x * 0.0032 + 3, z * 0.0032 - 2));
        return (r * r * 18 * (0.3 + 0.7 * hilly) - 5) * (0.25 + 0.75 * back) + n.noise2(x * 0.012, z * 0.012) * 2.2 + n.noise2(x * 0.05, z * 0.05) * 0.3;
      }
      case 'taiga': {
        // hills that rise away from the road valley
        const away = smoothstep(40, 380, dx);
        const r = 1 - Math.abs(n.noise2(x * 0.0022 - 9, z * 0.0022 + 4));
        const r2 = 1 - Math.abs(n.noise2(x * 0.0068, z * 0.0068 + 8));
        return (r * r * 40 + r2 * r2 * 8) * (0.2 + 0.8 * away) + n.noise2(x * 0.02, z * 0.02) * 0.8 - 8;
      }
      case 'tundra': {
        // open, gently rolling, with frost hummocks
        const hum = Math.max(0, n.noise2(x * 0.09, z * 0.09)) * 0.45;
        return n.noise2(x * 0.003 + 1, z * 0.003) * 4 + n.noise2(x * 0.011, z * 0.011) * 1.1 + hum;
      }
      default: {
        // scrub: open desert plain sloping gently off the ranges, washes, low hills further out
        const plain = n.noise2(x * 0.0011, z * 0.0011) * 3.5 + n.noise2(x * 0.004, z * 0.004) * 0.6 + n.noise2(x * 0.05, z * 0.05) * 0.12;
        const hills = Math.pow(1 - Math.abs(n.noise2(x * 0.0024 + 9, z * 0.0024)), 2.5) * 16;
        return plain + this.wash(x, z) + hills * back * hilly;
      }
    }
  }

  // Slow colour drift of the ground, as a per-channel multiplier: a few hundred metres of redder
  // soil, then yellower, then a greyer, darker stretch, so a plain is never one flat colour.
  tintDrift(x, z) {
    const a = this.nC.noise2(x * 0.0014 + 31, z * 0.0014 - 7);
    const b = this.nA.noise2(x * 0.0006 - 13, z * 0.0006 + 29);
    const c = this.nB.noise2(x * 0.0035 + 5, z * 0.0035 + 17) * 0.5;
    const red = a * 0.09,
      grey = Math.max(0, b) * 0.14,
      v = 1 + c * 0.12 - grey * 0.5;
    return [(1 + red - grey * 0.3) * v, (1 - red * 0.2 + a * a * 0.04) * v, (1 - red * 0.9 + grey * 0.35) * v];
  }

  // Badlands mesa field: the tops stand where this is above ~0.28; just below it lie their feet.
  mesaNoise(x, z) {
    const n = this.nB;
    return n.noise2(x * 0.0021 + 11, z * 0.0021 - 4) + 0.35 * n.noise2(x * 0.006, z * 0.006);
  }

  // Returns natural (unroaded) ground height.
  naturalHeight(x, z, bw) {
    bw = bw || this.biomeWeights(x, z, this._bw || (this._bw = {}));
    let d = 0;
    const dx = Math.abs(x - this.roadX(z));
    for (const b of BIOMES) if (bw[b] > 0.001) d += bw[b] * this.biomeDetail(b, x, z, dx);
    return this.macroHeight(x, z) + d + this.mountain(x, z, bw);
  }

  // Mountain ranges standing back from the road: ridged peaks a few hundred metres high that
  // come and go along the way, now and then crowding in so the road runs up a valley between
  // them. Rivers cut their own valleys through.
  mountain(x, z, bw) {
    const dx = Math.abs(x - this.roadX(z));
    const n = this.nA;
    const close = smoothstep(0.3, 0.85, n.noise2(z * 0.00027 + 17, 3.3) * 0.5 + 0.5);
    const start = 1300 - 750 * close;
    if (dx < start) return 0;
    // ranges: broad belts of high country, with gaps between them
    const range = smoothstep(-0.5, 0.15, n.noise2(x * 0.00017 + 5, z * 0.00017 - 9) + 0.3 * close);
    if (range <= 0) return 0;
    let mask = smoothstep(start, start + 1000, dx) * range;
    for (const rv of this.riversNear(z, 1)) {
      if (Math.abs(z - rv.z0) > 1600) continue;
      mask *= smoothstep(rv.w + 60, rv.w + 1100, Math.abs(z - this.riverZ(rv, x)));
    }
    if (mask <= 0.001) return 0;
    // ranges run with the road (long belts across the land, like basin-and-range country); the
    // eroded fBm on them makes the crests, spurs and gullies, flat between the ranges
    const belt = n.noise2(x * 0.00034 + 3, z * 0.00011 - 1) + 0.3 * n.noise2(x * 0.0009 + 7, z * 0.0007);
    const k = smoothstep(-0.4, 0.3, belt) * mask;
    if (k <= 0.001) return 0;
    const e = erodedFbm(x * 0.00052, z * 0.00052, this.seed | 0);
    let relief = Math.pow(e / 0.45, 1.6);
    relief = 1.35 * Math.tanh(relief / 1.35);
    // sharp ridges and the gullies between them, cut deeper the higher the ground stands
    const nr = this.nC;
    let r = 0,
      a = 0.5,
      wgt = 1,
      px = x * 0.0013,
      pz = z * 0.0013;
    for (let o = 0; o < 4; o++) {
      let v = 1 - Math.abs(nr.noise2(px + o * 17.3, pz - o * 9.1));
      v = v * v * (3 - 2 * v);
      r += a * v * wgt;
      wgt = Math.min(1, v * 1.4);
      a *= 0.5;
      const qx = 1.6 * px - 1.2 * pz;
      pz = 1.2 * px + 1.6 * pz;
      px = qx;
    }
    relief *= 0.6 + 0.85 * r * smoothstep(0.06, 0.5, relief);
    bw = bw || this.biomeWeights(x, z);
    const amp = 520 + bw.highland * 380 + bw.taiga * 450 + bw.saltflat * 200 + bw.forest * 150 - bw.prairie * 150 - bw.dunes * 260;
    // where the belt thins out the range sinks into the plain instead of shrinking: only its
    // crests and spurs stand out (a ragged edge of outcrops, not a smooth dome or a lone cone),
    // full height in its middle. v^2/(v+w) eases the foot into the flat; the last factor takes it
    // to nothing at the belt's very edge
    const kk = k * k * (3 - 2 * k);
    const v = relief * (0.7 + 0.3 * kk) - (1 - kk) * 0.45;
    return v > 0 ? ((v * v) / (v + 0.08)) * amp * Math.min(1, k * 8) : 0;
  }

  // ---------------------------------------------------------------- water
  // Rivers cross the road every few kilometres, meandering across the whole map. In the desert most
  // are dry washes. Returns null or { k, zr (crossing z on the road), w (half width), dry }.
  river(k) {
    if (!this._rivers) this._rivers = new Map();
    if (this._rivers.has(k)) return this._rivers.get(k);
    let res = null;
    if (k > 0) {
      const z = k * RIVER_SPACING + (hash01(this.seed, k, 301) - 0.5) * 1400;
      const b = this._cellCached(Math.floor(z / BIOME_CELL));
      const desert = DESERT.includes(b);
      // keep clear of the homestead and of the ends of biome cells' POI slots is not needed
      const w = desert ? 5 + hash01(this.seed, k, 302) * 4 : 7 + hash01(this.seed, k, 302) * 7;
      res = { k, z0: z, w, dry: desert && hash01(this.seed, k, 303) < 0.75, frozen: SNOWY.includes(b), phase: hash01(this.seed, k, 304) * 100 };
      res.zr = this.riverZ(res, this.roadX(z));
      // the road crossing point: iterate to where the river meets the road line
      for (let i = 0; i < 10; i++) res.zr = this.riverZ(res, this.roadX(res.zr));
      res.level = this.roadY(res.zr) - (res.dry ? 2.2 : 4.2);
    }
    this._rivers.set(k, res);
    return res;
  }

  riverZ(r, x) {
    const n = this.nA;
    return r.z0 + n.noise2(x * 0.0021 + r.phase, 1.3) * 160 + n.noise2(x * 0.0075 + r.phase, 4.1) * 30;
  }

  riversNear(z, range = 2) {
    const k0 = Math.round(z / RIVER_SPACING);
    const out = [];
    for (let k = k0 - range; k <= k0 + range; k++) {
      const r = this.river(k);
      if (r) out.push(r);
    }
    return out;
  }

  // Nearest river at (x, z): distance across it, its water level there and the record.
  riverAt(x, z) {
    let best = null;
    for (const r of this.riversNear(z, 1)) {
      // meanders stay within ~190 m of the river's nominal line
      if (Math.abs(z - r.z0) > 230 + r.w * 2) continue;
      const zc = this.riverZ(r, x);
      const e = 2;
      const slope = (this.riverZ(r, x + e) - this.riverZ(r, x - e)) / (2 * e);
      const d = Math.abs(z - zc) / Math.sqrt(1 + slope * slope);
      if (best && d >= best.d) continue;
      // water level follows the land away from the road, and sits under the bridge near it
      const away = smoothstep(60, 500, Math.abs(x - this.roadX(zc)));
      const far = this.macroHeight(x, zc) - (r.dry ? 2.2 : 3.6);
      best = { d, r, level: lerp(r.level, far, away), zc };
    }
    return best;
  }

  // Lakes beside the road in green and snowy country.
  lake(k) {
    if (!this._lakes) this._lakes = new Map();
    if (this._lakes.has(k)) return this._lakes.get(k);
    let res = null;
    if (k > 1) {
      const z = k * LAKE_CELL + (hash01(this.seed, k, 401) - 0.5) * 600;
      const b = this._cellCached(Math.floor(z / BIOME_CELL));
      const p = { forest: 0.55, taiga: 0.5, tundra: 0.45, prairie: 0.35, highland: 0.15 }[b] || 0;
      if (hash01(this.seed, k, 402) < p) {
        const side = hash01(this.seed, k, 403) < 0.5 ? -1 : 1;
        const rx = 45 + hash01(this.seed, k, 404) * 70;
        const rz = rx * (0.7 + hash01(this.seed, k, 405) * 0.9);
        const off = rx + 35 + hash01(this.seed, k, 406) * 160;
        const cx = this.roadX(z) + side * off;
        res = { k, x: cx, z, rx, rz, rot: hash01(this.seed, k, 407) * Math.PI, frozen: SNOWY.includes(b), phase: hash01(this.seed, k, 408) * 50 };
        res.level = this.macroHeight(cx, z) + this.biomeDetail(b, cx, z) * 0.4 - 1.2;
        // no lake on the flank of a climb (its basin would be a step in the slope), and none the
        // road would swing into
        const g = Math.abs(this.liftAt(cx, z + rz) - this.liftAt(cx, z - rz)) / (2 * rz);
        if (g > 0.02) res = null;
        for (let zz = z - Math.max(rx, rz) * 1.7; res && zz <= z + Math.max(rx, rz) * 1.7; zz += 10) if (this.lakeDist(res, this.roadX(zz), zz) < 1.3) res = null;
      }
    }
    this._lakes.set(k, res);
    return res;
  }

  lakesNear(z, range = 1) {
    const k0 = Math.round(z / LAKE_CELL);
    const out = [];
    for (let k = k0 - range; k <= k0 + range; k++) {
      const l = this.lake(k);
      if (l) out.push(l);
    }
    return out;
  }

  // Normalised elliptical distance from a lake's centre (1 = shoreline), with a wobbly shore.
  lakeDist(l, x, z) {
    const dx = x - l.x,
      dz = z - l.z;
    const c = Math.cos(l.rot),
      s = Math.sin(l.rot);
    const u = (dx * c - dz * s) / l.rx,
      v = (dx * s + dz * c) / l.rz;
    const a = Math.atan2(v, u);
    const wob = 1 + 0.16 * Math.sin(a * 3 + l.phase) + 0.08 * Math.sin(a * 7 + l.phase * 2);
    return Math.hypot(u, v) / wob;
  }

  // Water surface at (x, z) if any: { level, frozen, kind, depth }.
  waterAt(x, z) {
    const rv = this.riverAt(x, z);
    if (rv && !rv.r.dry && rv.d < rv.r.w) return { level: rv.level, frozen: rv.r.frozen, kind: 'river' };
    for (const l of this.lakesNear(z, 1)) if (Math.abs(z - l.z) < Math.max(l.rx, l.rz) * 1.3 && this.lakeDist(l, x, z) < 1) return { level: l.level, frozen: l.frozen, kind: 'lake' };
    return null;
  }

  // Final ground height with road corridor, flattened POI pads, river valleys and lake basins.
  height(x, z) {
    let h = this.baseHeight(x, z);
    // river valley: banks slope down to a bed below the water line
    const rv = this.riverAt(x, z);
    if (rv) {
      const w = rv.r.w,
        bank = 12 + w * 0.6;
      if (rv.d < w + bank) {
        const t = smoothstep(w + bank, w * 0.6, rv.d);
        const bed = rv.level - (rv.r.dry ? 0.6 : 1.8) * (1 - (Math.min(rv.d, w) / w) ** 2) + (rv.d > w ? 0.35 : 0);
        h = lerp(h, Math.min(h, bed), t);
      }
    }
    // lake basins
    for (const l of this.lakesNear(z, 1)) {
      if (Math.abs(z - l.z) > Math.max(l.rx, l.rz) * 1.9 || Math.abs(x - l.x) > Math.max(l.rx, l.rz) * 1.9) continue;
      const d = this.lakeDist(l, x, z);
      if (d < 1.5) {
        const t = smoothstep(1.5, 0.92, d);
        const bed = l.level - 2.8 * Math.max(0, 1 - d * d) + Math.max(0, d - 1) * 2.0 + 0.25;
        h = lerp(h, Math.min(h, bed), t);
      }
    }
    return h;
  }

  // Road deck height over a bridge (the road keeps its own profile across the water).
  roadSurfaceY(x, z) {
    const rv = this.riverAt(x, z);
    if (rv && rv.d < rv.r.w + 12 + rv.r.w * 0.6) return this.roadY(z) - Math.max(0, Math.abs(x - this.roadX(z)) - ROAD.halfWidth) * 0.07;
    return this.height(x, z);
  }

  // Bridge on the road near z, if any: { r, z0, z1 } span along the road.
  bridgeNear(z) {
    for (const r of this.riversNear(z, 1)) {
      const span = r.w + 12 + r.w * 0.6 + 4;
      if (Math.abs(z - r.zr) < span + 200) return { r, z0: r.zr - span, z1: r.zr + span };
    }
    return null;
  }

  baseHeight(x, z) {
    const dx = this.roadDist(x, z);
    const roadY = this.roadY(z);
    const flat = ROAD.halfWidth + ROAD.shoulder;
    // on a POI pad the shoulder stays level and the ditch is filled, so forecourts and wrecks
    // beside the road sit on the ground instead of over a dip
    const pw = this.padWeight(x, z);
    if (dx < flat) return roadY - Math.max(0, dx - ROAD.halfWidth) * 0.07 * (1 - pw);
    const n0 = this.naturalHeight(x, z);
    const nat = n0 + this.padOffset(x, z, n0);
    const diff = nat - roadY;
    const jag = this.nC.noise2(x * 0.05, z * 0.05) * 2.5 + this.nC.noise2(z * 0.011, x * 0.003) * 4;
    const width = 10 + jag + Math.min(60, Math.abs(diff) * 1.6);
    const t = Math.max(smoothstep(flat + Math.max(0, jag * 0.3), flat + width, dx), pw * smoothstep(flat, flat + 2.5, dx));
    const edge = roadY - ROAD.shoulder * 0.07 * (1 - pw) - 0.25 * smoothstep(flat, flat + 3, dx) * (1 - t) * (1 - pw);
    let h = lerp(edge, nat, t);
    // a dirt track cuts its own narrow bed through the land; the highway's corridor wins
    const tn = this.trackNear(x, z);
    if (tn && tn.d < 45) {
      const ty = this.trackY(tn.tr, z);
      const tf = TRACK.halfWidth + TRACK.shoulder;
      const tw = 5 + Math.min(30, Math.abs(h - ty) * 1.3);
      const tt = smoothstep(tf, tf + tw, tn.d);
      const keep = smoothstep(flat + 0.3, flat + 6, dx);
      const tedge = ty - Math.max(0, tn.d - TRACK.halfWidth) * 0.08;
      h = lerp(h, tedge, (1 - tt) * keep);
    }
    return h;
  }

  // ---------------------------------------------------------------- POI planning
  // Points of interest sit in slots along the road. Each slot is deterministic from the seed.
  poiSlot(k) {
    // the cached path is kept free of closures (a closure would cost an allocation per call,
    // and the height function asks for slots constantly)
    const c = this._poi && this._poi.get(k);
    return c !== undefined ? c : this.makePoiSlot(k);
  }

  makePoiSlot(k) {
    if (!this._poi) this._poi = new Map();
    if (this._poi.has(k)) return this._poi.get(k);
    let res = null;
    const r = (i) => hash01(this.seed, k, 501 + i);
    if (k === 0) {
      const z = 18;
      res = { k, type: 'homestead', side: 1, z, offset: 26 };
    } else if (k > 0 && r(0) < 0.92) {
      const z = k * POI_SPACING + (r(1) - 0.5) * POI_SPACING * 0.5;
      const biome = this._cellCached(Math.floor(z / BIOME_CELL));
      const table = POI_TABLE[biome] || POI_TABLE.scrub;
      let tot = 0;
      for (const [, w] of table) tot += w;
      let pick = r(2) * tot;
      let type = table[0][0];
      for (const [t, w] of table) {
        pick -= w;
        if (pick <= 0) {
          type = t;
          break;
        }
      }
      // avoid repeating recent types; guarantee fuel every few slots
      const recent = [this.poiSlot(k - 1), this.poiSlot(k - 2)].filter(Boolean).map((p) => p.type);
      let tries = 0;
      while (recent.includes(type) && tries < 8) {
        let pk = hash01(this.seed, k, 600 + tries) * tot;
        for (const [t, w] of table) {
          pk -= w;
          if (pk <= 0) {
            type = t;
            break;
          }
        }
        tries++;
      }
      let sinceFuel = 0;
      for (let j = k - 1; j >= Math.max(0, k - 6); j--) {
        const pj = this.poiSlot(j);
        if (pj && pj.type === 'gasStation') break;
        sinceFuel++;
      }
      if (sinceFuel >= 5 && type !== 'gasStation') type = 'gasStation';
      const side = r(3) < 0.5 ? -1 : 1;
      const info = POI_INFO[type];
      res = { k, type, side, z, offset: info.offset[0] + r(4) * (info.offset[1] - info.offset[0]), biome };
    }
    if (res) {
      const info = POI_INFO[res.type];
      res.padR = info.pad;
      res.padBlend = 22;
      res.seed = Math.floor(r(9) * 1e9);
      // keep the pad out of river valleys and lake basins: slide it along the road, or try the
      // other side, and give the slot up if neither works
      const along = res.z;
      let placed = false;
      for (const shift of k === 0 ? [0] : [0, 40, -40, 80, -80, 130, -130, 190, -190]) {
        for (const side of [res.side, -res.side]) {
          this.placePoi(res, along + shift, side);
          if (k === 0 || (this.poiClear(res.x, res.z, res.padR + res.padBlend * 0.6) && this.poiOnRoad(res, along + shift))) {
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed) res = null;
    }
    this._poi.set(k, res);
    return res;
  }

  // The place sits beside a stretch of road it can stand on: not on a steep climb, and with the
  // road not bending back into its yard.
  poiOnRoad(res, along) {
    if (Math.abs(this.roadY(along + 25) - this.roadY(along - 25)) / 50 > 0.055) return false;
    const R = res.padR + res.padBlend * 0.6;
    const need = Math.min(res.offset, R) * 0.85;
    for (let dz = -R - 70; dz <= R + 70; dz += 6) {
      const zz = along + dz;
      if (Math.hypot(res.x - this.roadX(zz), res.z - zz) < need) return false;
    }
    return true;
  }

  placePoi(res, along, side) {
    const [dx, dz] = this.roadDir(along);
    // perpendicular (pointing to +x side of the road for side=+1)
    const px = dz,
      pz = -dx;
    res.side = side;
    res.x = this.roadX(along) + px * res.offset * side;
    res.z = along + pz * res.offset * side;
    // face the road
    res.rot = Math.atan2(-px * side, -pz * side);
    res.y = this.roadY(res.z) + 0.1;
  }

  // No river bank or lake basin within R metres of (x, z).
  poiClear(x, z, R) {
    // keep pads off the side tracks
    for (let dz = -R - 20; dz <= R + 20; dz += 10) {
      const tr = this.trackAt(z + dz);
      if (tr && Math.abs(x - this.trackX(tr, z + dz)) < R + 14) return false;
    }
    const rv = this.riverAt(x, z);
    if (rv && rv.d < rv.r.w + 12 + rv.r.w * 0.6 + R) return false;
    for (const l of this.lakesNear(z, 1)) {
      if (Math.abs(z - l.z) > Math.max(l.rx, l.rz) * 2 + R || Math.abs(x - l.x) > Math.max(l.rx, l.rz) * 2 + R) continue;
      // basin edge at normalised distance 1.5; convert the margin to metres with the short radius
      if ((this.lakeDist(l, x, z) - 1.5) * Math.min(l.rx, l.rz) < R) return false;
    }
    return true;
  }

  poisNear(z, range = 1) {
    const k0 = Math.round(z / POI_SPACING);
    const out = [];
    for (let k = k0 - range; k <= k0 + range; k++) {
      const p = this.poiSlot(k);
      if (p) out.push(p);
    }
    return out;
  }

  // 1 on a POI's level pad, fading to 0 across its blend ring.
  padWeight(x, z) {
    const k0 = Math.round(z / POI_SPACING);
    let w = 0;
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const p = this.poiSlot(k);
      if (!p) continue;
      const dx = x - p.x,
        dz = z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < p.padR + p.padBlend) w = Math.max(w, 1 - smoothstep(p.padR, p.padR + p.padBlend, d));
    }
    return w;
  }

  padOffset(x, z, nat) {
    const k0 = Math.round(z / POI_SPACING);
    let off = 0;
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const p = this.poiSlot(k);
      if (!p) continue;
      const dx = x - p.x,
        dz = z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < p.padR + p.padBlend) {
        const t = 1 - smoothstep(p.padR, p.padR + p.padBlend, d);
        off += (p.y - nat) * t;
        nat += (p.y - nat) * t;
      }
    }
    return off;
  }

  normal(x, z, e = 0.5) {
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    return [-hx / l, (2 * e) / l, -hz / l];
  }

  // Ground material weights: [sand, dirt, rock, salt, grass, snow, forest floor, gravel].
  groundMaterial(x, z, nrmY, bw) {
    bw = bw || this.biomeWeights(x, z);
    const slope = 1 - nrmY;
    const n = this.nC.noise2(x * 0.02, z * 0.02) * 0.5 + 0.5;
    const n2 = this.nB.noise2(x * 0.045 + 3, z * 0.045) * 0.5 + 0.5;
    let sand = bw.dunes + bw.scrub * 0.25 + bw.badlands * 0.1;
    let dirt = bw.scrub * 0.75 + bw.badlands * 0.55 + bw.highland * 0.45 + bw.prairie * 0.12 + bw.forest * 0.15;
    let rock = bw.highland * 0.55 + bw.badlands * 0.35 + bw.taiga * 0.05;
    let salt = bw.saltflat;
    let grass = bw.prairie * 0.9 + bw.forest * 0.3 + bw.tundra * 0.18 * n2 + bw.highland * 0.05;
    let snow = bw.taiga * 0.9 + bw.tundra * (0.85 - 0.25 * n2);
    let forest = bw.forest * 0.65 + bw.taiga * 0.12;
    // desert pavement: patches of packed gravel on the flats, sharp-edged and irregular
    const pv = this.nA.noise2(x * 0.019 + 7, z * 0.019 - 3) + this.nB.noise2(x * 0.07, z * 0.07) * 0.3;
    const dryland = bw.scrub + bw.badlands + bw.highland + bw.saltflat * 0.3;
    let gravel = smoothstep(0.3, 0.55, pv) * dryland * 1.2;
    // and a sandy fringe where wind piles it in the low spots
    sand += smoothstep(-0.1, -0.5, pv) * (bw.scrub + bw.highland * 0.5) * 0.25;
    sand *= 0.7 + 0.6 * n;
    dirt *= 1.3 - 0.6 * n;
    grass *= 0.75 + 0.5 * n2;
    forest *= 0.7 + 0.6 * (1 - n2);
    // bare rock shows on steep ground, but sand dunes stay sand and green country turns to
    // earth first and only to rock on real cliffs
    const green = bw.prairie + bw.forest + bw.taiga + bw.tundra;
    const steep = smoothstep(0.05, 0.2, slope) * (1 - bw.dunes * 0.92);
    // scree: loose gravel collects on the moderate slopes below the cliffs
    gravel += smoothstep(0.03, 0.1, slope) * (1 - smoothstep(0.18, 0.3, slope)) * (1 - green) * (1 - bw.dunes) * 1.4;
    gravel *= 1 - smoothstep(0.2, 0.35, slope);
    rock += steep * 3 * (1 - green * 0.75) + smoothstep(0.3, 0.5, slope) * 2 * green;
    dirt += steep * 1.6 * green;
    salt *= 1 - smoothstep(0.015, 0.06, slope);
    // mountains: bare rock high up, snow on the tops (lower in the north)
    const mh = this.mountain(x, z, bw);
    if (mh > 40) {
      const desert = bw.dunes + bw.scrub + bw.badlands + bw.saltflat + bw.highland;
      // desert ranges are bare rock; green ones are wooded to the tree line
      rock += smoothstep(120, 300, mh) * desert * 2.5 + smoothstep(330, 520, mh) * green * 2.2;
      forest += smoothstep(60, 180, mh) * (bw.forest + bw.taiga) * (1 - smoothstep(330, 480, mh)) * 1.4;
      grass *= 1 - smoothstep(260, 460, mh) * 0.85;
      forest *= 1 - smoothstep(380, 520, mh);
      const line = 420 + desert * 160 - (bw.taiga + bw.tundra) * 200;
      snow += smoothstep(line - 30, line + 70, mh + n * 40) * 4;
    }
    // snow slides off steep rock; grass thins on slopes
    snow *= 1 - smoothstep(0.3, 0.6, slope) * 0.8;
    grass *= 1 - smoothstep(0.12, 0.3, slope) * 0.8;
    // wet shores: sand and mud at rivers and lakes
    const rv = this.riverAt(x, z);
    if (rv && rv.d < rv.r.w + 10) {
      const t = smoothstep(rv.r.w + 10, rv.r.w, rv.d);
      sand += t * (rv.r.dry ? 2 : 1.2) * (1 - green * 0.85);
      dirt += t * (0.8 + green * 0.9);
      grass *= 1 - t * 0.6;
      snow *= 1 - t * (rv.r.frozen ? 0.2 : 0.8);
    }
    if (rv && rv.d < rv.r.w + 10) gravel *= smoothstep(rv.r.w, rv.r.w + 10, rv.d);
    const s = sand + dirt + rock + salt + grass + snow + forest + gravel + 1e-6;
    return [sand / s, dirt / s, rock / s, salt / s, grass / s, snow / s, forest / s, gravel / s];
  }

  // Surface type for tyres / footsteps.
  surfaceAt(x, z) {
    const rx = this.roadX(z);
    const dx = Math.abs(x - rx);
    if (dx < ROAD.halfWidth) {
      const ri = this.roadInfo(z);
      if (ri.snow > 0.55) return 'snowRoad';
      return ri.dirt ? 'gravel' : 'asphalt';
    }
    if (dx < ROAD.halfWidth + ROAD.shoulder) return this.roadInfo(z).snow > 0.5 ? 'snow' : 'gravel';
    const tn = this.trackNear(x, z);
    if (tn && tn.d < TRACK.halfWidth + 0.4) return this.roadInfo(z).snow > 0.5 ? 'snowRoad' : 'dirt';
    const bw = this.biomeWeights(x, z);
    const n = this.normal(x, z, 1.0);
    const m = this.groundMaterial(x, z, n[1], bw);
    const best = m.indexOf(Math.max(...m));
    return ['sand', 'dirt', 'rock', 'salt', 'grass', 'snow', 'dirt', 'gravel'][best];
  }
}
