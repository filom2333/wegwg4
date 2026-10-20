// Songs for the CDs: six albums in different styles, three tracks each. Every track is written
// out as a small arrangement with its own tempo, key, chord progression and groove. Melodies
// grow from a two-bar hook that is stated, answered and brought home; chords move with smooth
// voice leading; drums play patterns with fills into each section and crashes on the downbeats;
// sections build and drop (intro, verse, build, chorus, break, solo, outro). The instruments
// are in engine.js.

import { Mix, rng, mtof, pluck, epiano, pad, organ, bass, lead, steel, kick, snare, hat, brush, ride, clap, piano, bell, tom, crash, shaker, rim, riser } from './engine.js';

import { ALBUMS } from './albums.js';
export { ALBUMS };
export { SR } from './engine.js';

// ------------------------------------------------------------------ theory
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixo: [0, 2, 4, 5, 7, 9, 10],
  penta: [0, 2, 4, 7, 9],
  pentaMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

// Chord shapes, semitones above the chord root. A chord in a progression is
// [root above the key, shape, bass above the key for slash chords].
const Q = {
  5: [0, 7, 12],
  maj: [0, 4, 7],
  min: [0, 3, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  6: [0, 4, 7, 9],
  7: [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  9: [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  13: [0, 4, 10, 14, 21],
  m11: [0, 3, 7, 10, 14, 17],
  '7sus': [0, 5, 7, 10],
  '6sus': [0, 5, 7, 9],
  'maj7#11': [0, 4, 7, 11, 18],
};

const pc = (m) => ((m % 12) + 12) % 12;
// The note with the pitch class of m in [lo, lo + 11].
const low = (m, lo) => lo + pc(m - lo);
// The note with pitch class p nearest to m.
const near = (p, m) => {
  const d = pc(p - m);
  return d > 6 ? m + d - 12 : m + d;
};
// A fifth above the root, or a fourth below when that would climb past `top`.
const fifth = (m, top) => (m + 7 > top ? m - 5 : m + 7);
const tones = (key, ch) => Q[ch[1]].map((x) => pc(key + ch[0] + x));
const bassOf = (key, ch) => key + (ch[2] ?? ch[0]);
// The diatonic triad on a chord root (what a melody hears over a bare power chord).
function triad(key, scale, root) {
  const i = scale.indexOf(pc(root));
  if (i < 0) return [pc(key + root), pc(key + root + 7)];
  return [0, 2, 4].map((k) => pc(key + scale[(i + k) % scale.length]));
}
// The note `steps` scale steps above m (a harmony line).
function above(m, key, scale, steps) {
  let x = m,
    k = 0;
  while (k < steps) if (scale.includes(pc(++x - key))) k++;
  return x;
}

// Chord notes inside [lo, hi] that move least from the previous voicing (voice leading). The
// fifth goes first when there are more notes than `size`; `rootless` leaves the root to the bass.
function voicing(prev, key, ch, lo, hi, { size = 4, rootless = false } = {}) {
  let t = [...new Set(tones(key, ch))];
  if (rootless && t.length > 3) t = t.slice(1);
  const f = pc(key + ch[0] + 7);
  if (t.length > size && t.includes(f)) t = t.filter((x) => x !== f);
  t = t.slice(0, size);
  let best = null,
    bs = Infinity;
  for (let rot = 0; rot < t.length; rot++) {
    const ord = t.slice(rot).concat(t.slice(0, rot));
    for (let b = lo; b <= hi; b++) {
      if (pc(b) !== ord[0]) continue;
      const v = [b];
      for (let i = 1; i < ord.length; i++) {
        let m = v[i - 1] + 1;
        while (pc(m) !== ord[i]) m++;
        v.push(m);
      }
      if (v[v.length - 1] > hi) break;
      let sc = 0;
      if (prev) for (let i = 0; i < v.length; i++) sc += Math.abs(v[i] - prev[Math.min(i, prev.length - 1)]);
      else sc = Math.abs(v[0] + v[v.length - 1] - lo - hi);
      if (sc < bs) {
        bs = sc;
        best = v;
      }
    }
  }
  return best || t.map((x) => low(x, lo));
}

// A rhythm on a grid of `steps` per beat: 'x' starts a note ('X' accented), '-' holds it, '.'
// rests; '|' and spaces are only for reading. Returns [{ t, d, acc }] in beats.
function rhy(str, steps = 4) {
  const s = str.replace(/[ |]/g, '');
  const out = [];
  let open = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '-') {
      if (open) open.d += 1 / steps;
      continue;
    }
    open = null;
    if (c === '.') continue;
    open = { t: i / steps, d: 1 / steps, acc: c === 'X' };
    out.push(open);
  }
  return out;
}

// One bar of a drum part spread evenly over `beats`: 'X' accent, 'x' hit, 'o' ghost, '.' rest.
function hits(str, beats = 4) {
  const s = str.replace(/ /g, '');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const v = s[i] === 'X' ? 1 : s[i] === 'x' ? 0.72 : s[i] === 'o' ? 0.3 : 0;
    if (v) out.push({ t: (i * beats) / s.length, v });
  }
  return out;
}

// A singable line over rhythm `rh`: chord tones on the strong beats and long notes, mostly steps
// between (a leap is answered by a step back), an arch rising `arch` of the way to the top of the
// range at `peak` (0..1 through the phrase), one leap up early on (the gesture that makes a hook
// stick), and the last note on a chord tone near `end`. Notes in `keep` with the same onset are
// reused, nudged onto the chord where needed, so a phrase can bring its hook back over new chords.
function line(r, rh, o) {
  const { key, scale, lo, hi, chordAt, start, end, keep, peak = 0.6, arch = 0.65, meter = 4 } = o;
  const leapAt = rh.length > 3 ? 1 + Math.floor(r() * Math.min(3, rh.length - 2)) : -1;
  const pool = [];
  for (let m = lo; m <= hi; m++) if (scale.includes(pc(m - key))) pool.push(m);
  const idx = (m) => {
    let j = 0;
    for (let i = 0; i < pool.length; i++) if (Math.abs(pool[i] - m) < Math.abs(pool[j] - m)) j = i;
    return j;
  };
  let cur = idx(start),
    move = 0;
  const out = [];
  rh.forEach((n, i) => {
    const pcs = chordAt(n.t);
    const strong = n.d >= 1 || n.acc || Math.abs(n.t % meter) < 1e-6 || (meter === 4 && Math.abs(n.t % 2) < 1e-6);
    const k = keep && keep.find((x) => Math.abs(x.t - n.t) < 1e-3);
    if (k) {
      let m = k.m;
      if (strong && !pcs.includes(pc(m))) {
        let bm = m,
          bd = 99;
        for (const q of pool)
          if (pcs.includes(pc(q)) && Math.abs(q - m) < bd) {
            bd = Math.abs(q - m);
            bm = q;
          }
        if (bd <= 2) m = bm;
      }
      move = idx(m) - cur;
      cur = idx(m);
      out.push({ t: n.t, d: n.d, m });
      return;
    }
    const u = rh.length > 1 ? i / (rh.length - 1) : 0;
    const shape = u < peak ? u / peak : 1 - (u - peak) / (1 - peak);
    const target = start + shape * arch * (hi - start);
    let best = cur,
      bs = Infinity;
    for (let j = Math.max(0, cur - 4); j <= Math.min(pool.length - 1, cur + 4); j++) {
      const m = pool[j],
        dj = j - cur;
      const ct = pcs.includes(pc(m));
      let sc = Math.abs(m - target) * 0.16 + (i === leapAt ? (dj >= 2 && dj <= 4 ? -1 : 2) : Math.abs(dj) * 0.5);
      if (strong && !ct) sc += 3;
      if (ct) sc -= 0.5;
      if (dj === 0) sc += out.length >= 2 && out[out.length - 1].m === out[out.length - 2].m ? 3 : 1.1;
      if (Math.abs(move) >= 3 && Math.sign(dj) === Math.sign(move)) sc += 2.5;
      sc += r() * 1.3;
      if (sc < bs) {
        bs = sc;
        best = j;
      }
    }
    move = best - cur;
    cur = best;
    out.push({ t: n.t, d: n.d, m: pool[cur] });
  });
  if (end !== undefined && out.length) {
    const last = out[out.length - 1],
      pcs = chordAt(last.t),
      prev = out.length > 1 ? out[out.length - 2].m : last.m;
    let bm = last.m,
      bs = Infinity;
    for (const m of pool)
      if (pcs.includes(pc(m))) {
        const sc = Math.abs(m - end) + Math.abs(m - prev) * 0.4;
        if (sc < bs) {
          bs = sc;
          bm = m;
        }
      }
    last.m = bm;
  }
  return out;
}

// An eight-bar tune from a two-bar rhythm: the hook (bars 1-2), the hook again with an open
// ending on the fifth (3-4), the hook (5-6) and a cadence home on rhythm `rhB` (7-8). `o.ch(t)`
// gives the chord tones at beat t of the eight bars.
function tune(r, rhA, rhB, o) {
  const M = o.meter || 4,
    steps = o.steps || 4;
  const A = rhy(rhA, steps),
    B = rhy(rhB, steps);
  const off = (k) => ({ ...o, chordAt: (t) => o.ch(t + k * 2 * M) });
  const p1 = line(r, A, off(0));
  const head = p1.filter((x) => x.t < M);
  const p2 = line(r, A, { ...off(1), keep: head, end: near(o.key + 7, (o.lo + o.hi) / 2) });
  const p3 = line(r, A, { ...off(2), keep: p1 });
  const p4 = line(r, B, { ...off(3), keep: head, end: near(o.key, o.start) });
  return [p1, p2, p3, p4].flatMap((p, k) => p.map((x) => ({ ...x, t: x.t + k * 2 * M })));
}

// Improvised phrases over `bars` bars: each bar picks a rhythm from `rhythms`, starts where the
// last phrase ended and climbs a little higher; the last one lands on the root.
function improv(r, bars, o) {
  const M = o.meter || 4;
  const out = [];
  let start = o.start;
  for (let b = 0; b < bars; b++) {
    const rh = rhy(o.rhythms[Math.floor(r() * o.rhythms.length)], o.steps || 4);
    if (!rh.length) continue;
    const ph = line(r, rh, {
      ...o,
      chordAt: (t) => o.chordAt(t + b * M),
      start,
      arch: (o.arch || 0.4) + (0.4 * b) / bars,
      end: b === bars - 1 ? near(o.key, start + 3) : undefined,
    });
    for (const x of ph) out.push({ ...x, t: x.t + b * M });
    start = ph[ph.length - 1].m;
  }
  return out;
}

// ------------------------------------------------------------------ song frame
const mallet = (f, d, o) => bell(f, { ...o, len: d + (o.ring ?? 1.2) });

class Song {
  constructor(r, { bpm, meter = 4, swing = 0, unit = 0.5, form, tail = 4 }) {
    this.r = r;
    this.beat = 60 / bpm;
    this.meter = meter;
    this.swing = swing;
    this.unit = unit;
    this.bars = [];
    for (const [name, len, energy = 1, tag = ''] of form)
      for (let i = 0; i < len; i++) this.bars.push({ name, i, len, energy, tag, n: this.bars.length, first: i === 0, last: i === len - 1 });
    this.mix = new Mix(this.bars.length * meter * this.beat + tail);
    this.cache = new Map();
    this.cached = 0;
    this.kicks = [];
  }

