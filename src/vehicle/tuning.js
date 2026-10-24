// Tuning: variants of ordinary parts that change how a car goes and sounds. They live on the part
// itself (car.parts[id].tune, and item.state.tune once it is off the car), so a tuned engine
// keeps its carbs when it is lifted out and a set of knobbly tyres can be moved car to car.
//   engine  'twin'    twin carburettors with chrome pancake filters: more pull up the rev range,
//                     an induction roar, a thirstier engine (fitted from a kit, unbolted with a wrench)
//   exhaust 'sport'   free-flowing muffler with big chrome tips: a little more top end, a harder
//                     rasp, and pops and crackles on the overrun
//   wheel   'offroad' knobbly mud tyres: bite in sand, dirt, grass and snow, give a little on
//                     tarmac, hum at speed
//   steeringWheel 'sport' / 'wood' / 'dish' / 'classic': another wheel on the column, the same
//                     size as the car's own (the hands hold it where they held that one)
//   front seat 'bucket' / 'recliner' / 'sheepskin': another seat in the car's own seat's place,
//                     made to its size

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roundedBox, cushionBox } from '../gfx/geom.js';
import { addSurfaceDetail } from '../gfx/triplanar.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const TUNES = {
  engine: { twin: { label: 'twin carbs', desc: 'Two carburettors breathe through chrome pancake filters: it pulls harder above mid revs, roars on the intake and drinks a fifth more.' } },
  exhaust: { sport: { label: 'Sport muffler', desc: 'Straight-through box with big chrome tips. A little more top end, a lot more noise, and it crackles when you lift off.' } },
  wheel: { offroad: { label: 'Mud tyre', desc: 'Knobbly off-road tread: grips in sand, dirt, grass and snow; a little less sure on tarmac, and it hums at speed.' } },
  seat: {
    bucket: { label: 'Bucket seat', desc: 'A fibreglass racing shell with deep bolsters and harness slots. Bolts into any front seat place.' },
    recliner: { label: 'Velour recliner', desc: 'A plump seventies seat in brown velour, pleated, with its own headrest. Bolts into any front seat place.' },
    sheepskin: { label: 'Sheepskin seat', desc: 'A seat under a thick sheepskin cover: warm in the desert night, hot in the day. Bolts into any front seat place.' },
  },
  steeringWheel: {
    sport: { label: 'Sport steering wheel', desc: 'Three drilled alloy spokes and a thick leather rim. Fits any column.' },
    wood: { label: 'Wooden steering wheel', desc: 'A varnished wood rim on three polished spokes, from some old roadster. Fits any column.' },
    dish: { label: 'Deep-dish steering wheel', desc: 'Suede rim, spokes dished toward you, a red mark at the top. Fits any column.' },
    classic: { label: 'Banjo steering wheel', desc: 'A thin black rim on four wire spokes, a chrome horn ring inside. Fits any column.' },
  },
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

// (a tune's family: the front seats share theirs; otherwise the type's part families)
const family = (car, id) => (id === 'seat_FL' || id === 'seat_FR' ? 'seat' : (car.type.PART_FAMILY && car.type.PART_FAMILY[id]) || id);
export const tuneInfo = (familyId, tune) => (tune && TUNES[familyId] && TUNES[familyId][tune]) || null;

