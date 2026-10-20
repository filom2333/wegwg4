// Non-residential structures and site props. Every builder returns { builder, footprint }
// in a local frame where +Z faces the road.

import * as THREE from 'three';
import { Builder } from './builder.js';
import { archMaterials, signMaterial, stdMat } from './materials.js';
import * as FUR from './furniture.js';
import { place } from './furniture.js';
import { latheY, tubeAlong, roundedBox, loftSections, superSection } from '../../gfx/geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ helpers
function room(b, x0, z0, x1, z1, y, h, { ext, inner, floor, t = 0.22, openings = {}, trim, roof = 'flat', roofMat, pitch = 0.3, rnd = Math.random, broken = 0.4, ceiling = true }) {
  const M = archMaterials();
  b.box((x0 + x1) / 2, y - 0.1, (z0 + z1) / 2, x1 - x0 + 0.2, 0.2, z1 - z0 + 0.2, M.concrete, { surface: 'concrete' });
  b.box((x0 + x1) / 2, y + 0.005, (z0 + z1) / 2, x1 - x0 - t, 0.01, z1 - z0 - t, floor, { collide: false });
  const walls = {
    front: [[x0, z1], [x1, z1]],
    back: [[x1, z0], [x0, z0]],
    left: [[x0, z0], [x0, z1]],
    right: [[x1, z1], [x1, z0]],
  };
  const infos = {};
  for (const [side, [a, c]] of Object.entries(walls)) {
    const ops = openings[side] || [];
    const info = b.wall(a, c, y, h, t, { outMat: ext, inMat: inner, openings: ops, outSide: 1 });
    infos[side] = info;
    for (const o of ops) {
      if (o.type === 'window') b.window(info, a, y, o, t, { frameMat: trim, glassMat: M.glassDirty, broken, sillMat: trim, rnd, mullions: o.mullions ?? 1 });
      else if (o.type === 'door') b.doorway(info, a, y, o, t, { frameMat: trim, leafMat: o.leafMat || M.metalPainted, leaf: !o.noLeaf, open: o.open ?? 0, hingeSide: o.hinge ?? 1 });
      else if (o.type === 'gap') b.doorway(info, a, y, o, t, { frameMat: trim, leaf: false });
    }
  }
  if (ceiling) b.box((x0 + x1) / 2, y + h + 0.03, (z0 + z1) / 2, x1 - x0 - t, 0.06, z1 - z0 - t, M.ceiling, { collide: false });
  if (roof === 'none') {
    // caller adds its own roof
  } else if (roof === 'flat') b.flatRoof(x0 - t / 2, z0 - t / 2, x1 + t / 2, z1 + t / 2, y + h + 0.06, { mat: roofMat || M.concrete, parapetMat: ext, parapet: 0.4 });
  else
    b.gableRoof(x0 - t / 2, z0 - t / 2, x1 + t / 2, z1 + t / 2, y + h + 0.06, pitch, {
      mat: roofMat || M.corrugated,
      fascia: trim,
      overhang: 0.35,
      ridgeAlong: x1 - x0 >= z1 - z0 ? 'x' : 'z',
      gableMat: ext,
    });
  b.collider((x0 + x1) / 2, y + h + 0.08, (z0 + z1) / 2, x1 - x0, 0.1, z1 - z0, 0, 'concrete');
  return infos;
}

function placeIt(b, item, x, y, z, rot = 0) {
  place(b, item, x, y, z, rot);
}

// Sign board on posts / wall
function signBoard(b, x, y, z, w, h, mat, rotY = 0, { posts = 0, postMat } = {}) {
  const g = new THREE.BoxGeometry(w, h, 0.08);
  const uv = g.attributes.uv,
    p = g.attributes.position,
    n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getZ(i)) > 0.5) uv.setXY(i, (p.getX(i) / w) * Math.sign(n.getZ(i)) + 0.5, p.getY(i) / h + 0.5);
    else uv.setXY(i, 0.01, 0.01);
  }
  g.rotateY(rotY);
  g.translate(x, y, z);
  b.add(g, mat);
  if (posts) {
    const M = archMaterials();
    for (const s of [-1, 1]) {
      const px = x + Math.cos(rotY) * s * w * 0.35,
        pz = z - Math.sin(rotY) * s * w * 0.35;
      b.box(px, (y - h / 2) / 2, pz, 0.12, y - h / 2, 0.12, postMat || M.metal, { surface: 'metal' });
    }
  }
}

// ------------------------------------------------------------------ garage / workshop
export function buildGarage(rnd, { w = 6.5, d = 7.5, open = true } = {}) {
  const M = archMaterials();
  const b = new Builder('garage');
  const x0 = -w / 2,
    x1 = w / 2,
    z0 = -d / 2,
    z1 = d / 2;
  const y = 0.1;
  const ext = rnd() < 0.5 ? M.corrugated : M.siding;
  room(b, x0, z0, x1, z1, y, 3.2, {
    ext,
    inner: M.planks,
    floor: M.concrete,
    trim: M.trimDark,
    roof: 'gable',
    roofMat: M.corrugatedRust,
    pitch: 0.28,
    rnd,
    ceiling: false,
    openings: {
      front: [{ at: w / 2, w: 3.2, bottom: 0, top: 2.75, type: 'gap' }],
      left: [{ at: d * 0.7, w: 0.9, bottom: 0, top: 2.05, type: 'door', leafMat: M.planks }],
      right: [{ at: d * 0.5, w: 1.2, bottom: 1.0, top: 2.0, type: 'window' }],
    },
  });
  // roll-up door drum + partially raised door
  b.box(0, y + 2.95, z1 - 0.25, 3.4, 0.35, 0.35, M.metalPainted, { collide: false });
  if (!open) b.box(0, y + 1.4, z1 - 0.15, 3.2, 2.7, 0.05, M.corrugated, {});
  else b.box(0, y + 2.55, z1 - 0.15, 3.2, 0.4, 0.05, M.corrugated, { collide: false });
  // interior: workbench along the back, shelving, tyres, barrels, oil stain
  placeIt(b, FUR.workbench(rnd), x0 + 1.4, y, z0 + 0.5, 0);
  placeIt(b, FUR.metalShelf(rnd, 1.2, 1.9, 0.45), x1 - 0.4, y, z0 + 1.1, -Math.PI / 2);
  placeIt(b, FUR.metalShelf(rnd, 1.2, 1.9, 0.45), x1 - 0.4, y, z0 + 2.5, -Math.PI / 2);
  placeIt(b, FUR.tirePile(rnd), x0 + 0.6, y, z1 - 1.2, 0);
  placeIt(b, FUR.barrel(rnd), x1 - 0.5, y, z1 - 0.8, 0);
  // light bulb
  b.lights.push({ pos: [0, y + 2.9, 0], color: 0xffe2b0, intensity: 0, distance: 9, fixture: true });
  const stain = new THREE.CircleGeometry(0.9, 24);
  stain.rotateX(-Math.PI / 2);
  stain.translate(0.2, y + 0.012, 0.3);
  b.add(stain, M.blackMatte);
  b.carSpot = { x: 0, z: 0.4, rot: 0 };
  return { builder: b, footprint: { w: w + 1, d: d + 1 } };
}