  // Seconds at beat `pos` of bar `n`: swung off-beats plus up to `hum` s of human timing.
  at(n, pos, hum = 0.004) {
    let p = pos;
    if (this.swing) {
      const e = p / this.unit,
        k = Math.round(e);
      if (Math.abs(e - k) < 1e-3 && k % 2) p += this.swing * this.unit;
    }
    return (n * this.meter + p) * this.beat + (hum ? (this.r() - 0.5) * 2 * hum : 0);
  }

  bar(n) {
    return this.bars[n];
  }

  // Memoised render: an identical note is drawn once per song.
  v(key, fn) {
    let x = this.cache.get(key);
    if (!x) {
      if (this.cached > 8e6) {
        this.cache.clear();
        this.cached = 0;
      }
      x = fn();
      this.cache.set(key, x);
      this.cached += x.length;
    }
    return x;
  }

  // Instrument `fn(freq, seconds, opts)` at MIDI note m.
  note(tag, fn, m, d, o = {}) {
    const dq = Math.max(0.02, Math.round(d * 200) / 200);
    return this.v(tag + m + ':' + dq + JSON.stringify(o), () => fn(mtof(m), dq, o));
  }

  put(v, t, o) {
    this.mix.put(v, t, o);
  }

  // A drum part over bar n from a pattern; kicks are remembered for the sidechain.
  drum(n, str, voice, { gain = 1, pan = 0, rev = 0.1, dly = 0, kick = false, hum = 0.003 } = {}) {
    for (const h of hits(str, this.meter)) {
      const t = this.at(n, h.t, hum);
      this.put(voice, t, { gain: gain * h.v * (0.93 + this.r() * 0.14), pan, rev, dly });
      if (kick) this.kicks.push(t);
    }
  }

  // Plays notes { t (beats from bar n0), d, m } with inst(m, seconds, note, glideFrom).
  play(n0, notes, inst, opts, { legato = 0.95, hum = 0.006, shift = 0 } = {}) {
    let prev = null;
    for (const x of notes) {
      const k = Math.floor(x.t / this.meter + 1e-6);
      const glide = prev && Math.abs(prev.t + prev.d - x.t) < 0.01 && Math.abs(prev.m - x.m) <= 5 ? prev.m + shift : 0;
      this.put(inst(x.m + shift, x.d * this.beat * legato, x, glide), this.at(n0 + k, x.t - k * this.meter, hum), opts);
      prev = x;
    }
  }

  // A chord strummed low to high (or high to low), `gap` s between strings.
  strum(n, pos, notes, inst, opts, { gap = 0.012, up = false, hum = 0.005 } = {}) {
    const t0 = this.at(n, pos, hum);
    (up ? [...notes].reverse() : notes).forEach((m, j) => this.put(inst(m, j), t0 + j * gap, opts));
  }

  finish(o) {
    return this.mix.finish(o);
  }
}

// Toms rolling down over the last `beats` of bar n in 16ths, the snare leading in.
function tomFill(s, n, toms, sn, { beats = 1, gain = 0.5 } = {}) {
  const k = beats * 4,
    p0 = s.meter - beats;
  for (let i = 0; i < k; i++) {
    const j = Math.floor((i / k) * (toms.length + 1)) - 1;
    s.put(j < 0 ? sn : toms[j], s.at(n, p0 + i / 4, 0.003), { gain: gain * (0.72 + (0.28 * i) / k), pan: j < 0 ? 0 : 0.45 - j * 0.45, rev: 0.2 });
  }
}

// A snare roll swelling from g0 to g1 between beats `from` and `to` of bar n, `div` hits a beat.
function roll(s, n, sn, { div = 4, g0 = 0.15, g1 = 0.55, from = 0, to = 4 } = {}) {
  for (let p = from; p < to - 1e-6; p += 1 / div) s.put(sn, s.at(n, p, 0.002), { gain: g0 + ((g1 - g0) * (p - from)) / (to - from), rev: 0.25 });
}

// ------------------------------------------------------------------ synthwave
function synthwave(r, ti) {
  const T = [
    {
      bpm: 104,
      key: 57,
      verse: [
        [0, 'madd9'],
        [8, 'maj7'],
        [3, 'add9'],
        [10, 'sus2'],
      ],
      chorus: [
        [5, 'm7'],
        [8, 'maj7'],
        [10, 'add9'],
        [0, 'madd9'],
      ],
      hook: 'x--x--x-x---x-x-|x--x--x-x-------',
      cad: 'x--x--x-x---x---|x---------------',
      vr: 'x---x-x-x-------|x---x-x---x-----',
      vc: 'x---x-x-x-------|x---------------',
      arp: [0, 1, 2, 3, 4, 3, 2, 1],
      lift: 2,
      half: false,
      shape: 0.35,
    },
    {
      bpm: 92,
      key: 54,
      verse: [
        [0, 'm9'],
        [0, 'm9'],
        [8, 'maj7'],
        [10, '6'],
      ],
      chorus: [
        [8, 'maj7'],
        [10, 'add9'],
        [0, 'madd9'],
        [3, 'add9'],
      ],
      hook: 'x-----x-x-x-x---|x-----x-x--x----',
      cad: 'x-----x-x-x-x---|x---------------',
      vr: 'x-------x-x-x---|x-------x-------',
      vc: 'x-------x-x-x---|x---------------',
      arp: [0, 2, 1, 3, 2, 4, 3, 5],
      lift: 0,
      half: true,
      shape: 0.75,
    },
    {
      bpm: 86,
      key: 48,
      verse: [
        [0, 'm9'],
        [5, 'm7'],
        [8, 'maj7'],
        [7, '7sus'],
      ],
      chorus: [
        [8, 'maj7'],
        [10, 'add9'],
        [0, 'm9'],
        [7, '7'],
      ],
      hook: 'x--x--x---x-x-x-|x--x--x-x-x-----',
      cad: 'x--x--x---x-x-x-|x---------------',
      vr: '..x-x-x-x-------|..x-x-x---x-----',
      vc: '..x-x-x-x-------|x---------------',
      arp: [0, 1, 2, 1, 3, 2, 4, 3],
      lift: 0,
      half: false,
      shape: 0.2,
    },
  ][ti];
  const s = new Song(r, {
    bpm: T.bpm,
    tail: 6,
    form: [
      ['intro', 4, 0.3],
      ['verse', 8, 0.6],
      ['build', 4, 0.75],
      ['chorus', 8, 1],
      ['break', 4, 0.4],
      ['verse', 8, 0.65, 2],
      ['build', 4, 0.8],
      ['chorus', 8, 1],
      ['chorus', 8, 1, 'lift'],
      ['outro', 4, 0.3],
    ],
  });
  const sc = SCALES.minor;
  const chordOf = (b) => {
    if (!b) return T.verse[0];
    if (b.name === 'build' && b.last) return [(T.chorus[0][0] + 7) % 12, 'sus4'];
    return (b.name === 'chorus' || b.name === 'build' ? T.chorus : T.verse)[b.i % 4];
  };
  const keyOf = (b) => T.key + (b && b.tag === 'lift' ? T.lift : 0);
  const over = (prog) => (t) => tones(T.key, prog[Math.floor(t / 4) % prog.length]);
  const hook = tune(r, T.hook, T.cad, { key: T.key, scale: sc, lo: T.key + 7, hi: T.key + 22, start: T.key + 12, ch: over(T.chorus) });
  const verseTune = tune(r, T.vr, T.vc, { key: T.key, scale: sc, lo: T.key + 3, hi: T.key + 17, start: T.key + 7, ch: over(T.verse), arch: 0.35 });

  const K = kick({ tone: 46, punch: 1.1 }),
    SN = snare({ gate: 0.16, len: 0.42, seed: 21, tone: 200 }),
    CL = clap({ seed: 22 }),
    H = hat({ seed: 3 }),
    HO = hat({ seed: 4, open: true }),
    CR = crash({ seed: 5, len: 2.8 });
  const TOMS = [tom(190, { seed: 1 }), tom(140, { seed: 2 }), tom(100, { seed: 3 })];
  // drums first: the kick drives the sidechain pump of the pads and the bass
  for (const b of s.bars) {
    const { n, name } = b;
    if (b.first && (name === 'chorus' || name === 'outro' || (name === 'verse' && b.tag === 2))) s.put(CR, s.at(n, 0), { gain: 0.3, pan: -0.3, rev: 0.3 });
    if (name === 'chorus' && b.i === 4) s.put(CR, s.at(n, 0), { gain: 0.22, pan: 0.3, rev: 0.3 });
    if (name === 'verse' || name === 'chorus') {
      const ch = name === 'chorus';
      if (T.half) {
        s.drum(n, ch ? 'x......x..x.....' : 'x.........x.....', K, { gain: 0.95, kick: true });
        s.drum(n, '........X.......', SN, { gain: 0.62, rev: 0.6 });
        s.drum(n, '........x.......', CL, { gain: 0.3, rev: 0.5 });
        s.drum(n, ch ? 'x.x.x.x.x.x.x.x.' : 'x...x...x...x...', H, { gain: 0.22, pan: 0.3, rev: 0.05 });
        if (ch) s.drum(n, '......x.......x.', HO, { gain: 0.12, pan: -0.25 });
      } else {
        s.drum(n, 'X...x...X...x...', K, { gain: 0.9, kick: true });
        s.drum(n, '....X.......X...', SN, { gain: 0.5, rev: 0.5 });
        s.drum(n, '....x.......x...', CL, { gain: 0.26, rev: 0.4 });
        s.drum(n, ch ? 'xoxoxoxoxoxoxoxo' : 'x.o.x.o.x.o.x.o.', H, { gain: 0.2, pan: 0.3, rev: 0.05 });
        if (ch) s.drum(n, '..x...x...x...x.', HO, { gain: 0.11, pan: -0.25 });
      }
      if (b.last && name === 'verse') roll(s, n, SN, { from: 3, to: 4, g0: 0.15, g1: 0.4 });
      if (b.last && name === 'chorus') tomFill(s, n, TOMS, SN, { beats: 1, gain: 0.45 });
    } else if (name === 'build') {
      s.drum(n, 'x...x...x...x...', K, { gain: 0.85, kick: true });
      s.drum(n, 'x.x.x.x.x.x.x.x.', H, { gain: 0.15, pan: 0.3 });
      if (b.i < 2) s.drum(n, '....x.......x...', SN, { gain: 0.45, rev: 0.5 });
      else if (b.i === 2) roll(s, n, SN, { div: 2, g0: 0.2, g1: 0.4 });
      else {
        roll(s, n, SN, { div: 4, g0: 0.3, g1: 0.6, to: 3 });
        tomFill(s, n, TOMS, SN, { beats: 1, gain: 0.55 });
      }
    } else if (name === 'break' && b.last) tomFill(s, n, TOMS, SN, { beats: 2, gain: 0.42 });
    else if (name === 'outro' && b.first) s.drum(n, 'X...............', K, { gain: 0.9 });
  }
  s.mix.sidechain(s.kicks, 0.55, 0.15);

  const barS = 4 * s.beat;
  let pv = null;
  for (const b of s.bars) {
    const { n, name } = b;
    const key = keyOf(b),
      ch = chordOf(b);
    const v = (pv = voicing(pv, key, ch, key - 3, key + 16));
    const pumped = name === 'verse' || name === 'chorus' || name === 'build';
    // pads, opening up through the intro and closing again in the outro
    const cut = name === 'intro' ? 500 + b.i * 350 : name === 'chorus' ? 2600 : name === 'break' ? 1000 : name === 'outro' ? 1400 - b.i * 250 : 1600;
    const plen = name === 'outro' && b.last ? barS * 2.2 : barS;
    v.forEach((m, j) =>
      s.put(s.note('pad', pad, m, plen, { cutoff: cut, seed: m, attack: 0.3, release: 1.2, sweep: 0.25, detune: 0.14 }), s.at(n, 0, 0), { pan: (j / (v.length - 1)) * 1.2 - 0.6, gain: 0.09, rev: 0.45, duck: pumped ? 0.8 : 0 })
    );
    // the 16th arpeggio, accents grouped in threes across the bar
    if (name !== 'outro' || b.i < 3) {
      const top = v[3] ?? v[0] + 12;
      const pool = [v[0], v[1], v[2], top, v[0] + 12, v[1] + 12, v[2] + 12, top + 12];
      const ac = Math.round((name === 'intro' ? 700 + b.i * 600 : name === 'break' ? 1300 : name === 'outro' ? 1800 - b.i * 400 : 1800 + b.energy * 1600) / 200) * 200;
      const fade = name === 'intro' ? 0.35 + b.i * 0.2 : name === 'outro' ? 1 - b.i * 0.3 : 1;
      for (let k = 0; k < 16; k++) {
        const m = pool[T.arp[k % 8]] + 12;
        s.put(s.note('arp', lead, m, s.beat * 0.16, { shape: 0.85, vib: 0, cutoff: ac, attack: 0.003 }), s.at(n, k * 0.25, 0.002), {
          pan: k % 2 ? 0.35 : -0.35,
          gain: (k % 3 === 0 ? 0.12 : 0.075) * fade,
          rev: 0.25,
          dly: 0.3,
          duck: pumped ? 0.4 : 0,
        });
      }
    }
    // bass: octave 8ths in the verse, a galloping chorus, held roots through the build; the last
    // note walks to the next chord
    if (pumped) {
      const rn = low(bassOf(key, ch), 33);
      const nb = s.bar(n + 1),
        nr = nb ? low(bassOf(keyOf(nb), chordOf(nb)), 33) : rn;
      const pat = rhy(name === 'build' ? 'x---x---x---x---' : name === 'chorus' && !T.half ? 'x.xxx.xxx.xxx.xx' : 'x-x-x-x-x-x-x-x-');
      pat.forEach((x, k) => {
        let m = rn + (name === 'verse' && k % 2 ? 12 : 0);
        if (x.t >= 3.5 && nr !== rn) m = nr + (nr > rn ? -1 : 1);
        s.put(s.note('bs', bass, m, x.d * s.beat * 0.9, { kind: 'synth', cutoff: name === 'chorus' ? 560 : 420 }), s.at(n, x.t, 0.002), { gain: 0.42, rev: 0.02, duck: 0.3 });
      });
    }
    // tunes: glassy bells in the verses (only the second half of the first), the lead hook in
    // the choruses, doubled an octave down in the last one, a dark echo of it in the break
    if (b.first && name === 'verse')
      s.play(n, b.tag === 2 ? verseTune : verseTune.filter((x) => x.t >= 16), (m, d) => s.note('bell', mallet, m, d, { ratio: 3.5, index: 1.4, decay: 1.4, vel: 0.7 }), { gain: 0.17, rev: 0.4, dly: 0.3, pan: -0.15 });
    if (b.first && name === 'chorus') {
      const sh = key - T.key;
      s.play(n, hook, (m, d, x, g) => s.note('ld', lead, m, d, { shape: T.shape, vib: 0.01, cutoff: 3400, attack: 0.02, from: g ? mtof(g) : 0 }), { gain: 0.19, rev: 0.32, dly: 0.26, pan: 0.05 }, { shift: sh });
      if (b.tag === 'lift') s.play(n, hook, (m, d) => s.note('ld2', lead, m - 12, d, { shape: 0.8, vib: 0.006, cutoff: 2200, attack: 0.02 }), { gain: 0.09, rev: 0.3, pan: -0.3 }, { shift: sh });
      else if (b.n > 20) s.play(n, verseTune, (m, d) => s.note('bell', mallet, m + 12, d, { ratio: 3.5, index: 1.4, decay: 1.4, vel: 0.6 }), { gain: 0.08, rev: 0.45, dly: 0.35, pan: -0.4 });
    }
    if (b.first && name === 'break') s.play(n, hook.filter((x) => x.t < 16), (m, d) => s.note('ldb', lead, m - 12, d, { shape: 0.5, vib: 0.008, cutoff: 1400, attack: 0.05 }), { gain: 0.14, rev: 0.5, dly: 0.45 });
    if ((name === 'intro' || name === 'build' || name === 'break') && b.i === b.len - 2) s.put(s.v('riser', () => riser(barS * 2)), s.at(n, 0, 0), { gain: 0.1, rev: 0.35 });
    if (name === 'outro' && b.last) s.put(s.note('bellF', mallet, key + 24, barS, { ring: 3, ratio: 3.5, index: 1.2, decay: 0.8, vel: 0.7 }), s.at(n, 0), { gain: 0.15, rev: 0.6, dly: 0.4 });
  }
  return s.finish({ delay: s.beat * 0.75, feedback: 0.42, room: 0.86, damp: 0.3, seed: T.bpm });
}

