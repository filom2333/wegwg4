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
  const car = g.car;
  const cp = car.root.position,
    cq = car.root.quaternion;
  const p = g.player;
  const pp = p.position;
  const ia = g.interaction;
  const parts = {};
  for (const [id, st] of Object.entries(car.parts)) parts[id] = { installed: !!st.installed, condition: st.condition ?? 1 };
  const held = ia.held ? { id: ia.held.id, part: ia.held.part, state: ia.held.state } : null;
  return {
    v: 1,
    savedAt: Date.now(),
    seed: g.seed,
    difficulty: g.difficultyName,
    startMode: g.startMode,
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
      bleeding: p.bleeding,
      seat: p.seat,
      headlampOn: p.headlampOn,
    },
    inventory: { slots: g.inventory.serialize(), heldFrom: g.inventory.heldFrom, ammo: ia.ammo, held },
    car: {
      pos: [cp.x + o.x, cp.y, cp.z + o.z],
      quat: [cq.x, cq.y, cq.z, cq.w],
      fuel: car.fuel,
      oil: car.oil,
      coolant: car.coolant,
      battery: car.battery,
      engineCondition: car.engineCondition,
      radiatorCondition: car.radiatorCondition,
      odometer: car.odometer,
      trip: car.trip,
      dirt: car.dirt,
      lightsOn: car.lightsOn,
      paintColor: car.paintColor ?? null,
      stereo: car.stereo ? { disc: car.stereo.disc, track: car.stereo.track, mode: car.stereo.mode } : null,
      storage: car.storage ? Object.fromEntries(Object.entries(car.storage).map(([k, c]) => [k, c.serialize()])) : null,
      parts,
      open: Object.fromEntries(Object.values(car.model.parts).filter((m) => m.hinge).map((m) => [m.id, m.openT > 0.5 ? 1 : 0])),
    },
    // loot that never left its spot is regenerated deterministically when the POI loads
    items: g.items.serialize().filter((it) => it.poi === null || it.poi === undefined),
    itemsSaved: [...g.items.saved.entries()],
    pois: [...g.pois.state.entries()].map(([k, st]) => [k, { ...st, taken: [...st.taken] }]),
    stats: { ...g.stats },
    story: g.story ? g.story.serialize() : null,
  };
}

// Restores persistent world maps before anything streams in.
export function applyWorldState(g, d) {
  for (const [k, st] of d.pois || []) g.pois.state.set(+k, { ...st, taken: new Set(st.taken || []) });
  for (const [k, list] of d.itemsSaved || []) g.items.saved.set(+k, list);
}

// Restores player, car, items and stats once the car and player exist.
export function applySave(g, d) {
  const o = g.origin;
  const car = g.car;
  Object.assign(g.stats, d.stats || {});
  g.env.time = d.env.time;
  g.env.day = d.env.day;
  if (d.env.weather) g.env.setWeather(d.env.weather, true);
  // car
  const c = d.car;
  for (const k of ['fuel', 'oil', 'coolant', 'battery', 'engineCondition', 'radiatorCondition', 'odometer', 'trip', 'dirt', 'lightsOn']) if (c[k] !== undefined) car[k] = c[k];
  if (c.paintColor) {
    car.paintColor = c.paintColor;
    g.carMats.paint.color.setHex(c.paintColor);
  }
  for (const [id, st] of Object.entries(c.parts || {})) {
    if (!car.parts[id]) continue;
    if (!!car.parts[id].installed !== st.installed) car.setInstalled(id, st.installed);
    car.parts[id].condition = st.condition;
  }
  for (const [id, t] of Object.entries(c.open || {})) if (car.model.parts[id] && car.isInstalled(id)) car.model.setOpen(id, t);
  car.rebuildColliders();
  // items
  for (const s of d.items || []) {
    const pos = new THREE.Vector3(s.pos[0] - o.x, s.pos[1], s.pos[2] - o.z);
    const q = new THREE.Quaternion(...s.quat);
    const it = s.part ? g.items.spawnPart(s.part, pos, q, s.state) : g.items.spawn(s.id, pos, q, s.state, { sleep: !s.stowed });
    it.poiKey = null;
    it.spot = null;
    if (s.stowed) {
      it.mesh.updateMatrixWorld(true);
      g.items.stow(it, car);
    }
  }
  // player
  const p = g.player;
  for (const k of ['health', 'food', 'water', 'energy', 'bleeding', 'headlampOn']) if (d.player[k] !== undefined) p[k] = d.player[k];
  p.yaw = d.player.yaw;
  p.pitch = d.player.pitch;
  const inv = d.inventory || {};
  if (inv.slots) g.inventory.restore(inv.slots);
  else if (inv.pockets) inv.pockets.forEach((e) => e && g.inventory.addSmart({ id: e.id, state: e.state || {} }));
  if (c.stereo && car.stereo) Object.assign(car.stereo, c.stereo, { pos: 0 });
  if (c.storage && car.storage) for (const [k, list] of Object.entries(c.storage)) car.storage[k] && car.storage[k].restore(list);
  if (inv.ammo) g.interaction.ammo = inv.ammo;
  if (inv.held) {
    const pos = p.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const it = inv.held.part ? g.items.spawnPart(inv.held.part, pos, new THREE.Quaternion(), inv.held.state) : g.items.spawn(inv.held.id, pos, new THREE.Quaternion(), inv.held.state);
    g.interaction.pick(it);
    g.inventory.heldFrom = inv.heldFrom ?? -1;
  }
  if (d.player.seat) p.enterSeat(car, d.player.seat);
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
