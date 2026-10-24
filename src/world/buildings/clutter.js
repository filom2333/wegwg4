// Junk of an abandoned place: what fell, was dropped, knocked over, blown in and left. Each maker
// returns an Item (furniture.js) in its own frame (origin on the floor, front +z); the small ones
// have no collider (they are walked through), the bigger ones a box. clutterRoom() and
// clutterYard() strew them through a room once its furniture stands, and round a house.

import * as THREE from 'three';
import { roundedBox, latheY, tubeAlong, shapeFromPoints } from '../../gfx/geom.js';
import { archMaterials, stdMat } from './materials.js';
import { Item, place, chair, stool, pictureFrame, fridge, sofa, tirePile, barrel, crate, metreUV, cushion, toppled, partsOf, moveParts, papers, cardboardBox } from './furniture.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A straight member of section w x t from a to b (a box stood on a and turned to point at b).
function bar(a, b, w, t) {
  const d = b.clone().sub(a);
  const len = d.length();
  const g = new THREE.BoxGeometry(w, len, t).translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a, q, V(1, 1, 1)));
}

// Lay parts down on their side (or back) at (x, z): see toppled().
const lieDown = (it, parts, rx, rz, x, z, ry) => toppled(parts, rx, rz, x, z, ry).forEach(([g, m]) => it.add(g, m));

// ------------------------------------------------------------------ pieces
// A stepladder: treads between the front stiles, back legs hinged at the top cap, the paint shelf
// and spreaders. Stood open, folded against a wall (back at -z), or lying on its side.
export function stepladder(rnd, pose = null) {
  const M = archMaterials();
  pose = pose || (rnd() < 0.35 ? 'open' : rnd() < 0.55 ? 'lying' : 'leaning');
  const mat = rnd() < 0.4 ? M.chromeOld : M.wood;
  const H = 1.3 + rnd() * 0.5;
  const it = new Item([0.55, H, 0.6]);
  const parts = [];
  const open = pose === 'open';
  const fz = open ? H * 0.19 : 0.05,
    bz = open ? -H * 0.19 : -0.04;
  for (const s of [-1, 1]) {
    parts.push([bar(V(s * 0.22, 0, fz), V(s * 0.17, H - 0.03, 0.02), 0.025, 0.065), mat]);
    parts.push([bar(V(s * 0.2, 0, bz), V(s * 0.17, H - 0.05, -0.02), 0.025, 0.045), mat]);
  }
  const steps = 4;
  for (let k = 1; k <= steps; k++) {
    const t = k / (steps + 1);
    const z = fz + (0.02 - fz) * t;
    parts.push([new THREE.BoxGeometry(0.4 - 0.05 * t, 0.022, 0.1).translate(0, t * (H - 0.05), z - 0.01), mat]);
  }
  parts.push([roundedBox(0.42, 0.04, 0.16, 0.008, 1).translate(0, H - 0.01, 0.0), mat]);
  if (open) {
    // the paint shelf swung down, the spreaders locked
    parts.push([new THREE.BoxGeometry(0.34, 0.016, 0.16).translate(0, H * 0.66, bz * 0.3 - 0.06), mat]);
    for (const s of [-1, 1]) parts.push([bar(V(s * 0.2, H * 0.4, fz * 0.6), V(s * 0.2, H * 0.4, bz * 0.6), 0.01, 0.004), M.chromeOld]);
  }
  const m4 = new THREE.Matrix4();
  if (pose === 'lying') {
    lieDown(it, parts, 0, Math.PI / 2, 0, 0, rnd() * 6.28);
    it.col(H, 0.4, 0.5, 0, 0.2, 0);
    return it;
  }
  if (pose === 'leaning') {
    m4.makeTranslation(0, 0, 0.12).multiply(new THREE.Matrix4().makeRotationX(-0.22));
    it.leans = true;
  }
  moveParts(it, parts, m4);
  if (open) it.col(0.5, H, H * 0.38, 0, H / 2, 0);
  return it;
}

// Boards dropped in a heap: some whole, some snapped off short with splintered ends, one end of a
// board up on another.
export function planks(rnd) {
  const M = archMaterials();
  const it = new Item([2.0, 0.15, 1.4]);
  const n = 2 + Math.floor(rnd() * 4);
  for (let k = 0; k < n; k++) {
    const L = rnd() < 0.4 ? 0.5 + rnd() * 0.6 : 1.2 + rnd() * 0.8;
    const w = 0.09 + rnd() * 0.1,
      t = 0.022;
    const g = metreUV(new THREE.BoxGeometry(w, t, L));
    // a splintered end: the far corners pulled out unevenly
    if (rnd() < 0.5) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) p.setZ(i, p.getZ(i) + (p.getX(i) > 0 ? 0.06 : -0.04) * rnd());
      g.computeVertexNormals();
    }
    const tilt = k > 0 && rnd() < 0.35 ? 0.05 + rnd() * 0.08 : 0;
    g.translate(0, t / 2, 0).rotateX(tilt).rotateY(rnd() * Math.PI).translate((rnd() - 0.5) * 0.8, tilt ? 0.02 : k * 0.0005, (rnd() - 0.5) * 0.5);
    it.add(g, rnd() < 0.5 ? M.wood : M.woodDark);
  }
  return it;
}

// Plaster down from the ceiling: chunks and a broken sheet on a patch of dust, and above them the
// hole they came from with the laths hanging out of it.
export function fallenPlaster(rnd, ceilingY = 3.0) {
  const M = archMaterials();
  const it = new Item([1.2, 0.2, 1.2]);
  it.add(new THREE.CircleGeometry(0.55 + rnd() * 0.25, 14).rotateX(-Math.PI / 2).translate(0, 0.003, 0), M.dust);
  for (let k = 0; k < 6 + Math.floor(rnd() * 10); k++) {
    const g = new THREE.IcosahedronGeometry(0.03 + rnd() * 0.08, 0);
    g.scale(1, 0.35 + rnd() * 0.3, 0.6 + rnd() * 0.6).rotateY(rnd() * 6);
    const r = rnd() * 0.5,
      a = rnd() * 6.28;
    it.add(g.translate(Math.cos(a) * r, 0.015, Math.sin(a) * r), M.rubble);
  }
  if (rnd() < 0.6) it.add(new THREE.BoxGeometry(0.5 + rnd() * 0.3, 0.012, 0.35 + rnd() * 0.2).rotateZ(0.12).rotateY(rnd() * 3).translate(0.1, 0.05, 0), M.rubble);
  // the hole: the dark of the roof space through a ragged gap, its broken edge sagging, laths
  // hanging out of it
  const pts = [];
  const n = 13;
  const rim = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = 0.25 + rnd() * 0.22;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    rim.push([a, r, r + 0.05 + rnd() * 0.09, 0.015 + rnd() * 0.045]);
  }
  it.add(new THREE.ShapeGeometry(shapeFromPoints(pts)).rotateX(Math.PI / 2).translate(0, ceilingY - 0.004, 0), stdMat({ color: 0x120e0a, roughness: 1 }));
  const rp = [];
  for (let k = 0; k < n; k++) {
    const [a0, r0, R0, s0] = rim[k],
      [a1, r1, R1, s1] = rim[(k + 1) % n];
    const p = (a, r, y) => V(Math.cos(a) * r, ceilingY - y, -Math.sin(a) * r);
    const i0 = p(a0, r0, s0),
      i1 = p(a1, r1, s1),
      o0 = p(a0, R0, 0.003),
      o1 = p(a1, R1, 0.003);
    rp.push(i0, o0, i1, i1, o0, o1);
  }
  const rg = new THREE.BufferGeometry().setFromPoints(rp);
  rg.computeVertexNormals();
  it.add(rg, M.rubble);
  for (let k = 0; k < 3; k++) {
    const x = (rnd() - 0.5) * 0.4;
    const L = 0.2 + rnd() * 0.5;
    it.add(new THREE.BoxGeometry(0.035, 0.008, L).translate(0, 0, -L / 2).rotateX(-0.6 - rnd() * 0.7).translate(x, ceilingY - 0.01, 0.2), M.wood);
  }
  return it;
}

