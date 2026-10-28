"""Packs the ground and road textures (CC0, Poly Haven) into the three texture arrays the terrain
and road shaders sample: colour, normal, and data (height, roughness, ambient occlusion).

    python3 -I pack_ground.py <folder with the downloaded maps> <godot/assets/textures/ground>

Layer order is the shaders' (see ground.gdshaderinc): sand, dirt, rock, salt, grass, snow, forest
floor, gravel, asphalt, shoulder gravel."""
import sys, os
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
SIZE = 1024
LAYERS = ['dense_sand', 'dry_ground_rocks', 'rock_face_03', 'mud_cracked_dry_03', 'leafy_grass', 'snow_02', 'forest_ground_04', 'gravelly_sand', 'asphalt_02', 'gravel_floor_02']


def load(name, kind, mode):
    for ext in ('jpg', 'png'):
        p = os.path.join(SRC, f'{name}_{kind}.{ext}')
        if os.path.exists(p):
            im = Image.open(p)
            if im.mode == 'I;16' or im.mode == 'I':
                a = np.asarray(im, dtype=np.float32)
                a = a / (65535.0 if a.max() > 255 else 255.0)
                im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8), 'L')
            im = im.convert(mode)
            if im.size != (SIZE, SIZE):
                im = im.resize((SIZE, SIZE), Image.LANCZOS)
            return np.asarray(im, dtype=np.float32) / 255.0
    raise FileNotFoundError(f'{name}_{kind}')


alb, nrm, dat = [], [], []
for name in LAYERS:
    a = load(name, 'diff', 'RGB')
    if name == 'mud_cracked_dry_03':
        # salt crust: the cracked clay bleached white, the cracks staying darker
        g = a.mean(axis=2, keepdims=True)
        g = (g - g.mean()) * 0.8 + 0.8
        a = np.clip(g * np.array([1.0, 0.985, 0.95]), 0, 1)
    n = load(name, 'nor', 'RGB')
    arm = load(name, 'arm', 'RGB')
    h = load(name, 'disp', 'L')
    # height normalised per layer (2nd..98th percentile), so height blending treats all alike
    lo, hi = np.percentile(h, 2), np.percentile(h, 98)
    h = np.clip((h - lo) / max(hi - lo, 1e-3), 0, 1)
    alb.append(a)
    nrm.append(n)
    dat.append(np.stack([h, arm[..., 1], arm[..., 0]], axis=2))
    print(f'{name:22s} mean colour {a.reshape(-1, 3).mean(0).round(3)}  roughness {arm[..., 1].mean():.2f}')

os.makedirs(OUT, exist_ok=True)
for arr, fname in ((alb, 'ground_albedo.jpg'), (nrm, 'ground_normal.jpg'), (dat, 'ground_data.jpg')):
    strip = np.concatenate(arr, axis=0)
    Image.fromarray(np.clip(strip * 255 + 0.5, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(OUT, fname), quality=94, subsampling=0)
print('layers', len(LAYERS))
