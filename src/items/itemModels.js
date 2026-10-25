// Procedural models for loose items. Each builder returns a THREE.Group whose origin is the
// item's centre of mass; models are detailed but compact (they are seen up close in the hand).

import * as THREE from 'three';
import { latheY, roundedBox, tubeAlong, loftSections, superSection, shapeFromPoints } from '../gfx/geom.js';
import { crtTV } from '../world/buildings/furniture.js';
import { mulberry32 } from '../core/noise.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeCanvas, canvasTexture, cached } from '../gfx/textures.js';
import { ALBUMS } from '../audio/music/albums.js';
import { addSurfaceDetail } from '../gfx/triplanar.js';
import { paintOf } from '../vehicle/paints.js';
import { accessoryItemModel } from '../vehicle/accessories.js';
import { plateModel } from '../vehicle/plates.js';
import { jackModel } from '../vehicle/jack.js';
import { carbKitModel } from '../vehicle/tuning.js';
import { tentBagModel } from '../world/tents.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

let MAT = null;
export function itemMats() {
  if (MAT) return MAT;
  MAT = {
    jerryRed: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x8e2a1e, roughness: 0.55, metalness: 0.35 }), 'cast', 0.3),
    jerryGreen: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x4d5a36, roughness: 0.6, metalness: 0.3 }), 'cast', 0.3),
    steel: new THREE.MeshStandardMaterial({ color: 0xa3a6a8, roughness: 0.35, metalness: 0.9 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x2b2c2e, roughness: 0.4, metalness: 0.85 }),
    blued: new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.3, metalness: 0.9 }),
    walnut: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x5a3622, roughness: 0.5 }), 'grain', 0.3),
    plasticBlue: new THREE.MeshPhysicalMaterial({ color: 0x6fa0c8, roughness: 0.15, transmission: 0, transparent: true, opacity: 0.55, depthWrite: false }),
    capBlue: new THREE.MeshStandardMaterial({ color: 0x1f56a8, roughness: 0.4 }),
    capWhite: new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.4 }),
    water: new THREE.MeshPhysicalMaterial({ color: 0xa8c8d8, roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
    cardboard: new THREE.MeshStandardMaterial({ color: 0xa88458, roughness: 0.95 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x55603d, roughness: 0.7 }),
    yellowPlastic: new THREE.MeshStandardMaterial({ color: 0xd9a619, roughness: 0.45 }),
    greenPlastic: new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.45 }),
    redPaint: new THREE.MeshStandardMaterial({ color: 0xb3261b, roughness: 0.4, metalness: 0.3 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc89b3c, roughness: 0.3, metalness: 1 }),
    glassAmber: new THREE.MeshPhysicalMaterial({ color: 0x8a5a1a, roughness: 0.05, transparent: true, opacity: 0.7, depthWrite: false }),
    lanternGlow: new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffc070, emissiveIntensity: 0, roughness: 0.3, transparent: true, opacity: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xc4c1b9, roughness: 0.6 }),
    fabric: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x5b6046, roughness: 0.95 }), 'weave', 0.3),
  };
  return MAT;
}

function labelTex(key, w, h, draw) {
  return cached('label:' + key, () => {
    const c = makeCanvas(w, h);
    draw(c.getContext('2d'), w, h);
    return canvasTexture(c, { wrap: true });
  });
}

function labelMat(key, w, h, draw, opts = {}) {
  return cached('labelmat:' + key, () => new THREE.MeshStandardMaterial({ map: labelTex(key, w, h, draw), roughness: opts.roughness ?? 0.55, metalness: opts.metalness ?? 0 }));
}

function mesh(g, m, cast = true) {
  const x = new THREE.Mesh(g, m);
  x.castShadow = cast;
  x.receiveShadow = true;
  return x;
}

function centered(group) {
  const b = new THREE.Box3().setFromObject(group);
  const c = b.getCenter(new THREE.Vector3());
  for (const ch of group.children) ch.position.sub(c);
  for (const k of ['grip', 'grip2']) if (group.userData[k]) group.userData[k].p.sub(c);
  if (group.userData.muzzle) group.userData.muzzle.sub(c);
  group.userData.size = b.getSize(new THREE.Vector3());
  return group;
}

// Declares where a hand closes on the model (model space, before centring): `cls` is the hold
// (wrap/palm/side/tool/pistol/rifle), `pose` the hand pose, `thumb` the direction the thumb side
// of the fist points along the handle, `back` the direction the back of the hand faces.
function grip(g, cls, pose, p, thumb, back, which = 'grip') {
  g.userData[which] = { cls, pose, p, thumb: thumb.clone().normalize(), back: back.clone().normalize() };
  return g;
}
const UP = V(0, 1, 0),
  RIGHT = V(1, 0, 0),
  DOWN = V(0, -1, 0);

// ------------------------------------------------------------------ containers
export function jerryCan(color = 'red') {
  const M = itemMats();
  const g = new THREE.Group();
  const mat = color === 'red' ? M.jerryRed : M.jerryGreen;
  // body: 0.34 x 0.47 x 0.165 with the X-press pattern
  const body = roundedBox(0.165, 0.42, 0.34, 0.025, 3);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    if (Math.abs(x) > 0.07) {
      const xm = Math.abs(Math.abs(y / 0.18) - Math.abs(z / 0.15));
      const dent = Math.max(0, 1 - xm * 4) * 0.008 * (Math.abs(y) < 0.18 && Math.abs(z) < 0.15 ? 1 : 0);
      p.setX(i, x - Math.sign(x) * dent);
    }
  }
  body.computeVertexNormals();
  g.add(mesh(body, mat));
  // the pressed X and the frame round it on both faces, the weld seam round the edge
  for (const sx of [-1, 1]) {
    const x = sx * 0.0835;
    for (const a of [0.69, -0.69]) g.add(mesh(roundedBox(0.007, 0.43, 0.02, 0.003, 1).rotateX(a).translate(x, 0, 0), mat));
    for (const y of [-0.172, 0.172]) g.add(mesh(roundedBox(0.007, 0.018, 0.3, 0.003, 1).translate(x, y, 0), mat));
    for (const z of [-0.142, 0.142]) g.add(mesh(roundedBox(0.007, 0.36, 0.018, 0.003, 1).translate(x, 0, z), mat));
  }
  g.add(mesh(roundedBox(0.012, 0.007, 0.3, 0.003, 1).translate(0, 0.212, 0), mat));
  g.add(mesh(roundedBox(0.012, 0.007, 0.3, 0.003, 1).translate(0, -0.212, 0), mat));
  g.add(mesh(roundedBox(0.012, 0.37, 0.007, 0.003, 1).translate(0, 0, 0.172), mat));
  g.add(mesh(roundedBox(0.012, 0.37, 0.007, 0.003, 1).translate(0, 0, -0.172), mat));
  // three-bar handle
  for (const z of [-0.07, 0, 0.07]) g.add(mesh(roundedBox(0.03, 0.06, 0.018, 0.008, 2).translate(0, 0.24, z - 0.05), mat));
  g.add(mesh(roundedBox(0.035, 0.022, 0.2, 0.01, 2).translate(0, 0.28, -0.05), mat));
  // spout with cap
  const spout = latheY([[0.026, 0], [0.026, 0.035], [0.03, 0.04], [0.03, 0.07], [0.0, 0.07]], 18);
  spout.rotateX(0.5);
  spout.translate(0, 0.205, 0.13);
  g.add(mesh(spout, M.darkSteel));
  // the screw cap (off while pouring)
  const cap = mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.024, 16).rotateX(0.5).translate(0, 0.27, 0.165), mat);
  cap.name = 'cap';
  g.add(cap);
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6).rotateZ(Math.PI / 2).translate(0, 0.25, 0.1), M.darkSteel));
  grip(g, 'side', 'wrap12', V(0, 0.28, -0.05), V(0, 0, 1), V(-1, 0, 0));
  return centered(g);
}

export function waterBottle() {
  const M = itemMats();
  const g = new THREE.Group();
  const prof = [
    [0, 0],
    [0.04, 0.002],
    [0.043, 0.01],
    [0.043, 0.06],
    [0.04, 0.07],
    [0.043, 0.08],
    [0.043, 0.21],
    [0.035, 0.25],
    [0.016, 0.275],
    [0.015, 0.29],
  ];
  g.add(mesh(latheY(prof, 28), M.plasticBlue, false));
  const water = latheY(
    [
      [0, 0.004],
      [0.039, 0.006],
      [0.04, 0.2],
      [0, 0.2],
    ],
    20
  );
  water.name = 'fill';
  const wm = mesh(water, M.water, false);
  wm.name = 'fill';
  g.add(wm);
  const cap = mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.022, 16).translate(0, 0.3, 0), M.capBlue);
  cap.name = 'cap';
  g.add(cap);
  const label = labelMat('water', 256, 64, (c, w, h) => {
    c.fillStyle = '#e9f1f4';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#2462a8';
    c.fillRect(0, 0, w, 10);
    c.font = 'bold 28px Arial';
    c.fillText('SPRING WATER 1.5L', 14, 44);
  });
  g.add(mesh(new THREE.CylinderGeometry(0.0435, 0.0435, 0.07, 28, 1, true).translate(0, 0.14, 0), label, false));
  grip(g, 'wrap', 'wrap40', V(0, 0.13, 0), UP, RIGHT);
  return centered(g);
}

export function sodaCan(brand = 0) {
  const M = itemMats();
  const g = new THREE.Group();
  const cols = [
    ['#b81d1d', 'COLA'],
    ['#2e7d32', 'LIME UP'],
    ['#e0a314', 'ORANGE'],
  ][brand % 3];
  const m = labelMat('soda' + brand, 256, 128, (c, w, h) => {
    c.fillStyle = cols[0];
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff';
    c.font = 'bold 44px Arial';
    c.fillText(cols[1], 30, 80);
    c.fillRect(0, 100, w, 6);
  }, { metalness: 0.6, roughness: 0.3 });
  g.add(mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.1, 24, 1, true).translate(0, 0.06, 0), m));
  g.add(mesh(latheY([[0.0, 0.0], [0.026, 0.0], [0.033, 0.01], [0.033, 0.011]], 24), M.steel));
  g.add(mesh(latheY([[0.033, 0.109], [0.03, 0.118], [0.028, 0.12], [0.0, 0.118]], 24), M.steel));
  grip(g, 'wrap', 'wrap33', V(0, 0.058, 0), UP, RIGHT);
  return centered(g);
}

