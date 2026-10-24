// Furniture & interior props. Each factory returns an Item: { parts: [[geo, mat]], size:[w,h,d],
// cols:[{c,h}], loot:[{pos, kind}] } in local space (origin at floor centre, front = +Z).

import * as THREE from 'three';
import { roundedBox, latheY, loftSections, superSection, tubeAlong, shapeFromPoints, cushionBox } from '../../gfx/geom.js';
import { archMaterials, stdMat } from './materials.js';
import { mulberry32 } from '../../core/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Box-projected uvs in metres (as Item.box makes them), so a texture keeps its scale on every face
// of a rounded block instead of being squeezed onto its thin edges.
function metreUV(g) {
  const p = g.attributes.position,
    n = g.attributes.normal,
    uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)),
      ay = Math.abs(n.getY(i)),
      az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) uv.setXY(i, p.getZ(i), p.getY(i));
    else if (ay >= az) uv.setXY(i, p.getX(i), p.getZ(i));
    else uv.setXY(i, p.getX(i), p.getY(i));
  }
  return g;
}

class Item {
  constructor(size) {
    this.parts = [];
    this.size = size;
    this.cols = [];
    this.loot = [];
    this.lights = [];
    this.props = []; // real models (world/props.js) placed with the item
  }
  add(geo, mat) {
    this.parts.push([geo, mat]);
    return geo;
  }
  rbox(w, h, d, x, y, z, mat, r = 0.01, rotY = 0) {
    // one bevel row: the rounding on furniture is a few millimetres
    const g = metreUV(roundedBox(w, h, d, r, 1));
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    return this.add(g, mat);
  }
  box(w, h, d, x, y, z, mat) {
    const g = new THREE.BoxGeometry(w, h, d);
    // metre uvs
    const p = g.attributes.position,
      n = g.attributes.normal,
      uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)),
        ay = Math.abs(n.getY(i));
      const X = p.getX(i) + x,
        Y = p.getY(i) + y,
        Z = p.getZ(i) + z;
      if (ax > 0.5) uv.setXY(i, Z, Y);
      else if (ay > 0.5) uv.setXY(i, X, Z);
      else uv.setXY(i, X, Y);
    }
    g.translate(x, y, z);
    return this.add(g, mat);
  }
  col(w, h, d, x, y, z) {
    this.cols.push({ c: [x, y, z], h: [w / 2, h / 2, d / 2] });
  }
  lootAt(x, y, z, kind = 'any') {
    this.loot.push({ pos: [x, y, z], kind });
  }
}

const legs4 = (it, w, d, h, r, mat, inset = 0.04, round = true) => {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - inset),
        z = sz * (d / 2 - inset);
      if (round) {
        const g = new THREE.CylinderGeometry(r * 0.8, r, h, 10);
        g.translate(x, h / 2, z);
        it.add(g, mat);
      } else it.rbox(r * 2, h, r * 2, x, h / 2, z, mat, 0.004);
    }
};

// A soft cushion (see cushionBox) with uvs in metres for its fabric.
const cushion = (w, h, d, opts) => metreUV(cushionBox(w, h, d, { seg: 2, ...opts }));

// Bend a geometry `hw` either side of x = 0 so its middle bows back (towards -z) by `k`.
const bow = (g, k, hw) => {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - k * (1 - (p.getX(i) / hw) ** 2));
  g.computeVertexNormals();
  return g;
};

// Parts knocked over: turned as one (about x to fall on the back, about z on a side) and set
// down so their lowest point rests on the floor, then moved to (x, z).
function toppled(parts, rx, rz, x, z, ry = 0) {
  const m = new THREE.Matrix4().makeRotationY(ry).multiply(new THREE.Matrix4().makeRotationZ(rz)).multiply(new THREE.Matrix4().makeRotationX(rx));
  let lo = Infinity;
  for (const [g] of parts) {
    g.applyMatrix4(m);
    g.computeBoundingBox();
    lo = Math.min(lo, g.boundingBox.min.y);
  }
  for (const [g] of parts) g.translate(x, -lo, z);
  return parts;
}

// An Item's parts lifted out as a list (for knocking a whole piece over).
const partsOf = (item) => item.parts.map(([g, m]) => [g, m]);

// ------------------------------------------------------------------ bedroom
// Colliders for open shelving: the two ends, the back (optional) and every board, so whatever
// stands on a shelf rests on its board and can be reached. (One box around the whole unit had
// the things on the shelves buried inside it: they could not be aimed at, and when something
// woke them the physics shot them out.)
function shelfCols(it, w, h, d, boards, { back = true, cx = 0, cz = 0 } = {}) {
  const t = 0.03;
  for (const sx of [-1, 1]) it.col(t, h, d, cx + sx * (w / 2 - t / 2), h / 2, cz);
  if (back) it.col(w, h, t, cx, h / 2, cz - d / 2 + t / 2);
  for (const y of boards) it.col(w, t, d, cx, y, cz);
}

// A bed: panelled head and foot boards on posts (or a tubular iron frame), box spring, a
// mattress that has sagged, pillows, a blanket half pulled off. Left as found: the mattress
// shoved askew, bare and stained, a pillow on the floor.
export function bed(rnd, { double = true } = {}) {
  const M = archMaterials();
  const w = double ? 1.45 : 0.95,
    L = 2.0;
  const it = new Item([w + 0.12, 1.1, L + 0.1]);
  const wood = rnd() < 0.5 ? M.veneerDark : M.veneer;
  if (rnd() < 0.3) {
    // tubular iron frame: head and foot rails with bars, side angles
    const paint = rnd() < 0.5 ? M.metalPainted : M.enamelBlack;
    for (const sz of [-1, 1]) {
      const zz = (sz * L) / 2;
      const hh = sz < 0 ? 1.05 : 0.7;
      for (const sx of [-1, 1]) {
        it.add(new THREE.CylinderGeometry(0.02, 0.02, hh, 10).translate((sx * w) / 2, hh / 2, zz), paint);
        it.add(new THREE.SphereGeometry(0.03, 10, 8).translate((sx * w) / 2, hh + 0.01, zz), paint);
      }
      it.add(tubeAlong([V(-w / 2, hh - 0.06, zz), V(w / 2, hh - 0.06, zz)], 0.016, 8), paint);
      it.add(tubeAlong([V(-w / 2, 0.36, zz), V(w / 2, 0.36, zz)], 0.014, 8), paint);
      for (let k = 1; k < 6; k++) it.add(new THREE.CylinderGeometry(0.008, 0.008, hh - 0.42, 6).translate(-w / 2 + (w * k) / 6, 0.36 + (hh - 0.42) / 2, zz), paint);
    }
    for (const sx of [-1, 1]) it.box(0.04, 0.04, L, (sx * (w - 0.04)) / 2, 0.3, 0, paint);
  } else {
    // posts, rails, and boards made of a frame round a panel
    for (const sx of [-1, 1]) {
      it.rbox(0.07, 1.05, 0.07, sx * (w / 2 + 0.025), 0.525, -L / 2, wood, 0.01);
      it.add(latheY([[0, 0], [0.03, 0], [0.034, 0.02], [0.02, 0.05], [0, 0.07]], 12).translate(sx * (w / 2 + 0.025), 1.05, -L / 2), wood);
      it.rbox(0.06, 0.66, 0.06, sx * (w / 2 + 0.02), 0.33, L / 2, wood, 0.01);
      it.rbox(0.035, 0.17, L, sx * (w / 2 + 0.01), 0.28, 0, wood, 0.006);
    }
    moveParts(it, front(w, 0.55, wood, { t: 0.025 }), new THREE.Matrix4().makeTranslation(0, 0.72, -L / 2 - 0.012));
    it.rbox(w + 0.16, 0.06, 0.09, 0, 1.0, -L / 2, wood, 0.02);
    moveParts(it, front(w, 0.3, wood, { t: 0.022 }), new THREE.Matrix4().makeTranslation(0, 0.44, L / 2 - 0.011));
    it.rbox(w + 0.1, 0.05, 0.075, 0, 0.62, L / 2, wood, 0.015);
  }
  // box spring and mattress
  it.rbox(w - 0.02, 0.17, L - 0.04, 0, 0.3, 0, M.fabricBrown, 0.02);
  const askew = rnd() < 0.18;
  const mat = cushion(w - 0.04, 0.2, L - 0.08, { r: 0.05, puff: 0.012, sag: 0.025, seg: 3 });
  if (askew) mat.rotateY((rnd() - 0.5) * 0.25).translate((rnd() - 0.5) * 0.2, 0, 0.1 + rnd() * 0.12);
  it.add(mat.translate(0, 0.485, 0), M.mattress);
  const made = rnd() < 0.55;
  if (made && !askew) {
    // a blanket over the lower part, hanging down the sides in folds
    const blanketMat = [M.fabricRed, M.fabricBlue, M.fabric, M.fabricBrown, M.fabricGreen, M.fabricOrange][Math.floor(rnd() * 6)];
    const bl = new THREE.PlaneGeometry(w + 0.14, L * 0.7, 28, 28);
    bl.rotateX(-Math.PI / 2);
    const p = bl.attributes.position;
    const pulled = rnd() < 0.4 ? (rnd() < 0.5 ? -1 : 1) : 0;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i);
      const z = p.getZ(i);
      if (pulled) x += pulled * 0.35;
      let y = 0.6;
      const over = Math.abs(x) - (w - 0.04) / 2;
      if (over > 0) {
        y -= over * 3.0;
        x = Math.sign(x) * ((w - 0.04) / 2 + 0.02 + over * 0.15);
        y = Math.max(y, 0.02);
      }
      y += Math.sin(z * 11 + x * 3) * 0.01 + Math.sin(x * 17 + z * 5) * 0.006 + Math.sin(z * 23) * 0.003;
      p.setXYZ(i, x, y, z + L * 0.15);
    }
    bl.computeVertexNormals();
    it.add(bl, blanketMat);
    it.add(cushion(w + 0.02, 0.05, 0.2, { r: 0.022, puff: 0.012 }).translate(pulled * 0.35, 0.6, -L * 0.2), blanketMat);
  }
  // pillows: one may have ended up on the floor
  const np = double ? 2 : 1;
  for (let i = 0; i < np; i++) {
    const px = np === 1 ? 0 : (i - 0.5) * w * 0.48;
    const pg = cushion((w / np) * 0.82, 0.11, 0.38, { r: 0.05, puff: 0.035 });
    if (rnd() < 0.18) {
      pg.rotateZ(Math.PI / 2 - 0.3).rotateY(rnd() * 3);
      it.add(pg.translate((i ? 1 : -1) * (w / 2 + 0.05), 0.2, -L / 2 + 0.6 + rnd() * 0.5), M.mattress);
    } else it.add(pg.rotateX(-0.12).translate(px, 0.64, -L / 2 + 0.3), M.mattress);
  }
  it.col(w + 0.08, 0.6, L + 0.08, 0, 0.3, 0);
  it.col(w + 0.16, 0.5, 0.1, 0, 0.82, -L / 2);
  it.lootAt(0, 0.64, 0.3, 'bed');
  return it;
}

// A bedside cabinet: a drawer over an open cubby on short legs; a lamp on it, now and then
// knocked over.
export function nightstand(rnd) {
  const M = archMaterials();
  const it = new Item([0.46, 0.62, 0.4]);
  const wood = rnd() < 0.5 ? M.veneer : M.veneerDark;
  it.rbox(0.46, 0.03, 0.4, 0, 0.6, 0, wood, 0.008);
  for (const sx of [-1, 1]) it.box(0.02, 0.48, 0.38, sx * 0.21, 0.34, -0.01, wood);
  it.box(0.4, 0.02, 0.38, 0, 0.11, -0.01, wood);
  it.box(0.4, 0.02, 0.36, 0, 0.4, -0.01, wood);
  it.box(0.4, 0.48, 0.01, 0, 0.34, -0.195, wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) it.add(new THREE.CylinderGeometry(0.016, 0.011, 0.1, 8).translate(sx * 0.19, 0.05, sz * 0.15), wood);
  const out = rnd() < 0.25 ? 0.08 + rnd() * 0.14 : 0;
  const dr = front(0.4, 0.16, wood, { frame: false });
  pull(dr, rnd() < 0.5 ? 'knob' : 'bar', 0, 0, 0.02, M.chromeOld);
  if (out) {
    dr.push([new THREE.BoxGeometry(0.36, 0.008, 0.3).translate(0, -0.06, -0.15), wood]);
    for (const sx of [-1, 1]) dr.push([new THREE.BoxGeometry(0.01, 0.1, 0.3).translate(sx * 0.18, -0.02, -0.15), wood]);
  }
  moveParts(it, dr, new THREE.Matrix4().makeTranslation(0, 0.5, 0.185 + out));
  // a book or two in the cubby
  if (rnd() < 0.5) it.rbox(0.16, 0.03, 0.22, -0.05, 0.135, 0, [M.fabricRed, M.fabricBlue, M.trimDark][Math.floor(rnd() * 3)], 0.004);
  it.col(0.46, 0.62, 0.4, 0, 0.31, 0);
  it.lootAt(0.1, 0.62, 0.02, 'small');
  if (rnd() < 0.6) {
    const lamp = partsOf(tableLamp(rnd));
    if (rnd() < 0.2) toppled(lamp, 0, Math.PI / 2, -0.05, 0, rnd() * 3).forEach(([g, m]) => it.add(g.translate(0, 0.615, -0.02), m));
    else {
      for (const [g, m] of lamp) it.add(g.translate(-0.1, 0.615, -0.06), m);
      it.lights.push({ pos: [-0.1, 0.95, -0.06], color: 0xffd8a0, intensity: 1.2, distance: 4 });
    }
  }
  return it;
}

// A table lamp: a glazed ginger-jar base, brass neck, harp and finial, a pleated shade.
export function tableLamp(rnd) {
  const M = archMaterials();
  const it = new Item([0.3, 0.45, 0.3]);
  const base = [M.porcelainOld, M.applianceAvocado, M.applianceGold, M.applianceCopper][Math.floor(rnd() * 4)];
  it.add(latheY([[0, 0], [0.05, 0], [0.055, 0.008], [0.05, 0.016], [0.075, 0.07], [0.078, 0.11], [0.06, 0.16], [0.03, 0.18], [0.028, 0.19], [0, 0.19]], 24), base);
  it.add(latheY([[0, 0.19], [0.012, 0.19], [0.008, 0.2], [0.006, 0.3], [0.012, 0.31], [0, 0.31]], 10), M.chromeOld);
  it.add(new THREE.TorusGeometry(0.06, 0.003, 4, 16, Math.PI).translate(0, 0.31, 0), M.chromeOld);
  it.add(new THREE.SphereGeometry(0.01, 8, 6).translate(0, 0.375, 0), M.chromeOld);
  // the shade, with its pleats pressed in (a closed profile: outside and inside)
  const sh = latheY([[0.125, 0.2], [0.083, 0.37], [0.079, 0.37], [0.121, 0.2]], 64);
  const p = sh.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i);
    const k = 1 + Math.cos(Math.atan2(x, z) * 32) * 0.035;
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
  sh.computeVertexNormals();
  it.add(sh, rnd() < 0.7 ? M.mattress : M.fabricOrange);
  return it;
}