// Sand blown in: a drift highest against its back edge (a doorway or a window), thinning out
// into the room, uneven along its length.
export function sandDrift(rnd, w = 1.4, d = 1.2) {
  const M = archMaterials();
  const it = new Item([w, 0.2, d]);
  const g = new THREE.PlaneGeometry(w, d, 14, 12).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const h = 0.06 + rnd() * 0.1;
  const ph = rnd() * 6;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2),
      t = (p.getZ(i) + d / 2) / d; // 0 at the back edge
    const along = 0.75 + 0.25 * Math.sin(x * 3.1 + ph);
    const y = h * Math.pow(Math.max(0, 1 - t), 1.6) * Math.max(0, 1 - x * x) * along;
    p.setY(i, y + 0.004);
  }
  g.computeVertexNormals();
  // uvs in metres for the grain
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
  it.add(g, M.sand);
  return it;
}

// A rubbish bag, tied off: full and lumpy at the bottom, gathered to a neck, slumped to one side.
export function trashBag(rnd) {
  const M = archMaterials();
  const it = new Item([0.5, 0.5, 0.5]);
  const H = 0.36 + rnd() * 0.12;
  const g = latheY([[0, 0], [0.15, 0], [0.2, 0.04], [0.215, 0.14], [0.2, H * 0.62], [0.14, H * 0.82], [0.05, H * 0.93], [0.035, H], [0, H]], 18, 0, Math.PI * 2);
  const p = g.attributes.position;
  const s = rnd() * 100;
  const lean = (rnd() - 0.5) * 0.25;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const a = Math.atan2(z, x);
    // lumps of what is inside, creases where the plastic is drawn tight
    const k = 1 + 0.1 * Math.sin(a * 3 + s) * Math.sin(y * 14 + s * 0.5) + 0.04 * Math.sin(a * 11 + y * 30);
    p.setXYZ(i, x * k + lean * y, y * (y > 0.02 ? 0.92 : 1), z * k * 0.9);
  }
  g.computeVertexNormals();
  const mat = rnd() < 0.8 ? M.trashBag : stdMat({ color: 0x3a4a30, roughness: 0.4 }, true);
  it.add(g, mat);
  // the tied ears
  for (const s2 of [-1, 1]) it.add(new THREE.ConeGeometry(0.025, 0.08, 5).rotateZ(s2 * 1.2).translate(lean * H + s2 * 0.04, H * 0.97, 0), mat);
  return it;
}

// A heap of clothes: a few garments dropped one on another.
export function clothesPile(rnd) {
  const M = archMaterials();
  const it = new Item([0.8, 0.2, 0.7]);
  const mats = [M.fabricBlue, M.fabricRed, M.fabric, M.fabricBrown, M.fabricGreen, M.trimDark];
  for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) {
    const g = cushion(0.35 + rnd() * 0.25, 0.04 + rnd() * 0.03, 0.3 + rnd() * 0.25, { r: 0.02, puff: 0.02 });
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.sin(p.getX(i) * 17 + k) * 0.012 * Math.sin(p.getZ(i) * 13));
    g.computeVertexNormals();
    it.add(g.rotateY(rnd() * 3).translate((rnd() - 0.5) * 0.3, 0.02 + k * 0.03, (rnd() - 0.5) * 0.25), mats[Math.floor(rnd() * mats.length)]);
  }
  return it;
}

// Empty bottles and cans: some standing, most lying, the cans stepped on.
export function bottles(rnd) {
  const M = archMaterials();
  const it = new Item([0.8, 0.3, 0.8]);
  const bottle = latheY([[0, 0], [0.032, 0], [0.034, 0.01], [0.034, 0.17], [0.026, 0.2], [0.013, 0.24], [0.013, 0.29], [0.015, 0.295], [0.0, 0.295]], 12);
  for (let k = 0; k < 2 + Math.floor(rnd() * 5); k++) {
    const x = (rnd() - 0.5) * 0.6,
      z = (rnd() - 0.5) * 0.6;
    if (rnd() < 0.55) {
      const g = bottle.clone();
      const glass = rnd() < 0.5 ? M.bottleBrown : M.bottleGreen;
      if (rnd() < 0.7) g.rotateZ(Math.PI / 2).rotateY(rnd() * 6.28).translate(x, 0.034, z);
      else g.translate(x, 0, z);
      it.add(g, glass);
    } else {
      // a can, crushed flat or just dented, its paint faded
      const crushed = rnd() < 0.6;
      const g = new THREE.CylinderGeometry(0.033, 0.033, 0.12, 12, 3);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const k = crushed ? 1 + 0.25 * Math.cos(y * 60) : 1;
        p.setXYZ(i, p.getX(i) * k, y * (crushed ? 0.3 : 1), p.getZ(i) * k);
      }
      g.computeVertexNormals();
      if (!crushed) g.rotateZ(Math.PI / 2);
      g.rotateY(rnd() * 6.28).translate(x, crushed ? 0.018 : 0.033, z);
      it.add(g, stdMat({ color: [0x8a2a22, 0x2a4a7a, 0xb8b2a4, 0x3a6a3a][Math.floor(rnd() * 4)], roughness: 0.5, metalness: 0.5 }));
    }
  }
  return it;
}

// A picture come off its nail: face down on the floor, or propped at the foot of the wall.
export function fallenPicture(rnd) {
  const it = new Item([0.7, 0.6, 0.3]);
  const pic = partsOf(pictureFrame(rnd));
  if (rnd() < 0.5) lieDown(it, pic, -Math.PI / 2, 0, 0, 0, rnd() * 6.28);
  else for (const [g, m] of pic) it.add(g.rotateX(-0.25).translate(0, 0.22, -0.08), m);
  return it;
}

// A bucket (galvanised or plastic) with its wire handle, standing or kicked over.
export function bucket(rnd) {
  const M = archMaterials();
  const it = new Item([0.4, 0.35, 0.4]);
  const mat = rnd() < 0.5 ? M.chromeOld : stdMat({ color: [0x2a5a9a, 0xc8a030, 0x9a2a22][Math.floor(rnd() * 3)], roughness: 0.6 });
  const parts = [
    [latheY([[0, 0.004], [0.11, 0.004], [0.115, 0.0], [0.14, 0.27], [0.15, 0.28], [0.145, 0.285], [0.132, 0.27], [0.106, 0.012], [0, 0.012]], 18), mat],
    [tubeAlong([V(-0.145, 0.24, 0), V(-0.1, 0.36, 0), V(0.1, 0.36, 0), V(0.145, 0.24, 0)], 0.003, 4, { closedEnds: false }), M.chromeOld],
  ];
  if (rnd() < 0.4) lieDown(it, parts, 0, Math.PI / 2, 0, 0, rnd() * 6.28);
  else for (const [g, m] of parts) it.add(g, m);
  return it;
}

