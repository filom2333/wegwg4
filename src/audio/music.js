// Recorded music from public/music/, streamed: an <audio> element wired into the graph, not a
// decoded buffer (a three-minute song decoded whole is 60 MB of memory). music/index.json lists
// what is there:
//   { "menu": file,
//     "score": { "day": [files], "dawn": [..], "dusk": [..], "night": [..], "campfire": [..],
//                "rain": [..], "north": [..] },
//     "albums": { "<album id>": [file per track] }, "haven": [files],
//     "jingles": { "<station id>": file } }
// The background score is a calm track now and then with silence between, picked by the hour,
// the weather and the country; it fades away while the car stereo plays and comes back after.
// The menu theme and the score share the Music volume and the on/off switch (key U).

import { settings } from '../core/settings.js';
import { ALBUMS } from './music/albums.js';

const DIR = (import.meta.env.BASE_URL || '/') + 'music/';
const rnd = (a, b) => a + Math.random() * (b - a);
const LEVEL = { menu: 0.8, score: 0.55 };

export class Music {
  constructor(audio) {
    this.a = audio;
    const c = (this.ctx = audio.ctx);
    this.index = {};
    // menu theme and score: the Music volume
    this.bus = c.createGain();
    this.bus.connect(audio.master);
    this.applyVolume();
    this.score = { p: null, state: 'gap', t: rnd(25, 60), last: null, ducked: false, quiet: 0, kind: null };
  }

  async load() {
    try {
      const r = await fetch(DIR + 'index.json');
      if (r.ok) this.index = await r.json();
    } catch {
      this.index = {};
    }
  }

  get on() {
    return settings.data.musicOn !== false;
  }

  applyVolume() {
    this.bus.gain.value = settings.data.scoreVolume ?? 0.6;
  }

  // An <audio> element playing into `out` through its own gain (silent until faded in).
  player(out) {
    const el = new Audio();
    el.preload = 'auto';
    const src = this.ctx.createMediaElementSource(el);
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(out);
    return { el, g };
  }

  fade(p, to, seconds) {
    const now = this.ctx.currentTime;
    p.g.gain.cancelScheduledValues(now);
    p.g.gain.setValueAtTime(p.g.gain.value, now);
    p.g.gain.linearRampToValueAtTime(to, now + seconds);
  }

  start(p, file, { loop = false, at = 0, level = 1, fadeIn = 2 } = {}) {
    p.el.loop = loop;
    p.el.src = DIR + file;
    p.file = file;
    const go = () => {
      try {
        p.el.currentTime = Math.max(0, Math.min(at, (p.el.duration || 1e9) - 0.5));
      } catch {
        /* not seekable yet */
      }
      p.el.play().catch(() => {});
    };
    if (at > 0) p.el.addEventListener('loadedmetadata', go, { once: true });
    else go();
    this.fade(p, level, fadeIn);
  }

  stop(p, seconds = 1.5) {
    if (!p || !p.file) return;
    this.fade(p, 0, seconds);
    const file = p.file;
    setTimeout(() => {
      if (p.file === file && p.g.gain.value < 0.01) p.el.pause();
    }, seconds * 1000 + 100);
  }

  // ---------------------------------------------------------------- menu
  startMenu() {
    if (!this.index.menu) return false;
    this.inMenu = true;
    if (!this.on) return true;
    this.menu = this.menu || this.player(this.bus);
    // (also when it is still fading out from a moment ago)
    if (this.menu.file !== this.index.menu || this.menu.el.paused || this.menu.g.gain.value < LEVEL.menu * 0.9) this.start(this.menu, this.index.menu, { loop: true, level: LEVEL.menu, fadeIn: 3 });
    return true;
  }

  stopMenu() {
    if (this.menu) this.stop(this.menu, 1.5);
  }

  // ---------------------------------------------------------------- the car stereo's songs
  // (a track with no recording falls back to one the album has)
  songFile(album, track) {
    const al = ALBUMS[album % ALBUMS.length];
    const list = ((this.index.albums && this.index.albums[al.id]) || []).filter(Boolean);
    return list.length ? (this.index.albums[al.id][track] || list[track % list.length]) : null;
  }

  // Haven's own recordings, or else the calm score tracks between its bulletins.
  havenFiles() {
    if (this.index.haven && this.index.haven.length) return this.index.haven;
    const S = this.index.score || {};
    return ['day', 'dusk', 'night', 'dawn'].flatMap((k) => S[k] || []);
  }

  jingleFile(stationId) {
    return (this.index.jingles && this.index.jingles[stationId]) || null;
  }

  // ---------------------------------------------------------------- background score
  // What fits now: the weather first, then the country, then the hour.
  kindFor({ sunY, morning, rain, north, fire }) {
    const S = this.index.score || {};
    const has = (k) => S[k] && S[k].length;
    const night = sunY < -0.06;
    const order = [];
    if (rain > 0.35) order.push('rain');
    if (north > 0.5) order.push('north');
    if (night) order.push(...(fire ? ['campfire', 'night'] : ['night', 'campfire']));
    else if (sunY < 0.22) order.push(morning ? 'dawn' : 'dusk', 'day');
    else order.push('day');
    return order.find(has) || null;
  }

  pick(kind) {
    const list = this.index.score[kind];
    const pool = list.length > 1 ? list.filter((f) => f !== this.score.last) : list;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Each frame in a game. ctx: { sunY, morning, rain, north, fire, stereo (the car stereo can
  // be heard), quiet (asleep, dead, a menu up: no new track starts) }.
  update(dt, ctx) {
    const s = this.score;
    if (!this.index.score) return;
    const blocked = !this.on || ctx.stereo;
    if (s.state === 'play') {
      const p = s.p;
      if (blocked && !s.ducked) {
        // the radio came on (or music was switched off): fade away and hold the place
        s.ducked = true;
        this.fade(p, 0, this.on ? 2.5 : 0.8);
        s.holdT = 0;
      } else if (blocked) {
        s.holdT += dt;
        if (!this.on || s.holdT > 90) {
          // switched off, or the radio stayed on: let this track go, a new one later
          this.stop(p, 0.8);
          s.state = 'gap';
          s.t = rnd(20, 50);
          s.ducked = false;
        } else if (s.holdT > 3 && !p.el.paused) p.el.pause();
      } else if (s.ducked) {
        // the radio is off again: pick up where it was
        s.ducked = false;
        p.el.play().catch(() => {});
        this.fade(p, LEVEL.score, 4);
      } else if (p.el.ended) {
        s.state = 'gap';
        s.t = rnd(90, 240);
      }
      return;
    }
    // between tracks
    if (blocked || ctx.quiet) return;
    s.t -= dt;
    if (s.t > 0) return;
    const kind = this.kindFor(ctx);
    if (!kind) {
      s.t = 30;
      return;
    }
    s.p = s.p || this.player(this.bus);
    const file = this.pick(kind);
    s.last = file;
    s.kind = kind;
    this.start(s.p, file, { level: LEVEL.score, fadeIn: 5 });
    s.state = 'play';
    s.ducked = false;
  }

  // After the on/off switch changed (key U, the pause menu, Settings).
  sync() {
    if (!this.on) {
      if (this.score.p) this.fade(this.score.p, 0, 0.8);
      this.stopMenu();
    } else if (this.score.state === 'gap') {
      // switched on: something soon rather than in a few minutes
      this.score.t = Math.min(this.score.t, 3);
    }
  }
}
