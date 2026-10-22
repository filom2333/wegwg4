// Menu layer: title (over pre-rendered pictures from the road), new game setup, settings, career
// statistics, multiplayer placeholder, loading, click-to-play, pause, journal, sleep and death.

import { CAR_TYPE_LIST } from '../vehicle/types.js';
import { settings, DEFAULT_BINDINGS } from '../core/settings.js';
import { InventoryUI } from './inventoryUI.js';
import { input } from '../core/input.js';
import { hasSave, saveSummary, writeSave, readCareer, recordRun, deleteSave } from '../core/save.js';
import { NOTES, HAVEN_KM } from '../story/story.js';
import { drawAtlas } from '../story/atlas.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const VERSION = '0.10';

// Pictures behind the title menu (public/menu/), each with its own slow camera move.
const MENU_SHOTS = [
  { src: 'menu/golden.webp', move: 'in', origin: '42% 58%' },
  { src: 'menu/gas.webp', move: 'left', origin: '50% 55%' },
  { src: 'menu/vista.webp', move: 'out', origin: '48% 60%' },
  { src: 'menu/forest.webp', move: 'in', origin: '52% 62%' },
  { src: 'menu/taiga.webp', move: 'right', origin: '40% 64%' },
  { src: 'menu/night.webp', move: 'in', origin: '50% 52%' },
  { src: 'menu/dunes.webp', move: 'right', origin: '40% 55%' },
  { src: 'menu/mesas.webp', move: 'out', origin: '55% 50%' },
  { src: 'menu/valley.webp', move: 'left', origin: '60% 55%' },
];
const SLIDE_SECONDS = 9;

const TIPS = [
  'A jerry can holds 20 litres. The tank holds 50. Fill both when you find a working pump.',
  'Headlights keep some things at a distance. Not all of them.',
  'Hold R on a part to unbolt it. Parts that depend on it have to come off first.',
  'Coolant and oil are cheap. Engines are not.',
  'Rain turns dirt roads to grease. Brake earlier.',
  'Aim for the head. It is a long way to the next box of cartridges.',
  'Sleep in the car with the engine off, in a tent you pitch, or in a bed in an empty house: a bed rests you best.',
  'Abandoned cars still have parts worth taking.',
  'The road always goes north. Everything else is a detour.',
];

const LABELS = {
  forward: 'Forward / throttle',
  back: 'Back / brake / reverse',
  left: 'Left / steer left',
  right: 'Right / steer right',
  sprint: 'Sprint',
  crouch: 'Crouch',
  jump: 'Jump',
  interact: 'Interact / enter / exit',
  drop: 'Drop (hold to throw)',
  reload: 'Reload / remove part (hold)',
  flashlight: 'Flashlight / use now',
  lights: 'Headlights',
  ignition: 'Ignition (hold to crank)',
  horn: 'Horn',
  gearUp: 'Gear up (manual)',
  gearDown: 'Gear down (manual)',
  handbrake: 'Handbrake',
  wipers: 'Wipers',
  lookBack: 'Look back',
  winch: 'Wind in the winch',
  journal: 'Journal',
  atlas: 'Road atlas',
  photo: 'Photo mode',
  inventory: 'Inventory',
  nextTrack: 'Next CD track',
  stow: 'Put in backpack',
  sleep: 'Sleep (car, tent or bed)',
  view: 'First / third person',
};

function keyName(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', Space: 'Space', AltLeft: 'Alt', Tab: 'Tab', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Backspace: 'Backspace' }[code] || code;
}

