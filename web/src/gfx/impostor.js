// Billboard impostors for distant vegetation: each model is rendered once (unlit vertex colours)
// from the front and the side into an atlas, then drawn far away as two crossed quads with an
// alpha-tested, scene-lit material. Four triangles stand in for hundreds. A second atlas holds
// the model's own normals (the rounded crown of a tree) from the same views, so a card is lit
// like the tree it stands for: sunlit on one side, in shade on the other, not a flat cut-out.

import * as THREE from 'three';
import { RENDER_CAPS } from './caps.js';

const TILE_W = 128,
  TILE_H = 256;

// geos: [BufferGeometry] with position/normal/color, base near y = 0. Returns
// { texture, normals, quads: [BufferGeometry], means: [[r, g, b] linear] } (one crossed-quad
// geometry and one average colour per input).
// materials[i]: optional material array for a textured model (geometry groups); unlit copies of
// its maps are used for the bake.
export function bakeImpostors(renderer, geos, { tileW = TILE_W, tileH = TILE_H, snow = [], materials = [] } = {}) {
  const tiles = geos.length * 2;
  const cols = Math.min(16, tiles);
  const rows = Math.ceil(tiles / cols);
  const W = THREE.MathUtils.ceilPowerOfTwo(cols * tileW);
  const H = THREE.MathUtils.ceilPowerOfTwo(rows * tileH);
  const rt = new THREE.WebGLRenderTarget(W, H, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.SRGBColorSpace,
    depthBuffer: true,
  });
  const scene = new THREE.Scene();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  // snowy models: the same facet-normal snow as the scene's snow material
  const snowMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const addSnow = (m, lo = 0.18, hi = 0.55) => {
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowWP;').replace('#include <project_vertex>', '#include <project_vertex>\nvSnowWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowWP;').replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 fn = normalize(cross(dFdx(vSnowWP), dFdy(vSnowWP)));
  if (dot(fn, cameraPosition - vSnowWP) < 0.0) fn = -fn;
  float sn = smoothstep(${lo.toFixed(2)}, ${hi.toFixed(2)}, fn.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), sn * 0.9);
}`
      );
    };
    m.customProgramCacheKey = () => 'impSnow' + lo;
  };
  const textured = (mats, sn) =>
    mats.map((m, k) => {
      const b = new THREE.MeshBasicMaterial({ map: m.map || null, color: m.color, alphaTest: m.alphaTest || 0, side: THREE.DoubleSide });
      if (sn) addSnow(b, k ? 0.05 : 0.25, k ? 0.45 : 0.6);
      return b;
    });
  snowMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowWP;').replace('#include <project_vertex>', '#include <project_vertex>\nvSnowWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowWP;').replace(
      '#include <color_fragment>',
      `#include <color_fragment>
{
  vec3 fn = normalize(cross(dFdx(vSnowWP), dFdy(vSnowWP)));
  if (dot(fn, cameraPosition - vSnowWP) < 0.0) fn = -fn;
  float sn = smoothstep(0.18, 0.55, fn.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), sn * 0.92);
}`
    );
  };
  snowMat.customProgramCacheKey = () => 'impSnow';
  // the normal pass: object-space normals, cut by the same alpha as the colour
  const nrt = rt.clone();
  nrt.texture.colorSpace = THREE.NoColorSpace;
  const normalMat = (map = null, alphaTest = 0) =>
    new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, alphaTest: { value: alphaTest } },
      side: THREE.DoubleSide,
      vertexShader: `varying vec3 vN; varying vec2 vUv;
