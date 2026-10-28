# The buildings of the places, modelled: houses (sided, brick, stucco, adobe), garages and the
# rest as they come, each variant from seeded choices on the floor plan of the browser version
# (web/src/world/buildings/house.js) but built as a real one is: lapped siding boards, corner
# boards, windows with casings, sills, drip caps and double-hung sashes, panelled doors on their
# hinges, floors and baseboards, a crawlspace foundation with vents, steps, a porch, rafters
# with fascia and soffits under rows of shingles, gutters and downspouts, chimney and vent pipe.
# Materials are named by the game's tokens (BuildingMaterials.cs) and UVs are in metres.
#
#   blender -b --factory-startup --python tools/blender/buildings.py -- <out dir> [name...]
#
# Writes <out>/<name>.glb (objects: "shell" everything fixed, "glass" the panes, "door_<i>" each
# door leaf with its origin on the hinge) and <out>/<name>.json (colliders, doors, lights, rooms,
# footprint), which PlaceStreamer.cs reads.

import bpy
import json
import math
import os
import random
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from buildkit import Part, V, at, rot_x, rot_y, rot_z  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402


def half(v):
    return round(v * 2) / 2


class Out:
    """What a building is made of: its parts (shell, glass, door leaves) and what the game needs
    to know about it."""

    def __init__(self, name):
        self.name = name
        self.shell = Part("shell")
        self.glass = Part("glass")
        self.doors = []  # (Part relative to the hinge, info)
        self.colliders = []
        self.lights = []
        self.rooms = []
        self.footprint = (10, 10)
        self.floor_y = 0.0
        self.car_spot = None

    def col(self, c, size, rot_y_=0.0, rot_x_=0.0, surface="wood"):
        self.colliders.append({"c": [round(c[0], 4), round(c[1], 4), round(c[2], 4)], "h": [round(size[0] / 2, 4), round(size[1] / 2, 4), round(size[2] / 2, 4)], "ry": round(rot_y_, 5), "rx": round(rot_x_, 5), "s": surface})


# ------------------------------------------------------------------------------ the house

WALL_H = 2.75
CORE_T = 0.2     # the framed wall, sheathing to drywall
CLAD = 0.03      # siding standing out from the sheathing
INT_T = 0.12
COURSE = 0.165   # siding exposure
# the shingle scan (grey_roof_01 laid at 4 m) has 27 courses a repeat, their lower edges 7 px
# down each 37.9 px: rows of that exposure with their edge there (in the game's V, 1 - Blender's)
SHINGLE_M = 4.0
SHINGLE_EXP = SHINGLE_M / 27
SHINGLE_EDGE = 1 - SHINGLE_M * 7 / 1024


def plan_house(r):
    """Rooms of a one-storey family house: the front with the living room (and the way in) and
    the kitchen, the back with one or two bedrooms and the bathroom. +z is the front."""
    W = half(10.5 + r.random() * 4)
    D = half(8.5 + r.random() * 3)
    x0, x1, z0, z1 = -W / 2, W / 2, -D / 2, D / 2
    front_d = half(D * (0.5 + r.random() * 0.12))
    zmid = z1 - front_d
    rooms = []
    living_w = half(W * (0.55 + r.random() * 0.1))
    if r.random() < 0.5:
        rooms += [dict(type="living", x0=x0, z0=zmid, x1=x0 + living_w, z1=z1), dict(type="kitchen", x0=x0 + living_w, z0=zmid, x1=x1, z1=z1)]
    else:
        rooms += [dict(type="kitchen", x0=x0, z0=zmid, x1=x1 - living_w, z1=z1), dict(type="living", x0=x1 - living_w, z0=zmid, x1=x1, z1=z1)]
    bath_w = 2.2 + r.random() * 0.4
    rest = W - bath_w
    back = []
    bath_left = r.random() < 0.5
    if bath_left:
        back.append(("bath", bath_w))
    if rest > 7:
        b1 = half(rest / 2)
        back += [("bedroom", b1), ("bedroom", rest - b1)]
    else:
        back.append(("bedroom", rest))
    if not bath_left:
        back.append(("bath", bath_w))
    bx = x0
    for t, w in back:
        rooms.append(dict(type=t, x0=bx, z0=z0, x1=bx + w, z1=zmid))
        bx += w
    rooms[-1]["x1"] = x1
    return dict(W=W, D=D, x0=x0, x1=x1, z0=z0, z1=z1, zmid=zmid, rooms=rooms)


STYLES = {
    # cladding, roof, trim, roof type, foundation
    "siding": dict(ext="siding", roof="shingles", trim="trimWhite", roof_type="gable", crawl=True),
    "sidingYellow": dict(ext="sidingYellow", roof="shingles", trim="trimWhite", roof_type="gable", crawl=True),
    "sidingGreen": dict(ext="sidingGreen", roof="shingles", trim="trimWhite", roof_type="gable", crawl=True),
    "brick": dict(ext="brick", roof="shingles", trim="trimWhite", roof_type="gable", crawl=True),
    "stucco": dict(ext="stucco", roof="rooftiles", trim="woodDark", roof_type="gable", crawl=False),
    "stuccoFlat": dict(ext="stuccoPink", roof="concrete", trim="woodDark", roof_type="flat", crawl=False),
    "adobe": dict(ext="adobe", roof="concrete", trim="woodDark", roof_type="flat", crawl=False),
}


class Wall:
    """A straight wall from a to b ([x, z]) in the house's frame, its outside to the left of
    a->b. m(s, y, off): a frame at s along it, height y, `off` out from its centre line, with x
    along the wall and z pointing out."""

    def __init__(self, a, b):
        self.a = V(a[0], 0, a[1])
        self.b = V(b[0], 0, b[1])
        d = self.b - self.a
        self.L = d.length
        self.u = d / self.L
        self.n = V(-self.u.z, 0, self.u.x)
        self.rot = math.atan2(-self.u.z, self.u.x)

    def m(self, s, y, off=0.0):
        p = self.a + self.u * s + self.n * off
        return at(p.x, y, p.z) @ rot_y(self.rot)

    def p(self, s, off=0.0):
        return self.a + self.u * s + self.n * off


def facing(n):
    """A rotation taking +y to the direction n."""
    return V(0, 1, 0).rotation_difference(Vector(n).normalized()).to_matrix().to_4x4()


def pieces(s_min, s_max, h, openings):
    """The solid parts of a wall from s_min to s_max and h high round its openings."""
    out, s = [], s_min
    for o in sorted(openings, key=lambda o: o["at"]):
        s0, s1 = o["at"] - o["w"] / 2, o["at"] + o["w"] / 2
        if s0 > s + 1e-3:
            out.append((s, s0, 0, h))
        if o["bottom"] > 1e-3:
            out.append((s0, s1, 0, o["bottom"]))
        if o["top"] < h - 1e-3:
            out.append((s0, s1, o["top"], h))
        s = s1
    if s < s_max - 1e-3:
        out.append((s, s_max, 0, h))
    return out


def free_spans(s_min, s_max, y0, y1, openings, pad):
    """Stretches from s_min to s_max clear of the openings that reach into heights y0..y1."""
    cuts = sorted((o["at"] - o["w"] / 2 - pad, o["at"] + o["w"] / 2 + pad) for o in openings if o["bottom"] < y1 and o["top"] > y0)
    spans, s = [], s_min
    for c0, c1 in cuts:
        if c0 > s + 0.02:
            spans.append((s, min(c0, s_max)))
        s = max(s, c1)
    if s < s_max - 0.02:
        spans.append((s, s_max))
    return [(a, b) for a, b in spans if b - a > 0.02]


def wall_core(o, w, y, h, t, openings, out_mat, in_mat, s_min=0.0, s_max=None, collide=True):
    """The wall itself round its openings: out_mat on the outside face, in_mat inside and on the
    faces round the openings (the liners and casings cover those)."""
    s_max = w.L if s_max is None else s_max
    for s0, s1, y0, y1 in pieces(s_min, s_max, h, openings):
        cs, ln, hh = (s0 + s1) / 2, s1 - s0, y1 - y0
        o.shell.box(None, w.m(cs, y + (y0 + y1) / 2), ln, hh, t, mats=[in_mat, in_mat, in_mat, in_mat, out_mat, in_mat])
        if collide:
            p = w.p(cs)
            o.col((p.x, y + (y0 + y1) / 2, p.z), (ln, hh, t), w.rot)


