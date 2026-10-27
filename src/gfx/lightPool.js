// The world's small lights (headlamps, tail, reverse and dome lamps, the player's head torch,
// fires, lanterns, lamps at the places along the road) are proxies: invisible lights that say
// where a light would be and how bright. Each frame the ones that matter most to the camera are
// copied onto a fixed handful of real lights. Every shader so always sees the same number of
// lights (nothing recompiles when a car comes into view or a lantern is lit) and each pixel pays
// for a few lights instead of every lamp in the area. With nothing lit (most of the day) the
// pool switches off entirely, so daylight pixels pay for none.

import * as THREE from 'three';

const _p = new THREE.Vector3();

export class LightPool {
  constructor(scene, { points = 4, spots = 1, shadowSpots = 2 } = {}) {
    this.scene = scene;
    this.proxies = new Set();
    this.points = [];
    this.spots = [];
    this.shadowSpots = [];
    this.cand = [];
    for (let i = 0; i < points; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.name = 'pool-point';
      scene.add(l);
      this.points.push(l);
    }
    const spot = (shadow) => {
      const l = new THREE.SpotLight(0xffffff, 0, 10, 0.6, 0.5, 1.5);
      l.name = shadow ? 'pool-spot-shadow' : 'pool-spot';
      if (shadow) {
        // the headlamps' shadows: each lamp throws its own, like real lamps
        l.castShadow = true;
        l.shadow.mapSize.set(768, 768);
        l.shadow.camera.near = 0.25;
        l.shadow.camera.far = 60;
        l.shadow.bias = -0.0008;
        l.shadow.normalBias = 0.03;
        l.shadow.autoUpdate = false;
        l.shadow.needsUpdate = true;
      }
      scene.add(l, l.target);
      return l;
    };
    for (let i = 0; i < spots; i++) this.spots.push(spot(false));
    for (let i = 0; i < shadowSpots; i++) this.shadowSpots.push(spot(true));
    this.all = [...this.points, ...this.spots, ...this.shadowSpots];
    this.idle = 0;
    this.setActive(false);
  }

  // The pool's lights stay in the scene (dark when not in use) whatever is lit: a light that comes
  // or goes changes the count every lit shader is built for, and all of them would compile anew
  // (a freeze each time a lamp, a lantern or the headlights came on). Only the work is skipped.
  setActive(on) {
    this.active = on;
    for (const l of this.all) l.visible = true;
  }

  // Compiles the scene's shaders for the pool both off and on (while loading), so the first lamp
  // to light up does not stall the game. `target` is the render target the scene is drawn into;
  // `extra` holds things not in the scene yet that should be ready too (lit by the scene's lights).
  warm(renderer, camera, target, extra = null) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    for (const on of [true, false]) {
      this.setActive(on);
      renderer.compile(this.scene, camera);
      if (extra) renderer.compile(extra, camera, this.scene);
    }
    renderer.setRenderTarget(prev);
    this.idle = 0;
  }

  // Makes `light` a proxy. It stays where it is in the scene graph (so it moves with its car or
  // lantern) and keeps being switched by its owner; `shadow` lets it take a shadow-casting slot.
  add(light, { shadow = false } = {}) {
    light.visible = false;
    light.castShadow = false;
    light.userData.poolShadow = shadow;
    this.proxies.add(light);
    return light;
  }

  remove(light) {
    if (light) this.proxies.delete(light);
  }

  // Picks the brightest proxies near the camera for the real lights. Call once a frame before
  // rendering.
  update(camera) {
    const cam = camera.getWorldPosition(_p).clone();
    const cand = this.cand;
    cand.length = 0;
    for (const l of this.proxies) {
      if (!(l.intensity > 0)) continue;
      // only proxies in the scene under visible parents (a parked car far away is hidden)
      let o = l.parent,
        shown = true;
      while (o && o.parent) {
        if (!o.visible) shown = false;
        o = o.parent;
      }
      if (o !== this.scene || !shown) continue;
      l.updateWorldMatrix(true, false);
      _p.setFromMatrixPosition(l.matrixWorld);
      const range = l.distance || 60;
      const d = _p.distanceTo(cam);
      if (d > range + 150) continue;
      const k = d / range;
      cand.push({ l, score: (l.intensity * (l.isSpotLight ? 2 : 1)) / (1 + k * k) });
    }
    // on as soon as anything is lit, off after a couple of seconds of nothing
    if (cand.length) {
      this.idle = 0;
      if (!this.active) this.setActive(true);
    } else if (this.active && ++this.idle > 120) this.setActive(false);
    cand.sort((a, b) => b.score - a.score);
    let pi = 0,
      si = 0,
      ss = 0;
    for (const { l } of cand) {
      if (l.isPointLight) {
        if (pi < this.points.length) this.copy(this.points[pi++], l);
      } else if (l.userData.poolShadow && ss < this.shadowSpots.length) this.copy(this.shadowSpots[ss++], l);
      else if (si < this.spots.length) this.copy(this.spots[si++], l);
      else if (ss < this.shadowSpots.length) this.copy(this.shadowSpots[ss++], l);
    }
    for (; pi < this.points.length; pi++) this.points[pi].intensity = 0;
    for (; si < this.spots.length; si++) this.spots[si].intensity = 0;
    for (; ss < this.shadowSpots.length; ss++) {
      this.shadowSpots[ss].intensity = 0;
      this.shadowSpots[ss].shadow.autoUpdate = false;
    }
  }

  copy(dst, src) {
    dst.position.setFromMatrixPosition(src.matrixWorld);
    dst.color.copy(src.color);
    dst.intensity = src.intensity;
    dst.distance = src.distance;
    dst.decay = src.decay;
    if (src.isSpotLight) {
      src.target.updateWorldMatrix(true, false);
      dst.target.position.setFromMatrixPosition(src.target.matrixWorld);
      dst.angle = src.angle;
      dst.penumbra = src.penumbra;
      if (dst.castShadow) dst.shadow.autoUpdate = true;
    }
  }
}
