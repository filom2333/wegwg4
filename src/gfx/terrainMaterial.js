// Terrain material: height-blended splatting of the ground texture array, biome tint,
// distance-dependent tiling, macro variation and rain wetness.

import * as THREE from 'three';

export function createTerrainMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.userData.uniforms = {
    uAlb: { value: tex.albedo },
    uNrm: { value: tex.normal },
    uWet: { value: 0 },
    uScale: { value: 0.33 },
    uFadeFar: { value: 3200 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 mat;
attribute vec4 matB;
attribute vec4 tint;
varying vec4 vMat;
varying vec4 vMat2;
varying vec3 vTint;
varying float vVeg;
varying vec2 vWuv;
varying float vWy;
varying vec3 vWN;
varying float vViewDist;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vMat = mat;
vMat2 = matB;
vTint = tint.rgb;
vVeg = tint.a;
vWuv = uv;
vWy = position.y;
vWN = normalize(mat3(modelMatrix) * normal);`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vViewDist = -mvPosition.z;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uAlb;
uniform sampler2DArray uNrm;
uniform float uWet;
uniform float uScale;
uniform float uFadeFar;
varying vec4 vMat;
varying vec4 vMat2;
varying vec3 vTint;
varying float vVeg;
varying vec2 vWuv;
varying float vWy;
varying vec3 vWN;
varying float vViewDist;
vec3 gNrmT;
float gRough;
float gRockW;
float gSnowW;
// value noise with derivatives on a lattice that wraps every P cells (the world uv wraps at 2048 m,
// so P = 2048 / cell size keeps it seamless)
float tHash(vec2 i){ vec2 p = fract(i * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
vec3 tNoised(vec2 p, float P) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 i1 = mod(i + 1.0, P);
  i = mod(i, P);
  float a = tHash(i), b = tHash(vec2(i1.x, i.y)), c = tHash(vec2(i.x, i1.y)), d = tHash(i1);
  float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * (vec2(k1, k2) + k4 * u.yx));
}

vec4 layerSample(float L, vec2 uvNear, vec2 uvFar, float farT) {
  vec4 a = texture(uAlb, vec3(uvNear, L));
  vec4 b = texture(uAlb, vec3(uvFar, L));
  return mix(a, b, farT);
}
vec3 layerNormal(float L, vec2 uvNear, vec2 uvFar, float farT) {
  vec3 a = texture(uNrm, vec3(uvNear, L)).xyz * 2.0 - 1.0;
  vec3 b = texture(uNrm, vec3(uvFar, L)).xyz * 2.0 - 1.0;
  return normalize(mix(a, b, farT));
}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 uvN = vWuv * uScale;
  vec2 uvF = vWuv * uScale * 0.21 + 0.37;
  // explicit gradients so layers can be skipped per pixel without mip seams
  vec2 dxN = dFdx(uvN), dyN = dFdy(uvN), dxF = dFdx(uvF), dyF = dFdy(uvF);
  float farT = smoothstep(18.0, 70.0, vViewDist);
  // steep ground: dirt and rock are also projected from the side, so cliffs are not smeared
  vec3 Nw = normalize(vWN);
  float side = smoothstep(0.8, 0.5, Nw.y);
  vec2 uvSN = (abs(Nw.x) > abs(Nw.z) ? vec2(vWuv.y, vWy) : vec2(vWuv.x, vWy)) * uScale;
  vec2 uvSF = uvSN * 0.21 + 0.37;
  vec2 dxSN = dFdx(uvSN), dySN = dFdy(uvSN), dxSF = dFdx(uvSF), dySF = dFdy(uvSF);
  // beyond ~70 m the near scale is gone; blend the far scale into a very coarse one instead, so
  // hillsides and mountains a kilometre off show no repeating pattern
  bool vfar = vViewDist > 70.0;
  vec2 uvX = vWuv * uScale * 0.043 + 0.71, uvSX = uvSN * 0.043 + 0.71;
  vec2 uA = vfar ? uvF : uvN, uB = vfar ? uvX : uvF;
  vec2 dxA = vfar ? dxF : dxN, dyA = vfar ? dyF : dyN, dxB = vfar ? dFdx(uvX) : dxF, dyB = vfar ? dFdy(uvX) : dyF;
  vec2 uSA = vfar ? uvSF : uvSN, uSB = vfar ? uvSX : uvSF;
  vec2 dxSA = vfar ? dxSF : dxSN, dySA = vfar ? dySF : dySN, dxSB = vfar ? dFdx(uvSX) : dxSF, dySB = vfar ? dFdy(uvSX) : dySF;
  float pairT = vfar ? smoothstep(110.0, 700.0, vViewDist) * 0.85 : farT;
  float flatT = smoothstep(450.0, 1400.0, vViewDist) * 0.8;
  float wt[8];
  wt[0] = vMat.x; wt[1] = vMat.y; wt[2] = vMat.z; wt[3] = vMat.w;
  wt[4] = vMat2.x; wt[5] = vMat2.y; wt[6] = vMat2.z; wt[7] = vMat2.w;
  // texture-array layer, near and far tiling per ground type:
  // sand, dirt, rock, salt, grass, snow, forest floor, gravel
  const float LIDX[8] = float[8](0.0, 1.0, 2.0, 3.0, 6.0, 7.0, 8.0, 4.0);
  const float SN[8] = float[8](1.0, 0.8, 0.6, 0.5, 0.9, 0.42, 0.85, 0.75);
  const float SF[8] = float[8](1.0, 1.0, 0.8, 1.0, 1.0, 0.7, 1.0, 1.0);
  const float RO[8] = float[8](0.96, 0.93, 0.82, 0.78, 0.9, 0.62, 0.93, 0.9);
  vec4 smp[8];
  float w[8];
  float tot = 0.0;
  for (int i = 0; i < 8; i++) {
    smp[i] = vec4(0.0);
    w[i] = 0.0;
    if (wt[i] > 0.004) {
      float mA = vfar ? SF[i] : SN[i], mB = vfar ? 1.0 : SF[i];
      vec4 a = textureGrad(uAlb, vec3(uA * mA, LIDX[i]), dxA * mA, dyA * mA);
      vec4 b = textureGrad(uAlb, vec3(uB * mB, LIDX[i]), dxB * mB, dyB * mB);
      smp[i] = mix(a, b, pairT);
      if ((i == 1 || i == 2) && side > 0.01) {
        vec4 sa = textureGrad(uAlb, vec3(uSA * mA, LIDX[i]), dxSA * mA, dySA * mA);
        vec4 sb = textureGrad(uAlb, vec3(uSB * mB, LIDX[i]), dxSB * mB, dySB * mB);
        smp[i] = mix(smp[i], mix(sa, sb, pairT), side);
      }
      // far off, texture detail is only noise: settle to the layer's mean colour and let the
      // relief, light and macro variation carry the land
      if (flatT > 0.0) smp[i].rgb = mix(smp[i].rgb, textureLod(uAlb, vec3(0.5, 0.5, LIDX[i]), 12.0).rgb, flatT);
      // height-based blending: the taller texture wins at transitions
      w[i] = pow(wt[i] * smp[i].a + wt[i] * 0.001 + 0.08, 6.0);
      tot += w[i];
    }
  }
  vec3 alb = vec3(0.0);
  vec3 nt = vec3(0.0);
  gRough = 0.0;
  for (int i = 0; i < 8; i++) {
    if (w[i] <= 0.0) continue;
    float k = w[i] / tot;
    alb += smp[i].rgb * k;
    float mA = vfar ? SF[i] : SN[i], mB = vfar ? 1.0 : SF[i];
    vec3 na = textureGrad(uNrm, vec3(uA * mA, LIDX[i]), dxA * mA, dyA * mA).xyz * 2.0 - 1.0;
    vec3 nb = textureGrad(uNrm, vec3(uB * mB, LIDX[i]), dxB * mB, dyB * mB).xyz * 2.0 - 1.0;
    nt += normalize(mix(na, nb, pairT)) * k;
    gRough += RO[i] * k;
  }
  float wSand = w[0] / tot, wDirt = w[1] / tot, wRock = w[2] / tot, wSalt = w[3] / tot, wSnow = w[5] / tot, wGrav = w[7] / tot;
  gRockW = wRock;
  gSnowW = wSnow;
  // sedimentary layering in exposed rock: bands of slightly different tone, warped and tilted
  {
    // beds of uneven thickness: value noise along the height, warped, so no regular stripes
    vec3 sn = tNoised(vWuv / 64.0, 32.0);
    float yy = vWy + sn.x * 12.0;
    float band = tNoised(vec2(yy / 13.0, 3.5), 4096.0).x * 0.6 + tNoised(vec2(yy / 4.7 + 0.37, 9.5), 4096.0).x * 0.4;
    band = smoothstep(0.3, 0.7, band);
    float band2 = tNoised(vec2(yy / 2.3, 7.5), 4096.0).x * (1.0 - smoothstep(150.0, 600.0, vViewDist));
    vec3 strata = mix(vec3(0.84, 0.79, 0.76), vec3(1.1, 1.03, 0.94), band) * (0.93 + 0.1 * band2);
    alb *= mix(vec3(1.0), strata, wRock * (1.0 - wSnow) * 0.7);
  }
  // biome tint (normalised) mostly on dirt and rock
  float lum = max(dot(vTint, vec3(0.333)), 0.01);
  vec3 tintN = vTint / lum;
  alb *= mix(vec3(1.0), tintN, (0.55 * (wDirt + wRock) + 0.25 * wSand + 0.4 * wGrav) * (1.0 - wSnow));
  // soil crust: dark, slightly greyer blotches with crisp edges on bare earth
  {
    float cn = tNoised(vWuv / 4.0, 512.0).x * 0.65 + tNoised(vWuv / 1.0, 2048.0).x * 0.35;
    float crust = smoothstep(0.58, 0.64, cn) * wDirt * (1.0 - farT * 0.5);
    alb = mix(alb, alb * vec3(0.72, 0.7, 0.7), crust * 0.8);
  }
  // grassland is never one green: drier, golden stretches and lusher hollows drift across it
  {
    float wGrass = w[4] / tot;
    if (wGrass > 0.01) {
      vec2 wq = vWuv / 128.0 + (tNoised(vWuv / 64.0, 32.0).x - 0.5) * 1.3;
      float dn = tNoised(wq, 16.0).x * 0.7 + tNoised(vWuv / 32.0, 64.0).x * 0.3;
      float dry = smoothstep(0.32, 0.62, dn);
      float l = dot(alb, vec3(0.3, 0.5, 0.2));
      vec3 straw = vec3(1.75, 1.42, 0.7) * l;
      alb = mix(alb, straw, dry * 0.85 * wGrass);
      alb = mix(alb, alb * vec3(0.72, 0.88, 0.7), (1.0 - smoothstep(0.22, 0.42, dn)) * 0.7 * wGrass);
    }
  }
  // macro brightness variation
  float macro = texture(uAlb, vec3(vWuv * 0.0021 + 0.5, 1.0)).a;
  float macro2 = texture(uAlb, vec3(vWuv * 0.0007, 0.0)).a;
  alb *= mix(0.82 + 0.3 * macro + 0.12 * (macro2 - 0.5), 0.95 + 0.08 * macro, wSnow);
  // far shrubs: past the ring of scattered meshes, dark crowns speckle the open ground at the
  // biome's cover; once a 4 m cell shrinks to a few pixels they average into a tone, so no shimmer
  {
    // in wooded country the speckle is forest canopy, taking over where the tree impostors end
    float wood = smoothstep(0.15, 0.45, w[6] / tot);
    float veg = max(vVeg, wood * 0.95) * (1.0 - wRock) * (1.0 - wSnow * (1.0 - wood * 0.7)) * (1.0 - wSalt);
    float fadeIn = smoothstep(mix(210.0, 760.0, wood), mix(330.0, 980.0, wood), vViewDist);
    if (veg > 0.01 && fadeIn > 0.0) {
      vec2 p = vWuv / 4.0;
      vec2 ci = mod(floor(p), 512.0);
      vec2 f = fract(p);
      float pres = step(tHash(ci + vec2(71.0, 3.0)), veg);
      vec2 c = vec2(tHash(ci + vec2(13.0, 7.0)), tHash(ci + vec2(29.0, 17.0))) * 0.5 + 0.25;
      float r = mix(0.18, 0.36, wood) + 0.14 * tHash(ci + vec2(47.0, 23.0));
      float mpp = max(length(fwidth(vWuv)), 1e-4);
      float aa = mpp / 4.0;
      float dotC = pres * (1.0 - smoothstep(r - aa, r + aa, length(f - c)));
      float rm = mix(0.25, 0.43, wood);
      float meanC = veg * 3.14159 * rm * rm;
      float k = smoothstep(2.5, 7.0, 4.0 / mpp);
      float cov = mix(meanC, dotC, k) * fadeIn;
      vec3 crown = mix(vec3(0.06, 0.07, 0.04), vec3(0.025, 0.045, 0.025), wood);
      alb = mix(alb, crown * (0.8 + 0.4 * tHash(ci + vec2(5.0, 41.0))), cov);
    }
  }
  // snow: never paper white. Cold blue in the wind-scoured hollows, a faint warm crust on the
  // ridges, and a sparkle of ice grains that catch the light one by one up close
  if (wSnow > 0.01) {
    vec3 drift = tNoised(vec2(vWuv.x / 9.0, vWuv.y / 2.6), 512.0);
    float hol = smoothstep(0.35, 0.75, drift.x);
    vec3 snowCol = alb * mix(vec3(1.0, 0.99, 0.97), vec3(0.8, 0.86, 0.97), hol * 0.75) * 0.82;
    alb = mix(alb, snowCol, wSnow);
    vec2 sc = floor(vWuv * 34.0);
    float glint = step(0.986, tHash(mod(sc, 4096.0) + vec2(3.0, 91.0))) * wSnow * (1.0 - smoothstep(6.0, 28.0, vViewDist));
    gRough = mix(gRough, 0.06, glint);
    alb = mix(alb, vec3(1.0), glint * 0.25);
  }
  // wetness darkens porous ground (not snow or salt)
  alb *= mix(1.0, 0.62, uWet * (1.0 - wSalt * 0.6) * (1.0 - wSnow));
  diffuseColor.rgb = alb;
  float nFar = 1.0 - farT * 0.6;
  gNrmT = normalize(nt);
  gNrmT.xy *= nFar;
  gRough = mix(gRough, 0.35, uWet * 0.8 * (1.0 - wSnow));
}`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = gRough;`
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
#ifdef USE_FOG
gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, smoothstep(uFadeFar * 0.7, uFadeFar * 0.97, vViewDist));
#endif`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 N = normalize(vWN);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = normalize(cross(T, N));
  vec3 nw = normalize(T * gNrmT.x + B * gNrmT.y + N * max(gNrmT.z, 0.2));
  nw = normalize(mix(N, nw, 1.0 - smoothstep(60.0, 200.0, vViewDist) * 0.7));
  // relief the mesh is too coarse to carry far away: spurs and gullies on the mountains, gentle
  // rolls on the plains
  {
    vec3 m1 = tNoised(vWuv / 32.0, 64.0);
    vec3 m2 = tNoised(vWuv / 128.0, 16.0);
    vec3 m3 = tNoised(vWuv / 8.0, 256.0);
    float far = smoothstep(40.0, 700.0, vViewDist);
    float rough = 0.25 + 0.75 * gRockW;
    vec2 g = (m1.yz / 32.0 * 3.5 + m2.yz / 128.0 * 14.0) * rough * (0.35 + 0.65 * far) + m3.yz / 8.0 * 0.5 * rough * (1.0 - far);
    // sastrugi: snow ridges combed out by the wind, long across x, short across z
    if (gSnowW > 0.01) {
      vec3 sd = tNoised(vec2(vWuv.x / 9.0, vWuv.y / 2.6), 512.0);
      vec3 sd2 = tNoised(vec2(vWuv.x / 2.2, vWuv.y / 0.7), 2048.0);
      vec2 gs = vec2(sd.y / 9.0, sd.z / 2.6) * 1.1 + vec2(sd2.y / 2.2, sd2.z / 0.7) * 0.06;
      g += gs * gSnowW * (1.0 - smoothstep(30.0, 160.0, vViewDist));
      // each ice grain faces its own way: glints come and go as you move
      vec2 sc = floor(vWuv * 34.0);
      float h = tHash(mod(sc, 4096.0) + vec2(3.0, 91.0));
      if (h > 0.986) g += (vec2(tHash(sc + 7.0), tHash(sc + 19.0)) - 0.5) * 1.6 * gSnowW;
    }
    nw = normalize(nw - vec3(g.x, 0.0, g.y) + N * dot(vec3(g.x, 0.0, g.y), N));
  }
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}`
      );
  };
  mat.customProgramCacheKey = () => 'terrain-v7';
  return mat;
}

// Road surface: asphalt / gravel from the array plus lane markings, wear, cracks and patches.
// Geometry uv: u across (0 left shoulder edge .. 1 right edge), v along (metres). Attribute 'road'
// carries [wear, dirt(0/1), widthTotal, markings].
export function createRoadMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  mat.userData.uniforms = { uAlb: { value: tex.albedo }, uNrm: { value: tex.normal }, uWet: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 road;
attribute vec2 env;
varying vec4 vRoad;
varying vec2 vEnv;
varying vec2 vRuv;
varying vec3 vWN;
varying float vViewDist;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vRoad = road;
vEnv = env;
vRuv = uv;
vWN = normalize(mat3(modelMatrix) * normal);`
      )
      .replace('#include <project_vertex>', `#include <project_vertex>\nvViewDist = -mvPosition.z;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uAlb;
uniform sampler2DArray uNrm;
uniform float uWet;
varying vec4 vRoad;
varying vec2 vEnv;
varying vec2 vRuv;
varying vec3 vWN;
varying float vViewDist;
vec3 rNrmT;
float rRough;
float rHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rNoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(rHash(i), rHash(i+vec2(1,0)), f.x), mix(rHash(i+vec2(0,1)), rHash(i+vec2(1,1)), f.x), f.y); }
float rFbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*rNoise(p); p*=2.03; a*=0.5;} return s; }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float W = vRoad.z;           // total width incl. shoulders (m)
  float wear = vRoad.x;
  float isDirt = vRoad.y;
  float across = (vRuv.x - 0.5) * W; // metres from centre
  float along = vRuv.y;
  float halfRoad = ${(3.6).toFixed(2)};
  float onRoad = 1.0 - smoothstep(halfRoad - 0.05, halfRoad + 0.15, abs(across));
  vec2 wuv = vec2(across, along) * 0.35;
  vec4 asph = texture(uAlb, vec3(wuv, 5.0));
  vec4 grav = texture(uAlb, vec3(wuv * 2.6, 4.0));
  vec4 sand = texture(uAlb, vec3(wuv * 0.5, 0.0));
  // dirt road: gravel with sandy wheel tracks
  float tracks = smoothstep(0.5, 0.0, abs(abs(across) - 1.8));
  vec3 dirtRoad = mix(grav.rgb, sand.rgb * 0.9, 0.35 + 0.4 * tracks);
  vec3 col = mix(asph.rgb, dirtRoad, isDirt);
  // patches and wear
  float pn = rFbm(vec2(across * 0.25, along * 0.06));
  float patchM = smoothstep(0.62, 0.64, pn) * wear * (1.0 - isDirt);
  col = mix(col, col * 0.62, patchM);
  col = mix(col, col * 1.25 + 0.05, wear * 0.35 * (1.0 - isDirt) * smoothstep(0.3, 0.7, rFbm(vec2(across, along) * 0.15)));
  // wheel-path polish/darkening
  float wp = smoothstep(0.6, 0.0, abs(abs(across) - 1.85)) * (1.0 - isDirt);
  col *= 1.0 - 0.12 * wp;
  // cracks: thin dark lines from warped noise iso-contours
  float cn = rFbm(vec2(across * 0.6, along * 0.25) + rFbm(vec2(along * 0.05, across)) * 2.0);
  float crack = 1.0 - smoothstep(0.0, 0.025 + 0.02 * wear, abs(cn - 0.5));
  crack *= smoothstep(0.35, 0.8, wear + rNoise(vec2(along * 0.02, 3.0)) * 0.4) * (1.0 - isDirt);
  col = mix(col, vec3(0.05), crack * 0.8 * onRoad);
  // markings: dashed centre line (amber), solid edge lines (white), faded by wear
  float marks = vRoad.w * (1.0 - isDirt);
  float fade = 1.0 - wear * 0.6 * smoothstep(0.3, 0.7, rNoise(vec2(along * 0.4, across * 2.0)));
  float dash = step(fract(along / 12.0), 0.42);
  float centre = (1.0 - smoothstep(0.05, 0.075, abs(abs(across) - 0.0) - 0.0)) * dash;
  float edgeL = 1.0 - smoothstep(0.06, 0.085, abs(abs(across) - (halfRoad - 0.25)));
  vec3 amber = vec3(0.86, 0.66, 0.2);
  vec3 white = vec3(0.86, 0.86, 0.82);
  col = mix(col, amber, centre * marks * fade * 0.95);
  col = mix(col, white, edgeL * marks * fade * 0.9);
  // shoulders: gravel blending into the surrounding sand
  float sh = smoothstep(halfRoad, halfRoad + 0.3, abs(across));
  vec3 shoulder = mix(grav.rgb, grav.rgb * 0.8 + sand.rgb * 0.35, smoothstep(halfRoad + 0.5, W * 0.5, abs(across)));
  col = mix(col, shoulder, sh);
  // winter: packed snow over the lanes with darker wheel tracks, banks of snow on the shoulders
  float snow = vEnv.x;
  float bridge = vEnv.y;
  if (snow > 0.01) {
    vec4 sn = texture(uAlb, vec3(wuv * 0.45, 7.0));
    float tracksS = smoothstep(0.55, 0.15, abs(abs(across) - 1.85));
    float cover = snow * clamp(0.95 - tracksS * 0.55 + (rFbm(vec2(across * 0.7, along * 0.12)) - 0.5) * 0.6, 0.0, 1.0);
    cover = max(cover, snow * sh);
    vec3 packedS = mix(sn.rgb, sn.rgb * vec3(0.78, 0.8, 0.84), tracksS * 0.6);
    col = mix(col, packedS, clamp(cover, 0.0, 1.0));
  }
  // bridge deck: concrete with expansion joints
  if (bridge > 0.5) {
    float joint = 1.0 - smoothstep(0.04, 0.08, abs(fract(along / 9.0) - 0.5) * 9.0 - 4.4);
    col = mix(col, col * 0.55, joint * onRoad);
  }
  col *= mix(1.0, 0.58, uWet * (1.0 - snow * 0.5));
  diffuseColor.rgb = col;
  vec3 na = texture(uNrm, vec3(wuv, 5.0)).xyz * 2.0 - 1.0;
  vec3 ng = texture(uNrm, vec3(wuv * 2.6, 4.0)).xyz * 2.0 - 1.0;
  // fine aggregate: only a hint of relief, or grazing headlights turn it into cobbles
  na.xy *= 0.35;
  ng.xy *= 0.6;
  rNrmT = normalize(mix(mix(na, ng, isDirt), ng, sh));
  rRough = mix(mix(0.88, 0.95, isDirt), 0.95, sh);
  rRough = mix(rRough, 0.12, uWet * onRoad * (1.0 - isDirt) * 0.9);
  rRough = mix(rRough, 0.6, (centre + edgeL) * marks);
}`
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = rRough;`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 N = normalize(vWN);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = normalize(cross(T, N));
  vec3 nw = normalize(T * rNrmT.x + B * rNrmT.y + N * max(rNrmT.z, 0.3));
  nw = normalize(mix(N, nw, 1.0 - smoothstep(30.0, 120.0, vViewDist) * 0.8));
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}`
      );
  };
  mat.customProgramCacheKey = () => 'road-v3';
  return mat;
}
