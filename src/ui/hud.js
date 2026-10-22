// In-game HUD, in the look of the rest of the game (theme.css): plain type with a shadow over the
// world and as little of it as will do. The objective in the top left, a kilometre marker for the
// road to Haven in the top right, a thin compass at the top, the body's needs as short bars in
// the bottom left (they fade back while all is well), the car's speed, gear and gauges in the
// bottom right when driving, with its warnings on yellow plaques, and the hotbar at the bottom.

import { ICONS } from './icons.js';
import { ITEMS } from '../items/itemDefs.js';
import { itemIcon } from './itemIcons.js';
import { ALBUMS, trackOn } from '../audio/music/albums.js';
import { HAVEN_KM } from '../story/story.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

// The fists slot's picture: a clenched fist, knuckles forward.
const FIST_SVG = '<svg class="hb-fist" viewBox="0 0 48 48" aria-hidden="true"><path d="M12 22c0-3 2-5 4.5-5S21 19 21 21v-3c0-2.5 2-4.5 4.5-4.5S30 15.5 30 18v1c.5-2 2.4-3.4 4.5-3.2 2.4.2 4 2.3 4 4.7V29c0 7.5-5.5 13-13 13h-2C16.5 42 12 37.5 12 31.5z" fill="currentColor" opacity=".85"/><path d="M21 21v6M30 19v7M12 26h9c2 0 3.5 1.6 3.5 3.5S23 33 21 33h-4" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="1.6" stroke-linecap="round"/></svg>';
// the arrow toward the objective's thing
const ARROW_SVG = '<svg viewBox="0 0 16 16"><path d="M8 1.5 13 12 8 9.6 3 12z" fill="currentColor"/></svg>';

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = el('div', 'hud', document.body);
    this.root.style.display = 'none';
    // soft shade in the corners the type sits in, so it reads over a white sky or salt
    el('div', 'hud-shade', this.root);
    // crosshair
    this.cross = el('div', 'hud-cross', this.root);
    // interaction dots on the controls around the aim (see setDots)
    this.dotLayer = el('div', 'hud-dots', this.root);
    this.dotEls = [];
    this.hit = el('div', 'hud-hit', this.root);
    // what you look at (or hold): its name, a line about it, a bar, and the keys for it
    this.card = el('div', 'hud-card', this.root);
    this.cardTitle = el('div', 'hud-card-title', this.card);
    this.cardSub = el('div', 'hud-card-sub', this.card);
    this.cardBar = el('div', 'hud-card-bar', this.card);
    this.cardBarFill = el('div', '', this.cardBar);
    this.cardProg = el('div', 'hud-card-prog', this.card);
    this.cardProgFill = el('div', '', this.cardProg);
    this.prompts = el('div', 'hud-prompts', this.card);
    // the body (bottom left): a short bar each, stamina under them while it is spent
    this.needs = el('div', 'hud-needs', this.root);
    this.needEls = {};
    for (const [k, icon] of [
      ['health', 'heart'],
      ['food', 'food'],
      ['water', 'water'],
      ['energy', 'moon'],
      ['warmth', 'temp'],
    ]) {
      const row = el('div', 'hud-need need-' + k, this.needs);
      el('span', 'hud-icon', row, ICONS[icon]);
      const bar = el('div', 'hud-bar', row);
      const fill = el('i', '', bar);
      const val = el('span', 'hud-need-val', row);
      this.needEls[k] = { row, fill, val };
    }
    this.stamina = el('div', 'hud-stamina', this.needs);
    this.staminaFill = el('i', '', this.stamina);
    // the car (bottom right, driving): gear plate, speed, the rev counter, gauges, warnings
    this.veh = el('div', 'hud-veh', this.root);
    this.warn = el('div', 'hud-veh-warn', this.veh);
    const head = el('div', 'hud-veh-head', this.veh);
    this.gear = el('div', 'hud-gear', head);
    const sp = el('div', 'hud-speed-wrap', head);
    this.speed = el('div', 'hud-speed', sp);
    this.speedUnit = el('div', 'hud-speed-unit', sp, 'km/h');
    this.rpm = el('div', 'hud-rpm', this.veh);
    this.rpmSegs = [];
    for (let i = 0; i < 30; i++) {
      const seg = el('i', i >= 25 ? 'red' : '', this.rpm);
      seg.style.height = (4 + (i / 29) * 10).toFixed(1) + 'px';
      this.rpmSegs.push(seg);
    }
    this.vstats = el('div', 'hud-veh-stats', this.veh);
    this.fuel = this.vstat('fuel');
    this.temp = this.vstat('temp');
    this.batt = this.vstat('battery');
    // compass (top centre)
    this.top = el('div', 'hud-top', this.root);
    this.compass = el('div', 'hud-compass', this.top);
    this.compassStrip = el('div', 'hud-compass-strip', this.compass);
    const marks = [];
    for (let i = 0; i < 72; i++) {
      const deg = i * 5;
      const lab = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[deg];
      marks.push(`<span class="${lab ? 'lab' + (lab.length === 1 ? ' card' : '') : deg % 15 === 0 ? 'mid' : 'tick'}" style="left:${i * 12}px">${lab || ''}</span>`);
    }
    this.compassStrip.innerHTML = marks.join('') + marks.join('').replace(/left:(\d+)px/g, (m, n) => `left:${+n + 864}px`);
    this.heading = el('div', 'hud-heading', this.top);
    // the road to Haven (top right): a kilometre marker, as they stand along the road, and the
    // day and the time under it
    this.mile = el('div', 'hud-mile', this.root);
    const plate = el('div', 'hud-mile-plate', this.mile);
    el('div', 'hud-mile-k', plate, 'KM');
    this.dist = el('div', 'hud-mile-n', plate);
    this.haven = el('div', 'hud-mile-haven', this.mile);
    this.clock = el('div', 'hud-clock', this.mile);
    // hotbar (bottom centre): fists on 1, then slots 1-6 of the backpack on keys 2-7
    this.hotbar = el('div', 'hud-hotbar', this.root);
    this.hotLabel = el('div', 'hud-hotlabel', this.root);
    this.hotSlots = [];
    // 1: fists, always there
    this.fistSlot = el('div', 'hb-slot hb-fists', this.hotbar);
    el('span', 'hb-key', this.fistSlot, '1');
    this.fistSlot.insertAdjacentHTML('beforeend', FIST_SVG);
    for (let i = 0; i < 6; i++) {
      const d = el('div', 'hb-slot', this.hotbar);
      el('span', 'hb-key', d, String(i + 2));
      this.hotSlots.push(d);
    }
    this.ammoEl = el('div', 'hud-ammo', this.root);
    this.hotIdle = 0;
    // the objective (top left) and a marker on the thing it is about (see goals.js)
    this.goalEl = el('div', 'hud-goal', this.root);
    this.goalEl.innerHTML = `<div class="g-t"><span class="diamond"></span><b></b></div><div class="g-p"><div class="g-pb"><i></i></div><span class="g-s"></span></div><div class="g-n"><b class="g-dir">${ARROW_SVG}</b><span></span><em></em></div><div class="g-l"></div>`;
    this.goalParts = {
      t: this.goalEl.querySelector('.g-t b'),
      p: this.goalEl.querySelector('.g-p'),
      pf: this.goalEl.querySelector('.g-pb i'),
      s: this.goalEl.querySelector('.g-s'),
      n: this.goalEl.querySelector('.g-n'),
      nt: this.goalEl.querySelector('.g-n span'),
      dir: this.goalEl.querySelector('.g-dir'),
      dd: this.goalEl.querySelector('.g-n em'),
      l: this.goalEl.querySelector('.g-l'),
    };
    this.goalMark = el('div', 'hud-goalmark', this.root, '<i></i><span></span>');
    this.goalKey = null;
    // toasts
    this.toasts = el('div', 'hud-toasts', this.root);
    // radio / speech subtitles
    this.sub = el('div', 'hud-sub', this.root);
    // what the stereo is playing: the cover and two lines, under the kilometre marker
    this.music = el('div', 'hud-music', this.root);
    this.state = { prompts: '', info: null };
    this.hitTimer = 0;
    this.calm = 0;
    this.visible = false;
  }

  vstat(icon) {
    const row = el('div', 'hud-vstat', this.vstats);
    el('span', 'hud-icon', row, ICONS[icon]);
    const bar = el('div', 'hud-bar', row);
    const fill = el('i', '', bar);
    const val = el('span', 'hud-vstat-val', row);
    return { row, fill, val };
  }

  gauge(G, f, text, low) {
    const k = Math.round(Math.max(0, Math.min(1, f)) * 200);
    if (k !== G.k) {
      G.k = k;
      G.fill.style.transform = `scaleX(${(k / 200).toFixed(3)})`;
    }
    if (text !== G.t) G.val.textContent = G.t = text;
    if (low !== G.low) G.row.classList.toggle('low', (G.low = low));
  }

  show(on) {
    this.visible = on;
    this.root.style.display = on ? '' : 'none';
  }

  setPrompts(list) {
    const key = JSON.stringify(list);
    if (key === this.state.prompts) return;
    this.state.prompts = key;
    this.prompts.innerHTML = list
      .map(([k, label, hint]) => (k ? `<div class="p"><kbd>${k}</kbd><span>${label}</span>${hint ? `<em>${hint}</em>` : ''}</div>` : `<div class="p muted"><span class="diamond"></span><span>${label}</span></div>`))
      .join('');
  }

  setTargetInfo(info) {
    const has = !!info;
    this.card.classList.toggle('on', has || this.state.prompts !== '[]');
    if (!info) {
      this.cardTitle.textContent = '';
      this.cardSub.textContent = '';
      this.cardBar.style.display = 'none';
      this.cardProg.style.display = 'none';
      return;
    }
    this.cardTitle.textContent = info.title || '';
    this.cardSub.textContent = info.sub || '';
    if (info.bar !== undefined && info.bar !== null) {
      this.cardBar.style.display = '';
      this.cardBarFill.style.transform = `scaleX(${Math.max(0, Math.min(1, info.bar)).toFixed(3)})`;
    } else this.cardBar.style.display = 'none';
    if (info.progress !== undefined) {
      this.cardProg.style.display = '';
      this.cardProgFill.style.transform = `scaleX(${Math.max(0, Math.min(1, info.progress)).toFixed(3)})`;
    } else this.cardProg.style.display = 'none';
  }

  // Next to the crosshair for what you look at; in the lower right corner, out of the way of the
  // thing in your hands, for what you hold (above the car's dials when seated).
  setCardPlace(held, seated) {
    this.card.classList.toggle('held', !!held);
    this.card.classList.toggle('seated', !!(held && seated));
  }

  // Interaction dots: a small mark on each control near the middle of the view, fading in as the
  // aim comes closer; the one aimed at grows into a ring with its name over it.
  // list: [{ x, y (pixels), a (0..1), on, label, sub }]
  setDots(list) {
    const pool = this.dotEls;
    while (pool.length < list.length) {
      const d = el('div', 'hud-dot', this.dotLayer, '<i></i><span><b></b><em></em></span>');
      d._b = d.querySelector('b');
      d._em = d.querySelector('em');
      d._v = true;
      pool.push(d);
    }
    for (let i = 0; i < pool.length; i++) {
      const d = pool[i],
        o = list[i];
      if (!o) {
        if (d._v) d.style.display = 'none';
        d._v = false;
        continue;
      }
      if (!d._v) d.style.display = '';
      d._v = true;
      d.style.transform = `translate3d(${o.x.toFixed(1)}px, ${o.y.toFixed(1)}px, 0)`;
      d.style.opacity = o.a.toFixed(2);
      if (d._on !== !!o.on) d.classList.toggle('on', (d._on = !!o.on));
      if (o.on) {
        if (d._label !== o.label) d._b.textContent = d._label = o.label;
        if (d._sub !== (o.sub || '')) d._em.textContent = d._sub = o.sub || '';
      }
    }
  }

  // The objective panel. goal: { key, title, sub, progress, next, lines, kind } or null. A new
  // objective slides in bright; one that has stood a while settles back.
  setGoal(goal) {
    const G = this.goalParts;
    const e = this.goalEl;
    if (!goal) {
      e.classList.remove('on');
      this.goalKey = null;
      return;
    }
    e.classList.add('on');
    e.classList.toggle('warn', goal.kind === 'warn');
    if (goal.key !== this.goalKey) {
      this.goalKey = goal.key;
      this.goalSince = performance.now();
      e.classList.remove('fresh');
      void e.offsetWidth;
      e.classList.add('fresh');
      this.game.audio && this.game.audio.uiSound && this.game.audio.uiSound('hover');
    }
    e.classList.toggle('settled', performance.now() - this.goalSince > 9000 && !goal.at);
    if (G.t.textContent !== goal.title) G.t.textContent = goal.title;
    if (goal.progress !== undefined) G.pf.style.transform = `scaleX(${Math.max(0.02, Math.min(1, goal.progress)).toFixed(3)})`;
    const sub = goal.sub || '';
    if (G.s.textContent !== sub) G.s.textContent = sub;
    G.p.classList.toggle('nobar', goal.progress === undefined);
    G.p.style.display = sub || goal.progress !== undefined ? '' : 'none';
    // (the next thing, or where the objective's thing is when there is no next)
    const next = goal.next || '';
    G.n.style.display = next ? '' : 'none';
    if (next && G.nt.textContent !== next) G.nt.textContent = next;
    G.dir.style.display = goal.at ? '' : 'none';
    G.dd.style.display = goal.at ? '' : 'none';
    const lines = (goal.lines || []).map((t) => `<div>${esc(t)}</div>`).join('');
    if (lines !== this._goalLines) G.l.innerHTML = this._goalLines = lines;
  }

  // Which way the objective's thing lies from where you look, and how far.
  setGoalDir(d) {
    const G = this.goalParts;
    G.dir.style.transform = `rotate(${d.a.toFixed(3)}rad)`;
    const t = d.d < 1.5 ? 'here' : Math.round(d.d) + ' m';
    if (G.dd.textContent !== t) G.dd.textContent = t;
  }

  // A marker over the objective's thing when it is in view: { x, y, d } in pixels, or null.
  setGoalMark(m) {
    const e = this.goalMark;
    if (!m) {
      if (e._on) e.classList.remove('on');
      e._on = false;
      return;
    }
    if (!e._on) e.classList.add('on');
    e._on = true;
    e.style.transform = `translate3d(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px, 0)`;
    const t = Math.round(m.d) + ' m';
    const sp = e.lastChild;
    if (sp.textContent !== t) sp.textContent = t;
  }

  setCrosshair(kind) {
    this.cross.className = 'hud-cross ' + kind;
  }

  hitmarker(head) {
    this.hit.className = 'hud-hit on' + (head ? ' head' : '');
    this.hitTimer = 0.18;
  }

  subtitle(who, text, seconds = 6) {
    this.sub.innerHTML = `<b>${who}</b><span>${text}</span>`;
    this.sub.classList.add('on');
    clearTimeout(this._subT);
    this._subT = setTimeout(() => this.sub.classList.remove('on'), seconds * 1000);
  }

  // "Now playing" card when a track starts (a disc, or a song on a music station).
  nowPlaying(disc, track, station = null) {
    const al = ALBUMS[disc % ALBUMS.length];
    const [a, b, c] = al.colors;
    const tag = station ? `${esc(station.freq)} \u00b7 ${esc(station.name)}` : `CD \u00b7 track ${track + 1} of ${al.tracks.length}`;
    this.showMusic(`<div class="cover" style="background:linear-gradient(135deg, ${a}, ${b} 62%, ${c})"><i></i></div>
      <div class="txt"><small>${tag}</small><b>${esc(al.tracks[trackOn(disc, track)])}</b><span>${esc(al.artist)} \u00b7 ${esc(al.title)}</span></div>`);
  }

  // A station tuned in that is not playing records (talk, the emergency loop, static).
  tunedTo(station) {
    this.showMusic(`<div class="cover radio"><i></i></div><div class="txt"><small>Radio</small><b>${esc(station.freq)}</b><span>${esc(station.name)}</span></div>`);
  }

  showMusic(html) {
    this.music.innerHTML = html;
    this.music.classList.add('on');
    clearTimeout(this._musT);
    this._musT = setTimeout(() => this.music.classList.remove('on'), 5200);
  }

  // Brings the hotbar back to full opacity for a few seconds.
  pulseHotbar() {
    this.hotIdle = 0;
    this._hb = null;
  }

  toast(text, kind = '') {
    const t = el('div', 'hud-toast ' + kind, this.toasts, text);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  update(dt) {
    if (!this.visible) return;
    const g = this.game;
    const p = g.player;
    if (!p) return;
    this.hitTimer -= dt;
    if (this.hitTimer <= 0) this.hit.className = 'hud-hit';
    // needs: a bar each, yellow when low, red and beating when it is about to hurt; the lot
    // fades back while nothing is low and nothing has changed for a while
    let worst = 100;
    for (const k of ['health', 'food', 'water', 'energy', 'warmth']) {
      const v = Math.max(0, Math.min(100, p[k]));
      worst = Math.min(worst, v);
      const e = this.needEls[k];
      const r = Math.round(v);
      if (e.last !== r) {
        if (e.last !== undefined && Math.abs(e.last - r) > 1) this.calm = 0;
        e.last = r;
        e.fill.style.transform = `scaleX(${(v / 100).toFixed(3)})`;
      }
      const low = v < 25,
        crit = v < 10;
      if (e.low !== low) e.row.classList.toggle('low', (e.low = low));
      if (e.crit !== crit) e.row.classList.toggle('crit', (e.crit = crit));
    }
    // the warmth bar turns icy when cold and says the air temperature
    const cold = p.warmth < 45;
    if (cold !== this._cold) this.needEls.warmth.row.classList.toggle('cold', (this._cold = cold));
    const at = Math.round(p.airTemp ?? 20);
    if (at !== this._at) {
      this._at = at;
      this.needEls.warmth.val.textContent = `${at}°`;
    }
    const tired = p.stamina < 99 && !p.seat;
    if (tired) this.calm = 0;
    this.stamina.classList.toggle('on', tired);
    this.staminaFill.style.transform = `scaleX(${(p.stamina / 100).toFixed(3)})`;
    this.calm += dt;
    this.needs.classList.toggle('calm', this.calm > 6 && worst > 40);
    // vehicle
    const car = g.car;
    const driving = p.seat === 'driver';
    this.veh.classList.toggle('on', !!driving);
    this.root.classList.toggle('driving', !!driving);
    if (driving && car) {
      const kmh = Math.abs(car.speedKmh);
      const sk = Math.round(kmh);
      if (sk !== this._sk) this.speed.textContent = this._sk = sk;
      const running = car.dyn.engine.running;
      const gl = running ? car.dyn.gearLabel() : car.ignition ? 'ON' : 'OFF';
      if (gl !== this._gl) {
        this.gear.textContent = this._gl = gl;
        this.gear.classList.toggle('off', !running);
      }
      const lit = Math.round(Math.min(1, car.dyn.engine.rpm / 7000) * this.rpmSegs.length);
      if (lit !== this._lit) {
        this._lit = lit;
        this.rpmSegs.forEach((d, i) => d.classList.toggle('on', i < lit));
      }
      this.gauge(this.fuel, car.fuel / car.fuelCap, car.fuel.toFixed(car.fuel < 10 ? 1 : 0) + ' L', car.fuel / car.fuelCap < 0.12);
      this.gauge(this.temp, (car.engineTemp - 40) / 90, Math.round(car.engineTemp) + '°', car.engineTemp > 110);
      this.gauge(this.batt, car.battery, Math.round(car.battery * 100) + '%', car.battery < 0.15);
      const w = [];
      if (!car.isInstalled('battery')) w.push('No battery');
      else if (car.battery < 0.05) w.push('Battery dead');
      if (!car.isInstalled('engine')) w.push('No engine');
      if (car.oil < 0.8) w.push('Low oil');
      if (car.coolantCap && (car.coolant < car.coolantCap * 0.3 || !car.isInstalled('radiator'))) w.push('Low coolant');
      if (car.engineTemp > 112) w.push('Overheating');
      if (car.fire > 0) w.push('Engine fire');
      if (!car.isInstalled('steeringWheel')) w.push('No steering wheel');
      if (car.dyn.wheels.some((x) => x.flat)) w.push('Flat tyre');
      if (car.parkBrake && car.dyn.engine.running) w.push('Parking brake');
      const wk = w.slice(0, 3).join('|');
      if (wk !== this._wk) {
        this._wk = wk;
        this.warn.innerHTML = w
          .slice(0, 3)
          .map((t) => `<span>${t}</span>`)
          .join('');
      }
    }
    // compass
    const cam = g.renderer.camera;
    const fwd = cam.getWorldDirection(cam.position.clone());
    // world +z is "north" along the road
    let hdg = (Math.atan2(-fwd.x, fwd.z) * 180) / Math.PI;
    hdg = (hdg + 360) % 360;
    this.compassStrip.style.transform = `translateX(${(-(hdg / 5) * 12 + 150 - 864).toFixed(1)}px)`;
    const hd = String(Math.round(hdg) % 360).padStart(3, '0');
    if (hd !== this._hd) this.heading.textContent = this._hd = hd;
    // the day and the hour
    const h = g.env.time;
    const hh = Math.floor(h),
      mm = Math.floor((h - hh) * 60);
    const ck = `Day ${g.env.day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    if (ck !== this._ck) this.clock.textContent = this._ck = ck;
    // the kilometre marker: the whole kilometres up Route 9, like the posts along it
    const km = Math.max(0, g.focusPoint().z + g.origin.z) / 1000;
    const kn = Math.floor(km);
    if (kn !== this._kn) {
      this._kn = kn;
      this.dist.textContent = kn;
      this.haven.innerHTML = kn >= HAVEN_KM ? 'Haven' : `Haven <b>${Math.max(0, HAVEN_KM - kn)}</b> km`;
    }
    // hotbar
    const ia = g.interaction;
    const inv = g.inventory;
    if (ia && inv) {
      const key = inv.slots.slice(0, 6).map((x) => (x ? x.id + ':' + (x.count || 1) : '')).join(',') + '|' + inv.heldFrom + '|' + (ia.held ? 1 : 0) + '|' + (ia.fists ? 1 : 0);
      if (key !== this._hb) {
        this._hb = key;
        this.hotIdle = 0;
        this.fistSlot.classList.toggle('on', !!ia.fists && !ia.held);
        this.hotSlots.forEach((d, i) => {
          const e = inv.slots[i];
          d.classList.toggle('on', i === inv.heldFrom && !!ia.held);
          d.classList.toggle('empty', !e);
          let img = d.querySelector('img');
          if (!e) {
            if (img) img.remove();
            d.querySelector('.hb-n') && d.querySelector('.hb-n').remove();
            d.title = '';
            return;
          }
          if (!img) {
            img = el('img', '', d);
            img.draggable = false;
          }
          const def = ITEMS[e.id];
          const ikey = e.id + (def && def.variants ? ':' + (e.state.variant || 0) : '');
          const url = itemIcon(ikey, () => g.items.buildMesh(e.id, e.state), def && def.weapon ? 'weapon' : '', { async: true, onReady: () => (this._hb = null) });
          if (url) img.src = url;
          let n = d.querySelector('.hb-n');
          if ((e.count || 1) > 1) {
            if (!n) n = el('span', 'hb-n', d);
            n.textContent = '×' + e.count;
          } else if (n) n.remove();
        });
      }
      const name = ia.held ? ia.held.name || (ia.held.def && ia.held.def.name) || '' : '';
      if (name !== this._hn) {
        this._hn = name;
        this.hotLabel.textContent = name;
        this.hotLabel.classList.toggle('on', !!name);
        this.hotIdle = 0;
      }
      this.hotIdle += dt;
      this.hotLabel.classList.toggle('dim', this.hotIdle > 4);
      this.hotbar.classList.toggle('dim', this.hotIdle > 4 && !(g.ui && g.ui.current === 'inventory'));
      const akey = ia.ammo['38'] + ',' + ia.ammo['12'];
      if (akey !== this._am) {
        this._am = akey;
        this.ammoEl.innerHTML = (ia.ammo['38'] ? `<span>.38 × ${ia.ammo['38']}</span>` : '') + (ia.ammo['12'] ? `<span>12 ga × ${ia.ammo['12']}</span>` : '');
      }
    }
  }
}
