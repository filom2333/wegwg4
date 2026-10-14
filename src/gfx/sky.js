// Physically-inspired sky dome (single scattering approximation) used both as the visible sky
// and as the source of image-based lighting.

import * as THREE from 'three';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
  gl_Position = p.xyww;
}
`;

const skyFrag = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uTurbidity;
uniform float uCloud;
uniform float uDust;
uniform float uTime;
uniform float uNight;
uniform float uStars;
uniform vec3 uDustColor;
uniform float uOvercast;
uniform float uFlash;

// Hash / noise
float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5;} return s; }

vec3 skyColor(vec3 dir, vec3 sun) {
  float sunH = sun.y;
  float h = max(dir.y, 0.0);
  float mu = dot(dir, sun);
  // Rayleigh-ish gradient
  float day = smoothstep(-0.12, 0.25, sunH);
  vec3 zenith = mix(vec3(0.012, 0.018, 0.04), vec3(0.20, 0.42, 0.80), day);
  vec3 horizon = mix(vec3(0.03, 0.04, 0.07), vec3(0.72, 0.80, 0.88), day);
  // warm horizon at low sun
  float low = smoothstep(0.35, 0.0, abs(sunH)) * smoothstep(-0.2, 0.02, sunH);
  float az = pow(max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(sun.x, 0.0001, sun.z))), 0.0), 2.0);
  horizon = mix(horizon, vec3(1.0, 0.55, 0.28), low * (0.45 + 0.55 * az));
  zenith = mix(zenith, vec3(0.18, 0.24, 0.42), low * 0.5);
  float t = pow(1.0 - h, 3.2 + uTurbidity * 0.2);
  vec3 col = mix(zenith, horizon, t);
  // Mie glow around the sun
  float g = 0.76;
  float mie = (1.0 - g*g) / pow(1.0 + g*g - 2.0*g*mu, 1.5);
  vec3 mieCol = mix(vec3(1.0, 0.75, 0.45), vec3(1.0, 0.95, 0.85), smoothstep(0.0, 0.4, sunH));
  col += mieCol * mie * 0.018 * (0.4 + uTurbidity * 0.12) * smoothstep(-0.1, 0.05, sunH);
  // below horizon: ground haze
  if (dir.y < 0.0) {
    col = mix(horizon * 0.85, horizon * 0.55, smoothstep(0.0, -0.3, dir.y));
  }
  return col;
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 sun = normalize(uSunDir);
  vec3 col = skyColor(dir, sun);

  // Sun disc
  float mu = dot(dir, sun);
  float disc = smoothstep(0.99985, 0.99993, mu);
  vec3 sunCol = mix(vec3(1.0, 0.45, 0.15), vec3(1.0, 0.96, 0.88), smoothstep(0.0, 0.3, sun.y));
  col += sunCol * disc * 40.0 * smoothstep(-0.03, 0.02, sun.y) * (1.0 - uOvercast * 0.95);

  // Night sky: stars + moon
  float night = uNight;
  if (night > 0.001 && dir.y > -0.05) {
    vec3 sd = dir * 380.0;
    vec3 cell = floor(sd);
    float h = hash(cell);
    float star = step(0.9965, h) * smoothstep(0.55, 0.0, length(fract(sd) - 0.5));
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + h * 100.0);
    float milky = fbm(dir * 3.0 + vec3(3.1, 0.0, 1.7));
    float band = exp(-pow(dot(dir, normalize(vec3(0.3, 0.4, 0.86))) * 3.0, 2.0));
    col += vec3(0.9, 0.95, 1.0) * star * tw * night * uStars * 2.2 * (1.0 - uCloud);
    col += vec3(0.05, 0.06, 0.09) * milky * band * night * uStars * (1.0 - uCloud) * 0.6;
    vec3 moon = normalize(uMoonDir);
    float md = dot(dir, moon);
    float mdisc = smoothstep(0.99955, 0.99965, md);
    float crater = 0.75 + 0.25 * fbm(dir * 900.0);
    col += vec3(0.85, 0.88, 0.95) * mdisc * crater * 3.0 * (1.0 - uCloud * 0.8);
    col += vec3(0.08, 0.1, 0.16) * pow(max(md, 0.0), 80.0) * night * 0.6;
  }

  // Clouds (2D noise projected on a dome)
  if (dir.y > 0.0) {
    vec2 uv = dir.xz / (dir.y + 0.12) * 1.6;
    vec3 q = vec3(uv * 0.7 + vec2(uTime * 0.004, uTime * 0.002), uTime * 0.003);
    float n = fbm(q);
    float cover = mix(0.72, 0.28, uCloud);
    float c = smoothstep(cover, cover + 0.22, n) * smoothstep(0.0, 0.12, dir.y);
    float sunLit = clamp(dot(sun, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0, 1.0);
    float day = smoothstep(-0.1, 0.2, sun.y);
    vec3 cloudCol = mix(vec3(0.05, 0.055, 0.07), vec3(0.95, 0.94, 0.92), day);
    cloudCol = mix(cloudCol, cloudCol * vec3(1.0, 0.7, 0.5), smoothstep(0.3, 0.0, sun.y) * day);
    cloudCol *= mix(1.0, 0.45, uOvercast);
    float shade = 1.0 - 0.35 * smoothstep(0.4, 0.9, n);
    col = mix(col, cloudCol * shade, c * 0.92);
  }
  // Overcast & dust haze
  vec3 grey = mix(vec3(0.03, 0.035, 0.045), vec3(0.55, 0.57, 0.6), smoothstep(-0.1, 0.3, sun.y));
  col = mix(col, grey * (0.85 + 0.15 * dir.y), uOvercast * 0.85);
  vec3 dustC = uDustColor * mix(0.06, 1.0, smoothstep(-0.1, 0.3, sun.y));
  col = mix(col, dustC, uDust * (0.55 + 0.45 * (1.0 - max(dir.y, 0.0))));
  col += vec3(0.6, 0.65, 0.8) * uFlash;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor() {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.4).normalize() },
      uMoonDir: { value: new THREE.Vector3(-0.3, 0.5, -0.4).normalize() },
      uTurbidity: { value: 3.0 },
      uCloud: { value: 0.2 },
      uDust: { value: 0.0 },
      uTime: { value: 0 },
      uNight: { value: 0 },
      uStars: { value: 1 },
      uDustColor: { value: new THREE.Color(0.78, 0.62, 0.45) },
      uOvercast: { value: 0 },
      uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.mesh.scale.setScalar(4000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }
}

// Generates a PMREM environment map from a sky (and optional ground colour).
export class EnvironmentBaker {
  constructor(renderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = new THREE.Scene();
    this.sky = new Sky();
    this.sky.mesh.scale.setScalar(100);
    this.scene.add(this.sky.mesh);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0x8a7255, side: THREE.DoubleSide });
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(90, 32), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -1.6;
    this.scene.add(this.ground);
    this.target = null;
  }

  bake(skyUniforms, groundColor) {
    for (const k in skyUniforms) {
      if (this.sky.uniforms[k]) {
        const v = skyUniforms[k].value;
        if (v && v.copy) this.sky.uniforms[k].value.copy(v);
        else this.sky.uniforms[k].value = v;
      }
    }
    this.sky.uniforms.uStars.value = 0;
    if (groundColor) this.ground.material.color.copy(groundColor);
    const old = this.target;
    this.target = this.pmrem.fromScene(this.scene, 0, 0.1, 200);
    if (old) old.dispose();
    return this.target.texture;
  }
}