export function cannedFood(kind = 'beans') {
  const M = itemMats();
  const g = new THREE.Group();
  const spec = { beans: ['#8a3b1d', 'BAKED BEANS'], meat: ['#7c1f2a', 'CORNED BEEF'], soup: ['#c8b22a', 'TOMATO SOUP'], peaches: ['#d08a2a', 'PEACHES'] }[kind] || ['#777', 'FOOD'];
  const m = labelMat('can' + kind, 256, 128, (c, w, h) => {
    c.fillStyle = spec[0];
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#f1e7cf';
    c.fillRect(0, 34, w, 60);
    c.fillStyle = '#2a1a10';
    c.font = 'bold 30px Georgia';
    c.fillText(spec[1], 18, 74);
  });
  g.add(mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.1, 24, 1, true).translate(0, 0.055, 0), m));
  for (const y of [0, 0.11]) g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.006, 24).translate(0, y + 0.003, 0), M.steel));
  grip(g, 'wrap', 'wrap40', V(0, 0.056, 0), UP, RIGHT);
  return centered(g);
}

export function snackBag(kind = 'chips') {
  const M = itemMats();
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.16, 0.22, 0.05, 8, 10, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const puff = Math.cos((x / 0.08) * Math.PI * 0.5) * Math.cos((y / 0.11) * Math.PI * 0.5);
    p.setZ(i, z * (0.3 + 0.9 * puff));
  }
  geo.computeVertexNormals();
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 0.16 + 0.5, p.getY(i) / 0.22 + 0.5);
  const m = labelMat('snack' + kind, 128, 192, (c, w, h) => {
    c.fillStyle = kind === 'chips' ? '#d7a41e' : '#6b3a1c';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#b3261b';
    c.beginPath();
    c.arc(64, 90, 40, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff';
    c.font = 'bold 22px Arial';
    c.fillText(kind === 'chips' ? 'CRISPS' : 'JERKY', 24, 98);
  }, { roughness: 0.3, metalness: 0.4 });
  g.add(mesh(geo, m));
  for (const y of [-0.115, 0.115]) g.add(mesh(new THREE.BoxGeometry(0.16, 0.012, 0.012).translate(0, y, 0), m));
  grip(g, 'palm', 'palm', V(0.045, 0.06, -0.02), RIGHT, V(0, 0, -1));
  return centered(g);
}

export function sponge() {
  const g = new THREE.Group();
  const m = cached('spongeMat', () => addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0xd9b23a, roughness: 0.95 }), 'cast', 1.2));
  const scour = cached('scourMat', () => new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 1 }));
  g.add(mesh(roundedBox(0.12, 0.035, 0.075, 0.012, 3).translate(0, 0.0175, 0), m));
  g.add(mesh(roundedBox(0.12, 0.01, 0.075, 0.004, 2).translate(0, 0.04, 0), scour));
  grip(g, 'palm', 'palm', V(0.03, 0, 0.012), RIGHT, DOWN);
  return centered(g);
}

// A wire brush: a walnut handle with a steel ferrule, rows of crimped steel bristles under the
// head, and a scraper blade at the nose.
export function wireBrush() {
  const M = itemMats();
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.2, 0.022, 0.034, 0.008, 2).translate(-0.02, 0.011, 0), M.walnut));
  g.add(mesh(roundedBox(0.03, 0.024, 0.036, 0.003, 1).translate(0.075, 0.012, 0), M.steel));
  const bristle = cached('bristleMat', () => new THREE.MeshStandardMaterial({ color: 0x8d8f91, roughness: 0.55, metalness: 0.8 }));
  // the bristle tufts: little boxes in rows under the head
  const tufts = [];
  for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) tufts.push(new THREE.BoxGeometry(0.008, 0.024, 0.006).translate(-0.085 + i * 0.019, -0.012, -0.011 + j * 0.011));
  g.add(mesh(mergeGeometries(tufts), bristle));
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.002, 0.03).translate(0.105, 0.004, 0), M.steel));
  grip(g, 'tool', 'wrap12', V(-0.06, 0.011, 0), RIGHT, UP);
  return centered(g);
}

export function sprayPaint(variant = 0) {
  const M = itemMats();
  const g = new THREE.Group();
  const P = paintOf(variant);
  const css = '#' + P.hex.toString(16).padStart(6, '0');
  const lab = labelMat('spray' + variant, 256, 128, (c, w, h) => {
    c.fillStyle = '#e8e4da';
    c.fillRect(0, 0, w, h);
    c.fillStyle = css;
    c.fillRect(0, 0, w, h * 0.62);
    c.fillStyle = '#1b1b1b';
    c.fillRect(0, h * 0.62, w, 4);
    c.font = 'bold 26px Arial';
    c.fillStyle = P.hex > 0x999999 ? '#1b1b1b' : '#ffffff';
    c.fillText('AUTO ENAMEL', 16, 46);
    c.fillStyle = '#1b1b1b';
    c.font = 'bold 20px Arial';
    c.fillText(P.name.toUpperCase(), 16, h * 0.86);
  }, { metalness: 0.5, roughness: 0.35 });
  g.add(mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.16, 24, 1, true).translate(0, 0.085, 0), lab));
  g.add(mesh(latheY([[0.0, 0.0], [0.03, 0.0], [0.033, 0.005]], 24), M.steel));
  g.add(mesh(latheY([[0.033, 0.165], [0.02, 0.185], [0.012, 0.19], [0.0, 0.19]], 24), M.steel));
  // the cap shows the colour too
  g.add(mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.016, 12).translate(0, 0.198, 0), new THREE.MeshStandardMaterial({ color: P.hex, roughness: 0.4 })));
  grip(g, 'wrap', 'wrap33', V(0, 0.075, 0), UP, RIGHT);
  g.userData.muzzle = V(0, 0.2, 0.012); // the nozzle
  return centered(g);
}

export function cigarettes() {
  const g = new THREE.Group();
  const lab = labelMat('cigs', 128, 192, (c, w, h) => {
    c.fillStyle = '#efe9dc';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#8c1d1d';
    c.fillRect(0, 0, w, 70);
    c.fillStyle = '#111';
    c.font = 'bold 22px Arial';
    c.fillText('DESERT', 18, 110);
    c.font = '14px Arial';
    c.fillText('FILTERS · 20', 18, 135);
  }, { roughness: 0.6 });
  g.add(mesh(roundedBox(0.055, 0.085, 0.022, 0.003, 1).translate(0, 0.0425, 0), lab));
  grip(g, 'palm', 'palm', V(0.012, 0.03, -0.011), RIGHT, V(0, 0, -1));
  return centered(g);
}

export function coffee() {
  const g = new THREE.Group();
  const M = itemMats();
  const lab = labelMat('coffee', 256, 128, (c, w, h) => {
    c.fillStyle = '#3b2416';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8c27a';
    c.font = 'bold 40px Arial';
    c.fillText('COFFEE', 40, 78);
  }, { roughness: 0.4, metalness: 0.3 });
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.11, 24, 1, true).translate(0, 0.06, 0), lab));
  g.add(mesh(latheY([[0.0, 0.0], [0.04, 0.0], [0.04, 0.005]], 24), M.steel));
  g.add(mesh(latheY([[0.04, 0.115], [0.036, 0.122], [0.0, 0.12]], 24), M.steel));
  grip(g, 'wrap', 'wrap40', V(0, 0.058, 0), UP, RIGHT);
  return centered(g);
}

// Steel vacuum flask with an olive sleeve and a cup for a lid.
export function thermos() {
  const g = new THREE.Group();
  const M = itemMats();
  const sleeve = cached('thermosMat', () => addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x4f5b3e, roughness: 0.5, metalness: 0.2 }), 'cast', 0.25));
  g.add(mesh(latheY([[0, 0], [0.042, 0], [0.045, 0.01], [0.045, 0.2], [0.04, 0.215], [0.03, 0.225]], 28), sleeve));
  g.add(mesh(latheY([[0.03, 0.222], [0.046, 0.226], [0.047, 0.29], [0.04, 0.295], [0, 0.297]], 28), M.steel));
  g.add(mesh(new THREE.CylinderGeometry(0.0465, 0.0465, 0.012, 28).translate(0, 0.06, 0), M.steel));
  grip(g, 'wrap', 'wrap40', V(0, 0.11, 0), UP, RIGHT);
  return centered(g);
}

// Wool blanket rolled up and tied with two straps.
export function blanket() {
  const g = new THREE.Group();
  const wool = cached('blanketMat', () => {
    const tex = labelTex('blanketPlaid', 128, 128, (c, w, h) => {
      c.fillStyle = '#7a2f24';
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(30,24,20,0.55)';
      for (const x of [20, 76]) c.fillRect(x, 0, 16, h);
      for (const y of [20, 76]) c.fillRect(0, y, w, 16);
      c.fillStyle = 'rgba(230,200,140,0.35)';
      for (const x of [48, 104]) c.fillRect(x, 0, 3, h);
      for (const y of [48, 104]) c.fillRect(0, y, w, 3);
    });
    return addSurfaceDetail(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.98 }), 'weave', 0.5);
  });
  const roll = new THREE.CylinderGeometry(0.075, 0.075, 0.42, 24, 1);
  roll.rotateZ(Math.PI / 2);
  g.add(mesh(roll, wool));
  const M = itemMats();
  for (const x of [-0.12, 0.12]) g.add(mesh(new THREE.TorusGeometry(0.078, 0.006, 6, 24).rotateY(Math.PI / 2).translate(x, 0, 0), M.rubber));
  grip(g, 'side', 'grip', V(0, 0.075, 0), RIGHT, UP);
  return centered(g);
}

// Fire kit: a bundle of kindling sticks tied with cord, a box of matches tucked in.
export function campfireKit() {
  const g = new THREE.Group();
  const wood = cached('kindlingMat', () => addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 }), 'grain', 0.4));
  const M = itemMats();
  let seed = 3;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const rr = i === 0 ? 0 : 0.032;
    const stick = new THREE.CylinderGeometry(0.014 + r() * 0.006, 0.016 + r() * 0.006, 0.38 + r() * 0.06, 6);
    stick.rotateZ(Math.PI / 2);
    stick.translate((r() - 0.5) * 0.04, Math.sin(a) * rr, Math.cos(a) * rr);
    g.add(mesh(stick, wood));
  }
  for (const x of [-0.09, 0.09]) g.add(mesh(new THREE.TorusGeometry(0.05, 0.004, 5, 18).rotateY(Math.PI / 2).translate(x, 0, 0), M.cardboard));
  const box = labelMat('matches', 64, 32, (c, w, h) => {
    c.fillStyle = '#c8402a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2e3b8';
    c.font = 'bold 12px Arial';
    c.fillText('MATCHES', 6, 20);
  });
  g.add(mesh(roundedBox(0.05, 0.016, 0.035, 0.002, 1).translate(0, 0.05, 0), box));
  grip(g, 'side', 'grip', V(0, 0.05, 0), RIGHT, UP);
  return centered(g);
}

