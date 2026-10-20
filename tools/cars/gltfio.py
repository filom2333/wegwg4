# Minimal glTF 2.0 reader (embedded or external buffers) with world transforms, for the car
# import tools.
import base64, json, os, struct
import numpy as np

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load(path):
    j = json.load(open(path))
    j['_dir'] = os.path.dirname(os.path.abspath(path))
    bufs = []
    for b in j['buffers']:
        uri = b['uri']
        if uri.startswith('data:'):
            bufs.append(base64.b64decode(uri.split(',', 1)[1]))
        else:
            bufs.append(open(os.path.join(j['_dir'], uri), 'rb').read())
    return j, bufs


def view_bytes(j, bufs, bv):
    v = j['bufferViews'][bv]
    b = bufs[v['buffer']]
    o = v.get('byteOffset', 0)
    return b[o:o + v['byteLength']], v.get('byteStride')


def accessor(j, bufs, i):
    a = j['accessors'][i]
    data, stride = view_bytes(j, bufs, a['bufferView'])
    dt = np.dtype(COMP[a['componentType']])
    n = NCOMP[a['type']]
    off = a.get('byteOffset', 0)
    cnt = a['count']
    if stride and stride != dt.itemsize * n:
        out = np.zeros((cnt, n), dt)
        for k in range(cnt):
            out[k] = np.frombuffer(data, dt, n, off + k * stride)
        return out
    arr = np.frombuffer(data, dt, cnt * n, off).reshape(cnt, n) if n > 1 else np.frombuffer(data, dt, cnt, off)
    return arr.copy()


def quat_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def local_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    s = np.array(n.get('scale', [1, 1, 1]))
    r = quat_mat(n.get('rotation', [0, 0, 0, 1]))
    m[:3, :3] = r * s
    m[:3, 3] = n.get('translation', [0, 0, 0])
    return m


def world_matrices(j):
    nodes = j['nodes']
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    cache = {}

    def wm(i):
        if i in cache:
            return cache[i]
        m = local_matrix(nodes[i])
        if i in parent:
            m = wm(parent[i]) @ m
        cache[i] = m
        return m

    return [wm(i) for i in range(len(nodes))], parent


def node_path(j, parent, i):
    out = []
    while True:
        out.append(j['nodes'][i].get('name', str(i)))
        if i not in parent:
            break
        i = parent[i]
    return out


def mesh_instances(j, bufs):
    """Yields dicts with world-space positions/normals, uvs, indices, material and node path."""
    W, parent = world_matrices(j)
    for i, n in enumerate(j['nodes']):
        if 'mesh' not in n:
            continue
        M = W[i]
        N = np.linalg.inv(M[:3, :3]).T
        for p in j['meshes'][n['mesh']]['primitives']:
            at = p['attributes']
            pos = accessor(j, bufs, at['POSITION']).astype(np.float64)
            nor = accessor(j, bufs, at['NORMAL']).astype(np.float64) if 'NORMAL' in at else None
            uv = accessor(j, bufs, at['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in at else None
            idx = accessor(j, bufs, p['indices']).astype(np.int64) if 'indices' in p else np.arange(len(pos))
            wp = pos @ M[:3, :3].T + M[:3, 3]
            wn = None
            if nor is not None:
                wn = nor @ N.T
                wn /= np.linalg.norm(wn, axis=1, keepdims=True) + 1e-12
            yield {'name': n.get('name'), 'path': node_path(j, parent, i), 'pos': wp, 'nor': wn, 'uv': uv, 'idx': idx.reshape(-1, 3), 'mat': p.get('material'), 'flip': np.linalg.det(M[:3, :3]) < 0}


def image_bytes(j, bufs, img):
    im = j['images'][img]
    if 'bufferView' in im:
        return view_bytes(j, bufs, im['bufferView'])[0]
    uri = im['uri']
    if uri.startswith('data:'):
        return base64.b64decode(uri.split(',', 1)[1])
    return open(os.path.join(j['_dir'], uri), 'rb').read()