// A two-door wardrobe: crown and plinth, panelled doors; one often hangs open on the empty
// rail and its wire hangers.
export function wardrobe(rnd) {
  const M = archMaterials();
  const w = 0.95 + rnd() * 0.35,
    d = 0.58,
    H = 2.0;
  const it = new Item([w + 0.04, H + 0.04, d + 0.04]);
  const wood = rnd() < 0.5 ? M.veneerDark : M.veneer;
  const zf = d / 2 - 0.02;
  for (const sx of [-1, 1]) it.box(0.02, H - 0.1, d - 0.02, sx * (w / 2 - 0.01), 0.1 + (H - 0.1) / 2, -0.01, wood);
  it.box(w - 0.04, 0.02, d - 0.04, 0, 0.11, -0.01, wood);
  it.box(w - 0.04, 0.02, d - 0.04, 0, H - 0.03, -0.01, wood);
  it.box(w - 0.04, H - 0.1, 0.01, 0, 0.1 + (H - 0.1) / 2, -d / 2 + 0.005, wood);
  it.rbox(w + 0.05, 0.05, d + 0.04, 0, H + 0.005, 0, wood, 0.01);
  it.rbox(w + 0.02, 0.03, d + 0.02, 0, H - 0.03, 0, wood, 0.01);
  it.rbox(w, 0.1, d - 0.02, 0, 0.05, 0, M.trimDark, 0.006);
  // inside: a shelf, the rail and what is left on it
  it.box(w - 0.04, 0.018, d - 0.06, 0, H - 0.3, -0.02, wood);
  it.add(new THREE.CylinderGeometry(0.012, 0.012, w - 0.04, 10).rotateZ(Math.PI / 2).translate(0, H - 0.4, -0.02), M.chromeOld);
  let x = -w / 2 + 0.1;
  while (x < w / 2 - 0.1) {
    if (rnd() < 0.55) {
      const a = (rnd() - 0.5) * 0.4;
      it.add(tubeAlong([V(x, H - 0.4, -0.02), V(x, H - 0.43, -0.02), V(x + 0.2 * Math.cos(a), H - 0.52, -0.02 + 0.2 * Math.sin(a)), V(x - 0.2 * Math.cos(a), H - 0.52, -0.02 - 0.2 * Math.sin(a)), V(x, H - 0.43, -0.02)], 0.002, 4, { closedEnds: false }), M.chromeOld);
      // an old coat still on one
      if (rnd() < 0.2) it.add(cushion(0.42, 0.85, 0.12, { r: 0.05, puff: 0.03 }).rotateY(a).translate(x, H - 0.95, -0.02), [M.fabricBrown, M.trimDark, M.fabricBlue][Math.floor(rnd() * 3)]);
    }
    x += 0.1 + rnd() * 0.12;
  }
  // the doors: one may hang open, one may be gone
  const open = rnd() < 0.4 ? (rnd() < 0.5 ? -1 : 1) : 0;
  for (const s of [-1, 1]) {
    if (open === s && rnd() < 0.15) continue;
    const dw = w / 2 - 0.015;
    const parts = front(dw, H - 0.16, wood, { t: 0.022 });
    pull(parts, 'knob', -s * (dw / 2 - 0.05), 0, 0.022, M.chromeOld);
    moveParts(it, parts, swingY((s * w) / 4, 0.1 + (H - 0.1) / 2, zf, dw, s, open === s ? 0.35 + rnd() * 1.4 : 0));
  }
  it.col(w, H, d, 0, H / 2, 0);
  // (the doors were shut on most: whatever was kept was left on top)
  it.lootAt(0, H + 0.03, 0.0, 'clothes');
  return it;
}

// A chest of drawers: the drawers pulled out or gone, a mirror over it (sometimes cracked).
export function dresser(rnd) {
  const M = archMaterials();
  const w = 1.0 + rnd() * 0.3;
  const it = new Item([w + 0.03, 0.9, 0.5]);
  const wood = rnd() < 0.5 ? M.veneer : M.veneerDark;
  it.rbox(w + 0.03, 0.03, 0.5, 0, 0.835, 0, wood, 0.008);
  for (const sx of [-1, 1]) it.box(0.02, 0.72, 0.46, sx * (w / 2 - 0.01), 0.46, -0.01, wood);
  it.box(w - 0.04, 0.72, 0.01, 0, 0.46, -0.235, wood);
  it.box(w - 0.04, 0.02, 0.44, 0, 0.11, -0.01, wood);
  it.rbox(w, 0.1, 0.44, 0, 0.05, -0.02, M.trimDark, 0.006);
  const knob = rnd() < 0.5 ? 'knob' : 'bar';
  for (let i = 0; i < 3; i++) {
    const y = 0.22 + i * 0.23;
    it.box(w - 0.04, 0.014, 0.44, 0, y - 0.115, -0.01, wood);
    const st = rnd();
    if (st < 0.08) continue;
    const out = st < 0.3 ? 0.1 + rnd() * 0.25 : 0;
    const parts = front(w - 0.05, 0.21, wood, { frame: false });
    for (const s of [-1, 1]) pull(parts, knob, s * w * 0.25, 0, 0.02, M.chromeOld);
    if (out) {
      parts.push([new THREE.BoxGeometry(w - 0.1, 0.008, 0.4).translate(0, -0.08, -0.2), wood]);
      for (const s of [-1, 1]) parts.push([new THREE.BoxGeometry(0.012, 0.16, 0.4).translate((s * (w - 0.1)) / 2, -0.01, -0.2), wood]);
      parts.push([new THREE.BoxGeometry(w - 0.1, 0.16, 0.012).translate(0, -0.01, -0.4), wood]);
      // a jumper left in it
      if (rnd() < 0.4) parts.push([cushion(w * 0.4, 0.05, 0.25, { r: 0.02, puff: 0.02 }).translate((rnd() - 0.5) * w * 0.3, -0.05, -0.2), [M.fabricRed, M.fabricBlue, M.fabricGreen][Math.floor(rnd() * 3)]]);
    }
    moveParts(it, parts, new THREE.Matrix4().makeTranslation(0, y, 0.215 + out));
  }
  if (rnd() < 0.6) {
    // the mirror on its stand: frame, glass gone grey, now and then a crack across it
    for (const s of [-1, 1]) it.rbox(0.04, 0.5, 0.04, s * w * 0.36, 1.08, -0.21, wood, 0.008);
    it.rbox(w * 0.66, 0.66, 0.03, 0, 1.25, -0.2, wood, 0.012);
    it.rbox(w * 0.66 - 0.08, 0.58, 0.004, 0, 1.25, -0.183, stdMat({ color: 0x8e938f, metalness: 1, roughness: 0.18 }), 0.003);
    if (rnd() < 0.35) {
      let px = (rnd() - 0.5) * w * 0.3,
        py = 1.25 + (rnd() - 0.5) * 0.3;
      for (let k = 0; k < 7; k++) {
        const a = rnd() * 6.28,
          l = 0.06 + rnd() * 0.12;
        const c = new THREE.BoxGeometry(l, 0.002, 0.001).rotateZ(a).translate(px + (Math.cos(a) * l) / 2, py + (Math.sin(a) * l) / 2, -0.18);
        it.add(c, M.blackMatte);
        if (k % 3 === 2) {
          px += Math.cos(a) * l * 0.5;
          py += Math.sin(a) * l * 0.5;
        }
      }
    }
  }
  it.col(w, 0.85, 0.48, 0, 0.42, 0);
  it.lootAt(0.2, 0.86, 0, 'small');
  return it;
}

// ------------------------------------------------------------------ living
// A settee: seat and back cushions that swell, rolled or square arms, on tapered legs or a skirt.
// Left as found: a seat cushion gone (on the floor), a back cushion slumped forward.
export function sofa(rnd, { seats = 3 } = {}) {
  const M = archMaterials();
  const fab = [M.fabric, M.fabricBrown, M.fabricBlue, M.fabricRed, M.fabricGreen, M.fabricOrange][Math.floor(rnd() * 6)];
  const w = 0.62 * seats + 0.3,
    d = 0.86;
  const it = new Item([w, 0.86, d + 0.02]);
  const legs = rnd() < 0.6;
  const y0 = legs ? 0.12 : 0.02;
  if (legs) for (const sx of [-1, 1]) for (const sz of [-1, 1]) it.add(new THREE.CylinderGeometry(0.022, 0.012, 0.13, 10).translate(0, -0.065, 0).rotateX(sz * 0.12).rotateZ(-sx * 0.12).translate(sx * (w / 2 - 0.07), 0.13, sz * (d / 2 - 0.08)), M.veneerDark);
  else it.rbox(w - 0.02, 0.14, d - 0.04, 0, 0.09, 0, fab, 0.01);
  // the frame under the cushions and the back
  it.rbox(w, 0.2, d, 0, y0 + 0.1, 0, fab, 0.03);
  it.add(cushion(w, 0.5, 0.2, { r: 0.06, puff: 0.015 }).translate(0, y0 + 0.43, -d / 2 + 0.1), fab);
  // arms
  const rolled = rnd() < 0.5;
  for (const s of [-1, 1]) {
    if (rolled) {
      it.add(cushion(0.15, 0.3, d, { r: 0.06, puff: 0.01 }).translate(s * (w / 2 - 0.075), y0 + 0.33, 0), fab);
      it.add(new THREE.CylinderGeometry(0.095, 0.095, d - 0.02, 16).rotateX(Math.PI / 2).translate(s * (w / 2 - 0.07), y0 + 0.5, 0.0), fab);
    } else it.add(cushion(0.16, 0.44, d, { r: 0.05, puff: 0.012 }).translate(s * (w / 2 - 0.08), y0 + 0.37, 0), fab);
  }
  // cushions
  const cw = (w - 0.32) / seats;
  for (let i = 0; i < seats; i++) {
    const x = -w / 2 + 0.16 + cw * (i + 0.5);
    const seat = cushion(cw - 0.012, 0.15, d - 0.22, { r: 0.05, puff: 0.03, sag: 0.015 });
    if (rnd() < 0.12) {
      // pulled off and dropped in front
      seat.rotateZ(rnd() < 0.3 ? Math.PI / 2 : 0).rotateY(rnd() * 3);
      it.add(seat.translate(x + (rnd() - 0.5) * 0.3, 0.08, d / 2 + 0.25), fab);
    } else it.add(seat.translate(x, y0 + 0.275, 0.09), fab);
    const back = cushion(cw - 0.015, 0.42, 0.15, { r: 0.06, puff: 0.03 });
    if (rnd() < 0.15) it.add(back.rotateX(1.1).translate(x, y0 + 0.42, 0.02), fab);
    else it.add(back.rotateX(-0.14).translate(x, y0 + 0.55, -d / 2 + 0.24), fab);
  }
  it.col(w, y0 + 0.36, d, 0, (y0 + 0.36) / 2, 0);
  it.col(w, 0.45, 0.2, 0, y0 + 0.43, -d / 2 + 0.1);
  it.lootAt(0.2, y0 + 0.36, 0.1, 'couch');
  return it;
}

export function armchair(rnd) {
  const it = sofa(rnd, { seats: 1 });
  it.size = [0.92, 0.86, 0.88];
  return it;
}

// A low table on splayed tapered legs, a shelf under it with old magazines, an ashtray.
export function coffeeTable(rnd) {
  const M = archMaterials();
  const it = new Item([1.0, 0.45, 0.55]);
  const wood = rnd() < 0.5 ? M.veneer : M.veneerDark;
  it.rbox(1.0, 0.035, 0.55, 0, 0.43, 0, wood, 0.012);
  it.rbox(0.9, 0.05, 0.45, 0, 0.39, 0, wood, 0.004);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) it.add(new THREE.CylinderGeometry(0.022, 0.011, 0.4, 10).translate(0, -0.2, 0).rotateX(sz * 0.14).rotateZ(-sx * 0.14).translate(sx * 0.42, 0.39, sz * 0.19), wood);
  it.rbox(0.82, 0.018, 0.36, 0, 0.13, 0, wood, 0.004);
  for (let k = 0; k < Math.floor(rnd() * 4); k++) {
    const m = new THREE.BoxGeometry(0.21, 0.006, 0.28).rotateY((rnd() - 0.5) * 0.8).translate((rnd() - 0.5) * 0.4, 0.143 + k * 0.007, (rnd() - 0.5) * 0.08);
    it.add(m, stdMat({ color: [0xc8b89a, 0x9a4a3a, 0x4a6a8a, 0xd8c060][Math.floor(rnd() * 4)], roughness: 0.8 }));
  }
  if (rnd() < 0.35) it.add(latheY([[0, 0], [0.06, 0], [0.065, 0.025], [0.058, 0.026], [0.05, 0.008], [0, 0.008]], 16).translate(-0.3 + rnd() * 0.2, 0.448, 0.1), M.glassDirty);
  it.col(1.0, 0.45, 0.55, 0, 0.22, 0);
  it.lootAt(0.15, 0.45, 0.05, 'table');
  return it;
}

// A cathode ray television of the seventies: a wood or plastic case tapering to the back, the
// screen bulging in its dark surround, channel dials and a speaker grille beside it, rabbit-ear
// aerials on top. Some have the screen kicked in.
export function crtTV(rnd, { broken = null, aerial = null } = {}) {
  const M = archMaterials();
  const parts = [];
  const add = (g, m) => parts.push([g, m]);
  const W = 0.64,
    H = 0.48,
    D = 0.44;
  const caseMat = rnd() < 0.5 ? M.veneerDark : M.plasticDark;
  // the front: a rounded block, the housing behind it tapering back
  add(roundedBox(W, H, 0.08, 0.02, 2).translate(0, H / 2 + 0.02, D / 2 - 0.04), caseMat);
  const rows = [
    [W / 2 - 0.015, H / 2 - 0.015, D / 2 - 0.08],
    [0.27, 0.21, 0.0],
    [0.19, 0.15, -D / 2],
  ];
  add(loftSections(rows.map(([a, b, z]) => superSection(V(0, H / 2 + 0.02, z), V(1, 0, 0), V(0, 1, 0), a, b, 5, 24)), { capEnd: true }), M.plasticDark);
  // screen in its surround
  const sx = -0.07,
    sy = H / 2 + 0.02,
    sz = D / 2 + 0.001;
  add(roundedBox(0.47, 0.37, 0.012, 0.03, 2).translate(sx, sy, sz), M.blackMatte);
  if (broken === null) broken = rnd() < 0.18;
  const scr = new THREE.PlaneGeometry(0.43, 0.33, 10, 8);
  const p = scr.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / 0.215,
      v = p.getY(i) / 0.165;
    p.setZ(i, 0.012 * (1 - u * u) * (1 - v * v) - (broken ? 0.12 : 0));
  }
  scr.computeVertexNormals();
  add(scr.translate(sx, sy, sz + 0.007), broken ? M.blackMatte : M.screen);
  if (broken) {
    // what is left of the glass round the edge of the hole
    const s = new THREE.Shape();
    s.moveTo(-0.215, -0.165);
    s.lineTo(0.215, -0.165);
    s.lineTo(0.215, 0.165);
    s.lineTo(-0.215, 0.165);
    s.closePath();
    const hole = new THREE.Path();
    const n = 22;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const r = 0.55 + rnd() * 0.4;
      const x = Math.cos(a) * 0.2 * r,
        y = Math.sin(a) * 0.15 * r;
      if (k) hole.lineTo(x, y);
      else hole.moveTo(x, y);
    }
    hole.closePath();
    s.holes.push(hole);
    add(new THREE.ShapeGeometry(s).translate(sx, sy, sz + 0.009), M.screen);
  }
  // controls: two dials, a row of buttons, the grille below
  for (const ky of [0.07, -0.04]) add(latheY([[0, 0], [0.026, 0], [0.027, 0.01], [0.02, 0.026], [0, 0.028]], 18).rotateX(Math.PI / 2).translate(0.235, sy + ky, D / 2), M.plasticDark);
  for (let k = 0; k < 3; k++) add(roundedBox(0.018, 0.012, 0.01, 0.003, 1).translate(0.205 + k * 0.03, sy - 0.1, D / 2 + 0.004), M.trimWhite);
  add(roundedBox(0.11, 0.09, 0.004, 0.006, 1).translate(0.235, sy - 0.17 + 0.02, D / 2 + 0.002), M.blackMatte);
  for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(0.1, 0.004, 0.003).translate(0.235, sy - 0.18 + k * 0.016, D / 2 + 0.005), M.chromeOld);
  for (const fx of [-1, 1]) for (const fz of [-1, 1]) add(roundedBox(0.05, 0.022, 0.05, 0.008, 1).translate(fx * (W / 2 - 0.06), 0.011, fz * (D / 2 - 0.08)), M.rubber);
  // aerial
  if (aerial ?? rnd() < 0.55) {
    // on the top of the tube's housing (its top a little behind the front block)
    const ay = H / 2 + 0.02 + 0.205;
    add(latheY([[0, 0], [0.05, 0], [0.04, 0.03], [0, 0.04]], 14).translate(0.05, ay - 0.004, 0.0), M.plasticDark);
    for (const s of [-1, 1]) {
      const a = 0.35 + rnd() * 0.4;
      add(new THREE.CylinderGeometry(0.003, 0.003, 0.5, 5).translate(0, 0.25, 0).rotateZ(s * a).rotateX(-0.25).translate(0.05, ay + 0.022, 0.0), M.chromeOld);
    }
  }
  return parts;
}

