# Builds public/sounds from the first batch (sfx/raw) and the re-made candidates (sfx2/raw):
# picks the chosen take of each re-made sound, cuts bursts down to single events, damps ringing
# tails, cuts footstep takes into clean single steps, matches loop levels to the synthesized noise
# they replace, and encodes small mp3s. Sounds whose recordings were not good enough are left out
# so the game keeps its synthesized versions.
import json, os, subprocess, sys
import numpy as np
D1, D2, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
D3 = sys.argv[4] if len(sys.argv) > 4 else None  # later additions (night: frogs, poorwill)
SR = 44100
KB = {'shot': 64, 'step': 56, 'loop': 80, 'loop2': 96}
SKIP = {'engine_idle', 'engine_low', 'engine_mid', 'engine_high', 'squeak', 'floorCreak', 'hum', 'keys'}
# chosen re-made takes: name -> list of (candidate, start s, end s or None)
PICK = {
    'pickup': [(2, 0, None)], 'pocket': [(2, 0, None)], 'pickupHeavy': [(1, 0, None)], 'click': [(2, 0, None)],
    'install': [(2, 0, None)], 'remove': [(3, 0, None)], 'hitMetal': [(3, 0, None)], 'hitFlesh': [(1, 0, None)],
    'drink': [(1, 0, None)], 'eat': [(2, 0, None)], 'reloadRevolver': [(1, 0, None)], 'chime': [(3, 0, None)],
    'wind': [(1, 0, None)], 'tyreRoll': [(3, 0, None)], 'skid': [(3, 1.1, None)],
    'ping': [(3, 0, None), (2, 0, None), (1, 0, 0.2)],
}
# from the later batch (D3)
PICK3 = {'frogs': [(1, 0, None)], 'poorwill': [(3, 0, None), (1, 0, None)]}
BURST = {'ratchet': (3, [1, 2, 3]), 'tick': (1, [1, 3])}  # keep the first n events of each take
DAMP = {'hitMetal': 0.12, 'install': 0.16, 'remove': 0.2, 'ping': 0.06, 'tick': 0.04, 'ratchet': 0.05, 'click': 0.05, 'pickup': 0.1}
LOWPASS = {'ratchet': 7000, 'click': 9000, 'reloadRevolver': 9000, 'eat': 10000}
HIGHPASS = {'wind': 110, 'tyreRoll': 45, 'skid': 300, 'rain': 80, 'pickupHeavy': 60, 'install': 50, 'remove': 50, 'tick': 120, 'ping': 150}
CUT = {'starter': (0.9, None)}
LIMIT = {'rain': 12}  # dB taken off the loudest drops so the hiss can be brought up
# How much louder (dB) each recording came out than the synthesized sound it replaces, measured in
# the game (loudest 50 ms); anything more than 3 dB off is brought back to within 3 dB by gain.
MEASURED = {'pocket': 4.4, 'pickupHeavy': -3.6, 'hitMetal': -4.7, 'hitFlesh': -4.8, 'eat': 4.4, 'starter': -5.8, 'stall': -7.9,
            'doorClose': -3, 'hood': -4.4, 'trunk': -6.7, 'crashHeavy': 4.8, 'crackle': -12.7, 'heartbeat': -3.2, 'revolver': -3.8,
            'shotgun': 7.7, 'stream': -5.7, 'throw': 6, 'bandage': 6.3, 'extinguish': -6.2, 'land': -5.2, 'stomach': -8.6,
            'reloadShotgun': -7.2, 'swing': 5.3, 'chatter': 3.7, 'doorCreak': -8, 'doorShut': -4.8, 'hurt': 4.4, 'ping': -3.5,
            'ratchet': -3.8, 'yips': -3.7, 'growl': 4, 'step_ice': -3.6, 'song': -5.2, 'step_dirt': -3.5, 'step_asphalt': -5.1,
            'step_rock': -5.5, 'step_wood': -4.1, 'step_salt': -3.5, 'step_snowRoad': -4.1, 'step_concrete': -3.7}
LOOP_STEREO = {'wind', 'rain', 'cicadas', 'crickets', 'stream', 'crackle', 'frogs'}

def decode(path, ch=1):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', str(ch), '-ar', str(SR), '-'], capture_output=True)
    a = np.frombuffer(r.stdout, dtype=np.float32).copy()
    return a.reshape(-1, ch) if ch > 1 else a

def encode(a, path, ch, kbps):
    raw = np.clip(a, -1, 1).astype(np.float32).tobytes()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ac', str(ch), '-ar', str(SR), '-i', '-', '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', path], input=raw, check=True)

def mono(a):
    return a if a.ndim == 1 else a.mean(1)

