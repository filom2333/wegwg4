# Procedural plants for the scatter: grass, shrubs, cacti, yuccas, Joshua trees, dead trees,
# pines, spruces and birches, every variant built from seeded random choices, with a coarser
# model for further off. Leaves and needles are twig cards (tools/blender/twigs.py); bark comes
# from Poly Haven scans (tools/blender/fetch_textures.py) or textures painted here (birch bark,
# cactus skin).
#
#   blender -b --factory-startup --python tools/blender/plants.py -- <out dir> [species...]
#
# Writes <out>/<species>.glb with objects <species>_<v> (and <species>_<v>_mid, a coarser model)
# and the painted textures into <out>/textures/. Every mesh carries:
#   UV0   the material's texture coordinates
#   UV1   wind: x how freely that part sways (0 at the trunk, 1 at a twig tip), y a random phase
#   COLOR a tint per part (colour variation between leaves, the grass's own colour)
# and materials named after what they are (bark_pine, leaf_spruce, cactus_saguaro...), which
# FloraLibrary.cs swaps for the game's own.

import bpy
import math
import os
import random
import sys
import zlib
import numpy as np
from mathutils import Vector, Matrix, Quaternion

UP = Vector((0, 0, 1))


def V(x, y, z):
    return Vector((x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


class Mesh:
    """Triangles with per-corner normal, UV, wind UV and colour, and a material each."""

    def __init__(self):
        self.p, self.n, self.uv, self.w, self.c = [], [], [], [], []
        self.faces = []  # (i, j, k, material)

    def vert(self, p, n, uv, w=(0, 0), c=(1, 1, 1)):
        self.p.append(Vector(p))
        self.n.append(Vector(n).normalized())
        self.uv.append(tuple(uv))
        self.w.append(tuple(w))
        self.c.append(tuple(c))
        return len(self.p) - 1

    def tri(self, a, b, c, mat):
        self.faces.append((a, b, c, mat))

    def quad(self, a, b, c, d, mat):
        self.tri(a, b, c, mat)
        self.tri(a, c, d, mat)

    @property
    def tris(self):
        return len(self.faces)

    # -- pieces --------------------------------------------------------------------------------

    def tube(self, pts, radii, sides, mat, tex_len=1.0, wraps=1, wind=None, phase=0.0, rib=None, c=(1, 1, 1), cap=False, shape=None):
        """A tube along pts with a radius per point; UV u round it (wraps times), v along it in
        tex_len units. wind: sway weight per point. rib: (count, depth) pleats round it."""
        n = len(pts)
        wind = wind or [0.0] * n
        frames = []
        prev_u = None
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            if prev_u is None:
                u = t.cross(V(0.31, 0.77, 0.11)).normalized()
            else:
                u = (prev_u - t * prev_u.dot(t)).normalized()
            prev_u = u
            frames.append((t, u, t.cross(u)))
        along = 0.0
        rings = []
        for i, p in enumerate(pts):
            if i:
                along += (pts[i] - pts[i - 1]).length
            t, u, v = frames[i]
            ring = []
            for k in range(sides + 1):
                a = k / sides * 2 * math.pi
                d = u * math.cos(a) + v * math.sin(a)
                r = radii[i]
                if shape:
                    r *= shape(a, i / max(1, n - 1))
                nrm = d
                if rib:
                    cnt, depth = rib
                    r *= 1 - depth * (0.5 - 0.5 * math.cos(a * cnt))
                    # (the pleats' normal leans with their slope)
                    tang = -u * math.sin(a) + v * math.cos(a)
                    nrm = (d - tang * (depth * 0.5 * cnt * math.sin(a * cnt)) * 0.6).normalized()
                ring.append(self.vert(p + d * r, nrm, (k / sides * wraps, along / tex_len), (wind[i], phase), c))
            rings.append(ring)
        for i in range(n - 1):
            for k in range(sides):
                a, b = rings[i][k], rings[i][k + 1]
                cc, d = rings[i + 1][k + 1], rings[i + 1][k]
                self.quad(a, b, cc, d, mat)
        if cap:
            t = frames[-1][0]
            ci = self.vert(pts[-1] + t * radii[-1] * 0.3, t, (0.5, along / tex_len), (wind[-1], phase), c)
            for k in range(sides):
                self.tri(rings[-1][k], rings[-1][k + 1], ci, mat)

    def card(self, base, axis, face, width, length, mat, normal_of=None, wind=(1.0, 0.0), c=(1, 1, 1), bend=0.0, rows=3):
        """A twig card: its base at `base`, growing along `axis`, facing `face`; the texture's
        bottom middle is the base. normal_of(p) bends the lighting normal toward the crown's
        outside so a crown of cards shades like a rounded mass. bend: the tip droops."""
        axis = axis.normalized()
        side = axis.cross(face).normalized()
        face = side.cross(axis).normalized()
        idx = []
        for j in range(rows + 1):
            t = j / rows
            p = base + axis * (length * t) - face * (bend * length * t * t)
            row = []
            for k, s in enumerate((-0.5, 0.5)):
                q = p + side * (width * s)
                nrm = face
                if normal_of:
                    nrm = (face * 0.45 + normal_of(q) * 0.55).normalized()
                row.append(self.vert(q, nrm, (0.5 + s, t), (wind[0] * (0.6 + 0.4 * t), wind[1]), c))
            idx.append(row)
        for j in range(rows):
            self.quad(idx[j][0], idx[j][1], idx[j + 1][1], idx[j + 1][0], mat)

    def blade(self, base, d, length, width, segs, mat, droop, rnd, uvx, normal_up=0.6, c=(1, 1, 1), fold=0.0, phase=0.0):
        """A grass blade or a long leaf: a tapering strip curving over; UV y 0 at its foot, 1 at
        its tip; normals leaning toward the sky so a tuft lights softly."""
        d = d.normalized()
        side = d.cross(UP)
        if side.length < 1e-3:
            side = V(1, 0, 0)
        side.normalize()
        prev = None
        p = base.copy()
        dd = d.copy()
        step = length / segs
        for i in range(segs + 1):
            t = i / segs
            w = width * (1 - t ** 1.5) * (0.6 + 0.4 * math.sin(math.pi * min(1, t + 0.25)))
            face = side.cross(dd).normalized()
            if face.z < 0:
                face = -face
            nrm = (face * (1 - normal_up) + UP * normal_up).normalized()
            centre = p - face * (fold * w)
            a = self.vert(centre - side * w * 0.5, nrm, (uvx, t), (t * t, phase), c)
            b = self.vert(centre + side * w * 0.5, nrm, (uvx, t), (t * t, phase), c)
            if fold:
                m = self.vert(p, nrm, (uvx, t), (t * t, phase), c)
                cur = (a, m, b)
            else:
                cur = (a, b)
            if prev:
                if fold:
                    self.quad(prev[0], prev[1], cur[1], cur[0], mat)
                    self.quad(prev[1], prev[2], cur[2], cur[1], mat)
                else:
                    self.quad(prev[0], prev[1], cur[1], cur[0], mat)
            prev = cur
            # bend over: the direction tips toward the ground as it goes
            dd = (dd + V(0, 0, -droop * step * 2.2) + side * (rnd.uniform(-0.05, 0.05))).normalized()
            p = p + dd * step

    def object(self, name, materials):
        me = bpy.data.meshes.new(name)
        verts = [tuple(p) for p in self.p]
        faces = [(a, b, c) for a, b, c, _ in self.faces]
        me.from_pydata(verts, [], faces)
        for m in materials:
            me.materials.append(bpy.data.materials.get(m) or new_material(m))
        mats = {m: i for i, m in enumerate(materials)}
        for poly, f in zip(me.polygons, self.faces):
            poly.material_index = mats[f[3]]
            poly.use_smooth = True
        uv0 = me.uv_layers.new(name="UVMap")
        uv1 = me.uv_layers.new(name="wind")
        col = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
        normals = []
        for poly in me.polygons:
            for li, vi in zip(poly.loop_indices, poly.vertices):
                uv0.data[li].uv = self.uv[vi]
                uv1.data[li].uv = self.w[vi]
                c = self.c[vi]
                col.data[li].color = (c[0], c[1], c[2], 1)
                normals.append(self.n[vi])
        me.normals_split_custom_set(normals)
        me.update()
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        return o


def new_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m


# --- shared shapes -------------------------------------------------------------------------------

def limb(rnd, start, direction, length, segs, curl=0.05, droop=0.0, rise=0.0):
    """A wandering branch: points from start, turning a little at random each step, sagging
    (droop) or turning up (rise) as it goes."""
    pts = [start.copy()]
    d = direction.normalized()
    p = start.copy()
    step = length / segs
    for i in range(segs):
        d = (d + V(rnd.uniform(-curl, curl), rnd.uniform(-curl, curl), rnd.uniform(-curl, curl) * 0.5 + rise - droop)).normalized()
        p = p + d * step
        pts.append(p.copy())
    return pts


def at(pts, t):
    """The point a fraction t along a polyline."""
    lens = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    total = sum(lens)
    goal = t * total
    for i, L in enumerate(lens):
        if goal <= L or i == len(lens) - 1:
            return pts[i].lerp(pts[i + 1], min(1, goal / max(L, 1e-6)))
        goal -= L
    return pts[-1].copy()


def dir_at(pts, t):
    i = min(int(t * (len(pts) - 1)), len(pts) - 2)
    return (pts[i + 1] - pts[i]).normalized()


def crown_normal(centre, rx, rz):
    """Normals bent outward from an ellipsoid crown round centre."""
    def f(p):
        d = p - centre
        return V(d.x / rx, d.y / rx, d.z / rz).normalized()
    return f


def jitter(rnd, k=0.12):
    v = rnd.uniform(1 - k, 1 + k)
    return (v, v * rnd.uniform(0.97, 1.03), v * rnd.uniform(0.94, 1.02))


# --- grass ---------------------------------------------------------------------------------------

def tuft(rnd, height, width, blades, mat, segs=4, droop=0.35, lod=0):
    M = Mesh()
    n = blades if not lod else blades // 2
    for i in range(n):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(0, 0.09) * width
        base = V(math.cos(a) * r, math.sin(a) * r, -0.02)
        out = rnd.uniform(0.2, 0.95) * width
        d = V(math.cos(a) * out, math.sin(a) * out, 1)
        L = height * rnd.uniform(0.55, 1.15)
        M.blade(base, d, L, rnd.uniform(0.008, 0.014) * (1 + width * 0.3), segs if not lod else 2, mat, droop * rnd.uniform(0.5, 1.4), rnd, rnd.random(), phase=rnd.random())
    return M


def grass(rnd, v, lod):
    return tuft(rnd, 0.48, 1.0, 46, "grass", lod=lod)


def meadow(rnd, v, lod):
    M = tuft(rnd, 0.78, 0.9, 38, "meadow", segs=5, droop=0.25, lod=lod)
    # a few seed heads on taller stalks
    for i in range(0 if lod else 5):
        a = rnd.uniform(0, 2 * math.pi)
        base = V(math.cos(a) * 0.03, math.sin(a) * 0.03, 0)
        M.blade(base, V(math.cos(a) * 0.2, math.sin(a) * 0.2, 1), rnd.uniform(0.8, 1.05), 0.006, 5, "meadow", 0.12, rnd, 0.97 + rnd.random() * 0.03, phase=rnd.random())
    return M


def snowgrass(rnd, v, lod):
    return tuft(rnd, 0.5, 0.7, 26, "snowgrass", droop=0.45, lod=lod)


def reeds(rnd, v, lod):
    M = tuft(rnd, 1.45, 0.5, 34, "reeds", segs=5, droop=0.08, lod=lod)
    for i in range(0 if lod else 4):
        a = rnd.uniform(0, 2 * math.pi)
        base = V(math.cos(a) * 0.05, math.sin(a) * 0.05, 0)
        top = base + V(math.cos(a) * 0.12, math.sin(a) * 0.12, rnd.uniform(1.4, 1.8))
        stalk = [base, base.lerp(top, 0.5), top]
        M.tube(stalk, [0.005, 0.004, 0.003], 4, "plant", wind=[0, 0.4, 1], phase=rnd.random(), c=(0.42, 0.45, 0.25))
        d = (top - base).normalized()
        M.tube([top, top + d * 0.17], [0.014, 0.014], 6, "plant", wind=[1, 1], phase=rnd.random(), c=(0.36, 0.22, 0.12), cap=True)
    return M


def flowers(rnd, v, lod):
    palettes = [((0.62, 0.32, 0.72), (0.52, 0.28, 0.66)), ((0.95, 0.8, 0.15), (0.95, 0.62, 0.1)), ((0.95, 0.94, 0.9), (0.88, 0.86, 0.92)), ((0.88, 0.22, 0.16), (0.92, 0.5, 0.15))]
    pal = palettes[v % len(palettes)]
    M = tuft(rnd, 0.32, 0.6, 16, "meadow", segs=3, droop=0.3, lod=lod)
    for i in range(5 if lod else 11):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(0.02, 0.16)
        base = V(math.cos(a) * r, math.sin(a) * r, 0)
        top = base + V(rnd.uniform(-0.06, 0.06), rnd.uniform(-0.06, 0.06), rnd.uniform(0.3, 0.5))
        ph = rnd.random()
        M.tube([base, base.lerp(top, 0.5), top], [0.003, 0.0025, 0.002], 3, "plant", wind=[0, 0.3, 1], phase=ph, c=(0.3, 0.42, 0.16))
        # the flower: a ring of petals round a darker heart
        col = pal[i % 2]
        k = rnd.uniform(0.85, 1.1)
        petals = 6
        rr = rnd.uniform(0.022, 0.034)
        heart = M.vert(top + V(0, 0, 0.004), UP, (0.5, 1), (1, ph), (col[0] * 0.5, col[1] * 0.45, col[2] * 0.3))
        rim = []
        for j in range(petals * 2):
            ang = j / (petals * 2) * 2 * math.pi
            rad = rr if j % 2 == 0 else rr * 0.45
            q = top + V(math.cos(ang) * rad, math.sin(ang) * rad, -rad * 0.25)
            rim.append(M.vert(q, (UP + V(math.cos(ang), math.sin(ang), 0) * 0.3), (0.5, 1), (1, ph), (col[0] * k, col[1] * k, col[2] * k)))
        for j in range(len(rim)):
            M.tri(heart, rim[j], rim[(j + 1) % len(rim)], "plant")
    return M


# --- shrubs --------------------------------------------------------------------------------------

def bush(rnd, lod, height, spread, twig, bark, stems=(5, 8), cards=4, card_scale=(0.42, 0.7), width_k=0.9):
    M = Mesh()
    H = height * rnd.uniform(0.75, 1.25)
    centre = V(0, 0, H * 0.55)
    normal_of = crown_normal(centre, H * 0.6 * spread, H * 0.5)
    n = rnd.randint(*stems) if not lod else 3
    for i in range(n):
        az = i / n * 2 * math.pi + rnd.uniform(0, 0.8)
        out = rnd.uniform(0.25, 0.7) * spread
        d = V(math.cos(az) * out, math.sin(az) * out, 1)
        L = H * rnd.uniform(0.55, 1.0)
        pts = limb(rnd, V(rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), -0.05), d, L, 3, curl=0.3)
        ph = rnd.random()
        if not lod:
            M.tube(pts, [0.028, 0.018, 0.012, 0.005], 4, bark, tex_len=0.4, wind=[0, 0.2, 0.5, 0.8], phase=ph)
        nc = cards if not lod else 2
        for c in range(nc):
            t = 0.3 + 0.7 * (c + rnd.random() * 0.6) / nc
            p = at(pts, t)
            dd = (dir_at(pts, t) + V(rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7), rnd.uniform(0.2, 0.6))).normalized()
            L2 = H * rnd.uniform(*card_scale) * (1.35 if lod else 1)
            # (cards lean outward and lie fairly flat, so the bush reads round from any side)
            face = (normal_of(p) + V(rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(0.2, 0.8))).normalized()
            M.card(p, dd, face, L2 * ASPECT[twig], L2, twig, normal_of, wind=(0.8, rnd.random()), c=jitter(rnd), bend=0.08, rows=2)
    return M


