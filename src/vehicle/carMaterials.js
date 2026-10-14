// Material set for the sedan, including procedural weathering (dirt, dust, rust, sun fade, wetness).

import * as THREE from 'three';
import { NOISE_GLSL } from '../gfx/glsl.js';
import { SLOT } from './body/carBody.js';

export function weatheringUniforms(opts = {}) {
  return {
    uDirt: { value: opts.dirt ?? 0.3 },
    uDust: { value: opts.dust ?? 0.18 },
    uRust: { value: opts.rust ?? 0.0 },
    uFade: { value: opts.fade ?? 0.2 },
    uWet: { value: 0 },
  };
}

// Injects weathering into a MeshStandard/Physical material. Positions/normals in object space.
export function applyWeathering(mat, uniforms, { rustColor = true, strength = 1 } = {}) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
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
  mat.customProgramCacheKey = () => 'weather' + (rustColor ? 1 : 0) + strength;
  return mat;
}

function glassMaterial(fritWidth = 0.05, tint = new THREE.Color(0.08, 0.1, 0.11)) {
  const m = new THREE.MeshPhysicalMaterial({
    color: tint,
    metalness: 0,
    roughness: 0.04,
    transparent: true,
    opacity: 0.32,
    envMapIntensity: 1.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float edge;\nvarying float vEdge;\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = edge;\nvObjPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEdge;\nvarying vec3 vObjPos;\nfloat gFrit;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float w = ${fritWidth.toFixed(3)};
  float fw = max(fwidth(vEdge), 1e-5);
  float solid = 1.0 - smoothstep(w * 0.62 - fw, w * 0.62 + fw, vEdge);
  float fade = (1.0 - smoothstep(w * 0.62, w, vEdge)) * 0.35;
  gFrit = max(solid, fade);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012), gFrit);
  diffuseColor.a = mix(diffuseColor.a, 1.0, gFrit);
}`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, gFrit);'
      );
  };
  m.customProgramCacheKey = () => 'glass' + fritWidth;
  return m;
}

export function createCarMaterials(opts = {}) {
  const color = new THREE.Color(opts.color ?? 0xb4532a);
  const weather = weatheringUniforms(opts.weather);
  const paint = applyWeathering(
    new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.15,
      roughness: 0.42,
      clearcoat: 0.75,
      clearcoatRoughness: 0.12,
    }),
    weather
  );
  const inner = applyWeathering(
    new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8), metalness: 0.1, roughness: 0.6 }),
    weather,
    { strength: 0.6 }
  );
  const trim = applyWeathering(new THREE.MeshStandardMaterial({ color: 0x141515, roughness: 0.62, metalness: 0 }), weather, {
    rustColor: false,
    strength: 0.7,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dadc, metalness: 1, roughness: 0.14 });
  const interior = new THREE.MeshStandardMaterial({ color: 0x45443f, roughness: 0.8, metalness: 0 });
  const headliner = new THREE.MeshStandardMaterial({ color: 0xb3ada2, roughness: 0.96 });
  const carpet = new THREE.MeshStandardMaterial({ color: 0x2c2a28, roughness: 1 });
  const trunk = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 1 });
  const under = applyWeathering(new THREE.MeshStandardMaterial({ color: 0x1a1918, roughness: 0.92 }), weather, {
    rustColor: false,
    strength: 1.2,
  });
  const glass = glassMaterial(0.055);
  const lens = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.03,
    transparent: true,
    opacity: 0.18,
    envMapIntensity: 1.6,
    depthWrite: false,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.88 });
  const lampHousing = new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.5, metalness: 0.3 });
  const primer = new THREE.MeshStandardMaterial({ color: 0x55585a, roughness: 0.8 });
  const lensRed = new THREE.MeshPhysicalMaterial({
    color: 0x7a0a08,
    metalness: 0,
    roughness: 0.05,
    transparent: true,
    opacity: 0.82,
    envMapIntensity: 1.3,
    emissive: 0xff1a0a,
    emissiveIntensity: 0,
    depthWrite: false,
  });
  const lensAmber = new THREE.MeshPhysicalMaterial({
    color: 0xd98a1c,
    metalness: 0,
    roughness: 0.06,
    transparent: true,
    opacity: 0.55,
    envMapIntensity: 1.3,
    emissive: 0xffa020,
    emissiveIntensity: 0,
    depthWrite: false,
  });
  lampHousing.color.set(0x55585c);
  lampHousing.metalness = 0.9;
  lampHousing.roughness = 0.3;
  const slots = [];
  slots[SLOT.paint] = paint;
  slots[SLOT.inner] = inner;
  slots[SLOT.trim] = trim;
  slots[SLOT.chrome] = chrome;
  slots[SLOT.interior] = interior;
  slots[SLOT.headliner] = headliner;
  slots[SLOT.carpet] = carpet;
  slots[SLOT.trunk] = trunk;
  slots[SLOT.under] = under;
  slots[SLOT.glass] = glass;
  slots[SLOT.lens] = lens;
  slots[SLOT.rubber] = rubber;
  slots[SLOT.lampHousing] = lampHousing;
  slots[SLOT.primer] = primer;
  slots[SLOT.lensRed] = lensRed;
  slots[SLOT.lensAmber] = lensAmber;
  const extra = {
    lampChrome: new THREE.MeshStandardMaterial({ color: 0xe6e8ea, metalness: 1, roughness: 0.08 }),
    amberChrome: new THREE.MeshStandardMaterial({ color: 0xe0962a, metalness: 1, roughness: 0.15 }),
    redChrome: new THREE.MeshStandardMaterial({ color: 0xa82015, metalness: 0.9, roughness: 0.2, emissive: 0xff2010, emissiveIntensity: 0 }),
    projector: new THREE.MeshPhysicalMaterial({
      color: 0xdfe8f0,
      metalness: 0,
      roughness: 0.02,
      transmission: 0,
      envMapIntensity: 2,
      emissive: 0xfff4e0,
      emissiveIntensity: 0,
    }),
    bulb: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 0, roughness: 0.2 }),
    drl: new THREE.MeshStandardMaterial({ color: 0x8d9296, emissive: 0xeef4ff, emissiveIntensity: 0, roughness: 0.55 }),
    indicator: new THREE.MeshStandardMaterial({ color: 0xc87818, emissive: 0xffa020, emissiveIntensity: 0, roughness: 0.3 }),
    blackGloss: new THREE.MeshPhysicalMaterial({ color: 0x08090a, roughness: 0.18, metalness: 0, clearcoat: 0.6 }),
    blackMatte: new THREE.MeshStandardMaterial({ color: 0x111213, roughness: 0.75 }),
    mirrorGlass: new THREE.MeshStandardMaterial({ color: 0xbfc6cc, metalness: 1, roughness: 0.02, envMapIntensity: 1.5 }),
    seal: rubber,
  };
  return { slots, weather, paint, color, ...extra, lensRed, lensAmber, chrome, rubber, trim, interior, glass, inner, under, carpet, headliner };
}
