# Generic car import: reads a glTF car, moves it into car space (metres, +Z forward, +X to the
# car's left, ground at y = 0, wheelbase centred on z = 0), sorts meshes (or their connected
# components) into game parts with a per-car rule set, and writes
#   <out>/<name>.glb        one node per part, one mesh per (part, material key)
#   <out>/*.webp            colour / normal / metal-roughness textures per material key
#   <meta>                  part boxes, wheels, steering wheel, hinges and extra points
#
# A car config (see sedan88.py) provides: SRC, NAME, to_car(p), to_car_dir(n),
# SPLIT (mesh names whose components are classified one by one), classify(mesh, info),
# MATERIALS {source material: key}, TEXTURES {key: (source material, colour, normal, mr sizes)},
# and finish(meta, parts) to add hinges and points.
import io, json, os, struct, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import gltfio
from comps import components


def info_of(pos, tris):
    vp = pos[np.unique(tris)]
    mn, mx = vp.min(0), vp.max(0)
    return {'tris': len(tris), 'min': mn, 'max': mx, 'c': (mn + mx) / 2, 's': mx - mn, 'P': vp}


def pca_axis(P):
    c = P.mean(0)
    _, _, vt = np.linalg.svd(P - c)
    return c, vt[2]


def run(cfg, out_dir, meta_path):
    os.makedirs(out_dir, exist_ok=True)
    j, bufs = gltfio.load(cfg.SRC)
    groups = {}
    report = {}
    for m in gltfio.mesh_instances(j, bufs):
        pos = cfg.to_car(m['pos'])
        nor = cfg.to_car_dir(m['nor']) if m['nor'] is not None else np.zeros_like(pos)
        uv = m['uv'] if m['uv'] is not None else np.zeros((len(pos), 2))
        idx = m['idx'][:, ::-1] if m['flip'] else m['idx']
        src_mat = j['materials'][m['mat']]['name'] if m['mat'] is not None else ''
        name = m['name']
        if name in cfg.SPLIT:
            lab = components(pos, idx)
            pieces = [(idx[lab == c], c) for c in range(lab.max() + 1)]
        else:
            pieces = [(idx, None)]
        for tris, ci in pieces:
            inf = info_of(pos, tris)
            inf['comp'] = ci
            inf['mat'] = src_mat
            inf['path'] = m['path']
            part = cfg.classify(name, inf)
            report.setdefault(part, []).append((name, ci, len(tris)))
            if part is None:
                continue
            key = cfg.material_key(src_mat, part, inf) if hasattr(cfg, 'material_key') else cfg.MATERIALS[src_mat]
            g = groups.setdefault((part, key), {'pos': [], 'nor': [], 'uv': [], 'idx': [], 'n': 0})
            used = np.unique(tris)
            remap = -np.ones(len(pos), np.int64)
            remap[used] = np.arange(len(used)) + g['n']
            g['pos'].append(pos[used])
            g['nor'].append(nor[used])
            g['uv'].append(uv[used])
            g['idx'].append(remap[tris])
            g['n'] += len(used)
    # geometry the config makes itself (a tyre the source leaves to its own engine, say)
    if hasattr(cfg, 'extra'):
        cfg.extra(groups)
    # one wheel model: the chosen wheel's geometry moved to the origin with its axle along X; the
    # four wheel parts keep only their boxes (hub centres)
    wheel_boxes = {}
    for (part, key) in list(groups):
        if part.startswith('wheel_'):
            g = groups.pop((part, key))
            P = np.concatenate(g['pos'])
            mn, mx = wheel_boxes.get(part, (P.min(0), P.max(0)))
            wheel_boxes[part] = (np.minimum(mn, P.min(0)), np.maximum(mx, P.max(0)))
            if part == getattr(cfg, 'TYRE', None):
                c = (P.min(0) + P.max(0)) / 2
                _, ax = pca_axis(P)
                if ax[0] < 0:
                    ax = -ax
                # rotation taking the axle onto +X (about the vertical)
                ang = np.arctan2(ax[2], ax[0])
                R = np.array([[np.cos(ang), 0, np.sin(ang)], [0, 1, 0], [-np.sin(ang), 0, np.cos(ang)]])
                g['pos'] = [(p - c) @ R.T for p in g['pos']]
                g['nor'] = [n @ R.T for n in g['nor']]
                groups[('tyre', key)] = g
    keys = sorted({k for (_, k) in groups})
    # ---------------------------------------------------------------- GLB
    bin_chunks, accessors, views, meshes_out, nodes = [], [], [], [], []
    off = [0]

    def add_view(arr, target=None):
        b = arr.tobytes()
        pad = (-len(b)) % 4
        bin_chunks.append(b + b'\0' * pad)
        v = {'buffer': 0, 'byteOffset': off[0], 'byteLength': len(b)}
        if target:
            v['target'] = target
        views.append(v)
        off[0] += len(b) + pad
        return len(views) - 1

    def add_acc(arr, typ, ctype=5126, target=34962, minmax=False):
        vi = add_view(arr, target)
        a = {'bufferView': vi, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if minmax:
            a['min'] = arr.min(0).astype(float).tolist()
            a['max'] = arr.max(0).astype(float).tolist()
        accessors.append(a)
        return len(accessors) - 1

    part_nodes, bbox, tri_count, geo = {}, {}, {}, {}
    for (part, key), g in sorted(groups.items()):
        pos = np.concatenate(g['pos']).astype(np.float32)
        nor = np.concatenate(g['nor']).astype(np.float32)
        uv = np.concatenate(g['uv']).astype(np.float32)
        idx = np.concatenate(g['idx'])
        geo.setdefault(part, []).append((pos, idx))
        ii = idx.astype(np.uint32 if len(pos) > 65535 else np.uint16).reshape(-1)
        prim = {
            'attributes': {'POSITION': add_acc(pos, 'VEC3', minmax=True), 'NORMAL': add_acc(nor, 'VEC3'), 'TEXCOORD_0': add_acc(uv, 'VEC2')},
            'indices': add_acc(ii, 'SCALAR', 5125 if ii.dtype == np.uint32 else 5123, 34963),
            'material': keys.index(key),
        }
        meshes_out.append({'name': part + ':' + key, 'primitives': [prim]})
        nodes.append({'name': part + ':' + key, 'mesh': len(meshes_out) - 1})
        part_nodes.setdefault(part, []).append(len(nodes) - 1)
        b = bbox.setdefault(part, [pos.min(0), pos.max(0)])
        b[0] = np.minimum(b[0], pos.min(0))
        b[1] = np.maximum(b[1], pos.max(0))
        tri_count[part] = tri_count.get(part, 0) + len(idx)
    top = []
    for part, kids in part_nodes.items():
        nodes.append({'name': part, 'children': kids})
        top.append(len(nodes) - 1)
    binary = b''.join(bin_chunks)
    gl = {
        'asset': {'version': '2.0', 'generator': 'route9 car import', 'copyright': cfg.CREDIT},
        'scene': 0,
        'scenes': [{'nodes': top}],
        'nodes': nodes,
        'meshes': meshes_out,
        'materials': [{'name': k} for k in keys],
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': len(binary)}],
    }
    js = json.dumps(gl, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    with open(f'{out_dir}/{cfg.NAME}.glb', 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(binary), 0x004E4942) + binary)
    # ---------------------------------------------------------------- textures
    mats = {m['name']: m for m in j['materials']}

    def image_of(tex_index):
        src = j['textures'][tex_index]['source']
        return Image.open(io.BytesIO(gltfio.image_bytes(j, bufs, src)))

    tex_meta = {}
    for key, (src_name, sc, sn, sm) in cfg.TEXTURES.items():
        m = mats[src_name]
        pbr = m.get('pbrMetallicRoughness', {})
        out = {}
        if 'baseColorTexture' in pbr and sc:
            im = image_of(pbr['baseColorTexture']['index'])
            alpha = im.mode in ('RGBA', 'LA', 'P') and key in getattr(cfg, 'ALPHA_KEYS', ())
            im = im.convert('RGBA' if alpha else 'RGB').resize((sc, sc), Image.LANCZOS)
            if hasattr(cfg, 'fix_color'):
                im = cfg.fix_color(key, im)
            im.save(f'{out_dir}/{key}_color.webp', quality=86, method=6)
            out['map'] = f'{key}_color.webp'
        if 'normalTexture' in m and sn:
            image_of(m['normalTexture']['index']).convert('RGB').resize((sn, sn), Image.LANCZOS).save(f'{out_dir}/{key}_normal.webp', quality=88, method=6)
            out['normalMap'] = f'{key}_normal.webp'
        if 'metallicRoughnessTexture' in pbr and sm:
            image_of(pbr['metallicRoughnessTexture']['index']).convert('RGB').resize((sm, sm), Image.LANCZOS).save(f'{out_dir}/{key}_mr.webp', quality=86, method=6)
            out['mrMap'] = f'{key}_mr.webp'
        f = pbr.get('baseColorFactor')
        if f:
            out['color'] = [round(x, 4) for x in f]
        out['metalness'] = pbr.get('metallicFactor', 1.0 if 'metallicRoughnessTexture' in pbr else 0.0)
        out['roughness'] = pbr.get('roughnessFactor', 1.0)
        tex_meta[key] = out
    for alias, key in getattr(cfg, 'ALIASES', {}).items():
        if alias in keys:
            tex_meta[alias] = dict(tex_meta[key])
    # ---------------------------------------------------------------- metadata
    meta = {'source': cfg.CREDIT, 'materials': tex_meta, 'keys': keys}
    meta['parts'] = {p: {'min': bbox[p][0].round(4).tolist(), 'max': bbox[p][1].round(4).tolist(), 'tris': int(tri_count[p])} for p in bbox}
    # wheels: hub centres from the four wheel boxes; radius / width from the wheel model
    wheels = {w: ((mn + mx) / 2).round(4).tolist() for w, (mn, mx) in wheel_boxes.items()}
    if 'tyre' in bbox:
        mn, mx = bbox['tyre']
        meta['wheel'] = {'radius': round(float((mx[1] - mn[1]) / 2), 4), 'width': round(float(mx[0] - mn[0]), 4), 'centers': wheels}
    if 'steeringWheel' in geo:
        P = np.concatenate([p for p, _ in geo['steeringWheel']])
        c, ax = pca_axis(P)
        if ax[2] > 0:
            ax = -ax  # from the hub toward the driver (rearward)
        meta['steeringWheel'] = {'center': c.round(4).tolist(), 'axis': ax.round(4).tolist(), 'radius': round(float(np.percentile(np.linalg.norm(P - c, axis=1), 98)), 4)}
    meta['triangles'] = int(sum(tri_count.values()))
    cfg.finish(meta, {p: (bbox[p][0], bbox[p][1]) for p in bbox}, geo)
    json.dump(meta, open(meta_path, 'w'), indent=1)
    # report
    print(cfg.NAME, 'parts', len(bbox), 'tris', meta['triangles'], 'glb', os.path.getsize(f'{out_dir}/{cfg.NAME}.glb') // 1024, 'KB')
    for p in sorted(bbox, key=str):
        print(f'  {p:16s} {tri_count[p]:6d}  min {bbox[p][0].round(2).tolist()} max {bbox[p][1].round(2).tolist()}')
    if None in report:
        print('  dropped:', report[None][:20])
    return meta