// A tumbleweed blown in: a ball of dry twigs.
export function tumbleweed(rnd) {
  const M = archMaterials();
  const it = new Item([0.7, 0.6, 0.7]);
  const R = 0.22 + rnd() * 0.12;
  for (let k = 0; k < 26; k++) {
    const a = V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(R);
    const b = V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(R);
    const mid = a.clone().add(b).multiplyScalar(0.5).multiplyScalar(1.25);
    it.add(tubeAlong([a, mid, b], 0.004, 3, { closedEnds: false }).translate(0, R * 0.9, 0), M.tumbleweed);
  }
  return it;
}

// A mattress stood on its edge against a wall (back at -z), stained.
export function mattressLeaning(rnd) {
  const M = archMaterials();
  const w = rnd() < 0.5 ? 1.4 : 0.95;
  const it = new Item([w + 0.1, 1.95, 0.6]);
  const g = cushion(w, 1.9, 0.18, { r: 0.05, puff: 0.015, seg: 3 });
  g.rotateX(-0.18).translate(0, 0.95, 0.0);
  it.add(g, M.mattress);
  it.col(w, 1.9, 0.3, 0, 0.95, 0.0);
  it.leans = true;
  return it;
}

// A suitcase dropped open, its lid flung back, clothes spilling out.
export function suitcase(rnd) {
  const M = archMaterials();
  const it = new Item([0.8, 0.4, 0.9]);
  const shell = [M.fabricBrown, M.vinylRed, M.trimDark, M.fabricBlue][Math.floor(rnd() * 4)];
  const W = 0.62,
    D = 0.42;
  it.rbox(W, 0.1, D, 0, 0.05, 0, shell, 0.02);
  it.box(W - 0.04, 0.004, D - 0.04, 0, 0.098, 0, M.fabric);
  const lid = roundedBox(W, 0.07, D, 0.02, 1);
  lid.translate(0, 0.035, -D / 2).rotateX(-(1.9 + rnd() * 0.6)).translate(0, 0.1, -D / 2);
  it.add(lid, shell);
  for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) it.add(cushion(0.3 + rnd() * 0.2, 0.04, 0.25, { r: 0.02, puff: 0.02 }).rotateY((rnd() - 0.5) * 1.5).translate((rnd() - 0.5) * 0.3, 0.11 + k * 0.03, (rnd() - 0.3) * 0.3), [M.fabricRed, M.fabricBlue, M.fabric, M.fabricGreen][Math.floor(rnd() * 4)]);
  it.rbox(0.12, 0.02, 0.025, 0, 0.06, D / 2 + 0.01, M.trimDark, 0.008);
  return it;
}

// Broken glass under a window.
export function glassShards(rnd) {
  const M = archMaterials();
  const it = new Item([1.0, 0.02, 0.8]);
  for (let k = 0; k < 8 + Math.floor(rnd() * 10); k++) {
    const s = 0.02 + rnd() * 0.08;
    const g = new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(s, 0, s * (rnd() - 0.5)), V(s * rnd(), 0, s)]);
    g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) g.scale(1, 1, -1);
    it.add(g.rotateY(rnd() * 6.28).translate((rnd() - 0.5) * 0.9, 0.003 + rnd() * 0.002, (rnd() - 0.5) * 0.7), M.glass);
  }
  return it;
}

// A chair that came apart: knocked on its back or side, a leg lying off by itself.
export function brokenChair(rnd) {
  const M = archMaterials();
  const it = new Item([0.9, 0.5, 0.9]);
  const c = partsOf(chair(rnd, rnd() < 0.5 ? M.veneer : M.veneerDark, rnd() < 0.3));
  // the parts nearest the front left leg come away (the seat stays with the rest)
  const leg = [];
  const rest = [];
  for (const pr of c) {
    pr[0].computeBoundingBox();
    const b = pr[0].boundingBox;
    (b.max.y < 0.44 && b.min.x < -0.12 && b.min.z > 0.1 && b.max.x - b.min.x < 0.06 ? leg : rest).push(pr);
  }
  lieDown(it, rest, rnd() < 0.5 ? -Math.PI / 2 : 0, rnd() < 0.5 ? Math.PI / 2 : 0, 0, 0, rnd() * 6.28);
  if (leg.length) lieDown(it, leg, 0, Math.PI / 2, 0.45, 0.2, rnd() * 6.28);
  return it;
}

// Cinder blocks: a short stack or a few scattered, the two cores in each.
export function cinderBlocks(rnd) {
  const M = archMaterials();
  const it = new Item([1.0, 0.6, 0.8]);
  const n = 2 + Math.floor(rnd() * 5);
  const stack = rnd() < 0.5;
  for (let k = 0; k < n; k++) {
    const g = [[metreUV(new THREE.BoxGeometry(0.39, 0.19, 0.19)), M.concrete]];
    for (const x of [-0.095, 0.095]) g.push([new THREE.BoxGeometry(0.13, 0.002, 0.11).translate(x, 0.096, 0), M.blackMatte]);
    const m = new THREE.Matrix4();
    if (stack) m.makeRotationY(((k % 2) * Math.PI) / 2 + (rnd() - 0.5) * 0.2).setPosition((rnd() - 0.5) * 0.04, 0.095 + Math.floor(k / 2) * 0.19, (k % 2) * 0.1 - 0.05);
    else m.makeRotationY(rnd() * 6.28).multiply(new THREE.Matrix4().makeRotationX(rnd() < 0.3 ? Math.PI / 2 : 0)).setPosition((rnd() - 0.5) * 0.7, 0.095, (rnd() - 0.5) * 0.5);
    moveParts(it, g, m);
  }
  if (stack) it.col(0.42, Math.ceil(n / 2) * 0.19, 0.42, 0, (Math.ceil(n / 2) * 0.19) / 2, 0);
  return it;
}

// A shipping pallet: deck boards on three stringers, flat on the ground or stood against a wall.
export function pallet(rnd, leaning = null) {
  const M = archMaterials();
  const it = new Item([1.2, 1.1, 0.4]);
  const parts = [];
  for (let k = 0; k < 6; k++) if (rnd() > 0.08) parts.push([metreUV(new THREE.BoxGeometry(1.2, 0.02, 0.1)).translate(0, 0.13, -0.45 + k * 0.18), M.wood]);
  for (const z of [-0.45, 0, 0.45]) parts.push([metreUV(new THREE.BoxGeometry(1.2, 0.1, 0.09)).translate(0, 0.07, z), M.woodDark]);
  for (const z of [-0.45, 0, 0.45]) parts.push([metreUV(new THREE.BoxGeometry(1.2, 0.02, 0.1)).translate(0, 0.01, z), M.wood]);
  leaning = leaning ?? rnd() < 0.4;
  if (leaning) {
    moveParts(it, parts, new THREE.Matrix4().makeTranslation(0, 0, 0.08).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2 + 0.2)).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.5)));
    it.col(1.2, 1.0, 0.25, 0, 0.5, 0);
    it.leans = true;
  } else {
    moveParts(it, parts, new THREE.Matrix4().makeRotationY((rnd() - 0.5) * 0.4));
    it.size = [1.2, 0.15, 1.2];
    it.col(1.2, 0.14, 1.0, 0, 0.07, 0);
  }
  return it;
}

