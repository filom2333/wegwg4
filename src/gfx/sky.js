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
uniform float uWall;
uniform float uWallUp;
uniform vec3 uWallDir;
uniform float uMist;

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
  vec3 zenith = mix(vec3(0.012, 0.018, 0.04), vec3(0.16, 0.38, 0.82), day);
  vec3 horizon = mix(vec3(0.03, 0.04, 0.07), vec3(0.74, 0.8, 0.86), day);
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
    // stars in two layers (many faint, a few bright), each its own colour and twinkle; low in the
    // sky they shimmer harder and dim in the thicker air
    float lowAir = 1.0 - smoothstep(0.0, 0.45, dir.y);
    float ext = smoothstep(-0.02, 0.18, dir.y);
    vec3 starCol = vec3(0.0);
    for (int L = 0; L < 2; L++) {
      float dens = L == 0 ? 520.0 : 210.0;
      vec3 sd = dir * dens;
      vec3 cell = floor(sd);
      float h = hash(cell);
      float h2 = hash(cell + 17.31);
      float h3 = hash(cell + 41.7);
      vec3 jit = vec3(hash(cell + 3.1), hash(cell + 5.7), hash(cell + 9.3)) - 0.5;
      float rr = length(fract(sd) - 0.5 - jit * 0.5);
      float th = L == 0 ? 0.982 : 0.9965;
      float star = step(th, h) * smoothstep(L == 0 ? 0.38 : 0.5, 0.0, rr);
      float mag = L == 0 ? 0.25 + 0.55 * h2 * h2 : 1.4 + 2.6 * h2;
      float sp = 1.5 + 7.0 * h3;
      float amp = mix(0.12, 0.7, lowAir);
      float tw = 1.0 - amp * (0.5 + 0.5 * sin(uTime * sp + h * 80.0)) * (0.5 + 0.5 * sin(uTime * sp * 1.73 + h * 31.0));
      vec3 c = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.66), h3);
      starCol += c * star * mag * tw;
    }
    col += starCol * ext * night * uStars * 1.8 * (1.0 - uCloud);
    // the Milky Way: a soft band with darker dust lanes through it
    vec3 mwAxis = normalize(vec3(0.3, 0.4, 0.86));
    float band = exp(-pow(dot(dir, mwAxis) * 3.2, 2.0));
    float milky = fbm(dir * 3.0 + vec3(3.1, 0.0, 1.7));
    float lanes = smoothstep(0.35, 0.7, fbm(dir * 9.0 + vec3(7.0, 1.0, 2.0)));
    col += vec3(0.075, 0.085, 0.12) * (0.4 + milky) * band * (1.0 - lanes * 0.6) * ext * night * uStars * (1.0 - uCloud);
    vec3 moon = normalize(uMoonDir);
    float md = dot(dir, moon);
    float mdisc = smoothstep(0.99955, 0.99965, md);
    float crater = 0.75 + 0.25 * fbm(dir * 900.0);
    col += vec3(0.85, 0.88, 0.95) * mdisc * crater * 3.0 * (1.0 - uCloud * 0.8);
    col += vec3(0.08, 0.1, 0.16) * pow(max(md, 0.0), 80.0) * night * 0.6;
  }

  // Clouds: a cumulus layer (domain-warped fbm) lit from the sun with a self-shadow march,
  // silver lining toward the sun and warm undersides at golden hour; thin cirrus streaks above.
  if (dir.y > 0.0) {
    float dayC = smoothstep(-0.14, 0.04, sun.y);
    vec2 uv = dir.xz / (dir.y + 0.09) * 1.25;
    vec2 wind = vec2(uTime * 0.006, uTime * 0.003);
    vec3 q = vec3(uv * 0.55 + wind, uTime * 0.002);
    vec3 warp = vec3(fbm(q * 0.6 + 4.2), fbm(q * 0.6 + 9.1), 0.0);
    float n = fbm(q + warp * 0.9);
    float cover = mix(0.66, 0.24, uCloud);
    float dens = smoothstep(cover, cover + 0.2, n) * smoothstep(0.0, 0.1, dir.y);
    // light march toward the sun across the cloud layer
    vec2 sdir = normalize(sun.xz + 1e-4) * 0.06;
    float occ = 0.0;
    for (int i = 1; i <= 3; i++) {
      vec3 qs = vec3((uv + sdir * float(i)) * 0.55 + wind, uTime * 0.002);
      occ += smoothstep(cover, cover + 0.25, fbm(qs + warp * 0.9));
    }
    float lightT = exp(-occ * 0.75);
    float mu2 = dot(dir, sun);
    float silver = pow(max(mu2, 0.0), 6.0) * (1.0 - dens) * 2.2;
    vec3 sunTint = mix(vec3(1.0, 0.55, 0.3), vec3(1.0, 0.97, 0.92), smoothstep(0.02, 0.35, sun.y));
    // sunset: undersides catch the low sun and glow pink-orange
    float glow = smoothstep(0.25, 0.0, sun.y) * smoothstep(-0.14, -0.02, sun.y);
    vec3 lit = sunTint * (0.55 + 0.75 * lightT) + silver * sunTint + vec3(1.0, 0.45, 0.32) * glow * (0.6 + 0.6 * (1.0 - lightT));
    vec3 ambient = mix(vec3(0.42, 0.48, 0.6), vec3(0.62, 0.5, 0.48), smoothstep(0.3, 0.0, sun.y));
    vec3 cloudCol = mix(ambient * 0.7, lit, 0.7);
    // night: dim moonlit grey
    cloudCol = mix(vec3(0.03, 0.035, 0.05) + vec3(0.04, 0.045, 0.06) * lightT, cloudCol, dayC);
    cloudCol *= mix(1.0, 0.5, uOvercast);
    col = mix(col, cloudCol, dens * 0.95);
    // cirrus
    vec2 cu = dir.xz / (dir.y + 0.25) * vec2(0.6, 2.4) + wind * 2.0;
    float ci = smoothstep(0.55, 0.85, fbm(vec3(cu, 1.7))) * smoothstep(0.05, 0.3, dir.y) * (0.25 + 0.5 * uCloud) * (1.0 - dens);
    col = mix(col, sunTint * mix(0.25, 1.05, dayC), ci * 0.35);
  }
  // Overcast & dust haze
  vec3 grey = mix(vec3(0.03, 0.035, 0.045), vec3(0.55, 0.57, 0.6), smoothstep(-0.1, 0.3, sun.y));
  col = mix(col, grey * (0.85 + 0.15 * dir.y), uOvercast * 0.85);
  vec3 dustC = uDustColor * mix(0.06, 1.0, smoothstep(-0.1, 0.3, sun.y));
  col = mix(col, dustC, uDust * (0.72 + 0.28 * (1.0 - max(dir.y, 0.0))));
  // a sandstorm rolling in: a billowing brown wall across one side of the horizon, climbing as
  // it comes, its top catching the sun
  if (uWall > 0.0) {
    vec2 hz = normalize(dir.xz + 1e-5);
    float side = smoothstep(-0.3, 0.5, dot(hz, normalize(uWallDir.xz)));
    float az = atan(hz.y, hz.x);
    float billow = fbm(vec3(az * 3.0, uTime * 0.05, 3.1)) - 0.5;
    float top = uWallUp * (0.75 + 0.5 * side) + billow * (0.04 + uWallUp * 0.25);
    float inWall = smoothstep(top + 0.02, top - 0.03, dir.y) * side;
    vec3 wallLit = mix(uDustColor * 0.35, uDustColor * 1.05, smoothstep(top - 0.25, top, dir.y)) * mix(0.08, 1.0, smoothstep(-0.1, 0.3, sun.y));
    col = mix(col, wallLit, inWall * uWall);
  }
  // inside a mist the sky goes milky toward the horizon
  vec3 mistC = mix(vec3(0.05, 0.055, 0.07), vec3(0.8, 0.82, 0.85), smoothstep(-0.1, 0.25, sun.y));
  col = mix(col, mistC, uMist * 0.85 * (1.0 - smoothstep(0.0, 0.6, dir.y) * 0.65));
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
      uWall: { value: 0 },
      uWallUp: { value: 0.02 },
      uWallDir: { value: new THREE.Vector3(1, 0, 0) },
      uMist: { value: 0 },
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
