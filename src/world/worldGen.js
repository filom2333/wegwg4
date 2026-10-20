// Deterministic world description: road centre line and profile, biomes, terrain height and
// ground materials. Pure functions (no THREE), safe to run inside a worker.

import { SimplexNoise, hash01, clamp, smoothstep, lerp } from '../core/noise.js';

export const BIOMES = ['scrub', 'dunes', 'badlands', 'saltflat', 'highland', 'prairie', 'forest', 'taiga', 'tundra'];
export const BIOME_INFO = {
  scrub: { name: 'Sagebrush steppe', ground: [0.56, 0.47, 0.36] },
  dunes: { name: 'Dune sea', ground: [0.8, 0.64, 0.44] },
  badlands: { name: 'Red badlands', ground: [0.66, 0.38, 0.24] },
  saltflat: { name: 'Salt flats', ground: [0.86, 0.84, 0.8] },
  highland: { name: 'Stone highlands', ground: [0.5, 0.47, 0.43] },
  prairie: { name: 'Grass prairie', ground: [0.52, 0.53, 0.36] },
  forest: { name: 'Pine forest', ground: [0.42, 0.42, 0.32] },
  taiga: { name: 'Snowy taiga', ground: [0.86, 0.88, 0.92] },
  tundra: { name: 'Frozen tundra', ground: [0.84, 0.86, 0.9] },
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
const BIOME_CELL = 2600;
export const POI_SPACING = 620;

export const POI_INFO = {
  homestead: { offset: [24, 28], pad: 26 },
  gasStation: { offset: [22, 26], pad: 30 },
  motel: { offset: [26, 34], pad: 32 },
  diner: { offset: [20, 26], pad: 22 },
  houses: { offset: [30, 46], pad: 38 },
  house: { offset: [22, 40], pad: 18 },
  ranch: { offset: [40, 60], pad: 34 },
  waterTower: { offset: [18, 30], pad: 12 },
  radioTower: { offset: [30, 60], pad: 14 },
  junkyard: { offset: [24, 36], pad: 26 },
  trailers: { offset: [24, 40], pad: 28 },
  outpost: { offset: [30, 50], pad: 26 },
  ruins: { offset: [18, 40], pad: 16 },
  camp: { offset: [16, 30], pad: 12 },
  wreck: { offset: [6, 9], pad: 6 },
  farm: { offset: [34, 52], pad: 36 },
  cabin: { offset: [22, 36], pad: 16 },
  church: { offset: [22, 34], pad: 22 },
  sawmill: { offset: [28, 44], pad: 30 },
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
  roadX(z) {
    const n = this.nA;
    let x = n.noise2(z * 0.00032, 7.1) * 240 + n.noise2(z * 0.001, 3.3) * 55 + n.noise2(z * 0.0028, 9.9) * 7;
    // keep the start area straight-ish
    const s = smoothstep(150, 900, Math.abs(z));
    return x * s;
  }

  roadDir(z) {
    const e = 1;
    const dx = this.roadX(z + e) - this.roadX(z - e);
    const l = Math.hypot(dx, 2 * e);
    return [dx / l, (2 * e) / l];
  }

  macroHeight(x, z) {
    const n = this.nB;
    return n.noise2(x * 0.00045, z * 0.00045) * 26 + n.noise2(x * 0.0012 + 31, z * 0.0012) * 7;
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
  biomeDetail(b, x, z) {
    const n = this.nB,
      m = this.nC;
    switch (b) {
      case 'dunes': {
        // transverse dunes elongated across the prevailing wind (+x), with a sharper lee side
        const u = x * 0.0075 + m.noise2(x * 0.002, z * 0.002) * 1.5;
        const v = z * 0.0042;
        const r = n.noise2(u, v);
        const dune = Math.pow(Math.max(0, 1 - Math.abs(r)), 2.2) * 11 + n.noise2(x * 0.02, z * 0.02) * 0.8;
        return dune + 2 * n.noise2(x * 0.0015, z * 0.0015);
      }
      case 'badlands': {
        const mm = n.noise2(x * 0.0021 + 11, z * 0.0021 - 4) + 0.35 * n.noise2(x * 0.006, z * 0.006);
        let h = smoothstep(0.25, 0.42, mm) * 32;
        // terraces
        const step = 5.5;
        const tq = Math.floor(h / step);
        const fr = h / step - tq;
        h = (tq + smoothstep(0.55, 1.0, fr)) * step;
        const gully = Math.abs(n.noise2(x * 0.01, z * 0.01)) * 2.2;
        return h + 3 * n.noise2(x * 0.004, z * 0.004) - gully;
      }
      case 'saltflat':
        return n.noise2(x * 0.003, z * 0.003) * 0.35;
      case 'highland': {
        const r = 1 - Math.abs(n.noise2(x * 0.0035, z * 0.0035));
        const r2 = 1 - Math.abs(n.noise2(x * 0.009 + 5, z * 0.009));
        return r * r * 26 + r2 * r2 * 7 + n.noise2(x * 0.03, z * 0.03) * 0.6 - 10;
      }
      case 'prairie':
        // long gentle swells
        return n.noise2(x * 0.0024 + 7, z * 0.0024) * 7 + n.noise2(x * 0.008, z * 0.008 + 3) * 1.6 + n.noise2(x * 0.04, z * 0.04) * 0.15;
      case 'forest': {
        // wooded hills with soft ridges
        const r = 1 - Math.abs(n.noise2(x * 0.004 + 3, z * 0.004 - 2));
        return r * r * 16 + n.noise2(x * 0.012, z * 0.012) * 3 + n.noise2(x * 0.05, z * 0.05) * 0.3 - 6;
      }
      case 'taiga': {
        // mountains that rise away from the road valley
        const away = smoothstep(40, 380, Math.abs(x - this.roadX(z)));
        const r = 1 - Math.abs(n.noise2(x * 0.0022 - 9, z * 0.0022 + 4));
        const r2 = 1 - Math.abs(n.noise2(x * 0.0068, z * 0.0068 + 8));
        return (r * r * 46 + r2 * r2 * 10) * (0.25 + 0.75 * away) + n.noise2(x * 0.02, z * 0.02) * 0.8 - 8;
      }
      case 'tundra': {
        // open, gently rolling, with frost hummocks
        const hum = Math.max(0, n.noise2(x * 0.09, z * 0.09)) * 0.45;
        return n.noise2(x * 0.003 + 1, z * 0.003) * 4 + n.noise2(x * 0.011, z * 0.011) * 1.1 + hum;
      }
      default: {
        // scrub: rolling hills
        return n.noise2(x * 0.004, z * 0.004) * 5 + n.noise2(x * 0.011, z * 0.011) * 1.6 + n.noise2(x * 0.05, z * 0.05) * 0.25;
      }
    }
  }

  // Returns natural (unroaded) ground height.
  naturalHeight(x, z, bw) {
    bw = bw || this.biomeWeights(x, z, this._bw || (this._bw = {}));
    let d = 0;
    for (const b of BIOMES) if (bw[b] > 0.001) d += bw[b] * this.biomeDetail(b, x, z);
    return this.macroHeight(x, z) + d + this.mountain(x, z, bw);
  }

  // Mountain ranges standing back from the road: ridged peaks a few hundred metres high that
  // come and go along the way, now and then crowding in so the road runs up a valley between
  // them. Rivers cut their own valleys through.
  mountain(x, z, bw) {
    const dx = Math.abs(x - this.roadX(z));
    const n = this.nA;
    const close = smoothstep(0.3, 0.85, n.noise2(z * 0.00027 + 17, 3.3) * 0.5 + 0.5);
    const start = 950 - 680 * close;
    if (dx < start) return 0;
    // ranges: broad belts of high country, with gaps between them
    const range = smoothstep(-0.5, 0.15, n.noise2(x * 0.00017 + 5, z * 0.00017 - 9) + 0.3 * close);
    if (range <= 0) return 0;
    let mask = smoothstep(start, start + 1000, dx) * range;
    for (const rv of this.riversNear(z, 1)) {
      if (Math.abs(z - rv.z0) > 1200) continue;
      mask *= smoothstep(rv.w + 40, rv.w + 520, Math.abs(z - this.riverZ(rv, x)));
    }
    if (mask <= 0.001) return 0;
    // broad massifs carry the height; ridged noise on them makes crests, spurs and gullies (the
    // coordinates are warped so the ridges wander instead of lining up)
    const wx = x + n.noise2(x * 0.0004 + 41, z * 0.0004) * 420,
      wz = z + n.noise2(x * 0.0004, z * 0.0004 - 23) * 420;
    const mass = smoothstep(-0.65, 0.45, n.noise2(wx * 0.00021 + 3, wz * 0.00021 - 1));
    let f = 0.0007,
      a = 1,
      sum = 0,
      w = 1;
    for (let o = 0; o < 5; o++) {
      let r = 1 - Math.abs(n.noise2(wx * f + o * 13.1, wz * f - o * 7.7));
      r = r * r * w;
      w = Math.min(1, r * 1.6);
      sum += r * a;
      f *= 2.07;
      a *= 0.47;
    }
    bw = bw || this.biomeWeights(x, z);
    const amp = bw.scrub * 620 + bw.dunes * 480 + bw.badlands * 650 + bw.saltflat * 780 + bw.highland * 950 + bw.prairie * 420 + bw.forest * 720 + bw.taiga * 1050 + bw.tundra * 560;
    return mass * (0.3 + 0.7 * mass) * (0.3 + 0.7 * (sum / 1.5)) * amp * 1.35 * mask;
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
    const rx = this.roadX(z);
    const dx = Math.abs(x - rx);
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
    return lerp(edge, nat, t);
  }

  // ---------------------------------------------------------------- POI planning
  // Points of interest sit in slots along the road. Each slot is deterministic from the seed.
  poiSlot(k) {
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
          if (k === 0 || this.poiClear(res.x, res.z, res.padR + res.padBlend * 0.6)) {
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
      const d = Math.hypot(x - p.x, z - p.z);
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
      const d = Math.hypot(x - p.x, z - p.z);
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

  // Ground material weights: [sand, dirt, rock, salt, grass, snow, forest floor].
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
    sand *= 0.7 + 0.6 * n;
    dirt *= 1.3 - 0.6 * n;
    grass *= 0.75 + 0.5 * n2;
    forest *= 0.7 + 0.6 * (1 - n2);
    // bare rock shows on steep ground, but sand dunes stay sand and green country turns to
    // earth first and only to rock on real cliffs
    const green = bw.prairie + bw.forest + bw.taiga + bw.tundra;
    const steep = smoothstep(0.05, 0.2, slope) * (1 - bw.dunes * 0.92);
    rock += steep * 3 * (1 - green * 0.75) + smoothstep(0.3, 0.5, slope) * 2 * green;
    dirt += steep * 1.6 * green;
    salt *= 1 - smoothstep(0.015, 0.06, slope);
    // mountains: bare rock high up, snow on the tops (lower in the north)
    const mh = this.mountain(x, z, bw);
    if (mh > 40) {
      const desert = bw.dunes + bw.scrub + bw.badlands + bw.saltflat;
      rock += smoothstep(120, 300, mh) * (1.5 + desert);
      grass *= 1 - smoothstep(180, 380, mh) * 0.85;
      forest *= 1 - smoothstep(250, 450, mh);
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
    const s = sand + dirt + rock + salt + grass + snow + forest + 1e-6;
    return [sand / s, dirt / s, rock / s, salt / s, grass / s, snow / s, forest / s];
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
    const bw = this.biomeWeights(x, z);
    const n = this.normal(x, z, 1.0);
    const m = this.groundMaterial(x, z, n[1], bw);
    const best = m.indexOf(Math.max(...m));
    return ['sand', 'dirt', 'rock', 'salt', 'grass', 'snow', 'dirt'][best];
  }
}
