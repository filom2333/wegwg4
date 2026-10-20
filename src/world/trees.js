// Textured trees: a trunk and branches swept as tapered tubes with bark UVs, foliage as crossed
// alpha-tested cards carrying photographed twigs. One geometry per tree with two groups (0 bark,
// 1 foliage) for a [bark, leaves] material pair. Base at y = 0, trunk up +Y, sizes in metres.
//
// Bark (pine, birch, oak) from Poly Haven / TextureCan (CC0); twig cards from ez-tree by Daniel
// Greenheck (MIT).

import * as THREE from 'three';
import { RENDER_CAPS } from '../gfx/caps.js';
import { mulberry32 } from '../core/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

class TreeMesher {
  constructor() {
    this.bark = { p: [], n: [], u: [], i: [] };
    this.leaf = { p: [], n: [], u: [], i: [] };
  }

  // Tube along `pts` with radii `rad`; bark texture wraps `wraps` times around.
  tube(pts, rad, seg, { wraps = 1, texLen = 1 } = {}) {
    const B = this.bark;
    const base = B.p.length / 3;
    // parallel-transport frames
    let t = pts[1].clone().sub(pts[0]).normalize();
    let nrm = Math.abs(t.y) < 0.9 ? new THREE.Vector3().crossVectors(t, UP).normalize() : V(1, 0, 0);
    let s = 0;
    for (let k = 0; k < pts.length; k++) {
      if (k > 0) {
        s += pts[k].distanceTo(pts[k - 1]);
        const nt = (k < pts.length - 1 ? pts[k + 1].clone().sub(pts[k - 1]) : pts[k].clone().sub(pts[k - 1])).normalize();
        const ax = new THREE.Vector3().crossVectors(t, nt);
        const sa = ax.length();
        if (sa > 1e-6) nrm.applyAxisAngle(ax.multiplyScalar(1 / sa), Math.asin(Math.min(1, sa)));
        t = nt;
      }
      const bin = new THREE.Vector3().crossVectors(t, nrm).normalize();
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const dx = nrm.x * Math.cos(a) + bin.x * Math.sin(a),
          dy = nrm.y * Math.cos(a) + bin.y * Math.sin(a),
          dz = nrm.z * Math.cos(a) + bin.z * Math.sin(a);
        const r = rad[k];
        B.p.push(pts[k].x + dx * r, pts[k].y + dy * r, pts[k].z + dz * r);
        B.n.push(dx, dy, dz);
        B.u.push((j / seg) * wraps, s / texLen);
      }
    }
    const W = seg + 1;
    for (let k = 0; k < pts.length - 1; k++)
      for (let j = 0; j < seg; j++) {
        const a = base + k * W + j,
          b = a + 1,
          c = a + W,
          d = c + 1;
        B.i.push(a, c, b, b, c, d);
      }
  }

  // A twig card (two crossed quads) from `at` along `dir`: texture v runs from the stem (0) up.
  card(at, dir, roll, len, wid, normalOf) {
    const L = this.leaf;
    const d = dir.clone().normalize();
    let side = new THREE.Vector3().crossVectors(d, UP);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize().applyAxisAngle(d, roll);
    for (let q = 0; q < 2; q++) {
      const sd = q ? side.clone().applyAxisAngle(d, Math.PI / 2) : side;
      const base = L.p.length / 3;
      const corners = [
        [-0.5, 0],
        [0.5, 0],
        [0.5, 1],
        [-0.5, 1],
      ];
      for (const [cx, cy] of corners) {
        const p = at.clone().addScaledVector(sd, cx * wid).addScaledVector(d, cy * len);
        L.p.push(p.x, p.y, p.z);
        const n = normalOf(p);
        L.n.push(n.x, n.y, n.z);
        L.u.push(cx + 0.5, cy);
      }
      L.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  geometry() {
    const B = this.bark,
      L = this.leaf;
    const nb = B.p.length / 3;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...B.p, ...L.p], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([...B.n, ...L.n], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([...B.u, ...L.u], 2));
    g.setIndex([...B.i, ...L.i.map((i) => i + nb)]);
    g.addGroup(0, B.i.length, 0);
    if (L.i.length) g.addGroup(B.i.length, L.i.length, 1);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Points along a gently curving limb: start, direction, length, droop (negative bends down)
// and a little noise.
function limb(rnd, start, dir, len, n, { droop = 0, curl = 0.08, lift = 0 } = {}) {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const p = start.clone();
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    d.y += (droop + lift * (1 - t)) / n;
    d.x += (rnd() - 0.5) * curl;
    d.z += (rnd() - 0.5) * curl;
    d.normalize();
    p.addScaledVector(d, len / n);
    pts.push(p.clone());
  }
  return pts;
}

function pointAt(pts, t) {
  const f = t * (pts.length - 1);
  const k = Math.min(pts.length - 2, Math.floor(f));
  return pts[k].clone().lerp(pts[k + 1], f - k);
}

function dirAt(pts, t) {
  const f = t * (pts.length - 1);
  const k = Math.min(pts.length - 2, Math.floor(f));
  return pts[k + 1].clone().sub(pts[k]).normalize();
}

// Foliage normals point out of the crown (with an upward bias), so the cards shade like one
// rounded mass instead of a pile of flat boards.
function crownNormal(cy, ry, up = 0.45) {
  return (p) => V(p.x, ((p.y - cy) / ry) * 0.7 + up, p.z).normalize();
}

// Spruce (dense cone from the ground) or pine (tall bare trunk, crown at the top).
export function texturedConifer(seed, { spruce = true, lod = 0 } = {}) {
  const rnd = mulberry32(seed);
  const M = new TreeMesher();
  const H = spruce ? 13 + rnd() * 6 : 15 + rnd() * 6;
  const r0 = H * (spruce ? 0.017 : 0.019);
  const lean = V((rnd() - 0.5) * 0.04, 1, (rnd() - 0.5) * 0.04).normalize();
  const trunk = limb(rnd, V(0, -0.3, 0), lean, H + 0.3, lod ? 5 : 12, { curl: 0.025 });
  const rad = trunk.map((p, k) => {
    const t = k / (trunk.length - 1);
    return r0 * Math.pow(1 - t, 0.85) * (1 + (t < 0.06 ? (0.06 - t) * 5 : 0)) + 0.012;
  });
  M.tube(trunk, rad, lod ? 5 : 8, { wraps: 2, texLen: r0 * 5 });
  const crown0 = spruce ? 0.08 + rnd() * 0.06 : 0.42 + rnd() * 0.12;
  const Lmax = H * (spruce ? 0.25 : 0.2);
  const step = (spruce ? 0.5 : 0.62) * (lod ? 1.7 : 1);
  const normalOf = crownNormal(H * (spruce ? 0.45 : 0.72), H * 0.5);
  const cardScale = H / 16;
  for (let y = crown0 * H; y < H - 0.5; y += step * (0.85 + rnd() * 0.3)) {
    const t = (y / H - crown0) / (1 - crown0);
    const prof = spruce ? Math.pow(1 - t, 0.95) : Math.sin(Math.min(1, t * 1.25 + 0.12) * Math.PI) * 0.85 * (1 - t * 0.35);
    const L = Lmax * prof * (0.8 + rnd() * 0.35) + 0.35;
    const nb = (spruce ? 5 : 4) + Math.floor(rnd() * 2) - (lod ? 1 : 0);
    const az0 = rnd() * Math.PI * 2;
    const at = pointAt(trunk, y / H);
    for (let b = 0; b < nb; b++) {
      const az = az0 + (b / nb) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const pitch = spruce ? -0.25 - (1 - t) * 0.25 : 0.05 - t * 0.2;
      const dir = V(Math.cos(az), pitch, Math.sin(az));
      const pts = limb(rnd, at, dir, L, lod ? 2 : 3, { droop: spruce ? -0.1 : -0.18, lift: spruce ? 0.32 : 0.12, curl: 0.12 });
      const br = 0.02 + 0.04 * (L / Lmax);
      if (!lod || L > Lmax * 0.45) M.tube(pts, pts.map((p, k) => br * (1 - (k / (pts.length - 1)) * 0.85)), lod ? 3 : 4, { texLen: 0.5 });
      // twig cards along the outer part of the branch, pointing outward and a little up
      const nc = Math.max(1, Math.round((L / (spruce ? 0.62 : 0.7)) * (lod ? 0.55 : 1)));
      for (let c = 0; c < nc; c++) {
        const ct = 0.22 + (0.78 * (c + rnd() * 0.5)) / nc;
        const p = pointAt(pts, Math.min(1, ct));
        const d = dirAt(pts, Math.min(0.99, ct)).add(V(0, 0.3 + rnd() * 0.3, 0)).add(V((rnd() - 0.5) * 0.6, 0, (rnd() - 0.5) * 0.6));
        const len = (0.9 + rnd() * 0.5) * cardScale * (0.75 + 0.35 * (1 - t)) * (lod ? 1.5 : 1);
        M.card(p, d, rnd() * Math.PI, len, len * 0.85, normalOf);
      }
    }
  }
  // leader: a few cards up the top metre
  for (let k = 0; k < (lod ? 2 : 4); k++) {
    const p = pointAt(trunk, 0.9 + k * 0.02);
    M.card(p, V((rnd() - 0.5) * 0.4, 1, (rnd() - 0.5) * 0.4), rnd() * Math.PI, 1.1 * cardScale, 0.8 * cardScale, normalOf);
  }
  return M.geometry();
}

// Birch / aspen: slender trunk, two orders of upward branches, leaf cards at the twig ends.
// bare: winter tree with an extra order of fine twigs and no leaves.
export function texturedBroadleaf(seed, { bare = false, lod = 0 } = {}) {
  const rnd = mulberry32(seed);
  const M = new TreeMesher();
  const H = 10 + rnd() * 5;
  const r0 = H * 0.016;
  const lean = V((rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12).normalize();
  const trunk = limb(rnd, V(0, -0.3, 0), lean, H * 0.88, lod ? 5 : 10, { curl: 0.05 });
  M.tube(
    trunk,
    trunk.map((p, k) => r0 * Math.pow(1 - (k / (trunk.length - 1)) * 0.8, 1.2) + 0.01),
    lod ? 5 : 8,
    { wraps: 1, texLen: r0 * 7 }
  );
  const normalOf = crownNormal(H * 0.66, H * 0.35, 0.35);
  const n1 = (bare ? 9 : 11) + Math.floor(rnd() * 4) - (lod ? 3 : 0);
  const cardS = H / 13;
  for (let i = 0; i < n1; i++) {
    const t = 0.32 + (0.6 * (i + rnd() * 0.6)) / n1;
    const at = pointAt(trunk, t);
    const az = i * 2.4 + rnd() * 0.6;
    const L1 = H * (0.36 - t * 0.2) * (0.75 + rnd() * 0.4);
    const dir = V(Math.cos(az), 0.75 + t * 0.5 + rnd() * 0.3, Math.sin(az));
    const b1 = limb(rnd, at, dir, L1, lod ? 2 : 4, { droop: -0.25, curl: 0.18 });
    const r1 = r0 * (0.42 - t * 0.2);
    M.tube(b1, b1.map((p, k) => r1 * (1 - (k / (b1.length - 1)) * 0.8) + 0.004), lod ? 3 : 5, { texLen: 0.4 });
    const n2 = (lod ? 2 : 4) + Math.floor(rnd() * 2);
    for (let j = 0; j < n2; j++) {
      const t2 = 0.3 + (0.7 * (j + rnd() * 0.5)) / n2;
      const p2 = pointAt(b1, Math.min(1, t2));
      const side = (j % 2 ? 1 : -1) * (0.6 + rnd() * 0.5);
      const d1 = dirAt(b1, Math.min(0.99, t2));
      const d2 = d1.clone().applyAxisAngle(UP, side).add(V(0, 0.25, 0));
      const L2 = L1 * (0.35 + rnd() * 0.25);
      const b2 = limb(rnd, p2, d2, L2, lod ? 1 : 2, { droop: -0.35, curl: 0.25 });
      if (!lod || !bare) M.tube(b2, b2.map((p, k) => 0.012 * (1 - (k / (b2.length - 1)) * 0.7)), 3, { texLen: 0.3 });
      if (bare) {
        if (lod) continue;
        for (let k = 0; k < 3; k++) {
          const p3 = pointAt(b2, 0.4 + k * 0.25);
          const d3 = dirAt(b2, 0.5).applyAxisAngle(UP, (rnd() - 0.5) * 2.4).add(V(0, 0.4, 0));
          const b3 = limb(rnd, p3, d3, L2 * 0.5, 1, { curl: 0.3 });
          M.tube(b3, [0.006, 0.002], 3, { texLen: 0.3 });
        }
        continue;
      }
      // leafy twigs: cards hang off the end two thirds, outward and up
      const nc = lod ? 2 : 4;
      for (let c = 0; c < nc; c++) {
        const p = pointAt(b2, 0.3 + (0.7 * c) / nc);
        const d = dirAt(b2, 0.5).add(V((rnd() - 0.5) * 1.2, 0.2 + rnd() * 0.6, (rnd() - 0.5) * 1.2));
        const len = (1.0 + rnd() * 0.6) * cardS * (lod ? 1.45 : 1);
        M.card(p, d, rnd() * Math.PI, len, len * 0.7, normalOf);
      }
    }
  }
  return M.geometry();
}

// Low woody shrub (sagebrush, dwarf birch): a few crooked stems from the root, twig cards
// fanned around their upper parts.
export function texturedShrub(seed, { lod = 0, height = 1.1, spread = 1 } = {}) {
  const rnd = mulberry32(seed);
  const M = new TreeMesher();
  const H = height * (0.75 + rnd() * 0.5);
  const normalOf = crownNormal(H * 0.55, H * 0.6, 0.5);
  const stems = (lod ? 3 : 5) + Math.floor(rnd() * 3);
  for (let i = 0; i < stems; i++) {
    const az = (i / stems) * Math.PI * 2 + rnd() * 0.8;
    const out = 0.25 + rnd() * 0.45 * spread;
    const dir = V(Math.cos(az) * out, 1, Math.sin(az) * out);
    const L = H * (0.6 + rnd() * 0.45);
    const pts = limb(rnd, V((rnd() - 0.5) * 0.1, -0.05, (rnd() - 0.5) * 0.1), dir, L, 2, { curl: 0.35, droop: -0.1 });
    if (!lod) M.tube(pts, [0.025, 0.016, 0.006], 3, { texLen: 0.3 });
    const nc = lod ? 2 : 4;
    for (let c = 0; c < nc; c++) {
      const p = pointAt(pts, 0.35 + (0.65 * (c + rnd() * 0.5)) / nc);
      const d = dirAt(pts, 0.6).add(V((rnd() - 0.5) * 1.4, 0.3 + rnd() * 0.5, (rnd() - 0.5) * 1.4));
      const len = H * (0.45 + rnd() * 0.25) * (lod ? 1.4 : 1);
      M.card(p, d, rnd() * Math.PI, len, len * 0.85, normalOf);
    }
  }
  return M.geometry();
}

// ----------------------------------------------------------------------- materials
const BASE = (import.meta.env && import.meta.env.BASE_URL ? import.meta.env.BASE_URL : './') + 'textures/trees/';

// Resolves once every texture has loaded (the impostor bake needs the pixels).
export async function loadTreeTextures(renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = async (name, srgb, repeat = true) => {
    const t = await loader.loadAsync(BASE + name + '.webp');
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    return t;
  };
  const T = { bark: {}, leaf: {} };
  const jobs = [];
  for (const b of ['pine', 'birch', 'oak'])
    jobs.push(Promise.all([load(`bark_${b}_color`, true), load(`bark_${b}_normal`, false)]).then(([map, normal]) => (T.bark[b] = { map, normal })));
  for (const l of ['pine', 'aspen_green', 'aspen_autumn', 'ash', 'oak']) jobs.push(load('leaf_' + l, true, false).then((t) => (T.leaf[l] = t)));
  // ground cover cards
  T.flora = {};
  const FL = (import.meta.env && import.meta.env.BASE_URL ? import.meta.env.BASE_URL : './') + 'textures/flora/';
  for (const f of ['grass_tall', 'grass_short', 'fern'])
    jobs.push(
      loader.loadAsync(FL + f + '.webp').then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = aniso;
        T.flora[f] = t;
      })
    );
  await Promise.all(jobs);
  return T;
}

