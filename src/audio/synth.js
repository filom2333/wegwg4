// The few sounds still synthesized into AudioBuffers (the rest are recordings in public/sounds):
// noise for the shaped layers, a creaking board, keys in the ignition, a wiper squeak, a lamp's
// hum, and the plucked notes of the radio and the title theme.

const SR = 44100;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeBuffer(ctx, seconds, fn, channels = 1) {
  const n = Math.max(1, Math.floor(seconds * SR));
  const buf = ctx.createBuffer(channels, n, SR);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    fn(d, n, c);
  }
  // normalise peak to 0.9
  let peak = 0;
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak > 0)
    for (let c = 0; c < channels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] *= 0.9 / peak;
    }
  return buf;
}

// one-pole filters operating in place
function lowpass(d, cutoff) {
  const a = Math.exp((-2 * Math.PI * cutoff) / SR);
  let y = 0;
  for (let i = 0; i < d.length; i++) {
    y = (1 - a) * d[i] + a * y;
    d[i] = y;
  }
  return d;
}
// resonant bandpass (biquad, constant peak gain)
function bandpass(d, f, q) {
  const w = (2 * Math.PI * f) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const b0 = alpha,
    b2 = -alpha,
    a0 = 1 + alpha,
    a1 = -2 * Math.cos(w),
    a2 = 1 - alpha;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    d[i] = y;
  }
  return d;
}

// A tone gliding from f0 to f1 (exponentially) with vibrato, a sine envelope and some
// harmonics, added into d from sample s.
function glide(d, s, dur, f0, f1, { amp = 1, vib = 0, vibF = 40, harm = [1], rough = 0, r = Math.random } = {}) {
  const m = Math.floor(dur * SR);
  let ph = 0;
  for (let j = 0; j < m && s + j < d.length; j++) {
    const u = j / m;
    const f = f0 * Math.pow(f1 / f0, u) * (1 + vib * Math.sin((2 * Math.PI * vibF * j) / SR));
    ph += f / SR;
    let v = 0;
    for (let k = 0; k < harm.length; k++) v += Math.sin(2 * Math.PI * ph * (k + 1)) * harm[k];
    if (rough) v *= 1 - rough + rough * (r() * 2 - 1);
    d[s + j] += v * Math.sin(Math.PI * u) * amp;
  }
}

// ------------------------------------------------------------------ generators
export const GEN = {
  noise(ctx, seconds = 2, color = 'white', seed = 1) {
    const r = rng(seed);
    return makeBuffer(ctx, seconds, (d, n) => {
      let b = 0,
        p = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const w = r() * 2 - 1;
        if (color === 'brown') {
          b = (b + 0.02 * w) / 1.02;
          d[i] = b * 3.5;
        } else if (color === 'pink') {
          p[0] = 0.99886 * p[0] + w * 0.0555179;
          p[1] = 0.99332 * p[1] + w * 0.0750759;
          p[2] = 0.969 * p[2] + w * 0.153852;
          p[3] = 0.8665 * p[3] + w * 0.3104856;
          p[4] = 0.55 * p[4] + w * 0.5329522;
          p[5] = -0.7616 * p[5] - w * 0.016898;
          d[i] = (p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + w * 0.5362) * 0.11;
          p[6] = w * 0.115926;
        } else d[i] = w;
      }
      // make loopable: crossfade the ends
      const f = Math.floor(n * 0.05);
      for (let i = 0; i < f; i++) {
        const t = i / f;
        d[i] = d[i] * t + d[n - f + i] * (1 - t);
      }
    });
  },

  creak(ctx, { f = 180, len = 0.9, seed = 9 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const fr = f * (1 + 0.35 * Math.sin(t * 3.1) + 0.1 * Math.sin(t * 17));
        ph += fr / SR;
        // stick-slip pulses
        const pulse = Math.pow(Math.max(0, Math.sin(2 * Math.PI * ph)), 12);
        d[i] = (pulse + (r() - 0.5) * 0.08) * Math.sin(Math.PI * Math.min(1, t / len));
      }
      bandpass(d, f * 4, 2.5);
    });
  },

  hum(ctx, { len = 2, seed = 55 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        let v = 0;
        for (let k = 1; k <= 7; k++) v += Math.sin(2 * Math.PI * 120 * k * t) / (k * (k % 2 ? 1 : 1.6));
        d[i] = v * (0.8 + 0.2 * Math.sin(2 * Math.PI * 3 * t)) + (r() - 0.5) * 0.08;
      }
    });
  },

  // Birdsong: a phrase of quick whistled notes. kind: 'warbler', 'trill', 'meadowlark', 'robin'.
  keys(ctx, { seed = 75 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, 0.5, (d, n) => {
      for (let h = 0; h < 7; h++) {
        const s = Math.floor(r() * 0.3 * SR),
          f = 3200 + r() * 3000,
          a = 0.3 + r() * 0.7;
        for (let j = 0; s + j < n && j < 0.12 * SR; j++) {
          const t = j / SR;
          d[s + j] += (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.73 * t)) * Math.exp(-t * 45) * a;
        }
      }
    });
  },

  // Rubber wiper blade squeaking on dry glass.
  squeak(ctx, { seed = 77, len = 0.28 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d) => {
      glide(d, 0, len, 820 + r() * 200, 1250 + r() * 300, { harm: [1, 0.6, 0.4, 0.25], rough: 0.25, r, vib: 0.04, vibF: 90 });
    });
  },

  // Heart: lub-dub.
  pluck(ctx, { f = 196, len = 2.2, seed = 31, damp = 0.996 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      const P = Math.floor(SR / f);
      const buf = new Float32Array(P);
      for (let i = 0; i < P; i++) buf[i] = r() * 2 - 1;
      let k = 0;
      for (let i = 0; i < n; i++) {
        const a = buf[k],
          b = buf[(k + 1) % P];
        const v = 0.5 * (a + b) * damp;
        buf[k] = v;
        d[i] = a;
        k = (k + 1) % P;
      }
      lowpass(d, 3500);
    });
  },
};

export { SR, lowpass, bandpass, rng };
