// Tuning: variants of ordinary parts that change how a car goes and sounds. They live on the part
// itself (car.parts[id].tune, and item.state.tune once it is off the car), so a tuned engine
// keeps its carbs when it is lifted out and a set of knobbly tyres can be moved car to car.
//   engine  'twin'    twin carburettors with chrome pancake filters: more pull up the rev range,
//                     an induction roar, a thirstier engine (fitted from a kit, unbolted with a wrench)
//   exhaust 'sport'   free-flowing muffler with big chrome tips: a little more top end, a harder
//                     rasp, and pops and crackles on the overrun
//   wheel   'offroad' knobbly mud tyres: bite in sand, dirt, grass and snow, give a little on
//                     tarmac, hum at speed

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const TUNES = {
  engine: { twin: { label: 'twin carbs', desc: 'Two carburettors breathe through chrome pancake filters: it pulls harder above mid revs, roars on the intake and drinks a fifth more.' } },
  exhaust: { sport: { label: 'Sport muffler', desc: 'Straight-through box with big chrome tips. A little more top end, a lot more noise, and it crackles when you lift off.' } },
  wheel: { offroad: { label: 'Mud tyre', desc: 'Knobbly off-road tread: grips in sand, dirt, grass and snow; a little less sure on tarmac, and it hums at speed.' } },
};

// Grip and rolling resistance of off-road tread on each surface, relative to a road tyre.
export const OFFROAD = {
  asphalt: [0.95, 1.15],
  concrete: [0.95, 1.15],
  gravel: [1.15, 0.9],
  dirt: [1.22, 0.85],
  sand: [1.32, 0.68],
  grass: [1.2, 0.85],
  rock: [1.05, 1],
  salt: [1.0, 1.1],
  wood: [0.95, 1.1],
  snowRoad: [1.12, 1],
  snow: [1.3, 0.75],
  ice: [0.95, 1],
};

const family = (car, id) => (car.type.PART_FAMILY && car.type.PART_FAMILY[id]) || id;
export const tuneInfo = (familyId, tune) => (tune && TUNES[familyId] && TUNES[familyId][tune]) || null;

// Label of a part (on a car or as an item) with its tune.
export function tunedLabel(type, id, tune) {
  const base = (type.PARTS[id] || { label: id }).label;
  const fam = (type.PART_FAMILY && type.PART_FAMILY[id]) || id;
  const t = tuneInfo(fam, tune);
  if (!t) return base;
  if (fam === 'engine') return `${base} (${t.label})`;
  if (fam === 'wheel') return base.replace(/^(Spare )?wheel/i, (m, s) => (s ? 'Spare mud-tyre wheel' : 'Mud-tyre wheel'));
  return t.label;
}

// Torque gain of the tuned engine at a fraction u of the redline.
function torqueGain(car, u) {
  let g = 0;
  if (car.parts.engine && car.parts.engine.installed && car.parts.engine.tune === 'twin') g += 0.03 + 0.15 * smooth(0.3, 0.75, u);
  if (car.parts.exhaust && car.parts.exhaust.installed && car.parts.exhaust.tune === 'sport') g += -0.02 + 0.1 * smooth(0.35, 0.8, u);
  return g;
}

// Push the tunes into the car's dynamics: the torque curve and the tread of each wheel.
export function applyTune(car) {
  const p = car.dyn.p;
  const T = car.engineType || car.type;
  const base = T.DYNAMICS.torqueCurve;
  const red = p.redline || 6000;
  p.torqueCurve = base.map(([r, t]) => [r, t * (1 + torqueGain(car, r / red))]);
  for (const w of car.dyn.wheels) w.tread = car.parts[w.id] && car.parts[w.id].tune === 'offroad' ? 'offroad' : null;
  car.fuelFactor = car.parts.engine && car.parts.engine.installed && car.parts.engine.tune === 'twin' ? 1.2 : 1;
}

export function isSport(car) {
  return !!(car.parts.exhaust && car.parts.exhaust.installed && car.parts.exhaust.tune === 'sport');
}

