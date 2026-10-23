// Renders staged promo shots (and menu pictures): each scene in a fresh page at the dev start, a
// Stage (stage.js) to place cars and friends, then the frame at `ss` times the size, scaled down
// with Lanczos for clean edges, and a depth map (disparity, for the menu's parallax).
// Usage: node tools/promo/shoot.mjs <scenes.mjs> <out dir> [names,comma,separated]
// env: W, H (output size, default 1920x1080), SS (supersampling, default 2), BASE (dev server)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const [scenesFile, outDir, only] = process.argv.slice(2);
const { scenes } = await import(path.resolve(scenesFile));
const W = +(process.env.W || 1920),
  H = +(process.env.H || 1080),
  SS = +(process.env.SS || 2);
fs.mkdirSync(outDir, { recursive: true });
const pick = only ? only.split(',') : null;

for (const sc of scenes) {
  if (pick && !pick.includes(sc.name)) continue;
  const t0 = Date.now();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=8192'] });
  const page = await browser.newPage({ viewport: { width: W * SS, height: H * SS } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.addInitScript((q) => localStorage.setItem('dustroad.settings.v1', JSON.stringify({ quality: q, dynamicResolution: false, musicOn: false, hfov: 90 })), sc.quality || 'ultra');
  const q = `seed=${sc.seed || 1234}&time=${sc.time ?? 18}&z=${sc.z}&manual=1&weather=${sc.weather || 'clear'}&car=${sc.car || 'w203'}`;
  await page.goto((process.env.BASE || 'http://127.0.0.1:5173/') + '?' + q, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 600000 });
  try {
    await page.evaluate(
      async ([setup, settle]) => {
        const g = window.game;
        // full resolution whatever the preset's pixel budget
        g.renderer.q = { ...g.renderer.q, maxPixels: 1e9, pixelRatio: 1 };
        g.renderer.applyPixelRatio();
        const { Stage } = await import('/tools/promo/stage.js');
        const S = (window.__stage = new Stage(g));
        const fn = new Function('S', 'g', 'THREE', 'return (' + setup + ')(S, g, THREE)');
        await fn(S, g, window.__THREE);
        await S.settle(settle);
        // the scene may re-pose after the settle (cars moved on their springs)
        if (S.after) await S.after();
      },
      [sc.setup.toString(), sc.settle ?? 6]
    );
  } catch (e) {
    console.log('SETUP FAILED', sc.name, e.message);
    for (const l of logs.slice(-20)) console.log(l);
    await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
    continue;
  }
  await page.addStyleTag({ content: 'body > :not(#game){display:none!important}' });
  await page.evaluate(() => window.game.renderNow());
  await page.evaluate(() => window.game.renderNow());
  const big = path.join(outDir, sc.name + '_big.png');
  await page.screenshot({ path: big, timeout: 900000 });
  // depth: disparity (1.5 m / distance, square-rooted) at half the output size
  const dw = W / 2,
    dh = H / 2;
  const depth = await page.evaluate(
    ([dw, dh]) => {
      const THREE = window.__THREE;
      const g = window.game,
        R = g.renderer,
        cam = R.camera;
      const rt = new THREE.WebGLRenderTarget(dw, dh);
      const mat = new THREE.ShaderMaterial({
        uniforms: { tD: { value: R.grade.uniforms.tDepth.value }, uRev: { value: R.revZ ? 1 : 0 }, uN: { value: cam.near }, uF: { value: cam.far } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `uniform sampler2D tD; uniform float uRev, uN, uF; varying vec2 vUv;
void main() {
  float d = texture2D(tD, vUv).r;
  if (uRev > 0.5) d = 1.0 - d;
  float z = uN * uF / (uF - d * (uF - uN));
  gl_FragColor = vec4(vec3(sqrt(clamp(1.5 / z, 0.0, 1.0))), 1.0);
}`,
      });
      const sc = new THREE.Scene();
      sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
      R.renderer.setRenderTarget(rt);
      R.renderer.render(sc, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
      const px = new Uint8Array(dw * dh * 4);
      R.renderer.readRenderTargetPixels(rt, 0, 0, dw, dh, px);
      R.renderer.setRenderTarget(null);
      // rows bottom-up in GL; one channel
      const out = new Uint8Array(dw * dh);
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) out[(dh - 1 - y) * dw + x] = px[(y * dw + x) * 4];
      let s = '';
      for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
      return btoa(s);
    },
    [dw, dh]
  );
  const raw = path.join(outDir, sc.name + '_depth.gray');
  fs.writeFileSync(raw, Buffer.from(depth, 'base64'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', big, '-vf', `scale=${W}:${H}:flags=lanczos`, path.join(outDir, sc.name + '.png')]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${dw}x${dh}`, '-i', raw, path.join(outDir, sc.name + '_depth.png')]);
  fs.unlinkSync(raw);
  fs.unlinkSync(big);
  console.log(sc.name, ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  for (const l of logs.filter((l) => /pageerror|error/i.test(l) && !/GL Driver/.test(l)).slice(-8)) console.log('  ', l);
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
}
process.exit(0);
