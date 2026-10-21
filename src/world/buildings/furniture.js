// Furniture & interior props. Each factory returns an Item: { parts: [[geo, mat]], size:[w,h,d],
// cols:[{c,h}], loot:[{pos, kind}] } in local space (origin at floor centre, front = +Z).

import * as THREE from 'three';
import { roundedBox, latheY, loftSections, superSection, tubeAlong } from '../../gfx/geom.js';
import { archMaterials, stdMat } from './materials.js';
import { mulberry32 } from '../../core/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

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
    const g = roundedBox(w, h, d, r, 1);
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

// ------------------------------------------------------------------ bedroom
export function bed(rnd, { double = true } = {}) {
  const M = archMaterials();
  const w = double ? 1.5 : 0.95,
    L = 2.05;
  const it = new Item([w + 0.08, 1.0, L + 0.08]);
  const wood = rnd() < 0.5 ? M.woodDark : M.wood;
  const metal = rnd() < 0.3;
  if (metal) {
    // tubular metal frame
    for (const sz of [-1, 1]) {
      const zz = (sz * L) / 2;
      const hh = sz < 0 ? 1.0 : 0.65;
      it.add(tubeAlong([V(-w / 2, 0, zz), V(-w / 2, hh, zz), V(w / 2, hh, zz), V(w / 2, 0, zz)], 0.018, 8), M.metalPainted);
      for (let k = 1; k < 5; k++) it.add(tubeAlong([V(-w / 2 + (w * k) / 5, 0.32, zz), V(-w / 2 + (w * k) / 5, hh, zz)], 0.009, 6), M.metalPainted);
    }
    it.rbox(w, 0.06, L, 0, 0.3, 0, M.metalPainted, 0.01);
  } else {
    it.rbox(w + 0.06, 0.24, L + 0.04, 0, 0.18, 0, wood, 0.015);
    legs4(it, w + 0.04, L, 0.08, 0.035, wood, 0.06, false);
    // headboard with panels
    it.rbox(w + 0.08, 0.9, 0.06, 0, 0.55, -L / 2 - 0.01, wood, 0.02);
    it.rbox(w * 0.38, 0.35, 0.02, -w * 0.22, 0.68, -L / 2 + 0.025, wood, 0.01);
    it.rbox(w * 0.38, 0.35, 0.02, w * 0.22, 0.68, -L / 2 + 0.025, wood, 0.01);
  }
  // mattress
  it.rbox(w - 0.04, 0.2, L - 0.06, 0, 0.42, 0.01, M.mattress, 0.06);
  // blanket: draped over the lower 2/3, hangs down the sides with folds
  const blanketMat = [M.fabricRed, M.fabricBlue, M.fabric, M.fabricBrown][Math.floor(rnd() * 4)];
  const bl = new THREE.PlaneGeometry(w + 0.12, L * 0.72, 24, 24);
  bl.rotateX(-Math.PI / 2);
  const p = bl.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i),
      z = p.getZ(i);
    let y = 0.535;
    const over = Math.abs(x) - (w - 0.04) / 2;
    if (over > 0) {
      y -= over * 3.2;
      x = Math.sign(x) * ((w - 0.04) / 2 + 0.015 + over * 0.12);
    }
    y += Math.sin(z * 9 + x * 3) * 0.008 + Math.sin(x * 14) * 0.004;
    p.setXYZ(i, x, y, z + L * 0.14);
  }
  bl.computeVertexNormals();
  it.add(bl, blanketMat);
  const blb = bl.clone();
  blb.scale(1, 1, 1);
  // folded edge
  it.rbox(w + 0.02, 0.05, 0.22, 0, 0.55, -L * 0.22, M.mattress, 0.024);
  // pillows
  const np = double ? 2 : 1;
  for (let i = 0; i < np; i++) {
    const px = np === 1 ? 0 : (i - 0.5) * w * 0.5;
    const pg = new THREE.SphereGeometry(1, 16, 10);
    pg.scale(w / np / 2.3, 0.07, 0.2);
    pg.translate(px, 0.6, -L / 2 + 0.28);
    it.add(pg, M.mattress);
  }
  it.col(w + 0.08, 0.6, L + 0.08, 0, 0.3, 0);
  it.lootAt(0, 0.62, 0.3, 'bed');
  return it;
}

export function nightstand(rnd) {
  const M = archMaterials();
  const it = new Item([0.45, 0.6, 0.4]);
  const wood = rnd() < 0.5 ? M.wood : M.woodDark;
  it.rbox(0.45, 0.04, 0.4, 0, 0.58, 0, wood, 0.008);
  it.rbox(0.42, 0.48, 0.37, 0, 0.32, -0.01, wood, 0.008);
  legs4(it, 0.42, 0.36, 0.08, 0.018, wood, 0.03, false);
  it.rbox(0.38, 0.17, 0.02, 0, 0.44, 0.18, wood, 0.006);
  it.rbox(0.38, 0.2, 0.02, 0, 0.22, 0.18, wood, 0.006);
  for (const y of [0.44, 0.22]) {
    const k = new THREE.SphereGeometry(0.014, 10, 8);
    k.translate(0, y, 0.2);
    it.add(k, M.metal);
  }
  it.col(0.45, 0.6, 0.4, 0, 0.3, 0);
  it.lootAt(0.08, 0.6, 0, 'small');
  if (rnd() < 0.6) {
    const lamp = tableLamp(rnd);
    for (const [g, m] of lamp.parts) {
      g.translate(-0.1, 0.6, -0.05);
      it.add(g, m);
    }
    it.lights.push({ pos: [-0.1, 0.95, -0.05], color: 0xffd8a0, intensity: 1.2, distance: 4 });
  }
  return it;
}