def shrub(rnd, v, lod):
    return bush(rnd, lod, 1.0, 1.1, "leaf_sage", "bark_grey", stems=(7, 10), cards=8, card_scale=(0.5, 0.78))


def tundrashrub(rnd, v, lod):
    return bush(rnd, lod, 0.7, 1.4, "leaf_dwarfbirch", "bark_grey", stems=(5, 7), cards=5, card_scale=(0.5, 0.8))


# --- desert succulents ---------------------------------------------------------------------------

def rosette(M, rnd, base, up, leaves, length, width, col, dead=0.0, spread=0.9, phase=0.0, wind=0.3, segs=3, fold=0.35):
    """A ball of stiff sword leaves round `base`, the youngest pointing up, the old ones out and
    (dead) hanging down brown."""
    up = up.normalized()
    side = up.cross(V(0.3, 0.7, 0.2)).normalized()
    other = up.cross(side)
    for i in range(leaves):
        f = i / leaves
        ang = i * 2.39996
        tilt = (1 - f) * spread * 1.4 + 0.05
        d = (up * math.cos(tilt) + (side * math.cos(ang) + other * math.sin(ang)) * math.sin(tilt)).normalized()
        L = length * rnd.uniform(0.75, 1.1) * (0.7 + 0.3 * f)
        c = col
        droop = 0.02
        if dead and f < dead:
            c = (0.42, 0.33, 0.22)
            d = (d + V(0, 0, -1.2)).normalized()
            droop = 0.0
        k = rnd.uniform(0.85, 1.12)
        M.blade(base, d, L, width * rnd.uniform(0.8, 1.2), segs, "plant", droop, rnd, 0.5, normal_up=0.25, c=(c[0] * k, c[1] * k, c[2] * k), fold=fold, phase=phase)


