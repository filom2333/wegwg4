# Converts the source Beetle model (glTF from the MetaDrive asset pack, CC-BY-4.0 "Beetle/Fusca
# (Version 1)" by soujagah) into the game's car asset: geometry split into removable parts in car
# space (metres, +Z forward, +X left, ground at y = 0), glass separated by texture alpha, a paint
# mask for repainting, compressed textures and measured metadata (hinges, wheels, controls).
#
# usage: python3 -I tools/beetle/import.py <source dir> <public out dir> <meta json out>
import sys, os, json, io, struct
import numpy as np
from PIL import Image

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import gltfio
from common import load_source, to_car, S, ZC
from islands import uv_islands
from comps import components

SRC, OUT, META = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)

j, bufs, meshes = load_source(SRC)

# ------------------------------------------------------------------ textures (decoded once)
def tex_of(mat_index, slot):
    m = j['materials'][mat_index]
    if slot == 'color':
        t = m['pbrMetallicRoughness']['baseColorTexture']['index']
    elif slot == 'mr':
        t = m['pbrMetallicRoughness']['metallicRoughnessTexture']['index']
    else:
        t = m['normalTexture']['index']
    img = j['textures'][t]['source']
    return Image.open(io.BytesIO(gltfio.image_bytes(j, bufs, img)))


ALPHA = {k: np.asarray(tex_of(k, 'color').convert('RGBA'))[:, :, 3] for k in (1, 2)}


def sample(a, uv):
    h, w = a.shape
    u = np.mod(uv[:, 0], 1.0)
    v = np.mod(uv[:, 1], 1.0)
    return a[np.clip((v * h).astype(int), 0, h - 1), np.clip((u * w).astype(int), 0, w - 1)]


# ------------------------------------------------------------------ classification helpers
def near(c, t, tol):
    return np.all(np.abs(np.asarray(c) - np.asarray(t)) <= tol)


def nearA(c, t, tol):
    return near((abs(c[0]), c[1], c[2]), t, tol)


def side(x):
    return 'L' if x > 0 else 'R'


def comp_stats(m):
    out = []
    for c in range(m['lab'].max() + 1):
        t = m['idx'][m['lab'] == c]
        vp = m['pos'][np.unique(t)]
        mn, mx = vp.min(0), vp.max(0)
        out.append({'c': (mn + mx) / 2, 's': mx - mn, 'n': len(t), 'min': mn, 'max': mx})
    return out


HEAD = [(0.53, 0.68, 1.61), (-0.53, 0.68, 1.61)]
TAIL = [(0.55, 0.63, -1.59), (-0.55, 0.63, -1.59)]
WHEEL = (0.30, 1.0, 0.365)