// ------------------------------------------------------------------ fuel pump & gas station
function fuelPump(b, x, y, z, rot, brand) {
  const M = archMaterials();
  const it = new FUR.Item([0.8, 1.9, 0.5]);
  it.rbox(0.8, 0.1, 0.5, 0, 0.05, 0, M.metalPainted, 0.01);
  it.rbox(0.66, 1.5, 0.42, 0, 0.85, 0, M.metalWhite, 0.03);
  it.rbox(0.68, 0.32, 0.44, 0, 1.75, 0, brand, 0.04);
  for (const s of [-1, 1]) {
    it.rbox(0.42, 0.34, 0.01, 0, 1.25, s * 0.215, M.screen, 0.01);
    it.rbox(0.16, 0.1, 0.02, 0.18, 1.62, s * 0.22, M.emissiveWarm, 0.005);
    // nozzle holster + nozzle
    it.rbox(0.08, 0.18, 0.06, -0.27, 0.95, s * 0.24, M.plasticDark, 0.01);
    it.rbox(0.05, 0.2, 0.04, -0.27, 1.0, s * 0.28, M.blackMatte, 0.01);
    it.add(tubeAlong([V(-0.27, 0.9, s * 0.28), V(-0.33, 0.6, s * 0.36), V(-0.3, 0.3, s * 0.3), V(-0.2, 0.6, s * 0.21)], 0.015, 6), M.rubber);
  }
  it.col(0.8, 1.9, 0.5, 0, 0.95, 0);
  place(b, it, x, y, z, rot);
  b.pumps = b.pumps || [];
  b.pumps.push({ pos: [x, y + 1.0, z] });
}

export function buildGasStation(rnd) {
  const M = archMaterials();
  const b = new Builder('gasstation');
  const brands = [
    ['MERIDIAN', '#b8322a'],
    ['DUSTLINE', '#2c5d8a'],
    ['SUNFUEL', '#d58b1d'],
    ['NOMAD OIL', '#3c6e3a'],
  ];
  const [brandName, brandCol] = brands[Math.floor(rnd() * brands.length)];
  const brand = stdMat({ color: brandCol, roughness: 0.55, metalness: 0.2 });
  // forecourt
  b.box(0, 0.05, 2, 26, 0.1, 20, M.concrete, { surface: 'concrete' });
  // canopy
  const cz = 6.5;
  const ch = 4.6;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.box(sx * 3.6, ch / 2 + 0.1, cz + sz * 2.4, 0.35, ch, 0.35, M.metalWhite, { surface: 'metal' });
  b.box(0, ch + 0.25, cz, 12, 0.5, 8, M.metalWhite, { surface: 'metal' });
  b.box(0, ch + 0.25, cz + 4.01, 12.02, 0.42, 0.02, brand, { collide: false });
  b.box(0, ch + 0.25, cz - 4.01, 12.02, 0.42, 0.02, brand, { collide: false });
  b.box(-6.01, ch + 0.25, cz, 0.02, 0.42, 8, brand, { collide: false });
  b.box(6.01, ch + 0.25, cz, 0.02, 0.42, 8, brand, { collide: false });
  // canopy light panels
  for (const sx of [-2, 0, 2])
    for (const sz of [-1.5, 1.5]) {
      b.box(sx * 1.8, ch - 0.01, cz + sz, 1.2, 0.04, 0.6, M.emissiveWarm, { collide: false });
    }
  b.lights.push({ pos: [-2.5, ch - 0.3, cz], color: 0xfff2dd, intensity: 0, distance: 18, fixture: true, powered: true });
  b.lights.push({ pos: [2.5, ch - 0.3, cz], color: 0xfff2dd, intensity: 0, distance: 18, fixture: true, powered: true });
  // pump islands
  for (const sx of [-1, 1]) {
    b.box(sx * 3.6, 0.2, cz, 1.2, 0.2, 5.8, M.concrete, { surface: 'concrete' });
    for (const s2 of [-1.3, 1.3]) fuelPump(b, sx * 3.6, 0.3, cz + s2, Math.PI / 2, brand);
    // bollards
    for (const s2 of [-2.8, 2.8]) {
      const g = new THREE.CylinderGeometry(0.1, 0.1, 0.9, 12);
      g.translate(sx * 3.6, 0.75, cz + s2);
      b.add(g, M.sidingYellow || brand);
      b.collider(sx * 3.6, 0.75, cz + s2, 0.2, 0.9, 0.2);
    }
  }
  // shop
  const sx0 = -6,
    sx1 = 6,
    sz0 = -8.5,
    sz1 = -1.5;
  const sy = 0.12;
  room(b, sx0, sz0, sx1, sz1, sy, 3.4, {
    ext: rnd() < 0.5 ? M.stucco : M.brick,
    inner: M.plaster,
    floor: M.linoleum,
    trim: M.metal,
    rnd,
    broken: 0.45,
    openings: {
      front: [
        { at: 3.0, w: 4.4, bottom: 0.6, top: 2.7, type: 'window', mullions: 2 },
        { at: 6.4, w: 1.2, bottom: 0, top: 2.2, type: 'door', leafMat: M.metal, open: rnd() < 0.5 ? 0.6 : 0 },
        { at: 9.4, w: 3.6, bottom: 0.6, top: 2.7, type: 'window', mullions: 2 },
      ],
      back: [{ at: 10.2, w: 0.9, bottom: 0, top: 2.05, type: 'door' }],
      right: [{ at: 2.0, w: 0.6, bottom: 1.6, top: 2.1, type: 'window' }],
    },
  });
  // brand fascia on shop
  signBoard(b, 0, sy + 3.75, sz1 + 0.18, 7.5, 0.7, signMaterial([brandName + '  ·  FOOD  ·  DRINKS'], { w: 1024, h: 96, bg: brandCol, fg: '#f3efe6', border: null, worn: 0.4 }));
  // interior
  placeIt(b, FUR.shopCounter(rnd), -3.5, sy, sz1 - 1.6, Math.PI);
  placeIt(b, FUR.gondola(rnd, 2.6), 1.5, sy, -4.6, 0);
  placeIt(b, FUR.gondola(rnd, 2.6), 1.5, sy, -6.4, 0);
  placeIt(b, FUR.cooler(rnd, 3), 3.4, sy, sz0 + 0.5, 0);
  placeIt(b, FUR.metalShelf(rnd, 1.4, 1.9, 0.45), -5.5, sy, -5.5, Math.PI / 2);
  // restroom partition
  b.wall([-2.2, sz0 + 0.1], [-2.2, sz0 + 2.4], sy, 2.4, 0.1, { outMat: M.tiles, inMat: M.tiles, outSide: null, openings: [{ at: 1.6, w: 0.8, bottom: 0, top: 2.0, type: 'door' }] });
  b.wall([-5.9, sz0 + 2.4], [-2.2, sz0 + 2.4], sy, 2.4, 0.1, { outMat: M.plaster, inMat: M.tiles, outSide: null });
  placeIt(b, FUR.toilet(rnd), -5.3, sy, sz0 + 0.5, 0);
  placeIt(b, FUR.washbasin(rnd), -3.2, sy, sz0 + 0.4, 0);
  b.lights.push({ pos: [0, sy + 3.2, -5], color: 0xf0f4ff, intensity: 0, distance: 10, fixture: true });
  // price sign on a pole
  const px = 11,
    pz = 9;
  b.box(px, 3.5, pz, 0.3, 7, 0.3, M.metal, { surface: 'metal' });
  const prices = ['REGULAR  3.89', 'PREMIUM  4.29', 'DIESEL   4.09'];
  // boards are bolted to the road side of the pole, not threaded through it
  signBoard(b, px, 6.8, pz + 0.2, 2.6, 1.0, signMaterial([brandName], { w: 512, h: 196, bg: brandCol, fg: '#f3efe6', border: null }), 0);
  signBoard(b, px, 5.6, pz + 0.2, 2.4, 1.3, signMaterial(prices, { w: 512, h: 280, bg: '#efe8d8', fg: '#1a1a1a', font: 'Courier New', worn: 0.5 }), 0);
  for (const y of [6.8, 5.6]) b.box(px, y, pz + 0.12, 0.5, 0.12, 0.1, M.metal, { collide: false }); // brackets
  // air/water stand, dumpster, propane cage
  b.box(-10, 0.7, 4, 0.5, 1.4, 0.4, M.metalRed, { surface: 'metal' });
  b.box(9.5, 0.75, -6, 2.0, 1.5, 1.2, M.metalGreen, { surface: 'metal' });
  b.box(9.5, 1.55, -6, 2.05, 0.08, 1.25, M.metalGreen, { collide: false });
  placeIt(b, FUR.barrel(rnd), -9.5, 0.1, -7, 0);
  placeIt(b, FUR.tirePile(rnd), -10.5, 0.1, -5.5, 0);
  // underground tank fill caps
  for (const x of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.25, 0.25, 0.04, 16);
    g.translate(x * 1.2, 0.11, 10.5);
    b.add(g, M.metal);
  }
  b.fuelReserve = 60 + rnd() * 240; // litres left in the underground tanks
  return { builder: b, footprint: { w: 26, d: 20 } };
}

