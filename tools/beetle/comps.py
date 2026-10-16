# Connected components of the source meshes in car space, for writing the part split rules.
import sys, json
import numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import gltfio

S = 0.92


def to_car(p):
    return np.stack([-p[:, 0] * S, p[:, 1] * S, -p[:, 2] * S], 1)


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


if __name__ == '__main__':
    src = sys.argv[1]
    only = sys.argv[2] if len(sys.argv) > 2 else None
    j, bufs = gltfio.load(src + '/vehicle.gltf')
    out = []
    for m in gltfio.mesh_instances(j, bufs):
        if only and not m['name'].startswith(only):
            continue
        p = to_car(m['pos'])
        lab = components(p, m['idx'])
        for c in range(lab.max() + 1):
            tris = m['idx'][lab == c]
            vp = p[np.unique(tris)]
            uv = m['uv'][np.unique(tris)]
            out.append((m['name'], c, len(tris), vp.min(0).round(3).tolist(), vp.max(0).round(3).tolist(), uv.mean(0).round(2).tolist()))
    out.sort(key=lambda r: (r[0], -r[2]))
    for r in out:
        print(r[0], 'c%d' % r[1], 'tris', r[2], 'min', r[3], 'max', r[4], 'uv', r[5])