// An old top-loading washing machine dumped outside: enamel cabinet, the lid, the control panel.
export function washer(rnd) {
  const M = archMaterials();
  const it = new Item([0.7, 1.1, 0.7]);
  const body = [M.applianceWhite, M.applianceAlmond, M.applianceAvocado][Math.floor(rnd() * 3)];
  it.rbox(0.68, 0.9, 0.66, 0, 0.45, 0, body, 0.02);
  it.rbox(0.62, 0.02, 0.48, 0, 0.905, 0.06, body, 0.008);
  it.add(new THREE.CircleGeometry(0.2, 18).rotateX(-Math.PI / 2).translate(0, 0.917, 0.06), M.blackMatte);
  it.rbox(0.68, 0.18, 0.12, 0, 0.99, -0.27, body, 0.012);
  for (let k = 0; k < 3; k++) it.add(latheY([[0, 0], [0.022, 0], [0.02, 0.02], [0, 0.022]], 12).rotateX(Math.PI / 2).translate(-0.2 + k * 0.2, 1.0, -0.21), M.plasticDark);
  it.rbox(0.66, 0.06, 0.02, 0, 0.03, 0.33, M.trimDark, 0.004);
  it.col(0.68, 1.08, 0.66, 0, 0.54, 0);
  return it;
}

// Grime on a floor: a few ragged patches of dust and darker dirt, dry leaves and grit blown in.
export function floorGrime(rnd, w = 2.5, d = 2.5) {
  const M = archMaterials();
  const it = new Item([w, 0.01, d]);
  const dark = stdMat({ color: 0x4a3c2c, roughness: 1 });
  for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) {
    const pts = [];
    const R = 0.3 + rnd() * 0.6,
      n = 12;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      const r = R * (0.6 + rnd() * 0.5);
      pts.push([Math.cos(a) * r * 1.4, Math.sin(a) * r]);
    }
    const g = new THREE.ShapeGeometry(shapeFromPoints(pts)).rotateX(-Math.PI / 2).rotateY(rnd() * 3);
    it.add(g.translate((rnd() - 0.5) * (w - 1), 0.002 + k * 0.0004, (rnd() - 0.5) * (d - 1)), rnd() < 0.45 ? M.dust : dark);
  }
  // leaves and grit
  for (let k = 0; k < 10 + Math.floor(rnd() * 20); k++) {
    const s2 = 0.015 + rnd() * 0.03;
    const g = new THREE.CircleGeometry(s2, 4).scale(1, 0.55, 1).rotateX(-Math.PI / 2).rotateY(rnd() * 6);
    it.add(g.translate((rnd() - 0.5) * w, 0.004, (rnd() - 0.5) * d), rnd() < 0.6 ? M.tumbleweed : M.rubble);
  }
  return it;
}

// A clothes line on two T-posts, sagging, a rag still pegged to it.
export function clothesline(rnd) {
  const M = archMaterials();
  const L = 3 + rnd() * 2;
  const it = new Item([L + 0.6, 2.0, 0.8]);
  for (const s2 of [-1, 1]) {
    const x = (s2 * L) / 2;
    it.add(metreUV(new THREE.BoxGeometry(0.07, 1.9, 0.07)).translate(x, 0.95, 0), M.woodDark);
    it.add(metreUV(new THREE.BoxGeometry(0.06, 0.06, 0.7)).translate(x, 1.8, 0), M.woodDark);
    it.col(0.08, 1.9, 0.08, x, 0.95, 0);
  }
  for (const z of [-0.3, 0.3]) {
    if (rnd() < 0.25) continue;
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      pts.push(V(-L / 2 + t * L, 1.8 - 0.25 * Math.sin(t * Math.PI), z));
    }
    it.add(tubeAlong(pts, 0.0025, 3, { closedEnds: false }), M.trimWhite);
    if (rnd() < 0.5) {
      const t = 0.3 + rnd() * 0.4;
      const rag = new THREE.PlaneGeometry(0.35, 0.45, 3, 3).translate(0, -0.225, 0);
      const p = rag.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 12 + p.getY(i) * 5) * 0.03);
      rag.computeVertexNormals();
      it.add(rag.translate(-L / 2 + t * L, 1.8 - 0.25 * Math.sin(t * Math.PI), z), stdMat({ color: [0xb8a888, 0x8a6a5a, 0x6a7a8a][Math.floor(rnd() * 3)], roughness: 1, side: THREE.DoubleSide }));
    }
  }
  return it;
}

// Split firewood stacked against a wall (back at -z), a few logs fallen off it.
export function woodpile(rnd) {
  const M = archMaterials();
  const w = 1.2 + rnd() * 1.0;
  const it = new Item([w, 1.0, 0.6]);
  const bark = stdMat({ color: 0x5a4632, roughness: 1 });
  const rows = 3 + Math.floor(rnd() * 4);
  for (let r = 0; r < rows; r++)
    for (let x = -w / 2 + 0.08; x < w / 2 - 0.05; x += 0.15 + rnd() * 0.03) {
      if (r === rows - 1 && rnd() < 0.4) continue;
      const g = new THREE.CylinderGeometry(0.065, 0.07, 0.45, 6).rotateX(Math.PI / 2).rotateZ(rnd() * 3);
      it.add(g.translate(x, 0.07 + r * 0.13, -0.05 + (rnd() - 0.5) * 0.05), bark);
    }
  for (let k = 0; k < 2; k++) it.add(new THREE.CylinderGeometry(0.06, 0.065, 0.45, 6).rotateZ(Math.PI / 2).rotateY(rnd() * 3).translate((rnd() - 0.5) * w, 0.06, 0.3), bark);
  it.col(w, 0.07 + rows * 0.13, 0.45, 0, (0.07 + rows * 0.13) / 2, -0.05);
  it.leans = true;
  return it;
}

// A run of picket fence gone over: a few pickets still on their rail, the rest down.
export function brokenFence(rnd) {
  const M = archMaterials();
  const it = new Item([2.4, 1.1, 0.8]);
  const paint = rnd() < 0.5 ? M.trimWhite : M.woodDark;
  const lean = 0.2 + rnd() * 0.9;
  const fence = [[metreUV(new THREE.BoxGeometry(2.2, 0.06, 0.03)).translate(0, 0.75, -0.02), paint], [metreUV(new THREE.BoxGeometry(2.2, 0.06, 0.03)).translate(0, 0.3, -0.02), paint]];
  for (let x = -1.0; x <= 1.0; x += 0.16) if (rnd() > 0.25) fence.push([metreUV(new THREE.BoxGeometry(0.08, 1.0, 0.02)).translate(x, 0.5, 0.005), paint]);
  moveParts(it, fence, new THREE.Matrix4().makeRotationX(lean));
  for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) it.add(metreUV(new THREE.BoxGeometry(0.08, 0.02, 1.0)).rotateY(rnd() * 3).translate((rnd() - 0.5) * 1.8, 0.01, 0.3 + rnd() * 0.3), paint);
  return it;
}

