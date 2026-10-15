// Interior: dashboard, gauge cluster with live needles, centre stack and console, steering,
// pedals, seats, door trims, mirror, visors, dome light, parcel shelf, mats and belts.
// Everything is authored in car space; seats/steering wheel are returned as separate groups
// so they can be installed or removed as parts.

import * as THREE from 'three';
import { loftSections, superSection, roundedBox, latheY, tubeAlong, smoothClosed2 } from '../../gfx/geom.js';
import { makeCanvas, canvasTexture, cached } from '../../gfx/textures.js';
import { addSurfaceDetail, makeUpholstery } from '../../gfx/triplanar.js';
import { bodyField } from '../body/shape.js';
import { skinTopY, skinAlong } from '../body/probe.js';
import { GLASS_FRAMES } from '../body/shape.js';
import { yBelt } from '../body/regions.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Driver ergonomics (car space, LHD: driver on +X).
export const DRIVER = {
  x: 0.37,
  seatZ: -0.16, // seat cushion centre
  hip: V(0.37, 0.56, -0.27),
  eye: V(0.37, 1.17, -0.34),
  wheelCenter: V(0.37, 0.935, 0.255),
  wheelNormal: V(0, 0.36, -0.933).normalize(),
};

const smooth01 = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// Shift pattern engraved on the knob top (1-5, R).
function shiftPatternMat() {
  return cached('shiftPat', () => {
    const c = makeCanvas(128, 128);
    const x = c.getContext('2d');
    x.fillStyle = '#1d1c1b';
    x.fillRect(0, 0, 128, 128);
    x.strokeStyle = '#b8b2a6';
    x.lineWidth = 4;
    x.beginPath();
    for (const cx of [32, 64, 96]) {
      x.moveTo(cx, 30);
      x.lineTo(cx, 98);
    }
    x.moveTo(32, 64);
    x.lineTo(96, 64);
    x.stroke();
    x.fillStyle = '#d9d3c6';
    x.font = 'bold 18px Arial';
    x.textAlign = 'center';
    [['1', 32, 24], ['2', 32, 118], ['3', 64, 24], ['4', 64, 118], ['5', 96, 24], ['R', 96, 118]].forEach(([t, px, py]) => x.fillText(t, px, py));
    return new THREE.MeshStandardMaterial({ map: canvasTexture(c, { wrap: false }), roughness: 0.5 });
  });
}

// ---------- materials ----------
export function createInteriorMaterials() {
  return cached('interiorMats', () => {
    const m = {
      dashTop: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x2c2c2d, roughness: 0.82 }), 'grain', 0.25),
      dashLow: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x5b5a56, roughness: 0.78 }), 'grain', 0.25),
      plastic: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x353536, roughness: 0.7 }), 'grain', 0.2),
      piano: new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.15, clearcoat: 0.8 }),
      satin: new THREE.MeshStandardMaterial({ color: 0x9a9da0, metalness: 0.8, roughness: 0.35 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xdadcde, metalness: 1, roughness: 0.12 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }),
      leather: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x1f1e1d, roughness: 0.6 }), 'grain', 0.35),
      pillarTrim: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.85 }), 'grain', 0.18),
      seatSide: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x3e3d3b, roughness: 0.9 }), 'weave', 0.22),
      seatInsert: null,
      carpet: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x2c2a28, roughness: 1 }), 'carpet', 0.45, { tint: 0.25 }),
      headliner: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0xb3ada2, roughness: 0.96 }), 'weave', 0.12),
      belt: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.8 }), 'weave', 0.2),
      gauge: null,
      needle: new THREE.MeshStandardMaterial({ color: 0xe0491d, emissive: 0xff5a20, emissiveIntensity: 0.0, roughness: 0.4 }),
      display: new THREE.MeshStandardMaterial({ color: 0x0d1410, emissive: 0x7dd3a6, emissiveIntensity: 0.0, roughness: 0.3 }),
      domeLens: new THREE.MeshStandardMaterial({ color: 0xe8e4da, emissive: 0xfff1d6, emissiveIntensity: 0, roughness: 0.4, transparent: true, opacity: 0.9 }),
      speaker: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x1c1c1d, roughness: 0.8 }), 'weave', 0.5),
      mirror: new THREE.MeshStandardMaterial({ color: 0xbfc6cc, metalness: 1, roughness: 0.03 }),
      brakeLight: new THREE.MeshStandardMaterial({ color: 0x5a0606, emissive: 0xff1a0a, emissiveIntensity: 0, roughness: 0.3 }),
    };
    // Seat insert fabric: woven pattern with subtle vertical stitch channels.
    const c = makeCanvas(256, 256);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#6b6862';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 2) {
      for (let x = 0; x < 256; x += 2) {
        const v = 84 + (((x >> 1) + (y >> 1)) % 2) * 6 + ((x * 31 + y * 17) % 5);
        ctx.fillStyle = `rgb(${v},${v - 3},${v - 7})`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
    ctx.fillStyle = 'rgba(20,20,20,0.28)';
    for (let x = 0; x < 256; x += 64) ctx.fillRect(x, 0, 2, 256);
    const tex = canvasTexture(c, { repeat: [3, 3] });
    m.seatInsert = addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.95 }), 'weave', 0.18);
    const ins = [0.27, 0.265, 0.25];
    m.uphFrontCushion = makeUpholstery(0x3e3d3b, ins, { kind: 'cushion', hx: 0.13, y0: 0.085, hz: 0.2 });
    m.uphFrontBack = makeUpholstery(0x3e3d3b, ins, { kind: 'back', hx: 0.13, y0: 0.06, y1: 0.5 });
    m.uphRearCushion = makeUpholstery(0x3e3d3b, ins, { kind: 'cushion', hx: 0.15, y0: 0.075, hz: 0.19 });
    m.uphRearBack = makeUpholstery(0x3e3d3b, ins, { kind: 'back', hx: 0.15, y0: 0.06, y1: 0.46 });
    m.gauge = new THREE.MeshStandardMaterial({ color: 0xffffff, map: gaugeTexture(), emissive: 0xffffff, emissiveMap: gaugeTexture(), emissiveIntensity: 0.3, roughness: 0.35 });
    return m;
  });
}