def classify_component(short, ci):
    """Part for a whole connected component, or None to fall back to the node default."""
    c, s, n = ci['c'], ci['s'], ci['n']
    x, y, z = c
    if short == 'M1':
        if s[2] > 1.0 and s[2] < 1.25 and abs(x) > 0.5 and z < -0.6:
            return 'fender_R' + side(x)
        if nearA(c, (0.55, 0.63, -1.57), (0.08, 0.08, 0.08)) and abs(x) > 0.45:
            return 'taillight_' + side(x)
        return None
    for h in HEAD:
        if np.linalg.norm(c - np.array(h)) < 0.16 and short in ('M2', 'M3', 'M4'):
            return 'headlight_' + side(x)
    for t in TAIL:
        if np.linalg.norm(c - np.array(t)) < 0.13 and short in ('M2', 'M3', 'M4'):
            return 'taillight_' + side(x)
    if short == 'M2':
        if near(c, (0, 0.67, 1.42), (0.05, 0.05, 0.06)) and n > 1000:
            return 'spare'
        if abs(x) > 0.15 and abs(x) < 0.45 and -0.25 < z < 0.75 and y < 1.1 and s[0] < 0.6:
            return 'seat_F' + side(x)
        if abs(x) < 0.1 and -0.95 < z < -0.25 and y < 1.1 and s[0] > 0.9 and s[0] < 1.2:
            return 'seat_R'
        if s[2] > 1.0 and s[2] < 1.25 and abs(x) > 0.45 and z < -0.6 and y < 0.8:
            return 'fender_R' + side(x)
        if s[2] > 1.0 and s[2] < 1.15 and abs(x) > 0.4 and z > 0.9 and y < 0.7:
            return 'fender_F' + side(x)
        return None
    if short == 'M3':
        # windscreen wipers (arm, blade and spindle per side) at the base of the screen
        if 1.1 < y < 1.19 and 0.5 < z < 0.63 and s[0] < 0.3 and s[1] < 0.06 and abs(x) < 0.5:
            return 'x_wiperL' if x > -0.03 else 'x_wiperR'
        # chassis: floor pan, tunnel, front beam, frame horns, torsion housings
        if (y < 0.36 and abs(x) < 0.6 and z > -1.45 and s[1] < 0.2) or near(c, (0, 0.35, -1.3), (0.05, 0.05, 0.05)):
            return 'chassis'
        if z > 1.62 and y < 0.62 and abs(x) < 0.75:
            return 'bumper_F'
        if nearA(c, (0.17, 0.32, -1.88), (0.03, 0.03, 0.04)) and abs(x) > 0.1:
            return 'exhaust'
        if z < -1.68 and 0.38 < y < 0.7 and abs(x) < 0.75:
            return 'bumper_R'
        if nearA(c, (0.58, 0.89, 1.29), (0.04, 0.04, 0.04)) and abs(x) > 0.5:
            return 'fender_F' + side(x)  # fender-top turn signals
        if s[2] > 1.0 and s[2] < 1.2 and abs(x) > 0.45 and z < -0.6 and y < 0.7:
            return None  # inner wheelhouse stays with the shell
        if y < 0.36 and abs(x) < 0.7 and z < -1.45 and s[0] > 0.5:
            return 'exhaust'  # heat exchanger cross pipe under the engine
        return None
    if short == 'M4':
        if np.linalg.norm(c - np.array(WHEEL)) < 0.17 and n > 40:
            return 'steeringWheel'
        if z < -1.3:
            if near(c, (0.0, 0.47, -1.71), (0.06, 0.04, 0.04)) and s[0] > 0.4:
                return 'exhaust'
            if s[0] > 0.6 and s[1] > 0.45:
                return None  # firewall seal plate
            if y > 0.82:
                return 'airfilter'
            return 'engine'
        if s[0] > 0.35 and s[2] > 0.3 and y < 0.5 and abs(x) > 0.2 and abs(x) < 0.4 and z > -0.2 and z < 0.4:
            return 'seat_F' + side(x)  # seat frame
        # pedals: arm + pad per pedal, x 0.11 (gas), 0.21 (brake), 0.30 (clutch)
        if 0.66 < z < 0.8 and y < 0.5 and s[0] < 0.12:
            px = x
            return 'x_pedalGas' if px < 0.16 else 'x_pedalBrake' if px < 0.26 else 'x_pedalClutch'
        if near(c, (0, 0.54, 0.49), (0.03, 0.04, 0.04)) or near(c, (0, 0.71, 0.45), (0.03, 0.03, 0.03)):
            return 'x_gearLever'
        if near(c, (0, 0.52, 0.18), (0.03, 0.04, 0.05)) or near(c, (0, 0.42, -0.03), (0.04, 0.04, 0.04)):
            return 'x_handbrake'
        if near(c, (0.28, 1.01, 0.54), (0.03, 0.03, 0.03)) and n > 150:
            return 'x_speedo'
        return None
    return None


DEFAULT = {'DL': 'door_FL', 'DR': 'door_FR', 'F': 'trunk', 'R': 'hood', 'M': 'body'}


def node_default(short):
    for k in ('DL', 'DR'):
        if short.startswith(k):
            return DEFAULT[k]
    return DEFAULT[short[0]]


# front fenders are part of the shell's connected component; take their UV islands
FENDER_ISLANDS = [
    ((0.54, 0.58, 1.17), (0.48, 0.6, 1.08)),
    ((0.54, 0.58, 1.17), (0.46, 0.59, 1.05)),
    ((0.48, 0.57, 1.17), (0.34, 0.59, 1.07)),
    ((0.50, 0.38, 1.66), (0.39, 0.05, 0.10)),
    ((0.69, 0.28, 0.72), (0.16, 0.0, 0.18)),
]