// A piece of meat: a steak with its fat cap down one side, raw (dark red, glistening) or cooked
// over a fire (browned, the grill bars burnt across it).
export function meatChunk(cooked = false) {
  const g = new THREE.Group();
  const mat = cached('meat' + (cooked ? 'C' : 'R'), () =>
    addSurfaceDetail(new THREE.MeshStandardMaterial({ color: cooked ? 0x6a3a1e : 0x8a2420, roughness: cooked ? 0.75 : 0.35 }), 'grain', 0.35)
  );
  const fat = cached('fat' + (cooked ? 'C' : 'R'), () => new THREE.MeshStandardMaterial({ color: cooked ? 0x9a6a3a : 0xe6d6bc, roughness: cooked ? 0.6 : 0.4 }));
  const r = (a) => 1 + 0.12 * Math.sin(3 * a + 1) + 0.07 * Math.sin(5 * a + 0.4);
  const N = 36;
  const outline = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    outline.push([Math.cos(a) * 0.09 * r(a), Math.sin(a) * 0.062 * r(a)]);
  }
  const slab = (pts, t, bevel) => {
    const geo = new THREE.ExtrudeGeometry(shapeFromPoints(pts), { depth: t - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 });
    return geo.translate(0, 0, bevel).rotateX(-Math.PI / 2);
  };
  g.add(mesh(slab(outline, 0.024, 0.007), mat));
  // the fat: a band along the long curved side, a little proud of the meat
  const band = [];
  for (let k = 0; k <= 12; k++) {
    const a = 1.1 + (k / 12) * 1.7;
    band.push([Math.cos(a) * 0.096 * r(a), Math.sin(a) * 0.067 * r(a)]);
  }
  for (let k = 12; k >= 0; k--) {
    const a = 1.1 + (k / 12) * 1.7;
    band.push([Math.cos(a) * 0.075 * r(a), Math.sin(a) * 0.05 * r(a)]);
  }
  g.add(mesh(slab(band, 0.026, 0.006).translate(0, -0.001, 0), fat));
  if (cooked) for (let k = -1; k <= 1; k++) g.add(mesh(new THREE.BoxGeometry(0.15, 0.002, 0.008).rotateY(0.6).translate(k * 0.03, 0.0245, k * 0.012), cached('char', () => new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.9 }))));
  grip(g, 'palm', 'palm', V(0, 0, 0), RIGHT, DOWN);
  return centered(g);
}

// Fishing rod: cork handle, a small spinning reel, a long tapered blank with guides.
export function fishingRod() {
  const g = new THREE.Group();
  const M = itemMats();
  const cork = cached('corkMat', () => addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 }), 'cast', 0.5));
  const blank = cached('rodMat', () => new THREE.MeshStandardMaterial({ color: 0x2a3a2e, roughness: 0.35, metalness: 0.4 }));
  g.add(mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.3, 12).translate(0, 0.15, 0), cork));
  g.add(mesh(new THREE.CylinderGeometry(0.003, 0.009, 1.45, 8).translate(0, 1.02, 0), blank));
  for (let i = 0; i < 5; i++) g.add(mesh(new THREE.TorusGeometry(0.008 - i * 0.0008, 0.0012, 4, 10).rotateY(Math.PI / 2).translate(0.012, 0.45 + i * 0.28, 0), M.steel));
  const reel = new THREE.Group();
  reel.add(mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 16).rotateZ(Math.PI / 2), M.darkSteel));
  reel.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.045, 6).rotateZ(Math.PI / 2).translate(-0.03, 0, 0), M.steel));
  reel.position.set(0.035, 0.34, 0);
  g.add(reel);
  grip(g, 'tool', 'grip', V(0, 0.16, 0), UP, RIGHT);
  return centered(g);
}

// A trout: raw (silvery, speckled) or grilled (golden brown, charred stripes).
// Real models handed over by the prop library once loaded (an item built before that, or when
// one failed to load, keeps its drawn model).
const REAL = {};
export function registerRealModel(id, obj) {
  if (obj) REAL[id] = obj;
}

// variant 0 a carp, 1 a bass (the barramundi scan)
export function fish(cooked = false, variant = 0) {
  const real = (variant === 1 && REAL.bass) || REAL.carp;
  if (real) {
    const g = new THREE.Group();
    const m = real.clone();
    m.position.set(0, 0, 0);
    if (cooked)
      m.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.color.multiply(new THREE.Color(0.62, 0.4, 0.22));
        o.material.roughness = 0.75;
      });
    g.add(m);
    return g;
  }
  const g = new THREE.Group();
  const mat = cached('fishMat' + (cooked ? 'C' : 'R'), () => {
    const tex = labelTex('fishSkin' + (cooked ? 'C' : 'R'), 128, 64, (c, w, h) => {
      const grd = c.createLinearGradient(0, 0, 0, h);
      if (cooked) {
        grd.addColorStop(0, '#5a3418');
        grd.addColorStop(1, '#b07a3c');
      } else {
        grd.addColorStop(0, '#4a5a52');
        grd.addColorStop(0.5, '#b6b9a8');
        grd.addColorStop(1, '#e6e2d6');
      }
      c.fillStyle = grd;
      c.fillRect(0, 0, w, h);
      c.fillStyle = cooked ? 'rgba(20,10,4,0.65)' : 'rgba(30,30,30,0.5)';
      for (let i = 0; i < (cooked ? 6 : 40); i++) {
        if (cooked) c.fillRect(14 + i * 18, 0, 4, h);
        else c.fillRect(Math.random() * w, Math.random() * h * 0.5, 2, 2);
      }
    });
    return new THREE.MeshStandardMaterial({ map: tex, roughness: cooked ? 0.7 : 0.3, metalness: cooked ? 0 : 0.2 });
  });
  const body = new THREE.SphereGeometry(0.06, 20, 12);
  body.scale(2.6, 0.75, 0.42);
  g.add(mesh(body, mat));
  const tail = new THREE.ConeGeometry(0.05, 0.08, 4).rotateZ(Math.PI / 2).scale(1, 1, 0.2).translate(-0.19, 0, 0);
  g.add(mesh(tail, mat));
  grip(g, 'palm', 'palm', V(0, -0.04, 0), RIGHT, DOWN);
  return centered(g);
}

// Folded sheet of paper with handwriting.
export function note() {
  const mat = cached('noteMat', () => {
    const c = makeCanvas(256, 340);
    const x = c.getContext('2d');
    x.fillStyle = '#e9e1cf';
    x.fillRect(0, 0, 256, 340);
    x.strokeStyle = 'rgba(70,90,140,0.25)';
    for (let y = 40; y < 340; y += 18) {
      x.beginPath();
      x.moveTo(0, y);
      x.lineTo(256, y);
      x.stroke();
    }
    x.strokeStyle = 'rgba(30,30,45,0.8)';
    x.lineWidth = 1.6;
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 36; y < 320; y += 18) {
      let px = 18;
      const end = 230 - r() * 60;
      x.beginPath();
      x.moveTo(px, y);
      while (px < end) {
        px += 3 + r() * 5;
        x.lineTo(px, y - 4 + r() * 6);
      }
      x.stroke();
    }
    x.fillStyle = 'rgba(120,90,40,0.12)';
    for (let i = 0; i < 6; i++) {
      x.beginPath();
      x.arc(r() * 256, r() * 340, 10 + r() * 30, 0, Math.PI * 2);
      x.fill();
    }
    return new THREE.MeshStandardMaterial({ map: canvasTexture(c, { wrap: false }), roughness: 0.9, side: THREE.DoubleSide });
  });
  const g = new THREE.Group();
  // two panels with a soft fold in the middle
  const geo = new THREE.PlaneGeometry(0.15, 0.2, 6, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const xx = p.getX(i);
    p.setZ(i, Math.abs(xx) * 0.12 + 0.004 * Math.sin(xx * 60));
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);
  g.add(mesh(geo, mat, false));
  grip(g, 'palm', 'palm', V(0.035, 0, 0.03), RIGHT, DOWN);
  return centered(g);
}

export function chocolate() {
  const g = new THREE.Group();
  const m = labelMat('choc', 256, 64, (c, w, h) => {
    c.fillStyle = '#4a2a1a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#e6c37a';
    c.font = 'bold 30px Georgia';
    c.fillText('DESERT BAR', 40, 44);
  });
  const geo = roundedBox(0.16, 0.012, 0.06, 0.004, 2);
  const p = geo.attributes.position,
    uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 0.16 + 0.5, -p.getZ(i) / 0.06 + 0.5);
  g.add(mesh(geo, m));
  grip(g, 'palm', 'palm', V(0.04, -0.006, 0.01), RIGHT, DOWN);
  return centered(g);
}

export function mre() {
  const M = itemMats();
  const g = new THREE.Group();
  const geo = roundedBox(0.26, 0.05, 0.16, 0.02, 3);
  g.add(mesh(geo, M.olive));
  const m = labelMat('mre', 256, 128, (c, w, h) => {
    c.fillStyle = '#6b6a4a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1a1a10';
    c.font = 'bold 26px Courier New';
    c.fillText('MEAL, READY-TO-EAT', 8, 50);
    c.font = '20px Courier New';
    c.fillText('MENU No. 14  BEEF STEW', 8, 90);
  });
  g.add(mesh(new THREE.PlaneGeometry(0.22, 0.11).rotateX(-Math.PI / 2).translate(0, 0.026, 0), m, false));
  grip(g, 'palm', 'palm', V(0.07, -0.025, 0.03), RIGHT, DOWN);
  return centered(g);
}

export function medkit() {
  const M = itemMats();
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.28, 0.09, 0.2, 0.02, 3), M.white));
  g.add(mesh(roundedBox(0.282, 0.012, 0.202, 0.004, 1).translate(0, 0.0, 0), M.redPaint));
  for (const [w, d] of [
    [0.08, 0.025],
    [0.025, 0.08],
  ])
    g.add(mesh(new THREE.BoxGeometry(w, 0.002, d).translate(0, 0.046, 0), M.redPaint));
  // the carrying handle in the middle of the lid, so the case hangs level from the fist
  g.add(mesh(tubeAlong([V(-0.045, 0.045, 0), V(-0.045, 0.072, 0), V(0.045, 0.072, 0), V(0.045, 0.045, 0)], 0.008, 6), M.rubber));
  grip(g, 'side', 'wrap12', V(0, 0.07, 0), RIGHT, V(0, 0, 1));
  return centered(g);
}