void main() { vN = normal; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map; uniform float alphaTest; varying vec3 vN; varying vec2 vUv;
void main() {
  ${map ? 'if (texture2D(map, vUv).a < alphaTest) discard;' : ''}
  vec3 n = normalize(vN);
  ${map ? '' : 'if (!gl_FrontFacing) n = -n;'}
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`,
    });
  const plainN = normalMat();
  const texturedN = (mats) => mats.map((m) => normalMat(m.map || null, m.map ? m.alphaTest || 0.4 : 0));
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  const prev = {
    target: renderer.getRenderTarget(),
    clear: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
    shadow: renderer.shadowMap.enabled,
    tone: renderer.toneMapping,
  };
  renderer.setRenderTarget(rt);
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  // average foliage colour as the transparent background so mip levels don't fringe dark
  const avg = new THREE.Color(0.2, 0.26, 0.14);
  renderer.setRenderTarget(nrt);
  renderer.setClearColor(new THREE.Color(0.5, 1, 0.5), 0);
  renderer.clear(true, true, true);
  renderer.setRenderTarget(rt);
  renderer.setClearColor(avg, 0);
  renderer.clear(true, true, true);
  renderer.autoClear = false;
  const quads = [];
  geos.forEach((geo, i) => {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const b = geo.boundingBox;
    const h = b.max.y - Math.min(0, b.min.y);
    const y0 = Math.min(0, b.min.y);
    const views = [
      { dir: new THREE.Vector3(0, 0, 1), half: Math.max(Math.abs(b.min.x), Math.abs(b.max.x)) },
      { dir: new THREE.Vector3(1, 0, 0), half: Math.max(Math.abs(b.min.z), Math.abs(b.max.z)) },
    ];
    // keep the aspect of the tile: widen the frame if the model is squat
    const rects = [];
    views.forEach((v, k) => {
      const t = i * 2 + k;
      const cx = t % cols,
        cy = Math.floor(t / cols);
      const halfW = Math.max(v.half, (h * tileW) / tileH / 2) * 1.02;
      const halfH = (halfW * tileH) / tileW;
      cam.left = -halfW;
      cam.right = halfW;
      cam.top = y0 + halfH * 2;
      cam.bottom = y0;
      cam.position.copy(v.dir).multiplyScalar(50);
      cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
      mesh.geometry = geo;
      if (materials[i]) {
        if (!materials[i].baked) materials[i].baked = textured(materials[i], snow[i]);
        mesh.material = materials[i].baked;
      } else mesh.material = snow[i] ? snowMat : mat;
      const px = cx * tileW,
        py = cy * tileH;
      // render-target viewports are in target pixels (no device pixel ratio)
      for (const target of [rt, nrt]) {
        target.viewport.set(px, py, tileW, tileH);
        target.scissor.set(px, py, tileW, tileH);
        target.scissorTest = true;
      }
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      // the same view again, normals this time
      const colour = mesh.material;
      if (materials[i]) {
        if (!materials[i].bakedN) materials[i].bakedN = texturedN(materials[i]);
        mesh.material = materials[i].bakedN;
      } else mesh.material = plainN;
      renderer.setRenderTarget(nrt);
      renderer.clearDepth();
      renderer.render(scene, cam);
      mesh.material = colour;
      renderer.setRenderTarget(rt);
      rects.push({ u0: px / W, u1: (px + tileW) / W, v0: py / H, v1: (py + tileH) / H, halfW, height: halfH * 2, y0 });
    });
    quads.push(crossedQuads(rects));
  });
  for (const target of [rt, nrt]) {
    target.viewport.set(0, 0, W, H);
    target.scissor.set(0, 0, W, H);
    target.scissorTest = false;
  }
  renderer.autoClear = prev.autoClear;
  renderer.setRenderTarget(prev.target);
  renderer.setClearColor(prev.clear, prev.alpha);
  renderer.shadowMap.enabled = prev.shadow;
  renderer.toneMapping = prev.tone;
  mat.dispose();
  snowMat.dispose();
  plainN.dispose();
  for (const ms of materials) if (ms) for (const m of [...(ms.baked || []), ...(ms.bakedN || [])]) m.dispose();
  // read back and bleed colour into the transparent texels (push-pull), so the mip chain does
  // not average the trees with the background and distant cards keep their colour
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
  const npx = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(nrt, 0, 0, W, H, npx);
  // each model's average colour where it is solid (for the far canopy painted on the ground)
  const means = geos.map((g, i) => {
    const m = [0, 0, 0];
    let n = 0;
    for (let k = 0; k < 2; k++) {
      const t = i * 2 + k;
      const x0 = (t % cols) * tileW,
        y0 = Math.floor(t / cols) * tileH;
      for (let y = y0; y < y0 + tileH; y++)
        for (let x = x0; x < x0 + tileW; x++) {
          const o = (y * W + x) * 4;
          if (px[o + 3] < 128) continue;
          for (let c = 0; c < 3; c++) m[c] += Math.pow(px[o + c] / 255, 2.2);
          n++;
        }
    }
    return m.map((v) => v / Math.max(1, n));
  });
  pushPull(px, W, H);
  // the normals' empty texels take their neighbours' (the colour's alpha marks what is solid)
  for (let i = 0; i < W * H; i++) npx[i * 4 + 3] = px[i * 4 + 3];
  pushPull(npx, W, H);
  const atlas = (data, srgb) => {
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  };
  rt.dispose();
  nrt.dispose();
  return { texture: atlas(px, true), normals: atlas(npx, false), quads, means };
}

// Fills the RGB of transparent pixels from an alpha-weighted pyramid (alpha is kept).
function pushPull(px, W, H) {
  const levels = [];
  let w = W,
    h = H;
  let c = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3] > 8 ? 1 : 0;
    c[i * 4] = px[i * 4] * a;
    c[i * 4 + 1] = px[i * 4 + 1] * a;
    c[i * 4 + 2] = px[i * 4 + 2] * a;
    c[i * 4 + 3] = a;
  }
  levels.push({ c, w, h });
  while (w > 1 && h > 1) {
    const nw = w >> 1,
      nh = h >> 1;
    const n = new Float32Array(nw * nh * 4);
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        const o = (y * nw + x) * 4;
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          const s = ((y * 2 + dy) * w + x * 2 + dx) * 4;
          n[o] += c[s];
          n[o + 1] += c[s + 1];
          n[o + 2] += c[s + 2];
          n[o + 3] += c[s + 3];
        }
      }
    levels.push({ c: n, w: nw, h: nh });
    c = n;
    w = nw;
    h = nh;
  }
  // normalise sums to colours; weight 0 marks an empty texel
  for (const L of levels)
    for (let i = 0; i < L.w * L.h; i++) {
      const wt = L.c[i * 4 + 3];
      if (wt > 0) {
        L.c[i * 4] /= wt;
        L.c[i * 4 + 1] /= wt;
        L.c[i * 4 + 2] /= wt;
      }
    }
  // pull: each level's empty texels take the colour of the level above
  for (let k = levels.length - 2; k >= 0; k--) {
    const L = levels[k],
      U = levels[k + 1];
    for (let y = 0; y < L.h; y++)
      for (let x = 0; x < L.w; x++) {
        const o = (y * L.w + x) * 4;
        if (L.c[o + 3] > 0) continue;
        const u = (Math.min(U.h - 1, y >> 1) * U.w + Math.min(U.w - 1, x >> 1)) * 4;
        L.c[o] = U.c[u];
        L.c[o + 1] = U.c[u + 1];
        L.c[o + 2] = U.c[u + 2];
        L.c[o + 3] = U.c[u + 3] > 0 ? 1e-3 : 0;
      }
  }
  const L0 = levels[0].c;
  for (let i = 0; i < W * H; i++) {
    if (px[i * 4 + 3] > 8) continue;
    px[i * 4] = L0[i * 4];
    px[i * 4 + 1] = L0[i * 4 + 1];
    px[i * 4 + 2] = L0[i * 4 + 2];
  }
}

// Two quads crossing on the trunk: one in the XY plane (front view), one in ZY (side view).
function crossedQuads(rects) {
  const pos = [],
    nor = [],
    uv = [],
    idx = [];
  rects.forEach((r, k) => {
    const base = pos.length / 3;
    const x0 = -r.halfW,
      x1 = r.halfW,
      y0 = r.y0,
      y1 = r.y0 + r.height;
    // front view was rendered looking down -Z from +Z: image x = +X; side view looking down -X
    // from +X: image x = -Z
    const P = k === 0 ? [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]] : [[0, y0, -x0], [0, y0, -x1], [0, y1, -x1], [0, y1, -x0]];
    for (const p of P) pos.push(...p);
    // normals lean up and out so the cards light like a rounded crown, not like flat boards
    for (const p of P) {
      const n = new THREE.Vector3(p[0], (p[1] - y0) / r.height - 0.2 + 0.6, p[2]).normalize();
      nor.push(n.x, n.y, n.z);
    }
    uv.push(r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// The cards' material: the colour atlas lit through the baked normals (turned with each
// instance), each tree a little lighter or darker than the next (the same tint its full model
// gets, from its scale and turn, so nothing changes when the model swaps for the card), the
// foliage kept solid down the mip chain, and a dithered fade where the cards end (opts.far, m from
// the camera) so the forest runs on into the canopy painted on the ground instead of stopping at
// a line.
// opts.near: where cards that take over from nearer ones start (the same dither, the other way
// round, so the two sets cross-dissolve); opts.fade: how long the far fade is (m).
export function createImpostorMaterial(texture, normals = null, { far = 0, near = 0, fade = 150 } = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.42,
    alphaToCoverage: RENDER_CAPS.msaa > 0,
    side: THREE.DoubleSide,
    roughness: 0.92,
    metalness: 0,
  });
  m.userData.uniforms = { uImpN: { value: normals }, uImpFar: { value: far }, uImpNear: { value: near }, uImpFade: { value: fade } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vImpX;\nvarying vec3 vImpY;\nvarying vec3 vImpZ;\nvarying float vImpTint;\nvarying float vImpDist;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
#ifdef USE_INSTANCING
  mat3 im = mat3(instanceMatrix);
#else
  mat3 im = mat3(1.0);
#endif
  mat3 o2v = mat3(viewMatrix) * mat3(modelMatrix) * im;
  vImpX = o2v[0];
  vImpY = o2v[1];
  vImpZ = o2v[2];
  vImpTint = fract(sin(dot(vec2(im[0].x, im[0].z), vec2(127.1, 311.7))) * 43758.5453);
}`
      )
      .replace('#include <project_vertex>', '#include <project_vertex>\nvImpDist = length(mvPosition.xyz);');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uImpN;\nuniform float uImpFar;\nuniform float uImpNear;\nuniform float uImpFade;\nvarying vec3 vImpX;\nvarying vec3 vImpY;\nvarying vec3 vImpZ;\nvarying float vImpTint;\nvarying float vImpDist;'
      )
      .replace(
        '#include <alphatest_fragment>',
        `{
  // keep the crowns solid far away: alpha averaged down the mips would fall under the cut
  vec2 tsz = vec2(textureSize(map, 0));
  vec2 ddx = dFdx(vMapUv * tsz), ddy = dFdy(vMapUv * tsz);
  float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
  diffuseColor.a *= 1.0 + mip * 0.22;
  diffuseColor.rgb *= mix(0.82, 1.12, vImpTint);
  // a crown far off shows more of its own shade
  diffuseColor.rgb *= mix(1.0, 0.8, smoothstep(250.0, 1600.0, vImpDist));
  float h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  if (uImpFar > 0.0 && 1.0 - smoothstep(uImpFar - uImpFade, uImpFar, vImpDist) < h) discard;
  if (uImpNear > 0.0 && smoothstep(uImpNear - 150.0, uImpNear, vImpDist) < 1.0 - h) discard;
}
#include <alphatest_fragment>`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
  vec3 on = texture2D(uImpN, vMapUv).xyz * 2.0 - 1.0;
  normal = normalize(mat3(vImpX, vImpY, vImpZ) * on);
}`
      );
  };
  m.customProgramCacheKey = () => 'impostorLit';
  return m;
}
