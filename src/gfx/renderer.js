// Renderer, camera and post-processing chain with quality presets.

import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SelectionOutlinePass } from './outline.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import './fogSun.js';
import { RENDER_CAPS } from './caps.js';

// maxPixels caps the internal resolution: a 4K or retina panel at full device resolution costs
// four times the shading of 1080p for little visible gain at the post-processed output.
export const QUALITY = {
  low: { pixelRatio: 0.75, maxPixels: 1.0e6, shadow: 1024, shadowExtent: 35, bloom: false, aa: true, msaa: 0, sharpen: 0.25, shafts: false, view: 1800 },
  medium: { pixelRatio: 1, maxPixels: 2.1e6, shadow: 2048, shadowExtent: 45, bloom: true, aa: true, msaa: 0, sharpen: 0.3, shafts: true, view: 2600 },
  high: { pixelRatio: 1, maxPixels: 3.7e6, shadow: 2048, shadowExtent: 55, bloom: true, aa: false, msaa: 4, sharpen: 0.32, shafts: true, view: 3200 },
  ultra: { pixelRatio: 1.5, maxPixels: 6.0e6, shadow: 4096, shadowExtent: 65, bloom: true, aa: false, msaa: 4, sharpen: 0.25, shafts: true, view: 3200 },
};

