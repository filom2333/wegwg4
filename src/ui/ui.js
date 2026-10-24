// Menu layer. Everything here is something you would find on Route 9 (see theme.css): the title,
// the pause and the end of a run are road signs on their posts; the new game is a trip sheet on a
// clipboard; the manual, the journal, settings, statistics and credits are typed paper; warnings
// are yellow. Screens: title (over pictures from the road), new game, how to play, settings,
// statistics, credits, loading, the first screen of a run, pause, journal, road atlas, notes,
// sleep, death and Haven.

import { CAR_TYPE_LIST } from '../vehicle/types.js';
import { settings, DEFAULT_BINDINGS } from '../core/settings.js';
import { InventoryUI } from './inventoryUI.js';
import { input } from '../core/input.js';
import { hasSave, saveSummary, writeSave, readCareer, recordRun, deleteSave } from '../core/save.js';
import { NOTES, HAVEN_KM } from '../story/story.js';
import { drawAtlas } from '../story/atlas.js';
import { MenuBackdrop } from './menuBackdrop.js';
import { applySignTextures } from './signTextures.js';
import { LANGS, lang } from '../core/i18n.js';
import { gfx, startCustom } from '../core/gfx.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const VERSION = '0.11';

// Pictures behind the title (public/menu/): moments from the road, each with its depth map so
// the title shows them in depth (menuBackdrop.js); the flat slideshow is the fallback.
const MENU_SHOTS = ['roadside', 'campfire', 'vista', 'breakdown', 'snow', 'pushing', 'fishing', 'flipped'].map((n, i) => ({
  src: `menu/${n}.webp`,
  depth: `menu/${n}_depth.webp`,
  move: ['in', 'left', 'out', 'right'][i % 4],
  origin: '50% 55%',
}));
const SLIDE_SECONDS = 9;

const TIPS = [
  'A jerry can holds 20 litres. Fill every can you have when you find a pump that works.',
  'Headlights keep some things at a distance. Not all of them.',
  'Hold R on a part to unbolt it. Parts that hang on it have to come off first.',
  'Coolant and oil are cheap. Engines are not.',
  'Rain turns dirt roads to grease. Brake earlier.',
  'Aim for the head. It is a long way to the next box of cartridges.',
  'A bed rests you best, a tent next, the back seat least.',
  'Abandoned cars still have parts worth taking.',
  'The road always goes north. Everything else is a detour.',
];

const LABELS = {
  forward: 'Forward / throttle',
  back: 'Back / brake / reverse',
  left: 'Left / steer left',
  right: 'Right / steer right',
  sprint: 'Run',
  crouch: 'Crouch',
  jump: 'Jump',
  interact: 'Use, pick up, get in and out',
  drop: 'Drop (hold to throw)',
  reload: 'Reload · unbolt a part (hold)',
  flashlight: 'Flashlight · use now',
  lights: 'Headlights',
  horn: 'Horn',
  gearUp: 'Gear up (manual)',
  gearDown: 'Gear down (manual)',
  handbrake: 'Handbrake (hold)',
  wipers: 'Wipers',
  lookBack: 'Look back',
  winch: 'Wind in the winch',
  journal: 'Journal',
  atlas: 'Road atlas',
  photo: 'Photo mode',
  inventory: 'Backpack',
  nextTrack: 'Next track on the stereo',
  music: 'Music on / off',
  stow: 'Into the backpack',
  sleep: 'Sleep (car, tent or bed)',
  view: 'First / third person',
};

// A highway arrow (shaft and a broad head), pointing up; .arrow turns it by --rot.
const ARROW = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2 37 20H26.5v18h-13V20H3z"/></svg>';