// A doghouse: plank walls, a pitched roof, the round-topped door, an empty bowl.
export function doghouse(rnd) {
  const M = archMaterials();
  const it = new Item([0.9, 0.9, 1.0]);
  const w = 0.75,
    d = 0.9,
    h = 0.55;
  for (const s2 of [-1, 1]) it.add(metreUV(new THREE.BoxGeometry(0.02, h, d)).translate((s2 * w) / 2, h / 2, 0), M.planks);
  it.add(metreUV(new THREE.BoxGeometry(w, h, 0.02)).translate(0, h / 2, -d / 2), M.planks);
  const front = new THREE.Shape();
  front.moveTo(-w / 2, 0);
  front.lineTo(w / 2, 0);
  front.lineTo(w / 2, h);
  front.lineTo(0, h + 0.28);
  front.lineTo(-w / 2, h);
  front.closePath();
  const door = new THREE.Path();
  door.moveTo(-0.16, 0.03);
  door.lineTo(0.16, 0.03);
  door.lineTo(0.16, 0.3);
  door.absarc(0, 0.3, 0.16, 0, Math.PI, false);
  door.closePath();
  front.holes.push(door);
  it.add(metreUV(new THREE.ExtrudeGeometry(front, { depth: 0.02, bevelEnabled: false })).translate(0, 0, d / 2 - 0.02), M.planks);
  it.add(metreUV(new THREE.ExtrudeGeometry(front, { depth: 0.02, bevelEnabled: false })).translate(0, 0, -d / 2), M.planks);
  for (const s2 of [-1, 1]) it.add(metreUV(new THREE.BoxGeometry(0.5, 0.02, d + 0.1)).translate((s2 * 0.5) / 2, 0, 0).rotateZ(-s2 * 0.5).translate(0, h + 0.15, 0), M.shingles);
  it.add(latheY([[0, 0], [0.09, 0], [0.11, 0.05], [0.1, 0.05], [0.08, 0.008], [0, 0.008]], 14).translate(0.3, 0, d / 2 + 0.25), M.chromeOld);
  it.col(w, h + 0.2, d, 0, (h + 0.2) / 2, 0);
  return it;
}

// A settee dumped in the yard: tipped on its back, the cushions gone.
function dumpedSofa(rnd) {
  const it = new Item([2.0, 0.9, 1.0]);
  const so = partsOf(sofa(rnd, { seats: 2 + Math.floor(rnd() * 2) }));
  lieDown(it, so, rnd() < 0.5 ? -Math.PI / 2 : 0, 0, 0, 0, 0);
  it.col(1.9, 0.8, 0.9, 0, 0.4, 0);
  return it;
}

// ------------------------------------------------------------------ strewing
// What each kind of room collects, with weights; makers take (rnd) and return an Item.
const ROOM_JUNK = {
  living: [[papers0, 3], [bottles, 2], [clothesPile, 1], [fallenPicture, 1.5], [planks, 1], [fallenPlaster, 0.6], [stepladder, 0.6], [trashBag, 1], [box0, 1.5], [brokenChair, 0.8], [tumbleweed, 0.5], [bucket, 0.5]],
  kitchen: [[papers0, 1.5], [bottles, 2.5], [bucket, 1], [trashBag, 1.5], [box0, 1], [fallenPlaster, 0.5], [brokenChair, 0.6], [planks, 0.6], [tumbleweed, 0.4]],
  bedroom: [[clothesPile, 3], [suitcase, 1.2], [papers0, 1], [box0, 1.5], [fallenPicture, 1], [bottles, 1], [fallenPlaster, 0.5], [mattressLeaning, 0.5], [stepladder, 0.3]],
  bath: [[bottles, 1], [bucket, 1.5], [clothesPile, 0.8], [fallenPlaster, 0.5], [papers0, 0.5]],
};

function papers0(rnd) {
  const it = new Item([1.0, 0.02, 0.8]);
  papers(it, rnd, 3 + Math.floor(rnd() * 8), 0, 0, 0, 0.8);
  return it;
}

function box0(rnd) {
  const it = new Item([0.6, 0.5, 0.6]);
  const n = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < n; k++) cardboardBox(it, rnd, 0.3 + rnd() * 0.2, 0.22 + rnd() * 0.15, 0.25 + rnd() * 0.15, (rnd() - 0.5) * 0.3, k && rnd() < 0.5 ? 0.25 : 0, (rnd() - 0.5) * 0.3, rnd() * 3);
  it.col(0.5, 0.4, 0.5, 0, 0.2, 0);
  return it;
}

const pick = (rnd, list) => {
  let t = list.reduce((s, [, w]) => s + w, 0) * rnd();
  for (const [f, w] of list) if ((t -= w) <= 0) return f;
  return list[0][0];
};