// ---------- gauge face texture ----------
function gaugeTexture() {
  return cached('gaugeTex', () => {
    const W = 1024,
      H = 384;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0a0a0b';
    ctx.fillRect(0, 0, W, H);
    const dial = (cx, cy, r, max, step, label, red, unit) => {
      // bezel
      ctx.strokeStyle = '#2f3134';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
      ctx.stroke();
      const a0 = Math.PI * 0.75,
        a1 = Math.PI * 2.25;
      for (let v = 0; v <= max; v += step / 2) {
        const t = v / max;
        const a = a0 + (a1 - a0) * t;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        ctx.strokeStyle = red !== null && v >= red ? '#e04a22' : '#e9e7e0';
        ctx.lineWidth = major ? 4 : 2;
        const r0 = r - (major ? 22 : 12);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
        if (major) {
          ctx.fillStyle = '#e9e7e0';
          ctx.font = `600 ${Math.round(r * 0.16)}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const rr = r - 44;
          ctx.fillText(String(label(v)), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
      }
      ctx.fillStyle = '#9a9890';
      ctx.font = `500 ${Math.round(r * 0.1)}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText(unit, cx, cy + r * 0.42);
    };
    // Tachometer (left, driver's view) and speedometer (right).
    dial(260, 190, 150, 8, 1, (v) => v, 6.5, 'x1000 rpm');
    dial(764, 190, 150, 220, 20, (v) => v, null, 'km/h');
    // Fuel and temperature arcs in the middle.
    const arc = (cx, cy, r, labelL, labelR, warnLeft) => {
      ctx.lineWidth = 3;
      const a0 = Math.PI * 1.15,
        a1 = Math.PI * 1.85;
      for (let i = 0; i <= 8; i++) {
        const a = a0 + ((a1 - a0) * i) / 8;
        ctx.strokeStyle = (warnLeft && i < 2) || (!warnLeft && i > 6) ? '#e04a22' : '#e9e7e0';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (r - (i % 4 === 0 ? 14 : 8)), cy + Math.sin(a) * (r - (i % 4 === 0 ? 14 : 8)));
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.fillStyle = '#e9e7e0';
      ctx.font = '600 20px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(labelL, cx + Math.cos(a0) * (r + 6) - 8, cy + Math.sin(a0) * (r + 6) + 18);
      ctx.fillText(labelR, cx + Math.cos(a1) * (r + 6) + 8, cy + Math.sin(a1) * (r + 6) + 18);
    };
    arc(512, 150, 70, 'E', 'F', true);
    arc(512, 300, 70, 'C', 'H', false);
    // Odometer window
    ctx.fillStyle = '#121513';
    ctx.fillRect(712, 270, 104, 30);
    ctx.fillStyle = '#7dd3a6';
    ctx.font = '600 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('184 213', 764, 293);
    return canvasTexture(c, { wrap: false });
  });
}

// ---------- helpers ----------
function sectionLoftAlongX(xs, profileAt, { capStart = true, capEnd = true, n = 28 } = {}) {
  const sections = xs.map((x) => smoothClosed2(profileAt(x), n).map(([z, y]) => V(x, y, z)));
  return loftSections(sections, { capStart, capEnd });
}

function mesh(geo, mat, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

const clampToSkin = (x, z, y, margin) => {
  let top = 2;
  try {
    top = skinTopY(x, z, 0.5, 2.0);
  } catch (e) {
    /* keep */
  }
  return Math.min(y, top - margin);
};

// ---------- dashboard ----------
export function buildDashboard(M) {
  const g = new THREE.Group();
  const xs = [];
  for (let i = 0; i <= 30; i++) xs.push(-0.735 + (1.47 * i) / 30);
  const base = [
    [1.0, 0.965],
    [0.82, 0.985],
    [0.66, 1.0],
    [0.6, 0.997],
    [0.57, 0.975],
    [0.555, 0.93],
    [0.55, 0.86],
    [0.548, 0.79],
    [0.565, 0.71],
    [0.6, 0.655],
    [0.66, 0.62],
    [0.8, 0.6],
    [0.93, 0.62],
    [0.99, 0.78],
  ];
  // the instrument pocket: the dash top dips in front of the driver so the dials sit in a recess
  const pocket = (x) => {
    const t = Math.abs(x - 0.37) / 0.2;
    return t < 0.8 ? 1 : t > 1.08 ? 0 : 1 - smooth01((t - 0.8) / 0.28);
  };
  const profileAt = (x) => {
    const ax = Math.abs(x);
    const endTaper = Math.max(0, ax - 0.62) / 0.12; // ends get shallower under the A-pillars
    const w = pocket(x);
    return base.map(([z0, y0], i) => {
      let z = z0,
        y = y0;
      if (w > 0) {
        if (i === 2) [z, y] = [lerp(z0, 0.71, w), y0];
        if (i === 3) [z, y] = [lerp(z0, 0.705, w), lerp(y0, 0.885, w)];
        if (i === 4) [z, y] = [lerp(z0, 0.6, w), lerp(y0, 0.882, w)];
        if (i === 5) [z, y] = [z0, lerp(y0, 0.885, w)];
      }
      let zz = z,
        yy = y;
      // front edge must stay under the windshield / cowl
      zz = Math.min(zz, 1.0 - 0.1 * endTaper * endTaper);
      yy = clampToSkin(x, zz, yy, 0.04);
      // ends round off
      if (endTaper > 0 && y > 0.9) yy -= 0.025 * endTaper * endTaper;
      return [zz, yy];
    });
  };
  const top = sectionLoftAlongX(xs, profileAt);
  g.add(mesh(top, M.dashTop));

  // Lower trim / knee panel across the passenger side + glovebox lid with seam.
  const glove = roundedBox(0.36, 0.13, 0.03, 0.012, 3);
  glove.rotateX(-0.25);
  glove.translate(-0.37, 0.735, 0.555);
  g.add(mesh(glove, M.dashLow));
  const gloveHandle = roundedBox(0.09, 0.018, 0.02, 0.006, 2);
  gloveHandle.translate(-0.37, 0.79, 0.54);
  g.add(mesh(gloveHandle, M.satin));
  // Driver knee panel with fuse cover outline
  const knee = roundedBox(0.4, 0.12, 0.025, 0.01, 3);
  knee.rotateX(-0.3);
  knee.translate(0.4, 0.69, 0.585);
  g.add(mesh(knee, M.dashLow));

  // Decorative satin strip across the dash face (passenger side).
  const strip = tubeAlong(
    [V(-0.7, 0.87, 0.551), V(-0.4, 0.87, 0.549), V(-0.17, 0.87, 0.549)],
    0.006,
    8
  );
  g.add(mesh(strip, M.satin));

  // Air vents: two outer, two centre.
  const vent = (x, y, z, w, h) => {
    const vg = new THREE.Group();
    const frame = roundedBox(w + 0.016, h + 0.016, 0.03, 0.01, 3);
    frame.translate(x, y, z);
    vg.add(mesh(frame, M.plastic));
    const back = roundedBox(w, h, 0.01, 0.006, 2);
    back.translate(x, y, z - 0.008);
    vg.add(mesh(back, M.rubber, false));
    for (let k = 0; k < 4; k++) {
      const vane = roundedBox(w - 0.006, 0.004, 0.022, 0.0015, 1);
      vane.rotateX(-0.25);
      vane.translate(x, y - h / 2 + (h * (k + 0.5)) / 4, z - 0.004);
      vg.add(mesh(vane, M.plastic, false));
    }
    return vg;
  };
  g.add(vent(0.66, 0.9, 0.56, 0.085, 0.06));
  g.add(vent(-0.66, 0.9, 0.56, 0.085, 0.06));
  g.add(vent(0.075, 0.935, 0.5, 0.09, 0.05));
  g.add(vent(-0.075, 0.935, 0.5, 0.09, 0.05));
  return g;
}

// ---------- instrument binnacle & gauges ----------
export function buildCluster(M) {
  const g = new THREE.Group();
  const xs = [];
  for (let i = 0; i <= 14; i++) xs.push(0.18 + (0.38 * i) / 14);
  const hood = sectionLoftAlongX(xs, (x) => {
    const t = (x - 0.37) / 0.19;
    const lift = 0.045 * Math.sqrt(Math.max(0, 1 - t * t));
    const y = 1.012;
    return [
      [0.72, y - 0.006],
      [0.64, y + lift],
      [0.565, y + lift + 0.004],
      [0.53, y - 0.005 + lift * 0.9],
      [0.535, y - 0.016 + lift * 0.7],
      [0.6, y + lift * 0.4],
      [0.715, y - 0.008],
    ];
  });
  g.add(mesh(hood, M.dashTop));
  // back wall of the pocket behind the dials
  const wall = roundedBox(0.4, 0.15, 0.02, 0.008, 2);
  wall.translate(0.37, 0.955, 0.715);
  g.add(mesh(wall, M.dashTop, false));
  // Gauge face (tilted toward the driver's eye).
  const face = new THREE.PlaneGeometry(0.32, 0.12);
  const tilt = new THREE.Group();
  const fm = mesh(face, M.gauge, false);
  tilt.add(fm);
  tilt.position.set(0.37, 0.948, 0.64);
  tilt.lookAt(DRIVER.eye);
  g.add(tilt);
  // Needles: pivot groups in face space. Face 0.32 x 0.12 maps texture 1024x384.
  const needles = {};
  const toFace = (px, py) => V((px / 1024 - 0.5) * 0.32, (0.5 - py / 384) * 0.12, 0.003);
  const mk = (name, px, py, len) => {
    const piv = new THREE.Group();
    piv.position.copy(toFace(px, py));
    const ng = roundedBox(0.0035, len, 0.0015, 0.0008, 1);
    ng.translate(0, len / 2 - 0.006, 0);
    piv.add(mesh(ng, M.needle, false));
    const hub = new THREE.CylinderGeometry(0.0055, 0.0055, 0.003, 16);
    hub.rotateX(Math.PI / 2);
    piv.add(mesh(hub, M.piano, false));
    tilt.add(piv);
    needles[name] = piv;
  };
  mk('rpm', 260, 190, 0.042);
  mk('speed', 764, 190, 0.042);
  mk('fuel', 512, 150, 0.02);
  mk('temp', 512, 300, 0.02);
  g.userData.needles = needles;
  return g;
}

// Needle angle helpers (radians, clockwise on the face from the 0 position).
export function setNeedle(needles, name, t) {
  const n = needles && needles[name];
  if (!n) return;
  // dial sweep: from 135deg to 405deg in canvas space (clockwise) = 270 deg; small arcs: 126deg
  const sweep = name === 'fuel' || name === 'temp' ? Math.PI * 0.7 : Math.PI * 1.5;
  const start = name === 'fuel' || name === 'temp' ? Math.PI * 0.35 : Math.PI * 0.75;
  // canvas angle a (clockwise from +x). Needle points +y in face space at rotation 0 (= canvas angle -90deg).
  const a = start + sweep * Math.min(1, Math.max(0, t));
  n.rotation.z = -(a + Math.PI / 2);
}

// ---------- centre stack, console, shifter, handbrake ----------
export function buildCenterStack(M) {
  const g = new THREE.Group();
  const xs = [];
  for (let i = 0; i <= 10; i++) xs.push(-0.16 + (0.32 * i) / 10);
  const stack = sectionLoftAlongX(xs, (x) => {
    const r = Math.abs(x) / 0.16;
    const inset = 0.01 * r * r;
    return [
      [0.62, 0.97],
      [0.53, 0.975],
      [0.495 + inset, 0.96],
      [0.49 + inset, 0.86],
      [0.5 + inset, 0.72],
      [0.53 + inset, 0.6],
      [0.6, 0.48],
      [0.7, 0.47],
      [0.72, 0.8],
    ];
  });
  g.add(mesh(stack, M.dashLow));
  // Radio head unit
  const radio = roundedBox(0.2, 0.06, 0.02, 0.006, 2);
  radio.translate(0, 0.855, 0.488);
  g.add(mesh(radio, M.piano));
  const disp = new THREE.PlaneGeometry(0.1, 0.022);
  disp.rotateY(Math.PI);
  disp.translate(0, 0.862, 0.477);
  const dm = mesh(disp, M.display, false);
  dm.name = 'radioDisplay';
  g.add(dm);
  for (let k = 0; k < 6; k++) {
    const b = roundedBox(0.022, 0.009, 0.006, 0.002, 1);
    b.translate(-0.06 + k * 0.024, 0.836, 0.478);
    g.add(mesh(b, M.plastic, false));
  }
  for (const sx of [-0.082, 0.082]) {
    const knob = latheY(
      [
        [0.0, 0.012],
        [0.011, 0.011],
        [0.013, 0.0],
      ],
      20
    );
    knob.rotateX(-Math.PI / 2);
    knob.translate(sx, 0.857, 0.48);
    g.add(mesh(knob, M.satin, false));
  }
  // HVAC panel: three knobs
  const panel = roundedBox(0.2, 0.06, 0.012, 0.008, 2);
  panel.translate(0, 0.745, 0.5);
  g.add(mesh(panel, M.plastic));
  for (const sx of [-0.065, 0, 0.065]) {
    const knob = latheY(
      [
        [0.0, 0.016],
        [0.018, 0.015],
        [0.02, 0.004],
        [0.019, 0.0],
      ],
      24
    );
    knob.rotateX(-Math.PI / 2);
    knob.translate(sx, 0.745, 0.493);
    g.add(mesh(knob, M.satin, false));
  }
  // Hazard button
  const hz = roundedBox(0.03, 0.016, 0.01, 0.004, 2);
  hz.translate(0, 0.905, 0.488);
  g.add(mesh(hz, M.brakeLight, false));

  // Console: from the stack base back between the seats with a storage armrest.
  const cz = [];
  for (let i = 0; i <= 16; i++) cz.push(0.5 - (0.98 * i) / 16);
  const sections = cz.map((z) => {
    const armrest = z < -0.08 ? Math.min(1, (-0.08 - z) / 0.06) : 0;
    const h = 0.43 + 0.17 * armrest + (z > 0.4 ? 0.06 * ((z - 0.4) / 0.1) : 0);
    const w = 0.105 + 0.01 * armrest;
    return superSection(V(0, (0.28 + h) / 2, z), V(1, 0, 0), V(0, 1, 0), w, (h - 0.28) / 2 + 0.005, 6, 24);
  });
  g.add(mesh(loftSections(sections, { capStart: true, capEnd: true }), M.plastic));
  // Twin cupholders recessed into the console top, 12 V socket, coin tray
  for (const zc of [0.06, -0.035]) {
    const cup = latheY(
      [
        [0.04, 0.0],
        [0.038, -0.006],
        [0.036, -0.06],
        [0.0, -0.062],
      ],
      24
    );
    cup.translate(0, 0.437, zc);
    g.add(mesh(cup, M.rubber, false));
    const rim = new THREE.TorusGeometry(0.041, 0.003, 6, 28);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, 0.437, zc);
    g.add(mesh(rim, M.satin, false));
  }
  const sock = latheY([[0.0, -0.004], [0.011, -0.002], [0.012, 0.004], [0.009, 0.004], [0.0, -0.002]], 18);
  sock.rotateX(-Math.PI / 2);
  sock.translate(0.05, 0.6, 0.474);
  g.add(mesh(sock, M.satin, false));
  const tray = roundedBox(0.13, 0.008, 0.07, 0.006, 2);
  tray.translate(0, 0.53, 0.49);
  g.add(mesh(tray, M.rubber, false));
  // Shifter gate surround with chrome ring and printed shift pattern
  const sur = roundedBox(0.12, 0.01, 0.14, 0.02, 3);
  sur.translate(0, 0.442, 0.24);
  g.add(mesh(sur, M.piano, false));
  const ring = new THREE.TorusGeometry(0.058, 0.003, 6, 32);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0.447, 0.24);
  g.add(mesh(ring, M.chrome, false));
  // Armrest lid (leather)
  const lid = roundedBox(0.22, 0.03, 0.3, 0.014, 3);
  lid.translate(0, 0.62, -0.28);
  g.add(mesh(lid, M.leather));
  // Shifter: boot, lever, knob
  const boot = latheY(
    [
      [0.06, 0.0],
      [0.055, 0.01],
      [0.044, 0.04],
      [0.03, 0.07],
      [0.014, 0.1],
      [0.009, 0.11],
    ],
    16
  );
  // wrinkles
  const bp = boot.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i),
      y = bp.getY(i),
      z = bp.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.06 * Math.sin(a * 7) * Math.sin(y * 60);
    bp.setXYZ(i, x * k, y, z * k);
  }
  boot.computeVertexNormals();
  boot.translate(0, 0.44, 0.24);
  g.add(mesh(boot, M.leather));
  const lever = new THREE.CylinderGeometry(0.006, 0.007, 0.08, 10);
  lever.translate(0, 0.585, 0.235);
  g.add(mesh(lever, M.satin, false));
  const knobS = new THREE.SphereGeometry(0.024, 20, 14);
  knobS.scale(1, 0.85, 1.05);
  knobS.translate(0, 0.63, 0.232);
  g.add(mesh(knobS, M.leather));
  const pat = new THREE.CircleGeometry(0.014, 20);
  pat.rotateX(-Math.PI / 2);
  pat.translate(0, 0.6505, 0.232);
  g.add(mesh(pat, shiftPatternMat(), false));
  // Handbrake lever beside the console
  const hb = new THREE.Group();
  const hbBody = roundedBox(0.035, 0.03, 0.26, 0.012, 3);
  hbBody.translate(0, 0, -0.13);
  hb.add(mesh(hbBody, M.plastic));
  const hbGrip = roundedBox(0.038, 0.034, 0.1, 0.014, 3);
  hbGrip.translate(0, 0.002, -0.22);
  hb.add(mesh(hbGrip, M.leather));
  const btn = new THREE.CylinderGeometry(0.008, 0.008, 0.01, 12);
  btn.rotateX(Math.PI / 2);
  btn.translate(0, 0, -0.276);
  hb.add(mesh(btn, M.satin, false));
  hb.position.set(0, 0.49, 0.04);
  hb.rotation.x = 0.22;
  hb.name = 'handbrake';
  g.add(hb);
  g.userData.handbrake = hb;
  return g;
}

