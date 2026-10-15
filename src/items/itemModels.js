// Procedural models for loose items. Each builder returns a THREE.Group whose origin is the
// item's centre of mass; models are detailed but compact (they are seen up close in the hand).

import * as THREE from 'three';
import { latheY, roundedBox, tubeAlong, loftSections, superSection } from '../gfx/geom.js';
import { makeCanvas, canvasTexture, cached } from '../gfx/textures.js';
import { addSurfaceDetail } from '../gfx/triplanar.js';

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
  group.userData.size = b.getSize(new THREE.Vector3());
  return group;
}

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
  // three-bar handle
  for (const z of [-0.07, 0, 0.07]) g.add(mesh(roundedBox(0.03, 0.06, 0.018, 0.008, 2).translate(0, 0.24, z - 0.05), mat));
  g.add(mesh(roundedBox(0.035, 0.022, 0.2, 0.01, 2).translate(0, 0.28, -0.05), mat));
  // spout with cap
  const spout = latheY([[0.026, 0], [0.026, 0.035], [0.03, 0.04], [0.03, 0.07], [0.0, 0.07]], 18);
  spout.rotateX(0.5);
  spout.translate(0, 0.205, 0.13);
  g.add(mesh(spout, M.darkSteel));
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6).rotateZ(Math.PI / 2).translate(0, 0.25, 0.1), M.darkSteel));
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
  g.add(mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.022, 16).translate(0, 0.3, 0), M.capBlue));
  const label = labelMat('water', 256, 64, (c, w, h) => {
    c.fillStyle = '#e9f1f4';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#2462a8';
    c.fillRect(0, 0, w, 10);
    c.font = 'bold 28px Arial';
    c.fillText('SPRING WATER 1.5L', 14, 44);
  });
  g.add(mesh(new THREE.CylinderGeometry(0.0435, 0.0435, 0.07, 28, 1, true).translate(0, 0.14, 0), label, false));
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
  return centered(g);
}

export function sponge() {
  const g = new THREE.Group();
  const m = cached('spongeMat', () => addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0xd9b23a, roughness: 0.95 }), 'cast', 1.2));
  const scour = cached('scourMat', () => new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 1 }));
  g.add(mesh(roundedBox(0.12, 0.035, 0.075, 0.012, 3).translate(0, 0.0175, 0), m));
  g.add(mesh(roundedBox(0.12, 0.01, 0.075, 0.004, 2).translate(0, 0.04, 0), scour));
  return centered(g);
}

export function sprayPaint() {
  const M = itemMats();
  const g = new THREE.Group();
  const lab = labelMat('spray', 256, 128, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#1d4e8a');
    gr.addColorStop(0.5, '#c23b22');
    gr.addColorStop(1, '#e0b21c');
    c.fillStyle = gr;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff';
    c.font = 'bold 30px Arial';
    c.fillText('AUTO ENAMEL', 18, 74);
  }, { metalness: 0.5, roughness: 0.35 });
  g.add(mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.16, 24, 1, true).translate(0, 0.085, 0), lab));
  g.add(mesh(latheY([[0.0, 0.0], [0.03, 0.0], [0.033, 0.005]], 24), M.steel));
  g.add(mesh(latheY([[0.033, 0.165], [0.02, 0.185], [0.012, 0.19], [0.0, 0.19]], 24), M.steel));
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.015, 10).translate(0, 0.197, 0), M.rubber));
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
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 0.16 + 0.5, p.getZ(i) / 0.06 + 0.5);
  g.add(mesh(geo, m));
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
  g.add(mesh(tubeAlong([V(-0.04, 0.045, -0.1), V(-0.04, 0.07, -0.13), V(0.04, 0.07, -0.13), V(0.04, 0.045, -0.1)], 0.008, 6), M.rubber));
  return centered(g);
}

export function bandage() {
  const g = new THREE.Group();
  const M = itemMats();
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 20).rotateZ(Math.PI / 2), M.white));
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.072, 12).rotateZ(Math.PI / 2), M.cardboard));
  return centered(g);
}

