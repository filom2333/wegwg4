// Pictures for How to play (public/howto/<name>.webp): real first-person frames from the game with
// the HUD on, each staged to show what its page explains: the prompt on screen, the thing in the
// hand, the car's controls. Medium quality and small, so they render quickly.
// Usage: BASE=... LANG_UI=ru node tools/promo/howtoShots.mjs <out dir> [names]   (one set per language:
// the prompts in the pictures are in the player's language)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const [outDir, only] = process.argv.slice(2);
const LANG = process.env.LANG_UI || 'en';
const W = 960,
  H = 540;
fs.mkdirSync(outDir, { recursive: true });
const pick = only ? only.split(',') : null;

// Each shot runs in the page with (g, S, THREE, aim): aim(eye, target) puts the player there
// looking at it. It returns the number of frames to run before the picture.
const SHOTS = {
  move: async (g, S, THREE, aim) => {
    const r = S.road(60, -9);
    aim(r.p, S.road(140, 0).p.clone().setY(r.p.y + 1.2));
    g.player.bob = 1.3;
    return 8;
  },
  take: async (g, S, THREE, aim) => {
    const r = S.road(40, -10);
    const at = r.p.clone().addScaledVector(r.fwd, 1.3);
    at.y = S.ground(at.x, at.z) + 0.2;
    g.items.spawn('jerryCan', at, undefined, { liquid: 14, liquidType: 'fuel' });
    aim(r.p, at.clone().setY(at.y - 0.05));
    return 12;
  },
  fit: async (g, S, THREE, aim) => {
    // the battery going into its place, the lid over it open (the bonnet, or the boot on a car
    // that keeps it there)
    const car = g.car;
    const r = S.road(40, -6);
    await S.placeCar(car, r.p, r.yaw);
    const spot = car.type.HOTSPOTS.find((h) => h.id === 'battery');
    if (spot.lid) S.open(car, spot.lid);
    car.setInstalled('battery', false);
    const p = g.player.position.clone();
    const it = [...g.items.items].reverse().find((x) => x.part === 'battery') || g.items.spawnPart('battery', p.clone().setY(p.y + 1), undefined, { condition: 0.9, charge: 0.8 });
    g.interaction.pick(it);
    const slot = car.root.localToWorld(spot.pos.clone());
    // stand off the slot's end of the car, a step to its side
    const lp = spot.pos;
    const eye = S.on(car, lp.x + Math.sign(lp.x || 1) * 0.55, 0, lp.z + Math.sign(lp.z) * 1.15);
    aim(eye, slot);
    return 14;
  },
  fuel: async (g, S, THREE, aim) => {
    const car = g.car;
    const r = S.road(40, -6);
    await S.placeCar(car, r.p, r.yaw);
    car.fillerOpen = true;
    car.fillerCapOff = true;
    car.fillerT = 1;
    const F = car.type.FILLER;
    const filler = car.root.localToWorld(new THREE.Vector3(...F.pos));
    const n = new THREE.Vector3(...F.normal).transformDirection(car.root.matrixWorld);
    const eye = filler.clone().addScaledVector(n, 0.95).addScaledVector(r.fwd, -0.35);
    eye.y = S.ground(eye.x, eye.z);
    const p = g.player.position.clone();
    g.interaction.pick(g.items.spawn('jerryCan', p.clone().setY(p.y + 1), undefined, { liquid: 16, liquidType: 'fuel' }));
    aim(eye, filler);
    return 14;
  },
  start: async (g, S, THREE, aim) => {
    const car = g.car;
    const r = S.road(40, -6);
    await S.placeCar(car, r.p, r.yaw);
    g.player.enterSeat(car, 'driver');
    car.ignition = true;
    const key = car.type.HOTSPOTS.find((h) => h.id === 'ignition').pos;
    const eye = car.type.SEATS.driver.pos;
    const d = key.clone().sub(eye);
    g.player.seatYaw = Math.atan2(d.x, d.z);
    g.player.seatPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    return 10;
  },
  drive: async (g, S, THREE, aim) => {
    // (near the start, where the world is already built)
    const car = g.car;
    const r = S.road(70, 1.8);
    await S.placeCar(car, r.p, r.yaw);
    g.player.enterSeat(car, 'driver');
    car.ignition = true;
    car.dyn.startEngine && car.dyn.startEngine();
    car.dyn.engine.running = true;
    car.dyn.body.setLinvel({ x: r.fwd.x * 19, y: 0, z: r.fwd.z * 19 }, true);
    g.player.seatYaw = 0;
    g.player.seatPitch = -0.12;
    return 6;
  },
  eat: async (g, S, THREE, aim) => {
    const r = S.road(40, -10);
    g.player.food = 28;
    g.player.water = 34;
    const p = g.player.position.clone();
    g.interaction.pick(g.items.spawn('cannedPeaches', p.clone().setY(p.y + 1)));
    aim(r.p, S.road(90, -3).p.clone().setY(r.p.y + 1.0));
    return 10;
  },
  night: async (g, S, THREE, aim) => {
    // the car's lamps on the road ahead, a lit lantern in hand
    g.env.time = 23.2;
    const car = g.car;
    const r = S.road(40, -6);
    await S.placeCar(car, r.p, r.yaw);
    car.ignition = true;
    car.lightsOn = 1;
    const p = g.player.position.clone();
    const lamp = g.items.spawn('lantern', p.clone().setY(p.y + 1), undefined, { liquid: 0.3, on: true });
    g.interaction.pick(lamp);
    const eye = S.on(car, -1.4, 0, -1.2);
    aim(eye, S.on(car, 0.6, 0.5, 14));
    return 14;
  },
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, fn] of Object.entries(SHOTS)) {
  if (pick && !pick.includes(name)) continue;
  const t0 = Date.now();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const logs = [];
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.addInitScript((l) => localStorage.setItem('dustroad.settings.v1', JSON.stringify({ quality: 'medium', musicOn: false, showFps: false, v: 2, tutorial: false, dynamicResolution: false, language: l })), LANG);
  await page.goto((process.env.BASE || 'http://127.0.0.1:5175/') + `?seed=1234&time=${name === 'night' ? 23 : 10.5}&z=0&manual=1&start=assembled&car=kiri86`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
  try {
    await page.evaluate(
      async (src) => {
        const g = window.game;
        const THREE = window.__THREE;
        const { Stage } = await import('/tools/promo/stage.js');
        const S = new Stage(g);
        g.running = true;
        g.paused = false;
        for (let i = 0; i < 3; i++) g.frame(1 / 30);
        // stand at `eye` (ground point) looking at `target`
        const aim = (eye, target) => {
          g.player.setPosition(eye);
          const e = eye.clone().setY(eye.y + 1.64);
          const d = target.clone().sub(e);
          g.player.yaw = Math.atan2(d.x, d.z);
          g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        };
        const n = await new Function('g', 'S', 'THREE', 'aim', 'return (' + src + ')(g, S, THREE, aim)')(g, S, THREE, aim);
        for (let i = 0; i < n; i++) g.frame(1 / 30);
      },
      fn.toString()
    );
  } catch (e) {
    console.log('FAILED', name, e.message);
  }
  const png = path.join(outDir, name + '.png');
  await page.screenshot({ path: png, timeout: 300000 });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-quality', '80', path.join(outDir, name + '.webp')]);
  console.log(name, ((Date.now() - t0) / 1000).toFixed(0) + ' s', logs.slice(-3).join(' '));
  await page.close();
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 4000))]);
process.exit(0);
