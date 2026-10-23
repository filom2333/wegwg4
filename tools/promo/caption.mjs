// Captioned promo pictures: a shot from shoot.mjs with the game's mark in a corner and a line on
// a green guide sign at the bottom (the menus' look). Two languages from the same list.
// Usage: node tools/promo/caption.mjs <shots dir> <out dir> [lang en|ru]
// env FONTS: a folder with Cyrillic Overpass / IBM Plex Mono woff2 (@fontsource) for Russian.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const [shots, outDir, lang = 'en'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname);
const gameFonts = path.resolve(here, '../../src/ui/fonts');
const extra = process.env.FONTS || '';

export const CAPTIONS = {
  roadside: {
    en: ['Stop wherever the road takes you', 'An endless highway, a car you keep alive part by part'],
    ru: ['Остановись там, где захочется', 'Бесконечная трасса и машина, которую держишь на ходу по деталям'],
  },
  campfire: {
    en: ['Nights by the fire', 'Cook what you caught, warm up, sleep before the next stretch'],
    ru: ['Ночи у костра', 'Приготовь улов, согрейся и выспись перед новым отрезком пути'],
  },
  breakdown: {
    en: ['Every part can fail. Every part can be fixed.', 'Belts, plugs, pumps, wheels: find them, bolt them on'],
    ru: ['Сломаться может всё. Починить тоже.', 'Ремни, свечи, помпы, колёса: найди и прикрути сам'],
  },
  flipped: {
    en: ['Some trips end upside down', 'Real physics: sand trips you, a loaded roof rolls you'],
    ru: ['Некоторые поездки заканчиваются вверх колёсами', 'Настоящая физика: песок подсекает, груз на крыше переворачивает'],
  },
  pushing: {
    en: ['Out of fuel? Push.', 'Every litre counts on Route 9'],
    ru: ['Кончился бензин? Толкай.', 'На трассе 9 на счету каждый литр'],
  },
  vista: {
    en: ['150 km to Haven', 'Forests, deserts and mountains all the way to the horizon'],
    ru: ['150 км до Хейвена', 'Леса, пустыни и горы до самого горизонта'],
  },
  snow: {
    en: ['From the desert to the frozen north', 'Nine lands, day and night, sandstorms, rain and snow'],
    ru: ['От пустыни до ледяного севера', 'Девять краёв, день и ночь, песчаные бури, дождь и снег'],
  },
  fishing: {
    en: ['Live off the land', 'Fish, hunt, scavenge the places along the road'],
    ru: ['Живи тем, что даёт земля', 'Рыбалка, охота и всё, что найдёшь по дороге'],
  },
};

const SHIELD = `<svg viewBox="0 0 100 100"><rect x="1" y="1" width="98" height="98" rx="9" fill="#141414"/><path d="M50 10c9 6 21 7 34 3 5 21 3 40-6 56-7 12-16 19-28 23-12-4-21-11-28-23-9-16-11-35-6-56 13 4 25 3 34-3z" fill="#f7f6f0"/><text x="50" y="72" text-anchor="middle" font-family="Overpass" font-weight="800" font-size="52" fill="#141414">9</text></svg>`;

function face(family, weight, file) {
  return fs.existsSync(file) ? `@font-face{font-family:'${family}';font-weight:${weight};src:url('file://${file}') format('woff2');}` : '';
}

function page(img, [title, sub]) {
  const fonts = [
    face('Overpass', 800, gameFonts + '/overpass-latin-800-normal.woff2'),
    face('Overpass', 600, gameFonts + '/overpass-latin-600-normal.woff2'),
    face('Courier Prime', 400, gameFonts + '/courier-prime-latin-400-normal.woff2'),
    extra && face('OverpassC', 800, extra + '/overpass-cyrillic-800-normal.woff2'),
    extra && face('OverpassC', 600, extra + '/overpass-cyrillic-600-normal.woff2'),
    extra && face('PlexC', 400, extra + '/ibm-plex-mono-cyrillic-400-normal.woff2'),
  ].join('\n');
  return `<!doctype html><meta charset="utf-8"><style>
${fonts}
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000}
.shot{position:absolute;inset:0;background:url('file://${img}') center/cover}
.shade{position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.55),rgba(0,0,0,0) 34%),linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,0) 22%),radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 60%,rgba(0,0,0,.28))}
.mark{position:absolute;left:64px;top:52px;display:flex;align-items:center;gap:18px;color:#f6f3eb;text-shadow:0 2px 6px rgba(0,0,0,.6)}
.mark svg{width:74px;height:74px;filter:drop-shadow(0 3px 8px rgba(0,0,0,.45))}
.mark h1{margin:0;font:800 58px/0.9 Overpass,OverpassC,sans-serif;letter-spacing:-.01em}
.mark small{display:block;margin-top:8px;font:600 19px/1 Overpass,OverpassC,sans-serif;letter-spacing:.14em;opacity:.85;text-transform:uppercase}
.sign{position:absolute;left:64px;bottom:64px;max-width:1120px;padding:7px;border-radius:16px;background:#0e5b3b;
 background-image:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,0) 40%,rgba(0,0,0,0) 70%,rgba(40,30,10,.18));
 box-shadow:0 1px 0 rgba(255,255,255,.08) inset,0 -2px 0 rgba(0,0,0,.25) inset,0 30px 60px rgba(0,0,0,.45),0 6px 14px rgba(0,0,0,.35)}
.in{position:relative;border:4px solid #f3f2ea;border-radius:10px;padding:24px 34px 22px;color:#f3f2ea}
.in:before,.in:after{content:'';position:absolute;top:9px;width:9px;height:9px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#d6d8d2,#7d817c 60%,#4e524d)}
.in:before{left:10px}.in:after{right:10px}
.t{font:800 60px/1.02 Overpass,OverpassC,sans-serif;letter-spacing:-.005em}
.s{margin-top:12px;font:600 27px/1.25 Overpass,OverpassC,sans-serif;opacity:.92}
</style>
<div class="shot"></div><div class="shade"></div>
<div class="mark">${SHIELD}<div><h1>Dust Road</h1><small>Route 9 · 150 km to Haven</small></div></div>
<div class="sign"><div class="in"><div class="t">${title}</div><div class="s">${sub}</div></div></div>`;
}

const browser = await chromium.launch();
const pg = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [name, c] of Object.entries(CAPTIONS)) {
  const img = path.resolve(shots, name + '.png');
  if (!fs.existsSync(img)) continue;
  const html = path.resolve(outDir, `_${name}.html`);
  fs.writeFileSync(html, page(img, c[lang] || c.en));
  await pg.goto('file://' + html);
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(150);
  await pg.screenshot({ path: path.resolve(outDir, `${name}_${lang}.png`) });
  fs.unlinkSync(html);
  console.log(name, lang);
}
await browser.close();
