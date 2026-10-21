// Audio engine: buses, positional one-shots, real-time engine synthesis, tyre/wind/rain loops,
// ambience scheduler and the car radio's generative music.

import * as THREE from 'three';
import { GEN } from './synth.js';
import { Soundscape } from './soundscape.js';
import { settings } from '../core/settings.js';
import { clamp, lerp } from '../core/noise.js';

const STEP_SURF = {
  sand: { cut: 1600, grains: 30, spread: 0.12, body: 0.15 },
  dirt: { cut: 2200, grains: 22, spread: 0.08, body: 0.3 },
  gravel: { cut: 4200, grains: 46, spread: 0.12, body: 0.2 },
  rock: { cut: 3000, grains: 8, spread: 0.03, body: 0.5, bodyF: 140 },
  asphalt: { cut: 2600, grains: 10, spread: 0.03, body: 0.45, bodyF: 110 },
  concrete: { cut: 2800, grains: 9, spread: 0.03, body: 0.45, bodyF: 120 },
  wood: { cut: 1400, grains: 6, spread: 0.02, body: 0.9, bodyF: 95 },
  metal: { cut: 5000, grains: 5, spread: 0.02, body: 0.6, bodyF: 320 },
  salt: { cut: 5200, grains: 40, spread: 0.1, body: 0.15 },
  // soft squeaky crunch of packed snow, a swish through grass, needles underfoot in the forest
  snow: { cut: 2400, grains: 55, spread: 0.16, body: 0.35, bodyF: 260 },
  snowRoad: { cut: 2600, grains: 40, spread: 0.12, body: 0.3, bodyF: 300 },
  grass: { cut: 3600, grains: 34, spread: 0.18, body: 0.08 },
  ice: { cut: 4200, grains: 6, spread: 0.02, body: 0.5, bodyF: 420 },
};

