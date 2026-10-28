# Shared loading for the Beetle import: source meshes in car space with connected components.
import numpy as np
import gltfio
from comps import components

S = 0.92
ZC = 0.296  # wheelbase midpoint (source front axle 1.497, rear -0.905 after scaling)


def to_car(p):
    return np.stack([-p[:, 0] * S, p[:, 1] * S, -p[:, 2] * S - ZC], 1)


def to_car_dir(n):
    return np.stack([-n[:, 0], n[:, 1], -n[:, 2]], 1)


def load_source(src):
    j, bufs = gltfio.load(src + '/vehicle.gltf')
    meshes = []
    for m in gltfio.mesh_instances(j, bufs):
        m['pos'] = to_car(m['pos'])
        m['nor'] = to_car_dir(m['nor'])
        m['short'] = m['name'].replace('_0', '').replace('Door_', 'D').replace('Main_', 'M').replace('Front_', 'F').replace('Rear_', 'R')
        m['lab'] = components(m['pos'], m['idx'])
        meshes.append(m)
    return j, bufs, meshes


def comp_info(m, c):
    t = m['idx'][m['lab'] == c]
    vp = m['pos'][np.unique(t)]
    return {'tris': len(t), 'min': vp.min(0), 'max': vp.max(0), 'c': (vp.min(0) + vp.max(0)) / 2}
