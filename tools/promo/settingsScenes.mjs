// The example pictures in Settings > Picture > Custom (public/settings/<option>_<choice>.webp),
// for tools/promo/shoot.mjs. One scene per subject; each choice is applied to the running game
// and shot (the draw distance needs a fresh start for each, so it has a scene per choice).
// Usage: W=480 H=270 SS=2 node tools/promo/shoot.mjs tools/promo/settingsScenes.mjs <out dir>

// a car on the forest road in the afternoon: shadows, resolution, antialiasing, sharpening, grain
async function carInForest(S, g) {
  const r = S.road(16470, 1.8);
  await S.placeCar(g.car, r.p, r.yaw + 0.35);
  S.open(g.car, 'door_FL');
  S.look(S.on(g.car, -4.6, 1.6, 5.2), S.on(g.car, 0.2, 0.7, 0), 50);
  g.player.setPosition(S.on(g.car, -12, 0, 14));
}

// variants give the renderer options to set (see shoot.mjs)
const base = { msaa: 0, shadowsOn: true, shadow: 2048, shadowExtent: 55, sharpen: 0.3, grain: true, bloom: true, shafts: true, aa: false, pixelRatio: 1 };
const CROP = [0.3, 0.32, 0.4, 0.4];

const dist = (v) => ({
  name: 'distance',
  z: 16500,
  time: 16.8,
  quality: 'custom',
  settings: { custom: { distance: v, shadows: 'high', resolution: 'high', aa: 'fxaa' } },
  settle: 8,
  setup: async (S, g, THREE) => {
    const r = S.road(16470, 1.8);
    await S.placeCar(g.car, r.p, r.yaw);
    S.look(S.on(g.car, 6, 22, -30), S.on(g.car, -2, 4, 160), 55);
    g.player.setPosition(S.on(g.car, 9, 0, -34));
  },
  variants: [[v, () => {}]],
});

export const scenes = [
  {
    // the car's shadow on the desert road in the afternoon
    name: 'shadows',
    z: 4300,
    time: 15.2,
    setup: async (S, g) => {
      const r = S.road(4330, 1.8);
      await S.placeCar(g.car, r.p, r.yaw + 0.35);
      S.open(g.car, 'door_FL');
      S.look(S.on(g.car, -4.2, 2.6, 4.8), S.on(g.car, 0.8, 0, -0.6), 55);
      g.player.setPosition(S.on(g.car, -12, 0, 14));
    },
    variants: [
      ['off', { ...base, shadowsOn: false }],
      ['low', { ...base, shadow: 1024, shadowExtent: 35 }],
      ['medium', { ...base, shadow: 2048, shadowExtent: 45 }],
      ['high', { ...base, shadow: 2048, shadowExtent: 55 }],
      ['ultra', { ...base, shadow: 4096, shadowExtent: 65 }],
    ],
  },
  {
    name: 'detail',
    z: 16500,
    time: 15.6,
    setup: carInForest,
    variants: [
      ['resolution_low', { ...base, pixelRatio: 0.55 }, CROP],
      ['resolution_medium', { ...base, pixelRatio: 0.75 }, CROP],
      ['resolution_high', { ...base, pixelRatio: 1 }, CROP],
      ['resolution_ultra', { ...base, pixelRatio: 1.5 }, CROP],
      ['sharpen_off', { ...base, sharpen: 0 }, CROP],
      ['sharpen_light', { ...base, sharpen: 0.3 }, CROP],
      ['sharpen_strong', { ...base, sharpen: 0.6 }, CROP],
      ['grain_false', { ...base, grain: false }, CROP],
      ['grain_true', { ...base, grain: true }, CROP],
      ['aa_off', { ...base, aa: false }, CROP],
      ['aa_fxaa', { ...base, aa: true }, CROP],
      ['aa_msaa', { ...base, msaa: 4 }, CROP],
    ],
  },
  {
    // into the low sun through the trees: rays and glow
    name: 'sun',
    z: 16500,
    time: 18.55,
    setup: async (S, g) => {
      const r = S.road(16470, 1.8);
      await S.placeCar(g.car, r.p, r.yaw);
      g.car.lightsOn = true;
      const sun = g.env.sunDir.clone();
      sun.y = 0;
      sun.normalize();
      const from = S.on(g.car, 0, 1.7, -7);
      S.look(from, from.clone().addScaledVector(sun, 50).setY(from.y + 6), 60);
      g.player.setPosition(S.on(g.car, 9, 0, -34));
    },
    variants: [
      ['shafts_true', { ...base, shafts: true, bloom: true }],
      ['shafts_false', { ...base, shafts: false, bloom: true }],
      ['bloom_true', { ...base, shafts: true, bloom: true }],
      ['bloom_false', { ...base, shafts: true, bloom: false }],
    ],
  },
  {
    // down a desert road at midday: the air over it shimmering
    name: 'heat',
    z: 4300,
    time: 13,
    setup: async (S, g) => {
      const a = S.road(4300, 2.2),
        b = S.road(4700, 2.2);
      await S.placeCar(g.car, S.road(4330, -3.5).p, a.yaw);
      S.look(a.p.clone().setY(a.p.y + 1.5), b.p.clone().setY(b.p.y + 1.2), 40);
      g.player.setPosition(S.road(4280, -6).p);
    },
    variants: [
      ['heat_true', { ...base, heat: true, heatHold: 1 }, [0.25, 0.3, 0.5, 0.5]],
      ['heat_false', { ...base, heat: false, heatHold: 0 }, [0.25, 0.3, 0.5, 0.5]],
    ],
  },
  dist('low'),
  dist('medium'),
  dist('high'),
  dist('ultra'),
];