// Label of a part (on a car or as an item) with its tune.
export function tunedLabel(type, id, tune) {
  const base = (type.PARTS[id] || { label: id }).label;
  const fam = id === 'seat_FL' || id === 'seat_FR' ? 'seat' : (type.PART_FAMILY && type.PART_FAMILY[id]) || id;
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

// The engine voice with the tunes: a sport box is brighter and louder, twin carbs rasp more
// under load. Cached per voice.
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
    if (sport) Object.assign(S, { gain: S.gain * 1.4, bright: S.bright * 1.6, bite: Math.min(1, S.bite + 0.3) });
    if (twin) Object.assign(S, { gain: S.gain * 1.12, bite: Math.min(1, S.bite + 0.25) });
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

// Another steering wheel, in the column's spinning frame (rim in the xy plane, round the origin,
// +z toward the driver, +y up to twelve o'clock), the rim at radius R.
let WHEEL_MATS = null;
function steeringWheelModel(kind, R) {
  const g = new THREE.Group();
  const M = mats();
  const mat = (WHEEL_MATS = WHEEL_MATS || {
    leather: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.62 }),
    wood: new THREE.MeshPhysicalMaterial({ color: 0x5b2c14, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    suede: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.95 }),
    bakelite: new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb01c14, roughness: 0.6 }),
    // satin steel for spokes and hubs: in the shade of a cabin a mirror chrome only shows the sky
    steel: new THREE.MeshStandardMaterial({ color: 0x9c9fa2, roughness: 0.38, metalness: 0.75, envMapIntensity: 0.35 }),
  });
  const add = (geo, m) => {
    const o = new THREE.Mesh(geo, m);
    o.castShadow = true;
    g.add(o);
    return o;
  };
  // a spoke from the hub out to the rim at angle a (0 = three o'clock), sunk `dish` toward the column at the hub
  const spoke = (a, w, t, m, dish = 0, holes = 0) => {
    const len = R - 0.035;
    const geo = new THREE.BoxGeometry(len, w, t).translate(0.035 + len / 2, 0, 0);
    // dish: the inner end lower toward the column
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - dish * (1 - (p.getX(i) - 0.035) / len));
    geo.computeVertexNormals();
    const o = add(geo, m);
    o.rotation.z = a;
    for (let k = 0; k < holes; k++) {
      const h = add(new THREE.CylinderGeometry(w * 0.22, w * 0.22, t + 0.002, 10).rotateX(Math.PI / 2).translate(0.07 + (k * (len - 0.07)) / holes, 0, -dish * (1 - (0.035 + (k * (len - 0.07)) / holes) / len)), mat.bakelite);
      h.rotation.z = a;
    }
    return o;
  };
  const hub = (r, depth, m, z = 0) => add(new THREE.CylinderGeometry(r, r * 1.05, depth, 28).rotateX(Math.PI / 2).translate(0, 0, z - depth / 2), m);
  if (kind === 'sport') {
    add(new THREE.TorusGeometry(R, 0.0155, 12, 64), mat.leather);
    for (const a of [0, Math.PI, -Math.PI / 2]) spoke(a, 0.034, 0.006, mat.steel, 0.012, 3);
    hub(0.045, 0.04, mat.leather, -0.008);
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 20).rotateX(Math.PI / 2).translate(0, 0, -0.006), mat.steel);
  } else if (kind === 'wood') {
    add(new THREE.TorusGeometry(R, 0.0115, 10, 64), mat.wood);
    for (const a of [0, Math.PI, -Math.PI / 2]) spoke(a, 0.022, 0.004, mat.steel, 0.02, 2);
    hub(0.032, 0.03, mat.steel, -0.018);
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 20).rotateX(Math.PI / 2).translate(0, 0, -0.02), mat.bakelite);
  } else if (kind === 'dish') {
    add(new THREE.TorusGeometry(R, 0.015, 12, 64), mat.suede);
    for (const a of [0, Math.PI, -Math.PI / 2]) spoke(a, 0.03, 0.005, mat.bakelite, 0.065, 3);
    hub(0.04, 0.03, mat.bakelite, -0.06);
    // the top-centre mark
    const stripe = add(new THREE.TorusGeometry(R, 0.0158, 8, 6, 0.09), mat.red);
    stripe.rotation.z = Math.PI / 2 - 0.045;
  } else {
    // banjo: a thin rim, four wire spokes in pairs, a chrome horn ring part way out
    add(new THREE.TorusGeometry(R, 0.0095, 10, 64), mat.bakelite);
    for (const a of [0.35, Math.PI - 0.35, Math.PI + 0.35, -0.35]) for (const d of [-0.012, 0.012]) {
      const w = add(new THREE.CylinderGeometry(0.0022, 0.0022, R - 0.03, 6).rotateZ(Math.PI / 2).translate(0.03 + (R - 0.03) / 2, d, -0.01), mat.steel);
      w.rotation.z = a;
    }
    add(new THREE.TorusGeometry(R * 0.62, 0.004, 8, 48).translate(0, 0, 0.004), mat.steel);
    hub(0.05, 0.035, mat.bakelite, -0.01);
  }
  return mark(g);
}