// ---------- steering ----------
export function buildSteering(M) {
  const g = new THREE.Group(); // column + shroud (fixed)
  const wheelPivot = new THREE.Group(); // rotates with steering
  const c = DRIVER.wheelCenter;
  const n = DRIVER.wheelNormal;
  // Column shroud: from the dash to behind the wheel hub.
  const start = V(DRIVER.x, 0.86, 0.57);
  const end = c.clone().addScaledVector(n, 0.055);
  const shroudSecs = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const p = start.clone().lerp(end, t);
    const dir = end.clone().sub(start).normalize();
    const right = V(1, 0, 0);
    const up = right.clone().cross(dir).normalize().negate();
    shroudSecs.push(superSection(p, right, up, 0.055 - 0.012 * t, 0.045 - 0.01 * t, 3.2, 20));
  }
  g.add(mesh(loftSections(shroudSecs, { capStart: true, capEnd: true }), M.plastic));
  // Stalks (indicator / wiper)
  for (const s of [1, -1]) {
    const stalk = tubeAlong(
      [end.clone().add(V(0.04 * s, 0.01, 0.0)), end.clone().add(V(0.1 * s, 0.015, -0.015)), end.clone().add(V(0.145 * s, 0.02, -0.03))],
      0.006,
      8
    );
    g.add(mesh(stalk, M.plastic, false));
  }
  // Ignition barrel on the right side of the shroud
  const ign = latheY(
    [
      [0.0, 0.0],
      [0.014, 0.0],
      [0.016, 0.012],
      [0.0, 0.014],
    ],
    20
  );
  ign.rotateZ(-Math.PI / 2);
  const ignPos = start.clone().lerp(end, 0.55).add(V(-0.055, 0.0, 0));
  ign.translate(ignPos.x, ignPos.y, ignPos.z);
  const ignMesh = mesh(ign, M.satin, false);
  ignMesh.name = 'ignition';
  g.add(ignMesh);
  g.userData.ignitionPos = ignPos;

  // Wheel in its own frame: local Z = wheel normal (toward driver), local Y = up along the wheel plane.
  const wheel = new THREE.Group();
  const R = 0.188;
  const rimSecs = [];
  const N = 64;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const ctr = V(Math.cos(a) * R, Math.sin(a) * R, 0);
    const radial = V(Math.cos(a), Math.sin(a), 0);
    // thicker grip at 9-and-3
    const grip = 1 + 0.12 * Math.pow(Math.abs(Math.cos(a)), 6);
    rimSecs.push(superSection(ctr, radial, V(0, 0, 1), 0.0145 * grip, 0.017 * grip, 2.2, 12));
  }
  rimSecs.push(rimSecs[0]);
  wheel.add(mesh(loftSections(rimSecs, {}), M.leather));
  // Hub / airbag cover
  const hubSecs = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const zc = -0.03 + 0.05 * t;
    const sh = Math.sin(t * Math.PI * 0.5 + 0.2);
    hubSecs.push(superSection(V(0, -0.008, zc), V(1, 0, 0), V(0, 1, 0), 0.068 * (0.75 + 0.25 * sh), 0.056 * (0.75 + 0.25 * sh), 3.2, 28));
  }
  wheel.add(mesh(loftSections(hubSecs, { capStart: true, capEnd: true }), M.plastic));
  // Emblem
  const emb = new THREE.Shape();
  emb.moveTo(-0.018, -0.008);
  emb.lineTo(0, 0.011);
  emb.lineTo(0.018, -0.008);
  emb.lineTo(0.012, -0.008);
  emb.lineTo(0, 0.004);
  emb.lineTo(-0.012, -0.008);
  emb.closePath();
  const embG = new THREE.ExtrudeGeometry(emb, { depth: 0.002, bevelEnabled: false });
  embG.translate(0, 0.0, 0.021);
  wheel.add(mesh(embG, M.chrome, false));
  // Spokes: left, right, bottom
  for (const ang of [0, Math.PI, -Math.PI / 2]) {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const r = 0.055 + (R - 0.06) * t;
      pts.push(V(Math.cos(ang) * r, Math.sin(ang) * r - 0.012 * Math.sin(t * Math.PI) * (ang === -Math.PI / 2 ? 0 : 1), -0.012 * (1 - t)));
    }
    const secs = pts.map((p, i) => {
      const t = i / 6;
      const radial = V(Math.cos(ang), Math.sin(ang), 0);
      const side = V(-Math.sin(ang), Math.cos(ang), 0);
      void radial;
      return superSection(p, side, V(0, 0, 1), ang === -Math.PI / 2 ? 0.024 - 0.01 * t : 0.028 - 0.008 * t, 0.009, 3, 14);
    });
    wheel.add(mesh(loftSections(secs, { capStart: true, capEnd: true }), M.plastic));
  }
  // Spoke buttons: audio on the left, cruise on the right, horn icons on the pad
  for (const s2 of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const b = roundedBox(0.012, 0.009, 0.005, 0.0025, 1);
      b.translate(s2 * (0.085 + k * 0.016), 0.004 - k * 0.002, 0.006);
      wheel.add(mesh(b, k === 1 ? M.satin : M.piano, false));
    }
  }
  for (const s2 of [-1, 1]) {
    const hi = new THREE.CircleGeometry(0.004, 10);
    hi.translate(s2 * 0.045, -0.03, 0.0215);
    wheel.add(mesh(hi, M.satin, false));
  }
  // Orient the wheel frame
  const zAxis = n.clone();
  const yAxis = V(0, 1, 0).addScaledVector(zAxis, -zAxis.y).normalize();
  const xAxis = yAxis.clone().cross(zAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  wheelPivot.quaternion.setFromRotationMatrix(basis);
  wheelPivot.position.copy(c);
  wheelPivot.add(wheel);
  wheelPivot.name = 'steeringWheel';
  return { column: g, wheel: wheelPivot };
}

