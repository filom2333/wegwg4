// Offline music renderer for the car's CD player: small sample-level instruments (plucked
// strings, electric piano, pads, organ, bass, leads, drums), a stereo mixer with sends to a
// reverb and a ping-pong delay, and a gentle master bus. Everything is computed into plain
// Float32Arrays so it can run in a worker; songs come from arrange.js.

export const SR = 32000;

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ------------------------------------------------------------------ mixer
export class Mix {
  constructor(seconds) {
    this.n = Math.ceil(seconds * SR);
    this.L = new Float32Array(this.n);
    this.R = new Float32Array(this.n);
    this.revL = new Float32Array(this.n);
    this.revR = new Float32Array(this.n);
    this.dlyL = new Float32Array(this.n);
    this.dlyR = new Float32Array(this.n);
  }

  // Kick-triggered ducking for put(..., { duck }): the gain dips by `depth` at each time and
  // recovers over `rel` seconds, the pumping of dance music.
  sidechain(times, depth = 0.6, rel = 0.16) {
    const e = new Float32Array(this.n).fill(1);
    const a = Math.floor(0.004 * SR),
      len = Math.floor(rel * SR * 5);
    for (const t of times) {
      const i0 = Math.floor(t * SR);
      for (let k = -a; k < len; k++) {
        const i = i0 + k;
        if (i < 0 || i >= this.n) continue;
        const g = k < 0 ? 1 - depth * (1 + k / a) : 1 - depth * Math.exp(-k / (rel * SR));
        if (g < e[i]) e[i] = g;
      }
    }
    this.duckEnv = e;
  }

  // Adds a mono voice at time t (seconds) with pan (-1..1), gain and send levels; `duck` (0..1)
  // is how much the sidechain pumps it.
  put(v, t, { pan = 0, gain = 1, rev = 0.15, dly = 0, duck = 0 } = {}) {
    const i0 = Math.floor(t * SR);
    const a = Math.cos(((pan + 1) * Math.PI) / 4) * gain,
      b = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
    const n = Math.min(v.length, this.n - i0);
    const { L, R, revL, revR, dlyL, dlyR } = this;
    const de = duck && this.duckEnv;
    for (let k = Math.max(0, -i0); k < n; k++) {
      const i = i0 + k,
        x = de ? v[k] * (1 - duck * (1 - de[i])) : v[k];
      const l = x * a,
        r = x * b;
      L[i] += l;
      R[i] += r;
      if (rev) {
        revL[i] += l * rev;
        revR[i] += r * rev;
      }
      if (dly) {
        dlyL[i] += l * dly;
        dlyR[i] += r * dly;
      }
    }
  }