export function tableLamp(rnd) {
  const M = archMaterials();
  const it = new Item([0.25, 0.4, 0.25]);
  it.add(latheY([[0, 0], [0.07, 0], [0.075, 0.015], [0.02, 0.03], [0.012, 0.2], [0.02, 0.21], [0, 0.22]], 18), rnd() < 0.5 ? M.metal : M.porcelain);
  const shade = latheY([[0.07, 0.18], [0.12, 0.18], [0.085, 0.36], [0.06, 0.36]], 24);
  it.add(shade, M.mattress);
  return it;
}

export function wardrobe(rnd) {
  const M = archMaterials();
  const w = 0.9 + rnd() * 0.4;
  const it = new Item([w, 2.0, 0.58]);
  const wood = rnd() < 0.5 ? M.woodDark : M.wood;
  it.rbox(w, 1.86, 0.56, 0, 1.02, 0, wood, 0.01);
  it.rbox(w + 0.04, 0.06, 0.6, 0, 1.97, 0.0, wood, 0.012);
  it.rbox(w + 0.02, 0.08, 0.58, 0, 0.06, 0, wood, 0.01);
  // doors
  for (const s of [-1, 1]) {
    it.rbox(w / 2 - 0.02, 1.7, 0.025, (s * w) / 4, 1.0, 0.285, wood, 0.008);
    it.rbox(w / 2 - 0.14, 0.7, 0.012, (s * w) / 4, 1.35, 0.3, wood, 0.006);
    it.rbox(w / 2 - 0.14, 0.7, 0.012, (s * w) / 4, 0.6, 0.3, wood, 0.006);
    const h = new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8);
    h.translate(s * 0.04, 1.0, 0.31);
    it.add(h, M.metal);
  }
  it.col(w, 2.0, 0.58, 0, 1.0, 0);
  it.lootAt(0, 1.3, 0.05, 'clothes');
  return it;
}

export function dresser(rnd) {
  const M = archMaterials();
  const w = 1.0 + rnd() * 0.3;
  const it = new Item([w, 0.85, 0.48]);
  const wood = rnd() < 0.5 ? M.wood : M.woodDark;
  it.rbox(w, 0.04, 0.48, 0, 0.83, 0, wood, 0.01);
  it.rbox(w - 0.04, 0.72, 0.45, 0, 0.45, -0.01, wood, 0.008);
  legs4(it, w - 0.06, 0.42, 0.09, 0.02, wood, 0.03, false);
  for (let i = 0; i < 3; i++) {
    const y = 0.22 + i * 0.22;
    it.rbox(w - 0.1, 0.19, 0.02, 0, y, 0.23, wood, 0.006);
    for (const s of [-1, 1]) {
      const k = new THREE.CylinderGeometry(0.006, 0.006, 0.09, 8);
      k.rotateZ(Math.PI / 2);
      k.translate(s * w * 0.25, y, 0.25);
      it.add(k, M.metal);
    }
  }
  // mirror
  if (rnd() < 0.6) {
    it.rbox(w * 0.7, 0.7, 0.03, 0, 1.25, -0.2, wood, 0.01);
    it.rbox(w * 0.7 - 0.08, 0.62, 0.005, 0, 1.25, -0.183, stdMat({ color: 0x9aa3a6, metalness: 1, roughness: 0.08 }), 0.004);
  }
  it.col(w, 0.85, 0.48, 0, 0.42, 0);
  it.lootAt(0.2, 0.86, 0, 'small');
  return it;
}

// ------------------------------------------------------------------ living
export function sofa(rnd, { seats = 3 } = {}) {
  const M = archMaterials();
  const fab = [M.fabric, M.fabricBrown, M.fabricBlue, M.fabricRed][Math.floor(rnd() * 4)];
  const w = 0.62 * seats + 0.3;
  const it = new Item([w, 0.85, 0.88]);
  // base
  it.rbox(w, 0.22, 0.85, 0, 0.21, 0, fab, 0.04);
  // arms
  for (const s of [-1, 1]) it.rbox(0.16, 0.36, 0.85, s * (w / 2 - 0.08), 0.42, 0, fab, 0.06);
  // back
  it.rbox(w - 0.02, 0.5, 0.18, 0, 0.52, -0.34, fab, 0.07);
  // cushions
  const cw = (w - 0.32) / seats;
  for (let i = 0; i < seats; i++) {
    const x = -w / 2 + 0.16 + cw * (i + 0.5);
    it.rbox(cw - 0.015, 0.13, 0.6, x, 0.385, 0.08, fab, 0.05);
    const back = roundedBox(cw - 0.02, 0.38, 0.14, 0.06, 3);
    back.rotateX(-0.12);
    back.translate(x, 0.63, -0.21);
    it.add(back, fab);
  }
  // legs
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.02, 0.015, 0.1, 8);
      g.translate(sx * (w / 2 - 0.06), 0.05, sz * 0.36);
      it.add(g, M.woodDark);
    }
  it.col(w, 0.5, 0.88, 0, 0.25, 0);
  it.col(w, 0.4, 0.2, 0, 0.6, -0.34);
  it.lootAt(0.2, 0.46, 0.1, 'couch');
  return it;
}

