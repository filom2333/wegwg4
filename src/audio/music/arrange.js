// Songs for the CDs: six albums in different styles, three tracks each. A track is generated
// from its album style and seed: key, tempo, chord progression, a melody built from a motif and
// its variations, and a sectioned arrangement (intro, verse, chorus, bridge, outro) rendered
// with the instruments in engine.js.

import { Mix, SR, rng, mtof, pluck, epiano, pad, organ, bass, lead, steel, kick, snare, hat, brush, ride, clap } from './engine.js';

import { ALBUMS } from './albums.js';
export { ALBUMS };

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixo: [0, 2, 4, 5, 7, 9, 10],
  pentaMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

// MIDI note of scale degree d (any integer, wraps octaves) above root.
function deg(root, scale, d) {
  const n = scale.length;
  const o = Math.floor(d / n);
  return root + scale[((d % n) + n) % n] + 12 * o;
}

// Chord tones (MIDI) stacked in thirds on scale degree d.
function chord(root, scale, d, size = 3) {
  const out = [];
  for (let k = 0; k < size; k++) out.push(deg(root, scale, d + k * 2));
  return out;
}

// A melodic phrase over `bars` bars: rhythm cells per beat, stepwise motion that lands on chord
// tones on strong beats. Returns [{ t, d, deg }] in beats (deg relative to the scale).
function motif(r, bars, chordDegs, { density = 0.6, range = [2, 11], start = 4 } = {}) {
  const cells = [[1], [0.5, 0.5], [0.75, 0.25], [0.5, 0.25, 0.25], [1.5, 0.5], [0.25, 0.25, 0.5], [2]];
  const notes = [];
  let t = 0;
  let cur = start;
  const total = bars * 4;
  while (t < total - 0.01) {
    if (r() > density + 0.25 && t % 1 === 0) {
      t += r() < 0.5 ? 0.5 : 1; // rest
      continue;
    }
    const cell = cells[Math.floor(r() * (density > 0.6 ? cells.length - 1 : cells.length))];
    for (const d of cell) {
      if (t >= total - 0.01) break;
      const bar = Math.floor(t / 4);
      const cd = chordDegs[bar % chordDegs.length];
      const strong = t % 2 === 0;
      if (strong) {
        // nearest chord tone
        const tones = [cd, cd + 2, cd + 4, cd + 7, cd + 9, cd + 11];
        let best = tones[0];
        for (const x of tones) if (Math.abs(x - cur) < Math.abs(best - cur)) best = x;
        cur = best;
      } else {
        const step = r() < 0.7 ? (r() < 0.5 ? 1 : -1) : r() < 0.5 ? 2 : -2;
        cur += step;
      }
      cur = Math.max(range[0], Math.min(range[1], cur));
      notes.push({ t, d: Math.min(d, total - t), deg: cur });
      t += d;
    }
  }
  return notes;
}

// Variation: same rhythm, the last notes moved.
function vary(r, m, amount = 0.35) {
  return m.map((n, i) => (i > m.length * 0.6 && r() < amount ? { ...n, deg: n.deg + (r() < 0.5 ? 1 : -1) } : { ...n }));
}

function swingT(t, beat, sw) {
  // delays every off-8th by `sw` of an 8th
  const e = t / (beat / 2);
  const k = Math.floor(e + 1e-6);
  return k % 2 === 1 ? t + sw * (beat / 2) : t;
}