// An elastic bandage: a tight tan roll with the weave showing and the layers at its ends, a few
// turns let go and hanging, held by the two little toothed clips.
export function bandage() {
  const g = new THREE.Group();
  const M = itemMats();
  const crepe = cached('crepe', () => addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0xc4a07a, roughness: 0.95, side: THREE.DoubleSide }), 'weave', 0.8));
  const ends = labelMat('crepeEnds', 128, 128, (c, w, h) => {
    c.fillStyle = '#c09c76';
    c.fillRect(0, 0, w, h);
    for (let k = 0; k < 16; k++) {
      c.strokeStyle = k % 2 ? 'rgba(110,80,50,0.55)' : 'rgba(225,200,170,0.5)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(w / 2, h / 2, 10 + k * 3.4, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = '#6a4c30';
    c.beginPath();
    c.arc(w / 2, h / 2, 9, 0, Math.PI * 2);
    c.fill();
  });
  const R = 0.026,
    L = 0.075;
  const side = new THREE.CylinderGeometry(R, R, L, 28, 6, true);
  // the weave stands out in bands across the width, the edges a shade thicker
  const p = side.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + 0.03 * Math.abs(p.getY(i) / (L / 2)) ** 4;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  side.computeVertexNormals();
  g.add(mesh(side.rotateZ(Math.PI / 2), crepe));
  for (const s of [-1, 1]) g.add(mesh(new THREE.CircleGeometry(R, 28).rotateY((s * Math.PI) / 2).translate((s * L) / 2, 0, 0), ends));
  // the loose end: a short tail curling off the roll
  const tail = new THREE.PlaneGeometry(L * 0.96, 0.05, 1, 8);
  const tp = tail.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const t = (tp.getY(i) + 0.025) / 0.05;
    const a = t * 1.1;
    tp.setXYZ(i, tp.getX(i), (R + 0.0015) * Math.cos(a) - t * t * 0.012, (R + 0.0015) * Math.sin(a) + t * 0.004);
  }
  tail.computeVertexNormals();
  g.add(mesh(tail, crepe));
  // two butterfly clips over the end, their teeth biting the weave
  for (const x of [-0.018, 0.018]) {
    const clip = new THREE.Group();
    clip.add(mesh(roundedBox(0.016, 0.0015, 0.012, 0.0006, 1), M.steel));
    for (const z of [-0.008, 0.008]) clip.add(mesh(new THREE.BoxGeometry(0.012, 0.0012, 0.006).translate(0, -0.0006, z), M.steel));
    clip.position.set(x, R * Math.cos(1.0) + 0.002, R * Math.sin(1.0));
    clip.rotation.x = 1.0;
    g.add(clip);
  }
  grip(g, 'wrap', 'wrap33', V(0, 0, 0), RIGHT, UP);
  return centered(g);
}

export function pillBottle() {
  const M = itemMats();
  const g = new THREE.Group();
  g.add(mesh(latheY([[0, 0], [0.025, 0], [0.026, 0.07], [0, 0.07]], 18), M.glassAmber, false));
  g.add(mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 18).translate(0, 0.08, 0), M.capWhite));
  grip(g, 'wrap', 'wrap24', V(0, 0.035, 0), UP, RIGHT);
  return centered(g);
}

export function oilBottle() {
  const M = itemMats();
  const g = new THREE.Group();
  const body = roundedBox(0.12, 0.22, 0.07, 0.02, 3);
  g.add(mesh(body.translate(0, 0.11, 0), M.yellowPlastic));
  g.add(mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.03, 14, 1, true).translate(0.03, 0.235, 0), M.yellowPlastic));
  const cap = mesh(latheY([[0.017, 0.028], [0.02, 0.033], [0.02, 0.05], [0, 0.05]], 16).translate(0.03, 0.22, 0), M.rubber);
  cap.name = 'cap';
  g.add(cap);
  const m = labelMat('oil', 128, 192, (c, w, h) => {
    c.fillStyle = '#d9a619';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1a1a1a';
    c.fillRect(0, 60, w, 70);
    c.fillStyle = '#d9a619';
    c.font = 'bold 26px Arial';
    c.fillText('MOTOR', 18, 92);
    c.fillText('OIL 1L', 18, 122);
  });
  g.add(mesh(new THREE.PlaneGeometry(0.1, 0.15).translate(0, 0.1, 0.0352), m, false));
  grip(g, 'wrap', 'wrap33', V(0.025, 0.1, 0), UP, RIGHT);
  return centered(g);
}

export function coolantJug() {
  const M = itemMats();
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.16, 0.28, 0.1, 0.025, 3).translate(0, 0.14, 0), M.greenPlastic));
  g.add(mesh(tubeAlong([V(0.03, 0.27, 0), V(0.07, 0.31, 0), V(0.075, 0.2, 0)], 0.012, 6), M.greenPlastic));
  g.add(mesh(new THREE.CylinderGeometry(0.017, 0.018, 0.02, 12, 1, true).translate(-0.04, 0.285, 0), M.greenPlastic));
  const cap = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 14).translate(-0.04, 0.3, 0), M.capWhite);
  cap.name = 'cap';
  g.add(cap);
  grip(g, 'wrap', 'wrap12', V(0.072, 0.25, 0), UP, RIGHT);
  return centered(g);
}

export function waterJug() {
  const M = itemMats();
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.2, 0.3, 0.16, 0.04, 3).translate(0, 0.15, 0), M.plasticBlue, false));
  const fill = mesh(roundedBox(0.185, 0.24, 0.145, 0.03, 2).translate(0, 0.13, 0), M.water, false);
  fill.name = 'fill';
  g.add(fill);
  g.add(mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.02, 14, 1, true).translate(0, 0.305, 0), M.plasticBlue, false));
  const cap = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 16).translate(0, 0.318, 0), M.capBlue);
  cap.name = 'cap';
  g.add(cap);
  g.add(mesh(tubeAlong([V(-0.06, 0.3, 0), V(-0.03, 0.34, 0), V(0.03, 0.34, 0), V(0.06, 0.3, 0)], 0.01, 6), M.capBlue));
  grip(g, 'side', 'wrap12', V(0, 0.34, 0), RIGHT, V(0, 0, 1));
  return centered(g);
}

// ------------------------------------------------------------------ tools & kits
export function repairKit() {
  const M = itemMats();
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.38, 0.14, 0.18, 0.015, 2).translate(0, 0.07, 0), M.redPaint));
  g.add(mesh(roundedBox(0.385, 0.01, 0.185, 0.004, 1).translate(0, 0.1, 0), M.darkSteel));
  g.add(mesh(tubeAlong([V(-0.08, 0.14, 0), V(-0.08, 0.19, 0), V(0.08, 0.19, 0), V(0.08, 0.14, 0)], 0.01, 6), M.darkSteel));
  for (const x of [-0.15, 0.15]) g.add(mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02).translate(x, 0.1, 0.095), M.steel));
  grip(g, 'side', 'wrap12', V(0, 0.19, 0), RIGHT, V(0, 0, 1));
  return centered(g);
}

// A combination spanner: a box end with twelve points and an open end at 15 degrees, on a shaft
// that thins in the middle.
export function wrench() {
  const M = itemMats();
  const g = new THREE.Group();
  const flat = (shape, t) => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: t - 0.002, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1, curveSegments: 16 });
    return geo.translate(0, 0, -(t - 0.002) / 2).rotateX(-Math.PI / 2);
  };
  // shaft
  const secs = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8,
      x = -0.13 + t * 0.26;
    const a = 0.0095 - 0.002 * Math.sin(t * Math.PI);
    secs.push(superSection(V(x, 0, 0), V(0, 0, 1), V(0, 1, 0), a, 0.0035, 4, 16));
  }
  g.add(mesh(loftSections(secs, { capStart: true, capEnd: true }), M.steel));
  // the box end: a ring round a twelve-point hole
  const box = new THREE.Shape();
  box.absarc(0, 0, 0.019, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2,
      r = k % 2 ? 0.0118 : 0.0102;
    if (k) hole.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else hole.moveTo(r, 0);
  }
  hole.closePath();
  box.holes.push(hole);
  g.add(mesh(flat(box, 0.0085).rotateZ(0.26).translate(-0.15, 0.002, 0), M.steel));
  // the open end
  const a0 = 0.62,
    R = 0.023;
  const jaw = [];
  for (let k = 0; k <= 20; k++) {
    const a = a0 + (k / 20) * (Math.PI * 2 - 2 * a0);
    jaw.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  jaw.push([Math.cos(a0) * R, -0.0083], [-0.004, -0.0083], [-0.004, 0.0083], [Math.cos(a0) * R, 0.0083]);
  g.add(mesh(flat(shapeFromPoints(jaw), 0.0075).rotateY(0.26).translate(0.152, 0, 0), M.steel));
  grip(g, 'tool', 'wrap12', V(-0.075, 0, 0), RIGHT, UP);
  return centered(g);
}

export function extinguisher() {
  const M = itemMats();
  const g = new THREE.Group();
  g.add(mesh(latheY([[0, 0], [0.06, 0.0], [0.065, 0.02], [0.065, 0.36], [0.05, 0.4], [0.02, 0.42], [0, 0.42]], 24), M.redPaint));
  g.add(mesh(roundedBox(0.03, 0.06, 0.12, 0.008, 2).translate(0, 0.46, 0.02), M.darkSteel));
  g.add(mesh(tubeAlong([V(0, 0.44, -0.03), V(0, 0.4, -0.09), V(0, 0.2, -0.08), V(0, 0.12, -0.075)], 0.01, 6), M.rubber));
  grip(g, 'side', 'grip', V(0, 0.455, 0.02), V(0, 0, 1), V(-1, 0, 0));
  return centered(g);
}

export function lantern() {
  const M = itemMats();
  const g = new THREE.Group();
  g.add(mesh(latheY([[0, 0], [0.08, 0], [0.085, 0.03], [0.06, 0.05], [0, 0.05]], 20), M.jerryGreen));
  const glow = mesh(latheY([[0.0, 0.05], [0.045, 0.05], [0.06, 0.12], [0.045, 0.19], [0, 0.19]], 20), M.lanternGlow, false);
  glow.name = 'glow';
  g.add(glow);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.15).translate(Math.cos(a) * 0.062, 0.12, Math.sin(a) * 0.062), M.darkSteel));
  }
  g.add(mesh(latheY([[0.0, 0.19], [0.07, 0.19], [0.05, 0.23], [0.015, 0.25], [0, 0.25]], 20), M.jerryGreen));
  g.add(mesh(new THREE.TorusGeometry(0.06, 0.004, 6, 20, Math.PI).translate(0, 0.25, 0), M.darkSteel));
  grip(g, 'side', 'wrap12', V(0, 0.31, 0), RIGHT, V(0, 0, 1));
  return centered(g);
}

// ------------------------------------------------------------------ weapons
// A flat part cut to an outline seen from the side (u = z forward, v = y up), t thick, centred on
// x = 0, its edges rounded.
function sidePlate(pts, t, bevel = 0.0012, holes = []) {
  const s = shapeFromPoints(pts);
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
  const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-4, t - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  geo.translate(0, 0, -(t - 2 * bevel) / 2);
  return geo.rotateY(-Math.PI / 2);
}