// ------------------------------------------------------------------ rock
function rock(r, ti) {
  const P5 = (x) => [x, '5'];
  const T = [
    {
      bpm: 136,
      key: 40,
      feel: 'rock',
      scale: SCALES.minor,
      riff: 'mm1mm2m3|mm1m4312',
      verse: [P5(0)],
      build: [P5(8), P5(10), P5(5), P5(7)],
      chorus: [P5(8), P5(3), P5(10), P5(0)],
      push: 'x-----x-----x---',
      hook: 'x-x-x---x-x-x---|x-x-x-x-x-------',
      cad: 'x-x-x---x-x-x---|x---------------',
      form: [
        ['intro', 4],
        ['verse', 8],
        ['build', 4],
        ['chorus', 8],
        ['verse', 8],
        ['build', 4],
        ['chorus', 8],
        ['solo', 8],
        ['break', 4],
        ['chorus', 8, 1, 'harm'],
        ['outro', 4],
      ],
    },
    {
      bpm: 116,
      key: 45,
      feel: 'shuffle',
      swing: 0.33,
      scale: SCALES.dorian,
      riff: 'aabbaabb|aabbacbb',
      verse: [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7].map(P5),
      build: [P5(5), P5(5), P5(7), P5(7)],
      chorus: [P5(5), P5(0), P5(7), P5(0)],
      push: 'x-------x-----x-',
      hook: 'x-x---x-x-x-x---|x-----x-x-------',
      cad: 'x-x---x-x-x-x---|x---------------',
      form: [
        ['intro', 4],
        ['verse', 12],
        ['chorus', 8],
        ['verse', 12],
        ['chorus', 8],
        ['solo', 12],
        ['break', 4],
        ['chorus', 8, 1, 'harm'],
        ['outro', 4],
      ],
    },
    {
      bpm: 164,
      key: 38,
      feel: 'punk',
      scale: SCALES.major,
      riff: 'PPPPPPPP|PPPPPPPP',
      verse: [P5(0), P5(7), P5(9), P5(5)],
      build: [P5(5), P5(5), P5(7), P5(7)],
      chorus: [P5(5), P5(0), P5(7), P5(9)],
      push: 'x-x-x-x-x-x-x-x-',
      hook: 'x-x-x-x-x---x---|x-x-x-x-x-------',
      cad: 'x-x-x-x-x---x---|x---------------',
      form: [
        ['intro', 4],
        ['verse', 8],
        ['chorus', 8],
        ['verse', 8],
        ['chorus', 8],
        ['break', 8],
        ['solo', 8],
        ['chorus', 8],
        ['chorus', 8, 1, 'harm'],
        ['outro', 2],
      ],
    },
  ][ti];
  const s = new Song(r, { bpm: T.bpm, swing: T.swing || 0, form: T.form, tail: 4 });
  const pent = T.feel === 'punk' ? SCALES.penta : SCALES.pentaMinor;
  const soloProg = T.feel === 'shuffle' ? T.verse : T.chorus;
  const chordOf = (b) => {
    if (!b) return P5(0);
    if (b.name === 'chorus') return T.chorus[b.i % 4];
    if (b.name === 'solo') return soloProg[b.i % soloProg.length];
    if (b.name === 'build') return T.build[b.i % 4];
    return T.verse[b.i % T.verse.length];
  };
  const R = (b) => low(T.key + chordOf(b)[0], T.key);
  const mel = (prog) => (t) => triad(T.key, T.scale, prog[Math.floor(t / 4) % prog.length][0]);
  const hook = tune(r, T.hook, T.cad, { key: T.key, scale: T.scale, lo: T.key + 19, hi: T.key + 34, start: T.key + 24, ch: mel(T.chorus) });
  const soloRh = ['x-xxx-x-x-xx--x-', 'xxxxx-x-x---x-x-', '..x-x-x-x-x-x-x-', 'x-x-xxx-x-xxx-x-', 'x-------x-x-xxxx', 'x---x---x-x-x---'];
  const solo = improv(r, T.feel === 'shuffle' ? 12 : 8, { key: T.key, scale: pent, lo: T.key + 22, hi: T.key + 41, start: T.key + 27, rhythms: soloRh, chordAt: mel(soloProg) });

  const K = kick({ tone: 54, punch: 0.9, len: 0.35 }),
    SN = snare({ seed: 31, tone: 210, len: 0.3 }),
    H = hat({ seed: 6 }),
    HO = hat({ seed: 8, open: true, len: 0.25 }),
    RI = ride({ seed: 9 }),
    CR = crash({ seed: 7, len: 2.6 });
  const TOMS = [tom(200, { seed: 4 }), tom(150, { seed: 5 }), tom(105, { seed: 6 })];
  const gtr = (m, d, o, seed) => s.note('g', pluck, m, d, { ...o, seed });
  // two rhythm guitars hard left and right, each with its own timing
  const both = (n, pos, notes, o, gain, d) => {
    for (const [side, pan] of [
      [1, -0.6],
      [2, 0.6],
    ])
      notes.forEach((m, j) => s.put(gtr(m, d, o, side * 7 + j), s.at(n, pos, 0.006) + j * 0.004, { pan, gain, rev: 0.1 }));
  };
  const bassN = (m, d) => s.note('b', bass, m, d, { kind: 'finger', seed: 2 });
  const lg = (m, d, bendIn) => s.note('lg', pluck, bendIn ? m - 2 : m, d, { drive: 0.9, bright: 0.85, decay: 3, bend: bendIn ? 2 : 0, vib: d > 0.4 ? 0.004 : 0, body: 0.2 });
  // the riff, one token per eighth: m/M muted chug (M accented), P power chord, a/b/c boogie
  // dyads (root with fifth, sixth, seventh), digits single notes up the pentatonic
  const riffTok = T.riff.replace(/\|/g, '');
  const riffNotes = rhy(riffTok.replace(/[^.-]/g, 'x'), 2);

  for (const b of s.bars) {
    const { n, name } = b;
    const ch = chordOf(b),
      root = R(b);
    const nb = s.bar(n + 1);
    const nr = nb ? R(nb) : root;
    const hitBar = Math.max(1, b.len - 2);
    // ---- drums
    const drums = name !== 'intro' || b.i >= 2;
    if (drums && b.first && name !== 'intro') s.put(CR, s.at(n, 0), { gain: 0.32, pan: -0.3, rev: 0.15 });
    if (name === 'intro' && b.i === 2) s.put(CR, s.at(n, 0), { gain: 0.3, pan: 0.3, rev: 0.15 });
    if (name === 'intro' && b.i === 1) roll(s, n, SN, { from: 3, to: 4, g0: 0.25, g1: 0.5 });
    if (drums && !(name === 'outro' && b.i >= hitBar)) {
      const big = name === 'chorus' || name === 'solo';
      if (T.feel === 'punk') {
        if (big) {
          s.drum(n, 'x...x...x...x...', K, { gain: 0.85 });
          s.drum(n, '..x...x...x...x.', SN, { gain: 0.5, rev: 0.2 });
          s.drum(n, 'x.x.x.x.x.x.x.x.', RI, { gain: 0.18, pan: 0.35 });
        } else if (name === 'break') {
          s.drum(n, 'x.......x.x.....', K, { gain: 0.8 });
          s.drum(n, '........x.......', SN, { gain: 0.55, rev: 0.3 });
          s.drum(n, 'x...x...x...x...', HO, { gain: 0.16, pan: 0.35 });
        } else {
          s.drum(n, 'x.x.....x.x.....', K, { gain: 0.85 });
          s.drum(n, '....x.......x...', SN, { gain: 0.55, rev: 0.2 });
          s.drum(n, 'x.x.x.x.x.x.x.x.', H, { gain: 0.2, pan: 0.35 });
        }
      } else if (name === 'break') {
        s.drum(n, 'x.........x.....', K, { gain: 0.8 });
        s.drum(n, '........X.......', SN, { gain: 0.55, rev: 0.3 });
        s.drum(n, '..x...x...x...x.', TOMS[2], { gain: 0.3, pan: -0.35 });
      } else {
        s.drum(n, big ? 'x.....x.x.x.....' : 'x.....x.x.......', K, { gain: 0.85 });
        s.drum(n, big ? '....X.......X...' : '....X......oX...', SN, { gain: 0.55, rev: 0.22 });
        if (big) s.drum(n, 'x.x.x.x.x.x.x.x.', RI, { gain: 0.2, pan: 0.35 });
        else s.drum(n, 'X.x.X.x.X.x.X.x.', name === 'build' ? HO : H, { gain: 0.2, pan: 0.35 });
      }
      if (b.last && name !== 'outro') {
        if (name === 'build') roll(s, n, SN, { div: 4, from: 2, to: 4, g0: 0.2, g1: 0.55 });
        else tomFill(s, n, TOMS, SN, { beats: name === 'chorus' || name === 'solo' ? 2 : 1, gain: 0.5 });
      }
    }
    // ---- rhythm guitars and bass
    if (name === 'verse' || name === 'intro' || name === 'break' || (name === 'outro' && b.i < hitBar)) {
      const half = b.i % 2;
      const alone = name === 'intro' && b.i < 2;
      for (const x of riffNotes) {
        if (Math.floor(x.t / 4) !== half) continue;
        const c = riffTok[Math.round(x.t * 2)];
        const pos = x.t - half * 4,
          d = x.d * s.beat;
        let notes, o;
        if (c === 'm' || c === 'M') {
          notes = [root, root + 7];
          o = { mute: 1, drive: 1.1, bright: 0.65 };
        } else if (c === 'P') {
          notes = [root, root + 7, root + 12];
          o = { mute: name === 'verse' ? 1 : 0, drive: 1.1, bright: 0.75, decay: 1.4 };
        } else if ('abc'.includes(c)) {
          notes = [root, root + [7, 9, 10]['abc'.indexOf(c)]];
          o = { drive: 0.8, bright: 0.6, decay: 0.7 };
        } else {
          notes = [root + pent[+c % 5] + 12 * Math.floor(+c / 5)];
          o = { drive: 1.0, bright: 0.75, decay: 1.2 };
        }
        const g = c === 'M' ? 0.34 : 0.28;
        if (alone) notes.forEach((m, j) => s.put(gtr(m, d, o, 7 + j), s.at(n, pos, 0.005), { pan: -0.4, gain: g * 0.85, rev: 0.12 }));
        else both(n, pos, notes, o, g, d);
        // the bass doubles the riff an octave down (the shuffle walks instead)
        if (!alone && T.feel !== 'shuffle') s.put(bassN(notes.length > 1 ? root - 12 : notes[0] - 12, d * 0.9), s.at(n, pos, 0.003), { gain: 0.46, rev: 0.02 });
      }
      if (T.feel === 'shuffle' && !alone) (half ? [10, 9, 7, 4] : [0, 4, 7, 9]).forEach((iv, k) => s.put(bassN(root - 12 + iv, s.beat * 0.85), s.at(n, k, 0.003), { gain: 0.5, rev: 0.02 }));
    } else if (name === 'outro') {
      if (b.i === hitBar) {
        // the last chord, left to ring under a crash
        const r0 = low(T.key, T.key);
        both(n, 0, [r0, r0 + 7, r0 + 12], { drive: 1.1, bright: 0.75, decay: 4 }, 0.32, s.beat * 7);
        s.put(bassN(r0 - 12, s.beat * 7), s.at(n, 0), { gain: 0.5 });
        s.put(CR, s.at(n, 0), { gain: 0.38, rev: 0.25 });
        s.put(K, s.at(n, 0), { gain: 0.9 });
      }
    } else {
      // chords: whole notes then muted 8ths through the build, the push rhythm in the chorus
      const pw = [root, root + 7, root + 12];
      const muted = name === 'build' && b.i >= 2;
      const pat = name === 'build' ? (muted ? 'x-x-x-x-x-x-x-x-' : 'x---------------') : T.push;
      for (const x of rhy(pat)) both(n, x.t, pw, { mute: muted ? 1 : 0, drive: 1.1, bright: 0.8, decay: 1.8 }, muted ? 0.26 : 0.27, x.d * s.beat * 0.95);
      // bass: 8ths on the root, walking into the next chord
      for (let k = 0; k < 8; k++) {
        const m = k === 7 && nr !== root ? nr - 12 + (nr > root ? -1 : 1) : root - 12;
        s.put(bassN(m, s.beat * 0.45), s.at(n, k * 0.5, 0.003), { gain: 0.46, rev: 0.02 });
      }
    }
    // ---- leads: the chorus hook (harmonised in thirds at the end), licks answering the
    // verse riff, the solo
    if (b.first && name === 'chorus') {
      s.play(n, hook, (m, d, x) => lg(m, d, x.d >= 1 && pc(m - T.key) !== 0), { gain: 0.24, rev: 0.25, dly: 0.15, pan: 0.15 });
      if (b.tag === 'harm') s.play(n, hook, (m, d) => lg(above(m, T.key, T.scale, 2), d, false), { gain: 0.17, rev: 0.25, dly: 0.15, pan: -0.25 });
    }
    if (b.first && name === 'solo') s.play(n, solo, (m, d, x) => lg(m, d, x.d >= 1), { gain: 0.26, rev: 0.25, dly: 0.18, pan: 0.1 });
    if (name === 'verse' && b.i % 4 === 3 && b.n > 6) {
      const lick = line(r, rhy(['........x-x-xx-x', '........x-xxx---', '..........x-x-x-'][b.i % 3]), { key: T.key, scale: pent, lo: T.key + 22, hi: T.key + 36, start: T.key + 27, chordAt: () => triad(T.key, T.scale, ch[0]), end: root + 24 });
      s.play(n, lick, (m, d) => lg(m, d, false), { gain: 0.2, rev: 0.3, dly: 0.2, pan: 0.25 });
    }
  }
  return s.finish({ delay: s.beat * 0.5, feedback: 0.22, room: 0.7, damp: 0.45, seed: T.bpm });
}

