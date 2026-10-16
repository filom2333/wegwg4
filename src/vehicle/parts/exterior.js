// Exterior detail components that complete the skin: lamp internals, grille and intake inserts,
// fog lamps, mirrors, handles, plates, wipers, badges, arch liners, exhaust and antenna.
// All geometry is authored in car space at rest; callers attach each group to its part.

import * as THREE from 'three';
import { latheY, loftSections, roundedBox, tubeAlong, superSection } from '../../gfx/geom.js';
import { makeCanvas, canvasTexture, cached, normalFromHeight } from '../../gfx/textures.js';
import { skinFrontZ, skinRearZ, skinSideX, skinTopY, skinNormal, skinAlong } from '../body/probe.js';
import { SPEC, GLASS_FRAMES } from '../body/shape.js';
import { yBelt, unwrapFront, HEAD_POLY_PTS } from '../body/regions.js';
import { mergeList } from './wheel.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function mirrorX(geo) {
  const g = geo.clone();
  g.scale(-1, 1, 1);
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    g.index.needsUpdate = true;
  } else {
    const p = g.attributes.position.array;
    const n = g.attributes.normal ? g.attributes.normal.array : null;
    for (let i = 0; i < p.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = p[i + 3 + k];
        p[i + 3 + k] = p[i + 6 + k];
        p[i + 6 + k] = t;
        if (n) {
          const u = n[i + 3 + k];
          n[i + 3 + k] = n[i + 6 + k];
          n[i + 6 + k] = u;
        }
      }
    }
  }
  if (g.attributes.normal) {
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) n[i] = -n[i];
  }
  return g;
}

function meshL(geo, mat, sideSign) {
  const g = sideSign < 0 ? mirrorX(geo) : geo;
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Orient a geometry built along +Y (lathe axis) to point along `dir`, placed at `pos`.
function orientY(geo, dir, pos) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
  geo.applyQuaternion(q);
  geo.translate(pos.x, pos.y, pos.z);
  return geo;
}

function frontPoint(x, y, inset = 0) {
  const z = skinFrontZ(x, y);
  const n = skinNormal([x, y, z]);
  return { p: V(x, y, z).addScaledVector(V(...n), -inset), n: V(...n) };
}

// ------------------------------------------------------------------ headlamps
// Skin point at unwrapped front coordinate U (see regions.unwrapFront) and height y: walks the
// body's outline at that height (across the front, round the corner, along the side).
function frontOutline(y) {
  const pts = [];
  const zMax = skinFrontZ(0, y);
  for (let i = 0; i <= 40; i++) {
    const x = (0.78 * i) / 40;
    const z = skinFrontZ(x, y);
    if (!isFinite(z)) break;
    pts.push([x, z]);
  }
  const last = pts[pts.length - 1];
  for (let i = 1; i <= 30; i++) {
    const z = last[1] - (0.45 * i) / 30;
    const x = skinSideX(y, z);
    if (!isFinite(x)) break;
    pts.push([x, z]);
  }
  void zMax;
  return pts.map(([x, z]) => ({ x, z, U: unwrapFront(x, z) })).filter((p, i, a) => i === 0 || p.U > a[i - 1].U);
}
function skinAtU(U, y, cache) {
  const key = y.toFixed(3);
  const o = cache[key] || (cache[key] = frontOutline(y));
  let i = 1;
  while (i < o.length - 1 && o[i].U < U) i++;
  const a = o[i - 1],
    b = o[i];
  const t = Math.max(0, Math.min(1, (U - a.U) / Math.max(1e-6, b.U - a.U)));
  return V(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t);
}