// The engine voice with the tunes: a sport box rasps harder and louder, twin carbs roar on the
// intake. Cached per voice so the audio graph only rebuilds when it changes.
const VOICES = new WeakMap();
export function tunedVoice(car, T) {
  const sport = isSport(car);
  const twin = !!(car.parts.engine && car.parts.engine.installed && car.parts.engine.tune === 'twin');
  if (!sport && !twin) return T;
  let m = VOICES.get(T);
  if (!m) VOICES.set(T, (m = {}));
  const key = (sport ? 's' : '') + (twin ? 't' : '');
  if (!m[key]) {
    const S = { ...T.sound };
    if (sport) Object.assign(S, { drive: S.drive * 1.7, odd: S.odd * 1.2, gain: S.gain * 1.4, tone: S.tone + 140, toneRpm: S.toneRpm * 1.15, sub: S.sub * 1.25 });
    if (twin) S.intake = (S.intake ?? 1) * 1.8;
    m[key] = { ...T, sound: S };
  }
  return m[key];
}

// ------------------------------------------------------------------ looks
let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    chrome: new THREE.MeshStandardMaterial({ color: 0xd4d7da, roughness: 0.16, metalness: 1 }),
    soot: new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.9 }),
    alloy: new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.45, metalness: 0.85 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.93, metalness: 0 }),
    hose: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 }),
  };
  return MATS;
}

function mark(g) {
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      o.userData.tuneMesh = true;
      o.userData.shared = true;
    }
  });
  g.userData.tuneMesh = true;
  return g;
}

// Knobbly tread for a tyre of radius R and width W, axle along x, centred on the hub.
const TREAD = new Map();
function treadGeometry(R, W) {
  const key = R.toFixed(3) + ':' + W.toFixed(3);
  if (TREAD.has(key)) return TREAD.get(key);
  const list = [];
  const N = 24;
  const h = 0.016;
  const pitch = (2 * Math.PI) / N;
  const block = (x, w, a, len, hh, inset) => {
    const g = new THREE.BoxGeometry(w, hh, len);
    g.translate(0, R - inset + hh / 2, 0);
    g.rotateX(a);
    g.translate(x, 0, 0);
    list.push(g);
  };
  for (let i = 0; i < N; i++) {
    const a = i * pitch;
    const len = R * pitch * 0.5;
    // two staggered centre rows, chevron-ish
    block(-W * 0.2, W * 0.34, a, len, h, 0.006);
    block(W * 0.2, W * 0.34, a + pitch * 0.5, len, h, 0.006);
    // shoulder lugs that wrap onto the sidewall
    for (const s of [-1, 1]) {
      const sa = a + (s > 0 ? 0 : pitch * 0.5);
      block(s * (W * 0.5 - 0.016), 0.034, sa, len * 1.15, h + 0.012, 0.02);
    }
  }
  const geo = mergeGeometries(list, false);
  geo.computeVertexNormals();
  TREAD.set(key, geo);
  return geo;
}

// Radius, tread width and tread centre (along the axle) of the tyre under a wheel's spin group,
// from the vertices near its outer radius (the hubcap would widen a bounding box).
const SIZES = new WeakMap();
function tyreSize(spin) {
  const meshes = [];
  spin.traverse((o) => o.isMesh && !o.userData.tuneMesh && meshes.push(o));
  const hit = SIZES.get(spin);
  if (hit && hit.first === meshes[0]) return hit.out;
  spin.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(spin.matrixWorld).invert();
  const pts = [];
  const v = V(0, 0, 0);
  let R = 0;
  for (const o of meshes) {
    const m = inv.clone().multiply(o.matrixWorld);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const r = Math.hypot(v.y, v.z);
      R = Math.max(R, r);
      pts.push(v.x, r);
    }
  }
  let x0 = Infinity,
    x1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2)
    if (pts[i + 1] > R * 0.93) {
      x0 = Math.min(x0, pts[i]);
      x1 = Math.max(x1, pts[i]);
    }
  const out = { R, W: x1 > x0 ? x1 - x0 : 0.2, cx: x1 > x0 ? (x0 + x1) / 2 : 0 };
  SIZES.set(spin, { first: meshes[0], out });
  return out;
}

export function treadMesh(spin) {
  const { R, W, cx } = tyreSize(spin);
  const m = new THREE.Mesh(treadGeometry(R, Math.max(0.12, W * 0.96)), mats().rubber);
  m.position.set(cx, 0, 0);
  return mark(new THREE.Group().add(m));
}

