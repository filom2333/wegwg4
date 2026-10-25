// Inventory screen: backpack (hotbar row + pack) on the left, the hands in the middle, and a
// second panel on the right for whatever is at hand: things lying nearby, the car's trunk or
// glovebox. Drag and drop between any slots, shift-click to send to the other side,
// double-click to take in hand, right-click for actions, hover for details, 2-7 over a slot to
// put it on the hotbar.

import * as THREE from 'three';
import { ITEMS, itemLabel } from '../items/itemDefs.js';
import { ALBUMS } from '../audio/music/albums.js';
import { HOTBAR, CAPACITY, fitsInBag, entryMass, moveSlot } from '../items/inventory.js';
import { itemIcon } from './itemIcons.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const NEARBY_R = 2.6;

// Readable details for an inventory entry (or a held item's id/state).
export function describeEntry(id, state = {}, ammo = {}) {
  const def = ITEMS[id];
  if (!def) return { title: id, lines: [] };
  const lines = [];
  if (def.liquid) lines.push(`${(state.liquid || 0).toFixed(1)} / ${def.liquid.cap} l ${state.liquidType || def.liquid.type}`);
  if (def.consume) {
    const c = def.consume;
    const parts = [];
    if (c.food > 0) parts.push(`food +${c.food}`);
    if (c.water > 0) parts.push(`water +${c.water}`);
    if (c.health > 0) parts.push(`health +${c.health}`);
    if (c.energy > 0) parts.push(`energy +${c.energy}`);
    if (parts.length) lines.push(parts.join(' · '));
  }
  if (def.weapon) lines.push(`${state.loaded || 0} / ${def.weapon.mag} loaded · pouch ${ammo[def.weapon.ammo] || 0}`);
  else if (def.charges !== undefined) lines.push(`${state.charges ?? def.charges} use${(state.charges ?? def.charges) === 1 ? '' : 's'} left`);
  if (def.ammo) lines.push(`${def.ammo.count} rounds`);
  if (def.disc) {
    const al = ALBUMS[(state.variant || 0) % ALBUMS.length];
    lines.push(`${al.year} · ${al.tracks.length} tracks`);
    lines.push(al.tracks.map((t, i) => `${i + 1}. ${t}`).join('  '));
  }
  return { title: itemLabel(id, state), desc: def.desc || '', lines };
}

// Fill level shown as a thin bar on the slot (liquid, charges, loaded rounds).
function fillOf(id, state = {}) {
  const def = ITEMS[id];
  if (!def) return null;
  if (def.liquid) return (state.liquid || 0) / def.liquid.cap;
  if (def.weapon) return (state.loaded || 0) / def.weapon.mag;
  if (def.charges !== undefined && def.charges > 1) return (state.charges ?? def.charges) / def.charges;
  return null;
}

export class InventoryUI {
  constructor(ui) {
    this.ui = ui;
    this.open = false;
    this.side = null; // id of the right-hand panel
    this.drag = null;
    this.hover = null;
    this.menu = null;
    this.onMove = (e) => this.pointerMove(e);
    this.onUp = (e) => this.pointerUp(e);
    this.onKey = (e) => this.keyDown(e);
  }

  get game() {
    return this.ui.game;
  }

  // ------------------------------------------------------------------ containers
  // Containers the right panel can show right now, best first.
  sides() {
    const g = this.game;
    const out = [];
    const car = g.car;
    const p = g.player;
    if (car && car.storage) {
      if (p.seat) out.push(car.storage.glovebox);
      if (!p.seat && car.canReachTrunk && car.canReachTrunk(g.interaction.cam.position)) out.push(car.storage.trunk);
      const box = car.storage.roofbox && car.accessories && car.accessories.roof;
      if (box && !p.seat && car.worldPointOf(box.center).distanceTo(g.interaction.cam.position) < 2.3) out.push(car.storage.roofbox);
    }
    out.push(this.nearby());
    return out;
  }

