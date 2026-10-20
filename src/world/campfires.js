// Campfires the player lights from a kit: a ring of stones round a few crossed logs, flames and
// smoke from the effects pools, a flickering warm light. A fire burns for a few game hours, warms
// whoever stands close and cooks meat held over it.

import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BURN_HOURS = 3;

let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    stone: new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.95, flatShading: true }),
    log: new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9 }),
    char: new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 1, emissive: 0xff5a1a, emissiveIntensity: 0 }),
    ash: new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 1 }),
  };
  return MATS;
}

function buildFire(seed) {
  const M = mats();
  const rnd = mulberry32(seed);
  const g = new THREE.Group();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.2;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11 + rnd() * 0.05, 0), M.stone);
    s.position.set(Math.cos(a) * 0.48, 0.05, Math.sin(a) * 0.48);
    s.scale.set(1, 0.6 + rnd() * 0.3, 1);
    s.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    s.castShadow = s.receiveShadow = true;
    g.add(s);
  }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.36, 16).rotateX(-Math.PI / 2), M.ash);
  ash.position.y = 0.012;
  g.add(ash);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.62, 7), i % 2 ? M.log : M.char);
    log.rotation.z = Math.PI / 2 - 0.45;
    log.rotation.y = a;
    log.position.set(Math.cos(a) * 0.12, 0.13, Math.sin(a) * 0.12);
    log.castShadow = true;
    g.add(log);
  }
  return g;
}

export class Campfires {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    this.group.name = 'campfires';
    game.worldGroup.add(this.group);
    this.light = new THREE.PointLight(0xff9a4a, 0, 14, 1.6);
    this.light.castShadow = false;
    this.group.add(this.light);
  }

  // Lights a fire at a point on the ground (scene coordinates).
  kindle(pos) {
    const root = buildFire(this.list.length * 13 + 7);
    root.position.copy(pos);
    this.group.add(root);
    const f = { root, pos: pos.clone(), hours: BURN_HOURS, t: 0 };
    this.list.push(f);
    this.game.audio && this.game.audio.play('ignite', { at: pos, volume: 0.6 });
    return f;
  }

  // Extra air warmth (°C) a fire gives at a point: strong close in, nothing beyond ~6 m.
  heatAt(p) {
    let h = 0;
    for (const f of this.list) {
      if (f.hours <= 0) continue;
      const d = f.pos.distanceTo(p);
      h = Math.max(h, 24 * Math.max(0, 1 - d / 6) * Math.min(1, f.hours * 2));
    }
    return h;
  }

  // A burning fire within reach of a point, or null.
  near(p, r = 2.2) {
    for (const f of this.list) if (f.hours > 0 && f.pos.distanceTo(p) < r) return f;
    return null;
  }

  update(dt) {
    const g = this.game;
    const fx = g.effects;
    const hours = g.gameHoursDelta || 0;
    let best = null,
      bd = Infinity;
    const cam = g.renderer.camera.position;
    for (const f of this.list) {
      if (f.hours <= 0) continue;
      f.hours -= hours;
      f.t += dt;
      const k = Math.min(1, f.hours * 2);
      const rain = g.env.w.rain;
      if (rain > 0.5) f.hours -= hours * rain;
      if (fx) {
        if (Math.random() < dt * 26 * k)
          fx.fire.emit({ pos: f.pos.clone().add(V((Math.random() - 0.5) * 0.3, 0.12, (Math.random() - 0.5) * 0.3)), vel: V((Math.random() - 0.5) * 0.15, 0.9 + Math.random() * 0.6, (Math.random() - 0.5) * 0.15), size: 0.32, grow: 0.08, life: 0.5 + Math.random() * 0.4, color: [1.0, 0.5 + Math.random() * 0.2, 0.15], alpha: 0.9, drag: 1.2, grav: -0.6 });
        if (Math.random() < dt * 4)
          fx.smoke.emit({ pos: f.pos.clone().add(V(0, 0.6, 0)), vel: V((Math.random() - 0.5) * 0.2, 0.7, (Math.random() - 0.5) * 0.2), size: 0.35, grow: 2.2, life: 4, color: [0.42, 0.41, 0.4], alpha: 0.18, drag: 0.5, grav: -0.15 });
        if (Math.random() < dt * 3 * k)
          fx.sparks.emit({ pos: f.pos.clone().add(V(0, 0.3, 0)), vel: V((Math.random() - 0.5) * 0.6, 1.6 + Math.random(), (Math.random() - 0.5) * 0.6), size: 0.03, grow: 0.02, life: 1.2, color: [1, 0.6, 0.25], alpha: 1, drag: 0.6, grav: 0.4 });
      }
      for (const c of f.root.children) if (c.material === mats().char) c.material.emissiveIntensity = 1.4 * k * (0.8 + 0.3 * Math.sin(f.t * 9));
      const d = f.pos.distanceTo(cam);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    // one shared light visits the nearest fire
    if (best && bd < 120) {
      const k = Math.min(1, best.hours * 2);
      this.light.position.copy(best.pos).add(V(0, 0.6, 0));
      this.light.intensity = 9 * k * (0.85 + 0.15 * Math.sin(best.t * 13) * Math.sin(best.t * 7.3));
    } else this.light.intensity = 0;
    // burnt out fires stay as a ring of stones round the ash for a while, then go
    this.list = this.list.filter((f) => {
      if (f.hours > -6) return true;
      this.group.remove(f.root);
      return false;
    });
  }

  rebase(dx, dz) {
    for (const f of this.list) {
      f.pos.x -= dx;
      f.pos.z -= dz;
      f.root.position.copy(f.pos);
    }
  }
}