// Lamp bucket: a closed dark-chrome housing behind the lens, following its outline, so nothing
// of the engine bay shows through the glass.
function headlampBucket(mats) {
  const cache = {};
  // resample the outline so long edges follow the body round the corner
  const pts = [];
  for (let i = 0; i < HEAD_POLY_PTS.length; i++) {
    const a = HEAD_POLY_PTS[i],
      b = HEAD_POLY_PTS[(i + 1) % HEAD_POLY_PTS.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.025));
    for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  const ring = pts.map(([U, y0]) => {
    // the top of the lens stops at the hood seam: keep off the hood's upper surface, and raise a
    // lip from there up to the hood's underside so nothing shows over the bucket
    let y = y0;
    let p = skinAtU(U, y, cache);
    let n = V(...skinNormal([p.x, p.y, p.z]));
    while (n.y > 0.72 && y > 0.68) {
      y -= 0.005;
      p = skinAtU(U, y, cache);
      n = V(...skinNormal([p.x, p.y, p.z]));
    }
    let lip = null;
    if (y < y0 - 0.004) {
      const top = skinTopY(p.x, p.z - 0.01, 0.6, 1.2);
      lip = V(p.x, Math.min(y0, (isFinite(top) ? top : y0) - 0.008), p.z - 0.01);
    }
    return { p, n, lip };
  });
  const c = V(0, 0, 0);
  ring.forEach((r) => c.add(r.p));
  c.multiplyScalar(1 / ring.length);
  const secs = [0.004, 0.02, 0.05, 0.08].map((d, k) =>
    ring.map(({ p, n, lip }) => {
      if (k === 0 && lip) return lip.clone();
      const q = p.clone().addScaledVector(n, -d);
      // narrow toward the back
      return q.lerp(c.clone().addScaledVector(V(0, 0, -1), d * 0.6), k * 0.07);
    })
  );
  const geo = loftSections(secs, { capStart: false, capEnd: true });
  const mat = cached('lampBucket', () => new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide }));
  void mats;
  return [geo, mat];
}

export function buildHeadlampInternals(mats, side) {
  const g = new THREE.Group();
  const s = side;
  const parts = [];
  parts.push(headlampBucket(mats));
  // Low-beam projector.
  {
    const { p, n } = frontPoint(0.56, 0.722, 0.03);
    const dir = n.clone().lerp(V(0, 0, 1), 0.5).normalize();
    const ring = latheY(
      [
        [0.026, -0.03],
        [0.03, 0.0],
        [0.041, 0.004],
        [0.044, 0.0],
        [0.042, -0.012],
        [0.032, -0.04],
      ],
      40
    );
    parts.push([orientY(ring, dir, p), mats.lampChrome]);
    const lens = latheY(
      [
        [0.0, 0.017],
        [0.012, 0.014],
        [0.022, 0.008],
        [0.028, 0.0],
        [0.028, -0.01],
      ],
      40
    );
    parts.push([orientY(lens, dir, p.clone().addScaledVector(dir, 0.002)), mats.projector]);
    const shroud = latheY(
      [
        [0.03, -0.04],
        [0.034, -0.075],
        [0.0, -0.08],
      ],
      24
    );
    parts.push([orientY(shroud, dir, p), mats.blackMatte]);
  }
  // High-beam parabolic reflector with bulb.
  {
    const { p, n } = frontPoint(0.42, 0.728, 0.045);
    const dir = n.clone().lerp(V(0, 0, 1), 0.5).normalize();
    const prof = [];
    for (let i = 0; i <= 10; i++) {
      const r = 0.006 + (0.034 * i) / 10;
      prof.push([r, (r * r) / 0.06 - 0.02]);
    }
    prof.push([0.04, 0.0]);
    parts.push([orientY(latheY(prof, 40), dir, p), mats.lampChrome]);
    const bulb = new THREE.SphereGeometry(0.0065, 12, 8);
    parts.push([orientY(bulb, dir, p.clone().addScaledVector(dir, -0.008)), mats.bulb]);
    const cap = latheY(
      [
        [0.0, 0.004],
        [0.008, 0.0],
        [0.0, -0.002],
      ],
      16
    );
    parts.push([orientY(cap, dir, p.clone().addScaledVector(dir, 0.004)), mats.lampChrome]);
  }
  // Amber indicator reflector at the outer corner.
  {
    const x = 0.725,
      y = 0.742;
    const z = skinFrontZ(x, y);
    const n = V(...skinNormal([x, y, z]));
    const p = V(x, y, z).addScaledVector(n, -0.03);
    const prof = [];
    for (let i = 0; i <= 8; i++) {
      const r = 0.005 + (0.024 * i) / 8;
      prof.push([r, (r * r) / 0.05 - 0.012]);
    }
    parts.push([orientY(latheY(prof, 32), n, p), mats.amberChrome]);
    parts.push([orientY(new THREE.SphereGeometry(0.006, 10, 8), n, p.clone().addScaledVector(n, -0.004)), mats.indicator]);
  }
  // Daytime light guide: flat frosted strip just behind the lens along the lower edge.
  {
    const secs = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const x = 0.37 + 0.39 * t;
      const y = 0.682 + 0.03 * t * t;
      const z = skinFrontZ(x, y);
      const nn = V(...skinNormal([x, y, z]));
      const c = V(x, y, z).addScaledVector(nn, -0.011);
      const up = V(0, 1, 0).addScaledVector(nn, -nn.y).normalize();
      secs.push(superSection(c, nn, up, 0.0035, 0.0055, 4, 10));
    }
    parts.push([loftSections(secs, { capStart: true, capEnd: true }), mats.drl]);
  }
  // Dark-chrome separator between the high and low beam.
  {
    const { p, n } = frontPoint(0.495, 0.725, 0.035);
    const geo = roundedBox(0.006, 0.07, 0.03, 0.002, 1);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n));
    geo.translate(p.x, p.y, p.z);
    parts.push([geo, mats.lampHousingDark || mats.blackMatte]);
  }
  for (const [geo, mat] of parts) {
    const m = meshL(geo, mat, s);
    // everything sits behind the lens inside the body: no shadow casting (VSM leaks through the hood)
    m.castShadow = false;
    g.add(m);
  }
  return g;
}