// Big chrome tips over the tail pipes (car space).
function sportTips(type) {
  const M = mats();
  const g = new THREE.Group();
  const P = type.POINTS;
  for (const p of [P.exhaust, P.exhaust2].filter(Boolean)) {
    const tip = new THREE.Group();
    tip.position.copy(p);
    // flared can, rolled lip, sooty bore
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.2, 18, 1, true).rotateX(Math.PI / 2), M.chrome);
    can.position.z = 0.04;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.039, 0.0045, 6, 20), M.chrome);
    lip.position.z = -0.06;
    const bore = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16).rotateY(Math.PI), M.soot);
    bore.position.z = -0.045;
    const back = new THREE.Mesh(new THREE.CircleGeometry(0.033, 16), M.soot);
    back.position.z = 0.14;
    tip.add(can, lip, bore, back);
    tip.rotation.x = -0.06;
    g.add(tip);
  }
  return mark(g);
}

// Two carbs with pancake filters and a linkage on top of the engine (car space, from its box).
function twinCarbs(box) {
  const M = mats();
  const g = new THREE.Group();
  const c = box.getCenter(V(0, 0, 0)),
    s = box.getSize(V(0, 0, 0));
  // the filter tops just under the top of the engine, toward the side the bay opens to
  const y = box.max.y - 0.14;
  const z = c.z + (box.min.z < 0 && box.max.z < 0 ? -0.05 : 0.05);
  const dx = Math.min(0.22, s.x * 0.28);
  for (const sx of [-1, 1]) {
    const x = c.x + sx * dx;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.07), M.alloy);
    body.position.set(x, y, z);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.03, 14), M.alloy);
    neck.position.set(x, y + 0.055, z);
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.045, 24), M.chrome);
    pan.position.set(x, y + 0.09, z);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8), M.chrome);
    nut.position.set(x, y + 0.12, z);
    const runner = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 10), M.alloy);
    runner.position.set(x + sx * 0.04, y - 0.06, z);
    runner.rotation.z = sx * 0.6;
    g.add(body, neck, pan, nut, runner);
  }
  // throttle linkage across, and the fuel hose between the float bowls
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, dx * 2, 6).rotateZ(Math.PI / 2), M.chrome);
  rod.position.set(c.x, y + 0.025, z + 0.042);
  const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, dx * 2 - 0.06, 8).rotateZ(Math.PI / 2), M.hose);
  hose.position.set(c.x, y - 0.02, z + 0.045);
  g.add(rod, hose);
  return mark(g);
}

// The kit as an item: the pair of carbs on their manifold bar.
export function carbKitModel() {
  const g = twinCarbs(new THREE.Box3(V(-0.25, -0.1, -0.06), V(0.25, 0.07, 0.06)));
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.07), mats().alloy);
  bar.position.y = -0.065;
  g.add(bar);
  return mark(g);
}

// Visual of a tune on a part, in car space for engine and exhaust, in spin space for a wheel.
export function tuneVisual(car, id, tune, spin = null) {
  const fam = family(car, id);
  if (fam === 'wheel' && tune === 'offroad' && spin) return treadMesh(spin);
  if (fam === 'exhaust' && tune === 'sport') return sportTips(car.type);
  if (fam === 'engine' && tune === 'twin') return twinCarbs(car.model.parts.engine.bbox);
  return null;
}

// Put a part's tune on the car's model (or take it off).
export function refreshTuneVisual(car, id) {
  const mp = car.model.parts[id];
  if (!mp) return;
  const wheel = car.model.wheels && car.model.wheels[id];
  const holder = wheel ? wheel.spin : mp.inner;
  for (const o of [...holder.children]) if (o.userData.tuneMesh) holder.remove(o);
  const tune = car.parts[id] && car.parts[id].installed ? car.parts[id].tune : null;
  if (!tune) return;
  const v = tuneVisual(car, id, tune, wheel ? wheel.spin : null);
  if (v) holder.add(v);
}

// Set a part's tune (null clears it), with looks and dynamics.
export function setTune(car, id, tune) {
  if (!car.parts[id]) return;
  car.parts[id].tune = tune || null;
  refreshTuneVisual(car, id);
  applyTune(car);
}