// Strew a room (once its furniture stands, P its RoomPlacer) with what an abandoned house collects:
// clear of the furniture and the door ways, a sand drift at a door or a broken window now and then.
export function clutterRoom(b, P, r, rnd, y, openings, { amount = 1, ceilingY = 3.0 } = {}) {
  const W = r.x1 - r.x0,
    D = r.z1 - r.z0;
  const list = ROOM_JUNK[r.type] || ROOM_JUNK.living;
  // grime over the floor first, then the junk
  place(b, floorGrime(rnd, W - 0.4, D - 0.4), (r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2, 0);
  const n = Math.max(3, Math.min(14, Math.round(W * D * 0.6 * amount)));
  const lootHere = floorLoot(b, y);
  for (let k = 0; k < n; k++) {
    const make = pick(rnd, list);
    const item = make === fallenPlaster ? fallenPlaster(rnd, ceilingY - y) : make(rnd);
    const [w, , d] = item.size;
    const rot = rnd() * Math.PI * 2;
    // what leans goes against a wall, the rest anywhere clear
    if (item.leans) {
      P.wall(item, ['back', 'left', 'right', 'front'].map((v) => [rnd(), v]).sort((p, q) => p[0] - q[0]).map((p) => p[1]), { tall: false });
      continue;
    }
    for (let tries = 0; tries < 8; tries++) {
      const x = r.x0 + 0.3 + w / 2 + rnd() * Math.max(0, W - 0.6 - w),
        z = r.z0 + 0.3 + d / 2 + rnd() * Math.max(0, D - 0.6 - d);
      const half = Math.max(w, d) / 2;
      const box = [x - half, z - half, x + half, z + half];
      if (P.overlaps(box) || lootHere.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) continue;
      place(b, item, x, y, z, rot);
      if (item.cols.length) P.placed.push(box);
      break;
    }
  }
  // sand blown in at a door to the outside or a window (most of the glass is gone by now)
  for (const o of openings) {
    if (rnd() > 0.35 * amount) continue;
    const inside = o.x > r.x0 - 0.3 && o.x < r.x1 + 0.3 && o.z > r.z0 - 0.3 && o.z < r.z1 + 0.3;
    if (!inside || !o.ext) continue;
    const onX = Math.abs(o.z - r.z0) < 0.35 || Math.abs(o.z - r.z1) < 0.35;
    const inward = onX ? (Math.abs(o.z - r.z0) < 0.35 ? 1 : -1) : Math.abs(o.x - r.x0) < 0.35 ? 1 : -1;
    const rot = onX ? (inward > 0 ? 0 : Math.PI) : inward > 0 ? Math.PI / 2 : -Math.PI / 2;
    const dd = 0.9 + rnd() * 0.8;
    const drift = sandDrift(rnd, Math.min(o.w + 0.6, 2.2), dd);
    const off = 0.06 + dd / 2;
    const x = onX ? o.x : o.x + inward * off,
      z = onX ? o.z + inward * off : o.z;
    place(b, drift, x, y, z, rot);
    if (o.type === 'window') place(b, glassShards(rnd), onX ? o.x : o.x + inward * 0.5, y, onX ? o.z + inward * 0.5 : o.z, rnd() * 6);
  }
}

// Strew the ground round a house (plan in house coordinates, the porch at the front, +z): tyres,
// drums, blocks, pallets, boards, a dumped washer or fridge, the ladder somebody left out.
export function clutterYard(b, plan, rnd, { amount = 1 } = {}) {
  const { x0, x1, z0, z1 } = plan;
  const makers = [
    [tirePile, 1.5],
    [barrel, 1.5],
    [cinderBlocks, 1.5],
    [pallet, 1.2],
    [planks, 1.2],
    [washer, 0.5],
    [dumpedFridge, 0.4],
    [stepladder, 0.5],
    [trashBag, 1],
    [bottles, 1],
    [crate, 0.8],
    [bucket, 0.7],
    [brokenChair, 0.6],
    [tumbleweed, 1.2],
    [woodpile, 0.8],
    [brokenFence, 0.8],
    [doghouse, 0.35],
    [dumpedSofa, 0.35],
    [clothesline, 0.5],
  ];
  const n = Math.round((6 + rnd() * 7) * amount);
  const placed = [];
  for (let k = 0; k < n; k++) {
    const make = pick(rnd, makers);
    const item = make(rnd);
    // a side of the house (not the front where the porch and path are), a little off the wall
    const side = Math.floor(rnd() * 3);
    const off = 0.7 + rnd() * 1.6;
    let x, z, rot;
    if (side === 0) {
      x = x0 + 0.5 + rnd() * (x1 - x0 - 1);
      z = z0 - off;
      rot = Math.PI;
    } else {
      x = side === 1 ? x0 - off : x1 + off;
      z = z0 + 0.5 + rnd() * (z1 - z0 - 1);
      rot = side === 1 ? -Math.PI / 2 : Math.PI / 2;
    }
    const big = Math.max(item.size[0], item.size[2]) > 1.6;
    if (item.leans || big) {
      // stood against the wall with its back to it, or (a long thing) laid along it clear of it
      const back = item.leans ? item.size[2] / 2 + 0.13 : item.size[2] / 2 + 0.5 + rnd() * 1.2;
      if (side === 0) z = z0 - back;
      else x = side === 1 ? x0 - back : x1 + back;
    } else {
      rot = rnd() * Math.PI * 2;
      // far enough out that turning it does not put it through the wall
      const clear = Math.hypot(item.size[0], item.size[2]) / 2 + 0.15;
      if (side === 0) z = Math.min(z, z0 - clear);
      else x = side === 1 ? Math.min(x, x0 - clear) : Math.max(x, x1 + clear);
    }
    const half = Math.max(item.size[0], item.size[2]) / 2 + 0.1;
    if (placed.some(([px, pz, ph]) => Math.abs(px - x) < ph + half && Math.abs(pz - z) < ph + half)) continue;
    placed.push([x, z, half]);
    place(b, item, x, 0, z, rot);
  }
}

// A fridge dumped outside on its back, the door hanging off.
function dumpedFridge(rnd) {
  const it = new Item([1.8, 0.8, 0.8]);
  const f = partsOf(fridge(rnd));
  lieDown(it, f, -Math.PI / 2, 0, 0, 0, 0);
  it.col(1.7, 0.75, 0.75, 0, 0.37, 0);
  return it;
}

// ------------------------------------------------------------------ more pieces, for other places
// Spilt oil gone black and tacky on a garage floor or a forecourt.
export function oilStain(rnd) {
  const it = new Item([1.4, 0.01, 1.4]);
  const pts = [];
  const R = 0.35 + rnd() * 0.5;
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    pts.push([Math.cos(a) * R * (0.6 + rnd() * 0.5), Math.sin(a) * R * (0.6 + rnd() * 0.5)]);
  }
  it.add(new THREE.ShapeGeometry(shapeFromPoints(pts)).rotateX(-Math.PI / 2).translate(0, 0.004, 0), stdMat({ color: 0x0e0d0c, roughness: 0.25, metalness: 0.1 }));
  return it;
}

// A few old paint tins, one tipped over with its lid off.
export function paintTins(rnd) {
  const M = archMaterials();
  const it = new Item([0.6, 0.25, 0.5]);
  for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) {
    const g = latheY([[0, 0], [0.078, 0], [0.081, 0.006], [0.079, 0.012], [0.079, 0.17], [0.082, 0.176], [0.079, 0.182], [0, 0.182]], 16);
    const x = (rnd() - 0.5) * 0.4,
      z = (rnd() - 0.5) * 0.3;
    if (rnd() < 0.3) g.rotateZ(Math.PI / 2).rotateY(rnd() * 6).translate(x, 0.08, z);
    else g.translate(x, 0, z);
    it.add(g, rnd() < 0.5 ? M.chromeOld : stdMat({ color: [0xb8382a, 0x2f5f8a, 0xe8e2d0, 0x3d6b3a][Math.floor(rnd() * 4)], roughness: 0.6, metalness: 0.3 }));
  }
  return it;
}

// A hubcap lying face up (or face down), dented.
export function hubcap(rnd) {
  const M = archMaterials();
  const it = new Item([0.45, 0.06, 0.45]);
  const g = latheY([[0, 0.05], [0.04, 0.05], [0.09, 0.04], [0.15, 0.03], [0.19, 0.012], [0.2, 0.0], [0.19, 0.0], [0.0, 0.03]], 20);
  if (rnd() < 0.4) g.rotateX(Math.PI).translate(0, 0.05, 0);
  it.add(g.rotateZ((rnd() - 0.5) * 0.15).translate(0, 0.01, 0), M.chrome);
  return it;
}

// A sack of feed or cement: burlap or paper, slumped, sometimes split.
export function feedSack(rnd) {
  const M = archMaterials();
  const it = new Item([0.8, 0.3, 0.6]);
  const mat = rnd() < 0.5 ? M.sandbag : stdMat({ color: 0xc9c2b0, roughness: 1 });
  for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) {
    const g = cushion(0.42, 0.13, 0.65, { r: 0.06, puff: 0.04, sag: 0.02 });
    it.add(g.rotateY(rnd() * 3).translate((rnd() - 0.5) * 0.25, 0.065 + k * 0.12, (rnd() - 0.5) * 0.2), mat);
  }
  it.col(0.6, 0.2, 0.6, 0, 0.1, 0);
  return it;
}