// ------------------------------------------------------------------ tail lamps
export function buildTaillampInternals(mats, side) {
  const g = new THREE.Group();
  const parts = [];
  // Two round brake/tail light rings on the rear face, outer part.
  for (const [x, y] of [
    [0.7, 0.92],
    [0.585, 0.935],
  ]) {
    const z = skinRearZ(x, y);
    const n = V(...skinNormal([x, y, z]));
    const p = V(x, y, z).addScaledVector(n, -0.022);
    const ring = latheY(
      [
        [0.018, 0.0],
        [0.03, 0.003],
        [0.034, 0.0],
        [0.03, -0.012],
      ],
      32
    );
    parts.push([orientY(ring, n, p), mats.lampChrome]);
    const disc = latheY(
      [
        [0.0, 0.002],
        [0.018, 0.0],
        [0.018, -0.004],
      ],
      24
    );
    parts.push([orientY(disc, n, p), mats.redChrome]);
  }
  // Reverse lamp reflector (inner clear section).
  {
    const x = 0.55,
      y = 0.865;
    const z = skinRearZ(x, y);
    const n = V(...skinNormal([x, y, z]));
    const p = V(x, y, z).addScaledVector(n, -0.026);
    const prof = [];
    for (let i = 0; i <= 8; i++) {
      const r = 0.004 + (0.022 * i) / 8;
      prof.push([r, (r * r) / 0.05 - 0.01]);
    }
    parts.push([orientY(latheY(prof, 28), n, p), mats.lampChrome]);
    parts.push([orientY(new THREE.SphereGeometry(0.005, 10, 8), n, p.clone().addScaledVector(n, -0.003)), mats.bulb]);
  }
  for (const [geo, mat] of parts) g.add(meshL(geo, mat, side));
  return g;
}