// ------------------------------------------------------------------ styles
function synthwave(r, title) {
  const root = [45, 50, 52, 47][Math.floor(r() * 4)]; // A2, D3, E3, B2
  const sc = SCALES.minor;
  const bpm = 98 + Math.floor(r() * 12);
  const beat = 60 / bpm;
  const progs = [
    [0, 5, 2, 6],
    [0, 6, 5, 6],
    [5, 6, 0, 0],
    [0, 3, 5, 4],
  ];
  const prog = progs[Math.floor(r() * progs.length)];
  const sections = [
    ['intro', 4],
    ['verse', 8],
    ['chorus', 8],
    ['break', 4],
    ['verse', 8],
    ['chorus', 8],
    ['outro', 4],
  ];
  const bars = sections.reduce((a, s) => a + s[1], 0);
  const mix = new Mix(bars * 4 * beat + 3);
  const m1 = motif(r, 2, prog.slice(0, 2), { density: 0.55, range: [5, 13], start: 7 });
  const m2 = vary(r, m1);
  const K = kick({ tone: 46, punch: 1.1 }),
    S = snare({ gate: 0.18, len: 0.45, seed: 21 }),
    H = hat({ seed: 3 }),
    HO = hat({ seed: 4, open: true });
  let bar = 0;
  for (const [sec, n] of sections) {
    for (let b = 0; b < n; b++, bar++) {
      const t0 = bar * 4 * beat;
      const cd = prog[bar % prog.length];
      const ch = chord(root + 12, sc, cd);
      const full = sec === 'verse' || sec === 'chorus';
      // pad
      for (const m of ch) mix.put(pad(mtof(m + 12), 4 * beat, { cutoff: sec === 'chorus' ? 2600 : 1500, seed: m, attack: 0.4, sweep: 0.4 }), t0, { pan: (m % 3) - 1, gain: 0.16, rev: 0.45 });
      // arpeggio 16ths
      if (sec !== 'outro' || b < 2) {
        const arp = [ch[0], ch[1], ch[2], ch[1] + 12, ch[2], ch[0] + 12, ch[1], ch[2]];
        for (let k = 0; k < 16; k++) {
          const m = arp[k % arp.length] + 12;
          mix.put(lead(mtof(m), beat * 0.2, { shape: 0.8, vib: 0, cutoff: 3200 }), t0 + k * beat * 0.25, { pan: k % 2 ? 0.35 : -0.35, gain: 0.12, rev: 0.25, dly: 0.35 });
        }
      }
      // bass: octave-pumping 8ths
      if (sec !== 'intro') {
        const bn = deg(root - 12, sc, cd);
        for (let k = 0; k < 8; k++) mix.put(bass(mtof(bn + (k % 2 ? 12 : 0)), beat * 0.45, { kind: 'synth', cutoff: 380 }), t0 + k * beat * 0.5, { gain: 0.5, rev: 0.02 });
      }
      // drums
      if (full || (sec === 'break' && b >= 2)) {
        for (let k = 0; k < 4; k++) mix.put(K, t0 + k * beat, { gain: 0.9, rev: 0.02 });
        for (const k of [1, 3]) mix.put(S, t0 + k * beat, { gain: 0.55, rev: 0.6 });
        for (let k = 0; k < 8; k++) mix.put(k % 2 ? H : k === 6 ? HO : H, t0 + k * beat * 0.5, { pan: 0.3, gain: k % 2 ? 0.28 : 0.16, rev: 0.05 });
      }
      // lead melody in the chorus
      if (sec === 'chorus') {
        const m = (Math.floor(b / 2) % 2 ? m2 : m1).filter((x) => Math.floor(x.t / 4) === b % 2);
        for (const x of m) {
          const midi = deg(root + 12, sc, x.deg);
          mix.put(lead(mtof(midi), x.d * beat * 0.95, { shape: 0.35, vib: 0.01, cutoff: 3600, attack: 0.03 }), t0 + (x.t % 4) * beat, { gain: 0.22, rev: 0.35, dly: 0.3 });
        }
      }
    }
  }
  return mix.finish({ delay: beat * 0.75, feedback: 0.42, room: 0.86, damp: 0.3, seed: bpm });
}