// A wheelbarrow: steel tray, two handles, the wheel at the front; upright or tipped over.
export function wheelbarrow(rnd) {
  const M = archMaterials();
  const it = new Item([0.7, 0.6, 1.5]);
  const tray = rnd() < 0.5 ? M.drumGreen : M.drumRed;
  const parts = [
    [loftSectionsTray(), tray],
    [tubeAlong([V(-0.25, 0.32, -0.75), V(-0.22, 0.42, -0.2), V(-0.08, 0.3, 0.45), V(0, 0.22, 0.55)], 0.016, 6), M.chromeOld],
    [tubeAlong([V(0.25, 0.32, -0.75), V(0.22, 0.42, -0.2), V(0.08, 0.3, 0.45), V(0, 0.22, 0.55)], 0.016, 6), M.chromeOld],
    [new THREE.TorusGeometry(0.16, 0.05, 8, 18).rotateY(Math.PI / 2).translate(0, 0.21, 0.55), M.rubber],
    [new THREE.CylinderGeometry(0.06, 0.06, 0.06, 10).rotateZ(Math.PI / 2).translate(0, 0.21, 0.55), M.chromeOld],
  ];
  for (const s2 of [-1, 1]) parts.push([tubeAlong([V(s2 * 0.2, 0.36, -0.35), V(s2 * 0.22, 0.0, -0.4)], 0.014, 5), M.chromeOld]);
  if (rnd() < 0.35) lieDown(it, parts, 0, Math.PI / 2, 0, 0, rnd() * 6.28);
  else for (const [g, m] of parts) it.add(g, m);
  it.col(0.6, 0.5, 1.3, 0, 0.25, 0);
  return it;
}
function loftSectionsTray() {
  // the tray: a deep pan wider at the top, its front sloped
  const rows = [
    [0.18, 0.2, 0.3],
    [0.3, 0.38, 0.45],
    [0.34, 0.45, 0.62],
  ];
  const secs = rows.map(([a, b, y]) => {
    const out = [];
    for (let k = 0; k < 20; k++) {
      const t = (k / 20) * Math.PI * 2;
      out.push(V(Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** 0.5 * a, y, Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** 0.5 * b + (y - 0.3) * 0.4));
    }
    return out;
  });
  const g = new THREE.BufferGeometry();
  const pos = [];
  for (let r = 0; r < secs.length - 1; r++)
    for (let k = 0; k < 20; k++) {
      const a = secs[r][k],
        b = secs[r][(k + 1) % 20],
        c = secs[r + 1][(k + 1) % 20],
        d = secs[r + 1][k];
      pos.push(a, b, d, b, c, d, a, d, b, b, d, c);
    }
  for (let k = 1; k < 19; k++) pos.push(secs[0][0], secs[0][k], secs[0][k + 1], secs[0][0], secs[0][k + 1], secs[0][k]);
  g.setFromPoints(pos);
  g.computeVertexNormals();
  return g;
}

// A folding camp chair: aluminium X legs, a sagging canvas seat; open, or folded and dropped.
export function campChair(rnd) {
  const M = archMaterials();
  const it = new Item([0.6, 0.9, 0.6]);
  const cloth = stdMat({ color: [0x2a4a7a, 0x8a2a22, 0x3d6b3a, 0xc8823c][Math.floor(rnd() * 4)], roughness: 1, side: THREE.DoubleSide });
  const parts = [];
  for (const s2 of [-1, 1]) {
    parts.push([tubeAlong([V(s2 * 0.25, 0, 0.25), V(s2 * 0.25, 0.45, -0.2)], 0.01, 5), M.chromeOld]);
    parts.push([tubeAlong([V(s2 * 0.25, 0, -0.22), V(s2 * 0.25, 0.45, 0.22)], 0.01, 5), M.chromeOld]);
    parts.push([tubeAlong([V(s2 * 0.25, 0.42, -0.22), V(s2 * 0.25, 0.85, -0.3)], 0.01, 5), M.chromeOld]);
  }
  const seat = new THREE.PlaneGeometry(0.5, 0.45, 4, 4).rotateX(-Math.PI / 2);
  const p = seat.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, -0.05 * (1 - (p.getX(i) / 0.25) ** 2));
  seat.computeVertexNormals();
  parts.push([seat.translate(0, 0.45, 0), cloth]);
  parts.push([new THREE.PlaneGeometry(0.5, 0.38).rotateX(0.18).translate(0, 0.66, -0.26), cloth]);
  if (rnd() < 0.4) lieDown(it, parts, rnd() < 0.5 ? -Math.PI / 2 : 0, rnd() < 0.5 ? Math.PI / 2 : 0, 0, 0, rnd() * 6.28);
  else for (const [g, m] of parts) it.add(g, m);
  return it;
}

// A kettle barbecue on three legs, its lid off beside it, the ash gone hard.
export function kettleGrill(rnd) {
  const M = archMaterials();
  const it = new Item([0.7, 1.0, 0.7]);
  const black = M.enamelBlack;
  it.add(latheY([[0, 0.55], [0.2, 0.58], [0.28, 0.68], [0.29, 0.78], [0.27, 0.78], [0.26, 0.69], [0.19, 0.6], [0, 0.57]], 20), black);
  it.add(new THREE.CircleGeometry(0.25, 18).rotateX(-Math.PI / 2).translate(0, 0.72, 0), stdMat({ color: 0x8a8580, roughness: 1 }));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    it.add(tubeAlong([V(Math.cos(a) * 0.2, 0.6, Math.sin(a) * 0.2), V(Math.cos(a) * 0.32, 0.0, Math.sin(a) * 0.32)], 0.012, 5), M.chromeOld);
  }
  const lid = latheY([[0, 0.3], [0.08, 0.29], [0.2, 0.22], [0.28, 0.08], [0.29, 0.0], [0.27, 0.0], [0.26, 0.07], [0.18, 0.2], [0, 0.27]], 20);
  if (rnd() < 0.6) it.add(lid.rotateX(Math.PI / 2 - 0.3).translate(0.45, 0.28, 0.2), black);
  else it.add(lid.translate(0, 0.78, 0), black);
  it.col(0.6, 0.8, 0.6, 0, 0.4, 0);
  return it;
}

// A propane bottle, standing or rolled over, its collar and valve.
export function propaneTank(rnd) {
  const M = archMaterials();
  const it = new Item([0.4, 0.6, 0.4]);
  const parts = [
    [latheY([[0, 0], [0.13, 0], [0.155, 0.04], [0.155, 0.38], [0.13, 0.45], [0.05, 0.47], [0, 0.47]], 16), rnd() < 0.5 ? M.applianceWhite : M.drumBlue],
    [latheY([[0.06, 0.45], [0.09, 0.47], [0.09, 0.56], [0.08, 0.56], [0.075, 0.48]], 12), M.chromeOld],
    [new THREE.CylinderGeometry(0.018, 0.018, 0.08, 8).translate(0, 0.51, 0), M.chromeOld],
  ];
  if (rnd() < 0.4) lieDown(it, parts, 0, Math.PI / 2, 0, 0, rnd() * 6.28);
  else for (const [g, m] of parts) it.add(g, m);
  it.col(0.32, 0.5, 0.32, 0, 0.25, 0);
  return it;
}