export function armchair(rnd) {
  const it = sofa(rnd, { seats: 1 });
  it.size = [0.92, 0.85, 0.88];
  return it;
}

export function coffeeTable(rnd) {
  const M = archMaterials();
  const it = new Item([1.0, 0.45, 0.55]);
  const wood = rnd() < 0.5 ? M.wood : M.woodDark;
  it.rbox(1.0, 0.04, 0.55, 0, 0.43, 0, wood, 0.01);
  it.rbox(0.92, 0.02, 0.47, 0, 0.14, 0, wood, 0.005);
  legs4(it, 0.96, 0.51, 0.42, 0.022, wood, 0.03, false);
  it.col(1.0, 0.45, 0.55, 0, 0.22, 0);
  it.lootAt(0.15, 0.45, 0.05, 'table');
  return it;
}

export function tvStand(rnd) {
  const M = archMaterials();
  const it = new Item([1.1, 1.0, 0.5]);
  const wood = M.woodDark;
  it.rbox(1.1, 0.5, 0.45, 0, 0.27, 0, wood, 0.012);
  it.rbox(0.48, 0.38, 0.02, -0.26, 0.27, 0.225, wood, 0.006);
  it.rbox(0.48, 0.38, 0.02, 0.26, 0.27, 0.225, wood, 0.006);
  legs4(it, 1.06, 0.4, 0.04, 0.02, wood, 0.03, false);
  // CRT television
  it.rbox(0.62, 0.48, 0.42, 0, 0.78, -0.02, M.plasticDark, 0.04);
  it.rbox(0.5, 0.36, 0.02, -0.03, 0.8, 0.2, M.screen, 0.03);
  for (let k = 0; k < 2; k++) {
    const b = new THREE.CylinderGeometry(0.012, 0.012, 0.02, 10);
    b.rotateX(Math.PI / 2);
    b.translate(0.26, 0.86 - k * 0.06, 0.2);
    it.add(b, M.metal);
  }
  it.col(1.1, 1.0, 0.5, 0, 0.5, 0);
  return it;
}