// Wind: the whole tree bends with height (as the old flora material did); foliage also flutters.
// Snow: whatever faces up turns white (facet normal from screen derivatives).
function treeShader(m, { sway, snow, leaf, sat = 1 }) {
  m.userData.uniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nvarying vec3 vSnowWP;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
#ifdef USE_INSTANCING
  vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
#else
  vec4 wp = vec4(0.0);
#endif
  float ph = wp.x * 0.37 + wp.z * 0.21;
  float h = max(position.y, 0.0);
  float bend = h * h * ${sway.toFixed(4)} * (0.4 + uWind) * (sin(uTime * (1.1 + uWind) + ph) * 0.6 + sin(uTime * 2.7 + ph * 2.0) * 0.25 + uWind * 0.8);
  transformed.x += bend;
  transformed.z += bend * 0.4;
  ${leaf ? 'float fl = sin(uTime * 6.0 + position.x * 3.0 + position.z * 2.0 + ph) * 0.03 * (0.3 + uWind) * h / 12.0; transformed.y += fl; transformed.x += fl * 0.6;' : ''}
}`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
#ifdef USE_INSTANCING
vSnowWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
vSnowWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`
      );
    let fs = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowWP;\nfloat gSnow = 0.0;');
    // desaturated foliage (sagebrush silver, dwarf birch rust) from the same twig photos
    if (sat < 1)
      fs = fs.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sdc = texture2D( map, vMapUv );
  sdc.rgb = mix(vec3(dot(sdc.rgb, vec3(0.3, 0.55, 0.15))), sdc.rgb, ${sat.toFixed(2)});
  diffuseColor *= sdc;