// ------------------------------------------------------------------ grille & intake
function frontInsert(x0, x1, y0, y1, inset, nx = 24, ny = 8) {
  // Heightfield patch z = skin(x,y) - inset over a rectangle (x0..x1 full width).
  const sections = [];
  const pos = [],
    uv = [],
    idx = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      const y = y0 + ((y1 - y0) * j) / ny;
      const z = skinFrontZ(x, y, 1.6) - inset;
      pos.push(x, y, z);
      uv.push((x - x0) / 0.06, (y - y0) / 0.06);
    }
  }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i,
        b = a + 1,
        c = a + nx + 2,
        d = a + nx + 1;
      idx.push(a, b, c, a, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  void sections;
  return geo;
}

function honeycombMaterial() {
  return cached('honeycomb', () => {
    const c = makeCanvas(256, 256);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#fff';
    const r = 18;
    const h = Math.sqrt(3) * r;
    for (let row = -1; row < 10; row++) {
      for (let col = -1; col < 10; col++) {
        const cx = col * r * 1.5 * 1.0 + 0;
        const cy = row * h + (col % 2 ? h / 2 : 0);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          ctx.lineTo(cx * (256 / (r * 1.5 * 8)) + Math.cos(a) * r * 0.78, cy * (256 / (h * 7.4)) + Math.sin(a) * r * 0.78);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    const alpha = canvasTexture(c, { srgb: false });
    // invert: holes are white in canvas -> alpha should be 0 there
    const inv = makeCanvas(256, 256);
    const ictx = inv.getContext('2d');
    ictx.filter = 'invert(1)';
    ictx.drawImage(c, 0, 0);
    const aTex = canvasTexture(inv, { srgb: false });
    void alpha;
    const m = new THREE.MeshStandardMaterial({
      color: 0x0c0c0d,
      roughness: 0.55,
      alphaMap: aTex,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    return m;
  });
}

export function buildFrontBumperDetails(mats) {
  const g = new THREE.Group();
  const add = (geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // Upper grille: recessed dark backing, three horizontal slats and a chrome top strip.
  add(frontInsert(-0.34, 0.34, 0.655, 0.775, 0.045, 24, 6), mats.blackMatte, false);
  for (let k = 0; k < 3; k++) {
    const y = 0.692 + k * 0.026;
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const x = -0.29 + (0.58 * i) / 10;
      const z = skinFrontZ(x, y) - 0.016;
      pts.push(V(x, y, z));
    }
    const sec = [];
    for (const p of pts) {
      sec.push(
        superSection(p, V(0, 1, 0), V(0, 0, 1), 0.0045, 0.012, 3, 12).map((v) => v)
      );
    }
    const geo = loftSections(sec, { capStart: true, capEnd: true });
    add(geo, k === 2 ? mats.chrome : mats.blackGloss);
  }
  // Badge: chrome arrow emblem in the grille centre.
  {
    const shape = new THREE.Shape();
    shape.moveTo(-0.045, -0.018);
    shape.lineTo(0.0, 0.026);
    shape.lineTo(0.045, -0.018);
    shape.lineTo(0.03, -0.018);
    shape.lineTo(0.0, 0.01);
    shape.lineTo(-0.03, -0.018);
    shape.closePath();
    const oval = new THREE.Shape();
    oval.absellipse(0, 0, 0.062, 0.036, 0, Math.PI * 2);
    const hole = new THREE.Path();
    hole.absellipse(0, 0, 0.054, 0.029, 0, Math.PI * 2, true);
    oval.holes.push(hole);
    const z = skinFrontZ(0, 0.718) - 0.004;
    for (const sh of [shape, oval]) {
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 24 });
      geo.translate(0, 0.718, z);
      add(geo, mats.chrome);
    }
  }
  // Lower intake: honeycomb mesh with a dark backing behind it.
  add(frontInsert(-0.5, 0.5, 0.28, 0.49, 0.03, 30, 8), honeycombMaterial(), false);
  add(frontInsert(-0.5, 0.5, 0.28, 0.49, 0.075, 12, 4), mats.blackMatte, false);
  // Fog lamps.
  for (const s of [1, -1]) {
    // U=0.655 on the unwrapped front corner -> find x on the front face
    const x = 0.609,
      y = 0.395;
    const z = skinFrontZ(x, y);
    const n = V(...skinNormal([x, y, z]));
    const p = V(x, y, z).addScaledVector(n, -0.012);
    const body = latheY(
      [
        [0.0, -0.05],
        [0.034, -0.05],
        [0.044, -0.02],
        [0.047, 0.0],
        [0.036, 0.005],
      ],
      32
    );
    const lens = latheY(
      [
        [0.0, 0.007],
        [0.02, 0.006],
        [0.033, 0.003],
        [0.037, 0.0],
      ],
      32
    );
    const refl = latheY(
      [
        [0.006, -0.03],
        [0.02, -0.022],
        [0.031, -0.006],
      ],
      24
    );
    for (const [geo, mat] of [
      [orientY(body, n, p), mats.blackMatte],
      [orientY(refl, n, p), mats.lampChrome],
      [orientY(lens, n, p), mats.projector],
    ]) {
      const m = meshL(geo, mat, s);
      g.add(m);
    }
  }
  // Front licence plate.
  g.add(buildPlate('S 742 KO', V(0, 0.565, skinFrontZ(0, 0.565) + 0.006), V(0, 0, 1), mats));
  return g;
}

// ------------------------------------------------------------------ plates
function plateTexture(text) {
  return cached('plate:' + text, () => {
    const c = makeCanvas(1040, 224);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e9e7df';
    ctx.fillRect(0, 0, 1040, 224);
    // grime gradient
    const gr = ctx.createLinearGradient(0, 0, 0, 224);
    gr.addColorStop(0, 'rgba(120,95,60,0.06)');
    gr.addColorStop(1, 'rgba(120,95,60,0.28)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 1040, 224);
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, 1020, 204);
    ctx.fillStyle = '#2a4b8c';
    ctx.fillRect(14, 14, 92, 196);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = 'bold 50px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('DR', 60, 170);
    ctx.fillStyle = '#151515';
    ctx.font = 'bold 150px "Arial Narrow", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 575, 118);
    return canvasTexture(c, { srgb: true, wrap: false });
  });
}

export function buildPlate(text, pos, normal, mats) {
  const w = 0.52,
    h = 0.112;
  const g = new THREE.Group();
  const plateGeo = roundedBox(w, h, 0.0025, 0.004, 2);
  const tex = plateTexture(text);
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.55, metalness: 0.2 });
  // UVs from position for the front face
  const uv = plateGeo.attributes.uv;
  const ps = plateGeo.attributes.position;
  for (let i = 0; i < ps.count; i++) uv.setXY(i, ps.getX(i) / w + 0.5, ps.getY(i) / h + 0.5);
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.castShadow = true;
  const holder = new THREE.Mesh(roundedBox(w + 0.018, h + 0.018, 0.008, 0.005, 2), mats.blackMatte);
  holder.position.z = -0.005;
  g.add(holder, plate);
  g.position.copy(pos);
  g.lookAt(pos.clone().add(normal));
  return g;
}

