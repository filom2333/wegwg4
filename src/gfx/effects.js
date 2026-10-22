// Visual effects: soft particles (dust, smoke, fire, sparks, blood), muzzle flashes, tracers,
// shell casings, impact marks, rain + splashes, lightning, dust devils, tumbleweeds, birds,
// meteors and moths. Everything is pooled; nothing allocates per frame in steady state.

import * as THREE from 'three';
import { makeCanvas } from './textures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLASS_RAIN } from './glassRain.js';
import { mulberry32 } from '../core/noise.js';
import { tubeAlong } from './geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ particle pool
const PVERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
attribute float aRot;
varying float vAlpha;
varying vec3 vColor;
varying float vRot;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
varying float vRot;
uniform float uSoft;
uniform float uLight;
uniform float uLobes;
uniform vec3 uAmbient;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = mat2(c, -s, s, c) * p;
  float r = length(p) * 2.0;
  // billowy puff: radial falloff modulated by a few lobes
  float lobes = 1.0 - uLobes + uLobes * sin(atan(p.y, p.x) * 5.0 + vRot * 3.0);
  float a = smoothstep(1.0, uSoft, r / lobes) * vAlpha;
  if (a < 0.003) discard;
  vec3 col = vColor * mix(vec3(1.0), uAmbient, uLight);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(max, { additive = false, soft = 0.0, lit = 1, depthWrite = false, lobes = 0.15 } = {}) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.rot = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVERT,
      fragmentShader: PFRAG,
      uniforms: { uScale: { value: 300 }, uSoft: { value: soft }, uLight: { value: lit }, uLobes: { value: lobes }, uAmbient: { value: new THREE.Color(1, 1, 1) } },
      transparent: true,
      depthWrite,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.parts = [];
    for (let i = 0; i < max; i++) this.parts.push({ life: 0 });
    this.next = 0;
    this.live = 0;
  }

  emit(p) {
    this.fresh = true;
    const q = this.parts[this.next];
    this.next = (this.next + 1) % this.max;
    // fields written one by one: no temporary object per particle
    q.life = q.max = p.life;
    q.x = p.pos.x;
    q.y = p.pos.y;
    q.z = p.pos.z;
    q.vx = p.vel ? p.vel.x : 0;
    q.vy = p.vel ? p.vel.y : 0;
    q.vz = p.vel ? p.vel.z : 0;
    q.s0 = p.size;
    q.s1 = p.grow ?? p.size * 2;
    q.a0 = p.alpha ?? 1;
    q.r = p.color[0];
    q.g = p.color[1];
    q.b = p.color[2];
    q.drag = p.drag ?? 1;
    q.grav = p.grav ?? 0;
    q.rot = Math.random() * 6.28;
    q.spin = (Math.random() - 0.5) * (p.spin ?? 1);
    q.fadeIn = p.fadeIn ?? 0.1;
    q.ground = p.ground ?? -1e9;
  }

  update(dt) {
    // nothing alive and nothing new: the buffers already hold zeros
    if (!this.live && !this.fresh) {
      this.points.visible = false;
      return;
    }
    this.fresh = false;
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      const p = this.parts[i];
      if (p.life <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      p.life -= dt;
      const t = 1 - p.life / p.max;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy = p.vy * k - p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < p.ground) {
        p.y = p.ground;
        p.vy *= -0.2;
        p.vx *= 0.5;
        p.vz *= 0.5;
      }
      p.rot += p.spin * dt;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.s0 + (p.s1 - p.s0) * Math.sqrt(t);
      const fi = Math.min(1, t / Math.max(1e-3, p.fadeIn));
      this.alpha[i] = p.a0 * fi * (1 - t) * (1 - t * 0.3);
      this.color[i * 3] = p.r;
      this.color[i * 3 + 1] = p.g;
      this.color[i * 3 + 2] = p.b;
      this.rot[i] = p.rot;
      n++;
    }
    this.live = n;
    this.points.visible = true;
    for (const k of ['position', 'aSize', 'aAlpha', 'aColor', 'aRot']) this.geo.attributes[k].needsUpdate = true;
  }

  rebase(dx, dz) {
    for (const p of this.parts) {
      p.x -= dx;
      p.z -= dz;
    }
  }
}

const moteFwd = new THREE.Vector3(),
  motePos = new THREE.Vector3(),
  moteVel = new THREE.Vector3();

// ------------------------------------------------------------------ tumbleweed mesh
function tumbleweedGeo(seed) {
  const r = mulberry32(seed);
  const pts = [];
  const list = [];
  for (let k = 0; k < 26; k++) {
    const a = r() * Math.PI * 2,
      b = Math.acos(2 * r() - 1);
    const p = [];
    let d = V(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a));
    for (let i = 0; i < 6; i++) {
      const rr = 0.32 + 0.08 * Math.sin(i + k);
      p.push(d.clone().multiplyScalar(rr));
      d.add(V(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.9)).normalize();
    }
    list.push(tubeAlong(p, 0.006, 3, { closedEnds: false }));
  }
  void pts;
  let count = 0;
  for (const g of list) count += g.index.count;
  const geos = list.map((g) => g.toNonIndexed());
  const pos = new Float32Array(geos.reduce((a, g) => a + g.attributes.position.count * 3, 0));
  const nrm = new Float32Array(pos.length);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o);
    nrm.set(g.attributes.normal.array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  void count;
  return out;
}

// simple vulture: body + two wings that flap
function makeBird(mat, scale = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6).scale(1, 0.8, 2.6), mat);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), new THREE.MeshStandardMaterial({ color: 0x9a5a4a, roughness: 0.8 }));
  head.position.set(0, 0.03, 0.34);
  g.add(head);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.12);
  wingShape.lineTo(0.55, 0.14);
  wingShape.lineTo(0.95, 0.02);
  wingShape.lineTo(0.9, -0.08);
  wingShape.lineTo(0.5, -0.1);
  wingShape.lineTo(0, -0.12);
  wingShape.closePath();
  const wg = new THREE.ShapeGeometry(wingShape);
  wg.rotateX(-Math.PI / 2);
  const wl = new THREE.Mesh(wg, mat);
  const wr = new THREE.Mesh(wg, mat);
  wr.scale.x = -1;
  const pl = new THREE.Group(),
    pr = new THREE.Group();
  pl.add(wl);
  pr.add(wr);
  g.add(pl, pr);
  g.userData.wings = [pl, pr];
  g.scale.setScalar(scale);
  return g;
}

