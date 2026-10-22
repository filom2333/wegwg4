# 2007 C-class saloon (W203): "Mercedes-Benz C-class W203 2007" by szymonpasterczyk734 (Sketchfab),
# CC-BY-4.0, from the threed-garden npm package. The source is split into named parts (body,
# four doors, bonnet, boot lid, bumpers, wings, lamps, mirrors, steering wheel, pedals, rear
# suspension) but has no textures to speak of, no tyres and no engine: colours are set here, the
# tyre is turned on a lathe and the engine bay is filled in by the game (procParts).
# Run the source through scratchpad gt/w203conv.mjs first (spec-gloss -> metal-rough, lighter).
# Source units are metres, Y up, +Z forward, +X to the car's left; the wheel model sits at the
# origin, rim only.
import os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

SRC = os.environ.get('W203_SRC', '') + '/w203_mr.gltf'
NAME = 'w203'
CREDIT = '"Mercedes-Benz C-class W203 2007" by szymonpasterczyk734 (sketchfab.com/szymonpasterczyk734), CC-BY-4.0'
FRONT_Z, REAR_Z = 1.50, -1.35  # axle lines (wheel arch openings)
ZMID = (FRONT_Z + REAR_Z) / 2
HUB_Y = 0.35
TYRE_R, TYRE_W, RIM_R = 0.326, 0.205, 0.205
GROUND = HUB_Y - TYRE_R
RIM_CX = -0.0225  # the rim model's box centre across (outer face toward +X)
TRACK_HALF = 0.755


def to_car(p):
    return np.stack([p[:, 0], p[:, 1] - GROUND, p[:, 2] - ZMID], 1)


def to_car_dir(n):
    return n


# meshes whose pieces are sorted one by one (interior trim holds the seats, some panels sit under
# the wrong node in the source)
SPLIT = {'Salon-material', 'Gray2-material', 'Glass-material', 'midsize-material', 'Gray-material', 'Chrome-material'}

# mesh (= source material) -> material key
MESH_KEY = {
    'midsize-material': 'paint',
    'Gray-material': 'trim',
    'Setka-material': 'trim',
    'Chrome-material': 'chrome',
    'Mat_emperor_013-material': 'chrome',
    'Mat_emperor_104-material': 'chrome',
    'Mat_emperor_124-material': 'chrome',
    'Mat_emperor_151-material': 'chrome',
    'Salon-material': 'interior',
    'Gray2-material': 'cabin',
    'midsize_interior-material': 'cabin',
    'Priborka-material': 'dash',
    'Glass-material': 'glass',
    'Light-material': 'lens',
    'Fog-material': 'lens',
    'Fog1-material': 'lens',
    'Mat_emperor_101-material': 'lens',
    'Mat_emperor_102-material': 'lens',
    'Pov_R-material': 'amber',
    'Pov_L-material': 'amber',
    'Mat_emperor_123-material': 'amber',
    'Mat_emperor_150-material': 'amber',
    'LightZad-material': 'tail',
    'RedGlass-material': 'tail',
    'ZadHod-material': 'lens',
    'Wheel-material': 'rim',
}
MATERIALS = {}  # (keys come from MESH_KEY; see material_key)
# every key is flat colour: the importer only needs a source material to read
KEYS = sorted(set(MESH_KEY.values()) | {'under', 'tyre'})
TEXTURES = {k: ('Chrome', 0, 0, 0) for k in KEYS}
ALPHA_KEYS = ()
TYRE = 'wheel_RL'