// Final grade, after tone mapping: light sharpening, sun shafts and lens glare from the scene
// depth, a film-like curve and split toning, vignette and grain.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    uAspect: { value: 16 / 9 },
    uSharpen: { value: 0.3 },
    uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVis: { value: 0 },
    uSunCol: { value: new THREE.Color(1, 0.9, 0.7) },
    uShafts: { value: 1 },
    uTime: { value: 0 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.02 },
    uDamage: { value: 0 },
    uGrit: { value: 0 },
    uFilm: { value: 0 },
    uBars: { value: 0 },
    uFade: { value: 0 },
    uWarm: { value: 0 },
    uNight: { value: 0 },
    uOvercast: { value: 0 },
    uHeat: { value: 0 },
    uNear: { value: 0.1 },
    uRevZ: { value: 0 },
    uFar: { value: 10000 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uAspect; uniform float uSharpen;
    uniform vec2 uSunUv; uniform float uSunVis; uniform vec3 uSunCol; uniform float uShafts;
    uniform float uTime; uniform float uVignette; uniform float uGrain; uniform float uDamage; uniform float uFade; uniform float uGrit; uniform float uFilm; uniform float uBars;
    uniform float uWarm; uniform float uNight; uniform float uOvercast;
    uniform float uHeat; uniform float uNear; uniform float uFar; uniform float uRevZ;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 7.13) * 43758.5453); }
    // open sky (nothing drawn in front of the cleared far plane)
    // scene depth as the usual 0 (near) .. 1 (far), whichever way the buffer runs
    float depthAt(vec2 uv){ float d = texture2D(tDepth, uv).r; return uRevZ > 0.5 ? 1.0 - d : d; }
    float sky(vec2 uv){ return step(0.999999, depthAt(clamp(uv, 0.001, 0.999))); }
    void main(){
      // heat shimmer: on a hot clear day the air over the ground wobbles from ~100 m out to the
      // horizon (where the far road turns to a mirage of the sky)
      vec2 uv = vUv;
      if (uHeat > 0.001) {
        float dz = depthAt(vUv);
        float z = uNear * uFar / (uFar - dz * (uFar - uNear));
        float band = smoothstep(90.0, 320.0, z) * (1.0 - smoothstep(2600.0, 5200.0, z)) * step(dz, 0.999999);
        float wob = sin(vUv.y * 950.0 - uTime * 7.0 + sin(vUv.x * 55.0 + uTime * 1.3) * 3.0) * 0.55 + sin(vUv.y * 1830.0 - uTime * 11.0 + vUv.x * 37.0) * 0.45;
        uv += vec2(0.0004, 0.0007) * wob * band * uHeat;
      }
      vec4 c = texture2D(tDiffuse, uv);
      // contrast-adaptive sharpening: a cross of neighbours, limited where the contrast is already high
      vec3 n = texture2D(tDiffuse, uv + vec2(0.0, uTexel.y)).rgb, s = texture2D(tDiffuse, uv - vec2(0.0, uTexel.y)).rgb;
      vec3 e = texture2D(tDiffuse, uv + vec2(uTexel.x, 0.0)).rgb, w = texture2D(tDiffuse, uv - vec2(uTexel.x, 0.0)).rgb;
      vec3 mn = min(c.rgb, min(min(n, s), min(e, w))), mx = max(c.rgb, max(max(n, s), max(e, w)));
      vec3 amt = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-3), 0.0, 1.0)) * uSharpen;
      vec3 col = clamp(c.rgb + (4.0 * c.rgb - n - s - e - w) * amt * 0.25, 0.0, 1.0);
      // the sun: shafts through gaps in trees and buildings, a soft glare and lens ghosts
      if (uSunVis > 0.001) {
        vec2 toSun = uSunUv - vUv;
        vec2 ta = vec2(toSun.x * uAspect, toSun.y);
        float dist = length(ta);
        float vis = 0.0;
        for (int i = 0; i < 5; i++) { float a = float(i) * 1.2566; vis += sky(uSunUv + vec2(cos(a), sin(a)) * 0.006 * vec2(1.0 / uAspect, 1.0)); }
        vis = vis / 5.0 * uSunVis;
        if (uShafts > 0.5) {
          float acc = 0.0, wsum = 0.0;
          float jit = h(vUv * 731.0) * 0.06;
          for (int i = 0; i < 14; i++) {
            float t = (float(i) + jit * 14.0) / 14.0;
            float wt = 1.0 - t * 0.6;
            acc += sky(vUv + toSun * t * 0.85) * wt;
            wsum += wt;
          }
          float shaft = acc / wsum;
          // only where the light is broken up (not plain sky, not plain shade)
          float here = sky(vUv);
          col += uSunCol * shaft * (1.0 - here * 0.85) * exp(-dist * 2.6) * uSunVis * (0.16 + 0.22 * uWarm);
        }
        // glare: core, halo, a faint horizontal streak
        float glare = exp(-dist * 9.0) * 0.55 + exp(-dist * 2.8) * 0.12 + exp(-abs(ta.y) * 140.0) * exp(-abs(ta.x) * 3.0) * 0.09;
        col += uSunCol * glare * vis;
        // ghosts along the line through the centre of the frame
        vec2 axis = vec2(0.5) - uSunUv;
        for (int i = 0; i < 4; i++) {
          float k = 0.45 + float(i) * 0.38;
          vec2 g = uSunUv + axis * k * 2.0;
          float r = 0.025 + float(i) * 0.018;
          float d = length(vec2((vUv.x - g.x) * uAspect, vUv.y - g.y));
          float ring = smoothstep(r, r * 0.7, d) * (0.25 + 0.75 * smoothstep(r * 0.4, r, d));
          col += uSunCol * vec3(0.6 + 0.2 * float(i), 0.75, 1.0 - 0.15 * float(i)) * ring * 0.035 * vis;
        }
      }
      // film-like grade (display-referred): gentle S-curve, saturation, split toning
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float sat = 1.18 - 0.1 * uOvercast - 0.12 * uNight;
      col = mix(vec3(lum), col, sat);
      col = clamp(col, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.32);
      // shadows lean teal, highlights lean warm; golden hour pushes amber
      float sh = 1.0 - smoothstep(0.0, 0.45, lum);
      float hi = smoothstep(0.45, 1.0, lum);
      col += vec3(-0.012, 0.004, 0.018) * sh * (1.0 - uNight);
      col += vec3(0.022, 0.008, -0.016) * hi * (1.0 + uWarm * 1.5);
      col *= mix(vec3(1.0), vec3(1.06, 0.98, 0.9), uWarm * 0.6);
      // moonlight: cool blue night
      col *= mix(vec3(1.0), vec3(0.86, 0.95, 1.12), uNight);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * uVignette * 2.2;
      col *= v;
      col += (h(vUv * 1000.0) - 0.5) * uGrain;
      // damage: desaturate and redden the edges
      float l2 = dot(col, vec3(0.299, 0.587, 0.114));
      float edge = smoothstep(0.25, 0.75, length(d) * 1.6);
      col = mix(col, vec3(l2) * vec3(1.0, 0.75, 0.72), uDamage * 0.5);
      col = mix(col, vec3(0.35, 0.02, 0.01), uDamage * edge * 0.6);
      // sand in the eyes: a dusty tint, edges closing in, gritty speckle
      if (uGrit > 0.0) {
        col = mix(col, col * vec3(1.04, 0.86, 0.66), uGrit * 0.6);
        col *= 1.0 - uGrit * 0.5 * smoothstep(0.2, 0.75, length(d) * 1.5);
        col += (h(vUv * 730.0 + uTime) - 0.5) * 0.08 * uGrit;
      }
      // photo mode looks
      if (uFilm > 0.5) {
        float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
        if (uFilm < 1.5) col = vec3(smoothstep(0.03, 0.97, L));
        else if (uFilm < 2.5) col = vec3(L) * vec3(1.08, 0.93, 0.72) + vec3(0.035, 0.02, 0.0);
        else if (uFilm < 3.5) col = (mix(vec3(L), col, 0.72) * vec3(1.04, 0.98, 0.86)) * 0.86 + vec3(0.075, 0.065, 0.05);
        else if (uFilm < 4.5) col = mix(vec3(L), col, 0.8) * vec3(0.9, 1.0, 1.1) + vec3(0.0, 0.01, 0.025);
        else col = clamp(mix(vec3(L), col, 1.38) * 1.03, 0.0, 1.0);
      }
      if (uBars > 0.0) col *= step(uBars, vUv.y) * step(vUv.y, 1.0 - uBars);
      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(col, c.a);
    }`,
};

// Keeps the scene depth the render pass just wrote, for passes further down the chain.
class DepthCapturePass {
  constructor(target) {
    this.target = target;
    this.enabled = true;
    this.needsSwap = false;
    this.clear = false;
    this.renderToScreen = false;
  }
  setSize() {}
  render(renderer, writeBuffer, readBuffer) {
    this.target.value = readBuffer.depthTexture;
  }
  dispose() {}
}

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    // reversed depth (float, far = 0): an even precision from the near plane to the horizon, so
    // overlapping surfaces far off no longer flicker (24-bit standard depth gave ~10 cm steps at 300 m)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false, reversedDepthBuffer: true });
    this.revZ = !!(this.renderer.state.buffers.depth.getReversed && this.renderer.state.buffers.depth.getReversed());
    // checking every program after linking waits for each compile; release builds let the driver
    // compile in parallel
    this.renderer.debug.checkShaderErrors = !!import.meta.env.DEV;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 7000);
    this.setQuality(quality);
  }

  setQuality(q) {
    this.qualityName = q;
    this.q = QUALITY[q] || QUALITY.high;
    this.applyPixelRatio();
  }

  // Render scale (settings) on top of the preset's pixel ratio.
  setScale(s) {
    this.scale = s;
    this.applyPixelRatio();
  }

  // Device pixel ratio x preset x user render scale x dynamic scale, capped by the preset's
  // pixel budget.
  applyPixelRatio() {
    const w = window.innerWidth,
      h = window.innerHeight;
    let pr = Math.min(window.devicePixelRatio || 1, 2) * this.q.pixelRatio * (this.scale ?? settings.data.resolutionScale ?? 1);
    const budget = this.q.maxPixels || 3e6;
    if (w * h * pr * pr > budget) pr = Math.sqrt(budget / (w * h));
    pr *= this.dynScale ?? 1;
    this.renderer.setPixelRatio(Math.max(0.35, pr));
    this.resize();
  }

  // Dynamic resolution: when frames run long for a second, render a little smaller; when there
  // is headroom for a few seconds, step back up. Changes are rare and in 10 % steps.
  adaptResolution(dt) {
    if (settings.data.dynamicResolution === false) {
      if (this.dynScale !== undefined && this.dynScale !== 1) {
        this.dynScale = 1;
        this.applyPixelRatio();
      }
      return;
    }
    this.dynScale = this.dynScale ?? 1;
    const ms = dt * 1000;
    this._ftAvg = this._ftAvg === undefined ? ms : this._ftAvg + (ms - this._ftAvg) * 0.05;
    this._slow = ms > 21 ? (this._slow || 0) + dt : Math.max(0, (this._slow || 0) - dt * 0.5);
    this._fast = this._ftAvg < 13.5 ? (this._fast || 0) + dt : 0;
    if (this._slow > 1.0 && this.dynScale > 0.75) {
      this.dynScale = Math.max(0.75, this.dynScale * 0.9);
      this._slow = 0;
      this._fast = 0;
      this.applyPixelRatio();
    } else if (this._fast > 4 && this.dynScale < 1) {
      this.dynScale = Math.min(1, this.dynScale / 0.9);
      this._fast = 0;
      this.applyPixelRatio();
    }
  }

  setupComposer(scene) {
    this.scene = scene;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    // multisampled on the higher presets (sharper than a post-process blur); the scene depth is
    // kept as a texture for the selection outline and the sun shafts
    const msaa = r.capabilities.isWebGL2 ? this.q.msaa || 0 : 0;
    RENDER_CAPS.msaa = msaa;
    RENDER_CAPS.aniso = Math.min(16, r.capabilities.getMaxAnisotropy());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: msaa });
    rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
    rt.depthTexture.type = this.revZ ? THREE.FloatType : THREE.UnsignedIntType;
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uRevZ.value = this.revZ ? 1 : 0;
    this.composer.addPass(new DepthCapturePass(this.grade.uniforms.tDepth));
    this.outline = new SelectionOutlinePass(this.camera);
    this.outline.edgeStrength = 2.2;
    this.outline.visibleEdgeColor.set(0xf2e6cf);
    this.outline.enabled = false;
    this.composer.addPass(this.outline);
    // threshold well above sunlit diffuse surfaces (snow, salt and white sand are ~1.5 in the
    // linear HDR buffer): only lamps, the sun's glint and fire bloom
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.4, 0.5, 2.2);
    // the half-float scene buffer tops out at 65504: a sun glint or a hot specular past that is
    // Inf, and one Inf (or a NaN from any shader) blurred through the bloom chain turns into big
    // black blocks across the screen. Clean the input of the bloom and of the tone mapping.
    // (a NaN or an Inf fails the comparison; written to compile as GLSL 1 and 3 alike)
    const SANE = (v) => `if (!(abs(${v}.r + ${v}.g + ${v}.b) < 1e30)) ${v} = vec4(0.0, 0.0, 0.0, 1.0); ${v}.rgb = clamp(${v}.rgb, 0.0, 64.0);`;
    const hp = this.bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv ); ' + SANE('texel'));
    hp.needsUpdate = true;
    this.composer.addPass(this.bloom);
    const out = new OutputPass();
    out.material.fragmentShader = out.material.fragmentShader.replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = texture2D( tDiffuse, vUv ); ' + SANE('gl_FragColor'));
    out.material.needsUpdate = true;
    this.composer.addPass(out);
    // antialiasing before the grade, so the sharpening works on the smoothed edges
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.composer.addPass(this.grade);
    this.applyPassSettings();
    this.resize();
  }

  applyPassSettings() {
    if (!this.composer) return;
    this.bloom.enabled = this.q.bloom && settings.data.bloom !== false;
    this.fxaa.enabled = this.q.aa;
    this.grade.uniforms.uSharpen.value = settings.data.sharpen === false ? 0 : this.q.sharpen ?? 0.3;
    this.grade.uniforms.uShafts.value = this.q.shafts ? 1 : 0;
  }

  resize() {
    const w = window.innerWidth,
      h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      const pr = this.renderer.getPixelRatio();
      this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
      this.grade.uniforms.uTexel.value.set(1 / (w * pr), 1 / (h * pr));
      this.grade.uniforms.uAspect.value = w / h;
    }
  }

  // Heat shimmer strength 0..1 (midday in the desert).
  setHeat(v) {
    if (!this.grade) return;
    const u = this.grade.uniforms;
    u.uHeat.value = v;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
  }

  // Where the sun is on screen and how much of it shows (0 behind the camera, set or overcast).
  setSun(dir, color, strength) {
    if (!this.grade) return;
    const u = this.grade.uniforms;
    const cam = this.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const facing = fwd.dot(dir);
    const p = cam.position.clone().addScaledVector(dir, 1000).project(cam);
    u.uSunUv.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    const onScreen = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(p.x), Math.abs(p.y)), 1.0, 1.6);
    u.uSunVis.value = facing > 0 ? strength * onScreen * THREE.MathUtils.smoothstep(facing, 0.0, 0.25) : 0;
    u.uSunCol.value.copy(color);
  }

  render(dt) {
    if (dt > 0 && dt < 0.25) this.adaptResolution(dt);
    if (this.grade) this.grade.uniforms.uTime.value += dt;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