def yucca(rnd, v, lod):
    M = Mesh()
    # a short trunk (or none) under a dense rosette, now and then a dry flower stalk
    trunk_h = rnd.uniform(0.0, 0.5) if v != 1 else rnd.uniform(0.6, 1.1)
    top = V(0, 0, trunk_h)
    if trunk_h > 0.05:
        pts = [V(0, 0, -0.05), V(0.02, 0, trunk_h * 0.5), top]
        M.tube(pts, [0.09, 0.08, 0.07], 6, "bark_grey", tex_len=0.5)
        # the skirt of dead leaves down the trunk
        rosette(M, rnd, top - V(0, 0, trunk_h * 0.3), UP, 22 if not lod else 8, 0.45, 0.022, (0.45, 0.36, 0.24), dead=1.0)
    rosette(M, rnd, top, UP, 70 if not lod else 26, 0.62, 0.03, (0.38, 0.48, 0.22), dead=0.25 if trunk_h < 0.05 else 0.0, phase=rnd.random())
    if v == 2 and not lod:
        stalk = [top, top + V(0.03, 0.02, 0.9), top + V(0.05, 0.03, 1.8)]
        M.tube(stalk, [0.022, 0.016, 0.01], 5, "plant", wind=[0, 0.3, 0.8], c=(0.5, 0.42, 0.28))
        for j in range(18):
            t = 0.55 + 0.45 * rnd.random()
            p = at(stalk, t)
            M.tube([p, p + V(rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), rnd.uniform(0.0, 0.08))], [0.012, 0.004], 4, "plant", wind=[0.8, 1], c=(0.6, 0.5, 0.32), cap=True)
    return M