#endif`
      );
    if (leaf)
      // keep the crown normals on back faces (no flip), and let light through thin foliage a bit
      fs = fs.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize( vNormal );');
    if (snow)
      fs = fs
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  vec3 fn = normalize(cross(dFdx(vSnowWP), dFdy(vSnowWP)));
  if (dot(fn, cameraPosition - vSnowWP) < 0.0) fn = -fn;
  gSnow = smoothstep(${leaf ? '0.05, 0.45' : '0.25, 0.6'}, fn.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), gSnow * ${leaf ? '0.85' : '0.9'});
}`
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.75, gSnow);');
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'tree' + sway + (snow ? 's' : '') + (leaf ? 'l' : 'b') + sat;
  return m;
}

// [bark, leaves] for a species. leaf: key of T.leaf or null for bare trees.
export function treeMaterials(T, { bark = 'pine', leaf = 'pine', tint = 0xffffff, snow = false, sway = 0.0024, sat = 1 } = {}) {
  const b = new THREE.MeshStandardMaterial({ map: T.bark[bark].map, normalMap: T.bark[bark].normal, roughness: 0.95, metalness: 0 });
  b.normalScale.set(1.2, 1.2);
  treeShader(b, { sway, snow, leaf: false });
  const l = new THREE.MeshStandardMaterial({ map: leaf ? T.leaf[leaf] : null, color: tint, alphaTest: 0.42, alphaToCoverage: RENDER_CAPS.msaa > 0, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
  treeShader(l, { sway, snow, leaf: true, sat });
  return [b, l];
}