def siding(o, w, y, h, openings, mat, s_min, s_max, slope=None):
    """Lapped boards up the outside of a wall, round its openings and clear of their casings,
    each course standing out at its foot over the one below. slope: (s at the peak, rise per
    metre, height at the peak) cuts the courses under a gable's roof line."""
    yy = 0.0
    while yy < h - 0.02:
        yb, yt = yy, min(yy + COURSE + 0.025, h)
        for s0, s1 in free_spans(s_min, s_max, yb, yt, openings, 0.1):
            if slope is not None:
                peak, k, top = slope
                lim = top - yt
                if lim <= 0:
                    continue
                s0, s1 = max(s0, peak - lim / k), min(s1, peak + lim / k)
                if s1 - s0 < 0.05:
                    continue
            bh = yt - yb
            m = w.m((s0 + s1) / 2, y + yb + bh / 2, CORE_T / 2 + 0.019) @ rot_x(-math.atan2(0.012, bh))
            # (its top lies under the next course and its back on the wall: neither is drawn)
            o.shell.box(mat, m, s1 - s0, bh, 0.014, frame=(V(1, 0, 0), V(0, 1, 0)), skip=(2, 5))
        yy += COURSE


def window(o, w, y, op, r, trim, broken=0.0, boarded=False, clad=True, mullions=True):
    """A double-hung window in an opening: liners through the wall; outside a casing, a sloped
    sill with its nose, a drip cap; two sashes with their glass; inside a casing, the stool and
    the apron."""
    s, wd, b, t = op["at"], op["w"], op["bottom"], op["top"]
    hgt = t - b
    cy = y + (b + t) / 2
    out_face = CORE_T / 2 + (CLAD if clad else 0.0)
    in_face = -CORE_T / 2
    depth, mid = out_face - in_face, (out_face + in_face) / 2
    lt = 0.02
    o.shell.box(trim, w.m(s, y + b + lt / 2, mid), wd, lt, depth)
    o.shell.box(trim, w.m(s, y + t - lt / 2, mid), wd, lt, depth)
    for sg in (-1, 1):
        o.shell.box(trim, w.m(s + sg * (wd / 2 - lt / 2), cy, mid), lt, hgt - 2 * lt, depth)
    # outside
    cw, ct = 0.09, 0.025
    zc = out_face + ct / 2
    o.shell.box(trim, w.m(s, y + t + cw / 2, zc), wd + cw * 2, cw, ct, bevel=0.004, skip=(5,))
    o.shell.box(trim, w.m(s, y + t + cw + 0.015, out_face + 0.035), wd + cw * 2 + 0.05, 0.03, 0.07, bevel=0.006)
    for sg in (-1, 1):
        o.shell.box(trim, w.m(s + sg * (wd / 2 + cw / 2), cy, zc), cw, hgt, ct, bevel=0.004, skip=(5,))
    o.shell.box(trim, w.m(s, y + b - 0.022, out_face + 0.035) @ rot_x(0.12), wd + cw * 2 + 0.08, 0.045, 0.1, bevel=0.006)
    if boarded:
        for k in range(4):
            yy = b + 0.15 + k * (hgt - 0.15) / 4
            m = w.m(s + (r.random() - 0.5) * 0.05, y + yy, out_face + ct + 0.013) @ rot_z((r.random() - 0.5) * 0.12)
            o.shell.box("wood", m, wd + cw * 2 + r.random() * 0.12, 0.15 + r.random() * 0.04, 0.022, bevel=0.004)
    # the sashes: the upper outside, the lower inside it, overlapping at the meeting rails
    fw, sd = 0.055, 0.035
    sh = hgt / 2 + 0.02 - lt
    for upper in (1, 0):
        sy = y + b + lt + (hgt - 2 * lt) * (0.75 if upper else 0.25)
        zo = out_face - 0.06 - (0 if upper else sd + 0.004)
        m0 = w.m(s, sy, zo)
        iw = wd - 2 * lt
        for sg in (-1, 1):
            o.shell.box(trim, m0 @ at(sg * (iw / 2 - fw / 2), 0, 0), fw, sh, sd)
        o.shell.box(trim, m0 @ at(0, sh / 2 - fw / 2, 0), iw - 2 * fw, fw, sd)
        o.shell.box(trim, m0 @ at(0, -sh / 2 + (fw + 0.015) / 2, 0), iw - 2 * fw, fw + 0.015, sd)
        gw, gh = iw - fw * 2, sh - fw * 2 - 0.015
        gy = 0.0075
        if mullions:
            o.shell.box(trim, m0 @ at(0, gy, 0), 0.022, gh, sd * 0.6)
        if r.random() >= broken:
            o.glass.box("glassDirty" if r.random() < 0.4 else "glass", m0 @ at(0, gy, 0), gw, gh, 0.004)
    # inside
    zi = in_face - 0.01
    o.shell.box("trimWhite", w.m(s, y + t + 0.035, zi), wd + 0.14, 0.07, 0.02, bevel=0.003, skip=(4,))
    for sg in (-1, 1):
        o.shell.box("trimWhite", w.m(s + sg * (wd / 2 + 0.035), cy, zi), 0.07, hgt, 0.02, bevel=0.003, skip=(4,))
    o.shell.box("trimWhite", w.m(s, y + b + 0.012, in_face - 0.03), wd + 0.18, 0.024, 0.08, bevel=0.004)
    o.shell.box("trimWhite", w.m(s, y + b - 0.045, zi), wd + 0.1, 0.07, 0.02, skip=(4,))


def door_leaf(lw, lh, lt, mat, glass_top=False):
    """A panelled leaf with its hinge edge on the origin's vertical, running +x: a thin core with
    stiles and rails standing proud on both faces round the panels, a knob each side, hinges.
    A half-glazed one has the core cut away for the glass. Returns (leaf, glass)."""
    p, g = Part("leaf"), Part("leafglass")
    core = lt * 0.55
    st, rb, rt, rm = 0.12, 0.24, 0.13, 0.12
    yl = 1.0  # the lock rail
    if glass_top:
        p.box(mat, at(lw / 2, (yl + rm) / 2, 0), lw, yl + rm, core)
        for x in (st / 2, lw - st / 2):
            p.box(mat, at(x, (yl + rm + lh) / 2, 0), st, lh - yl - rm, core)
        p.box(mat, at(lw / 2, lh - rt / 2, 0), lw - 2 * st, rt, core)
        g.box("glassDirty", at(lw / 2, (yl + rm + lh - rt) / 2, 0), lw - 2 * st, lh - rt - yl - rm, 0.006)
    else:
        p.box(mat, at(lw / 2, lh / 2, 0), lw, lh, core)
    d = (lt - core) / 2
    for sg in (-1, 1):
        z = sg * (core / 2 + d / 2)
        for x in (st / 2, lw - st / 2):
            p.box(mat, at(x, lh / 2, z), st, lh, d, bevel=0.003)
        for y0, hh in ((0.0, rb), (yl, rm), (lh - rt, rt)):
            p.box(mat, at(lw / 2, y0 + hh / 2, z), lw - 2 * st, hh, d, bevel=0.003)
        p.box(mat, at(lw / 2, (rb + yl) / 2, z), 0.1, yl - rb, d, bevel=0.003)
        if not glass_top:
            p.box(mat, at(lw / 2, (yl + rm + lh - rt) / 2, z), 0.1, lh - rt - yl - rm, d, bevel=0.003)
    for sg in (-1, 1):
        p.cylinder("chrome", at(lw - 0.07, 0.95, sg * (lt / 2 + 0.005)) @ rot_x(math.pi / 2), 0.032, 0.01, seg=14)
        p.cylinder("chrome", at(lw - 0.07, 0.95, sg * (lt / 2 + 0.035)) @ rot_x(math.pi / 2), 0.026, 0.05, seg=14, r2=0.03)
    for hy in (0.22, lh / 2, lh - 0.22):
        p.box("metal", at(-0.004, hy, 0), 0.012, 0.09, lt * 0.8)
    return p, g