def barrel(rnd, v, lod):
    """A barrel cactus: a squat ribbed drum, often leaning south, a crown of yellow fruit."""
    M = Mesh()
    H = rnd.uniform(0.55, 0.9)
    R = H * rnd.uniform(0.36, 0.44)
    lean = V(rnd.uniform(-0.15, 0.15), rnd.uniform(0.0, 0.2), 1).normalized()
    n = 9 if not lod else 5
    pts, radii = [], []
    for i in range(n + 1):
        t = i / n
        pts.append(lean * (H * t) - V(0, 0, 0.04))
        top = max(0.0, (t - 0.72) / 0.28)
        radii.append(R * (0.94 + 0.08 * math.sin(math.pi * t)) * math.sqrt(max(0.0, 1 - top * top * 0.92)))
    ribs = 18 if v == 0 else 21
    M.tube(pts, radii, ribs * 2 if not lod else ribs, "cactus_barrel", tex_len=H, wraps=ribs, rib=(ribs, 0.14), cap=True)
    if not lod:
        top = pts[-1]
        for j in range(9):
            a = j / 9 * 2 * math.pi
            q = top + V(math.cos(a), math.sin(a), 0) * R * 0.25
            M.tube([q, q + V(0, 0, 0.035)], [0.018, 0.012], 5, "plant", c=(0.85, 0.72, 0.18), cap=True)
    return M


def saguaro(rnd, v, lod):
    """A saguaro: a pleated column with arms that leave it level and turn up, J-shaped."""
    M = Mesh()
    H = rnd.uniform(6.0, 9.0)
    R = rnd.uniform(0.2, 0.26)
    sides = 36 if not lod else 18
    ribs = 18 if not lod else 9

    def column(base, d, L, r0, segs, turn=None):
        pts, radii = [], []
        p = base.copy()
        dd = d.normalized()
        step = L / segs
        for i in range(segs + 1):
            t = i / segs
            pts.append(p.copy())
            radii.append(r0 * (1.0 if t < 0.85 else 1 - (t - 0.85) / 0.15 * 0.45))
            if turn:
                dd = (dd + turn * step).normalized()
            p = p + dd * step
        M.tube(pts, radii, sides, "cactus_saguaro", tex_len=0.9, wraps=ribs, rib=(ribs, 0.1), cap=True, wind=[0] * len(pts))
        return pts

    trunk = column(V(0, 0, -0.1), V(rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), 1), H, R, 12 if not lod else 6)
    arms = [0, 2, 3, 2][v % 4] + rnd.randint(0, 1)
    for k in range(arms):
        t = rnd.uniform(0.35, 0.6)
        p = at(trunk, t)
        a = k / max(1, arms) * 2 * math.pi + rnd.uniform(-0.6, 0.6)
        out = V(math.cos(a), math.sin(a), 0)
        r = R * rnd.uniform(0.7, 0.85)
        # out level, then a bend up, then up
        elbow = [p + out * (R * 0.6)]
        L1 = rnd.uniform(0.35, 0.7)
        steps = 8 if not lod else 4
        pts = []
        q = elbow[0].copy()
        d = out.copy()
        for i in range(steps + 1):
            pts.append(q.copy())
            f = i / steps
            d = (out * (1 - f) + UP * f).normalized()
            q = q + d * (L1 + 0.6) / steps
        rad = [r] * len(pts)
        M.tube(pts, rad, sides // 2 + 2, "cactus_saguaro", tex_len=0.9, wraps=ribs // 2, rib=(ribs // 2, 0.1))
        column(pts[-1], UP, (H * (1 - t)) * rnd.uniform(0.35, 0.65), r, 6 if not lod else 3)
    return M


def ocotillo(rnd, v, lod):
    """An ocotillo: a fountain of long spiny canes from one root crown, red flower tips."""
    M = Mesh()
    canes = rnd.randint(14, 24) if not lod else 7
    for i in range(canes):
        a = rnd.uniform(0, 2 * math.pi)
        out = rnd.uniform(0.1, 0.45)
        d = V(math.cos(a) * out, math.sin(a) * out, 1)
        L = rnd.uniform(2.5, 5.0)
        pts = limb(rnd, V(math.cos(a) * 0.04, math.sin(a) * 0.04, -0.05), d, L, 6 if not lod else 3, curl=0.04)
        ph = rnd.random()
        w = [(j / (len(pts) - 1)) ** 1.5 for j in range(len(pts))]
        M.tube(pts, [lerp(0.03, 0.01, j / (len(pts) - 1)) for j in range(len(pts))], 5, "bark_ocotillo", tex_len=0.6, wind=w, phase=ph)
        if not lod:
            # small leaves along the cane after the rains, a red flower spike at the tip
            for j in range(10):
                t = rnd.uniform(0.2, 0.92)
                p = at(pts, t)
                dd = (dir_at(pts, t) + V(rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0.2)).normalized()
                M.blade(p, dd, 0.05, 0.02, 1, "plant", 0.0, rnd, 0.5, normal_up=0.4, c=(0.32, 0.44, 0.16), phase=ph)
            tip = pts[-1]
            M.tube([tip, tip + dir_at(pts, 1.0) * 0.18], [0.02, 0.006], 5, "plant", wind=[1, 1], phase=ph, c=(0.78, 0.2, 0.1), cap=True)
    return M


def joshua(rnd, v, lod):
    """A Joshua tree: a shaggy trunk forking into crooked arms, each ending in a ball of
    dagger leaves over a skirt of dead ones."""
    M = Mesh()
    H = rnd.uniform(3.5, 6.0)

    def arm(p, d, L, r, depth, wind0):
        pts = limb(rnd, p, d, L, 4 if not lod else 2, curl=0.25, rise=0.05)
        ws = [lerp(wind0, wind0 + 0.25, j / (len(pts) - 1)) for j in range(len(pts))]
        M.tube(pts, [r * (1 - 0.25 * j / (len(pts) - 1)) for j in range(len(pts))], 7 if not lod else 5, "bark_joshua", tex_len=0.8, wind=ws)
        end = pts[-1]
        if depth == 0 or rnd.random() < 0.2:
            leaves = 56 if not lod else 18
            rosette(M, rnd, end, dir_at(pts, 1.0) + V(0, 0, 0.6), leaves, 0.42, 0.022, (0.42, 0.5, 0.24), dead=0.3, spread=1.0, phase=rnd.random(), segs=2 if not lod else 1, fold=0.0)
            return
        n = rnd.randint(2, 3)
        for k in range(n):
            a = k / n * 2 * math.pi + rnd.uniform(-0.5, 0.5)
            dd = (dir_at(pts, 1.0) * 0.6 + V(math.cos(a), math.sin(a), 0.5)).normalized()
            arm(end, dd, L * rnd.uniform(0.55, 0.8), r * 0.72, depth - 1, wind0 + 0.25)

    trunk_h = H * rnd.uniform(0.35, 0.5)
    trunk = limb(rnd, V(0, 0, -0.1), V(rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1), 1), trunk_h, 4, curl=0.12)
    M.tube(trunk, [0.3, 0.25, 0.22, 0.21, 0.2], 9 if not lod else 6, "bark_joshua", tex_len=0.8)
    n = rnd.randint(2, 4)
    for k in range(n):
        a = k / n * 2 * math.pi + rnd.uniform(-0.4, 0.4)
        d = V(math.cos(a), math.sin(a), rnd.uniform(0.6, 1.2))
        arm(trunk[-1], d, H * rnd.uniform(0.2, 0.3), 0.16, 2 if not lod else 1, 0.15)
    return M


