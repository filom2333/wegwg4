# Plots components of one source mesh, each in its own colour and labelled with its index.
import sys, colorsys
import numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import load_source, comp_info
from ortho import render

src, which, out = sys.argv[1], sys.argv[2], sys.argv[3]
views = sys.argv[4].split(',') if len(sys.argv) > 4 else ['side', 'top', 'front', 'rear']
minTris = int(sys.argv[5]) if len(sys.argv) > 5 else 0
j, bufs, meshes = load_source(src)
for m in meshes:
    if m['short'] != which:
        continue
    n = m['lab'].max() + 1
    tl, labels = [], []
    for c in range(n):
        ci = comp_info(m, c)
        if ci['tris'] < minTris:
            continue
        h = (c * 0.618) % 1
        col = [int(255 * v) for v in colorsys.hsv_to_rgb(h, 0.55, 0.95)]
        P = m['pos'][m['idx'][m['lab'] == c]]
        tl.append((P, col))
        labels.append((ci['c'], str(c)))
    for v in views:
        bnd = ((-2.3, 2.3), (-1.75, 0.05)) if v in ('side', 'rside') else ((-2.3, 2.3), (-0.95, 0.95)) if v in ('top', 'under') else ((-1.0, 1.0), (-1.75, 0.05))
        render(tl, v, 260 if v in ('front', 'rear') else 200, bnd, labels).save(f'{out}_{which}_{v}.png')
