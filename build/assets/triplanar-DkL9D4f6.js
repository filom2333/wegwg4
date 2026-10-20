import{o as e}from"./geom-DFPPJBxJ.js";var t={grain:{f:260,src:`float pat(vec3 p){ return vnoise(p*260.0)*0.6 + vnoise(p*110.0)*0.4; }`},weave:{f:420,src:`float pat(vec3 p){ vec3 q = p*420.0*6.2831; return 0.5+0.25*(sin(q.x)*sin(q.y+q.z)) + 0.25*vnoise(p*160.0); }`},carpet:{f:500,src:`float pat(vec3 p){ return vnoise(p*500.0)*0.6 + vnoise(p*140.0)*0.4; }`},cast:{f:90,src:`float pat(vec3 p){ return vnoise(p*90.0)*0.5 + vnoise(p*30.0)*0.5; }`},brushed:{f:1200,src:`float pat(vec3 p){ return vnoise(vec3(p.x*1200.0, p.y*20.0, p.z*20.0)); }`}};function n(n,r=`grain`,i=.35,{tint:a=0}={}){let o=n.onBeforeCompile;n.onBeforeCompile=(n,s)=>{o&&o(n,s),n.vertexShader.includes(`varying vec3 vDetPos;`)||(n.vertexShader=n.vertexShader.replace(`#include <common>`,`#include <common>
varying vec3 vDetPos;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
vDetPos = position;`));let c=n.fragmentShader.includes(`float vnoise(vec3 x)`)?``:e;n.fragmentShader=n.fragmentShader.replace(`#include <common>`,`#include <common>\nvarying vec3 vDetPos;\n${c}\n${t[r].src}`).replace(`#include <normal_fragment_maps>`,`#include <normal_fragment_maps>
{
  // Screen-space derivative bump mapping of the object-space pattern.
  float h = pat(vDetPos);
  // fade when a pattern cell gets smaller than ~2 pixels
  float cellsPerPixel = length(fwidth(vDetPos)) * ${t[r].f.toFixed(1)};
  float lod = 1.0 - smoothstep(0.06, 0.22, cellsPerPixel);
  vec2 dHdxy = vec2(dFdx(h), dFdy(h)) * ${(i*.002).toFixed(5)} * lod;
  vec3 vSigmaX = dFdx(-vViewPosition);
  vec3 vSigmaY = dFdy(-vViewPosition);
  vec3 vN = normal;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  fDet *= (float(gl_FrontFacing) * 2.0 - 1.0);
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  normal = normalize(abs(fDet) * vN - vGrad);
  ${a>0?`diffuseColor.rgb *= 1.0 - ${a.toFixed(3)} * (h - 0.5) * lod;`:``}
}`)};let s=n.customProgramCacheKey?n.customProgramCacheKey():``;return n.customProgramCacheKey=()=>s+`|det`+r+i+a,n.needsUpdate=!0,n}export{n as t};