// A low cabinet with the television on it (or a clean patch where one stood).
export function tvStand(rnd) {
  const M = archMaterials();
  const it = new Item([1.1, 1.1, 0.5]);
  const wood = M.veneerDark;
  it.rbox(1.1, 0.03, 0.46, 0, 0.5, 0, wood, 0.008);
  for (const sx of [-1, 1]) it.box(0.02, 0.42, 0.44, sx * 0.54, 0.28, -0.01, wood);
  it.box(1.06, 0.02, 0.44, 0, 0.08, -0.01, wood);
  it.box(1.06, 0.42, 0.01, 0, 0.28, -0.225, wood);
  it.box(1.06, 0.02, 0.4, 0, 0.29, -0.01, wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) it.add(new THREE.CylinderGeometry(0.018, 0.012, 0.08, 8).translate(sx * 0.5, 0.04, sz * 0.18), wood);
  for (const s of [-1, 1]) {
    const parts = front(0.52, 0.4, wood, { t: 0.02 });
    pull(parts, 'knob', -s * 0.2, 0, 0.02, M.chromeOld);
    moveParts(it, parts, swingY(s * 0.265, 0.29, 0.215, 0.52, s, rnd() < 0.2 ? 0.3 + rnd() * 1.2 : 0));
  }
  if (rnd() < 0.85) {
    const tv = crtTV(rnd);
    const m = new THREE.Matrix4().makeRotationY((rnd() - 0.5) * 0.3).setPosition((rnd() - 0.5) * 0.15, 0.515, -0.02);
    for (const [g, mat] of tv) it.add(g.applyMatrix4(m), mat);
  }
  it.col(1.1, 0.52, 0.46, 0, 0.26, 0);
  it.col(0.62, 0.5, 0.42, 0, 0.77, 0);
  return it;
}

export function bookshelf(rnd) {
  const M = archMaterials();
  const w = 0.8 + rnd() * 0.3,
    h = 1.8;
  const it = new Item([w, h, 0.32]);
  const wood = rnd() < 0.5 ? M.veneer : M.veneerDark;
  it.rbox(0.025, h, 0.3, -w / 2 + 0.0125, h / 2, 0, wood, 0.004);
  it.rbox(0.025, h, 0.3, w / 2 - 0.0125, h / 2, 0, wood, 0.004);
  it.box(w - 0.03, h - 0.02, 0.008, 0, h / 2, -0.146, wood);
  it.rbox(w + 0.02, 0.03, 0.32, 0, h + 0.015, 0, wood, 0.006);
  it.rbox(w - 0.03, 0.06, 0.02, 0, 0.03, 0.14, M.trimDark, 0.004);
  const shelves = 5;
  const bookMats = [M.metalRed, M.fabricBlue, M.fabricBrown, M.trimDark, M.metalGreen, M.mattress, M.fabricOrange];
  for (let i = 0; i <= shelves; i++) {
    const y = 0.04 + (i * (h - 0.06)) / shelves;
    it.rbox(w - 0.03, 0.022, 0.29, 0, y, 0, wood, 0.003);
    if (i === shelves) continue;
    // books: runs with gaps where some were taken, some leaning, a few lying flat
    let x = -w / 2 + 0.04;
    while (x < w / 2 - 0.08) {
      const r = rnd();
      if (r < 0.22) {
        x += 0.05 + rnd() * 0.15;
        continue;
      }
      if (r < 0.3) {
        const bw = 0.2 + rnd() * 0.06;
        if (x + bw > w / 2 - 0.03) break;
        for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) it.add(roundedBox(bw, 0.03, 0.15 + rnd() * 0.05, 0.003, 1).rotateY((rnd() - 0.5) * 0.3).translate(x + bw / 2, y + 0.026 + k * 0.031, 0.0), bookMats[Math.floor(rnd() * bookMats.length)]);
        x += bw + 0.01;
        continue;
      }
      const bw = 0.025 + rnd() * 0.03,
        bh = 0.18 + rnd() * 0.1,
        bd = 0.15 + rnd() * 0.08;
      const lean = rnd() < 0.12 ? 0.25 : 0;
      const g = roundedBox(bw, bh, bd, 0.003, 1);
      if (lean) g.translate(bw / 2, bh / 2, 0).rotateZ(-lean).translate(-bw / 2, -bh / 2, 0);
      g.translate(x + bw / 2, y + 0.011 + bh / 2, 0.0);
      it.add(g, bookMats[Math.floor(rnd() * bookMats.length)]);
      x += bw + 0.002 + (lean ? 0.06 : 0);
    }
  }
  // a couple pulled out and dropped
  for (let k = 0; k < Math.floor(rnd() * 3); k++) it.add(roundedBox(0.16, 0.03, 0.22, 0.003, 1).rotateY(rnd() * 6).translate((rnd() - 0.5) * w * 0.7, 0.015, 0.22 + rnd() * 0.1), bookMats[Math.floor(rnd() * bookMats.length)]);
  shelfCols(it, w, h, 0.32, Array.from({ length: shelves + 1 }, (_, i) => 0.04 + (i * (h - 0.06)) / shelves));
  // on the board at chest height, in front of the books
  it.lootAt(0, 0.04 + (3 * (h - 0.06)) / shelves + 0.012, 0.08, 'shelf');
  return it;
}

export function rug(rnd, w = 2.0, d = 1.4) {
  const M = archMaterials();
  const it = new Item([w, 0.01, d]);
  const g = new THREE.BoxGeometry(w, 0.008, d);
  const uv = g.attributes.uv,
    p = g.attributes.position;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getZ(i) / d + 0.5);
  g.translate(0, 0.004, 0);
  it.add(g, M.rug);
  return it;
}

// ------------------------------------------------------------------ dining / kitchen
// A dining table, either wooden on turned legs or a chrome dinette with a laminate top, and its
// chairs: some knocked over, some gone.
export function diningTable(rnd, { chairs = 4 } = {}) {
  const M = archMaterials();
  const w = 1.3,
    d = 0.8;
  const it = new Item([w + 0.9, 0.95, d + 0.9]);
  const dinette = rnd() < 0.4;
  const wood = rnd() < 0.5 ? M.veneer : M.veneerDark;
  if (dinette) {
    it.rbox(w, 0.03, d, 0, 0.745, 0, rnd() < 0.5 ? M.linoleum : M.trimWhite, 0.006);
    it.rbox(w + 0.006, 0.032, d + 0.006, 0, 0.744, 0, M.chromeOld, 0.004);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        it.add(new THREE.CylinderGeometry(0.018, 0.018, 0.72, 10).translate(sx * (w / 2 - 0.08), 0.37, sz * (d / 2 - 0.08)), M.chromeOld);
        it.add(new THREE.CylinderGeometry(0.022, 0.026, 0.02, 10).translate(sx * (w / 2 - 0.08), 0.01, sz * (d / 2 - 0.08)), M.rubber);
      }
  } else {
    it.rbox(w, 0.035, d, 0, 0.75, 0, wood, 0.01);
    for (const sx of [-1, 1]) it.box(0.02, 0.09, d - 0.12, sx * (w / 2 - 0.06), 0.685, 0, wood);
    for (const sz of [-1, 1]) it.box(w - 0.12, 0.09, 0.02, 0, 0.685, sz * (d / 2 - 0.06), wood);
    const leg = [[0, 0], [0.024, 0], [0.026, 0.06], [0.018, 0.12], [0.022, 0.3], [0.03, 0.42], [0.022, 0.5], [0.028, 0.56], [0.03, 0.73], [0, 0.73]];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) it.add(latheY(leg, 12).translate(sx * (w / 2 - 0.07), 0, sz * (d / 2 - 0.07)), wood);
  }
  it.col(w, 0.77, d, 0, 0.385, 0);
  const places = [
    [0, -d / 2 - 0.25, 0],
    [0, d / 2 + 0.25, Math.PI],
    [-w / 2 - 0.25, 0, Math.PI / 2],
    [w / 2 + 0.25, 0, -Math.PI / 2],
  ];
  for (let i = 0; i < chairs && i < 4; i++) {
    const [x, z, r] = places[i];
    const st = rnd();
    if (st < 0.08) continue;
    const c = partsOf(chair(rnd, wood, dinette));
    if (st < 0.28) {
      // knocked over, on its back or a side, shoved off from its place
      const back = rnd() < 0.6;
      const out = 0.3 + rnd() * 0.3;
      toppled(c, back ? -Math.PI / 2 : 0, back ? 0 : (rnd() < 0.5 ? -1 : 1) * (Math.PI / 2), 0, 0, r + (rnd() - 0.5) * 1.2).forEach(([g, m]) => it.add(g.translate(x - Math.sin(r) * out, 0, z - Math.cos(r) * out), m));
      continue;
    }
    const rr = r + (rnd() - 0.5) * 0.35;
    const slide = rnd() < 0.4 ? 0.15 + rnd() * 0.2 : 0;
    for (const [g, m] of c) it.add(g.rotateY(rr).translate(x - Math.sin(r) * slide, 0, z - Math.cos(r) * slide), m);
  }
  it.lootAt(0.2, 0.77, 0.1, 'table');
  return it;
}

// A dining chair facing +z: wooden with turned front legs, the back legs running up into posts,
// a bowed top rail over spindles; or a chrome-tube dinette chair with vinyl seat and back.
export function chair(rnd, wood, dinette = false) {
  const M = archMaterials();
  wood = wood || M.veneer;
  const it = new Item([0.46, 0.95, 0.46]);
  if (dinette) {
    const vinyl = [M.vinylRed, M.vinylTeal, M.vinylYellow][Math.floor(rnd() * 3)];
    for (const s of [-1, 1]) {
      const x = s * 0.19;
      it.add(tubeAlong([V(x, 0.0, 0.2), V(x, 0.0, -0.17), V(x, 0.02, -0.2), V(x, 0.44, -0.2), V(x, 0.9, -0.24)], 0.011, 8), M.chromeOld);
      it.add(tubeAlong([V(x, 0.0, 0.2), V(x, 0.03, 0.22), V(x, 0.42, 0.18)], 0.011, 8), M.chromeOld);
    }
    it.add(tubeAlong([V(-0.19, 0.42, 0.18), V(0.19, 0.42, 0.18)], 0.009, 8), M.chromeOld);
    it.add(cushion(0.42, 0.07, 0.42, { r: 0.03, puff: 0.012 }).translate(0, 0.47, 0.0), vinyl);
    it.add(cushion(0.38, 0.22, 0.05, { r: 0.022, puff: 0.012 }).rotateX(0.08).translate(0, 0.78, -0.225), vinyl);
  } else {
    // seat, slightly dished
    it.add(cushion(0.42, 0.03, 0.4, { r: 0.012, puff: 0.004, sag: 0.006 }).translate(0, 0.45, 0.01), wood);
    const leg = [[0, 0], [0.016, 0], [0.019, 0.08], [0.013, 0.15], [0.017, 0.24], [0.022, 0.3], [0.017, 0.36], [0.02, 0.43], [0, 0.43]];
    for (const s of [-1, 1]) {
      it.add(latheY(leg, 10).translate(s * 0.18, 0, 0.17), wood);
      // back leg and post in one, raked back above the seat
      it.add(tubeAlong([V(s * 0.18, 0, -0.2), V(s * 0.18, 0.44, -0.18), V(s * 0.18, 0.92, -0.23)], 0.016, 8), wood);
      it.add(new THREE.CylinderGeometry(0.009, 0.009, 0.36, 6).rotateX(Math.PI / 2).translate(s * 0.18, 0.15, -0.01), wood);
    }
    it.add(new THREE.CylinderGeometry(0.009, 0.009, 0.36, 6).rotateZ(Math.PI / 2).translate(0, 0.17, -0.01), wood);
    it.add(bow(roundedBox(0.4, 0.07, 0.024, 0.008, 1), 0.035, 0.2).translate(0, 0.86, -0.21), wood);
    for (const k of [-1, 0, 1]) it.add(new THREE.CylinderGeometry(0.008, 0.009, 0.36, 6).rotateX(0.1).translate(k * 0.09, 0.65, -0.205 + (k === 0 ? -0.006 : 0)), wood);
  }
  it.col(0.42, 0.47, 0.42, 0, 0.23, 0);
  return it;
}

// Fronts and hardware for cabinets, built round their own origin (front face towards +z, back
// at z = 0) as [geo, mat] lists, then moved as one: a door swung on its hinge, a drawer pulled out.
const moveParts = (it, parts, m4) => {
  for (const [g, m] of parts) it.add(g.applyMatrix4(m4), m);
};
// shut at (x, y, z); hinged on its left (side -1) or right (1) edge and opened by `a`
const swingY = (x, y, z, w, side, a) =>
  new THREE.Matrix4()
    .makeTranslation(x + (side * w) / 2, y, z)
    .multiply(new THREE.Matrix4().makeRotationY(side * a))
    .multiply(new THREE.Matrix4().makeTranslation((-side * w) / 2, 0, 0));
// hinged along its bottom edge (an oven door), dropped open by `a`
const swingX = (x, y, z, h, a) =>
  new THREE.Matrix4()
    .makeTranslation(x, y - h / 2, z)
    .multiply(new THREE.Matrix4().makeRotationX(a))
    .multiply(new THREE.Matrix4().makeTranslation(0, h / 2, 0));

// A door or drawer front: a frame round a sunk panel (or plain), t thick.
function front(w, h, mat, { frame = true, t = 0.02 } = {}) {
  const parts = [];
  const rb = (...a) => metreUV(roundedBox(...a));
  if (!frame || w < 0.16 || h < 0.16) {
    parts.push([rb(w, h, t, 0.004, 1).translate(0, 0, t / 2), mat]);
    return parts;
  }
  const f = Math.min(0.06, w * 0.16, h * 0.16);
  parts.push([metreUV(new THREE.BoxGeometry(w - 2 * f + 0.01, h - 2 * f + 0.01, t * 0.55)).translate(0, 0, t * 0.27), mat]);
  for (const sx of [-1, 1]) parts.push([rb(f, h, t, 0.004, 1).translate(sx * (w / 2 - f / 2), 0, t / 2), mat]);
  for (const sy of [-1, 1]) parts.push([rb(w - 2 * f, f, t, 0.004, 1).translate(0, sy * (h / 2 - f / 2), t / 2), mat]);
  return parts;
}

// A pull on a front at (x, y): a bar on two posts (upright or across), or a knob.
function pull(parts, kind, x, y, z, mat, upright = false) {
  if (kind === 'knob') {
    parts.push([latheY([[0, 0], [0.007, 0], [0.006, 0.014], [0.014, 0.02], [0.012, 0.028], [0, 0.03]], 12).rotateX(Math.PI / 2).translate(x, y, z), mat]);
    return;
  }
  const L = 0.1;
  const bar = roundedBox(L, 0.011, 0.011, 0.005, 1);
  const post = (o) => new THREE.CylinderGeometry(0.004, 0.005, 0.024, 8).rotateX(Math.PI / 2).translate(o, 0, 0.012);
  const gs = [bar.translate(0, 0, 0.028), post(-L * 0.4), post(L * 0.4)];
  for (const g of gs) {
    if (upright) g.rotateZ(Math.PI / 2);
    parts.push([g.translate(x, y, z), mat]);
  }
}