  // Ping-pong delay and a Freeverb-style reverb on the sends, then the master bus.
  finish({ delay = 0.375, feedback = 0.38, room = 0.82, damp = 0.35, wet = 1, lowpass = 0, crackle = 0, seed = 1, wow = 0, stop = null, level = 0.24 } = {}) {
    const { L, R, n } = this;
    // delay
    const D = Math.max(1, Math.floor(delay * SR));
    const bl = new Float32Array(D),
      br = new Float32Array(D);
    let lpL = 0,
      lpR = 0;
    for (let i = 0, j = 0; i < n; i++, j = j + 1 === D ? 0 : j + 1) {
      const oL = bl[j],
        oR = br[j];
      lpL += (oL - lpL) * 0.45;
      lpR += (oR - lpR) * 0.45;
      bl[j] = this.dlyL[i] + lpR * feedback;
      br[j] = this.dlyR[i] + lpL * feedback;
      L[i] += oL * 0.8;
      R[i] += oR * 0.8;
      this.revL[i] += oL * 0.25;
      this.revR[i] += oR * 0.25;
    }
    // reverb (8 combs + 4 allpasses per side, right side detuned for width)
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const aps = [556, 441, 341, 225];
    const verb = (inp, spread) => {
      const out = new Float32Array(n);
      for (const c of combs) {
        const b = new Float32Array(c + spread);
        const bl = b.length;
        let k = 0,
          f = 0;
        for (let i = 0; i < n; i++) {
          const y = b[k];
          f = y * (1 - damp) + f * damp;
          b[k] = inp[i] * 0.015 + f * room;
          if (++k === bl) k = 0;
          out[i] += y;
        }
      }
      for (const a of aps) {
        const b = new Float32Array(a + spread);
        const bl = b.length;
        let k = 0;
        for (let i = 0; i < n; i++) {
          const bo = b[k];
          const y = -out[i] + bo;
          b[k] = out[i] + bo * 0.5;
          if (++k === bl) k = 0;
          out[i] = y;
        }
      }
      return out;
    };
    const vl = verb(this.revL, 0),
      vr = verb(this.revR, 23);
    for (let i = 0; i < n; i++) {
      L[i] += vl[i] * wet;
      R[i] += vr[i] * wet;
    }
    // lo-fi: tape wow, a dark lowpass and vinyl crackle
    if (wow) {
      const tl = L.slice(),
        tr = R.slice();
      for (let i = 0; i < n; i++) {
        const d = (Math.sin((i / SR) * 2 * Math.PI * 0.55) * 0.5 + Math.sin((i / SR) * 2 * Math.PI * 0.13) * 0.5) * wow * SR * 0.0012;
        const p = i - 30 - d;
        const p0 = Math.floor(p),
          fr = p - p0;
        if (p0 < 0 || p0 + 1 >= n) continue;
        L[i] = tl[p0] * (1 - fr) + tl[p0 + 1] * fr;
        R[i] = tr[p0] * (1 - fr) + tr[p0 + 1] * fr;
      }
    }
    if (lowpass) {
      const k = 1 - Math.exp((-2 * Math.PI * lowpass) / SR);
      let a = 0,
        b = 0,
        c = 0,
        d = 0;
      for (let i = 0; i < n; i++) {
        a += (L[i] - a) * k;
        b += (a - b) * k;
        c += (R[i] - c) * k;
        d += (c - d) * k;
        L[i] = b;
        R[i] = d;
      }
    }
    if (crackle) {
      const r = rng(seed * 77 + 5);
      let h = 0;
      for (let i = 0; i < n; i++) {
        h = h * 0.995 + (r() - 0.5) * 0.004;
        let x = h * crackle * 0.6;
        if (r() < 0.00012 * crackle * 4) x += (r() - 0.5) * 0.35 * crackle;
        L[i] += x;
        R[i] += x * 0.9;
      }
    }
    // tape stop: from `stop[0]` s the reels slow to a halt over `stop[1]` s
    if (stop) {
      const i0 = Math.floor(stop[0] * SR),
        m = Math.floor(stop[1] * SR);
      const tl = L.slice(i0),
        tr = R.slice(i0);
      let p = 0;
      for (let k = 0; i0 + k < n; k++) {
        const rate = 1 - k / m,
          p0 = Math.floor(p),
          fr = p - p0;
        if (rate <= 0 || p0 + 1 >= tl.length) {
          L[i0 + k] = R[i0 + k] = 0;
          continue;
        }
        const g = Math.min(1, rate * 4);
        L[i0 + k] = (tl[p0] * (1 - fr) + tl[p0 + 1] * fr) * g;
        R[i0 + k] = (tr[p0] * (1 - fr) + tr[p0 + 1] * fr) * g;
        p += rate;
      }
    }
    // master: DC block, then the loud parts of every song brought to the same level (`level` RMS)
    // into a soft clipper, short fades at the ends
    let pk = 1e-6;
    let zl = 0,
      zr = 0,
      pl = 0,
      pr = 0;
    for (let i = 0; i < n; i++) {
      const xl = L[i],
        xr = R[i];
      zl = xl - pl + 0.9995 * zl;
      zr = xr - pr + 0.9995 * zr;
      pl = xl;
      pr = xr;
      L[i] = zl;
      R[i] = zr;
      pk = Math.max(pk, Math.abs(zl), Math.abs(zr));
    }
    const W = SR >> 1,
      wins = [];
    for (let i = 0; i + W <= n; i += W) {
      let q = 0;
      for (let j = i; j < i + W; j++) q += L[j] * L[j] + R[j] * R[j];
      wins.push(Math.sqrt(q / (2 * W)));
    }
    wins.sort((a, b) => a - b);
    const loud = wins[Math.floor(wins.length * 0.85)] || 0.1;
    const g = Math.min(level / Math.max(loud, 1e-4), 2.4 / pk);
    const fade = Math.floor(SR * 0.6);
    for (let i = 0; i < n; i++) {
      let e = 1;
      if (i < 400) e = i / 400;
      if (i > n - fade) e = (n - i) / fade;
      L[i] = Math.tanh(L[i] * g) * 0.84 * e;
      R[i] = Math.tanh(R[i] * g) * 0.84 * e;
    }
    return { L, R, sr: SR };
  }
}

