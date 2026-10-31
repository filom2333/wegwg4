# Geometry kit for the buildings (tools/blender/buildings.py): pieces built in the game's own
# frame (x across, y up, z toward the road, metres), each face with its own vertices, normals and
# UVs in metres (laid along the face, so a scan's grain runs the way the piece does), collected
# per material token (the names BuildingMaterials.cs knows) and turned into Blender objects at
# the end. Boxes can have chamfered edges, which catch the light as a real board's do.

import math
import bpy
from mathutils import Vector, Matrix

UP = Vector((0, 1, 0))


def V(x, y, z):
    return Vector((x, y, z))


def rot_y(a):
    return Matrix.Rotation(a, 4, "Y")


def rot_x(a):
    return Matrix.Rotation(a, 4, "X")


def rot_z(a):
    return Matrix.Rotation(a, 4, "Z")


def at(x, y, z):
    return Matrix.Translation(V(x, y, z))


def uv_of(p, n, frame=None):
    """Metre UVs of point p on a face with normal n: along the face's horizontal run and up it
    (walls), x and z on what faces up or down, or along a given frame (u axis, v axis)."""
    if frame is not None:
        off = frame[2] if len(frame) > 2 else (0.0, 0.0)
        return (p.dot(frame[0]) + off[0], p.dot(frame[1]) + off[1])
    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
    if ay >= ax and ay >= az:
        return (p.x, p.z if n.y > 0 else -p.z)
    if ax >= az:
        return (-p.z if n.x > 0 else p.z, p.y)
    return (p.x if n.z > 0 else -p.x, p.y)


