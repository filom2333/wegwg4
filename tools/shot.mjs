// Headless screenshot driver used during development.
// Usage: node tools/shot.mjs <url> <steps.json|inline-json> [width height]
// Steps: [{ "eval": "js", "wait": ms, "shot": "path.png", "waitFor": "js-expr" }]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const [url, stepsArg, w = '1280', h = '720'] = process.argv.slice(2);
const steps = fs.existsSync(stepsArg) ? JSON.parse(fs.readFileSync(stepsArg, 'utf8')) : JSON.parse(stepsArg || '[]');
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
try {
  await page.waitForFunction('window.__ready === true', null, { timeout: +(process.env.READY_TIMEOUT || 240000) });
} catch (e) {
  console.log('NOT READY:', e.message);
  for (const l of logs.slice(-40)) console.log(l);
  await page.screenshot({ path: 'shots/_fail.png' });
  await browser.close();
  process.exit(1);
}
for (const s of steps) {
  if (s.eval) {
    const r = await page.evaluate(s.eval);
    if (r !== undefined) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r));
  }
  if (s.waitFor) await page.waitForFunction(s.waitFor, null, { timeout: 240000 });
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) {
    fs.mkdirSync(s.shot.split('/').slice(0, -1).join('/') || '.', { recursive: true });
    await page.evaluate('window.inspector && window.inspector.renderNow ? window.inspector.renderNow() : (window.game && window.game.renderNow ? window.game.renderNow() : 0)');
    await page.screenshot({ path: s.shot, timeout: 180000 });
    console.log('shot', s.shot);
  }
}
for (const l of logs.slice(-40)) console.log(l);
await browser.close();
