// Procedural architectural materials (canvas textures with world-metre UVs) shared by all
// buildings and props. Every texture maps 1 UV unit = 1 metre unless noted.

import * as THREE from 'three';
import { makeCanvas, canvasTexture, cached, normalFromHeight } from '../../gfx/textures.js';
import { mulberry32, SimplexNoise } from '../../core/noise.js';
import { applyWeathering, weatheringUniforms } from '../../vehicle/carMaterials.js';

const PX = 256; // pixels per texture

function noiseFill(ctx, w, h, seed, _tint, amp, scale = 0.02) {
  // modulates the existing pixels' brightness with tileable fbm noise
  const n = new SimplexNoise(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const f = (xx, yy) => n.fbm2(xx * scale * w, yy * scale * h, 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const u = x / w,
        v = y / h;
      const t = (f(u, v) * (1 - u) + f(u - 1, v) * u) * (1 - v) + (f(u, v - 1) * (1 - u) + f(u - 1, v - 1) * u) * v;
      const k = 1 + t * amp;
      img.data[i] = Math.min(255, img.data[i] * k);
      img.data[i + 1] = Math.min(255, img.data[i + 1] * k);
      img.data[i + 2] = Math.min(255, img.data[i + 2] * k);
    }
  ctx.putImageData(img, 0, 0);
}

function heightFromColor(c) {
  const h = makeCanvas(c.width, c.height);
  const x = h.getContext('2d');
  x.filter = 'grayscale(1)';
  x.drawImage(c, 0, 0);
  return h;
}

// Builds {map, normalMap} from a painter callback drawing on a canvas.
function texPair(key, metres, painter, { normal = 2, rough = null } = {}) {
  return cached('arch:' + key, () => {
    const c = makeCanvas(PX, PX);
    const ctx = c.getContext('2d');
    const hc = makeCanvas(PX, PX);
    const hctx = hc.getContext('2d');
    painter(ctx, hctx, PX);
    const map = canvasTexture(c, { repeat: [1 / metres, 1 / metres] });
    const nrm = canvasTexture(normalFromHeight(hc, normal, true), { srgb: false, repeat: [1 / metres, 1 / metres] });
    return { map, normalMap: nrm, metres };
  });
}

const P = {
  stucco: (ctx, hctx, S) => {
    ctx.fillStyle = '#c9b597';
    ctx.fillRect(0, 0, S, S);
    noiseFill(ctx, S, S, 11, [205, 186, 155], 0.18, 0.06);
    hctx.fillStyle = '#808080';
    hctx.fillRect(0, 0, S, S);
    const r = mulberry32(3);
    for (let i = 0; i < 2600; i++) {
      const v = 100 + r() * 90;
      hctx.fillStyle = `rgb(${v},${v},${v})`;
      hctx.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
    }
  },
  plaster: (ctx, hctx, S) => {
    ctx.fillStyle = '#d9d2c3';
    ctx.fillRect(0, 0, S, S);
    noiseFill(ctx, S, S, 21, [224, 216, 200], 0.08, 0.03);
    hctx.fillStyle = '#808080';
    hctx.fillRect(0, 0, S, S);
  },
  siding: (ctx, hctx, S) => {
    // horizontal lap siding, 0.2 m boards (texture = 2 m)
    const boards = 10;
    for (let i = 0; i < boards; i++) {
      const y = (i * S) / boards;
      const g = ctx.createLinearGradient(0, y, 0, y + S / boards);
      g.addColorStop(0, '#d8d2c4');
      g.addColorStop(0.85, '#c8c1b1');
      g.addColorStop(1, '#8f897c');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, S, S / boards);
      const hg = hctx.createLinearGradient(0, y, 0, y + S / boards);
      hg.addColorStop(0, '#606060');
      hg.addColorStop(0.9, '#b0b0b0');
      hg.addColorStop(1, '#303030');
      hctx.fillStyle = hg;
      hctx.fillRect(0, y, S, S / boards);
    }
    noiseFill(ctx, S, S, 31, [235, 228, 214], 0.12, 0.05);
  },
  planks: (ctx, hctx, S) => {
    // weathered vertical barn planks 0.18 m
    const r = mulberry32(5);
    const n = 11;
    for (let i = 0; i < n; i++) {
      const x = (i * S) / n;
      const v = 120 + r() * 50;
      ctx.fillStyle = `rgb(${v},${v * 0.82},${v * 0.66})`;
      ctx.fillRect(x, 0, S / n, S);
      for (let k = 0; k < 40; k++) {
        ctx.strokeStyle = `rgba(60,40,25,${0.08 + r() * 0.12})`;
        ctx.beginPath();
        const xx = x + r() * (S / n);
        ctx.moveTo(xx, 0);
        ctx.bezierCurveTo(xx + r() * 4 - 2, S * 0.3, xx + r() * 4 - 2, S * 0.6, xx + r() * 4 - 2, S);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(25,18,12,0.85)';
      ctx.fillRect(x, 0, 2, S);
      hctx.fillStyle = '#a0a0a0';
      hctx.fillRect(x, 0, S / n, S);
      hctx.fillStyle = '#202020';
      hctx.fillRect(x, 0, 2, S);
    }
  },
  floorboards: (ctx, hctx, S) => {
    const r = mulberry32(9);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const y = (i * S) / n;
      let x = -r() * S;
      while (x < S) {
        const len = S * (0.4 + r() * 0.6);
        const v = 120 + r() * 45;
        ctx.fillStyle = `rgb(${v},${v * 0.74},${v * 0.52})`;
        ctx.fillRect(x, y, len, S / n);
        ctx.fillStyle = 'rgba(30,20,10,0.6)';
        ctx.fillRect(x, y, 1.5, S / n);
        x += len;
      }
      ctx.fillStyle = 'rgba(30,20,10,0.7)';
      ctx.fillRect(0, y, S, 1.5);
      hctx.fillStyle = '#a0a0a0';
      hctx.fillRect(0, y, S, S / n);
      hctx.fillStyle = '#303030';
      hctx.fillRect(0, y, S, 1.5);
    }
    noiseFill(ctx, S, S, 41, [255, 255, 255], 0.12, 0.08);
  },
  linoleum: (ctx, hctx, S) => {
    // checker tiles 0.3 m (texture 1.2 m: 4x4)
    const n = 4;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = (i + j) % 2 ? '#d8d2c2' : '#6f6a60';
        ctx.fillRect((i * S) / n, (j * S) / n, S / n, S / n);
      }
    noiseFill(ctx, S, S, 51, [255, 255, 255], 0.1, 0.05);
    hctx.fillStyle = '#909090';
    hctx.fillRect(0, 0, S, S);
    hctx.fillStyle = '#606060';
    for (let i = 0; i <= n; i++) {
      hctx.fillRect((i * S) / n - 1, 0, 2, S);
      hctx.fillRect(0, (i * S) / n - 1, S, 2);
    }
  },
  tiles: (ctx, hctx, S) => {
    // white bathroom tiles 0.15 m (texture 1.2 m: 8x8)
    const n = 8;
    ctx.fillStyle = '#9a9a92';
    ctx.fillRect(0, 0, S, S);
    hctx.fillStyle = '#404040';
    hctx.fillRect(0, 0, S, S);
    const r = mulberry32(13);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const v = 210 + r() * 25;
        ctx.fillStyle = `rgb(${v},${v},${v - 6})`;
        ctx.fillRect((i * S) / n + 1.5, (j * S) / n + 1.5, S / n - 3, S / n - 3);
        hctx.fillStyle = '#b0b0b0';
        hctx.fillRect((i * S) / n + 1.5, (j * S) / n + 1.5, S / n - 3, S / n - 3);
      }
  },
  wallpaper: (ctx, hctx, S) => {
    ctx.fillStyle = '#b9ae92';
    ctx.fillRect(0, 0, S, S);
    // vertical stripes + small motif (texture 0.8 m)
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(120,96,70,0.18)' : 'rgba(255,255,255,0.08)';
      ctx.fillRect((i * S) / 8, 0, S / 8, S);
    }
    ctx.fillStyle = 'rgba(110,80,60,0.25)';
    for (let j = 0; j < 4; j++)
      for (let i = 0; i < 4; i++) {
        const cx = (i + 0.5) * (S / 4),
          cy = (j + 0.5 + (i % 2) * 0.5) * (S / 4);
        ctx.beginPath();
        ctx.ellipse(cx, cy % S, 5, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    noiseFill(ctx, S, S, 61, [255, 255, 255], 0.14, 0.04);
    hctx.fillStyle = '#808080';
    hctx.fillRect(0, 0, S, S);
  },
  brick: (ctx, hctx, S) => {
    // 0.215 x 0.065 bricks, texture 1.0 m
    ctx.fillStyle = '#7d6a5c';
    ctx.fillRect(0, 0, S, S);
    hctx.fillStyle = '#404040';
    hctx.fillRect(0, 0, S, S);
    const r = mulberry32(17);
    const rows = 13,
      cols = 4.6;
    for (let j = 0; j < rows; j++) {
      const off = j % 2 ? 0.5 : 0;
      for (let i = -1; i < cols + 1; i++) {
        const x = ((i + off) * S) / cols,
          y = (j * S) / rows;
        const v = 120 + r() * 60;
        ctx.fillStyle = `rgb(${v},${v * 0.55},${v * 0.42})`;
        ctx.fillRect(x + 2, y + 2, S / cols - 4, S / rows - 4);
        hctx.fillStyle = '#b0b0b0';
        hctx.fillRect(x + 2, y + 2, S / cols - 4, S / rows - 4);
      }
    }
    noiseFill(ctx, S, S, 71, [255, 255, 255], 0.15, 0.05);
  },
  concrete: (ctx, hctx, S) => {
    ctx.fillStyle = '#9a968e';
    ctx.fillRect(0, 0, S, S);
    noiseFill(ctx, S, S, 81, [168, 164, 156], 0.16, 0.03);
    hctx.fillStyle = '#808080';
    hctx.fillRect(0, 0, S, S);
    const r = mulberry32(19);
    for (let i = 0; i < 900; i++) {
      const v = 80 + r() * 60;
      hctx.fillStyle = `rgb(${v},${v},${v})`;
      hctx.fillRect(r() * S, r() * S, 1.5, 1.5);
    }
  },
  corrugated: (ctx, hctx, S) => {
    // 76 mm pitch corrugation, texture 1 m
    const n = 13;
    for (let i = 0; i < S; i++) {
      const t = 0.5 + 0.5 * Math.sin((i / S) * n * Math.PI * 2);
      const v = 150 + t * 50;
      ctx.fillStyle = `rgb(${v},${v},${v * 0.98})`;
      ctx.fillRect(i, 0, 1, S);
      const h = Math.round(t * 255);
      hctx.fillStyle = `rgb(${h},${h},${h})`;
      hctx.fillRect(i, 0, 1, S);
    }
    noiseFill(ctx, S, S, 91, [255, 255, 255], 0.2, 0.04);
  },
  shingles: (ctx, hctx, S) => {
    // asphalt shingles, texture 1 m: 6 rows
    const r = mulberry32(23);
    const rows = 6;
    ctx.fillStyle = '#4a4440';
    ctx.fillRect(0, 0, S, S);
    for (let j = 0; j < rows; j++) {
      const y = (j * S) / rows;
      const off = (j % 2) * 0.5;
      for (let i = -1; i < 4; i++) {
        const x = ((i + off) * S) / 3;
        const v = 60 + r() * 30;
        ctx.fillStyle = `rgb(${v},${v * 0.93},${v * 0.86})`;
        ctx.fillRect(x + 1, y, S / 3 - 2, S / rows - 2);
        const hg = hctx.createLinearGradient(0, y, 0, y + S / rows);
        hg.addColorStop(0, '#606060');
        hg.addColorStop(1, '#c0c0c0');
        hctx.fillStyle = hg;
        hctx.fillRect(x + 1, y, S / 3 - 2, S / rows - 2);
      }
    }
    // granules
    for (let i = 0; i < 6000; i++) {
      const v = 40 + r() * 70;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(r() * S, r() * S, 1, 1);
    }
  },
  rooftiles: (ctx, hctx, S) => {
    // terracotta barrel tiles, texture 1 m: 4 columns x 3 rows
    for (let i = 0; i < S; i++) {
      const t = 0.5 + 0.5 * Math.cos((i / S) * 4 * Math.PI * 2);
      for (let j = 0; j < 3; j++) {
        const y = (j * S) / 3;
        const g = ctx.createLinearGradient(0, y, 0, y + S / 3);
        g.addColorStop(0, `rgb(${120 + t * 60},${60 + t * 30},${40 + t * 20})`);
        g.addColorStop(1, `rgb(${90 + t * 50},${45 + t * 25},${30 + t * 15})`);
        ctx.fillStyle = g;
        ctx.fillRect(i, y, 1, S / 3);
        const h = Math.round(t * 200);
        hctx.fillStyle = `rgb(${h},${h},${h})`;
        hctx.fillRect(i, y, 1, S / 3);
      }
    }
    noiseFill(ctx, S, S, 101, [255, 255, 255], 0.2, 0.05);
  },
  adobe: (ctx, hctx, S) => {
    ctx.fillStyle = '#a77d5b';
    ctx.fillRect(0, 0, S, S);
    noiseFill(ctx, S, S, 111, [182, 140, 104], 0.22, 0.05);
    hctx.fillStyle = '#808080';
    hctx.fillRect(0, 0, S, S);
    const r = mulberry32(29);
    // faint brick courses
    for (let j = 0; j < 10; j++) {
      ctx.fillStyle = 'rgba(90,60,40,0.2)';
      ctx.fillRect(0, (j * S) / 10, S, 2);
      for (let i = 0; i < 3; i++) ctx.fillRect(((i + (j % 2) * 0.5) * S) / 3, (j * S) / 10, 2, S / 10);
    }
    for (let i = 0; i < 1500; i++) {
      const v = 90 + r() * 80;
      hctx.fillStyle = `rgb(${v},${v},${v})`;
      hctx.fillRect(r() * S, r() * S, 2, 2);
    }
  },
  rug: (ctx, hctx, S) => {
    ctx.fillStyle = '#6e3326';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#d2b48a';
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, S - 28, S - 28);
    ctx.strokeStyle = '#2e3b4e';
    ctx.lineWidth = 4;
    ctx.strokeRect(28, 28, S - 56, S - 56);
    ctx.fillStyle = '#c99a5e';
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.translate(S / 2, S / 2);
      ctx.rotate((i / 5) * Math.PI * 2);
      ctx.fillRect(-6, -60, 12, 50);
      ctx.restore();
    }
    noiseFill(ctx, S, S, 121, [255, 255, 255], 0.2, 0.2);
    hctx.fillStyle = '#808080';
    hctx.fillRect(0, 0, S, S);
  },
  fabric: (ctx, hctx, S) => {
    ctx.fillStyle = '#5d6b55';
    ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 2)
      for (let x = 0; x < S; x += 2) {
        const v = ((x + y) / 2) % 2 ? 1.06 : 0.94;
        ctx.fillStyle = `rgba(${Math.round(93 * v)},${Math.round(107 * v)},${Math.round(85 * v)},1)`;
        ctx.fillRect(x, y, 2, 2);
      }
    noiseFill(ctx, S, S, 131, [255, 255, 255], 0.15, 0.05);
    hctx.fillStyle = '#808080';
    hctx.fillRect(0, 0, S, S);
  },
};