def doorway(o, w, y, op, trim, leaf_mat, ext, t, clad=True, leaf=True, open_=0.0, hinge=1, glass_top=False):
    """Liners through the wall, a casing each side, a sill outside, and the leaf as its own object
    standing on its hinge."""
    s, wd, top = op["at"], op["w"], op["top"]
    out_face = t / 2 + (CLAD if (ext and clad) else 0.0)
    in_face = -t / 2
    depth, mid = out_face - in_face, (out_face + in_face) / 2
    lt = 0.024
    o.shell.box(trim if ext else "trimWhite", w.m(s, y + top - lt / 2, mid), wd, lt, depth)
    for sg in (-1, 1):
        o.shell.box(trim if ext else "trimWhite", w.m(s + sg * (wd / 2 - lt / 2), y + (top - lt) / 2, mid), lt, top - lt, depth)
    if ext:
        o.shell.box("woodDark", w.m(s, y + 0.01, mid + 0.01), wd, 0.02, depth + 0.04, bevel=0.004)
    for face in (out_face, in_face):
        sgz = 1 if face > 0 else -1
        mat = trim if (ext and face > 0) else "trimWhite"
        cw = 0.09 if (ext and face > 0) else 0.07
        z = face + sgz * 0.012
        back = (5,) if sgz > 0 else (4,)
        o.shell.box(mat, w.m(s, y + top + cw / 2, z), wd + cw * 2, cw, 0.024, bevel=0.004, skip=back)
        for sg in (-1, 1):
            o.shell.box(mat, w.m(s + sg * (wd / 2 + cw / 2), y + top / 2, z), cw, top, 0.024, bevel=0.004, skip=back + (3,))
    if not leaf:
        return
    lw, lh, lthick = wd - 2 * lt - 0.006, top - lt - 0.025, 0.045 if ext else 0.038
    p, g = door_leaf(lw, lh, lthick, leaf_mat, glass_top)
    hp = w.p(s - hinge * (wd / 2 - lt - 0.003), mid)
    rot = w.rot + (0 if hinge > 0 else math.pi)
    o.doors.append((p, g, dict(hinge=[round(hp.x, 4), round(y + 0.02, 4), round(hp.z, 4)], rot=round(rot, 5), w=round(lw, 4), h=round(lh, 4), t=lthick, open=round(open_, 3), ext=ext)))


def steps(o, w, s, y_top, out0, width=1.3, mat="concrete"):
    """Steps from y_top down to the ground, starting out0 out from the wall's centre line."""
    n = max(1, int(round(y_top / 0.18)))
    rise = y_top / n
    for k in range(n - 1):
        top = y_top - rise * (k + 1)
        p = w.p(s, out0 + 0.28 * (k + 0.5))
        o.shell.box(mat, w.m(s, (top - 0.3) / 2, out0 + 0.28 * (k + 0.5)), width - 0.04 * k, top + 0.3, 0.28 + 0.002, bevel=0.012)
        o.col((p.x, (top - 0.3) / 2, p.z), (width, top + 0.3, 0.28), w.rot, surface="concrete")