function rock(r) {
  const root = [40, 45, 43, 38][Math.floor(r() * 4)]; // E2, A2, G2, D2
  const sc = SCALES.minor;
  const pent = SCALES.pentaMinor;
  const bpm = 122 + Math.floor(r() * 16);
  const beat = 60 / bpm;
  const prog = [
    [0, 6, 5, 6],
    [0, 0, 5, 6],
    [0, 3, 6, 5],
  ][Math.floor(r() * 3)];
  const sections = [
    ['intro', 4],
    ['verse', 8],
    ['chorus', 8],
    ['verse', 8],
    ['chorus', 8],
    ['solo', 8],
    ['chorus', 8],
    ['outro', 2],
  ];
  const bars = sections.reduce((a, s) => a + s[1], 0);
  const mix = new Mix(bars * 4 * beat + 3);
  const K = kick({ tone: 52, punch: 0.9, len: 0.35 }),
    S = snare({ seed: 31, tone: 210, len: 0.28 }),
    H = hat({ seed: 6 }),
    CR = hat({ seed: 7, open: true, len: 1.4 });
  // a riff: 8 eighths on the root with a pentatonic turn at the end
  const riff = [0, 0, 'x', 0, 0, 'x', 1, 2].map((v) => (v === 'x' ? null : v));
  let bar = 0;
  for (const [sec, n] of sections) {
    for (let b = 0; b < n; b++, bar++) {
      const t0 = bar * 4 * beat;
      const cd = prog[bar % prog.length];
      const rn = deg(root, sc, cd);
      const power = [rn, rn + 7, rn + 12];
      // rhythm guitar: palm-muted 8ths in verses, ringing chords in choruses
      if (sec === 'verse' || sec === 'intro') {
        riff.forEach((v, k) => {
          if (v === null) return;
          const m = v === 0 ? rn : deg(root, pent, Math.floor(cd / 1.4) + v + 2);
          for (const [j, x] of [m, m + 7].entries()) mix.put(pluck(mtof(x), beat * 0.4, { mute: 1, drive: 1, bright: 0.7, seed: k * 3 + j + bar }), t0 + k * beat * 0.5, { pan: j ? 0.55 : -0.55, gain: 0.32, rev: 0.06 });
        });
      } else if (sec !== 'outro' || b === 0) {
        for (const k of [0, 1.5, 2, 3.5]) for (const [j, x] of power.entries()) mix.put(pluck(mtof(x), beat * (k % 1 ? 0.5 : 1.5), { drive: 1, bright: 0.8, decay: 1.8, seed: j + bar * 5 + k * 7 }), t0 + k * beat + j * 0.006, { pan: j % 2 ? 0.6 : -0.6, gain: 0.26, rev: 0.12 });
      }
      // bass
      if (sec !== 'intro') for (let k = 0; k < 8; k++) mix.put(bass(mtof(rn - 12), beat * 0.45, { kind: 'finger', seed: k }), t0 + k * beat * 0.5, { gain: 0.48, rev: 0.02 });
      // drums
      if (sec !== 'intro' || b >= 2) {
        if (b === 0 && sec !== 'intro') mix.put(CR, t0, { pan: -0.3, gain: 0.35, rev: 0.15 });
        for (const k of [0, 2, 2.5]) mix.put(K, t0 + k * beat, { gain: 0.85, rev: 0.03 });
        for (const k of [1, 3]) mix.put(S, t0 + k * beat, { gain: 0.6, rev: 0.25 });
        for (let k = 0; k < 8; k++) mix.put(H, t0 + k * beat * 0.5, { pan: 0.35, gain: 0.2, rev: 0.03 });
        if (b === n - 1) for (let k = 0; k < 4; k++) mix.put(S, t0 + (3 + k * 0.25) * beat, { gain: 0.3 + k * 0.08, rev: 0.2 }); // fill
      }
      // solo: pentatonic phrases with bends
      if (sec === 'solo') {
        const ph = motif(r, 1, [cd], { density: 0.8, range: [5, 12], start: 7 });
        for (const x of ph) {
          const midi = deg(root + 12, pent, x.deg);
          mix.put(pluck(mtof(midi), x.d * beat, { drive: 1.4, bright: 0.85, decay: 2.2, bend: x.d >= 1 && r() < 0.6 ? 2 : 0, seed: Math.floor(x.t * 7) + bar }), t0 + x.t * beat, { pan: 0.1, gain: 0.3, rev: 0.3, dly: 0.2 });
        }
      }
    }
  }
  return mix.finish({ delay: beat * 0.5, feedback: 0.25, room: 0.7, damp: 0.45, seed: bpm });
}

