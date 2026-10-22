# Seamless loops (16-bit mono WAV) and one-shots from downloaded car recordings: the engine from
# qubodup's "Car Engine Loop 96kHz, 4s" (CC-BY 3.0), the horn and parking brake from GGBotNet's
# "Car Sound Effects Pack" (CC0, <oga dir>/carpack), the spray hiss from the game's extinguisher.
# The downloads are data: keep them in their own folder and run this with python3 -I.
# Usage: python3 -I carloops.py <oga dir> <public/sounds dir> <engine-loop-1.wav>
import subprocess, sys, wave
import numpy as np
SR = 44100
src, out = sys.argv[1], sys.argv[2]
rng = np.random.default_rng(9)

def load(f):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)

def rms(x):
    return float(np.sqrt(np.mean(x ** 2)))

def level(x, db):
    x = x - x.mean()
    return x * (10 ** (db / 20) / rms(x))

def write(name, x):
    pk = np.abs(x).max()
    if pk > 0.98:
        x = x * 0.98 / pk
    with wave.open(f'{out}/{name}', 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
    print(name, '%.3f s' % (len(x) / SR), 'rms %.1f dB' % (20 * np.log10(rms(x))))

def best_end(x, s, n, search, w=1024):
    # the end point near s+n whose next samples look most like the ones at s
    a = x[s:s + w]
    best, bi = -2, s + n
    for e in range(s + n - search, s + n + search):
        b = x[e:e + w]
        if len(b) < w:
            break
        c = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12)
        if c > best:
            best, bi = c, e
    return bi, best

def xloop(x, s, e, L):
    # x[s:e] made to loop: its first L samples crossfade with the L samples after e
    seg = x[s:e].copy()
    t = np.linspace(0, 1, L, endpoint=False)
    fi, fo = np.sin(t * np.pi / 2) ** 2, np.cos(t * np.pi / 2) ** 2
    seg[:L] = x[s:s + L] * fi + x[e:e + L] * fo
    return seg

def texture(x, s, e, seconds, grain=0.16):
    # a longer noise loop from random grains of x[s:e] (Hann, half overlap), wrapped round
    g = int(grain * SR)
    hop = g // 2
    n = int(seconds * SR) // hop * hop
    y = np.zeros(n + g)
    win = np.hanning(g)
    for p in range(0, n, hop):
        o = rng.integers(s, e - g)
        y[p:p + g] += x[o:o + g] * win
    y[:g] += y[n:n + g]
    return y[:n]

# the engine: qubodup's recorded car engine loop (CC-BY 3.0), already seamless at 4 s; firing ~87 Hz
x = load(sys.argv[3])
write('engineLoop.wav', level(x[: 4 * SR], -16))
# horn: the steady middle of the blast, cut on whole cycles
x = load(f'{src}/carpack/Car_Horn.ogg')
s = int(0.07 * SR)
e, c = best_end(x, s, int(0.1 * SR), 120, 600)
write('hornLoop.wav', level(xloop(x, s, e, 220), -11))
# spray can hiss: grains of the extinguisher's steady burst
x = load(f'{out}/extinguish.mp3')
write('sprayLoop.wav', level(texture(x, int(0.02 * SR), int(0.36 * SR), 2.4), -18))
# parking brake (one-shot; encode to mp3 afterwards: ffmpeg -i parkBrake.wav -b:a 128k parkBrake.mp3)
x = load(f'{src}/carpack/Car_Parking_Brake.ogg')
x = x[: int(0.44 * SR)]
x[-400:] *= np.linspace(1, 0, 400)
write('parkBrake.wav', level(x, -20))