export class UI {
  constructor() {
    this.root = el('div', 'ui', document.body);
    // automated captures render far below real time: skip fades so screens are never caught mid-transition
    if (navigator.webdriver) this.root.classList.add('instant');
    this.screens = {};
    this.current = null;
    this.game = null;
    this.mode = 'menu'; // menu | loading | play
    this.fpsEl = el('div', 'ui-fps', document.body);
    this.fpsEl.style.display = settings.data.showFps ? '' : 'none';
    this.fpsAcc = 0;
    this.fpsN = 0;
    this.autosaveT = 0;
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    this.inventory = new InventoryUI(this);
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

  // ---------------------------------------------------------------- title
  // Route shield emblem used by the logo.
  shield() {
    return `<svg class="ui-shield" viewBox="0 0 100 110" aria-hidden="true"><path d="M50 4 C62 12 78 12 92 8 C96 40 92 74 50 106 C8 74 4 40 8 8 C22 12 38 12 50 4 Z" fill="none" stroke="currentColor" stroke-width="5"/><text x="50" y="40" text-anchor="middle" font-size="15" letter-spacing="2" fill="currentColor">ROUTE</text><text x="50" y="82" text-anchor="middle" font-size="44" font-weight="600" fill="currentColor">9</text></svg>`;
  }

  // Title backdrop: stills from the road that slowly pan and zoom, cross-fading every few seconds.
  showBackdrop() {
    if (this.backdrop) return;
    const b = (this.backdrop = el('div', 'ui-backdrop', document.body));
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

  // First screen: wait for a key/click (also unlocks audio and starts the title theme).
  showSplash() {
    this.mode = 'menu';
    this.screen('splash', (s) => {
      s.classList.add('ui-shade-bottom');
      const c = el('div', 'ui-splash', s);
      el('div', 'ui-logo-wrap reveal', c, `${this.shield()}<h1 class="ui-logo">Dust Road<span>Route 9 · 150 km to Haven</span></h1>`);
      el('div', 'ui-press', c, 'Press any key');
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
      s.classList.add('ui-shade-left');
      el('div', 'ui-title-block', s, `<div class="ui-logo-wrap">${this.shield()}<h1 class="ui-logo">Dust Road<span>Route 9 · 150 km to Haven</span></h1></div>`);
      const m = el('div', 'ui-menu', s);
      if (sum) {
        const b = this.item(m, 'Continue', () => this.go({ load: 1 }), `Day ${sum.day} · ${(Math.max(0, sum.distance) / 1000).toFixed(1)} km`);
        b.classList.add('primary');
      }
      const ng = this.item(m, 'New game', () => this.showNewGame());
      if (!sum) ng.classList.add('primary');
      this.item(m, 'Multiplayer', () => this.showMultiplayer(), 'coming later');
      this.item(m, 'Settings', () => this.showSettings(() => this.showTitle()));
      this.item(m, 'Statistics', () => this.showCareer(() => this.showTitle()));
      this.item(m, 'Credits', () => this.showCredits());
      const news = el('div', 'ui-news', s);
      news.innerHTML = `<div class="ui-news-k">Update 0.10 · The open country update</div>
        <div class="ui-news-t">A second car, parts that fit any car, spray paint, roof racks and bolt-on plates, rollovers. New land: real dunes, ridged mountains, mesas, denser brush, yucca and ocotillo, forests to the horizon.</div>
        <div class="ui-news-k dim">Next: co-op on Route 9</div>`;
      el('div', 'ui-foot', s, `v${VERSION} · keyboard and mouse · ↑ ↓ Enter`);
      this.menuNav(m);
    });
    this.show('title');
  }

  // Arrow keys / Enter move through a menu; hover sounds on every focus change.
  menuNav(menu) {
    const items = [...menu.querySelectorAll('.ui-item:not([disabled])')];
    if (!items.length) return;
    const focus = (i) => {
      items.forEach((b) => b.classList.remove('kb'));
      this.navIndex = (i + items.length) % items.length;
      items[this.navIndex].classList.add('kb');
      items[this.navIndex].focus({ preventScroll: true });
    };
    this.navIndex = 0;
    this.nav = { items, focus };
    setTimeout(() => this.current && focus(0), 50);
  }

  showCredits() {
    this.screen('credits', (s) => {
      s.classList.add('ui-shade-panel');
      const p = el('div', 'ui-panel', s);
      el('h2', 'ui-h', p, 'Credits');
      const body = el('div', 'ui-body', p);
      const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
      const ccby = link('http://creativecommons.org/licenses/by/4.0/', 'CC-BY-4.0');
      body.innerHTML = `<p class="ui-sub">The land, the buildings, the people and the music are generated in code at load time. Most sound effects were generated with ${link('https://elevenlabs.io/sound-effects', 'ElevenLabs')} text-to-sound and then cut, levelled and looped for the game; the engine, the radio and the music are synthesized.</p>
        <p class="ui-sub">The 1960s Beetle is based on ${link('https://sketchfab.com/3d-models/beetlefusca-version-1-cb6e82e73386448fb3b4e2dd25255a5e', '"Beetle/Fusca (Version 1)"')} by ${link('https://sketchfab.com/soujagah', 'soujagah')}, and the '88 Riverside sedan on "88 American Sedan - Low poly model" by ${link('https://sketchfab.com/DanielZhabotinsky', 'Daniel Zhabotinsky')}, both licensed under ${ccby}; scaled, split into parts and re-textured for repainting.</p>
        <p class="ui-sub">The '04 Kronberg saloon is based on "Mercedes-Benz C-class W203 2007" by ${link('https://sketchfab.com/szymonpasterczyk734', 'szymonpasterczyk734')} (${ccby}); re-coloured, given tyres, an engine bay and a boot battery. Props: the oil drum from the Babylon.js assets (${ccby}), lamp post, barn lamp, fridge, sofa, plant, skull and flight helmet from the Khronos glTF sample models (CC0 / ${ccby}), the player's body is the Ready Player Me avatar from the three.js examples, re-dressed for the road and moved by the Soldier's Mixamo clips; mossy boulders from ez-tree by Daniel Greenheck (MIT); the grass carp from @so-chart/fish (ISC, USFWS public-domain photo); the barramundi, the antique camera and the teacup from the Khronos glTF sample assets (${ccby}); a worn tyre from the 3d-model-testingpublic package (ISC).</p>
        <p class="ui-sub">Tree bark from ${link('https://www.texturecan.com/', 'TextureCan')} and ${link('https://polyhaven.com/a/bark_brown_02', 'Poly Haven')} (CC0); twig cards from ${link('https://github.com/dgreenheck/ez-tree', 'ez-tree')} by Daniel Greenheck (MIT).</p>
        <div class="ui-cols">
          <div><div class="ui-label">Built with</div><div class="ui-stat"><span>Rendering</span><span>three.js</span></div><div class="ui-stat"><span>Physics</span><span>Rapier</span></div><div class="ui-stat"><span>Sound</span><span>Web Audio</span></div><div class="ui-stat"><span>Sound effects</span><span>ElevenLabs</span></div></div>
          <div><div class="ui-label">Models and textures</div><div class="ui-stat"><span>Beetle</span><span>soujagah · CC-BY-4.0</span></div><div class="ui-stat"><span>Sedan</span><span>D. Zhabotinsky · CC-BY-4.0</span></div><div class="ui-stat"><span>Saloon</span><span>szymonpasterczyk734 · CC-BY-4.0</span></div><div class="ui-stat"><span>Props</span><span>Khronos, Babylon.js · CC0 / CC-BY</span></div><div class="ui-stat"><span>Bark</span><span>TextureCan, Poly Haven · CC0</span></div><div class="ui-stat"><span>Twigs</span><span>ez-tree · MIT</span></div></div>
          <div><div class="ui-label">Inspired by</div><div class="ui-stat"><span>Road trips</span><span>The Long Drive</span></div><div class="ui-stat"><span>Dust</span><span>Route 66, 89, 95</span></div></div>
        </div>`;
      const a = el('div', 'ui-actions', p);
      this.item(a, 'Back', () => this.showTitle());
    });
    this.show('credits');
  }

  item(parent, label, fn, small) {
    const b = el('button', 'ui-item', parent, esc(label) + (small ? `<small>${esc(small)}</small>` : ''));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game && this.game.audio && this.game.audio.uiSound('select');
      fn();
    });
    b.addEventListener('pointerenter', () => this.game && this.game.audio && this.game.audio.uiSound('hover'));
    return b;
  }