function country(r) {
  const root = [43, 50, 45, 40][Math.floor(r() * 4)]; // G2, D3, A2, E2
  const sc = SCALES.major;
  const bpm = 96 + Math.floor(r() * 14);
  const beat = 60 / bpm;
  const prog = [
    [0, 3, 4, 0],
    [0, 0, 3, 4],
    [0, 3, 0, 4],
    [0, 5, 3, 4],
  ][Math.floor(r() * 4)];
  const sections = [
    ['intro', 4],
    ['verse', 8],
    ['chorus', 8],
    ['verse', 8],
    ['chorus', 8],
    ['outro', 4],
  ];
  const bars = sections.reduce((a, s) => a + s[1], 0);
  const mix = new Mix(bars * 4 * beat + 4);
  const mel = motif(r, 2, prog.slice(0, 2), { density: 0.5, range: [4, 11], start: 7 });
  const mel2 = vary(r, mel, 0.5);
  let bar = 0;
  for (const [sec, n] of sections) {
    for (let b = 0; b < n; b++, bar++) {
      const t0 = bar * 4 * beat;
      const cd = prog[bar % prog.length];
      const ch = chord(root + 12, sc, cd);
      const rn = deg(root, sc, cd);
      // boom-chick guitar: bass note on 1 and 3 (root, fifth), strums on 2 and 4 and the offbeats
      mix.put(pluck(mtof(rn + 12), beat, { bright: 0.45, decay: 1.6, seed: bar }), t0, { pan: -0.25, gain: 0.32, rev: 0.12 });
      mix.put(pluck(mtof(rn + 19), beat, { bright: 0.45, decay: 1.6, seed: bar + 1 }), t0 + 2 * beat, { pan: -0.25, gain: 0.28, rev: 0.12 });
      for (const k of [1, 1.5, 3, 3.5]) {
        const down = k % 1 === 0;
        const notes = down ? [...ch, ch[0] + 12] : [ch[1] + 12, ch[0] + 12];
        notes.forEach((m, j) => mix.put(pluck(mtof(m), beat * 0.5, { bright: 0.6, decay: 1.1, seed: j * 11 + bar * 3 + k * 5 }), t0 + k * beat + j * 0.011, { pan: 0.2, gain: down ? 0.16 : 0.1, rev: 0.12 }));
      }
      // upright bass and brushes
      if (sec !== 'intro') {
        mix.put(bass(mtof(rn - 12), beat * 0.9, { kind: 'upright', seed: bar }), t0, { gain: 0.5, rev: 0.03 });
        mix.put(bass(mtof(rn - 5), beat * 0.9, { kind: 'upright', seed: bar + 2 }), t0 + 2 * beat, { gain: 0.42, rev: 0.03 });
        for (let k = 0; k < 4; k++) mix.put(brush({ seed: k + bar, sweep: true, len: beat * 0.9 }), t0 + k * beat, { pan: 0.15, gain: 0.22, rev: 0.08 });
        for (const k of [1, 3]) mix.put(brush({ seed: 40 + k + bar }), t0 + k * beat, { pan: 0.1, gain: 0.4, rev: 0.12 });
        for (const k of [0, 2]) mix.put(kick({ tone: 58, punch: 0.4, len: 0.3 }), t0 + k * beat, { gain: 0.45 });
      }
      // pedal steel melody, sliding into the notes
      if (sec === 'chorus' || (sec === 'verse' && b >= 4)) {
        const m = (Math.floor(b / 2) % 2 ? mel2 : mel).filter((x) => Math.floor(x.t / 4) === b % 2);
        for (const x of m) {
          const f = mtof(deg(root + 24, sc, x.deg));
          mix.put(steel(f, x.d * beat * 0.98, { from: x.d >= 1 ? f * 0.94 : 0 }), t0 + (x.t % 4) * beat, { pan: 0.35, gain: 0.3, rev: 0.4, dly: 0.12 });
        }
      }
    }
  }
  return mix.finish({ delay: beat, feedback: 0.25, room: 0.75, damp: 0.4, seed: bpm });
}