// A .38 service revolver: the frame with its top strap round the cylinder window, a four-inch
// barrel with rib, sight and ejector rod, the fluted cylinder (turning on its own axis as it is
// fired), hammer, trigger in its guard, walnut stocks on a round butt.
export function revolver() {
  const M = itemMats();
  const g = new THREE.Group();
  const by = 0.045; // bore axis
  // barrel: tapered tube, rib, ramp sight, the bore, ejector rod under it
  g.add(mesh(new THREE.CylinderGeometry(0.0078, 0.0086, 0.154, 18).rotateX(Math.PI / 2).translate(0, by, 0.101), M.blued));
  g.add(mesh(roundedBox(0.009, 0.007, 0.148, 0.003, 1).translate(0, by + 0.0085, 0.1), M.blued));
  g.add(mesh(sidePlate([[0.158, 0.0], [0.176, 0.0], [0.176, 0.009], [0.171, 0.009]], 0.004, 0.0006).translate(0, by + 0.011, 0), M.blued));
  g.add(mesh(new THREE.CircleGeometry(0.0042, 12).translate(0, by, 0.1785), M.rubber));
  g.add(mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.09, 10).rotateX(Math.PI / 2).translate(0, by - 0.0135, 0.07), M.blued));
  g.add(mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.012, 12).rotateX(Math.PI / 2).translate(0, by - 0.0135, 0.118), M.blued));
  // frame, with the window the cylinder sits in
  const frame = [
    [0.031, 0.063], [-0.026, 0.063], [-0.032, 0.058], [-0.036, 0.048], [-0.04, 0.04], [-0.046, 0.033], [-0.056, 0.014], [-0.066, -0.016], [-0.074, -0.045],
    [-0.078, -0.062], [-0.072, -0.068], [-0.048, -0.068], [-0.044, -0.062], [-0.04, -0.035], [-0.034, -0.008], [-0.03, 0.002], [-0.02, 0.004], [0.022, 0.004],
    [0.028, 0.009], [0.031, 0.024], [0.032, 0.04],
  ];
  const window_ = [[-0.0215, 0.0135], [0.0215, 0.0135], [0.0215, 0.0555], [-0.0215, 0.0555]];
  g.add(mesh(sidePlate(frame, 0.017, 0.0015, [window_]), M.blued));
  // walnut stocks either side of the grip frame, a medallion in each
  const stocks = [[-0.043, 0.03], [-0.054, 0.012], [-0.064, -0.016], [-0.071, -0.046], [-0.073, -0.06], [-0.05, -0.062], [-0.046, -0.056], [-0.042, -0.032], [-0.037, -0.006], [-0.034, 0.012], [-0.036, 0.026]];
  g.add(mesh(sidePlate(stocks, 0.029, 0.005), M.walnut));
  for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.001, 12).rotateZ(Math.PI / 2).translate(s * 0.0146, -0.008, -0.052), M.brass));
  // cylinder: fluted, six chambers at the front; built round its own axis
  const cy = by - 0.0115;
  const cyl = new THREE.CylinderGeometry(0.0195, 0.0195, 0.04, 36, 1).rotateX(Math.PI / 2);
  const p = cyl.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i);
    const r = Math.hypot(x, y);
    if (r > 0.015) {
      const f = 1 - 0.14 * Math.max(0, Math.cos(Math.atan2(y, x) * 6 + Math.PI / 6)) ** 3;
      p.setX(i, x * f);
      p.setY(i, y * f);
    }
  }
  cyl.computeVertexNormals();
  const cylMesh = mesh(cyl, M.blued);
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 3;
    cylMesh.add(mesh(new THREE.CircleGeometry(0.0045, 10).translate(Math.cos(a) * 0.0115, Math.sin(a) * 0.0115, 0.0201), M.rubber));
  }
  cylMesh.position.set(0, cy, 0);
  cylMesh.name = 'cylinder';
  g.add(cylMesh);
  // hammer, trigger, the guard round it, the cylinder latch
  g.add(mesh(sidePlate([[-0.03, 0.05], [-0.034, 0.066], [-0.046, 0.074], [-0.051, 0.071], [-0.041, 0.062], [-0.037, 0.05]], 0.007, 0.0008), M.blued));
  g.add(mesh(sidePlate([[-0.006, 0.006], [-0.004, -0.004], [-0.007, -0.016], [-0.012, -0.022], [-0.014, -0.019], [-0.011, -0.012], [-0.011, -0.002], [-0.012, 0.006]], 0.006, 0.0008), M.steel));
  g.add(mesh(tubeAlong([V(0, 0.004, 0.008), V(0, -0.012, 0.002), V(0, -0.021, -0.013), V(0, -0.018, -0.026), V(0, -0.006, -0.033)], 0.0028, 6), M.blued));
  g.add(mesh(roundedBox(0.003, 0.008, 0.014, 0.001, 1).translate(0.009, 0.042, -0.03), M.blued));
  g.userData.muzzle = V(0, by, 0.18);
  grip(g, 'pistol', 'pistol', V(0, -0.022, -0.054), V(0, Math.cos(0.35), Math.sin(0.35)), V(-1, 0, 0.35));
  // support hand cupped round the shooting hand (aimed only)
  grip(g, 'pistol', 'wrap33', V(0.028, -0.04, -0.045), V(0, Math.cos(0.35), Math.sin(0.35)), V(1, -0.5, 0.35), 'grip2');
  g.userData.grip2.aimOnly = true;
  return g;
}

// A side-by-side double: two barrels with the rib between them and a bead at the muzzle, the
// action with its top lever, two triggers in the guard, a splinter forend and a straight English
// stock ending in a rubber pad.
export function shotgun() {
  const M = itemMats();
  const g = new THREE.Group();
  const by = 0.04;
  for (const x of [-0.0105, 0.0105]) {
    g.add(mesh(new THREE.CylinderGeometry(0.0102, 0.0108, 0.59, 16).rotateX(Math.PI / 2).translate(x, by, 0.335), M.blued));
    g.add(mesh(new THREE.CircleGeometry(0.0085, 12).translate(x, by, 0.6305), M.rubber));
  }
  g.add(mesh(roundedBox(0.009, 0.006, 0.59, 0.002, 1).translate(0, by + 0.0105, 0.335), M.blued));
  g.add(mesh(roundedBox(0.008, 0.006, 0.5, 0.002, 1).translate(0, by - 0.0105, 0.29), M.blued));
  g.add(mesh(new THREE.SphereGeometry(0.0022, 8, 6).translate(0, by + 0.0145, 0.622), M.brass));
  // the action
  const act = [[0.045, 0.055], [-0.015, 0.055], [-0.03, 0.05], [-0.045, 0.035], [-0.05, 0.012], [-0.04, -0.002], [0.015, -0.002], [0.04, 0.012], [0.045, 0.025]];
  g.add(mesh(sidePlate(act, 0.042, 0.003), M.steel));
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.043, 12).rotateZ(Math.PI / 2).translate(0, 0.006, 0.04), M.steel));
  g.add(mesh(roundedBox(0.008, 0.006, 0.045, 0.002, 1).rotateY(0.35).translate(0.006, 0.058, -0.03), M.blued));
  g.add(mesh(roundedBox(0.006, 0.004, 0.012, 0.0015, 1).translate(0, 0.057, -0.055), M.steel));
  // guard and two triggers
  g.add(mesh(tubeAlong([V(0, -0.002, 0.012), V(0, -0.024, 0.0), V(0, -0.03, -0.03), V(0, -0.018, -0.06), V(0, -0.006, -0.075)], 0.0028, 6), M.blued));
  for (const z of [-0.012, -0.03]) g.add(mesh(sidePlate([[z + 0.003, -0.002], [z + 0.004, -0.012], [z, -0.022], [z - 0.003, -0.02], [z - 0.0005, -0.012], [z - 0.001, -0.002]], 0.005, 0.0007), M.steel));
  // splinter forend under the barrels
  const fsecs = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6,
      z = 0.055 + t * 0.25;
    fsecs.push(superSection(V(0, 0.024 - 0.003 * t, z), V(1, 0, 0), V(0, 1, 0), 0.02 - 0.004 * t, 0.013 - 0.003 * t, 2.6, 18));
  }
  g.add(mesh(loftSections(fsecs, { capStart: true, capEnd: true }), M.walnut));
  // stock: thin at the wrist, deepening to the butt, dropping away from the line of the barrels
  const ssecs = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10,
      z = -0.045 - t * 0.37;
    const top = 0.05 - 0.03 * t,
      bot = 0.004 - 0.105 * t ** 1.1;
    ssecs.push(superSection(V(0, (top + bot) / 2, z), V(1, 0, 0), V(0, 1, 0), 0.016 + 0.007 * t, (top - bot) / 2, 2.4, 20));
  }
  g.add(mesh(loftSections(ssecs, { capStart: true, capEnd: true }), M.walnut));
  const last = ssecs[ssecs.length - 1];
  const pad = last.map((q) => q.clone().add(V(0, 0, -0.014)));
  g.add(mesh(loftSections([last.map((q) => q.clone().add(V(0, 0, 0.001))), pad], { capStart: true, capEnd: true }), M.rubber));
  g.userData.muzzle = V(0, by, 0.63);
  grip(g, 'rifle', 'pistol', V(0, -0.004, -0.08), V(0, 0.9, -0.42), V(-1, 0, 0.35));
  grip(g, 'rifle', 'wrap24', V(0, 0.012, 0.27), V(0, 0, 1), V(0.15, -1, 0), 'grip2');
  return g;
}

export function ammoBox(kind = '38') {
  const g = new THREE.Group();
  const m = labelMat('ammo' + kind, 256, 128, (c, w, h) => {
    c.fillStyle = kind === '38' ? '#2d4a2a' : '#8a2a1a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8dcb0';
    c.font = 'bold 34px Arial';
    c.fillText(kind === '38' ? '.38 SPECIAL' : '12 GAUGE', 20, 60);
    c.font = '20px Arial';
    c.fillText(kind === '38' ? '12 CARTRIDGES' : '8 SHELLS', 20, 98);
  });
  const geo = roundedBox(kind === '38' ? 0.09 : 0.12, 0.05, kind === '38' ? 0.06 : 0.07, 0.004, 1);
  const p = geo.attributes.position,
    uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 0.12 + 0.5, (p.getY(i) + p.getZ(i)) / 0.12 + 0.5);
  g.add(mesh(geo, m));
  grip(g, 'palm', 'palm', V(0.02, -0.025, 0.01), RIGHT, DOWN);
  return centered(g);
}

