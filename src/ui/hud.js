// In-game HUD: crosshair, target card with key prompts, vitals rings, vehicle cluster, toasts,
// hit markers, compass with the road to Haven, and the hotbar. Everything sits on soft frosted
// panels and fades when not relevant; colours carry meaning (red health, amber food, blue water,
// yellow rest) so a glance is enough.

import { ICONS } from './icons.js';
import { ITEMS } from '../items/itemDefs.js';
import { itemIcon } from './itemIcons.js';
import { ALBUMS } from '../audio/music/albums.js';
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

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = el('div', 'hud', document.body);
    this.root.style.display = 'none';
    // crosshair
    this.cross = el('div', 'hud-cross', this.root);
    // interaction dots on the controls around the aim (see setDots)
    this.dotLayer = el('div', 'hud-dots', this.root);
    this.dotEls = [];
    this.hit = el('div', 'hud-hit', this.root);
    // target card
    this.card = el('div', 'hud-card', this.root);
    this.cardTitle = el('div', 'hud-card-title', this.card);
    this.cardSub = el('div', 'hud-card-sub', this.card);
    this.cardBar = el('div', 'hud-card-bar', this.card);
    this.cardBarFill = el('div', '', this.cardBar);
    this.cardProg = el('div', 'hud-card-prog', this.card);
    this.cardProgFill = el('div', '', this.cardProg);
    this.prompts = el('div', 'hud-prompts', this.card);
    // vitals (bottom left): four rings with a number, stamina under them
    this.needs = el('div', 'hud-needs', this.root);
    this.needEls = {};
    const C = 2 * Math.PI * 19;
    this.ringC = C;
    for (const [k, icon, label] of [
      ['health', 'heart', 'Health'],
      ['food', 'food', 'Food'],
      ['water', 'water', 'Water'],
      ['energy', 'energy', 'Rest'],
      ['warmth', 'temp', 'Warmth'],
    ]) {
      const row = el('div', 'hud-need need-' + k, this.needs);
      row.innerHTML = `<svg class="ring" viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="19"/><circle class="fg" cx="22" cy="22" r="19" stroke-dasharray="${C.toFixed(2)}"/></svg>`;
      el('span', 'hud-icon', row, ICONS[icon]);
      const val = el('span', 'hud-need-val', row);
      el('span', 'hud-need-lab', row, label);
      this.needEls[k] = { row, fg: row.querySelector('.fg'), val };
    }
    this.stamina = el('div', 'hud-stamina', this.needs);
    this.staminaFill = el('div', '', this.stamina);
    // vehicle cluster (bottom right)
    this.veh = el('div', 'hud-veh', this.root);
    const head = el('div', 'hud-veh-head', this.veh);
    const sp = el('div', 'hud-speed-wrap', head);
    this.speed = el('div', 'hud-speed', sp);
    this.speedUnit = el('div', 'hud-speed-unit', sp, 'km/h');
    this.gear = el('div', 'hud-gear', head);
    this.rpm = el('div', 'hud-rpm', this.veh);
    this.rpmSegs = [];
    for (let i = 0; i < 28; i++) this.rpmSegs.push(el('i', i >= 24 ? 'red' : i >= 20 ? 'hot' : '', this.rpm));
    this.vrow = this.rpm;
    this.vstats = el('div', 'hud-veh-stats', this.veh);
    this.fuel = this.vstat('fuel', 'Fuel');
    this.temp = this.vstat('temp', 'Temp');
    this.batt = this.vstat('battery', 'Battery');
    this.warn = el('div', 'hud-veh-warn', this.veh);
    // compass + clock + the road to Haven (top centre)
    this.top = el('div', 'hud-top', this.root);
    this.compass = el('div', 'hud-compass', this.top);
    this.compassStrip = el('div', 'hud-compass-strip', this.compass);
    const marks = [];
    for (let i = 0; i < 72; i++) {
      const deg = i * 5;
      const lab = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[deg];
      marks.push(`<span class="${lab ? 'lab' : deg % 15 === 0 ? 'mid' : 'tick'}" style="left:${i * 12}px">${lab || ''}</span>`);
    }
    this.compassStrip.innerHTML = marks.join('') + marks.join('').replace(/left:(\d+)px/g, (m, n) => `left:${+n + 864}px`);
    this.heading = el('div', 'hud-heading', this.top);
    const info = el('div', 'hud-info', this.top);
    this.clock = el('div', 'hud-clock', info);
    const route = el('div', 'hud-route', info);
    this.dist = el('div', 'hud-dist', route);
    this.routeBar = el('div', 'hud-route-bar', route);
    this.routeFill = el('div', '', this.routeBar);
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
    // toasts
    this.toasts = el('div', 'hud-toasts', this.root);
    // radio / speech subtitles
    this.sub = el('div', 'hud-sub', this.root);
    // what the stereo is playing: a small card with the cover, slides in at the top left
    this.music = el('div', 'hud-music', this.root);
    // vignette for damage handled in post
    this.state = { prompts: '', info: null };
    this.hitTimer = 0;
    this.visible = false;
  }

  vstat(icon, label) {
    const row = el('div', 'hud-vstat', this.vstats);
    el('span', 'hud-icon', row, ICONS[icon]);
    el('span', 'hud-vstat-lab', row, label);
    const bar = el('div', 'hud-vstat-bar', row);
    const fill = el('div', '', bar);
    const val = el('span', 'hud-vstat-val', row);
    return { row, fill, val };
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
      .map(([k, label, hint]) => (k ? `<div class="p"><kbd>${k}</kbd><span>${label}</span>${hint ? `<em>${hint}</em>` : ''}</div>` : `<div class="p muted"><span>${label}</span></div>`))
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
      this.cardBarFill.style.width = Math.round(Math.max(0, Math.min(1, info.bar)) * 100) + '%';
    } else this.cardBar.style.display = 'none';
    if (info.progress !== undefined) {
      this.cardProg.style.display = '';
      this.cardProgFill.style.width = Math.round(Math.min(1, info.progress) * 100) + '%';
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
      <div class="txt"><small>${tag}</small><b>${esc(al.tracks[track])}</b><span>${esc(al.artist)} \u00b7 ${esc(al.title)}</span></div>`);
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
    // needs: rows highlight when low
    for (const k of ['health', 'food', 'water', 'energy', 'warmth']) {
      const v = Math.max(0, Math.min(100, p[k]));
      const e = this.needEls[k];
      const r = Math.round(v);
      if (e.last !== r) {
        e.last = r;
        e.fg.style.strokeDashoffset = (this.ringC * (1 - v / 100)).toFixed(2);
        e.val.textContent = r;
      }
      e.row.classList.toggle('low', v < 25);
      e.row.classList.toggle('crit', v < 10);
    }
    // the warmth ring turns icy when cold and shows the air temperature on its label
    const wv = p.warmth;
    this.needEls.warmth.row.classList.toggle('cold', wv < 45);
    const at = Math.round(p.airTemp ?? 20);
    if (at !== this._at) {
      this._at = at;
      this.needEls.warmth.row.querySelector('.hud-need-lab').textContent = `${at}°C`;
    }
    this.stamina.style.opacity = p.stamina < 99 && !p.seat ? 1 : 0;
    this.staminaFill.style.width = p.stamina.toFixed(0) + '%';
    // vehicle
    const car = g.car;
    const driving = p.seat === 'driver';
    this.veh.classList.toggle('on', !!driving);
    if (driving && car) {
      const kmh = Math.abs(car.speedKmh);
      this.speed.textContent = Math.round(kmh);
      this.gear.textContent = car.dyn.engine.running ? car.dyn.gearLabel() : car.ignition ? 'ON' : 'OFF';
      this.gear.classList.toggle('off', !car.dyn.engine.running);
      const lit = Math.round(Math.min(1, car.dyn.engine.rpm / 7000) * this.rpmSegs.length);
      if (lit !== this._lit) {
        this._lit = lit;
        this.rpmSegs.forEach((d, i) => d.classList.toggle('on', i < lit));
      }
      this.fuel.fill.style.width = (car.fuel / car.fuelCap) * 100 + '%';
      this.fuel.val.textContent = car.fuel.toFixed(car.fuel < 10 ? 1 : 0) + ' L';
      this.fuel.row.classList.toggle('low', car.fuel / car.fuelCap < 0.12);
      const tn = Math.max(0, Math.min(1, (car.engineTemp - 40) / 90));
      this.temp.fill.style.width = tn * 100 + '%';
      this.temp.val.textContent = Math.round(car.engineTemp) + '°';
      this.temp.row.classList.toggle('low', car.engineTemp > 110);
      this.batt.fill.style.width = car.battery * 100 + '%';
      this.batt.val.textContent = Math.round(car.battery * 100) + '%';
      this.batt.row.classList.toggle('low', car.battery < 0.15);
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
        this.warn.innerHTML = w.slice(0, 3).map((t) => `<span>${t}</span>`).join('');
      }
    }
    // compass
    const cam = g.renderer.camera;
    const fwd = cam.getWorldDirection(cam.position.clone());
    // world +z is "north" along the road
    let hdg = (Math.atan2(-fwd.x, fwd.z) * 180) / Math.PI;
    hdg = (hdg + 360) % 360;
    this.compassStrip.style.transform = `translateX(${-(hdg / 5) * 12 + 180 - 864}px)`;
    this.heading.textContent = String(Math.round(hdg) % 360).padStart(3, '0') + '°';
    const h = g.env.time;
    const hh = Math.floor(h),
      mm = Math.floor((h - hh) * 60);
    this.clock.innerHTML = `<b>Day ${g.env.day}</b> ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const km = Math.max(0, g.focusPoint().z + g.origin.z) / 1000;
    const dk = km.toFixed(1);
    if (dk !== this._dk) {
      this._dk = dk;
      this.dist.innerHTML = `${dk} km <span>· Haven ${Math.max(0, HAVEN_KM - km).toFixed(0)} km</span>`;
      this.routeFill.style.width = Math.min(100, (km / HAVEN_KM) * 100).toFixed(1) + '%';
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
