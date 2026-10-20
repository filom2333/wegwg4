// Drives the game headlessly: run steps with simulated input and capture screenshots.
// Usage: node tools/play.mjs <query> <script.json> [w h]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const [query = '', scriptArg = '[]', w = '1280', h = '720'] = process.argv.slice(2);
const steps = fs.existsSync(scriptArg) ? JSON.parse(fs.readFileSync(scriptArg, 'utf8')) : JSON.parse(scriptArg);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto((process.env.BASE || 'http://127.0.0.1:5173/') + '?' + query, { waitUntil: 'load', timeout: 120000 });
try {
  await page.waitForFunction('window.__ready === true', null, { timeout: +(process.env.READY_TIMEOUT || 300000) });
} catch (e) {
  console.log('NOT READY', e.message);
  for (const l of logs.slice(-30)) console.log(l);
  await browser.close();
  process.exit(1);
}
if (process.env.HELPERS) await page.addScriptTag({ content: fs.readFileSync(process.env.HELPERS, 'utf8') });
// The page's own RAF loop is too slow in software GL; we drive time manually via game.debugStep.
for (const s of steps) {
  if (s.eval) {
    const r = await page.evaluate(s.eval);
    if (r !== undefined && r !== null) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r));
  }
  if (s.sim) {
    // simulate seconds of game time at fixed dt without rendering
    await page.evaluate(([sec, dt]) => window.game.debugSimulate(sec, dt), [s.sim, s.dt || 1 / 30]);
  }
  if (s.waitFor) await page.waitForFunction(s.waitFor, null, { timeout: 300000 });
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) {
    fs.mkdirSync('shots', { recursive: true });
    if (await page.evaluate('!!(window.game && window.game.renderNow)')) await page.evaluate('window.game.renderNow()');
    await page.screenshot({ path: s.shot, timeout: 180000 });
    console.log('shot', s.shot);
  }
}
for (const l of logs.slice(-25)) console.log(l);
await browser.close();