OWNER = {
    'W203_body': 'body', 'W203_windshield': 'body', 'W203_backlight': 'body', 'W203_mirror_L': 'body', 'W203_mirror_R': 'body',
    'W203_door_FL': 'door_FL', 'W203_door_FR': 'door_FR', 'W203_door_RL': 'door_RL', 'W203_door_RR': 'door_RR',
    'W203_hood': 'hood', 'W203_trunk': 'trunk', 'W203_spoiler': 'trunk',
    'W203_bumper_F': 'bumper_F', 'W203_bumper_R': 'bumper_R',
    'W203_fender_L': 'fender_FL', 'W203_fender_R': 'fender_FR',
    'W203_headlight_L': 'headlight_L', 'W203_headlight_R': 'headlight_R',
    'W203_taillight_L': 'taillight_L', 'W203_taillight_R': 'taillight_R',
    'W203_taillightcover_L': 'taillight_L', 'W203_taillightcover_R': 'taillight_R',
    'W203_steer': 'steeringWheel',
    'W203_gaspedal': 'x_pedalGas', 'W203_brakepedal': 'x_pedalBrake', 'W203_clutchpedal': 'x_pedalClutch',
    'W203_subframe_F': 'chassis', 'W203_subframe_R': 'chassis', 'W203_trailingarm_R': 'chassis', 'W203_lowerarm_R': 'chassis',
    'W203_hub_R': 'chassis', 'W203_swaybar_R': 'chassis', 'W203_strut_R': 'chassis', 'W203_wires_R': 'chassis',
    'calm': 'wheel_RL',
}
# dropped: the misplaced headlamp glass (it floats above the bonnet in the source), the
# game's own dial needle, and another car's badges
DROP = {'W203_headlightglass_L', 'W203_headlightglass_R', 'W203_needle_speedo', 'W203_lettering_ibishu', 'W203_lettering_pessima'}


def owner_of(path):
    for x in path:
        if x.startswith('W203_') or x == 'calm':
            return x
    return None


def classify(name, inf):
    inf['mesh'] = name
    o = owner_of(inf['path'])
    if o in DROP or name == 'midsize_lettering-material':
        return None
    c, mn, mx, s = inf['c'], inf['min'], inf['max'], inf['s']
    side = 'L' if c[0] > 0 else 'R'
    # door glass: one node in the source holds a pane of each side
    if o and o.startswith('W203_doorglass_'):
        return 'door_' + o[-2] + side
    # the right wing node also carries pieces from elsewhere on the body
    if o == 'W203_fender_R':
        return 'fender_FR' if c[0] < -0.6 and c[2] > 0.7 else 'body'
    # seats inside the cabin trim (front: cushion, back, headrest and side mouldings)
    if o == 'W203_body' and name in ('Salon-material', 'Gray2-material'):
        if -0.5 < mn[2] and mx[2] < 0.45 and mx[1] < 1.26 and 0.08 < abs(c[0]) < 0.68 and s[0] < 0.62 and mn[1] > 0.3:
            return 'seat_F' + side
        if mx[2] < -1.15 and mn[1] > 0.95 and mx[1] < 1.06:
            return 'seat_R'
    # the engine's plastic shroud (star, ridges, throttle body) and the trim ahead of it: one part
    # that comes off to get at the coils and the front of the engine
    if o == 'W203_body' and abs(c[0]) < 0.36 and 0.6 < c[1] < 0.92 and 1.03 < c[2] < 1.66 and s[0] < 0.7 and s[2] < 0.45:
        return 'enginecover'
    part = OWNER.get(o, 'body')
    return part


def material_key(src, part, inf):
    key = MESH_KEY.get(inf.get('mesh'), 'trim')
    if part == 'chassis':
        return 'under'
    # the instrument cluster's own backlight pieces: dark glass, not lamp lenses
    if part == 'body' and key in ('lens', 'amber'):
        return 'dash'
    return key


