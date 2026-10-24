// The first steps of a new game, one at a time on a card at the right of the screen: look and
// walk, find a part, pick it up and fit it, put the car together, fuel, get in, start her,
// release the brake and drive. Each step is read from the game's state, so doing things in
// another order is fine (a step already done is passed over). A car that starts assembled skips
// the building. Skipped from the pause menu, and shown once (Settings > Game turns it back on).

import { settings, DEFAULT_BINDINGS } from '../core/settings.js';
import { keyName } from './ui.js';
import { COSMETIC } from './goals.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const K = (a) => keyName(settings.data.bindings[a] || DEFAULT_BINDINGS[a]);

// line drawings for the steps (48 x 48, drawn in the card's ink)
const svg = (body) => `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  look: svg('<rect x="15" y="7" width="18" height="29" rx="9"/><path d="M24 7v9"/><path d="M8 20l-4 4 4 4M40 20l4 4-4 4"/><path d="M12 42c3.5 2 7.5 3 12 3s8.5-1 12-3" opacity=".55"/>'),
  walk: svg('<rect x="17" y="5" width="14" height="14" rx="3"/><rect x="2" y="22" width="14" height="14" rx="3"/><rect x="17" y="22" width="14" height="14" rx="3"/><rect x="32" y="22" width="14" height="14" rx="3"/><path d="M24 15v-6M21 11l3-3 3 3M24 26v6M21 30l3 3 3-3M12 29H6M8 26l-3 3 3 3M36 29h6M40 26l3 3-3 3" stroke-width="1.8"/>'),
  find: svg('<path d="M24 5 41 22 24 39 7 22Z" fill="#f0b51b" stroke="#17140e" stroke-width="2"/><path d="M24 15v9M24 29v.5" stroke="#17140e" stroke-width="3"/><path d="M14 44h20" opacity=".5"/>'),
  take: svg('<path d="M15 27V15a3 3 0 0 1 6 0v9M21 23V11a3 3 0 0 1 6 0v12M27 23V13a3 3 0 0 1 6 0v11M33 24v-4a3 3 0 0 1 6 0v9c0 9-6 15-14 15h-2c-5 0-9-3-11-8l-4-8a3 3 0 0 1 5-3l3 5"/>'),
  fit: svg('<path d="M31 5a10 10 0 0 0-9.5 13.2L6.5 33.2a4.2 4.2 0 0 0 6 6l15-15A10 10 0 0 0 40.6 14l-6.3 4-4.8-1.7-1.7-4.8z"/>'),
  rest: svg('<path d="M4 33v-7l5-2 6-8h17l7 8 6 2v7h-4M15 33h18"/><circle cx="11" cy="33" r="4.5"/><circle cx="37" cy="33" r="4.5"/><path d="M16 18l-3 6h23l-5-6z" stroke-width="1.8"/>'),
  fuel: svg('<path d="M11 13h17l9 9v21H11z"/><path d="M14 13V7h9v6M18 7V4"/><path d="M16 24l16 14M32 24 16 38" stroke-width="1.8"/><path d="M40 10c0 3-2.5 4-2.5 6.5a2.5 2.5 0 0 0 5 0C42.5 14 40 13 40 10z" fill="currentColor" stroke="none"/>'),
  getin: svg('<path d="M7 9h21l13 13v19H7z"/><path d="M7 23h34"/><path d="M28 29h7" stroke-width="3"/><path d="M2 33h12M10 29l4 4-4 4" stroke-width="2"/>'),
  key: svg('<circle cx="14" cy="26" r="8"/><circle cx="14" cy="26" r="2.4"/><path d="M22 26h21M37 26v6M42 26v4"/><path d="M7 12a17 17 0 0 1 16-4" /><path d="M20 4l3 4-4 3"/>'),
  brake: svg('<path d="M8 40h22"/><path d="M14 40 33 13" stroke-width="4"/><circle cx="35" cy="11" r="4.2"/><circle cx="38" cy="33" r="7.5" stroke-width="2"/><path d="M36 37v-8h3a2.2 2.2 0 0 1 0 4.4h-3" stroke-width="2"/>'),
  drive: svg('<circle cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="4.5"/><path d="M6.5 21c6-2.3 11.8-3.2 17.5-3.2s11.5.9 17.5 3.2M24 28.5V42"/>'),
  north: svg('<path d="M24 4 37 40 24 32 11 40Z" fill="currentColor" fill-opacity=".18"/><path d="M19 22v-8l10 8v-8" stroke-width="2"/>'),
  done: svg('<path d="M10 25l9 9 19-20" stroke-width="3.4"/>'),
};

function partsLeft(car) {
  const ids = car.type.ASSEMBLY_ORDER.filter((id) => car.parts[id]);
  return ids.filter((id) => !car.isInstalled(id) && !COSMETIC.test(id)).length;
}
function partsOn(car) {
  return car.type.ASSEMBLY_ORDER.filter((id) => car.parts[id] && car.isInstalled(id)).length;
}
const seated = (g) => g.player.seat === 'driver' && g.player.car === g.car;
const holdingPart = (g) => !!(g.interaction && g.interaction.held && g.interaction.held.part);

// Each step: what it shows, when it is done, and when it is passed over unseen.
// keys: [key, what it does]; parts: only when the car starts in pieces.
function steps() {
  return [
    { id: 'look', title: 'Look around', keys: [['Mouse', 'look']], hint: 'Move the mouse to turn your head.', done: (t) => t.turned > 1.4 },
    { id: 'walk', title: 'Walk', keys: [[`${K('forward')} ${K('left')} ${K('back')} ${K('right')}`, 'walk'], [K('sprint'), 'run']], hint: 'Walk over to the garage.', done: (t) => t.walked > 6 },
    { id: 'find', parts: true, title: 'Find a part', keys: [], hint: 'The yellow diamond marks the next one. The top left corner says which part it is.', done: (t, g) => holdingPart(g) || partsOn(g.car) > t.on0 || (g.goals.goal && g.goals.goal.at && g.goals.goal.at.distanceTo(g.player.position) < 2.6) },
    { id: 'take', parts: true, title: 'Pick it up', keys: [[K('interact'), 'look at it and press']], hint: `Big parts take both hands. ${K('drop')} puts it down.`, done: (t, g) => holdingPart(g) || partsOn(g.car) > t.on0 },
    { id: 'fit', parts: true, title: 'Fit it to the car', keys: [[K('interact'), 'where it goes']], hint: 'Carry it to the car: hold it to the place it goes and press.', done: (t, g) => partsOn(g.car) > t.on0 },
    { id: 'rest', parts: true, title: 'Put the car together', keys: [[`${K('reload')} hold`, 'take a part off']], hint: 'The rest goes on the same way, one after another. The top left corner says what comes next. Panels can wait.', done: (t, g) => partsLeft(g.car) === 0 },
    { id: 'fuel', title: 'Fill her up', keys: [[K('interact'), 'open the flap, then the cap'], ['LMB', 'pour']], hint: 'Take a jerry can to the filler on the rear wing. Open it, hold the can to it and hold the left button.', skip: (t, g) => g.car.fuel >= 2, done: (t, g) => g.car.fuel >= 2 },
    { id: 'getin', title: 'Get in', keys: [[K('interact'), 'on the driver’s door']], hint: 'Open the door, then get in the same way.', skip: (t, g) => seated(g), done: (t, g) => seated(g) },
    { id: 'key', title: 'Start the engine', keys: [[`${K('interact')} hold`, 'look at the key']], hint: 'Keep holding until she catches.', skip: (t, g) => g.car.dyn.engine.running, done: (t, g) => g.car.dyn.engine.running },
    { id: 'brake', title: 'Release the parking brake', keys: [[K('interact'), 'look at the lever']], hint: 'The red light on the dash goes out.', skip: (t, g) => !g.car.parkBrake, done: (t, g) => !g.car.parkBrake },
    { id: 'drive', title: 'Drive', keys: [[K('forward'), 'gas'], [K('back'), 'brake, reverse'], [`${K('left')} ${K('right')}`, 'steer']], hint: 'Out onto the road.', done: (t) => t.driven > 45 },
    { id: 'north', title: 'Drive north to Haven', keys: [[K('journal'), 'journal'], [K('atlas'), 'road atlas'], ['Esc', 'pause']], hint: 'That is all you need. Eat, drink, sleep, and keep the car fed.', done: (t) => t.t > 11, last: true },
  ];
}

export class Tutorial {
  constructor(game, mode = 'parts') {
    this.game = game;
    this.list = steps().filter((s) => !s.parts || mode === 'parts');
    this.i = -1;
    this.t = 0;
    this.okT = 0;
    this.turned = 0;
    this.walked = 0;
    this.driven = 0;
    this.finished = false;
    this.root = el('div', 'tut', game.hud.root);
    this.next();
  }

  get active() {
    return !this.finished;
  }

  next() {
    const g = this.game;
    for (;;) {
      this.i++;
      if (this.i >= this.list.length) return this.finish();
      const s = this.list[this.i];
      this.t = 0;
      this.on0 = g.car ? partsOn(g.car) : 0;
      if (!(s.skip && s.skip(this, g))) break;
    }
    this.okT = 0;
    this.draw();
  }

  draw() {
    const s = this.list[this.i];
    const n = this.list.length;
    this.root.className = 'tut';
    this.root.innerHTML = `<div class="tut-head"><span class="tut-k">Tutorial</span><span class="tut-n">Step ${this.i + 1} of ${n}</span></div>
      <div class="tut-main"><div class="tut-icon">${ICONS[s.id] || ''}</div><div class="tut-body"><div class="tut-t">${esc(s.title)}</div>
      ${s.keys.map(([k, what]) => `<div class="tut-key"><kbd>${esc(k)}</kbd><span>${esc(what)}</span></div>`).join('')}</div></div>
      <p class="tut-hint">${esc(s.hint)}</p>
      <div class="tut-dots">${this.list.map((x, j) => `<i class="${j < this.i ? 'd' : j === this.i ? 'c' : ''}"></i>`).join('')}</div>
      <div class="tut-skip">${s.last ? 'Have a good trip' : 'Skip it in the pause menu (Esc)'}</div>`;
    // a fresh card slides in
    void this.root.offsetWidth;
    this.root.classList.add('on');
  }

  update(dt) {
    const g = this.game;
    if (this.finished || g.paused || !g.player) return;
    const p = g.player;
    // what the steps are judged by
    if (this.lastYaw !== undefined) {
      let d = p.yaw - this.lastYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.turned += Math.abs(d);
    }
    this.lastYaw = p.yaw;
    if (this.lastPos && !p.seat) this.walked += Math.min(1, Math.hypot(p.position.x - this.lastPos.x, p.position.z - this.lastPos.z));
    this.lastPos = { x: p.position.x, z: p.position.z };
    if (seated(g) && g.car.speedKmh > 3) this.driven += (g.car.speedKmh / 3.6) * dt;
    this.t += dt;
    if (this.okT > 0) {
      this.okT -= dt;
      if (this.okT <= 0) this.next();
      return;
    }
    const s = this.list[this.i];
    if (!s) return;
    // a long step tucks its hint away after a while
    this.root.classList.toggle('settled', this.t > 14 && !s.last);
    if (s.done(this, g)) {
      if (s.last) return this.finish();
      this.okT = 1.2;
      this.root.classList.add('ok');
      const ic = this.root.querySelector('.tut-icon');
      if (ic) ic.innerHTML = ICONS.done;
      g.audio && g.audio.uiSound && g.audio.uiSound('select');
    }
  }

  // Done or skipped: the card goes, and the next new game starts without it.
  finish() {
    if (this.finished) return;
    this.finished = true;
    settings.set('tutorial', false);
    this.root.classList.remove('on');
    this.root.classList.add('gone');
    setTimeout(() => this.root.remove(), 600);
  }
}