// ------------------------------------------------------------------ instruments
// All return a mono Float32Array starting at the note-on.

function env(n, a, d, s, r, holdN) {
  // ADSR in samples: attack a, decay d to level s, held until holdN, release r
  const e = new Float32Array(n);
  let lvl = 0;
  for (let i = 0; i < n; i++) {
    if (i < a) lvl = i / a;
    else if (i < a + d) lvl = 1 - (1 - s) * ((i - a) / d);
    else if (i < holdN) lvl = s;
    else lvl = s * Math.max(0, 1 - (i - holdN) / r);
    e[i] = lvl;
  }
  return e;
}

// Karplus-Strong string: bright = pick brightness (0..1), decay = seconds to fade, bend = semitones
// up over the first part of the note, mute = palm mute, vib = finger vibrato depth (fraction).
export function pluck(f, dur, { bright = 0.6, decay = 2.5, seed = 1, bend = 0, mute = 0, drive = 0, body = 0.3, vib = 0 } = {}) {
  const r = rng(seed);
  const tail = mute ? 0.12 : Math.min(decay, 4);
  const n = Math.floor((dur + tail) * SR);
  const out = new Float32Array(n);
  const P0 = SR / f;
  const len = Math.ceil(P0 * (bend ? 1.05 : 1)) + 8;
  const buf = new Float32Array(len);
  // excitation: filtered noise burst
  let lp = 0;
  const k0 = 0.15 + bright * 0.8;
  for (let i = 0; i < len; i++) {
    lp += (r() * 2 - 1 - lp) * k0;
    buf[i] = lp;
  }
  const fb = Math.pow(0.001, 1 / ((SR * (mute ? 0.18 : decay)) / P0)) * 0.5;
  const fbOff = fb * 0.985; // released: damped by the fingers
  const offN = Math.floor(dur * SR);
  const bendN = Math.floor(SR * 0.12);
  let w = 0;
  let prev = 0;
  let bodyLp = 0;
  let P = P0;
  const dk = 1 + drive * 8;
  for (let i = 0; i < n; i++) {
    // a bend shortens the loop over the first 120 ms
    if (bend && i <= bendN) P = P0 / Math.pow(2, (bend * (i / bendN)) / 12);
    let rp = w - (vib && i > 4000 ? P * (1 + vib * Math.sin(i * 0.00108) * Math.min(1, (i - 4000) / 6000)) : P);
    if (rp < 0) rp += len;
    const i0 = rp | 0,
      fr = rp - i0;
    const i1 = i0 + 1 === len ? 0 : i0 + 1;
    const y = buf[i0] * (1 - fr) + buf[i1] * fr;
    buf[w] = (y + prev) * (i > offN ? fbOff : fb);
    prev = y;
    w++;
    if (w === len) w = 0;
    let s = y;
    if (drive) s = Math.tanh(s * dk) * 0.7;
    bodyLp += (s - bodyLp) * 0.08;
    out[i] = s + bodyLp * body;
  }
  return out;
}

// Two-operator FM electric piano (tine bell over a warm body).
export function epiano(f, dur, { vel = 0.8, bright = 0.5 } = {}) {
  const rel = 0.5;
  const n = Math.floor((dur + rel) * SR);
  const out = new Float32Array(n);
  const offN = Math.floor(dur * SR);
  let ph = 0,
    pm = 0,
    pb = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const amp = Math.exp(-t * 1.6) * (i > offN ? Math.max(0, 1 - (i - offN) / (rel * SR)) : 1);
    const idx = (0.6 + bright * 2.2) * vel * Math.exp(-t * 7);
    pm += (2 * Math.PI * f * 14) / SR;
    pb += (2 * Math.PI * f) / SR;
    ph += (2 * Math.PI * f) / SR;
    const bell = Math.sin(pm) * 0.05 * Math.exp(-t * 18);
    out[i] = (Math.sin(ph + idx * Math.sin(pb)) + bell) * amp * vel * 0.5;
  }
  return out;
}

