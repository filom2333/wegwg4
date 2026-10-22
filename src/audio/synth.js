// The few sounds still synthesized into AudioBuffers (the rest are recordings in public/sounds):
// noise for the shaped layers (radio static, spray) and the plucked notes of the radio tuning.

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

// ------------------------------------------------------------------ generators
export const GEN = {
  noise(ctx, seconds = 2, color = 'white', seed = 1) {
    const r = rng(seed);
    return makeBuffer(ctx, seconds, (d, n) => {
      let b = 0;
      for (let i = 0; i < n; i++) {
        const w = r() * 2 - 1;
        if (color === 'brown') {
          b = (b + 0.02 * w) / 1.02;
          d[i] = b * 3.5;
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

  // A plucked string (Karplus-Strong).
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

export { SR, lowpass, rng };