export function bookshelf(rnd) {
  const M = archMaterials();
  const w = 0.8 + rnd() * 0.3,
    h = 1.8;
  const it = new Item([w, h, 0.32]);
  const wood = rnd() < 0.5 ? M.wood : M.woodDark;
  it.rbox(0.025, h, 0.3, -w / 2 + 0.0125, h / 2, 0, wood, 0.004);
  it.rbox(0.025, h, 0.3, w / 2 - 0.0125, h / 2, 0, wood, 0.004);
  it.rbox(w, 0.01, 0.3, 0, h / 2, -0.145, wood, 0.002);
  const shelves = 5;
  const bookMats = [M.metalRed, M.fabricBlue, M.fabricBrown, M.trimDark, M.metalGreen, M.mattress];
  for (let i = 0; i <= shelves; i++) {
    const y = 0.04 + (i * (h - 0.06)) / shelves;
    it.rbox(w - 0.03, 0.022, 0.29, 0, y, 0, wood, 0.003);
    if (i === shelves) continue;
    // books
    let x = -w / 2 + 0.04;
    while (x < w / 2 - 0.08) {
      if (rnd() < 0.15) {
        x += 0.05 + rnd() * 0.1;
        continue;
      }
      const bw = 0.025 + rnd() * 0.03,
        bh = 0.18 + rnd() * 0.1,
        bd = 0.15 + rnd() * 0.08;
      const lean = rnd() < 0.1 ? 0.2 : 0;
      const g = roundedBox(bw, bh, bd, 0.003, 1);
      if (lean) g.rotateZ(lean);
      g.translate(x + bw / 2, y + 0.011 + bh / 2, 0.0);
      it.add(g, bookMats[Math.floor(rnd() * bookMats.length)]);
      x += bw + 0.002;
    }
  }
  it.col(w, h, 0.32, 0, h / 2, 0);
  it.lootAt(0, 1.1, 0.05, 'shelf');
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
export function diningTable(rnd, { chairs = 4 } = {}) {
  const M = archMaterials();
  const w = 1.3,
    d = 0.8;
  const it = new Item([w + 0.9, 0.95, d + 0.9]);
  const wood = rnd() < 0.5 ? M.wood : M.woodDark;
  it.rbox(w, 0.035, d, 0, 0.75, 0, wood, 0.008);
  it.rbox(w - 0.1, 0.08, d - 0.1, 0, 0.69, 0, wood, 0.004);
  legs4(it, w - 0.06, d - 0.06, 0.73, 0.025, wood, 0.03, false);
  it.col(w, 0.77, d, 0, 0.385, 0);
  const places = [
    [0, -d / 2 - 0.25, 0],
    [0, d / 2 + 0.25, Math.PI],
    [-w / 2 - 0.25, 0, Math.PI / 2],
    [w / 2 + 0.25, 0, -Math.PI / 2],
  ];
  for (let i = 0; i < chairs && i < 4; i++) {
    const [x, z, r] = places[i];
    const c = chair(rnd, wood);
    const rr = r + (rnd() - 0.5) * 0.25;
    for (const [g, m] of c.parts) {
      g.rotateY(rr);
      g.translate(x, 0, z);
      it.add(g, m);
    }
  }
  it.lootAt(0.2, 0.77, 0.1, 'table');
  return it;
}

export function chair(rnd, wood) {
  const M = archMaterials();
  wood = wood || M.wood;
  const it = new Item([0.45, 0.95, 0.45]);
  it.rbox(0.42, 0.035, 0.42, 0, 0.45, 0, wood, 0.008);
  legs4(it, 0.4, 0.4, 0.44, 0.017, wood, 0.02, false);
  for (const s of [-1, 1]) it.rbox(0.03, 0.5, 0.03, s * 0.18, 0.7, 0.19, wood, 0.006);
  for (let k = 0; k < 3; k++) it.rbox(0.36, 0.05, 0.02, 0, 0.62 + k * 0.12, 0.19, wood, 0.006);
  // chairs back faces -z so the sitter faces +z... we put back at +z: rotate so it faces table
  for (const [g] of it.parts) g.rotateY(Math.PI);
  it.col(0.42, 0.47, 0.42, 0, 0.23, 0);
  return it;
}

export function kitchenRun(rnd, len = 2.4, { sink = true, stove = true, uppers = true } = {}) {
  const M = archMaterials();
  const it = new Item([len, uppers ? 2.2 : 0.95, 0.62]);
  const cab = rnd() < 0.5 ? M.trimWhite : M.wood;
  const top = rnd() < 0.5 ? M.concrete : M.linoleum;
  const n = Math.max(2, Math.round(len / 0.6));
  const cw = len / n;
  let stoveAt = stove ? Math.floor(n * 0.75) : -1;
  if (stoveAt === 0) stoveAt = n - 1;
  const sinkAt = sink ? Math.floor(n * 0.3) : -1;
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + cw * (i + 0.5);
    if (i === stoveAt) {
      const st = stoveUnit(rnd, cw);
      for (const [g, m] of st.parts) {
        g.translate(x, 0, 0);
        it.add(g, m);
      }
      continue;
    }
    it.rbox(cw - 0.01, 0.8, 0.56, x, 0.48, -0.02, cab, 0.006);
    it.box(cw - 0.01, 0.08, 0.5, x, 0.04, -0.05, M.trimDark);
    it.rbox(cw - 0.04, 0.6, 0.02, x, 0.45, 0.27, cab, 0.006);
    it.rbox(cw - 0.04, 0.12, 0.02, x, 0.81, 0.27, cab, 0.006);
    const hd = new THREE.CylinderGeometry(0.007, 0.007, 0.1, 8);
    hd.rotateZ(Math.PI / 2);
    hd.translate(x, 0.81, 0.29);
    it.add(hd, M.metal);
    const hd2 = new THREE.CylinderGeometry(0.007, 0.007, 0.1, 8);
    hd2.translate(x + cw * 0.35, 0.62, 0.29);
    it.add(hd2, M.metal);
    // countertop
    it.box(cw, 0.04, 0.62, x, 0.9, 0.0, top);
    if (i === sinkAt) {
      // sink basin + faucet
      it.rbox(cw * 0.7, 0.012, 0.42, x, 0.925, 0.02, M.metal, 0.004);
      const basin = new THREE.BoxGeometry(cw * 0.6, 0.16, 0.36);
      basin.translate(x, 0.84, 0.02);
      it.add(basin, M.metal);
      it.add(tubeAlong([V(x, 0.92, -0.22), V(x, 1.15, -0.22), V(x, 1.17, -0.14), V(x, 1.1, -0.08)], 0.012, 8), M.metal);
    } else it.lootAt(x, 0.93, 0.05, 'kitchen');
    if (uppers && i !== stoveAt) {
      it.rbox(cw - 0.01, 0.7, 0.34, x, 1.75, -0.13, cab, 0.006);
      it.rbox(cw - 0.04, 0.64, 0.02, x, 1.75, 0.05, cab, 0.006);
      it.lootAt(x, 1.5, -0.13, 'cupboard');
    }
  }
  it.col(len, 0.92, 0.62, 0, 0.46, 0);
  if (uppers) it.col(len, 0.7, 0.34, 0, 1.75, -0.13);
  return it;
}

