# Paints a fern frond card: rachis up the middle, alternating pinnae made of small lobes.
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter
out = sys.argv[1]
SS = 3
W, H = 256, 512
rnd = random.Random(5)
im = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
def P(x, y):
    return (x * SS, y * SS)
N = 26
stem = []
for k in range(101):
    t = k / 100
    stem.append((W / 2 + math.sin(t * 2.2) * 6 * t, H - 6 - t * (H - 14)))
def at(t):
    f = t * 100
    i = min(99, int(f))
    a, b = stem[i], stem[i + 1]
    return (a[0] + (b[0] - a[0]) * (f - i), a[1] + (b[1] - a[1]) * (f - i))
for i in range(N):
    t = 0.08 + 0.9 * i / N
    side = 1 if i % 2 else -1
    L = (W * 0.46) * (math.sin(min(1, t * 1.6) * math.pi * 0.5) ** 0.6) * (1 - t) ** 0.55 + 6
    x0, y0 = at(t)
    ang = math.radians(62 - t * 25) * side
    lobes = max(3, int(L / 7))
    for k in range(lobes):
        s = (k + 0.5) / lobes
        cx = x0 + math.sin(ang) * L * s
        cy = y0 - math.cos(ang) * L * s * 0.55 - s * s * 10
        r = (1 - s * 0.75) * 7.5 + 1.5
        g = 0.55 + 0.35 * rnd.random() * 0.5 + 0.25 * (1 - s)
        col = (int(70 * g), int(118 * g), int(42 * g), 255)
        for side2 in (-1, 1):
            ox = math.cos(ang) * r * 0.55 * side2
            oy = math.sin(ang) * r * 0.55 * side2 * 0.5
            d.ellipse([P(cx + ox - r * 0.55, cy + oy - r * 0.9)[0], P(cx + ox - r * 0.55, cy + oy - r * 0.9)[1], P(cx + ox + r * 0.55, cy + oy + r * 0.9)[0], P(cx + ox + r * 0.55, cy + oy + r * 0.9)[1]], fill=col)
    # pinna midrib
    d.line([P(x0, y0), P(x0 + math.sin(ang) * L, y0 - math.cos(ang) * L * 0.55 - 10)], fill=(58, 82, 34, 255), width=SS)
d.line([P(*p) for p in stem], fill=(70, 92, 40, 255), width=3 * SS)
im = im.resize((W, H), Image.LANCZOS)
blur = im.filter(ImageFilter.GaussianBlur(5))
ip, bp = im.load(), blur.load()
o = Image.new('RGBA', (W, H)); op = o.load()
for y in range(H):
    for x in range(W):
        r, g, b, a = ip[x, y]
        if a < 250:
            br, bg, bb, ba = bp[x, y]
            fr, fg, fb = (min(255, int(br * 255 / ba)), min(255, int(bg * 255 / ba)), min(255, int(bb * 255 / ba))) if ba else (60, 95, 38)
            k = a / 255
            r, g, b = int(r * k + fr * (1 - k)), int(g * k + fg * (1 - k)), int(b * k + fb * (1 - k))
        op[x, y] = (r, g, b, a)
o.save(f'{out}/fern.webp', 'WEBP', quality=88, method=6)
print('ok')
