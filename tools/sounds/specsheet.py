# Spectrogram contact sheet: one row per sound (log-frequency spectrogram 60 Hz - 16 kHz plus the
# waveform), labelled, so ringing (horizontal lines), clatter (many vertical streaks) and music
# (stacked harmonics) can be seen at a glance.
import sys, os, subprocess
import numpy as np
from PIL import Image, ImageDraw
SR = 44100
def dec(p):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.float32)
out, files = sys.argv[1], sys.argv[2:]
W, H, LW = 520, 90, 150
N, hop = 2048, 256
f = np.fft.rfftfreq(N, 1 / SR)
edges = np.geomspace(60, 16000, H + 1)
rows = []
for p in files:
    a = dec(p)
    if len(a) < N:
        a = np.pad(a, (0, N - len(a)))
    fr = np.lib.stride_tricks.sliding_window_view(a, N)[::hop] * np.hanning(N)
    S = np.abs(np.fft.rfft(fr, axis=1)) ** 2
    M = np.stack([S[:, (f >= edges[i]) & (f < edges[i + 1])].mean(1) if ((f >= edges[i]) & (f < edges[i + 1])).any() else S[:, np.argmin(abs(f - edges[i]))] for i in range(H)], 1)
    D = 10 * np.log10(M + 1e-12)
    D = np.clip((D - (D.max() - 70)) / 70, 0, 1)
    img = Image.fromarray((np.flipud(D.T) * 255).astype(np.uint8)).resize((W, H))
    img = img.convert('RGB')
    row = Image.new('RGB', (LW + W, H + 30), (20, 20, 24))
    row.paste(img, (LW, 0))
    d = ImageDraw.Draw(row)
    # waveform strip
    n = len(a) // W
    pk = np.abs(a[: n * W]).reshape(W, n).max(1) if n else np.zeros(W)
    for x in range(W):
        h = int(pk[x] * 14)
        d.line([(LW + x, H + 15 - h), (LW + x, H + 15 + h)], fill=(120, 200, 140))
    for hz, lab in [(100, '100'), (1000, '1k'), (5000, '5k')]:
        y = H - int(np.searchsorted(edges, hz) / H * H)
        d.line([(LW - 6, y), (LW, y)], fill=(200, 200, 90))
        d.text((LW - 34, y - 6), lab, fill=(200, 200, 90))
    d.text((6, 8), os.path.basename(p)[:22], fill=(255, 255, 255))
    d.text((6, 26), f"{len(a) / SR:.2f}s", fill=(170, 170, 170))
    rows.append(row)
sheet = Image.new('RGB', (LW + W, sum(r.height for r in rows)), (0, 0, 0))
y = 0
for r in rows:
    sheet.paste(r, (0, y))
    y += r.height
sheet.save(out)