  // ---------------------------------------------------------------- new game
  showNewGame() {
    const cfg = this.newCfg || (this.newCfg = { difficulty: 'normal', start: 'parts', car: 'w203', seed: String(Math.floor(Math.random() * 900000) + 100000) });
    this.screen('newgame', (s) => {
      s.classList.add('ui-shade-panel');
      const p = el('div', 'ui-panel', s);
      el('h2', 'ui-h', p, 'New game');
      el('p', 'ui-sub', p, 'The road runs north through scrub, dunes, badlands and salt. Nobody is coming to help.');
      const body = el('div', 'ui-body', p);
      el('div', 'ui-label', body, 'Difficulty');
      this.choices(
        body,
        [
          ['easy', 'Easy', 'Slower hunger and thirst, gentler wear, fewer and weaker enemies, more loot.'],
          ['normal', 'Normal', 'The intended balance. Plan your fuel, keep your engine fed.'],
          ['hard', 'Hard', 'Everything wears faster, loot is scarce and the night is crowded.'],
        ],
        cfg.difficulty,
        (v) => (cfg.difficulty = v)
      );
      el('div', 'ui-label', body, 'Your car');
      this.carChoices(body, cfg);
      el('div', 'ui-label', body, 'Condition');
      this.choices(
        body,
        [
          ['parts', 'Build it first', 'The body stands on its wheels in the garage. Everything else is somewhere about the place, and a few parts are down the road.'],
          ['assembled', 'Ready to drive', 'Start with the car assembled in the garage, a little fuel in the tank.'],
        ],
        cfg.start,
        (v) => (cfg.start = v)
      );
      el('div', 'ui-label', body, 'World seed');
      const sr = el('div', 'ui-seed', body);
      const inp = el('input', 'ui-input', sr);
      inp.value = cfg.seed;
      inp.maxLength = 9;
      inp.addEventListener('input', () => (cfg.seed = inp.value.replace(/\D/g, '').slice(0, 9)));
      const dice = el('button', 'ui-link', sr, 'Randomise');
      dice.onclick = () => {
        cfg.seed = String(Math.floor(Math.random() * 900000) + 100000);
        inp.value = cfg.seed;
      };
      const a = el('div', 'ui-actions', p);
      this.item(a, 'Back', () => this.showTitle());
      el('div', 'spacer', a);
      const go = this.item(a, 'Start the drive', () => {
        const seed = +(cfg.seed || 1) || 1;
        if (hasSave()) {
          this.confirm('Starting a new game replaces your current save.', 'Start anyway', () => this.go({ seed, difficulty: cfg.difficulty, start: cfg.start, car: cfg.car, fresh: 1 }));
        } else this.go({ seed, difficulty: cfg.difficulty, start: cfg.start, car: cfg.car, fresh: 1 });
      });
      go.classList.add('primary');
    });
    this.show('newgame');
  }

  // Starting car cards: name, year, a line about it and its numbers. The other two wait somewhere
  // along the road.
  carChoices(parent, cfg) {
    const wrap = el('div', 'ui-cars', parent);
    const cards = CAR_TYPE_LIST.map((t) => {
      const S = t.stats;
      const b = el(
        'button',
        'ui-car' + (t.id === cfg.car ? ' sel' : ''),
        wrap,
        `<b>${esc(t.name)}</b><em>${t.year} · ${esc(S.engine)}</em><span>${esc(t.blurb)}</span>
         <div class="ui-car-stats"><i>${S.power} hp</i><i>${S.torque} Nm</i><i>${S.mass} kg</i><i>${S.top} km/h</i><i>${esc(S.drive)}</i><i>${esc(S.gearbox)}</i></div>`
      );
      b.onclick = () => {
        cards.forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        cfg.car = t.id;
      };
      return b;
    });
    el('p', 'ui-note', parent, 'The other two are out there somewhere along the road, abandoned. Find them, fix them, drive whichever you like.');
  }

  choices(parent, list, cur, onPick) {
    const wrap = el('div', 'ui-choices', parent);
    const btns = list.map(([v, title, desc]) => {
      const b = el('button', 'ui-choice' + (v === cur ? ' sel' : ''), wrap, `<b>${esc(title)}</b><span>${esc(desc)}</span>`);
      b.onclick = () => {
        btns.forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        onPick(v);
      };
      return b;
    });
    return wrap;
  }

  confirm(text, okLabel, onOk) {
    const s = this.screens[this.current];
    if (!s) return onOk();
    const c = el('div', 'ui-confirm', s);
    el('p', '', c, esc(text));
    const a = el('div', 'ui-actions', c);
    a.style.border = '0';
    a.style.paddingTop = '0';
    this.item(a, 'Cancel', () => c.remove());
    el('div', 'spacer', a);
    this.item(a, okLabel, () => {
      c.remove();
      onOk();
    }).classList.add('primary');
  }

