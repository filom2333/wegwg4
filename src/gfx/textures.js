// Procedural texture helpers (Canvas 2D based), including height -> normal map conversion.

import * as THREE from 'three';
import { SimplexNoise, mulberry32 } from '../core/noise.js';

const cache = new Map();

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function canvasTexture(canvas, { srgb = true, repeat = [1, 1], wrap = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

export function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// Height canvas (grayscale in R) -> tangent-space normal map canvas.
export function normalFromHeight(src, strength = 2, wrap = true) {
  const w = src.width,
    h = src.height;
  const sctx = src.getContext('2d');
  const sd = sctx.getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const octx = out.getContext('2d');
  const od = octx.createImageData(w, h);
  const H = (x, y) => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + h) % h;
    } else {
      x = Math.min(w - 1, Math.max(0, x));
      y = Math.min(h - 1, Math.max(0, y));
    }
    return sd[(y * w + x) * 4] / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      let nx = -dx,
        ny = dy,
        nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      od.data[i] = (nx * 0.5 + 0.5) * 255;
      od.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      od.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      od.data[i + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

// Fill a canvas with fractal noise; mapper(v,x,y) -> [r,g,b] (0..255)
export function noiseCanvas(w, h, { scale = 4, octaves = 5, seed = 1, mapper, tile = true } = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const n = new SimplexNoise(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v;
      if (tile) {
        // 4D-like torus mapping via 3D noise on two circles is costly; blend 4 samples instead.
        const u = x / w,
          t = y / h;
        const s = scale;
        const a = n.fbm2(u * s, t * s, octaves);
        const b = n.fbm2((u - 1) * s, t * s, octaves);
        const c2 = n.fbm2(u * s, (t - 1) * s, octaves);
        const d = n.fbm2((u - 1) * s, (t - 1) * s, octaves);
        v = (a * (1 - u) + b * u) * (1 - t) + (c2 * (1 - u) + d * u) * t;
      } else v = n.fbm2((x / w) * scale, (y / h) * scale, octaves);
      v = v * 0.5 + 0.5;
      const i = (y * w + x) * 4;
      const col = mapper ? mapper(v, x, y) : [v * 255, v * 255, v * 255];
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function seededRandom(seed) {
  return mulberry32(seed);
}

// Blur a canvas in place (cheap box blur via drawImage filter where supported).
export function blurCanvas(c, px) {
  const t = makeCanvas(c.width, c.height);
  const ctx = t.getContext('2d');
  ctx.filter = `blur(${px}px)`;
  ctx.drawImage(c, 0, 0);
  const cx = c.getContext('2d');
  cx.clearRect(0, 0, c.width, c.height);
  cx.drawImage(t, 0, 0);
  return c;
}
