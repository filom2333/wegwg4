// Audio engine: buses, recorded one-shots placed in the world, real-time engine synthesis,
// tyre/wind/rain loops, the ambience (soundscape), where it all sits in space (space.js), and the
// car radio's generative music.

import * as THREE from 'three';
import { GEN } from './synth.js';
import { Soundscape } from './soundscape.js';
import { Space } from './space.js';
import { Music } from './music.js';
import { settings } from '../core/settings.js';
import { clamp, lerp } from '../core/noise.js';
import { tunedVoice } from '../vehicle/tuning.js';
import { STATIONS, stationProgram } from './stations.js';

const SOUNDS = (import.meta.env.BASE_URL || '/') + 'sounds/';
// surfaces with their own footsteps (step_<surface> in sounds/index.json)
const STEP_SURF = new Set(['sand', 'dirt', 'gravel', 'rock', 'asphalt', 'concrete', 'wood', 'metal', 'salt', 'snow', 'snowRoad', 'grass', 'ice']);

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
    // the player's own sounds (sfx) and the world's bed (amb) are not placed; everything placed
    // in the world goes through a voice of the Space into sfxPos / ambPos
    this.sfx = ctx.createGain();
    this.sfxPos = ctx.createGain();
    this.amb = ctx.createGain();
    this.ambPos = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(this.master);
    this.sfxPos.connect(this.master);
    this.ambPos.connect(this.master);
    // the world's bed, muffled indoors and in the cabin (the soundscape moves the cutoff)
    this.ambLP = ctx.createBiquadFilter();
    this.ambLP.type = 'lowpass';
    this.ambLP.frequency.value = 20000;
    this.amb.connect(this.ambLP).connect(this.master);
    this.music.connect(this.master);
    this.space = new Space(this);
    this.musicRec = new Music(this);
    // your own sounds get the room when indoors (the soundscape opens this)
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = 0;
    this.sfx.connect(this.sfxSend).connect(this.space.send);
    this.windGust = 1;
    this.applyVolumes();
    settings.onChange(() => this.applyVolumes());
    this.buildBuffers();
    await Promise.all([this.loadSamples(), this.musicRec.load()]);
    this.applySamples();
    this.buildLoops();
    this.scape = new Soundscape(this);
    this.scape.build();
    this.ready = true;
  }

  // The sounds are recordings in public/sounds/ listed in sounds/index.json: { "sounds": { name:
  // file | [files] }, "gain": { name: level } }. Several files for a name are variants picked at
  // random. (Music is streamed from public/music/, see music.js.)
  async loadSamples() {
    this.samples = {};
    let list = null;
    try {
      const r = await fetch(SOUNDS + 'index.json');
      if (r.ok) list = await r.json();
    } catch {
      list = null;
    }
    if (!list) return;
    // level corrections for recorded loops, so they sit where the shaped noise they replace did
    this.sampleGain = list.gain || {};
    await Promise.all(
      Object.entries(list.sounds || {}).map(async ([name, files]) => {
        const bufs = [];
        for (const f of [].concat(files)) {
          try {
            const r = await fetch(SOUNDS + f);
            bufs.push(await this.ctx.decodeAudioData(await r.arrayBuffer()));
          } catch (e) {
            console.warn('sound', f, 'did not load:', e.message || e);
          }
        }
        if (bufs.length) this.samples[name] = bufs.length === 1 ? bufs[0] : bufs;
      })
    );
  }

  applySamples() {
    for (const [k, v] of Object.entries(this.samples || {})) this.buffers[k] = v;
  }

  // A recording's level correction from the index.
  trim(name) {
    return (this.sampleGain || {})[name] ?? 1;
  }

  // A loaded recording for a loop (its first variant), or null.
  sample(name) {
    const s = this.samples && this.samples[name];
    return s ? (Array.isArray(s) ? s[0] : s) : null;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = settings.data;
    this.master.gain.value = s.masterVolume;
    this.sfx.gain.value = this.sfxPos.gain.value = s.sfxVolume;
    this.amb.gain.value = this.ambPos.gain.value = s.ambientVolume;
    this.music.gain.value = s.musicVolume;
    if (this.musicRec) this.musicRec.applyVolume();
  }

  // What is still made here rather than recorded: hiss for the spray can, the radio's static and
  // the engine's intake, and the plucked notes of the radio station and the title theme.
  buildBuffers() {
    const c = this.ctx;
    const B = this.buffers;
    B.white = GEN.noise(c, 3, 'white', 1);
    B.brown = GEN.noise(c, 3, 'brown', 3);
    const notes = [110, 130.81, 146.83, 164.81, 196, 220, 246.94, 261.63, 293.66, 329.63];
    B.pluck = notes.map((f, i) => GEN.pluck(c, { f, len: 2.6, seed: 90 + i }));
  }

  // Continuous sources.
  buildLoops() {
    const c = this.ctx;
    const mkNoise = (buf, bus, filterType, freq, q = 0.7, trim = 1) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      let head = src;
      if (trim !== 1) {
        const t = c.createGain();
        t.gain.value = trim;
        head = src.connect(t);
      }
      head.connect(f).connect(g).connect(bus);
      src.start();
      return { src, f, g };
    };
    // ambience: the recorded wind and rain, with shaped noise for the high whistle of a gale and
    // the drumming on a roof
    this.loops.wind = mkNoise(this.sample('wind'), this.amb, 'lowpass', 1500, 0.7, this.trim('wind'));
    this.loops.rain = mkNoise(this.sample('rain'), this.amb, 'highpass', 300, 0.7, this.trim('rain'));
    // the drumming on a roof over your head: the recorded rain's low end
    this.loops.rainLow = mkNoise(this.sample('rain'), this.amb, 'lowpass', 400, 0.7, this.trim('rain') * 2);
    // the car, as two places: the engine (in the bay, or at the tailpipe when you stand behind)
    // and the wheels under the floor. Sitting inside, the body takes the top off both and the
    // cabin booms a little.
    const carVoice = (track, ref, cut) => {
      const bus = c.createGain();
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 20000;
      const boom = c.createBiquadFilter();
      boom.type = 'lowshelf';
      boom.frequency.value = 130;
      boom.gain.value = 0;
      const v = this.space.voice({ ref, own: true, track, bus: this.sfxPos, wet: 0.6 });
      bus.connect(lp).connect(boom).connect(v.input);
      return { bus, lp, boom, v, cut };
    };
    this.engineAt = new THREE.Vector3();
    this.wheelsAt = new THREE.Vector3();
    this.engineVoice = carVoice(() => (this.game.car ? this.engineAt : null), 3, 1700);
    this.wheelVoice = carVoice(() => (this.game.car ? this.wheelsAt : null), 2.5, 1100);
    const carBus = (this.carBus = this.engineVoice.bus);
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
    st.buffer = this.sample('starter');
    st.loop = true;
    const stG = c.createGain();
    stG.gain.value = 0;
    const stT = c.createGain();
    stT.gain.value = this.trim('starter');
    st.connect(stT).connect(stG).connect(carBus);
    st.start();
    this.loops.starter = { src: st, g: stG };
    // tyres rolling and skidding
    this.loops.tyre = mkNoise(this.sample('tyreRoll'), this.wheelVoice.bus, 'lowpass', 300, 0.7, this.trim('tyreRoll'));
    this.loops.skid = mkNoise(this.sample('skid'), this.wheelVoice.bus, 'bandpass', 950, 0.5, this.trim('skid'));
    // pour loop (non positional)
    const ps = c.createBufferSource();
    ps.buffer = this.sample('pour');
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
    // the car's stereo plays straight to you in the seat, and from the car when you stand outside
    const stereo = c.createGain();
    this.stereoDirect = c.createGain();
    this.stereoOut = c.createGain();
    this.stereoOut.gain.value = 0;
    const sv = this.space.voice({ ref: 3, own: true, bus: this.music, wet: 0.5, track: () => (this.game.car ? this.game.car.root.position : null) });
    stereo.connect(this.stereoDirect).connect(this.music);
    stereo.connect(this.stereoOut).connect(sv.input);
    rf.connect(rg).connect(stereo);
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
    cdHp.connect(cdLow).connect(cdLp).connect(cdG).connect(stereo);
    // songs come in through songIn, so a station ID can push them back for a moment
    const songIn = c.createGain();
    songIn.connect(cdHp);
    this.cd = { in: cdHp, songIn, lp: cdLp, g: cdG, src: null, p: null, streaming: false, key: null, buffers: new Map(), pending: new Map(), worker: null, startedAt: 0, offset: 0 };
  }

  // ------------------------------------------------------------------ CD player
  // A song with no recording yet is rendered by a worker; the two most recent stay cached.
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
    let want = powered && st.mode === 'cd' && st.disc >= 0 ? st.disc + ':' + st.track : null;
    // a music station: the albums on the air, picked by the clock
    this.radioClock = (this.radioClock ?? 1e4 + Math.random() * 5e4) + dt;
    const station = st && st.mode !== 'cd' ? STATIONS[st.station ?? 1] : null;
    let prog = null;
    if (powered && station && station.kind === 'music') {
      prog = stationProgram(station, this.radioClock + (st.radioShift || 0));
      want = 'fm:' + prog.album + ':' + prog.track;
    }
    // Haven plays its recordings between the bulletins (a quiet gap after each)
    const haven = this.musicRec.havenFiles();
    if (powered && station && station.kind === 'haven' && haven.length) {
      const slot = Math.floor(this.radioClock / 150);
      prog = { haven: true, slot, file: haven[slot % haven.length], pos: this.radioClock - slot * 150 };
      want = 'haven:' + slot;
    }
    if (cd.key !== want || st?.restart) {
      this.stopSong();
      cd.key = null;
      if (st) st.restart = false;
      if (want) this.startSong(car, station, prog, want, now);
    }
    if (cd.key && st && !prog) st.pos = cd.streaming ? cd.p.el.currentTime : Math.max(0, now - cd.startedAt);
    set(cd.g.gain, cd.key ? (prog ? 0.7 : 0.85) * (seated ? 1 : 0.4) : 0, now, 0.08);
    // over the air: no deep bass, no sparkle
    set(cd.lp.frequency, seated ? (prog ? 5200 : 14000) : 1600, now, 0.2);
    return { loading: !!want && !cd.key, playing: !!cd.key, pos: st ? st.pos || 0 : 0, prog };
  }

  stopSong() {
    const cd = this.cd;
    if (cd.src) {
      try {
        cd.src.stop();
      } catch (e) {
        /* already stopped */
      }
      cd.src = null;
    }
    if (cd.streaming) {
      cd.p.el.onended = null;
      cd.p.el.pause();
      cd.p.g.gain.cancelScheduledValues(this.ctx.currentTime);
      cd.p.g.gain.value = 0;
      cd.streaming = false;
    }
  }

  // Starts the song `want` names: the recording streamed if there is one, else the rendered one
  // (which may still be rendering: then this is tried again next frame).
  startSong(car, station, prog, want, now) {
    const cd = this.cd,
      M = this.musicRec,
      st = car.stereo;
    const album = prog ? prog.album : st.disc,
      track = prog ? prog.track : st.track;
    const file = prog && prog.haven ? prog.file : M.songFile(album, track);
    const off = prog ? prog.pos : st.pos || 0;
    const radioSlot = prog && !prog.haven ? prog.slot : null;
    const ended = () => {
      if (prog && prog.haven) return;
      if (radioSlot !== null) {
        // the song is over before its slot: the station moves on to the next one
        const now2 = stationProgram(STATIONS[st.station ?? 1], this.radioClock + (st.radioShift || 0));
        if (now2.slot === radioSlot) st.radioShift = (st.radioShift || 0) + (210 - now2.pos);
        return;
      }
      if (st.disc >= 0) {
        st.pos = 0;
        car.nextTrack();
      }
    };
    if (file) {
      cd.p = cd.p || M.player(cd.songIn);
      M.start(cd.p, file, { at: off, fadeIn: 0.05 });
      cd.p.el.onended = () => cd.key === want && ended();
      cd.streaming = true;
    } else {
      const buf = this.cdTrack(album, track);
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(cd.songIn);
      const o = Math.max(0, Math.min(off, buf.duration - 0.5));
      src.start(now + 0.05, o);
      cd.src = src;
      cd.startedAt = now + 0.05 - o;
      src.onended = () => cd.src === src && ended();
    }
    cd.key = want;
    const hud = this.game.hud;
    if (prog && !prog.haven) hud && hud.nowPlaying && hud.nowPlaying(prog.album, prog.track, station);
    if (!prog) {
      hud && hud.nowPlaying && hud.nowPlaying(st.disc, st.track);
      // render the next one in the background
      if (!M.songFile(st.disc, (st.track + 1) % 3)) this.cdTrack(st.disc, (st.track + 1) % 3);
    }
    // the station's ID when you tune in and before each song
    if (station && (cd.lastStation !== station.id || off < 4)) this.jingle(station.id);
    cd.lastStation = station ? station.id : null;
  }

  // A station ID over the start of a song, the song stepping back under it.
  jingle(stationId) {
    const M = this.musicRec,
      cd = this.cd;
    const f = M.jingleFile(stationId);
    if (!f) return;
    cd.jp = cd.jp || M.player(cd.in);
    M.start(cd.jp, f, { fadeIn: 0.02 });
    const g = cd.songIn.gain,
      now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.25, now + 0.3);
    g.setValueAtTime(0.25, now + 7);
    g.linearRampToValueAtTime(1, now + 8.5);
  }

  // ------------------------------------------------------------------ one-shots
  play(name, opts = {}) {
    if (!this.ready) return;
    const c = this.ctx;
    let key = name;
    if (name === 'step') key = 'step_' + (STEP_SURF.has(opts.surface) ? opts.surface : 'dirt');
    if (name === 'pickup' && opts.mass > 6) key = 'pickupHeavy';
    let buf = this.buffers[key];
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
    g.gain.value = (opts.volume ?? 1) * (VOL[name] ?? 0.8) * this.trim(key);
    let node = src.connect(g);
    if (opts.lowpass) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lowpass;
      node = node.connect(f);
    }
    if (opts.at) {
      // placed in the world: panned, muffled by what is in between, answered by the space
      const v = this.space.voice({ ref: opts.ref ?? 2, rolloff: opts.rolloff ?? 1, bus: opts.bus === 'amb' ? this.ambPos : this.sfxPos, wet: opts.wet });
      node.connect(v.input);
      v.place(opts.at);
      src.onended = () => {
        node.disconnect();
        v.dispose();
      };
    } else node.connect(opts.bus === 'amb' ? this.amb : this.sfx);
    src.start();
    return src;
  }

  setRadio(on) {
    this.radioOn = on;
  }

  // The emergency system's attention signal: two tones together, through the radio.
  ebsTone(seconds = 2.5) {
    if (!this.ready) return;
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.12, c.currentTime, 0.02);
    g.gain.setTargetAtTime(0, c.currentTime + seconds, 0.03);
    g.connect(this.radio.in);
    for (const f of [853, 960]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.connect(g);
      o.start();
      o.stop(c.currentTime + seconds + 0.3);
    }
  }

  // A short pip for the numbers station.
  pip(freq = 1200) {
    if (!this.ready) return;
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.1, c.currentTime, 0.005);
    g.gain.setTargetAtTime(0, c.currentTime + 0.12, 0.01);
    g.connect(this.radio.in);
    const o = c.createOscillator();
    o.frequency.value = freq;
    o.connect(g);
    o.start();
    o.stop(c.currentTime + 0.3);
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
      // set, not automated (see Voice.place)
      L.positionX.value = cam.position.x;
      L.positionY.value = cam.position.y;
      L.positionZ.value = cam.position.z;
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
    // a tent muffles the outside like a cabin does, and the rain drums on the canvas
    const seated = !!player.seat || !!(player.lying && player.lying.kind === 'tent');
    this.inCabin = lerp(this.inCabin, seated ? 1 : 0, Math.min(1, dt * 5));
    // ---- wind / rain ambience
    const carSpeed = car ? Math.abs(car.dyn.forwardSpeed) : 0;
    const wind = env.w.wind;
    const windGain = (0.05 + wind * 0.25 + env.w.dust * 0.3) * this.windGust;
    const drive = seated ? Math.min(1, carSpeed / 30) : 0;
    set(this.loops.wind.g.gain, (windGain + drive * 0.25) * (1 - this.inCabin * 0.5), now);
    set(this.loops.wind.f.frequency, (700 + wind * 1800) * (1 - this.inCabin * 0.5) + drive * 900, now);
    // snow falls without a sound
    const rain = env.snowing ? 0 : env.w.rain;
    set(this.loops.rain.g.gain, rain * 0.22 * (1 - this.inCabin * 0.4), now);
    set(this.loops.rain.f.frequency, seated ? 150 : 300, now);
    set(this.loops.rainLow.g.gain, rain * (seated ? 0.35 : 0.12), now);
    // ---- car
    if (car) {
      const p = car.root.position;
      // the voice is the engine's: a swapped engine sounds like the car it came from
      // (with its tunes: a sport muffler rasps, twin carbs roar on the intake)
      const ET = tunedVoice(car, car.engineType || car.type);
      if (ET !== this.carType) this.setCarType(ET);
      const S = ET.sound;
      // where the engine is heard from: the bay, or the tailpipe as you walk round behind
      const P = car.type.POINTS;
      const ep = V3.copy(P.engine).applyMatrix4(car.root.matrixWorld);
      const xp = V3b.copy(P.exhaust || P.engine).applyMatrix4(car.root.matrixWorld);
      const ownSeat = !!player.seat && player.car === car;
      const span = Math.max(0.5, ep.distanceTo(xp));
      const toTail = ownSeat ? 0 : clamp(((cam.position.distanceTo(ep) - cam.position.distanceTo(xp)) / span) * 0.5 + 0.5, 0, 1);
      this.engineAt.lerpVectors(ep, xp, toTail);
      // the wheels: under the middle of the car
      this.wheelsAt.copy(p);
      this.wheelsAt.y -= 0.25;
      // in the seat the body takes the top off and the cabin booms
      const k = ownSeat ? this.inCabin : 0;
      for (const cv of [this.engineVoice, this.wheelVoice]) {
        set(cv.lp.frequency, lerp(20000, cv.cut, k), now);
        set(cv.boom.gain, k * 5, now, 0.2);
      }
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
      const synthGain = running ? (0.16 + load * 0.22 + rpm / 30000 + rough) * (exhaustMissing ? 1.8 : 1) * S.gain : 0;
      set(e.g.gain, synthGain, now, 0.05);
      set(this.loops.intake.g.gain, running ? (0.05 + load * 0.25) * S.intake : 0, now);
      set(this.loops.intake.f.frequency, 200 + rpm * 0.25, now);
      set(this.loops.starter.g.gain, car.cranking > 0 && !running ? 0.5 : 0, now, 0.02);
      // tyres
      let roll = 0,
        skid = 0,
        rough2 = 0,
        knobs = 0;
      for (const w of d.wheels) {
        if (!w.contact) continue;
        roll += Math.min(1, Math.abs(w.vLong) / 25);
        if (w.tread) knobs += 0.25;
        skid = Math.max(skid, w.skid);
        const s = d.surfaces(w.surface);
        rough2 += s.noise;
      }
      roll /= 4;
      rough2 /= 4;
      // knobbly mud tyres hum on hard ground
      set(this.loops.tyre.g.gain, roll * (0.25 + rough2 * 0.6 + knobs * 0.35), now);
      set(this.loops.tyre.f.frequency, 200 + rough2 * 1500 + roll * (400 + knobs * 500), now);
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
    const kind = radioOn ? STATIONS[car.stereo.station ?? 1].kind : null;
    set(this.radio.g.gain, radioOn ? 0.5 * (seated ? 1 : 0.35) : 0, now, 0.1);
    const inside = player.seat && player.car === car ? 1 : 0;
    set(this.stereoDirect.gain, inside, now, 0.15);
    set(this.stereoOut.gain, 1 - inside, now, 0.15);
    set(this.loops.static.g.gain, kind === 'numbers' ? 0.14 : kind === 'ebs' ? 0.06 : radioOn ? 0.03 : 0, now, 0.1);
    if (kind === 'haven' && !this.musicRec.havenFiles().length) {
      this.timers.radio -= dt;
      if (this.timers.radio <= 0) this.radioNote();
    }
    // ---- background music: steps aside while the car stereo can be heard
    const stereo = !!car && (radioOn || !!(car.stereoState && car.stereoState.playing)) && (inside || car.root.position.distanceTo(cam.position) < 18);
    const sc = this.scape;
    this.musicRec.update(dt, {
      sunY: env.sunDir ? env.sunDir.y : 0.5,
      morning: env.time < 12,
      rain: env.snowing ? 0 : env.w.rain,
      north: sc ? sc.mix.north : 0,
      fire: !!(player.lying && player.lying.kind === 'tent') || !!(g.campfires && g.campfires.near(cam.position, 12)),
      stereo,
      quiet: !!player.dead,
    });
    // ---- the land's sound (ambience layers, creatures, small touches)
    if (this.scape) this.scape.update(dt);
  }

  // ---------------------------------------------------------------- title theme
  // A slow, warm pad (detuned saws through a breathing low-pass) under a sparse plucked melody
  // with a long delay: road-movie at dusk. Runs on the music bus.
  startMenuMusic() {
    if (!this.ready) return;
    this.inMenu = true;
    if (!this.musicRec.on || this.musicRec.startMenu() || this.menuMusic) return;
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

  stopMenuMusic(keepMenu = false) {
    if (!keepMenu) this.inMenu = false;
    if (this.musicRec) this.musicRec.stopMenu();
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

  // Background music and the menu theme on or off (key U, the pause menu, Settings).
  toggleMusic() {
    settings.set('musicOn', settings.data.musicOn === false);
    this.syncMusic();
    return settings.data.musicOn;
  }

  syncMusic() {
    if (!this.ready) return;
    this.musicRec.sync();
    if (this.inMenu) {
      if (this.musicRec.on) this.startMenuMusic();
      else this.stopMenuMusic(true);
    }
  }

  // Menu ticks: the recorded click, a faint high one for hover, a fuller one for choosing.
  uiSound(kind = 'hover') {
    if (!this.ready) return;
    this.play('click', kind === 'hover' ? { volume: 0.12, rate: 1.5, pitchVar: 0.04 } : { volume: 0.45, rate: 0.9, pitchVar: 0.04 });
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
  poorwill: 1,
  chime: 1,
  signCreak: 1,
  tick: 1,
  ping: 1,
  clunk: 1,
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