// ------------------------------------------------------------------ motel
export function buildMotel(rnd) {
  const M = archMaterials();
  const b = new Builder('motel');
  const n = 5 + Math.floor(rnd() * 3);
  const rw = 4.2,
    rd = 6.5;
  const total = n * rw;
  const x0 = -total / 2;
  const y = 0.15;
  const ext = [M.stuccoPink, M.stucco, M.stuccoBlue][Math.floor(rnd() * 3)];
  for (let i = 0; i < n; i++) {
    const a = x0 + i * rw,
      c = a + rw;
    const infos = room(b, a, -rd / 2, c, rd / 2, y, 2.7, {
      ext,
      inner: rnd() < 0.5 ? M.wallpaper : M.plaster,
      floor: rnd() < 0.5 ? M.fabricBrown : M.floorboards,
      trim: M.trimWhite,
      rnd,
      broken: 0.5,
      ceiling: true,
      roof: 'none',
      openings: {
        front: [
          { at: 1.0, w: 0.95, bottom: 0, top: 2.1, type: 'door', leafMat: M.metalPainted, open: rnd() < 0.4 ? 0.8 : 0 },
          { at: 2.9, w: 1.4, bottom: 0.9, top: 2.1, type: 'window' },
        ],
        back: [{ at: 1.2, w: 0.6, bottom: 1.6, top: 2.1, type: 'window' }],
      },
    });
    void infos;
    // room interior
    placeIt(b, FUR.bed(rnd, { double: true }), a + rw / 2 + 0.3, y, -rd / 2 + 1.2, 0);
    placeIt(b, FUR.nightstand(rnd), a + rw / 2 + 0.3 + 1.1, y, -rd / 2 + 0.35, 0);
    placeIt(b, FUR.tvStand(rnd), a + rw / 2 + 0.3, y, rd / 2 - 1.2, Math.PI);
    // bathroom partition at the back-left corner
    b.wall([a + 1.6, -rd / 2 + 0.12], [a + 1.6, -rd / 2 + 2.0], y, 2.4, 0.1, { outMat: M.plaster, inMat: M.tiles, outSide: null });
    b.wall([a + 0.12, -rd / 2 + 2.0], [a + 1.6, -rd / 2 + 2.0], y, 2.4, 0.1, { outMat: M.tiles, inMat: M.plaster, outSide: null, openings: [{ at: 0.8, w: 0.75, bottom: 0, top: 2.0, type: 'door' }] });
    placeIt(b, FUR.toilet(rnd), a + 0.5, y, -rd / 2 + 0.5, 0);
    // room number plate
    signBoard(b, a + 1.6, y + 2.25, rd / 2 + 0.13, 0.32, 0.22, signMaterial([String(101 + i)], { w: 128, h: 96, bg: '#2a2a2a', fg: '#d9c9a0', border: null }));
  }
  // continuous roof with an overhang over the walkway
  b.gableRoof(x0 - 0.12, -rd / 2 - 0.12, x0 + total + 0.12, rd / 2 + 2.2, y + 2.76, 0.22, { mat: M.rooftiles, fascia: M.trimWhite, overhang: 0.4, ridgeAlong: 'x', gableMat: ext });
  // walkway slab + posts
  b.box(0, y - 0.05, rd / 2 + 1.1, total, 0.2, 2.2, M.concrete, { surface: 'concrete' });
  for (let i = 0; i <= n; i++) b.box(x0 + i * rw, y + 1.35, rd / 2 + 2.0, 0.16, 2.7, 0.16, M.trimWhite, { surface: 'wood' });
  // office at the left end
  const ox1 = x0 - 0.2,
    ox0 = ox1 - 5;
  room(b, ox0, -rd / 2, ox1, rd / 2 - 1, y, 2.8, {
    ext,
    inner: M.plaster,
    floor: M.linoleum,
    trim: M.trimWhite,
    rnd,
    roof: 'flat',
    openings: { front: [{ at: 1.3, w: 1.0, bottom: 0, top: 2.1, type: 'door', leafMat: M.metal }, { at: 3.4, w: 2.0, bottom: 0.8, top: 2.2, type: 'window' }] },
  });
  placeIt(b, FUR.shopCounter(rnd), ox0 + 2.5, y, -0.6, Math.PI);
  placeIt(b, FUR.filingCabinet(rnd), ox0 + 0.5, y, -rd / 2 + 0.5, 0);
  placeIt(b, FUR.desk(rnd), ox1 - 1.0, y, -rd / 2 + 0.6, 0);
  // tall sign
  b.box(ox0 - 2, 3.8, rd / 2 + 4, 0.25, 7.6, 0.25, M.metal, { surface: 'metal' });
  signBoard(b, ox0 - 2, 6.6, rd / 2 + 4.2, 3.4, 1.4, signMaterial([{ text: 'MOTEL', size: 120 }, { text: 'VACANCY', size: 50 }], { bg: '#203a4a', fg: '#e8c25a', border: '#e8c25a' }), 0);
  b.box(ox0 - 2, 6.6, rd / 2 + 4.13, 0.5, 0.12, 0.08, M.metal, { collide: false }); // bracket
  return { builder: b, footprint: { w: total + 14, d: rd + 7 } };
}