// ------------------------------------------------------------------ music
// Album artwork painted on a canvas: a motif per style in the album's colours.
export function drawCover(c, w, h, al) {
  const [bg, a, b] = al.colors;
  const gr = c.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, bg);
  gr.addColorStop(1, shade(bg, al.style === 'ambient' || al.style === 'country' ? -0.12 : 0.18));
  c.fillStyle = gr;
  c.fillRect(0, 0, w, h);
  c.save();
  const cx = w / 2;
  switch (al.style) {
    case 'synthwave': {
      // striped sun over a grid
      const sg = c.createLinearGradient(0, h * 0.18, 0, h * 0.62);
      sg.addColorStop(0, b);
      sg.addColorStop(1, a);
      c.fillStyle = sg;
      c.beginPath();
      c.arc(cx, h * 0.45, w * 0.26, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = bg;
      for (let k = 0; k < 6; k++) c.fillRect(0, h * (0.47 + k * 0.035), w, 3 + k * 1.6);
      c.strokeStyle = a;
      c.lineWidth = 2;
      for (let k = 0; k < 8; k++) {
        const y = h * 0.66 + Math.pow(k / 8, 1.8) * h * 0.34;
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
      }
      for (let k = -8; k <= 8; k++) {
        c.beginPath();
        c.moveTo(cx + k * 6, h * 0.66);
        c.lineTo(cx + k * 60, h);
        c.stroke();
      }
      break;
    }
    case 'rock': {
      // a coiled rattlesnake made of arcs and a lightning-bolt road
      c.strokeStyle = a;
      c.lineWidth = 10;
      for (let k = 0; k < 4; k++) {
        c.beginPath();
        c.arc(cx, h * 0.5, w * (0.08 + k * 0.07), k * 0.9, k * 0.9 + Math.PI * 1.5);
        c.stroke();
      }
      c.fillStyle = b;
      c.beginPath();
      c.moveTo(cx + 18, h * 0.12);
      c.lineTo(cx - 10, h * 0.5);
      c.lineTo(cx + 8, h * 0.5);
      c.lineTo(cx - 16, h * 0.88);
      c.lineTo(cx + 26, h * 0.42);
      c.lineTo(cx + 6, h * 0.42);
      c.closePath();
      c.fill();
      break;
    }
    case 'country': {
      // road to the horizon under a big moon
      c.fillStyle = b;
      c.globalAlpha = 0.85;
      c.beginPath();
      c.arc(w * 0.7, h * 0.28, w * 0.11, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      c.fillStyle = a;
      c.fillRect(0, h * 0.58, w, h * 0.42);
      c.fillStyle = shade(a, -0.3);
      c.beginPath();
      c.moveTo(cx - 4, h * 0.58);
      c.lineTo(cx + 4, h * 0.58);
      c.lineTo(cx + w * 0.3, h);
      c.lineTo(cx - w * 0.3, h);
      c.closePath();
      c.fill();
      c.fillStyle = '#f2e6b8';
      for (let k = 0; k < 5; k++) {
        const y0 = h * 0.6 + Math.pow(k / 5, 1.6) * h * 0.4;
        c.fillRect(cx - 1 - k, y0, 2 + k * 2, 4 + k * 4);
      }
      break;
    }
    case 'ambient': {
      // heat shimmer bands over a white flat
      for (let k = 0; k < 14; k++) {
        c.fillStyle = k % 2 ? a : b;
        c.globalAlpha = 0.12 + (k / 14) * 0.25;
        const y = h * 0.35 + k * h * 0.035;
        c.beginPath();
        c.moveTo(0, y);
        for (let x = 0; x <= w; x += 8) c.lineTo(x, y + Math.sin(x * 0.05 + k) * 3);
        c.lineTo(w, y + 6);
        c.lineTo(0, y + 6);
        c.fill();
      }
      c.globalAlpha = 1;
      break;
    }
    case 'blues': {
      // neon guitar sign in a dark window
      c.strokeStyle = a;
      c.lineWidth = 6;
      c.shadowColor = a;
      c.shadowBlur = 16;
      c.beginPath();
      c.ellipse(cx - 10, h * 0.6, w * 0.13, h * 0.11, 0.4, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.moveTo(cx + 10, h * 0.52);
      c.lineTo(cx + w * 0.3, h * 0.2);
      c.stroke();
      c.shadowBlur = 0;
      break;
    }
    case 'lofi': {
      // a motel window at night with a crescent moon
      c.fillStyle = shade(bg, 0.25);
      c.fillRect(w * 0.2, h * 0.18, w * 0.6, h * 0.5);
      c.fillStyle = a;
      c.beginPath();
      c.arc(w * 0.62, h * 0.34, 18, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = shade(bg, 0.25);
      c.beginPath();
      c.arc(w * 0.66, h * 0.31, 16, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = shade(bg, -0.3);
      c.lineWidth = 6;
      c.strokeRect(w * 0.2, h * 0.18, w * 0.6, h * 0.5);
      c.beginPath();
      c.moveTo(cx, h * 0.18);
      c.lineTo(cx, h * 0.68);
      c.stroke();
      c.fillStyle = b;
      c.fillRect(w * 0.14, h * 0.74, w * 0.72, 6);
      break;
    }
  }
  c.restore();
  // type
  c.fillStyle = al.style === 'ambient' || al.style === 'country' ? '#1d1d1f' : '#f4efe4';
  c.font = `bold ${Math.round(h * 0.075)}px Georgia`;
  c.textAlign = 'left';
  c.fillText(al.artist.toUpperCase(), w * 0.07, h * 0.1);
  c.font = `italic ${Math.round(h * 0.06)}px Georgia`;
  c.fillText(al.title, w * 0.07, h * 0.93);
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (k > 0 ? (255 - v) * k : v * k))));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
}

// CD in its jewel case; `album` indexes ALBUMS.
export function cdCase(album = 0) {
  const al = ALBUMS[album % ALBUMS.length];
  const g = new THREE.Group();
  const cover = labelMat('cd' + al.id, 256, 256, (c, w, h) => drawCover(c, w, h, al), { roughness: 0.25 });
  const plastic = cached('cdPlastic', () => new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false }));
  const tray = cached('cdTray', () => new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5 }));
  // case 142 x 125 x 10 mm; cover insert on top (+Y), tray underneath
  g.add(mesh(roundedBox(0.142, 0.0085, 0.125, 0.0015, 1), tray));
  const top = new THREE.PlaneGeometry(0.136, 0.12);
  top.rotateX(-Math.PI / 2);
  top.translate(0.002, 0.0045, 0);
  g.add(mesh(top, cover, false));
  g.add(mesh(roundedBox(0.142, 0.002, 0.125, 0.0008, 1).translate(0, 0.0052, 0), plastic, false));
  // hinge strip
  g.add(mesh(new THREE.BoxGeometry(0.008, 0.0095, 0.125).translate(-0.067, 0, 0), tray));
  grip(g, 'palm', 'palm', V(0.03, -0.004, 0.02), RIGHT, DOWN);
  return centered(g);
}

// A sack of sand: a lumpy pillow, tied off at one end.
export function sandbag() {
  const M = itemMats();
  const g = new THREE.Group();
  const geo = roundedBox(0.36, 0.17, 0.6, 0.07, 4);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    // slumped: the sand settles to the bottom and bulges the sides; the tied end narrows
    const end = Math.max(0, z / 0.3 - 0.55) / 0.45;
    const lump = 1 + 0.04 * Math.sin(x * 23 + z * 17) * Math.sin(z * 11);
    p.setX(i, x * (1 - 0.55 * end * end) * (y < 0 ? 1.06 : 0.94) * lump);
    p.setY(i, (y * (1 - 0.6 * end * end) - (y > 0 ? 0.02 * (1 - (x / 0.18) ** 2) : 0)) * lump);
  }
  geo.computeVertexNormals();
  g.add(mesh(geo, M.sack || (M.sack = addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x8d7c58, roughness: 0.97 }), 'weave', 0.5))));
  g.add(mesh(latheY([[0.03, 0], [0.045, 0.02], [0.02, 0.05], [0.035, 0.09], [0, 0.1]], 10).rotateX(Math.PI / 2).translate(0, 0, 0.29), M.sack));
  g.add(mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 14).translate(0, 0, 0.32), M.rubber));
  grip(g, 'side', 'wrap12', V(0, 0, 0.33), RIGHT, UP);
  return centered(g);
}

// ------------------------------------------------------------------ big things to carry
// A CRT television (the same set as stands in the houses): wood or plastic case tapering back,
// the bulging screen, dials and grille, rabbit ears. Carried in both arms.
export function tv() {
  const g = new THREE.Group();
  for (const [geo, m] of crtTV(mulberry32(5), { broken: false, aerial: true })) g.add(mesh(geo, m));
  grip(g, 'side', 'wrap12', V(0, 0.5, 0.0), RIGHT, V(0, 0, 1));
  return centered(g);
}

// A 60-litre steel drum: rolled hoops, a rim each end, two bungs in the lid.
export function drum(color = 0) {
  const M = itemMats();
  const paint = [0x2f4f7a, 0x8a2b20, 0x55603d][color % 3];
  const key = 'drum' + (color % 3);
  if (!M[key]) M[key] = addSurfaceDetail(new THREE.MeshStandardMaterial({ color: paint, roughness: 0.55, metalness: 0.45 }), 'cast', 0.45);
  const g = new THREE.Group();
  const R = 0.2,
    H = 0.6;
  g.add(mesh(new THREE.CylinderGeometry(R, R, H, 28, 1, true).translate(0, H / 2, 0), M[key]));
  for (const y of [0.012, H - 0.012]) g.add(mesh(new THREE.TorusGeometry(R, 0.011, 6, 28).rotateX(Math.PI / 2).translate(0, y, 0), M[key]));
  for (const y of [H * 0.33, H * 0.67]) g.add(mesh(new THREE.TorusGeometry(R + 0.004, 0.007, 6, 28).rotateX(Math.PI / 2).translate(0, y, 0), M[key]));
  g.add(mesh(new THREE.CircleGeometry(R, 28).rotateX(-Math.PI / 2).translate(0, H - 0.008, 0), M[key]));
  g.add(mesh(new THREE.CircleGeometry(R, 28).rotateX(Math.PI / 2).translate(0, 0.006, 0), M[key]));
  // the bungs: the big one (the filler) unscrews
  for (const [x, z, r] of [[0.11, 0.02, 0.026], [-0.12, -0.03, 0.016]]) {
    const b = mesh(new THREE.CylinderGeometry(r, r, 0.014, 12).translate(x, H - 0.002, z), M.darkSteel);
    if (r > 0.02) b.name = 'cap';
    g.add(b);
  }
  g.add(mesh(new THREE.CircleGeometry(0.022, 12).rotateX(-Math.PI / 2).translate(0.11, H - 0.0075, 0.02), M.rubber));
  grip(g, 'side', 'wrap12', V(0, H, 0), RIGHT, V(0, 0, 1));
  return centered(g);
}

// ------------------------------------------------------------------ decorations
// Things to hang from the mirror (built hanging from the origin: userData.hangTop is that point
// once centred) and toys for the dashboard (their nodding part is the child named 'bob', pivoted
// where it nods).
function hanging(g) {
  const b = new THREE.Box3().setFromObject(g);
  const c = b.getCenter(new THREE.Vector3());
  for (const ch of g.children) ch.position.sub(c);
  g.userData.hangTop = c.clone().negate();
  g.userData.size = b.getSize(new THREE.Vector3());
  return g;
}

const decoMat = (color, o = {}) => cached('deco:' + color.toString(16) + JSON.stringify(o), () => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o }));

// the cord a decoration hangs by, from the mirror's arm (y = 0) down to `y`
function cord(g, y, x = 0) {
  g.add(mesh(new THREE.CylinderGeometry(0.0012, 0.0012, -y, 4).translate(x * 0.5, y / 2, 0).rotateZ(Math.atan2(x, -y) * 0), decoMat(0xd8d0c0, { roughness: 1 }), false));
}