// The pipes under a sink: tail piece, the U of the trap, out into the wall.
function sinkTrap(it, x, y, z, mat) {
  it.add(tubeAlong([V(x, y, z), V(x, y - 0.18, z), V(x, y - 0.26, z - 0.03), V(x, y - 0.22, z - 0.09), V(x, y - 0.17, z - 0.11), V(x, y - 0.17, z - 0.3)], 0.018, 10), mat);
}

// A plate, a bowl or a mug left on a shelf.
function crockery(it, rnd, x, y, z, mat) {
  const k = rnd();
  if (k < 0.45) {
    const n = 1 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) it.add(latheY([[0, 0], [0.06, 0], [0.11, 0.014], [0.115, 0.018], [0.1, 0.012], [0, 0.006]], 18).translate(x, y + i * 0.012, z), mat);
  } else if (k < 0.75) it.add(latheY([[0, 0], [0.035, 0], [0.065, 0.04], [0.07, 0.06], [0.064, 0.058], [0.03, 0.006], [0, 0.006]], 16).translate(x, y, z), mat);
  else {
    it.add(latheY([[0, 0], [0.036, 0], [0.04, 0.09], [0.036, 0.09], [0.033, 0.006], [0, 0.006]], 14).translate(x, y, z), mat);
    it.add(new THREE.TorusGeometry(0.025, 0.006, 6, 10, Math.PI).rotateZ(-Math.PI / 2).translate(x + 0.04, y + 0.045, z), mat);
  }
}

// A run of kitchen units against a wall (back at z = -0.31): base cabinets with a drawer over a
// door, a counter with the sink let into it, wall cupboards over. Left as it was found: doors hang
// open or are gone, drawers pulled out.
export function kitchenRun(rnd, len = 2.4, { sink = true, stove = true, uppers = true } = {}) {
  const M = archMaterials();
  const it = new Item([len, uppers ? 2.2 : 0.95, 0.62]);
  const style = rnd();
  const cab = style < 0.4 ? M.veneer : style < 0.7 ? M.veneerDark : M.trimWhite;
  const carcass = M.woodDark;
  const top = [M.linoleum, M.linoleum, M.concrete, M.tiles][Math.floor(rnd() * 4)];
  const hw = rnd() < 0.6 ? M.chromeOld : M.trimDark;
  const pullKind = rnd() < 0.65 ? 'bar' : 'knob';
  const n = Math.max(2, Math.round(len / 0.6));
  const cw = len / n;
  let stoveAt = stove ? Math.floor(n * 0.75) : -1;
  if (stoveAt === 0) stoveAt = n - 1;
  const sinkAt = sink ? Math.floor(n * 0.3) : -1;
  const zF = 0.25; // carcass front
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + cw * (i + 0.5);
    if (i === stoveAt) {
      const st = stoveUnit(rnd, cw);
      for (const [g, m] of st.parts) it.add(g.translate(x, 0, -0.01), m);
      // a hood over it
      if (uppers) {
        it.rbox(cw, 0.12, 0.46, x, 1.62, -0.08, M.metalPainted, 0.01);
        const lip = roundedBox(cw, 0.08, 0.1, 0.01, 1);
        lip.rotateX(0.5);
        it.add(lip.translate(x, 1.54, 0.12), M.metalPainted);
        it.rbox(cw * 0.6, 0.006, 0.25, x, 1.558, -0.05, M.blackMatte, 0.002);
      }
      continue;
    }
    // the carcass: open box behind the fronts, a shelf inside, a recessed kick
    for (const sx of [-1, 1]) it.box(0.018, 0.78, 0.56, x + sx * (cw / 2 - 0.009), 0.49, -0.03, carcass);
    it.box(cw - 0.036, 0.018, 0.56, x, 0.109, -0.03, carcass);
    it.box(cw - 0.036, 0.76, 0.01, x, 0.49, -0.305, carcass);
    if (i !== sinkAt) it.box(cw - 0.04, 0.016, 0.5, x, 0.43, -0.04, carcass);
    else sinkTrap(it, x, 0.85, -0.02, M.chromeOld);
    it.box(cw, 0.1, 0.02, x, 0.05, zF - 0.06, M.trimDark);
    it.box(cw - 0.036, 0.045, 0.02, x, 0.84, zF - 0.01, carcass);
    // the drawer: in, pulled out, or gone
    const dr = rnd();
    if (dr > 0.05) {
      const out = dr < 0.2 ? 0.12 + rnd() * 0.22 : 0;
      const parts = front(cw - 0.012, 0.12, cab, { frame: false });
      pull(parts, pullKind, 0, 0, 0.02, hw);
      if (out > 0) {
        parts.push([new THREE.BoxGeometry(0.012, 0.09, 0.44).translate(-(cw - 0.08) / 2, -0.005, -0.22), carcass]);
        parts.push([new THREE.BoxGeometry(0.012, 0.09, 0.44).translate((cw - 0.08) / 2, -0.005, -0.22), carcass]);
        parts.push([new THREE.BoxGeometry(cw - 0.08, 0.008, 0.44).translate(0, -0.05, -0.22), carcass]);
        parts.push([new THREE.BoxGeometry(cw - 0.08, 0.09, 0.012).translate(0, -0.005, -0.44), carcass]);
      }
      moveParts(it, parts, new THREE.Matrix4().makeTranslation(x, 0.785, zF + out));
    }
    // the door below (two narrow ones under the sink)
    const leaves = i === sinkAt && cw > 0.5 ? 2 : 1;
    const lw = (cw - 0.012) / leaves;
    for (let l = 0; l < leaves; l++) {
      const d = rnd();
      if (d < 0.07) continue;
      const side = leaves === 2 ? (l === 0 ? -1 : 1) : rnd() < 0.5 ? -1 : 1;
      const lx = x - (cw - 0.012) / 2 + lw * (l + 0.5);
      const parts = front(lw - 0.006, 0.6, cab);
      pull(parts, pullKind, -side * (lw / 2 - 0.05), 0.22, 0.02, hw, true);
      const a = d < 0.3 ? 0.25 + rnd() * 1.4 : 0;
      moveParts(it, parts, swingY(lx, 0.42, zF, lw - 0.006, side, a));
    }
    if (i !== sinkAt) it.lootAt(x, 0.93, 0.05, 'kitchen');
    // wall cupboard over it
    if (uppers) {
      const y0 = 1.42,
        h = 0.7,
        zf = 0.0;
      for (const sx of [-1, 1]) it.box(0.018, h, 0.31, x + sx * (cw / 2 - 0.009), y0 + h / 2, -0.155, carcass);
      it.box(cw - 0.036, 0.018, 0.31, x, y0 + 0.009, -0.155, carcass);
      it.box(cw - 0.036, 0.018, 0.31, x, y0 + h - 0.009, -0.155, carcass);
      it.box(cw - 0.036, h, 0.01, x, y0 + h / 2, -0.305, carcass);
      it.box(cw - 0.04, 0.014, 0.28, x, y0 + 0.36, -0.16, carcass);
      const d = rnd();
      const open = d < 0.38;
      if (d > 0.08) {
        const side = rnd() < 0.5 ? -1 : 1;
        const parts = front(cw - 0.012, h - 0.012, cab);
        pull(parts, pullKind, -side * (cw / 2 - 0.05), -h / 2 + 0.08, 0.02, hw, true);
        let m4 = swingY(x, y0 + h / 2, zf, cw - 0.012, side, open ? 0.3 + rnd() * 1.3 : 0);
        // now and then one hangs off its bottom hinge
        if (open && rnd() < 0.2) {
          const px = x + (side * (cw - 0.012)) / 2,
            py = y0 + 0.04;
          m4 = new THREE.Matrix4().makeTranslation(px, py, zf).multiply(new THREE.Matrix4().makeRotationZ(side * (0.25 + rnd() * 0.2))).multiply(new THREE.Matrix4().makeTranslation(-px, -py, -zf)).multiply(m4);
        }
        moveParts(it, parts, m4);
      }
      // what was left on the shelves shows where the door is open or gone
      if (open || d <= 0.08)
        for (const sy of [y0 + 0.018, y0 + 0.367]) if (rnd() < 0.5) crockery(it, rnd, x + (rnd() - 0.5) * (cw - 0.2), sy, -0.16, rnd() < 0.7 ? M.porcelainOld : M.plastic);
      it.lootAt(x, 0.93, -0.2, 'cupboard');
    }
  }
  // the counter, cut round the sink, a steel edge on the older ones, a splash board at the back
  const shape = new THREE.Shape();
  shape.moveTo(-len / 2, -0.32);
  shape.lineTo(len / 2, -0.32);
  shape.lineTo(len / 2, 0.31);
  shape.lineTo(-len / 2, 0.31);
  shape.closePath();
  if (sinkAt >= 0) {
    const xs = -len / 2 + cw * (sinkAt + 0.5);
    const hole = new THREE.Path();
    const hw2 = Math.min(0.235, cw / 2 - 0.05),
      hd = 0.185;
    hole.moveTo(xs - hw2, -0.02 - hd);
    hole.lineTo(xs - hw2, -0.02 + hd);
    hole.lineTo(xs + hw2, -0.02 + hd);
    hole.lineTo(xs + hw2, -0.02 - hd);
    hole.closePath();
    shape.holes.push(hole);
    // the bowl (stainless or enamelled iron) under the cut, the plug hole, the taps and spout
    const bowlMat = rnd() < 0.5 ? M.chromeOld : M.porcelainOld;
    const sup = (a, b, y) => superSection(V(xs, y, 0.02), V(1, 0, 0), V(0, 0, 1), a, b, 6, 36);
    it.add(
      stack(
        [
          [hw2 + 0.022, hd + 0.022, 0.915],
          [hw2 + 0.018, hd + 0.018, 0.919],
          [hw2 + 0.004, hd + 0.004, 0.918],
          [hw2 - 0.006, hd - 0.006, 0.91],
          [hw2 - 0.01, hd - 0.01, 0.88],
          [hw2 - 0.014, hd - 0.014, 0.76],
          [hw2 - 0.035, hd - 0.035, 0.735],
          [hw2 - 0.09, hd - 0.09, 0.729],
          [0.02, 0.02, 0.727],
        ].map(([a, b, y]) => [a, b, y]),
        sup,
        [false, true]
      ),
      bowlMat
    );
    it.add(new THREE.CylinderGeometry(0.03, 0.03, 0.004, 16).translate(xs, 0.729, 0.02), M.blackMatte);
    it.rbox(0.22, 0.016, 0.06, xs, 0.923, -0.235, M.chromeOld, 0.006);
    for (const sx of [-1, 1]) tapHead(it, xs + sx * 0.08, 0.93, -0.235, M.chromeOld, sx < 0);
    it.add(tubeAlong([V(xs, 0.93, -0.235), V(xs, 1.08, -0.235), V(xs, 1.13, -0.17), V(xs, 1.1, -0.08), V(xs, 1.06, -0.06)], 0.009, 10), M.chromeOld);
  }
  it.add(slab(shape, 0.035, 0.88, 0.004), top);
  if (top !== M.tiles && rnd() < 0.5) it.rbox(len, 0.036, 0.006, 0, 0.8975, 0.313, M.chromeOld, 0.002);
  it.box(len, 0.1, 0.015, 0, 0.965, -0.305, top);
  it.col(len, 0.92, 0.62, 0, 0.46, 0);
  if (uppers) it.col(len, 0.7, 0.32, 0, 1.77, -0.15);
  return it;
}

// An electric range of the sixties: enamel body, coil rings on chrome drip pans, a back guard with
// the knobs and a clock, the oven door with its window and bar (sometimes dropped open).
export function stoveUnit(rnd, w = 0.6) {
  const M = archMaterials();
  const it = new Item([w, 1.12, 0.62]);
  const body = [M.applianceWhite, M.applianceWhite, M.applianceAlmond, M.applianceAvocado, M.applianceGold, M.applianceCopper][Math.floor(rnd() * 6)];
  // feet, body, the top a shade inset
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) it.add(new THREE.CylinderGeometry(0.015, 0.018, 0.05, 8).translate(sx * (w / 2 - 0.05), 0.025, sz * 0.24), M.trimDark);
  it.rbox(w - 0.01, 0.86, 0.6, 0, 0.48, -0.01, body, 0.012);
  it.box(w - 0.04, 0.006, 0.54, 0, 0.912, 0.0, body);
  // burners: a pan and a coil of two and a half turns each
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const bx = sx * w * 0.23,
        bz = sz * 0.13 + 0.01,
        r0 = sz > 0 ? 0.065 : 0.085;
      it.add(latheY([[0, 0], [r0 * 0.4, 0.0], [r0, 0.008], [r0 + 0.012, 0.012], [r0 + 0.014, 0.01]], 20).translate(bx, 0.905, bz), M.chromeOld);
      const pts = [];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12,
          a = t * Math.PI * 5;
        const r = 0.018 + t * (r0 - 0.025);
        pts.push(V(bx + Math.cos(a) * r, 0.926, bz + Math.sin(a) * r));
      }
      it.add(tubeAlong(pts, 0.0045, 4, { closedEnds: false }), M.blackMatte);
    }
  // back guard: knobs, a clock in a chrome ring
  it.rbox(w - 0.01, 0.2, 0.07, 0, 1.01, -0.275, body, 0.01);
  it.box(w - 0.06, 0.12, 0.004, 0, 1.0, -0.238, M.chromeOld);
  for (let k = 0; k < 4; k++) {
    const kx = (k < 2 ? -1 : 1) * (w * 0.2 + (k % 2) * w * 0.12);
    it.add(latheY([[0, 0], [0.018, 0], [0.019, 0.012], [0.014, 0.022], [0, 0.024]], 14).rotateX(Math.PI / 2).translate(kx, 1.0, -0.236), M.plasticDark);
  }
  it.add(new THREE.CylinderGeometry(0.04, 0.04, 0.008, 20).rotateX(Math.PI / 2).translate(0, 1.0, -0.232), M.trimWhite);
  it.add(new THREE.TorusGeometry(0.041, 0.005, 6, 24).translate(0, 1.0, -0.228), M.chromeOld);
  for (const a of [0.6, 2.3]) it.add(new THREE.BoxGeometry(0.003, 0.03, 0.002).translate(0, 0.014, 0).rotateZ(a).translate(0, 1.0, -0.226), M.blackMatte);
  // the oven: dark inside, its door on a bottom hinge
  it.box(w - 0.08, 0.44, 0.01, 0, 0.47, 0.285, M.blackMatte);
  const door = front(w - 0.03, 0.5, body, { frame: false, t: 0.03 });
  door.push([roundedBox(w * 0.56, 0.2, 0.006, 0.01, 1).translate(0, 0.04, 0.031), M.screen]);
  door.push([roundedBox(w * 0.6, 0.24, 0.004, 0.012, 1).translate(0, 0.04, 0.03), M.chromeOld]);
  pull(door, 'bar', 0, 0.2, 0.03, M.chromeOld);
  door.push([roundedBox(w - 0.14, 0.011, 0.011, 0.005, 1).translate(0, 0.2, 0.058), M.chromeOld]);
  moveParts(it, door, swingX(0, 0.47, 0.29, 0.5, rnd() < 0.25 ? 0.15 + rnd() * 0.9 : 0));
  // broiler drawer and kick
  const drawer = front(w - 0.03, 0.15, body, { frame: false });
  pull(drawer, 'bar', 0, 0.02, 0.02, M.chromeOld);
  moveParts(it, drawer, new THREE.Matrix4().makeTranslation(0, 0.13, 0.29));
  it.col(w, 0.92, 0.62, 0, 0.46, 0);
  return it;
}