export function stoveUnit(rnd, w = 0.6) {
  const M = archMaterials();
  const it = new Item([w, 0.95, 0.6]);
  const body = rnd() < 0.6 ? M.metalWhite : M.metalPainted;
  it.rbox(w - 0.01, 0.88, 0.58, 0, 0.45, -0.01, body, 0.01);
  it.rbox(w - 0.08, 0.42, 0.02, 0, 0.36, 0.285, M.blackMatte, 0.01);
  it.rbox(w - 0.2, 0.18, 0.01, 0, 0.4, 0.297, M.screen, 0.005);
  const h = new THREE.CylinderGeometry(0.01, 0.01, w - 0.15, 8);
  h.rotateZ(Math.PI / 2);
  h.translate(0, 0.62, 0.31);
  it.add(h, M.metal);
  // burners
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const b = new THREE.CylinderGeometry(0.075, 0.08, 0.012, 20);
      b.translate(sx * w * 0.24, 0.9, sz * 0.13);
      it.add(b, M.blackMatte);
    }
  // back panel + knobs
  it.rbox(w - 0.01, 0.12, 0.05, 0, 0.96, -0.27, body, 0.01);
  for (let k = 0; k < 4; k++) {
    const kn = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12);
    kn.rotateX(Math.PI / 2);
    kn.translate(-w * 0.3 + k * w * 0.2, 0.8, 0.3);
    it.add(kn, M.blackMatte);
  }
  return it;
}

export function fridge(rnd) {
  const M = archMaterials();
  const it = new Item([0.72, 1.75, 0.7]);
  const body = rnd() < 0.7 ? M.metalWhite : stdMat({ color: 0xc9d1b0, roughness: 0.4, metalness: 0.2 });
  it.rbox(0.7, 1.7, 0.66, 0, 0.87, -0.02, body, 0.04);
  it.rbox(0.68, 0.48, 0.04, 0, 1.45, 0.31, body, 0.02);
  it.rbox(0.68, 1.14, 0.04, 0, 0.63, 0.31, body, 0.02);
  for (const y of [1.35, 0.95]) {
    const h = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8);
    h.translate(-0.27, y, 0.35);
    it.add(h, M.metal);
  }
  it.col(0.72, 1.75, 0.7, 0, 0.87, 0);
  it.lootAt(0, 0.9, 0.1, 'fridge');
  return it;
}

// ------------------------------------------------------------------ bathroom
export function toilet(rnd) {
  const M = archMaterials();
  const it = new Item([0.42, 0.8, 0.7]);
  it.add(latheY([[0.0, 0.0], [0.11, 0.0], [0.12, 0.05], [0.1, 0.25], [0.17, 0.38], [0.18, 0.42], [0.0, 0.42]], 24).scale(1, 1, 1.25).translate(0, 0, 0.1), M.porcelain);
  it.rbox(0.38, 0.03, 0.46, 0, 0.44, 0.1, M.porcelain, 0.015);
  it.rbox(0.42, 0.36, 0.18, 0, 0.62, -0.24, M.porcelain, 0.03);
  it.rbox(0.44, 0.03, 0.2, 0, 0.815, -0.24, M.porcelain, 0.01);
  it.col(0.42, 0.8, 0.7, 0, 0.4, 0);
  return it;
}

export function washbasin(rnd) {
  const M = archMaterials();
  const it = new Item([0.55, 1.6, 0.45]);
  it.add(latheY([[0.05, 0], [0.08, 0.0], [0.06, 0.6], [0.05, 0.7], [0.0, 0.7]], 16).translate(0, 0, -0.05), M.porcelain);
  it.rbox(0.55, 0.14, 0.42, 0, 0.78, 0.0, M.porcelain, 0.04);
  it.add(tubeAlong([V(0, 0.84, -0.18), V(0, 0.95, -0.18), V(0, 0.96, -0.1)], 0.01, 8), M.metal);
  // mirror cabinet
  it.rbox(0.5, 0.6, 0.12, 0, 1.45, -0.16, M.trimWhite, 0.01);
  it.rbox(0.46, 0.56, 0.005, 0, 1.45, -0.098, stdMat({ color: 0xa0a8aa, metalness: 1, roughness: 0.05 }), 0.004);
  it.col(0.55, 0.85, 0.45, 0, 0.42, 0);
  it.lootAt(0, 1.45, -0.16, 'medicine');
  return it;
}

export function bathtub(rnd) {
  const M = archMaterials();
  const it = new Item([0.75, 0.58, 1.6]);
  it.rbox(0.75, 0.55, 1.6, 0, 0.275, 0, M.porcelain, 0.06);
  it.rbox(0.6, 0.06, 1.42, 0, 0.53, 0, M.tiles, 0.04);
  it.add(tubeAlong([V(0, 0.55, -0.78), V(0, 0.75, -0.78), V(0, 0.76, -0.66)], 0.012, 8), M.metal);
  it.col(0.75, 0.58, 1.6, 0, 0.29, 0);
  return it;
}

// ------------------------------------------------------------------ office / storage
export function desk(rnd) {
  const M = archMaterials();
  const it = new Item([1.3, 0.78, 0.7]);
  const wood = rnd() < 0.5 ? M.wood : M.woodDark;
  it.rbox(1.3, 0.035, 0.7, 0, 0.76, 0, wood, 0.008);
  it.rbox(0.4, 0.72, 0.64, 0.42, 0.37, 0, wood, 0.008);
  for (let i = 0; i < 3; i++) it.rbox(0.36, 0.2, 0.02, 0.42, 0.15 + i * 0.22, 0.33, wood, 0.005);
  it.rbox(0.04, 0.72, 0.64, -0.62, 0.37, 0, wood, 0.006);
  it.rbox(0.8, 0.5, 0.02, -0.2, 0.48, -0.3, wood, 0.004);
  it.col(1.3, 0.78, 0.7, 0, 0.39, 0);
  it.lootAt(-0.2, 0.79, 0.05, 'desk');
  return it;
}