// ------------------------------------------------------------------ diner
export function buildDiner(rnd) {
  const M = archMaterials();
  const b = new Builder('diner');
  const y = 0.15;
  const x0 = -7,
    x1 = 7,
    z0 = -5,
    z1 = 4;
  room(b, x0, z0, x1, z1, y, 3.0, {
    ext: rnd() < 0.5 ? M.metalWhite : M.stuccoBlue,
    inner: M.plaster,
    floor: M.linoleum,
    trim: M.metal,
    rnd,
    broken: 0.5,
    openings: {
      front: [
        { at: 2.5, w: 3.6, bottom: 0.9, top: 2.4, type: 'window', mullions: 2 },
        { at: 6.0, w: 1.1, bottom: 0, top: 2.2, type: 'door', leafMat: M.metal, open: 0.5 },
        { at: 9.6, w: 3.6, bottom: 0.9, top: 2.4, type: 'window', mullions: 2 },
        { at: 12.6, w: 1.6, bottom: 0.9, top: 2.4, type: 'window' },
      ],
      left: [{ at: 4.0, w: 2.4, bottom: 0.9, top: 2.4, type: 'window', mullions: 1 }],
      back: [{ at: 3.0, w: 0.9, bottom: 0, top: 2.05, type: 'door' }],
    },
  });
  // booths along the front windows
  for (const x of [-4.5, 2.6, 5.4]) placeIt(b, FUR.boothSeat(rnd), x, y, z1 - 1.0, Math.PI / 2);
  // counter + stools
  b.box(-0.5, y + 0.52, -1.0, 7.5, 1.04, 0.6, M.metalWhite, { surface: 'metal' });
  b.box(-0.5, y + 1.06, -1.0, 7.7, 0.05, 0.75, M.linoleum, { collide: false });
  for (let i = 0; i < 7; i++) placeIt(b, FUR.stool(rnd), -4 + i * 1.05, y, -0.2, 0);
  for (let i = 0; i < 3; i++) b.loot.push({ pos: [-3 + i * 2.2, y + 1.09, -1.0], kind: 'counter' });
  // kitchen behind
  placeIt(b, FUR.kitchenRun(rnd, 4.2, { sink: true, stove: true, uppers: false }), -1.5, y, z0 + 0.45, 0);
  placeIt(b, FUR.fridge(rnd), 3.2, y, z0 + 0.5, 0);
  placeIt(b, FUR.metalShelf(rnd, 1.2, 1.9, 0.45), 5.2, y, z0 + 0.4, 0);
  b.lights.push({ pos: [0, y + 2.8, 1], color: 0xfff0d0, intensity: 0, distance: 12, fixture: true });
  // roof sign
  // stands on two posts above the parapet (top of the parapet is ~3.6 m above the floor)
  signBoard(b, 0, y + 4.35, z1 - 0.3, 5, 1.1, signMaterial([{ text: 'DINER', size: 150 }], { bg: '#7a1c18', fg: '#f1e2b8', border: '#f1e2b8' }), 0);
  b.box(-1.5, y + 3.5, z1 - 0.3, 0.1, 0.84, 0.1, M.metal, { collide: false });
  b.box(1.5, y + 3.5, z1 - 0.3, 0.1, 0.84, 0.1, M.metal, { collide: false });
  // parking lot
  b.box(0, 0.04, z1 + 5, 18, 0.08, 9, M.asphalt, { surface: 'asphalt' });
  return { builder: b, footprint: { w: 18, d: 18 } };
}