const TEX_METRES = {
  stucco: 2,
  plaster: 2,
  siding: 2,
  planks: 2,
  floorboards: 2,
  linoleum: 1.2,
  tiles: 1.2,
  wallpaper: 0.8,
  brick: 1,
  concrete: 2,
  corrugated: 1,
  shingles: 1,
  rooftiles: 1,
  adobe: 2,
  rug: 1,
  fabric: 0.5,
};

let MATS = null;

// Token mode (inside the POI worker): materials are stand-ins naming what to use, resolved to
// real materials on the main thread by resolveMaterial().
let TOKENS = false;
const tokenCache = {};
const tokenProxy = new Proxy({}, { get: (_, name) => (typeof name === 'string' ? (tokenCache[name] = tokenCache[name] || { __mat: name }) : undefined) });
export function useMaterialTokens(on) {
  TOKENS = on;
}
export function resolveMaterial(t) {
  if (!t || t.isMaterial) return t;
  if (t.__mat) return archMaterials()[t.__mat];
  if (t.__sign) return signMaterial(...t.__sign);
  if (t.__std) return stdMat(t.__std, t.physical);
  return archMaterials().trimWhite;
}

// Plain coloured materials made on the fly by builders, shared by identical parameters.
const stdCache = new Map();
export function stdMat(params, physical = false) {
  if (TOKENS) return { __std: params, physical };
  const key = JSON.stringify(params) + physical;
  let m = stdCache.get(key);
  if (!m) {
    m = physical ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
    stdCache.set(key, m);
  }
  return m;
}

