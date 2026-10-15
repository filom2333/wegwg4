// Drives the real menu flow: /?play=1... -> loading -> click to play.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const [query, stepsArg] = process.argv.slice(2);
const steps = JSON.parse(stepsArg || '[]');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto('http://127.0.0.1:5173/' + query, { waitUntil: 'load', timeout: 180000 });
if (process.env.HELPERS) await page.addScriptTag({ content: fs.readFileSync(process.env.HELPERS, 'utf8') });
for (const s of steps) {
  if (s.goto !== undefined) {
    await page.evaluate('window.game && (window.game.running = false, cancelAnimationFrame(window.game.raf))').catch(() => {});
    await page.goto('http://127.0.0.1:5173/' + s.goto, { waitUntil: 'load', timeout: 180000 });
    if (process.env.HELPERS) await page.addScriptTag({ content: fs.readFileSync(process.env.HELPERS, 'utf8') });
  }
  if (s.waitFor) await page.waitForFunction(s.waitFor, null, { timeout: 400000, polling: 500 });
  if (s.eval) {
    const r = await page.evaluate(s.eval);
    if (r !== undefined && r !== null) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r));
  }
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) {
    await page.evaluate('window.game && window.game.renderNow && window.game.renderer && window.game.scene && window.game.running ? window.game.renderNow() : 0');
    await page.screenshot({ path: s.shot, timeout: 180000 });
    console.log('shot', s.shot);
  }
}
for (const l of logs.filter((l) => !l.includes('[vite]')).slice(-15)) console.log(l);
await browser.close();