def house(name, seed, style, abandoned=0.1):
    r = random.Random(seed)
    S = STYLES[style]
    o = Out(name)
    plan = plan_house(r)
    W, D = plan["W"], plan["D"]
    x0, x1, z0, z1 = plan["x0"], plan["x1"], plan["z0"], plan["z1"]
    rooms = plan["rooms"]
    T = CORE_T
    fy = 0.55 if S["crawl"] else 0.2
    o.floor_y = fy
    trim = S["trim"]
    clad = S["ext"].startswith("siding")
    ext_mat = "planks" if clad else S["ext"]
    gable = S["roof_type"] == "gable"
    has_porch = gable and r.random() < 0.75
    living = next(rm for rm in rooms if rm["type"] == "living")
    door_at = (living["x0"] + living["x1"]) / 2 + (r.random() - 0.5) * 0.8

    # the outer walls: front and back run the full width over the corners, the sides between them
    sides = [("front", (x0, z1), (x1, z1), True), ("back", (x1, z0), (x0, z0), True), ("left", (x0, z0), (x0, z1), False), ("right", (x1, z1), (x1, z0), False)]
    walls = [(side, Wall(a, b), full) for side, a, b, full in sides]

    # ------------------------------------------------ foundation
    if S["crawl"]:
        for side, w, full in walls:
            s0, s1 = (-T / 2 - 0.03, w.L + T / 2 + 0.03) if full else (T / 2 + 0.03, w.L - T / 2 - 0.03)
            o.shell.box("concrete", w.m((s0 + s1) / 2, (fy - 0.4) / 2, 0.0), s1 - s0, fy + 0.4, T + 0.06, bevel=0.008)
            n = max(1, int(w.L / 2.8))
            for k in range(n):
                mv = w.m(w.L * (k + 0.5) / n, fy * 0.45, T / 2 + 0.03)
                o.shell.box("blackMatte", mv, 0.4, 0.17, 0.006)
                for j in range(5):
                    o.shell.box("metal", mv @ at(0, -0.066 + j * 0.033, 0.006), 0.38, 0.012, 0.008)
        o.shell.box("concrete", at(0, fy - 0.14, 0), W - T, 0.24, D - T)
    else:
        o.shell.box("concrete", at(0, (fy - 0.3) / 2, 0), W + T + 0.1, fy + 0.3, D + T + 0.1, bevel=0.01)
    o.col((0, fy - 0.1, 0), (W + T, 0.2, D + T), surface="concrete")

    # ------------------------------------------------ rooms
    floor_mat = {"living": "floorboards", "kitchen": "linoleum", "bath": "tiles", "bedroom": "floorboards"}
    wall_mat = {"living": r.choice(["wallpaper", "plaster", "plasterGreen"]), "kitchen": r.choice(["plaster", "plasterBlue"]), "bath": "tiles", "bedroom": r.choice(["wallpaper", "plasterBlue", "plaster"])}
    for rm in rooms:
        rm["wall"] = wall_mat[rm["type"]]
        cx, cz = (rm["x0"] + rm["x1"]) / 2, (rm["z0"] + rm["z1"]) / 2
        o.shell.box(floor_mat[rm["type"]], at(cx, fy + 0.008, cz), rm["x1"] - rm["x0"], 0.016, rm["z1"] - rm["z0"])
        o.shell.box("ceiling", at(cx, fy + WALL_H + 0.02, cz), rm["x1"] - rm["x0"], 0.04, rm["z1"] - rm["z0"])
        # a ceiling lamp
        o.shell.cylinder("metalWhite", at(cx, fy + WALL_H - 0.01, cz), 0.06, 0.02, seg=12)
        o.glass.cylinder("glassDirty", at(cx, fy + WALL_H - 0.07, cz), 0.16, 0.1, seg=16, r2=0.12)
        o.rooms.append({k: rm[k] for k in ("type", "x0", "z0", "x1", "z1")})
        o.lights.append(dict(pos=[cx, fy + WALL_H - 0.12, cz], kind="ceiling"))
    o.col((0, fy + WALL_H + 0.06, 0), (W, 0.1, D))

    # ------------------------------------------------ outer walls with their openings
    openings_all = []
    for side, w, full in walls:
        ops, along = [], []
        for rm in rooms:
            if side == "front" and abs(rm["z1"] - z1) < 0.01:
                along.append((rm, rm["x0"] - x0, rm["x1"] - x0))
            elif side == "back" and abs(rm["z0"] - z0) < 0.01:
                along.append((rm, x1 - rm["x1"], x1 - rm["x0"]))
            elif side == "left" and abs(rm["x0"] - x0) < 0.01:
                along.append((rm, rm["z0"] - z0, rm["z1"] - z0))
            elif side == "right" and abs(rm["x1"] - x1) < 0.01:
                along.append((rm, z1 - rm["z1"], z1 - rm["z0"]))
        for rm, s0, s1 in along:
            ln = s1 - s0
            if side == "front" and rm is living:
                da = door_at - x0
                ops.append(dict(at=da, w=0.95, bottom=0, top=2.05, type="door"))
                other = (s0 + da - 0.6) / 2 if da - s0 > s1 - da else (da + 0.6 + s1) / 2
                if abs(other - da) > 1.5:
                    ops.append(dict(at=other, w=1.5, bottom=0.8, top=2.15, type="window"))
            elif rm["type"] == "bath":
                if ln > 1.4 and r.random() < 0.8:
                    ops.append(dict(at=(s0 + s1) / 2, w=0.7, bottom=1.45, top=2.1, type="window"))
            elif rm["type"] == "kitchen" and side == "back" and r.random() < 0.5 and ln > 2.2:
                ops.append(dict(at=s0 + 0.9, w=0.9, bottom=0, top=2.05, type="door"))
            elif ln > 2.2:
                n = 2 if ln > 4.5 else 1
                for k in range(n):
                    ops.append(dict(at=s0 + ln * (k + 0.5) / n, w=0.95, bottom=0.85, top=2.15, type="window"))
        w.ops = ops
        s_min, s_max = (-T / 2, w.L + T / 2) if full else (T / 2, w.L - T / 2)
        wall_core(o, w, fy, WALL_H, T, ops, ext_mat, "plaster", s_min, s_max)
        if clad:
            siding(o, w, fy - 0.04, WALL_H + 0.04, [dict(op, bottom=op["bottom"] + 0.04, top=op["top"] + 0.04) for op in ops], S["ext"], -T / 2 - CLAD, w.L + T / 2 + CLAD)
        for op in ops:
            p = w.p(op["at"])
            openings_all.append(dict(x=p.x, z=p.z, w=op["w"], type=op["type"]))
            if op["type"] == "window":
                window(o, w, fy, op, r, trim, abandoned * (0.3 + r.random() * 0.5), r.random() < abandoned * 0.35, clad, r.random() < 0.6)
            else:
                front_door = side == "front"
                doorway(o, w, fy, op, trim, r.choice(["woodDark", "trimWhite", "veneerDark"]), True, T, clad, leaf=r.random() >= abandoned * 0.25,
                        open_=0.7 if r.random() < abandoned * 0.4 else 0.0, glass_top=r.random() < 0.4)
                if not (front_door and has_porch):
                    # a stoop and steps
                    o.shell.box("concrete", w.m(op["at"], (fy - 0.03 - 0.3) / 2, T / 2 + CLAD + 0.45), 1.4, fy - 0.03 + 0.3, 0.9, bevel=0.012)
                    pp = w.p(op["at"], T / 2 + CLAD + 0.45)
                    o.col((pp.x, (fy - 0.03 - 0.3) / 2, pp.z), (1.4, fy + 0.27, 0.9), w.rot, surface="concrete")
                    steps(o, w, op["at"], fy - 0.03, T / 2 + CLAD + 0.9)
        # each room's own finish on the inner face
        for rm, s0, s1 in along:
            if rm["wall"] == "plaster":
                continue
            rops = [dict(op, at=op["at"] - s0) for op in ops if s0 < op["at"] < s1]
            pa, pb = w.p(s0, -(T / 2 + 0.006)), w.p(s1, -(T / 2 + 0.006))
            wall_core(o, Wall((pa.x, pa.z), (pb.x, pb.z)), fy + 0.016, WALL_H - 0.02, 0.008, rops, rm["wall"], rm["wall"], collide=False)
    if clad:
        # corner boards over the ends of the courses
        for side, w, full in walls:
            for s, sg in ((-T / 2 - CLAD, 1), (w.L + T / 2 + CLAD, -1)):
                o.shell.box(trim, w.m(s + sg * 0.065, fy + (WALL_H - 0.05) / 2, T / 2 + CLAD + 0.012), 0.13, WALL_H + 0.05, 0.024, bevel=0.004)

    # ------------------------------------------------ inner walls
    links = []
    front = [rm for rm in rooms if rm["z1"] == z1]
    backs = [rm for rm in rooms if rm["z1"] == plan["zmid"]]
    for bk in backs:
        best, best_ov = None, 0
        for f in front:
            ov = min(bk["x1"], f["x1"]) - max(bk["x0"], f["x0"])
            pref = 1.2 if f["type"] == "living" else 1
            if ov * pref > best_ov and ov > 1.1:
                best_ov, best = ov * pref, f
        if best:
            lo, hi = max(bk["x0"], best["x0"]) + 0.6, min(bk["x1"], best["x1"]) - 0.6
            links.append(dict(axis="x", z=plan["zmid"], at=(lo + hi) / 2))
    links.append(dict(axis="z", x=front[0]["x1"], at=(plan["zmid"] + z1) / 2 - 0.4, open=True))
    iws = [((x0 + T / 2, plan["zmid"]), (x1 - T / 2, plan["zmid"]))]
    for zone in (front, backs):
        for i in range(len(zone) - 1):
            xw = zone[i]["x1"]
            iws.append(((xw, zone[i]["z0"] + (T / 2 if zone[i]["z0"] == z0 else INT_T / 2)), (xw, zone[i]["z1"] - (T / 2 if zone[i]["z1"] == z1 else INT_T / 2))))
    for a, b in iws:
        w = Wall(a, b)
        horiz = abs(a[1] - b[1]) < 0.01
        ops = []
        for l in links:
            if horiz and l["axis"] == "x" and abs(l["z"] - a[1]) < 0.01:
                ops.append(dict(at=l["at"] - a[0], w=0.85, bottom=0, top=2.03, type="door"))
            if not horiz and l["axis"] == "z" and abs(l["x"] - a[0]) < 0.01:
                sat = l["at"] - a[1]
                if 0.5 < sat < abs(b[1] - a[1]) - 0.5:
                    op = l.get("open")
                    ops.append(dict(at=sat, w=1.4 if op else 0.85, bottom=0, top=2.25 if op else 2.03, type="arch" if op else "door"))
        wall_core(o, w, fy, WALL_H, INT_T, ops, "plaster", "plaster")
        for sgn in (1, -1):
            for rm in rooms:
                if rm["wall"] == "plaster":
                    continue
                if abs(w.u.x) > 0.5:
                    ra, rb = (rm["x0"] - w.a.x) / w.u.x, (rm["x1"] - w.a.x) / w.u.x
                else:
                    ra, rb = (rm["z0"] - w.a.z) / w.u.z, (rm["z1"] - w.a.z) / w.u.z
                s0, s1 = max(0.0, min(ra, rb) + INT_T / 2), min(w.L, max(ra, rb) - INT_T / 2)
                if s1 - s0 < 0.1:
                    continue
                pm = w.p((s0 + s1) / 2, sgn * 0.3)
                if not (rm["x0"] < pm.x < rm["x1"] and rm["z0"] < pm.z < rm["z1"]):
                    continue
                rops = [dict(op, at=op["at"] - s0) for op in ops if s0 < op["at"] < s1]
                pa, pb = w.p(s0, sgn * (INT_T / 2 + 0.006)), w.p(s1, sgn * (INT_T / 2 + 0.006))
                wall_core(o, Wall((pa.x, pa.z), (pb.x, pb.z)), fy + 0.016, WALL_H - 0.02, 0.008, rops, rm["wall"], rm["wall"], collide=False)
        for op in ops:
            p = w.p(op["at"])
            openings_all.append(dict(x=p.x, z=p.z, w=op["w"], type="door"))
            if op["type"] == "door":
                doorway(o, w, fy, op, "trimWhite", "trimWhite", False, INT_T, leaf=r.random() > abandoned * 0.3, open_=1.0 if r.random() < 0.5 else 0.2 + r.random() * 0.5, hinge=1 if r.random() < 0.5 else -1)
            else:
                doorway(o, w, fy, op, "trimWhite", None, False, INT_T, leaf=False)

    # ------------------------------------------------ baseboards, clear of the doorways
    for rm in rooms:
        for a, b in (((rm["x0"], rm["z1"]), (rm["x1"], rm["z1"])), ((rm["x1"], rm["z0"]), (rm["x0"], rm["z0"])), ((rm["x0"], rm["z0"]), (rm["x0"], rm["z1"])), ((rm["x1"], rm["z1"]), (rm["x1"], rm["z0"]))):
            w = Wall(a, b)
            outer = (a[1] == b[1] and a[1] in (z0, z1)) or (a[0] == b[0] and a[0] in (x0, x1))
            inset = T / 2 if outer else INT_T / 2
            doors_here = []
            for op in openings_all:
                if op["type"] == "window":
                    continue
                dv = V(op["x"], 0, op["z"]) - w.a
                if abs(dv.dot(w.n)) < 0.2 and -0.3 < dv.dot(w.u) < w.L + 0.3:
                    doors_here.append(dict(at=dv.dot(w.u), w=op["w"] + 0.16, bottom=0, top=1))
            for s0, s1 in free_spans(inset, w.L - inset, 0, 0.1, doors_here, 0):
                o.shell.box("trimWhite", w.m((s0 + s1) / 2, fy + 0.066, -(inset + 0.008 + 0.009)), s1 - s0, 0.1, 0.018, skip=(3, 4))

    # ------------------------------------------------ roof, porch, what is on the walls
    roof_y = fy + WALL_H + 0.04
    if gable:
        gable_roof(o, r, plan, roof_y, math.radians(18 + r.random() * 8), S, abandoned, clad)
    else:
        flat_roof(o, r, plan, roof_y, S, style)
    if has_porch:
        porch(o, r, plan, door_at, fy, S, clad)
    fw = walls[0][1]
    lp = fw.p(door_at - x0 + 0.78, T / 2 + (CLAD if clad else 0) + 0.05)
    o.shell.box("metalPainted", at(lp.x, fy + 2.15, lp.z), 0.12, 0.18, 0.08, bevel=0.01)
    o.glass.box("glassDirty", at(lp.x, fy + 2.1, lp.z + 0.045), 0.08, 0.1, 0.01)
    o.lights.append(dict(pos=[lp.x, fy + 2.1, lp.z + 0.1], kind="porch"))
    sw = walls[3][1]
    out = T / 2 + (CLAD if clad else 0)
    pm = sw.p(sw.L * 0.7, out + 0.05)
    o.shell.box(None, sw.m(sw.L * 0.7, fy + 1.2, out + 0.05), 0.25, 0.35, 0.1, bevel=0.012, mats=["metalPainted"] * 6)
    o.shell.tube("metal", [sw.p(sw.L * 0.7, out + 0.03) + V(0, fy + 1.37, 0), sw.p(sw.L * 0.7, out + 0.03) + V(0, fy + WALL_H - 0.05, 0)], 0.016, seg=8)
    gm = sw.p(sw.L * 0.7, out + 0.12)
    o.glass.cylinder("glassDirty", at(gm.x, fy + 1.24, gm.z) @ facing(sw.n), 0.065, 0.06, seg=16)
    o.footprint = (W + 1.5, D + 4.5)
    return o