export function filingCabinet(rnd) {
  const M = archMaterials();
  const it = new Item([0.45, 1.3, 0.6]);
  it.rbox(0.45, 1.3, 0.6, 0, 0.65, 0, M.metalGreen, 0.01);
  for (let i = 0; i < 4; i++) {
    it.rbox(0.41, 0.28, 0.02, 0, 0.18 + i * 0.31, 0.3, M.metalGreen, 0.006);
    it.rbox(0.12, 0.025, 0.03, 0, 0.26 + i * 0.31, 0.32, M.metal, 0.005);
  }
  it.col(0.45, 1.3, 0.6, 0, 0.65, 0);
  it.lootAt(0, 1.31, 0, 'office');
  return it;
}

export function metalShelf(rnd, w = 1.2, h = 1.9, d = 0.45) {
  const M = archMaterials();
  const it = new Item([w, h, d]);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) it.rbox(0.035, h, 0.035, sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02), M.metalPainted, 0.004);
  for (let i = 0; i < 5; i++) {
    const y = 0.1 + (i * (h - 0.15)) / 4;
    it.rbox(w, 0.02, d, 0, y, 0, M.metalPainted, 0.004);
    if (i < 4) it.lootAt(((i % 2) - 0.5) * w * 0.4, y + 0.02, 0, 'storage');
    // boxes and cans
    let x = -w / 2 + 0.06;
    while (x < w / 2 - 0.12) {
      if (rnd() < 0.35) {
        x += 0.15;
        continue;
      }
      const bw = 0.15 + rnd() * 0.25,
        bh = 0.12 + rnd() * 0.2;
      it.rbox(bw, bh, Math.min(d - 0.05, 0.25 + rnd() * 0.15), x + bw / 2, y + 0.01 + bh / 2, (rnd() - 0.5) * 0.05, rnd() < 0.5 ? M.cardboard || M.fabricBrown : M.mattress, 0.006);
      x += bw + 0.03;
    }
  }
  it.col(w, h, d, 0, h / 2, 0);
  return it;
}

export function workbench(rnd) {
  const M = archMaterials();
  const it = new Item([2.0, 1.9, 0.75]);
  it.rbox(2.0, 0.06, 0.75, 0, 0.88, 0, M.woodDark, 0.006);
  legs4(it, 1.94, 0.7, 0.86, 0.035, M.woodDark, 0.04, false);
  it.rbox(1.9, 0.03, 0.66, 0, 0.25, 0, M.woodDark, 0.004);
  // pegboard
  it.rbox(2.0, 1.0, 0.03, 0, 1.45, -0.36, M.planks, 0.004);
  // vise
  it.rbox(0.12, 0.1, 0.18, 0.8, 0.96, 0.25, M.metalGreen, 0.01);
  // tools on pegboard
  for (let i = 0; i < 7; i++) {
    const x = -0.8 + i * 0.26;
    it.rbox(0.03, 0.22 + rnd() * 0.1, 0.02, x, 1.45, -0.33, i % 2 ? M.metal : M.metalRed, 0.006);
  }
  it.col(2.0, 0.9, 0.75, 0, 0.45, 0);
  it.lootAt(-0.4, 0.92, 0.05, 'tools');
  it.lootAt(0.3, 0.92, 0.05, 'tools');
  return it;
}

// ------------------------------------------------------------------ shop
// A product in its packaging: uvs squeezed into one cell of the goods atlas.
function inCell(g, cell) {
  const n = 8;
  const cx = cell % n,
    cy = Math.floor(cell / n);
  const uv = g.attributes.uv;
  // the atlas's first row is at the top of the canvas (uv v = 1)
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (cx + 0.02 + uv.getX(i) * 0.96) / n, 1 - (cy + 0.98 - uv.getY(i) * 0.96) / n);
  return g;
}

// One kind of product as the shop stocks it: cans, boxes, bags, bottles, sized to their row.
function product(cell, x, y, z, rnd, rotY = 0) {
  const row = Math.floor(cell / 8);
  let g;
  if (row < 2 || row === 4 || row === 5) {
    // cans and bottles: label round the side
    const r = row === 5 ? 0.055 : row === 4 ? 0.033 : 0.038;
    const h = row === 5 ? 0.24 : row === 4 ? 0.12 : 0.11;
    g = new THREE.CylinderGeometry(r, r, h, 12, 1, false);
    g.translate(0, h / 2, 0);
  } else if (row === 2) {
    g = new THREE.BoxGeometry(0.19, 0.27, 0.07);
    g.translate(0, 0.135, 0);
  } else if (row === 3) {
    // crisp bags: puffed, wider at the middle
    g = new THREE.BoxGeometry(0.16, 0.24, 0.07, 1, 3, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * (0.6 + 0.8 * (1 - Math.abs(p.getY(i)) / 0.12)));
    g.computeVertexNormals();
    g.translate(0, 0.12, 0);
  } else {
    g = new THREE.BoxGeometry(0.1 + (cell % 3) * 0.02, 0.07 + (cell % 2) * 0.05, 0.04);
    g.translate(0, 0.045 + (cell % 2) * 0.025, 0);
  }
  inCell(g, cell);
  g.rotateY(rotY + (rnd() - 0.5) * 0.15);
  g.translate(x, y, z);
  return g;
}