def env(a, win=256):
    m = mono(a)
    n = len(m) // win
    return np.sqrt((m[: n * win].reshape(n, win) ** 2).mean(1) + 1e-12)

def filt(a, hp=None, lp=None, order=2):
    # zero-phase Butterworth-shaped magnitude in the frequency domain
    if hp is None and lp is None:
        return a
    n = len(a)
    f = np.fft.rfftfreq(n, 1 / SR)
    g = np.ones_like(f)
    if lp:
        g /= np.sqrt(1 + (f / lp) ** (2 * order))
    if hp:
        g *= 1 / np.sqrt(1 + (hp / np.maximum(f, 1e-3)) ** (2 * order))
    if a.ndim == 1:
        return np.fft.irfft(np.fft.rfft(a) * g, n).astype(np.float32)
    return np.stack([np.fft.irfft(np.fft.rfft(a[:, c]) * g, n) for c in range(a.shape[1])], 1).astype(np.float32)

def fades(b, fin=0.004, fout=0.016):
    b = b.copy()
    i, o = min(len(b) // 4, int(fin * SR)), min(len(b) // 3, int(fout * SR))
    sh = (lambda x: x[:, None]) if b.ndim > 1 else (lambda x: x)
    if i > 1:
        b[:i] *= sh(np.linspace(0, 1, i))
    if o > 1:
        b[-o:] *= sh(np.linspace(1, 0, o))
    return b

def trim(a, thr_db=-48, pad=0.01, start_db=-30):
    e = env(a)
    idx = np.where(e > e.max() * 10 ** (thr_db / 20))[0]
    if not len(idx):
        return a
    first = np.where(e > e.max() * 10 ** (start_db / 20))[0][0]
    s = max(0, first * 256 - int(pad * SR))
    t = min(len(a), (idx[-1] + 1) * 256 + int(pad * 4 * SR))
    return fades(a[s:t], 0.004, 0.016)

def damp(a, tau):
    # an exponential decay after the loudest moment, so impacts stop instead of ringing on
    m = np.argmax(np.abs(mono(a)))
    k = np.ones(len(a))
    t = np.arange(len(a) - m) / SR
    k[m:] = np.exp(-np.maximum(0, t - tau * 0.5) / tau)
    return a * (k[:, None] if a.ndim > 1 else k)

def norm(a, peak=0.89):
    p = np.abs(a).max()
    return a * (peak / p) if p > 1e-6 else a

def onsets(a, thr=0.25, sep=0.25, win=220):
    e = env(a, win)
    hop = win / SR
    t = e.max() * thr
    out, last = [], -1e9
    for i in range(1, len(e) - 1):
        if e[i] > t and e[i] >= e[i - 1] and e[i] >= e[i + 1] and (i - last) * hop > sep:
            j = i
            while j > 0 and e[j - 1] > e[i] * 0.12 and (i - j) * hop < 0.04:
                j -= 1
            out.append((j * win, i * win, e[i]))
            last = i
    return out

def events(a, sep, maxlen):
    # single events: from each onset to just before the next one (or maxlen)
    on = onsets(a, 0.25, sep)
    segs = []
    for k, (s, p, lev) in enumerate(on):
        s = max(0, s - int(0.006 * SR))
        end = on[k + 1][0] - int(0.012 * SR) if k + 1 < len(on) else len(a)
        end = min(end, s + int(maxlen * SR))
        seg = trim(a[s:end], -38, 0.004)
        segs.append((seg, lev))
    return segs

def steps(a):
    # one footfall per file: the loudest transient of each step, from its rise to just before any
    # second hit (a heel-toe double or the next step), so every step is a single clean crunch
    win = 110
    e = env(a, win)
    hop = win / SR
    peaks = [i for i in range(1, len(e) - 1) if e[i] > e.max() * 0.12 and e[i] >= e[i - 1] and e[i] >= e[i + 1]]
    anchors = []
    for i in sorted(peaks, key=lambda i: -e[i]):
        if all(abs(i - j) * hop > 0.35 for j in anchors):
            anchors.append(i)
    groups = [[i] for i in sorted(anchors[:5])]
    out = []
    for g in groups:
        k = max(g, key=lambda i: e[i])
        s = k
        while s > 0 and e[s - 1] > e[k] * 0.1 and (k - s) * hop < 0.03:
            s -= 1
        end = k + int(0.24 / hop)
        for i in peaks:
            if i > k + int(0.1 / hop) and e[i] > e[k] * 0.33:
                end = min(end, i - int(0.01 / hop))
                break
        seg = a[max(0, s * win - int(0.003 * SR)): end * win]
        if len(seg) > 0.05 * SR:
            out.append((seg, e[k]))
    if not out:
        return []
    top = max(l for _, l in out)
    return [norm(fades(seg, 0.002, 0.05), 0.8) for seg, l in out if l > top * 0.3][:4]

# The game's filter on each loop at a typical moment: (filter for the synthesized noise, filter
# for a recording), as (highpass, lowpass) pairs; audio.js opens them up for recordings.
BANDS = {
    'wind': ((None, 500), (None, 1420)),
    'rain': ((1500, None), (300, None)),
    'tyreRoll': ((None, 1050), (None, 1050)),
    'skid': ((830, 1070), (400, 2300)),
}

def loudness(a, kind, rec=True):
    hp, lp = BANDS[kind][1 if rec else 0]
    m = filt(mono(a), hp, lp, 2 if rec or kind != 'skid' else 6)
    return np.sqrt((m ** 2).mean())

REF = {}
def ref_noise():
    # the synthesized pink, brown and white noise from synth.js, through the game's filters
    r = np.random.default_rng(1)
    w = r.uniform(-1, 1, SR * 3)
    p = np.zeros(7)
    pink = np.empty_like(w)
    for i, x in enumerate(w):
        p[0] = 0.99886 * p[0] + x * 0.0555179; p[1] = 0.99332 * p[1] + x * 0.0750759; p[2] = 0.969 * p[2] + x * 0.153852
        p[3] = 0.8665 * p[3] + x * 0.3104856; p[4] = 0.55 * p[4] + x * 0.5329522; p[5] = -0.7616 * p[5] - x * 0.016898
        pink[i] = (p[:6].sum() + p[6] + x * 0.5362) * 0.11
        p[6] = x * 0.115926
    b = 0.0
    brown = np.empty_like(w)
    for i, x in enumerate(w):
        b = (b + 0.02 * x) / 1.02
        brown[i] = b * 3.5
    REF['wind'] = loudness(pink, 'wind', False)
    REF['skid'] = loudness(pink, 'skid', False)
    REF['tyreRoll'] = loudness(brown, 'tyreRoll', False)
    # white noise hiss is harsher than real rain at the same level
    REF['rain'] = loudness(w, 'rain', False) * 0.7

def limit(a, db):
    # a peak limiter: fast attack, 60 ms release, ceiling db below the loudest peak
    m = np.abs(mono(a))
    thr = m.max() * 10 ** (-db / 20)
    w = int(0.004 * SR)
    pk = np.maximum.reduce([np.roll(m, -k) for k in range(0, w, 8)])
    g = np.minimum(1, thr / np.maximum(pk, 1e-9))
    rel = np.exp(-1 / (0.06 * SR))
    out = np.empty_like(g)
    cur = 1.0
    for i, x in enumerate(g):
        cur = x if x < cur else x + (cur - x) * rel
        out[i] = cur
    return a * (out[:, None] if a.ndim > 1 else out)

def loop_seam(a, xf=0.4):
    n = int(xf * SR)
    if len(a) < n * 3:
        return a
    t = np.linspace(0, 1, n)
    if a.ndim > 1:
        t = t[:, None]
    mixed = a[-n:] * np.cos(t * np.pi / 2) + a[:n] * np.sin(t * np.pi / 2)
    return np.concatenate([mixed, a[n:-n]])

def balance(a, win=3.0):
    # a stereo loop leaning to one side (the wind came out 9 dB louder on the right) is brought
    # back to the middle over a few seconds, keeping the quick movement of the gusts
    w = int(win * SR)
    k = np.ones(w) / w
    e = [np.sqrt(np.convolve(a[:, c] ** 2, k, 'same') + 1e-9) for c in (0, 1)]
    mid = np.sqrt(e[0] * e[1])
    return np.stack([a[:, c] * (mid / e[c]) ** 0.85 for c in (0, 1)], 1).astype(np.float32)

def level_out(a, win=0.5):
    # take the slow swells out of a loop that should be steady (skid, road noise)
    m = mono(a)
    w = int(win * SR)
    e = np.sqrt(np.convolve(m ** 2, np.ones(w) / w, 'same') + 1e-9)
    g = (np.median(e) / e) ** 0.7
    return a * (g[:, None] if a.ndim > 1 else g)

ref_noise()
jobs = json.load(open(os.path.join(D1, 'jobs.json')))
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.mp3'):
        os.remove(os.path.join(OUT, f))
index = {'sounds': {}, 'music': {}, 'gain': {}}
report = []
done = set()

def add(name, fn):
    index['sounds'].setdefault(name, []).append(fn)

def finish_shot(name, a, fn):
    a = filt(a, HIGHPASS.get(name), LOWPASS.get(name))
    a = trim(a)
    if name in DAMP:
        a = trim(damp(a, DAMP[name]), -50)
    a = norm(a)
    encode(a, os.path.join(OUT, fn), 1, KB['shot'])
    add(name, fn)
    report.append(f'{fn}: {len(a) / SR:.2f}s')

def finish_loop(name, a, fn):
    ch = a.shape[1] if a.ndim > 1 else 1
    a = filt(a, HIGHPASS.get(name), LOWPASS.get(name))
    if name in ('skid', 'tyreRoll'):
        a = level_out(a)
    if ch == 2:
        a = balance(a)
    if name in LIMIT:
        a = limit(a, LIMIT[name])
    a = loop_seam(a)
    if name in REF:
        # peak-normalise the file; whatever level is still missing goes into index.json's gain
        a = norm(a, 0.95)
        index['gain'][name] = round(float(REF[name] / loudness(a, name)), 3)
        report.append(f"{name}: gain {index['gain'][name]}")
    else:
        a = norm(a, 0.8)
    encode(a, os.path.join(OUT, fn), ch, KB['loop2'] if ch == 2 else KB['loop'])
    add(name, fn)
    report.append(f'{fn}: loop {len(a) / SR:.2f}s peak {np.abs(a).max():.2f}')

# re-made sounds
for name, takes in PICK.items():
    for i, (c, s, e) in enumerate(takes):
        loop = name in ('wind', 'tyreRoll', 'skid')
        a = decode(os.path.join(D2, 'raw', f'{name}_c{c}.mp3'), 2 if name in LOOP_STEREO else 1)
        a = a[int(s * SR): int(e * SR) if e else None]
        fn = f'{name}.mp3' if len(takes) == 1 else f'{name}_{i + 1}.mp3'
        (finish_loop if loop else finish_shot)(name, a, fn)
    done.add(name)
for name, takes in (PICK3.items() if D3 else []):
    for i, (c, s, e) in enumerate(takes):
        loop = name == 'frogs'
        a = decode(os.path.join(D3, 'raw', f'{name}_c{c}.mp3'), 2 if name in LOOP_STEREO else 1)
        a = a[int(s * SR): int(e * SR) if e else None]
        fn = f'{name}.mp3' if len(takes) == 1 else f'{name}_{i + 1}.mp3'
        (finish_loop if loop else finish_shot)(name, a, fn)
    done.add(name)
for name, (n, cands) in BURST.items():
    k = 0
    for c in cands:
        a = decode(os.path.join(D2, 'raw', f'{name}_c{c}.mp3'))
        if name == 'tick':
            parts = [seg for seg, _ in events(a, 0.1, 0.25)]
        else:
            on = onsets(a, 0.25, 0.03, 110)
            end = on[n][0] - int(0.01 * SR) if len(on) > n else len(a)
            parts = [a[max(0, on[0][0] - int(0.004 * SR)): end]] if on else []
        for seg in parts:
            k += 1
            finish_shot(name, seg, f'{name}_{k}.mp3')
    done.add(name)

# first-batch sounds kept as they were made
for j in jobs:
    name = j['name']
    if name in done or name in SKIP:
        continue
    src = os.path.join(D1, 'raw', j['file'] + '.mp3')
    if not os.path.exists(src):
        continue
    if name.startswith('step_'):
        for i, s in enumerate(steps(decode(src))):
            fn = f'{name}_{i + 1}.mp3'
            encode(s, os.path.join(OUT, fn), 1, KB['step'])
            add(name, fn)
        report.append(f"{name}: {len(index['sounds'].get(name, []))} steps")
        continue
    if j['loop']:
        a = decode(src, 2 if name in LOOP_STEREO else 1)
        if name in CUT:
            s, e = CUT[name]
            a = a[int(s * SR): int(e * SR) if e else None]
        finish_loop(name, a, j['file'] + '.mp3')
    else:
        finish_shot(name, decode(src), j['file'] + '.mp3')
for k, d in MEASURED.items():
    if k in index['sounds'] and abs(d) > 3:
        index['gain'][k] = round(10 ** (-(d - np.sign(d) * 3) / 20), 3)
for k, v in list(index['sounds'].items()):
    if len(v) == 1:
        index['sounds'][k] = v[0]
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
open(os.path.join(os.path.dirname(OUT.rstrip('/')), 'report2.txt') if False else os.path.join(D2, 'report.txt'), 'w').write('\n'.join(report))
print(len(index['sounds']), 'sounds,', sum(len(v) if isinstance(v, list) else 1 for v in index['sounds'].values()), 'files')