# --- trees ---------------------------------------------------------------------------------------

def taper(n, r0, r1, k=1.0):
    return [lerp(r0, r1, (i / (n - 1)) ** k) for i in range(n)]


def deadtree(rnd, v, lod):
    """A dead tree: a twisted grey trunk and a few broken, crooked limbs."""
    M = Mesh()
    H = rnd.uniform(4.0, 7.0)
    trunk = limb(rnd, V(0, 0, -0.2), V(rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), 1), H, 8 if not lod else 4, curl=0.12)
    rad = taper(len(trunk), 0.24, 0.05, 0.8)
    rad[0] *= 1.45
    M.tube(trunk, rad, 8 if not lod else 5, "bark_dead", tex_len=1.2)

    def branch(p, d, L, r, depth, w0):
        pts = limb(rnd, p, d, L, 4 if not lod else 2, curl=0.3, rise=0.04)
        M.tube(pts, taper(len(pts), r, r * 0.3), 5 if not lod else 4, "bark_dead", tex_len=1.0, wind=[lerp(w0, w0 + 0.3, j / (len(pts) - 1)) for j in range(len(pts))])
        if depth > 0:
            for k in range(rnd.randint(1, 3)):
                t = rnd.uniform(0.4, 0.9)
                dd = (dir_at(pts, t) + V(rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0, 0.8))).normalized()
                branch(at(pts, t), dd, L * rnd.uniform(0.4, 0.65), r * 0.55, depth - 1, w0 + 0.3)

    nb = rnd.randint(3, 6) if not lod else 3
    for k in range(nb):
        t = rnd.uniform(0.35, 0.92)
        a = rnd.uniform(0, 2 * math.pi)
        d = V(math.cos(a), math.sin(a), rnd.uniform(0.2, 1.0))
        branch(at(trunk, t), d, H * rnd.uniform(0.25, 0.45), 0.08 * (1.2 - t), 2 if not lod else 1, 0.2)
    return M


# twig pictures' width for their height (tools/blender/twigs.py ASPECT)
ASPECT = {"leaf_pine": 0.5, "leaf_spruce": 1.0, "leaf_birch": 0.75, "leaf_birch_autumn": 0.75, "leaf_sage": 0.75, "leaf_dwarfbirch": 0.625, "leaf_bare": 0.75}


def spray(M, twig, base, axis, face, size, normal_of, ph, rnd, bend=0.1, rows=2):
    M.card(base, axis, face, size * ASPECT[twig], size, twig, normal_of, wind=(0.85, ph), c=jitter(rnd, 0.1), bend=bend, rows=rows)