export function gondola(rnd, len = 2.4) {
  const M = archMaterials();
  const it = new Item([len, 1.5, 0.9]);
  it.rbox(len, 1.45, 0.08, 0, 0.75, 0, M.metalPainted, 0.008);
  it.rbox(len, 0.12, 0.9, 0, 0.06, 0, M.metalWhite, 0.01);
  // end caps
  for (const s of [-1, 1]) it.rbox(0.04, 1.5, 0.9, s * (len / 2 + 0.02), 0.75, 0, M.metalWhite, 0.008);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const y = 0.15 + i * 0.36;
      it.rbox(len - 0.04, 0.02, 0.38, 0, y, side * 0.23, M.metalWhite, 0.004);
      // price strip along the shelf edge
      it.rbox(len - 0.04, 0.035, 0.008, 0, y - 0.005, side * 0.42, M.trimWhite || M.plastic, 0.002);
      if (i > 0) it.lootAt((rnd() - 0.5) * len * 0.6, y + 0.02, side * 0.24, 'shop');
      // facings: runs of the same product, gaps where the shelf was picked over
      let x = -len / 2 + 0.06;
      const rowKinds = i === 3 ? [2, 3] : i === 2 ? [0, 1, 6] : i === 1 ? [0, 1, 7] : [4, 5];
      while (x < len / 2 - 0.12) {
        const kind = rowKinds[Math.floor(rnd() * rowKinds.length)];
        const cell = kind * 8 + Math.floor(rnd() * 8);
        const n = 2 + Math.floor(rnd() * 5);
        const wdt = kind === 2 ? 0.2 : kind === 3 ? 0.17 : kind === 5 ? 0.12 : kind >= 6 ? 0.12 : 0.085;
        for (let k = 0; k < n && x < len / 2 - 0.08; k++) {
          // the odd missing one, the odd one knocked over
          if (rnd() < 0.3) {
            x += wdt;
            continue;
          }
          const front = side * (0.38 - wdt * 0.2);
          if (rnd() < 0.05) {
            const g = product(cell, 0, 0, 0, rnd);
            g.rotateZ(Math.PI / 2);
            g.translate(x, y + 0.04, front);
            it.add(g, M.goods);
          } else it.add(product(cell, x, y + 0.01, front, rnd, side > 0 ? 0 : Math.PI), M.goods);
          // a second row behind the first
          if (rnd() < 0.6) it.add(product(cell, x, y + 0.01, front - side * 0.1, rnd, side > 0 ? 0 : Math.PI), M.goods);
          x += wdt;
        }
        x += 0.02 + (rnd() < 0.35 ? 0.2 + rnd() * 0.3 : 0);
      }
    }
  }
  // dropped on the floor when the place was picked over
  for (let k = 0; k < 2 + Math.floor(rnd() * 4); k++) {
    const g = product(Math.floor(rnd() * 48), 0, 0, 0, rnd);
    g.rotateZ(rnd() < 0.6 ? Math.PI / 2 : 0);
    g.rotateY(rnd() * 6.28);
    g.translate((rnd() - 0.5) * len, 0.04, (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.3));
    it.add(g, M.goods);
  }
  it.col(len, 1.5, 0.9, 0, 0.75, 0);
  return it;
}

export function cooler(rnd, doors = 2) {
  const M = archMaterials();
  const w = doors * 0.75;
  const it = new Item([w, 2.0, 0.8]);
  it.rbox(w, 2.0, 0.78, 0, 1.0, 0, M.metalWhite, 0.01);
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + 0.375 + i * 0.75;
    it.rbox(0.68, 1.6, 0.03, x, 1.0, 0.39, M.metal, 0.01);
    it.rbox(0.6, 1.5, 0.01, x, 1.0, 0.405, M.glassDirty, 0.004);
    for (let s = 0; s < 4; s++) {
      it.rbox(0.62, 0.015, 0.6, x, 0.4 + s * 0.38, 0, M.metal, 0.003);
      it.lootAt(x, 0.42 + s * 0.38, 0.1, 'drinks');
      const brand = 32 + Math.floor(rnd() * 8);
      for (let b = 0; b < 6; b++) {
        if (rnd() < 0.4) continue;
        it.add(product(b % 3 === 2 ? 32 + Math.floor(rnd() * 8) : brand, x - 0.25 + b * 0.1, 0.42 + s * 0.38, 0.1, rnd), M.goods);
      }
    }
  }
  // lit header
  it.rbox(w, 0.18, 0.04, 0, 1.88, 0.4, M.emissiveWarm, 0.01);
  it.col(w, 2.0, 0.8, 0, 1.0, 0);
  return it;
}

