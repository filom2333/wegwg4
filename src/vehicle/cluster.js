// The instrument cluster of an imported car, built as a real object in the hood of the source's
// dash: a fascia of grained dark plastic curving round toward the driver, and each dial sunk in its
// own tube, its face at the back, a chrome bezel at the front and a glass over it that catches the
// light; tapered needles on black hubs; the warning lamps as the usual symbols, dark until lit.
// The faces are drawn large (1024 px) and drawn again once the game's typeface has loaded.
//
// G (type.GAUGES): speedo { center, normal, radius, lcd }, tacho { offset, radius }, small:
// [{ kind: 'fuel'|'temp'|'oil'|'volt', offset, radius }], panel [w, h, x, y], curve (how fast the
// fascia bends toward the driver), depth (how deep the tubes are).
// The group's +x points to the driver's right, +z toward the driver.

import * as THREE from 'three';
import { makeCanvas, canvasTexture } from '../gfx/textures.js';
import { needleAngle } from './gauges.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FONT = '"Overpass", "Arial Narrow", Arial, sans-serif';
const INK = '#f3efe4';
const RED = '#e0442c';

// ------------------------------------------------------------------ faces
function base(ctx, S) {
  const c = S / 2;
  ctx.clearRect(0, 0, S, S);
  const grd = ctx.createRadialGradient(c, c * 0.9, S * 0.05, c, c, S * 0.5);
  grd.addColorStop(0, '#202022');
  grd.addColorStop(0.7, '#111113');
  grd.addColorStop(1, '#060607');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(c, c, S * 0.5, 0, Math.PI * 2);
  ctx.fill();
  // fine turned rings in the face
  ctx.lineWidth = 1;
  for (let r = S * 0.06; r < S * 0.48; r += S * 0.012) {
    ctx.strokeStyle = `rgba(255,255,255,${0.012 + 0.01 * Math.sin(r * 0.37)})`;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function tick(ctx, c, a, r0, r1, w, col) {
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
  ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
  ctx.stroke();
}

// A round scale: speedometer or rev counter.
function drawDial(ctx, S, { max, minor, major, unit, red = null, label = null, sub = null }) {
  base(ctx, S);
  const c = S / 2;
  ctx.lineCap = 'round';
  // the arc the ticks stand on, and the red zone as a band
  ctx.strokeStyle = 'rgba(243,239,228,0.35)';
  ctx.lineWidth = S * 0.004;
  ctx.beginPath();
  ctx.arc(c, c, S * 0.445, needleAngle('speed', 0), needleAngle('speed', 1));
  ctx.stroke();
  if (red !== null) {
    ctx.strokeStyle = 'rgba(224,68,44,0.9)';
    ctx.lineWidth = S * 0.022;
    ctx.beginPath();
    ctx.arc(c, c, S * 0.432, needleAngle('speed', red / max), needleAngle('speed', 1));
    ctx.stroke();
  }
  const n = Math.round(max / minor);
  for (let i = 0; i <= n; i++) {
    const v = i * minor;
    const a = needleAngle('speed', v / max);
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    const half = !isMajor && Math.abs((v * 2) / major - Math.round((v * 2) / major)) < 1e-6;
    const col = red !== null && v >= red ? RED : INK;
    tick(ctx, c, a, S * (isMajor ? 0.37 : half ? 0.395 : 0.41), S * 0.445, S * (isMajor ? 0.011 : half ? 0.007 : 0.0045), col);
    if (isMajor) {
      ctx.fillStyle = col;
      ctx.font = `800 ${Math.round(S * 0.072)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.round(v)), c + Math.cos(a) * S * 0.305, c + Math.sin(a) * S * 0.305 + S * 0.004);
    }
  }
  ctx.fillStyle = 'rgba(243,239,228,0.75)';
  ctx.font = `600 ${Math.round(S * 0.04)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(unit, c, c - S * 0.14);
  if (label) {
    ctx.fillStyle = 'rgba(243,239,228,0.45)';
    ctx.font = `600 ${Math.round(S * 0.03)}px ${FONT}`;
    ctx.fillText(label, c, c - S * 0.2);
  }
  if (sub) {
    ctx.fillStyle = 'rgba(243,239,228,0.4)';
    ctx.font = `600 ${Math.round(S * 0.028)}px ${FONT}`;
    ctx.fillText(sub, c, c + S * 0.36);
  }
}

// A small gauge across a 70 degree arc, with its symbol: fuel, coolant temperature, oil pressure or
// the battery's volts.
function drawSmall(ctx, S, kind) {
  base(ctx, S);
  const c = S / 2;
  const cy = c + S * 0.14;
  ctx.lineCap = 'round';
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const a = needleAngle(kind, t);
    const major = i % 4 === 0;
    const red = kind === 'fuel' || kind === 'oil' ? t < 0.13 : kind === 'temp' ? t > 0.8 : false;
    ctx.strokeStyle = red ? RED : INK;
    ctx.lineWidth = S * (major ? 0.024 : 0.013);
    const r0 = S * (major ? 0.29 : 0.33),
      r1 = S * 0.39;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
  // the two ends only, just outside the arc's ends
  ctx.font = `800 ${Math.round(S * 0.11)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const [lo, hi] = { fuel: ['E', 'F'], temp: ['C', 'H'], oil: ['L', 'H'], volt: ['8', '16'] }[kind];
  const la = needleAngle(kind, 0),
    ha = needleAngle(kind, 1);
  ctx.fillStyle = kind === 'fuel' || kind === 'oil' ? RED : INK;
  ctx.fillText(lo, c + Math.cos(la) * S * 0.44, cy + Math.sin(la) * S * 0.44 + S * 0.075);
  ctx.fillStyle = kind === 'temp' ? RED : INK;
  ctx.fillText(hi, c + Math.cos(ha) * S * 0.44, cy + Math.sin(ha) * S * 0.44 + S * 0.075);
  symbol(ctx, { fuel: 'fuel', temp: 'temp', oil: 'oil', volt: 'gen' }[kind], c, c + S * 0.31, S * 0.16, 'rgba(243,239,228,0.7)');
}

// ------------------------------------------------------------------ symbols
// The usual warning symbols, drawn in `col` centred on (x, y), about `s` across.
function symbol(ctx, kind, x, y, s, col) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 100, s / 100);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = (pts, close = false) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    if (close) ctx.closePath();
  };
  if (kind === 'gen') {
    ctx.strokeRect(-38, -22, 76, 50);
    ctx.fillRect(-28, -32, 14, 10);
    ctx.fillRect(14, -32, 14, 10);
    path([[-24, 2], [-10, 2]]);
    ctx.stroke();
    path([[10, 2], [24, 2]]);
    ctx.stroke();
    path([[17, -5], [17, 9]]);
    ctx.stroke();
  } else if (kind === 'oil') {
    path([[-44, 4], [-20, -12], [22, -12], [38, -24], [44, -18], [26, 14], [-36, 14]], true);
    ctx.stroke();
    path([[-20, -12], [-20, -24], [-6, -24]]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(44, 2, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'park') {
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.stroke();
    for (const sg of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(0, 0, 44, sg > 0 ? -0.6 : Math.PI - 0.6, sg > 0 ? 0.6 : Math.PI + 0.6);
      ctx.stroke();
    }
    ctx.font = `900 46px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', 0, 3);
  } else if (kind === 'temp' || kind === 'hot') {
    path([[0, -40], [0, 14]]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 22, 11, 0, Math.PI * 2);
    ctx.fill();
    for (const ty of [-26, -12]) path([[4, ty], [16, ty]]), ctx.stroke();
    for (const wy of [34, 46]) {
      ctx.beginPath();
      for (let k = -40; k <= 40; k += 4) ctx.lineTo(k, wy + Math.sin(k * 0.25) * 4);
      ctx.stroke();
    }
  } else if (kind === 'fuel' || kind === 'lowFuel') {
    ctx.strokeRect(-30, -34, 40, 68);
    ctx.fillRect(-22, -26, 24, 18);
    path([[10, -16], [26, -6], [26, 22], [34, 22], [34, -18]]);
    ctx.stroke();
  } else if (kind === 'beam') {
    path([[-6, -30], [-6, 30]]);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6, -30);
    ctx.bezierCurveTo(40, -30, 40, 30, -6, 30);
    ctx.stroke();
    for (const ly of [-22, -8, 6, 20]) path([[-16, ly], [-44, ly]]), ctx.stroke();
  } else if (kind === 'turnL' || kind === 'turnR') {
    const sg = kind === 'turnL' ? -1 : 1;
    path([[sg * 44, 0], [sg * 6, -30], [sg * 6, -12], [-sg * 40, -12], [-sg * 40, 12], [sg * 6, 12], [sg * 6, 30]], true);
    ctx.fill();
  }
  ctx.restore();
}

const LAMP = {
  gen: 0xff2a10,
  oil: 0xff3a10,
  park: 0xff2a10,
  hot: 0xff2a10,
  lowFuel: 0xffa010,
  beam: 0x3d7dff,
  turnL: 0x30ff60,
  turnR: 0x30ff60,
};

// ------------------------------------------------------------------ the cluster
export function buildCluster(model, G, M, type) {
  const g = new THREE.Group();
  g.name = 'cluster';
  const s = G.speedo;
  const n = V(...s.normal).normalize();
  // (out from the source's own face, which would cover anything set flush with it)
  g.position.copy(V(...s.center)).addScaledVector(n, G.lift ?? 0.032);
  const z = n.clone();
  const y = V(0, 1, 0).addScaledVector(z, -z.y).normalize();
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z));
  const depth = G.depth ?? 0.022;
  const curve = G.curve ?? 1.1;
  const R = s.radius;
  const faces = [];
  const redraws = [];
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8, depthWrite: false });
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.45, metalness: 0.2, side: THREE.BackSide });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.25, metalness: 0.3 });
  // satin chrome: bright, but no sun glints flaring through the glow
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0xa9adb2, metalness: 1, roughness: 0.32 });
  // grained dark plastic for the fascia
  const grain = makeCanvas(256, 256);
  {
    const x = grain.getContext('2d');
    const img = x.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + Math.random() * 40;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }
  const grainTex = canvasTexture(grain, { wrap: true });
  grainTex.repeat.set(6, 3);
  const fasciaMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.8, metalness: 0.05, bumpMap: grainTex, bumpScale: 0.6 });

  // the fascia: rounded, its ends curving toward the driver
  if (G.panel) {
    const [pw, ph, px = 0, py = 0] = G.panel;
    const r = ph * 0.3;
    const sh = new THREE.Shape();
    sh.moveTo(-pw / 2 + r, -ph / 2);
    sh.lineTo(pw / 2 - r, -ph / 2);
    sh.quadraticCurveTo(pw / 2, -ph / 2, pw / 2, -ph / 2 + r);
    sh.lineTo(pw / 2, ph / 2 - r);
    sh.quadraticCurveTo(pw / 2, ph / 2, pw / 2 - r, ph / 2);
    sh.lineTo(-pw / 2 + r, ph / 2);
    sh.quadraticCurveTo(-pw / 2, ph / 2, -pw / 2, ph / 2 - r);
    sh.lineTo(-pw / 2, -ph / 2 + r);
    sh.quadraticCurveTo(-pw / 2, -ph / 2, -pw / 2 + r, -ph / 2);
    // a hole for each dial: the tubes go through the fascia
    const holes = [[0, 0, R], ...(G.tacho ? [[G.tacho.offset[0], G.tacho.offset[1], G.tacho.radius]] : []), ...(G.small || []).map((d) => [d.offset[0], d.offset[1], d.radius])];
    for (const [hx, hy, hr] of holes) {
      const h = new THREE.Path();
      h.absarc(hx - px, hy - py, hr * 0.99, 0, Math.PI * 2, true);
      sh.holes.push(h);
    }
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 10 });
    const p = geo.attributes.position;
    // (its face just behind the dials' faces, so the tubes stand out of it)
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - 0.017 + curve * (p.getX(i) + px) ** 2);
    geo.computeVertexNormals();
    const fascia = new THREE.Mesh(geo, fasciaMat);
    fascia.position.set(px, py, 0);
    g.add(fascia);
  }

  const needles = {};
  // a dial in its tube: face at the back, needle on its hub, bezel and glass at the front
  const dial = (name, at, r, draw, needleLen, opts = {}) => {
    const d = new THREE.Group();
    // (the fascia curves: a dial sits on it where it is)
    d.position.set(at[0], at[1], curve * at[0] * at[0] - 0.006);
    g.add(d);
    const c = makeCanvas(1024, 1024);
    const tex = canvasTexture(c, { wrap: false });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const fm = M.gauge.clone();
    fm.map = tex;
    fm.emissiveMap = tex;
    fm.transparent = false;
    faces.push(fm);
    const redraw = () => {
      draw(c.getContext('2d'), 1024);
      tex.needsUpdate = true;
    };
    redraw();
    redraws.push(redraw);
    const face = new THREE.Mesh(new THREE.CircleGeometry(r, 64), fm);
    face.position.z = 0.001;
    d.add(face);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.0, depth, 64, 1, true).rotateX(Math.PI / 2).translate(0, 0, depth / 2), tubeMat);
    d.add(tube);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(r * 1.04, Math.max(0.0022, r * 0.045), 10, 72), bezelMat);
    bezel.position.z = depth;
    d.add(bezel);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(r * 3.2, 48, 8, 0, Math.PI * 2, 0, Math.asin(1.02 / 3.2)).rotateX(Math.PI / 2).translate(0, 0, depth - r * 3.2 * Math.cos(Math.asin(1.02 / 3.2)) - 0.001), glass);
    lens.renderOrder = 3;
    d.add(lens);
    // the needle: a tapered blade with a short tail, on a hub
    const pivot = new THREE.Group();
    const at2 = opts.pivot || [0, 0];
    pivot.position.set(at2[0], at2[1], 0.006);
    const w = Math.max(0.0035, r * 0.055);
    const L = needleLen;
    const ns = new THREE.Shape();
    ns.moveTo(-w / 2, -L * 0.18);
    ns.lineTo(w / 2, -L * 0.18);
    ns.lineTo(w * 0.14, L);
    ns.lineTo(-w * 0.14, L);
    ns.closePath();
    pivot.add(new THREE.Mesh(new THREE.ExtrudeGeometry(ns, { depth: 0.0012, bevelEnabled: false }), M.needle));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.5, w * 1.7, 0.006, 24).rotateX(Math.PI / 2).translate(0, 0, 0.003), hubMat);
    pivot.add(hub);
    d.add(pivot);
    needles[name] = pivot;
    return d;
  };

  const big = type.SPEEDO_MAX > 160;
  const speedo = dial('speed', [0, 0], R, (ctx, S) => drawDial(ctx, S, { max: type.SPEEDO_MAX, minor: big ? 10 : 5, major: big ? 40 : 20, unit: 'km/h', sub: s.lcd ? null : 'km' }), R * 0.84);
  if (G.tacho) {
    const t = G.tacho;
    const red = type.DYNAMICS.redline / 1000;
    dial('rpm', t.offset, t.radius, (ctx, S) => drawDial(ctx, S, { max: 8, minor: 0.25, major: 1, unit: '1/min x1000', red }), t.radius * 0.84);
  }
  for (const d of G.small || []) dial(d.kind, d.offset, d.radius, (ctx, S) => drawSmall(ctx, S, d.kind), d.radius * 0.6, { pivot: [0, -d.radius * 0.28] });

  // the speed in figures, low in the speedometer
  let lcd = null;
  if (s.lcd) {
    const c = makeCanvas(256, 96);
    const tex = canvasTexture(c, { wrap: false });
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ color: 0x050805, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0, roughness: 0.3 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(R * 0.62, R * 0.233), mat);
    m.position.set(0, -R * 0.42, 0.0035);
    speedo.add(m);
    lcd = { canvas: c, tex, mat, shown: null };
  }

  // warning lamps: symbols in a strip across the bottom of the speedometer and between the dials
  const lamps = {};
  const L = G.lamps || {};
  const lampAt = (name, at, size) => {
    const c = makeCanvas(128, 128);
    const x = c.getContext('2d');
    x.fillStyle = '#000';
    x.fillRect(0, 0, 128, 128);
    symbol(x, name, 64, 64, 104, '#fff');
    const tex = canvasTexture(c, { wrap: false });
    const col = LAMP[name];
    const mat = new THREE.MeshStandardMaterial({ color: 0x060606, emissive: col, emissiveMap: tex, emissiveIntensity: 0, roughness: 0.35, transparent: true, alphaMap: tex, opacity: 1 });
    mat.alphaTest = 0.02;
    // dark symbol showing faintly when off
    const ghost = new THREE.MeshBasicMaterial({ color: 0x2a2a2a, alphaMap: tex, transparent: true, opacity: 0.55, depthWrite: false });
    const geo = new THREE.PlaneGeometry(size, size);
    const off = new THREE.Mesh(geo, ghost);
    off.position.set(at[0], at[1], 0.0025);
    speedo.add(off);
    const on = new THREE.Mesh(geo, mat);
    on.position.set(at[0], at[1], 0.0027);
    speedo.add(on);
    lamps[name] = mat;
  };
  const ls = R * 0.15;
  lampAt('gen', L.gen || [-0.5 * R, -0.62 * R], ls);
  lampAt('oil', L.oil || [-0.27 * R, -0.72 * R], ls);
  lampAt('park', L.park || [0.27 * R, -0.72 * R], ls);
  lampAt('hot', L.hot || [0.5 * R, -0.62 * R], ls);
  lampAt('lowFuel', L.lowFuel || [0.38 * R, 0.22 * R], ls * 0.9);
  lampAt('beam', L.beam || [0, 0.5 * R], ls);
  lampAt('turnL', [-0.36 * R, 0.4 * R], ls);
  lampAt('turnR', [0.36 * R, 0.4 * R], ls);

  // the faces again once the typeface is in
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.load(`800 40px Overpass`).then(() => redraws.forEach((r) => r())).catch(() => {});

  g.userData.needles = needles;
  g.userData.lamps = lamps;
  g.userData.faces = faces;
  if (lcd) g.userData.lcd = lcd;
  model.parts.body.inner.add(g);
  return g;
}
