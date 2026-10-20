# Connected components of a triangle mesh (vertices welded by position).
import sys, json
import numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import gltfio

def components(pos, idx):
    q = np.round(pos / 2e-4).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    v = inv[idx]  # tri -> welded verts
    par = np.arange(inv.max() + 1)

    def find(a):
        r = a
        while par[r] != r:
            r = par[r]
        while par[a] != r:
            par[a], a = r, par[a]
        return r

    for t in v:
        a, b, c = find(t[0]), find(t[1]), find(t[2])
        if a != b: par[b] = a
        c = find(c)
        if a != c: par[c] = a
    roots = np.array([find(t[0]) for t in v])
    _, lab = np.unique(roots, return_inverse=True)
    return lab

