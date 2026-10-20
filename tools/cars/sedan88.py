# '88 American Sedan: "88 American Sedan - Low poly model" by Daniel Zhabotinsky, CC-BY-4.0.
# Source units are inches, length along -X (front), Y up, Z to the car's left.
import os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

SRC = os.environ.get('SEDAN88_SRC', '') + '/scene.gltf'
NAME = 'sedan88'
CREDIT = '"88 American Sedan - Low poly model" by Daniel Zhabotinsky (sketchfab.com/DanielZhabotinsky), CC-BY-4.0'
S = 0.0254
GROUND = -52.84
XMID = 0.02


def to_car(p):
    return np.stack([p[:, 2] * S, (p[:, 1] - GROUND) * S, -(p[:, 0] - XMID) * S], 1)


def to_car_dir(n):
    return np.stack([n[:, 2], n[:, 1], -n[:, 0]], 1)


SPLIT = set()
SPLIT = {'bottom_UCB_BOTTOM_0', 'Interior_GEN4DR_INTERIOR_0', 'Seats_GEN4DR_INTERIOR_0', 'Headlight_UCB_BOTTOM_0', 'Headlight_glass_Riverside88_Headlights_0', 'Turnsignals_glass_Riverside88_Headlights_0', 'Taillights_UCB_BOTTOM_0', 'Brakelights_glass_Riverside88_Headlights_0', 'ReverseLights_glass_Riverside88_Headlights_0'}

MATERIALS = {
    'Bodycolor': 'paint',
    'UCB_BOTTOM': 'under',
    'Riverside88_Headlights': 'lens',
    'RIMSTOCK_04': 'wheel',
    'UCB_GLASS': 'glass',
    'GEN4DR_INTERIOR': 'interior',
    'Numberplates': 'plate',
    'GENERIC_BADGES': 'badge',
}
# key: (source material, colour, normal, metal-roughness sizes)
TEXTURES = {
    'paint': ('Bodycolor', 0, 0, 0),
    'under': ('UCB_BOTTOM', 1024, 1024, 512),
    'lens': ('Riverside88_Headlights', 512, 512, 0),
    'wheel': ('RIMSTOCK_04', 512, 512, 512),
    'glass': ('UCB_GLASS', 64, 0, 0),
    'interior': ('GEN4DR_INTERIOR', 1024, 512, 512),
    'plate': ('Numberplates', 512, 0, 0),
    'badge': ('GENERIC_BADGES', 256, 0, 256),
}
ALPHA_KEYS = ('lens', 'glass')
# the unsteered rear left wheel becomes the one wheel model (hub at the origin, outer face +X)
TYRE = 'wheel_RL'

DIRECT = {
    'Body': 'body', 'Bumper_Front': 'bumper_F', 'Bumper_Front_inner': 'bumper_F', 'Numberplate_front': 'bumper_F',
    'Bumper_rear': 'bumper_R', 'Bumper_rear_inner': 'bumper_R', 'Numberplate_rear': 'bumper_R',
    'Hood': 'hood', 'Hood_inner': 'hood', 'Trunk_door': 'trunk', 'Trunk_door_inner': 'trunk', 'Trunk_door_badges': 'trunk',
    'Windshield': 'body', 'Rear_window': 'body', 'Fender_rear': 'body', 'Dashboard': 'body',
    'exhaust': 'exhaust', 'Suspension': 'chassis', 'Engine': 'engine', 'Steering_wheel': 'steeringWheel',
    'Wheel_FL': 'wheel_FL', 'Wheel_FR': 'wheel_FR', 'Wheel_RL': 'wheel_RL', 'Wheel_RR': 'wheel_RR',
}


def base_name(n):
    # 'Door_inner_FL_UCB_BOTTOM_0' -> 'Door_inner_FL'
    for mat in MATERIALS:
        if n.endswith('_' + mat + '_0'):
            return n[: -len(mat) - 3]
    return n


def classify(name, inf):
    b = base_name(name)
    c, mn, mx = inf['c'], inf['min'], inf['max']
    side = 'L' if c[0] > 0 else 'R'
    for k in ('FL', 'FR', 'RL', 'RR'):
        if b.endswith('_' + k) and (b.startswith('Door') or b.startswith('Doorcard')):
            return 'door_' + k
    if b in DIRECT:
        return DIRECT[b]
    if b in ('Headlight', 'Headlight_glass', 'Turnsignals_glass'):
        return 'headlight_' + side
    if b in ('Taillights', 'Brakelights_glass', 'ReverseLights_glass'):
        return 'taillight_' + side
    if b == 'Seats':
        # rear bench and its headrests sit behind z = -0.5; front headrests just behind the backs
        return 'seat_R' if c[2] < -0.5 else 'seat_F' + side
    if b == 'Interior':
        # three floor pedals in the driver's footwell
        if inf['tris'] == 22 and mn[1] < 0.35:
            return {0: 'x_pedalGas', 1: 'x_pedalBrake', 2: 'x_pedalClutch'}[int(round((c[0] - 0.24) / 0.095))]
        return 'body'
    if b == 'bottom':
        # floor pan, wheel wells and the two frame rails are the chassis; the rest is body
        if inf['tris'] in (958,) or (inf['tris'] == 110 and mx[1] < 0.5):
            return 'chassis'
        return 'body'
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
    if src == 'Riverside88_Headlights' and part.startswith('taillight'):
        return 'tail'
    return MATERIALS[src]