// Detuned saw pad through a gliding lowpass.
export function pad(f, dur, { voices = 5, detune = 0.12, cutoff = 1800, attack = 0.6, release = 1.2, seed = 3, sweep = 0, vib = 0 } = {}) {
  const r = rng(seed);
  const n = Math.floor((dur + release) * SR);
  const out = new Float32Array(n);
  const phs = [],
    frs = [];
  for (let v = 0; v < voices; v++) {
    phs.push(r());
    frs.push(f * Math.pow(2, ((v - (voices - 1) / 2) * detune) / 12));
  }
  const e = env(n, Math.floor(attack * SR), 1, 1, Math.floor(release * SR), Math.floor(dur * SR));
  let a = 0,
    b = 0,
    k = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    const vb = vib ? 1 + vib * Math.sin(i * 0.00098) : 1;
    for (let v = 0; v < voices; v++) {
      phs[v] += (frs[v] * vb) / SR;
      phs[v] -= Math.floor(phs[v]);
      s += phs[v] * 2 - 1;
    }
    s /= voices;
    if ((i & 31) === 0) k = 1 - Math.exp((-2 * Math.PI * cutoff * (1 + sweep * Math.sin((i / n) * Math.PI))) / SR);
    a += (s - a) * k;
    b += (a - b) * k;
    out[i] = b * e[i];
  }
  return out;
}

// Drawbar organ with a little vibrato (blues, gospel).
export function organ(f, dur, { bars = [1, 0.8, 0.5, 0.35, 0.2], vib = 0.004 } = {}) {
  const rel = 0.08;
  const n = Math.floor((dur + rel) * SR);
  const out = new Float32Array(n);
  const ratios = [0.5, 1, 2, 3, 4];
  const ph = new Float64Array(5);
  const e = env(n, 120, 1, 1, Math.floor(rel * SR), Math.floor(dur * SR));
  for (let i = 0; i < n; i++) {
    const v = 1 + Math.sin((i / SR) * 2 * Math.PI * 6.2) * vib;
    let s = 0;
    for (let k = 0; k < 5; k++) {
      ph[k] += (2 * Math.PI * f * ratios[k] * v) / SR;
      s += Math.sin(ph[k]) * bars[k];
    }
    // key click
    if (i < 80) s += (Math.sin(i * 1.7) * (80 - i)) / 160;
    out[i] = s * 0.25 * e[i];
  }
  return out;
}

// Bass: 'synth' (saw + sub through an envelope filter), 'finger' (round plucked), 'upright'.
export function bass(f, dur, { kind = 'finger', cutoff = 700, seed = 5, from = 0 } = {}) {
  if (kind === 'sub') {
    // round sine sub with a touch of second harmonic, gliding in from `from` (lo-fi, 808)
    const rel = 0.08;
    const n = Math.floor((dur + rel) * SR);
    const out = new Float32Array(n);
    const offN = Math.floor(dur * SR);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const g = from ? from + (f - from) * Math.min(1, t / 0.06) : f;
      ph += (2 * Math.PI * g) / SR;
      const e = Math.min(1, i / 90) * (i > offN ? Math.max(0, 1 - (i - offN) / (rel * SR)) : 1) * (0.7 + 0.3 * Math.exp(-t * 5));
      out[i] = Math.tanh(Math.sin(ph) * 1.5 + Math.sin(2 * ph) * 0.2) * 0.8 * e;
    }
    return out;
  }
  if (kind === 'finger' || kind === 'upright') {
    const v = pluck(f, dur, { bright: kind === 'upright' ? 0.25 : 0.4, decay: kind === 'upright' ? 1.2 : 2.2, seed, body: 0.8 });
    // fundamental reinforcement
    let ph = 0;
    for (let i = 0; i < v.length; i++) {
      ph += (2 * Math.PI * f) / SR;
      v[i] = v[i] * 0.8 + Math.sin(ph) * 0.45 * Math.exp((-i / SR) * (kind === 'upright' ? 2.5 : 1.2)) * (i < 200 ? i / 200 : 1);
    }
    return v;
  }
  const rel = 0.06;
  const n = Math.floor((dur + rel) * SR);
  const out = new Float32Array(n);
  let p = 0,
    s1 = 0,
    a = 0,
    b = 0,
    k = 0;
  const offN = Math.floor(dur * SR);
  for (let i = 0; i < n; i++) {
    p += f / SR;
    p -= Math.floor(p);
    s1 += (2 * Math.PI * f) / SR;
    const saw = p * 2 - 1;
    if ((i & 31) === 0) k = 1 - Math.exp((-2 * Math.PI * cutoff * (1 + 3 * Math.exp((-i / SR) * 12))) / SR);
    a += (saw - a) * k;
    b += (a - b) * k;
    const e = (i < 60 ? i / 60 : 1) * (i > offN ? Math.max(0, 1 - (i - offN) / (rel * SR)) : 1);
    out[i] = (b * 0.7 + Math.sin(s1) * 0.55) * e;
  }
  return out;
}

