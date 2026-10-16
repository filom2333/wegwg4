// Rivers and lakes: water surfaces streamed around the player (ribbons along each river's
// meandering course, discs for lakes), an animated water material that reflects the sky and
// fades into the shallows, and ice in the frozen north (walkable, slippery, with a collider).

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';

const RANGE = 1500; // how far around the player water is built
const RIVER_HALF_LEN = 1100; // river ribbon extent either side of the road

export class Water {
  constructor() {
    this.items = new Map(); // key -> { mesh, body }
  }

  init(game) {
    this.g = game;
    this.group = new THREE.Group();
    this.group.name = 'water';
    game.worldGroup.add(this.group);
    this.waterMat = waterMaterial(false);
    this.iceMat = waterMaterial(true);
    this.t = 0;
  }

  update(dt) {
    const g = this.g;
    if (!g || !g.gen) return;
    this.t += dt;
    this.waterMat.userData.uniforms.uTime.value = this.t;
    this.waterMat.userData.uniforms.uWind.value = g.env ? g.env.w.wind : 0.3;
    // stream (a few times a second is plenty)
    this.acc = (this.acc || 0) + dt;
    if (this.acc < 0.5 && this.items.size) return;
    this.acc = 0;
    const f = g.focusPoint();
    const gx = f.x + g.origin.x,
      gz = f.z + g.origin.z;
    const want = new Set();
    for (const r of g.gen.riversNear(gz, 1)) {
      if (r.dry || Math.abs(r.zr - gz) > RANGE + 300) continue;
      const key = 'r' + r.k;
      want.add(key);
      if (!this.items.has(key)) this.items.set(key, this.buildRiver(r));
    }
    for (const l of g.gen.lakesNear(gz, 2)) {
      if (Math.hypot(l.x - gx, l.z - gz) > RANGE) continue;
      const key = 'l' + l.k;
      want.add(key);
      if (!this.items.has(key)) this.items.set(key, this.buildLake(l));
    }
    for (const [k, it] of this.items) {
      if (want.has(k)) continue;
      this.group.remove(it.mesh);
      it.mesh.geometry.dispose();
      if (it.body) g.physics.removeBody(it.body);
      this.items.delete(k);
    }
  }

  // Ribbon along the river's course, a little wider than the channel so the banks hide its edge.
  buildRiver(r) {
    const g = this.g;
    const gen = g.gen;
    const xr = gen.roadX(r.zr);
    const step = 5;
    const n = Math.ceil((2 * RIVER_HALF_LEN) / step);
    const across = [-1.15, -0.8, -0.4, 0, 0.4, 0.8, 1.15];
    const na = across.length;
    const pos = new Float32Array((n + 1) * na * 3);
    const uv = new Float32Array((n + 1) * na * 2);
    const edge = new Float32Array((n + 1) * na);
    const o = g.origin;
    const ox = xr,
      oz = r.zr;
    let along = 0;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const x = xr - RIVER_HALF_LEN + i * step;
      const z = gen.riverZ(r, x);
      const e = 1.5;
      const tx = 2 * e,
        tz = gen.riverZ(r, x + e) - gen.riverZ(r, x - e);
      const tl = Math.hypot(tx, tz);
      const px = -tz / tl,
        pz = tx / tl; // across the flow
      const info = gen.riverAt(x, z);
      const level = info ? info.level : r.level;
      if (prev) along += Math.hypot(x - prev[0], z - prev[1]);
      prev = [x, z];
      for (let j = 0; j < na; j++) {
        const a = across[j] * r.w;
        const k = i * na + j;
        pos[k * 3] = x + px * a - ox;
        pos[k * 3 + 1] = level;
        pos[k * 3 + 2] = z + pz * a - oz;
        uv[k * 2] = along;
        uv[k * 2 + 1] = a;
        edge[k] = Math.min(1, Math.abs(across[j]));
      }
    }
    const idx = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < na - 1; j++) {
        const a = i * na + j,
          b = a + 1,
          c = a + na + 1,
          d = a + na;
        idx.push(a, b, d, b, c, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('edge', new THREE.BufferAttribute(edge, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // keep the up normal (the ribbon is nearly flat; tiny slopes would tilt reflections)
    const nr = geo.attributes.normal;
    for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, r.frozen ? this.iceMat : this.waterMat);
    mesh.position.set(ox - o.x, 0.0, oz - o.z);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    let body = null;
    if (r.frozen) body = this.iceCollider(geo, mesh.position);
    return { mesh, body };
  }

  buildLake(l) {
    const g = this.g;
    const gen = g.gen;
    const rings = 10,
      segs = 64;
    const pos = [],
      uv = [],
      edge = [];
    const o = g.origin;
    // the shoreline distance is warped; march outward until the wobbly edge (lakeDist = 1)
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        // find the shoreline radius along this direction
        const c = Math.cos(l.rot),
          s = Math.sin(l.rot);
        const u = Math.cos(a),
          v = Math.sin(a);
        // local ellipse frame -> world
        const dx = u * l.rx * c + v * l.rz * s,
          dz = -u * l.rx * s + v * l.rz * c;
        let lo = 0.2,
          hi = 2;
        for (let k = 0; k < 14; k++) {
          const m = (lo + hi) / 2;
          if (gen.lakeDist(l, l.x + dx * m, l.z + dz * m) < 1) lo = m;
          else hi = m;
        }
        const rr = lo * 1.04 * t;
        pos.push(dx * rr, l.level, dz * rr);
        uv.push(l.x + dx * rr, l.z + dz * rr);
        edge.push(t);
      }
    }
    const idx = [];
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < segs; j++) {
        const a = i * segs + j,
          b = i * segs + ((j + 1) % segs),
          c = (i + 1) * segs + ((j + 1) % segs),
          d = (i + 1) * segs + j;
        idx.push(a, d, b, b, d, c);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
    geo.setIndex(idx);
    const nr = new Float32Array(pos.length);
    for (let i = 1; i < nr.length; i += 3) nr[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, l.frozen ? this.iceMat : this.waterMat);
    mesh.position.set(l.x - o.x, 0, l.z - o.z);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    let body = null;
    if (l.frozen) body = this.iceCollider(geo, mesh.position);
    return { mesh, body };
  }

  // Ice you can walk and drive on.
  iceCollider(geo, at) {
    const ph = this.g.physics;
    const body = ph.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(at.x, at.y, at.z));
    const v = new Float32Array(geo.attributes.position.array);
    const c = ph.world.createCollider(RAPIER.ColliderDesc.trimesh(v, new Uint32Array(geo.index.array)).setFriction(0.08).setCollisionGroups(GROUPS.world), body);
    ph.setOwner(c, { kind: 'terrain', surface: 'ice' });
    return body;
  }

  rebase(dx, dz) {
    for (const it of this.items.values()) {
      it.mesh.position.x -= dx;
      it.mesh.position.z -= dz;
    }
  }
}