// Broken crockery: halves and shards of plates and a cup.
export function brokenPlates(rnd) {
  const M = archMaterials();
  const it = new Item([0.8, 0.05, 0.8]);
  for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) {
    const a0 = rnd() * 6.28,
      len = 0.8 + rnd() * 2.2;
    const g = latheY([[0.06, 0], [0.11, 0.014], [0.115, 0.018], [0.1, 0.012], [0.05, 0.004]], 12, a0, len);
    it.add(g.rotateY(rnd() * 6).translate((rnd() - 0.5) * 0.6, 0.002, (rnd() - 0.5) * 0.6), M.porcelainOld);
  }
  for (let k = 0; k < 6 + Math.floor(rnd() * 8); k++) {
    const s = 0.015 + rnd() * 0.03;
    it.add(new THREE.CircleGeometry(s, 3).rotateX(-Math.PI / 2).rotateY(rnd() * 6).translate((rnd() - 0.5) * 0.7, 0.003, (rnd() - 0.5) * 0.7), M.porcelainOld);
  }
  return it;
}

// A stool knocked over.
export function fallenStool(rnd) {
  const it = new Item([0.8, 0.45, 0.8]);
  lieDown(it, partsOf(stool(rnd)), 0, Math.PI / 2, 0, 0, rnd() * 6.28);
  return it;
}

// A housekeeping cart left on the walkway: shelves of towels, a bin bag hung off the end.
export function maidCart(rnd) {
  const M = archMaterials();
  const it = new Item([1.2, 1.1, 0.6]);
  for (const y of [0.15, 0.55, 0.95]) it.rbox(1.0, 0.03, 0.45, 0, y, 0, M.plasticDark, 0.008);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) it.add(new THREE.CylinderGeometry(0.012, 0.012, 0.95, 6).translate(sx * 0.48, 0.55, sz * 0.2), M.chromeOld);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) it.add(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10).rotateZ(Math.PI / 2).translate(sx * 0.45, 0.04, sz * 0.18), M.rubber);
  for (let k = 0; k < 4; k++) if (rnd() < 0.6) it.add(cushion(0.25, 0.12, 0.3, { r: 0.03, puff: 0.02 }).translate(-0.35 + k * 0.23, 0.6 + 0.06, 0), M.mattress);
  it.add(cushion(0.3, 0.5, 0.25, { r: 0.08, puff: 0.04 }).translate(0.65, 0.5, 0), M.trashBag);
  it.col(1.0, 1.0, 0.45, 0, 0.5, 0);
  return it;
}

// Straw spread over a floor in tufts.
export function strawLitter(rnd) {
  const it = new Item([2.5, 0.05, 2.5]);
  const straw = stdMat({ color: 0xc8a860, roughness: 1, side: THREE.DoubleSide });
  for (let k = 0; k < 30; k++) {
    const g = new THREE.PlaneGeometry(0.3 + rnd() * 0.3, 0.04 + rnd() * 0.05).rotateX(-Math.PI / 2 + (rnd() - 0.5) * 0.3).rotateY(rnd() * 6);
    it.add(g.translate((rnd() - 0.5) * 2.2, 0.01 + rnd() * 0.02, (rnd() - 0.5) * 2.2), straw);
  }
  return it;
}

// Boxes round the loot spots on the floor at height y (things are put down there).
const floorLoot = (b, y) => b.loot.filter((l) => Math.abs(l.pos[1] - y) < 0.3).map((l) => [l.pos[0] - 0.45, l.pos[2] - 0.45, l.pos[0] + 0.45, l.pos[2] + 0.45]);

// Strew a rectangle (a shop floor, a workshop, a forecourt) with what `list` ([maker, weight])
// holds, clear of the boxes in `keep` ([x0, z0, x1, z1]: what stands there, ways through doors).
export function clutterArea(b, rnd, [x0, z0, x1, z1], y, list, n, keep = []) {
  const placed = [];
  // never on top of a spot where loot lies on the floor
  keep = [...keep, ...floorLoot(b, y)];
  for (let k = 0; k < n; k++) {
    const make = pick(rnd, list);
    const item = make(rnd);
    const half = Math.hypot(item.size[0], item.size[2]) / 2 * 0.8;
    for (let tries = 0; tries < 10; tries++) {
      const x = x0 + half + rnd() * Math.max(0, x1 - x0 - 2 * half),
        z = z0 + half + rnd() * Math.max(0, z1 - z0 - 2 * half);
      const box = [x - half, z - half, x + half, z + half];
      const hit = (q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1];
      if (keep.some(hit) || (item.cols.length && placed.some(hit))) continue;
      place(b, item, x, y, z, rnd() * Math.PI * 2);
      if (item.cols.length) placed.push(box);
      break;
    }
  }
}

export const JUNK = {
  garage: [[planks, 1.2], [cinderBlocks, 1], [bucket, 0.8], [box0, 1.2], [oilStain, 1.6], [paintTins, 1.2], [hubcap, 0.8], [papers0, 0.6], [trashBag, 0.6], [stepladder, 0.5], [bottles, 0.6], [pallet, 0.4]],
  shop: [[papers0, 2], [box0, 2], [bottles, 1.2], [trashBag, 1], [glassShards, 0.8], [fallenPlaster, 0.6], [tumbleweed, 0.8], [floorGrime, 1.2]],
  forecourt: [[tumbleweed, 2], [trashBag, 1], [oilStain, 1.5], [box0, 0.6], [cinderBlocks, 0.6], [bottles, 1], [pallet, 0.5], [hubcap, 0.5], [papers0, 0.6]],
  // the same where cars drive: nothing that would stop one
  lot: [[tumbleweed, 2], [trashBag, 1], [oilStain, 1.5], [box0, 0.6], [bottles, 1], [hubcap, 0.5], [papers0, 0.6]],
  motelRoom: [[clothesPile, 2], [suitcase, 1.2], [bottles, 1.5], [papers0, 1], [trashBag, 0.8], [fallenPlaster, 0.6], [floorGrime, 1], [tumbleweed, 0.4]],
  walkway: [[campChair, 1.2], [trashBag, 1], [bottles, 1], [tumbleweed, 1.5], [box0, 0.5], [bucket, 0.6]],
  diner: [[brokenPlates, 2], [fallenStool, 1.2], [papers0, 1.5], [bottles, 1], [trashBag, 0.8], [box0, 0.6], [floorGrime, 1.2], [tumbleweed, 0.6], [glassShards, 0.6]],
  barn: [[strawLitter, 2], [feedSack, 1.5], [bucket, 1], [wheelbarrow, 0.8], [planks, 1], [pallet, 0.8], [cinderBlocks, 0.5], [brokenChair, 0.4]],
  trailerYard: [[campChair, 1.5], [kettleGrill, 0.8], [propaneTank, 0.8], [trashBag, 1], [bottles, 1.2], [cinderBlocks, 1], [tumbleweed, 1], [bucket, 0.6], [box0, 0.5]],
};