// A fridge-freezer of the seventies: squared enamel cabinet, the small freezer door over the big
// one, long pulls down the side, a grille at the foot. Often the door was left open: the light
// gone, shelves and bins inside.
export function fridge(rnd) {
  const M = archMaterials();
  const W = 0.74,
    H = 1.66,
    D = 0.68;
  const it = new Item([W, H + 0.02, D + 0.04]);
  const body = [M.applianceWhite, M.applianceWhite, M.applianceAlmond, M.applianceAvocado, M.applianceGold][Math.floor(rnd() * 5)];
  const liner = M.plastic;
  const z0 = -D / 2 - 0.01,
    zf = D / 2 - 0.03; // back, cabinet front
  const yb = 0.06;
  // the shell: sides, top, bottom, back (lined), a divider under the freezer
  for (const sx of [-1, 1]) it.rbox(0.035, H - yb, D - 0.03, sx * (W / 2 - 0.0175), yb + (H - yb) / 2, (z0 + zf) / 2, body, 0.012);
  it.rbox(W, 0.04, D - 0.03, 0, H - 0.02, (z0 + zf) / 2, body, 0.012);
  it.rbox(W - 0.06, 0.05, D - 0.05, 0, yb + 0.06, (z0 + zf) / 2, liner, 0.006);
  it.box(W - 0.06, H - yb, 0.03, 0, yb + (H - yb) / 2, z0 + 0.015, body);
  it.box(W - 0.07, 0.006, D - 0.06, 0, H - 0.045, (z0 + zf) / 2, liner);
  for (const sx of [-1, 1]) it.box(0.004, H - yb - 0.1, D - 0.06, sx * (W / 2 - 0.037), yb + (H - yb) / 2, (z0 + zf) / 2, liner);
  it.box(W - 0.07, H - yb - 0.1, 0.004, 0, yb + (H - yb) / 2, z0 + 0.032, liner);
  const yDiv = H - 0.46;
  it.rbox(W - 0.06, 0.05, D - 0.05, 0, yDiv, (z0 + zf) / 2, liner, 0.008);
  // the grille at its foot
  it.box(W - 0.04, yb, 0.02, 0, yb / 2, zf - 0.03, M.blackMatte);
  for (let k = 0; k < 6; k++) it.box(W - 0.1, 0.004, 0.006, 0, 0.008 + k * 0.009, zf - 0.02, M.chromeOld);
  // inside: two wire shelves, crisper drawers, an egg tray in the freezer
  const shelves = [yb + 0.5, yb + 0.85];
  for (const y of shelves) {
    it.box(W - 0.08, 0.006, D - 0.1, 0, y, (z0 + zf) / 2 - 0.01, M.chromeOld);
    for (let k = 0; k < 8; k++) it.box(0.004, 0.004, D - 0.1, -W / 2 + 0.06 + k * ((W - 0.12) / 7), y + 0.004, (z0 + zf) / 2 - 0.01, M.chromeOld);
  }
  for (const sx of [-1, 1]) {
    it.rbox(W / 2 - 0.05, 0.2, D - 0.14, sx * (W / 4 - 0.005), yb + 0.2, (z0 + zf) / 2, M.glassDirty, 0.01);
    it.rbox(W / 2 - 0.05, 0.03, 0.01, sx * (W / 4 - 0.005), yb + 0.27, zf - 0.075, liner, 0.004);
  }
  it.box(W - 0.1, 0.006, D - 0.12, 0, yDiv + 0.18, (z0 + zf) / 2, M.chromeOld);
  // the doors: hinged on the right, the pulls on their left edges
  const open = rnd() < 0.35;
  const hingeSide = 1;
  const doors = [
    [yDiv + 0.025, H - 0.005, open && rnd() < 0.5],
    [yb + 0.005, yDiv - 0.025, open],
  ];
  for (const [ya, yb2, ajar] of doors) {
    const h = yb2 - ya;
    const parts = [[roundedBox(W - 0.004, h, 0.05, 0.015, 2).translate(0, 0, 0.025), body]];
    // the liner moulded inside the door, with bins
    parts.push([roundedBox(W - 0.1, h - 0.1, 0.03, 0.01, 1).translate(0, 0, -0.012), liner]);
    if (h > 0.6) for (let k = 0; k < 3; k++) parts.push([roundedBox(W - 0.14, 0.08, 0.08, 0.008, 1).translate(0, -h / 2 + 0.2 + k * 0.32, -0.06), liner]);
    // gasket all round the back
    parts.push([roundedBox(W - 0.03, h - 0.03, 0.012, 0.004, 1).translate(0, 0, -0.004), M.rubber]);
    // the pull down the edge it opens from, a badge on the big door
    parts.push([roundedBox(0.03, Math.min(0.32, h * 0.7), 0.03, 0.012, 2).translate(-W / 2 + 0.035, h > 0.6 ? h / 2 - 0.25 : -h / 2 + 0.2, 0.065), M.chromeOld]);
    if (h > 0.6) parts.push([roundedBox(0.12, 0.025, 0.004, 0.004, 1).translate(0.18, h / 2 - 0.12, 0.051), M.chromeOld]);
    moveParts(it, parts, swingY(0, (ya + yb2) / 2, zf, W - 0.004, hingeSide, ajar ? 0.4 + rnd() * 1.2 : 0));
  }
  if (open) {
    shelfCols(it, W, H, D, [yb + 0.08, ...shelves, yDiv, H - 0.02], { cz: (z0 + zf) / 2 });
    it.lootAt(-0.1, shelves[0] + 0.01, 0.0, 'fridge');
  } else {
    it.col(W, H, D, 0, H / 2, (z0 + zf) / 2 + 0.02);
    // the door stays shut; something was left on top
    it.lootAt(0, H + 0.01, 0.0, 'fridge');
  }
  return it;
}

// ------------------------------------------------------------------ bathroom
// A ring in plan shaped like a toilet bowl's: an ellipse a wide (x) and b long (z) round z = zc,
// narrowed towards the front (+z) by `egg`.
function eggRing(a, b, zc, y, egg = 0.14, n = 40) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    const z = Math.cos(t) * b;
    out.push(V(Math.sin(t) * a * (1 - egg * (z / b)), y, zc + z));
  }
  return out;
}

// The same outline as a flat shape (shape y = -z), for seats and lids.
function eggShape(a, b, zc, egg = 0.14, n = 40, hole = null) {
  const s = new THREE.Shape();
  const pts = eggRing(a, b, zc, 0, egg, n);
  pts.forEach((p, i) => (i ? s.lineTo(p.x, -p.z) : s.moveTo(p.x, -p.z)));
  s.closePath();
  if (hole) {
    const h = new THREE.Path();
    eggRing(...hole, 0, egg, n)
      .reverse()
      .forEach((p, i) => (i ? h.lineTo(p.x, -p.z) : h.moveTo(p.x, -p.z)));
    h.closePath();
    s.holes.push(h);
  }
  return s;
}

// A flat piece cut to a shape, t thick with rounded edges, lying with its underside at y.
function slab(shape, t, y, bevel = 0.006) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-4, t - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, bevel);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

// A body of revolution-like shape made of stacked rings: rows [a, b, zc, y] through `ring`.
const stack = (rows, ring, caps = [true, true]) => loftSections(rows.map((r) => ring(...r)), { capStart: caps[0], capEnd: caps[1] });

// Swing a geometry about a horizontal hinge line along x at (y, z).
const hingeX = (g, y, z, a) => g.translate(0, -y, -z).rotateX(a).translate(0, y, z);

// A cross-head tap: base, stem and four arms, a coloured button on top.
function tapHead(it, x, y, z, mat, hot) {
  it.add(latheY([[0, 0], [0.024, 0], [0.026, 0.006], [0.016, 0.014], [0.011, 0.04], [0.016, 0.046], [0, 0.05]], 14).translate(x, y, z), mat);
  for (let k = 0; k < 2; k++) {
    const arm = roundedBox(0.075, 0.012, 0.012, 0.005, 1);
    arm.rotateY(k * (Math.PI / 2) + 0.4);
    arm.translate(x, y + 0.046, z);
    it.add(arm, mat);
  }
  it.add(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 10).translate(x, y + 0.054, z), stdMat({ color: hot ? 0xa83a2a : 0x2a4f9a, roughness: 0.4 }));
}

export function toilet(rnd) {
  const M = archMaterials();
  const old = rnd() < 0.85;
  const china = old ? M.porcelainOld : M.porcelain;
  const chrome = old ? M.chromeOld : M.chrome;
  const it = new Item([0.42, 0.8, 0.7]);
  const zc = 0.09;
  // pedestal, flaring into the bowl, over the rim and down inside to the trap
  const bowl = stack(
    [
      [0.13, 0.18, 0.03, 0.0],
      [0.125, 0.175, 0.03, 0.012],
      [0.108, 0.16, 0.035, 0.06],
      [0.1, 0.155, 0.04, 0.15],
      [0.112, 0.17, 0.05, 0.23],
      [0.155, 0.215, 0.075, 0.31],
      [0.177, 0.24, 0.088, 0.36],
      [0.183, 0.247, zc, 0.384],
      [0.178, 0.243, zc, 0.396],
      [0.163, 0.228, zc, 0.399],
      [0.152, 0.215, zc, 0.391],
      [0.146, 0.205, zc + 0.005, 0.37],
      [0.125, 0.17, zc + 0.012, 0.32],
      [0.088, 0.115, zc + 0.02, 0.27],
      [0.062, 0.075, zc + 0.02, 0.235],
      [0.045, 0.05, zc + 0.015, 0.2],
    ],
    (a, b, z, y) => eggRing(a, b, z, y)
  );
  it.add(bowl, china);
  // what is left in it: brown water, or the ring it dried to
  const dry = rnd() < 0.5;
  const wl = dry ? 0.238 : 0.258;
  it.add(new THREE.ShapeGeometry(eggShape(dry ? 0.064 : 0.078, dry ? 0.078 : 0.098, zc + 0.02), 1).rotateX(-Math.PI / 2).translate(0, wl, 0), dry ? M.stain : M.waterMurky);
  // the back of the bowl the tank stands on, and the bolt caps at its foot
  it.rbox(0.27, 0.09, 0.2, 0, 0.35, -0.245, china, 0.03);
  for (const sx of [-1, 1]) it.add(new THREE.SphereGeometry(0.017, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1).translate(sx * 0.13, 0.0, 0.035), china);
  // tank and its lid (pushed askew in a house that was gone through)
  it.rbox(0.4, 0.36, 0.18, 0, 0.58, -0.255, china, 0.025);
  it.rbox(0.38, 0.01, 0.16, 0, 0.405, -0.255, china, 0.004);
  if (rnd() < 0.85) {
    const lid = roundedBox(0.43, 0.028, 0.205, 0.012, 2);
    const skew = rnd() < 0.3 ? 0.12 + rnd() * 0.15 : 0;
    lid.rotateY(skew);
    lid.translate(skew * 0.12, 0.774, -0.252 + skew * 0.05);
    it.add(lid, china);
  }
  // flush lever on the front left
  it.add(new THREE.CylinderGeometry(0.019, 0.021, 0.008, 16).rotateX(Math.PI / 2).translate(-0.135, 0.7, -0.162), chrome);
  const lever = roundedBox(0.075, 0.014, 0.012, 0.005, 1);
  lever.rotateZ(rnd() < 0.3 ? -0.5 : -0.05);
  lever.translate(-0.1, 0.698, -0.155);
  it.add(lever, chrome);
  // supply: out of the wall, a stop valve, up into the tank
  it.add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 14).rotateX(Math.PI / 2).translate(-0.13, 0.17, -0.344), chrome);
  it.add(tubeAlong([V(-0.13, 0.17, -0.344), V(-0.13, 0.17, -0.3), V(-0.13, 0.2, -0.285), V(-0.13, 0.4, -0.285)], 0.0055, 8), chrome);
  it.add(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 10).rotateX(Math.PI / 2).translate(-0.13, 0.17, -0.31), chrome);
  it.add(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 6).rotateZ(Math.PI / 2).translate(-0.105, 0.17, -0.31), chrome);
  // seat and lid on their hinges: either may be up, or gone
  const seatMat = old && rnd() < 0.35 ? M.woodDark : rnd() < 0.15 ? M.plasticDark : M.plastic;
  const hz = -0.142,
    hy = 0.42;
  const seat = rnd() < 0.88;
  if (seat) {
    const sg = slab(eggShape(0.183, 0.24, zc, 0.14, 40, [0.118, 0.155, zc + 0.012]), 0.022, 0.4, 0.008);
    if (rnd() < 0.2) hingeX(sg, hy, hz, -(Math.PI / 2 + 0.08));
    it.add(sg, seatMat);
    for (const sx of [-1, 1]) it.add(new THREE.CylinderGeometry(0.011, 0.011, 0.04, 10).rotateZ(Math.PI / 2).translate(sx * 0.075, 0.414, hz - 0.005), chrome);
  }
  if (seat && rnd() < 0.8) {
    const lg = slab(eggShape(0.178, 0.235, zc + 0.004), 0.018, 0.422, 0.007);
    if (rnd() < 0.55) hingeX(lg, hy + 0.005, hz, -(Math.PI / 2 + 0.07));
    it.add(lg, seatMat);
  }
  it.col(0.42, 0.42, 0.5, 0, 0.21, 0.08);
  it.col(0.42, 0.42, 0.2, 0, 0.58, -0.25);
  return it;
}

// A pedestal basin: the column, a basin with a deck at the back for its taps and a spout, the
// overflow and plug hole, and a mirror cabinet above it.
export function washbasin(rnd) {
  const M = archMaterials();
  const old = rnd() < 0.85;
  const china = old ? M.porcelainOld : M.porcelain;
  const chrome = old ? M.chromeOld : M.chrome;
  const it = new Item([0.56, 1.75, 0.45]);
  const sup = (a, b, z, y, n = 2.6) => superSection(V(0, y, z), V(1, 0, 0), V(0, 0, 1), a, b, n, 36);
  // the column
  it.add(
    stack(
      [
        [0.11, 0.09, -0.06, 0.0],
        [0.105, 0.087, -0.06, 0.015],
        [0.088, 0.072, -0.065, 0.08],
        [0.07, 0.06, -0.07, 0.42],
        [0.082, 0.066, -0.07, 0.6],
        [0.11, 0.08, -0.07, 0.68],
      ],
      sup
    ),
    china
  );
  // the basin: underside, rolled front rim, flat deck at the back, the bowl sunk into it
  it.add(
    stack(
      [
        [0.13, 0.09, -0.02, 0.665],
        [0.22, 0.16, -0.01, 0.7],
        [0.265, 0.195, 0.0, 0.76],
        [0.278, 0.205, 0.0, 0.81],
        [0.276, 0.203, 0.0, 0.832],
        [0.266, 0.194, 0.0, 0.84],
        [0.236, 0.15, 0.03, 0.838],
        [0.226, 0.138, 0.035, 0.828],
        [0.205, 0.118, 0.04, 0.8],
        [0.15, 0.085, 0.045, 0.76],
        [0.07, 0.045, 0.045, 0.738],
        [0.02, 0.015, 0.045, 0.733],
      ].map(([a, b, z, y]) => [a, b, z, y, 3]),
      sup
    ),
    china
  );
  it.add(new THREE.CylinderGeometry(0.018, 0.018, 0.003, 14).translate(0, 0.736, 0.045), M.blackMatte);
  it.add(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 10).rotateX(Math.PI / 2).translate(0, 0.815, 0.18), M.blackMatte);
  // taps either side of a spout
  for (const sx of [-1, 1]) tapHead(it, sx * 0.13, 0.838, -0.135, chrome, sx < 0);
  it.add(latheY([[0, 0], [0.016, 0], [0.015, 0.03], [0, 0.03]], 12).translate(0, 0.838, -0.14), chrome);
  it.add(tubeAlong([V(0, 0.86, -0.14), V(0, 0.9, -0.13), V(0, 0.905, -0.08), V(0, 0.885, -0.05)], 0.009, 10), chrome);
  // mirror cabinet: a box, its door a frame round the glass (spotted with age), a pull
  const cy = 1.45;
  const cab = M.trimWhite;
  it.rbox(0.5, 0.62, 0.12, 0, cy, -0.165, cab, 0.008);
  it.rbox(0.48, 0.6, 0.018, 0, cy, -0.096, cab, 0.006);
  it.rbox(0.42, 0.54, 0.004, 0, cy, -0.086, stdMat({ color: old ? 0x8d918a : 0xa4abac, metalness: 1, roughness: old ? 0.22 : 0.05 }), 0.002);
  it.rbox(0.012, 0.06, 0.012, 0.215, cy - 0.12, -0.082, chrome, 0.004);
  // a small glass shelf under it
  it.rbox(0.42, 0.008, 0.11, 0, cy - 0.38, -0.17, M.glass, 0.003);
  for (const sx of [-1, 1]) it.rbox(0.012, 0.02, 0.1, sx * 0.19, cy - 0.395, -0.17, chrome, 0.004);
  it.col(0.56, 0.86, 0.42, 0, 0.43, 0);
  it.lootAt(0.17, 0.85, -0.12, 'medicine');
  return it;
}