function ambient(r) {
  const root = [38, 41, 43, 36][Math.floor(r() * 4)];
  const sc = r() < 0.5 ? SCALES.major : SCALES.dorian;
  const len = 96;
  const mix = new Mix(len + 6);
  const prog = [0, 3, 5, 4, 0, 2, 3, 4];
  const chordLen = 12;
  for (let c = 0; c * chordLen < len; c++) {
    const t0 = c * chordLen;
    const cd = prog[c % prog.length];
    const ch = chord(root + 12, sc, cd, 4);
    ch.forEach((m, j) => mix.put(pad(mtof(m + (j > 1 ? 12 : 0)), chordLen + 2, { voices: 4, detune: 0.08, cutoff: 900 + j * 300, attack: 3.5, release: 4, seed: c * 7 + j, sweep: 0.6 }), t0, { pan: (j / 3) * 1.4 - 0.7, gain: 0.14, rev: 0.7 }));
    // a drone underneath
    mix.put(pad(mtof(root), chordLen + 2, { voices: 3, detune: 0.05, cutoff: 260, attack: 4, release: 4, seed: 900 + c }), t0, { gain: 0.25, rev: 0.4 });
    // sparse glassy notes
    const k = 2 + Math.floor(r() * 4);
    for (let i = 0; i < k; i++) {
      const tt = t0 + r() * chordLen;
      const m = deg(root + 36, sc, cd + Math.floor(r() * 6));
      mix.put(pluck(mtof(m), 0.2, { bright: 0.3, decay: 3.8, seed: i + c * 13 }), tt, { pan: r() * 1.6 - 0.8, gain: 0.12, rev: 0.75, dly: 0.45 });
      if (r() < 0.4) mix.put(epiano(mtof(m - 12), 1.5, { vel: 0.5, bright: 0.2 }), tt + 0.4, { pan: -0.3, gain: 0.12, rev: 0.7 });
    }
  }
  return mix.finish({ delay: 0.62, feedback: 0.55, room: 0.94, damp: 0.25, wet: 1.3, seed: root });
}

function blues(r) {
  const root = [40, 43, 45, 47][Math.floor(r() * 4)]; // E, G, A, B
  const bpm = 78 + Math.floor(r() * 18);
  const beat = 60 / bpm;
  const sw = 0.33; // shuffle
  const twelve = [0, 5, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7]; // semitones above the root
  const choruses = 3;
  const bars = 12 * choruses + 1;
  const mix = new Mix(bars * 4 * beat + 4);
  const K = kick({ tone: 55, punch: 0.6, len: 0.3 }),
    S = snare({ seed: 51, tone: 180, len: 0.25, noise: 0.8 }),
    RI = ride({ seed: 52 });
  const bl = SCALES.blues;
  let bar = 0;
  for (let c = 0; c < choruses; c++) {
    for (let b = 0; b < 12; b++, bar++) {
      const t0 = bar * 4 * beat;
      const off = twelve[b];
      const rn = root + off;
      const dom7 = [rn + 12, rn + 16, rn + 19, rn + 22];
      // organ comping on the swung offbeats
      for (const k of [0.5, 1.5, 2.5, 3.5]) {
        const t = swingT(t0 + k * beat, beat, sw);
        for (const [j, m] of dom7.entries()) mix.put(organ(mtof(m), beat * 0.35), t, { pan: (j - 1.5) * 0.25, gain: 0.08, rev: 0.25 });
      }
      // walking bass: root, 3rd, 5th, 6th
      [0, 4, 7, 9].forEach((iv, k) => mix.put(bass(mtof(rn - 12 + iv), beat * 0.9, { kind: 'finger', seed: k + bar }), t0 + k * beat, { gain: 0.5, rev: 0.03 }));
      // drums: shuffle on the ride
      for (const k of [0, 2]) mix.put(K, t0 + k * beat, { gain: 0.7 });
      for (const k of [1, 3]) mix.put(S, t0 + k * beat, { gain: 0.5, rev: 0.25 });
      for (let k = 0; k < 4; k++) {
        mix.put(RI, t0 + k * beat, { pan: 0.4, gain: 0.25, rev: 0.1 });
        mix.put(RI, swingT(t0 + (k + 0.5) * beat, beat, sw), { pan: 0.4, gain: 0.14, rev: 0.1 });
      }
      // guitar licks: call in the first bars of each line, turnaround at the end
      if (c > 0 && (b % 4 === 0 || b === 11)) {
        const ph = motif(r, 1, [0], { density: 0.75, range: [3, 10], start: 5 });
        for (const x of ph) {
          const m = deg(root + 12, bl, x.deg);
          mix.put(pluck(mtof(m), x.d * beat, { drive: 0.5, bright: 0.65, decay: 2, bend: x.d >= 1 && r() < 0.5 ? 1 : 0, seed: Math.floor(x.t * 13) + bar }), swingT(t0 + x.t * beat, beat, sw), { pan: -0.2, gain: 0.32, rev: 0.32 });
        }
      }
    }
  }
  // final chord
  const t0 = bar * 4 * beat;
  for (const m of [root + 12, root + 16, root + 19, root + 22]) mix.put(organ(mtof(m), beat * 3), t0, { gain: 0.1, rev: 0.4 });
  mix.put(K, t0, { gain: 0.7 });
  mix.put(RI, t0, { gain: 0.3, rev: 0.3 });
  return mix.finish({ delay: beat * 0.66, feedback: 0.2, room: 0.72, damp: 0.5, seed: bpm });
}

