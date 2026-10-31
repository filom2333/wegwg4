# Twig cards for the trees and shrubs: a twig modelled leaf by leaf (needle by needle) and
# rendered straight down onto a square texture, colour with coverage in alpha, and a normal map
# (OpenGL convention, as Godot reads it). The tree and shrub models hang these cards on their
# branch ends (tools/blender/plants.py).
#
#   blender -b --factory-startup --python tools/blender/twigs.py -- <out dir> [names]
#
# Writes <out>/twig_<name>_albedo.png and twig_<name>_normal.png. The twig grows from the bottom
# middle of the picture (where the card is fixed to its branch) toward the top.

import bpy
import bmesh
import math
import os
import random
import sys
import zlib
import numpy as np
from mathutils import Vector, Matrix

SIZE = 1024


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


class Builder:
    """Collects triangles with a colour per corner and makes one mesh object of them."""

    def __init__(self):
        self.v = []
        self.f = []
        self.c = []

    def tri(self, a, b, c, ca, cb=None, cc=None):
        i = len(self.v)
        self.v += [a, b, c]
        self.f.append((i, i + 1, i + 2))
        self.c += [ca, cb or ca, cc or ca]

    def quad(self, a, b, c, d, ca, cb=None, cc=None, cd=None):
        self.tri(a, b, c, ca, cb, cc)
        self.tri(a, c, d, ca, cc or ca, cd or ca)

    def object(self, name="twig"):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(p) for p in self.v], [], self.f)
        # (colours are given as they look, sRGB; the attribute is linear)
        attr = me.color_attributes.new("col", "FLOAT_COLOR", "CORNER")
        lin = lambda x: x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
        for poly in me.polygons:
            for li, vi in zip(poly.loop_indices, poly.vertices):
                c = self.c[vi]
                attr.data[li].color = (lin(c[0]), lin(c[1]), lin(c[2]), 1)
        me.update()
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        return o


def lerp(a, b, t):
    return a + (b - a) * t


def mixc(a, b, t):
    return tuple(lerp(x, y, t) for x, y in zip(a, b))


def scale(c, k):
    return tuple(x * k for x in c)


def tube(B, pts, r0, r1, col, sides=6):
    """A tapering tube along pts (stems, twigs, petioles)."""
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        u = t.cross(Vector((0, 0, 1)))
        if u.length < 1e-4:
            u = t.cross(Vector((1, 0, 0)))
        u.normalize()
        v = t.cross(u)
        r = lerp(r0, r1, i / max(1, n - 1))
        rings.append([p + (u * math.cos(a) + v * math.sin(a)) * r for a in (k / sides * 2 * math.pi for k in range(sides))])
    for i in range(n - 1):
        shade = 0.85 + 0.15 * (i / max(1, n - 1))
        for k in range(sides):
            a, b = rings[i][k], rings[i][(k + 1) % sides]
            c, d = rings[i + 1][(k + 1) % sides], rings[i + 1][k]
            B.quad(a, b, c, d, scale(col, shade))


def curve(p0, d, length, bend, n, rnd, wobble=0.0):
    """Points along a gently bending path from p0 heading d (bend: turn per unit length, radians)."""
    pts = [p0.copy()]
    p = p0.copy()
    d = d.normalized()
    step = length / n
    for i in range(n):
        ang = bend * step + (rnd.random() - 0.5) * wobble
        d = Matrix.Rotation(ang, 3, "Z") @ d
        d.z += (rnd.random() - 0.5) * wobble * 0.3
        d.normalize()
        p = p + d * step
        pts.append(p.copy())
    return pts


def leaf(B, base, d, length, width, shape, col, rnd, fold=0.25, serr=0.0, droop=0.15, mid=None, edge=None, lobes=0):
    """A flat leaf from base along d: shape(t) gives its half-width (0..1) at t along it; folded a
    little along the midrib, drooping toward the tip; serrated or lobed margins."""
    d = d.normalized()
    side = Vector((-d.y, d.x, 0)).normalized()
    up = Vector((0, 0, 1))
    n = 18
    mid = mid or scale(col, 0.82)
    edge = edge or scale(col, 1.08)
    prev = None
    for i in range(n + 1):
        t = i / n
        w = width * shape(t)
        if serr:
            w *= 1 - serr * (0.5 + 0.5 * math.sin(t * math.pi * 2 * (7 + lobes)))
        if lobes:
            w *= 0.75 + 0.25 * abs(math.sin(t * math.pi * lobes))
        c = base + d * (t * length) - up * (droop * length * t * t)
        lft = c + side * w - up * (fold * w)
        rgt = c - side * w - up * (fold * w)
        cur = (lft, c, rgt)
        if prev:
            # two strips: left half and right half, the midrib darker
            B.quad(prev[0], prev[1], cur[1], cur[0], edge, mid, mid, edge)
            B.quad(prev[1], prev[2], cur[2], cur[1], mid, edge, edge, mid)
        prev = cur


