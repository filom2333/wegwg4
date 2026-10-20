import sys, colorsys
import numpy as np
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
def save(im, name, q=82):
    im.save(f'{out}/{name}.webp', 'WEBP', quality=q, method=6)
# bark: colour (sRGB) and normal maps at 512
for b in ['pine', 'birch', 'oak']:
    for kind in ['color', 'normal']:
        im = Image.open(f'{src}/bark/{b}_{kind}_1k.jpg').convert('RGB').resize((512, 512), Image.LANCZOS)
        save(im, f'bark_{b}_{kind}', 85 if kind == 'normal' else 80)
# leaves: premultiplied-safe colour bleed so mip levels don't fringe, alpha kept
def leaf(name, im):
    a = np.asarray(im).astype(np.float32)
    rgb, al = a[..., :3], a[..., 3:4] / 255.0
    # bleed: blur colour weighted by alpha, fill transparent texels
    from PIL import ImageFilter
    w = al.copy()
    acc = rgb * w
    for r in [2, 6, 16, 40]:
        A = Image.fromarray(np.clip(acc, 0, 255 * 1).astype(np.float32)[..., 0], mode='F')
        pass
    small = im.resize((32, 32), Image.BOX)
    sa = np.asarray(small).astype(np.float32)
    mean = (sa[..., :3] * sa[..., 3:4]).sum((0, 1)) / max(1, sa[..., 3].sum())
    fill = np.where(al > 0.02, rgb, mean[None, None, :])
    o = np.concatenate([fill, al * 255], -1).clip(0, 255).astype(np.uint8)
    Image.fromarray(o, 'RGBA').resize((512, 512), Image.LANCZOS).save(f'{out}/leaf_{name}.webp', 'WEBP', quality=88, method=6)
for n in ['pine', 'oak', 'ash']:
    leaf(n, Image.open(f'{src}/leaves/{n}_color.png').convert('RGBA'))
# aspen: autumn as is, plus a summer green made by rotating the hue
asp = Image.open(f'{src}/leaves/aspen_color.png').convert('RGBA')
leaf('aspen_autumn', asp)
a = np.asarray(asp).astype(np.float32) / 255.0
rgb = a[..., :3]
import numpy as np
mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn + 1e-6
# vectorised hue rotate via YIQ
T = np.array([[0.299, 0.587, 0.114], [0.596, -0.274, -0.322], [0.211, -0.523, 0.312]])
yiq = rgb @ T.T
ang = np.deg2rad(-58)
c, s = np.cos(ang), np.sin(ang)
i2 = yiq[..., 1] * c - yiq[..., 2] * s
q2 = yiq[..., 1] * s + yiq[..., 2] * c
yiq2 = np.stack([yiq[..., 0] * 0.82, i2 * 0.9, q2 * 0.9], -1)
rgb2 = yiq2 @ np.linalg.inv(T).T
g = np.concatenate([rgb2.clip(0, 1), a[..., 3:4]], -1)
leaf('aspen_green', Image.fromarray((g * 255).astype(np.uint8), 'RGBA'))
print('ok')
