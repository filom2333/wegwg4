# Per-file audio features to find "tinkly" or busy sounds: onsets, spectral centroid, share of
# energy above 3 kHz, and how tonal (ringing) the 1.5-10 kHz band is.
import sys, os, subprocess, json
import numpy as np
SR = 44100
def dec(p):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.float32)
def feats(a):
    w = 441
    n = len(a) // w
    e = np.sqrt((a[: n * w].reshape(n, w) ** 2).mean(1) + 1e-12)
    thr = e.max() * 0.3
    on, last = 0, -99
    for i in range(1, n - 1):
        if e[i] > thr and e[i] >= e[i - 1] and e[i] >= e[i + 1] and e[i] > e[max(0, i - 4)] * 1.6 and i - last > 6:
            on += 1
            last = i
    N = 2048
    frames = [a[i : i + N] * np.hanning(N) for i in range(0, len(a) - N, N // 2)] or [np.pad(a, (0, N - len(a))) * np.hanning(N)]
    S = np.mean([np.abs(np.fft.rfft(f)) ** 2 for f in frames], axis=0)
    f = np.fft.rfftfreq(N, 1 / SR)
    tot = S.sum() + 1e-12
    cent = (S * f).sum() / tot
    hf = S[f > 3000].sum() / tot
    band = (f > 1500) & (f < 10000)
    sb = S[band]
    ton = 10 * np.log10(sb.max() / (np.median(sb) + 1e-12))
    return {'dur': round(len(a) / SR, 2), 'onsets': on, 'centroid': int(cent), 'hf%': round(hf * 100), 'ring_dB': round(ton, 1)}
out = {}
for fn in sorted(os.listdir(sys.argv[1])):
    if not fn.endswith('.mp3') or fn.startswith('step_'):
        continue
    out[fn[:-4]] = feats(dec(os.path.join(sys.argv[1], fn)))
for k, v in sorted(out.items(), key=lambda kv: -kv[1]['ring_dB']):
    print(f"{k:16s} dur {v['dur']:5.2f} onsets {v['onsets']:2d} centroid {v['centroid']:5d} hf {v['hf%']:3d}% ring {v['ring_dB']:5.1f} dB")