// A cast iron tub on claw feet, its tap end to the wall: rolled rim, the bath sunk inside, the
// enamel worn where the water stood.
export function bathtub(rnd) {
  const M = archMaterials();
  const old = rnd() < 0.85;
  const china = old ? M.porcelainOld : M.porcelain;
  const chrome = old ? M.chromeOld : M.chrome;
  const outside = [M.enamelBlack, china, M.metalGreen, M.metalRed][Math.floor(rnd() * 4)];
  const it = new Item([0.76, 0.75, 1.62]);
  const sup = (a, b, y, n) => superSection(V(0, y, 0), V(1, 0, 0), V(0, 0, 1), a, b, n, 40);
  // outside up to the roll
  it.add(
    stack(
      [
        [0.25, 0.6, 0.17, 2.2],
        [0.3, 0.68, 0.2, 2.4],
        [0.34, 0.735, 0.3, 2.6],
        [0.358, 0.76, 0.45, 2.7],
        [0.364, 0.77, 0.56, 2.8],
        [0.371, 0.778, 0.585, 2.8],
      ],
      sup,
      [true, false]
    ),
    outside
  );
  // the roll and the inside down to its floor
  it.add(
    stack(
      [
        [0.371, 0.778, 0.585, 2.8],
        [0.373, 0.78, 0.605, 2.8],
        [0.366, 0.773, 0.622, 2.8],
        [0.352, 0.759, 0.627, 2.8],
        [0.338, 0.745, 0.616, 2.8],
        [0.333, 0.74, 0.595, 2.8],
        [0.322, 0.72, 0.45, 2.7],
        [0.29, 0.67, 0.3, 2.6],
        [0.24, 0.6, 0.235, 2.4],
        [0.17, 0.52, 0.218, 2.3],
        [0.02, 0.38, 0.214, 2.2],
      ],
      sup,
      [false, true]
    ),
    china
  );
  // tide line and the drain at the tap end
  if (old) {
    const ring = stack(
      [
        [0.3, 0.686, 0.335, 2.6],
        [0.305, 0.695, 0.36, 2.65],
      ],
      sup,
      [false, false]
    );
    ring.scale(0.995, 1, 0.997);
    it.add(ring, M.stain);
  }
  it.add(new THREE.CylinderGeometry(0.03, 0.03, 0.004, 16).translate(0, 0.217, -0.56), M.chromeOld);
  // four cast claw feet: a haunch flared against the belly, narrowing to the ankle, the claws
  // closed round a ball on the floor
  const foot = outside === china ? M.metal : outside;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * 0.25,
        z = sz * 0.55;
      const bx = x * 1.14,
        bz = z * 1.06;
      it.add(tubeAlong([V(x, 0.26, z), V(x * 1.04, 0.18, z * 1.02), V(x * 1.1, 0.1, z * 1.045), V(bx, 0.055, bz)], 0.03, 8, { radiusFn: (t) => 0.022 + 0.05 * Math.pow(1 - t, 1.6) + 0.006 * Math.max(0, t - 0.8) * 5 }), foot);
      it.add(new THREE.SphereGeometry(0.028, 8, 6).translate(bx, 0.028, bz), foot);
      // three toes curled over the ball
      for (let k = -1; k <= 1; k++) {
        const a = Math.atan2(sx, sz) + k * 0.75;
        it.add(new THREE.SphereGeometry(0.011, 7, 5).scale(1, 0.75, 2.2).rotateX(0.5).rotateY(a).translate(bx + Math.sin(a) * 0.026, 0.024, bz + Math.cos(a) * 0.026), foot);
      }
    }
  // the taps on two risers over the rim at the wall end, a spout between them
  const tz = -0.73;
  for (const sx of [-1, 1]) {
    it.add(tubeAlong([V(sx * 0.1, 0.62, tz - 0.06), V(sx * 0.1, 0.7, tz - 0.06), V(sx * 0.1, 0.72, tz - 0.03), V(sx * 0.1, 0.72, tz)], 0.011, 10), chrome);
    tapHead(it, sx * 0.1, 0.72, tz + 0.012, chrome, sx < 0);
  }
  it.add(tubeAlong([V(-0.1, 0.715, tz), V(0.1, 0.715, tz)], 0.012, 10), chrome);
  it.add(tubeAlong([V(0, 0.715, tz), V(0, 0.72, tz + 0.05), V(0, 0.69, tz + 0.1)], 0.012, 10), chrome);
  // the plug on its chain hung over the rim
  it.add(tubeAlong([V(0.06, 0.63, tz + 0.02), V(0.07, 0.5, tz + 0.05), V(0.05, 0.35, tz + 0.1), V(0.03, 0.24, tz + 0.2)], 0.0025, 5), chrome);
  it.add(new THREE.CylinderGeometry(0.025, 0.022, 0.016, 14).translate(0.03, 0.225, tz + 0.21), M.rubber);
  it.col(0.76, 0.6, 1.58, 0, 0.32, 0);
  return it;
}

// ------------------------------------------------------------------ office / storage
// Loose sheets of paper dropped flat round (x, z) at height y.
function papers(it, rnd, n, x, y, z, spread) {
  const M = archMaterials();
  for (let k = 0; k < n; k++) {
    const g = new THREE.PlaneGeometry(0.21, 0.297);
    g.rotateX(-Math.PI / 2).rotateY(rnd() * 6.28);
    it.add(g.translate(x + (rnd() - 0.5) * spread, y + 0.001 + k * 0.0006, z + (rnd() - 0.5) * spread * 0.6), M.paper);
  }
}

// A cardboard box: taped shut, its flaps standing open, or squashed.
function cardboardBox(it, rnd, w, h, d, x, y, z, ry = 0) {
  const M = archMaterials();
  const parts = [];
  const st = rnd();
  const hh = st < 0.15 ? h * 0.7 : h;
  parts.push([roundedBox(w, hh, d, 0.004, 1).translate(0, hh / 2, 0), M.cardboard]);
  if (st < 0.15) parts[0][0].applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0.12, 0, 0, 0));
  else if (st < 0.45) {
    // flaps open: the long ones folded out, the short ones up
    for (const s of [-1, 1]) {
      parts.push([new THREE.BoxGeometry(w, 0.003, d / 2).translate(0, 0, s * (d / 4)).rotateX(s * (1.2 + rnd() * 1.4)).translate(0, hh, (s * d) / 2), M.cardboard]);
      parts.push([new THREE.BoxGeometry(w / 2 - 0.01, 0.003, d * 0.9).translate(s * (w / 4), 0, 0).rotateZ(-s * (1.4 + rnd() * 0.3)).translate((s * w) / 2, hh, 0), M.cardboard]);
    }
    parts.push([new THREE.BoxGeometry(w - 0.01, 0.002, d - 0.01).translate(0, 0.004, 0), M.blackMatte]);
  } else parts.push([new THREE.BoxGeometry(0.05, 0.002, d + 0.002).translate(0, hh + 0.001, 0), M.trimWhite]);
  moveParts(it, parts, new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
}

// A kneehole desk: drawers down one side (pulled out or gone), papers left on it, a lamp.
export function desk(rnd) {
  const M = archMaterials();
  const it = new Item([1.3, 0.78, 0.7]);
  const wood = rnd() < 0.5 ? M.veneer : M.veneerDark;
  it.rbox(1.3, 0.035, 0.7, 0, 0.76, 0, wood, 0.008);
  // pedestal of drawers on the right, a plain end on the left, the modesty panel
  for (const sx of [0.22, 0.62]) it.box(0.02, 0.74, 0.64, sx, 0.37, 0, wood);
  it.box(0.4, 0.74, 0.01, 0.42, 0.37, -0.315, wood);
  it.box(0.38, 0.02, 0.62, 0.42, 0.07, 0, wood);
  it.box(0.03, 0.74, 0.64, -0.62, 0.37, 0, wood);
  it.box(0.82, 0.45, 0.015, -0.2, 0.52, -0.3, wood);
  it.rbox(0.4, 0.06, 0.62, 0.42, 0.03, 0, M.trimDark, 0.004);
  for (let i = 0; i < 3; i++) {
    const y = 0.17 + i * 0.2;
    const st = rnd();
    if (st < 0.08) continue;
    const out = st < 0.3 ? 0.1 + rnd() * 0.25 : 0;
    const parts = front(0.38, 0.18, wood, { frame: false });
    pull(parts, 'bar', 0, 0.03, 0.02, M.chromeOld);
    if (out) {
      parts.push([new THREE.BoxGeometry(0.34, 0.008, 0.55).translate(0, -0.07, -0.275), wood]);
      for (const s of [-1, 1]) parts.push([new THREE.BoxGeometry(0.01, 0.13, 0.55).translate(s * 0.17, -0.01, -0.275), wood]);
      if (rnd() < 0.6) papers(it, rnd, 2, 0.42, y - 0.065, 0.32 + out - 0.2, 0.1);
    }
    moveParts(it, parts, new THREE.Matrix4().makeTranslation(0.42, y, 0.32 + out));
  }
  if (rnd() < 0.75) papers(it, rnd, 2 + Math.floor(rnd() * 6), -0.2, 0.778, 0.05, 0.6);
  if (rnd() < 0.4) {
    // a desk lamp on a bent arm
    it.add(latheY([[0, 0], [0.07, 0], [0.065, 0.02], [0.012, 0.03], [0, 0.03]], 16).translate(-0.45, 0.778, -0.2), M.metalGreen);
    it.add(tubeAlong([V(-0.45, 0.8, -0.2), V(-0.45, 1.05, -0.18), V(-0.4, 1.12, -0.08), V(-0.37, 1.1, 0.0)], 0.008, 6), M.chromeOld);
    it.add(latheY([[0.02, 0], [0.08, -0.1], [0.075, -0.1], [0.015, 0.0]], 16).rotateX(-0.4).translate(-0.37, 1.1, 0.0), M.metalGreen);
  }
  if (rnd() < 0.15) {
    // a typewriter, its roller and keys
    it.rbox(0.42, 0.1, 0.34, 0.25, 0.83, 0.0, M.metalGreen, 0.03);
    it.add(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 14).rotateZ(Math.PI / 2).translate(0.25, 0.9, -0.12), M.blackMatte);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 10; k++) it.add(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 8).translate(0.25 - 0.15 + k * 0.033 + r * 0.008, 0.882 - r * 0.012, 0.03 + r * 0.03), M.trimDark);
  }
  it.col(1.3, 0.78, 0.7, 0, 0.39, 0);
  it.lootAt(-0.2, 0.79, 0.05, 'desk');
  return it;
}

// A steel filing cabinet: four drawers with their pulls and card holders, one hanging open
// with the folders still in it.
export function filingCabinet(rnd) {
  const M = archMaterials();
  const it = new Item([0.46, 1.33, 0.64]);
  const steel = rnd() < 0.5 ? M.metalGreen : M.metalPainted;
  it.rbox(0.46, 1.3, 0.62, 0, 0.66, -0.01, steel, 0.01);
  const openAt = rnd() < 0.35 ? Math.floor(rnd() * 4) : -1;
  for (let i = 0; i < 4; i++) {
    const y = 0.18 + i * 0.31;
    const out = i === openAt ? 0.15 + rnd() * 0.3 : 0;
    const parts = [[roundedBox(0.42, 0.29, 0.02, 0.006, 1).translate(0, 0, 0.01), steel]];
    parts.push([roundedBox(0.13, 0.025, 0.03, 0.008, 1).translate(0, 0.05, 0.03), M.chromeOld]);
    parts.push([new THREE.BoxGeometry(0.09, 0.04, 0.004).translate(0, 0.1, 0.022), M.chromeOld]);
    parts.push([new THREE.BoxGeometry(0.08, 0.03, 0.002).translate(0, 0.1, 0.0245), M.paper]);
    if (out) {
      parts.push([new THREE.BoxGeometry(0.38, 0.008, 0.55).translate(0, -0.12, -0.275), steel]);
      for (const s of [-1, 1]) parts.push([new THREE.BoxGeometry(0.008, 0.24, 0.55).translate(s * 0.19, 0.0, -0.275), steel]);
      for (let k = 0; k < 8; k++) if (rnd() < 0.7) parts.push([new THREE.BoxGeometry(0.33, 0.22 + rnd() * 0.03, 0.006).rotateX((rnd() - 0.5) * 0.3).translate(0, -0.01, -0.05 - k * 0.055), stdMat({ color: 0xc9a86a, roughness: 0.9 })]);
    }
    moveParts(it, parts, new THREE.Matrix4().makeTranslation(0, y, 0.3 + out));
  }
  it.col(0.46, 1.31, 0.62, 0, 0.655, -0.01);
  it.lootAt(0, 1.32, 0, 'office');
  return it;
}

// Steel shelving: angle posts, boards with a turned-down lip, a cross brace; a few boxes and tins.
export function metalShelf(rnd, w = 1.2, h = 1.9, d = 0.45) {
  const M = archMaterials();
  const it = new Item([w, h, d]);
  const paint = rnd() < 0.5 ? M.metalPainted : M.metalGreen;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - 0.02),
        z = sz * (d / 2 - 0.02);
      it.box(0.035, h, 0.003, x, h / 2, z + sz * 0.0165, paint);
      it.box(0.003, h, 0.035, x + sx * 0.0165, h / 2, z, paint);
    }
  for (const s of [-1, 1]) it.add(tubeAlong([V(-w / 2 + 0.03, 0.12, -d / 2 + 0.01), V(w / 2 - 0.03, h - 0.1, -d / 2 + 0.01)].map((p) => (s < 0 ? V(-p.x, p.y, p.z) : p)), 0.005, 4), paint);
  const ys = [];
  for (let i = 0; i < 5; i++) {
    const y = 0.1 + (i * (h - 0.15)) / 4;
    ys.push(y);
    it.box(w - 0.01, 0.006, d - 0.01, 0, y, 0, paint);
    for (const s of [-1, 1]) it.box(w - 0.01, 0.03, 0.004, 0, y - 0.012, s * (d / 2 - 0.005), paint);
    if (i < 4 && rnd() < 0.5) it.lootAt(((i % 2) - 0.5) * w * 0.4, y + 0.01, 0, 'storage');
    // what is left on it: a box or two, a paint tin
    let x = -w / 2 + 0.08;
    while (x < w / 2 - 0.15) {
      if (rnd() < 0.6 || i === 4) {
        x += 0.18 + rnd() * 0.2;
        continue;
      }
      if (rnd() < 0.7) {
        const bw = 0.2 + rnd() * 0.18,
          bh = 0.14 + rnd() * 0.16;
        if (x + bw > w / 2 - 0.04) break;
        cardboardBox(it, rnd, bw, Math.min(bh, (h - 0.15) / 4 - 0.06), Math.min(d - 0.06, 0.26 + rnd() * 0.12), x + bw / 2, y + 0.003, (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.2);
        x += bw + 0.04;
      } else {
        paintTin(it, rnd, x + 0.08, y + 0.003, 0);
        x += 0.2;
      }
    }
  }
  shelfCols(it, w, h, d, ys, { back: false });
  return it;
}

