// Procedural weathering for car (and wreck) materials: dust, dirt, rust, sun fade and wetness,
// injected into MeshStandard/Physical shaders. Positions and normals in object space.

import * as THREE from 'three';
import { NOISE_GLSL } from '../gfx/glsl.js';

// Where a car has been washed (R) and brushed back to bare metal or paint (G): a coarse grid over
// its box in its own space, filled in by the sponge and the wire brush (Car.scrub). Until a car is
// first scrubbed its materials look at this empty one (every weathered shader samples the grid, so
// each must have one bound).
const NO_CLEAN = new THREE.Data3DTexture(new Uint8Array(2), 1, 1, 1);
NO_CLEAN.format = THREE.RGFormat;
NO_CLEAN.needsUpdate = true;

export function weatheringUniforms(opts = {}) {
  return {
    uDirt: { value: opts.dirt ?? 0.3 },
    uDust: { value: opts.dust ?? 0.18 },
    uRust: { value: opts.rust ?? 0.0 },
    uFade: { value: opts.fade ?? 0.2 },
    uWet: { value: 0 },
    uClean: { value: NO_CLEAN },
    uCleanMin: { value: new THREE.Vector3() },
    uCleanInv: { value: new THREE.Vector3(1, 1, 1) },
  };
}
const CLEAN_DEFAULTS = { uClean: { value: NO_CLEAN }, uCleanMin: { value: new THREE.Vector3() }, uCleanInv: { value: new THREE.Vector3(1, 1, 1) } };

// Injects weathering into a MeshStandard/Physical material. Positions/normals in object space.
export function applyWeathering(mat, uniforms, { rustColor = true, strength = 1 } = {}) {
  const own = (k) => Object.prototype.hasOwnProperty.call(mat, k);
  const prev = own('onBeforeCompile') ? mat.onBeforeCompile : null;
  const prevKey = own('customProgramCacheKey') ? mat.customProgramCacheKey : null;
  mat.userData.weathered = true;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, CLEAN_DEFAULTS, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vObjPos;
varying vec3 vObjN;
uniform float uDirt; uniform float uDust; uniform float uRust; uniform float uFade; uniform float uWet;
uniform highp sampler3D uClean; uniform vec3 uCleanMin; uniform vec3 uCleanInv;
float wDirtMask; float wDustMask; float wRustMask;
${NOISE_GLSL}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 op = vObjPos;
  vec3 on = normalize(vObjN);
  float grime = smoothstep(0.66, 0.2, op.y);
  float n1 = fbm3(op * 3.1);
  float n2 = fbm3(op * 19.0 + 3.0);
  float n3 = vnoise(op * vec3(1.5, 28.0, 1.5));
  wDirtMask = clamp(grime * (0.35 + 0.8 * n1) * (0.9 + 0.2 * n3) * uDirt * ${strength.toFixed(2)}, 0.0, 1.0);
  float up = smoothstep(0.3, 0.95, on.y);
  wDustMask = clamp(smoothstep(0.25, 0.85, up * (0.45 + 0.7 * n1)) * uDust * ${strength.toFixed(2)}, 0.0, 1.0);
  float rn = fbm3(op * 4.7 + 11.0) + 0.22 * grime + 0.18 * n2;
  wRustMask = uRust > 0.001 ? smoothstep(0.74 - uRust * 0.3, 0.79 - uRust * 0.3, rn) : 0.0;
  // washed and brushed patches
  // (a few rubs read as clean, with a soft edge round the patch)
  vec2 cl = smoothstep(0.04, 0.6, texture(uClean, clamp((op - uCleanMin) * uCleanInv, 0.0, 1.0)).rg);
  wDirtMask *= 1.0 - cl.r;
  wDustMask *= 1.0 - cl.r;
  wRustMask *= 1.0 - cl.g;
  vec3 rustC = mix(vec3(0.24, 0.1, 0.045), vec3(0.52, 0.25, 0.1), n2);
  vec3 dirtC = mix(vec3(0.3, 0.24, 0.17), vec3(0.45, 0.37, 0.27), n1);
  vec3 dustC = vec3(0.70, 0.60, 0.47);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.82 + vec3(0.1, 0.09, 0.08), uFade * up);
  ${rustColor ? 'diffuseColor.rgb = mix(diffuseColor.rgb, rustC, wRustMask);' : ''}
  diffuseColor.rgb = mix(diffuseColor.rgb, dirtC, wDirtMask * 0.85);
  diffuseColor.rgb = mix(diffuseColor.rgb, dustC, wDustMask * 0.75);
  diffuseColor.rgb *= mix(1.0, 0.72, uWet * (1.0 - wRustMask));
}`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.95, max(wRustMask, max(wDirtMask, wDustMask) * 0.85));
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, uWet);`
      );
    if (shader.fragmentShader.includes('#include <lights_physical_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
material.clearcoat *= (1.0 - max(wRustMask, max(wDirtMask * 0.8, wDustMask * 0.7)));
#endif`
      );
    }
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + 'weather' + (rustColor ? 1 : 0) + strength;
  return mat;
}

