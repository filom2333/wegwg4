// Records what the game sounds like, headless: runs scenes in real time (no rendering) and writes
// the master output of each as a stereo WAV, for tools/sounds/audioreport.py to look at.
// Usage: node tools/audiotest.mjs <scenes.mjs> <out dir> [only scene names, comma separated]
// (with the dev server running: npx vite; BASE overrides http://127.0.0.1:5173/)
// A scenes module exports `query` (the dev start) and `scenes`: [{ name, seconds, setup, frame }],
// where setup(game, h) and frame(game, t, h) are run in the page (h: helpers below).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const [scenesFile, outDir, only] = process.argv.slice(2);
const mod = await import(path.resolve(scenesFile));
const pick = only ? only.split(',') : null;
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.addInitScript(() => {
  localStorage.setItem('dustroad.settings.v1', JSON.stringify({ quality: 'low', musicOn: false }));
  // a tap on everything that reaches the speakers
  const connect = AudioNode.prototype.connect;
  window.__rec = { on: false, L: [], R: [] };
  AudioNode.prototype.connect = function (dst, ...rest) {
    if (dst instanceof AudioDestinationNode && !dst.__tapped) {
      dst.__tapped = true;
      const ctx = dst.context;
      const sp = ctx.createScriptProcessor(4096, 2, 2);
      sp.onaudioprocess = (e) => {
        if (!window.__rec.on) return;
        window.__rec.L.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        window.__rec.R.push(new Float32Array(e.inputBuffer.getChannelData(1)));
      };
      const z = ctx.createGain();
      z.gain.value = 0;
      connect.call(sp, z);
      connect.call(z, dst);
      window.__tap = sp;
    }
    const r = connect.call(this, dst, ...rest);
    if (dst instanceof AudioDestinationNode && window.__tap && this !== window.__tap) connect.call(this, window.__tap);
    return r;
  };
});
await page.goto((process.env.BASE || 'http://127.0.0.1:5173/') + '?' + mod.query, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__ready === true', null, { timeout: 300000 });
await page.evaluate(async () => {
  await window.game.audio.start();
});
// helpers in the page
await page.evaluate(() => {
  const g = window.game;
  const V = window.__THREE.Vector3;
  window.__h = {
    V,
    // global (world) x/z to the scene's
    at(x, z, dy = 0) {
      return new V(x - g.origin.x, g.gen.height(x, z) + dy, z - g.origin.z);
    },
    // stand somewhere, looking along yaw (radians, 0 = -z)
    stand(p, yaw = 0) {
      if (g.player.seat) g.player.exitSeat();
      g.player.setPosition(p);
      g.player.yaw = yaw;
      g.player.pitch = 0;
    },
    key(code, down) {
      window.dev.input.simulate(code, down);
    },
    drive(on = true) {
      const car = g.car;
      if (!g.player.seat) g.player.enterSeat(car, 'driver');
      if (on && !car.dyn.engine.running) {
        car.setIgnition && car.setIgnition(true);
        car.dyn.engine.running = true;
        car.dyn.engine.rpm = 850;
      }
    },
  };
});

const SR = await page.evaluate(() => window.game.audio.ctx.sampleRate);
for (const sc of mod.scenes) {
  if (pick && !pick.includes(sc.name)) continue;
  const t0 = Date.now();
  const res = await page.evaluate(
    async ([setup, frame, seconds, settle]) => {
      const g = window.game,
        h = window.__h;
      const setupFn = new Function('g', 'h', 'return (' + setup + ')(g, h)');
      const frameFn = frame ? new Function('g', 't', 'h', 'return (' + frame + ')(g, t, h)') : null;
      await setupFn(g, h);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const run = async (sec, record) => {
        let last = performance.now(),
          t = 0;
        while (t < sec) {
          await sleep(12);
          const now = performance.now();
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          t += dt;
          if (frameFn) frameFn(g, t, h);
          g.step(dt);
          window.dev.input.endFrame();
        }
      };
      // let the streaming and the sounds settle, then record
      await run(settle, false);
      window.__rec.L = [];
      window.__rec.R = [];
      window.__rec.on = true;
      await run(seconds, true);
      window.__rec.on = false;
      const n = window.__rec.L.reduce((s, a) => s + a.length, 0);
      const out = new Int16Array(n * 2);
      let o = 0;
      for (let k = 0; k < window.__rec.L.length; k++) {
        const L = window.__rec.L[k],
          R = window.__rec.R[k];
        for (let i = 0; i < L.length; i++) {
          out[o++] = Math.max(-32768, Math.min(32767, L[i] * 32767));
          out[o++] = Math.max(-32768, Math.min(32767, R[i] * 32767));
        }
      }
      // base64 of the samples
      const b = new Uint8Array(out.buffer);
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      return btoa(s);
    },
    [sc.setup.toString(), sc.frame ? sc.frame.toString() : null, sc.seconds, sc.settle ?? 3]
  );
  const pcm = Buffer.from(res, 'base64');
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0);
  hdr.writeUInt32LE(36 + pcm.length, 4);
  hdr.write('WAVEfmt ', 8);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(2, 22);
  hdr.writeUInt32LE(SR, 24);
  hdr.writeUInt32LE(SR * 4, 28);
  hdr.writeUInt16LE(4, 32);
  hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36);
  hdr.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(path.join(outDir, sc.name + '.wav'), Buffer.concat([hdr, pcm]));
  console.log(sc.name, ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
const errs = logs.filter((l) => /error|warn/i.test(l));
for (const l of errs.slice(-30)) console.log(l);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(0);
