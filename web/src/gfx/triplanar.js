// Triplanar detail for materials on generated surfaces without UVs: perturbs normals with a
// procedural grain (leather, fabric weave, carpet pile, cast metal, plaster) in object space.

import { MeshStandardMaterial as THREE_MS } from 'three';
import { NOISE_GLSL } from './glsl.js';

// Each pattern declares its base frequency (cycles per metre) so the bump can fade out before it aliases.
const PATTERNS = {
  grain: { f: 260.0, src: `float pat(vec3 p){ return vnoise(p*260.0)*0.6 + vnoise(p*110.0)*0.4; }` },
  weave: { f: 420.0, src: `float pat(vec3 p){ vec3 q = p*420.0*6.2831; return 0.5+0.25*(sin(q.x)*sin(q.y+q.z)) + 0.25*vnoise(p*160.0); }` },
  carpet: { f: 500.0, src: `float pat(vec3 p){ return vnoise(p*500.0)*0.6 + vnoise(p*140.0)*0.4; }` },
  cast: { f: 90.0, src: `float pat(vec3 p){ return vnoise(p*90.0)*0.5 + vnoise(p*30.0)*0.5; }` },
  brushed: { f: 1200.0, src: `float pat(vec3 p){ return vnoise(vec3(p.x*1200.0, p.y*20.0, p.z*20.0)); }` },
};

/**
 * Adds an object-space bump pattern to a MeshStandard/Physical material.
 * strength ~ normal perturbation magnitude.
 */
export function addSurfaceDetail(mat, kind = 'grain', strength = 0.35, { tint = 0.0 } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    if (!shader.vertexShader.includes('varying vec3 vDetPos;')) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDetPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDetPos = position;');
    }
    const noise = shader.fragmentShader.includes('float vnoise(vec3 x)') ? '' : NOISE_GLSL;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vDetPos;\n${noise}\n${PATTERNS[kind].src}`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // Screen-space derivative bump mapping of the object-space pattern.
  float h = pat(vDetPos);
  // fade when a pattern cell gets smaller than ~2 pixels
  float cellsPerPixel = length(fwidth(vDetPos)) * ${PATTERNS[kind].f.toFixed(1)};
  float lod = 1.0 - smoothstep(0.06, 0.22, cellsPerPixel);
  vec2 dHdxy = vec2(dFdx(h), dFdy(h)) * ${(strength * 0.002).toFixed(5)} * lod;
  vec3 vSigmaX = dFdx(-vViewPosition);
  vec3 vSigmaY = dFdy(-vViewPosition);
  vec3 vN = normal;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  fDet *= (float(gl_FrontFacing) * 2.0 - 1.0);
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  normal = normalize(abs(fDet) * vN - vGrad);
  ${tint > 0 ? `diffuseColor.rgb *= 1.0 - ${tint.toFixed(3)} * (h - 0.5) * lod;` : ''}
}`
      );
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.customProgramCacheKey = () => key + '|det' + kind + strength + tint;
  mat.needsUpdate = true;
  return mat;
}

/**
 * Seat upholstery: smooth, anti-aliased insert panels defined in object space with a stitched
 * seam, woven fabric in the insert and plain fabric elsewhere.
 * region: { kind: 'cushion'|'back', hx, y0, y1, hz }
 */
export function makeUpholstery(base, insertColor, region) {
  const mat = new THREE_MS({ color: base, roughness: 0.92 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeatPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeatPos = position;');
    const isBack = region.kind === 'back';
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSeatPos;
${NOISE_GLSL}
float seatMask;
float seatSeam;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 p = vSeatPos;
  // signed distance (negative inside) to the insert rectangle, in metres
  float dx = abs(p.x) - ${region.hx.toFixed(4)};
  ${
    isBack
      ? `float dy = max(${region.y0.toFixed(4)} - p.y, p.y - ${region.y1.toFixed(4)});
  float face = smoothstep(0.004, -0.01, p.z);`
      : `float dy = abs(p.z) - ${region.hz.toFixed(4)};
  float face = smoothstep(${region.y0.toFixed(4)} - 0.01, ${region.y0.toFixed(4)} + 0.004, p.y);`
  }
  float d = max(dx, dy);
  float aa = max(fwidth(d), 1e-4);
  seatMask = (1.0 - smoothstep(-aa, aa, d)) * face;
  seatSeam = (1.0 - smoothstep(0.0, 0.0018 + aa, abs(d + 0.002))) * face;
  // woven insert with fine ribs running front-to-back / up-down
  float rib = 0.5 + 0.5 * sin(${isBack ? 'p.y' : 'p.z'} * 520.0);
  float fib = vnoise(p * 900.0);
  vec3 ins = vec3(${insertColor.map((v) => v.toFixed(3)).join(',')}) * (0.9 + 0.1 * rib) * (0.92 + 0.16 * fib);
  vec3 side = diffuseColor.rgb * (0.94 + 0.12 * vnoise(p * 700.0));
  diffuseColor.rgb = mix(side, ins, seatMask);
  diffuseColor.rgb *= 1.0 - 0.55 * seatSeam;
}`
      );
  };
  mat.customProgramCacheKey = () => 'uph' + JSON.stringify(region) + insertColor.join(',');
  return mat;
}
