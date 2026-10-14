// Deterministic world description: road centre line and profile, biomes, terrain height and
// ground materials. Pure functions (no THREE), safe to run inside a worker.

import { SimplexNoise, hash01, clamp, smoothstep, lerp } from '../core/noise.js';

export const BIOMES = ['scrub', 'dunes', 'badlands', 'saltflat', 'highland'];
export const BIOME_INFO = {
  scrub: { name: 'Sagebrush steppe', ground: [0.56, 0.47, 0.36] },
  dunes: { name: 'Dune sea', ground: [0.8, 0.64, 0.44] },
  badlands: { name: 'Red badlands', ground: [0.66, 0.38, 0.24] },
  saltflat: { name: 'Salt flats', ground: [0.86, 0.84, 0.8] },
  highland: { name: 'Stone highlands', ground: [0.5, 0.47, 0.43] },
};

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
    if (k <= 0) return 'scrub';
    // avoid repeating the previous cell's biome
    const prev = this.biomeOfCell(k - 1);
    let b;
    let tries = 0;
    do {
      b = BIOMES[Math.floor(hash01(this.seed, k, 91 + tries) * BIOMES.length)];
      tries++;
    } while (b === prev && tries < 6);
    return b;
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
    const dirt = seg > 2 && h < (biome === 'badlands' || biome === 'highland' ? 0.16 : 0.06);
    const wear = clamp(0.25 + 0.6 * hash01(this.seed, seg, 23) + 0.15 * this.nA.noise2(z * 0.01, 1.7), 0, 1);
    return { dirt, wear };
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
    return this.macroHeight(x, z) + d;
  }

  // Final ground height with road corridor and flattened POI pads.
  height(x, z) {
    const rx = this.roadX(z);
    const dx = Math.abs(x - rx);
    const roadY = this.roadY(z);
    const flat = ROAD.halfWidth + ROAD.shoulder;
    if (dx < flat) return roadY - Math.max(0, dx - ROAD.halfWidth) * 0.07;
    const n0 = this.naturalHeight(x, z);
    const nat = n0 + this.padOffset(x, z, n0);
    const diff = nat - roadY;
    const jag = this.nC.noise2(x * 0.05, z * 0.05) * 2.5 + this.nC.noise2(z * 0.011, x * 0.003) * 4;
    const width = 10 + jag + Math.min(60, Math.abs(diff) * 1.6);
    const t = smoothstep(flat + Math.max(0, jag * 0.3), flat + width, dx);
    const edge = roadY - ROAD.shoulder * 0.07 - 0.25 * smoothstep(flat, flat + 3, dx) * (1 - t);
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
      const [dx, dz] = this.roadDir(res.z);
      // perpendicular (pointing to +x side of the road for side=+1)
      const px = dz,
        pz = -dx;
      res.x = this.roadX(res.z) + px * res.offset * res.side;
      res.z = res.z + pz * res.offset * res.side;
      // face the road
      res.rot = Math.atan2(-px * res.side, -pz * res.side);
      res.padR = info.pad;
      res.padBlend = 22;
      res.y = this.roadY(res.z) + 0.1;
      res.seed = Math.floor(r(9) * 1e9);
    }
    this._poi.set(k, res);
    return res;
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

  // Ground material weights: [sand, dirt, rock, salt] and road/shoulder masks.
  groundMaterial(x, z, nrmY, bw) {
    bw = bw || this.biomeWeights(x, z);
    const slope = 1 - nrmY;
    let sand = bw.dunes + bw.scrub * 0.25 + bw.badlands * 0.1;
    let dirt = bw.scrub * 0.75 + bw.badlands * 0.55 + bw.highland * 0.45;
    let rock = bw.highland * 0.55 + bw.badlands * 0.35;
    let salt = bw.saltflat;
    const n = this.nC.noise2(x * 0.02, z * 0.02) * 0.5 + 0.5;
    sand *= 0.7 + 0.6 * n;
    dirt *= 1.3 - 0.6 * n;
    rock += smoothstep(0.05, 0.2, slope) * 3;
    salt *= 1 - smoothstep(0.015, 0.06, slope);
    const s = sand + dirt + rock + salt + 1e-6;
    return [sand / s, dirt / s, rock / s, salt / s];
  }

  // Surface type for tyres / footsteps.
  surfaceAt(x, z) {
    const rx = this.roadX(z);
    const dx = Math.abs(x - rx);
    if (dx < ROAD.halfWidth) return this.roadInfo(z).dirt ? 'gravel' : 'asphalt';
    if (dx < ROAD.halfWidth + ROAD.shoulder) return 'gravel';
    const bw = this.biomeWeights(x, z);
    const n = this.normal(x, z, 1.0);
    const m = this.groundMaterial(x, z, n[1], bw);
    const best = m.indexOf(Math.max(...m));
    return ['sand', 'dirt', 'rock', 'salt'][best];
  }
}