def gable_roof(o, r, plan, y, pitch, S, abandoned, clad, extras=True, over=0.45):
    """A deck on rafters with rows of shingles (or tiles) lapping down it, a ridge cap; fascia,
    soffits and gutters with downspouts at the eaves; the gables clad like the walls, with rake
    boards and a vent; a chimney, a vent pipe, maybe a TV aerial."""
    T = CORE_T
    x0, x1, z0, z1 = plan["x0"], plan["x1"], plan["z0"], plan["z1"]
    along_x = (x1 - x0) >= (z1 - z0)
    # the roof's own frame: the ridge along local x, the slopes falling to local +-z
    base = Matrix.Identity(4) if along_x else rot_y(math.pi / 2)
    if along_x:
        X0, X1, Z0, Z1 = x0, x1, z0, z1
    else:
        X0, X1, Z0, Z1 = -z1, -z0, x0, x1
    cx, cz = (X0 + X1) / 2, (Z0 + Z1) / 2
    wall_face = (Z1 - Z0) / 2 + T / 2 + (CLAD if clad else 0)
    run = wall_face + over
    tp = math.tan(pitch)
    rise = wall_face * tp
    ridge_y = y + rise
    eave_y = y - over * tp
    rake = 0.3
    length = X1 - X0 + T + 2 * (CLAD if clad else 0) + 2 * rake
    deck = 0.12
    slope_len = run / math.cos(pitch)
    roof_mat = S["roof"]
    tiles = roof_mat == "rooftiles"
    trim = "trimWhite" if clad else S["trim"]
    ry = 0.0 if along_x else math.pi / 2

    def L(x, yy, z):
        return base @ V(x, yy, z)

    for s in (-1, 1):
        # the deck: its underside from the ridge line down past the wall
        nrm = V(0, math.cos(pitch), s * math.sin(pitch))
        mid_bottom = V(cx, ridge_y - (run / 2) * tp, cz + s * run / 2)
        c = mid_bottom + nrm * (deck / 2)
        m = base @ at(c.x, c.y, c.z) @ rot_x(pitch * s)
        o.shell.box(None, m, length, deck, slope_len, mats=[trim, trim, "planks", "planks", trim, trim], frame=(V(1, 0, 0), V(0, 0, 1)))
        cw = L(c.x, c.y, c.z)
        o.col((cw.x, cw.y, cw.z), (length, deck, slope_len), ry, pitch * s, surface="roof")
        if roof_mat.startswith("corrugated"):
            # sheets of iron down the slope, each lapping the last by a wave
            n = int(math.ceil(length / 0.78))
            for k in range(n):
                x = -length / 2 + 0.43 + k * (length - 0.86) / max(1, n - 1)
                if abandoned > 0.3 and r.random() < abandoned * 0.12:
                    continue
                o.shell.corrugated(roof_mat, m @ at(x, deck / 2 + 0.012 + (k % 2) * 0.004, 0.02 * s), 0.86, slope_len + 0.06)
        exp = 0.3 if tiles else SHINGLE_EXP
        lap = 0.06
        d = slope_len if not roof_mat.startswith("corrugated") else 0.0
        k = 0
        # rows lapping down the slope from the ridge to the eave, each laid so the scan's own
        # courses fall on it (its lower edge on a course edge of the scan)
        while d > 0.02:
            lo = d
            hi = max(0.0, d - exp - lap)
            segs = [(-length / 2, length / 2)]
            if abandoned > 0.3 and r.random() < abandoned * 0.12:
                g0 = (r.random() - 0.5) * length * 0.8
                gl = 0.4 + r.random() * 1.2
                segs = [(-length / 2, g0 - gl / 2), (g0 + gl / 2, length / 2)]
            for a, b in segs:
                if b - a < 0.12:
                    continue
                zl = s * (-slope_len / 2 + (lo + hi) / 2)
                th = 0.022 if tiles else 0.008
                mm = m @ at((a + b) / 2, deck / 2 + th / 2 + 0.002, zl) @ rot_x(-0.03 * s)
                up = mm.to_3x3().normalized() @ V(0, 0, -s)
                q = (mm @ V(0, 0, s * (lo - hi) / 2)).dot(up)
                off = (k * 0.37 % 1.7, SHINGLE_EDGE - q)
                # (the underside and the upper end lie on the deck and under the next row)
                o.shell.box(roof_mat, mm, b - a, th, lo - hi, bevel=0.008 if tiles else 0.0, frame=(V(1, 0, 0), V(0, 0, -s)), uv_off=off, skip=(3, 5 if s > 0 else 4))
            d -= exp
            k += 1
        # the fascia, the soffit under the overhang, the gutter
        ez = cz + s * run
        o.shell.box(trim, base @ at(cx, eave_y - 0.04, ez + s * 0.013), length, 0.2, 0.026, bevel=0.004)
        if clad:
            o.shell.box(trim, base @ at(cx, eave_y - 0.13, cz + s * (wall_face + over / 2)), length - 0.06, 0.014, over - 0.01)
        gutter(o, r, base, cx, eave_y + 0.01, ez + s * 0.09, length - 0.1, s, wall_face, cz, abandoned)
    # the ridge cap
    if roof_mat.startswith("corrugated"):
        for s in (-1, 1):
            o.shell.box(roof_mat, base @ at(cx, ridge_y + deck / math.cos(pitch) + 0.04, cz + s * 0.1) @ rot_x(pitch * s), length, 0.006, 0.24)
    else:
        o.shell.box(roof_mat, base @ at(cx, ridge_y + deck / math.cos(pitch) + 0.02, cz), length, 0.04 if not tiles else 0.08, 0.28, bevel=0.015 if tiles else 0.006, frame=(V(1, 0, 0), V(0, 0, 1)))
    # the gables
    for e in (-1, 1):
        xe = (X0 - T / 2) if e < 0 else (X1 + T / 2)
        # the gable wall up to the underside of the roof (a pentagon: the roof meets the wall's
        # outer edge a little above its top)
        lift = (CLAD if clad else 0) * tp
        def gable_pts(xx):
            return [V(xx, y, Z0 - T / 2), V(xx, y, Z1 + T / 2), V(xx, y + lift, Z1 + T / 2), V(xx, ridge_y, cz), V(xx, y + lift, Z0 - T / 2)]
        o.shell.poly("plaster", [L(*p) for p in gable_pts(xe - e * T)], base.to_3x3() @ V(-e, 0, 0))
        o.shell.poly("planks" if clad else S["ext"], [L(*p) for p in gable_pts(xe)], base.to_3x3() @ V(e, 0, 0))
        # its wall line in the house's frame, outside to the left
        pa, pb = L(xe - e * T / 2, 0, Z1 + T / 2 + 0.2), L(xe - e * T / 2, 0, Z0 - T / 2 - 0.2)
        gw = Wall((pa.x, pa.z), (pb.x, pb.z))
        if gw.n.dot(base.to_3x3() @ V(e, 0, 0)) < 0:
            gw = Wall((pb.x, pb.z), (pa.x, pa.z))
        if clad:
            siding(o, gw, y - 0.02, rise, [], S["ext"], 0.0, gw.L, slope=(gw.L / 2, tp, (gw.L / 2 - 0.2) * tp + 0.02))
            vm = gw.m(gw.L / 2, y + rise * 0.5, T / 2 + CLAD + 0.015)
            o.shell.box(trim, vm, 0.55, 0.45, 0.03, bevel=0.005)
            o.shell.box("blackMatte", vm @ at(0, 0, 0.006), 0.43, 0.33, 0.02)
            for j in range(5):
                o.shell.box(trim, vm @ at(0, -0.13 + j * 0.065, 0.018) @ rot_x(0.6), 0.42, 0.055, 0.008)
        # rake boards up both slopes, standing out past the cladding
        for s in (-1, 1):
            p0 = V(xe + e * ((CLAD if clad else 0) + rake - 0.013), eave_y + 0.01, cz + s * run)
            p1 = V(xe + e * ((CLAD if clad else 0) + rake - 0.013), ridge_y + deck + 0.01, cz)
            mid = (p0 + p1) / 2
            dv = p1 - p0
            ang = math.atan2(-dv.y, dv.z)
            o.shell.box(trim, base @ at(mid.x, mid.y, mid.z) @ rot_x(ang), 0.026, 0.2, dv.length, bevel=0.004)
    # chimney through the back slope, vent pipe, maybe an aerial
    if not extras:
        return
    if r.random() < 0.55:
        cxw = cx + (r.random() - 0.5) * (X1 - X0) * 0.5
        czw = cz - wall_face / 2
        roof_at = ridge_y - (wall_face / 2) * tp
        top = ridge_y + 0.9
        bot = roof_at - 0.4
        o.shell.box("brick", base @ at(cxw, (top + bot) / 2, czw), 0.62, top - bot, 0.62, bevel=0.008)
        o.shell.box("concrete", base @ at(cxw, top + 0.04, czw), 0.72, 0.08, 0.72, bevel=0.01)
        o.shell.cylinder("metal", base @ at(cxw, top + 0.2, czw), 0.09, 0.25, seg=12)
        cc = L(cxw, (top + bot) / 2, czw)
        o.col((cc.x, cc.y, cc.z), (0.62, top - bot, 0.62), ry, surface="concrete")
    vx = cx + (r.random() - 0.5) * (X1 - X0) * 0.6
    vz = cz - wall_face * 0.6
    vy = ridge_y - wall_face * 0.6 * tp
    o.shell.cylinder("blackMatte", base @ at(vx, vy + 0.22, vz), 0.045, 0.5, seg=10)
    if r.random() < 0.4:
        ax_ = cx + (X1 - X0) * 0.3
        b0 = V(ax_, ridge_y - 0.2, cz)
        o.shell.tube("metal", [L(*b0), L(b0.x, b0.y + 2.4, b0.z)], 0.02, seg=8)
        for k in range(5):
            yy = b0.y + 1.5 + k * 0.17
            wl = 1.4 - k * 0.2
            o.shell.tube("metal", [L(ax_, yy, cz - wl / 2), L(ax_, yy, cz + wl / 2)], 0.008, seg=6)