// Water: deep teal with sky reflections from the environment map, animated ripples flowing along
// the river (or wind-driven on lakes), clearer and lighter toward the shallows at the edges.
// Ice: pale blue-white with frosted patches and a crack network.
function waterMaterial(frozen) {
  const m = new THREE.MeshStandardMaterial({
    color: frozen ? 0xcfe0ea : 0x1d4a52,
    roughness: frozen ? 0.2 : 0.04,
    metalness: frozen ? 0 : 0.0,
    transparent: !frozen,
    opacity: 1,
    envMapIntensity: frozen ? 0.8 : 1.25,
  });
  m.userData.uniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float edge;\nvarying float vEdge;\nvarying vec2 vWuv;\nvarying vec3 vWP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvEdge = edge;\nvWuv = uv;\nvWP = (modelMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uWind;
varying float vEdge;
varying vec2 vWuv;
varying vec3 vWP;
float wh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wn(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(wh(i), wh(i+vec2(1,0)), f.x), mix(wh(i+vec2(0,1)), wh(i+vec2(1,1)), f.x), f.y); }
vec2 wGrad(vec2 p){ float e = 0.05; return vec2(wn(p+vec2(e,0.0))-wn(p-vec2(e,0.0)), wn(p+vec2(0.0,e))-wn(p-vec2(0.0,e))) / (2.0*e); }
vec3 gWN;`
      )
      .replace(
        '#include <color_fragment>',
        frozen
          ? `#include <color_fragment>
{
  // frost patches and a crack network on the ice
  vec2 p = vWP.xz * 0.35;
  float frost = smoothstep(0.35, 0.75, wn(p * 0.6) * 0.7 + wn(p * 2.3) * 0.3);
  vec2 c = vWP.xz * 0.6;
  vec2 ci = floor(c); vec2 cf = fract(c);
  float d1 = 9.0, d2 = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 q = o + vec2(wh(ci + o), wh(ci + o + 17.0)) - cf;
    float d = dot(q, q);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  float crack = 1.0 - smoothstep(0.0, 0.05, sqrt(d2) - sqrt(d1));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.97, 1.0), frost * 0.75);
  diffuseColor.rgb *= 1.0 - crack * 0.35 * (1.0 - frost);
  gWN = vec3(0.0, 1.0, 0.0);
}`
          : `#include <color_fragment>
{
  // ripples: two noise layers drifting along the flow / with the wind
  vec2 p = vWuv;
  float sp = 0.6 + uWind;
  vec2 g1 = wGrad(vec2(p.x * 0.35 - uTime * sp * 0.6, p.y * 0.5));
  vec2 g2 = wGrad(vec2(p.x * 1.1 - uTime * sp * 1.3 + 3.1, p.y * 1.4 + uTime * 0.2));
  vec2 g3 = wGrad(vWP.xz * 2.2 + vec2(uTime * 0.7, -uTime * 0.5));
  vec2 slope = g1 * 0.05 + g2 * 0.03 + g3 * 0.012 * (0.5 + uWind);
  gWN = normalize(vec3(-slope.x, 1.0, -slope.y));
  // shallows: lighter, more transparent toward the banks
  float shallow = smoothstep(0.55, 1.0, vEdge);
  diffuseColor.rgb = mix(vec3(0.07, 0.2, 0.22), vec3(0.32, 0.4, 0.33), shallow);
  diffuseColor.a = mix(0.93, 0.0, smoothstep(0.82, 1.0, vEdge));
}`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(gWN, 0.0)).xyz);`
      );
  };
  m.customProgramCacheKey = () => (frozen ? 'ice-v1' : 'water-v1');
  return m;
}
