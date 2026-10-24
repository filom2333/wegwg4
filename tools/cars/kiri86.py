# '86 Kiri: "Kiri '86 - Low poly model" by Daniel Zhabotinsky, CC-BY-4.0 (sketchfab.com,
# uid 5c17c582ef9549798f694b660feea42a), a mid-80s Japanese family saloon. The same author and
# build as the '88 sedan: every door with its card and glass, bonnet, boot lid, wings and bumpers
# apart, an engine in the bay and a whole cabin. The source glb is the one Sketchfab made from the
# author's upload (KIRI86_SRC: the folder that holds kiri86.glb).
# Source units are inches, length along -X (front), Y up, Z to the car's left.
import os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

SRC = os.environ.get('KIRI86_SRC', '') + '/kiri86.glb'
NAME = 'kiri86'
CREDIT = '"Kiri \'86 - Low poly model" by Daniel Zhabotinsky (sketchfab.com/DanielZhabotinsky), CC-BY-4.0'
S = 0.0254
GROUND = -52.0
XMID = -7.4  # half way between the axles


def to_car(p):
    return np.stack([p[:, 2] * S, (p[:, 1] - GROUND) * S, -(p[:, 0] - XMID) * S], 1)


def to_car_dir(n):
    return np.stack([n[:, 2], n[:, 1], -n[:, 0]], 1)


# meshes holding pieces of more than one part (both sides' lamps, every seat, the floor pan)
SPLIT = {
    'bottom_UCB_BOTTOM_0', 'Interior_GEN4DR_INTERIOR_0', 'Seats_GEN4DR_INTERIOR_0', 'Taillights_UCB_BOTTOM_0', 'Healights_UCB_BOTTOM_0',
    'Headlights_glass_krmlgtbdy85_headlights_0', 'Turnsignals_Glass_Front_krmlgtbdy85_headlights_0', 'Brakelights_glass_krmlgtbdy85_headlights_0',
    'Turnsignals_Rear_glass_krmlgtbdy85_headlights_0', 'Fenders_front_Bodycolor_0', 'Fenders_Front_inner_UCB_BOTTOM_0', 'Engine_Material #26_0',
}

MATERIALS = {
    'Bodycolor': 'paint',
    'UCB_BOTTOM': 'under',
    'krmlgtbdy85_headlights': 'lens',
    'RIMSTOCK_02_1': 'wheel',
    'UCB_GLASS_CLEAN': 'glass',
    'GEN4DR_INTERIOR': 'interior',
    'Numberplates_dif': 'plate',
    'GENERIC_BADGES': 'badge',
    'Material #26': 'motor',
    'Material_26': 'motor',
}
# key: (source material, colour, normal, metal-roughness sizes)
TEXTURES = {
    'paint': ('Bodycolor', 0, 0, 0),
    'under': ('UCB_BOTTOM', 1024, 1024, 512),
    'lens': ('krmlgtbdy85_headlights', 512, 0, 0),
    'wheel': ('RIMSTOCK_02_1', 512, 512, 512),
    'glass': ('UCB_GLASS_CLEAN', 64, 0, 0),
    'interior': ('GEN4DR_INTERIOR', 1024, 512, 512),
    'plate': ('Numberplates_dif', 512, 0, 0),
    'badge': ('GENERIC_BADGES', 256, 0, 256),
    'motor': ('Material_26', 1024, 512, 512),
}
ALPHA_KEYS = ('lens', 'glass')
# the unsteered rear left wheel becomes the one wheel model (hub at the origin, outer face +X)
TYRE = 'wheel_RL'

DIRECT = {
    'Body': 'body', 'Body_badge': 'body', 'Roof_window': 'body', 'Windshield': 'body', 'Rear_window': 'body', 'Stoplight_Glass': 'body',
    'Grill_badge': 'body', 'Dashboard': 'body', 'Numberplate_rear': 'body',
    'Bumper_front': 'bumper_F', 'Bumper_Front_Inner': 'bumper_F', 'Numberplate_front': 'bumper_F', 'Turnsignals_glass_Bumper_F': 'bumper_F',
    'Bumper_rear': 'bumper_R', 'bumper_rear_inner': 'bumper_R',
    'Hood': 'hood', 'Hood_inner': 'hood', 'Trunk_door': 'trunk', 'Trunk_door_inner': 'trunk',
    'Sidemirror_Left': 'door_FL', 'Sidemirror_Right': 'door_FR',
    'Exhausts': 'exhaust', 'Suspension_front': 'chassis', 'Suspension_rear': 'chassis', 'Engine': 'engine', 'Steering_wheel': 'steeringWheel',
    'Wheel_FL': 'wheel_FL', 'Wheel_FR': 'wheel_FR', 'Wheel_RL': 'wheel_RL', 'Wheel_RR': 'wheel_RR',
}