def gutter(o, r, base, cx, y, z, length, s, wall_face, cz, abandoned):
    """A box gutter along an eave, a downspout down each end to a splash block."""
    m = base @ at(cx, y, z)
    o.shell.box("metalWhite", m @ at(0, -0.1, 0), length, 0.008, 0.12)
    o.shell.box("metalWhite", m @ at(0, -0.055, s * 0.06), length, 0.1, 0.006, bevel=0.002)
    o.shell.box("metalWhite", m @ at(0, -0.06, -s * 0.06), length, 0.08, 0.006)
    for e in (-1, 1):
        o.shell.box("metalWhite", m @ at(e * length / 2, -0.06, 0), 0.006, 0.09, 0.12)
    for e in (-1, 1):
        if abandoned > 0.3 and r.random() < abandoned * 0.4:
            continue
        x = cx + e * (length / 2 - 0.3)
        wz = cz + s * (wall_face + 0.06)
        pts = [V(x, y - 0.1, z), V(x, y - 0.3, wz), V(x, 0.32, wz), V(x, 0.08, wz + s * 0.3)]
        o.shell.tube("metalWhite", [base @ p for p in pts], 0.036, seg=8)
        sp = base @ V(x, 0.03, wz + s * 0.45)
        o.shell.box("concrete", at(sp.x, sp.y, sp.z) @ base, 0.3, 0.06, 0.5, bevel=0.01)


def flat_roof(o, r, plan, y, S, style):
    """A flat roof behind a parapet with its coping; on adobe the vigas standing out of the front
    and wooden canales through the parapet at the back."""
    T = CORE_T
    x0, x1, z0, z1 = plan["x0"], plan["x1"], plan["z0"], plan["z1"]
    W, D = x1 - x0 + T, z1 - z0 + T
    o.shell.box(None, at((x0 + x1) / 2, y + 0.1, (z0 + z1) / 2), W, 0.2, D, mats=[S["ext"]] * 2 + ["concrete", "ceiling"] + [S["ext"]] * 2)
    o.col(((x0 + x1) / 2, y + 0.1, (z0 + z1) / 2), (W, 0.2, D), surface="concrete")
    par = 0.55
    adobe = style == "adobe"
    for (ax, az), (bx, bz), full in (((x0, z1), (x1, z1), True), ((x1, z0), (x0, z0), True), ((x0, z0), (x0, z1), False), ((x1, z1), (x1, z0), False)):
        w = Wall((ax, az), (bx, bz))
        s0, s1 = (-T / 2, w.L + T / 2) if full else (T / 2, w.L - T / 2)
        o.shell.box(None, w.m((s0 + s1) / 2, y + 0.2 + par / 2, 0), s1 - s0, par, T, mats=[S["ext"]] * 4 + [S["ext"], "concrete"], bevel=0.0)
        c0, c1 = (s0 - 0.04, s1 + 0.04) if full else (s0 + 0.04, s1 - 0.04)
        o.shell.box(S["ext"] if adobe else "concrete", w.m((c0 + c1) / 2, y + 0.2 + par + 0.03, 0), c1 - c0, 0.06, T + 0.08, bevel=0.025 if adobe else 0.008)
        p = w.p((s0 + s1) / 2)
        o.col((p.x, y + 0.2 + par / 2, p.z), (s1 - s0, par, T), w.rot, surface="concrete")
    if adobe:
        k = 0
        x = x0 + 0.6
        while x < x1 - 0.3:
            o.shell.cylinder("woodDark", at(x, y - 0.1, z1 + T / 2 + 0.16) @ rot_x(math.pi / 2), 0.09, 0.42, seg=10)
            x += 0.9
        for xx in (x0 + 1.0, x1 - 1.0):
            o.shell.box("woodDark", at(xx, y + 0.28, z0 - T / 2 - 0.25), 0.2, 0.14, 0.7, bevel=0.01)


