import sys, colorsys
import numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import load_source
from islands import uv_islands
from ortho import render

src, which, out = sys.argv[1], sys.argv[2], sys.argv[3]
views = sys.argv[4].split(',')
sel = set(int(x) for x in sys.argv[5].split(',')) if len(sys.argv) > 5 and sys.argv[5] else None
_, _, ms = load_source(src)
for m in ms:
    if m['short'] != which:
        continue
    isl = uv_islands(m)
    tl, labels = [], []
    for c in range(isl.max() + 1):
        if sel is not None and c not in sel:
            continue
        t = m['idx'][isl == c]
        if len(t) < 8:
            continue
        P = m['pos'][t]
        col = [int(255 * v) for v in colorsys.hsv_to_rgb((c * 0.618) % 1, 0.55, 0.95)]
        tl.append((P, col))
        labels.append((P.reshape(-1, 3).mean(0), str(c)))
    for v in views:
        bnd = ((-2.3, 2.3), (-1.75, 0.05)) if v in ('side', 'rside') else ((-2.3, 2.3), (-0.95, 0.95)) if v in ('top', 'under') else ((-1.0, 1.0), (-1.75, 0.05))
        render(tl, v, 260 if v in ('front', 'rear') else 200, bnd, labels).save(f'{out}_{which}_isl_{v}.png')