# ------------------------------------------------------------------ made here
def lathe(profile, seg, cx):
    """Surface of revolution about the X axis: profile [(x, r)], seg segments; returns pos, nor, uv, idx."""
    pr = np.array(profile, float)
    n = len(pr)
    a = np.linspace(0, 2 * np.pi, seg + 1)
    pos = np.zeros(((seg + 1) * n, 3))
    uv = np.zeros(((seg + 1) * n, 2))
    for i, t in enumerate(a):
        pos[i * n:(i + 1) * n, 0] = pr[:, 0] + cx
        pos[i * n:(i + 1) * n, 1] = pr[:, 1] * np.cos(t)
        pos[i * n:(i + 1) * n, 2] = pr[:, 1] * np.sin(t)
        uv[i * n:(i + 1) * n, 0] = t / (2 * np.pi) * 8
        uv[i * n:(i + 1) * n, 1] = np.linspace(0, 1, n)
    idx = []
    for i in range(seg):
        for k in range(n - 1):
            p0, p1 = i * n + k, i * n + k + 1
            q0, q1 = p0 + n, p1 + n
            idx += [[p0, q0, p1], [p1, q0, q1]]
    idx = np.array(idx, np.int64)
    # vertex normals from the faces
    nor = np.zeros_like(pos)
    f = np.cross(pos[idx[:, 1]] - pos[idx[:, 0]], pos[idx[:, 2]] - pos[idx[:, 0]])
    for c in range(3):
        np.add.at(nor, idx[:, c], f)
    nor /= np.linalg.norm(nor, axis=1, keepdims=True) + 1e-12
    # face outward: the middle of the tread must point away from the axle
    mid = (seg // 4) * n + n // 2
    if nor[mid, 1] * pos[mid, 1] + nor[mid, 2] * pos[mid, 2] < 0:
        idx = idx[:, ::-1].copy()
        nor = -nor
    return pos, nor, uv, idx


def add(groups, part, key, pos, nor, uv, idx):
    g = groups.setdefault((part, key), {'pos': [], 'nor': [], 'uv': [], 'idx': [], 'n': 0})
    g['pos'].append(pos)
    g['nor'].append(nor)
    g['uv'].append(uv)
    g['idx'].append(idx + g['n'])
    g['n'] += len(pos)


def extra(groups):
    # 205/60 R16: bead on the rim, a rounded sidewall, a flat tread with squared shoulders
    hw = TYRE_W / 2
    prof = [(-hw * 0.82, RIM_R - 0.004), (-hw * 0.96, RIM_R + 0.02), (-hw, RIM_R + 0.06), (-hw * 0.98, TYRE_R - 0.03), (-hw * 0.9, TYRE_R - 0.008), (-hw * 0.7, TYRE_R),
            (0, TYRE_R + 0.002), (hw * 0.7, TYRE_R), (hw * 0.9, TYRE_R - 0.008), (hw * 0.98, TYRE_R - 0.03), (hw, RIM_R + 0.06), (hw * 0.96, RIM_R + 0.02), (hw * 0.82, RIM_R - 0.004)]
    pos, nor, uv, idx = lathe(prof, 56, RIM_CX)
    add(groups, 'wheel_RL', 'tyre', pos, nor, uv, idx)
    # exhaust: down-pipe along the tunnel, a centre box, the rear silencer, one tailpipe on the right
    pieces = []
    def tube(z0, z1, x, y, r, seg=12):
        p, n, u, i = lathe([(z0, r), (z1, r)], seg, 0)
        # lathe runs along X: turn it to run along Z
        p = np.stack([p[:, 1] + x, p[:, 2] + y, p[:, 0]], 1)
        n = np.stack([n[:, 1], n[:, 2], n[:, 0]], 1)
        pieces.append((p, n, u, i))
    def box(x0, x1, y0, y1, z0, z1):
        P = np.array([[x, y, z] for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], float)
        F = [(0, 1, 3, 2, (-1, 0, 0)), (4, 6, 7, 5, (1, 0, 0)), (0, 4, 5, 1, (0, -1, 0)), (2, 3, 7, 6, (0, 1, 0)), (0, 2, 6, 4, (0, 0, -1)), (1, 5, 7, 3, (0, 0, 1))]
        pos, nor, uv, idx = [], [], [], []
        for a, b, c, d, nn in F:
            k = len(pos)
            pos += [P[a], P[b], P[c], P[d]]
            nor += [nn] * 4
            uv += [(0, 0), (1, 0), (1, 1), (0, 1)]
            idx += [[k, k + 1, k + 2], [k, k + 2, k + 3]]
        pieces.append((np.array(pos), np.array(nor, float), np.array(uv, float), np.array(idx)))
    zc = lambda z: z - ZMID
    yc = lambda y: y - GROUND
    tube(zc(1.2), zc(-0.2), -0.06, yc(0.2), 0.026)
    box(-0.16, 0.04, yc(0.15), yc(0.26), zc(-0.2), zc(-0.75))
    tube(zc(-0.75), zc(-1.75), -0.1, yc(0.21), 0.024)
    box(-0.62, -0.08, yc(0.2), yc(0.38), zc(-1.75), zc(-2.15))
    tube(zc(-2.15), zc(-2.4), -0.48, yc(0.26), 0.032)
    for p in pieces:
        add(groups, 'exhaust', 'under', *p)


# flat colours per key (no source textures): colour, metalness, roughness
COLOURS = {
    'paint': ([0.8, 0.8, 0.8, 1], 0.4, 0.35),
    'trim': ([0.035, 0.035, 0.037, 1], 0.0, 0.62),
    'chrome': ([0.78, 0.79, 0.8, 1], 1.0, 0.22),
    'interior': ([0.33, 0.31, 0.29, 1], 0.0, 0.92),
    'cabin': ([0.085, 0.085, 0.09, 1], 0.0, 0.7),
    'dash': ([0.05, 0.05, 0.055, 1], 0.0, 0.5),
    'glass': ([0.6, 0.65, 0.68, 0.3], 0.0, 0.05),
    'lens': ([0.92, 0.93, 0.95, 0.55], 0.1, 0.05),
    'amber': ([0.95, 0.5, 0.08, 1], 0.0, 0.25),
    'tail': ([0.55, 0.04, 0.03, 1], 0.0, 0.2),
    'rim': ([0.68, 0.69, 0.7, 1], 1.0, 0.3),
    'tyre': ([0.045, 0.045, 0.045, 1], 0.0, 0.88),
    'under': ([0.11, 0.105, 0.1, 1], 0.6, 0.7),
}


def finish(meta, parts, geo):
    for k, (c, m, r) in COLOURS.items():
        if k in meta['materials']:
            meta['materials'][k] = {'color': c, 'metalness': m, 'roughness': r}
    def box(p):
        return parts[p]
    H = {}
    for d in ('door_FL', 'door_FR', 'door_RL', 'door_RR'):
        mn, mx = box(d)
        x = mx[0] - 0.05 if d[-1] == 'L' else mn[0] + 0.05
        H[d] = [round(float(x), 4), round(float((mn[1] + mx[1]) / 2), 4), round(float(mx[2] - 0.04), 4)]
    mn, mx = box('hood')
    H['hood'] = [0.0, round(float(mx[1] - 0.02), 4), round(float(mn[2] + 0.03), 4)]
    mn, mx = box('trunk')
    H['trunk'] = [0.0, round(float(mx[1] - 0.02), 4), round(float(mx[2] - 0.03), 4)]
    meta['hinges'] = H
    mn, mx = box('exhaust')
    meta['exhaust'] = [-0.48, round(float(GROUND * 0 + 0.26 - GROUND), 4), round(float(mn[2]), 4)]
    meta['controls'] = {p: {'min': box(p)[0].round(4).tolist(), 'max': box(p)[1].round(4).tolist()} for p in parts if p.startswith('x_')}
    # four wheels at the hubs (the source has one wheel at the origin)
    zf, zr = FRONT_Z - ZMID, REAR_Z - ZMID
    y = HUB_Y - GROUND
    meta['wheel'] = {'radius': TYRE_R, 'width': round(TYRE_W + 0.02, 4), 'centers': {
        'wheel_FL': [TRACK_HALF, y, zf], 'wheel_FR': [-TRACK_HALF, y, zf], 'wheel_RL': [TRACK_HALF, y, zr], 'wheel_RR': [-TRACK_HALF, y, zr]}}
    meta['parts'].pop('wheel_RL', None)