def porch(o, r, plan, door_at, fy, S, clad):
    """A wooden porch at the front door: a deck of boards with gaps on a frame, steps down, posts
    with bases, a beam, rafters from a ledger on the wall carrying corrugated iron, a railing."""
    x0, x1, z1 = plan["x0"], plan["x1"], plan["z1"]
    T = CORE_T
    pd = 1.9
    pw = min(plan["W"] - 0.4, 5 + r.random() * 3)
    pcx = max(x0 + pw / 2, min(x1 - pw / 2, door_at))
    zf = z1 + T / 2 + (CLAD if clad else 0)
    trim = S["trim"]
    o.shell.box("woodDark", at(pcx, fy - 0.14, zf + pd / 2), pw, 0.2, pd, bevel=0.008)
    for xs in (pcx - pw / 2 + 0.1, pcx + pw / 2 - 0.1):
        o.shell.box("concrete", at(xs, (fy - 0.24 - 0.3) / 2, zf + pd - 0.12), 0.25, fy - 0.24 + 0.3, 0.25, bevel=0.01)
    nb = int(pw / 0.145)
    for k in range(nb):
        x = pcx - pw / 2 + (k + 0.5) * pw / nb
        o.shell.box("wood", at(x, fy - 0.014, zf + pd / 2 + 0.01), pw / nb - 0.008, 0.026, pd + 0.02, bevel=0.003, frame=(V(0, 0, 1), V(1, 0, 0)))
    o.col((pcx, fy - 0.1, zf + pd / 2), (pw, 0.2, pd))
    # steps down to the ground at the door
    n = max(1, int(round(fy / 0.18)))
    rise = fy / n
    for k in range(1, n):
        top = fy - rise * k
        zk = zf + pd + 0.15 + 0.28 * (k - 1)
        o.shell.box("wood", at(door_at, top - 0.017, zk), 1.3, 0.034, 0.3, bevel=0.004)
        o.shell.box("woodDark", at(door_at, (top - 0.034) / 2, zk - 0.03), 1.2, top - 0.034, 0.22)
        o.col((door_at, top / 2, zk), (1.3, top, 0.3))
    # posts and the beam
    ph = 2.1
    posts = max(2, int(round(pw / 2.2)) + 1)
    zp = zf + pd - 0.12
    for i in range(posts):
        x = pcx - pw / 2 + 0.1 + (pw - 0.2) * i / (posts - 1)
        o.shell.box(trim, at(x, fy + ph / 2, zp), 0.11, ph, 0.11, bevel=0.008)
        o.shell.box(trim, at(x, fy + 0.05, zp), 0.15, 0.1, 0.15, bevel=0.012)
        o.shell.box(trim, at(x, fy + ph - 0.04, zp), 0.15, 0.06, 0.15, bevel=0.01)
        o.col((x, fy + ph / 2, zp), (0.11, ph, 0.11))
    beam_top = fy + ph + 0.18
    o.shell.box(trim, at(pcx, fy + ph + 0.09, zp), pw + 0.1, 0.18, 0.12, bevel=0.006)
    # the ledger on the wall and rafters from it over the beam
    led_y = fy + WALL_H - 0.12
    o.shell.box("woodDark", at(pcx, led_y - 0.09, zf + 0.025), pw + 0.2, 0.18, 0.05, bevel=0.005)
    slope = math.atan2(led_y - beam_top, zp - zf)
    ln = ((zp + 0.35) - zf) / math.cos(slope)
    nr = max(2, int(pw / 0.6))
    for k in range(nr + 1):
        x = pcx - (pw + 0.1) / 2 + k * (pw + 0.1) / nr
        m = at(x, led_y - math.sin(slope) * ln / 2, zf + math.cos(slope) * ln / 2) @ rot_x(slope)
        o.shell.box("woodDark", m @ at(0, -0.06, 0), 0.05, 0.12, ln, bevel=0.004)
    m = at(pcx, led_y - math.sin(slope) * ln / 2, zf + math.cos(slope) * ln / 2) @ rot_x(slope) @ at(0, 0.012, 0.03)
    o.shell.corrugated("corrugated", m, pw + 0.4, ln + 0.1)
    cc = m @ V(0, 0, 0)
    o.col((cc.x, cc.y, cc.z), (pw + 0.4, 0.04, ln + 0.1), 0, slope, surface="roof")
    # a railing either side of the steps and along the ends
    if r.random() < 0.7:
        def rail(pa, pb):
            mid, d = (pa + pb) / 2, pb - pa
            rr = math.atan2(-d.z, d.x)
            L_ = d.length
            o.shell.box(trim, at(mid.x, fy + 0.92, mid.z) @ rot_y(rr), L_, 0.05, 0.085, bevel=0.006)
            o.shell.box(trim, at(mid.x, fy + 0.12, mid.z) @ rot_y(rr), L_, 0.04, 0.06, bevel=0.005)
            nb2 = max(2, int(L_ / 0.12))
            for k in range(1, nb2):
                pk = pa + d * (k / nb2)
                o.shell.box(trim, at(pk.x, fy + 0.52, pk.z), 0.035, 0.76, 0.035, skip=(2, 3))
            o.col((mid.x, fy + 0.5, mid.z), (L_, 1.0, 0.1), rr)
        xa, xb = pcx - pw / 2 + 0.16, pcx + pw / 2 - 0.16
        if door_at - 0.7 - xa > 0.4:
            rail(V(xa, 0, zp), V(door_at - 0.7, 0, zp))
        if xb - (door_at + 0.7) > 0.4:
            rail(V(door_at + 0.7, 0, zp), V(xb, 0, zp))
        for xs in (pcx - pw / 2 + 0.1, pcx + pw / 2 - 0.1):
            rail(V(xs, 0, zf + 0.06), V(xs, 0, zp - 0.06))


# ------------------------------------------------------------------------------ garage, props

def garage(name, seed, w=6.5, d=7.5, ext="corrugated", door_up=1.0, workshop=False, abandoned=0.3):
    """A garage on a slab: walls of corrugated iron on a frame (or lapped siding), lined with
    boards inside, a wide doorway at the front with a roll-up door (all the way up, part way,
    or down), a side door and a window, a rusted iron gable roof on purlins open to the inside
    with ties across, an oil stain where the car stands."""
    r = random.Random(seed)
    o = Out(name)
    x0, x1, z0, z1 = -w / 2, w / 2, -d / 2, d / 2
    y = 0.12
    h = 3.0
    t = 0.14
    o.floor_y = y
    sheet = ext == "corrugated"
    o.shell.box(None, at(0, (y - 0.3) / 2, 0), w + t + 0.08, y + 0.3, d + t + 0.08, bevel=0.012, mats=["concrete", "concrete", "garageFloor", "concrete", "concrete", "concrete"])
    o.col((0, y - 0.1, 0), (w + t, 0.2, d + t), surface="concrete")
    gap = dict(at=w / 2, w=3.2, bottom=0, top=2.7, type="gap")
    side_door = dict(at=d * 0.7, w=0.9, bottom=0, top=2.03, type="door")
    win = dict(at=d * 0.5, w=1.0, bottom=1.1, top=2.0, type="window")
    defs = [("front", (x0, z1), (x1, z1), True, [gap]), ("back", (x1, z0), (x0, z0), True, []), ("left", (x0, z0), (x0, z1), False, [side_door]), ("right", (x1, z1), (x1, z0), False, [win])]
    walls = []
    for side, a, b, full, ops in defs:
        wl = Wall(a, b)
        walls.append(wl)
        s_min, s_max = (-t / 2, wl.L + t / 2) if full else (t / 2, wl.L - t / 2)
        wall_core(o, wl, y, h, t, ops, "planks", "planks", s_min, s_max)
        if sheet:
            # vertical sheets of iron over the frame, round the openings
            for s0, s1, y0, y1 in pieces(-t / 2 - 0.012, wl.L + t / 2 + 0.012, h + 0.02, ops):
                if s1 - s0 < 0.05 or y1 - y0 < 0.05:
                    continue
                m = wl.m((s0 + s1) / 2, y + (y0 + y1) / 2 - 0.02, t / 2 + 0.012) @ rot_x(math.pi / 2)
                o.shell.corrugated("corrugated", m, s1 - s0, y1 - y0)
        else:
            siding(o, wl, y, h, ops, ext, -t / 2 - CLAD, wl.L + t / 2 + CLAD)
        for op in ops:
            if op["type"] == "window":
                window(o, wl, y, op, r, "trimDark", abandoned * 0.6, False, clad=not sheet, mullions=True)
            elif op["type"] == "door":
                doorway(o, wl, y, op, "trimDark", "planks", True, t, clad=not sheet, open_=0.0)
            else:
                doorway(o, wl, y, op, "trimDark", None, True, t, clad=not sheet, leaf=False)
    # corner trim over the ends of the sheets
    for wl in walls:
        for sv, sg in ((-t / 2 - 0.02, 1), (wl.L + t / 2 + 0.02, -1)):
            o.shell.box("trimDark", wl.m(sv + sg * 0.05, y + h / 2, t / 2 + 0.03), 0.1, h, 0.02, bevel=0.003)
    # the roll-up door: its drum over the opening inside, the slats down as far as it is shut
    fw = walls[0]
    o.shell.box("metalPainted", fw.m(gap["at"], y + 2.92, -0.28), 3.4, 0.36, 0.36, bevel=0.03)
    shut = 1.0 - door_up
    slats = max(1, int(round((2.7 * shut + 0.36) / 0.09)))
    for k in range(slats):
        yy = y + 2.7 - 0.045 - k * 0.09
        if yy < y + 0.05:
            break
        o.shell.box("metalWhite", fw.m(gap["at"], yy, -0.06) @ rot_x(0.08), 3.18, 0.088, 0.02, bevel=0.004)
    if shut > 0.5:
        o.col((0, y + 1.35, z1 - 0.06), (3.2, 2.7, 0.05), 0)
    # the roof, and ties across under it
    plan = dict(x0=x0, x1=x1, z0=z0, z1=z1)
    S = dict(ext="corrugated" if sheet else ext, roof="corrugatedRust", trim="trimDark")
    gable_roof(o, r, plan, y + h + 0.03, 0.28, S, abandoned, False, extras=False, over=0.3)
    along_x = w >= d
    for k in range(1, 4):
        if along_x:
            xk = x0 + k * w / 4
            o.shell.box("woodDark", at(xk, y + h - 0.05, 0), 0.05, 0.14, d - t, bevel=0.004)
        else:
            zk = z0 + k * d / 4
            o.shell.box("woodDark", at(0, y + h - 0.05, zk), w - t, 0.14, 0.05, bevel=0.004)
    # an oil stain where the car stood, a bulb over it
    pts = [V(0.2 + math.cos(a) * (0.9 + 0.15 * math.sin(a * 3)), y + 0.003, 0.3 + math.sin(a) * (0.7 + 0.1 * math.cos(a * 5))) for a in (k / 20 * 2 * math.pi for k in range(20))]
    o.shell.poly("blackMatte", pts, V(0, 1, 0))
    o.shell.cylinder("metalPainted", at(0, y + h - 0.02, 0), 0.05, 0.08, seg=10)
    o.glass.cylinder("glass", at(0, y + h - 0.12, 0), 0.04, 0.1, seg=12)
    o.lights.append(dict(pos=[0, y + h - 0.15, 0], kind="bulb"))
    o.rooms.append(dict(type="garage", x0=x0, z0=z0, x1=x1, z1=z1))
    o.car_spot = [0.0, 0.4]
    o.footprint = (w + 1, d + 1)
    return o