// ------------------------------------------------------------------ barn, windmill, water tower, radio tower
export function buildBarn(rnd) {
  const M = archMaterials();
  const b = new Builder('barn');
  const w = 9,
    d = 12;
  const y = 0.05;
  const ext = rnd() < 0.6 ? M.planks : M.corrugatedRust;
  room(b, -w / 2, -d / 2, w / 2, d / 2, y, 4.2, {
    ext,
    inner: M.planks,
    floor: M.planks,
    trim: M.woodDark,
    roof: 'gable',
    roofMat: M.corrugatedRust,
    pitch: 0.62,
    rnd,
    ceiling: false,
    openings: { front: [{ at: w / 2, w: 3.6, bottom: 0, top: 3.6, type: 'gap' }], back: [{ at: w / 2, w: 1.2, bottom: 0, top: 2.2, type: 'gap' }], left: [{ at: 4, w: 1, bottom: 1.8, top: 2.6, type: 'window' }] },
  });
  // hay bales and stalls
  for (let i = 0; i < 6; i++) {
    const g = roundedBox(1.0, 0.45, 0.5, 0.05, 2);
    g.translate(-w / 2 + 1 + (i % 3) * 1.05, y + 0.23 + Math.floor(i / 3) * 0.46, -d / 2 + 0.8);
    b.add(g, M.mattress);
  }
  b.collider(-w / 2 + 2.05, y + 0.46, -d / 2 + 0.8, 3.2, 0.92, 0.5);
  for (let i = 0; i < 3; i++) b.box(w / 2 - 1.6, y + 0.6, -d / 2 + 2 + i * 2.6, 3.0, 1.2, 0.08, M.planks, {});
  placeIt(b, FUR.workbench(rnd), -w / 2 + 1.2, y, 2, Math.PI / 2);
  placeIt(b, FUR.crate(rnd), 0.5, y, -3.5, 0.3);
  return { builder: b, footprint: { w: w + 1, d: d + 1 } };
}

export function buildWindmill(rnd) {
  const M = archMaterials();
  const b = new Builder('windmill');
  const H = 9 + rnd() * 3;
  const base = 1.6,
    top = 0.35;
  const legs = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const p0 = V(sx * base, 0, sz * base),
        p1 = V(sx * top, H, sz * top);
      legs.push([p0, p1]);
      b.add(tubeAlong([p0, p1], 0.05, 6), M.metalPainted);
    }
  // cross braces
  for (let k = 0; k < 4; k++) {
    const t0 = k / 4,
      t1 = (k + 1) / 4;
    for (let i = 0; i < 4; i++) {
      const a = legs[i],
        c = legs[[1, 3, 0, 2][i]];
      const pa = a[0].clone().lerp(a[1], t0),
        pc = c[0].clone().lerp(c[1], t1);
      b.add(tubeAlong([pa, pc], 0.022, 5), M.metalPainted);
    }
  }
  b.collider(0, H / 2, 0, base * 2, H, base * 2, 0, 'metal');
  // head (static) and rotor: a sub-builder turning about its hub (animated)
  const rotor = b.sub('rotor', [0, H + 0.3, 0.45], { kind: 'spin', speed: 1.6 });
  const blades = 18;
  for (let i = 0; i < blades; i++) {
    const bl = new THREE.BoxGeometry(0.22, 1.3, 0.02);
    bl.translate(0, 0.95, 0);
    bl.rotateY(0.35);
    bl.rotateZ((i / blades) * Math.PI * 2);
    rotor.add(bl, M.metalWhite);
  }
  rotor.add(new THREE.TorusGeometry(1.25, 0.025, 6, 32), M.metal);
  rotor.add(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 12).rotateX(Math.PI / 2), M.metal);
  b.add(new THREE.BoxGeometry(0.02, 0.9, 1.4).translate(0, H + 0.4, -1.4), M.metalWhite);
  b.add(new THREE.BoxGeometry(0.4, 0.4, 0.9).translate(0, H + 0.3, 0), M.metal);
  b.add(new THREE.CylinderGeometry(0.03, 0.03, 2.2).rotateX(Math.PI / 2).translate(0, H + 0.4, -0.7), M.metal);
  // water tank + trough
  const tank = latheY([[0, 0], [1.6, 0], [1.6, 1.4], [1.62, 1.45], [0, 1.45]], 32);
  tank.translate(3.2, 0, 0.5);
  b.add(tank, M.corrugatedRust);
  b.collider(3.2, 0.7, 0.5, 3.2, 1.4, 3.2, 0, 'metal');
  b.box(0.5, 0.35, 3, 2.4, 0.7, 0.7, M.metalPainted, { surface: 'metal' });
  return { builder: b, footprint: { w: 6, d: 6 } };
}

export function buildWaterTower(rnd) {
  const M = archMaterials();
  const b = new Builder('watertower');
  const H = 14 + rnd() * 6,
    R = 3.2;
  const legPos = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const p0 = V(Math.cos(a) * R * 1.25, 0, Math.sin(a) * R * 1.25),
      p1 = V(Math.cos(a) * R * 0.85, H, Math.sin(a) * R * 0.85);
    legPos.push([p0, p1]);
    b.add(tubeAlong([p0, p1], 0.16, 10), M.metalPainted);
    b.collider(p0.x * 0.95 + p1.x * 0.05, H / 2, p0.z * 0.95, 0.4, H, 0.4, 0, 'metal');
    // footing
    b.box(p0.x, 0.3, p0.z, 0.9, 0.6, 0.9, M.concrete, { surface: 'concrete' });
  }
  for (let k = 1; k < 4; k++) {
    const t = k / 4;
    for (let i = 0; i < 4; i++) {
      const a = legPos[i],
        c = legPos[(i + 1) % 4];
      b.add(tubeAlong([a[0].clone().lerp(a[1], t), c[0].clone().lerp(c[1], t)], 0.05, 6), M.metalPainted);
      b.add(tubeAlong([a[0].clone().lerp(a[1], t - 0.25), c[0].clone().lerp(c[1], t)], 0.035, 5), M.metalPainted);
    }
  }
  const prof = [
    [0, H - 0.8],
    [R * 0.5, H - 0.6],
    [R, H + 0.3],
    [R, H + 4.2],
    [R * 1.02, H + 4.3],
    [R * 0.15, H + 5.6],
    [0, H + 5.7],
  ];
  b.add(latheY(prof, 40), M.metalWhite);
  // band with town name
  const band = new THREE.CylinderGeometry(R + 0.01, R + 0.01, 0.9, 40, 1, true);
  const uv = band.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 2);
  band.translate(0, H + 2.4, 0);
  const town = ['ASHFORK', 'RED MESA', 'DRY CREEK', 'SALTON', 'GRAYSTONE'][Math.floor(rnd() * 5)];
  b.add(band, signMaterial([town], { w: 1024, h: 128, bg: '#e6e2d8', fg: '#2e4a66', border: null, worn: 0.6, repeatX: true }));
  // walkway ring + ladder
  b.add(new THREE.TorusGeometry(R + 0.5, 0.04, 6, 40).rotateX(Math.PI / 2).translate(0, H + 1.4, 0), M.metal);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add(new THREE.CylinderGeometry(0.025, 0.025, 1.0).translate(Math.cos(a) * (R + 0.5), H + 0.9, Math.sin(a) * (R + 0.5)), M.metal);
  }
  const lx = R * 1.25 * Math.cos(Math.PI / 4) + 0.3;
  for (const s of [-0.22, 0.22]) b.add(tubeAlong([V(lx, 0.2, s), V(lx - 0.5, H + 0.4, s)], 0.02, 5), M.metal);
  return { builder: b, footprint: { w: 10, d: 10 } };
}