def conifer(rnd, v, lod, spruce, twig):
    """A spruce (a cone of drooping branches from near the ground up, each one thick with flat
    sprays) or a pine (a tall bare trunk, a high crown of upturned limbs ending in tufts)."""
    M = Mesh()
    H = rnd.uniform(13, 19) if spruce else rnd.uniform(15, 21)
    lean = V(rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), 1)
    trunk = limb(rnd, V(0, 0, -0.3), lean, H + 0.3, 12 if not lod else 5, curl=0.02)
    r0 = H * (0.024 if spruce else 0.022)
    rad = [r0 * (1 - 0.92 * (i / (len(trunk) - 1)) ** 0.9) + 0.02 for i in range(len(trunk))]
    rad[0] *= 1.3
    bark = "bark_spruce" if spruce else "bark_pine"
    M.tube(trunk, rad, 10 if not lod else 6, bark, tex_len=r0 * 6, wraps=2, wind=[0.15 * (i / (len(trunk) - 1)) ** 2 for i in range(len(trunk))])
    crown0 = rnd.uniform(0.05, 0.12) if spruce else rnd.uniform(0.45, 0.58)
    centre = V(0, 0, H * (0.42 if spruce else 0.74))
    normal_of = crown_normal(centre, H * (0.3 if spruce else 0.28), H * (0.5 if spruce else 0.3))
    step = (0.62 if spruce else 0.95) * (1.6 if lod else 1)
    y = crown0 * H
    while y < H - 0.5:
        t = (y / H - crown0) / (1 - crown0)
        p0 = at(trunk, y / (H + 0.3))
        if spruce:
            n = rnd.randint(5, 6) if not lod else 4
            for k in range(n):
                a = k / n * 2 * math.pi + rnd.uniform(-0.35, 0.35) + y * 1.7
                out = V(math.cos(a), math.sin(a), 0)
                L = H * 0.3 * (1 - t) ** 1.05 * rnd.uniform(0.85, 1.15) + 0.45
                d = (out + V(0, 0, rnd.uniform(-0.35, -0.1))).normalized()
                pts = limb(rnd, p0, d, L, 3 if not lod else 2, curl=0.05, rise=0.12)
                ph = rnd.random()
                # (the short branches up top are hidden in their sprays)
                if L > (1.0 if not lod else 2.0):
                    br = max(0.02, r0 * 0.22 * (1 - t * 0.6))
                    M.tube(pts[:-1] if len(pts) > 2 else pts, taper(len(pts) - 1 if len(pts) > 2 else len(pts), br, br * 0.4), 4, bark, tex_len=0.8, wind=[lerp(0.15, 0.6, j / max(1, len(pts) - 2)) for j in range(len(pts) - 1 if len(pts) > 2 else len(pts))], phase=ph)
                # flat sprays along the branch, in pairs splayed either side and turned to the sky
                gap = 0.52 if not lod else 1.0
                f = 0.12
                while f < 1.0:
                    q = at(pts, f)
                    bd = dir_at(pts, f)
                    side = bd.cross(UP).normalized()
                    size = rnd.uniform(0.8, 1.05) * (0.7 + 0.45 * (1 - t)) * (1.45 if lod else 1)
                    for sd in ((-1, 1) if not lod else (rnd.choice((-1, 1)),)):
                        dd = (bd + side * sd * rnd.uniform(0.35, 0.75) + V(0, 0, rnd.uniform(0.0, 0.2))).normalized()
                        # (turned out from the trunk as much as up, so the cone is full seen from the side too)
                        face = (UP * 0.8 + out * rnd.uniform(0.55, 0.9) + side * sd * rnd.uniform(0.1, 0.4)).normalized()
                        spray(M, twig, q - dd * size * 0.1, dd, face, size, normal_of, ph, rnd, bend=0.12, rows=2 if not lod and size > 0.85 else 1)
                    f += gap / max(L, 0.5)
                # and one along the tip
                spray(M, twig, pts[-1] - bd * 0.2, bd + V(0, 0, 0.15), UP, rnd.uniform(0.75, 1.0) * (1.4 if lod else 1), normal_of, ph, rnd, rows=1)
        else:
            n = rnd.randint(3, 4) if not lod else 3
            for k in range(n):
                a = k / n * 2 * math.pi + rnd.uniform(-0.4, 0.4) + y * 1.7
                out = V(math.cos(a), math.sin(a), 0)
                L = H * 0.2 * math.sin(math.pi * min(1, t * 0.85 + 0.2)) * rnd.uniform(0.75, 1.2) + 0.5
                d = (out + V(0, 0, rnd.uniform(0.3, 0.7))).normalized()
                pts = limb(rnd, p0, d, L, 3 if not lod else 2, curl=0.1, rise=0.1)
                ph = rnd.random()
                br = max(0.03, r0 * 0.32 * (1 - t * 0.6))
                M.tube(pts, taper(len(pts), br, br * 0.3), 5 if not lod else 4, "bark_pine", tex_len=0.8, wind=[lerp(0.15, 0.7, j / (len(pts) - 1)) for j in range(len(pts))], phase=ph)
                tips = [(pts[-1], dir_at(pts, 1.0))]
                # a few side shoots on the outer half, each with its own tuft
                for j in range(rnd.randint(2, 3) if not lod else 1):
                    f = rnd.uniform(0.45, 0.85)
                    q = at(pts, f)
                    sd = (dir_at(pts, f) + V(rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0.2, 0.8))).normalized()
                    sp = limb(rnd, q, sd, L * rnd.uniform(0.25, 0.4), 2, curl=0.1, rise=0.1)
                    if not lod:
                        M.tube(sp, [br * 0.45, br * 0.2, br * 0.12], 4, "bark_pine", tex_len=0.6, wind=[0.6, 0.75, 0.85], phase=ph)
                    tips.append((sp[-1], dir_at(sp, 1.0)))
                # tufts: a ball of needle cards round each tip, pointing out and up
                for q, td in tips:
                    m = rnd.randint(4, 6) if not lod else 2
                    for c in range(m):
                        ang = c / m * 2 * math.pi + rnd.uniform(-0.3, 0.3)
                        side = td.cross(UP)
                        if side.length < 1e-3:
                            side = V(1, 0, 0)
                        side.normalize()
                        other = td.cross(side).normalized()
                        dd = (td * 0.9 + (side * math.cos(ang) + other * math.sin(ang)) * 0.9 + V(0, 0, 0.35)).normalized()
                        face = (side * -math.sin(ang) + other * math.cos(ang)).normalized()
                        size = rnd.uniform(0.95, 1.3) * (1.4 if lod else 1)
                        spray(M, twig, q - dd * size * 0.25, dd, face, size, normal_of, ph, rnd, bend=0.04, rows=1)
        y += step * rnd.uniform(0.85, 1.15)
    # the leader: a few sprays round the very top
    for k in range(4 if not lod else 2):
        p = at(trunk, 0.93 + k * 0.015)
        a = k * 1.7 + rnd.uniform(-0.3, 0.3)
        dd = V(math.cos(a) * 0.5, math.sin(a) * 0.5, 1).normalized()
        face = V(math.cos(a + 1.5), math.sin(a + 1.5), 0)
        spray(M, twig, p, dd, face, 0.9, normal_of, rnd.random(), rnd, rows=1)
    return M


def pine(rnd, v, lod):
    return conifer(rnd, v, lod, spruce=(v % 2 == 0), twig="leaf_spruce" if v % 2 == 0 else "leaf_pine")


def snowpine(rnd, v, lod):
    return conifer(rnd, v, lod, spruce=(v != 3), twig="leaf_spruce" if v != 3 else "leaf_pine")


