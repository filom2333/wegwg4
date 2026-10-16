// Wheel assembly: 205/55 R16 tyre with modelled grooves + tread/sidewall normal map,
// 10-spoke alloy rim, lug nuts, centre cap, vented brake disc and (static) caliper.
// Local frame: axle along X, outer face toward +X. Wheel centre at origin.

import * as THREE from 'three';
import { latheX, loftSections, roundedBox, xform } from '../../gfx/geom.js';
import { makeCanvas, canvasTexture, normalFromHeight, cached, blurCanvas } from '../../gfx/textures.js';
import { applyWeathering, weatheringUniforms } from '../carMaterials.js';

export const TYRE = { R: 0.316, rimR: 0.2032, width: 0.205 };

// ---- tyre profile ----
function tyreProfile() {
  const half = [
    [0.2032, 0.088],
    [0.211, 0.0955],
    [0.23, 0.1015],
    [0.255, 0.104],
    [0.28, 0.102],
    [0.298, 0.0975],
    [0.3085, 0.092],
    [0.314, 0.084],
    [0.316, 0.074],
    [0.316, 0.06],
    // outer groove
    [0.316, 0.0525],
    [0.3095, 0.0508],
    [0.3095, 0.0448],
    [0.316, 0.043],
    [0.316, 0.024],
    // inner groove
    [0.316, 0.0195],
    [0.3095, 0.0178],
    [0.3095, 0.0122],
    [0.316, 0.0105],
    [0.316, 0.0],
  ];
  const inner = half.map(([r, x]) => [r, -x]);
  const outer = half
    .slice(0, -1)
    .reverse()
    .map(([r, x]) => [r, x]);
  return [...inner, ...outer];
}