// ---------- pedals ----------
export function buildPedals(M) {
  const g = new THREE.Group();
  const defs = [
    ['clutch', 0.485, 0.405, 0.735],
    ['brake', 0.395, 0.405, 0.73],
    ['gas', 0.26, 0.36, 0.765],
  ];
  const pedals = {};
  for (const [name, x, y, z] of defs) {
    const pg = new THREE.Group();
    const piv = V(x, 0.66, 0.79);
    const arm = tubeAlong([V(0, 0, 0), V(0, -0.1, -0.04), V(0, y - 0.66, z - 0.79)], 0.006, 8);
    pg.add(mesh(arm, M.satin, false));
    const pad = roundedBox(name === 'gas' ? 0.045 : 0.07, name === 'gas' ? 0.11 : 0.06, 0.012, 0.006, 2);
    pad.rotateX(0.35);
    pad.translate(0, y - 0.66, z - 0.79 - 0.006);
    pg.add(mesh(pad, M.rubber));
    pg.position.copy(piv);
    g.add(pg);
    pedals[name] = pg;
  }
  // Footrest
  const rest = roundedBox(0.06, 0.16, 0.02, 0.008, 2);
  rest.rotateX(0.7);
  rest.translate(0.6, 0.36, 0.74);
  g.add(mesh(rest, M.rubber));
  g.userData.pedals = pedals;
  return g;
}

