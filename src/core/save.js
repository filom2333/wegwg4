// Save games (single slot + autosave) and career statistics, kept in localStorage.
// Positions are stored in global (origin-independent) coordinates.

import * as THREE from 'three';

const SAVE_KEY = 'dustroad.save.v1';
const CAREER_KEY = 'dustroad.career.v1';

function store() {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

export function hasSave() {
  const s = store();
  return !!(s && s.getItem(SAVE_KEY));
}

export function readSave() {
  const s = store();
  if (!s) return null;
  try {
    return JSON.parse(s.getItem(SAVE_KEY));
  } catch (e) {
    return null;
  }
}

export function deleteSave() {
  const s = store();
  s && s.removeItem(SAVE_KEY);
}

export function saveSummary() {
  const d = readSave();
  if (!d) return null;
  return { day: d.env.day, time: d.env.time, distance: d.stats.distance, savedAt: d.savedAt, difficulty: d.difficulty, seed: d.seed };
}

export function writeSave(game) {
  const s = store();
  if (!s) return false;
  const data = serializeGame(game);
  try {
    s.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function serializeGame(g) {
  const o = g.origin;
  const p = g.player;
  const pp = p.position;
  const ia = g.interaction;
  const held = ia.held ? { id: ia.held.id, part: ia.held.part, state: ia.held.state } : null;
  return {
    v: 2,
    savedAt: Date.now(),
    seed: g.seed,
    difficulty: g.difficultyName,
    startMode: g.startMode,
    startCar: g.startCarType,
    origin: [o.x, o.z],
    env: { time: g.env.time, day: g.env.day, weather: g.env.weatherName },
    player: {
      pos: [pp.x + o.x, pp.y, pp.z + o.z],
      yaw: p.yaw,
      pitch: p.pitch,
      health: p.health,
      food: p.food,
      water: p.water,
      energy: p.energy,
      warmth: p.warmth,
      wet: p.wet,
      bleeding: p.bleeding,
      seat: p.seat,
      seatCar: p.seat && p.car ? p.car.id : null,
      headlampOn: p.headlampOn,
    },
    inventory: { slots: g.inventory.serialize(), heldFrom: g.inventory.heldFrom, ammo: ia.ammo, held },
    fleet: g.fleet.serialize(),
    trailers: g.trailers ? g.trailers.serialize() : [],
    tents: g.tents ? g.tents.serialize(o) : [],
    worldPlates: g.worldPlates ? g.worldPlates.serialize(o) : [],
    atlas: g.atlas ? g.atlas.serialize() : null,
    // loot that never left its spot is regenerated deterministically when the POI loads
    // jacks standing under cars are kept as jacks lying where they stood
    items: g.items
      .serialize()
      .filter((it) => it.poi === null || it.poi === undefined)
      .concat((g.jacks ? g.jacks.list : []).map((j) => ({ id: 'jack', part: null, state: {}, pos: [j.base.x + g.origin.x, j.base.y + 0.06, j.base.z + g.origin.z], quat: [0, 0, 0, 1], stowed: false, poi: null, spot: null }))),
    itemsSaved: [...g.items.saved.entries()],
    itemsPending: [...(g.items.pending || new Map()).entries()],
    pois: [...g.pois.state.entries()].map(([k, st]) => [k, { ...st, taken: [...st.taken] }]),
    stats: { ...g.stats },
    story: g.story ? g.story.serialize() : null,
  };
}

// Restores persistent world maps before anything streams in.
export function applyWorldState(g, d) {
  for (const [k, st] of d.pois || []) g.pois.state.set(+k, { ...st, taken: new Set(st.taken || []) });
  for (const [k, list] of d.itemsSaved || []) g.items.saved.set(+k, list);
  for (const [k, list] of d.itemsPending || []) g.items.addPending(+k, list);
}

// Restores player, car, items and stats once the car and player exist.
export function applySave(g, d) {
  const o = g.origin;
  const car = g.car;
  const carById = (id) => (id === true || id === undefined ? car : g.fleet.cars.find((c) => c.id === id) || car);
  Object.assign(g.stats, d.stats || {});
  g.env.time = d.env.time;
  g.env.day = d.env.day;
  if (d.env.weather) g.env.setWeather(d.env.weather, true);
  if (g.tents) g.tents.restore(d.tents, o);
  if (g.worldPlates) g.worldPlates.restore(d.worldPlates, o);
  if (g.atlas) g.atlas.restore(d.atlas);
  // items
  for (const s of d.items || []) {
    if (s.part && !(s.state && s.state.carType) && !car.model.parts[s.part]) continue;
    const pos = new THREE.Vector3(s.pos[0] - o.x, s.pos[1], s.pos[2] - o.z);
    const q = new THREE.Quaternion(...s.quat);
    const it = s.part ? g.items.spawnPart(s.part, pos, q, s.state) : g.items.spawn(s.id, pos, q, s.state, { sleep: !s.stowed });
    it.poiKey = null;
    it.spot = null;
    if (s.stowed) {
      it.mesh.updateMatrixWorld(true);
      g.items.stow(it, carById(s.stowed));
    } else if (s.mounted) {
      const c = carById(s.mounted.car);
      if (c && c.isInstalled(s.mounted.part)) g.items.mount(it, c, s.mounted.part, new THREE.Matrix4().fromArray(s.mounted.m), { hang: s.mounted.hang ? new THREE.Vector3(...s.mounted.hang) : null });
    }
  }
  // player
  const p = g.player;
  for (const k of ['health', 'food', 'water', 'energy', 'warmth', 'wet', 'bleeding', 'headlampOn']) if (d.player[k] !== undefined) p[k] = d.player[k];
  p.yaw = d.player.yaw;
  p.pitch = d.player.pitch;
  const inv = d.inventory || {};
  if (inv.slots) g.inventory.restore(inv.slots);
  else if (inv.pockets) inv.pockets.forEach((e) => e && g.inventory.addSmart({ id: e.id, state: e.state || {} }));
  if (inv.ammo) g.interaction.ammo = inv.ammo;
  if (inv.held) {
    const pos = p.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const it = inv.held.part ? g.items.spawnPart(inv.held.part, pos, new THREE.Quaternion(), inv.held.state) : g.items.spawn(inv.held.id, pos, new THREE.Quaternion(), inv.held.state);
    g.interaction.pick(it);
    g.inventory.heldFrom = inv.heldFrom ?? -1;
  }
  if (d.player.seat) p.enterSeat(carById(d.player.seatCar ?? true), d.player.seat);
}

// ------------------------------------------------------------------ career
export function readCareer() {
  const s = store();
  const base = { runs: 0, deaths: 0, distance: 0, longest: 0, days: 0, bestDays: 0, kills: 0, headshots: 0, itemsLooted: 0, partsInstalled: 0, fuelUsed: 0, lastRun: null };
  if (!s) return base;
  try {
    return { ...base, ...(JSON.parse(s.getItem(CAREER_KEY)) || {}) };
  } catch (e) {
    return base;
  }
}

// Folds a finished run into the career totals.
export function recordRun(stats, cause) {
  const s = store();
  const c = readCareer();
  c.runs++;
  if (cause) c.deaths++;
  c.distance += stats.distance || 0;
  c.longest = Math.max(c.longest, stats.distance || 0);
  c.days += stats.daysSurvived || 0;
  c.bestDays = Math.max(c.bestDays, stats.daysSurvived || 0);
  c.kills += stats.kills || 0;
  c.headshots += stats.headshots || 0;
  c.itemsLooted += stats.itemsLooted || 0;
  c.partsInstalled += stats.partsInstalled || 0;
  c.fuelUsed += stats.fuelUsed || 0;
  c.lastRun = { ...stats, cause: cause || null, at: Date.now() };
  try {
    s && s.setItem(CAREER_KEY, JSON.stringify(c));
  } catch (e) {
    /* ignore */
  }
  return c;
}