export function buildRadioTower(rnd) {
  const M = archMaterials();
  const b = new Builder('radiotower');
  const H = 32 + rnd() * 18;
  const r = 0.7;
  const pts = [0, 1, 2].map((i) => (i / 3) * Math.PI * 2);
  for (const a of pts) b.add(tubeAlong([V(Math.cos(a) * r, 0, Math.sin(a) * r), V(Math.cos(a) * r * 0.55, H, Math.sin(a) * r * 0.55)], 0.05, 6), M.metalRed);
  const seg = 1.4;
  for (let y = 0; y < H; y += seg) {
    const k0 = 1 - (y / H) * 0.45,
      k1 = 1 - ((y + seg) / H) * 0.45;
    for (let i = 0; i < 3; i++) {
      const a = pts[i],
        c = pts[(i + 1) % 3];
      const pa = V(Math.cos(a) * r * k0, y, Math.sin(a) * r * k0),
        pc = V(Math.cos(c) * r * k1, y + seg, Math.sin(c) * r * k1);
      b.add(tubeAlong([pa, pc], 0.018, 4), Math.floor(y / 6) % 2 ? M.metalWhite : M.metalRed);
      b.add(tubeAlong([pa, V(Math.cos(c) * r * k0, y, Math.sin(c) * r * k0)], 0.018, 4), M.metal);
    }
  }
  b.collider(0, H / 2, 0, r * 2, H, r * 2, 0, 'metal');
  b.add(new THREE.SphereGeometry(0.18, 10, 8).translate(0, H + 0.2, 0), M.neonRed);
  b.lights.push({ pos: [0, H + 0.4, 0], color: 0xff2010, intensity: 0, distance: 30, beacon: true });
  b.beacon = true;
  // guy wires
  for (const a of pts) b.add(tubeAlong([V(0, H * 0.8, 0), V(Math.cos(a + 0.5) * H * 0.55, 0, Math.sin(a + 0.5) * H * 0.55)], 0.008, 3), M.metal);
  // equipment shed with fence
  const sx = 4.5;
  room(b, sx, -1.8, sx + 3.2, 1.8, 0.15, 2.5, { ext: M.concrete, inner: M.concrete, floor: M.concrete, trim: M.metal, rnd, openings: { left: [{ at: 1.8, w: 0.9, bottom: 0, top: 2.0, type: 'door', leafMat: M.metal }] } });
  placeIt(b, FUR.metalShelf(rnd, 1.2, 1.9, 0.45), sx + 2.6, 0.15, 0, -Math.PI / 2);
  placeIt(b, FUR.desk(rnd), sx + 1.4, 0.15, -1.2, 0);
  return { builder: b, footprint: { w: 12, d: 10 } };
}

// ------------------------------------------------------------------ trailer (mobile home)
export function buildTrailer(rnd) {
  const M = archMaterials();
  const b = new Builder('trailer');
  const L = 11 + rnd() * 3,
    W = 3.4;
  const y = 0.7;
  const ext = rnd() < 0.5 ? M.metalWhite : M.sidingYellow || M.metalPainted;
  room(b, -L / 2, -W / 2, L / 2, W / 2, y, 2.3, {
    ext,
    inner: M.wallpaper,
    floor: M.linoleum,
    trim: M.metal,
    rnd,
    t: 0.12,
    roof: 'flat',
    roofMat: M.metalWhite,
    openings: {
      front: [
        { at: 2.0, w: 1.3, bottom: 0.9, top: 1.9, type: 'window' },
        { at: L / 2 - 1.2, w: 0.85, bottom: 0, top: 1.95, type: 'door', leafMat: M.metalPainted, open: rnd() < 0.4 ? 0.7 : 0 },
        { at: L - 2.2, w: 1.3, bottom: 0.9, top: 1.9, type: 'window' },
      ],
      back: [{ at: L / 2, w: 1.0, bottom: 1.0, top: 1.8, type: 'window' }],
    },
  });
  // skirt and blocks, steps
  b.box(0, y / 2, 0, L - 0.2, y, W - 0.2, M.corrugated, {});
  b.box(-1.2, y / 2, W / 2 + 0.5, 1.2, y, 0.9, M.woodDark, { surface: 'wood' });
  // stripe
  b.box(0, y + 1.2, W / 2 + 0.065, L, 0.12, 0.01, M.metalGreen, { collide: false });
  placeIt(b, FUR.bed(rnd, { double: true }), -L / 2 + 1.3, y, 0, Math.PI / 2);
  placeIt(b, FUR.kitchenRun(rnd, 2.4, { uppers: true }), 1.4, y, -W / 2 + 0.38, 0);
  placeIt(b, FUR.sofa(rnd, { seats: 2 }), L / 2 - 0.6, y, 0, -Math.PI / 2);
  placeIt(b, FUR.fridge(rnd), 3.2, y, -W / 2 + 0.42, 0);
  return { builder: b, footprint: { w: L + 1, d: W + 2 } };
}