export function pillBottle() {
  const M = itemMats();
  const g = new THREE.Group();
  g.add(mesh(latheY([[0, 0], [0.025, 0], [0.026, 0.07], [0, 0.07]], 18), M.glassAmber, false));
  g.add(mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 18).translate(0, 0.08, 0), M.capWhite));
  return centered(g);
}

export function oilBottle() {
  const M = itemMats();
  const g = new THREE.Group();
  const body = roundedBox(0.12, 0.22, 0.07, 0.02, 3);
  g.add(mesh(body.translate(0, 0.11, 0), M.yellowPlastic));
  g.add(mesh(latheY([[0.016, 0], [0.016, 0.03], [0.02, 0.035], [0.02, 0.05], [0, 0.05]], 16).translate(0.03, 0.22, 0), M.rubber));
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
  return centered(g);
}

export function coolantJug() {
  const M = itemMats();
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.16, 0.28, 0.1, 0.025, 3).translate(0, 0.14, 0), M.greenPlastic));
  g.add(mesh(tubeAlong([V(0.03, 0.27, 0), V(0.07, 0.31, 0), V(0.075, 0.2, 0)], 0.012, 6), M.greenPlastic));
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 14).translate(-0.04, 0.295, 0), M.capWhite));
  return centered(g);
}

export function waterJug() {
  const M = itemMats();
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.2, 0.3, 0.16, 0.04, 3).translate(0, 0.15, 0), M.plasticBlue, false));
  const fill = mesh(roundedBox(0.185, 0.24, 0.145, 0.03, 2).translate(0, 0.13, 0), M.water, false);
  fill.name = 'fill';
  g.add(fill);
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 16).translate(0, 0.315, 0), M.capBlue));
  g.add(mesh(tubeAlong([V(-0.06, 0.3, 0), V(-0.03, 0.34, 0), V(0.03, 0.34, 0), V(0.06, 0.3, 0)], 0.01, 6), M.capBlue));
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
  return centered(g);
}

export function wrench() {
  const M = itemMats();
  const g = new THREE.Group();
  const shaft = roundedBox(0.3, 0.012, 0.028, 0.005, 2);
  g.add(mesh(shaft, M.steel));
  // open end
  const head = new THREE.Shape();
  head.absarc(0, 0, 0.032, 0, Math.PI * 2, false);
  const jaw = new THREE.Path();
  jaw.moveTo(0.04, -0.012);
  jaw.lineTo(0.0, -0.012);
  jaw.lineTo(0.0, 0.012);
  jaw.lineTo(0.04, 0.012);
  head.holes.push(jaw);
  const hg = new THREE.ExtrudeGeometry(head, { depth: 0.012, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 });
  hg.rotateX(Math.PI / 2);
  hg.translate(0.17, 0.006, 0);
  g.add(mesh(hg, M.steel));
  const ring = new THREE.TorusGeometry(0.024, 0.009, 8, 20).rotateX(Math.PI / 2).translate(-0.17, 0, 0);
  g.add(mesh(ring, M.steel));
  return centered(g);
}

export function extinguisher() {
  const M = itemMats();
  const g = new THREE.Group();
  g.add(mesh(latheY([[0, 0], [0.06, 0.0], [0.065, 0.02], [0.065, 0.36], [0.05, 0.4], [0.02, 0.42], [0, 0.42]], 24), M.redPaint));
  g.add(mesh(roundedBox(0.03, 0.06, 0.12, 0.008, 2).translate(0, 0.46, 0.02), M.darkSteel));
  g.add(mesh(tubeAlong([V(0, 0.44, -0.03), V(0, 0.4, -0.09), V(0, 0.2, -0.08), V(0, 0.12, -0.075)], 0.01, 6), M.rubber));
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
  return centered(g);
}

