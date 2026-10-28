// Where sounds are. Every sound placed in the world goes through a voice: 3D panning (HRTF for
// headphones, so a sound is in front, behind, above), the air taking the top off far sounds, a
// wall, a hill or a house between you and the sound muffling it, the car's cabin or the tent
// closing the world out, and the space answering: a small room indoors, far echoes off the land
// in the open, dense scattering in the woods. The echoes do not fall off with distance the way
// the direct sound does, so far sounds come back mostly as their echoes - which is how the ear
// tells near from far.

import * as THREE from 'three';
import { G, groups } from '../physics/physics.js';
import { settings } from '../core/settings.js';

// what stops sound: the ground, buildings, rocks (not cars, items or people)
const OCCLUDERS = groups(0xffff, G.WORLD);
const V = new THREE.Vector3();
const D = new THREE.Vector3();
const set = (param, v, now, tc = 0.06) => param.setTargetAtTime(v, now, tc);

export class Space {
  constructor(audio) {
    const a = (this.a = audio);
    const c = (this.ctx = a.ctx);
    this.listener = new THREE.Vector3();
    this.tracked = new Set();
    this.panners = new Set();
    this.indoors = 0;
    this.forest = 0;
    // the echo returns: everything placed sends into this, the three spaces take from it
    this.send = c.createGain();
    const space = (ir, gain) => {
      const cv = c.createConvolver();
      cv.buffer = ir;
      const g = c.createGain();
      g.gain.value = gain;
      this.send.connect(cv).connect(g).connect(a.master);
      return g;
    };
    this.room = space(roomIR(c), 0);
    this.open = space(openIR(c), 1);
    this.woods = space(woodsIR(c), 0);
    this.t = 0;
    settings.onChange(() => this.applyModel());
  }

  get model() {
    return settings.data.sound3d === 'speakers' ? 'equalpower' : 'HRTF';
  }

  applyModel() {
    for (const p of this.panners) p.panningModel = this.model;
  }

  // A chain for one source: input -> [air/wall/cabin low-pass] -> [level] -> panner -> bus, with an
  // echo send. opts: ref (m, full level within), rolloff, bus, wet (echo send scale), own (the
  // player's own car: no cabin muffling), track (a function giving the position each frame).
  voice(opts = {}) {
    const c = this.ctx;
    const v = new Voice(this, opts);
    v.lp = c.createBiquadFilter();
    v.lp.type = 'lowpass';
    v.lp.frequency.value = 20000;
    v.lp.Q.value = 0.5;
    v.level = c.createGain();
    v.p = c.createPanner();
    v.p.panningModel = this.model;
    v.p.distanceModel = 'inverse';
    v.p.refDistance = opts.ref ?? 2;
    v.p.rolloffFactor = opts.rolloff ?? 1;
    v.p.maxDistance = 10000;
    v.input = c.createGain();
    v.input.connect(v.lp).connect(v.level).connect(v.p).connect(opts.bus || this.a.sfx);
    v.wetG = c.createGain();
    v.wetG.gain.value = 0;
    v.level.connect(v.wetG).connect(this.send);
    this.panners.add(v.p);
    if (opts.track) this.tracked.add(v);
    return v;
  }

  // How much of the way to `pos` is blocked (0 open, 0.5 partly, 1 behind something solid): two
  // rays, to the source and to a point above it, so a low wall or a dune only half-hides it.
  occlusion(pos) {
    const ph = this.a.game.physics;
    if (!ph) return 0;
    let hits = 0;
    for (const up of [0.6, 2.6]) {
      D.set(pos.x, pos.y + up, pos.z).sub(this.listener);
      const d = D.length();
      if (d < 1.2) return 0;
      D.divideScalar(d);
      if (ph.raycast(this.listener, D, d - 0.7, OCCLUDERS)) hits++;
    }
    return hits / 2;
  }

  // The player's shelter (the car they sit in, or the tent), if any: { at, r, k }.
  shelter() {
    const a = this.a,
      g = a.game,
      p = g.player;
    if (!p || a.inCabin < 0.02) return null;
    if (p.seat && p.car) return { at: p.car.root.position, r: 2.4, k: a.inCabin };
    return { at: p.position, r: 1.6, k: a.inCabin };
  }

  // Low-pass cutoff and level for a source at `pos` heard from the listener now.
  shape(pos, occ, own) {
    const d = V.copy(pos).distanceTo(this.listener);
    // air: 20 m keeps nearly everything, 100 m loses the sparkle, 300 m is a dull thud
    let f = 20000 / (1 + d / 40);
    let k = 1;
    if (occ > 0) {
      f = Math.min(f, 20000 * Math.pow(0.035, occ));
      k *= 1 - 0.5 * occ;
    }
    const sh = !own && this.shelter();
    if (sh && pos.distanceTo(sh.at) > sh.r) {
      f = Math.min(f, 20000 - sh.k * 18800);
      k *= 1 - 0.45 * sh.k;
    }
    // the echo: louder indoors, and it stays while the direct sound fades with distance
    const wet = (this.indoors > 0.5 ? 0.3 : 0.14) / (1 + d / 350);
    return { f: Math.max(500, f), k, wet, d };
  }