def mailbox(name):
    """A rural mailbox on a post: flat sides and a round top, the door at the road end (+z) with
    its latch, the red flag down on its pivot."""
    o = Out(name)
    o.shell.box("woodDark", at(0, 0.55, 0), 0.09, 1.1, 0.09, bevel=0.008)
    o.shell.box("woodDark", at(0, 1.03, 0.02), 0.17, 0.04, 0.52, bevel=0.006)
    o.shell.box("metalPainted", at(0, 1.1, 0.02), 0.25, 0.12, 0.48, bevel=0.004, skip=(2,))
    half_cyl = Part("t")
    o.shell.cylinder("metalPainted", at(0, 1.16, 0.02) @ rot_x(math.pi / 2), 0.125, 0.48, seg=20, caps=False)
    # the door: a flat plate shaped like the box's end, proud by a little
    door = [V(0.13, 1.04, 0.265), V(-0.13, 1.04, 0.265)] + [V(math.cos(a) * 0.13, 1.16 + math.sin(a) * 0.13, 0.265) for a in (math.pi - k / 12 * math.pi for k in range(13))]
    o.shell.poly("metalPainted", door, V(0, 0, 1))
    back = [V(0.125, 1.04, -0.22), V(-0.125, 1.04, -0.22)] + [V(math.cos(a) * 0.125, 1.16 + math.sin(a) * 0.125, -0.22) for a in (math.pi - k / 12 * math.pi for k in range(13))]
    o.shell.poly("metalPainted", list(reversed(back)), V(0, 0, -1))
    o.shell.box("metal", at(0, 1.27, 0.275), 0.05, 0.024, 0.014, bevel=0.003)
    o.shell.box("metalRed", at(0.135, 1.13, 0.1), 0.012, 0.022, 0.24, bevel=0.003)
    o.shell.box("metalRed", at(0.135, 1.13, -0.03), 0.012, 0.09, 0.07, bevel=0.003)
    o.shell.cylinder("metal", at(0.13, 1.13, 0.2) @ rot_z(math.pi / 2), 0.012, 0.02, seg=8)
    o.col((0, 0.55, 0), (0.1, 1.1, 0.1))
    o.col((0, 1.15, 0.02), (0.26, 0.26, 0.5))
    o.footprint = (0.4, 0.6)
    return o


def fence_section(name, length=2.5, h=1.2):
    """A run of post-and-rail fence: the post at its start, two rails on to the next post."""
    o = Out(name)
    o.shell.box("woodDark", at(0, h / 2 - 0.15, 0), 0.1, h + 0.3, 0.1, bevel=0.008)
    o.shell.box("woodDark", at(0, h + 0.005, 0), 0.12, 0.02, 0.12, bevel=0.005)
    for yy in (h * 0.35, h * 0.8):
        o.shell.box("wood", at(length / 2, yy, 0.065), length, 0.09, 0.03, bevel=0.005, frame=(V(1, 0, 0), V(0, 1, 0)))
    o.col((length / 2, h / 2, 0.03), (length, h, 0.12))
    o.footprint = (length, 0.2)
    return o


def fence_post(name, h=1.2):
    o = Out(name)
    o.shell.box("woodDark", at(0, h / 2 - 0.15, 0), 0.1, h + 0.3, 0.1, bevel=0.008)
    o.shell.box("woodDark", at(0, h + 0.005, 0), 0.12, 0.02, 0.12, bevel=0.005)
    o.col((0, h / 2, 0), (0.1, h, 0.1))
    return o



# ------------------------------------------------------------------------------ catalogue

def catalogue():
    """Every building variant: name -> builder."""
    cat = {}
    for style, n in (("siding", 2), ("sidingYellow", 1), ("sidingGreen", 1), ("brick", 1), ("stucco", 1), ("stuccoFlat", 1), ("adobe", 1)):
        for v in range(n):
            for state, ab in (("kept", 0.1), ("old", 0.75)):
                name = f"house_{style}_{v}_{state}"
                cat[name] = (lambda name=name, style=style, v=v, ab=ab: house(name, zlib.crc32(f"house/{style}/{v}".encode()), style, ab))
    cat["workshop"] = lambda: garage("workshop", 11, 8, 9, "corrugated", 1.0, True, 0.2)
    cat["garage_iron"] = lambda: garage("garage_iron", 21, 5.5, 6.5, "corrugated", 0.55, False, 0.7)
    cat["garage_siding"] = lambda: garage("garage_siding", 31, 5.5, 6.5, "siding", 1.0, False, 0.6)
    cat["garage_shut"] = lambda: garage("garage_shut", 41, 6.0, 7.0, "sidingGreen", 0.0, False, 0.7)
    cat["mailbox"] = lambda: mailbox("mailbox")
    cat["fence"] = lambda: fence_section("fence")
    cat["fence_post"] = lambda: fence_post("fence_post")
    return cat


# ------------------------------------------------------------------------------ export

def export(o, out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = [o.shell.to_object("shell")]
    if o.glass.faces:
        objs.append(o.glass.to_object("glass"))
    doors = []
    for i, (p, g, info) in enumerate(o.doors):
        name = f"door_{i}"
        # the leaf built round its hinge: placed by the object's own transform
        ob = p.to_object(name)
        h = info["hinge"]
        ob.location = (h[0], -h[2], h[1])
        ob.rotation_euler = (0, 0, info["rot"])
        if g.faces:
            gob = g.to_object(name + "_glass")
            gob.parent = ob
        objs.append(ob)
        doors.append(dict(info, name=name))
    for ob in bpy.context.scene.objects:
        ob.select_set(True)
    path = os.path.join(out_dir, o.name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format="GLB", export_yup=True, export_materials="EXPORT", export_normals=True)
    tris = o.shell.count() + o.glass.count() + sum(p.count() + g.count() for p, g, _ in o.doors)
    meta = dict(name=o.name, floor_y=o.floor_y, footprint=list(o.footprint), colliders=o.colliders, doors=doors, lights=o.lights, rooms=o.rooms, tris=tris, car_spot=o.car_spot)
    with open(os.path.join(out_dir, o.name + ".json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    print(f"[buildings] {o.name}: {tris} triangles, {len(o.colliders)} colliders, {len(doors)} doors", flush=True)
    if os.environ.get("BUILDINGS_STATS"):
        per = sorted(((sum(len(p) - 2 for p, _, _ in fl), m) for m, fl in o.shell.faces.items()), reverse=True)
        print("   ", ", ".join(f"{m} {n}" for n, m in per), flush=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = argv[0]
    os.makedirs(out, exist_ok=True)
    cat = catalogue()
    names = argv[1:] or list(cat)
    for n in names:
        export(cat[n](), out)


if __name__ == "__main__":
    main()
