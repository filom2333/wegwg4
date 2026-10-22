// The land's sound: layered ambience that follows the country, the hour and the weather. Wind
// gusting and whistling, leaves in the woods, sand hissing over the dunes, cicadas in the heat of
// the day and crickets at night - a soft bed plus a few singers placed on the ground around you,
// so they come from every side - birdsong thickest at dawn and dusk, ravens and a hawk over the
// desert, owls, coyotes and a poorwill at night, running water near rivers with frogs along the
// bank after dark, a campfire's crackle, the hum of a lit sign, wind chimes and creaking signs at
// the places along the road, and old houses creaking and knocking inside (muffled through the
// walls from outside). Indoors the world outside is muffled and your steps get a room; inside the
// car the cabin closes in. Where each sound sits and what it passes through is space.js.
// And the small touches: keys in the ignition, a hot engine ticking as it cools, gravel pinging
// in the wheel arches, the suspension knocking over a pothole, wipers squeaking on dry glass, a
// heartbeat when hurt, a stomach complaining, teeth chattering in the cold.

import * as THREE from 'three';
import { GEN } from './synth.js';
import { G, groups } from '../physics/physics.js';
import { clamp, smoothstep } from '../core/noise.js';

const SOLID = groups(0xffff, G.WORLD);
const DOWN = { x: 0, y: -1, z: 0 };

const V = new THREE.Vector3();
const set = (param, v, now, tc = 0.25) => param.setTargetAtTime(v, now, tc);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// places where a breeze finds a wind chime, and where an old sign swings
const CHIME_PLACES = ['homestead', 'house', 'houses', 'farm', 'ranch', 'cabin', 'lodge'];
const SIGN_PLACES = ['gasStation', 'motel', 'diner', 'outpost', 'sawmill', 'junkyard'];

export class Soundscape {
  constructor(audio) {
    this.a = audio;
    this.gust = 0.4;
    this.gustV = 0;
    this.T = { bird: 4, night: 12, place: 6, body: 5, floor: 0, house: 8 };
    this.mix = { forest: 0, desert: 0, grass: 0, north: 0, dunes: 0 };
    this.mixT = 0;
    this.engineTicks = 0;
    this.tickT = 0;
    this.pingT = 0;
    this.clunkT = 0;
    this.prevComp = new Map();
  }