export function buildTrunkDetails(mats) {
  const g = new THREE.Group();
  const y = 0.87;
  const z = skinRearZ(0, y);
  g.add(buildPlate('S 742 KO', V(0, y, z - 0.008), V(0, 0, -1), mats));
  // Chrome emblem above the plate
  const z2 = skinRearZ(0, 0.958);
  const oval = new THREE.Shape();
  oval.absellipse(0, 0, 0.05, 0.03, 0, Math.PI * 2);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, 0.043, 0.024, 0, Math.PI * 2, true);
  oval.holes.push(hole);
  const arrow = new THREE.Shape();
  arrow.moveTo(-0.036, -0.015);
  arrow.lineTo(0, 0.021);
  arrow.lineTo(0.036, -0.015);
  arrow.lineTo(0.024, -0.015);
  arrow.lineTo(0, 0.008);
  arrow.lineTo(-0.024, -0.015);
  arrow.closePath();
  for (const sh of [oval, arrow]) {
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.001, bevelSegments: 2, curveSegments: 24 });
    geo.rotateY(Math.PI);
    geo.translate(0, 0.958, z2 - 0.001);
    const m = new THREE.Mesh(geo, mats.chrome);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

// ------------------------------------------------------------------ mirrors
export function buildMirror(mats, side) {
  const g = new THREE.Group();
  // Mount on the door sail, extends outward.
  const zc = 0.765,
    yc = 1.005;
  const x0 = Math.abs(skinSideX(yc, zc)) - 0.01;
  const secs = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = x0 + 0.03 + t * 0.17;
    const a = 0.034 + 0.02 * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.5) - 0.012 * t * t; // depth half (z)
    const b = 0.05 + 0.018 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) - 0.022 * Math.pow(t, 3); // height half
    const c = V(x, yc + 0.012 + 0.012 * t, zc + 0.012 * t);
    // D-shaped section: flat face toward the rear (-z)
    const pts = [];
    const M = 20;
    for (let k = 0; k < M; k++) {
      const ang = (k / M) * Math.PI * 2;
      const cy = Math.sin(ang),
        cz = Math.cos(ang);
      let zz = cz > 0 ? cz * a : cz * a * 0.25;
      const yy = Math.sign(cy) * Math.pow(Math.abs(cy), 0.75) * b;
      pts.push(V(c.x, c.y + yy, c.z + zz));
    }
    secs.push(pts);
  }
  // tip cap: shrink last section
  const tip = secs[N].map((p) => V(p.x + 0.012, (p.y - (yc + 0.024)) * 0.6 + yc + 0.024, (p.z - (zc + 0.012)) * 0.7 + zc + 0.012));
  secs.push(tip);
  const housing = loftSections(secs, { capStart: true, capEnd: true });
  g.add(meshL(housing, mats.paint, side));
  // Glass on the rear face
  const glass = roundedBox(0.15, 0.085, 0.002, 0.02, 3);
  glass.translate(x0 + 0.125, yc + 0.02, zc - 0.006);
  g.add(meshL(glass, mats.mirrorGlass, side));
  const frame = roundedBox(0.158, 0.093, 0.004, 0.022, 3);
  frame.translate(x0 + 0.125, yc + 0.02, zc - 0.004);
  g.add(meshL(frame, mats.blackMatte, side));
  // Indicator strip on the front-lower edge
  const ind = roundedBox(0.09, 0.008, 0.012, 0.004, 2);
  ind.translate(x0 + 0.15, yc - 0.022, zc + 0.034);
  g.add(meshL(ind, mats.indicator, side));
  // Black foot on the sail
  const foot = roundedBox(0.05, 0.05, 0.07, 0.012, 3);
  foot.translate(x0 + 0.015, yc, zc + 0.005);
  g.add(meshL(foot, mats.blackMatte, side));
  return g;
}

