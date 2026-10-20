# Paints grass-clump cards (grey value + alpha; tinted per species in the material).
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter
out = sys.argv[1]
SS = 4

def clump(seed, W, H, n, spread, hmin, hmax, wmin, wmax, lean, name, seeds=0):
    rnd = random.Random(seed)
    im = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    blades = []
    for i in range(n):
        x0 = W / 2 + rnd.gauss(0, spread * W)
        x0 = min(W - 4, max(4, x0))
        h = (hmin + (hmax - hmin) * rnd.random() ** 0.7) * H
        w = wmin + (wmax - wmin) * rnd.random()
        a = rnd.gauss(0, lean) + (x0 - W / 2) / W * 0.9
        curl = rnd.gauss(0, 0.32)
        blades.append((rnd.random(), x0, h, w, a, curl))
    blades.sort()  # random depth order
    for depth, x0, h, w, a, curl in blades:
        seg = 14
        pts_l, pts_r = [], []
        dark = 0.28 + 0.25 * depth
        for k in range(seg + 1):
            t = k / seg
            ang = a + curl * t * t
            x = x0 + math.sin(ang) * h * t + curl * h * 0.15 * t * t
            y = H - 1 - math.cos(ang) * h * t
            ww = w * (1 - t) ** 0.8 * 0.5
            nx, ny = math.cos(ang), math.sin(ang)
            pts_l.append(((x - nx * ww) * SS, (y - ny * ww) * SS))
            pts_r.append(((x + nx * ww) * SS, (y + ny * ww) * SS))
        # shade along the blade: dark base to light tip, a bit of per-blade variation
        for k in range(seg):
            t = (k + 0.5) / seg
            v = dark + (0.95 - dark) * (t ** 0.8)
            v *= 0.85 + 0.3 * depth
            g = int(max(0, min(255, v * 255)))
            poly = [pts_l[k], pts_l[k + 1], pts_r[k + 1], pts_r[k]]
            d.polygon(poly, fill=(g, g, g, 255))
        # midrib highlight
    if seeds:
        for i in range(seeds):
            x0 = W / 2 + rnd.gauss(0, spread * W * 0.8)
            h = (hmax * (0.9 + rnd.random() * 0.25)) * H
            a = rnd.gauss(0, lean * 0.6)
            xe, ye = x0 + math.sin(a) * h, H - 1 - math.cos(a) * min(h, H - 8)
            d.line([(x0 * SS, (H - 1) * SS), (xe * SS, ye * SS)], fill=(150, 150, 150, 255), width=SS)
            for k in range(9):
                t = 0.75 + k * 0.03
                cx = x0 + (xe - x0) * t + rnd.gauss(0, 1.5)
                cy = (H - 1) + (ye - (H - 1)) * t
                d.ellipse([(cx - 2.2) * SS, (cy - 4) * SS, (cx + 2.2) * SS, (cy + 4) * SS], fill=(205, 200, 185, 255))
    im = im.resize((W, H), Image.LANCZOS)
    # bleed colour into transparent texels for clean mips
    px = im.load()
    bg = Image.new('RGBA', (W, H), (120, 120, 120, 0))
    rgb = Image.alpha_composite(bg, im)
    blur = im.filter(ImageFilter.GaussianBlur(6))
    outim = Image.new('RGBA', (W, H))
    op = outim.load(); bp = blur.load(); ip = im.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = ip[x, y]
            if a < 250:
                br, bg_, bb, ba = bp[x, y]
                if ba > 0:
                    f = 255 / ba
                    fr, fg, fb = min(255, int(br * f)), min(255, int(bg_ * f)), min(255, int(bb * f))
                else:
                    fr = fg = fb = 110
                k = a / 255
                r, g, b = int(r * k + fr * (1 - k)), int(g * k + fg * (1 - k)), int(b * k + fb * (1 - k))
            op[x, y] = (r, g, b, a)
    outim.save(f'{out}/{name}.webp', 'WEBP', quality=88, method=6)

clump(11, 512, 512, 190, 0.1, 0.35, 0.95, 3.5, 8, 0.15, 'grass_tall', seeds=7)
clump(23, 512, 256, 160, 0.13, 0.45, 0.98, 3.5, 8, 0.22, 'grass_short')
print('ok')