MATKEY = {0: 'paint', 1: 'trim', 2: 'under', 3: 'mech'}
tri_part = []  # per mesh: array of part names per triangle
tri_mat = []
for m in meshes:
    nt = len(m['idx'])
    parts = np.array([node_default(m['short'])] * nt, dtype=object)
    stats = comp_stats(m)
    for ci_i, ci in enumerate(stats):
        p = classify_component(m['short'], ci)
        if p:
            parts[m['lab'] == ci_i] = p
    if m['short'] == 'M1':
        isl = uv_islands(m)
        for k in range(isl.max() + 1):
            sel = isl == k
            vp = m['pos'][np.unique(m['idx'][sel])]
            c = (vp.min(0) + vp.max(0)) / 2
            s = vp.max(0) - vp.min(0)
            for tc, ts in FENDER_ISLANDS:
                if near((abs(c[0]), c[1], c[2]), tc, 0.03) and near(s, ts, 0.03) and abs(c[0]) > 0.3:
                    parts[sel] = 'fender_F' + side(c[0])
    mk = np.array([MATKEY[m['mat']]] * nt, dtype=object)
    if m['mat'] in (1, 2):
        uvc = m['uv'][m['idx']].mean(1)
        a = sample(ALPHA[m['mat']], uvc)
        mk[a < 160] = 'glass'
    tri_part.append(parts)
    tri_mat.append(mk)

# headlight / taillight glass and the speedo glass are their own lens materials
for m, parts, mk in zip(meshes, tri_part, tri_mat):
    for i in range(len(parts)):
        if mk[i] == 'glass' and (parts[i].startswith('headlight') or parts[i].startswith('taillight') or parts[i] == 'x_speedo'):
            mk[i] = 'lens'

# ------------------------------------------------------------------ assemble buffers per (part, mat)
groups = {}
for m, parts, mk in zip(meshes, tri_part, tri_mat):
    for key in set(zip(parts, mk)):
        sel = (parts == key[0]) & (mk == key[1])
        g = groups.setdefault(key, {'pos': [], 'nor': [], 'uv': [], 'idx': [], 'n': 0})
        t = m['idx'][sel]
        used, inv = np.unique(t, return_inverse=True)
        g['pos'].append(m['pos'][used])
        g['nor'].append(m['nor'][used])
        g['uv'].append(m['uv'][used])
        g['idx'].append(inv.reshape(-1, 3) + g['n'])
        g['n'] += len(used)

# ------------------------------------------------------------------ tyre
jt, bt = gltfio.load(SRC + '/right_tire_front.gltf')
tm = next(gltfio.mesh_instances(jt, bt))
tp = to_car(tm['pos'])
tn = np.stack([-tm['nor'][:, 0], tm['nor'][:, 1], -tm['nor'][:, 2]], 1)
tc = (tp.min(0) + tp.max(0)) / 2
# the tyre's axle is the axis of least extent
ext = tp.max(0) - tp.min(0)
tp = tp - tc
tyre = {'pos': tp, 'nor': tn, 'uv': tm['uv'], 'idx': tm['idx']}
tyre_radius = float(max(ext[1], ext[2]) / 2)
tyre_width = float(ext[0])
# outward face: the hubcap side has the dome; find which x side carries more vertices near the axis
r_ax = np.hypot(tp[:, 1], tp[:, 2])
hub = tp[r_ax < tyre_radius * 0.35]
outward = float(np.sign(hub[:, 0].mean() if len(hub) else -1))

# ------------------------------------------------------------------ GLB writer
bin_chunks = []
accessors, views, meshes_out, nodes = [], [], [], []
off = 0


def add_view(arr, target=None):
    global off
    b = arr.tobytes()
    pad = (-len(b)) % 4
    bin_chunks.append(b + b'\0' * pad)
    v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(b)}
    if target:
        v['target'] = target
    views.append(v)
    off += len(b) + pad
    return len(views) - 1