// Another front seat in car space, made to the box of the car's own (min/max): runners on the floor,
// a cushion, a back raked on its pivot, and what makes each kind itself: a racing bucket with
// bolsters and harness slots, a pleated velour recliner of the seventies with its headrest, a
// stock seat under a fleece cover.
let SEAT_MATS = null;
function seatModel(kind, mn, mx) {
  const g = new THREE.Group();
  const M = mats();
  const S = (SEAT_MATS = SEAT_MATS || {
    shell: new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.35, clearcoat: 0.6 }),
    cloth: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.92 }), 'weave', 0.5),
    stripe: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x8e1d17, roughness: 0.9 }), 'weave', 0.5),
    velour: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.97 }), 'weave', 0.6),
    velourDark: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x3e2716, roughness: 0.97 }), 'weave', 0.6),
    wool: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0xb3a07c, roughness: 1 }), 'grain', 0.9),
    frame: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.7, metalness: 0.3 }),
  });
  const w = mx.x - mn.x,
    d = mx.z - mn.z,
    H = mx.y - mn.y;
  const cx = (mn.x + mx.x) / 2;
  const y0 = mn.y;
  const put = (parent, geo, m, x, y, z, rx = 0, ry = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, 0);
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  const cushY = y0 + Math.min(0.28, H * 0.32);
  const cushD = d * 0.64;
  const cushZ = mn.z + d * 0.6;
  const backH = mx.y - cushY - 0.02;
  // runners, the frame under the cushion
  for (const s of [-1, 1]) {
    put(g, new THREE.BoxGeometry(0.03, 0.025, d * 0.75), M.alloy, cx + s * w * 0.3, y0 + 0.012, mn.z + d * 0.55);
    put(g, new THREE.BoxGeometry(0.02, cushY - y0 - 0.06, 0.03), S.frame, cx + s * w * 0.3, (y0 + cushY - 0.06) / 2 + 0.012, cushZ + cushD * 0.3);
    put(g, new THREE.BoxGeometry(0.02, cushY - y0 - 0.06, 0.03), S.frame, cx + s * w * 0.3, (y0 + cushY - 0.06) / 2 + 0.012, cushZ - cushD * 0.35);
  }
  put(g, roundedBox(w * 0.8, 0.05, cushD * 0.9, 0.01, 1), S.frame, cx, cushY - 0.06, cushZ);
  // the back, built upright from its pivot at the rear of the cushion and raked back
  const back = new THREE.Group();
  back.position.set(cx, cushY + 0.01, cushZ - cushD / 2 + 0.04);
  back.rotation.x = -0.24;
  g.add(back);
  if (kind === 'bucket') {
    put(g, cushionBox(w * 0.6, 0.08, cushD * 0.92, { r: 0.03, puff: 0.012, sag: 0.008 }), S.cloth, cx, cushY, cushZ, -0.05);
    put(g, cushionBox(w * 0.16, 0.07, cushD * 0.9, { r: 0.02, puff: 0.01 }), S.stripe, cx, cushY + 0.006, cushZ, -0.05);
    for (const s of [-1, 1]) put(g, cushionBox(w * 0.17, 0.15, cushD * 0.98, { r: 0.05, puff: 0.02 }), S.shell, cx + s * w * 0.385, cushY + 0.035, cushZ, -0.05);
    put(g, roundedBox(w * 0.94, 0.04, cushD, 0.015, 2), S.shell, cx, cushY - 0.045, cushZ);
    put(back, cushionBox(w * 0.56, backH * 0.82, 0.07, { r: 0.03, puff: 0.012 }), S.cloth, 0, backH * 0.43, 0.02);
    put(back, cushionBox(w * 0.16, backH * 0.8, 0.075, { r: 0.02, puff: 0.01 }), S.stripe, 0, backH * 0.43, 0.026);
    for (const s of [-1, 1]) {
      put(back, cushionBox(w * 0.17, backH * 0.6, 0.16, { r: 0.05, puff: 0.02 }), S.shell, s * w * 0.36, backH * 0.32, 0.045, 0, -s * 0.25);
      put(back, cushionBox(w * 0.16, backH * 0.26, 0.12, { r: 0.045, puff: 0.02 }), S.shell, s * w * 0.31, backH * 0.76, 0.035, 0, -s * 0.2);
    }
    put(back, roundedBox(w * 0.9, backH * 1.02, 0.03, 0.015, 2), S.shell, 0, backH * 0.5, -0.035);
    // harness slots high in the back
    for (const s of [-1, 1]) put(back, roundedBox(0.05, 0.022, 0.09, 0.008, 1), M.soot, s * 0.07, backH * 0.84, 0.0);
  } else if (kind === 'recliner') {
    // a seat of four plump rolls, a back of five, piped sides
    for (let k = 0; k < 4; k++) put(g, cushionBox(w * 0.82, 0.11, cushD / 4 + 0.005, { r: 0.045, puff: 0.02 }), S.velour, cx, cushY + 0.01, cushZ - cushD / 2 + (k + 0.5) * (cushD / 4), -0.04);
    for (const s of [-1, 1]) put(g, cushionBox(w * 0.08, 0.13, cushD, { r: 0.03, puff: 0.01 }), S.velourDark, cx + s * w * 0.45, cushY + 0.01, cushZ, -0.04);
    const rh = (backH * 0.8) / 5;
    for (let k = 0; k < 5; k++) put(back, cushionBox(w * 0.8, rh + 0.006, 0.1, { r: 0.04, puff: 0.022 }), S.velour, 0, 0.03 + (k + 0.5) * rh, 0.01);
    for (const s of [-1, 1]) put(back, cushionBox(w * 0.08, backH * 0.84, 0.13, { r: 0.03, puff: 0.01 }), S.velourDark, s * w * 0.44, backH * 0.42, 0.0);
    put(back, roundedBox(w * 0.96, backH * 0.86, 0.04, 0.015, 2), S.velourDark, 0, backH * 0.43, -0.06);
    // headrest on chrome posts, the recline lever by the pivot
    const hy = backH * 0.86 + 0.13;
    for (const s of [-1, 1]) put(back, new THREE.CylinderGeometry(0.006, 0.006, 0.14, 8), M.chrome, s * 0.06, hy - 0.08, -0.01);
    put(back, cushionBox(w * 0.52, 0.16, 0.1, { r: 0.05, puff: 0.02 }), S.velour, 0, hy, 0.0);
    put(g, roundedBox(0.02, 0.02, 0.12, 0.006, 1), M.chrome, cx + w * 0.48, cushY - 0.02, cushZ - cushD * 0.3, -0.3);
  } else {
    // the stock shape under a fleece: lumpy, overhanging the sides
    const fuzz = (geo, amt) => {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const h = Math.sin(p.getX(i) * 431.7 + p.getY(i) * 217.3 + p.getZ(i) * 311.9) * 43758.5453;
        const k = 1 + (h - Math.floor(h) - 0.5) * amt;
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
      }
      geo.computeVertexNormals();
      return geo;
    };
    put(g, fuzz(cushionBox(w * 0.92, 0.14, cushD * 1.02, { r: 0.055, puff: 0.04, sag: 0.01, seg: 4 }), 0.06), S.wool, cx, cushY + 0.01, cushZ);
    for (const s of [-1, 1]) put(g, fuzz(cushionBox(0.03, 0.1, cushD * 0.9, { r: 0.012, puff: 0.01 }), 0.15), S.wool, cx + s * w * 0.47, cushY - 0.05, cushZ);
    put(back, fuzz(cushionBox(w * 0.9, backH * 0.84, 0.14, { r: 0.06, puff: 0.04, seg: 4 }), 0.05), S.wool, 0, backH * 0.43, 0.0);
    const hy = backH * 0.86 + 0.12;
    for (const s of [-1, 1]) put(back, new THREE.CylinderGeometry(0.006, 0.006, 0.12, 8), M.chrome, s * 0.06, hy - 0.08, -0.02);
    put(back, fuzz(cushionBox(w * 0.58, 0.16, 0.11, { r: 0.05, puff: 0.03 }), 0.06), S.wool, 0, hy, 0.0);
  }
  return mark(g);
}