// Small landscape paintings for picture frames (a handful, shared).
function paintingMaterial(i) {
  const c = makeCanvas(64, 48);
  const ctx = c.getContext('2d');
  const r = mulberry32(911 + i * 37);
  const g = ctx.createLinearGradient(0, 0, 0, 48);
  const skies = ['#87a7c4', '#c9a27a', '#9fb7c9', '#d8b48a', '#7f97b0', '#b7c4cf'];
  g.addColorStop(0, skies[i % skies.length]);
  g.addColorStop(0.55, '#e3c79a');
  g.addColorStop(1, '#a87b50');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 48);
  ctx.fillStyle = ['#7a4f35', '#5d6b4a', '#6d5a4a', '#4f5f6f'][i % 4];
  ctx.beginPath();
  ctx.moveTo(0, 30);
  ctx.lineTo(20, 18 + r() * 8);
  ctx.lineTo(40, 26);
  ctx.lineTo(64, 20 + r() * 6);
  ctx.lineTo(64, 48);
  ctx.lineTo(0, 48);
  ctx.fill();
  const tex = canvasTexture(c, { wrap: false });
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
}

export function archMaterials() {
  if (TOKENS) return tokenProxy;
  if (MATS) return MATS;
  const tex = (k, n = 2) => texPair(k, TEX_METRES[k], P[k], { normal: n });
  const wthr = weatheringUniforms({ dirt: 0.5, dust: 0.35, rust: 0, fade: 0.1 });
  // Light reaching an interior ceiling has bounced off walls and floor several times and arrives
  // close to neutral; desaturate the indirect term instead of tinting it with the sand-coloured sky.
  const neutralBounce = (m) => {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
  vec3 ind = reflectedLight.indirectDiffuse;
  float l = dot(ind, vec3(0.3, 0.55, 0.15));
  reflectedLight.indirectDiffuse = mix(vec3(l), ind, 0.2) * 1.25;
}`
      );
    };
    m.customProgramCacheKey = () => 'neutralBounce';
    return m;
  };
  const std = (k, opts = {}, weather = false) => {
    const t = tex(k, opts.normalStrength || 2);
    const m = new THREE.MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      roughness: opts.roughness ?? 0.9,
      metalness: opts.metalness ?? 0,
      color: opts.color ?? 0xffffff,
    });
    m.normalScale.set(opts.ns ?? 0.8, opts.ns ?? 0.8);
    if (weather) applyWeathering(m, wthr, { rustColor: !!opts.rust, strength: opts.weatherStrength ?? 0.6 });
    return m;
  };
  MATS = {
    stucco: std('stucco', { roughness: 0.95 }, true),
    stuccoBlue: std('stucco', { roughness: 0.95, color: 0xa9b8bf }, true),
    stuccoPink: std('stucco', { roughness: 0.95, color: 0xe6c1ac }, true),
    plaster: std('plaster', { roughness: 0.92, ns: 0.3 }),
    // interior ceilings only see light bounced off the floor; the outdoor environment map would
    // paint them with the sand-coloured lower sky, so they take less of it and a cooler base
    ceiling: neutralBounce(std('plaster', { roughness: 0.95, ns: 0.2, color: 0xdcdcdc })),
    plasterGreen: std('plaster', { roughness: 0.92, ns: 0.3, color: 0xb9c2a6 }),
    plasterBlue: std('plaster', { roughness: 0.92, ns: 0.3, color: 0xa9b6c4 }),
    siding: std('siding', { roughness: 0.85 }, true),
    sidingYellow: std('siding', { roughness: 0.85, color: 0xe8d9a6 }, true),
    sidingGreen: std('siding', { roughness: 0.85, color: 0xa9bba0 }, true),
    planks: std('planks', { roughness: 0.95 }, true),
    floorboards: std('floorboards', { roughness: 0.75 }),
    linoleum: std('linoleum', { roughness: 0.55, ns: 0.4 }),
    tiles: std('tiles', { roughness: 0.35, ns: 0.6 }),
    wallpaper: std('wallpaper', { roughness: 0.9, ns: 0.2 }),
    brick: std('brick', { roughness: 0.9, ns: 1.0 }, true),
    concrete: std('concrete', { roughness: 0.95 }, true),
    corrugated: std('corrugated', { roughness: 0.55, metalness: 0.6, ns: 1.2, rust: true }, true),
    corrugatedRust: (() => {
      const m = std('corrugated', { roughness: 0.75, metalness: 0.4, ns: 1.2 });
      applyWeathering(m, weatheringUniforms({ dirt: 0.5, dust: 0.3, rust: 0.8 }), { rustColor: true, strength: 1 });
      return m;
    })(),
    shingles: std('shingles', { roughness: 0.95, ns: 1.1 }, true),
    rooftiles: std('rooftiles', { roughness: 0.8, ns: 1.0 }, true),
    adobe: std('adobe', { roughness: 0.98 }, true),
    rug: std('rug', { roughness: 1, ns: 0.3 }),
    fabric: std('fabric', { roughness: 1, ns: 0.4 }),
    fabricRed: std('fabric', { roughness: 1, ns: 0.4, color: 0xd08070 }),
    fabricBlue: std('fabric', { roughness: 1, ns: 0.4, color: 0x8090c0 }),
    fabricBrown: std('fabric', { roughness: 1, ns: 0.4, color: 0xb09070 }),
    trimWhite: new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.7 }),
    trimDark: new THREE.MeshStandardMaterial({ color: 0x3b3430, roughness: 0.7 }),
    wood: std('planks', { roughness: 0.8, color: 0xc89a6a, ns: 0.5 }),
    woodDark: std('planks', { roughness: 0.75, color: 0x7d5c40, ns: 0.4 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8c8f92, roughness: 0.45, metalness: 0.8 }),
    metalPainted: new THREE.MeshStandardMaterial({ color: 0xb8b2a4, roughness: 0.6, metalness: 0.3 }),
    metalRed: new THREE.MeshStandardMaterial({ color: 0x9a2b22, roughness: 0.55, metalness: 0.3 }),
    metalWhite: new THREE.MeshStandardMaterial({ color: 0xe0ddd5, roughness: 0.5, metalness: 0.2 }),
    metalGreen: new THREE.MeshStandardMaterial({ color: 0x4f6b4f, roughness: 0.6, metalness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.55 }),
    plasticDark: new THREE.MeshStandardMaterial({ color: 0x2c2c2e, roughness: 0.6 }),
    porcelain: new THREE.MeshPhysicalMaterial({ color: 0xeeeeea, roughness: 0.2, clearcoat: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fb0b0, roughness: 0.08, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
    glassDirty: new THREE.MeshPhysicalMaterial({ color: 0xb6ad95, roughness: 0.4, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    mattress: std('fabric', { roughness: 1, color: 0xd8d2c0, ns: 0.3 }),
    blackMatte: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.15, metalness: 0.2 }),
    emissiveWarm: new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 0.0, roughness: 0.5 }),
    neonRed: new THREE.MeshStandardMaterial({ color: 0x401010, emissive: 0xff3020, emissiveIntensity: 0.0, roughness: 0.4 }),
    sign: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    sandbag: std('fabric', { roughness: 1, color: 0xc8b48a, ns: 0.8 }),
    canvasGreen: std('fabric', { roughness: 1, color: 0x8a9a70, ns: 0.6 }),
    canvasOrange: std('fabric', { roughness: 1, color: 0xd88850, ns: 0.6 }),
    cardboard: new THREE.MeshStandardMaterial({ color: 0xa88458, roughness: 0.95 }),
    asphalt: std('concrete', { roughness: 0.95, color: 0x55524e }),
  };
  for (let i = 0; i < 6; i++) MATS['painting' + i] = paintingMaterial(i);
  return MATS;
}

// Text-bearing sign material (cached by text)
export function signMaterial(lines, opts = {}) {
  if (TOKENS) return { __sign: [lines, opts] };
  const { w = 512, h = 256, bg = '#e8e2d2', fg = '#1d1d1d', border = '#1d1d1d', font = 'Arial', weight = 'bold', worn = 0.3 } = opts;
  return cached('sign:' + JSON.stringify(lines) + bg + fg, () => {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = h * 0.04;
      ctx.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
    }
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((ln, i) => {
      let size = typeof ln === 'object' ? ln.size : (h * 0.7) / n;
      const text = typeof ln === 'object' ? ln.text : ln;
      ctx.font = `${weight} ${size}px ${font}`;
      // never let a line run off the board
      const tw = ctx.measureText(text).width;
      const maxW = w * (border ? 0.84 : 0.9);
      if (tw > maxW) {
        size *= maxW / tw;
        ctx.font = `${weight} ${size}px ${font}`;
      }
      ctx.fillText(text, w / 2, (h * (i + 0.5)) / n);
    });
    // wear
    const r = mulberry32(lines.join('').length * 7 + 3);
    for (let i = 0; i < 400 * worn; i++) {
      ctx.fillStyle = `rgba(${150 + r() * 60},${120 + r() * 50},${90 + r() * 40},${0.15 + r() * 0.35})`;
      ctx.beginPath();
      ctx.arc(r() * w, r() * h, 1 + r() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = canvasTexture(c, { wrap: false });
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.1 });
  });
}