function lofi(r) {
  const root = [48, 50, 53, 45][Math.floor(r() * 4)];
  const sc = SCALES.major;
  const bpm = 74 + Math.floor(r() * 12);
  const beat = 60 / bpm;
  const sw = 0.28;
  const prog = [
    [1, 4, 0, 5],
    [3, 2, 1, 4],
    [0, 5, 1, 4],
  ][Math.floor(r() * 3)];
  const bars = 32;
  const mix = new Mix(bars * 4 * beat + 3);
  const K = kick({ tone: 48, punch: 0.7, len: 0.4 }),
    S = snare({ seed: 61, tone: 170, len: 0.22, noise: 0.6 }),
    CL = clap({ seed: 62 }),
    H = hat({ seed: 63 });
  const mel = motif(r, 2, prog.slice(0, 2), { density: 0.45, range: [5, 12], start: 9 });
  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4 * beat;
    const cd = prog[bar % prog.length];
    const ch = chord(root + 12, sc, cd, 4); // 7th chords
    // electric piano: chord on 1, a pushed re-hit before 3
    for (const [k, v] of [
      [0, 0.75],
      [1.75, 0.5],
    ])
      ch.forEach((m, j) => mix.put(epiano(mtof(m), beat * (k ? 2 : 1.6), { vel: v, bright: 0.35 }), t0 + k * beat + j * 0.008, { pan: (j - 1.5) * 0.2, gain: 0.2, rev: 0.25 }));
    // bass
    const rn = deg(root - 12, sc, cd);
    for (const [k, iv] of [
      [0, 0],
      [1.5, 0],
      [2.75, 7],
    ])
      mix.put(bass(mtof(rn + iv), beat * 0.7, { kind: 'finger', seed: k * 3 + bar }), t0 + k * beat, { gain: 0.5, rev: 0.02 });
    // boom-bap
    if (bar >= 2 && bar < bars - 1) {
      for (const k of [0, 1.75, 2.5]) mix.put(K, swingT(t0 + k * beat, beat, sw), { gain: 0.85 });
      for (const k of [1, 3]) {
        mix.put(S, t0 + k * beat, { gain: 0.42, rev: 0.12 });
        mix.put(CL, t0 + k * beat + 0.01, { gain: 0.2, rev: 0.15 });
      }
      for (let k = 0; k < 8; k++) mix.put(H, swingT(t0 + k * beat * 0.5, beat, sw), { pan: 0.25, gain: k % 2 ? 0.1 : 0.18 });
    }
    // a hazy melody every other section
    if (Math.floor(bar / 8) % 2 === 1) {
      const m = mel.filter((x) => Math.floor(x.t / 4) === bar % 2);
      for (const x of m) mix.put(epiano(mtof(deg(root + 24, sc, x.deg)), x.d * beat, { vel: 0.6, bright: 0.6 }), swingT(t0 + (x.t % 4) * beat, beat, sw), { pan: 0.3, gain: 0.18, rev: 0.35, dly: 0.25 });
    }
  }
  return mix.finish({ delay: beat * 0.75, feedback: 0.3, room: 0.7, damp: 0.55, lowpass: 4200, crackle: 1, wow: 1, seed: bpm });
}

const STYLES = { synthwave, rock, country, ambient, blues, lofi };

// Renders track `t` of album `a`: { L, R, sr }.
export function renderTrack(a, t) {
  const al = ALBUMS[a];
  const r = rng(1000 + a * 97 + t * 31);
  return STYLES[al.style](r, al.tracks[t]);
}

export { SR };