export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.ready = false;
    this.buffers = {};
    this.loops = {};
    this.timers = { amb: 3, radio: 0 };
    this.radioOn = false;
    this.inCabin = 0;
  }

  // Must be called from a user gesture.
  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(this.master);
    // the world outside, muffled indoors and in the cabin (the soundscape moves the cutoff)
    this.ambLP = ctx.createBiquadFilter();
    this.ambLP.type = 'lowpass';
    this.ambLP.frequency.value = 20000;
    this.amb.connect(this.ambLP).connect(this.master);
    this.music.connect(this.master);
    // a small room answering footsteps and doors when indoors
    this.room = ctx.createConvolver();
    this.room.buffer = roomImpulse(ctx);
    this.roomWet = ctx.createGain();
    this.roomWet.gain.value = 0;
    this.sfx.connect(this.room).connect(this.roomWet).connect(this.master);
    this.windGust = 1;
    this.applyVolumes();
    settings.onChange(() => this.applyVolumes());
    await this.buildBuffers();
    this.buildLoops();
    this.scape = new Soundscape(this);
    await this.scape.build(() => new Promise((r) => setTimeout(r, 0)));
    this.ready = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = settings.data;
    this.master.gain.value = s.masterVolume;
    this.sfx.gain.value = s.sfxVolume;
    this.amb.gain.value = s.ambientVolume;
    this.music.gain.value = s.musicVolume;
  }

  async buildBuffers() {
    const c = this.ctx;
    const B = this.buffers;
    const tick = () => new Promise((r) => setTimeout(r, 0));
    B.white = GEN.noise(c, 3, 'white', 1);
    B.pink = GEN.noise(c, 3, 'pink', 2);
    B.brown = GEN.noise(c, 3, 'brown', 3);
    await tick();
    for (const [k, v] of Object.entries(STEP_SURF)) B['step_' + k] = [0, 1, 2].map((i) => GEN.crunch(c, { ...v, len: 0.22, seed: 100 + i * 7 + k.length }));
    await tick();
    B.doorOpen = GEN.thump(c, { f: 90, decay: 0.05, click: 0.8, rattle: 0.2, seed: 3, len: 0.5, noiseCut: 3000 });
    B.doorClose = GEN.thump(c, { f: 60, decay: 0.14, click: 0.6, rattle: 0.35, seed: 4, len: 0.7 });
    B.hood = GEN.thump(c, { f: 55, decay: 0.2, click: 0.5, rattle: 0.5, seed: 5, len: 0.9 });
    B.trunk = GEN.thump(c, { f: 65, decay: 0.16, click: 0.5, rattle: 0.3, seed: 6, len: 0.8 });
    B.doorCreak = GEN.creak(c, { f: 150, len: 1.1 });
    B.doorShut = GEN.thump(c, { f: 80, decay: 0.09, click: 0.5, rattle: 0.1, seed: 8, len: 0.5, noiseCut: 900 });
    B.pickup = [0, 1].map((i) => GEN.crunch(c, { grains: 8, cut: 3000, len: 0.15, seed: 200 + i, body: 0.3, bodyF: 220, spread: 0.03 }));
    B.pickupHeavy = GEN.thump(c, { f: 75, decay: 0.06, click: 0.3, rattle: 0.4, seed: 9, len: 0.4 });
    B.throw = GEN.whoosh(c, { len: 0.3, f0: 300, f1: 1100 });
    B.swing = GEN.whoosh(c, { len: 0.25, f0: 500, f1: 2000, seed: 12 });
    B.pocket = GEN.crunch(c, { grains: 14, cut: 2400, len: 0.2, seed: 33, spread: 0.12 });
    await tick();
    B.click = GEN.metal(c, { f: 2600, decay: 0.01, partials: [1, 1.7], len: 0.08, hit: 0.4 });
    B.ratchet = GEN.crunch(c, { grains: 9, cut: 6000, len: 0.18, seed: 41, spread: 0.12, body: 0.2, bodyF: 1800 });
    B.install = GEN.metal(c, { f: 180, decay: 0.12, partials: [1, 2.3, 4.1], len: 0.6, hit: 0.8 });
    B.remove = GEN.metal(c, { f: 240, decay: 0.08, partials: [1, 2.9], len: 0.4, hit: 0.6 });
    B.hitMetal = GEN.metal(c, { f: 520, decay: 0.25, len: 0.8 });
    B.hitFlesh = GEN.thump(c, { f: 95, decay: 0.05, click: 0.9, seed: 44, len: 0.3, noiseCut: 900 });
    B.crash = GEN.metal(c, { f: 150, decay: 0.25, partials: [1, 2.31, 3.7, 6.1, 9.3], len: 1.2, hit: 2.5, seed: 45 });
    B.crashHeavy = GEN.metal(c, { f: 95, decay: 0.45, partials: [1, 1.7, 2.6, 4.3, 7.1], len: 2.0, hit: 3.5, seed: 46 });
    await tick();
    B.revolver = GEN.gunshot(c, { body: 160, tail: 0.55, crack: 1.2, seed: 51 });
    B.shotgun = GEN.gunshot(c, { body: 90, tail: 0.8, crack: 1.4, seed: 52, len: 2.2 });
    B.dryfire = GEN.metal(c, { f: 3100, decay: 0.008, partials: [1, 1.5], len: 0.06, hit: 0.5 });
    B.reloadRevolver = GEN.crunch(c, { grains: 6, cut: 7000, len: 1.6, spread: 1.4, seed: 53, body: 0.25, bodyF: 2200 });
    B.reloadShotgun = GEN.crunch(c, { grains: 5, cut: 4000, len: 1.8, spread: 1.6, seed: 54, body: 0.5, bodyF: 600 });
    B.backfire = GEN.gunshot(c, { body: 60, tail: 0.3, crack: 0.6, seed: 55, len: 0.9 });
    B.engineStart = GEN.starter(c, { len: 0.8 });
    B.starter = GEN.starter(c, { len: 1.0, seed: 20 });
    B.stall = GEN.thump(c, { f: 40, decay: 0.3, click: 0.2, rattle: 0.6, seed: 56, len: 0.9 });
    await tick();
    B.eat = GEN.crunch(c, { grains: 40, cut: 3000, len: 1.1, spread: 1.0, seed: 61 });
    B.drink = GEN.gulp(c, { len: 0.55 });
    B.pour = GEN.pourLoop(c, { len: 2 });
    B.bandage = GEN.crunch(c, { grains: 60, cut: 5000, len: 0.9, spread: 0.8, seed: 62 });
    B.extinguish = GEN.noise(c, 1.5, 'white', 63);
    B.ignite = GEN.whoosh(c, { len: 0.9, f0: 160, f1: 900, seed: 90 });
    B.hurt = GEN.breath(c, { len: 0.45, seed: 64 });
    B.land = GEN.thump(c, { f: 60, decay: 0.08, click: 0.6, seed: 65, len: 0.4, noiseCut: 1500 });
    B.seat = GEN.crunch(c, { grains: 20, cut: 1500, len: 0.5, spread: 0.4, seed: 66, body: 0.4, bodyF: 70 });
    B.thunder = [GEN.thunder(c, { seed: 71, close: 0.9 }), GEN.thunder(c, { seed: 72, close: 0.2 })];
    await tick();
    B.chirp = [GEN.chirp(c, { f: 4300 }), GEN.chirp(c, { f: 3800, len: 0.09 }), GEN.chirp(c, { f: 5200, len: 0.07 })];
    B.howl = GEN.howl(c, {});
    B.growl = [GEN.growl(c, { seed: 81 }), GEN.growl(c, { seed: 82, f: 55, len: 2.2 })];
    B.screech = GEN.screech(c, {});
    B.vagrant = [GEN.breath(c, { len: 0.8, seed: 85 }), GEN.growl(c, { f: 120, len: 0.8, seed: 86 })];
    B.bird = [GEN.chirp(c, { f: 2600, len: 0.18 }), GEN.chirp(c, { f: 3100, len: 0.12 })];
    // radio: plucked notes of a slow minor progression
    const notes = [110, 130.81, 146.83, 164.81, 196, 220, 246.94, 261.63, 293.66, 329.63];
    B.pluck = notes.map((f, i) => GEN.pluck(c, { f, len: 2.6, seed: 90 + i }));
  }

  // Continuous sources.
  buildLoops() {
    const c = this.ctx;
    const mkNoise = (buf, bus, filterType, freq, q = 0.7) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(bus);
      src.start();
      return { src, f, g };
    };
    // ambience
    this.loops.wind = mkNoise(this.buffers.pink, this.amb, 'lowpass', 500);
    this.loops.windHigh = mkNoise(this.buffers.white, this.amb, 'bandpass', 2400, 0.6);
    this.loops.rain = mkNoise(this.buffers.white, this.amb, 'highpass', 1200);
    this.loops.rainLow = mkNoise(this.buffers.brown, this.amb, 'lowpass', 400);
    // car: engine synthesis with panner at the car
    const pan = (this.carPanner = c.createPanner());
    pan.panningModel = 'equalpower';
    pan.distanceModel = 'inverse';
    pan.refDistance = 3;
    pan.rolloffFactor = 1;
    const cabin = (this.cabinFilter = c.createBiquadFilter());
    cabin.type = 'lowpass';
    cabin.frequency.value = 20000;
    const carBus = c.createGain();
    carBus.connect(cabin).connect(pan).connect(this.sfx);
    this.carBus = carBus;
    // engine: an oscillator at the firing frequency with the car type's harmonic recipe
    const eng = c.createOscillator();
    const sub = c.createOscillator();
    sub.type = 'triangle';
    const engF = c.createBiquadFilter();
    engF.type = 'lowpass';
    engF.Q.value = 1.2;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    const engG = c.createGain();
    engG.gain.value = 0;
    const subG = c.createGain();
    subG.gain.value = 0.5;
    eng.connect(shaper);
    sub.connect(subG).connect(shaper);
    shaper.connect(engF).connect(engG).connect(carBus);
    eng.start();
    sub.start();
    this.loops.engine = { osc: eng, sub, f: engF, g: engG, subG, shaper };
    this.setCarType({ sound: { harmonics: [0, 1, 0.55, 0.42, 0.3, 0.26, 0.18, 0.15, 0.1, 0.09, 0.06, 0.05, 0.04, 0.03, 0.02, 0.02], odd: 1, even: 0.8, sub: 0.5, drive: 2.2 } });
    // intake / exhaust noise
    const n = mkNoise(this.buffers.brown, carBus, 'bandpass', 300, 1.2);
    this.loops.intake = n;
    // starter
    const st = c.createBufferSource();
    st.buffer = this.buffers.starter;
    st.loop = true;
    const stG = c.createGain();
    stG.gain.value = 0;
    st.connect(stG).connect(carBus);
    st.start();
    this.loops.starter = { src: st, g: stG };
    // tyres & skid (not filtered by cabin as strongly but fine)
    this.loops.tyre = mkNoise(this.buffers.brown, carBus, 'lowpass', 300);
    this.loops.skid = mkNoise(this.buffers.pink, carBus, 'bandpass', 950, 4);
    // pour loop (non positional)
    const ps = c.createBufferSource();
    ps.buffer = this.buffers.pour;
    ps.loop = true;
    const pg = c.createGain();
    pg.gain.value = 0;
    ps.connect(pg).connect(this.sfx);
    ps.start();
    this.loops.pour = { g: pg };
    // spray can hiss
    this.loops.spray = mkNoise(this.buffers.white, this.sfx, 'highpass', 3800, 0.7);
    // radio
    const rf = c.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 1400;
    rf.Q.value = 0.5;
    const rg = c.createGain();
    rg.gain.value = 0;
    rf.connect(rg).connect(this.music);
    this.radio = { in: rf, g: rg, step: 0 };
    this.loops.static = mkNoise(this.buffers.white, rf, 'bandpass', 3000, 0.4);
    // CD player: full-range through door speakers (a little bass lift, rolled-off top); muffled by
    // the body when you are outside the car
    const cdHp = c.createBiquadFilter();
    cdHp.type = 'highpass';
    cdHp.frequency.value = 55;
    const cdLow = c.createBiquadFilter();
    cdLow.type = 'lowshelf';
    cdLow.frequency.value = 140;
    cdLow.gain.value = 3;
    const cdLp = c.createBiquadFilter();
    cdLp.type = 'lowpass';
    cdLp.frequency.value = 14000;
    const cdG = c.createGain();
    cdG.gain.value = 0;
    cdHp.connect(cdLow).connect(cdLp).connect(cdG).connect(this.music);
    this.cd = { in: cdHp, lp: cdLp, g: cdG, src: null, key: null, buffers: new Map(), pending: new Map(), worker: null, startedAt: 0, offset: 0 };
  }

  // ------------------------------------------------------------------ CD player
  // Rendered tracks come from a worker; the two most recent stay cached.
  cdTrack(album, track) {
    const cd = this.cd;
    const key = album + ':' + track;
    if (cd.buffers.has(key)) return cd.buffers.get(key);
    if (!cd.pending.has(key)) {
      if (!cd.worker) {
        cd.worker = new Worker(new URL('./music/musicWorker.js', import.meta.url), { type: 'module' });
        cd.worker.onmessage = (e) => {
          const d = e.data;
          const k = d.album + ':' + d.track;
          cd.pending.delete(k);
          if (d.error) {
            console.warn('cd render failed', d.error);
            return;
          }
          const b = this.ctx.createBuffer(2, d.L.length, d.sr);
          b.copyToChannel(d.L, 0);
          b.copyToChannel(d.R, 1);
          cd.buffers.set(k, b);
          while (cd.buffers.size > 2) cd.buffers.delete(cd.buffers.keys().next().value);
        };
      }
      cd.pending.set(key, true);
      cd.worker.postMessage({ id: key, album, track });
    }
    return null;
  }

  // Keeps the CD playing what the car's stereo says; returns playback state for the display.
  updateCd(car, dt, seated) {
    const cd = this.cd;
    const now = this.ctx.currentTime;
    const st = car && car.stereo;
    const powered = car && car.radioOn && car.isInstalled('battery') && car.battery > 0.03;
    const want = powered && st.mode === 'cd' && st.disc >= 0 ? st.disc + ':' + st.track : null;
    if (cd.key !== want || st?.restart) {
      if (cd.src) {
        try {
          cd.src.stop();
        } catch (e) {
          /* already stopped */
        }
        cd.src = null;
      }
      cd.key = null;
      if (st) st.restart = false;
      if (want) {
        const buf = this.cdTrack(st.disc, st.track);
        if (buf) {
          const src = this.ctx.createBufferSource();
          src.buffer = buf;
          src.connect(cd.in);
          const off = Math.min(st.pos || 0, buf.duration - 0.5);
          src.start(now + 0.05, Math.max(0, off));
          cd.src = src;
          cd.key = want;
          cd.startedAt = now + 0.05 - Math.max(0, off);
          cd.duration = buf.duration;
          src.onended = () => {
            if (cd.src === src && car.stereo.disc >= 0) {
              car.stereo.pos = 0;
              car.nextTrack();
            }
          };
          this.game.hud && this.game.hud.nowPlaying && this.game.hud.nowPlaying(st.disc, st.track);
          // render the next one in the background
          this.cdTrack(st.disc, (st.track + 1) % 3);
        }
      }
    }
    if (cd.key && st) st.pos = Math.max(0, now - cd.startedAt);
    set(cd.g.gain, cd.key ? 0.85 * (seated ? 1 : 0.4) : 0, now, 0.08);
    set(cd.lp.frequency, seated ? 14000 : 1600, now, 0.2);
    return { loading: !!want && !cd.key, playing: !!cd.key, pos: st ? st.pos || 0 : 0 };
  }

  // ------------------------------------------------------------------ one-shots
  play(name, opts = {}) {
    if (!this.ready) return;
    const c = this.ctx;
    let buf = this.buffers[name];
    if (name === 'step') buf = this.buffers['step_' + (opts.surface in STEP_SURF ? opts.surface : 'dirt')];
    if (name === 'pickup' && opts.mass > 6) buf = this.buffers.pickupHeavy;
    if (name === 'pour') {
      this.pourT = 0.15;
      return;
    }
    if (!buf) return;
    if (Array.isArray(buf)) buf = buf[Math.floor(Math.random() * buf.length)];
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts.rate || 1) * (1 + (Math.random() - 0.5) * (opts.pitchVar ?? 0.12));
    const g = c.createGain();
    g.gain.value = (opts.volume ?? 1) * (VOL[name] ?? 0.8);
    let node = src.connect(g);
    if (opts.lowpass) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lowpass;
      node = node.connect(f);
    }
    if (opts.at) {
      const p = c.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = opts.ref ?? 2;
      p.rolloffFactor = opts.rolloff ?? 1;
      p.positionX.value = opts.at.x;
      p.positionY.value = opts.at.y;
      p.positionZ.value = opts.at.z;
      node.connect(p).connect(opts.bus === 'amb' ? this.amb : this.sfx);
    } else node.connect(opts.bus === 'amb' ? this.amb : this.sfx);
    src.start();
    return src;
  }

  setRadio(on) {
    this.radioOn = on;
  }

  // ------------------------------------------------------------------ update
  // Engine voice of a car type: harmonic recipe, sub-octave mix and how hard the shaper drives.
  setCarType(type) {
    if (!this.ctx || !this.loops || !this.loops.engine) return;
    this.carType = type;
    const S = type.sound;
    const c = this.ctx;
    const real = new Float32Array(16),
      imag = new Float32Array(16);
    for (let i = 1; i < 16; i++) imag[i] = (S.harmonics[i] || 0) * (i % 2 ? S.odd : S.even);
    const e = this.loops.engine;
    e.osc.setPeriodicWave(c.createPeriodicWave(real, imag));
    e.subG.gain.value = S.sub;
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh(((i / 1023) * 2 - 1) * S.drive);
    e.shaper.curve = curve;
  }

  update(dt) {
    if (!this.ready) return;
    const g = this.game;
    const c = this.ctx;
    const now = c.currentTime;
    const cam = g.renderer.camera;
    const L = c.listener;
    const fwd = V3.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = V3b.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      L.positionX.setTargetAtTime(cam.position.x, now, 0.02);
      L.positionY.setTargetAtTime(cam.position.y, now, 0.02);
      L.positionZ.setTargetAtTime(cam.position.z, now, 0.02);
      L.forwardX.value = fwd.x;
      L.forwardY.value = fwd.y;
      L.forwardZ.value = fwd.z;
      L.upX.value = up.x;
      L.upY.value = up.y;
      L.upZ.value = up.z;
    } else {
      L.setPosition(cam.position.x, cam.position.y, cam.position.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    const env = g.env;
    const player = g.player;
    const car = g.car;
    const seated = !!player.seat;
    this.inCabin = lerp(this.inCabin, seated ? 1 : 0, Math.min(1, dt * 5));
    // ---- wind / rain ambience
    const carSpeed = car ? Math.abs(car.dyn.forwardSpeed) : 0;
    const wind = env.w.wind;
    const windGain = (0.05 + wind * 0.25 + env.w.dust * 0.3) * this.windGust;
    const drive = seated ? Math.min(1, carSpeed / 30) : 0;
    set(this.loops.wind.g.gain, (windGain + drive * 0.25) * (1 - this.inCabin * 0.5), now);
    set(this.loops.wind.f.frequency, 300 + wind * 500 + drive * 600, now);
    set(this.loops.windHigh.g.gain, (wind * 0.05 + env.w.dust * 0.12) * (1 - this.inCabin * 0.8) + drive * 0.03, now);
    const rain = env.w.rain;
    set(this.loops.rain.g.gain, rain * 0.22 * (1 - this.inCabin * 0.4), now);
    set(this.loops.rain.f.frequency, seated ? 600 : 1500, now);
    set(this.loops.rainLow.g.gain, rain * (seated ? 0.35 : 0.12), now);
    // ---- car
    if (car) {
      const p = car.root.position;
      // the voice is the engine's: a swapped engine sounds like the car it came from
      const ET = car.engineType || car.type;
      if (ET !== this.carType) this.setCarType(ET);
      const S = ET.sound;
      const ep = V3.copy(car.type.POINTS.engine).applyMatrix4(car.root.matrixWorld);
      this.carPanner.positionX.value = ep.x;
      this.carPanner.positionY.value = ep.y;
      this.carPanner.positionZ.value = ep.z;
      void p;
      set(this.cabinFilter.frequency, lerp(18000, 1800, this.inCabin), now);
      const d = car.dyn;
      const rpm = Math.max(0, d.engine.rpm);
      const running = d.engine.running;
      const load = running ? clamp(d.controls.throttle * (0.4 + 0.6 * Math.min(1, rpm / 4000)), 0, 1) : 0;
      const fire = (rpm / 60) * S.fires;
      const e = this.loops.engine;
      set(e.osc.frequency, Math.max(8, fire), now, 0.03);
      set(e.sub.frequency, Math.max(4, fire / 2), now, 0.03);
      const exhaustMissing = !car.isInstalled('exhaust');
      set(e.f.frequency, S.tone + rpm * S.toneRpm + load * 900 + (exhaustMissing ? 1200 : 0), now, 0.04);
      const rough = car.engineCondition < 0.4 ? (Math.random() - 0.5) * 0.25 * (0.4 - car.engineCondition) * 2 : 0;
      set(e.g.gain, running ? (0.16 + load * 0.22 + rpm / 30000 + rough) * (exhaustMissing ? 1.8 : 1) * S.gain : 0, now, 0.05);
      set(this.loops.intake.g.gain, running ? (0.05 + load * 0.25) * S.intake : 0, now);
      set(this.loops.intake.f.frequency, 200 + rpm * 0.25, now);
      set(this.loops.starter.g.gain, car.cranking > 0 && !running ? 0.5 : 0, now, 0.02);
      // tyres
      let roll = 0,
        skid = 0,
        rough2 = 0;
      for (const w of d.wheels) {
        if (!w.contact) continue;
        roll += Math.min(1, Math.abs(w.vLong) / 25);
        skid = Math.max(skid, w.skid);
        const s = d.surfaces(w.surface);
        rough2 += s.noise;
      }
      roll /= 4;
      rough2 /= 4;
      set(this.loops.tyre.g.gain, roll * (0.25 + rough2 * 0.6), now);
      set(this.loops.tyre.f.frequency, 200 + rough2 * 1500 + roll * 400, now);
      set(this.loops.skid.g.gain, skid * 0.35, now, 0.03);
      // horn
      if (car.horn && !this._horn) {
        this._horn = this.hornNode();
      } else if (!car.horn && this._horn) {
        this._horn.stop();
        this._horn = null;
      }
    }
    // pour
    this.pourT = Math.max(0, (this.pourT || 0) - dt);
    set(this.loops.pour.g.gain, this.pourT > 0 ? 0.35 : 0, now, 0.04);
    set(this.loops.spray.g.gain, g.interaction && g.interaction.spraying ? 0.22 : 0, now, 0.03);
    if (g.interaction && g.interaction.pouring) this.pourT = 0.12;
    // ---- CD player (replaces the radio while a disc plays)
    if (car) car.stereoState = this.updateCd(car, dt, seated);
    // ---- radio
    const radioOn = car && car.radioOn && car.isInstalled('battery') && car.battery > 0.03 && !(car.stereo && car.stereo.mode === 'cd');
    set(this.radio.g.gain, radioOn ? 0.5 * (seated ? 1 : 0.35) : 0, now, 0.1);
    set(this.loops.static.g.gain, radioOn ? 0.03 : 0, now, 0.1);
    if (radioOn) {
      this.timers.radio -= dt;
      if (this.timers.radio <= 0) this.radioNote();
    }
    // ---- the land's sound (ambience layers, creatures, small touches)
    if (this.scape) this.scape.update(dt);
  }

  // ---------------------------------------------------------------- title theme
  // A slow, warm pad (detuned saws through a breathing low-pass) under a sparse plucked melody
  // with a long delay: road-movie at dusk. Runs on the music bus.
  startMenuMusic() {
    if (!this.ready || this.menuMusic) return;
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    out.gain.linearRampToValueAtTime(0.9, c.currentTime + 4);
    out.connect(this.music);
    const delay = c.createDelay(2);
    delay.delayTime.value = 0.62;
    const fb = c.createGain();
    fb.gain.value = 0.38;
    const dl = c.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    delay.connect(dl).connect(fb).connect(delay);
    dl.connect(out);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.Q.value = 0.7;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = c.createGain();
    lfoG.gain.value = 380;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();
    const padG = c.createGain();
    padG.gain.value = 0.09;
    lp.connect(padG).connect(out);
    const chords = [
      [110, 164.81, 220, 261.63],
      [87.31, 130.81, 174.61, 220],
      [98, 146.83, 196, 246.94],
      [82.41, 123.47, 164.81, 207.65],
    ];
    const voices = [];
    for (let i = 0; i < 4; i++)
      for (const det of [-6, 6]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = det;
        o.frequency.value = chords[0][i];
        o.connect(lp);
        o.start();
        voices.push({ o, i });
      }
    const mm = (this.menuMusic = { out, voices, lfo, chord: 0, step: 0, timer: null });
    const tick = () => {
      if (this.menuMusic !== mm) return;
      // chord change every 8 steps, glide
      if (mm.step % 8 === 0) {
        const ch = chords[(mm.step / 8) % chords.length];
        for (const v of voices) v.o.frequency.setTargetAtTime(ch[v.i], c.currentTime, 0.8);
        mm.chord = (mm.step / 8) % chords.length;
      }
      // sparse melody from the pluck bank
      const pat = [0, -1, 2, -1, 3, 1, -1, 4];
      const k = pat[mm.step % pat.length];
      if (k >= 0 && Math.random() < 0.85) {
        const idx = (k + mm.chord * 2) % this.buffers.pluck.length;
        const src = c.createBufferSource();
        src.buffer = this.buffers.pluck[idx];
        const g = c.createGain();
        g.gain.value = 0.22;
        src.connect(g);
        g.connect(out);
        g.connect(delay);
        src.start();
      }
      mm.step++;
      mm.timer = setTimeout(tick, 680);
    };
    mm.timer = setTimeout(tick, 1500);
  }

  stopMenuMusic() {
    const mm = this.menuMusic;
    if (!mm) return;
    this.menuMusic = null;
    clearTimeout(mm.timer);
    const c = this.ctx;
    mm.out.gain.setTargetAtTime(0, c.currentTime, 0.4);
    setTimeout(() => {
      for (const v of mm.voices) v.o.stop();
      mm.lfo.stop();
      mm.out.disconnect();
    }, 2500);
  }

  // UI ticks: short filtered clicks for hover / select.
  uiSound(kind = 'hover') {
    if (!this.ready) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.value = kind === 'hover' ? 1400 : 520;
    o.frequency.exponentialRampToValueAtTime(kind === 'hover' ? 1100 : 300, c.currentTime + 0.08);
    g.gain.value = kind === 'hover' ? 0.035 : 0.09;
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + (kind === 'hover' ? 0.06 : 0.16));
    o.connect(g).connect(this.sfx);
    o.start();
    o.stop(c.currentTime + 0.2);
  }

  radioNote() {
    // slow arpeggiated progression in A minor; occasional fades for "signal"
    const r = this.radio;
    const prog = [
      [0, 2, 4, 7],
      [1, 3, 5, 8],
      [2, 4, 6, 9],
      [0, 3, 5, 7],
    ];
    const chord = prog[Math.floor(r.step / 8) % prog.length];
    const idx = chord[r.step % 4] + (r.step % 8 >= 4 ? 0 : 0);
    const buf = this.buffers.pluck[idx % this.buffers.pluck.length];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 0.35 + Math.random() * 0.1;
    src.connect(g).connect(r.in);
    src.start();
    // bass on downbeats
    if (r.step % 4 === 0) {
      const b = this.ctx.createBufferSource();
      b.buffer = this.buffers.pluck[chord[0]];
      b.playbackRate.value = 0.5;
      const bg = this.ctx.createGain();
      bg.gain.value = 0.4;
      b.connect(bg).connect(r.in);
      b.start();
    }
    r.step++;
    this.timers.radio = 0.42 + (r.step % 8 === 7 ? 0.42 : 0);
  }

  hornNode() {
    const c = this.ctx;
    const o1 = c.createOscillator(),
      o2 = c.createOscillator();
    o1.type = o2.type = 'square';
    o1.frequency.value = 420;
    o2.frequency.value = 505;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    const g = c.createGain();
    g.gain.value = 0.12;
    o1.connect(f);
    o2.connect(f);
    f.connect(g).connect(this.carBus);
    o1.start();
    o2.start();
    return {
      stop: () => {
        g.gain.setTargetAtTime(0, c.currentTime, 0.03);
        setTimeout(() => {
          o1.stop();
          o2.stop();
        }, 200);
      },
    };
  }

  thunder(distance) {
    if (!this.ready) return;
    const delay = Math.max(0, distance / 343);
    setTimeout(() => this.play('thunder', { volume: clamp(1.4 - distance / 2500, 0.25, 1.2), bus: 'amb', pitchVar: 0.2, rate: distance > 1200 ? 0.8 : 1 }), delay * 1000);
  }
}