// Re-orders a geometry's triangles into two material groups by a centroid predicate and lifts
// vertices well inside the predicate region along their normals (padded insert look).
function splitPadded(geo, pred, lift = 0.004) {
  const pos = geo.attributes.position;
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const idx = geo.index.array;
  const a = [],
    b = [];
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, idx[t + k]));
    c.multiplyScalar(1 / 3);
    (pred(c, 0) ? b : a).push(idx[t], idx[t + 1], idx[t + 2]);
  }
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const w = pred(v, 0.012) ? 1 : 0;
    if (w) pos.setXYZ(i, v.x + nrm.getX(i) * lift, v.y + nrm.getY(i) * lift, v.z + nrm.getZ(i) * lift);
  }
  geo.setIndex([...a, ...b]);
  geo.clearGroups();
  geo.addGroup(0, a.length, 0);
  geo.addGroup(a.length, b.length, 1);
  geo.computeVertexNormals();
  return geo;
}

// ---------- seats ----------
function seatCushion(w, d, h, bolster) {
  // Sections along z (front -> back) in seat-local coordinates (origin: cushion centre at floor of cushion).
  const secs = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 front, 1 back
    const z = d / 2 - d * t;
    const frontRound = Math.sin(Math.min(1, t * 4 + 0.15) * Math.PI * 0.5);
    const backRound = Math.sin(Math.min(1, (1 - t) * 5 + 0.25) * Math.PI * 0.5);
    const k = frontRound * backRound;
    const hw = (w / 2) * (0.9 + 0.1 * k);
    const top = h * (0.55 + 0.45 * k) + 0.012 * Math.sin(t * Math.PI);
    const bol = bolster * (0.3 + 0.7 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5)) * k;
    const prof = [
      [-hw, 0],
      [-hw - 0.004, top * 0.6],
      [-hw + 0.01, top + bol],
      [-hw + 0.06, top + bol * 0.9],
      [-hw + 0.11, top - 0.004],
      [0, top - 0.012],
      [hw - 0.11, top - 0.004],
      [hw - 0.06, top + bol * 0.9],
      [hw - 0.01, top + bol],
      [hw + 0.004, top * 0.6],
      [hw, 0],
      [0, -0.005],
    ];
    secs.push(smoothClosed2(prof, 36).map(([x, y]) => V(x, y, z)));
  }
  return loftSections(secs, { capStart: true, capEnd: true });
}