// ------------------------------------------------------------------ weapons
export function revolver() {
  const M = itemMats();
  const g = new THREE.Group();
  // barrel along +z (muzzle forward)
  g.add(mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.15, 16).rotateX(Math.PI / 2).translate(0, 0.045, 0.1), M.blued));
  g.add(mesh(roundedBox(0.018, 0.012, 0.15, 0.004, 1).translate(0, 0.057, 0.1), M.blued));
  g.add(mesh(roundedBox(0.004, 0.012, 0.01, 0.001, 1).translate(0, 0.066, 0.17), M.blued));
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 12).rotateX(Math.PI / 2).translate(0, 0.031, 0.09), M.blued));
  // cylinder with flutes
  const cyl = new THREE.CylinderGeometry(0.02, 0.02, 0.042, 6 * 4).rotateX(Math.PI / 2);
  const p = cyl.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i);
    const a = Math.atan2(y, x);
    const r = Math.hypot(x, y);
    if (r > 0.015) {
      const f = 1 - 0.12 * Math.max(0, Math.cos(a * 6));
      p.setX(i, x * f);
      p.setY(i, y * f);
    }
  }
  cyl.computeVertexNormals();
  const cylMesh = mesh(cyl.translate(0, 0.04, 0.0), M.blued);
  cylMesh.name = 'cylinder';
  g.add(cylMesh);
  // frame
  g.add(mesh(roundedBox(0.016, 0.05, 0.07, 0.006, 2).translate(0, 0.035, -0.005), M.blued));
  // hammer
  g.add(mesh(roundedBox(0.006, 0.026, 0.012, 0.002, 1).translate(0, 0.062, -0.04), M.blued));
  // trigger guard + trigger
  g.add(mesh(new THREE.TorusGeometry(0.016, 0.003, 6, 16, Math.PI * 1.3).rotateY(Math.PI / 2).translate(0, 0.006, 0.0), M.blued));
  g.add(mesh(roundedBox(0.004, 0.018, 0.005, 0.0015, 1).translate(0, 0.008, -0.002), M.steel));
  // grip (walnut) angled back
  const grip = roundedBox(0.026, 0.085, 0.034, 0.01, 3);
  grip.rotateX(-0.35);
  grip.translate(0, -0.025, -0.045);
  g.add(mesh(grip, M.walnut));
  g.userData.muzzle = V(0, 0.045, 0.18);
  return g;
}

export function shotgun() {
  const M = itemMats();
  const g = new THREE.Group();
  for (const x of [-0.011, 0.011]) g.add(mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.6, 14).rotateX(Math.PI / 2).translate(x, 0.04, 0.32), M.blued));
  g.add(mesh(roundedBox(0.016, 0.006, 0.6, 0.002, 1).translate(0, 0.053, 0.32), M.blued));
  g.add(mesh(roundedBox(0.04, 0.03, 0.22, 0.008, 2).translate(0, 0.022, 0.24), M.walnut));
  g.add(mesh(roundedBox(0.044, 0.05, 0.1, 0.006, 2).translate(0, 0.035, -0.0), M.steel));
  // stock
  const secs = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const z = -0.05 - t * 0.36;
    const y = 0.02 - t * 0.07;
    secs.push(superSection(V(0, y, z), V(1, 0, 0), V(0, 1, 0), 0.02 + 0.005 * t, 0.025 + 0.045 * t, 3, 16));
  }
  g.add(mesh(loftSections(secs, { capStart: true, capEnd: true }), M.walnut));
  g.add(mesh(new THREE.TorusGeometry(0.018, 0.003, 6, 16, Math.PI * 1.3).rotateY(Math.PI / 2).translate(0, -0.005, 0.02), M.blued));
  g.userData.muzzle = V(0, 0.04, 0.63);
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
  return centered(g);
}

// ------------------------------------------------------------------ spare battery / wheel built from car parts by the caller
export const MODEL_BUILDERS = {
  note,
  sponge,
  sprayPaint,
  cigarettes,
  coffee,
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
};
