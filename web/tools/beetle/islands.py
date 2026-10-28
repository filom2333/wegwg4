# UV islands of a source mesh (triangles connected through vertices that share position and uv).
import sys
import numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import load_source
from comps import components


def uv_islands(m):
    key = np.concatenate([np.round(m['pos'] / 2e-4), np.round(m['uv'] / 1e-4)], 1)
    return components(key, m['idx'])


if __name__ == '__main__':
    src, which = sys.argv[1], sys.argv[2]
    _, _, ms = load_source(src)
    for m in ms:
        if m['short'] != which:
            continue
        isl = uv_islands(m)
        rows = []
        for c in range(isl.max() + 1):
            t = m['idx'][isl == c]
            vp = m['pos'][np.unique(t)]
            uv = m['uv'][np.unique(t)]
            comp = np.bincount(m['lab'][isl == c]).argmax()
            rows.append((len(t), c, comp, ((vp.min(0) + vp.max(0)) / 2).round(2).tolist(), (vp.max(0) - vp.min(0)).round(2).tolist(), (uv.min(0) % 1).round(2).tolist()))
        rows.sort(reverse=True)
        for r in rows[:int(sys.argv[3]) if len(sys.argv) > 3 else 60]:
            print('isl', r[1], 'tris', r[0], 'comp', r[2], 'c', r[3], 'size', r[4], 'uv0', r[5])