// ------------------------------------------------------------------ country
function country(r, ti) {
  const M = (x) => [x, 'maj'];
  const T = [
    {
      bpm: 96,
      meter: 3,
      key: 43,
      feel: 'waltz',
      verse: [M(0), M(0), M(5), M(0), M(0), M(0), M(7), [7, '7']],
      chorus: [M(5), M(0), [9, 'min'], M(7), M(5), M(0), [7, '7'], M(0)],
      hook: 'x-----x---x-|x-----x-----',
      cad: 'x-----x---x-|x-----------',
      vr: 'x---x---x---|x-----------',
      vc: 'x---x---x---|x-----------',
      form: [
        ['intro', 4],
        ['verse', 8],
        ['chorus', 8],
        ['verse', 8],
        ['chorus', 8],
        ['solo', 8],
        ['chorus', 8, 1, 'last'],
        ['outro', 4],
      ],
    },
    {
      bpm: 118,
      meter: 4,
      key: 38,
      feel: 'train',
      verse: [M(0), M(0), M(5), M(0), M(0), [9, 'min'], M(7), M(7)],
      chorus: [M(5), M(0), M(7), [9, 'min'], M(5), M(0), [7, '7'], M(0)],
      hook: 'x-x-x---x-x-x---|x-x-x-x-x-------',
      cad: 'x-x-x---x-x-x---|x---------------',
      vr: 'x---x-x-x-------|x---x-x-x-------',
      vc: 'x---x-x-x-------|x---------------',
      form: [
        ['intro', 4],
        ['verse', 8],
        ['chorus', 8],
        ['verse', 8],
        ['chorus', 8],
        ['solo', 8],
        ['break', 4],
        ['chorus', 8],
        ['chorus', 8, 1, 'last'],
        ['outro', 4],
      ],
    },
    {
      bpm: 70,
      meter: 4,
      key: 45,
      feel: 'ballad',
      verse: [M(0), [7, 'maj', 11], [9, 'min'], M(5), M(0), [7, 'maj', 11], M(5), [7, 'sus4']],
      chorus: [M(5), [0, 'maj', 4], M(7), [9, 'min'], M(5), [0, 'maj', 4], [7, 'sus4'], M(0)],
      hook: 'x-x-x---x---x-x-|x-------x-x-x---',
      cad: 'x-x-x---x---x-x-|x---------------',
      vr: 'x---x-x-x-------|x---x-x-x-x-----',
      vc: 'x---x-x-x-------|x---------------',
      form: [
        ['intro', 4],
        ['verse', 8],
        ['chorus', 8],
        ['solo', 8],
        ['chorus', 8, 1, 'last'],
        ['outro', 4],
      ],
    },
  ][ti];
  const Mt = T.meter;
  const s = new Song(r, { bpm: T.bpm, meter: Mt, form: T.form, tail: 5 });
  const sc = SCALES.major;
  const chordOf = (b) => {
    if (!b) return M(0);
    if (b.name === 'chorus') return T.chorus[b.i % 8];
    if (b.name === 'intro') return T.chorus[4 + (b.i % 4)];
    if (b.name === 'outro') return b.i >= 2 ? M(0) : T.chorus[4 + b.i];
    return T.verse[b.i % 8];
  };
  const over = (prog) => (t) => tones(T.key, prog[Math.floor(t / Mt) % 8]);
  const lo = T.key + 19,
    hi = T.key + 34;
  const hook = tune(r, T.hook, T.cad, { key: T.key, scale: sc, lo, hi, start: T.key + 24, ch: over(T.chorus), meter: Mt });
  const verseTune = tune(r, T.vr, T.vc, { key: T.key, scale: sc, lo: lo - 3, hi: hi - 5, start: T.key + 19, ch: over(T.verse), meter: Mt, arch: 0.35 });
  const soloRh = Mt === 3 ? ['x-x-x-x-x-x-', 'x---x-x-x---', 'x-----x-x-x-', 'xxx-x-x-----'] : ['x-x-xxx-x-x-x---', 'x---x-x-x-x-x-x-', '..x-x-x-xxx-x---', 'x-xxx-x-x-------'];
  const solo = improv(r, 8, { key: T.key, scale: SCALES.penta, lo: lo - 2, hi: hi + 3, start: T.key + 24, rhythms: soloRh, meter: Mt, chordAt: over(T.verse) });

  const KK = kick({ tone: 58, punch: 0.4, len: 0.3 }),
    BR = brush({ seed: 41 }),
    SW = brush({ seed: 42, sweep: true, len: s.beat * 0.95 }),
    SNt = snare({ seed: 43, tone: 240, len: 0.14, noise: 0.7 }),
    H = hat({ seed: 45 }),
    CR = crash({ seed: 44, len: 2.4 });
  const guitar = (m, d, j) => s.note('ac', pluck, m, d, { bright: 0.58, decay: 1.1, seed: j, body: 0.45 });
  const upright = (m, d) => s.note('ub', bass, m, d, { kind: 'upright', seed: 1 });
  const fiddle = (m, d, x, g) => s.note('fd', lead, m, d, { shape: 0.88, vib: 0.024, attack: 0.07, breath: 0.05, cutoff: 3000, from: g ? mtof(g) : 0, glide: 0.09 });
  const steelM = (m, d, x, g) => s.note('st', steel, m, d, { from: g ? mtof(g) : x.d >= 1 ? mtof(m - 1) : 0 });
  const tele = (m, d) => s.note('tl', pluck, m, d * 0.7, { bright: 0.92, drive: 0.25, decay: 1, body: 0.2 });
  const lead1 = T.feel === 'waltz' ? fiddle : T.feel === 'train' ? tele : steelM;

  let pv = null;
  for (const b of s.bars) {
    const { n, name } = b;
    const ch = chordOf(b),
      nb = s.bar(n + 1),
      nch = nb ? chordOf(nb) : ch;
    const v = (pv = voicing(pv, T.key, ch, T.key + 10, T.key + 26, { size: 3 }));
    const rn = low(bassOf(T.key, ch), T.key - 12),
      nr = low(bassOf(T.key, nch), T.key - 12);
    const playing = name !== 'intro' || b.i >= 2 || T.feel === 'train';
    const change = nr !== rn && name !== 'outro';
    const f5 = fifth(rn, T.key - 1);
    // steps up (or down) the scale into the next chord's root
    const walk = (count) => {
      const out = [];
      let m = nr;
      for (let k = 0; k < count; k++) {
        m += nr > rn ? -1 : 1;
        while (!sc.includes(pc(m - T.key))) m += nr > rn ? -1 : 1;
        out.unshift(m);
      }
      return out;
    };
    if (b.first && (name === 'chorus' || (name === 'solo' && T.feel !== 'ballad')) && b.n > 4) s.put(CR, s.at(n, 0), { gain: 0.2, pan: -0.3, rev: 0.25 });
    if (T.feel === 'waltz') {
      // boom-chick-chick: bass on one (a walk-up into a new chord), guitar strums on two and three
      if (playing) {
        if (change) [rn, ...walk(2)].forEach((m, k) => s.put(upright(m, s.beat * 0.9), s.at(n, k), { gain: 0.5, rev: 0.03 }));
        else s.put(upright(b.i % 2 ? f5 : rn, s.beat * 1.8), s.at(n, 0), { gain: 0.5, rev: 0.03 });
      }
      s.put(guitar(rn + 12, s.beat, 9), s.at(n, 0), { pan: -0.2, gain: 0.3, rev: 0.12 });
      for (const k of [1, 2]) s.strum(n, k, [...v, v[0] + 12], (m, j) => guitar(m, s.beat * 0.7, j), { pan: 0.25, gain: 0.13, rev: 0.12 });
      if (playing) {
        for (let k = 0; k < 3; k++) s.put(SW, s.at(n, k), { pan: 0.15, gain: 0.2, rev: 0.08 });
        for (const k of [1, 2]) s.put(BR, s.at(n, k), { pan: 0.1, gain: 0.32, rev: 0.12 });
        s.put(KK, s.at(n, 0), { gain: 0.4 });
      }
      // a soft organ bed under the choruses
      if (name === 'chorus') v.forEach((m, j) => s.put(s.note('org', organ, m, s.beat * 3, { bars: [0.4, 0.8, 0.3, 0.1, 0], vib: 0.003 }), s.at(n, 0, 0), { pan: j * 0.3 - 0.3, gain: 0.05, rev: 0.35 }));
    } else if (T.feel === 'train') {
      // two-beat: root and fifth, a walk-up into a new chord, strums with up-strokes between
      const line2 = change ? [[0, rn, 1.8], ...walk(2).map((m, k) => [2 + k, m, 0.9])] : [[0, rn, 1.8], [2, f5, 1.8]];
      for (const [t, m, d] of line2) s.put(upright(m, s.beat * d), s.at(n, t), { gain: 0.5, rev: 0.03 });
      s.put(guitar(rn + 12, s.beat, 9), s.at(n, 0), { pan: -0.2, gain: 0.26, rev: 0.1 });
      s.put(guitar(f5 + 12, s.beat, 9), s.at(n, 2), { pan: -0.2, gain: 0.24, rev: 0.1 });
      for (const [k, up] of [
        [1, false],
        [1.5, true],
        [3, false],
        [3.5, true],
      ])
        s.strum(n, k, up ? v.slice(1).concat(v[0] + 12) : [...v, v[0] + 12], (m, j) => guitar(m, s.beat * 0.45, j), { pan: 0.25, gain: up ? 0.08 : 0.13, rev: 0.1 }, { up, gap: 0.009 });
      if (name !== 'intro' || b.i >= 2) {
        s.drum(n, 'x.......x.......', KK, { gain: 0.5 });
        s.drum(n, 'ooooXoooooooXooo', SNt, { gain: 0.32, pan: 0.1, rev: 0.12 });
        if (name === 'chorus' || name === 'solo') s.drum(n, 'x.x.x.x.x.x.x.x.', H, { gain: 0.12, pan: 0.35 });
      }
      // banjo rolls through the second half of the song
      if (b.n > 30 || name === 'break') {
        const pool = [v[0] + 12, v[1] + 12, v[2] + 12, T.key + 31];
        const roll3 = [0, 1, 3, 0, 1, 3, 0, 3, 0, 2, 3, 0, 2, 3, 0, 3];
        for (let k = 0; k < 16; k++) s.put(s.note('bj', pluck, pool[roll3[k]], s.beat * 0.3, { bright: 0.95, decay: 0.45, body: 0.05, seed: k % 3 }), s.at(n, k * 0.25, 0.003), { pan: -0.45, gain: k % 3 === 0 ? 0.12 : 0.08, rev: 0.12 });
      }
      if (name === 'chorus' || name === 'break') v.forEach((m, j) => s.put(s.note('sts', steel, m + 12, s.beat * 3.8, {}), s.at(n, 0, 0), { pan: 0.45 - j * 0.2, gain: 0.06, rev: 0.4 }));
    } else {
      // ballad: broken piano chords in eighths, upright bass in halves, brushes
      const pp = [rn + 12, v[0], v[1], v[2], v[0] + 12];
      const ord = [0, 1, 2, 3, 4, 3, 2, 1];
      for (let k = 0; k < 8; k++) s.put(s.note('pn', piano, pp[ord[k]], s.beat * 1.6, { vel: k === 0 ? 0.6 : 0.45, bright: 0.4 }), s.at(n, k * 0.5, 0.006), { pan: (ord[k] - 2) * 0.15, gain: 0.3, rev: 0.3 });
      if (playing) {
        const bl = change ? [[0, rn, 2.8], [3, walk(1)[0], 0.9]] : [[0, rn, 1.8], [2, f5, 1.8]];
        for (const [t, m, d] of bl) s.put(upright(m, s.beat * d), s.at(n, t), { gain: 0.5, rev: 0.04 });
        for (let k = 0; k < 4; k++) s.put(SW, s.at(n, k), { pan: 0.15, gain: 0.18, rev: 0.12 });
        if (name !== 'intro') {
          for (const k of [1, 3]) s.put(BR, s.at(n, k), { pan: 0.1, gain: 0.3, rev: 0.15 });
          s.put(KK, s.at(n, 0), { gain: 0.35 });
        }
      }
      if (name === 'chorus' || name === 'solo')
        v.forEach((m, j) => s.put(s.note('str', pad, m + 12, s.beat * 4, { voices: 4, detune: 0.09, cutoff: 1500, attack: 0.8, release: 1.4, seed: m, vib: 0.003 }), s.at(n, 0, 0), { pan: j * 0.4 - 0.4, gain: 0.07, rev: 0.45 }));
    }
    // ---- tunes: steel (or the tele) on the verse, the lead on the hook and the solo, the steel
    // answering the ends of the phrases
    if (b.first && name === 'verse') s.play(n, verseTune, T.feel === 'train' ? tele : steelM, { gain: 0.28, rev: 0.35, dly: 0.1, pan: 0.3 });
    if (b.first && name === 'chorus') {
      s.play(n, hook, lead1, { gain: T.feel === 'waltz' ? 0.17 : 0.28, rev: 0.35, dly: 0.08, pan: -0.1 });
      if (b.tag === 'last') s.play(n, hook, (m, d, x, g) => steelM(above(m, T.key, sc, 2), d, x, g ? above(g, T.key, sc, 2) : 0), { gain: 0.16, rev: 0.4, pan: 0.4 });
    }
    if (b.first && name === 'solo') s.play(n, solo, lead1, { gain: T.feel === 'waltz' ? 0.17 : 0.27, rev: 0.35, dly: 0.08, pan: -0.05 });
    if (b.first && name === 'intro') s.play(n, hook.filter((x) => x.t >= 4 * Mt).map((x) => ({ ...x, t: x.t - 4 * Mt })), steelM, { gain: 0.26, rev: 0.4, dly: 0.1, pan: 0.2 });
    if ((name === 'verse' || name === 'chorus') && b.i % 4 === 3) {
      const fill = line(r, rhy(Mt === 3 ? '....x-x-x---' : '........x-x-x---'), { key: T.key, scale: SCALES.penta, lo: lo - 2, hi, start: T.key + 26, meter: Mt, chordAt: () => tones(T.key, ch), end: T.key + 24 });
      s.play(n, fill, steelM, { gain: 0.18, rev: 0.45, dly: 0.15, pan: 0.45 });
    }
    if (name === 'outro' && b.last) {
      [...v, v[0] + 12].forEach((m, j) => s.put(s.note('stE', steel, m + 12, s.beat * Mt * 2, {}), s.at(n, 0) + j * 0.05, { pan: 0.3 - j * 0.2, gain: 0.12, rev: 0.5 }));
      s.put(upright(low(T.key, T.key - 12), s.beat * Mt * 2), s.at(n, 0), { gain: 0.5 });
    }
  }
  return s.finish({ delay: s.beat, feedback: 0.22, room: 0.75, damp: 0.4, seed: T.bpm });
}