// Mono lead: square/saw blend with vibrato, glide from `from` (Hz) over `glide` s and a soft
// filter; `breath` blows filtered noise in (harmonica, flute, sax).
export function lead(f, dur, { shape = 0.5, vib = 0.012, from = 0, cutoff = 2600, attack = 0.02, breath = 0, glide = 0.07, seed = 3 } = {}) {
  const r = rng(seed);
  let nz = 0;
  const rel = 0.15;
  const kc = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
  const n = Math.floor((dur + rel) * SR);
  const out = new Float32Array(n);
  let p = 0,
    a = 0,
    b = 0;
  const offN = Math.floor(dur * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const g = from ? from + (f - from) * Math.min(1, t / glide) : f;
    const v = 1 + Math.sin(t * 2 * Math.PI * 5.5) * vib * Math.min(1, t / 0.3);
    p += (g * v) / SR;
    p -= Math.floor(p);
    const sq = p < 0.5 ? 1 : -1;
    const saw = p * 2 - 1;
    let s = sq * (1 - shape) + saw * shape;
    if (breath) {
      nz += (r() * 2 - 1 - nz) * 0.35;
      s = s * (1 - breath * 0.5) + nz * breath * 2.2;
    }
    a += (s - a) * kc;
    b += (a - b) * kc;
    const e = Math.min(1, t / attack) * (i > offN ? Math.max(0, 1 - (i - offN) / (rel * SR)) : 1);
    out[i] = b * e * 0.5;
  }
  return out;
}

// Pedal steel / slide: sine stack with slow glide and wide vibrato.
export function steel(f, dur, { from = 0 } = {}) {
  const rel = 0.4;
  const n = Math.floor((dur + rel) * SR);
  const out = new Float32Array(n);
  let p1 = 0,
    p2 = 0,
    p3 = 0;
  const offN = Math.floor(dur * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const g = from ? from + (f - from) * Math.min(1, t / 0.18) : f;
    const v = 1 + Math.sin(t * 2 * Math.PI * 5) * 0.006 * Math.min(1, t / 0.4);
    p1 += (2 * Math.PI * g * v) / SR;
    p2 += (2 * Math.PI * g * v * 2) / SR;
    p3 += (2 * Math.PI * g * v * 3) / SR;
    const e = Math.min(1, t / 0.06) * Math.exp(-t * 0.6) * (i > offN ? Math.max(0, 1 - (i - offN) / (rel * SR)) : 1);
    out[i] = (Math.sin(p1) + Math.sin(p2) * 0.35 + Math.sin(p3) * 0.12) * e * 0.4;
  }
  return out;
}

// ------------------------------------------------------------------ drums
export function kick({ tone = 50, punch = 1, len = 0.45 } = {}) {
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = tone + 110 * punch * Math.exp(-t * 32);
    ph += (2 * Math.PI * f) / SR;
    out[i] = Math.sin(ph) * Math.exp(-t * 7) + (i < 90 ? (1 - i / 90) * 0.3 : 0);
  }
  return out;
}

export function snare({ seed = 9, tone = 190, noise = 1, len = 0.32, gate = 0 } = {}) {
  const r = rng(seed);
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  let ph = 0,
    hp = 0,
    prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * tone) / SR;
    const x = r() * 2 - 1;
    hp = 0.85 * (hp + x - prev);
    prev = x;
    let e = Math.exp(-t * 16);
    if (gate) e = t < gate ? Math.exp(-t * 3) : Math.exp(-gate * 3) * Math.exp(-(t - gate) * 60);
    out[i] = (Math.sin(ph) * 0.5 * Math.exp(-t * 30) + hp * 0.7 * noise) * e;
  }
  return out;
}