// ------------------------------------------------------------------ military outpost
export function buildOutpost(rnd) {
  const M = archMaterials();
  const b = new Builder('outpost');
  // sandbag walls (rows of rounded bags)
  const bagWall = (x0, z0, x1, z1, rows = 3) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / L,
      uz = (z1 - z0) / L;
    const rot = Math.atan2(-uz, ux);
    const n = Math.floor(L / 0.58);
    for (let r = 0; r < rows; r++)
      for (let i = 0; i < n; i++) {
        const s = (i + 0.5 + (r % 2) * 0.5) * (L / n);
        if (s > L) continue;
        const g = roundedBox(0.56, 0.17, 0.34, 0.07, 2);
        g.rotateY(rot + (rnd() - 0.5) * 0.12);
        g.translate(x0 + ux * s, 0.09 + r * 0.16, z0 + uz * s);
        b.add(g, M.sandbag);
      }
    b.collider((x0 + x1) / 2, rows * 0.08, (z0 + z1) / 2, L, rows * 0.16 + 0.04, 0.36, rot, 'sand');
  };
  bagWall(-8, 7, -2, 7);
  bagWall(2, 7, 8, 7);
  bagWall(-8, 7, -8, -5);
  bagWall(8, 7, 8, -5);
  // jersey barriers at the entrance
  for (const x of [-1.2, 1.2]) {
    const sh = new THREE.Shape();
    sh.moveTo(-0.3, 0);
    sh.lineTo(0.3, 0);
    sh.lineTo(0.12, 0.3);
    sh.lineTo(0.08, 0.8);
    sh.lineTo(-0.08, 0.8);
    sh.lineTo(-0.12, 0.3);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 2.0, bevelEnabled: false });
    g.translate(0, 0, -1);
    g.rotateY(Math.PI / 2);
    g.translate(x * 2, 0, 9);
    b.add(g, M.concrete);
    b.collider(x * 2, 0.4, 9, 2, 0.8, 0.6, 0, 'concrete');
  }
  // watchtower
  const tx = -5.5,
    tz = -2.5,
    th = 4.5;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(tx + sx * 1.1, th / 2, tz + sz * 1.1, 0.18, th, 0.18, M.woodDark, { surface: 'wood' });
  b.box(tx, th, tz, 2.8, 0.15, 2.8, M.planks, { surface: 'wood' });
  for (const [sx, sz, w, d] of [
    [0, 1.35, 2.8, 0.06],
    [0, -1.35, 2.8, 0.06],
    [1.35, 0, 0.06, 2.8],
    [-1.35, 0, 0.06, 2.8],
  ])
    b.box(tx + sx, th + 0.5, tz + sz, w, 0.9, d, M.planks, {});
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(tx + sx * 1.3, th + 1.4, tz + sz * 1.3, 0.1, 2.0, 0.1, M.woodDark, { collide: false });
  b.box(tx, th + 2.45, tz, 3.2, 0.1, 3.2, M.corrugated, {});
  // ladder
  for (const s of [-0.22, 0.22]) b.add(tubeAlong([V(tx + s, 0, tz + 1.6), V(tx + s, th + 0.1, tz + 1.2)], 0.025, 5), M.woodDark);
  for (let i = 1; i < 14; i++) b.box(tx, (i * th) / 14, tz + 1.6 - (i / 14) * 0.4, 0.44, 0.04, 0.04, M.woodDark, { collide: false });
  // tents
  tent(b, rnd, 3.5, -1, 0.1, M.canvasGreen, 4.2, 3.2, 2.4);
  tent(b, rnd, 3.5, 3.5, 0.0, M.canvasGreen, 3.6, 3.0, 2.2);
  // crates & ammo boxes
  for (let i = 0; i < 4; i++) placeIt(b, FUR.crate(rnd, 0.55 + rnd() * 0.2), -2 + i * 0.75, 0, -4 + (i % 2) * 0.5, rnd() * 0.5);
  placeIt(b, FUR.barrel(rnd), 6.5, 0, -4, 0);
  placeIt(b, FUR.barrel(rnd), 6.5, 0, -3.2, 0);
  // flag pole
  b.box(0, 3.5, -4.5, 0.08, 7, 0.08, M.metal, { surface: 'metal' });
  const flag = new THREE.PlaneGeometry(1.4, 0.8, 8, 4);
  const fp = flag.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setZ(i, Math.sin(fp.getX(i) * 3) * 0.08);
  flag.translate(0.72, 6.5, -4.5);
  b.add(flag, M.fabricBrown);
  return { builder: b, footprint: { w: 18, d: 18 } };
}

export function tent(b, rnd, x, z, rot, mat, L = 3.2, W = 2.6, H = 2.0) {
  const M = archMaterials();
  // A-frame with slightly sagging canvas
  const segs = 10;
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(L, Math.hypot(W / 2, H), segs, 4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i),
        v = p.getY(i) / Math.hypot(W / 2, H) + 0.5; // 0 bottom .. 1 ridge
      const sag = Math.sin(v * Math.PI) * 0.06 * (1 - Math.abs(u) / (L / 2)) ** 0.3;
      const yy = v * H - sag * 0.4;
      const xx = s * (W / 2) * (1 - v) - s * sag;
      p.setXYZ(i, xx, yy, u);
    }
    g.computeVertexNormals();
    g.rotateY(rot);
    g.translate(x, 0, z);
    b.add(g, mat);
  }
  // back wall triangle and poles
  const tri = new THREE.Shape();
  tri.moveTo(-W / 2, 0);
  tri.lineTo(W / 2, 0);
  tri.lineTo(0, H);
  tri.closePath();
  const back = new THREE.ShapeGeometry(tri);
  back.translate(0, 0, -L / 2);
  back.rotateY(rot);
  back.translate(x, 0, z);
  b.add(back, mat);
  for (const e of [-L / 2, L / 2]) {
    const g = new THREE.CylinderGeometry(0.025, 0.025, H, 6);
    g.translate(0, H / 2, e);
    g.rotateY(rot);
    g.translate(x, 0, z);
    b.add(g, M.woodDark);
  }
  b.collider(x, H / 3, z, W * 0.8, (H * 2) / 3, L, rot, 'canvas');
  b.loot.push({ pos: [x, 0.05, z], kind: 'tent' });
}