class Part:
    """Faces (each a polygon with its own corners) gathered per material."""

    def __init__(self, name):
        self.name = name
        self.faces = {}  # material -> list of (points, normal, uvs)

    def count(self):
        return sum(len(p) - 2 for fl in self.faces.values() for p, _, _ in fl)

    def poly(self, mat, pts, n=None, uvs=None, frame=None):
        """A flat convex polygon facing n (its corners turned round to face that way if they wind
        the other), or facing the way its corners wind (counter-clockwise seen from the front)."""
        pts = [Vector(p) for p in pts]
        if len(pts) < 3:
            return
        w = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if n is None:
            if w.length < 1e-12:
                return
            n = w.normalized()
        n = Vector(n)
        if uvs is None:
            uvs = [uv_of(p, n, frame) for p in pts]
        if w.dot(n) < 0:
            pts.reverse()
            uvs = list(reversed(uvs))
        self.faces.setdefault(mat, []).append((pts, n, uvs))

    def box(self, mat, m, sx, sy, sz, bevel=0.0, mats=None, frame=None, skip=(), uv_off=(0.0, 0.0)):
        """A box of size (sx, sy, sz) placed by matrix m, its edges chamfered by `bevel`. mats:
        per face (+x, -x, +y, -y, +z, -z) instead of one; skip: faces left out; frame: the UV
        axes in the box's own frame (with uv_off added) instead of the faces' own."""
        hx, hy, hz = sx / 2, sy / 2, sz / 2
        b = min(bevel, hx * 0.45, hy * 0.45, hz * 0.45)
        rot = m.to_3x3().normalized()
        ms = mats or [mat] * 6
        uvf = None if frame is None else (rot @ frame[0], rot @ frame[1], uv_off)

        def P(x, y, z):
            return m @ V(x, y, z)

        def face(i, pts, nl):
            if i in skip:
                return
            self.poly(ms[i], [P(*q) for q in pts], rot @ V(*nl), frame=uvf)

        # the six faces, shrunk by the chamfer
        face(0, [(hx, -hy + b, -hz + b), (hx, hy - b, -hz + b), (hx, hy - b, hz - b), (hx, -hy + b, hz - b)], (1, 0, 0))
        face(1, [(-hx, -hy + b, hz - b), (-hx, hy - b, hz - b), (-hx, hy - b, -hz + b), (-hx, -hy + b, -hz + b)], (-1, 0, 0))
        face(2, [(-hx + b, hy, -hz + b), (-hx + b, hy, hz - b), (hx - b, hy, hz - b), (hx - b, hy, -hz + b)], (0, 1, 0))
        face(3, [(-hx + b, -hy, hz - b), (-hx + b, -hy, -hz + b), (hx - b, -hy, -hz + b), (hx - b, -hy, hz - b)], (0, -1, 0))
        face(4, [(-hx + b, -hy + b, hz), (hx - b, -hy + b, hz), (hx - b, hy - b, hz), (-hx + b, hy - b, hz)], (0, 0, 1))
        face(5, [(hx - b, -hy + b, -hz), (-hx + b, -hy + b, -hz), (-hx + b, hy - b, -hz), (hx - b, hy - b, -hz)], (0, 0, -1))
        if b <= 0:
            return
        s2 = 1 / math.sqrt(2)
        s3 = 1 / math.sqrt(3)
        # (the chamfers take the given material, or the one most of the faces have)
        mat_e = mat if mat is not None else max(set(ms), key=ms.count)
        # the twelve chamfers along the edges
        for sx_ in (-1, 1):
            for sy_ in (-1, 1):
                # along z
                a = (sx_ * hx, sy_ * (hy - b), 0)
                c = (sx_ * (hx - b), sy_ * hy, 0)
                pts = [(a[0], a[1], -hz + b), (a[0], a[1], hz - b), (c[0], c[1], hz - b), (c[0], c[1], -hz + b)]
                self._edge(mat_e, m, rot, pts, (sx_ * s2, sy_ * s2, 0), uvf)
        for sx_ in (-1, 1):
            for sz_ in (-1, 1):
                a = (sx_ * hx, 0, sz_ * (hz - b))
                c = (sx_ * (hx - b), 0, sz_ * hz)
                pts = [(a[0], -hy + b, a[2]), (a[0], hy - b, a[2]), (c[0], hy - b, c[2]), (c[0], -hy + b, c[2])]
                self._edge(mat_e, m, rot, pts, (sx_ * s2, 0, sz_ * s2), uvf)
        for sy_ in (-1, 1):
            for sz_ in (-1, 1):
                a = (0, sy_ * hy, sz_ * (hz - b))
                c = (0, sy_ * (hy - b), sz_ * hz)
                pts = [(-hx + b, a[1], a[2]), (hx - b, a[1], a[2]), (hx - b, c[1], c[2]), (-hx + b, c[1], c[2])]
                self._edge(mat_e, m, rot, pts, (0, sy_ * s2, sz_ * s2), uvf)
        # the eight corners
        for sx_ in (-1, 1):
            for sy_ in (-1, 1):
                for sz_ in (-1, 1):
                    pts = [(sx_ * hx, sy_ * (hy - b), sz_ * (hz - b)), (sx_ * (hx - b), sy_ * hy, sz_ * (hz - b)), (sx_ * (hx - b), sy_ * (hy - b), sz_ * hz)]
                    self._edge(mat_e, m, rot, pts, (sx_ * s3, sy_ * s3, sz_ * s3), uvf)

    def _edge(self, mat, m, rot, pts, nl, uvf):
        self.poly(mat, [m @ V(*p) for p in pts], rot @ V(*nl), frame=uvf)

    def tube(self, mat, pts, r, seg=8, caps=False):
        """A round tube of radius r along a polyline."""
        pts = [Vector(p) for p in pts]
        prev = None
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            if prev is None:
                u = t.cross(UP if abs(t.dot(UP)) < 0.9 else V(1, 0, 0)).normalized()
            else:
                u = (prev - t * prev.dot(t)).normalized()
            prev = u
            v = t.cross(u)
            rings.append([p + (u * math.cos(a) + v * math.sin(a)) * r for a in (k / seg * 2 * math.pi for k in range(seg))])
        along = 0
        for i in range(len(pts) - 1):
            l = (pts[i + 1] - pts[i]).length
            for k in range(seg):
                k1 = (k + 1) % seg
                a, b, c, d = rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]
                n = ((a + b + c + d) / 4 - (pts[i] + pts[i + 1]) / 2).normalized()
                u0, u1 = k / seg * 2 * math.pi * r, (k + 1) / seg * 2 * math.pi * r
                self.poly(mat, [a, b, c, d], n, uvs=[(u0, along), (u1, along), (u1, along + l), (u0, along + l)])
            along += l
        if caps:
            for i, s in ((0, -1), (len(pts) - 1, 1)):
                t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized() * s
                self.poly(mat, rings[i], t)

    def cylinder(self, mat, m, r, h, seg=12, caps=True, r2=None):
        """A cylinder along its own y (radius r at the bottom, r2 at the top) placed by m."""
        r2 = r if r2 is None else r2
        rot = m.to_3x3().normalized()
        for k in range(seg):
            a0, a1 = k / seg * 2 * math.pi, (k + 1) / seg * 2 * math.pi
            d0, d1 = V(math.cos(a0), 0, -math.sin(a0)), V(math.cos(a1), 0, -math.sin(a1))
            pts = [m @ (d0 * r + V(0, -h / 2, 0)), m @ (d1 * r + V(0, -h / 2, 0)), m @ (d1 * r2 + V(0, h / 2, 0)), m @ (d0 * r2 + V(0, h / 2, 0))]
            n = (rot @ ((d0 + d1) / 2)).normalized()
            self.poly(mat, pts, n, uvs=[(a0 * r, 0), (a1 * r, 0), (a1 * r, h), (a0 * r, h)])
        if caps:
            top = [m @ (V(math.cos(k / seg * 2 * math.pi), 0, -math.sin(k / seg * 2 * math.pi)) * r2 + V(0, h / 2, 0)) for k in range(seg)]
            bot = [m @ (V(math.cos(k / seg * 2 * math.pi), 0, -math.sin(k / seg * 2 * math.pi)) * r + V(0, -h / 2, 0)) for k in range(seg)]
            self.poly(mat, top, rot @ V(0, 1, 0))
            self.poly(mat, list(reversed(bot)), rot @ V(0, -1, 0))

    def corrugated(self, mat, m, w, l, pitch=0.076, depth=0.018, both=True):
        """A sheet of corrugated iron w across (the waves) and l long (along z), placed by m."""
        rot = m.to_3x3().normalized()
        n = max(2, int(round(w / pitch * 4)))
        xs = [-w / 2 + w * i / n for i in range(n + 1)]
        ys = [depth / 2 * math.sin(x / pitch * 2 * math.pi) for x in xs]
        slope = [depth / 2 * 2 * math.pi / pitch * math.cos(x / pitch * 2 * math.pi) for x in xs]
        for i in range(n):
            pts = [V(xs[i], ys[i], -l / 2), V(xs[i + 1], ys[i + 1], -l / 2), V(xs[i + 1], ys[i + 1], l / 2), V(xs[i], ys[i], l / 2)]
            nn = rot @ V(-(slope[i] + slope[i + 1]) / 2, 1, 0).normalized()
            uvs = [(p.x, p.z) for p in pts]
            self.poly(mat, [m @ p for p in pts], nn, uvs=uvs)
            if both:
                self.poly(mat, [m @ (p - V(0, 0.002, 0)) for p in pts], -nn, uvs=uvs)

    def merge(self, other, m=None):
        for mat, fl in other.faces.items():
            dst = self.faces.setdefault(mat, [])
            if m is None:
                dst.extend(fl)
            else:
                rot = m.to_3x3().normalized()
                for pts, n, uvs in fl:
                    dst.append(([m @ p for p in pts], rot @ n, uvs))

    def to_object(self, name, coll=None):
        """A Blender object (z up: the game's y up becomes Blender's z), one material slot per
        token, flat-shaded faces with their own normals."""
        mats = sorted(self.faces)
        verts, polys, normals, uvs, mat_idx = [], [], [], [], []
        for mi, mat in enumerate(mats):
            for pts, n, uv in self.faces[mat]:
                base = len(verts)
                for p in pts:
                    verts.append((p.x, -p.z, p.y))
                polys.append(list(range(base, base + len(pts))))
                normals.extend([(n.x, -n.z, n.y)] * len(pts))
                uvs.extend(uv)
                mat_idx.append(mi)
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], polys)
        for mat in mats:
            me.materials.append(bpy.data.materials.get(mat) or new_material(mat))
        uvl = me.uv_layers.new(name="UVMap")
        for i, uv in enumerate(uvs):
            uvl.data[i].uv = uv
        for poly, mi in zip(me.polygons, mat_idx):
            poly.material_index = mi
            poly.use_smooth = True
        me.normals_split_custom_set(normals)
        me.validate(clean_customdata=False)
        me.update()
        o = bpy.data.objects.new(name, me)
        (coll or bpy.context.scene.collection).objects.link(o)
        return o


def new_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m