  // Navigate to a fresh page load that boots straight into the game.
  go(params) {
    this.game && this.game.audio && this.game.audio.stopMenuMusic && this.game.audio.stopMenuMusic();
    const q = new URLSearchParams({ play: '1', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    this.screen('fade', (s) => s.classList.add('ui-shade-dark'));
    this.show('fade');
    setTimeout(() => (location.search = '?' + q.toString()), 380);
  }

  // ---------------------------------------------------------------- multiplayer placeholder
  showMultiplayer() {
    this.screen('mp', (s) => {
      s.classList.add('ui-shade-panel');
      const p = el('div', 'ui-panel', s);
      el('h2', 'ui-h', p, 'Multiplayer');
      el('p', 'ui-sub', p, 'Driving north together is planned, but this build has no network play. The game keeps world, car and items as separate shared state so co-op can be added later.');
      el('div', 'ui-body', p);
      const a = el('div', 'ui-actions', p);
      this.item(a, 'Back', () => this.showTitle());
    });
    this.show('mp');
  }

  // ---------------------------------------------------------------- career statistics
  showCareer(back) {
    const c = readCareer();
    const km = (m) => (m / 1000).toFixed(1) + ' km';
    this.screen('career', (s) => {
      s.classList.add(this.mode === 'play' ? 'ui-shade-full' : 'ui-shade-panel');
      const p = el('div', 'ui-panel', s);
      el('h2', 'ui-h', p, 'Statistics');
      el('p', 'ui-sub', p, c.runs ? 'Every finished run, added up.' : 'No finished runs yet. Numbers appear here after your first one ends.');
      const body = el('div', 'ui-body', p);
      const hero = el('div', 'ui-hero', body);
      hero.innerHTML = `<div><div class="cap">Longest drive</div><div class="ui-big">${(c.longest / 1000).toFixed(1)}<small>km</small></div></div><div><div class="cap">Most days</div><div class="ui-big">${c.bestDays}</div></div><div><div class="cap">Runs</div><div class="ui-big">${c.runs}</div></div>`;
      const cols = el('div', 'ui-cols', body);
      this.statList(cols, 'Totals', [
        ['Distance', km(c.distance)],
        ['Days survived', c.days],
        ['Deaths', c.deaths],
        ['Fuel burned', c.fuelUsed.toFixed(0) + ' l'],
      ]);
      this.statList(cols, 'Hands', [
        ['Kills', c.kills],
        ['Headshots', c.headshots],
        ['Items looted', c.itemsLooted],
        ['Parts installed', c.partsInstalled],
      ]);
      if (c.lastRun) {
        const r = c.lastRun;
        this.statList(cols, 'Last run', [
          ['Distance', km(r.distance || 0)],
          ['Days', r.daysSurvived || 1],
          ['Ended by', r.cause ? causeText(r.cause) : 'Saved and left'],
        ]);
      }
      const a = el('div', 'ui-actions', p);
      this.item(a, 'Back', back);
    });
    this.show('career');
  }

  statList(parent, title, rows) {
    const c = el('div', '', parent);
    el('div', 'ui-label', c, esc(title));
    for (const [k, v, cls] of rows) el('div', 'ui-stat' + (cls ? ' ' + cls : ''), c, `<span>${esc(k)}</span><span>${esc(v)}</span>`);
    return c;
  }

  // ---------------------------------------------------------------- settings
  showSettings(back, tab = 'graphics') {
    const d = settings.data;
    this.screen('settings', (s) => {
      s.classList.add(this.mode === 'play' ? 'ui-shade-full' : 'ui-shade-panel');
      const p = el('div', 'ui-panel', s);
      el('h2', 'ui-h', p, 'Settings');
      const tabs = el('div', 'ui-tabs', p);
      for (const [k, lab] of [
        ['graphics', 'Graphics'],
        ['audio', 'Audio'],
        ['controls', 'Controls'],
        ['gameplay', 'Gameplay'],
      ]) {
        const b = el('button', k === tab ? 'sel' : '', tabs, lab);
        b.onclick = () => this.showSettings(back, k);
      }
      const body = el('div', 'ui-body', p);
      const set = (k, v) => {
        settings.set(k, v);
        this.applySettings(k);
      };
      if (tab === 'graphics') {
        this.seg(body, 'Quality preset', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], d.quality, (v) => set('quality', v), 'Shadows, view distance and detail. Applies on the next start.');
        this.range(body, 'Field of view', 70, 110, 1, d.hfov, (v) => set('hfov', v), (v) => v + '°');
        this.range(body, 'Render scale', 0.5, 1, 0.05, d.resolutionScale, (v) => set('resolutionScale', v), (v) => Math.round(v * 100) + '%');
        this.toggle(body, 'Dynamic resolution', d.dynamicResolution !== false, (v) => set('dynamicResolution', v));
        this.toggle(body, 'Bloom', d.bloom, (v) => set('bloom', v));
        this.toggle(body, 'Show frame rate', d.showFps, (v) => set('showFps', v));
      } else if (tab === 'audio') {
        this.range(body, 'Master', 0, 1, 0.01, d.masterVolume, (v) => set('masterVolume', v), pct);
        this.range(body, 'Effects', 0, 1, 0.01, d.sfxVolume, (v) => set('sfxVolume', v), pct);
        this.range(body, 'Ambience and weather', 0, 1, 0.01, d.ambientVolume, (v) => set('ambientVolume', v), pct);
        this.range(body, 'Radio', 0, 1, 0.01, d.musicVolume, (v) => set('musicVolume', v), pct);
        this.seg(body, 'Listening on', [['headphones', 'Headphones'], ['speakers', 'Speakers']], d.sound3d || 'headphones', (v) => set('sound3d', v), 'Headphones: sounds come from all round you, in front, behind and above. Speakers: plain left and right.');
      } else if (tab === 'controls') {
        this.range(body, 'Mouse sensitivity', 0.2, 3, 0.05, d.sensitivity, (v) => set('sensitivity', v), (v) => v.toFixed(2));
        this.toggle(body, 'Invert vertical look', d.invertY, (v) => set('invertY', v));
        this.seg(body, 'Gearbox', [['auto', 'Automatic'], ['manual', 'Manual']], d.transmission, (v) => set('transmission', v), 'Manual: X / Z to shift.');
        el('div', 'ui-label', body, 'Keys');
        for (const action of Object.keys(LABELS)) {
          const r = el('div', 'ui-row', body, `<span>${esc(LABELS[action])}</span>`);
          const k = el('button', 'ui-key', r, keyName(d.bindings[action] || DEFAULT_BINDINGS[action]));
          k.onclick = () => this.listenKey(action, k);
        }
        const rr = el('div', 'ui-row', body, '<span></span>');
        const reset = el('button', 'ui-link', rr, 'Reset keys');
        reset.style.justifySelf = 'end';
        reset.onclick = () => {
          settings.set('bindings', { ...DEFAULT_BINDINGS });
          this.showSettings(back, 'controls');
        };
      } else {
        this.seg(body, 'Units', [['metric', 'Metric'], ['imperial', 'Imperial']], d.units, (v) => set('units', v));
        this.toggle(body, 'Head bob', d.headBob, (v) => set('headBob', v));
      }
      const a = el('div', 'ui-actions', p);
      this.item(a, 'Back', back);
    });
    this.show('settings');
  }

  row(parent, label, note) {
    return el('div', 'ui-row', parent, `<span>${esc(label)}${note ? `<span class="note">${esc(note)}</span>` : ''}</span>`);
  }

  seg(parent, label, opts, cur, onPick, note) {
    const r = this.row(parent, label, note);
    const w = el('div', 'ui-seg', r);
    const bs = opts.map(([v, lab]) => {
      const b = el('button', v === cur ? 'sel' : '', w, esc(lab));
      b.onclick = () => {
        bs.forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        onPick(v);
      };
      return b;
    });
  }

  toggle(parent, label, cur, onPick) {
    this.seg(parent, label, [[true, 'On'], [false, 'Off']], cur, onPick);
  }

  range(parent, label, min, max, step, cur, onChange, fmt) {
    const r = this.row(parent, label);
    const w = el('div', 'ui-range', r);
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
    btn.textContent = 'Press a key';
    this.listening = { action, btn };
  }

  applySettings(k) {
    const g = this.game;
    const d = settings.data;
    if (k === 'showFps') this.fpsEl.style.display = d.showFps ? '' : 'none';
    if (!g) return;
    if (/Volume$/.test(k) && g.audio && g.audio.applyVolumes) g.audio.applyVolumes();
    // on the title screen there is no world yet: the rest applies when a game starts
    if (!g.renderer) return;
    if (k === 'transmission' && g.car) g.car.dyn.automatic = d.transmission === 'auto';
    if (k === 'resolutionScale' && g.renderer.setScale) g.renderer.setScale(d.resolutionScale);
    if (k === 'bloom') g.renderer.applyPassSettings();
  }

  // ---------------------------------------------------------------- loading / click to play
  showLoading() {
    this.mode = 'loading';
    this.screen('loading', (s) => {
      s.classList.add('ui-shade-dark');
      const c = el('div', 'ui-center ui-loading', s);
      el('h1', 'ui-logo', c, 'Dust Road');
      const bar = el('div', 'ui-loadbar', c);
      this.loadFill = el('div', '', bar);
      this.loadFill.style.width = '2%';
      this.loadText = el('div', 'ui-loadtext', c, 'Starting');
      el('div', 'ui-tip', s, `<b>NOTE FROM THE ROAD</b>${esc(TIPS[Math.floor(Math.random() * TIPS.length)])}`);
    });
    this.show('loading');
  }

  progress(text, p) {
    if (this.loadFill) this.loadFill.style.width = Math.round(Math.max(0.02, p) * 100) + '%';
    if (this.loadText) this.loadText.textContent = text;
  }

  showClickToPlay(first = true) {
    this.mode = 'play';
    this.screen('click', (s) => {
      s.classList.add('ui-click');
      const c = el('div', 'ui-center', s);
      el('h2', '', c, first ? 'Click to begin' : 'Click to resume');
      el('div', 'ui-loadtext', c, 'The mouse is captured while you play · Esc releases it');
      if (first) {
        const k = el('div', 'ui-keys', c);
        const b = settings.data.bindings;
        const rows = [
          [`${keyName(b.forward)} ${keyName(b.left)} ${keyName(b.back)} ${keyName(b.right)}`, 'Walk / drive'],
          [keyName(b.interact), 'Interact, pick up, get in and out'],
          ['RMB', 'Rotate held item'],
          [keyName(b.reload) + ' (hold)', 'Remove a car part'],
          [keyName(b.ignition), 'Ignition, hold to crank'],
          [keyName(b.lights), 'Headlights'],
          [keyName(b.journal), 'Journal'],
          [keyName(b.atlas || 'KeyM'), 'Road atlas'],
          [keyName(b.photo || 'KeyP'), 'Photo mode'],
        ];
        for (const [kk, t] of rows) k.innerHTML += `<kbd>${esc(kk)}</kbd><span>${esc(t)}</span>`;
      }
      s.addEventListener('click', () => this.resume());
    });
    this.show('click');
  }

  resume() {
    this.hide();
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

  // ---------------------------------------------------------------- pause
  showPause() {
    const g = this.game;
    g.paused = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.screen('pause', (s) => {
      s.classList.add('ui-shade-full');
      el('div', 'ui-title-block', s, `<h1 class="ui-logo" style="font-size:56px">Paused</h1>`);
      const m = el('div', 'ui-menu', s);
      this.item(m, 'Resume', () => this.resume()).classList.add('primary');
      this.item(m, 'Save game', () => {
        const ok = writeSave(g);
        g.hud && g.hud.toast(ok ? 'Game saved' : 'Could not save');
        this.resume();
      });
      this.item(m, 'Journal', () => this.showJournal(() => this.showPause()));
      this.item(m, 'Settings', () => this.showSettings(() => this.showPause()));
      this.item(m, 'Main menu', () => this.confirm('Leave to the main menu? Progress since your last save is lost.', 'Save and leave', () => {
        writeSave(g);
        location.search = '';
      }));
      el('div', 'ui-foot', s, `Seed ${g.seed} · ${g.difficulty.label}`);
    });
    this.show('pause');
  }

  // ---------------------------------------------------------------- journal (stats screen)
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
    const meter = (parent, label, v, low) => {
      el('div', 'ui-stat', parent, `<span>${esc(label)}</span><span>${Math.round(v * 100)}%</span>`);
      el('div', 'ui-meter' + (v < low ? ' low' : ''), parent, `<div style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></div>`);
    };
    this.screen('journal', (s) => {
      s.classList.add('ui-shade-full');
      const pnl = el('div', 'ui-panel center', s);
      pnl.style.width = 'min(980px, calc(100vw - 64px))';
      el('h2', 'ui-h', pnl, 'Journal');
      const h = g.env.time;
      el('p', 'ui-sub', pnl, `Day ${g.env.day}, ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')} · ${esc(biomeName(g.env.biome))} · ${esc(g.env.weatherName)}`);
      const body = el('div', 'ui-body', pnl);
      const cols = el('div', 'ui-cols', body);
      const a = el('div', '', cols);
      el('div', 'ui-label', a, 'You');
      meter(a, 'Health', p.health / 100, 0.3);
      meter(a, 'Food', p.food / 100, 0.25);
      meter(a, 'Water', p.water / 100, 0.25);
      meter(a, 'Rest', p.energy / 100, 0.2);
      if (p.bleeding > 0.05) el('div', 'ui-stat warn', a, `<span>Bleeding</span><span>${p.bleeding > 1 ? 'heavy' : 'light'}</span>`);
      const ia = g.interaction;
      el('div', 'ui-stat', a, `<span>.38 cartridges</span><span>${ia.ammo['38'] || 0}</span>`);
      el('div', 'ui-stat', a, `<span>12 ga shells</span><span>${ia.ammo['12'] || 0}</span>`);
      const b = el('div', '', cols);
      el('div', 'ui-label', b, car.type.name);
      meter(b, `Fuel · ${car.fuel.toFixed(1)} of ${car.fuelCap} l`, car.fuel / car.fuelCap, 0.15);
      meter(b, `Oil · ${car.oil.toFixed(1)} l`, car.oil / car.oilCap, 0.3);
      meter(b, 'Battery', car.battery, 0.2);
      meter(b, 'Engine', car.isInstalled('engine') ? car.engineCondition : 0, 0.35);
      meter(b, car.PARTS.fanbelt.label, car.isInstalled('fanbelt') ? car.fanbeltCondition : 0, 0.3);
      if (car.parts.sparkplugs) meter(b, 'Spark plugs', car.partCond('sparkplugs'), 0.3);
      if (car.parts.oilfilter) meter(b, 'Oil filter', car.partCond('oilfilter'), 0.25);
      if (car.coolantCap) meter(b, `Coolant · ${car.coolant.toFixed(1)} of ${car.coolantCap} l`, car.isInstalled('radiator') ? car.coolant / car.coolantCap : 0, 0.3);
      meter(b, `Engine temp · ${Math.round(car.engineTemp)}°C`, 1 - Math.max(0, Math.min(1, (car.engineTemp - 90) / 40)), 0.4);
      const tyres = car.dyn.wheels.filter((w) => w.installed);
      const tc = tyres.length ? tyres.reduce((m, w) => Math.min(m, car.parts[w.id].condition ?? 1), 1) : 0;
      meter(b, `Worst tyre · ${tyres.length} fitted`, tc, 0.25);
      const missing = Object.keys(car.parts).filter((id) => !car.isInstalled(id));
      el('div', 'ui-stat' + (missing.length ? ' warn' : ''), b, `<span>Missing parts</span><span>${missing.length || 'none'}</span>`);
      const c = el('div', '', cols);
      el('div', 'ui-label', c, 'This run');
      const rows = [
        ['Distance', dist(st.distance)],
        ['Odometer', dist(car.odometer * 1000)],
        ['Days survived', st.daysSurvived],
        ['Top speed', imperial ? Math.round(st.maxSpeed / 1.609) + ' mph' : Math.round(st.maxSpeed) + ' km/h'],
        ['Fuel burned', st.fuelUsed.toFixed(1) + ' l'],
        ['Places visited', st.placesVisited],
        ['Items looted', st.itemsLooted],
        ['Parts installed', st.partsInstalled],
        ['Kills · headshots', `${st.kills} · ${st.headshots}`],
        ['Meals · drinks', `${st.meals} · ${st.drinks}`],
        ['Crashes', st.crashes],
      ];
      for (const [k, v] of rows) el('div', 'ui-stat', c, `<span>${esc(k)}</span><span>${esc(v)}</span>`);
      // notes found so far, readable again
      const story = g.story;
      if (story) {
        const nb = el('div', '', body);
        el('div', 'ui-label', nb, `Notes · ${story.found.length} of ${NOTES.length} · Haven ${Math.max(0, HAVEN_KM - story.km()).toFixed(0)} km north`);
        const list = el('div', 'ui-notes', nb);
        if (!story.found.length) el('div', 'ui-sub', list, 'Nothing yet. People leave notes in houses, diners and wrecks.');
        for (const id of story.found) {
          const n = story.noteById(id);
          const b = el('button', 'ui-note-item', list, `<b>${esc(n.title)}</b><span>${esc(n.text.split('\n')[0].slice(0, 90))}…</span>`);
          b.onclick = () => this.showNote(n, () => this.showJournal(back));
        }
      }
      const act = el('div', 'ui-actions', pnl);
      this.item(act, back ? 'Back' : 'Close', () => (back ? back() : this.resume()));
      el('div', 'spacer', act);
      el('div', 'ui-loadtext', act, `${keyName(settings.data.bindings.journal)} to close`);
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
      s.classList.add('ui-shade-full');
      const pnl = el('div', 'ui-panel center ui-atlas', s);
      const head = el('div', 'ui-atlas-head', pnl);
      el('h2', 'ui-h', head, 'Road atlas');
      el('p', 'ui-sub', head, `Route 9 · ${Math.max(0, HAVEN_KM - here.z / 1000).toFixed(0)} km to Haven · day ${g.env.day}`);
      const row = el('div', 'ui-atlas-row', pnl);
      const wrap = el('div', 'ui-atlas-map', row);
      const cv = el('canvas', '', wrap);
      const side = el('div', 'ui-atlas-side', row);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const draw = () => {
        const r = wrap.getBoundingClientRect();
        cv.width = Math.max(10, Math.round(r.width * dpr));
        cv.height = Math.max(10, Math.round(r.height * dpr));
        layout = drawAtlas(cv, g, { cx: view.cx, cz: view.cz, s: view.s * dpr }, { dpr });
        if (pending) {
          const x = cv.width / 2 - (pending.x - view.cx) * view.s * dpr,
            y = cv.height / 2 - (pending.z - view.cz) * view.s * dpr;
          const c = cv.getContext('2d');
          c.strokeStyle = '#c63d2f';
          c.lineWidth = 2 * dpr;
          c.beginPath();
          c.arc(x, y, 7 * dpr, 0, Math.PI * 2);
          c.stroke();
        }
      };
      // notes and photos
      const list = () => {
        side.innerHTML = '';
        el('div', 'ui-label', side, 'Notes');
        const form = el('div', 'ui-atlas-form', side);
        const inp = el('input', 'ui-atlas-input', form);
        inp.placeholder = pending ? 'Note for the marked spot…' : 'Note for where you are…';
        inp.maxLength = 140;
        inp.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && inp.value.trim()) add(inp.value.trim());
          if (e.key === 'Escape') this.resume();
        });
        this.item(form, pending ? 'Pin it there' : 'Pin it here', () => inp.value.trim() && add(inp.value.trim()));
        if (pending) inp.focus();
        if (!A.notes.length) el('div', 'ui-sub', side, 'Click the map to mark a spot, or pin a note where you stand: fuel, water, a good camp, trouble.');
        A.notes.forEach((n, i) => {
          const r = el('div', 'ui-atlas-note', side, `<b>${i + 1}</b><span>${esc(n.text)}<small>day ${n.day} · ${Math.max(0, HAVEN_KM - n.z / 1000).toFixed(1)} km to Haven</small></span>`);
          r.onclick = () => {
            view.cx = n.x;
            view.cz = n.z;
            draw();
          };
          const x = el('button', 'ui-atlas-del', r, '×');
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
          el('div', 'ui-label', side, `Photos · ${photos.length}`);
          const grid = el('div', 'ui-atlas-photos', side);
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
      const act = el('div', 'ui-actions', pnl);
      this.item(act, 'Close', () => this.resume());
      this.item(act, 'Where am I', () => {
        const h = A.here();
        view.cx = h.x;
        view.cz = h.z;
        draw();
      });
      el('div', 'spacer', act);
      el('div', 'ui-loadtext', act, `Drag to move · wheel to zoom · click to mark · ${keyName(settings.data.bindings.atlas || 'KeyM')} to close`);
      list();
      requestAnimationFrame(draw);
    });
    this.show('atlas');
  }

  // A photo from the atlas, big, with when it was taken.
  showPhoto(ph) {
    const s = this.screens.atlas;
    if (!s) return;
    const old = s.querySelector('.ui-atlas-photo');
    if (old) old.remove();
    const box = el('div', 'ui-atlas-photo', s);
    const im = el('img', '', box);
    im.src = ph.thumb;
    const h = ph.time || 12;
    el('div', 'ui-sub', box, `Day ${ph.day}, ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')} · click to put it back`);
    box.onclick = () => box.remove();
  }

  // ---------------------------------------------------------------- notes
  showNote(n, back) {
    const g = this.game;
    if (!back) {
      g.paused = true;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    this.screen('note', (s) => {
      s.classList.add('ui-shade-full');
      const c = el('div', 'ui-center', s);
      const paper = el('div', 'ui-paper', c);
      el('div', 'ui-paper-title', paper, esc(n.title));
      el('div', 'ui-paper-text', paper, esc(n.text).replace(/\n/g, '<br>'));
      el('div', 'ui-paper-by', paper, '— ' + esc(n.by));
      const idx = NOTES.findIndex((x) => x.id === n.id);
      el('div', 'ui-loadtext', c, `Note ${idx + 1} of ${NOTES.length} · added to your journal`);
      const a = el('div', 'ui-actions', c);
      a.style.border = '0';
      this.item(a, back ? 'Back' : 'Put it away', () => (back ? back() : this.resume()));
    });
    this.show('note');
  }

  // ---------------------------------------------------------------- ending
  showEnding() {
    const g = this.game;
    g.paused = true;
    if (document.pointerLockElement) document.exitPointerLock();
    const st = g.stats;
    this.screen('ending', (s) => {
      s.classList.add('ui-shade-full', 'ui-death');
      const c = el('div', 'ui-center', s);
      el('h2', '', c, 'Haven');
      el('div', 'cause', c, `You reached the gate after ${st.daysSurvived} day${st.daysSurvived > 1 ? 's' : ''} on the road. ${g.story ? g.story.found.length : 0} of ${NOTES.length} notes found.`);
      const cols = el('div', 'ui-cols', c);
      this.statList(cols, 'Journey', [
        ['Distance', (st.distance / 1000).toFixed(1) + ' km'],
        ['Fuel burned', st.fuelUsed.toFixed(0) + ' l'],
        ['Top speed', Math.round(st.maxSpeed) + ' km/h'],
      ]);
      this.statList(cols, 'Survival', [
        ['Kills · headshots', `${st.kills} · ${st.headshots}`],
        ['Places visited', st.placesVisited],
        ['Parts installed', st.partsInstalled],
      ]);
      const a = el('div', 'ui-actions', c);
      this.item(a, 'Keep driving north', () => this.resume()).classList.add('primary');
      this.item(a, 'Main menu', () => {
        recordRun(st, null);
        deleteSave();
        location.search = '';
      });
    });
    this.show('ending');
  }

  // ---------------------------------------------------------------- sleep / death
  showSleep(on) {
    if (on) {
      this.screen('sleep', (s) => {
        s.classList.add('ui-sleep');
        const c = el('div', 'ui-center', s);
        this.sleepText = el('div', 'ui-loadtext', c, 'Sleeping');
      });
      this.show('sleep');
    } else if (this.current === 'sleep') this.hide();
  }

  showDeath(cause) {
    const g = this.game;
    const st = g.stats;
    recordRun(st, cause);
    deleteSave();
    if (document.pointerLockElement) document.exitPointerLock();
    const imperial = settings.data.units === 'imperial';
    const dist = (m) => (imperial ? (m / 1609.34).toFixed(1) + ' mi' : (m / 1000).toFixed(1) + ' km');
    this.screen('death', (s) => {
      s.classList.add('ui-shade-full', 'ui-death');
      const c = el('div', 'ui-center', s);
      el('h2', '', c, 'The road ends');
      el('div', 'cause', c, esc(causeText(cause)) + ` · day ${st.daysSurvived}`);
      const cols = el('div', 'ui-cols', c);
      this.statList(cols, 'Journey', [
        ['Distance', dist(st.distance)],
        ['Days', st.daysSurvived],
        ['Top speed', Math.round(st.maxSpeed) + ' km/h'],
        ['Places visited', st.placesVisited],
      ]);
      this.statList(cols, 'Survival', [
        ['Kills · headshots', `${st.kills} · ${st.headshots}`],
        ['Items looted', st.itemsLooted],
        ['Parts installed', st.partsInstalled],
        ['Meals · drinks', `${st.meals} · ${st.drinks}`],
      ]);
      const a = el('div', 'ui-actions', c);
      this.item(a, 'Try again', () => this.go({ seed: g.seed, difficulty: g.difficultyName, start: g.startMode, fresh: 1 })).classList.add('primary');
      this.item(a, 'New world', () => this.go({ seed: Math.floor(Math.random() * 900000) + 100000, difficulty: g.difficultyName, start: g.startMode, fresh: 1 }));
      this.item(a, 'Main menu', () => (location.search = ''));
    });
    this.show('death');
  }

  // ---------------------------------------------------------------- per-frame (in play)
  update(dt) {
    const g = this.game;
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.fpsEl.textContent = Math.round(this.fpsN / this.fpsAcc) + ' fps';
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
        if (writeSave(g)) g.hud && g.hud.toast('Autosaved', 'quiet');
      };
      if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 });
      else setTimeout(go, 0);
    }
    if (this.current === 'sleep' && this.sleepText) {
      const h = g.env.time;
      this.sleepText.textContent = `Sleeping · ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    }
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
    if (this.mode === 'menu' && this.nav && this.current === 'title') {
      const { items, focus } = this.nav;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        focus(this.navIndex + 1);
        this.game.audio && this.game.audio.uiSound('hover');
        e.preventDefault();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        focus(this.navIndex - 1);
        this.game.audio && this.game.audio.uiSound('hover');
        e.preventDefault();
      } else if (e.code === 'Enter' || e.code === 'Space') {
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
    if (e.code === atlasKey && !e.repeat) {
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
    if (e.code === 'Escape' && this.current && ['journal', 'settings', 'career'].includes(this.current)) {
      e.preventDefault();
      this.showPause();
    }
  }
}

function pct(v) {
  return Math.round(v * 100) + '%';
}

function biomeName(b) {
  return { scrub: 'Scrubland', dunes: 'Dune sea', badlands: 'Badlands', saltflat: 'Salt flats', highland: 'High desert' }[b] || 'Desert';
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
      exhaustion: 'Exhaustion',
      bleeding: 'Bled out',
      creature: 'Taken by something in the dark',
      coyote: 'Brought down by coyotes',
      vagrant: 'Killed by a stranger',
      fire: 'Burned',
    }[c] || 'Died'
  );
}
