// The picture settings. Four presets, or Custom, where each part of the picture is chosen on its
// own (it starts as a copy of the preset that was picked before). Whatever draws reads its
// options from here: the renderer (resolution, shadows, antialiasing, post effects), the land,
// the plants and the far forest (how far they reach).

import { settings } from './settings.js';

// what each choice means
export const RESOLUTION = {
  low: { pixelRatio: 0.75, maxPixels: 1.0e6 },
  medium: { pixelRatio: 1, maxPixels: 2.1e6 },
  high: { pixelRatio: 1, maxPixels: 3.7e6 },
  ultra: { pixelRatio: 1.5, maxPixels: 6.0e6 },
};
export const SHADOWS = {
  off: { size: 0, extent: 35 },
  low: { size: 1024, extent: 35 },
  medium: { size: 2048, extent: 45 },
  high: { size: 2048, extent: 55 },
  ultra: { size: 4096, extent: 65 },
};
// land: how far the ground is drawn (null: as far as the mountains); trees: real trees around
// you; forest: the flat far forest past them
export const DISTANCE = {
  low: { land: 3000, trees: 520, forest: 0 },
  medium: { land: null, trees: 700, forest: 1400 },
  high: { land: null, trees: 880, forest: 1900 },
  ultra: { land: null, trees: 1000, forest: 2400 },
};
export const SHARPEN = { off: 0, light: 0.3, strong: 0.6 };

export const PRESETS = {
  low: { resolution: 'low', shadows: 'low', distance: 'low', aa: 'fxaa', bloom: false, shafts: false, sharpen: 'light', heat: false, grain: true, mirrors: false },
  medium: { resolution: 'medium', shadows: 'medium', distance: 'medium', aa: 'fxaa', bloom: true, shafts: true, sharpen: 'light', heat: true, grain: true, mirrors: true },
  high: { resolution: 'high', shadows: 'high', distance: 'high', aa: 'msaa', bloom: true, shafts: true, sharpen: 'light', heat: true, grain: true, mirrors: true },
  ultra: { resolution: 'ultra', shadows: 'ultra', distance: 'ultra', aa: 'msaa', bloom: true, shafts: true, sharpen: 'light', heat: true, grain: true, mirrors: true },
};

// The options in effect: a preset by name, or the player's own (quality 'custom').
export function gfx(quality = settings.data.quality) {
  if (quality === 'custom') return { ...PRESETS.high, ...(settings.data.custom || {}) };
  return PRESETS[quality] || PRESETS.high;
}

// Switching to Custom starts from what was in effect.
export function startCustom() {
  if (settings.data.quality !== 'custom') settings.data.custom = { ...gfx() };
}

// The renderer's view of it.
export function renderOptions(quality) {
  const o = gfx(quality);
  const r = RESOLUTION[o.resolution] || RESOLUTION.high;
  const s = SHADOWS[o.shadows] || SHADOWS.high;
  return {
    pixelRatio: r.pixelRatio,
    maxPixels: r.maxPixels,
    shadow: s.size || 1024,
    shadowsOn: s.size > 0,
    shadowExtent: s.extent,
    plantShadows: s.size > 1024,
    bloom: o.bloom !== false,
    aa: o.aa === 'fxaa',
    msaa: o.aa === 'msaa' ? 4 : 0,
    sharpen: SHARPEN[o.sharpen] ?? 0.3,
    shafts: o.shafts !== false,
    heat: o.heat !== false,
    grain: o.grain !== false,
    mirrors: o.mirrors !== false,
  };
}

export function distance(quality) {
  return DISTANCE[gfx(quality).distance] || DISTANCE.high;
}