// ------------------------------------------------------------------ Effects
export class Effects {
  constructor(game) {
    this.game = game;
    const root = (this.root = new THREE.Group());
    root.name = 'effects';
    game.worldGroup.add(root);
    this.dust = new Particles(1400, { soft: 0.0, lit: 1 });
    this.smoke = new Particles(500, { soft: 0.1, lit: 1 });
    // flames and sparks: round, soft glows (the puff lobes read as little stars when additive)
    this.fire = new Particles(300, { additive: true, soft: -0.4, lit: 0, lobes: 0.04 });
    this.sparks = new Particles(400, { additive: true, soft: 0.2, lit: 0, lobes: 0 });
    this.blood = new Particles(300, { soft: 0.6, lit: 1 });
    this.moths = new Particles(200, { soft: 0.6, lit: 0 });
    // tall smoke columns seen from afar (signal fires)
    this.column = new Particles(260, { soft: 0.0, lit: 1 });
    for (const p of [this.dust, this.smoke, this.blood, this.fire, this.sparks, this.moths, this.column]) root.add(p.points);
    this.fire.points.renderOrder = 3;
    // flashes
    this.flashLight = new THREE.PointLight(0xffc070, 0, 14, 2);
    root.add(this.flashLight);
    game.lights.add(this.flashLight);
    this.flashT = 0;
    this.flashSprite = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uA: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
        fragmentShader: `varying vec2 vUv; uniform float uA; void main(){ vec2 p = vUv - 0.5; float r = length(p); float star = pow(max(0.0, 1.0 - abs(p.x*p.y)*80.0), 3.0) * smoothstep(0.5, 0.0, r); float core = smoothstep(0.35, 0.0, r); gl_FragColor = vec4(vec3(1.0, 0.75, 0.4) * (core + star*0.6) * uA, 1.0); }`,
      })
    );
    this.flashSprite.visible = false;
    root.add(this.flashSprite);
    // tracers
    this.tracers = [];
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    // decals (bullet holes / blood spots)
    this.decals = [];
    this.decalGeo = new THREE.CircleGeometry(0.03, 10);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x0b0a09, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    // blood: a few irregular splatter shapes (alpha maps), soaked dark into sand
    this.bloodGeo = new THREE.PlaneGeometry(1, 1);
    this.bloodMats = [0, 1, 2, 3].map((i) => new THREE.MeshStandardMaterial({ color: 0x4a0707, roughness: 0.35, transparent: true, alphaMap: splatterTexture(17 + i * 31), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.bloodMat = this.bloodMats[0];
    // what a leaking car leaves on the ground: black oil, green coolant
    const stain = (color, opacity, seed, rough) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.1, transparent: true, opacity, alphaMap: splatterTexture(seed), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.fluidMats = { oil: stain(0x0c0a07, 0.92, 211, 0.12), coolant: stain(0x2a7a46, 0.7, 233, 0.2) };
    // casings
    this.casings = [];
    this.casingGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.03, 8).rotateZ(Math.PI / 2);
    this.casingMat = new THREE.MeshStandardMaterial({ color: 0xc89b3c, metalness: 1, roughness: 0.3 });
    // rain
    this.buildRain();
    // lightning
    this.bolt = null;
    this.boltT = 0;
    // dust devils
    this.devils = [];
    this.devilTimer = 20;
    // tumbleweeds
    this.twMat = new THREE.MeshStandardMaterial({ color: 0x8a7350, roughness: 0.95 });
    this.twGeos = [tumbleweedGeo(1), tumbleweedGeo(2), tumbleweedGeo(3)];
    this.weeds = [];
    // birds
    this.birdMat = new THREE.MeshStandardMaterial({ color: 0x1c1816, roughness: 0.9, side: THREE.DoubleSide });
    this.birds = [];
    // meteors
    this.meteors = [];
    this.meteorTimer = 8;
    this.meteorMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.t = 0;
  }

  // ------------------------------------------------------------------ rain
  buildRain() {
    const N = 3500;
    const pos = new Float32Array(N * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab4bf, transparent: true, opacity: 0.32, depthWrite: false }));
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    this.root.add(this.rainLines);
    this.rainDrops = [];
    const r = mulberry32(5);
    for (let i = 0; i < N; i++) this.rainDrops.push({ x: (r() - 0.5) * 50, y: r() * 25, z: (r() - 0.5) * 50, v: 9 + r() * 4 });
    // splashes: tiny rings
    this.splashes = new Particles(500, { soft: 0.7, lit: 1 });
    this.root.add(this.splashes.points);
  }

  updateRain(dt, cam, intensity, wind) {
    const vis = intensity > 0.02;
    this.rainLines.visible = vis;
    if (!vis) return;
    const n = Math.floor(this.rainDrops.length * Math.min(1, intensity));
    const pos = this.rainLines.geometry.attributes.position.array;
    const wx = wind * 2.5;
    const g = this.game;
    for (let i = 0; i < this.rainDrops.length; i++) {
      const d = this.rainDrops[i];
      if (i >= n) {
        pos.fill(0, i * 6, i * 6 + 6);
        continue;
      }
      d.y -= d.v * dt;
      d.x += wx * dt;
      // keep around camera
      let ax = cam.position.x + d.x,
        az = cam.position.z + d.z;
      const ay = cam.position.y - 6 + d.y;
      if (d.y < 0 || Math.abs(d.x) > 25) {
        if (Math.random() < 0.15 && Math.abs(d.x) < 14 && Math.abs(d.z) < 14) {
          const gy = g.gen.height(ax + g.origin.x, az + g.origin.z);
          if (Math.abs(gy - ay) < 3) this.splashes.emit({ pos: V(ax, gy + 0.02, az), size: 0.05, grow: 0.16, life: 0.25, color: [0.75, 0.78, 0.82], alpha: 0.5 });
        }
        d.y = 22 + Math.random() * 3;
        d.x = (Math.random() - 0.5) * 50;
        d.z = (Math.random() - 0.5) * 50;
        ax = cam.position.x + d.x;
        az = cam.position.z + d.z;
      }
      const len = 0.35 + d.v * 0.03;
      pos[i * 6] = ax;
      pos[i * 6 + 1] = ay;
      pos[i * 6 + 2] = az;
      pos[i * 6 + 3] = ax - wx * 0.04;
      pos[i * 6 + 4] = ay + len;
      pos[i * 6 + 5] = az;
    }
    this.rainLines.geometry.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------------------ snow
  // Soft flakes drifting down round the camera: slow, swaying, carried by the wind.
  buildSnow() {
    const N = 7000;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const c = makeCanvas(32, 32);
    const x = c.getContext('2d');
    const grd = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = grd;
    x.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    this.snowPts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.13, map: tex, color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, sizeAttenuation: true }));
    this.snowPts.frustumCulled = false;
    this.snowPts.visible = false;
    this.root.add(this.snowPts);
    const r = mulberry32(9);
    this.flakes = [];
    for (let i = 0; i < N; i++) this.flakes.push({ x: (r() - 0.5) * 44, y: r() * 22, z: (r() - 0.5) * 44, v: 0.7 + r() * 0.8, ph: r() * 6.28, sw: 0.3 + r() * 0.6 });
  }

  updateSnow(dt, cam, intensity, wind) {
    if (!this.snowPts) {
      if (intensity <= 0.02) return;
      this.buildSnow();
    }
    const vis = intensity > 0.02;
    this.snowPts.visible = vis;
    if (!vis) return;
    const n = Math.floor(this.flakes.length * Math.min(1, intensity));
    const pos = this.snowPts.geometry.attributes.position.array;
    const wx = wind * 2.2,
      wz = wind * 0.6;
    const t = this.t;
    for (let i = 0; i < this.flakes.length; i++) {
      const f = this.flakes[i];
      if (i >= n) {
        pos[i * 3 + 1] = -1e5;
        continue;
      }
      f.y -= f.v * dt;
      f.x += (wx + Math.sin(t * f.sw * 2 + f.ph) * f.sw) * dt;
      f.z += (wz + Math.cos(t * f.sw * 1.6 + f.ph) * f.sw * 0.7) * dt;
      if (f.y < 0 || Math.abs(f.x) > 22 || Math.abs(f.z) > 22) {
        f.y = 20 + Math.random() * 2;
        f.x = (Math.random() - 0.5) * 44;
        f.z = (Math.random() - 0.5) * 44;
      }
      pos[i * 3] = cam.position.x + f.x;
      pos[i * 3 + 1] = cam.position.y - 6 + f.y;
      pos[i * 3 + 2] = cam.position.z + f.z;
    }
    this.snowPts.geometry.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------------------ emitters
  wheelDust(car, dt) {
    const d = car.dyn;
    const env = this.game.env;
    for (const w of d.wheels) {
      if (!w.contact) continue;
      const s = d.surfaces(w.surface);
      const speed = Math.hypot(w.vLong, w.vLat);
      // snow throws up a white powder spray instead of dust
      const powder = s.snow || 0;
      const rate = ((s.dust + powder * 0.8) * Math.max(0, speed - 3) * 0.9 + w.skid * 20) * (1 - env.w.rain * 0.9);
      let n = rate * dt;
      while (n > 0) {
        if (Math.random() < n) {
          const p = w.contactPoint;
          const back = V(0, 0, -1).applyQuaternion(car.root.quaternion);
          const col = powder ? [0.93, 0.95, 0.98] : w.surface === 'asphalt' ? [0.55, 0.53, 0.5] : w.surface === 'salt' ? [0.85, 0.84, 0.8] : w.surface === 'grass' ? [0.55, 0.5, 0.38] : [0.72, 0.6, 0.45];
          // a hard skid on tarmac burns rubber: thick pale smoke that hangs and drifts
          if (w.skid > 0.3 && (w.surface === 'asphalt' || w.surface === 'concrete') && Math.random() < 0.6)
            this.smoke.emit({
              pos: V(p.x + back.x * 0.2, p.y + 0.2, p.z + back.z * 0.2),
              vel: V(back.x * speed * 0.15 + (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.5, back.z * speed * 0.15 + (Math.random() - 0.5) * 0.6),
              size: 0.7,
              grow: 4.5,
              life: 2.6 + Math.random() * 1.8,
              color: [0.86, 0.86, 0.85],
              alpha: 0.3 * Math.min(1, w.skid),
              drag: 0.9,
              grav: -0.05,
              fadeIn: 0.1,
            });
          this.dust.emit({
            pos: V(p.x + back.x * 0.3, p.y + 0.15, p.z + back.z * 0.3),
            vel: V(back.x * speed * 0.3 + (Math.random() - 0.5), 0.6 + Math.random() * 0.8, back.z * speed * 0.3 + (Math.random() - 0.5)),
            size: 0.6,
            grow: 2.6 + speed * 0.06,
            life: 1.6 + Math.random() * 1.4,
            color: col,
            alpha: 0.32,
            drag: 1.2,
            grav: -0.1,
            fadeIn: 0.15,
          });
        }
        n -= 1;
      }
    }
  }

  exhaust(car, dt) {
    if (!car.dyn.engine.running || !car.isInstalled('exhaust')) return;
    const rate = 6 + car.dyn.controls.throttle * 20;
    if (Math.random() < rate * dt) {
      // twin tail pipes under the rear bumper
      const P = car.type.POINTS;
      const p = (Math.random() < 0.5 || !P.exhaust2 ? P.exhaust : P.exhaust2).clone().applyMatrix4(car.root.matrixWorld);
      const back = V(0, 0, -1).applyQuaternion(car.root.quaternion);
      const cold = this.game.env.time < 9 || this.game.env.time > 19 ? 0.35 : 0.12;
      const bad = Math.max(0, 0.5 - car.engineCondition);
      this.smoke.emit({
        pos: p,
        vel: back.multiplyScalar(1.5).add(V(0, 0.3, 0)).add(car.dyn.lastLinvel.clone().multiplyScalar(0.8)),
        size: 0.15,
        grow: 0.9,
        life: 1.4,
        color: bad > 0 ? [0.25, 0.25, 0.26] : [0.75, 0.75, 0.76],
        alpha: cold + bad,
        drag: 2,
        grav: -0.4,
      });
    }
  }

  engineSmoke(car, dt) {
    const s = car.smoke;
    const f = car.fire;
    // the engine is at the back: smoke pours out of the engine lid louvres
    const hood = car.isInstalled('hood') && car.model.parts.hood.openT < 0.3;
    const base = (hood ? car.type.POINTS.engineLidTop : car.type.POINTS.engine).clone().applyMatrix4(car.root.matrixWorld);
    if (s > 0.05 && Math.random() < s * 30 * dt)
      this.smoke.emit({ pos: base.clone().add(V((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.4)), vel: V((Math.random() - 0.5) * 0.4, 1.0 + s, (Math.random() - 0.5) * 0.4), size: 0.4, grow: 2.5, life: 2.5, color: s > 0.6 ? [0.12, 0.12, 0.12] : [0.55, 0.55, 0.56], alpha: 0.35, drag: 0.8, grav: -0.5 });
    if (f > 0) {
      for (let i = 0; i < 3; i++)
        if (Math.random() < f * 40 * dt)
          this.fire.emit({ pos: base.clone().add(V((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.6)), vel: V(0, 1.4 + Math.random(), 0), size: 0.5, grow: 0.15, life: 0.6 + Math.random() * 0.4, color: [1.0, 0.45 + Math.random() * 0.2, 0.12], alpha: 0.9, drag: 1, grav: -1 });
      this.flashLight.position.copy(base);
      this.flashLight.intensity = Math.max(this.flashLight.intensity, 4 * f * (0.8 + Math.random() * 0.4));
    }
  }

  // k: 1 a full bang, less for the small pops of a sport muffler on the overrun (out of either pipe)
  backfire(car, k = 1) {
    const P = car.type.POINTS;
    const pipe = k < 1 && P.exhaust2 && Math.random() < 0.5 ? P.exhaust2 : P.exhaust;
    const p = pipe.clone().add(V(0, 0, -0.1)).applyMatrix4(car.root.matrixWorld);
    const back = V(0, 0, -1).applyQuaternion(car.root.quaternion);
    const n = Math.max(2, Math.round(6 * k));
    for (let i = 0; i < n; i++) this.fire.emit({ pos: p, vel: back.clone().multiplyScalar((4 + Math.random() * 3) * (0.5 + 0.5 * k)).add(V(Math.random() - 0.5, Math.random() * 0.5, Math.random() - 0.5)).add(car.dyn.lastLinvel), size: 0.25 * (0.5 + 0.5 * k), grow: 0.05, life: 0.18 * (0.6 + 0.4 * k), color: [1, 0.55 + (1 - k) * 0.15, 0.2], alpha: 1, drag: 4 });
    if (k > 0.5) this.smoke.emit({ pos: p, vel: V(0, 0.5, 0), size: 0.3, grow: 1.4, life: 1.5, color: [0.2, 0.2, 0.2], alpha: 0.4, drag: 2, grav: -0.3 });
    this.flash(p, 0.6 * k);
  }

  impactDebris(car, imp, severity) {
    const p = car.root.position.clone().add(imp.dir.clone().multiplyScalar(-2)).add(V(0, 0.6, 0));
    const n = Math.min(40, Math.floor(severity * 4));
    for (let i = 0; i < n; i++) {
      this.sparks.emit({ pos: p.clone().add(V((Math.random() - 0.5) * 1.2, Math.random() * 0.5, (Math.random() - 0.5) * 1.2)), vel: V((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6), size: 0.06, grow: 0.04, life: 0.6 + Math.random() * 0.5, color: [1, 0.75, 0.4], alpha: 1, drag: 0.5, grav: 9.8 });
      if (i % 3 === 0) this.dust.emit({ pos: p.clone(), vel: V((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3), size: 0.5, grow: 2.5, life: 1.5, color: [0.65, 0.56, 0.44], alpha: 0.35, drag: 2 });
    }
  }

  // Spray can mist: a cone of fine droplets in the paint colour from the nozzle to the panel.
  sprayMist(from, to, hex, dt) {
    const c = new THREE.Color(hex);
    const dir = to.clone().sub(from).normalize();
    const n = Math.ceil(dt * 90);
    for (let i = 0; i < n; i++) {
      const spread = V((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5);
      this.smoke.emit({
        pos: from.clone().addScaledVector(dir, 0.04),
        vel: dir.clone().add(spread.multiplyScalar(0.6)).multiplyScalar(2.2 + Math.random() * 1.2),
        size: 0.025,
        grow: 0.5,
        life: 0.45 + Math.random() * 0.3,
        color: [c.r, c.g, c.b],
        alpha: 0.35,
        drag: 3.5,
        grav: 0.1,
      });
    }
  }

  footDust(pos, strength = 1) {
    for (let i = 0; i < 2; i++) this.dust.emit({ pos: pos.clone().add(V((Math.random() - 0.5) * 0.2, 0.05, (Math.random() - 0.5) * 0.2)), vel: V((Math.random() - 0.5) * 0.3, 0.2, (Math.random() - 0.5) * 0.3), size: 0.15, grow: 0.6 * strength, life: 0.9, color: [0.7, 0.6, 0.46], alpha: 0.2, drag: 2 });
  }

  // ------------------------------------------------------------------ combat
  flash(pos, strength = 1) {
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 30 * strength;
    this.flashT = 0.06;
  }

  muzzleFlash(pos, dir) {
    this.flash(pos, 1);
    const s = this.flashSprite;
    s.visible = true;
    s.position.copy(pos).addScaledVector(dir, 0.06);
    s.lookAt(this.game.renderer.camera.position);
    s.rotation.z = Math.random() * Math.PI;
    s.scale.setScalar(0.6 + Math.random() * 0.4);
    s.material.uniforms.uA.value = 1;
    for (let i = 0; i < 4; i++) this.smoke.emit({ pos: pos.clone().addScaledVector(dir, 0.1), vel: dir.clone().multiplyScalar(1.5 + Math.random()).add(V(0, 0.3, 0)), size: 0.06, grow: 0.5, life: 0.9, color: [0.7, 0.7, 0.7], alpha: 0.25, drag: 3, grav: -0.2 });
    // casing
    const cam = this.game.renderer.camera;
    const right = V(1, 0, 0).applyQuaternion(cam.quaternion);
    const m = new THREE.Mesh(this.casingGeo, this.casingMat);
    m.position.copy(pos).addScaledVector(dir, -0.15);
    this.root.add(m);
    this.casings.push({ m, v: right.multiplyScalar(1.5 + Math.random()).add(V(0, 1.8, 0)), life: 4, spin: V(Math.random() * 20, Math.random() * 20, 0) });
    if (this.casings.length > 20) {
      const c = this.casings.shift();
      this.root.remove(c.m);
    }
  }

  tracer(a, b) {
    const g = new THREE.BufferGeometry().setFromPoints([a.clone(), a.clone().lerp(b, 0.15)]);
    const l = new THREE.Line(g, this.tracerMat.clone());
    this.root.add(l);
    this.tracers.push({ l, a: a.clone(), b: b.clone(), t: 0, len: a.distanceTo(b) });
  }

  impact(p, n, surface) {
    const col = surface === 'metal' ? [1, 0.8, 0.5] : surface === 'wood' ? [0.6, 0.45, 0.3] : [0.7, 0.62, 0.5];
    for (let i = 0; i < 8; i++) this.dust.emit({ pos: p.clone().addScaledVector(n, 0.03), vel: n.clone().multiplyScalar(1 + Math.random() * 2).add(V((Math.random() - 0.5) * 1.5, Math.random(), (Math.random() - 0.5) * 1.5)), size: 0.05, grow: 0.5, life: 0.8, color: col, alpha: 0.5, drag: 3, grav: 2 });
    if (surface === 'metal') for (let i = 0; i < 6; i++) this.sparks.emit({ pos: p.clone(), vel: n.clone().multiplyScalar(3).add(V((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4)), size: 0.03, grow: 0.02, life: 0.3, color: [1, 0.8, 0.5], alpha: 1, grav: 9.8 });
    this.decal(p, n, this.decalMat, 0.6 + Math.random() * 0.5);
  }

  decal(p, n, mat, scale = 1) {
    const blood = this.bloodMats.includes(mat);
    if (blood) {
      mat = this.bloodMats[Math.floor(Math.random() * this.bloodMats.length)];
      scale *= 0.07;
    }
    const splat = blood || mat === this.fluidMats.oil || mat === this.fluidMats.coolant;
    const d = new THREE.Mesh(splat ? this.bloodGeo : this.decalGeo, mat);
    d.position.copy(p).addScaledVector(n, 0.004);
    d.lookAt(p.clone().add(n));
    if (splat) d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.setScalar(scale);
    this.root.add(d);
    this.decals.push(d);
    if (this.decals.length > 80) this.root.remove(this.decals.shift());
    return d;
  }

  // Drips under a car losing a fluid (oil with no filter on a running engine or upside down,
  // coolant with the water pump gone) and the puddle they make: it spreads while the car stands,
  // a trail of stains when it moves.
  leaks(car, dt) {
    const oil = car.oil > 0.05 && car.isInstalled('engine') && ((car.parts.oilfilter && !car.isInstalled('oilfilter') && car.dyn.engine.running) || car.inverted > 0.5);
    const coolant = car.coolant > 0.05 && car.parts.waterpump && !car.isInstalled('waterpump');
    if (!oil && !coolant) return;
    car._drip = (car._drip || 0) - dt;
    if (car._drip > 0) return;
    car._drip = 0.12 + Math.random() * 0.12;
    car._puddles = car._puddles || {};
    const g = this.game;
    for (const [on, key, col, dz] of [
      [oil, 'oil', [0.05, 0.04, 0.03], -0.15],
      [coolant, 'coolant', [0.2, 0.55, 0.3], 0.3],
    ]) {
      if (!on) continue;
      const p = car.type.POINTS.engine.clone().add(V((Math.random() - 0.5) * 0.15, -0.3, dz)).applyMatrix4(car.root.matrixWorld);
      this.blood.emit({ pos: p, vel: V(0, -0.4, 0), size: 0.018, grow: 0, life: 0.45, color: col, alpha: 0.9, grav: 9.8 });
      const gy = g.groundHeightAt(p.x, p.z, p.y + 0.5);
      if (p.y - gy > 1.5) continue;
      const pd = car._puddles[key];
      if (pd && pd.mesh.parent && Math.hypot(pd.x - p.x, pd.z - p.z) < 0.35) pd.mesh.scale.setScalar(Math.min(1.3, pd.mesh.scale.x + 0.004));
      else car._puddles[key] = { mesh: this.decal(V(p.x, gy, p.z), V(0, 1, 0), this.fluidMats[key], 0.18), x: p.x, z: p.z };
    }
  }

  bloodHit(p, dir, amount = 1) {
    for (let i = 0; i < 10 * amount; i++) this.blood.emit({ pos: p.clone(), vel: dir.clone().multiplyScalar(1 + Math.random() * 2.5).add(V((Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5)), size: 0.03, grow: 0.05, life: 0.7, color: [0.35, 0.02, 0.02], alpha: 0.95, drag: 1, grav: 9.8 });
    for (let i = 0; i < 2 * amount; i++) this.blood.emit({ pos: p.clone(), vel: dir.clone().multiplyScalar(0.4).add(V(0, 0.2, 0)), size: 0.06, grow: 0.3, life: 0.5, color: [0.4, 0.03, 0.03], alpha: 0.35, drag: 3 });
    // ground pool
    const g = this.game;
    const gy = g.groundHeightAt(p.x, p.z, p.y + 0.5);
    if (p.y - gy < 2) this.decal(V(p.x + dir.x * 0.4, gy, p.z + dir.z * 0.4), V(0, 1, 0), this.bloodMat, 2 + Math.random() * 3);
  }

  extinguish(car) {
    const p = car.type.POINTS.engine.clone().applyMatrix4(car.root.matrixWorld);
    for (let i = 0; i < 40; i++) this.smoke.emit({ pos: p.clone().add(V((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8)), vel: V((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2), size: 0.3, grow: 1.6, life: 2, color: [0.92, 0.92, 0.92], alpha: 0.5, drag: 1.5 });
  }

  // ------------------------------------------------------------------ weather / ambience
  // A strike: usually far over the land, now and then close enough to light the car up and shake
  // the ground (the steel cab is safe; standing out in the open near it is not). Forked channel
  // with a glow, two or three return strokes, a flash of light where it lands.
  lightning(seed) {
    const g = this.game;
    const cam = g.renderer.camera;
    const r = mulberry32(Math.floor(seed * 1e6));
    const near = r() < 0.22;
    const ang = r() * Math.PI * 2;
    const dist = near ? (r() < 0.3 ? 20 + r() * 30 : 50 + r() * 130) : 300 + r() * 1500;
    const base = V(cam.position.x + Math.cos(ang) * dist, 0, cam.position.z + Math.sin(ang) * dist);
    base.y = g.gen.height(base.x + g.origin.x, base.z + g.origin.z);
    const H = near ? 520 : 900;
    const top = base.clone().add(V((r() - 0.5) * 200, H, (r() - 0.5) * 200));
    // a random walk toward the ground: sharp kinks, not a smooth curve
    const channel = (from, to, steps, jag) => {
      const pts = [from.clone()];
      const p = from.clone();
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const aim = from.clone().lerp(to, t);
        p.lerp(aim, 0.55).add(V((r() - 0.5) * jag, (r() - 0.3) * jag * 0.25, (r() - 0.5) * jag));
        pts.push(p.clone());
      }
      pts[pts.length - 1].copy(to);
      return pts;
    };
    const main = channel(top, base, 44, near ? 22 : 34);
    const geos = [tubeAlong(main, near ? 0.35 : 0.7, 4, { closedEnds: false })];
    const glow = [tubeAlong(main, near ? 1.6 : 2.6, 5, { closedEnds: false })];
    // forks that die out in the air
    for (let b = 0; b < 2 + Math.floor(r() * 3); b++) {
      const k = 3 + Math.floor(r() * (main.length - 8));
      const from = main[k];
      const len = (H / main.length) * (4 + r() * 6);
      const to = from.clone().add(V((r() - 0.5) * len, -len * (0.5 + r() * 0.4), (r() - 0.5) * len));
      geos.push(tubeAlong(channel(from, to, 12, 14), near ? 0.2 : 0.4, 3, { closedEnds: false }));
    }
    if (this.bolt) {
      this.root.remove(this.bolt);
      this.bolt.traverse((o) => o.geometry && o.geometry.dispose());
    }
    const bolt = new THREE.Group();
    // the core far brighter than white, so the bloom spreads it
    bolt.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5.4, 6.5), transparent: true, opacity: 1, fog: false })));
    bolt.add(new THREE.Mesh(mergeGeometries(glow), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.6, 1.2), transparent: true, opacity: 0.25, fog: false, blending: THREE.AdditiveBlending, depthWrite: false })));
    this.bolt = bolt;
    this.root.add(bolt);
    this.boltT = 0.55;
    this.boltLen = 0.55;
    // where it lands: a white-blue flash over the ground, sparks and a puff of smoke
    if (near) {
      if (!this.strikeLight) {
        this.strikeLight = new THREE.PointLight(0xdfe6ff, 0, 600, 1.1);
        this.root.add(this.strikeLight);
        g.lights.add(this.strikeLight);
      }
      this.strikeLight.position.copy(base).add(V(0, 25, 0));
      this.strikeAt = base.clone();
      for (let i = 0; i < 60; i++) this.sparks.emit({ pos: base.clone().add(V(0, 0.3, 0)), vel: V((Math.random() - 0.5) * 14, 3 + Math.random() * 9, (Math.random() - 0.5) * 14), size: 0.12, grow: 0.05, life: 0.6 + Math.random() * 0.8, color: [1, 0.85, 0.6], alpha: 1, drag: 0.6, grav: 9.8 });
      for (let i = 0; i < 10; i++) this.smoke.emit({ pos: base.clone().add(V((Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2)), vel: V((Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5), size: 1.2, grow: 5, life: 5 + Math.random() * 3, color: [0.32, 0.31, 0.3], alpha: 0.4, drag: 0.6, grav: -0.1 });
      // out in the open close to it: the ground current knocks you down
      const pl = g.player;
      if (pl && !pl.seat && !pl.dead) {
        const d = pl.position.distanceTo(base);
        if (d < 14) {
          pl.damage(Math.round((14 - d) * 6), 'lightning');
          g.hud && g.hud.toast('Struck by the ground current', 'warn');
        }
      }
    }
    g.audio && g.audio.thunder(dist);
    return dist;
  }

  spawnDevil(cam) {
    const a = Math.random() * Math.PI * 2;
    const d = 60 + Math.random() * 140;
    const g = this.game;
    const x = cam.position.x + Math.cos(a) * d,
      z = cam.position.z + Math.sin(a) * d;
    this.devils.push({ x, z, vx: (Math.random() - 0.5) * 4, vz: (Math.random() - 0.5) * 4, life: 25 + Math.random() * 20, max: 40, h: 12 + Math.random() * 18, r: 1.5 + Math.random() * 2 });
    void g;
  }

  updateDevils(dt, cam) {
    const g = this.game;
    const env = g.env;
    this.devilTimer -= dt;
    const biome = env.biome;
    if (this.devilTimer <= 0 && this.devils.length < 2 && env.daylight > 0.6 && env.w.rain < 0.1 && (biome === 'dunes' || biome === 'scrub' || biome === 'saltflat' || biome === 'badlands')) {
      this.spawnDevil(cam);
      this.devilTimer = 30 + Math.random() * 50;
    }
    for (const dv of this.devils) {
      dv.life -= dt;
      dv.x += dv.vx * dt;
      dv.z += dv.vz * dt;
      const gy = g.gen.height(dv.x + g.origin.x, dv.z + g.origin.z);
      const strength = Math.min(1, dv.life / 5, (dv.max - dv.life) / 5 + 0.2);
      const n = 40 * dt * strength;
      for (let i = 0; i < n * 4; i++) {
        const h = Math.pow(Math.random(), 1.6) * dv.h;
        const rr = dv.r * (0.4 + h / dv.h * 1.6);
        const ang = Math.random() * Math.PI * 2;
        const px = dv.x + Math.cos(ang) * rr,
          pz = dv.z + Math.sin(ang) * rr;
        const tang = V(-Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(6 + h * 0.4);
        this.dust.emit({ pos: V(px, gy + h, pz), vel: tang.add(V(dv.vx, 2.5, dv.vz)), size: 1.0 + h * 0.08, grow: 3 + h * 0.2, life: 1.2, color: [0.76, 0.64, 0.48], alpha: 0.12 * strength, drag: 0.6, fadeIn: 0.3 });
      }
    }
    this.devils = this.devils.filter((d) => d.life > 0);
  }

  updateWeeds(dt, cam) {
    const g = this.game;
    const env = g.env;
    const want = env.w.dust > 0.4 ? 8 : env.w.wind > 0.3 && env.w.rain < 0.3 ? 4 : 1;
    if (this.weeds.length < want && Math.random() < dt * 0.2) {
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 60;
      const m = new THREE.Mesh(this.twGeos[Math.floor(Math.random() * 3)], this.twMat);
      m.castShadow = true;
      const s = 0.8 + Math.random() * 0.7;
      m.scale.setScalar(s);
      this.root.add(m);
      this.weeds.push({ m, x: cam.position.x + Math.cos(a) * d, z: cam.position.z + Math.sin(a) * d, y: 0, vy: 0, s, life: 60 });
    }
    const wdir = env.windDir;
    for (const w of this.weeds) {
      w.life -= dt;
      const sp = 1.5 + env.w.wind * 5 + env.w.dust * 6;
      w.x += wdir.x * sp * dt;
      w.z += wdir.z * sp * dt;
      const gy = g.gen.height(w.x + g.origin.x, w.z + g.origin.z) + 0.33 * w.s;
      w.vy -= 9.8 * dt;
      w.y += w.vy * dt;
      if (w.y < gy) {
        w.y = gy;
        w.vy = Math.random() < 0.05 ? 2 + Math.random() * 2 : Math.abs(w.vy) * 0.3;
      }
      w.m.position.set(w.x, w.y, w.z);
      w.m.rotation.z -= (sp * dt) / (0.33 * w.s);
      w.m.rotation.y = Math.atan2(wdir.x, wdir.z);
      if (w.life <= 0 || w.m.position.distanceTo(cam.position) > 160) {
        this.root.remove(w.m);
        w.dead = true;
      }
    }
    this.weeds = this.weeds.filter((w) => !w.dead);
  }

  updateBirds(dt, cam) {
    const env = this.game.env;
    const want = env.daylight > 0.5 && env.w.rain < 0.3 ? 3 : 0;
    if (this.birds.length < want && Math.random() < dt * 0.1) {
      const b = makeBird(this.birdMat, 1.6);
      const c = cam.position.clone().add(V((Math.random() - 0.5) * 200, 50 + Math.random() * 40, (Math.random() - 0.5) * 200));
      this.root.add(b);
      this.birds.push({ m: b, c, r: 15 + Math.random() * 20, a: Math.random() * 6, sp: 0.15 + Math.random() * 0.1, life: 120 });
    }
    for (const b of this.birds) {
      b.life -= dt;
      b.a += b.sp * dt;
      const p = V(b.c.x + Math.cos(b.a) * b.r, b.c.y + Math.sin(b.a * 0.7) * 3, b.c.z + Math.sin(b.a) * b.r);
      b.m.position.copy(p);
      b.m.rotation.set(0, -b.a, 0.25);
      const flap = Math.sin(this.t * 3 + b.a * 10);
      const glide = Math.sin(b.a * 3) > 0.2 ? 0.15 : 1;
      const [l, r] = b.m.userData.wings;
      l.rotation.z = flap * 0.35 * glide + 0.08;
      r.rotation.z = -flap * 0.35 * glide - 0.08;
      if (b.life <= 0 || (env.daylight < 0.3 && Math.random() < dt * 0.1)) {
        this.root.remove(b.m);
        b.dead = true;
      }
    }
    this.birds = this.birds.filter((b) => !b.dead);
  }

  updateMeteors(dt, cam) {
    const env = this.game.env;
    if (!env.isNight || env.w.cloud > 0.6) return;
    this.meteorTimer -= dt;
    if (this.meteorTimer <= 0) {
      this.meteorTimer = 6 + Math.random() * 18;
      const a = Math.random() * Math.PI * 2;
      const start = cam.position.clone().add(V(Math.cos(a) * 1200, 700 + Math.random() * 300, Math.sin(a) * 1200));
      const dir = V((Math.random() - 0.5) * 2, -0.35 - Math.random() * 0.3, (Math.random() - 0.5) * 2).normalize();
      const g = new THREE.BufferGeometry().setFromPoints([start, start.clone()]);
      const l = new THREE.Line(g, this.meteorMat.clone());
      l.material.fog = false;
      l.frustumCulled = false;
      this.root.add(l);
      this.meteors.push({ l, p: start, dir, t: 0, dur: 0.8 + Math.random() * 0.8, sp: 500 + Math.random() * 300 });
    }
    for (const m of this.meteors) {
      m.t += dt;
      const head = m.p.clone().addScaledVector(m.dir, m.sp * m.t);
      const tail = m.p.clone().addScaledVector(m.dir, Math.max(0, m.sp * m.t - 140));
      const pos = m.l.geometry.attributes.position;
      pos.setXYZ(0, tail.x, tail.y, tail.z);
      pos.setXYZ(1, head.x, head.y, head.z);
      pos.needsUpdate = true;
      m.l.material.opacity = Math.sin((Math.min(1, m.t / m.dur)) * Math.PI) * 0.9;
      if (m.t > m.dur) {
        this.root.remove(m.l);
        m.dead = true;
      }
    }
    this.meteors = this.meteors.filter((m) => !m.dead);
  }

  updateMoths(dt) {
    const g = this.game;
    if (!g.env.isNight) return;
    // light sources: car headlights, lanterns, powered POI lamps
    const sources = [];
    const car = g.car;
    if (car && car.lightsOn) sources.push(car.type.POINTS.headlampGlare.clone().add(V(0, 0, 0.4)).applyMatrix4(car.root.matrixWorld));
    if (g.pois) for (const l of g.pois.lightPool) if (l.intensity > 0 && !l.userData.beacon) sources.push(l.position.clone());
    for (const it of g.items.items) if (it.light) sources.push(it.mesh.getWorldPosition(V(0, 0, 0)));
    for (const s of sources) {
      if (s.distanceTo(g.renderer.camera.position) > 40) continue;
      if (Math.random() < dt * 8) {
        const a = Math.random() * Math.PI * 2;
        this.moths.emit({ pos: s.clone().add(V(Math.cos(a) * 0.5, (Math.random() - 0.5) * 0.4, Math.sin(a) * 0.5)), vel: V(-Math.sin(a) * 1.5, (Math.random() - 0.5) * 0.6, Math.cos(a) * 1.5), size: 0.035, grow: 0.035, life: 3 + Math.random() * 3, color: [1.0, 0.95, 0.8], alpha: 0.9, drag: 0.1, spin: 0 });
      }
    }
    // jitter towards the light
    for (const p of this.moths.parts) {
      if (p.life <= 0) continue;
      p.vx += (Math.random() - 0.5) * 12 * dt;
      p.vy += (Math.random() - 0.5) * 12 * dt;
      p.vz += (Math.random() - 0.5) * 12 * dt;
    }
  }

  // Dust motes: a few specks drifting in the air around you, lit up when you look toward the sun.
  updateMotes(dt, cam) {
    const env = this.game.env;
    if (env.isNight || env.w.rain > 0.1 || env.sunDir.y < 0.02) return;
    const fwd = moteFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const facing = THREE.MathUtils.smoothstep(fwd.dot(env.sunDir), 0.35, 0.9);
    if (facing <= 0) return;
    const n = dt * 26 * facing * (1 + env.w.dust * 2);
    const count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    const c = env.sun.color;
    for (let i = 0; i < count; i++) {
      const r = 0.8 + Math.random() * 4.5;
      motePos.copy(fwd).multiplyScalar(r).add(cam.position);
      motePos.x += (Math.random() - 0.5) * r;
      motePos.y += (Math.random() - 0.5) * r * 0.7;
      motePos.z += (Math.random() - 0.5) * r;
      moteVel.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.3) * 0.08, (Math.random() - 0.5) * 0.12);
      this.moths.emit({ pos: motePos, vel: moteVel, size: 0.008 + Math.random() * 0.01, grow: 0.012, life: 3 + Math.random() * 4, color: [c.r, c.g * 0.95, c.b * 0.85], alpha: 0.35 * facing, drag: 0.4, spin: 0, fadeIn: 0.3 });
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    this.t += dt;
    const g = this.game;
    const cam = g.renderer.camera;
    const amb = g.env.hemi.color.clone().multiplyScalar(0.6 + g.env.daylight * 0.6).add(g.env.sun.color.clone().multiplyScalar(g.env.sun.intensity * 0.12));
    for (const p of [this.dust, this.smoke, this.blood, this.splashes, this.column]) p.mat.uniforms.uAmbient.value.copy(amb);
    const scale = (window.innerHeight * g.renderer.renderer.getPixelRatio()) / (2 * Math.tan(((cam.fov / 2) * Math.PI) / 180));
    for (const p of [this.dust, this.smoke, this.fire, this.sparks, this.blood, this.moths, this.splashes, this.column]) {
      p.mat.uniforms.uScale.value = scale;
      p.update(dt);
    }
    if (g.car) {
      this.wheelDust(g.car, dt);
      this.exhaust(g.car, dt);
      this.engineSmoke(g.car, dt);
      this.leaks(g.car, dt);
    }
    // flash decay
    this.flashT -= dt;
    if (this.flashT <= 0) {
      this.flashLight.intensity *= Math.exp(-dt * 30);
      this.flashSprite.visible = false;
    }
    this.flashSprite.material.uniforms.uA.value *= Math.exp(-dt * 40);
    // tracers
    for (const t of this.tracers) {
      t.t += dt;
      const head = Math.min(1, (t.t * 400) / Math.max(1, t.len));
      const tail = Math.max(0, head - 12 / Math.max(1, t.len));
      const pos = t.l.geometry.attributes.position;
      const a = t.a.clone().lerp(t.b, tail),
        b = t.a.clone().lerp(t.b, head);
      pos.setXYZ(0, a.x, a.y, a.z);
      pos.setXYZ(1, b.x, b.y, b.z);
      pos.needsUpdate = true;
      t.l.material.opacity = head >= 1 ? Math.max(0, 0.9 - (t.t - t.len / 400) * 8) : 0.9;
      if (t.l.material.opacity <= 0) {
        this.root.remove(t.l);
        t.dead = true;
      }
    }
    this.tracers = this.tracers.filter((t) => !t.dead);
    // casings
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.v.y -= 9.8 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.spin.x * dt;
      c.m.rotation.y += c.spin.y * dt;
      const gy = g.groundHeightAt(c.m.position.x, c.m.position.z, c.m.position.y + 0.3);
      if (c.m.position.y < gy + 0.005) {
        c.m.position.y = gy + 0.005;
        c.v.multiplyScalar(0.3);
        c.v.y = Math.abs(c.v.y) * 0.4;
        c.spin.multiplyScalar(0.5);
        if (c.v.length() < 0.2 && !c.clinked) {
          c.clinked = true;
          g.audio && g.audio.play('click', { at: c.m.position, volume: 0.25, rate: 1.4 });
        }
      }
    }
    // lightning
    if (this.bolt) {
      this.boltT -= dt;
      // return strokes: bright, dim, bright again, fading
      const t = 1 - this.boltT / this.boltLen;
      const pulse = Math.max(0, 1 - t * 1.4) * (t < 0.12 || (t > 0.3 && t < 0.4) || (t > 0.58 && t < 0.64) ? 1 : 0.25) * (0.75 + 0.25 * Math.random());
      this.bolt.children[0].material.opacity = pulse;
      this.bolt.children[1].material.opacity = pulse * 0.25;
      if (this.strikeLight && this.strikeAt) this.strikeLight.intensity = pulse * 1500;
      if (this.boltT <= 0) {
        this.root.remove(this.bolt);
        this.bolt.traverse((o) => o.geometry && o.geometry.dispose());
        this.bolt = null;
        if (this.strikeLight) this.strikeLight.intensity = 0;
        this.strikeAt = null;
      }
    }
    // breath fogs in the cold air
    const pl = g.player;
    if (pl && !pl.dead && !pl.seat && g.env.airTemp() < 3) {
      this.breathT = (this.breathT || 0) - dt;
      if (this.breathT <= 0) {
        this.breathT = 3 + Math.random() * 1.5;
        const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion);
        for (let i = 0; i < 4; i++)
          this.smoke.emit({ pos: cam.position.clone().addScaledVector(fwd, 0.22).add(V(0, -0.09, 0)), vel: fwd.clone().multiplyScalar(0.35 + Math.random() * 0.2).add(V((Math.random() - 0.5) * 0.08, 0.06, (Math.random() - 0.5) * 0.08)), size: 0.04, grow: 0.35, life: 1.1 + Math.random() * 0.4, color: [0.95, 0.96, 0.98], alpha: 0.16, drag: 1.4, grav: -0.05, fadeIn: 0.15 });
      }
    }
    // in the snowy north it comes down as flakes
    const snowing = g.env.snowing;
    this.updateRain(dt, cam, snowing ? 0 : g.env.w.rain, g.env.w.wind);
    this.updateSnow(dt, cam, snowing ? g.env.w.rain : 0, g.env.w.wind);
    this.updateDevils(dt, cam);
    this.updateWeeds(dt, cam);
    this.updateBirds(dt, cam);
    this.updateMeteors(dt, cam);
    this.updateMoths(dt);
    this.updateMotes(dt, cam);
    // rain on the glass of the car you are near
    GLASS_RAIN.time.value += dt;
    const wetGlass = g.env.snowing ? 0 : g.env.w.rain;
    GLASS_RAIN.rain.value += ((wetGlass > 0.05 ? Math.min(1, 0.35 + wetGlass) : 0) - GLASS_RAIN.rain.value) * Math.min(1, dt * (g.env.w.rain > 0.05 ? 0.25 : 0.04));
    GLASS_RAIN.speed.value = g.car ? Math.abs(g.car.dyn.speed) : 0;
    GLASS_RAIN.wipe.value += ((g.car && g.car.wipers ? 1 : 0) - GLASS_RAIN.wipe.value) * Math.min(1, dt * 2);
    // sandstorm: billows of dust and fast streaks of sand driven along the wind, born upwind of
    // the camera so they stream through the view; dust settles on the car's glass
    const dust = g.env.w.dust;
    const wd = g.env.windDir;
    if (dust > 0.2) {
      const day = 0.25 + 0.75 * g.env.daylight;
      const col = [0.66 * day, 0.5 * day, 0.34 * day];
      for (let i = 0, n = dust * 80 * dt; i < n; i++) {
        const side = (Math.random() - 0.5) * 50,
          back = 8 + Math.random() * 30;
        const p = cam.position.clone().add(V(-wd.x * back - wd.z * side, (Math.random() - 0.25) * 7, -wd.z * back + wd.x * side));
        const sp = 11 + Math.random() * 8;
        this.dust.emit({ pos: p, vel: V(wd.x * sp, (Math.random() - 0.4) * 1.2, wd.z * sp), size: 2.5 + Math.random() * 2, grow: 7, life: 3, color: col, alpha: 0.13 * dust, drag: 0.15, fadeIn: 0.35 });
      }
      for (let i = 0, n = dust * 140 * dt; i < n; i++) {
        const side = (Math.random() - 0.5) * 16,
          back = 4 + Math.random() * 10;
        const p = cam.position.clone().add(V(-wd.x * back - wd.z * side, (Math.random() - 0.5) * 3, -wd.z * back + wd.x * side));
        const sp = 20 + Math.random() * 10;
        this.dust.emit({ pos: p, vel: V(wd.x * sp, (Math.random() - 0.5) * 2, wd.z * sp), size: 0.12, grow: 0.25, life: 0.9, color: [col[0] * 1.2, col[1] * 1.2, col[2] * 1.2], alpha: 0.35 * dust, drag: 0.1, fadeIn: 0.1 });
      }
    }
    const coat = dust > 0.35 ? 1 : 0;
    GLASS_RAIN.dust.value += (coat - GLASS_RAIN.dust.value) * Math.min(1, dt * (coat ? 0.03 : 0.004 + g.env.w.rain * 0.2));
    const wiping = g.car && g.car.wipers;
    GLASS_RAIN.dustFront.value = wiping ? Math.max(0, GLASS_RAIN.dustFront.value - dt * 0.8) : GLASS_RAIN.dustFront.value + (GLASS_RAIN.dust.value - GLASS_RAIN.dustFront.value) * Math.min(1, dt * 0.03);
  }

  rebase(dx, dz) {
    for (const p of [this.dust, this.smoke, this.fire, this.sparks, this.blood, this.moths, this.splashes, this.column]) p.rebase(dx, dz);
    for (const d of this.devils) {
      d.x -= dx;
      d.z -= dz;
    }
    for (const w of this.weeds) {
      w.x -= dx;
      w.z -= dz;
    }
    for (const b of this.birds) {
      b.c.x -= dx;
      b.c.z -= dz;
    }
    for (const d of this.decals) {
      d.position.x -= dx;
      d.position.z -= dz;
    }
    for (const c of this.casings) {
      c.m.position.x -= dx;
      c.m.position.z -= dz;
    }
  }
}


// Irregular splatter alpha map: a lumpy central pool, satellite drops and a few streaks.
function splatterTexture(seed) {
  let x = seed;
  const r = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff';
  const blob = (cx, cy, rad) => {
    g.beginPath();
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = rad * (0.75 + r() * 0.45);
      const px = cx + Math.cos(a) * rr,
        py = cy + Math.sin(a) * rr;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
    g.fill();
  };
  for (let i = 0; i < 5; i++) blob(S / 2 + (r() - 0.5) * 22, S / 2 + (r() - 0.5) * 22, 12 + r() * 14);
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2,
      d = 24 + r() * 34;
    blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 1.5 + r() * 4);
  }
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2;
    g.lineWidth = 2 + r() * 3;
    g.strokeStyle = '#fff';
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * 14, S / 2 + Math.sin(a) * 14);
    g.lineTo(S / 2 + Math.cos(a) * (34 + r() * 20), S / 2 + Math.sin(a) * (34 + r() * 20));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