// Visual of a tune on a part, in car space for engine and exhaust, in spin space for a wheel, in
// the column's spinning frame for a steering wheel.
export function tuneVisual(car, id, tune, spin = null) {
  const fam = family(car, id);
  if (fam === 'steeringWheel' && TUNES.steeringWheel[tune]) return steeringWheelModel(tune, car.type.META.steeringWheel.radius - 0.012);
  if (fam === 'seat' && TUNES.seat[tune] && car.type.META.parts[id]) {
    const b = car.type.META.parts[id];
    return seatModel(tune, V(...b.min), V(...b.max));
  }
  if (fam === 'wheel' && tune === 'offroad' && spin) return treadMesh(spin);
  if (fam === 'exhaust' && tune === 'sport') return sportTips(car.type);
  if (fam === 'engine' && tune === 'twin') return twinCarbs(car.model.parts.engine.bbox);
  return null;
}

// Put a part's tune on the car's model (or take it off).
export function refreshTuneVisual(car, id) {
  const mp = car.model.parts[id];
  if (!mp) return;
  if (family(car, id) === 'seat') {
    // another seat in place of the car's own
    for (const o of [...mp.inner.children]) if (o.userData.tuneMesh) mp.inner.remove(o);
    const tune = car.parts[id] && car.parts[id].installed ? car.parts[id].tune : null;
    const v = tune ? tuneVisual(car, id, tune) : null;
    mp.inner.traverse((o) => {
      if (o.isMesh && !o.userData.tuneMesh) o.visible = !v;
    });
    if (v) mp.inner.add(v);
    return;
  }
  if (family(car, id) === 'steeringWheel') {
    // another wheel on the column: the car's own hidden under it
    const spin = mp.inner.getObjectByName('steeringSpin');
    if (!spin) return;
    for (const o of [...spin.children]) if (o.userData.tuneMesh) spin.remove(o);
    const tune = car.parts[id] && car.parts[id].installed ? car.parts[id].tune : null;
    const v = tune ? tuneVisual(car, id, tune) : null;
    for (const o of spin.children) o.visible = !v;
    if (v) spin.add(v);
    return;
  }
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
