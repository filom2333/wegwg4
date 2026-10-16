// In-game HUD: crosshair, target card with key prompts, needs, vehicle readout, toasts,
// hit markers, compass and the hotbar. Quiet by design: everything fades when not relevant.

import { ICONS } from './icons.js';
import { ITEMS } from '../items/itemDefs.js';
import { itemIcon } from './itemIcons.js';
import { ALBUMS } from '../audio/music/albums.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = el('div', 'hud', document.body);
    this.root.style.display = 'none';
    // crosshair
    this.cross = el('div', 'hud-cross', this.root);
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
    // needs (bottom left)
    this.needs = el('div', 'hud-needs', this.root);
    this.needEls = {};
    for (const [k, icon] of [
      ['health', 'heart'],
      ['food', 'food'],
      ['water', 'water'],
      ['energy', 'energy'],
    ]) {
      const row = el('div', 'hud-need', this.needs);
      el('span', 'hud-icon', row, ICONS[icon]);
      const bar = el('div', 'hud-need-bar', row);
      const fill = el('div', '', bar);
      this.needEls[k] = { row, fill };
    }
    this.stamina = el('div', 'hud-stamina', this.root);
    this.staminaFill = el('div', '', this.stamina);
    // vehicle (bottom right)
    this.veh = el('div', 'hud-veh', this.root);
    this.speed = el('div', 'hud-speed', this.veh);
    this.speedUnit = el('div', 'hud-speed-unit', this.veh, 'km/h');
    this.vrow = el('div', 'hud-veh-row', this.veh);
    this.gear = el('div', 'hud-gear', this.vrow);
    this.rpm = el('div', 'hud-rpm', this.vrow);
    this.rpmFill = el('div', '', this.rpm);
    this.vstats = el('div', 'hud-veh-stats', this.veh);
    this.fuel = this.vstat('fuel');
    this.temp = this.vstat('temp');
    this.batt = this.vstat('battery');
    this.warn = el('div', 'hud-veh-warn', this.veh);
    // compass + clock (top centre)
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
    this.clock = el('div', 'hud-clock', this.top);
    this.dist = el('div', 'hud-dist', this.top);
    // hotbar (bottom centre): slots 1-6 of the backpack
    this.hotbar = el('div', 'hud-hotbar', this.root);
    this.hotSlots = [];
    for (let i = 0; i < 6; i++) {
      const d = el('div', 'hb-slot', this.hotbar);
      el('span', 'hb-key', d, String(i + 1));
      this.hotSlots.push(d);
    }
    this.ammoEl = el('div', 'hud-ammo', this.root);
    this.hotIdle = 0;
    // toasts
    this.toasts = el('div', 'hud-toasts', this.root);
    // radio / speech subtitles
    this.sub = el('div', 'hud-sub', this.root);
    // vignette for damage handled in post
    this.state = { prompts: '', info: null };
    this.hitTimer = 0;
    this.visible = false;
  }

  vstat(icon) {
    const row = el('div', 'hud-vstat', this.vstats);
    el('span', 'hud-icon', row, ICONS[icon]);
    const bar = el('div', 'hud-vstat-bar', row);
    const fill = el('div', '', bar);
    return { row, fill };
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

  // "Now playing" line when a CD track starts.
  nowPlaying(disc, track) {
    const al = ALBUMS[disc % ALBUMS.length];
    this.subtitle('\u266a ' + al.artist, `${al.tracks[track]}  \u00b7  ${al.title}`, 5);
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
    for (const k of ['health', 'food', 'water', 'energy']) {
      const v = p[k];
      const e = this.needEls[k];
      e.fill.style.width = v.toFixed(1) + '%';
      e.row.classList.toggle('low', v < 25);
      e.row.classList.toggle('crit', v < 10);
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
      this.rpmFill.style.width = Math.min(100, (car.dyn.engine.rpm / 7000) * 100) + '%';
      this.rpm.classList.toggle('red', car.dyn.engine.rpm > 6200);
      this.fuel.fill.style.width = (car.fuel / car.fuelCap) * 100 + '%';
      this.fuel.row.classList.toggle('low', car.fuel / car.fuelCap < 0.12);
      const tn = Math.max(0, Math.min(1, (car.engineTemp - 40) / 90));
      this.temp.fill.style.width = tn * 100 + '%';
      this.temp.row.classList.toggle('low', car.engineTemp > 110);
      this.batt.fill.style.width = car.battery * 100 + '%';
      this.batt.row.classList.toggle('low', car.battery < 0.15);
      const w = [];
      if (!car.isInstalled('battery')) w.push('No battery');
      else if (car.battery < 0.05) w.push('Battery dead');
      if (!car.isInstalled('engine')) w.push('No engine');
      if (car.oil < 0.8) w.push('Low oil');
      if (car.engineTemp > 112) w.push('Overheating');
      if (car.fire > 0) w.push('Engine fire');
      if (!car.isInstalled('steeringWheel')) w.push('No steering wheel');
      if (car.dyn.wheels.some((x) => x.flat)) w.push('Flat tyre');
      if (!car.ignition) w.push('E on ignition or press I');
      else if (!car.dyn.engine.running) w.push('Hold I to start');
      this.warn.textContent = w.slice(0, 2).join(' · ');
    }
    // compass
    const cam = g.renderer.camera;
    const fwd = cam.getWorldDirection(cam.position.clone());
    // world +z is "north" along the road
    let hdg = (Math.atan2(-fwd.x, fwd.z) * 180) / Math.PI;
    hdg = (hdg + 360) % 360;
    this.compassStrip.style.transform = `translateX(${-(hdg / 5) * 12 - 864 / 2 + 864 / 2 + 120 - 864}px)`;
    const h = g.env.time;
    const hh = Math.floor(h),
      mm = Math.floor((h - hh) * 60);
    this.clock.textContent = `Day ${g.env.day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const z = g.focusPoint().z + g.origin.z;
    this.dist.textContent = `${(Math.max(0, z) / 1000).toFixed(1)} km`;
    // hotbar
    const ia = g.interaction;
    const inv = g.inventory;
    if (ia && inv) {
      const key = inv.slots.slice(0, 6).map((x) => (x ? x.id + ':' + (x.count || 1) : '')).join(',') + '|' + inv.heldFrom + '|' + (ia.held ? 1 : 0);
      if (key !== this._hb) {
        this._hb = key;
        this.hotIdle = 0;
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
      this.hotIdle += dt;
      this.hotbar.classList.toggle('dim', this.hotIdle > 4 && !(g.ui && g.ui.current === 'inventory'));
      const akey = ia.ammo['38'] + ',' + ia.ammo['12'];
      if (akey !== this._am) {
        this._am = akey;
        this.ammoEl.innerHTML = (ia.ammo['38'] ? `<span>.38 × ${ia.ammo['38']}</span>` : '') + (ia.ammo['12'] ? `<span>12 ga × ${ia.ammo['12']}</span>` : '');
      }
    }
  }
}