def broadleaf(rnd, v, lod, twig):
    """A birch: a slender white trunk, often leaning, branches climbing then arching over with
    side twigs, leaf cards hanging along their outer two thirds."""
    M = Mesh()
    H = rnd.uniform(10, 15)
    lean = V(rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), 1)
    trunk = limb(rnd, V(0, 0, -0.3), lean, H * 0.9, 10 if not lod else 5, curl=0.05)
    r0 = H * 0.017
    M.tube(trunk, taper(len(trunk), r0, r0 * 0.25, 0.9), 9 if not lod else 6, "bark_birch", tex_len=1.2, wraps=1, wind=[0.2 * (i / (len(trunk) - 1)) ** 2 for i in range(len(trunk))])
    centre = V(0, 0, H * 0.64)
    normal_of = crown_normal(centre, H * 0.24, H * 0.34)
    nb = rnd.randint(10, 13) if not lod else 7
    for k in range(nb):
        t = rnd.uniform(0.34, 0.9)
        p = at(trunk, t)
        a = k * 2.39996 + rnd.uniform(-0.3, 0.3)
        d = V(math.cos(a), math.sin(a), rnd.uniform(0.7, 1.5))
        L = H * rnd.uniform(0.2, 0.32) * (1.15 - t * 0.5)
        pts = limb(rnd, p, d, L, 4 if not lod else 2, curl=0.12, droop=0.08)
        ph = rnd.random()
        M.tube(pts, taper(len(pts), r0 * 0.33, 0.012), 5 if not lod else 4, "bark_birch", tex_len=0.8, wind=[lerp(0.2, 0.75, j / (len(pts) - 1)) for j in range(len(pts))], phase=ph)
        shoots = [pts]
        for j in range(rnd.randint(2, 3) if not lod else 0):
            f = rnd.uniform(0.35, 0.8)
            q = at(pts, f)
            sd = (dir_at(pts, f) + V(rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.2, 0.6))).normalized()
            sp = limb(rnd, q, sd, L * rnd.uniform(0.3, 0.5), 2, curl=0.15, droop=0.12)
            M.tube(sp, [r0 * 0.12, r0 * 0.06, 0.006], 3, "bark_birch", tex_len=0.6, wind=[0.6, 0.8, 0.9], phase=ph)
            shoots.append(sp)
        for sp in shoots:
            nc = (rnd.randint(5, 7) if sp is pts else rnd.randint(3, 4)) if not lod else 4
            for c in range(nc):
                f = 0.3 + 0.7 * (c + rnd.random()) / nc
                q = at(sp, f)
                dd = (dir_at(sp, f) * 0.6 + V(rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7), rnd.uniform(-0.8, 0.3))).normalized()
                face = (dd.cross(V(rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0.3))).normalized()
                size = rnd.uniform(1.1, 1.6) * (1.45 if lod else 1)
                spray(M, twig, q - dd * size * 0.1, dd, face, size, normal_of, ph, rnd, bend=0.18, rows=2 if not lod else 1)
    return M


def birch(rnd, v, lod):
    return broadleaf(rnd, v, lod, "leaf_birch_autumn" if v == 2 else "leaf_birch")


def birchbare(rnd, v, lod):
    return broadleaf(rnd, v, lod, "leaf_bare")


def hoodoo(rnd, v, lod):
    """A hoodoo: a column of soft banded stone pinched at its weak layers, standing on the talus
    it sheds, under a cap of harder rock that keeps it from washing away."""
    M = Mesh()
    H = rnd.uniform(3.6, 5.6)
    r0 = rnd.uniform(0.6, 0.78)
    sides = 18 if not lod else 9
    ph = [rnd.uniform(0, 6.28) for _ in range(6)]

    def lumpy(k):
        # irregular round the column, more so at its foot
        return lambda a, t: 1 + k * (0.12 * math.sin(a * 3 + ph[0]) + 0.08 * math.sin(a * 5 + ph[1] + t * 4) + 0.05 * math.sin(a * 9 + ph[2]))

    # the talus cone it stands on
    cone = [V(0, 0, -0.25), V(0, 0, 0.15), V(0, 0, 0.45), V(0, 0, 0.75)]
    M.tube(cone, [1.9, 1.45, 1.05, r0 * 1.1], sides, "rock_hoodoo", tex_len=1.8, wraps=2, shape=lumpy(1.8))
    # the column, pinched where the soft layers wear back
    n = 14 if not lod else 6
    pts, rad = [], []
    for i in range(n + 1):
        t = i / n
        z = 0.75 + (H - 0.75) * t
        waist = math.sin(t * math.pi * rnd.choice((2, 3)) + ph[3]) ** 2
        pts.append(V(0.04 * math.sin(t * 3 + ph[4]), 0.04 * math.cos(t * 2 + ph[5]), z))
        rad.append(r0 * (1 - 0.22 * waist) * (1.08 - 0.15 * t))
    M.tube(pts, rad, sides, "rock_hoodoo", tex_len=1.8, wraps=2, shape=lumpy(1.0))
    # the cap: wider, flatter, a little tilted
    tilt = V(rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), 1).normalized()
    top = pts[-1]
    cap = [top - tilt * 0.05, top + tilt * 0.12, top + tilt * 0.3, top + tilt * 0.38]
    capr = rnd.uniform(0.95, 1.2)
    M.tube(cap, [rad[-1] * 0.95, capr, capr * 0.92, capr * 0.6], sides, "rock_hoodoo_cap", tex_len=1.8, wraps=2, cap=True, shape=lumpy(1.3))
    return M


SPECIES = {
    "hoodoo": (hoodoo, 3, True),
    "grass": (grass, 4, False),
    "meadow": (meadow, 4, False),
    "snowgrass": (snowgrass, 3, False),
    "reeds": (reeds, 3, False),
    "flowers": (flowers, 4, False),
    "shrub": (shrub, 4, True),
    "tundrashrub": (tundrashrub, 3, True),
    "yucca": (yucca, 3, False),
    "barrel": (barrel, 2, False),
    "saguaro": (saguaro, 3, True),
    "ocotillo": (ocotillo, 3, True),
    "joshua": (joshua, 3, True),
    "deadtree": (deadtree, 3, True),
    "pine": (pine, 4, True),
    "snowpine": (snowpine, 4, True),
    "birch": (birch, 3, True),
    "birchbare": (birchbare, 3, True),
}


# --- painted textures ----------------------------------------------------------------------------