// ------------------------------------------------------------------ handles
export function buildDoorHandle(mats, side, zFront, zBack, y = 0.888) {
  const g = new THREE.Group();
  const pts = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const z = zFront + ((zBack - zFront) * i) / N;
    const x = Math.abs(skinSideX(y, z));
    const n = skinNormal([x, y, z]);
    const bulge = Math.sin((i / N) * Math.PI);
    pts.push({ c: V(x + n[0] * (0.006 + 0.012 * bulge), y, z), n: V(...n) });
  }
  const secs = pts.map(({ c }, i) => {
    const t = i / N;
    const h = 0.012 + 0.004 * Math.sin(t * Math.PI);
    return superSection(c, V(1, 0, 0), V(0, 1, 0), 0.007 + 0.005 * Math.sin(t * Math.PI), h, 3, 14);
  });
  g.add(meshL(loftSections(secs, { capStart: true, capEnd: true }), mats.paint, side));
  // Recess cup (dark) behind
  const cupPts = [];
  for (let i = 0; i <= 10; i++) {
    const z = zFront + 0.01 + ((zBack - zFront - 0.02) * i) / 10;
    const x = Math.abs(skinSideX(y - 0.01, z));
    cupPts.push(V(x - 0.0015, y - 0.012, z));
  }
  const cup = tubeAlong(cupPts, 0.012, 10);
  cup.scale(1, 1, 1);
  g.add(meshL(cup, mats.blackMatte, side));
  return g;
}

