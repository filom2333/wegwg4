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

// maxPixels caps the internal resolution: a 4K or retina panel at full device resolution costs
// four times the shading of 1080p for little visible gain at the post-processed output.
export const QUALITY = {
  low: { pixelRatio: 0.75, maxPixels: 1.0e6, shadow: 1024, shadowExtent: 35, bloom: false, aa: false, view: 1800 },
  medium: { pixelRatio: 1, maxPixels: 2.1e6, shadow: 2048, shadowExtent: 45, bloom: true, aa: true, view: 2600 },
  high: { pixelRatio: 1, maxPixels: 3.0e6, shadow: 2048, shadowExtent: 55, bloom: true, aa: true, view: 3200 },
  ultra: { pixelRatio: 1.5, maxPixels: 5.0e6, shadow: 4096, shadowExtent: 65, bloom: true, aa: true, view: 3200 },
};

// Final grade: subtle vignette, warmth and film grain applied after tone mapping.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.02 },
    uDamage: { value: 0 },
    uFade: { value: 0 },
    uWarm: { value: 0 },
    uNight: { value: 0 },
    uOvercast: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uGrain; uniform float uDamage; uniform float uFade;
    uniform float uWarm; uniform float uNight; uniform float uOvercast;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 7.13) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // film-like grade (display-referred): gentle S-curve, saturation, split toning
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 col = c.rgb;
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
      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 6000);
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
    if (this._slow > 1.0 && this.dynScale > 0.6) {
      this.dynScale = Math.max(0.6, this.dynScale * 0.9);
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
    // the scene depth is kept as a texture so the selection outline can test against it
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
    rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
    rt.depthTexture.type = THREE.UnsignedIntType;
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.outline = new SelectionOutlinePass(this.camera);
    this.outline.edgeStrength = 2.2;
    this.outline.visibleEdgeColor.set(0xf2e6cf);
    this.outline.enabled = false;
    this.composer.addPass(this.outline);
    // threshold well above sunlit diffuse surfaces (snow, salt and white sand are ~1.5 in the
    // linear HDR buffer): only lamps, the sun's glint and fire bloom
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.4, 0.5, 2.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.applyPassSettings();
    this.resize();
  }

  applyPassSettings() {
    if (!this.composer) return;
    this.bloom.enabled = this.q.bloom && settings.data.bloom !== false;
    this.fxaa.enabled = this.q.aa;
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
    }
  }

  render(dt) {
    if (dt > 0 && dt < 0.25) this.adaptResolution(dt);
    if (this.grade) this.grade.uniforms.uTime.value += dt;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
