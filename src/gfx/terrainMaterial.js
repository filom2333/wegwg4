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
attribute vec3 tint;
varying vec4 vMat;
varying vec4 vMat2;
varying vec3 vTint;
varying vec2 vWuv;
varying vec3 vWN;
varying float vViewDist;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vMat = mat;
vMat2 = matB;
vTint = tint;
vWuv = uv;
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
varying vec2 vWuv;
varying vec3 vWN;
varying float vViewDist;
vec3 gNrmT;
float gRough;

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
  float wt[7];
  wt[0] = vMat.x; wt[1] = vMat.y; wt[2] = vMat.z; wt[3] = vMat.w;
  wt[4] = vMat2.x; wt[5] = vMat2.y; wt[6] = vMat2.z;
  // texture-array layer, near and far tiling per ground type:
  // sand, dirt, rock, salt, grass, snow, forest floor
  const float LIDX[7] = float[7](0.0, 1.0, 2.0, 3.0, 6.0, 7.0, 8.0);
  const float SN[7] = float[7](1.0, 0.8, 0.6, 0.5, 0.9, 0.42, 0.85);
  const float SF[7] = float[7](1.0, 1.0, 0.8, 1.0, 1.0, 0.7, 1.0);
  const float RO[7] = float[7](0.96, 0.93, 0.82, 0.78, 0.9, 0.62, 0.93);
  vec4 smp[7];
  float w[7];
  float tot = 0.0;
  for (int i = 0; i < 7; i++) {
    smp[i] = vec4(0.0);
    w[i] = 0.0;
    if (wt[i] > 0.004) {
      vec4 a = textureGrad(uAlb, vec3(uvN * SN[i], LIDX[i]), dxN * SN[i], dyN * SN[i]);
      vec4 b = textureGrad(uAlb, vec3(uvF * SF[i], LIDX[i]), dxF * SF[i], dyF * SF[i]);
      smp[i] = mix(a, b, farT);
      // height-based blending: the taller texture wins at transitions
      w[i] = pow(wt[i] * smp[i].a + wt[i] * 0.001 + 0.08, 6.0);
      tot += w[i];
    }
  }
  vec3 alb = vec3(0.0);
  vec3 nt = vec3(0.0);
  gRough = 0.0;
  for (int i = 0; i < 7; i++) {
    if (w[i] <= 0.0) continue;
    float k = w[i] / tot;
    alb += smp[i].rgb * k;
    vec3 na = textureGrad(uNrm, vec3(uvN * SN[i], LIDX[i]), dxN * SN[i], dyN * SN[i]).xyz * 2.0 - 1.0;
    vec3 nb = textureGrad(uNrm, vec3(uvF * SF[i], LIDX[i]), dxF * SF[i], dyF * SF[i]).xyz * 2.0 - 1.0;
    nt += normalize(mix(na, nb, farT)) * k;
    gRough += RO[i] * k;
  }
  float wSand = w[0] / tot, wDirt = w[1] / tot, wRock = w[2] / tot, wSalt = w[3] / tot, wSnow = w[5] / tot;
  // biome tint (normalised) mostly on dirt and rock
  float lum = max(dot(vTint, vec3(0.333)), 0.01);
  vec3 tintN = vTint / lum;
  alb *= mix(vec3(1.0), tintN, (0.55 * (wDirt + wRock) + 0.25 * wSand) * (1.0 - wSnow));
  // macro brightness variation
  float macro = texture(uAlb, vec3(vWuv * 0.0021 + 0.5, 1.0)).a;
  float macro2 = texture(uAlb, vec3(vWuv * 0.0007, 0.0)).a;
  alb *= mix(0.82 + 0.3 * macro + 0.12 * (macro2 - 0.5), 0.95 + 0.08 * macro, wSnow);
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
gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(uFadeFar * 0.7, uFadeFar * 0.97, vViewDist));
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
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}`
      );
  };
  mat.customProgramCacheKey = () => 'terrain-v3';
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
  mat.customProgramCacheKey = () => 'road-v2';
  return mat;
}