export function shopCounter(rnd) {
  const M = archMaterials();
  const it = new Item([2.2, 1.2, 0.7]);
  it.rbox(2.2, 0.95, 0.65, 0, 0.475, 0, M.woodDark, 0.01);
  it.box(2.25, 0.04, 0.72, 0, 0.97, 0, M.linoleum);
  // register
  it.rbox(0.36, 0.14, 0.32, 0.5, 1.06, 0, M.plasticDark, 0.02);
  const scr = roundedBox(0.22, 0.14, 0.02, 0.01, 1);
  scr.rotateX(-0.4);
  scr.translate(0.5, 1.2, -0.08);
  it.add(scr, M.screen);
  // cigarette rack behind
  it.col(2.2, 1.0, 0.7, 0, 0.5, 0);
  it.lootAt(-0.5, 0.99, 0.05, 'counter');
  return it;
}

export function boothSeat(rnd) {
  const M = archMaterials();
  const it = new Item([1.2, 1.1, 1.6]);
  const vinyl = stdMat({ color: rnd() < 0.5 ? 0x8a2020 : 0x2b5a6b, roughness: 0.4, clearcoat: 0.3 }, true);
  for (const s of [-1, 1]) {
    it.rbox(1.2, 0.45, 0.5, 0, 0.225, s * 0.55, vinyl, 0.05);
    it.rbox(1.2, 0.6, 0.16, 0, 0.75, s * 0.74, vinyl, 0.06);
  }
  it.rbox(1.0, 0.04, 0.7, 0, 0.75, 0, M.linoleum, 0.01);
  const leg = new THREE.CylinderGeometry(0.04, 0.12, 0.73, 12);
  leg.translate(0, 0.365, 0);
  it.add(leg, M.metal);
  it.col(1.2, 1.0, 1.6, 0, 0.5, 0);
  it.lootAt(0, 0.77, 0, 'table');
  return it;
}

export function stool(rnd) {
  const M = archMaterials();
  const it = new Item([0.4, 0.75, 0.4]);
  it.add(latheY([[0, 0.72], [0.18, 0.72], [0.19, 0.68], [0.17, 0.64], [0, 0.64]], 16), stdMat({ color: 0x8a2020, roughness: 0.4, clearcoat: 0.3 }, true));
  const p = new THREE.CylinderGeometry(0.03, 0.03, 0.64, 10);
  p.translate(0, 0.32, 0);
  it.add(p, M.metal);
  it.add(new THREE.CylinderGeometry(0.18, 0.2, 0.03, 16).translate(0, 0.015, 0), M.metal);
  return it;
}

// ------------------------------------------------------------------ outdoor & clutter
export function barrel(rnd) {
  const M = archMaterials();
  const it = new Item([0.6, 0.9, 0.6]);
  const mat = [M.metalRed, M.metalGreen, M.corrugatedRust, M.metalPainted][Math.floor(rnd() * 4)];
  it.add(
    latheY(
      [
        [0, 0],
        [0.28, 0],
        [0.29, 0.02],
        [0.29, 0.28],
        [0.3, 0.3],
        [0.29, 0.32],
        [0.29, 0.58],
        [0.3, 0.6],
        [0.29, 0.62],
        [0.29, 0.88],
        [0.28, 0.9],
        [0, 0.9],
      ],
      24
    ),
    mat
  );
  it.col(0.58, 0.9, 0.58, 0, 0.45, 0);
  return it;
}

export function crate(rnd, s = 0.6) {
  const M = archMaterials();
  const it = new Item([s, s, s]);
  const w = M.wood;
  const t = 0.02;
  for (const f of [
    [0, s / 2, s / 2 - t / 2, s, s, t],
    [0, s / 2, -s / 2 + t / 2, s, s, t],
    [s / 2 - t / 2, s / 2, 0, t, s, s - 2 * t],
    [-s / 2 + t / 2, s / 2, 0, t, s, s - 2 * t],
    [0, s - t / 2, 0, s - 2 * t, t, s - 2 * t],
    [0, t / 2, 0, s - 2 * t, t, s - 2 * t],
  ])
    it.box(f[3], f[4], f[5], f[0], f[1], f[2], w);
  // battens
  for (const zz of [-1, 1]) {
    it.box(s + 0.01, 0.06, 0.02, 0, 0.06, zz * (s / 2 + 0.005), M.woodDark);
    it.box(s + 0.01, 0.06, 0.02, 0, s - 0.06, zz * (s / 2 + 0.005), M.woodDark);
  }
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

export function ceilingLamp() {
  const M = archMaterials();
  const it = new Item([0.3, 0.2, 0.3]);
  it.add(latheY([[0.0, 0.0], [0.04, 0.0], [0.05, -0.02], [0.012, -0.03], [0.012, -0.08], [0.16, -0.14], [0.17, -0.16], [0.0, -0.13]], 20), M.metalWhite);
  it.add(new THREE.SphereGeometry(0.05, 12, 8).translate(0, -0.13, 0), M.emissiveWarm);
  return it;
}

export function curtain(w, h, mat) {
  const it = new Item([w, h, 0.05]);
  const g = new THREE.PlaneGeometry(w, h, Math.max(4, Math.round(w * 20)), 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 26) * 0.025);
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

export { Item, mulberry32 };