  // Things lying within reach, as a read-only view of world items.
  nearby() {
    const g = this.game;
    const eye = g.interaction.cam.position;
    const list = [];
    for (const it of g.items.items) {
      if (it.held || it.worn || it.part || !it.def) continue;
      const d = it.mesh.getWorldPosition(V(0, 0, 0)).distanceTo(eye);
      if (d < NEARBY_R) list.push([d, it]);
    }
    list.sort((a, b) => a[0] - b[0]);
    const items = list.slice(0, 18).map((x) => x[1]);
    const slots = items.map((it) => ({ id: it.id, state: it.state, item: it }));
    while (slots.length < 18) slots.push(null);
    return { id: 'nearby', title: 'Nearby', slots, items, accepts: () => true, weight: () => 0, capacity: Infinity, virtual: true };
  }

  container(id) {
    const g = this.game;
    if (id === 'player') return g.inventory;
    if (id === 'nearby') return this.nearbyC || (this.nearbyC = this.nearby());
    const st = g.car && g.car.storage;
    return st ? st[id] : null;
  }

  // ------------------------------------------------------------------ open / close
  show(sideId = null) {
    const ui = this.ui;
    this.open = true;
    const sides = this.sides();
    this.side = sideId && sides.some((s) => s.id === sideId) ? sideId : sides[0].id;
    this.nearbyC = null;
    ui.screen('inventory', (s) => this.build(s));
    ui.show('inventory');
    document.exitPointerLock && document.exitPointerLock();
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey, true);
    this.game.audio && this.game.audio.play('pocket', { volume: 0.5 });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.cancelDrag();
    this.closeMenu();
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey, true);
    this.tip && this.tip.remove();
    this.tip = null;
    this.ui.resume();
  }

  // ------------------------------------------------------------------ layout
  build(s) {
    s.classList.add('inv-screen');
    const wrap = el('div', 'inv', s);
    wrap.addEventListener('contextmenu', (e) => e.preventDefault());
    s.addEventListener('pointerdown', (e) => {
      if (e.target === s) this.closeMenu();
    });
    // left: the backpack
    const left = el('div', 'paper inv-panel inv-bag', wrap);
    const head = el('div', 'inv-head', left);
    el('div', 'inv-title', head, 'Backpack');
    this.weightEl = el('div', 'inv-weight', head);
    el('div', 'inv-label', left, 'Hotbar');
    this.hotGrid = el('div', 'inv-grid', left);
    el('div', 'inv-label', left, 'Pack');
    this.bagGrid = el('div', 'inv-grid', left);
    this.pouchEl = el('div', 'inv-pouch', left);
    // middle: hands
    const mid = el('div', 'paper inv-panel inv-hands', wrap);
    el('div', 'inv-title', mid, 'Hands');
    this.handSlot = el('div', 'inv-slot inv-handslot', mid);
    this.handSlot.dataset.c = 'hands';
    this.handSlot.dataset.i = '0';
    this.handName = el('div', 'inv-handname', mid);
    // right: nearby / trunk / glovebox
    const right = el('div', 'paper inv-panel inv-side', wrap);
    this.tabs = el('div', 'inv-tabs', right);
    this.sideHead = el('div', 'inv-head', right);
    this.sideGrid = el('div', 'inv-grid', right);
    this.sideNote = el('div', 'inv-note', right);
    // footer
    el(
      'div',
      'inv-help',
      s,
      '<span><kbd>Drag</kbd> move</span><span><kbd>Shift</kbd>+click send across</span><span><kbd>Double-click</kbd> take in hand</span><span><kbd>RMB</kbd> actions</span><span><kbd>2</kbd>–<kbd>7</kbd> over a slot: hotbar</span><span><kbd>Tab</kbd> close</span>'
    );
    this.refresh();
  }

  slotEl(parent, cId, i, entry, extra = '') {
    const d = el('div', 'inv-slot' + extra, parent);
    d.dataset.c = cId;
    d.dataset.i = String(i);
    if (entry) this.fillSlot(d, entry);
    else d.classList.add('empty');
    d.addEventListener('pointerdown', (e) => this.pointerDown(e, d));
    d.addEventListener('dblclick', () => this.equip(cId, i));
    d.addEventListener('pointerenter', () => this.hoverSlot(d, cId, i));
    d.addEventListener('pointerleave', () => this.hoverSlot(null));
    d.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.openMenu(e, cId, i);
    });
    return d;
  }

  fillSlot(d, entry) {
    const img = el('img', '', d);
    img.draggable = false;
    const url = this.icon(entry.id, entry.state, () => this.refresh());
    if (url) img.src = url;
    else d.classList.add('loading');
    if ((entry.count || 1) > 1) el('span', 'inv-count', d, '×' + entry.count);
    const f = fillOf(entry.id, entry.state);
    if (f !== null) {
      const b = el('div', 'inv-fill', d);
      el('div', '', b).style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%';
    }
    if (!fitsInBag(entry.id, entry.state)) el('span', 'inv-bulky', d, 'bulky');
  }

  icon(id, state, onReady) {
    const g = this.game;
    const def = ITEMS[id];
    const key = id + (def && def.variants ? ':' + (state.variant || 0) : '');
    return itemIcon(key, () => g.items.buildMesh(id, state), def && def.weapon ? 'weapon' : '', { async: true, onReady: () => this.open && onReady() });
  }

  refresh() {
    if (!this.open) return;
    const g = this.game;
    const inv = g.inventory;
    this.closeTip();
    // backpack
    this.hotGrid.innerHTML = '';
    this.bagGrid.innerHTML = '';
    for (let i = 0; i < inv.slots.length; i++) {
      const d = this.slotEl(i < HOTBAR ? this.hotGrid : this.bagGrid, 'player', i, inv.slots[i], i < HOTBAR ? ' hot' : '');
      if (i < HOTBAR) el('span', 'inv-key', d, String(i + 2));
      if (i === inv.heldFrom && g.interaction.held) d.classList.add('inhand');
    }
    const w = inv.weight();
    this.weightEl.innerHTML = `<span>${w.toFixed(1)} / ${CAPACITY} kg</span><div class="inv-wbar${w > CAPACITY ? ' over' : ''}"><div style="width:${Math.min(100, (w / CAPACITY) * 100)}%"></div></div>`;
    const am = g.interaction.ammo;
    this.pouchEl.innerHTML = `Ammo pouch · <b>.38</b> ${am['38'] || 0} · <b>12 ga</b> ${am['12'] || 0}`;
    // hands
    this.handSlot.innerHTML = '';
    this.handSlot.className = 'inv-slot inv-handslot';
    const held = g.interaction.held;
    if (held && !held.part) {
      this.fillSlot(this.handSlot, { id: held.id, state: held.state });
      this.handName.textContent = held.name;
    } else if (held && held.part) {
      this.handSlot.classList.add('empty');
      this.handName.textContent = held.name + ' (car part)';
    } else {
      this.handSlot.classList.add('empty');
      this.handName.textContent = 'Empty';
    }
    if (!this.handSlot._wired) {
      this.handSlot._wired = true;
      this.handSlot.addEventListener('pointerdown', (e) => this.pointerDown(e, this.handSlot));
      this.handSlot.addEventListener('pointerenter', () => this.hoverSlot(this.handSlot, 'hands', 0));
      this.handSlot.addEventListener('pointerleave', () => this.hoverSlot(null));
      this.handSlot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.openMenu(e, 'hands', 0);
      });
    }
    // side panel
    const sides = this.sides();
    if (!sides.some((x) => x.id === this.side)) this.side = sides[0].id;
    this.nearbyC = this.side === 'nearby' ? sides.find((x) => x.id === 'nearby') : null;
    this.tabs.innerHTML = '';
    this.tabs.style.display = sides.length > 1 ? '' : 'none';
    for (const c of sides) {
      const t = el('button', 'inv-tab' + (c.id === this.side ? ' on' : ''), this.tabs, c.title);
      t.onclick = () => {
        this.side = c.id;
        this.refresh();
      };
    }
    const C = this.container(this.side);
    this.sideHead.innerHTML = `<div class="inv-title">${C.title}</div>` + (C.capacity < Infinity ? `<div class="inv-weight"><span>${C.weight().toFixed(1)} / ${C.capacity} kg</span></div>` : '');
    this.sideGrid.innerHTML = '';
    C.slots.forEach((e, i) => this.slotEl(this.sideGrid, C.id, i, e));
    this.sideNote.textContent =
      C.id === 'nearby' ? (C.items.length ? 'Within arm’s reach. Drag here to put things down.' : 'Nothing within reach. Drag here to put things down.') : C.id === 'trunk' ? 'Stays with the car. Takes bulky things.' : 'Small things only.';
  }

  // ------------------------------------------------------------------ transfers
  // Moves an item between any two slots (hands, backpack, containers, the ground).
  transfer(fromId, i, toId, j) {
    const g = this.game;
    const ia = g.interaction;
    if (fromId === toId && i === j) return false;
    let ok = false;
    if (fromId === 'hands') {
      if (!ia.held || ia.held.part) return false;
      if (toId === 'nearby') {
        ia.drop(0);
        ok = true;
      } else ok = ia.stowHeld(this.container(toId), j);
    } else if (toId === 'hands') {
      ok = this.equip(fromId, i, true);
    } else if (fromId === 'nearby') {
      const C = this.container('nearby');
      const it = C.items[i];
      if (!it) return false;
      const T = this.container(toId);
      const e = { id: it.id, state: it.state };
      if (!T.accepts(e)) return this.refuse(T, e);
      const slot = T.slots[j] ? T.add(e) : T.add(e, j);
      if (slot < 0) return this.refuse(T, e);
      g.items.take(it);
      g.items.destroy(it);
      ok = true;
    } else if (toId === 'nearby') {
      const F = this.container(fromId);
      const e = F.take(i);
      if (!e) return false;
      ia.dropEntry(e);
      if (fromId === 'player' && i === g.inventory.heldFrom) g.inventory.heldFrom = -1;
      ok = true;
    } else {
      const F = this.container(fromId),
        T = this.container(toId);
      const a = F.slots[i];
      ok = moveSlot(F, i, T, j);
      if (!ok && a) this.refuse(T, a);
      if (ok && fromId === 'player' && i === g.inventory.heldFrom) g.inventory.heldFrom = toId === 'player' ? j : -1;
    }
    if (ok) g.audio && g.audio.play('pocket', { volume: 0.45 });
    this.refresh();
    return ok;
  }

  refuse(C, e) {
    const g = this.game;
    const msg = !C.accepts(e) ? 'Too bulky for the ' + C.title.toLowerCase() : 'No room in the ' + C.title.toLowerCase();
    g.hud && g.hud.toast(msg);
    g.audio && g.audio.uiSound && g.audio.uiSound('deny');
    return false;
  }

  equip(cId, i, quiet = false) {
    const g = this.game;
    if (cId === 'hands') return false;
    if (cId === 'nearby') {
      const it = this.container('nearby').items[i];
      if (!it) return false;
      if (g.interaction.held && !g.interaction.stowHeld(g.inventory)) return false;
      g.interaction.pick(it);
      g.inventory.heldFrom = -1;
    } else {
      const C = this.container(cId);
      if (!C || !C.slots[i]) return false;
      g.interaction.equipFrom(C, i);
    }
    if (!quiet) this.refresh();
    return true;
  }

  quickMove(cId, i) {
    const other = cId === 'player' ? this.side : 'player';
    if (cId === 'hands') return this.transfer('hands', 0, 'player', -1);
    const T = this.container(other);
    let j = T.slots.findIndex((s) => !s);
    if (other === 'player') {
      // into the pack first, the hotbar when the pack is full
      const k = T.slots.findIndex((s, n) => !s && n >= HOTBAR);
      if (k >= 0) j = k;
    }
    if (other === 'nearby') j = 0;
    if (j < 0) return this.refuse(T, this.container(cId).slots[i]);
    return this.transfer(cId, i, other, j);
  }

  // ------------------------------------------------------------------ pointer
  pointerDown(e, d) {
    if (e.button === 2) return;
    this.closeMenu();
    const cId = d.dataset.c,
      i = +d.dataset.i;
    const has = cId === 'hands' ? !!(this.game.interaction.held && !this.game.interaction.held.part) : !!(this.container(cId) && this.container(cId).slots[i]);
    if (!has) return;
    if (e.shiftKey) {
      this.quickMove(cId, i);
      return;
    }
    this.drag = { cId, i, x: e.clientX, y: e.clientY, started: false, src: d };
    e.preventDefault();
  }

  pointerMove(e) {
    const dr = this.drag;
    if (this.tip) this.placeTip(e.clientX, e.clientY);
    if (!dr) return;
    if (!dr.started && Math.hypot(e.clientX - dr.x, e.clientY - dr.y) > 5) {
      dr.started = true;
      this.closeTip();
      dr.src.classList.add('dragging');
      dr.ghost = el('div', 'inv-ghost', document.body);
      const img = dr.src.querySelector('img');
      if (img) el('img', '', dr.ghost).src = img.src;
    }
    if (dr.ghost) {
      dr.ghost.style.left = e.clientX + 'px';
      dr.ghost.style.top = e.clientY + 'px';
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const slot = over && over.closest && over.closest('.inv-slot');
      for (const x of document.querySelectorAll('.inv-slot.over')) x.classList.remove('over');
      if (slot) slot.classList.add('over');
    }
  }

  pointerUp(e) {
    const dr = this.drag;
    if (!dr) return;
    this.drag = null;
    if (dr.ghost) dr.ghost.remove();
    dr.src.classList.remove('dragging');
    for (const x of document.querySelectorAll('.inv-slot.over')) x.classList.remove('over');
    if (!dr.started) return;
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const slot = over && over.closest && over.closest('.inv-slot');
    if (slot) this.transfer(dr.cId, dr.i, slot.dataset.c, +slot.dataset.i);
    else if (!over || !over.closest('.inv')) this.transfer(dr.cId, dr.i, 'nearby', 0); // dropped outside the panels: put it down
  }

  cancelDrag() {
    if (this.drag && this.drag.ghost) this.drag.ghost.remove();
    this.drag = null;
  }

  keyDown(e) {
    if (!this.open) return;
    const m = /^Digit([2-7])$/.exec(e.code);
    if (m && this.hover) {
      const k = +m[1] - 2;
      const { cId, i } = this.hover;
      if (!(cId === 'player' && i === k)) this.transfer(cId, i, 'player', k);
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // ------------------------------------------------------------------ tooltip
  hoverSlot(d, cId, i) {
    this.closeTip();
    if (!d) {
      this.hover = null;
      return;
    }
    this.hover = { cId, i };
    let entry;
    if (cId === 'hands') {
      const h = this.game.interaction.held;
      entry = h && !h.part ? { id: h.id, state: h.state } : null;
    } else entry = this.container(cId) && this.container(cId).slots[i];
    if (!entry || this.drag) return;
    const info = describeEntry(entry.id, entry.state, this.game.interaction.ammo);
    const t = el('div', 'inv-tip', document.body);
    el('div', 'inv-tip-title', t, info.title + ((entry.count || 1) > 1 ? ` <span>×${entry.count}</span>` : ''));
    for (const l of info.lines) el('div', 'inv-tip-line', t, l);
    if (info.desc) el('div', 'inv-tip-desc', t, info.desc);
    el('div', 'inv-tip-mass', t, `${entryMass(entry).toFixed(2)} kg` + (fitsInBag(entry.id, entry.state) ? '' : ' · too bulky for the backpack'));
    this.tip = t;
    const r = d.getBoundingClientRect();
    this.placeTip(r.right, r.top);
  }

  placeTip(x, y) {
    const t = this.tip;
    if (!t) return;
    const w = t.offsetWidth,
      h = t.offsetHeight;
    t.style.left = Math.min(window.innerWidth - w - 10, x + 14) + 'px';
    t.style.top = Math.min(window.innerHeight - h - 10, Math.max(10, y + 10)) + 'px';
  }

  closeTip() {
    if (this.tip) this.tip.remove();
    this.tip = null;
  }

  // ------------------------------------------------------------------ context menu
  openMenu(e, cId, i) {
    this.closeMenu();
    this.closeTip();
    const g = this.game;
    const ia = g.interaction;
    let entry;
    if (cId === 'hands') {
      const h = ia.held;
      entry = h && !h.part ? { id: h.id, state: h.state } : null;
    } else entry = this.container(cId) && this.container(cId).slots[i];
    if (!entry) return;
    const def = ITEMS[entry.id] || {};
    const acts = [];
    if (cId !== 'hands') acts.push(['Take in hand', () => this.equip(cId, i)]);
    if (def.consume) acts.push([def.consume.smoke ? 'Smoke' : def.consume.food > 0 ? 'Eat' : def.consume.health > 0 ? 'Use' : 'Drink', () => this.consume(cId, i)]);
    if (def.liquid && (entry.state.liquidType === 'water' || def.drinkable) && (entry.state.liquid || 0) > 0.05) acts.push(['Drink', () => this.drink(cId, i)]);
    if (def.ammo) acts.push(['Put in ammo pouch', () => this.toPouch(cId, i)]);
    if (def.readable) acts.push(['Read', () => this.read(entry)]);
    if (cId !== 'nearby') acts.push(['Put down', () => this.transfer(cId, i, 'nearby', 0)]);
    const other = cId === 'player' ? this.side : 'player';
    if (cId !== 'hands' && other !== 'nearby') acts.push([`Move to ${this.container(other).title.toLowerCase()}`, () => this.quickMove(cId, i)]);
    if (cId === 'nearby') acts.push(['Put in backpack', () => this.quickMove(cId, i)]);
    if (cId === 'hands') acts.push(['Put in backpack', () => this.transfer('hands', 0, 'player', -1)]);
    const m = el('div', 'inv-menu', document.body);
    for (const [label, fn] of acts) {
      const b = el('button', '', m, label);
      b.onclick = () => {
        this.closeMenu();
        fn();
        this.refresh();
      };
    }
    m.style.left = Math.min(window.innerWidth - 200, e.clientX) + 'px';
    m.style.top = Math.min(window.innerHeight - acts.length * 34 - 10, e.clientY) + 'px';
    this.menu = m;
  }

  closeMenu() {
    if (this.menu) this.menu.remove();
    this.menu = null;
  }

  entryAt(cId, i) {
    if (cId === 'hands') return null;
    const C = this.container(cId);
    return C ? C.slots[i] : null;
  }

  // Eat / drink / smoke / use straight from the bag.
  consume(cId, i) {
    const g = this.game;
    if (cId === 'hands') return g.interaction.useHeld();
    const C = this.container(cId);
    const e = C.slots[i];
    if (!e) return;
    const def = ITEMS[e.id];
    g.player.consume(def.consume);
    if (def.consume.smoke) {
      e.state.charges = (e.state.charges ?? def.charges ?? 1) - 1;
      g.audio && g.audio.play('click');
      if (e.state.charges <= 0) C.slots[i] = null;
      return;
    }
    if (def.consume.food > 0) g.stats.meals++;
    else g.stats.drinks++;
    g.audio && g.audio.play(def.consume.food > 0 ? 'eat' : def.consume.health > 0 ? 'bandage' : 'drink');
    if (cId === 'nearby') {
      const it = C.items[i];
      g.items.take(it);
      g.items.destroy(it);
    } else C.take(i);
  }

  drink(cId, i) {
    const g = this.game;
    const e = cId === 'nearby' ? this.container('nearby').items[i] : this.entryAt(cId, i);
    if (!e) return;
    const st = e.state;
    const amt = Math.min(st.liquid || 0, 0.35);
    st.liquid -= amt;
    g.player.consume({ water: amt * 40 });
    g.stats.drinks++;
    g.audio && g.audio.play('drink');
    if (e.item) g.items.refreshVisual(e.item);
  }

  toPouch(cId, i) {
    const g = this.game;
    const e = this.entryAt(cId, i) || (cId === 'nearby' && this.container('nearby').slots[i]);
    if (!e) return;
    const def = ITEMS[e.id];
    g.interaction.ammo[def.ammo.type] = (g.interaction.ammo[def.ammo.type] || 0) + def.ammo.count;
    g.hud && g.hud.toast(`+${def.ammo.count} ${def.ammo.type === '38' ? '.38' : '12 ga'} in pouch`);
    g.audio && g.audio.play('pocket');
    if (cId === 'nearby') {
      const it = this.container('nearby').items[i];
      g.items.take(it);
      g.items.destroy(it);
    } else this.container(cId).take(i);
  }

  read(entry) {
    const g = this.game;
    const n = g.story && g.story.noteById(entry.state.note);
    if (!n) return;
    g.story.collect(n.id);
    this.open = false;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey, true);
    g.ui.showNote(n);
  }
}