// ------------------------------------------------------------------ wipers
export function buildWipers(mats) {
  const g = new THREE.Group();
  const { WS_P0, WS_E2, WS_N } = GLASS_FRAMES;
  const pivots = [
    [0.36, 0.56],
    [-0.12, 0.6],
  ];
  const wipers = [];
  for (const [px, len] of pivots) {
    const wg = new THREE.Group();
    const b = 0.065;
    const base = V(px, WS_P0[1] + WS_E2[1] * b, WS_P0[2] + WS_E2[2] * b);
    // follow the windshield surface: probe each point from inside along normal
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const x = px - (len * i) / 10;
      const bb = b + 0.03 * Math.sin((i / 10) * Math.PI);
      const o = [x, WS_P0[1] + WS_E2[1] * bb - WS_N[1] * 0.3, WS_P0[2] + WS_E2[2] * bb - WS_N[2] * 0.3];
      const sp = skinAlong(o, [0, WS_N[1], WS_N[2]], 0.6);
      pts.push(V(sp[0], sp[1] + WS_N[1] * 0.009, sp[2] + WS_N[2] * 0.009));
    }
    const blade = tubeAlong(pts, 0.0045, 6);
    blade.scale(1, 1, 1);
    const arm = tubeAlong(
      pts.slice(0, 7).map((p) => p.clone().add(V(0, WS_N[1] * 0.008, WS_N[2] * 0.008))),
      0.0035,
      6
    );
    const hub = new THREE.CylinderGeometry(0.012, 0.014, 0.02, 16);
    hub.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(0, WS_N[1], WS_N[2])));
    hub.translate(pts[0].x, pts[0].y, pts[0].z);
    for (const geo of [blade, arm, hub]) {
      const m = new THREE.Mesh(geo, mats.blackMatte);
      m.castShadow = true;
      wg.add(m);
    }
    wg.userData.pivot = pts[0].clone();
    wg.userData.axis = V(0, WS_N[1], WS_N[2]);
    g.add(wg);
    wipers.push(wg);
  }
  g.userData.wipers = wipers;
  return g;
}

// ------------------------------------------------------------------ arch liners
export function buildArchLiners(mats) {
  const g = new THREE.Group();
  for (const [zc, R, xIn] of [
    [SPEC.axleF, SPEC.archR, 0.47],
    [SPEC.axleR, SPEC.archRr, 0.59],
  ]) {
    for (const s of [1, -1]) {
      const sections = [];
      const yc = SPEC.wheelY;
      const a0 = -0.12,
        a1 = Math.PI + 0.12;
      const N = 36;
      const rows = [];
      for (let i = 0; i <= N; i++) {
        const a = a0 + ((a1 - a0) * i) / N;
        const rr = R + 0.012;
        const z = zc + Math.cos(a) * rr,
          y = yc + Math.sin(a) * rr;
        let xo = 0.86;
        try {
          xo = Math.abs(skinSideX(y, z)) - 0.02;
        } catch (e) {
          /* keep */
        }
        xo = Math.min(Math.max(xo, 0.6), 0.9);
        rows.push([z, y, xo, a]);
      }
      // Liner surface (cylinder strip) from inner wall x=0.47 to the skin
      const pos = [],
        idx = [];
      const M = 6;
      rows.forEach(([z, y, xo]) => {
        for (let k = 0; k <= M; k++) {
          const x = xIn + ((xo - xIn) * k) / M;
          pos.push(x * s, y, z);
        }
      });
      for (let i = 0; i < N; i++)
        for (let k = 0; k < M; k++) {
          const a = i * (M + 1) + k,
            b = a + 1,
            c = a + M + 2,
            d = a + M + 1;
          if (s > 0) idx.push(a, d, b, b, d, c);
          else idx.push(a, b, d, b, c, d);
        }
      // Inner wall (half disc) at x = 0.47
      const base = pos.length / 3;
      pos.push(xIn * s, yc - 0.02, zc);
      rows.forEach(([z, y]) => pos.push(xIn * s, y, z));
      for (let i = 0; i < N; i++) {
        if (s > 0) idx.push(base, base + 1 + i, base + 2 + i);
        else idx.push(base, base + 2 + i, base + 1 + i);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mats.blackMatte);
      m.material = mats.linerMat || mats.blackMatte;
      m.receiveShadow = true;
      g.add(m);
      void sections;
    }
  }
  return g;
}