function seatBack(w, hgt, thick, bolster) {
  // Sections along local Y (bottom -> top), section in (x, z) with z toward the occupant's back (+z = rear).
  const secs = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = hgt * t;
    const round = Math.sin(Math.min(1, (1 - t) * 6 + 0.2) * Math.PI * 0.5) * Math.sin(Math.min(1, t * 8 + 0.3) * Math.PI * 0.5);
    const hw = (w / 2) * (1 - 0.12 * t * t) * (0.92 + 0.08 * round);
    const lumbar = 0.012 * Math.exp(-Math.pow((t - 0.3) / 0.15, 2));
    const bol = bolster * Math.sin(Math.min(1, t * 1.4) * Math.PI) * round;
    const th = thick * (0.7 + 0.3 * round);
    const prof = [
      [-hw, th * 0.5],
      [-hw - 0.004, 0],
      [-hw + 0.02, -bol - 0.01],
      [-hw + 0.07, -bol * 0.8 - 0.004],
      [-hw + 0.12, -lumbar],
      [0, -lumbar - 0.006],
      [hw - 0.12, -lumbar],
      [hw - 0.07, -bol * 0.8 - 0.004],
      [hw - 0.02, -bol - 0.01],
      [hw + 0.004, 0],
      [hw, th * 0.5],
      [0, th * 0.55],
    ];
    secs.push(smoothClosed2(prof, 36).map(([x, z]) => V(x, y, z)));
  }
  return loftSections(secs, { capStart: true, capEnd: true });
}

function headrest(M) {
  const g = new THREE.Group();
  const secs = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const r = Math.sin(Math.min(1, t * 3 + 0.1) * Math.PI * 0.5) * Math.sin(Math.min(1, (1 - t) * 3 + 0.1) * Math.PI * 0.5);
    secs.push(superSection(V(0, 0.02 + 0.16 * t, 0), V(1, 0, 0), V(0, 0, 1), 0.13 * (0.8 + 0.2 * r), 0.05 * (0.7 + 0.3 * r), 3, 24));
  }
  g.add(mesh(loftSections(secs, { capStart: true, capEnd: true }), M.seatSide));
  for (const s of [-1, 1]) {
    const post = new THREE.CylinderGeometry(0.0055, 0.0055, 0.12, 10);
    post.translate(0.065 * s, -0.03, 0.005);
    g.add(mesh(post, M.satin, false));
  }
  return g;
}

export function buildFrontSeat(M, side) {
  const g = new THREE.Group();
  const x = DRIVER.x * side;
  // Seat-local frame at the cushion base centre.
  const cm = mesh(seatCushion(0.5, 0.5, 0.11, 0.035), M.uphFrontCushion);
  const cush = new THREE.Group();
  cush.add(cm);
  cush.position.set(0, 0.42, 0);
  cush.rotation.x = -0.08;
  g.add(cush);
  // Base / plastic shell and rails
  const base = roundedBox(0.46, 0.1, 0.46, 0.02, 3);
  base.translate(0, 0.36, 0.0);
  g.add(mesh(base, M.plastic));
  for (const s of [-1, 1]) {
    const rail = roundedBox(0.03, 0.025, 0.62, 0.006, 2);
    rail.translate(0.19 * s, 0.295, 0.0);
    g.add(mesh(rail, M.satin));
  }
  // Recline lever
  const lev = roundedBox(0.02, 0.025, 0.12, 0.008, 2);
  lev.translate(0.25 * side, 0.43, -0.16);
  g.add(mesh(lev, M.plastic, false));
  // Backrest
  const back = new THREE.Group();
  const bm = mesh(seatBack(0.5, 0.62, 0.11, 0.04), M.uphFrontBack);
  back.add(bm);
  const hr = headrest(M);
  hr.position.set(0, 0.66, 0.03);
  back.add(hr);
  back.position.set(0, 0.46, -0.235);
  back.rotation.x = -0.36; // recline (top toward the rear)
  // flip so the occupant-facing side is +z (front)
  back.rotation.y = Math.PI;
  g.add(back);
  // Belt buckle on a stalk on the inboard side, height lever and recline knob outboard
  const bk = new THREE.Group();
  const stalk = roundedBox(0.02, 0.12, 0.012, 0.005, 2);
  stalk.translate(0, 0.06, 0);
  bk.add(mesh(stalk, M.belt, false));
  const buckle = roundedBox(0.03, 0.05, 0.018, 0.006, 2);
  buckle.translate(0, 0.14, 0);
  bk.add(mesh(buckle, M.plastic, false));
  const btn = roundedBox(0.016, 0.006, 0.02, 0.002, 1);
  btn.translate(0, 0.167, 0);
  bk.add(mesh(btn, M.brakeLight, false));
  bk.position.set(-side * 0.27, 0.3, -0.12);
  bk.rotation.x = -0.35;
  g.add(bk);
  const hLever = roundedBox(0.012, 0.018, 0.12, 0.006, 2);
  hLever.translate(side * 0.26, 0.33, 0.06);
  g.add(mesh(hLever, M.plastic, false));
  const rk = latheY([[0.0, 0.0], [0.024, 0.0], [0.026, 0.012], [0.0, 0.016]], 18);
  rk.rotateZ((side * Math.PI) / 2);
  rk.translate(side * 0.27, 0.42, -0.2);
  g.add(mesh(rk, M.plastic, false));
  g.position.set(x, 0, DRIVER.seatZ);
  g.name = side > 0 ? 'seat_FL' : 'seat_FR';
  return g;
}

export function buildRearBench(M) {
  const g = new THREE.Group();
  const cush = new THREE.Group();
  for (const s of [-1, 1]) {
    const c = mesh(seatCushion(0.56, 0.48, 0.1, 0.018), M.uphRearCushion);
    c.position.set(0.29 * s, 0, 0);
    cush.add(c);
  }
  cush.position.set(0, 0.36, -0.9);
  cush.rotation.x = -0.1;
  g.add(cush);
  const back = new THREE.Group();
  for (const s of [-1, 1]) {
    const b = mesh(seatBack(0.56, 0.58, 0.12, 0.012), M.uphRearBack);
    b.position.set(0.29 * s, 0, 0);
    back.add(b);
    const hr = headrest(M);
    hr.position.set(0.36 * s, 0.6, 0.04);
    back.add(hr);
  }
  back.position.set(0, 0.42, -1.17);
  back.rotation.x = -0.42;
  back.rotation.y = Math.PI;
  g.add(back);
  g.name = 'seat_R';
  return g;
}

// ---------- door trims ----------
function innerSideX(y, z, depth, side) {
  // x of the inner door surface (level set bodyField = -depth) at (y, z) on the given side.
  let lo = 0.3,
    hi = 1.0;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    if (bodyField(m * side, y, z) + depth < 0) lo = m;
    else hi = m;
  }
  return lo * side;
}