def save_rgb(a, path):
    """a: (h, w, 3) sRGB 0..1, written as a JPEG via Blender."""
    h, w, _ = a.shape
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = np.clip(a[::-1], 0, 1)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = "JPEG"
    img.save(quality=92)


def value_noise(h, w, cells, rnd_np):
    g = rnd_np.random((cells[0] + 1, cells[1] + 1))
    g[-1, :] = g[0, :]
    g[:, -1] = g[:, 0]
    y = np.linspace(0, cells[0], h, endpoint=False)
    x = np.linspace(0, cells[1], w, endpoint=False)
    yi, xi = y.astype(int), x.astype(int)
    fy, fx = (y - yi)[:, None], (x - xi)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[yi][:, xi]
    b = g[yi][:, xi + 1]
    c = g[yi + 1][:, xi]
    d = g[yi + 1][:, xi + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def birch_bark(path):
    """Birch bark: chalky white, horizontal dark lenticels, black scars round old branches and a
    rougher dark band toward the foot (the texture runs 1.2 m up the trunk)."""
    S = 1024
    r = np.random.default_rng(7)
    n = value_noise(S, S, (8, 4), r) * 0.6 + value_noise(S, S, (32, 16), r) * 0.4
    base = np.stack([0.86 + 0.06 * n, 0.85 + 0.06 * n, 0.8 + 0.05 * n], -1)
    a = base.copy()
    # peeling: warmer, pinker strips
    peel = value_noise(S, S, (24, 3), r)
    a = a * (1 - 0.12 * np.clip((peel - 0.6) * 4, 0, 1))[..., None] + np.array([0.08, 0.04, 0.0]) * np.clip((peel - 0.6) * 4, 0, 1)[..., None]
    # lenticels: short dark horizontal dashes
    for i in range(900):
        y = r.integers(0, S)
        x = r.integers(0, S)
        L = int(r.integers(8, 60))
        t = int(r.integers(2, 5))
        dark = r.uniform(0.15, 0.45)
        xs = (np.arange(x, x + L) % S)
        a[max(0, y - t // 2):y + (t + 1) // 2, xs] *= dark
    # black diamond scars
    for i in range(10):
        cy, cx = r.integers(0, S), r.integers(0, S)
        hh, ww = r.integers(30, 90), r.integers(60, 160)
        yy, xx = np.ogrid[:S, :S]
        dx = np.minimum(np.abs(xx - cx), S - np.abs(xx - cx)) / ww
        dy = np.abs(yy - cy) / hh
        m = np.clip(1 - (dx + dy) * 1.2, 0, 1) ** 0.6
        a *= (1 - 0.85 * m)[..., None]
    save_rgb(a, path)


def cactus_skin(path, kind):
    """One rib of a cactus, its crest down the middle of the picture: green flesh darker in the
    grooves, a row of felted areoles along the crest, spines from each (pale on a saguaro, red
    and hooked on a barrel cactus). The texture repeats once per rib round the stem."""
    W, H = 256, 1024
    r = np.random.default_rng(11 if kind == "saguaro" else 13)
    x = np.linspace(-0.5, 0.5, W)[None, :]
    y = np.arange(H)[:, None]
    n = value_noise(H, W, (16, 2), r)
    crest = np.cos(x * math.pi) ** 2
    if kind == "saguaro":
        flesh = np.array([0.32, 0.4, 0.24])
        groove = np.array([0.2, 0.27, 0.16])
    else:
        flesh = np.array([0.36, 0.44, 0.22])
        groove = np.array([0.22, 0.3, 0.14])
    a = groove[None, None, :] + (flesh - groove)[None, None, :] * crest[..., None]
    a = a * (0.9 + 0.2 * n)[..., None]
    gap = 58 if kind == "saguaro" else 70
    spine = np.array([0.82, 0.78, 0.66]) if kind == "saguaro" else np.array([0.75, 0.3, 0.2])
    yy, xx = np.mgrid[:H, :W]
    for k in range(H // gap):
        cy = k * gap + gap // 2
        cx = W // 2
        d = np.sqrt(((xx - cx) / 1.0) ** 2 + ((yy - cy) / 1.3) ** 2)
        felt = np.clip(1 - d / 9, 0, 1)
        a = a * (1 - felt[..., None]) + np.array([0.62, 0.58, 0.5]) * felt[..., None]
        for s in range(9 if kind == "saguaro" else 7):
            ang = s / 9 * 2 * math.pi + r.uniform(-0.2, 0.2)
            L = r.uniform(18, 40) if kind == "saguaro" else r.uniform(30, 60)
            for j in range(int(L)):
                px = int(cx + math.cos(ang) * j)
                py = int(cy + math.sin(ang) * j * (0.6 if kind == "barrel" else 1))
                if 0 <= px < W and 0 <= py < H:
                    k2 = 1 - j / L * 0.4
                    a[py, max(0, px - 1):px + 1] = spine * k2
    save_rgb(a, path)


# --- building and export -------------------------------------------------------------------------

def build(name, out):
    fn, variants, has_mid = SPECIES[name]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for v in range(variants):
        for lod in ((0, 1) if has_mid else (0,)):
            rnd = random.Random(zlib.crc32(f"{name}/{v}".encode()))
            M = fn(rnd, v, lod)
            mats = sorted({f[3] for f in M.faces})
            M.object(f"{name}_{v}" + ("_mid" if lod else ""), mats)
            print(f"[plants] {name}_{v}{'_mid' if lod else ''}: {M.tris} triangles", flush=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, f"{name}.glb"), use_selection=True, export_format="GLB", export_yup=True, export_materials="EXPORT", export_vertex_color="ACTIVE", export_all_vertex_colors=False)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = argv[0]
    os.makedirs(os.path.join(out, "textures"), exist_ok=True)
    names = argv[1:] or list(SPECIES) + ["textures"]
    if "textures" in names:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        birch_bark(os.path.join(out, "textures", "bark_birch_albedo.jpg"))
        cactus_skin(os.path.join(out, "textures", "cactus_saguaro_albedo.jpg"), "saguaro")
        cactus_skin(os.path.join(out, "textures", "cactus_barrel_albedo.jpg"), "barrel")
        print("[plants] textures", flush=True)
    for n in names:
        if n != "textures":
            build(n, out)


main()