// A US-style route marker: black square, white shield, black number.
function shieldSvg(n) {
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="1" y="1" width="98" height="98" rx="9" fill="#141414"/><path d="M50 10c9 6 21 7 34 3 5 21 3 40-6 56-7 12-16 19-28 23-12-4-21-11-28-23-9-16-11-35-6-56 13 4 25 3 34-3z" fill="#f7f6f0"/><text x="50" y="72" text-anchor="middle" font-family="Overpass, Arial Narrow, sans-serif" font-weight="800" font-size="52" fill="#141414">${n}</text></svg>`;
}

// The flags in the corner of the title, for the language.
function usFlag() {
  let stars = '';
  for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 5 : 6); c++) stars += `<circle cx="${(1.27 + c * 2.53 + (r % 2 ? 1.27 : 0)).toFixed(2)}" cy="${(1.08 + r * 1.08).toFixed(2)}" r="0.42"/>`;
  return `<svg viewBox="0 0 38 20" aria-hidden="true"><rect width="38" height="20" fill="#b22234"/><path d="M0 2.31h38M0 5.38h38M0 8.46h38M0 11.54h38M0 14.62h38M0 17.69h38" stroke="#fff" stroke-width="1.54"/><rect width="15.2" height="10.77" fill="#3c3b6e"/><g fill="#fff">${stars}</g></svg>`;
}
const FLAGS = {
  en: usFlag(),
  ru: '<svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#fff"/><rect y="6.67" width="30" height="6.67" fill="#0039a6"/><rect y="13.33" width="30" height="6.67" fill="#d52b1e"/></svg>',
};

export function keyName(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', Space: 'Space', AltLeft: 'Alt', Tab: 'Tab', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Backspace: 'Backspace' }[code] || code;
}

// Custom picture settings: what each one is, its choices, what it does, and whether it changes at
// once (or on the next start). Each choice has a picture of what it looks like (public/settings/).
const GFX_OPTIONS = [
  ['distance', 'Draw distance', [['low', 'Near'], ['medium', 'Medium'], ['high', 'Far'], ['ultra', 'Very far']], 'How far out trees, the forest and the land are drawn.', false],
  ['shadows', 'Shadows', [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], 'Sharper shadows, reaching further from you.', true],
  ['resolution', 'Resolution', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], 'Pixels drawn for each frame. Ultra draws more than the screen has and smooths it down.', true],
  ['aa', 'Anti-aliasing', [['off', 'Off'], ['fxaa', 'FXAA'], ['msaa', 'MSAA 4×']], 'Smooths jagged edges. MSAA is cleaner, FXAA cheaper.', false],
  ['sharpen', 'Sharpening', [['off', 'Off'], ['light', 'Light'], ['strong', 'Strong']], 'Crisper fine detail: gravel, leaves, wires.', true],
  ['bloom', 'Glow', [[true, 'On'], [false, 'Off']], 'Lamps, headlights, the sun and fire glow.', true],
  ['shafts', 'Sun rays', [[true, 'On'], [false, 'Off']], 'Rays of sunlight through trees and gaps.', true],
  ['heat', 'Heat haze', [[true, 'On'], [false, 'Off']], 'The air shimmers over hot ground at midday.', true],
  ['grain', 'Film grain', [[true, 'On'], [false, 'Off']], 'A light grain over the picture, like film.', true],
  ['mirrors', 'Mirrors', [[true, 'On'], [false, 'Off']], 'The car mirrors show the road behind you. Costs a little frame rate.', true],
];

const GFX_PICTURES = new Set(['distance', 'resolution', 'aa', 'sharpen', 'grain']);

const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

export class UI {
  constructor() {
    this.root = el('div', 'ui', document.body);
    // automated captures render far below real time: skip fades so screens are never caught mid-transition
    if (navigator.webdriver) this.root.classList.add('instant');
    this.screens = {};
    this.current = null;
    this.game = null;
    this.mode = 'menu'; // menu | loading | play
    // frames a second, and the ping (for when there is company on the road)
    this.fpsEl = el('div', 'ui-fps', document.body, '<span class="fps-v"><b>--</b> FPS</span><i></i><span class="fps-ping"><em></em>Ping: soon</span>');
    this.fpsNum = this.fpsEl.querySelector('b');
    this.fpsEl.style.display = settings.data.showFps ? '' : 'none';
    document.body.classList.toggle('fps-on', !!settings.data.showFps);
    this.fpsAcc = 0;
    this.fpsN = 0;
    this.autosaveT = 0;
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    this.inventory = new InventoryUI(this);
    // the surfaces of signs and paper (drawn once)
    applySignTextures();
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  // ---------------------------------------------------------------- state
  get blocksMove() {
    return this.mode !== 'play' || (this.current && this.current !== 'sleep');
  }

  get blocksLook() {
    return this.blocksMove;
  }

  screen(name, build) {
    let s = this.screens[name];
    if (!s) {
      s = el('div', 'ui-screen', this.root);
      this.screens[name] = s;
    }
    s.innerHTML = '';
    s.className = 'ui-screen';
    this.nav = null;
    build(s);
    return s;
  }

  show(name) {
    for (const [k, s] of Object.entries(this.screens)) {
      if (k === name) continue;
      if (s.classList.contains('on')) {
        s.classList.remove('vis');
        s.classList.remove('on');
      }
    }
    const s = this.screens[name];
    this.current = name;
    if (!s) return;
    s.classList.add('on');
    requestAnimationFrame(() => s.classList.add('vis'));
  }

  hide() {
    if (this.current && this.screens[this.current]) {
      const s = this.screens[this.current];
      s.classList.remove('vis');
      s.classList.remove('on');
    }
    this.current = null;
  }

  // ---------------------------------------------------------------- building blocks
  // A sign face (guide green, or rest-area blue), optionally standing on posts.
  sign(parent, { cls = '', service = false, posts = 0 } = {}) {
    const s = el('div', 'sign' + (service ? ' service' : '') + (cls ? ' ' + cls : ''), parent);
    const face = el('div', 'sign-in', s);
    if (posts) el('div', 'posts' + (posts === 1 ? ' one' : ''), s);
    return face;
  }

  sounds(b) {
    b.addEventListener('pointerenter', () => this.game && this.game.audio && this.game.audio.uiSound('hover'));
  }

  click(b, fn) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game && this.game.audio && this.game.audio.uiSound('select');
      fn();
    });
    this.sounds(b);
    return b;
  }

  // A destination on a sign: the label, a small note, the arrow (degrees: 0 up, 90 right).
  line(parent, label, fn, { small = '', rot = 90, primary = false } = {}) {
    const b = el('button', 'sign-line' + (primary ? ' primary' : ''), parent, `<span class="t">${esc(label)}</span>${small ? `<small>${esc(small)}</small>` : ''}<span class="arrow" style="--rot:${rot}deg">${ARROW}</span>`);
    return this.click(b, fn);
  }

  // A link typed on paper.
  typed(parent, label, fn, primary = false) {
    return this.click(el('button', 'typed' + (primary ? ' primary' : ''), parent, esc(label)), fn);
  }

  // Older callers (the inventory) use item(): a typed link.
  item(parent, label, fn, small) {
    return this.typed(parent, label + (small ? ` (${small})` : ''), fn);
  }

  // A sheet of paper in the middle of the screen with a typed heading and a way back.
  doc(s, title, { sub = '', cls = '', back = null, backLabel = 'Back' } = {}) {
    s.classList.add('scr-doc');
    const p = el('div', 'paper doc' + (cls ? ' ' + cls : ''), s);
    const head = el('div', 'doc-head', p);
    el('h2', '', head, esc(title));
    if (sub) el('div', 'doc-sub', head, esc(sub));
    const body = el('div', 'doc-body', p);
    const foot = el('div', 'doc-foot', p);
    if (back) this.typed(foot, '← ' + backLabel, back);
    return { p, body, foot };
  }

  // Up and down keys walk through the choices on the current screen; Enter takes one.
  menuNav(container) {
    const items = [...container.querySelectorAll('.sign-line:not([disabled]), .typed, .stamp')];
    if (!items.length) return;
    const focus = (i) => {
      items.forEach((b) => b.classList.remove('kb'));
      this.navIndex = (i + items.length) % items.length;
      items[this.navIndex].classList.add('kb');
      items[this.navIndex].focus({ preventScroll: true });
    };
    this.navIndex = 0;
    this.nav = { items, focus };
    setTimeout(() => this.current && this.nav && this.nav.items === items && focus(0), 50);
  }

  // ---------------------------------------------------------------- title
  // Title backdrop: stills from the road that slowly pan and zoom, cross-fading every few seconds.
  showBackdrop() {
    if (this.backdrop) return;
    const b = (this.backdrop = el('div', 'ui-backdrop', document.body));
    this.liveSigns();
    try {
      this.depthView = new MenuBackdrop(b, MENU_SHOTS);
      return;
    } catch (e) {
      console.warn('title pictures without depth:', e.message || e);
    }
    const start = Math.floor(Math.random() * MENU_SHOTS.length);
    const slides = MENU_SHOTS.map((m) => {
      const d = el('div', 'ui-slide', b);
      d.style.backgroundImage = `url(${m.src})`;
      d.style.transformOrigin = m.origin;
      d.dataset.move = m.move;
      return d;
    });
    let i = start;
    const next = () => {
      const prev = slides.find((d) => d.classList.contains('on'));
      const d = slides[i % slides.length];
      // restart the camera move from its first frame
      d.classList.remove('moving');
      void d.offsetWidth;
      d.classList.add('on', 'moving');
      if (prev && prev !== d) setTimeout(() => prev.classList.remove('on'), 50);
      setTimeout(() => prev && prev !== d && prev.classList.remove('moving'), 3000);
      i++;
    };
    // show the first picture once it has loaded, so the menu never opens on a blank frame
    const img = new Image();
    img.onload = img.onerror = () => next();
    img.src = MENU_SHOTS[start].src;
    this.backdropTimer = setInterval(next, SLIDE_SECONDS * 1000);
  }

  // The signs answer the pointer: they turn a little towards it on their posts and shift against
  // the pictures behind (depth), and the light slides across their sheeting.
  liveSigns() {
    if (this.signsLive) return;
    this.signsLive = true;
    applySignTextures();
    const m = { x: 0, y: 0 };
    let raf = 0;
    const apply = () => {
      raf = 0;
      const root = document.documentElement.style;
      root.setProperty('--sheen', (0.5 + m.x * 0.45).toFixed(3));
      const ax = -m.y * 3.5,
        ay = m.x * 6;
      const ang = Math.hypot(ax, ay);
      for (const s of document.querySelectorAll('.title-sign, .pause-sign')) {
        s.style.rotate = ang > 0.05 ? `${(ax / ang).toFixed(3)} ${(ay / ang).toFixed(3)} 0 ${ang.toFixed(2)}deg` : 'none';
        s.style.translate = `${(-m.x * 10).toFixed(1)}px ${(-m.y * 6).toFixed(1)}px`;
      }
    };
    window.addEventListener('pointermove', (e) => {
      m.x = (e.clientX / window.innerWidth) * 2 - 1;
      m.y = (e.clientY / window.innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(apply);
    });
  }

  // The head of the title sign: NORTH over the route marker, the name, where the road goes.
  titleHead(face) {
    const h = el('div', 'title-head', face);
    el('div', 'title-marker', h, `<span class="plaque">NORTH</span><span class="shield">${shieldSvg(9)}</span>`);
    el('div', 'title-name', h, `<h1>Dust Road</h1><div class="title-dest"><span>Haven</span><b>${HAVEN_KM}</b></div>`);
  }

  // The language: two flags in the top corner of the title screens.
  langFlags(parent) {
    const w = el('div', 'lang-flags no-tr', parent);
    const bs = LANGS.map(([code, name]) => {
      const b = el('button', 'flag' + (lang() === code ? ' sel' : ''), w, `${FLAGS[code]}<span>${code.toUpperCase()}</span>`);
      b.setAttribute('aria-label', name);
      b.title = name;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.onclick = (e) => {
        e.stopPropagation();
        if (lang() === code) return;
        settings.set('language', code);
        bs.forEach((x) => x.classList.toggle('sel', x === b));
        this.game && this.game.audio && this.game.audio.uiSound && this.game.audio.uiSound('select');
      };
      return b;
    });
    return w;
  }

  // First screen: wait for a key/click (also unlocks audio and starts the title theme).
  showSplash() {
    this.mode = 'menu';
    this.screen('splash', (s) => {
      s.classList.add('scr-title');
      const face = this.sign(s, { cls: 'title-sign', posts: 2 });
      this.titleHead(face);
      el('div', 'title-press', s, 'Press any key');
      this.langFlags(s);
      const go = () => {
        window.removeEventListener('keydown', go, true);
        s.removeEventListener('pointerdown', go);
        this.unlockAudio();
        this.showTitle();
      };
      window.addEventListener('keydown', go, true);
      s.addEventListener('pointerdown', go);
    });
    this.show('splash');
  }

  async unlockAudio() {
    const a = this.game && this.game.audio;
    if (!a) return;
    await a.start();
    if (this.mode === 'menu') a.startMenuMusic();
  }

  showTitle() {
    this.mode = 'menu';
    const sum = hasSave() ? saveSummary() : null;
    this.screen('title', (s) => {
      s.classList.add('scr-title');
      const face = this.sign(s, { cls: 'title-sign', posts: 2 });
      this.titleHead(face);
      el('div', 'sign-rule', face);
      const m = el('div', 'title-lines', face);
      if (sum) this.line(m, 'Continue', () => this.go({ load: 1 }), { small: `Day ${sum.day} · ${(Math.max(0, sum.distance) / 1000).toFixed(1)} km`, rot: 0, primary: true });
      this.line(m, 'New game', () => this.showNewGame(), { rot: sum ? 45 : 0, primary: !sum });
      this.line(m, 'How to play', () => this.showHowTo(() => this.showTitle()));
      this.line(m, 'Settings', () => this.showSettings(() => this.showTitle()));
      this.line(m, 'Statistics', () => this.showCareer(() => this.showTitle()));
      this.line(m, 'Credits', () => this.showCredits());
      // what is new, on a sheet taped to the corner
      const f = el('div', 'paper tape title-flyer', s);
      f.innerHTML = `<div class="flyer-k">Notice · v${VERSION}</div>
        <p>The key turns by hand now. So do the turn signals, the parking brake and the door handles; whatever you can reach shows a dot when you look its way.</p>
        <p>The corner of the screen tells you what needs doing next.</p>
        <div class="flyer-next">Coming: songs for the radio, and company on the road.</div>`;
      el('div', 'title-foot', s, `v${VERSION} · ↑ ↓ and Enter work too`);
      this.langFlags(s);
      this.menuNav(m);
    });
    this.show('title');
  }

  showCredits() {
    this.screen('credits', (s) => {
      s.classList.add('scr-dim');
      const { body } = this.doc(s, 'Credits', { sub: 'Who made what', back: () => this.showTitle() });
      const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
      const ccby = link('http://creativecommons.org/licenses/by/4.0/', 'CC-BY-4.0');
      const oga = (path, text) => link('https://opengameart.org/content/' + path, text);
      body.innerHTML = `<p>The land, the buildings and the people are made in code when the game loads. The music and the songs on the radio were generated with AI music tools from prompts written for the game; most sound effects were made with ${link('https://elevenlabs.io/sound-effects', 'ElevenLabs')} text-to-sound, then cut, levelled and looped.</p>
        <p>The engine is "${oga('car-engine-loop-96khz-4s', 'Car Engine Loop 96kHz, 4s')}" by qubodup (${link('http://creativecommons.org/licenses/by/3.0/', 'CC-BY-3.0')}). The horn and the parking brake are from the "${oga('car-sound-effects-pack-low-quality', 'Car Sound Effects Pack')}" by GGBotNet (CC0). The emergency tone on AM 640 is the real Emergency Broadcast System signal (public domain, US government, via Wikimedia Commons).</p>
        <p>The '04 Kronberg is "Mercedes-Benz C-class W203 2007" by ${link('https://sketchfab.com/szymonpasterczyk734', 'szymonpasterczyk734')} (${ccby}): recoloured, given tyres, an engine bay, a boot battery and moving switches. The '88 Riverside is "88 American Sedan - Low poly model" by ${link('https://sketchfab.com/DanielZhabotinsky', 'Daniel Zhabotinsky')} (${ccby}). The old Beetle in some saves is "Beetle/Fusca (Version 1)" by ${link('https://sketchfab.com/soujagah', 'soujagah')} (${ccby}).</p>
        <p>Props: the oil drum from the Babylon.js assets (${ccby}); lamp post, barn lamp, fridge, sofa, plant, skull, flight helmet, barramundi, bellows camera and teacup from the Khronos glTF sample models (CC0 / ${ccby}); the player's body is the Ready Player Me avatar from the three.js examples, moved by Mixamo clips; boulders and twig cards from ez-tree by Daniel Greenheck (MIT); the grass carp from @so-chart/fish (ISC); a worn tyre from 3d-model-testingpublic (ISC). Tree bark from ${link('https://www.texturecan.com/', 'TextureCan')} and ${link('https://polyhaven.com/a/bark_brown_02', 'Poly Haven')} (CC0).</p>
        <p>Type: Overpass by the Overpass Project and Courier Prime by Alan Dague-Greene, both under the SIL Open Font License.</p>
        <p>Built with three.js, Rapier and Web Audio. Inspired by The Long Drive and a lot of empty road.</p>`;
    });
    this.show('credits');
  }

  // ---------------------------------------------------------------- new game: a trip sheet
  showNewGame() {
    const cfg = this.newCfg || (this.newCfg = { difficulty: 'normal', start: 'parts', car: 'w203', seed: String(Math.floor(Math.random() * 900000) + 100000) });
    this.screen('newgame', (s) => {
      s.classList.add('scr-dim', 'scr-board');
      const board = el('div', 'clipboard', s);
      el('div', 'clip', board);
      const p = el('div', 'paper sheet', board);
      el('div', 'sheet-head', p, `<h2>Trip sheet</h2><span>Route 9, northbound · ${HAVEN_KM} km to Haven</span>`);
      // two columns: the car on the left, the rest on the right
      const cols = el('div', 'sheet-cols', p);
      const L = el('div', 'sheet-col', cols);
      const R = el('div', 'sheet-col', cols);
      // the car: two photographs, the one you take ringed in pen
      el('div', 'sheet-label', L, '1. Car');
      const cars = el('div', 'polaroids', L);
      const pics = CAR_TYPE_LIST.map((t, i) => {
        const S = t.stats;
        const b = el(
          'button',
          'polaroid' + (t.id === cfg.car ? ' sel' : ''),
          cars,
          `<span class="pic" style="background-image:url(menu/car_${t.id}.webp)"></span><span class="cap">${esc(t.name)}</span><span class="spec"><span>${esc(S.engine)}</span> · <span>${S.power} hp</span> · <span>${esc(S.gearbox)}</span></span>`
        );
        b.style.setProperty('--tilt', (i % 2 ? 2.2 : -1.8) + 'deg');
        b.onclick = () => {
          pics.forEach((x) => x.classList.remove('sel'));
          b.classList.add('sel');
          cfg.car = t.id;
          blurb.textContent = t.blurb;
          this.game && this.game.audio && this.game.audio.uiSound('select');
        };
        this.sounds(b);
        return b;
      });
      const blurb = el('p', 'sheet-note', L, esc((CAR_TYPE_LIST.find((t) => t.id === cfg.car) || CAR_TYPE_LIST[0]).blurb));
      el('p', 'sheet-note dim', L, 'The other one waits somewhere up the road. Find it, fix it, drive whichever you like.');
      // ticked boxes
      const boxes = (label, list, cur, onPick) => {
        el('div', 'sheet-label', R, label);
        const row = el('div', 'boxes', R);
        const note = el('p', 'sheet-note', R);
        const bs = list.map(([v, title, desc]) => {
          const b = el('button', 'box' + (v === cur ? ' sel' : ''), row, `<i></i>${esc(title)}`);
          b.onclick = () => {
            bs.forEach((x) => x.classList.remove('sel'));
            b.classList.add('sel');
            note.textContent = desc;
            onPick(v);
            this.game && this.game.audio && this.game.audio.uiSound('select');
          };
          if (v === cur) note.textContent = desc;
          return b;
        });
      };
      boxes(
        '2. How hard',
        [
          ['easy', 'Easy', 'Slower hunger and thirst, gentler wear, fewer and weaker enemies, more to find.'],
          ['normal', 'Normal', 'As intended. Plan your fuel and keep the engine fed.'],
          ['hard', 'Hard', 'Everything wears faster, there is little to find and the nights are crowded.'],
        ],
        cfg.difficulty,
        (v) => (cfg.difficulty = v)
      );
      boxes(
        '3. The car is',
        [
          ['parts', 'In pieces', 'The body stands on its wheels in the garage. Everything else is in the house, the yard and a little way down the road.'],
          ['assembled', 'Ready to drive', 'Put together in the garage, with a little fuel in the tank.'],
        ],
        cfg.start,
        (v) => (cfg.start = v)
      );
      el('div', 'sheet-label', R, '4. Map no.');
      const sr = el('div', 'seed', R);
      const inp = el('input', 'seed-in', sr);
      inp.value = cfg.seed;
      inp.maxLength = 9;
      inp.spellcheck = false;
      inp.addEventListener('input', () => (cfg.seed = inp.value.replace(/\D/g, '').slice(0, 9)));
      this.typed(sr, 'another map', () => {
        cfg.seed = String(Math.floor(Math.random() * 900000) + 100000);
        inp.value = cfg.seed;
      });
      const foot = el('div', 'sheet-foot', p);
      this.typed(foot, '← Back', () => this.showTitle());
      const go = this.click(el('button', 'stamp', foot, 'Depart'), () => {
        const seed = +(cfg.seed || 1) || 1;
        const start = () => this.go({ seed, difficulty: cfg.difficulty, start: cfg.start, car: cfg.car, fresh: 1 });
        if (hasSave()) {
          const sum = saveSummary();
          const what = sum ? `day ${sum.day}, ${(Math.max(0, sum.distance) / 1000).toFixed(1)} km` : 'your current game';
          this.confirm('Erase your saved game?', `A new trip replaces the one you have saved (${what}). It cannot be loaded again.`, 'Erase it and go', start);
        } else start();
      });
      go.title = 'Start the drive';
    });
    this.show('newgame');
  }

  // A yellow warning sign over the current screen with two answers.
  confirm(title, text, okLabel, onOk) {
    const s = this.screens[this.current];
    if (!s) return onOk();
    const shade = el('div', 'confirm-shade', s);
    const c = el('div', 'warning', shade);
    el('div', 'warning-t', c, esc(title));
    el('p', '', c, esc(text));
    const a = el('div', 'warning-a', c);
    this.click(el('button', 'warn-btn', a, 'Cancel'), () => shade.remove());
    this.click(el('button', 'warn-btn go', a, esc(okLabel)), () => {
      shade.remove();
      onOk();
    });
  }

  // Navigate to a fresh page load that boots straight into the game.
  go(params) {
    this.game && this.game.audio && this.game.audio.stopMenuMusic && this.game.audio.stopMenuMusic();
    const q = new URLSearchParams({ play: '1', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    this.screen('fade', (s) => s.classList.add('scr-black'));
    this.show('fade');
    setTimeout(() => (location.search = '?' + q.toString()), 380);
  }

  // ---------------------------------------------------------------- statistics: a logbook page
  showCareer(back) {
    const c = readCareer();
    const km = (m) => (m / 1000).toFixed(1) + ' km';
    this.screen('career', (s) => {
      s.classList.add('scr-dim');
      const { body } = this.doc(s, 'Logbook', { sub: c.runs ? 'Every trip so far, added up' : 'No trips finished yet', back, cls: 'ruled-doc' });
      const hero = el('div', 'log-hero', body);
      for (const [v, lab] of [
        [(c.longest / 1000).toFixed(1), 'km, the longest trip'],
        [c.bestDays, 'days, the most'],
        [c.runs, c.runs === 1 ? 'trip' : 'trips'],
      ])
        el('div', '', hero, `<b>${esc(v)}</b><span>${esc(lab)}</span>`);
      const cols = el('div', 'log-cols', body);
      this.ledger(cols, 'Totals', [
        ['Distance', km(c.distance)],
        ['Days on the road', c.days],
        ['Deaths', c.deaths],
        ['Fuel burned', c.fuelUsed.toFixed(0) + ' l'],
        ['Killed', c.kills],
        ['Headshots', c.headshots],
        ['Things found', c.itemsLooted],
        ['Parts fitted', c.partsInstalled],
      ]);
      if (c.lastRun) {
        const r = c.lastRun;
        this.ledger(cols, 'Last trip', [
          ['Distance', km(r.distance || 0)],
          ['Days', r.daysSurvived || 1],
          ['Ended', r.cause ? causeText(r.cause) : 'Saved and left'],
        ]);
      }
    });
    this.show('career');
  }

  // Typed rows: a label, dots, the value.
  ledger(parent, title, rows) {
    const c = el('div', 'ledger', parent);
    el('h3', '', c, esc(title));
    for (const [k, v, cls] of rows) el('div', 'ledger-row' + (cls ? ' ' + cls : ''), c, `<span>${esc(k)}</span><i></i><b>${esc(v)}</b>`);
    return c;
  }

  // ---------------------------------------------------------------- settings
  showSettings(back, tab = 'graphics') {
    const d = settings.data;
    this.screen('settings', (s) => {
      s.classList.add('scr-dim');
      const { p, body } = this.doc(s, 'Settings', { back });
      const tabs = el('div', 'doc-tabs', p);
      p.insertBefore(tabs, body);
      for (const [k, lab] of [
        ['graphics', 'Picture'],
        ['audio', 'Sound'],
        ['controls', 'Controls'],
        ['gameplay', 'Game'],
      ]) {
        const b = el('button', k === tab ? 'sel' : '', tabs, lab);
        this.click(b, () => this.showSettings(back, k));
      }
      const set = (k, v) => {
        settings.set(k, v);
        this.applySettings(k);
      };
      if (tab === 'graphics') {
        this.seg(
          body,
          'Quality',
          [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']],
          d.quality,
          (v) => {
            if (v === 'custom') startCustom();
            set('quality', v);
            this.showSettings(back, 'graphics');
          },
          d.quality === 'custom' ? 'Each part of the picture on its own. Point at a choice to see it.' : 'A preset sets everything at once. Custom: choose each part yourself, with pictures.'
        );
        if (d.quality === 'custom') this.customGfx(body, set);
        this.range(body, 'Field of view', 70, 110, 1, d.hfov, (v) => set('hfov', v), (v) => v + '°');
        this.range(body, 'Render scale', 0.5, 1, 0.05, d.resolutionScale, (v) => set('resolutionScale', v), (v) => Math.round(v * 100) + '%');
        this.toggle(body, 'Dynamic resolution', d.dynamicResolution !== false, (v) => set('dynamicResolution', v));
        this.toggle(body, 'FPS and ping', d.showFps, (v) => set('showFps', v));
      } else if (tab === 'audio') {
        this.range(body, 'Everything', 0, 1, 0.01, d.masterVolume, (v) => set('masterVolume', v), pct);
        this.range(body, 'Effects', 0, 1, 0.01, d.sfxVolume, (v) => set('sfxVolume', v), pct);
        this.range(body, 'Wind, rain, animals', 0, 1, 0.01, d.ambientVolume, (v) => set('ambientVolume', v), pct);
        this.toggle(body, 'Background music', d.musicOn !== false, (v) => set('musicOn', v));
        this.range(body, 'Music', 0, 1, 0.01, d.scoreVolume ?? 0.6, (v) => set('scoreVolume', v), pct);
        this.range(body, 'Car stereo', 0, 1, 0.01, d.musicVolume, (v) => set('musicVolume', v), pct);
        this.seg(body, 'Listening on', [['headphones', 'Headphones'], ['speakers', 'Speakers']], d.sound3d || 'headphones', (v) => set('sound3d', v), 'Headphones: sound from all round you. Speakers: plain left and right.');
      } else if (tab === 'controls') {
        this.range(body, 'Mouse sensitivity', 0.2, 3, 0.05, d.sensitivity, (v) => set('sensitivity', v), (v) => v.toFixed(2));
        this.toggle(body, 'Invert vertical look', d.invertY, (v) => set('invertY', v));
        this.seg(body, 'Gearbox', [['auto', 'Automatic'], ['manual', 'Manual']], d.transmission, (v) => set('transmission', v), 'Manual: X and Z to shift.');
        el('h3', 'doc-h3', body, 'Keys · click one, then press the new key');
        const keys = el('div', 'keylist', body);
        for (const action of Object.keys(LABELS)) {
          const r = el('div', 'keylist-row', keys, `<span>${esc(LABELS[action])}</span>`);
          const k = el('button', 'keycap', r, esc(keyName(d.bindings[action] || DEFAULT_BINDINGS[action])));
          k.onclick = () => this.listenKey(action, k);
        }
        const rr = el('div', 'doc-row', body);
        this.typed(rr, 'Put all keys back as they were', () => {
          settings.set('bindings', { ...DEFAULT_BINDINGS });
          this.showSettings(back, 'controls');
        });
      } else {
        this.seg(body, 'Language', LANGS, lang(), (v) => set('language', v)).classList.add('no-tr');
        this.seg(body, 'Units', [['metric', 'Kilometres'], ['imperial', 'Miles']], d.units, (v) => set('units', v));
        this.toggle(body, 'Head bob', d.headBob, (v) => set('headBob', v));
        this.toggle(body, 'Tutorial on a new game', d.tutorial !== false, (v) => set('tutorial', v));
      }
    });
    this.show('settings');
  }

  // Custom picture settings: a card for each, with a picture of the choice (pointing at another
  // choice shows that one).
  customGfx(body, set) {
    const cur = () => settings.data.custom || {};
    const grid = el('div', 'gfx-grid', body);
    for (const [k, label, opts, note, live] of GFX_OPTIONS) {
      const card = el('div', 'gfx-card', grid);
      // (shadows, glow, sun rays and heat haze have no example picture yet)
      const pic = el('div', 'gfx-pic', GFX_PICTURES.has(k) ? card : null);
      const tag = el('span', 'gfx-tag', pic);
      const show = (v) => {
        pic.style.backgroundImage = `url(settings/${k}_${v}.webp)`;
        const o = opts.find((x) => String(x[0]) === String(v));
        tag.textContent = o ? o[1] : '';
      };
      show(gfx()[k]);
      el('div', 'gfx-k', card, `${esc(label)}${live ? '' : '<small>next start</small>'}`);
      const w = el('div', 'opts', card);
      const bs = opts.map(([v, lab]) => {
        const b = el('button', 'opt' + (String(v) === String(gfx()[k]) ? ' sel' : ''), w, esc(lab));
        b.addEventListener('pointerenter', () => show(v));
        b.addEventListener('pointerleave', () => show(gfx()[k]));
        this.click(b, () => {
          bs.forEach((x) => x.classList.remove('sel'));
          b.classList.add('sel');
          set('custom', { ...gfx(), ...cur(), [k]: v });
          show(v);
        });
        return b;
      });
      el('p', 'gfx-note', card, esc(note));
    }
  }

  row(parent, label, note) {
    return el('div', 'doc-row', parent, `<span class="doc-k">${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}</span>`);
  }

  // Options typed in a row; the chosen one ringed in pen.
  seg(parent, label, opts, cur, onPick, note) {
    const r = this.row(parent, label, note);
    const w = el('div', 'opts', r);
    const bs = opts.map(([v, lab]) => {
      const b = el('button', 'opt' + (v === cur ? ' sel' : ''), w, esc(lab));
      this.click(b, () => {
        bs.forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        onPick(v);
      });
      return b;
    });
    return w;
  }

  toggle(parent, label, cur, onPick) {
    this.seg(parent, label, [[true, 'On'], [false, 'Off']], cur, onPick);
  }

  range(parent, label, min, max, step, cur, onChange, fmt) {
    const r = this.row(parent, label);
    const w = el('div', 'slider', r);
    const i = el('input', '', w);
    i.type = 'range';
    i.min = min;
    i.max = max;
    i.step = step;
    i.value = cur;
    const o = el('output', '', w, fmt(+cur));
    i.oninput = () => {
      o.textContent = fmt(+i.value);
      onChange(+i.value);
    };
  }

  listenKey(action, btn) {
    if (this.listening) this.listening.btn.classList.remove('listening');
    btn.classList.add('listening');
    btn.textContent = 'press a key';
    this.listening = { action, btn };
  }

  applySettings(k) {
    const g = this.game;
    const d = settings.data;
    if (k === 'showFps') {
      this.fpsEl.style.display = d.showFps ? '' : 'none';
      document.body.classList.toggle('fps-on', !!d.showFps);
    }
    if (!g) return;
    if (/Volume$/.test(k) && g.audio && g.audio.applyVolumes) g.audio.applyVolumes();
    if (k === 'musicOn' && g.audio && g.audio.syncMusic) g.audio.syncMusic();
    // on the title screen there is no world yet: the rest applies when a game starts
    if (!g.renderer) return;
    if (k === 'transmission' && g.car) g.car.dyn.automatic = d.transmission === 'auto';
    if (k === 'resolutionScale' && g.renderer.setScale) g.renderer.setScale(d.resolutionScale);
    if (k === 'quality' || k === 'custom') {
      // what can change at once does; distance and antialiasing wait for the next start
      const msaa = g.renderer.q.msaa;
      g.renderer.setQuality(d.quality);
      g.renderer.q.msaa = msaa;
      g.renderer.applyPassSettings();
      const q = g.renderer.q;
      if (g.env && g.env.setShadows) g.env.setShadows(q.shadowsOn, q.shadow, q.shadowExtent);
      if (g.scatter && g.scatter.setPlantShadows) g.scatter.setPlantShadows(q.plantShadows);
    }
  }

  // ---------------------------------------------------------------- how to play: the manual
  // Six photographs from the road pinned to the page, each with what to do and the keys for it,
  // then the full list of keys.
  showHowTo(back) {
    const d = settings.data;
    const K = (a) => keyName(d.bindings[a] || DEFAULT_BINDINGS[a]);
    this.screen('howto', (s) => {
      s.classList.add('scr-dim');
      const { body } = this.doc(s, "Driver's manual", { sub: `Route 9, northbound. Haven is ${HAVEN_KM} km up the road, and the road goes on past it.`, back, cls: 'manual' });
      const grid = el('div', 'howto-grid', body);
      for (const [pic, title, text, keys] of [
        ['roadside', 'Drive north', 'Gas stations, diners, motels and farms line the road. Stop, look around, take what helps.', [[`${K('forward')} ${K('left')} ${K('back')} ${K('right')}`, 'drive'], [K('handbrake'), 'handbrake']]],
        ['breakdown', 'Fix the car', 'Hold R on a part to take it off. Carry one to the car and press E where it goes.', [[`${K('reload')} hold`, 'unbolt'], [K('interact'), 'fit']]],
        ['pushing', 'Keep her fed', 'Open the filler flap and the cap, hold a jerry can to it and pour. Some pumps still work. Oil and water matter too.', [[`${K('interact')}`, 'open'], ['LMB', 'pour']]],
        ['vista', 'Everything by hand', 'In the seat, look at the key and hold E. Lights, signals, the parking brake and the doors work the same way.', [[`${K('interact')} hold`, 'start'], [K('lights'), 'headlights']]],
        ['campfire', 'Stay alive', 'Food, water, rest and warmth run down. Sleep in the car, a tent or a bed. Nights are dark and not empty.', [[K('sleep'), 'sleep'], [K('flashlight'), 'flashlight']]],
        ['fishing', 'Your things', 'Pick things up, stow them, open the backpack. Notes go in the journal, places on the road atlas.', [[K('interact'), 'take'], [K('stow'), 'stow'], [K('inventory'), 'backpack'], [K('journal'), 'journal']]],
      ]) {
        const c = el('div', 'howto-card', grid);
        const ph = el('div', 'howto-pic', c);
        ph.style.backgroundImage = `url(menu/${pic}.webp)`;
        el('div', 'howto-t', c, esc(title));
        el('p', 'howto-p', c, esc(text));
        const kr = el('div', 'howto-keys', c);
        for (const [k, what] of keys) el('span', '', kr, `<kbd>${esc(k)}</kbd>${esc(what)}`);
      }
      el('h3', 'doc-h3', body, 'Keys');
      const keys = el('div', 'keylist cols', body);
      for (const action of Object.keys(LABELS)) el('div', 'keylist-row', keys, `<span>${esc(LABELS[action])}</span><kbd>${esc(keyName(d.bindings[action] || DEFAULT_BINDINGS[action]))}</kbd>`);
      for (const [k, t] of [
        ['LMB', 'Use what you hold'],
        ['RMB', 'Turn it · lean in, in the car'],
        ['Wheel', 'Hold it out or nearer'],
        ['1', 'Fists'],
      ])
        el('div', 'keylist-row', keys, `<span>${esc(t)}</span><kbd>${esc(k)}</kbd>`);
    });
    this.show('howto');
  }

  // ---------------------------------------------------------------- loading and the first screen
  showLoading() {
    this.mode = 'loading';
    this.screen('loading', (s) => {
      s.classList.add('scr-black', 'scr-loading');
      const c = el('div', 'load', s);
      el('div', 'shield load-shield', c, shieldSvg(9));
      el('div', 'load-t', c, 'Route 9 · northbound');
      const road = el('div', 'load-road', c);
      this.loadFill = el('div', 'load-fill', road);
      this.loadFill.style.width = '2%';
      this.loadText = el('div', 'load-text', c, 'Starting');
      const tip = el('div', 'paper load-tip', s);
      tip.innerHTML = `<b>From the road</b>${esc(TIPS[Math.floor(Math.random() * TIPS.length)])}`;
    });
    this.show('loading');
  }

  progress(text, p) {
    if (this.loadFill) this.loadFill.style.width = Math.round(Math.max(0.02, p) * 100) + '%';
    if (this.loadText) this.loadText.textContent = text;
  }

  // The first screen of a run: a note left on the bench, a card with the keys, the world
  // behind. Later (first = false), just a way back in.
  showClickToPlay(first = true) {
    this.mode = 'play';
    const g = this.game;
    this.screen('click', (s) => {
      s.classList.add('scr-intro');
      if (first && g) {
        const name = g.car ? g.car.type.short || g.car.type.name : 'car';
        const loaded = !!g.load;
        const km = Math.max(0, (g.focusPoint().z + g.origin.z) / 1000);
        const parts = !loaded && g.startMode === 'parts';
        const note = el('div', 'paper ruled intro-note', s);
        if (loaded) {
          note.innerHTML = `<div class="intro-date">Day ${g.env.day}, ${hhmm(g.env.time)} · ${km.toFixed(1)} km up Route 9</div>
            <p>Back on the road. Everything is where you left it.</p><p>The corner of the screen says what needs doing.</p>`;
        } else {
          note.innerHTML = `<div class="intro-date">Day 1 · the homestead</div>
            <p>${
              parts
                ? `The ${esc(name)} is in the garage, half of her in pieces. The parts are on the shelves, in the house and out in the yard. Put her back together, find some fuel, and get north to Haven: ${HAVEN_KM} km up Route 9.`
                : `The ${esc(name)} is in the garage and she runs, more or less. There is a little fuel in her. Find more, and get north to Haven: ${HAVEN_KM} km up Route 9.`
            }</p><p>Don't drive at night if you can help it.</p><div class="intro-sig">R.</div>`;
        }
      }
      el('div', 'intro-go', s, first ? 'Click to begin' : 'Click to go on');
      if (g && g.hud) g.hud.root.classList.add('intro');
      s.addEventListener('click', () => this.resume());
    });
    this.show('click');
  }

  resume() {
    this.hide();
    if (this.game && this.game.hud && this.game.hud.root) this.game.hud.root.classList.remove('intro');
    if (this.game) this.game.paused = false;
    input.lock();
    this.game && this.game.audio && this.game.audio.start();
  }

  onLockChange() {
    const locked = !!document.pointerLockElement;
    if (this.mode !== 'play' || !this.game) return;
    // Escape out of photo mode lands on the pause menu like anywhere else
    if (!locked && this.game.photo && this.game.photo.active) this.game.photo.exit();
    if (!locked && !this.current && !this.game.player.dead) this.showPause();
  }

  // ---------------------------------------------------------------- pause: a rest area
  showPause() {
    const g = this.game;
    g.paused = true;
    this.liveSigns();
    if (document.pointerLockElement) document.exitPointerLock();
    this.screen('pause', (s) => {
      s.classList.add('scr-pause');
      const face = this.sign(s, { cls: 'pause-sign', service: true, posts: 2 });
      el('div', 'pause-head', face, `<h1>Rest Area</h1><span>Day ${g.env.day} · ${hhmm(g.env.time)}</span>`);
      el('div', 'sign-rule', face);
      const m = el('div', 'title-lines', face);
      this.line(m, 'Back on the road', () => this.resume(), { rot: 0, primary: true });
      this.line(m, 'Save the game', () => {
        const ok = writeSave(g);
        g.hud && g.hud.toast(ok ? 'Saved' : 'Could not save', ok ? '' : 'warn');
        this.resume();
      });
      if (g.tutorial && g.tutorial.active)
        this.line(m, 'Skip the tutorial', () => {
          g.tutorial.finish();
          this.resume();
        });
      this.line(m, 'Journal', () => this.showJournal(() => this.showPause()));
      this.line(m, "Driver's manual", () => this.showHowTo(() => this.showPause()));
      this.line(m, settings.data.musicOn === false ? 'Music: off' : 'Music: on', () => {
        g.audio && g.audio.toggleMusic();
        this.showPause();
      }, { small: keyName(settings.data.bindings.music || 'KeyU') });
      this.line(m, 'Settings', () => this.showSettings(() => this.showPause()));
      this.line(m, 'Main menu', () => this.confirm('Leave for the main menu?', 'The game is saved first. Anything since then is kept.', 'Save and leave', () => {
        writeSave(g);
        location.search = '';
      }), { rot: 270 });
      el('div', 'pause-foot', s, `Map no. ${g.seed} · ${g.difficulty.label}`);
      this.menuNav(m);
    });
    this.show('pause');
  }

  // A short line at the bottom of the screen (in the menus, where there is no HUD).
  note(text) {
    if (!this.noteEl) this.noteEl = el('div', 'ui-note', this.root);
    this.noteEl.textContent = text;
    this.noteEl.classList.add('on');
    clearTimeout(this._noteT);
    this._noteT = setTimeout(() => this.noteEl.classList.remove('on'), 1600);
  }

  // ---------------------------------------------------------------- journal: a notebook
  showJournal(back) {
    const g = this.game;
    const p = g.player,
      car = g.car,
      st = g.stats;
    if (!back) {
      g.paused = true;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    const imperial = settings.data.units === 'imperial';
    const dist = (m) => (imperial ? (m / 1609.34).toFixed(1) + ' mi' : (m / 1000).toFixed(1) + ' km');
    // a value written as a row of tally boxes, the low ones in red pen
    const gauge = (parent, label, v, low, extra = '') => {
      const n = Math.round(Math.max(0, Math.min(1, v)) * 10);
      el('div', 'gauge' + (v < low ? ' low' : ''), parent, `<span>${esc(label)}</span><i>${'■'.repeat(n)}<em>${'□'.repeat(10 - n)}</em></i><b>${extra || Math.round(v * 100) + '%'}</b>`);
    };
    this.screen('journal', (s) => {
      s.classList.add('scr-dim');
      const book = el('div', 'notebook', s);
      const left = el('div', 'paper ruled page', book);
      const right = el('div', 'paper ruled page', book);
      el('div', 'page-date', left, `Day ${g.env.day}, ${hhmm(g.env.time)} · ${esc(biomeName(g.env.biome))} · ${esc(g.env.weatherName)}`);
      el('h3', '', left, 'Me');
      gauge(left, 'Health', p.health / 100, 0.3);
      gauge(left, 'Food', p.food / 100, 0.25);
      gauge(left, 'Water', p.water / 100, 0.25);
      gauge(left, 'Rest', p.energy / 100, 0.2);
      if (p.bleeding > 0.05) el('div', 'page-line red', left, `Bleeding, ${p.bleeding > 1 ? 'badly' : 'a little'}`);
      const ia = g.interaction;
      el('div', 'page-line', left, `.38 cartridges: ${ia.ammo['38'] || 0} · 12 ga shells: ${ia.ammo['12'] || 0}`);
      el('h3', '', left, esc(car.type.name));
      // a part not on the car says so instead of a worrying 0%
      const fitted = (id, label, v, low, extra) => (car.parts[id] && !car.isInstalled(id) ? el('div', 'gauge off', left, `<span>${esc(label)}</span><i></i><b>not on</b>`) : gauge(left, label, v, low, extra));
      gauge(left, 'Fuel', car.fuel / car.fuelCap, 0.15, `${car.fuel.toFixed(1)} l`);
      gauge(left, 'Oil', car.oil / car.oilCap, 0.3, `${car.oil.toFixed(1)} l`);
      fitted('battery', 'Battery', car.battery, 0.2);
      fitted('engine', 'Engine', car.engineCondition, 0.35);
      fitted('fanbelt', 'Belt', car.fanbeltCondition, 0.3);
      if (car.parts.sparkplugs) fitted('sparkplugs', 'Spark plugs', car.partCond('sparkplugs'), 0.3);
      if (car.coolantCap) fitted('radiator', 'Coolant', car.coolant / car.coolantCap, 0.3, `${car.coolant.toFixed(1)} l`);
      const tyres = car.dyn.wheels.filter((w) => w.installed);
      const tc = tyres.length ? tyres.reduce((m, w) => Math.min(m, car.parts[w.id].condition ?? 1), 1) : 0;
      gauge(left, 'Worst tyre', tc, 0.25);
      const missing = Object.keys(car.parts).filter((id) => !car.isInstalled(id));
      if (missing.length) el('div', 'page-line red', left, `${missing.length} part${missing.length > 1 ? 's' : ''} not on the car`);
      // the right page: this trip, then the notes found
      el('h3', '', right, 'This trip');
      this.ledger(right, '', [
        ['Distance', dist(st.distance)],
        ['Odometer', dist(car.odometer * 1000)],
        ['Days', st.daysSurvived],
        ['Top speed', imperial ? Math.round(st.maxSpeed / 1.609) + ' mph' : Math.round(st.maxSpeed) + ' km/h'],
        ['Fuel burned', st.fuelUsed.toFixed(1) + ' l'],
        ['Places', st.placesVisited],
        ['Things found', st.itemsLooted],
        ['Parts fitted', st.partsInstalled],
        ['Killed · headshots', `${st.kills} · ${st.headshots}`],
        ['Meals · drinks', `${st.meals} · ${st.drinks}`],
        ['Crashes', st.crashes],
      ]);
      const story = g.story;
      if (story) {
        el('h3', '', right, `Notes found · ${story.found.length} of ${NOTES.length}`);
        if (!story.found.length) el('div', 'page-line dim', right, 'None yet. People leave notes in houses, diners and wrecks.');
        for (const id of story.found) {
          const n = story.noteById(id);
          const b = el('button', 'page-note', right, `<b>${esc(n.title)}</b> ${esc(n.text.split('\n')[0].slice(0, 70))}…`);
          b.onclick = () => this.showNote(n, () => this.showJournal(back));
        }
      }
      const foot = el('div', 'notebook-foot', book);
      this.typed(foot, back ? '← Back' : `Close (${keyName(settings.data.bindings.journal)})`, () => (back ? back() : this.resume()));
    });
    this.show('journal');
  }

  // ---------------------------------------------------------------- road atlas
  // The strip map of Route 9: drag to move, wheel to zoom, click to pin a note.
  showAtlas() {
    const g = this.game;
    const A = g.atlas;
    g.paused = true;
    if (document.pointerLockElement) document.exitPointerLock();
    const here = A.here();
    const view = this.atlasView || { s: 0.06 };
    view.cx = here.x;
    view.cz = here.z;
    this.atlasView = view;
    let pending = null; // world point waiting for a note
    let layout = null;
    this.screen('atlas', (s) => {
      s.classList.add('scr-dim', 'scr-atlas');
      const desk = el('div', 'atlas', s);
      const wrap = el('div', 'atlas-map paper', desk);
      el('div', 'atlas-title', wrap, `<span class="shield">${shieldSvg(9)}</span><b>Road atlas</b><span>${Math.max(0, HAVEN_KM - here.z / 1000).toFixed(0)} km to Haven · day ${g.env.day}</span>`);
      const cv = el('canvas', '', wrap);
      const side = el('div', 'paper ruled atlas-side', desk);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const draw = () => {
        const r = cv.getBoundingClientRect();
        cv.width = Math.max(10, Math.round(r.width * dpr));
        cv.height = Math.max(10, Math.round(r.height * dpr));
        layout = drawAtlas(cv, g, { cx: view.cx, cz: view.cz, s: view.s * dpr }, { dpr });
        if (pending) {
          const x = cv.width / 2 - (pending.x - view.cx) * view.s * dpr,
            y = cv.height / 2 - (pending.z - view.cz) * view.s * dpr;
          const c = cv.getContext('2d');
          c.strokeStyle = '#b0331f';
          c.lineWidth = 2 * dpr;
          c.beginPath();
          c.arc(x, y, 7 * dpr, 0, Math.PI * 2);
          c.stroke();
        }
      };
      // notes and photos
      const list = () => {
        side.innerHTML = '';
        el('h3', '', side, 'Notes');
        const form = el('div', 'atlas-form', side);
        const inp = el('input', 'atlas-input', form);
        inp.placeholder = pending ? 'a note for the ringed spot…' : 'a note for where you are…';
        inp.maxLength = 140;
        inp.spellcheck = false;
        inp.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && inp.value.trim()) add(inp.value.trim());
          if (e.key === 'Escape') this.resume();
        });
        this.typed(form, pending ? 'pin it there' : 'pin it here', () => inp.value.trim() && add(inp.value.trim()));
        if (pending) inp.focus();
        if (!A.notes.length) el('div', 'page-line dim', side, 'Click the map to ring a spot, or pin a note where you stand: fuel, water, a good camp, trouble.');
        A.notes.forEach((n, i) => {
          const r = el('div', 'atlas-note', side, `<b>${i + 1}.</b><span>${esc(n.text)}<small>day ${n.day} · ${Math.max(0, HAVEN_KM - n.z / 1000).toFixed(1)} km to Haven</small></span>`);
          r.onclick = () => {
            view.cx = n.x;
            view.cz = n.z;
            draw();
          };
          const x = el('button', 'atlas-del', r, '×');
          x.title = 'Rub it out';
          x.onclick = (e) => {
            e.stopPropagation();
            A.removeNote(n);
            list();
            draw();
          };
        });
        const photos = A.photos.filter((p) => p.seed === g.seed);
        if (photos.length) {
          el('h3', '', side, `Photos · ${photos.length}`);
          const grid = el('div', 'atlas-photos', side);
          for (const ph of photos) {
            const im = el('img', '', grid);
            im.src = ph.thumb;
            im.title = `Day ${ph.day}`;
            im.onclick = () => {
              view.cx = ph.x;
              view.cz = ph.z;
              draw();
              this.showPhoto(ph);
            };
          }
        }
        const foot = el('div', 'atlas-foot', side);
        this.typed(foot, 'where am I', () => {
          const h = A.here();
          view.cx = h.x;
          view.cz = h.z;
          draw();
        });
        this.typed(foot, `close (${keyName(settings.data.bindings.atlas || 'KeyM')})`, () => this.resume());
      };
      const add = (text) => {
        const at = pending || A.here();
        A.addNote(at.x, at.z, text);
        pending = null;
        g.audio && g.audio.play('pocket', { volume: 0.5 });
        list();
        draw();
      };
      // drag, zoom, click
      let drag = null;
      cv.addEventListener('pointerdown', (e) => {
        drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: 0 };
        cv.setPointerCapture(e.pointerId);
      });
      cv.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x,
          dy = e.clientY - drag.y;
        drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
        view.cx = drag.cx + dx / view.s;
        view.cz = drag.cz + dy / view.s;
        draw();
      });
      cv.addEventListener('pointerup', (e) => {
        const d = drag;
        drag = null;
        if (!d || d.moved > 4 || !layout) return;
        const r = cv.getBoundingClientRect();
        const px = (e.clientX - r.left) * dpr,
          py = (e.clientY - r.top) * dpr;
        const hit = layout.hits.find((h) => Math.hypot(h.x - px, h.y - py) < h.r);
        if (hit && hit.kind === 'photo') return this.showPhoto(hit.photo);
        if (hit && hit.kind === 'note') {
          g.hud && g.hud.toast(hit.note.text);
          return;
        }
        pending = layout.toWorld(px, py);
        list();
        draw();
      });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        const mx = e.clientX - r.left - r.width / 2,
          my = e.clientY - r.top - r.height / 2;
        const k = Math.exp(-e.deltaY * 0.0015);
        const s1 = Math.min(0.6, Math.max(0.004, view.s * k));
        // keep the point under the cursor where it is
        view.cx += -mx / view.s + mx / s1;
        view.cz += -my / view.s + my / s1;
        view.s = s1;
        draw();
      });
      el('div', 'atlas-help', s, 'drag to move · wheel to zoom · click to ring a spot');
      list();
      requestAnimationFrame(draw);
    });
    this.show('atlas');
  }

  // A photo from the atlas, big, with when it was taken.
  showPhoto(ph) {
    const s = this.screens.atlas;
    if (!s) return;
    const old = s.querySelector('.atlas-photo');
    if (old) old.remove();
    const box = el('div', 'atlas-photo', s);
    const im = el('img', '', box);
    im.src = ph.thumb;
    el('div', 'atlas-photo-cap', box, `Day ${ph.day}, ${hhmm(ph.time || 12)} · click to put it back`);
    box.onclick = () => box.remove();
  }

  // ---------------------------------------------------------------- notes found on the road
  showNote(n, back) {
    const g = this.game;
    if (!back) {
      g.paused = true;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    this.screen('note', (s) => {
      s.classList.add('scr-dim');
      const paper = el('div', 'paper ruled found-note', s);
      el('div', 'found-title', paper, esc(n.title));
      el('div', 'found-text', paper, esc(n.text).replace(/\n/g, '<br>'));
      el('div', 'found-by', paper, '— ' + esc(n.by));
      const idx = NOTES.findIndex((x) => x.id === n.id);
      const foot = el('div', 'found-foot', s);
      el('span', '', foot, `Note ${idx + 1} of ${NOTES.length} · kept in your journal`);
      this.typed(foot, back ? '← Back' : 'Put it away', () => (back ? back() : this.resume()));
    });
    this.show('note');
  }

  // ---------------------------------------------------------------- the end of a run
  // Route 9 from the homestead to Haven, as a strip of road with where you got to on it.
  routeBar(parent, km) {
    const f = Math.min(1, km / HAVEN_KM);
    el(
      'div',
      'end-road',
      parent,
      `<div class="end-strip"><i style="width:${(f * 100).toFixed(1)}%"></i><b style="left:${(f * 100).toFixed(1)}%"><span>${km.toFixed(1)} km</span></b></div><div class="end-ends"><span>Homestead</span><span>${f >= 1 ? 'Haven' : `Haven, ${(HAVEN_KM - km).toFixed(0)} km on`}</span></div>`
    );
  }

  endNumbers(parent, list) {
    const n = el('div', 'end-nums', parent);
    for (const [v, lab] of list) el('div', '', n, `<b>${esc(v)}</b><span>${esc(lab)}</span>`);
  }

  showEnding() {
    const g = this.game;
    g.paused = true;
    if (document.pointerLockElement) document.exitPointerLock();
    const st = g.stats;
    const km = Math.max(0, st.distance / 1000);
    this.screen('ending', (s) => {
      s.classList.add('scr-end', 'won');
      const box = el('div', 'end', s);
      const face = this.sign(box, { cls: 'city-sign' });
      el('div', 'city', face, `<b>Haven</b><span>City limit</span><small>Pop. 214</small>`);
      el('div', 'end-cause', box, `You reached the gate on day ${st.daysSurvived}, with ${g.story ? g.story.found.length : 0} of ${NOTES.length} notes from the road.`);
      this.routeBar(box, Math.max(km, HAVEN_KM));
      this.endNumbers(box, [
        [km.toFixed(1), 'km driven'],
        [st.daysSurvived, st.daysSurvived === 1 ? 'day' : 'days'],
        [st.fuelUsed.toFixed(0), 'litres burned'],
        [st.placesVisited, 'places'],
      ]);
      const face2 = this.sign(box, { cls: 'end-sign' });
      this.line(face2, 'Keep driving north', () => this.resume(), { rot: 0, primary: true });
      this.line(face2, 'Main menu', () => {
        recordRun(st, null);
        deleteSave();
        location.search = '';
      }, { rot: 270 });
    });
    this.show('ending');
  }

  showSleep(on) {
    if (on) {
      this.screen('sleep', (s) => {
        s.classList.add('scr-sleep');
        const c = el('div', 'sleep', s);
        this.sleepText = el('div', 'sleep-t', c, 'Asleep');
      });
      this.show('sleep');
    } else if (this.current === 'sleep') this.hide();
  }

  // END over the route marker, as at the end of a highway; what did it, how far, where it stopped.
  showDeath(cause) {
    const g = this.game;
    const st = g.stats;
    recordRun(st, cause);
    deleteSave();
    if (document.pointerLockElement) document.exitPointerLock();
    const imperial = settings.data.units === 'imperial';
    const km = Math.max(0, st.distance / 1000);
    this.screen('death', (s) => {
      s.classList.add('scr-end');
      const box = el('div', 'end', s);
      el('div', 'end-marker', box, `<span class="plaque end-plaque">END</span><span class="shield">${shieldSvg(9)}</span><i class="end-post"></i>`);
      el('h2', 'end-t', box, esc(causeText(cause)));
      el('div', 'end-cause', box, `Day ${st.daysSurvived}, ${hhmm(g.env.time)} · ${imperial ? (km / 1.609).toFixed(1) + ' miles' : km.toFixed(1) + ' km'} up Route 9`);
      this.routeBar(box, km);
      this.endNumbers(box, [
        [imperial ? (km / 1.609).toFixed(1) : km.toFixed(1), imperial ? 'miles' : 'km'],
        [st.daysSurvived, st.daysSurvived === 1 ? 'day' : 'days'],
        [st.placesVisited, 'places'],
        [st.itemsLooted, 'things found'],
      ]);
      const small = [];
      if (st.kills) small.push(`${st.kills} killed${st.headshots ? `, ${st.headshots} by a headshot` : ''}`);
      if (st.partsInstalled) small.push(`${st.partsInstalled} parts fitted`);
      if (st.meals + st.drinks) small.push(`${st.meals} meals, ${st.drinks} drinks`);
      if (st.maxSpeed > 5) small.push(`top speed ${imperial ? Math.round(st.maxSpeed / 1.609) + ' mph' : Math.round(st.maxSpeed) + ' km/h'}`);
      if (small.length) el('div', 'end-small', box, esc(small.join(' · ')));
      const face = this.sign(box, { cls: 'end-sign' });
      this.line(face, 'Try again', () => this.go({ seed: g.seed, difficulty: g.difficultyName, start: g.startMode, car: g.startCarType, fresh: 1 }), { rot: 0, primary: true });
      this.line(face, 'A new road', () => this.go({ seed: Math.floor(Math.random() * 900000) + 100000, difficulty: g.difficultyName, start: g.startMode, car: g.startCarType, fresh: 1 }), { rot: 45 });
      this.line(face, 'Main menu', () => (location.search = ''), { rot: 270 });
      this.menuNav(face);
    });
    this.show('death');
  }

  // ---------------------------------------------------------------- per-frame (in play)
  update(dt) {
    const g = this.game;
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      const fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsNum.textContent = fps;
      this.fpsEl.classList.add('live');
      this.fpsEl.dataset.band = fps >= 55 ? 'ok' : fps >= 30 ? 'mid' : 'low';
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    if (!g || this.mode !== 'play' || g.paused || g.player.dead) return;
    this.autosaveT += dt;
    // autosave every few minutes at a calm moment (standing, or the car nearly still), in the
    // browser's idle time, so writing the save never lands in the middle of a drive
    const calm = (g.player.seat ? Math.abs(g.car.speedKmh) < 8 : true) && !g.interaction.held;
    if (this.autosaveT > 240 && (calm || this.autosaveT > 330) && !this.savePending) {
      this.savePending = true;
      const go = () => {
        this.savePending = false;
        this.autosaveT = 0;
        if (writeSave(g)) g.hud && g.hud.toast('Saved', 'quiet');
      };
      if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 });
      else setTimeout(go, 0);
    }
    if (this.current === 'sleep' && this.sleepText) this.sleepText.textContent = `Asleep · ${hhmm(g.env.time)}`;
  }

  onKey(e) {
    if (this.listening) {
      e.preventDefault();
      e.stopPropagation();
      const { action, btn } = this.listening;
      this.listening = null;
      btn.classList.remove('listening');
      if (e.code !== 'Escape') {
        const b = { ...settings.data.bindings, [action]: e.code };
        settings.set('bindings', b);
      }
      btn.textContent = keyName(settings.data.bindings[action]);
      return;
    }
    // music on/off from anywhere (not while typing)
    if (e.code === (settings.data.bindings.music || 'KeyU') && !/INPUT|TEXTAREA/.test((e.target && e.target.tagName) || '') && this.game && this.game.audio && this.game.audio.toggleMusic) {
      const on = this.game.audio.toggleMusic();
      if (this.game.hud && this.mode === 'play') this.game.hud.toast(on ? 'Music on' : 'Music off');
      else this.note(on ? 'Music on' : 'Music off');
      if (this.current === 'pause') this.showPause();
    }
    // arrow keys through the sign on the title, pause and end screens
    if (this.nav && ['title', 'pause', 'death'].includes(this.current) && !/INPUT|TEXTAREA/.test((e.target && e.target.tagName) || '')) {
      const { items, focus } = this.nav;
      if (e.code === 'ArrowDown' || (e.code === 'KeyS' && this.mode === 'menu')) {
        focus(this.navIndex + 1);
        this.game && this.game.audio && this.game.audio.uiSound('hover');
        e.preventDefault();
      } else if (e.code === 'ArrowUp' || (e.code === 'KeyW' && this.mode === 'menu')) {
        focus(this.navIndex - 1);
        this.game && this.game.audio && this.game.audio.uiSound('hover');
        e.preventDefault();
      } else if (e.code === 'Enter') {
        items[this.navIndex].click();
        e.preventDefault();
      }
    }
    if (e.code === 'Escape' && this.mode === 'menu' && this.current && !['title', 'splash'].includes(this.current)) this.showTitle();
    if (this.mode !== 'play' || !this.game) return;
    const invKey = settings.data.bindings.inventory || 'Tab';
    if (e.code === invKey && !e.repeat) {
      e.preventDefault();
      if (this.current === 'inventory') this.inventory.close();
      else if (!this.current && !this.game.player.dead) this.inventory.show();
      return;
    }
    if (e.code === 'Escape' && this.current === 'inventory') {
      e.preventDefault();
      this.inventory.close();
      return;
    }
    const atlasKey = settings.data.bindings.atlas || 'KeyM';
    if (e.code === atlasKey && !e.repeat && !/INPUT|TEXTAREA/.test((e.target && e.target.tagName) || '')) {
      if (this.current === 'atlas') this.resume();
      else if (!this.current && !this.game.player.dead && !(this.game.photo && this.game.photo.active)) this.showAtlas();
    }
    const journalKey = settings.data.bindings.journal;
    if (e.code === journalKey && !e.repeat) {
      if (this.current === 'journal') this.resume();
      else if (!this.current && !this.game.player.dead) this.showJournal();
    }
    if (e.code === 'Escape' && this.current === 'atlas') {
      e.preventDefault();
      this.resume();
      return;
    }
    if (e.code === 'Escape' && this.current === 'note') {
      e.preventDefault();
      this.resume();
      return;
    }
    if (e.code === 'Escape' && this.current && ['journal', 'settings', 'career', 'howto'].includes(this.current)) {
      e.preventDefault();
      this.showPause();
    }
  }
}

function pct(v) {
  return Math.round(v * 100) + '%';
}

function biomeName(b) {
  return { scrub: 'Scrubland', dunes: 'Dune sea', badlands: 'Badlands', saltflat: 'Salt flats', highland: 'High desert', taiga: 'North woods', tundra: 'Tundra' }[b] || 'Desert';
}

export function causeText(c) {
  return (
    {
      fall: 'A bad fall',
      crash: 'Killed in a crash',
      starvation: 'Starved',
      dehydration: 'Died of thirst',
      hypothermia: 'Froze to death',
      venom: 'Snake venom',
      snake: 'Snakebite',
      wolf: 'Wolves',
      stalker: 'Taken in the dark',
      exhaustion: 'Worn out',
      bleeding: 'Bled out',
      creature: 'Taken by something in the dark',
      coyote: 'Brought down by coyotes',
      vagrant: 'Killed by a stranger',
      fire: 'Burned',
      knuckles: 'Punched the wrong thing',
    }[c] || 'Died on the road'
  );
}