// ------------------------------------------------------------------ ambient
function ambient(r, ti) {
  const T = [
    {
      bpm: 72,
      key: 50,
      scale: SCALES.major,
      prog: [
        [0, 'maj9'],
        [9, 'm11'],
        [5, 'maj7#11'],
        [7, '6sus'],
      ],
      pulse: 'ostinato',
      mel: 'x-------x---x---|x-----------x---',
      cad: 'x-------x---x---|x---------------',
    },
    {
      bpm: 64,
      key: 53,
      scale: SCALES.major,
      prog: [
        [0, 'maj9'],
        [4, 'm7'],
        [2, 'm9'],
        [5, 'maj7#11'],
      ],
      pulse: 'piano',
      mel: 'x---x---x-------|x-------x-------',
      cad: 'x---x---x-------|x---------------',
    },
    {
      bpm: 84,
      key: 49,
      scale: SCALES.minor,
      prog: [
        [0, 'm9'],
        [8, 'maj9'],
        [3, 'add9'],
        [10, '6'],
      ],
      pulse: 'beat',
      mel: 'x--x--x-x-------|x--x--x---x-----',
      cad: 'x--x--x-x-------|x---------------',
    },
  ][ti];
  const s = new Song(r, {
    bpm: T.bpm,
    tail: 8,
    form: [
      ['intro', 4],
      ['a', 8],
      ['b', 8],
      ['c', 8],
      ['a', 8, 1, 2],
      ['outro', 4],
    ],
  });
  // every section starts on the first chord, each chord lasts two bars; the outro stays home
  const chordOf = (b) => T.prog[b.name === 'outro' ? 0 : Math.floor(b.i / 2) % 4];
  const over = (t) => tones(T.key, T.prog[Math.floor(t / 8) % 4]);
  const tuneA = tune(r, T.mel, T.cad, { key: T.key, scale: T.scale, lo: T.key + 14, hi: T.key + 31, start: T.key + 19, ch: over, arch: 0.45 });
  const K = kick({ tone: 42, punch: 0.35, len: 0.5 }),
    SH = shaker({ seed: 51 }),
    RM = rim({ seed: 52 }),
    K2 = kick({ tone: 48, punch: 0.6, len: 0.4 });
  const bar = 4 * s.beat;
  const steelG = (m, d, x, g) => s.note('st', steel, m, d, { from: g ? mtof(g) : 0 });
  let pv = null;
  for (const b of s.bars) {
    const { n, name } = b;
    const ch = chordOf(b);
    const first = b.i % 2 === 0;
    if (first) pv = voicing(pv, T.key, ch, T.key + 2, T.key + 21, { size: 4 });
    const v = pv;
    const top = v[3] ?? v[0] + 12;
    // pads and a drone, a new chord every two bars, swelling in
    if (first) {
      const cut = name === 'intro' ? 700 : name === 'c' ? 2000 : 1300;
      const L = name === 'outro' && b.i === 2 ? bar * 3 : bar * 2;
      v.forEach((m, j) => s.put(s.note('pd', pad, m, L, { voices: 4, detune: 0.08, cutoff: cut + j * 150, attack: 1.6, release: 3, seed: m, sweep: 0.4, vib: 0.002 }), s.at(n, 0, 0), { pan: (j / 3) * 1.4 - 0.7, gain: 0.1, rev: 0.7 }));
      s.put(s.note('dr', pad, low(T.key + ch[0], T.key - 12), L, { voices: 3, detune: 0.05, cutoff: 280, attack: 2, release: 3, seed: 9 }), s.at(n, 0, 0), { gain: 0.22, rev: 0.35 });
    }
    const groove = name === 'b' || name === 'c';
    if (T.pulse === 'ostinato') {
      // a six-note harp figure cycling through bars of eight, so it drifts against the beat
      if (name !== 'intro' && name !== 'outro') {
        const fig = [0, 2, 4, 1, 3, 5];
        const pool = [v[0] + 12, v[1] + 12, v[2] + 12, top + 12, v[0] + 24, v[1] + 24];
        for (let k = 0; k < 8; k++) {
          const g = b.n * 8 + k;
          s.put(s.note('hp', pluck, pool[fig[g % 6]], s.beat * 0.5, { bright: 0.32, decay: 2.4, body: 0.2, seed: 1 }), s.at(n, k * 0.5, 0.004), { pan: k % 2 ? 0.4 : -0.4, gain: k % 4 === 0 ? 0.15 : 0.1, rev: 0.45, dly: 0.35 });
        }
      }
      if (groove) {
        s.drum(n, 'x.......x.......', K, { gain: 0.55 });
        if (name === 'c') s.drum(n, 'x.x.x.x.x.x.x.x.', SH, { gain: 0.16, pan: 0.3, rev: 0.2 });
      }
    } else if (T.pulse === 'piano') {
      // broken chords on the piano in quarters, held with the pedal
      const pool = [v[0], v[2], v[1], top, v[0] + 12, v[2] + 12];
      const ord = name === 'c' ? [0, 2, 4, 3, 5, 3, 4, 2] : [0, 2, 1, 3, 0, 2, 1, 3];
      if (name !== 'intro' || b.i >= 2)
        for (let k = 0; k < 4; k++) {
          const j = ord[(b.i % 2) * 4 + k];
          s.put(s.note('pn', piano, pool[j], s.beat * 2.5, { vel: k === 0 ? 0.5 : 0.38, bright: 0.25 }), s.at(n, k, 0.008), { pan: (j - 2) * 0.18, gain: 0.32, rev: 0.55, dly: 0.12 });
        }
      if (groove) s.drum(n, 'x...............', K, { gain: 0.45 });
    } else {
      // downtempo: electric piano chords, round bass, kick, rim and shaker
      if (name !== 'outro' || b.i < 3)
        for (const x of rhy(b.i % 2 ? 'x-----x-x-------' : 'x-------x--x----'))
          v.forEach((m, j) => s.put(s.note('ep', epiano, m, x.d * s.beat, { vel: x.t === 0 ? 0.7 : 0.5, bright: 0.35 }), s.at(n, x.t, 0.005) + j * 0.008, { pan: (j - 1.5) * 0.2, gain: 0.17, rev: 0.35 }));
      if (name !== 'intro' && name !== 'outro') {
        const rn = low(T.key + ch[0], T.key - 12);
        for (const x of rhy('x-----x---x-----')) s.put(s.note('bs', bass, x.t === 2.5 ? fifth(rn, T.key) : rn, x.d * s.beat * 0.9, { kind: 'finger', seed: 3 }), s.at(n, x.t, 0.004), { gain: 0.42, rev: 0.03 });
        if (name !== 'c' || b.i >= 6) {
          s.drum(n, 'x.......x.x.....', K2, { gain: 0.75 });
          s.drum(n, '....x.......x...', RM, { gain: 0.32, rev: 0.25, pan: -0.1 });
        }
        s.drum(n, 'xoxoxoxoxoxoxoxo', SH, { gain: 0.18, pan: 0.3, rev: 0.15 });
      } else s.drum(n, '....x.......x...', RM, { gain: 0.2, rev: 0.35 });
    }
    // the tune: glass (steel) or vibraphone in B, bells in C, once more an octave down at the end
    if (b.first && name === 'b')
      s.play(n, tuneA, T.pulse === 'beat' ? (m, d) => s.note('vb', mallet, m, d, { ratio: 1, index: 0.8, decay: 0.9, trem: 0.35, ring: 0.8 }) : steelG, { gain: T.pulse === 'beat' ? 0.3 : 0.22, rev: 0.55, dly: 0.35, pan: 0.15 });
    if (b.first && name === 'c') {
      s.play(n, tuneA, (m, d) => s.note('bl', mallet, m + 12, d, { ratio: 3.5, index: 1.2, decay: 1.1, vel: 0.6, ring: 1.6 }), { gain: 0.14, rev: 0.6, dly: 0.45, pan: -0.3 });
      if (T.pulse !== 'ostinato') s.play(n, tuneA, steelG, { gain: 0.15, rev: 0.6, dly: 0.3, pan: 0.25 });
    }
    if (b.first && name === 'a' && b.tag === 2) s.play(n, tuneA.filter((x) => x.t < 16), (m, d) => s.note('lo', lead, m - 12, d, { shape: 0, vib: 0.008, cutoff: 700, attack: 0.25, breath: 0.1 }), { gain: 0.2, rev: 0.6, dly: 0.35 });
    if (name === 'intro' && b.i === 2) s.put(s.v('rs', () => riser(bar * 2, { from: 200, to: 2500 })), s.at(n, 0, 0), { gain: 0.05, rev: 0.6 });
  }
  return s.finish({ delay: s.beat * 0.75, feedback: 0.5, room: 0.93, damp: 0.28, wet: 1.25, seed: T.key, level: 0.2 });
}