def base_name(n):
    # 'Door_inner_FL_UCB_BOTTOM_0' -> 'Door_inner_FL'
    for mat in list(MATERIALS) + ['krmlgtbdy85_headlights']:
        if n.endswith('_' + mat + '_0'):
            return n[: -len(mat) - 3]
    return n


DEBUG = os.environ.get('CAR_DEBUG')


def classify(name, inf):
    b = base_name(name)
    c, mn, mx = inf['c'], inf['min'], inf['max']
    side = 'L' if c[0] > 0 else 'R'
    if DEBUG and name in SPLIT and b in ('bottom', 'Interior', 'Seats', 'Engine'):
        print(f"  {b:9s} comp {inf['comp']:3d} tris {inf['tris']:5d} c {np.round(c, 2).tolist()} s {np.round(inf['s'], 2).tolist()}")
    for k in ('FL', 'FR', 'RL', 'RR'):
        if b.lower().endswith('_' + k.lower()) and (b.lower().startswith('door') or b.lower().startswith('glass_door') or b.lower().startswith('doorcard')):
            return 'door_' + k
    if b == 'Engine':
        return engine_of(inf)
    if b in DIRECT:
        return DIRECT[b]
    if b in ('Healights', 'Headlights_glass', 'Turnsignals_Glass_Front'):
        return 'headlight_' + side
    if b in ('Taillights', 'Brakelights_glass', 'Turnsignals_Rear_glass'):
        return 'taillight_' + side
    if b in ('Fenders_front', 'Fenders_Front_inner'):
        return 'fender_F' + side
    if b == 'Seats':
        return seat_of(inf)
    if b == 'Interior':
        return interior_of(inf)
    if b == 'bottom':
        return bottom_of(inf)
    return 'body'


def seat_of(inf):
    c = inf['c']
    # the rear bench (cushion, back and headrests) behind the front seats' backs
    if c[2] < REAR_SEAT_Z:
        return 'seat_R'
    return 'seat_F' + ('L' if c[0] > 0 else 'R')


REAR_SEAT_Z = -0.45


def interior_of(inf):
    c, s = inf['c'], inf['s']
    # three floor pedals in the driver's footwell, accelerator nearest the tunnel
    if inf['tris'] == 22 and c[1] < 0.45 and c[0] > 0.15:
        return {0: 'x_pedalGas', 1: 'x_pedalBrake', 2: 'x_pedalClutch'}[int(round((c[0] - 0.24) / 0.08))]
    # the gear lever (stick and knob) standing out of its boot on the tunnel
    if abs(c[0]) < 0.12 and 0.45 < c[1] < 0.65 and s[1] > 0.12 and s[0] < 0.08:
        return 'x_gearLever'
    return 'body'


def engine_of(inf):
    c = inf['c']
    # the battery (case, lid and terminals) on the right of the bay and the air box with its
    # cover on the left, ahead of the block: parts of their own
    if c[0] < -0.28 and c[2] > 1.5:
        return 'battery'
    if c[0] > 0.3 and c[2] > 1.45:
        return 'airfilter'
    return 'engine'


def bottom_of(inf):
    c, s = inf['c'], inf['s']
    # the floor pan's rails, low and the length of the car: the chassis; the rest is the shell
    if c[1] < 0.45 and s[2] > 3.0:
        return 'chassis'
    return 'body'


def finish(meta, parts, geo):
    def box(p):
        return parts[p]

    H = {}
    for d in ('door_FL', 'door_FR', 'door_RL', 'door_RR'):
        mn, mx = box(d)
        x = mx[0] - 0.04 if d[-1] == 'L' else mn[0] + 0.04
        H[d] = [round(float(x), 4), round(float((mn[1] + mx[1]) / 2), 4), round(float(mx[2] - 0.03), 4)]
    mn, mx = box('hood')
    H['hood'] = [0.0, round(float(mx[1] - 0.02), 4), round(float(mn[2] + 0.02), 4)]
    mn, mx = box('trunk')
    H['trunk'] = [0.0, round(float(mx[1] - 0.02), 4), round(float(mx[2] - 0.02), 4)]
    meta['hinges'] = H
    mn, mx = box('exhaust')
    meta['exhaust'] = [round(float((mn[0] + mx[0]) / 2), 4), round(float(mn[1] + 0.04), 4), round(float(mn[2]), 4)]
    meta['controls'] = {p: {'min': box(p)[0].round(4).tolist(), 'max': box(p)[1].round(4).tolist()} for p in parts if p.startswith('x_')}


# tail lamp lenses share the lamp texture but glow red on their own
ALIASES = {'tail': 'lens'}


def material_key(src, part, inf):
    if src == 'krmlgtbdy85_headlights' and part.startswith('taillight'):
        return 'tail'
    return MATERIALS[src]