// A short warm room: stereo noise dying away over half a second.
function roomImpulse(ctx) {
  const n = Math.floor(ctx.sampleRate * 0.55);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += (Math.random() * 2 - 1 - lp) * 0.35;
      d[i] = lp * Math.exp((-i / n) * 6) * (i < 60 ? i / 60 : 1);
    }
  }
  return buf;
}

const V3 = new THREE.Vector3();
const V3b = new THREE.Vector3();

function set(param, v, now, tc = 0.08) {
  param.setTargetAtTime(v, now, tc);
}

// per-sound base volume
const VOL = {
  step: 0.35,
  doorOpen: 0.7,
  doorClose: 0.9,
  hood: 0.8,
  trunk: 0.8,
  doorCreak: 0.45,
  doorShut: 0.7,
  pickup: 0.5,
  pickupHeavy: 0.6,
  throw: 0.4,
  swing: 0.4,
  pocket: 0.4,
  click: 0.35,
  ratchet: 0.45,
  install: 0.7,
  remove: 0.6,
  hitMetal: 0.6,
  hitFlesh: 0.8,
  crash: 0.9,
  crashHeavy: 1.0,
  revolver: 1.0,
  shotgun: 1.0,
  dryfire: 0.5,
  reloadRevolver: 0.5,
  reloadShotgun: 0.5,
  backfire: 0.9,
  engineStart: 0.6,
  stall: 0.6,
  eat: 0.5,
  drink: 0.5,
  bandage: 0.4,
  extinguish: 0.6,
  hurt: 0.6,
  land: 0.5,
  seat: 0.45,
  thunder: 1.0,
  // the soundscape passes its own levels
  song: 1,
  meadowlark: 1,
  woodpecker: 1,
  owl: 1,
  caw: 1,
  hawk: 1,
  yips: 1,
  chime: 1,
  signCreak: 1,
  floorCreak: 1,
  keys: 1,
  tick: 1,
  ping: 1,
  clunk: 1,
  squeak: 1,
  swish: 1,
  heartbeat: 1,
  stomach: 1,
  chatter: 1,
  pant: 1,
  chirp: 0.5,
  howl: 0.6,
  growl: 0.8,
  screech: 0.5,
  vagrant: 0.7,
  bird: 0.5,
};