export function hat({ seed = 11, open = false, len = 0 } = {}) {
  const r = rng(seed);
  const L = len || (open ? 0.35 : 0.06);
  const n = Math.floor(L * SR);
  const out = new Float32Array(n);
  let hp = 0,
    prev = 0,
    hp2 = 0,
    prev2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const x = r() * 2 - 1;
    hp = 0.6 * (hp + x - prev);
    prev = x;
    hp2 = 0.6 * (hp2 + hp - prev2);
    prev2 = hp;
    out[i] = hp2 * Math.exp(-t * (open ? 9 : 55)) * 0.6;
  }
  return out;
}

// Brushed snare sweep / hit for the country shuffle.
export function brush({ seed = 13, len = 0.25, sweep = false } = {}) {
  const r = rng(seed);
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    lp += (r() * 2 - 1 - lp) * 0.35;
    const e = sweep ? Math.sin((Math.PI * t) / len) * 0.4 : Math.exp(-t * 22);
    out[i] = lp * e * 0.8;
  }
  return out;
}

export function ride({ seed = 15, len = 0.9 } = {}) {
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  const r = rng(seed);
  const fr = [3420, 4870, 5990, 7310, 8460];
  const ph = fr.map(() => r() * 6.28);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < fr.length; k++) s += Math.sin(ph[k] + (2 * Math.PI * fr[k] * i) / SR);
    out[i] = (s / fr.length) * Math.exp(-t * 4) * 0.35 + (r() - 0.5) * 0.1 * Math.exp(-t * 30);
  }
  return out;
}

export function clap({ seed = 17 } = {}) {
  const r = rng(seed);
  const n = Math.floor(0.3 * SR);
  const out = new Float32Array(n);
  let hp = 0,
    prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const x = r() * 2 - 1;
    hp = 0.8 * (hp + x - prev);
    prev = x;
    const bursts = [0, 0.011, 0.022].reduce((a, b) => a + (t >= b ? Math.exp(-(t - b) * 180) : 0), 0);
    out[i] = hp * (bursts * 0.6 + Math.exp(-t * 14) * 0.5) * 0.6;
  }
  return out;
}

// ------------------------------------------------------------------ more instruments
// Struck piano: pairs of slightly detuned inharmonic partials, brighter and shorter up high, a
// felt hammer thump at the start and dampers falling when the key is let go.
export function piano(f, dur, { vel = 0.7, bright = 0.5, seed = 7 } = {}) {
  const r = rng(seed);
  const life = Math.min(dur + 0.3, 1.5 + 5 * Math.pow(110 / f, 0.5));
  const n = Math.floor(life * SR);
  const out = new Float32Array(n);
  const offN = Math.floor(dur * SR);
  const P = f > 900 ? 4 : f > 400 ? 6 : 9;
  const bf = 0.35 + 0.4 * bright * (0.5 + vel * 0.5);
  const damp = Math.exp(-26 / SR);
  for (let k = 1; k <= P; k++) {
    const fk = k * f * Math.sqrt(1 + 0.00035 * k * k);
    if (fk > SR * 0.45) break;
    const amp = (Math.pow(bf, k - 1) / Math.sqrt(k)) * 0.5;
    const dm = Math.exp(-((0.6 + 0.45 * k) * Math.pow(f / 220, 0.45)) / SR);
    for (const det of [1, 1.0007]) {
      const w = (2 * Math.PI * fk * det) / SR;
      const c = Math.cos(w),
        s = Math.sin(w);
      const p0 = r() * 6.283;
      let x = Math.cos(p0),
        y = Math.sin(p0),
        e = amp;
      for (let i = 0; i < n; i++) {
        const nx = x * c - y * s;
        y = x * s + y * c;
        x = nx;
        out[i] += y * e;
        e *= i < offN ? dm : dm * damp;
      }
    }
  }
  let lp = 0;
  for (let i = 0; i < n; i++) {
    let v = out[i] * Math.min(1, i / 30);
    if (i < 500) {
      lp += (r() * 2 - 1 - lp) * 0.25;
      v += lp * 0.3 * vel * Math.exp(-i / 110);
    }
    out[i] = v * vel * 0.42;
  }
  return out;
}