// A paint tin: rolled rims, the lid, a wire bail, runs of dried paint down the side.
function paintTin(it, rnd, x, y, z) {
  const M = archMaterials();
  it.add(latheY([[0, 0], [0.078, 0], [0.081, 0.006], [0.079, 0.012], [0.079, 0.17], [0.082, 0.176], [0.079, 0.182], [0, 0.182]], 20).translate(x, y, z), M.chromeOld);
  const col = [0xb8382a, 0x2f5f8a, 0xe8e2d0, 0x3d6b3a, 0xd8b23a][Math.floor(rnd() * 5)];
  it.add(new THREE.CylinderGeometry(0.0795, 0.0795, 0.11, 20, 1, true).translate(x, y + 0.08, z), stdMat({ color: col, roughness: 0.7 }));
  it.add(tubeAlong([V(x - 0.08, y + 0.15, z), V(x - 0.05, y + 0.24, z + 0.02), V(x + 0.05, y + 0.24, z + 0.02), V(x + 0.08, y + 0.15, z)], 0.002, 4, { closedEnds: false }), M.chromeOld);
}

// A heavy workbench: a top of thick boards, legs and rails, a shelf of junk under it, the vice,
// a pegboard with the tools nobody took.
export function workbench(rnd) {
  const M = archMaterials();
  const it = new Item([2.0, 1.9, 0.75]);
  for (let k = 0; k < 4; k++) it.rbox(2.0, 0.055, 0.18, 0, 0.875, -0.27 + k * 0.183, M.woodDark, 0.006);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) it.rbox(0.08, 0.85, 0.08, sx * 0.92, 0.425, sz * 0.3, M.woodDark, 0.006);
  for (const sz of [-1, 1]) it.rbox(1.84, 0.08, 0.04, 0, 0.78, sz * 0.32, M.woodDark, 0.004);
  it.rbox(1.9, 0.025, 0.62, 0, 0.2, 0, M.planks, 0.004);
  for (let k = 0; k < 2; k++) if (rnd() < 0.7) cardboardBox(it, rnd, 0.35, 0.22, 0.3, -0.6 + k * 0.9 + rnd() * 0.2, 0.213, 0, (rnd() - 0.5) * 0.4);
  if (rnd() < 0.6) paintTin(it, rnd, 0.6, 0.213, 0.1);
  // pegboard on two battens
  it.box(2.0, 1.0, 0.012, 0, 1.45, -0.36, M.cardboard);
  for (let r = 0; r < 18; r++) for (let c = 0; c < 36; c++) if ((r + c) % 2 === 0) it.add(new THREE.CircleGeometry(0.004, 5).translate(-0.96 + c * 0.055, 0.98 + r * 0.055, -0.3535), M.blackMatte);
  // the vice on the front corner
  const vx = 0.75;
  it.rbox(0.14, 0.09, 0.2, vx, 0.95, 0.24, M.metalGreen, 0.012);
  it.rbox(0.16, 0.06, 0.03, vx, 0.99, 0.35, M.metalGreen, 0.006);
  it.rbox(0.16, 0.06, 0.03, vx, 0.99, 0.31, M.metalGreen, 0.006);
  it.add(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 8).rotateX(Math.PI / 2).translate(vx, 0.96, 0.42), M.chromeOld);
  it.add(new THREE.CylinderGeometry(0.006, 0.006, 0.18, 6).rotateZ(Math.PI / 2).translate(vx, 0.96, 0.5), M.chromeOld);
  // tools on hooks: a hammer, spanners, a saw, screwdrivers (some hooks empty)
  const hang = (x, kind) => {
    const y = 1.6;
    if (kind === 0) {
      it.add(new THREE.CylinderGeometry(0.012, 0.014, 0.3, 8).translate(x, y - 0.15, -0.34), M.wood);
      it.rbox(0.11, 0.03, 0.03, x, y - 0.0, -0.34, M.chromeOld, 0.005);
    } else if (kind === 1) {
      for (let k = 0; k < 3; k++) {
        const L = 0.16 + k * 0.04;
        it.rbox(0.016, L, 0.005, x + k * 0.04, y - L / 2, -0.345, M.chromeOld, 0.002);
        it.add(new THREE.TorusGeometry(0.014, 0.005, 6, 12).translate(x + k * 0.04, y - L, -0.345), M.chromeOld);
      }
    } else if (kind === 2) {
      it.add(new THREE.ShapeGeometry(shapeFromPoints([[0, 0], [0.06, 0], [0.06, -0.08], [0.0, -0.45], [-0.02, -0.45], [-0.02, 0]])).translate(x, y, -0.346), M.chromeOld);
      it.rbox(0.05, 0.11, 0.02, x + 0.03, y + 0.02, -0.344, M.wood, 0.01);
    } else {
      for (let k = 0; k < 4; k++) {
        it.add(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 6).translate(x + k * 0.03, y - 0.1, -0.343), M.chromeOld);
        it.add(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8).translate(x + k * 0.03, y, -0.343), [M.metalRed, M.metalGreen, M.vinylYellow][k % 3]);
      }
    }
  };
  for (let i = 0; i < 6; i++) if (rnd() < 0.6) hang(-0.8 + i * 0.3, Math.floor(rnd() * 4));
  if (rnd() < 0.5) papers(it, rnd, 1 + Math.floor(rnd() * 3), -0.3, 0.903, 0.05, 0.6);
  it.col(2.0, 0.9, 0.75, 0, 0.45, 0);
  it.lootAt(-0.4, 0.92, 0.05, 'tools');
  it.lootAt(0.3, 0.92, 0.05, 'tools');
  return it;
}

// A rolling tool chest: a red cabinet of drawers with steel pulls, on casters.
export function toolChest(rnd) {
  const M = archMaterials();
  const it = new Item([0.72, 1.05, 0.5]);
  const red = rnd() < 0.75 ? M.metalRed : M.metalGreen;
  it.rbox(0.72, 0.95, 0.48, 0, 0.56, 0, red, 0.012);
  const openAt = rnd() < 0.4 ? Math.floor(rnd() * 5) : -1;
  for (let i = 0; i < 5; i++) {
    const y = 0.2 + i * 0.17;
    const out = i === openAt ? 0.1 + rnd() * 0.2 : 0;
    const parts = [[roundedBox(0.68, 0.15, 0.02, 0.004, 1).translate(0, 0, 0.01), red]];
    parts.push([roundedBox(0.42, 0.016, 0.026, 0.004, 1).translate(0, 0.045, 0.027), M.chromeOld]);
    if (out) {
      parts.push([new THREE.BoxGeometry(0.64, 0.006, 0.42).translate(0, -0.06, -0.21), red]);
      for (const s of [-1, 1]) parts.push([new THREE.BoxGeometry(0.006, 0.12, 0.42).translate(s * 0.32, 0, -0.21), red]);
    }
    moveParts(it, parts, new THREE.Matrix4().makeTranslation(0, y, 0.235 + out));
  }
  for (const s of [-1, 1]) it.add(tubeAlong([V(s * 0.36, 0.8, -0.12), V(s * 0.4, 0.8, -0.1), V(s * 0.4, 0.8, 0.1), V(s * 0.36, 0.8, 0.12)], 0.01, 8), M.chromeOld);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      it.add(new THREE.CylinderGeometry(0.038, 0.038, 0.03, 12).rotateZ(Math.PI / 2).translate(sx * 0.3, 0.045, sz * 0.19), M.rubber);
      it.rbox(0.05, 0.03, 0.06, sx * 0.3, 0.09, sz * 0.19, M.chromeOld, 0.005);
    }
  it.col(0.72, 1.04, 0.5, 0, 0.52, 0);
  it.lootAt(0, 1.04, 0, 'tools');
  return it;
}

// A plank shelf on two steel brackets, its back to the wall (at z = -d/2).
export function wallShelf(rnd, w = 2.0, d = 0.32) {
  const M = archMaterials();
  const it = new Item([w, 0.26, d]);
  it.rbox(w, 0.035, d, 0, 0, 0, M.woodDark, 0.004);
  for (const sx of [-1, 1]) {
    it.rbox(0.03, 0.22, 0.03, sx * (w / 2 - 0.2), -0.12, -d / 2 + 0.03, M.metal, 0.004);
    it.rbox(0.03, 0.03, d - 0.05, sx * (w / 2 - 0.2), -0.03, 0.0, M.metal, 0.004);
  }
  // paint tins, a jar of screws, a box left along it
  for (let x = -w / 2 + 0.15; x < w / 2 - 0.2; x += 0.22 + rnd() * 0.3) {
    const r = rnd();
    if (r < 0.45) continue;
    if (r < 0.75) paintTin(it, rnd, x, 0.018, -0.04);
    else if (r < 0.85) it.add(latheY([[0, 0], [0.04, 0], [0.042, 0.1], [0.03, 0.12], [0.032, 0.14], [0, 0.14]], 14).translate(x, 0.018, -0.04), M.glassDirty);
    else cardboardBox(it, rnd, 0.2, 0.14, 0.18, x + 0.05, 0.018, -0.03, (rnd() - 0.5) * 0.3);
  }
  it.col(w, 0.035, d, 0, 0, 0);
  it.lootAt(-w * 0.28, 0.02, 0.04, 'storage');
  it.lootAt(w * 0.22, 0.02, 0.04, 'storage');
  return it;
}

// ------------------------------------------------------------------ shop
// Shop shelving picked bare: a pegboard spine, shelves with their price strips and a few torn
// tags, a board come down at one end. What is left on them is real (loot), and not much of it.
export function gondola(rnd, len = 2.4) {
  const M = archMaterials();
  const it = new Item([len, 1.5, 0.9]);
  it.rbox(len, 1.45, 0.06, 0, 0.75, 0, M.metalPainted, 0.006);
  it.rbox(len, 0.12, 0.9, 0, 0.06, 0, M.metalWhite, 0.01);
  for (const s of [-1, 1]) it.rbox(0.04, 1.5, 0.9, s * (len / 2 + 0.02), 0.75, 0, M.metalWhite, 0.008);
  it.rbox(len + 0.06, 0.05, 0.1, 0, 1.5, 0, M.metalWhite, 0.008);
  const fallen = rnd() < 0.25 ? [rnd() < 0.5 ? -1 : 1, 1 + Math.floor(rnd() * 3)] : null;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const y = 0.15 + i * 0.36;
      const down = fallen && fallen[0] === side && fallen[1] === i;
      const shelf = [[roundedBox(len - 0.04, 0.02, 0.38, 0.004, 1), M.metalWhite], [roundedBox(len - 0.04, 0.035, 0.008, 0.002, 1).translate(0, -0.005, 0.19), M.trimWhite]];
      // a few price tags still on the strip
      for (let k = 0; k < 6; k++) if (rnd() < 0.4) shelf.push([new THREE.PlaneGeometry(0.04, 0.022).translate(-len / 2 + 0.1 + rnd() * (len - 0.2), -0.005, 0.195), M.paper]);
      const m = new THREE.Matrix4().makeTranslation(0, y, side * 0.23);
      if (side < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      if (down) m.multiply(new THREE.Matrix4().makeTranslation(len / 2, 0, 0)).multiply(new THREE.Matrix4().makeRotationZ(-0.32)).multiply(new THREE.Matrix4().makeTranslation(-len / 2, -0.03, 0));
      moveParts(it, shelf, m);
      if (i > 0 && !down && rnd() < 0.35) it.lootAt((rnd() - 0.5) * len * 0.6, y + 0.02, side * 0.24, 'shop');
    }
  }
  // the floor round it: a torn-off flap of a box, paper
  if (rnd() < 0.6) papers(it, rnd, 1 + Math.floor(rnd() * 3), (rnd() - 0.5) * len, 0.0, (rnd() < 0.5 ? -1 : 1) * 0.65, 0.5);
  if (rnd() < 0.4) it.add(new THREE.BoxGeometry(0.4, 0.004, 0.3).rotateY(rnd() * 3).translate((rnd() - 0.5) * len, 0.002, (rnd() < 0.5 ? -1 : 1) * 0.7), M.cardboard);
  it.col(len, 0.12, 0.9, 0, 0.06, 0);
  it.col(len, 1.45, 0.06, 0, 0.75, 0);
  for (const s of [-1, 1]) it.col(0.04, 1.5, 0.9, s * (len / 2 + 0.02), 0.75, 0);
  for (const side of [-1, 1]) for (let i = 1; i < 4; i++) it.col(len - 0.04, 0.03, 0.38, 0, 0.15 + i * 0.36, side * 0.23);
  return it;
}

// A glass-door drinks fridge, dead: a hollow cabinet, the doors frames round their glass (one
// hanging open, one smashed), wire shelves with what little is left on them.
export function cooler(rnd, doors = 2) {
  const M = archMaterials();
  const w = doors * 0.75;
  const it = new Item([w, 2.0, 0.8]);
  it.rbox(w, 2.0, 0.04, 0, 1.0, -0.37, M.metalWhite, 0.01);
  for (const s of [-1, 1]) it.rbox(0.04, 2.0, 0.78, s * (w / 2 - 0.02), 1.0, 0, M.metalWhite, 0.01);
  it.rbox(w, 0.2, 0.78, 0, 1.9, 0, M.metalWhite, 0.01);
  it.rbox(w, 0.25, 0.78, 0, 0.125, 0, M.metalWhite, 0.01);
  for (let k = 0; k < 8; k++) it.box(w - 0.1, 0.006, 0.008, 0, 0.04 + k * 0.022, 0.392, M.blackMatte);
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + 0.375 + i * 0.75;
    const st = rnd();
    const smashed = st < 0.2;
    const parts = [];
    for (const s of [-1, 1]) parts.push([roundedBox(0.035, 1.6, 0.035, 0.006, 1).translate(s * 0.3225, 0, 0.0175), M.metal]);
    for (const y of [-0.785, 0.785]) parts.push([roundedBox(0.68, 0.035, 0.035, 0.006, 1).translate(0, y, 0.0175), M.metal]);
    if (!smashed) parts.push([new THREE.BoxGeometry(0.61, 1.535, 0.006).translate(0, 0, 0.0175), M.glass]);
    parts.push([roundedBox(0.022, 0.5, 0.03, 0.008, 1).translate(0.27, 0.05, 0.05), M.metal]);
    moveParts(it, parts, swingY(x, 1.0, 0.39, 0.68, -1, st > 0.8 ? 0.3 + rnd() * 1.1 : 0));
    if (smashed) {
      // glass on the floor in front of it
      for (let k = 0; k < 9; k++) {
        const g = new THREE.CircleGeometry(0.03 + rnd() * 0.06, 3).rotateX(-Math.PI / 2).rotateY(rnd() * 6);
        it.add(g.translate(x + (rnd() - 0.5) * 0.6, 0.004, 0.5 + rnd() * 0.4), M.glass);
      }
    }
    for (let s = 0; s < 4; s++) {
      it.box(0.62, 0.008, 0.6, x, 0.4 + s * 0.38, 0, M.chromeOld);
      for (let k = 0; k < 7; k++) it.box(0.004, 0.006, 0.6, x - 0.3 + k * 0.1, 0.405 + s * 0.38, 0, M.chromeOld);
      if (rnd() < 0.55) it.lootAt(x, 0.42 + s * 0.38, 0.1, 'drinks');
    }
  }
  // the header that once lit up
  it.rbox(w, 0.18, 0.04, 0, 1.88, 0.4, M.emissiveWarm, 0.01);
  shelfCols(it, w, 2.0, 0.78, [0.25, ...[0, 1, 2, 3].map((s) => 0.4 + s * 0.38), 1.8]);
  return it;
}