export function buildDoorTrim(M, doorId) {
  const g = new THREE.Group();
  const side = doorId.endsWith('L') ? 1 : -1;
  const front = doorId.includes('_F');
  const z0 = front ? 0.72 : -0.22,
    z1 = front ? -0.05 : -0.86;
  // Armrest: a lofted bar along the door at elbow height.
  const yA = 0.69;
  const secs = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = z0 + (z1 - z0) * (0.15 + 0.7 * t);
    const xi = innerSideX(yA, z, 0.105, side);
    const out = 0.045 * Math.sin(Math.min(1, t * 4) * Math.PI * 0.5) * Math.sin(Math.min(1, (1 - t) * 4) * Math.PI * 0.5) + 0.012;
    secs.push(superSection(V(xi - side * (out * 0.5), yA - 0.01 * t, z), V(1, 0, 0), V(0, 1, 0), out * 0.5 + 0.006, 0.03, 3, 18));
  }
  g.add(mesh(loftSections(secs, { capStart: true, capEnd: true }), M.dashLow));
  // Pull handle cup + inner opening lever
  const zH = z0 + (z1 - z0) * 0.22;
  const xH = innerSideX(0.84, zH, 0.105, side);
  const lever = roundedBox(0.012, 0.02, 0.085, 0.006, 2);
  lever.translate(xH - side * 0.008, 0.84, zH);
  g.add(mesh(lever, M.chrome, false));
  const cup = roundedBox(0.01, 0.04, 0.11, 0.008, 2);
  cup.translate(xH - side * 0.002, 0.84, zH);
  g.add(mesh(cup, M.rubber, false));
  // Window switch panel on the armrest top
  const zs = z0 + (z1 - z0) * 0.4;
  const xs = innerSideX(yA, zs, 0.105, side) - side * 0.03;
  const sw = roundedBox(0.05, 0.012, 0.09, 0.006, 2);
  sw.translate(xs, yA + 0.03, zs);
  g.add(mesh(sw, M.piano, false));
  // Speaker grille low at the front
  const zsp = z0 + (z1 - z0) * 0.25;
  const ysp = 0.43;
  const xsp = innerSideX(ysp, zsp, 0.105, side);
  const spk = new THREE.CylinderGeometry(0.075, 0.075, 0.012, 32);
  spk.rotateZ(Math.PI / 2);
  spk.translate(xsp - side * 0.004, ysp, zsp);
  g.add(mesh(spk, M.speaker, false));
  // Door pocket (lower rear)
  const zp = z0 + (z1 - z0) * 0.62;
  const xp = innerSideX(0.4, zp, 0.105, side);
  const pocket = roundedBox(0.03, 0.09, 0.28, 0.01, 2);
  pocket.translate(xp - side * 0.015, 0.4, zp);
  g.add(mesh(pocket, M.plastic));
  // Window switches (two on the front doors, one on the rear)
  const nsw = front ? 2 : 1;
  for (let k = 0; k < nsw; k++) {
    const b = roundedBox(0.018, 0.008, 0.03, 0.003, 1);
    b.translate(xs, yA + 0.04, zs - 0.022 + k * 0.044 * (front ? 1 : 0));
    g.add(mesh(b, M.plastic, false));
  }
  if (front && side > 0) {
    // mirror adjuster joystick next to the switches
    const mj = latheY([[0.0, 0.012], [0.009, 0.01], [0.012, 0.0]], 14);
    mj.translate(xs, yA + 0.036, zs + 0.06);
    g.add(mesh(mj, M.satin, false));
  }
  // Fabric insert across the upper door card, framed by a stitched seam
  const zi0 = z0 + (z1 - z0) * 0.12,
    zi1 = z0 + (z1 - z0) * 0.88;
  const ins = [];
  for (let i = 0; i <= 10; i++) {
    const z = zi0 + ((zi1 - zi0) * i) / 10;
    const yTop = yBelt(z) - 0.07;
    const pts = [];
    for (let j = 0; j <= 4; j++) {
      const y = 0.74 + ((yTop - 0.74) * j) / 4;
      pts.push(V(innerSideX(y, z, 0.105, side) - side * 0.004, y, z));
    }
    ins.push(pts);
  }
  {
    const pos = [],
      idx = [];
    for (const r of ins) for (const q of r) pos.push(q.x, q.y, q.z);
    for (let i = 0; i < ins.length - 1; i++)
      for (let j = 0; j < 4; j++) {
        const a = i * 5 + j;
        if (side > 0) idx.push(a, a + 1, a + 5, a + 1, a + 6, a + 5);
        else idx.push(a, a + 5, a + 1, a + 1, a + 5, a + 6);
      }
    const ig = new THREE.BufferGeometry();
    ig.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ig.setIndex(idx);
    ig.computeVertexNormals();
    g.add(mesh(ig, M.seatSide, false));
  }
  // Reflector on the trailing edge (visible with the door open)
  const rf = roundedBox(0.01, 0.025, 0.07, 0.004, 1);
  rf.translate(innerSideX(0.45, z1 + 0.02, 0.105, side) - side * 0.01, 0.45, z1 + 0.04);
  g.add(mesh(rf, M.brakeLight, false));
  // Lock pin on the window sill
  const pin = new THREE.CylinderGeometry(0.0045, 0.0055, 0.03, 10);
  const zl = z0 + (z1 - z0) * 0.85;
  const yl = yBelt(zl) - 0.012;
  const xl = innerSideX(yl - 0.02, zl, 0.07, side);
  pin.translate(xl - side * 0.02, yl, zl);
  g.add(mesh(pin, M.satin, false));
  return g;
}

