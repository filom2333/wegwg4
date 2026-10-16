// Inventory: the player's backpack (a hotbar row of 6 + 18 backpack slots, with a weight limit)
// and storage containers (the car's trunk and glovebox). Entries are plain records
// { id, state } so they survive saving and can be turned back into physical items at any time.

import { ITEMS, itemMass } from './itemDefs.js';

export const HOTBAR = 6;
export const BACKPACK = 18;
export const CAPACITY = 24; // kg the player can carry in the backpack without slowing down
export const MAX_BAG_MASS = 6; // heavier single things stay in the hands

// Too bulky for a backpack: carried in the hands or kept in the car.
export function fitsInBag(id, state) {
  const d = ITEMS[id];
  if (!d || d.bulky) return false;
  return itemMass(id, state) <= MAX_BAG_MASS;
}

export function entryMass(e) {
  return e ? itemMass(e.id, e.state) : 0;
}

// Ammo boxes and cigarettes merge into one slot when they are the same thing.
function stackKey(e) {
  const d = ITEMS[e.id];
  if (!d || !d.stack) return null;
  return e.id;
}

export class Container {
  constructor(id, title, size, { capacity = Infinity, bulky = false } = {}) {
    this.id = id;
    this.title = title;
    this.slots = new Array(size).fill(null);
    this.capacity = capacity;
    this.bulky = bulky; // accepts things too big for a backpack
  }

  accepts(e) {
    if (!e) return true;
    if (!this.bulky && !fitsInBag(e.id, e.state)) return false;
    return true;
  }

  weight() {
    let m = 0;
    for (const e of this.slots) m += entryMass(e);
    return m;
  }

  firstFree(from = 0) {
    for (let i = from; i < this.slots.length; i++) if (!this.slots[i]) return i;
    return -1;
  }

  // Adds an entry (merging stacks); returns the slot index or -1 when it does not fit.
  add(e, prefer = -1) {
    if (!this.accepts(e)) return -1;
    if (this.weight() + entryMass(e) > this.capacity + 1e-6) return -1;
    const k = stackKey(e);
    if (k) {
      const max = ITEMS[e.id].stack;
      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i];
        if (s && stackKey(s) === k && (s.count || 1) + (e.count || 1) <= max) {
          s.count = (s.count || 1) + (e.count || 1);
          return i;
        }
      }
    }
    const i = prefer >= 0 && !this.slots[prefer] ? prefer : this.firstFree();
    if (i < 0) return -1;
    this.slots[i] = e;
    return i;
  }

  // Removes one item from a slot (one of a stack).
  take(i) {
    const s = this.slots[i];
    if (!s) return null;
    if ((s.count || 1) > 1) {
      s.count--;
      return { id: s.id, state: JSON.parse(JSON.stringify(s.state || {})) };
    }
    this.slots[i] = null;
    return s;
  }

  serialize() {
    return this.slots.map((s) => (s ? { id: s.id, state: s.state, count: s.count || 1 } : null));
  }

  restore(list) {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = list[i] && ITEMS[list[i].id] ? { id: list[i].id, state: list[i].state || {}, count: list[i].count || 1 } : null;
  }
}

// The player's bag: slots 0-5 are the hotbar (keys 1-6), the rest is the backpack.
export class Inventory extends Container {
  constructor() {
    super('player', 'Backpack', HOTBAR + BACKPACK, { capacity: Infinity });
    this.heldFrom = -1; // slot the item in the hands came from
  }

  get load() {
    return this.weight();
  }

  // Movement penalty from a heavy pack (0 = none, 1 = crawling).
  get burden() {
    return Math.max(0, Math.min(1, (this.weight() - CAPACITY) / 20));
  }

  // Prefer the hotbar for things you use (food, drink, weapons, tools), the pack for the rest.
  addSmart(e, prefer = -1) {
    if (prefer >= 0) return this.add(e, prefer);
    const d = ITEMS[e.id] || {};
    const quick = d.weapon || d.consume || d.liquid || d.melee || d.light;
    const k = stackKey(e);
    if (k) return this.add(e);
    if (quick) {
      const i = this.firstFree(0);
      if (i >= 0 && i < HOTBAR) return this.add(e, i);
    }
    const j = this.firstFree(HOTBAR);
    if (j >= 0) return this.add(e, j);
    return this.add(e);
  }
}

// Moves (or swaps) between two slots, possibly in different containers. Returns true on success.
export function moveSlot(from, i, to, j) {
  if (from === to && i === j) return false;
  const a = from.slots[i];
  const b = to.slots[j];
  if (!a) return false;
  if (!to.accepts(a) || (b && !from.accepts(b))) return false;
  // stack onto the same thing
  if (b && ITEMS[a.id] && ITEMS[a.id].stack && a.id === b.id) {
    const max = ITEMS[a.id].stack;
    const n = Math.min(max - (b.count || 1), a.count || 1);
    if (n > 0) {
      b.count = (b.count || 1) + n;
      a.count = (a.count || 1) - n;
      if (a.count <= 0) from.slots[i] = null;
      return true;
    }
  }
  if (from !== to) {
    const dw = entryMass(a) - entryMass(b);
    if (to.weight() + dw > to.capacity + 1e-6) return false;
    if (from.weight() - dw > from.capacity + 1e-6) return false;
  }
  to.slots[j] = a;
  from.slots[i] = b;
  return true;
}