// The shop counter: panelled front, a laminate top with a steel edge, the till with its keys and
// drawer (sometimes left open, empty), a glass case at one end.
export function shopCounter(rnd) {
  const M = archMaterials();
  const it = new Item([2.2, 1.3, 0.7]);
  const wood = rnd() < 0.5 ? M.veneerDark : M.veneer;
  it.rbox(2.2, 0.92, 0.6, 0, 0.47, -0.02, wood, 0.008);
  for (let k = 0; k < 4; k++) moveParts(it, front(0.5, 0.7, wood), new THREE.Matrix4().makeTranslation(-0.81 + k * 0.54, 0.5, 0.28));
  it.rbox(2.2, 0.08, 0.02, 0, 0.04, 0.27, M.trimDark, 0.004);
  it.box(2.25, 0.035, 0.72, 0, 0.955, 0, M.linoleum);
  it.box(2.25, 0.037, 0.004, 0, 0.955, 0.362, M.chromeOld);
  // the till: body, sloped key bed, the display on its neck, the cash drawer
  const tx = 0.45;
  it.rbox(0.38, 0.12, 0.36, tx, 1.03, -0.02, M.metalPainted, 0.01);
  const bed = roundedBox(0.34, 0.03, 0.2, 0.008, 1);
  bed.rotateX(0.35);
  it.add(bed.translate(tx, 1.11, 0.04), M.metalPainted);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 7; k++) it.add(roundedBox(0.026, 0.012, 0.024, 0.003, 1).rotateX(0.35).translate(tx - 0.12 + k * 0.04, 1.13 + r * 0.012, 0.11 - r * 0.036), r === 0 && k > 4 ? M.metalRed : M.trimWhite);
  it.rbox(0.2, 0.08, 0.06, tx, 1.24, -0.12, M.plasticDark, 0.01);
  it.box(0.14, 0.035, 0.004, tx, 1.25, -0.088, stdMat({ color: 0x1d2a20, emissive: 0x0a140c, roughness: 0.3 }));
  it.add(new THREE.CylinderGeometry(0.02, 0.025, 0.08, 8).translate(tx, 1.15, -0.12), M.plasticDark);
  const drawerOut = rnd() < 0.4 ? 0.22 : 0;
  it.rbox(0.36, 0.08, 0.34, tx, 1.0, 0.0 + drawerOut, M.metalPainted, 0.006);
  if (drawerOut) for (let k = 0; k < 5; k++) it.box(0.005, 0.06, 0.3, tx - 0.14 + k * 0.07, 1.0, drawerOut, M.trimDark);
  // a spike of old receipts, the bell
  it.add(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 12).translate(-0.1, 0.978, 0.15), M.chromeOld);
  it.add(new THREE.CylinderGeometry(0.002, 0.002, 0.12, 4).translate(-0.1, 1.04, 0.15), M.chromeOld);
  for (let k = 0; k < 4; k++) it.add(new THREE.PlaneGeometry(0.06, 0.1).rotateX(-Math.PI / 2).rotateY(rnd() * 3).translate(-0.1, 0.99 + k * 0.008, 0.15), M.paper);
  if (rnd() < 0.5) it.add(latheY([[0, 0], [0.04, 0], [0.04, 0.008], [0.035, 0.03], [0.01, 0.045], [0.006, 0.06], [0, 0.06]], 16).translate(0.0, 0.973, 0.2), M.chromeOld);
  // glass case at the left end: frame, glass top and front, an empty shelf
  const gx = -0.75;
  it.box(0.6, 0.006, 0.5, gx, 1.27, 0.0, M.glass);
  it.box(0.6, 0.3, 0.006, gx, 1.12, 0.25, M.glass);
  for (const s of [-1, 1]) it.box(0.02, 0.32, 0.5, gx + s * 0.3, 1.12, 0.0, M.chromeOld);
  it.box(0.56, 0.006, 0.44, gx, 1.1, 0.0, M.metalWhite);
  it.col(2.2, 1.0, 0.7, 0, 0.5, 0);
  it.lootAt(-0.1, 0.99, 0.05, 'counter');
  return it;
}

// A diner booth: two buttoned vinyl benches either side of a laminate table on a pedestal.
export function boothSeat(rnd) {
  const M = archMaterials();
  const it = new Item([1.2, 1.1, 1.6]);
  const vinyl = [M.vinylRed, M.vinylTeal, M.vinylRed][Math.floor(rnd() * 3)];
  for (const s of [-1, 1]) {
    it.rbox(1.2, 0.3, 0.5, 0, 0.15, s * 0.55, M.trimDark, 0.01);
    it.add(cushion(1.18, 0.14, 0.48, { r: 0.04, puff: 0.02, sag: 0.01 }).translate(0, 0.37, s * 0.54), vinyl);
    const back = cushion(1.18, 0.55, 0.14, { r: 0.05, puff: 0.02 });
    // tufted: buttons in a grid
    for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) it.add(new THREE.SphereGeometry(0.008, 6, 4).translate(-0.42 + k * 0.28, 0.66 + r * 0.2, s * (0.74 - 0.075)), M.trimDark);
    it.add(back.translate(0, 0.76, s * 0.74), vinyl);
    it.rbox(1.22, 0.025, 0.03, 0, 1.05, s * 0.79, M.chromeOld, 0.008);
  }
  it.rbox(1.0, 0.035, 0.7, 0, 0.75, 0, rnd() < 0.5 ? M.linoleum : M.trimWhite, 0.008);
  it.rbox(1.006, 0.037, 0.706, 0, 0.75, 0, M.chromeOld, 0.004);
  it.add(latheY([[0, 0], [0.22, 0], [0.22, 0.015], [0.06, 0.03], [0.035, 0.06], [0.035, 0.7], [0.08, 0.72], [0, 0.73]], 20), M.chromeOld);
  for (const sg of [-1, 1]) {
    it.col(1.2, 0.45, 0.5, 0, 0.225, sg * 0.55);
    it.col(1.2, 0.6, 0.16, 0, 0.75, sg * 0.74);
  }
  it.col(1.0, 0.04, 0.7, 0, 0.75, 0);
  it.lootAt(0, 0.77, 0, 'table');
  return it;
}

// A diner stool: chrome pedestal on a domed foot, a padded vinyl seat with a chrome band.
export function stool(rnd) {
  const M = archMaterials();
  const it = new Item([0.4, 0.75, 0.4]);
  const vinyl = rnd() < 0.7 ? M.vinylRed : M.vinylTeal;
  it.add(latheY([[0, 0], [0.2, 0], [0.2, 0.012], [0.16, 0.03], [0.05, 0.06], [0.032, 0.08], [0.03, 0.62], [0.06, 0.64], [0.14, 0.655], [0.14, 0.665], [0, 0.665]], 22), M.chromeOld);
  it.add(cushion(0.36, 0.08, 0.36, { r: 0.04, puff: 0.02 }).translate(0, 0.7, 0), vinyl);
  it.add(new THREE.CylinderGeometry(0.183, 0.183, 0.04, 24, 1, true).translate(0, 0.685, 0), M.chromeOld);
  if (rnd() < 0.15) {
    // the seat torn, its foam showing
    it.add(new THREE.CircleGeometry(0.07, 7).rotateX(-Math.PI / 2).translate(0.04, 0.742, 0.02), stdMat({ color: 0xd8c27a, roughness: 1 }));
  }
  return it;
}

// ------------------------------------------------------------------ outdoor & clutter
// A 55-gallon drum: rolling hoops, the chime at each end, bung caps on the head; dented, the paint
// rusted through. Some stand open, full of rubbish and rainwater.
export function barrel(rnd) {
  const M = archMaterials();
  const it = new Item([0.6, 0.9, 0.6]);
  const mat = [M.drumRed, M.drumBlue, M.drumGreen, M.corrugatedRust][Math.floor(rnd() * 4)];
  const prof = [[0, 0.005], [0.27, 0.005], [0.285, 0.0], [0.29, 0.02], [0.285, 0.03], [0.285, 0.28], [0.295, 0.29], [0.295, 0.31], [0.285, 0.32], [0.285, 0.58], [0.295, 0.59], [0.295, 0.61], [0.285, 0.62], [0.285, 0.87], [0.29, 0.88], [0.285, 0.9]];
  const open = rnd() < 0.3;
  const body = latheY(open ? [...prof, [0.275, 0.9], [0.275, 0.05], [0, 0.05]] : [...prof, [0.27, 0.895], [0, 0.895]], 28);
  // dents: a couple of dished spots in the side
  const p = body.attributes.position;
  const dents = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => [rnd() * 6.28, 0.15 + rnd() * 0.6, 0.012 + rnd() * 0.025]);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i),
      y = p.getY(i);
    const r = Math.hypot(x, z);
    if (r < 0.2) continue;
    const a = Math.atan2(z, x);
    let k = 0;
    for (const [da, dy, depth] of dents) {
      const dd = Math.min(Math.abs(a - da), 6.283 - Math.abs(a - da));
      k += depth * Math.exp(-(dd * dd) / 0.08 - ((y - dy) * (y - dy)) / 0.01);
    }
    if (k) {
      p.setX(i, x * (1 - k / r));
      p.setZ(i, z * (1 - k / r));
    }
  }
  body.computeVertexNormals();
  it.add(body, mat);
  if (open) it.add(new THREE.CircleGeometry(0.27, 20).rotateX(-Math.PI / 2).translate(0, 0.55 + rnd() * 0.25, 0), M.waterMurky);
  else {
    it.add(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 10).translate(0.17, 0.9, 0), M.chromeOld);
    it.add(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 8).translate(-0.18, 0.9, 0.05), M.chromeOld);
  }
  it.col(0.58, 0.9, 0.58, 0, 0.45, 0);
  return it;
}

// A slatted crate: boards with gaps, corner posts, a lid nailed on (or prised off and leant on it).
export function crate(rnd, s = 0.6) {
  const M = archMaterials();
  const it = new Item([s, s, s]);
  const w = M.wood;
  const t = 0.018;
  const n = 4;
  const bh = (s - 0.02) / n - 0.012;
  for (let k = 0; k < n; k++) {
    const y = 0.012 + bh / 2 + k * (bh + 0.012);
    for (const zz of [-1, 1]) it.box(s, bh, t, 0, y, zz * (s / 2 - t / 2), w);
    for (const xx of [-1, 1]) it.box(t, bh, s - 2 * t, xx * (s / 2 - t / 2), y, 0, w);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) it.box(0.045, s, 0.045, sx * (s / 2 - 0.03), s / 2, sz * (s / 2 - 0.03), M.woodDark);
  it.box(s - 0.02, t, s - 0.02, 0, t / 2, 0, w);
  const lidOff = rnd() < 0.35;
  const lid = [];
  for (let k = 0; k < 4; k++) lid.push([new THREE.BoxGeometry(s / 4 - 0.01, t, s).translate(-s / 2 + s / 8 + (k * s) / 4, 0, 0), w]);
  lid.push([new THREE.BoxGeometry(s, t, 0.06).translate(0, t, -s * 0.3), M.woodDark]);
  lid.push([new THREE.BoxGeometry(s, t, 0.06).translate(0, t, s * 0.3), M.woodDark]);
  moveParts(it, lid, lidOff ? new THREE.Matrix4().makeTranslation(s * 0.62, s * 0.5, 0.02).multiply(new THREE.Matrix4().makeRotationZ(1.3)) : new THREE.Matrix4().makeTranslation(0, s - t / 2, 0));
  if (lidOff) it.add(new THREE.BoxGeometry(s - 0.06, 0.004, s - 0.06).translate(0, s * 0.35, 0), M.sandbag);
  it.col(s, s, s, 0, s / 2, 0);
  it.lootAt(0, s, 0, 'crate');
  return it;
}

// A stack of worn tyres (real model), one collider for the whole stack.
export function tirePile(rnd) {
  const it = new Item([0.8, 1.0, 0.8]);
  const n = 2 + Math.floor(rnd() * 4);
  const h = 0.168;
  for (let i = 0; i < n; i++) it.props.push({ id: 'tyre', pos: [(rnd() - 0.5) * 0.08, i * h, (rnd() - 0.5) * 0.08], rot: rnd() * 6.28, collide: false, ground: true });
  it.col(0.66, n * h, 0.66, 0, (n * h) / 2, 0);
  return it;
}

// A ceiling light: a canopy on the ceiling, a short stem, a frosted glass dome with dead flies.
export function ceilingLamp() {
  const M = archMaterials();
  const it = new Item([0.34, 0.22, 0.34]);
  it.add(latheY([[0, 0], [0.06, 0], [0.065, -0.012], [0.02, -0.022], [0, -0.022]], 18), M.metalWhite);
  it.add(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 8).translate(0, -0.05, 0), M.chromeOld);
  it.add(latheY([[0.04, -0.08], [0.15, -0.1], [0.17, -0.13], [0.16, -0.17], [0.1, -0.2], [0, -0.21], [0, -0.205], [0.095, -0.195], [0.155, -0.165], [0.165, -0.13], [0.145, -0.103], [0.04, -0.085]], 24), M.glassDirty);
  it.add(new THREE.SphereGeometry(0.04, 12, 8).translate(0, -0.13, 0), M.emissiveWarm);
  it.add(new THREE.CircleGeometry(0.06, 10).rotateX(-Math.PI / 2).translate(0, -0.2, 0), M.stain);
  return it;
}

export function curtain(w, h, mat) {
  const it = new Item([w, h, 0.05]);
  const g = new THREE.PlaneGeometry(w, h, Math.max(4, Math.round(w * 20)), 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i);
    p.setZ(i, Math.sin(x * 26) * 0.025);
    // the hem hangs ragged
    if (y < -h / 2 + 0.01) p.setY(i, y + Math.abs(Math.sin(x * 13.7) * Math.sin(x * 5.1)) * 0.12);
  }
  g.computeVertexNormals();
  g.translate(0, h / 2, 0);
  it.add(g, mat);
  return it;
}

export function pictureFrame(rnd) {
  const M = archMaterials();
  const it = new Item([0.5, 0.4, 0.03]);
  const w = 0.35 + rnd() * 0.3,
    h = 0.28 + rnd() * 0.2;
  it.rbox(w, h, 0.025, 0, 0, 0, M.woodDark, 0.005);
  // one of a few shared paintings (the random draw keeps the generator's sequence)
  const pick = Math.floor(rnd() * 6);
  const pg = new THREE.PlaneGeometry(w - 0.05, h - 0.05);
  pg.translate(0, 0, 0.0135);
  it.add(pg, M['painting' + pick]);
  return it;
}

export const FURNITURE = {
  bed,
  nightstand,
  wardrobe,
  dresser,
  sofa,
  armchair,
  coffeeTable,
  tvStand,
  bookshelf,
  diningTable,
  kitchenRun,
  stoveUnit,
  fridge,
  toilet,
  washbasin,
  bathtub,
  desk,
  filingCabinet,
  metalShelf,
  workbench,
  gondola,
  cooler,
  shopCounter,
  boothSeat,
  toolChest,
  wallShelf,
  stool,
  barrel,
  crate,
  tirePile,
};

// Place a furniture Item into a Builder at (x, y, z) rotated by rotY.
export function place(builder, item, x, y, z, rotY = 0) {
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
  for (const [g, mat] of item.parts) builder.add(g, mat, m);
  const q = new THREE.Vector3();
  for (const c of item.cols) {
    q.set(...c.c).applyMatrix4(m);
    builder.collider(q.x, q.y, q.z, c.h[0] * 2, c.h[1] * 2, c.h[2] * 2, rotY, 'wood');
  }
  for (const l of item.loot) {
    q.set(...l.pos).applyMatrix4(m);
    builder.loot.push({ pos: [q.x, q.y, q.z], kind: l.kind, rot: rotY });
  }
  for (const l of item.lights) {
    q.set(...l.pos).applyMatrix4(m);
    builder.lights.push({ ...l, pos: [q.x, q.y, q.z] });
  }
  for (const p of item.props) {
    q.set(...p.pos).applyMatrix4(m);
    const { id, pos, rot, ...opts } = p;
    void pos;
    builder.prop(id, q.x, q.y, q.z, (rot || 0) + rotY, opts);
  }
}

// A real model as a piece of furniture: `size` [w, h, d] is its footprint for room planning (the
// model itself is scaled to its real size when it loads); `loot` a spot on or in it.
export function propItem(id, size, { loot = null } = {}) {
  const it = new Item(size);
  it.props.push({ id, pos: [0, 0, 0], rot: 0 });
  if (loot) it.lootAt(...loot);
  return it;
}

export { Item, mulberry32, metreUV, cushion, toppled, partsOf, moveParts, papers, cardboardBox, paintTin };
