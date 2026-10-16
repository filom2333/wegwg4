// Procedural sound synthesis into AudioBuffers (no sample assets).

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
function highpass(d, cutoff) {
  const a = Math.exp((-2 * Math.PI * cutoff) / SR);
  let y = 0,
    x0 = 0;
  for (let i = 0; i < d.length; i++) {
    y = a * (y + d[i] - x0);
    x0 = d[i];
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

const env = (t, a, dcy) => (t < a ? t / a : Math.exp(-(t - a) / dcy));

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

  thump(ctx, { f = 70, decay = 0.12, click = 0.4, rattle = 0, seed = 2, len = 0.6, noiseCut = 1800 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      const nz = new Float32Array(n);
      for (let i = 0; i < n; i++) nz[i] = r() * 2 - 1;
      lowpass(nz, noiseCut);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const fr = f * (1 + 0.6 * Math.exp(-t / 0.02));
        d[i] = Math.sin(2 * Math.PI * fr * t) * Math.exp(-t / decay) + nz[i] * click * Math.exp(-t / 0.015);
        if (rattle) d[i] += nz[i] * rattle * Math.exp(-t / 0.12) * (0.5 + 0.5 * Math.sin(t * 190));
      }
    });
  },

  metal(ctx, { f = 420, decay = 0.35, partials = [1, 2.76, 5.4, 8.93], seed = 3, len = 1.0, hit = 0.6 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        let s = 0;
        partials.forEach((p, k) => (s += Math.sin(2 * Math.PI * f * p * t + k) * Math.exp(-t / (decay / (1 + k * 0.6))) / (1 + k)));
        d[i] = s + (r() * 2 - 1) * hit * Math.exp(-t / 0.01);
      }
    });
  },

  // gunshot: initial crack + body + tail
  gunshot(ctx, { body = 140, tail = 0.5, crack = 1, seed = 5, len = 1.6 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      const a = new Float32Array(n),
        b = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        a[i] = r() * 2 - 1;
        b[i] = r() * 2 - 1;
      }
      lowpass(b, 900);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        d[i] = a[i] * crack * Math.exp(-t / 0.006) + b[i] * 2.4 * Math.exp(-t / (tail * 0.25)) + Math.sin(2 * Math.PI * body * t * (1 - t)) * Math.exp(-t / 0.05) * 1.2;
        // early reflections off the ground
        if (t > 0.03) d[i] += b[i - Math.floor(0.03 * SR)] * 0.4 * Math.exp(-(t - 0.03) / tail);
      }
    });
  },

  // short granular crunch (footsteps, eating)
  crunch(ctx, { grains = 22, cut = 2500, len = 0.25, seed = 7, body = 0, bodyF = 90, spread = 0.15 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      for (let g = 0; g < grains; g++) {
        const st = Math.floor(Math.pow(r(), 1.6) * spread * SR);
        const gl = Math.floor((0.002 + r() * 0.01) * SR);
        const amp = 0.3 + r();
        for (let i = 0; i < gl && st + i < n; i++) d[st + i] += (r() * 2 - 1) * amp * Math.exp(-i / (gl * 0.3));
      }
      lowpass(d, cut);
      highpass(d, 120);
      if (body)
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          d[i] += Math.sin(2 * Math.PI * bodyF * t) * body * Math.exp(-t / 0.03);
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

  whoosh(ctx, { len = 0.35, f0 = 400, f1 = 1600, seed = 11 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
      const out = new Float32Array(n);
      // sweeping bandpass approximated with chunks
      const chunks = 16;
      for (let c = 0; c < chunks; c++) {
        const s = Math.floor((c / chunks) * n),
          e = Math.floor(((c + 1) / chunks) * n);
        const seg = d.slice(s, e);
        bandpass(seg, f0 + (f1 - f0) * Math.sin((c / chunks) * Math.PI), 1.4);
        out.set(seg, s);
      }
      for (let i = 0; i < n; i++) d[i] = out[i] * Math.sin((Math.PI * i) / n);
    });
  },

  gulp(ctx, { len = 0.5, seed = 13 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const k = Math.floor(t / 0.16);
        const tt = t - k * 0.16;
        const fr = 220 + 260 * tt * 6;
        d[i] = Math.sin(2 * Math.PI * fr * tt) * Math.exp(-tt / 0.03) * (k < 3 ? 1 : 0) + (r() - 0.5) * 0.04 * Math.exp(-tt / 0.05);
      }
      lowpass(d, 1400);
    });
  },

  pourLoop(ctx, { len = 2, seed = 15 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
      bandpass(d, 900, 0.8);
      // bubbles
      for (let b = 0; b < 40; b++) {
        const st = Math.floor(r() * n);
        const f = 300 + r() * 900;
        for (let i = 0; i < 1500 && st + i < n; i++) {
          const t = i / SR;
          d[st + i] += Math.sin(2 * Math.PI * f * (1 + t * 8) * t) * Math.exp(-t / 0.008) * 2;
        }
      }
    });
  },

  thunder(ctx, { len = 6, seed = 17, close = 0.5 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
      lowpass(d, 260);
      lowpass(d, 300);
      let crackle = new Float32Array(n);
      for (let i = 0; i < n; i++) crackle[i] = r() * 2 - 1;
      highpass(crackle, 800);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const e = Math.exp(-t / 1.6) * (0.6 + 0.4 * Math.sin(t * 3.7) * Math.sin(t * 1.3));
        d[i] = d[i] * 6 * e + crackle[i] * close * Math.exp(-t / 0.08);
      }
    });
  },

  starter(ctx, { len = 1.2, seed = 19 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const f = 9 + 3 * Math.min(1, t * 2); // compression strokes per second
        ph += f / SR;
        const pulse = 0.5 + 0.5 * Math.cos(2 * Math.PI * ph);
        d[i] = (Math.sin(2 * Math.PI * 160 * t) * 0.3 + (r() - 0.5) * 0.4) * (0.35 + 0.65 * pulse);
      }
      lowpass(d, 1500);
    });
  },

  chirp(ctx, { f = 4200, len = 0.12, seed = 21 } = {}) {
    return makeBuffer(ctx, len, (d, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        d[i] = Math.sin(2 * Math.PI * f * t) * Math.sin(2 * Math.PI * 60 * t) ** 2 * Math.sin((Math.PI * i) / n);
      }
    });
  },

  howl(ctx, { len = 3.2, f = 520, seed = 23 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const u = t / len;
        const fr = f * (0.75 + 0.45 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5) - 0.3 * Math.max(0, u - 0.7)) * (1 + 0.012 * Math.sin(t * 34));
        ph += fr / SR;
        d[i] = (Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph) + (r() - 0.5) * 0.06) * Math.sin(Math.PI * Math.min(1, u * 1.05));
      }
    });
  },

  growl(ctx, { len = 1.6, f = 70, seed = 25 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const fr = f * (1 + 0.25 * Math.sin(t * 9) + 0.15 * (r() - 0.5));
        ph += fr / SR;
        const saw = 2 * (ph % 1) - 1;
        d[i] = (saw * 0.6 + (r() - 0.5) * 0.9) * Math.sin(Math.PI * Math.min(1, t / len)) * (0.6 + 0.4 * Math.sin(t * 23));
      }
      bandpass(d, 420, 1.2);
    });
  },

  screech(ctx, { len = 0.9, seed = 27 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const fr = 1800 + 600 * Math.sin(t * 7) - 500 * t;
        ph += fr / SR;
        d[i] = (Math.sin(2 * Math.PI * ph) * 0.4 + (r() - 0.5)) * Math.sin((Math.PI * i) / n) ** 2;
      }
      bandpass(d, 2200, 1.5);
    });
  },

  breath(ctx, { len = 0.6, seed = 29 } = {}) {
    const r = rng(seed);
    return makeBuffer(ctx, len, (d, n) => {
      for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.sin((Math.PI * i) / n);
      bandpass(d, 1100, 0.9);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        d[i] += Math.sin(2 * Math.PI * 120 * t) * 0.3 * Math.exp(-t / 0.05);
      }
    });
  },

  // Karplus-Strong plucked string
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

export { SR, lowpass, highpass, bandpass, rng };