// FM mallet: `ratio` sets the colour (3.5 glassy bell, 1 vibraphone, 4 woody marimba with a fast
// decay); `trem` is a vibraphone's motor tremolo.
export function bell(f, { len = 2.5, ratio = 3.5, index = 2, decay = 1.6, vel = 0.8, trem = 0 } = {}) {
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  let ph = 0,
    pm = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    pm += (2 * Math.PI * f * ratio) / SR;
    ph += (2 * Math.PI * f) / SR;
    const ie = index * vel * Math.exp(-t * decay * 2.5);
    let amp = Math.exp(-t * decay) * Math.min(1, i / 40);
    if (trem) amp *= 1 - trem * 0.5 * (1 - Math.cos(t * 2 * Math.PI * 5.2));
    if (i > n - 400) amp *= (n - i) / 400;
    out[i] = Math.sin(ph + ie * Math.sin(pm)) * amp * vel * 0.4;
  }
  return out;
}

export function tom(f = 110, { len = 0.6, seed = 19 } = {}) {
  const r = rng(seed);
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  let ph = 0,
    lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * f * (1 + 0.55 * Math.exp(-t * 18))) / SR;
    lp += (r() * 2 - 1 - lp) * 0.5;
    out[i] = (Math.sin(ph) * Math.exp(-t * 5.5) + lp * 0.35 * Math.exp(-t * 50)) * 0.8;
  }
  return out;
}

// Crash / splash: square partials at inharmonic ratios (the clang) and noise, highpassed, with a
// long shimmering tail.
export function crash({ seed = 23, len = 2.4 } = {}) {
  const r = rng(seed);
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  const fr = [296, 435, 593, 811, 1063, 1427, 1789, 2383].map((x) => x * (1 + r() * 0.03));
  const ph = fr.map(() => r());
  let h1 = 0,
    p1 = 0,
    h2 = 0,
    p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < fr.length; k++) {
      ph[k] += fr[k] / SR;
      ph[k] -= Math.floor(ph[k]);
      s += ph[k] < 0.5 ? 1 : -1;
    }
    const x = s * 0.06 + (r() * 2 - 1) * 0.6;
    h1 = 0.55 * (h1 + x - p1);
    p1 = x;
    h2 = 0.7 * (h2 + h1 - p2);
    p2 = h1;
    const e = (0.8 * Math.exp((-t * 3.2) / len) + 0.35 * Math.exp(-t * 22)) * Math.min(1, i / 25) * (i > n - 800 ? (n - i) / 800 : 1);
    out[i] = h2 * e * 0.5;
  }
  return out;
}

export function shaker({ seed = 29, len = 0.1 } = {}) {
  const r = rng(seed);
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  let h = 0,
    p = 0,
    lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const x = r() * 2 - 1;
    h = 0.5 * (h + x - p);
    p = x;
    lp += (h - lp) * 0.7;
    out[i] = lp * Math.min(1, t / 0.012) * Math.exp(-t * 38) * 0.5;
  }
  return out;
}

// Cross-stick / rim click.
export function rim({ seed = 31 } = {}) {
  const r = rng(seed);
  const n = Math.floor(0.09 * SR);
  const out = new Float32Array(n);
  let h = 0,
    p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const x = r() * 2 - 1;
    h = 0.6 * (h + x - p);
    p = x;
    out[i] = (Math.sin(t * 2 * Math.PI * 1650) * 0.55 + Math.sin(t * 2 * Math.PI * 430) * 0.4) * Math.exp(-t * 75) + h * 0.45 * Math.exp(-t * 160);
  }
  return out;
}

// White noise swelling through a rising band: the build into a chorus.
export function riser(len = 2, { from = 300, to = 4800, seed = 37 } = {}) {
  const r = rng(seed);
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  let lo = 0,
    bd = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const f = from * Math.pow(to / from, u);
    const k = 2 * Math.sin((Math.PI * f) / SR);
    const x = r() * 2 - 1;
    lo += k * bd;
    const hi = x - lo - 0.35 * bd;
    bd += k * hi;
    out[i] = bd * u * u * 0.35 * (i > n - 200 ? (n - i) / 200 : 1);
  }
  return out;
}
