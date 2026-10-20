# Prints the car-space layout of the source model: per mesh bounds and connected components.
import sys
import numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import gltfio

src = sys.argv[1]
j, bufs = gltfio.load(src + '/vehicle.gltf')
allp = []
for m in gltfio.mesh_instances(j, bufs):
    allp.append(m['pos'])
    p = m['pos']
    print(m['name'], 'mat', m['mat'], 'tris', len(m['idx']), 'min', p.min(0).round(3), 'max', p.max(0).round(3), 'flip', m['flip'])
P = np.concatenate(allp)
print('ALL min', P.min(0).round(3), 'max', P.max(0).round(3))
W, parent = gltfio.world_matrices(j)
for i, n in enumerate(j['nodes']):
    if n.get('name', '').startswith(('Wheel', 'Node_35', 'Node_38', 'Node_41', 'Node_44', 'Door_', 'Front', 'Rear', 'Main')) and 'mesh' not in n:
        print('node', n['name'], 'world pos', W[i][:3, 3].round(3))
for t in ['right_tire_front', 'right_tire_back']:
    jt, bt = gltfio.load(src + '/' + t + '.gltf')
    for m in gltfio.mesh_instances(jt, bt):
        p = m['pos']
        c = (p.min(0) + p.max(0)) / 2
        print(t, m['name'], 'tris', len(m['idx']), 'min', p.min(0).round(3), 'max', p.max(0).round(3), 'center', c.round(3), 'mat', m['mat'])