// ---------- roof interior ----------
export function buildRoofInterior(M) {
  const g = new THREE.Group();
  const { WS_P0, WS_E2, WS_N } = GLASS_FRAMES;
  // Rear-view mirror: stalk from the windshield inside surface near the top.
  const b = 0.79;
  const o = [0, WS_P0[1] + WS_E2[1] * b - WS_N[1] * 0.3, WS_P0[2] + WS_E2[2] * b - WS_N[2] * 0.3];
  const sp = skinAlong(o, [0, WS_N[1], WS_N[2]], 0.6);
  const mount = V(sp[0], sp[1] - WS_N[1] * 0.02, sp[2] - WS_N[2] * 0.02);
  const stalk = tubeAlong([mount, mount.clone().add(V(0, -0.04, -0.03)), mount.clone().add(V(0, -0.06, -0.045))], 0.006, 8);
  g.add(mesh(stalk, M.plastic, false));
  const housing = roundedBox(0.25, 0.07, 0.035, 0.02, 3);
  housing.translate(0, mount.y - 0.075, mount.z - 0.055);
  g.add(mesh(housing, M.plastic));
  const glass = roundedBox(0.235, 0.058, 0.004, 0.017, 3);
  glass.translate(0, mount.y - 0.075, mount.z - 0.074);
  const gm = mesh(glass, M.mirror, false);
  gm.name = 'rearMirrorGlass';
  g.add(gm);
  // Sun visors
  for (const s of [1, -1]) {
    // stowed flat against the headliner on a hinge rod, with a vanity mirror cover underneath
    const v = roundedBox(0.33, 0.15, 0.016, 0.03, 3);
    v.rotateX(-1.5);
    const yv = skinTopY(0.3 * s, 0.25) - 0.05;
    v.translate(0.29 * s, yv, 0.24);
    g.add(mesh(v, M.headliner));
    const vm = roundedBox(0.12, 0.06, 0.004, 0.01, 2);
    vm.rotateX(-1.5);
    vm.translate(0.29 * s, yv - 0.009, 0.23);
    g.add(mesh(vm, M.plastic, false));
    const rod = tubeAlong([V(0.12 * s, yv + 0.005, 0.32), V(0.45 * s, yv + 0.005, 0.32)], 0.005, 8);
    g.add(mesh(rod, M.plastic, false));
  }
  // Dome light
  const yd = skinTopY(0, -0.05) - 0.06;
  const dome = roundedBox(0.16, 0.012, 0.08, 0.006, 2);
  dome.translate(0, yd, -0.05);
  g.add(mesh(dome, M.plastic, false));
  const lens = roundedBox(0.12, 0.006, 0.05, 0.004, 2);
  lens.translate(0, yd - 0.007, -0.05);
  const lm = mesh(lens, M.domeLens, false);
  lm.name = 'domeLens';
  g.add(lm);
  g.userData.domePos = V(0, yd - 0.04, -0.05);
  // Grab handles above the doors
  for (const [s, z] of [
    [-1, 0.0],
    [1, -0.75],
    [-1, -0.75],
  ]) {
      const y = 1.3;
      const x = innerSideX(y, z, 0.06, s);
      const hd = tubeAlong([V(x, y + 0.01, z + 0.1), V(x - s * 0.03, y - 0.02, z + 0.07), V(x - s * 0.035, y - 0.025, z), V(x - s * 0.03, y - 0.02, z - 0.07), V(x, y + 0.01, z - 0.1)], 0.009, 8);
      g.add(mesh(hd, M.plastic, false));
  }
  return g;
}

export function buildParcelShelf(M) {
  const g = new THREE.Group();
  // Shelf follows between the seat back top and the rear window inner surface.
  const pts = [];
  const shape = new THREE.Shape();
  const w = 0.6;
  shape.moveTo(-w, 0);
  shape.lineTo(w, 0);
  shape.lineTo(w - 0.06, -0.42);
  shape.lineTo(-w + 0.06, -0.42);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.004, bevelSegments: 2 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 1.03, -1.2);
  g.add(mesh(geo, M.plastic));
  void pts;
  for (const s of [1, -1]) {
    const spk = new THREE.CylinderGeometry(0.07, 0.07, 0.01, 28);
    spk.translate(0.42 * s, 1.04, -1.42);
    g.add(mesh(spk, M.speaker, false));
  }
  // Third brake light
  const bl = roundedBox(0.3, 0.025, 0.04, 0.008, 2);
  bl.translate(0, 1.055, -1.58);
  const blm = mesh(bl, M.brakeLight, false);
  blm.name = 'thirdBrake';
  g.add(blm);
  return g;
}

export function buildFloorMats(M) {
  const g = new THREE.Group();
  const mats = [
    [0.36, 0.0, 0.64, 0.42, 0.52],
    [-0.36, 0.0, 0.62, 0.42, 0.5],
    [0.38, 0.0, -0.53, 0.4, 0.34],
    [-0.38, 0.0, -0.53, 0.4, 0.34],
  ];
  for (const [x, , z, w, d] of mats) {
    const m = roundedBox(w, 0.008, d, 0.004, 2);
    m.translate(x, 0.293, z);
    g.add(mesh(m, M.rubber, false));
  }
  // Carpet floor pan visual (covers the shell floor inner surface edges)
  return g;
}

// B-pillars: structural box section inboard of the closed doors with a trimmed cabin face,
// plus the front seat belts running down them (D-ring at the top, retractor at the bottom).
export function buildBPillars(M) {
  const g = new THREE.Group();
  const zc = -0.122;
  for (const s of [1, -1]) {
    const secs = [];
    const N = 14;
    const y0 = 0.31,
      y1 = 1.33;
    for (let i = 0; i <= N; i++) {
      const y = y0 + ((y1 - y0) * i) / N;
      const belt = yBelt(zc);
      const doorD = y < belt - 0.02 ? 0.105 : 0.034;
      const xo = Math.abs(innerSideX(y, zc, doorD + 0.008, 1));
      const depth = y < belt ? 0.06 : 0.045;
      const halfZ = 0.06 - 0.012 * ((y - y0) / (y1 - y0));
      const c = V((xo - depth / 2) * s, y, zc);
      secs.push(superSection(c, V(1, 0, 0), V(0, 0, 1), depth / 2, halfZ, 5, 18));
    }
    g.add(mesh(loftSections(secs, { capStart: true, capEnd: true }), M.pillarTrim || M.dashLow));
    // seat belt webbing (flat ribbon) along the pillar face
    const top = V((Math.abs(innerSideX(1.2, zc, 0.042, 1)) - 0.05) * s, 1.2, zc - 0.005);
    const bot = V((Math.abs(innerSideX(0.42, zc, 0.113, 1)) - 0.065) * s, 0.42, zc - 0.01);
    const ribbon = [];
    const NR = 10;
    for (let i = 0; i <= NR; i++) {
      const t = i / NR;
      const p = top.clone().lerp(bot, t);
      p.x -= s * 0.004 * Math.sin(t * Math.PI);
      ribbon.push([p.clone().add(V(0, 0, 0.024)), p.clone().add(V(-0.003 * s, 0, 0.024)), p.clone().add(V(-0.003 * s, 0, -0.024)), p.clone().add(V(0, 0, -0.024))]);
    }
    g.add(mesh(loftSections(ribbon, { capStart: true, capEnd: true }), M.belt, false));
    // D-ring anchor and retractor housing
    const anchor = roundedBox(0.012, 0.06, 0.055, 0.006, 2);
    anchor.translate(top.x - 0.002 * s, top.y + 0.02, top.z);
    g.add(mesh(anchor, M.plastic, false));
    const retr = roundedBox(0.035, 0.1, 0.07, 0.01, 2);
    retr.translate(bot.x + 0.005 * s, bot.y - 0.04, bot.z);
    g.add(mesh(retr, M.plastic, false));
    // buckle on the console side
    const buckle = roundedBox(0.03, 0.07, 0.025, 0.008, 2);
    buckle.rotateX(-0.3);
    buckle.translate(0.15 * s, 0.53, -0.36);
    g.add(mesh(buckle, M.plastic, false));
  }
  return g;
}