// ------------------------------------------------------------------ blues
function blues(r, ti) {
  const T = [
    { bpm: 100, key: 40, feel: 'shuffle', swing: 0.33, quick: true, intro: 4, roles: ['head', 'head2', 'gtr', 'stop', 'head'] },
    { bpm: 58, key: 43, feel: 'slow', quick: true, intro: 2, roles: ['gtr', 'piano', 'gtr2'] },
    { bpm: 134, key: 46, feel: 'jump', swing: 0.3, quick: false, intro: 4, roles: ['horns', 'horns', 'gtr', 'stop', 'horns'] },
  ][ti];
  const slow = T.feel === 'slow';
  const steps = slow ? 3 : 4;
  const tw = [0, T.quick ? 5 : 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7];
  const form = [['intro', T.intro, 0.6]].concat(
    T.roles.map((t) => ['ch', 12, 1, t]),
    [['end', 2, 1]]
  );
  const s = new Song(r, { bpm: T.bpm, swing: T.swing || 0, form, tail: 5 });
  // the intro is the end of the form (the turnaround)
  const offOf = (b) => (!b || b.name === 'end' ? 0 : b.name === 'intro' ? tw[12 - b.len + b.i] : tw[b.i]);
  const key = T.key;
  const bl = SCALES.blues;
  // the blues "home" notes over every chord: root, minor third, fifth, flat seven, the chord root
  const home = (c) => [pc(key), pc(key + 3), pc(key + 7), pc(key + 10), pc(key + c)];
  const chAt12 = (t) => home(tw[Math.floor(t / 4) % 12]);
  const hlo = key + 24,
    hhi = key + 41;
  const rhs = slow
    ? ['x--x-xx-----', '..xx-xx--x--', 'x-----x-xx--', 'xxx-x-x-----', 'x--------x-x', '...x-xx-x---']
    : ['x-x-x-x-x---....', '..x-x-xxx-x-x---', 'x---x-x-x-x-x---', 'x-xxx-x-x-------', '....x-x-x-x-x-x-', 'x-------..x-x-x-'];
  // the head: a two-bar call over I, the same call over IV, an answer over V-IV, the turnaround
  const call = rhy(slow ? '...x-xx--x--|x-----------' : '..x-x-x-x---x---|x-------........', steps);
  const pA = line(r, call, { key, scale: bl, lo: hlo, hi: hhi, start: key + 31, chordAt: () => home(0), end: key + 31 });
  const pA2 = line(r, call, { key, scale: bl, lo: hlo, hi: hhi, start: key + 31, chordAt: () => home(5), keep: pA });
  const pB = line(r, rhy(slow ? 'x--x--x--x--|x-----------' : 'x-x-x-x-x-x-x---|x-------........', steps), { key, scale: bl, lo: hlo, hi: hhi, start: key + 34, chordAt: (t) => home(t < 4 ? 7 : 5), end: key + 24 });
  const head = [...pA, ...pA2.map((x) => ({ ...x, t: x.t + 16 })), ...pB.map((x) => ({ ...x, t: x.t + 32 }))];
  const solo = (lo2, hi2) => improv(r, 12, { key, scale: bl, lo: lo2, hi: hi2, start: lo2 + 7, rhythms: rhs, steps, chordAt: chAt12 });
  const solos = T.roles.map((role) => (role === 'gtr' || role === 'stop' || role === 'piano' ? solo(hlo - 2, hhi) : role === 'gtr2' ? solo(hlo + 3, hhi + 5) : null));
  // the turnaround: down the chromatic line from the octave, landing on V
  const turn = [12, 11, 10, 9].map((iv, k) => ({ t: k, d: 1, m: key + 24 + iv })).concat([{ t: 4, d: 2, m: key + 31 }]);
  // jump blues: a two-bar horn riff that follows the changes, in three-part harmony
  const riffA = line(r, rhy('x-x-..x-x-x-....|x---x-x-........'), { key, scale: SCALES.mixo, lo: key + 22, hi: key + 34, start: key + 28, chordAt: () => [pc(key), pc(key + 4), pc(key + 7), pc(key + 10)], end: key + 28 });

  const K = kick({ tone: 55, punch: 0.6, len: 0.3 }),
    SN = snare({ seed: 51, tone: 180, len: 0.25, noise: 0.8 }),
    RI = ride({ seed: 52 }),
    H = hat({ seed: 53 }),
    CR = crash({ seed: 54, len: 2.6 });
  const TOMS = [tom(190, { seed: 6 }), tom(130, { seed: 7 })];
  const harp = (m, d, x, g) => s.note('hp', lead, m, d, { shape: 0.3, breath: 0.22, vib: 0.02, cutoff: 2000, attack: 0.03, glide: 0.05, from: g ? mtof(g) : x.d >= 1 ? mtof(m - 1) : 0 });
  const sax = (m, d, x, g) => s.note('sx', lead, m, d, { shape: 0.75, breath: 0.25, vib: 0.02, cutoff: 1700, attack: 0.04, from: g ? mtof(g) : 0 });
  const gtrL = (m, d, x) => s.note('gl', pluck, x.d >= 1 ? m - 1 : m, d, { drive: 0.6, bright: 0.72, decay: 2.2, bend: x.d >= 1 ? 1 : 0, vib: d > 0.35 ? 0.005 : 0, body: 0.25 });
  const pianoR = (m, d) => s.note('pr', piano, m, d, { vel: 0.6, bright: 0.55 });
  const bassN = (m, d, kind = 'finger') => s.note('b', bass, m, d, { kind, seed: 1 });
  const org = (m, d, o = {}) => s.note('og', organ, m, d, o);
  const choruses = s.bars.filter((x) => x.name === 'ch' && x.first);
  let pv = null;
  for (const b of s.bars) {
    const { n, name } = b;
    const off = offOf(b),
      rn = key + off;
    const nr = key + offOf(s.bar(n + 1));
    const role = b.tag;
    const stop = role === 'stop' && b.i < 4;
    const v = (pv = voicing(pv, key, [off, '9'], key + 10, key + 27, { size: 4, rootless: T.feel === 'jump' }));
    if (b.first && name === 'ch' && b.n > T.intro) s.put(CR, s.at(n, 0), { gain: 0.24, pan: -0.3, rev: 0.2 });
    if (stop) {
      // stop time: the band hits the downbeat and leaves the soloist alone
      s.put(K, s.at(n, 0), { gain: 0.8 });
      s.put(CR, s.at(n, 0), { gain: 0.18, rev: 0.2 });
      s.put(bassN(rn - 12, s.beat * 0.8), s.at(n, 0), { gain: 0.5 });
      v.forEach((m) => s.put(org(m, s.beat * 0.7), s.at(n, 0), { gain: 0.08, rev: 0.25 }));
    } else if (name === 'end') {
      if (b.i === 0) {
        // the band's last bar under the ending lick
        [0, 4, 7, 9].forEach((iv, k) => s.put(bassN(rn - 12 + iv, s.beat * 0.9), s.at(n, k), { gain: 0.5 }));
        s.drum(n, slow ? 'x.....x.....' : 'x.......x.......', K, { gain: 0.75 });
        s.drum(n, slow ? '...x.....x..' : '....x.......x...', SN, { gain: 0.5, rev: 0.25 });
        roll(s, n, SN, { from: 2, to: 4, div: steps, g0: 0.15, g1: 0.5 });
      } else {
        // a chord a half step up, then home, held under a crash
        voicing(pv, key, [1, '9'], key + 10, key + 27).forEach((m) => s.put(org(m, s.beat * 0.4), s.at(n, 0), { gain: 0.09, rev: 0.3 }));
        s.put(bassN(key - 11, s.beat * 0.4), s.at(n, 0), { gain: 0.5 });
        const t1 = s.at(n, slow ? 2 / 3 : 0.5, 0);
        v.forEach((m) => s.put(org(m, s.beat * 4), t1, { gain: 0.1, rev: 0.4 }));
        s.put(bassN(key - 12, s.beat * 4), t1, { gain: 0.55 });
        s.put(CR, t1, { gain: 0.35, rev: 0.3 });
        s.put(K, t1, { gain: 0.85 });
        s.put(gtrL(key + 36, s.beat * 3.5, { d: 2 }), t1 + 0.02, { gain: 0.24, rev: 0.4, pan: 0.2 });
      }
    } else {
      const fillBar = b.last && name === 'ch';
      if (T.feel === 'shuffle') {
        // boogie guitar on the low strings, the bass walking the same shape, organ held
        const shape = [7, 7, 9, 9, 7, 7, b.i % 2 ? 10 : 9, 9];
        shape.forEach((iv, k) => [rn, rn + iv].forEach((m, j) => s.put(s.note('bg', pluck, m, s.beat * 0.42, { drive: 0.55, bright: 0.55, decay: 0.8, seed: j + 1 }), s.at(n, k * 0.5, 0.004), { pan: -0.45, gain: 0.24, rev: 0.1 })));
        (b.i % 2 ? [10, 9, 7, 4] : [0, 4, 7, 9]).forEach((iv, k) => s.put(bassN(rn - 12 + iv, s.beat * 0.85), s.at(n, k, 0.003), { gain: 0.5, rev: 0.02 }));
        v.forEach((m, j) => s.put(org(m, s.beat * 3.9, { vib: 0.005 }), s.at(n, 0, 0), { pan: 0.35 + j * 0.05, gain: 0.045, rev: 0.3 }));
        s.drum(n, 'x...x...x...x...', K, { gain: 0.62 });
        s.drum(n, '....X.....o.X...', SN, { gain: 0.5, rev: 0.22 });
        s.drum(n, 'x.x.x.x.x.x.x.x.', role === 'gtr' || role === 'stop' ? RI : H, { gain: 0.2, pan: 0.35, rev: 0.08 });
        if (fillBar) tomFill(s, n, TOMS, SN, { beats: 1, gain: 0.4 });
      } else if (slow) {
        // 12/8: piano triplets, organ, walking bass with a triplet pickup, ride triplets
        for (const h of hits('.xx.xx.xx.xx')) v.forEach((m, j) => s.put(s.note('pc', piano, m, s.beat * 0.3, { vel: 0.4, bright: 0.35 }), s.at(n, h.t, 0.004) + j * 0.006, { pan: 0.25, gain: 0.13, rev: 0.25 }));
        v.forEach((m, j) => s.put(org(m, s.beat * 3.9, { vib: 0.006, bars: [0.6, 1, 0.4, 0.2, 0.1] }), s.at(n, 0, 0), { pan: -0.35 + j * 0.05, gain: 0.045, rev: 0.35 }));
        [0, 4, 7, 9].forEach((iv, k) => s.put(bassN(rn - 12 + iv, s.beat * 0.85), s.at(n, k, 0.003), { gain: 0.5, rev: 0.02 }));
        s.put(bassN(nr - 12 + (nr > rn ? -1 : 1), s.beat * 0.3), s.at(n, 3 + 2 / 3, 0.003), { gain: 0.42 });
        s.drum(n, 'x.....x.....', K, { gain: 0.6 });
        s.drum(n, '...X....oX..', SN, { gain: 0.48, rev: 0.3 });
        s.drum(n, 'x.xx.xx.xx.x', RI, { gain: 0.18, pan: 0.35 });
        if (fillBar) roll(s, n, SN, { div: 3, from: 3, to: 4, g0: 0.25, g1: 0.5 });
      } else if (name === 'intro' && b.i < 2) {
        // jump: the piano boogies alone to start
        [0, 4, 7, 9, 10, 9, 7, 4].forEach((iv, k) => s.put(s.note('pl', piano, rn - 12 + iv, s.beat * 0.45, { vel: 0.6, bright: 0.4 }), s.at(n, k * 0.5, 0.004), { pan: -0.2, gain: 0.28, rev: 0.15 }));
      } else {
        // jump: walking bass with chromatic approaches, Charleston piano, ride, hat on 2 and 4
        const walk = [rn, rn + (b.i % 2 ? 4 : 2), rn + 7, nr === rn ? rn + 9 : nr + (nr > rn ? -1 : 1)];
        walk.forEach((m, k) => s.put(bassN(low(m, key - 14), s.beat * 0.85, 'upright'), s.at(n, k, 0.003), { gain: 0.55, rev: 0.03 }));
        for (const p of b.i % 2 ? [0.5, 2.5] : [0, 1.5]) v.forEach((m, j) => s.put(s.note('pc', piano, m, s.beat * 0.45, { vel: 0.5, bright: 0.5 }), s.at(n, p, 0.004) + j * 0.005, { pan: 0.25, gain: 0.15, rev: 0.2 }));
        s.drum(n, 'x...x.x.x...x.x.', RI, { gain: 0.2, pan: 0.35, rev: 0.1 });
        s.drum(n, '....x.......x...', H, { gain: 0.16, pan: 0.3 });
        s.drum(n, 'o...o...o...o...', K, { gain: 0.6 });
        s.drum(n, '....x..o....x.o.', SN, { gain: 0.36, rev: 0.2 });
        if (fillBar) roll(s, n, SN, { from: 3, to: 4, g0: 0.2, g1: 0.45 });
      }
    }
    // ---- the voices on top
    if (name === 'intro' && b.i === b.len - 2) s.play(n, turn, slow ? gtrL : T.feel === 'jump' ? sax : harp, { gain: 0.22, rev: 0.3, pan: 0.15 });
    if (name === 'ch' && b.first) {
      const sol = solos[choruses.indexOf(b)];
      if (role === 'head' || role === 'head2') {
        s.play(n, head, harp, { gain: 0.24, rev: 0.3, dly: 0.08, pan: 0.1 });
        s.play(n + 10, turn, gtrL, { gain: 0.2, rev: 0.3, pan: -0.2 });
        if (role === 'head2')
          for (const at of [2, 6]) s.play(n + at, line(r, rhy(rhs[at % rhs.length], steps), { key, scale: bl, lo: hlo - 5, hi: hhi - 5, start: key + 26, chordAt: chAt12, end: key + 24 }), gtrL, { gain: 0.2, rev: 0.3, pan: -0.25 });
      } else if (role === 'horns') {
        // the riff moves with the chords, in parallel three-part harmony
        for (let j = 0; j < 12; j++) {
          const o2 = tw[j],
            sh = o2 === 7 ? -5 : o2;
          const part = riffA.filter((x) => Math.floor(x.t / 4) === j % 2).map((x) => ({ ...x, t: x.t - (j % 2) * 4 }));
          [0, 2, 4].forEach((st, k) => s.play(n + j, part.map((x) => ({ ...x, m: above(x.m, key, SCALES.mixo, st) + sh })), sax, { gain: k ? 0.1 : 0.15, rev: 0.25, pan: k * 0.35 - 0.35 }, { legato: 0.8 }));
        }
      } else if (sol) s.play(n, sol, role === 'piano' ? pianoR : role === 'stop' ? (T.feel === 'jump' ? sax : harp) : gtrL, { gain: role === 'piano' ? 0.3 : 0.24, rev: 0.3, dly: 0.08, pan: 0.1 });
    }
    if (name === 'end' && b.i === 0) s.play(n, [12, 10, 7, 6, 5, 3, 0, 0].map((iv, k) => ({ t: k * 0.5, d: k === 7 ? 1 : 0.5, m: key + 24 + iv })), gtrL, { gain: 0.24, rev: 0.3, pan: 0.15 });
  }
  return s.finish({ delay: s.beat * 0.66, feedback: 0.2, room: 0.72, damp: 0.5, seed: T.bpm });
}