  // The few sounds still made here, and the loops; after the audio system made its buses and
  // loaded the recordings.
  build() {
    const a = this.a,
      c = a.ctx,
      B = a.buffers;
    B.hum = GEN.hum(c);
    B.floorCreak = [GEN.creak(c, { f: 210, len: 0.45, seed: 383 }), GEN.creak(c, { f: 160, len: 0.6, seed: 384 })];
    B.keys = GEN.keys(c);
    B.squeak = [GEN.squeak(c, { seed: 411 }), GEN.squeak(c, { seed: 412, len: 0.22 })];
    // beds: the whole country at once, not placed
    const bed = (buf, { filter = null, freq = 1000, q = 0.7, name = null } = {}) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = c.createGain();
      g.gain.value = 0;
      let node = src;
      if (name && a.trim(name) !== 1) {
        const t = c.createGain();
        t.gain.value = a.trim(name);
        node = node.connect(t);
      }
      let f = null;
      if (filter) {
        f = c.createBiquadFilter();
        f.type = filter;
        f.frequency.value = freq;
        f.Q.value = q;
        node = node.connect(f);
      }
      node.connect(g).connect(a.amb);
      if (buf) src.start(0, Math.random() * buf.duration);
      return { src, g, f };
    };
    // a placed loop: somewhere in the world (a river, a fire, a lamp), heard from there
    const spot = (name, ref, at, bus = a.ambPos, band = 0) => {
      const buf = a.sample(name) || B[name];
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = c.createGain();
      g.gain.value = 0;
      const v = a.space.voice({ ref, bus, track: at });
      let node = src.connect(g);
      if (band) {
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = band;
        f.Q.value = 0.8;
        node = node.connect(f);
      }
      node.connect(v.input);
      v.input.gain.value = a.trim(name);
      if (buf) src.start(0, Math.random() * buf.duration);
      return { src, g, v };
    };
    this.waterAt = new THREE.Vector3();
    this.fireAt = new THREE.Vector3();
    this.lampAt = new THREE.Vector3();
    this.L = {
      cicadas: bed(a.sample('cicadas'), { name: 'cicadas' }),
      crickets: bed(a.sample('crickets'), { name: 'crickets' }),
      leaves: bed(B.pink, { filter: 'highpass', freq: 1700, q: 0.5 }),
      sand: bed(B.white, { filter: 'bandpass', freq: 5200, q: 0.6 }),
      whistle: bed(B.pink, { filter: 'bandpass', freq: 900, q: 9 }),
      water: spot('stream', 10, () => (this.water ? this.waterAt : null)),
      frogs: spot('frogs', 8, () => (this.water ? this.waterAt : null)),
      fire: spot('crackle', 2.5, () => (this.fire ? this.fireAt : null), a.sfxPos),
      hum: spot('hum', 3, () => (this.lamp ? this.lampAt : null), a.ambPos, 600),
    };
    // singers spread out around you: crickets in the grass at night, cicadas in the bushes by day
    this.choir = { crickets: this.chorus('crickets', 5, 4), cicadas: this.chorus('cicadas', 3, 5) };
    this.ready = true;
  }

  // A chorus spread out around you instead of one flat layer: a few singers, each in its own spot
  // on the ground, staying put as you walk past and starting up again further on.
  chorus(name, n, ref) {
    const a = this.a,
      c = a.ctx;
    const buf = a.sample(name);
    const list = [];
    for (let i = 0; i < n; i++) {
      const e = { pos: new THREE.Vector3(), live: false, fade: 0, amp: rnd(0.6, 1) };
      e.v = a.space.voice({ ref, bus: a.ambPos, wet: 0.5, track: () => (e.live ? e.pos : null) });
      e.v.input.gain.value = a.trim(name);
      e.src = c.createBufferSource();
      e.src.buffer = buf;
      e.src.loop = true;
      e.src.playbackRate.value = rnd(0.93, 1.07);
      e.g = c.createGain();
      e.g.gain.value = 0;
      e.src.connect(e.g).connect(e.v.input);
      if (buf) e.src.start(0, Math.random() * buf.duration);
      list.push(e);
    }
    return list;
  }

  sing(list, level, cam, now, dt) {
    const g = this.a.game,
      o = g.origin;
    for (const e of list) {
      if (level < 0.002) {
        set(e.g.gain, 0, now, 0.5);
        continue;
      }
      if (!e.live || e.pos.distanceTo(cam.position) > 30) {
        const ang = Math.random() * Math.PI * 2,
          r = rnd(5, 22);
        const x = cam.position.x + Math.cos(ang) * r,
          z = cam.position.z + Math.sin(ang) * r;
        e.pos.set(x, g.gen.height(x + o.x, z + o.z) + 0.15, z);
        e.live = true;
        e.fade = 0;
        e.g.gain.cancelScheduledValues(now);
        e.g.gain.setValueAtTime(0, now);
      }
      e.fade = Math.min(1, e.fade + dt / 2);
      set(e.g.gain, level * e.amp * e.fade, now, 0.3);
    }
  }

  // A spot inside a building near you (a room under a roof), or null: rays down from above find
  // a roof, then the floor of the room under it.
  roomNear(cam) {
    const g = this.a.game,
      ph = g.physics;
    if (!g.pois || !ph) return null;
    let best = null,
      bd = 45;
    for (const inst of g.pois.loaded.values()) {
      const d = inst.root.position.distanceTo(cam.position);
      if (d < bd) {
        bd = d;
        best = inst;
      }
    }
    if (!best) return null;
    const c = best.root.position;
    for (let k = 0; k < 8; k++) {
      const x = c.x + rnd(-12, 12),
        z = c.z + rnd(-12, 12);
      let y = c.y + 25;
      const roof = ph.raycast({ x, y, z }, DOWN, 40, SOLID);
      if (!roof || !roof.owner || roof.owner.kind !== 'structure') continue;
      y = roof.point.y - 0.3;
      for (let step = 0; step < 4; step++) {
        const hit = ph.raycast({ x, y, z }, DOWN, 8, SOLID);
        if (!hit) break;
        if (y - hit.point.y > 2) return new THREE.Vector3(x, hit.point.y + 1.1, z);
        y = hit.point.y - 0.3;
      }
    }
    return null;
  }

  // Positional one-shot on the ambience bus.
  at(name, pos, volume, opts = {}) {
    this.a.play(name, { at: pos, volume, bus: 'amb', ref: opts.ref ?? 12, rolloff: opts.rolloff ?? 1, pitchVar: opts.pitchVar ?? 0.08, rate: opts.rate });
  }

  update(dt) {
    if (!this.ready) return;
    const a = this.a,
      g = a.game,
      c = a.ctx;
    const now = c.currentTime;
    const env = g.env,
      gen = g.gen,
      player = g.player,
      cam = g.renderer.camera;
    if (!env || !player) return;
    const o = g.origin;
    const px = cam.position.x + o.x,
      pz = cam.position.z + o.z;
    const sunY = env.sunDir ? env.sunDir.y : 0.5;
    const rain = env.w.rain,
      wind = env.w.wind,
      dust = env.w.dust;
    const air = env.airTemp();

    // the country around, refreshed twice a second
    this.mixT -= dt;
    if (this.mixT <= 0) {
      this.mixT = 0.5;
      const w = gen.biomeWeights(px, pz);
      const M = this.mix;
      M.forest = (w.forest || 0) + (w.taiga || 0) * 0.9 + (w.prairie || 0) * 0.25;
      M.desert = (w.scrub || 0) + (w.dunes || 0) + (w.badlands || 0) + (w.saltflat || 0) * 0.5 + (w.highland || 0) * 0.6;
      M.grass = (w.prairie || 0) + (w.scrub || 0) * 0.4 + (w.highland || 0) * 0.4 + (w.forest || 0) * 0.3;
      M.north = (w.taiga || 0) + (w.tundra || 0);
      M.dunes = (w.dunes || 0) + (w.badlands || 0) * 0.4 + (w.saltflat || 0) * 0.6;
      this.water = this.findWater(gen, px, pz);
    }
    const M = this.mix;

    // gusts: a slow random walk the wind layers breathe with
    this.gustV += (Math.random() - 0.5) * dt * 1.4 - this.gustV * dt * 0.6;
    this.gust = clamp(this.gust + this.gustV * dt, 0, 1);
    this.gust += (0.45 - this.gust) * dt * 0.05;
    a.windGust = 0.6 + 0.8 * this.gust;

    // indoors and in the cabin the world outside is muffled; a room answers your steps
    const indoors = !player.seat && player.indoors;
    const cabin = a.inCabin || 0;
    set(a.ambLP.frequency, indoors ? 800 : 20000 - cabin * 17500, now, 0.3);
    set(a.sfxSend.gain, indoors ? 0.3 : 0, now, 0.3);
    a.space.update(dt, cam, { indoors, forest: clamp(M.forest, 0, 1) });

    // ---- continuous layers
    const L = this.L;
    const day = smoothstep(0.15, 0.55, sunY),
      night = 1 - smoothstep(-0.12, 0.03, sunY);
    const dry = 1 - Math.min(1, rain * 1.5);
    // the insects: a soft bed for the far-off hum of thousands, and a few singers placed close
    // around, so they come from every side and stay where they are as you turn
    const cic = 0.075 * day * smoothstep(19, 29, air) * dry * (1 - wind * 0.5) * Math.min(1, M.desert + M.grass * 0.4);
    const cri = 0.065 * night * smoothstep(5, 13, air) * dry * Math.min(1, M.grass + M.desert * 0.6 + M.forest * 0.5);
    set(L.cicadas.g.gain, cic * 0.4, now, 0.8);
    set(L.crickets.g.gain, cri * 0.4, now, 0.8);
    this.sing(this.choir.cicadas, cic * 1.2, cam, now, dt);
    this.sing(this.choir.crickets, cri * 1.1, cam, now, dt);
    set(L.leaves.g.gain, 0.11 * Math.min(1, M.forest) * (0.18 + wind * 0.82) * (0.4 + this.gust), now, 0.4);
    set(L.leaves.f.frequency, 1500 + this.gust * 1600, now, 0.4);
    set(L.sand.g.gain, (0.09 * Math.min(1, M.dunes) * wind * wind + dust * 0.12) * (0.4 + this.gust), now, 0.4);
    const howling = smoothstep(0.45, 0.9, wind + dust * 0.3);
    set(L.whistle.g.gain, 0.045 * howling * this.gust * this.gust, now, 0.3);
    set(L.whistle.f.frequency, 620 + this.gust * 950, now, 0.5);
    // water
    if (this.water) {
      const w = this.water;
      this.waterAt.set(w.x - o.x, w.y, w.z - o.z);
      set(L.water.g.gain, w.gain, now, 0.5);
      // frogs along the bank on a warm night
      set(L.frogs.g.gain, 0.2 * night * dry * smoothstep(6, 14, air) * Math.min(1, w.gain / 0.15), now, 1.2);
    } else {
      set(L.water.g.gain, 0, now, 0.5);
      set(L.frogs.g.gain, 0, now, 0.5);
    }
    // the nearest burning campfire
    const fire = (this.fire = g.campfires && g.campfires.near(cam.position, 30));
    if (fire) {
      this.fireAt.set(fire.pos.x, fire.pos.y + 0.3, fire.pos.z);
      set(L.fire.g.gain, 0.5 * Math.min(1, fire.hours * 2), now, 0.3);
    } else set(L.fire.g.gain, 0, now, 0.5);
    // a lit sign or lamp humming close by at night
    let lamp = null,
      ld = 40;
    if (g.pois)
      for (const l of g.pois.lightPool) {
        if (!(l.intensity > 0) || l.userData.beacon) continue;
        const d = l.position.distanceTo(cam.position);
        if (d < ld) {
          ld = d;
          lamp = l;
        }
      }
    this.lamp = lamp;
    if (lamp) this.lampAt.copy(lamp.position);
    set(L.hum.g.gain, lamp ? 0.05 : 0, now, 0.4);

    // ---- creatures and places
    this.events(dt, { sunY, rain, wind, night, day, cam, indoors });
    this.carTouches(dt, now);
    this.bodyTouches(dt, indoors);
  }

  // Where water runs near (global x/z), and how loud.
  findWater(gen, px, pz) {
    const rv = gen.riverAt(px, pz);
    if (rv && !rv.r.dry && !rv.r.frozen) {
      const d = Math.max(0, rv.d - rv.r.w);
      if (d < 140) return { x: px, z: rv.zc, y: rv.level, gain: 0.28 * (1 - smoothstep(6, 140, d)) };
    }
    for (const l of gen.lakesNear(pz, 1)) {
      if (l.frozen) continue;
      const dx = px - l.x,
        dz = pz - l.z;
      const d = Math.sqrt(dx * dx + dz * dz) - Math.max(l.rx, l.rz);
      if (d < 60) return { x: l.x + (dx / (d + Math.max(l.rx, l.rz))) * Math.max(l.rx, l.rz), z: l.z + (dz / (d + Math.max(l.rx, l.rz))) * Math.max(l.rx, l.rz), y: l.level, gain: 0.1 * (1 - smoothstep(0, 60, Math.max(0, d))) };
    }
    return null;
  }

  // Random point on a ring around the camera, `up` metres above it.
  around(cam, r0, r1, up = 0) {
    const ang = Math.random() * Math.PI * 2,
      r = rnd(r0, r1);
    return V.set(cam.position.x + Math.cos(ang) * r, cam.position.y + up, cam.position.z + Math.sin(ang) * r).clone();
  }

  events(dt, { sunY, rain, wind, night, day, cam, indoors }) {
    const g = this.a.game,
      M = this.mix,
      T = this.T;
    const quiet = indoors ? 0.5 : 1;
    // birds: a chorus at dawn and dusk, a few through the day; none in rain or the dark
    T.bird -= dt;
    if (T.bird <= 0) {
      const dawn = smoothstep(-0.05, 0.12, sunY) * (1 - smoothstep(0.25, 0.5, sunY));
      const busy = (0.25 + dawn * 1.6) * (1 - rain) * (1 - smoothstep(0.7, 1, wind)) * (sunY > -0.03 ? 1 : 0);
      T.bird = busy > 0.05 ? rnd(1.5, 7) / busy : 6;
      if (busy > 0.05) {
        const r = Math.random();
        if (M.forest > 0.4 && r < 0.75) this.at(r < 0.08 ? 'woodpecker' : 'song', this.around(cam, 12, 45, rnd(3, 9)), 0.22 * quiet, { ref: 10 });
        else if (M.grass > 0.4 && r < 0.6) this.at('meadowlark', this.around(cam, 15, 55, 1), 0.24 * quiet, { ref: 12 });
        else if (M.desert > 0.4) {
          if (r < 0.12) this.at('hawk', this.around(cam, 60, 160, rnd(50, 110)), 0.32 * quiet, { ref: 40 });
          else if (r < 0.45) this.at('caw', this.around(cam, 25, 90, rnd(5, 25)), 0.26 * quiet, { ref: 20 });
        } else if (r < 0.5) this.at('song', this.around(cam, 15, 50, rnd(2, 6)), 0.18 * quiet, { ref: 10 });
      }
    }
    // the night: owls in the woods, coyotes on the open land, wolves up north
    T.night -= dt;
    if (T.night <= 0) {
      T.night = rnd(14, 45);
      if (night > 0.5 && rain < 0.4) {
        const r = Math.random();
        if (M.forest > 0.4 && r < 0.6) this.at('owl', this.around(cam, 30, 90, rnd(6, 14)), 0.32 * quiet, { ref: 20 });
        else if (M.north > 0.5 && r < 0.3) this.at('howl', this.around(cam, 150, 300), 0.45 * quiet, { ref: 60 });
        else if ((M.desert > 0.3 || M.grass > 0.3) && r < 0.55) this.at('yips', this.around(cam, 120, 320), 0.5 * quiet, { ref: 60 });
        else if (M.desert > 0.3 || M.grass > 0.3) this.at('poorwill', this.around(cam, 25, 90, 0.5), 0.3 * quiet, { ref: 15 });
      }
    }
    // at the places along the road: a wind chime on a porch, a sign swinging on its chains
    T.place -= dt;
    if (T.place <= 0) {
      T.place = rnd(5, 16) / Math.max(0.3, wind);
      if (g.pois && wind > 0.12) {
        let best = null,
          bd = 70;
        for (const inst of g.pois.loaded.values()) {
          const d = inst.root.position.distanceTo(cam.position);
          if (d < bd) {
            bd = d;
            best = inst;
          }
        }
        if (best) {
          const p = best.root.position.clone().add(V.set(rnd(-8, 8), 2.6, rnd(-8, 8)));
          if (CHIME_PLACES.includes(best.poi.type)) this.at('chime', p, 0.22 * (0.5 + wind), { ref: 6 });
          else if (SIGN_PLACES.includes(best.poi.type)) this.at('signCreak', p, 0.3 * (0.4 + wind), { ref: 8, pitchVar: 0.2 });
        }
      }
    }
    // old houses: a door creaking in the draught, a board settling, a door knocking in its frame -
    // muffled through the walls when you are outside, close and in the next room when inside
    T.house -= dt;
    if (T.house <= 0) {
      T.house = rnd(10, 30) / (0.6 + wind + night * 0.6);
      const at = this.roomNear(cam);
      if (at) {
        const r = Math.random();
        const name = r < 0.4 ? 'doorCreak' : r < 0.75 ? 'floorCreak' : 'doorShut';
        this.a.play(name, { at, volume: name === 'doorShut' ? 0.3 : 0.45, ref: 3, pitchVar: 0.15, bus: 'amb' });
      }
    }
    void day;
  }

  // The car's small sounds.
  carTouches(dt, now) {
    const g = this.a.game,
      car = g.car;
    if (!car || !car.root.visible) return;
    const seated = !!g.player.seat && g.player.car === car;
    const d = car.dyn;
    const engineAt = () => car.type.POINTS.engine.clone().applyMatrix4(car.root.matrixWorld);
    // keys turning in the ignition
    if (this.prevIgn !== undefined && car.ignition !== this.prevIgn && seated) this.a.play('keys', { volume: 0.25 });
    this.prevIgn = car.ignition;
    // a hot engine ticks as it cools after it stops
    const running = d.engine.running;
    if (this.prevRunning && !running && car.engineTemp > 50) this.engineTicks = clamp((car.engineTemp - 40) / 50, 0.3, 1) * 45;
    this.prevRunning = running;
    if (this.engineTicks > 0 && !running) {
      this.engineTicks -= dt;
      this.tickT -= dt;
      if (this.tickT <= 0) {
        const k = this.engineTicks / 45;
        this.tickT = rnd(0.25, 1.2) / Math.max(0.15, k);
        this.a.play('tick', { at: engineAt(), volume: 0.18 * (0.3 + k), ref: 1.5 });
      }
    }
    const kmh = Math.abs(car.speedKmh);
    // gravel flicked up into the wheel arches
    if (kmh > 15) {
      let loose = 0;
      for (const w of d.wheels) if (w.contact && (w.surface === 'gravel' || w.surface === 'dirt')) loose++;
      if (loose) {
        this.pingT -= dt * (kmh / 25) * (loose / 4);
        if (this.pingT <= 0) {
          this.pingT = rnd(0.05, 0.5);
          const w = pick(d.wheels);
          this.a.play('ping', { at: w.contactPoint, volume: rnd(0.06, 0.18) * (seated ? 0.7 : 1), ref: 2, pitchVar: 0.25 });
        }
      }
    }
    // the suspension knocking over a pothole or a kerb
    this.clunkT -= dt;
    for (const w of d.wheels) {
      const prev = this.prevComp.get(w) ?? w.compression;
      const v = (w.compression - prev) / Math.max(dt, 1e-3);
      this.prevComp.set(w, w.compression);
      if (w.contact && v > 0.9 && this.clunkT <= 0 && kmh > 8) {
        this.clunkT = 0.3;
        this.a.play('clunk', { at: w.contactPoint, volume: clamp(v / 3, 0.15, 0.7), ref: 2 });
      }
    }
    // wipers: a squeak at each end of the sweep on dry glass, a swish on wet
    if (car.wipers) {
      const end = Math.cos(car.wiperPhase) > 0.98 ? 0 : Math.cos(car.wiperPhase) < -0.98 ? 1 : -1;
      if (end >= 0 && end !== this.wiperEnd) {
        const wet = g.env.w.rain > 0.15;
        this.a.play(wet ? 'swish' : 'squeak', { volume: (wet ? 0.08 : 0.16) * (seated ? 1 : 0.4) });
      }
      this.wiperEnd = end >= 0 ? end : this.wiperEnd;
    }
    void now;
  }

  // What the body says: a pounding heart when badly hurt, a growling stomach, chattering teeth,
  // panting after a run, old floorboards underfoot.
  bodyTouches(dt, indoors) {
    const g = this.a.game,
      p = g.player,
      T = this.T;
    if (p.dead) return;
    T.body -= dt;
    if (p.health < 30) {
      this.beatT = (this.beatT ?? 0) - dt;
      if (this.beatT <= 0) {
        this.beatT = 0.55 + (p.health / 30) * 0.45;
        this.a.play('heartbeat', { volume: 0.35 * (1 - p.health / 40), pitchVar: 0.02 });
      }
    }
    if (T.body <= 0) {
      T.body = rnd(6, 14);
      if (p.food < 18 && Math.random() < 0.45) this.a.play('stomach', { volume: 0.22, pitchVar: 0.15 });
      else if (p.warmth < 25 && !p.seat) this.a.play('chatter', { volume: 0.2, pitchVar: 0.1 });
    }
    // out of breath
    if (p.stamina < 25 && !p.seat) {
      this.pantT = (this.pantT ?? 0) - dt;
      if (this.pantT <= 0) {
        this.pantT = rnd(0.7, 1.0);
        this.a.play('pant', { volume: 0.18 * (1 - p.stamina / 25) + 0.05, pitchVar: 0.08 });
      }
    }
    // floorboards in old houses
    if (indoors && p.onWood && p.moving) {
      T.floor -= dt;
      if (T.floor <= 0) {
        T.floor = rnd(1.2, 4);
        this.a.play('floorCreak', { at: p.position, volume: 0.25, ref: 2, pitchVar: 0.2 });
      }
    }
  }
}