// The cardboard pine of an air freshener, one of seven colours, its scent printed on it.
function airFreshener(variant = 0) {
  const COLS = [0x2f6fb8, 0xe8e6e0, 0xe3c12f, 0x3f9a48, 0xc23b2f, 0xe58fb4, 0x1c1c1c];
  const col = COLS[variant % COLS.length];
  const g = new THREE.Group();
  cord(g, -0.06);
  const pts = [[0, 0], [0.016, -0.02], [0.008, -0.02], [0.026, -0.045], [0.014, -0.045], [0.034, -0.075], [0.019, -0.075], [0.04, -0.105], [0.006, -0.105], [0.006, -0.118], [-0.006, -0.118], [-0.006, -0.105], [-0.04, -0.105], [-0.019, -0.075], [-0.034, -0.075], [-0.014, -0.045], [-0.026, -0.045], [-0.008, -0.02], [-0.016, -0.02]];
  const tree = new THREE.ExtrudeGeometry(shapeFromPoints(pts), { depth: 0.0018, bevelEnabled: false }).translate(0, -0.058, -0.0009);
  g.add(mesh(tree, decoMat(col, { roughness: 0.95 })));
  // the label band across it
  const lab = labelMat('fresh' + variant, 128, 32, (c, w, h) => {
    c.fillStyle = variant === 1 ? '#2a5a9a' : '#f4efe0';
    c.fillRect(0, 0, w, h);
    c.fillStyle = variant === 1 ? '#f4efe0' : '#3a2a1a';
    c.font = 'bold 20px Arial';
    c.textAlign = 'center';
    c.fillText('DESERT PINE', w / 2, 23);
  });
  for (const z of [0.0012, -0.0012]) g.add(mesh(new THREE.PlaneGeometry(0.05, 0.012).rotateY(z < 0 ? Math.PI : 0).translate(0, -0.142, z), lab, false));
  return hanging(g);
}

// A beetle on a thread: a shiny shell, a head and six legs.
function decoBeetle() {
  const g = new THREE.Group();
  cord(g, -0.05);
  const shell = decoMat(0x2a5ab8, { roughness: 0.25, metalness: 0.5 });
  g.add(mesh(new THREE.SphereGeometry(0.022, 16, 10).scale(1, 0.55, 1.35).translate(0, -0.062, 0), shell));
  g.add(mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 0.06, 3).rotateX(Math.PI / 2).translate(0, -0.05, 0), decoMat(0x101010)));
  g.add(mesh(new THREE.SphereGeometry(0.011, 10, 8).translate(0, -0.063, 0.03), decoMat(0x101010)));
  for (const sx of [-1, 1])
    for (const z of [-0.012, 0, 0.012]) g.add(mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.03, 4).rotateZ(sx * 1.0).translate(sx * 0.026, -0.072, z), decoMat(0x101010)));
  return hanging(g);
}

// An octopus with eight curling legs and big eyes.
function decoOctopus(variant = 0) {
  const g = new THREE.Group();
  cord(g, -0.035);
  const skin = decoMat(0x4a9a52, { roughness: 0.5 });
  g.add(mesh(new THREE.SphereGeometry(0.025, 16, 12).scale(1, 1.2, 1).translate(0, -0.062, 0), skin));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const r = 0.015 + t * 0.02 + Math.sin(t * 5 + k) * 0.004;
      pts.push(V(Math.cos(a) * r, -0.075 - t * 0.04 + Math.sin(t * Math.PI) * 0.006, Math.sin(a) * r));
    }
    g.add(mesh(tubeAlong(pts, 0.004, 5), skin));
  }
  const eye = decoMat(0xf4f0e8, { roughness: 0.3 }),
    pupil = decoMat(variant ? 0xb81a1a : 0x101010, { roughness: 0.2 });
  for (const sx of [-1, 1]) {
    g.add(mesh(new THREE.SphereGeometry(0.0075, 10, 8).translate(sx * 0.011, -0.058, 0.02), eye));
    g.add(mesh(new THREE.SphereGeometry(0.0035, 8, 6).translate(sx * 0.012, -0.058, 0.027), pupil));
  }
  return hanging(g);
}

// A frozen-juice tube in its paper sleeve, hung up for the smell of it.
function juicePop() {
  const g = new THREE.Group();
  cord(g, -0.02);
  const sleeve = labelMat('juicepop', 128, 256, (c, w, h) => {
    c.fillStyle = '#e8dcc0';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#d0502a';
    c.fillRect(0, h * 0.18, w, h * 0.22);
    c.fillStyle = '#f8f0e0';
    c.font = 'bold 30px Arial';
    c.textAlign = 'center';
    c.fillText('KALIPO', w / 2, h * 0.34);
    c.fillStyle = '#3a8a3a';
    c.beginPath();
    c.arc(w / 2, h * 0.62, 28, 0, Math.PI * 2);
    c.fill();
  });
  g.add(mesh(latheY([[0, -0.02], [0.012, -0.022], [0.015, -0.03], [0.016, -0.12], [0.012, -0.128], [0, -0.13]], 16), sleeve));
  return hanging(g);
}

// A short log on a string: bark, sawn rings at the ends.
function decoLog(variant = 0) {
  const g = new THREE.Group();
  cord(g, -0.03);
  const bark = decoMat([0x5a3a22, 0x9a7a52, 0x2e2018][variant % 3], { roughness: 1 });
  g.add(mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.09, 10).rotateZ(Math.PI / 2).translate(0, -0.046, 0), bark));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.CircleGeometry(0.0145, 12).rotateY((sx * Math.PI) / 2).translate(sx * 0.0451, -0.046, 0), decoMat(0xc8a068, { roughness: 0.9 })));
  return hanging(g);
}

// A bat hanging by its feet, wings folded half open.
function decoBat() {
  const g = new THREE.Group();
  cord(g, -0.01);
  const fur = decoMat(0x1a1714, { roughness: 0.9 });
  g.add(mesh(new THREE.SphereGeometry(0.012, 10, 8).scale(1, 1.6, 0.9).translate(0, -0.035, 0), fur));
  g.add(mesh(new THREE.SphereGeometry(0.009, 10, 8).translate(0, -0.058, 0.003), fur));
  for (const sx of [-1, 1]) {
    const wing = new THREE.ExtrudeGeometry(shapeFromPoints([[0, 0.012], [0.012, 0.02], [0.03, 0.01], [0.042, -0.02], [0.03, -0.012], [0.024, -0.03], [0.014, -0.02], [0.006, -0.03], [0, -0.012]]), { depth: 0.001, bevelEnabled: false });
    g.add(mesh(wing.scale(sx, 1, 1).rotateY(sx * 0.5).translate(sx * 0.006, -0.035, 0), fur));
    g.add(mesh(new THREE.ConeGeometry(0.003, 0.008, 4).translate(sx * 0.005, -0.051, 0.004).rotateZ(Math.PI), fur));
  }
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.0016, 6, 4).translate(sx * 0.004, -0.06, 0.011), decoMat(0xc83020, { emissive: 0x401008 })));
  return hanging(g);
}

// A round cat's-eye reflector on a chain.
function reflector() {
  const g = new THREE.Group();
  for (let k = 0; k < 6; k++) g.add(mesh(new THREE.TorusGeometry(0.003, 0.0008, 4, 8).rotateY((k % 2) * Math.PI * 0.5).translate(0, -0.004 - k * 0.0055, 0), decoMat(0xb8bcc0, { metalness: 1, roughness: 0.3 }), false));
  g.add(mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.008, 24).rotateX(Math.PI / 2).translate(0, -0.068, 0), decoMat(0x2a2a2a)));
  const lens = new THREE.MeshPhysicalMaterial({ color: 0xd02810, roughness: 0.15, emissive: 0x501004, clearcoat: 1 });
  for (const z of [0.0042, -0.0042]) g.add(mesh(new THREE.CircleGeometry(0.029, 6).rotateY(z < 0 ? Math.PI : 0).translate(0, -0.068, z), lens));
  return hanging(g);
}

// A pair of fluffy dice on a cord loop.
function fuzzyDice(variant = 0) {
  const g = new THREE.Group();
  const fur = decoMat([0xd8d4cc, 0xc8301f, 0x1c1c1c, 0xe58fb4][variant % 4], { roughness: 1 });
  const pip = decoMat(variant === 0 ? 0x1a1a1a : 0xf0ece0, { roughness: 1 });
  for (const sx of [-1, 1]) {
    const y = sx < 0 ? -0.075 : -0.095;
    g.add(mesh(new THREE.CylinderGeometry(0.0012, 0.0012, Math.hypot(0.022, y), 4).translate(0, y / 2, 0).rotateZ(-sx * Math.atan2(0.022, -y)), decoMat(0xd8d0c0), false));
    const d = roundedBox(0.042, 0.042, 0.042, 0.014, 2);
    const p = d.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + 0.06 * Math.sin(p.getX(i) * 300 + p.getY(i) * 260 + p.getZ(i) * 220);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    d.computeVertexNormals();
    const c = V(sx * 0.024, y - 0.022, 0);
    const rot = new THREE.Euler(0.4 * sx, 0.6, 0.2);
    g.add(mesh(d.clone().applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot)).translate(c.x, c.y, c.z), fur));
    // pips on the three faces turned outward
    const faces = [[V(0, 0, 1), 1], [V(1, 0, 0), 3], [V(0, 1, 0), 5]];
    for (const [n, count] of faces) {
      for (let k = 0; k < count; k++) {
        const u = count === 1 ? 0 : ((k % 3) - 1) * 0.011,
          v = count === 1 ? 0 : (Math.floor(k / 3) - 0.5) * 0.013 * (count > 3 ? 1 : 0) + (count === 3 ? (k - 1) * 0.011 : 0);
        const off = Math.abs(n.z) > 0.5 ? V(u, v, 0) : Math.abs(n.x) > 0.5 ? V(0, v, u) : V(u, 0, v);
        const q = n.clone().multiplyScalar(0.0225).add(off).applyEuler(rot).add(c);
        g.add(mesh(new THREE.SphereGeometry(0.004, 6, 4).translate(q.x, q.y, q.z), pip, false));
      }
    }
  }
  return hanging(g);
}