// ------------------------------------------------------------------ small items
export function buildExhaustTip(mats) {
  const g = new THREE.Group();
  const tip = latheY(
    [
      [0.026, 0.0],
      [0.03, 0.002],
      [0.031, 0.09],
      [0.028, 0.092],
      [0.024, 0.088],
      [0.024, 0.0],
    ],
    24
  );
  tip.rotateX(-Math.PI / 2);
  tip.translate(-0.5, 0.305, -2.2);
  const m = new THREE.Mesh(tip, mats.chrome);
  m.castShadow = true;
  g.add(m);
  const pipe = tubeAlong([V(-0.5, 0.305, -2.215), V(-0.5, 0.302, -2.14), V(-0.49, 0.29, -1.98), V(-0.44, 0.255, -1.84)], 0.024, 12);
  const p2 = new THREE.Mesh(pipe, mats.exhaustMat || mats.blackMatte);
  g.add(p2);
  return g;
}

export function buildAntenna(mats) {
  const g = new THREE.Group();
  const z = -0.72;
  const y = skinTopY(0, z);
  const secs = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const h = 0.055 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5) * (1 - 0.15 * t);
    const zz = z + 0.06 - t * 0.14;
    const w = 0.022 * (1 - t * 0.6);
    const top = Math.max(0.004, h);
    secs.push([V(-w, y - 0.002, zz), V(-w * 0.7, y + top * 0.6, zz), V(0, y + top, zz), V(w * 0.7, y + top * 0.6, zz), V(w, y - 0.002, zz)]);
  }
  const fin = loftSections(secs, { capStart: true, capEnd: true, closed: true });
  const m = new THREE.Mesh(fin, mats.blackGloss);
  m.castShadow = true;
  g.add(m);
  return g;
}

export function buildFuelCap(mats) {
  const g = new THREE.Group();
  const y = 0.86,
    z = -1.63;
  const x = Math.abs(skinSideX(y, z)) - 0.028;
  const recess = latheY(
    [
      [0.0, -0.03],
      [0.06, -0.03],
      [0.064, 0.0],
    ],
    24
  );
  recess.rotateZ(Math.PI / 2);
  recess.translate(-x, y, z);
  g.add(new THREE.Mesh(recess, mats.blackMatte));
  const cap = latheY(
    [
      [0.0, 0.016],
      [0.026, 0.014],
      [0.03, 0.0],
      [0.03, -0.01],
    ],
    20
  );
  cap.rotateZ(Math.PI / 2);
  cap.translate(-x - 0.012, y, z);
  const cm = new THREE.Mesh(cap, mats.blackGloss);
  cm.name = 'fuelCap';
  g.add(cm);
  return g;
}

export function buildRearReflectors(mats) {
  const g = new THREE.Group();
  for (const s of [1, -1]) {
    const x = 0.72,
      y = 0.47;
    const z = skinRearZ(x, y);
    const n = V(...skinNormal([x, y, z]));
    const geo = roundedBox(0.075, 0.018, 0.006, 0.003, 2);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n);
    geo.applyQuaternion(q);
    geo.translate(x, y, z + n.z * 0.001);
    g.add(meshL(geo, mats.redChrome, s));
  }
  return g;
}

export { mirrorX };