function tyreTextures() {
  return cached('tyreTex', () => {
    const W = 2048,
      H = 512;
    const hc = makeCanvas(W, H);
    const ctx = hc.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, W, H);
    // v layout is computed on the geometry: [0,0.33] inner sidewall, [0.33,0.67] tread, [0.67,1] outer sidewall
    const tv0 = 0.335 * H,
      tv1 = 0.665 * H;
    // Tread: white rubber blocks, dark grooves.
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, tv0, W, tv1 - tv0);
    const blocks = 64;
    const bw = W / blocks;
    ctx.strokeStyle = '#202020';
    for (let i = 0; i < blocks; i++) {
      const x = i * bw;
      // shoulder transverse grooves (both shoulders), slightly angled
      ctx.lineWidth = bw * 0.16;
      for (const [a, b] of [
        [tv0, tv0 + (tv1 - tv0) * 0.2],
        [tv1 - (tv1 - tv0) * 0.2, tv1],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x, a);
        ctx.lineTo(x + bw * 0.25, b);
        ctx.stroke();
      }
      // centre rib sipes, staggered and angled
      ctx.lineWidth = bw * 0.06;
      for (const f of [0.3, 0.5, 0.7]) {
        const yy = tv0 + (tv1 - tv0) * f;
        const off = f === 0.5 ? bw * 0.5 : 0;
        ctx.beginPath();
        ctx.moveTo(x + off, yy - (tv1 - tv0) * 0.07);
        ctx.lineTo(x + off + bw * 0.35, yy + (tv1 - tv0) * 0.07);
        ctx.stroke();
      }
    }
    // Sidewalls: subtle concentric ribs near the rim and the lettering on the outer wall.
    const rib = (v, w, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, v * H, W, w * H);
    };
    rib(0.04, 0.012, '#9a9a9a');
    rib(0.96, 0.012, '#9a9a9a');
    rib(0.29, 0.008, '#707070');
    rib(0.71, 0.008, '#707070');
    ctx.fillStyle = '#b4b4b4';
    ctx.font = `bold ${Math.round(H * 0.075)}px Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    const words = ['DUNEMASTER  AT', '205/55 R16  91H', 'TUBELESS · M+S', 'DUNEMASTER  AT', '205/55 R16  91H', 'MADE FOR LONG ROADS'];
    words.forEach((w, i) => {
      const x = (i / words.length) * W + 40;
      ctx.save();
      // text runs around the circumference; v (outer sidewall) mirrored so it reads from outside
      ctx.translate(x, H * 0.84);
      ctx.scale(1, -1);
      ctx.fillText(w, 0, 0);
      ctx.restore();
    });
    blurCanvas(hc, 1);
    const nrm = normalFromHeight(hc, 3.5, true);
    // Roughness/colour: grooves darker, sidewall slightly glossier, worn tread slightly brown.
    const cc = makeCanvas(W / 4, H / 4);
    const cctx = cc.getContext('2d');
    cctx.drawImage(hc, 0, 0, cc.width, cc.height);
    const img = cctx.getImageData(0, 0, cc.width, cc.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = img.data[i] / 255;
      const row = Math.floor(i / 4 / cc.width) / cc.height;
      const tread = row > 0.335 && row < 0.665;
      const base = tread ? 26 + v * 10 : 17 + v * 8;
      img.data[i] = base + (tread ? 10 : 0);
      img.data[i + 1] = base + (tread ? 7 : 0);
      img.data[i + 2] = base + (tread ? 4 : 0);
    }
    cctx.putImageData(img, 0, 0);
    return {
      normal: canvasTexture(nrm, { srgb: false }),
      color: canvasTexture(cc, { srgb: true }),
    };
  });
}

function buildTyre(mat) {
  const prof = tyreProfile();
  const g = latheX(prof, 96);
  // Custom v: map arc-length so that the tread spans [0.335, 0.665].
  const n = prof.length;
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  const treadStart = 8,
    treadEnd = n - 9;
  const vOf = (i) => {
    if (i <= treadStart) return (s[i] / s[treadStart]) * 0.335;
    if (i >= treadEnd) return 0.665 + ((s[i] - s[treadEnd]) / (s[n - 1] - s[treadEnd])) * 0.335;
    return 0.335 + ((s[i] - s[treadStart]) / (s[treadEnd] - s[treadStart])) * 0.33;
  };
  const uv = g.attributes.uv;
  const segs = 96;
  for (let j = 0; j <= segs; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      uv.setXY(k, j / segs, vOf(i));
    }
  }
  return new THREE.Mesh(g, mat);
}

// ---- rim ----
function rimProfile() {
  return [
    [0.2135, -0.093],
    [0.2032, -0.09],
    [0.2, -0.07],
    [0.179, -0.056],
    [0.178, -0.01],
    [0.182, 0.03],
    [0.196, 0.05],
    [0.2032, 0.082],
    [0.2125, 0.0885],
    [0.2155, 0.093],
    [0.2135, 0.0972],
    [0.205, 0.0975],
    [0.197, 0.0935],
    [0.191, 0.086],
    [0.188, 0.074],
  ];
}

function spokeGeometry(theta, split) {
  const sections = [];
  const r0 = 0.07,
    r1 = 0.19;
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = r0 + (r1 - r0) * t;
    let hw = 0.0105 - 0.003 * t + 0.01 * Math.pow(Math.max(0, (t - 0.82) / 0.18), 2);
    hw += 0.006 * Math.pow(Math.max(0, (0.15 - t) / 0.15), 2);
    const xf = 0.059 + 0.027 * Math.pow(t, 1.3);
    const xb = xf - 0.026 + 0.008 * t;
    const c = theta + split / r;
    const pts2 = [
      [-hw, xb],
      [-hw, xf - 0.005],
      [-hw * 0.7, xf],
      [hw * 0.7, xf],
      [hw, xf - 0.005],
      [hw, xb],
    ];
    sections.push(
      pts2.map(([s, x]) => {
        const a = c + s / r;
        return new THREE.Vector3(x, r * Math.cos(a), r * Math.sin(a));
      })
    );
  }
  return loftSections(sections, { capStart: true, capEnd: true });
}

function hubProfile() {
  return [
    [0.0, 0.0675],
    [0.022, 0.0675],
    [0.026, 0.065],
    [0.029, 0.061],
    [0.034, 0.059],
    [0.078, 0.059],
    [0.081, 0.055],
    [0.081, 0.03],
    [0.06, 0.02],
  ];
}

function lugNut() {
  const g = new THREE.CylinderGeometry(0.0098, 0.0098, 0.016, 6);
  g.rotateZ(Math.PI / 2);
  const cap = new THREE.SphereGeometry(0.0085, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.rotateZ(-Math.PI / 2);
  cap.translate(0.008, 0, 0);
  return [g, cap];
}

let rimMats = null;
function getRimMats() {
  if (rimMats) return rimMats;
  const w = weatheringUniforms({ dirt: 0.55, dust: 0.45, rust: 0, fade: 0 });
  rimMats = {
    alloy: applyWeathering(new THREE.MeshStandardMaterial({ color: 0xb9bcbf, metalness: 0.85, roughness: 0.32 }), w, {
      rustColor: false,
    }),
    darkAlloy: new THREE.MeshStandardMaterial({ color: 0x2b2c2e, metalness: 0.6, roughness: 0.55 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 1, roughness: 0.25 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x6d6a66, metalness: 0.85, roughness: 0.42 }),
    discHat: new THREE.MeshStandardMaterial({ color: 0x4a3a2e, metalness: 0.5, roughness: 0.8 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0x3d3b3a, metalness: 0.3, roughness: 0.6 }),
    rubber: null,
    weather: w,
  };
  const tex = tyreTextures();
  rimMats.rubber = applyWeathering(
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex.color, normalMap: tex.normal, roughness: 0.93, metalness: 0 }),
    weatheringUniforms({ dirt: 0.35, dust: 0.18, fade: 0 }),
    { rustColor: false, strength: 0.6 }
  );
  rimMats.rubber.normalScale.set(1, -1);
  return rimMats;
}

/**
 * Builds a wheel. Returns { group, spin, static } where `spin` rotates about X with the
 * road and `static` (caliper) stays fixed to the knuckle.
 */
export function buildWheel({ side = 1 } = {}) {
  const m = getRimMats();
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);

  const tyre = buildTyre(m.rubber);
  tyre.castShadow = tyre.receiveShadow = true;
  tyre.name = 'tyre';
  spin.add(tyre);

  const rim = new THREE.Mesh(latheX(rimProfile(), 72), m.alloy);
  rim.castShadow = rim.receiveShadow = true;
  spin.add(rim);

  const spokes = [];
  for (let k = 0; k < 5; k++) {
    const th = (k / 5) * Math.PI * 2;
    spokes.push(spokeGeometry(th, -0.012), spokeGeometry(th, 0.012));
  }
  const spokeMesh = new THREE.Mesh(mergeGeoms(spokes), m.alloy);
  spokeMesh.castShadow = spokeMesh.receiveShadow = true;
  spin.add(spokeMesh);

  const hub = new THREE.Mesh(latheX(hubProfile(), 48), m.alloy);
  spin.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0225, 0.0225, 0.005, 32).rotateZ(Math.PI / 2).translate(0.0695, 0, 0), m.alloy);
  spin.add(cap);

  const nuts = [];
  for (let k = 0; k < 5; k++) {
    const a = ((k + 0.5) / 5) * Math.PI * 2;
    for (const g of lugNut()) {
      const gg = g.clone();
      gg.translate(0.066, 0.057 * Math.cos(a), 0.057 * Math.sin(a));
      nuts.push(gg);
    }
  }
  spin.add(new THREE.Mesh(mergeGeoms(nuts), m.steel));

  // Vented disc: two friction plates with hat.
  const disc = new THREE.Mesh(
    latheX(
      [
        [0.07, -0.012],
        [0.141, -0.012],
        [0.142, -0.016],
        [0.142, -0.034],
        [0.141, -0.038],
        [0.085, -0.038],
        [0.085, -0.03],
        [0.07, -0.03],
      ],
      48
    ),
    m.disc
  );
  spin.add(disc);
  const hat = new THREE.Mesh(
    latheX(
      [
        [0.0, 0.0],
        [0.075, 0.0],
        [0.078, -0.006],
        [0.078, -0.03],
      ],
      36
    ),
    m.discHat
  );
  spin.add(hat);

  // Caliper (static): a curved bridge over the disc edge at the rear-top.
  const staticG = new THREE.Group();
  const cal = calliperGeometry();
  const cmesh = new THREE.Mesh(cal, m.caliper);
  cmesh.castShadow = true;
  staticG.add(cmesh);
  group.add(staticG);

  if (side < 0) group.rotation.y = Math.PI;
  return { group, spin, static: staticG };
}

function calliperGeometry() {
  const sections = [];
  const a0 = Math.PI * 0.55,
    a1 = Math.PI * 0.85;
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const a = a0 + ((a1 - a0) * i) / N;
    const e = Math.sin((i / N) * Math.PI);
    const rIn = 0.112,
      rOut = 0.152 + 0.004 * e;
    const x0 = -0.052,
      x1 = -0.002 + 0.002 * e;
    const pts = [
      [rIn, x0],
      [rOut, x0],
      [rOut, x1 - 0.006],
      [rOut - 0.006, x1],
      [rIn + 0.012, x1],
      [rIn + 0.012, x1 - 0.012],
      [rIn, x1 - 0.012],
    ];
    sections.push(pts.map(([r, x]) => new THREE.Vector3(x, r * Math.cos(a), r * Math.sin(a))));
  }
  return loftSections(sections, { capStart: true, capEnd: true });
}

function mergeGeoms(list) {
  const out = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    return n;
  });
  return mergeList(out);
}

function mergeList(geos) {
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3),
    nrm = new Float32Array(count * 3),
    uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  r.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  r.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  r.computeBoundingSphere();
  return r;
}

export { mergeList };