def needle(B, base, d, length, width, col, tip_col):
    """A needle as a thin flat ribbon with a ridge, lit from either side."""
    d = d.normalized()
    side = Vector((-d.y, d.x, 0))
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    up = Vector((0, 0, 1))
    tip = base + d * length
    m = base + d * (length * 0.5) + up * (width * 0.6)
    B.quad(base - side * width * 0.5, base + side * width * 0.5, m + side * width * 0.5, m - side * width * 0.5, col)
    B.tri(m - side * width * 0.5, m + side * width * 0.5, tip, col, col, tip_col)


# --- the twigs -----------------------------------------------------------------------------------

def pine(B, rnd):
    """A pine shoot: a woody stem ending in long needles in pairs and threes, densest at the tip."""
    stem = curve(Vector((0, -0.48, 0)), Vector((0, 1, 0)), 0.62, 0.25, 12, rnd, 0.05)
    tube(B, stem, 0.012, 0.007, (0.42, 0.33, 0.25))
    green = (0.22, 0.31, 0.15)
    for i in range(320):
        t = 0.3 + 0.7 * math.sqrt(rnd.random())
        k = min(int(t * (len(stem) - 1)), len(stem) - 2)
        p = stem[k].lerp(stem[k + 1], rnd.random())
        ax = (stem[k + 1] - stem[k]).normalized()
        a = rnd.uniform(-1.25, 1.25)
        d = (Matrix.Rotation(a, 3, "Z") @ ax)
        d.z += rnd.uniform(-0.2, 0.5)
        L = rnd.uniform(0.16, 0.24) * (0.75 + 0.25 * t)
        c = mixc(green, (0.3, 0.38, 0.18), rnd.random() * 0.6)
        needle(B, p, d, L, 0.006, c, mixc(c, (0.5, 0.5, 0.3), 0.5))


def spruce(B, rnd):
    """A spruce spray: a flat branchlet with side shoots, every shoot thick with short needles."""
    brown = (0.38, 0.3, 0.22)
    green = (0.15, 0.25, 0.14)

    def shoot(p0, d, L, depth):
        pts = curve(p0, d, L, rnd.uniform(-0.3, 0.3), 8, rnd, 0.04)
        tube(B, pts, 0.006 if depth == 0 else 0.004 if depth == 1 else 0.003, 0.002, brown)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            ax = (b - a).normalized()
            for j in range(30 if depth < 2 else 22):
                p = a.lerp(b, rnd.random())
                ang = rnd.uniform(0, 2 * math.pi)
                side = Vector((-ax.y, ax.x, 0))
                dd = (ax * 0.7 + side * math.cos(ang) * 0.8 + Vector((0, 0, 1)) * math.sin(ang) * 0.8).normalized()
                c = mixc(green, (0.24, 0.34, 0.18), rnd.random() * 0.7)
                needle(B, p, dd, rnd.uniform(0.026, 0.036), 0.004, c, scale(c, 1.2))
        if depth < 2:
            for i in range(1, len(pts) - 2):
                for sd in (-1, 1):
                    if rnd.random() < (0.15 if depth == 0 else 0.45):
                        continue
                    t = i / (len(pts) - 1)
                    dd = Matrix.Rotation(sd * rnd.uniform(0.6, 0.95), 3, "Z") @ (pts[i + 1] - pts[i]).normalized()
                    shoot(pts[i], dd, L * (0.5 - 0.3 * t) * rnd.uniform(0.8, 1.1), depth + 1)

    shoot(Vector((0, -0.48, 0)), Vector((0, 1, 0)), 0.92, 0)