def add_acc(arr, typ, ctype=5126, target=34962, minmax=False):
    vi = add_view(arr, target)
    a = {'bufferView': vi, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
    if minmax:
        a['min'] = arr.min(0).astype(float).tolist()
        a['max'] = arr.max(0).astype(float).tolist()
    accessors.append(a)
    return len(accessors) - 1


MAT_NAMES = ['paint', 'trim', 'under', 'mech', 'glass', 'lens', 'tyre']
materials = [{'name': n} for n in MAT_NAMES]


def add_mesh(name, pos, nor, uv, idx, mat):
    pos = pos.astype(np.float32)
    nor = nor.astype(np.float32)
    uv = uv.astype(np.float32)
    ii = idx.astype(np.uint32 if pos.shape[0] > 65535 else np.uint16).reshape(-1)
    prim = {
        'attributes': {'POSITION': add_acc(pos, 'VEC3', minmax=True), 'NORMAL': add_acc(nor, 'VEC3'), 'TEXCOORD_0': add_acc(uv, 'VEC2')},
        'indices': add_acc(ii, 'SCALAR', 5125 if ii.dtype == np.uint32 else 5123, 34963),
        'material': MAT_NAMES.index(mat),
    }
    meshes_out.append({'name': name, 'primitives': [prim]})
    return len(meshes_out) - 1


part_nodes = {}
bbox = {}
tri_count = {}
for (part, mat), g in sorted(groups.items()):
    pos = np.concatenate(g['pos'])
    nor = np.concatenate(g['nor'])
    uv = np.concatenate(g['uv'])
    idx = np.concatenate(g['idx'])
    mi = add_mesh(part + ':' + mat, pos, nor, uv, idx, mat)
    nodes.append({'name': part + ':' + mat, 'mesh': mi})
    part_nodes.setdefault(part, []).append(len(nodes) - 1)
    b = bbox.setdefault(part, [pos.min(0), pos.max(0)])
    b[0] = np.minimum(b[0], pos.min(0))
    b[1] = np.maximum(b[1], pos.max(0))
    tri_count[part] = tri_count.get(part, 0) + len(idx)

ti = add_mesh('tyre:tyre', tyre['pos'], tyre['nor'], tyre['uv'], tyre['idx'], 'tyre')
nodes.append({'name': 'tyre:tyre', 'mesh': ti})
part_nodes['tyre'] = [len(nodes) - 1]

top = []
for part, kids in part_nodes.items():
    nodes.append({'name': part, 'children': kids})
    top.append(len(nodes) - 1)
binary = b''.join(bin_chunks)
gl = {
    'asset': {'version': '2.0', 'generator': 'route9 beetle import', 'copyright': 'Beetle/Fusca (Version 1) by soujagah, CC-BY-4.0'},
    'scene': 0,
    'scenes': [{'nodes': top}],
    'nodes': nodes,
    'meshes': meshes_out,
    'materials': materials,
    'accessors': accessors,
    'bufferViews': views,
    'buffers': [{'byteLength': len(binary)}],
}
js = json.dumps(gl, separators=(',', ':')).encode()
js += b' ' * ((-len(js)) % 4)
with open(OUT + '/beetle.glb', 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
    f.write(struct.pack('<II', len(binary), 0x004E4942) + binary)

# ------------------------------------------------------------------ textures
TEX_SIZES = {0: (2048, 1024, 1024), 1: (2048, 1024, 1024), 2: (1024, 1024, 1024), 3: (2048, 1024, 1024)}
names = {0: 'paint', 1: 'trim', 2: 'under', 3: 'mech'}
for k, (sc, sn, sm) in TEX_SIZES.items():
    col = tex_of(k, 'color').convert('RGBA')
    rgb = col.convert('RGB')
    rgb.resize((sc, sc), Image.LANCZOS).save(f'{OUT}/{names[k]}_color.webp', quality=88, method=6)
    tex_of(k, 'normal').convert('RGB').resize((sn, sn), Image.LANCZOS).save(f'{OUT}/{names[k]}_normal.webp', quality=90, method=6)
    tex_of(k, 'mr').convert('RGB').resize((sm, sm), Image.LANCZOS).save(f'{OUT}/{names[k]}_orm.webp', quality=88, method=6)

# paint masks: the teal paint (and on the body texture the white two-tone) become "paint";
# chrome (metallic), black rubber, the brown underside and the cloth headliner do not.
# G keeps the texel's brightness relative to its paint tone so baked shading survives a repaint.
from PIL import ImageDraw


def uv_polys(sel_mesh_tris, size):
    """UV-space polygons (pixel coords) of the given (mesh, triangle mask) pairs."""
    out = []
    for m, sel in sel_mesh_tris:
        uv = m['uv'][m['idx'][sel]]  # (n,3,2)
        base = np.floor(uv.mean(1, keepdims=True))
        uv = (uv - base) * size
        out.extend(uv.reshape(-1, 6).tolist())
    return out


def headliner_tris(m):
    if m['short'] != 'M1':
        return None
    P = m['pos'][m['idx']]
    c = P.mean(1)
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    if m['flip']:
        n = -n
    return (np.abs(c[:, 0]) < 0.6) & (c[:, 1] > 1.12) & (c[:, 2] > -1.05) & (c[:, 2] < 0.6) & (n[:, 1] < -0.2)


def make_mask(k, name, with_white):
    pc = np.asarray(tex_of(k, 'color').convert('RGB')).astype(np.float32) / 255
    mr = np.asarray(tex_of(k, 'mr').convert('RGB').resize((pc.shape[1], pc.shape[0]))).astype(np.float32) / 255
    r, g, b = pc[..., 0], pc[..., 1], pc[..., 2]
    mx = pc.max(-1)
    mn = pc.min(-1)
    sat = (mx - mn) / (mx + 1e-4)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    metal = mr[..., 2]
    teal = (b > r + 0.08) & (g > r + 0.05) & (sat > 0.2) & (metal < 0.5)
    white = (sat < 0.12) & (lum > 0.62) & (metal < 0.5) if with_white else np.zeros_like(teal)
    mask = teal | white
    # cloth headliner (inner roof faces) keeps its texture
    size = pc.shape[0]
    excl = Image.new('L', (size, size), 0)
    dr = ImageDraw.Draw(excl)
    for mm in meshes:
        if mm['mat'] != k:
            continue
        sel = headliner_tris(mm)
        if sel is None or not sel.any():
            continue
        for poly in uv_polys([(mm, sel)], size):
            dr.polygon([(poly[0], poly[1]), (poly[2], poly[3]), (poly[4], poly[5])], fill=255)
    ex = np.asarray(excl) > 0
    mask &= ~ex
    ref_teal = np.median(lum[teal]) if teal.any() else 0.4
    ref_white = np.median(lum[white]) if white.any() else 0.8
    shade = np.where(teal, lum / ref_teal, np.where(white, lum / ref_white, 1.0))
    out = np.zeros(pc.shape, np.uint8)
    out[..., 0] = (mask * 255).astype(np.uint8)
    out[..., 1] = np.clip(shade * 0.5 * 255, 0, 255).astype(np.uint8)
    out[..., 2] = (white & mask).astype(np.uint8) * 255  # the original two-tone (optional accent)
    Image.fromarray(out).resize((1024, 1024), Image.BILINEAR).save(f'{OUT}/{name}_mask.webp', lossless=True)
    print('mask', name, 'paint fraction', round(float(mask.mean()), 3), 'headliner px', int(ex.sum()))


make_mask(0, 'paint', True)
make_mask(1, 'trim', False)
make_mask(2, 'under', False)

# tyre textures
tmat = jt['materials'][tm['mat']]
for slot, key, size in (('color', 'baseColorTexture', 1024), ('normal', None, 1024), ('mr', 'metallicRoughnessTexture', 512)):
    if slot == 'normal':
        t = tmat['normalTexture']['index']
    else:
        t = tmat['pbrMetallicRoughness'][key]['index']
    im = Image.open(io.BytesIO(gltfio.image_bytes(jt, bt, jt['textures'][t]['source']))).convert('RGB')
    im.resize((size, size), Image.LANCZOS).save(f'{OUT}/tyre_{ {"color": "color", "normal": "normal", "mr": "orm"}[slot] }.webp', quality=88, method=6)

# ------------------------------------------------------------------ metadata
W, parent = gltfio.world_matrices(j)
def node_world(name):
    for i, n in enumerate(j['nodes']):
        if n.get('name') == name:
            return to_car(W[i][:3, 3][None])[0]
    return None


def pca_axis(P):
    c = P.mean(0)
    u, s, vt = np.linalg.svd(P - c)
    return c, vt[2]


meta = {'source': 'Beetle/Fusca (Version 1) by soujagah (sketchfab.com/soujagah), CC-BY-4.0', 'scale': S, 'zShift': ZC}
meta['parts'] = {p: {'min': bbox[p][0].round(4).tolist(), 'max': bbox[p][1].round(4).tolist(), 'tris': int(tri_count[p])} for p in bbox}
meta['hinges'] = {}
for nm, part in (('Door_L', 'door_FL'), ('Door_R', 'door_FR'), ('Front', 'trunk'), ('Rear', 'hood')):
    meta['hinges'][part] = node_world(nm).round(4).tolist()
fw = node_world('Wheel_F_L')
meta['wheel'] = {'radius': round(tyre_radius, 4), 'width': round(tyre_width, 4), 'outward': outward, 'front': fw.round(4).tolist()}
# rear axle from the rear fender arch: lowest-curvature fit of the arch edge is overkill; use the
# fender's wheel opening (inner vertices below the arch top) centre in z
rf = None
for m, parts in zip(meshes, tri_part):
    if m['short'] == 'M1':
        sel = parts == 'fender_RL'
        P = m['pos'][np.unique(m['idx'][sel])]
        rf = P
arch = rf[(rf[:, 1] < 0.75)]
zs = arch[:, 2]
meta['wheel']['rearZ'] = round(float((zs.min() + zs.max()) / 2), 4)
for m, parts in zip(meshes, tri_part):
    if m['short'] == 'M4':
        P = m['pos'][np.unique(m['idx'][parts == 'steeringWheel'])]
        c, ax = pca_axis(P)
        if ax[2] > 0:
            ax = -ax  # points from the hub toward the driver (rearward)
        meta['steeringWheel'] = {'center': c.round(4).tolist(), 'axis': ax.round(4).tolist(), 'radius': round(float(np.percentile(np.linalg.norm(P - c, axis=1), 98)), 4)}
        P = m['pos'][np.unique(m['idx'][parts == 'x_speedo'])]
        c, ax = pca_axis(P)
        if ax[2] > 0:
            ax = -ax
        meta['speedo'] = {'center': c.round(4).tolist(), 'normal': ax.round(4).tolist(), 'radius': round(float(np.percentile(np.linalg.norm(P - c, axis=1), 95)), 4)}
        stats = comp_stats(m)
        meta['dash'] = {}
        for nm, ci in (('radio', 46), ('glovebox', 2), ('mirror', 26)):
            meta['dash'][nm] = {'center': stats[ci]['c'].round(4).tolist(), 'size': stats[ci]['s'].round(4).tolist()}
        knobs = [stats[k]['c'].round(4).tolist() for k in (6, 22, 24, 37, 50)]
        meta['dash']['knobs'] = knobs
for m, parts in zip(meshes, tri_part):
    if m['short'] == 'M3':
        stats = comp_stats(m)
        meta['wipers'] = {'L': stats[74]['c'].round(4).tolist(), 'R': stats[50]['c'].round(4).tolist()}
for p in ('x_pedalGas', 'x_pedalBrake', 'x_pedalClutch', 'x_gearLever', 'x_handbrake', 'x_wiperL', 'x_wiperR'):
    meta.setdefault('controls', {})[p] = {'min': bbox[p][0].round(4).tolist(), 'max': bbox[p][1].round(4).tolist()}
total = sum(tri_count.values()) + len(tyre['idx']) * 4
meta['triangles'] = int(total)
json.dump(meta, open(META, 'w'), indent=1)
print('parts', len(bbox), 'groups', len(groups), 'tris (with 4 tyres)', total)
for p in sorted(bbox):
    print(f'  {p:16s} {tri_count[p]:6d} tris  min {bbox[p][0].round(2).tolist()} max {bbox[p][1].round(2).tolist()}')
print('tyre r', tyre_radius, 'w', tyre_width, 'outward', outward)
print('glb', os.path.getsize(OUT + '/beetle.glb') // 1024, 'KB')