  // Called each frame from the audio update with the camera.
  update(dt, cam, { indoors, forest }) {
    const c = this.ctx,
      now = c.currentTime;
    this.listener.copy(cam.position);
    this.indoors += ((indoors ? 1 : 0) - this.indoors) * Math.min(1, dt * 3);
    this.forest += (forest - this.forest) * Math.min(1, dt * 0.5);
    const out = 1 - this.indoors;
    set(this.room.gain, this.indoors * 1.1, now, 0.3);
    set(this.open.gain, out * (1 - this.forest) + this.indoors * 0.12, now, 0.5);
    set(this.woods.gain, out * this.forest, now, 0.5);
    // tracked sources: move every frame, look for walls between a few times a second
    this.t -= dt;
    const look = this.t <= 0;
    if (look) this.t = 0.25;
    for (const v of this.tracked) {
      const p = v.opts.track();
      if (!p) continue;
      v.place(p, now, false, look);
    }
  }
}

class Voice {
  constructor(space, opts) {
    this.s = space;
    this.opts = opts;
    this.occ = 0;
    this.placed = false;
  }

  // Put the source at `pos` (scene space); instant for a one-shot, smoothed for a moving loop.
  place(pos, now = this.s.ctx.currentTime, instant = true, look = true) {
    const s = this.s;
    if (look || !this.placed) this.occ = this.opts.own && s.a.inCabin > 0.5 ? 0 : s.occlusion(pos);
    const sh = s.shape(pos, this.occ, this.opts.own);
    // (positions are set, never automated: an automated position puts the panner on its slow
    // sample-by-sample path, four times the cost)
    const p = this.p;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    if (instant || !this.placed) {
      this.lp.frequency.value = sh.f;
      this.level.gain.value = sh.k;
      this.wetG.gain.value = sh.wet * (this.opts.wet ?? 1);
    } else if (Math.abs(sh.f - this.f) > this.f * 0.04 || Math.abs(sh.k - this.k) > 0.02 || Math.abs(sh.wet - this.wet) > 0.005) {
      // only on a real change, so the filters are not kept on their per-sample path
      set(this.lp.frequency, sh.f, now, 0.15);
      set(this.level.gain, sh.k, now, 0.15);
      set(this.wetG.gain, sh.wet * (this.opts.wet ?? 1), now, 0.3);
    } else return this;
    this.f = sh.f;
    this.k = sh.k;
    this.wet = sh.wet;
    this.placed = true;
    return this;
  }

  dispose() {
    this.s.panners.delete(this.p);
    this.s.tracked.delete(this);
    this.input.disconnect();
    this.lp.disconnect();
    this.level.disconnect();
    this.wetG.disconnect();
    this.p.disconnect();
  }
}

// ---------------------------------------------------------------- the spaces' impulse responses
function noiseIR(ctx, seconds, fill) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) fill(buf.getChannelData(ch), ctx.sampleRate, ch);
  return buf;
}

// A small furnished room: a few early reflections off the walls, then a short warm tail.
function roomIR(ctx) {
  return noiseIR(ctx, 0.6, (d, sr, ch) => {
    for (const [ms, a] of [
      [4 + ch, 0.7],
      [9 + ch * 2, 0.5],
      [14 - ch, 0.42],
      [21 + ch * 3, 0.3],
      [29 - ch * 2, 0.22],
    ])
      d[Math.floor((ms / 1000) * sr)] += a * (Math.random() < 0.5 ? -1 : 1);
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      lp += (Math.random() * 2 - 1 - lp) * 0.3;
      d[i] += lp * 0.5 * Math.exp(-t * 9) * Math.min(1, t / 0.006);
    }
  });
}

// Open land: a handful of distinct echoes coming back off hills and mesas, the later ones
// weaker and duller, over a faint wash.
function openIR(ctx) {
  return noiseIR(ctx, 2.4, (d, sr) => {
    const taps = 9 + Math.floor(Math.random() * 4);
    for (let k = 0; k < taps; k++) {
      const t = 0.08 + Math.pow(Math.random(), 1.3) * 2.0;
      const amp = 0.55 * Math.exp(-t * 1.4) * (0.4 + Math.random() * 0.6);
      const len = Math.floor(sr * (0.012 + t * 0.02));
      const s0 = Math.floor(t * sr);
      // each echo smeared a little and duller the further it travelled
      const a = Math.max(0.04, 0.5 - t * 0.2);
      let lp = 0;
      for (let i = 0; i < len && s0 + i < d.length; i++) {
        lp += (Math.random() * 2 - 1 - lp) * a;
        d[s0 + i] += lp * amp * Math.exp((-i / len) * 4);
      }
    }
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      lp += (Math.random() * 2 - 1 - lp) * 0.12;
      d[i] += lp * 0.05 * Math.exp(-t * 2.2) * Math.min(1, t / 0.05);
    }
  });
}

// Woods: trunks everywhere scatter the sound into a dense, soft, quick tail.
function woodsIR(ctx) {
  return noiseIR(ctx, 1.4, (d, sr) => {
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      lp += (Math.random() * 2 - 1 - lp) * 0.22;
      d[i] = lp * Math.exp(-t * 4.2) * Math.min(1, t / 0.012);
    }
  });
}