def broadleaf(B, rnd, green, autumn=0.0, size=0.068, count=42, shape=None, serr=0.06, stem_len=0.85):
    """A twig with alternate leaves on short stalks (birch: ovate, pointed, double-toothed)."""
    shape = shape or (lambda t: math.sin(math.pi * min(1, t * 1.15)) ** 0.8 * (1 - 0.25 * t))
    stem = curve(Vector((0, -0.48, 0)), Vector((0, 1, 0)), stem_len, 0.2, 14, rnd, 0.12)
    tube(B, stem, 0.008, 0.003, (0.42, 0.34, 0.27))
    # side twigs
    shoots = [stem]
    for i in range(3, len(stem) - 3, 3):
        sd = 1 if (i // 3) % 2 else -1
        d = Matrix.Rotation(sd * rnd.uniform(0.5, 0.8), 3, "Z") @ (stem[i + 1] - stem[i]).normalized()
        s = curve(stem[i], d, stem_len * rnd.uniform(0.25, 0.4), -sd * 0.6, 6, rnd, 0.1)
        tube(B, s, 0.005, 0.002, (0.42, 0.34, 0.27))
        shoots.append(s)
    for s in shoots:
        n = max(3, int(count * (len(s) / len(stem))))
        for j in range(n):
            t = 0.15 + 0.85 * (j + rnd.random() * 0.5) / n
            k = min(int(t * (len(s) - 1)), len(s) - 2)
            p = s[k].lerp(s[k + 1], rnd.random())
            ax = (s[k + 1] - s[k]).normalized()
            sd = 1 if j % 2 else -1
            d = Matrix.Rotation(sd * rnd.uniform(0.5, 1.1), 3, "Z") @ ax
            pet = p + d * size * 0.35
            tube(B, [p, pet], 0.0018, 0.0012, (0.5, 0.45, 0.25))
            c = mixc(green, (green[0] * 1.3, green[1] * 1.15, green[2] * 0.9), rnd.random())
            if autumn:
                c = mixc(c, mixc((0.82, 0.62, 0.15), (0.75, 0.38, 0.1), rnd.random() * 0.5), autumn * rnd.uniform(0.6, 1.0))
            L = size * rnd.uniform(0.8, 1.15) * (0.7 + 0.3 * t)
            dl = (Matrix.Rotation(rnd.uniform(-0.3, 0.3), 3, "Z") @ d)
            leaf(B, pet, dl, L, L * 0.38, shape, c, rnd, fold=0.2, serr=serr, droop=0.1)


def sage(B, rnd):
    """Big sagebrush: grey-green wedge leaves, three-toothed at the tip, crowded on woody twigs."""
    grey = (0.44, 0.48, 0.38)
    shape = lambda t: min(1.0, t * 1.6) * (0.55 + 0.45 * t)
    stem = curve(Vector((0, -0.48, 0)), Vector((0, 1, 0)), 0.85, 0.3, 12, rnd, 0.25)
    tube(B, stem, 0.01, 0.004, (0.45, 0.41, 0.36))
    twigs = [stem]
    for i in range(2, len(stem) - 2, 2):
        sd = 1 if (i // 2) % 2 else -1
        d = Matrix.Rotation(sd * rnd.uniform(0.4, 0.9), 3, "Z") @ (stem[i + 1] - stem[i]).normalized()
        s = curve(stem[i], d, rnd.uniform(0.2, 0.35), -sd * 0.5, 6, rnd, 0.3)
        tube(B, s, 0.006, 0.003, (0.45, 0.41, 0.36))
        twigs.append(s)
    for s in twigs:
        for i in range(len(s) - 1):
            for j in range(20):
                p = s[i].lerp(s[i + 1], rnd.random())
                ang = rnd.uniform(0, 2 * math.pi)
                ax = (s[i + 1] - s[i]).normalized()
                d = (ax * 0.8 + Vector((math.cos(ang), math.sin(ang), 0)) * 0.9).normalized()
                c = mixc(grey, (0.56, 0.58, 0.47), rnd.random())
                L = rnd.uniform(0.025, 0.042)
                leaf(B, p, d, L, L * 0.32, shape, c, rnd, fold=0.1, serr=0.0, droop=0.0, lobes=3)


def dwarfbirch(B, rnd):
    """Tundra dwarf birch: small round crenate leaves, green turning orange and red."""
    shape = lambda t: math.sin(math.pi * t) ** 0.6
    for k in range(3):
        green = mixc((0.4, 0.48, 0.2), (0.72, 0.38, 0.14), rnd.uniform(0.2, 0.9))
        broadleaf(B, rnd, green, autumn=0.3, size=0.032, count=16, shape=shape, serr=0.12, stem_len=0.5 + 0.3 * k)


def bare(B, rnd):
    """Bare twigs: a branching spray of fine dark twigs (winter birch crowns, dead trees)."""
    col = (0.36, 0.32, 0.29)

    def grow(p, d, L, r, depth):
        pts = curve(p, d, L, rnd.uniform(-0.6, 0.6), 7, rnd, 0.25)
        tube(B, pts, r, r * 0.55, scale(col, rnd.uniform(0.85, 1.15)), sides=5)
        if depth == 0:
            return
        for i in range(1, len(pts) - 1, 2):
            sd = rnd.choice((-1, 1))
            dd = Matrix.Rotation(sd * rnd.uniform(0.35, 0.8), 3, "Z") @ (pts[i + 1] - pts[i]).normalized()
            grow(pts[i], dd, L * rnd.uniform(0.35, 0.55), r * 0.6, depth - 1)

    grow(Vector((0, -0.48, 0)), Vector((0, 1, 0)), 0.9, 0.009, 3)


# how wide each picture is for its height (the twig fills it, little empty card)
ASPECT = {"pine": 0.5, "spruce": 1.0, "birch": 0.75, "birch_autumn": 0.75, "sage": 0.75, "dwarfbirch": 0.625, "bare": 0.75}

TWIGS = {
    "pine": pine,
    "spruce": spruce,
    "birch": lambda B, r: broadleaf(B, r, (0.36, 0.5, 0.18)),
    "birch_autumn": lambda B, r: broadleaf(B, r, (0.45, 0.5, 0.18), autumn=0.85),
    "sage": sage,
    "dwarfbirch": dwarfbirch,
    "bare": bare,
}


# --- rendering ------------------------------------------------------------------------------------

def emission_material(kind):
    m = bpy.data.materials.new(kind)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    if kind == "albedo":
        a = nt.nodes.new("ShaderNodeVertexColor")
        a.layer_name = "col"
        nt.links.new(a.outputs["Color"], em.inputs["Color"])
    else:
        # the shading normal as 0..1 colour (Cycles turns it toward the camera on back faces)
        g = nt.nodes.new("ShaderNodeNewGeometry")
        mad = nt.nodes.new("ShaderNodeVectorMath")
        mad.operation = "MULTIPLY_ADD"
        mad.inputs[1].default_value = (0.5, 0.5, 0.5)
        mad.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(g.outputs["Normal"], mad.inputs[0])
        nt.links.new(mad.outputs[0], em.inputs["Color"])
    return m


def render(o, path, kind, aspect=1.0):
    sc = bpy.context.scene
    o.data.materials.clear()
    o.data.materials.append(emission_material(kind))
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 32
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 0
    sc.render.film_transparent = True
    sc.render.resolution_x = int(SIZE * aspect)
    sc.render.resolution_y = SIZE
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    # the albedo picture is sRGB like any colour texture; the normals go out as they are
    sc.display_settings.display_device = "sRGB"
    sc.view_settings.view_transform = "Standard" if kind == "albedo" else "Raw"
    sc.view_settings.look = "None"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def fill_edges(path):
    """Colour under the transparent pixels taken from the nearest leaves (push-pull), so the
    texture's mip levels don't darken the cut-out edges."""
    img = bpy.data.images.load(path)
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)
    m = (a[..., 3] > 0.02).astype(np.float32)
    # (PNG alpha is straight: the colour under a soft edge is already the leaf's)
    rgb = a[..., :3]
    levels = [(rgb * m[..., None], m)]
    while max(levels[-1][1].shape) > 1:
        c, mm = levels[-1]
        hh, ww = mm.shape
        # (odd sizes padded with empty pixels)
        ph, pw = hh % 2, ww % 2
        c = np.pad(c, ((0, ph), (0, pw), (0, 0)))
        mm = np.pad(mm, ((0, ph), (0, pw)))
        hh, ww = mm.shape
        levels.append((c.reshape(hh // 2, 2, ww // 2, 2, 3).sum((1, 3)), mm.reshape(hh // 2, 2, ww // 2, 2).sum((1, 3))))
    norm = [c / np.maximum(mm, 1e-6)[..., None] for c, mm in levels]
    for i in range(len(levels) - 2, -1, -1):
        hh, ww = levels[i][1].shape
        up = np.repeat(np.repeat(norm[i + 1], 2, 0), 2, 1)[:hh, :ww]
        hole = levels[i][1] <= 1e-6
        norm[i][hole] = up[hole]
    out = np.concatenate([norm[0], a[..., 3:4]], axis=2)
    img.pixels.foreach_set(out.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()


def build(name, out):
    clear()
    rnd = random.Random(zlib.crc32(name.encode()))
    B = Builder()
    TWIGS[name](B, rnd)
    o = B.object(name)
    bpy.ops.object.camera_add(location=(0, 0, 5))
    cam = bpy.context.object
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 1.0
    bpy.context.scene.camera = cam
    for kind in ("albedo", "normal"):
        p = os.path.join(out, f"twig_{name}_{kind}.png")
        render(o, p, kind, ASPECT[name])
        if kind == "albedo":
            fill_edges(p)
    print(f"[twigs] {name}: {len(B.f)} triangles", flush=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = argv[0]
    os.makedirs(out, exist_ok=True)
    for name in argv[1:] or list(TWIGS):
        build(name, out)


main()