// A nodding dog for the parcel shelf or the dash: its head on a spring (the 'bob' group).
function bobbleDog(variant = 0) {
  const g = new THREE.Group();
  const coat = decoMat([0x8a5a32, 0xd8c8a8, 0x2a2420][variant % 3], { roughness: 0.85 });
  const dark = decoMat(0x2a1a12, { roughness: 0.7 });
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.038, 0.01, 18).translate(0, 0.005, 0), decoMat(0x3a3a3a)));
  // sitting body, front legs, tail
  g.add(mesh(new THREE.SphereGeometry(0.03, 14, 10).scale(0.9, 1.1, 1.25).translate(0, 0.045, -0.006), coat));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.CapsuleGeometry(0.008, 0.03, 3, 8).translate(sx * 0.013, 0.03, 0.022), coat));
  g.add(mesh(new THREE.CapsuleGeometry(0.005, 0.025, 3, 6).rotateX(-0.9).translate(0, 0.03, -0.042), coat));
  const bob = new THREE.Group();
  bob.name = 'bob';
  bob.position.set(0, 0.075, 0.012);
  bob.add(mesh(new THREE.SphereGeometry(0.024, 14, 10).translate(0, 0.016, 0.006), coat));
  bob.add(mesh(new THREE.CapsuleGeometry(0.012, 0.02, 3, 8).rotateX(Math.PI / 2).translate(0, 0.01, 0.03), coat));
  bob.add(mesh(new THREE.SphereGeometry(0.006, 8, 6).translate(0, 0.012, 0.052), dark));
  for (const sx of [-1, 1]) {
    bob.add(mesh(new THREE.SphereGeometry(0.004, 8, 6).translate(sx * 0.01, 0.024, 0.026), dark));
    bob.add(mesh(new THREE.SphereGeometry(0.014, 10, 8).scale(0.4, 1.4, 0.9).rotateZ(sx * 0.3).translate(sx * 0.022, 0.006, -0.002), dark));
  }
  g.add(bob);
  return centered(g);
}

// A hula dancer on a spring: grass skirt, arms up, a flower in her hair; she sways (the 'bob').
function hulaGirl() {
  const g = new THREE.Group();
  const skin = decoMat(0xc8946a, { roughness: 0.5 });
  const grass = decoMat(0x9a8a3a, { roughness: 0.9 });
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.014, 18).translate(0, 0.007, 0), decoMat(0x2a6a3a)));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.CapsuleGeometry(0.006, 0.04, 3, 6).translate(sx * 0.007, 0.036, 0), skin));
  const bob = new THREE.Group();
  bob.name = 'bob';
  bob.position.set(0, 0.06, 0);
  // the skirt: strands round the hips
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2;
    bob.add(mesh(new THREE.BoxGeometry(0.004, 0.032, 0.0012).translate(0, -0.014, 0).rotateX(0.18).rotateY(-a).translate(Math.sin(a) * 0.013, 0, Math.cos(a) * 0.013), grass, false));
  }
  bob.add(mesh(new THREE.CapsuleGeometry(0.011, 0.028, 3, 10).translate(0, 0.02, 0), skin));
  bob.add(mesh(new THREE.TorusGeometry(0.012, 0.004, 4, 12).rotateX(Math.PI / 2).translate(0, 0.03, 0), decoMat(0xd83a6a)));
  bob.add(mesh(new THREE.SphereGeometry(0.011, 12, 10).translate(0, 0.054, 0), skin));
  bob.add(mesh(new THREE.SphereGeometry(0.012, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6).translate(0, 0.056, -0.002), decoMat(0x1a1210)));
  bob.add(mesh(new THREE.SphereGeometry(0.005, 8, 6).translate(0.009, 0.06, 0.004), decoMat(0xe8e0d0, { emissive: 0x302820 })));
  for (const sx of [-1, 1]) bob.add(mesh(new THREE.CapsuleGeometry(0.004, 0.03, 3, 6).rotateZ(sx * 2.4).translate(sx * 0.02, 0.05, 0), skin));
  g.add(bob);
  return centered(g);
}

// A garden gnome: red cap, white beard, blue coat, a lantern in hand.
function gardenGnome() {
  const g = new THREE.Group();
  const coat = decoMat(0x2f5a9a, { roughness: 0.55 }),
    cap = decoMat(0xb8281e, { roughness: 0.5 }),
    beard = decoMat(0xe8e4da, { roughness: 0.8 }),
    skin = decoMat(0xe0a888, { roughness: 0.5 }),
    boot = decoMat(0x3a2418, { roughness: 0.6 });
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.03, 16).translate(0, 0.015, 0), decoMat(0x6a7a4a, { roughness: 1 })));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.035, 10, 8).scale(1, 0.6, 1.5).translate(sx * 0.04, 0.045, 0.02), boot));
  g.add(mesh(latheY([[0, 0.04], [0.085, 0.05], [0.09, 0.12], [0.075, 0.2], [0.05, 0.25], [0, 0.26]], 18), coat));
  g.add(mesh(new THREE.TorusGeometry(0.083, 0.008, 6, 20).rotateX(Math.PI / 2).translate(0, 0.12, 0), decoMat(0x3a2a1a)));
  g.add(mesh(new THREE.SphereGeometry(0.055, 14, 12).translate(0, 0.3, 0.005), skin));
  g.add(mesh(new THREE.SphereGeometry(0.014, 8, 6).translate(0, 0.295, 0.058), decoMat(0xe08070)));
  g.add(mesh(latheY([[0, 0.02], [0.055, 0.0], [0.045, -0.06], [0.02, -0.1], [0, -0.11]], 14).translate(0, 0.29, 0.03).rotateX(0.15), beard));
  g.add(mesh(new THREE.ConeGeometry(0.062, 0.17, 16).translate(0, 0.41, -0.01).rotateX(-0.12), cap));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.006, 6, 4).translate(sx * 0.02, 0.315, 0.05), decoMat(0x101010)));
  g.add(mesh(new THREE.CapsuleGeometry(0.018, 0.08, 3, 8).rotateZ(0.6).translate(0.08, 0.17, 0.02), coat));
  g.add(mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.04, 8).translate(0.12, 0.12, 0.03), decoMat(0xd8a83a, { emissive: 0x2a1a04 })));
  grip(g, 'side', 'wrap12', V(0, 0.22, 0), UP, V(0, 0, 1));
  return centered(g);
}

// A worn teddy bear sitting up: ears, snout, button eyes, a ribbon.
function teddyBear() {
  const g = new THREE.Group();
  const fur = decoMat(0x9a6a3a, { roughness: 1 }),
    light = decoMat(0xc8a070, { roughness: 1 }),
    dark = decoMat(0x141010, { roughness: 0.3 });
  g.add(mesh(new THREE.SphereGeometry(0.075, 14, 10).scale(1, 1.15, 0.9).translate(0, 0.09, 0), fur));
  g.add(mesh(new THREE.SphereGeometry(0.045, 12, 8).scale(1, 1.1, 0.5).translate(0, 0.08, 0.05), light));
  g.add(mesh(new THREE.SphereGeometry(0.06, 14, 10).translate(0, 0.21, 0.005), fur));
  g.add(mesh(new THREE.SphereGeometry(0.026, 10, 8).scale(1, 0.8, 1).translate(0, 0.2, 0.055), light));
  g.add(mesh(new THREE.SphereGeometry(0.009, 8, 6).translate(0, 0.207, 0.08), dark));
  for (const sx of [-1, 1]) {
    g.add(mesh(new THREE.SphereGeometry(0.022, 10, 8).scale(1, 1, 0.5).translate(sx * 0.045, 0.26, 0), fur));
    g.add(mesh(new THREE.SphereGeometry(0.008, 8, 6).translate(sx * 0.022, 0.225, 0.052), dark));
    g.add(mesh(new THREE.CapsuleGeometry(0.022, 0.05, 3, 8).rotateZ(sx * 0.7).translate(sx * 0.075, 0.12, 0.01), fur));
    g.add(mesh(new THREE.CapsuleGeometry(0.026, 0.05, 3, 8).rotateX(Math.PI / 2).translate(sx * 0.045, 0.03, 0.05), fur));
  }
  g.add(mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 16).rotateX(Math.PI / 2).translate(0, 0.16, 0), decoMat(0xb8283a)));
  grip(g, 'side', 'wrap12', V(0, 0.12, 0), UP, V(0, 0, 1));
  return centered(g);
}

// A yellow rubber duck.
function rubberDuck() {
  const g = new THREE.Group();
  const y = decoMat(0xf0c818, { roughness: 0.35 });
  g.add(mesh(new THREE.SphereGeometry(0.04, 16, 12).scale(1, 0.7, 1.3).translate(0, 0.028, 0), y));
  g.add(mesh(new THREE.ConeGeometry(0.012, 0.03, 8).rotateX(-0.6).translate(0, 0.045, -0.05), y));
  g.add(mesh(new THREE.SphereGeometry(0.026, 14, 10).translate(0, 0.068, 0.025), y));
  g.add(mesh(new THREE.SphereGeometry(0.012, 10, 8).scale(1.2, 0.5, 1.6).translate(0, 0.064, 0.052), decoMat(0xe86a1a, { roughness: 0.4 })));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.0045, 8, 6).translate(sx * 0.012, 0.076, 0.044), decoMat(0x101010, { roughness: 0.2 })));
  return centered(g);
}

// A chipped enamel mug with a printed band.
function mug(variant = 0) {
  const g = new THREE.Group();
  const enamel = decoMat([0xe8e4da, 0x2a5a8a, 0xb8382a][variant % 3], { roughness: 0.25 });
  g.add(mesh(latheY([[0, 0], [0.04, 0], [0.042, 0.004], [0.042, 0.095], [0.039, 0.095], [0.038, 0.008], [0, 0.008]], 20), enamel));
  g.add(mesh(new THREE.TorusGeometry(0.0425, 0.002, 4, 24).rotateX(Math.PI / 2).translate(0, 0.095, 0), decoMat(0x1a2a3a)));
  g.add(mesh(new THREE.TorusGeometry(0.025, 0.006, 6, 14, Math.PI).rotateZ(-Math.PI / 2).translate(0.042, 0.05, 0), enamel));
  g.add(mesh(new THREE.CircleGeometry(0.008, 8).translate(0.02, 0.06, 0.0422), decoMat(0x1a1a1a)));
  return centered(g);
}

// ------------------------------------------------------------------ spare battery / wheel built from car parts by the caller
export const MODEL_BUILDERS = {
  airFreshener,
  decoBeetle,
  decoOctopus,
  juicePop,
  decoLog,
  decoBat,
  reflector,
  fuzzyDice,
  bobbleDog,
  hulaGirl,
  gardenGnome,
  teddyBear,
  rubberDuck,
  mug,
  tv,
  drum,
  sandbag,
  jack: () => jackModel(),
  carbKit: () => carbKitModel(),
  tentBag: (variant = 0) => tentBagModel(variant),
  accessory: accessoryItemModel,
  plate: (id, variant) => plateModel(id, variant),
  note,
  sponge,
  wireBrush,
  sprayPaint,
  cigarettes,
  coffee,
  thermos,
  blanket,
  campfireKit,
  meatChunk,
  fishingRod,
  fish,
  jerryCan,
  waterBottle,
  sodaCan,
  cannedFood,
  snackBag,
  chocolate,
  mre,
  medkit,
  bandage,
  pillBottle,
  oilBottle,
  coolantJug,
  waterJug,
  repairKit,
  wrench,
  extinguisher,
  lantern,
  revolver,
  shotgun,
  ammoBox,
  cdCase,
};