// ------------------------------------------------------------------ ruins
export function buildRuins(rnd) {
  const M = archMaterials();
  const b = new Builder('ruins');
  const W = 7 + rnd() * 4,
    D = 6 + rnd() * 3;
  const mat = M.adobe;
  const t = 0.4;
  const segs = [
    [[-W / 2, -D / 2], [W / 2, -D / 2]],
    [[W / 2, -D / 2], [W / 2, D / 2]],
    [[W / 2, D / 2], [-W / 2, D / 2]],
    [[-W / 2, D / 2], [-W / 2, -D / 2]],
    [[-W / 2, 0], [0.5, 0]],
  ];
  for (const [a, c] of segs) {
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const n = Math.ceil(L / 0.8);
    for (let i = 0; i < n; i++) {
      const t0 = i / n,
        t1 = (i + 1) / n;
      const h = Math.max(0, 0.4 + 2.6 * Math.pow(Math.abs(Math.sin(i * 1.7 + rnd() * 2)), 1.5) - (rnd() < 0.2 ? 2 : 0));
      if (h < 0.2) continue;
      const x = a[0] + (c[0] - a[0]) * ((t0 + t1) / 2),
        z = a[1] + (c[1] - a[1]) * ((t0 + t1) / 2);
      const rot = Math.atan2(-(c[1] - a[1]), c[0] - a[0]);
      const g = roundedBox(L / n + 0.02, h, t, 0.06, 2);
      // jagged top
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) if (p.getY(k) > h / 2 - 0.1) p.setY(k, p.getY(k) - rnd() * 0.25);
      g.computeVertexNormals();
      const uv = g.attributes.uv;
      for (let k = 0; k < p.count; k++) uv.setXY(k, p.getX(k) + x, p.getY(k) + h / 2);
      g.rotateY(rot);
      g.translate(x, h / 2, z);
      b.add(g, mat);
      b.collider(x, h / 2, z, L / n, h, t, rot, 'rock');
    }
  }
  // rubble
  for (let i = 0; i < 26; i++) {
    const g = roundedBox(0.25 + rnd() * 0.3, 0.15 + rnd() * 0.15, 0.2 + rnd() * 0.3, 0.05, 1);
    g.rotateY(rnd() * 3);
    g.translate((rnd() - 0.5) * W, 0.08, (rnd() - 0.5) * D);
    b.add(g, mat);
  }
  // a collapsed roof beam
  const beam = new THREE.CylinderGeometry(0.1, 0.12, W * 0.8, 8);
  beam.rotateZ(Math.PI / 2 - 0.25);
  beam.translate(0.4, 0.9, D / 4);
  b.add(beam, M.woodDark);
  placeIt(b, FUR.crate(rnd, 0.5), -W / 4, 0, -D / 4, 0.4);
  b.loot.push({ pos: [W / 4, 0.05, D / 4], kind: 'ruin' });
  return { builder: b, footprint: { w: W + 2, d: D + 2 } };
}

// ------------------------------------------------------------------ camp
export function buildCamp(rnd) {
  const M = archMaterials();
  const b = new Builder('camp');
  tent(b, rnd, -2.4, -1, 0.3, rnd() < 0.5 ? M.canvasOrange : M.canvasGreen, 2.6, 2.0, 1.4);
  if (rnd() < 0.6) tent(b, rnd, 2.6, -1.6, -0.4, M.canvasGreen, 2.4, 2.0, 1.3);
  // fire ring
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const g = roundedBox(0.22, 0.14, 0.18, 0.05, 1);
    g.rotateY(a);
    g.translate(Math.cos(a) * 0.55, 0.06, 1.5 + Math.sin(a) * 0.55);
    b.add(g, M.concrete);
  }
  for (let i = 0; i < 4; i++) {
    const g = new THREE.CylinderGeometry(0.04, 0.05, 0.6, 6);
    g.rotateZ(Math.PI / 2);
    g.rotateY(i * 0.8);
    g.translate(0, 0.06, 1.5);
    b.add(g, M.blackMatte);
  }
  b.campfire = [0, 0.1, 1.5];
  // folding chairs
  for (const [x, z, r] of [
    [-1.4, 2.4, 2.4],
    [1.3, 2.6, -2.2],
  ]) {
    const it = new FUR.Item([0.5, 0.8, 0.5]);
    for (const s of [-1, 1]) it.add(tubeAlong([V(s * 0.22, 0, -0.2), V(s * 0.22, 0.42, 0.18)], 0.012, 5), M.metal), it.add(tubeAlong([V(s * 0.22, 0, 0.2), V(s * 0.22, 0.85, -0.2)], 0.012, 5), M.metal);
    it.rbox(0.44, 0.02, 0.38, 0, 0.4, 0, M.canvasGreen, 0.01);
    it.rbox(0.44, 0.35, 0.02, 0, 0.65, -0.15, M.canvasGreen, 0.01);
    place(b, it, x, 0, z, r);
  }
  // cooler
  b.box(2.4, 0.22, 1.0, 0.6, 0.44, 0.38, M.metalRed, {});
  b.box(2.4, 0.46, 1.0, 0.62, 0.06, 0.4, M.metalWhite, { collide: false });
  b.loot.push({ pos: [2.4, 0.5, 1.0], kind: 'camp' });
  b.loot.push({ pos: [-0.3, 0.05, 2.6], kind: 'camp' });
  return { builder: b, footprint: { w: 9, d: 8 } };
}

// ------------------------------------------------------------------ small site props
export function mailbox(b, x, z, rot, name) {
  const M = archMaterials();
  b.box(x, 0.55, z, 0.08, 1.1, 0.08, M.woodDark, { surface: 'wood' });
  const g = new THREE.CylinderGeometry(0.13, 0.13, 0.48, 16, 1, false, 0, Math.PI);
  g.rotateZ(Math.PI / 2);
  g.rotateY(rot);
  g.translate(x, 1.15, z);
  b.add(g, M.metalPainted);
  b.box(x, 1.1, z, 0.26, 0.12, 0.48, M.metalPainted, { collide: false, rotY: rot });
  void name;
}

export function fence(b, pts, { mat, post, h = 1.2 } = {}) {
  const M = archMaterials();
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i],
      [x1, z1] = pts[i + 1];
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(L / 2.5));
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n,
        z = z0 + ((z1 - z0) * k) / n;
      b.box(x, h / 2, z, 0.1, h, 0.1, post || M.woodDark, { collide: false });
    }
    const rot = Math.atan2(-(z1 - z0), x1 - x0);
    for (const yy of [h * 0.35, h * 0.8]) b.box((x0 + x1) / 2, yy, (z0 + z1) / 2, L, 0.08, 0.03, mat || M.wood, { rotY: rot, collide: false });
    b.collider((x0 + x1) / 2, h / 2, (z0 + z1) / 2, L, h, 0.12, rot, 'wood');
  }
}

export { room, signBoard, placeIt };