// ------------------------------------------------------------------ lo-fi
function lofi(r, ti) {
  const T = [
    {
      bpm: 80,
      key: 53,
      scale: SCALES.major,
      prog: [
        [2, 'm9'],
        [7, '13'],
        [0, 'maj9'],
        [9, 'm9'],
      ],
      keys: 'epiano',
      comp: 'x-------x--x----',
      solo: 'flute',
      hook: 'x--x--x-x---....|x--x--x---x-x---',
      cad: 'x--x--x-x---....|x---------------',
      stop: false,
    },
    {
      bpm: 86,
      key: 48,
      scale: SCALES.minor,
      prog: [
        [8, 'maj7'],
        [7, 'm7'],
        [5, 'm9'],
        [10, '13'],
      ],
      keys: 'guitar',
      comp: 'x-----x---x-----',
      solo: 'vibes',
      hook: '..x-x-x-x-x-....|..x-x-x-x-------',
      cad: '..x-x-x-x-x-....|x---------------',
      stop: false,
    },
    {
      bpm: 70,
      key: 50,
      scale: SCALES.major,
      prog: [
        [9, 'm9'],
        [2, 'm9'],
        [7, '13'],
        [0, 'maj9'],
      ],
      keys: 'piano',
      comp: 'x---------x-----',
      solo: 'sax',
      hook: 'x---x-x-x-x-x---|x-------........',
      cad: 'x---x-x-x-x-x---|x---------------',
      stop: true,
    },
  ][ti];
  const s = new Song(r, {
    bpm: T.bpm,
    swing: 0.16,
    unit: 0.25,
    tail: 5,
    form: [
      ['intro', 4],
      ['a', 8],
      ['b', 8],
      ['c', 8],
      ['b', 8, 1, 2],
      ['b', 8, 1, 3],
      ['outro', 4],
    ],
  });
  const over = (t) => tones(T.key, T.prog[Math.floor(t / 4) % 4]);
  const hook = tune(r, T.hook, T.cad, { key: T.key, scale: T.scale, lo: T.key + 14, hi: T.key + 29, start: T.key + 19, ch: over });
  const counter = tune(r, 'x-------x-------|x-------x-------', 'x-------x-------|x---------------', { key: T.key, scale: T.scale, lo: T.key + 9, hi: T.key + 21, start: T.key + 14, ch: over, arch: 0.25 });
  const K = kick({ tone: 48, punch: 0.7, len: 0.4 }),
    SN = snare({ seed: 61, tone: 170, len: 0.22, noise: 0.6 }),
    CL = clap({ seed: 62 }),
    H = hat({ seed: 63 }),
    HO = hat({ seed: 64, open: true, len: 0.3 }),
    RM = rim({ seed: 65 });
  // drums first, for the sidechain
  for (const b of s.bars) {
    const { n, name } = b;
    if (name === 'a' || name === 'b' || (name === 'intro' && b.i >= 2)) {
      if (name !== 'intro') {
        s.drum(n, b.i % 2 ? 'x......x..x...o.' : 'x......x..x.....', K, { gain: 0.85, kick: true });
        s.drum(n, '....x.......x..o', SN, { gain: 0.42, rev: 0.12 });
        s.drum(n, '....x.......x...', CL, { gain: 0.16, rev: 0.15 });
      }
      s.drum(n, 'x.xox.x.x.xox.x.', H, { gain: 0.17, pan: 0.25 });
      if (b.i % 4 === 3) s.drum(n, '..............x.', HO, { gain: 0.1, pan: 0.25 });
    } else if (name === 'c') {
      s.drum(n, 'x.x.x.x.x.x.x.x.', H, { gain: 0.12, pan: 0.25 });
      s.drum(n, '....x.......x...', RM, { gain: 0.25, rev: 0.25 });
      if (b.last) s.drum(n, 'x.........x.x...', K, { gain: 0.7 });
    } else if (name === 'outro' && b.i < 2) s.drum(n, 'x.x.x.x.x.x.x.x.', H, { gain: 0.1, pan: 0.25 });
  }
  s.mix.sidechain(s.kicks, 0.3, 0.2);
  const keysV = (m, d, vel, bright) =>
    T.keys === 'epiano'
      ? s.note('ep', epiano, m, d, { vel, bright })
      : T.keys === 'guitar'
      ? s.note('jg', pluck, m, d, { bright: bright * 0.9, decay: 2.2, body: 0.5, seed: 1 })
      : s.note('pn', piano, m, d, { vel: vel * 0.85, bright: bright * 0.85 });
  const soloV =
    T.solo === 'flute'
      ? (m, d, x, g) => s.note('fl', lead, m, d, { shape: 0, vib: 0.014, cutoff: 1300, attack: 0.06, breath: 0.32, from: g ? mtof(g) : 0 })
      : T.solo === 'vibes'
      ? (m, d) => s.note('vb', mallet, m, d, { ratio: 1, index: 0.7, decay: 1, trem: 0.3, ring: 0.9 })
      : (m, d, x, g) => s.note('sx', lead, m - 12, d, { shape: 0.7, breath: 0.28, vib: 0.02, cutoff: 1500, attack: 0.05, from: g ? mtof(g - 12) : 0 });
  const bellV = (o2) => (m, d) => s.note('cb', mallet, m + o2, d, { ratio: 3.5, index: 1, decay: 1.2, vel: 0.5, ring: 1.2 });
  let pv = null;
  for (const b of s.bars) {
    const { n, name } = b;
    const ch = T.prog[b.i % 4],
      nb = s.bar(n + 1),
      nch = nb ? T.prog[nb.i % 4] : ch;
    const v = (pv = voicing(pv, T.key, ch, T.key + 2, T.key + 20, { size: 4, rootless: true }));
    // keys: rolled chords on the comping rhythm, dark and quiet in the intro and outro
    const dim = name === 'intro' || name === 'outro';
    const end = name === 'outro' && b.last;
    for (const x of rhy(end ? 'x---------------' : T.comp)) {
      const d = end ? s.beat * 6 : x.d * s.beat * 1.1;
      s.strum(n, x.t, v, (m) => keysV(m, d, x.t === 0 ? 0.62 : 0.48, dim ? 0.15 : 0.35), { pan: 0.1, gain: dim ? 0.15 : 0.19, rev: 0.25, duck: 0.25 }, { gap: T.keys === 'guitar' ? 0.018 : 0.011 });
    }
    // sub bass sliding into each root, a pushed fifth, an approach note into the next chord
    const rn = low(bassOf(T.key, ch), T.key - 14),
      nr = low(bassOf(T.key, nch), T.key - 14);
    if (name === 'a' || name === 'b' || (name === 'outro' && b.i === 0)) {
      const pat = [
        [0, 1.5, rn],
        [1.75, 0.5, rn],
        [2.5, 1, fifth(rn, T.key)],
        [3.5, 0.45, nr + (nr > rn ? -1 : 1)],
      ];
      let prev = 0;
      for (const [t, d, m] of pat) {
        s.put(s.note('sb', bass, m, d * s.beat, { kind: 'sub', from: prev && Math.abs(prev - m) < 8 ? mtof(prev) : 0 }), s.at(n, t, 0.004), { gain: 0.42, rev: 0.02 });
        prev = m;
      }
    } else if (name === 'c' && b.i % 2 === 0) s.put(s.note('sb', bass, rn, s.beat * 7, { kind: 'sub' }), s.at(n, 0), { gain: 0.35 });
    // the hook, a counter line in the last chorus and a dreamy echo of the hook in the drop
    if (b.first && name === 'b') {
      s.play(n, hook, soloV, { gain: T.solo === 'vibes' ? 0.3 : 0.22, rev: 0.35, dly: 0.25, pan: 0.15 });
      if (b.tag === 3) s.play(n, counter, bellV(0), { gain: 0.12, rev: 0.45, dly: 0.35, pan: -0.35 });
    }
    if (b.first && name === 'c') s.play(n, hook.filter((x) => x.t < 16), bellV(12), { gain: 0.13, rev: 0.6, dly: 0.45, pan: -0.2 });
  }
  const stop = T.stop ? [(s.bars.length - 0.6) * 4 * s.beat, 1.6] : null;
  return s.finish({ delay: s.beat * 0.75, feedback: 0.3, room: 0.7, damp: 0.55, lowpass: 4200, crackle: 1, wow: 1, seed: T.bpm, stop });
}

const STYLES = { synthwave, rock, country, ambient, blues, lofi };

// Renders track `t` of album `a`: { L, R, sr }.
export function renderTrack(a, t) {
  const al = ALBUMS[a];
  const r = rng(1000 + a * 97 + t * 31);
  return STYLES[al.style](r, t % 3);
}
