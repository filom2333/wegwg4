# Game models from Poly Haven scans (CC0): rocks, stumps, logs and ferns for the scatter.
#
# Each scan is cut down to a game-sized mesh (and a coarser one for further off), given its own
# UV layout, and the scan's colour, relief, roughness and ambient occlusion are baked onto it from
# the full-detail original. Sizes are normalised the way the scatter expects them (see
# scripts/world/ScatterGen.cs: a scale of 1 is a rock about 2 m across).
#
#   blender -b --factory-startup --python tools/blender/scans.py -- <scans dir> <out dir> [names]
#
# <scans dir> holds the glTF downloads (tools/blender/fetch_polyhaven.py fetches them, 2k), one
# folder per asset. Writes <out>/<species>.glb (objects <species>_<v> and <species>_<v>_lod1)
# and <out>/textures/<species>_<v>_{albedo,normal,orm}.jpg.

import bpy
import bmesh
import glob
import math
import os
import sys
import numpy as np
from mathutils import Vector, Matrix

# species: [(asset, object name or None for the only one, options)]; options: size (horizontal
# extent after scaling), flat (lay the thinnest side down), long (longest side along x),
# tris (game mesh), lod1 (coarser mesh, 0 for none), tex (texture size), keep (no bake: the
# scan's own mesh and textures, for cut-out leaves)
SPECIES = {
    "boulder": [
        ("namaqualand_boulder_03", None, {}),
        ("namaqualand_boulder_04", None, {}),
        ("namaqualand_boulder_05", None, {}),
        ("boulder_01", None, {}),
    ],
    "slab": [
        ("namaqualand_rocks_01", "namaqualand_rocks_02_b", {"flat": True, "size": 2.3}),
        ("stone_01", None, {"flat": True, "size": 2.2}),
        ("rock_09", None, {"flat": True, "size": 2.2}),
    ],
    "mossrock": [
        ("rock_moss_set_01", "rock_moss_set_01_rock03", {}),
        ("rock_moss_set_02", "rock_moss_set_02_rock12", {}),
        ("rock_moss_set_02", "rock_moss_set_02_rock11", {}),
    ],
    "snowrock": [
        ("namaqualand_boulder_06", None, {}),
        ("rock_moss_set_01", "rock_moss_set_01_rock05", {}),
        ("rock_moss_set_01", "rock_moss_set_01_rock04", {}),
    ],
    "pebble": [
        ("namaqualand_rocks_01", "namaqualand_rocks_02_a", {"tris": 300, "lod1": 0, "tex": 512}),
        ("namaqualand_rocks_01", "namaqualand_rocks_02_c", {"tris": 300, "lod1": 0, "tex": 512}),
        ("namaqualand_stones_01", "namaqualand_stones_01_e", {"tris": 300, "lod1": 0, "tex": 512}),
    ],
    "stump": [
        ("tree_stump_01", None, {"size": 1.5, "tris": 2500, "lod1": 0}),
        ("tree_stump_02", None, {"size": 1.5, "tris": 2500, "lod1": 0}),
    ],
    "log": [
        ("dead_tree_trunk_02", None, {"long": True, "size": 4.0, "tris": 3000, "lod1": 0}),
        ("dead_tree_trunk", None, {"long": True, "size": 4.5, "tris": 2000, "lod1": 0}),
    ],
    "fern": [
        ("fern_02", "fern_02_b", {"keep": True, "size": 1.0}),
        ("fern_02", "fern_02_c", {"keep": True, "size": 1.0}),
        ("fern_02", "fern_02_a", {"keep": True, "size": 0.8}),
    ],
}

DEFAULTS = {"size": 2.0, "flat": False, "long": False, "tris": 2600, "lod1": 380, "tex": 1024, "keep": False}


def tris_of(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def import_asset(scans, asset):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    f = glob.glob(os.path.join(scans, asset, "*.gltf"))[0]
    bpy.ops.import_scene.gltf(filepath=f)


def pick(name):
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    o = meshes[0] if name is None else bpy.data.objects[name]
    for m in meshes:
        if m is not o:
            bpy.data.objects.remove(m, do_unlink=True)
    # apply its transform (and drop any parent)
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def normalise(o, opt):
    """Lay it the way the game wants it and scale it: z up, bottom on z = 0, centred."""
    me = o.data
    # principal axes of the vertices (rocks: thinnest side down if flat; logs: longest along x)
    if opt["flat"] or opt["long"]:
        pts = [v.co for v in me.vertices]
        c = sum(pts, Vector()) / len(pts)
        cov = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
        for p in pts:
            d = p - c
            for i in range(3):
                for j in range(3):
                    cov[i][j] += d[i] * d[j]
        # power iteration for the main axis, then the least
        def main_axis(m):
            v = Vector((1, 0.3, 0.2))
            for _ in range(60):
                v = (m @ v).normalized()
            return v
        a = main_axis(cov)
        lam = (cov @ a).dot(a)
        defl = cov - lam * Matrix([[a[i] * a[j] for j in range(3)] for i in range(3)])
        b = main_axis(defl)
        n = a.cross(b).normalized()
        # keep the side that faced up in the scan facing up: its underside was never photographed
        if n.z < 0:
            b, n = -b, -n
        # longest along x, thinnest up (flat rocks lie down, logs lie along x)
        rot = Matrix((a, b, n)).to_4x4()
        me.transform(Matrix.Translation(-c))
        me.transform(rot)
    me.update()
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    ext = max(max(xs) - min(xs), max(ys) - min(ys))
    k = opt["size"] / ext
    me.transform(Matrix.Translation((-(max(xs) + min(xs)) / 2, -(max(ys) + min(ys)) / 2, -min(zs))))
    me.transform(Matrix.Scale(k, 4))
    me.update()


def decimated_copy(src, target, name, weld=False):
    """A copy cut down to about `target` triangles. weld: first join the scan's split vertices
    and drop its UVs (seams and loose triangles would stop the collapse), for a mesh that gets
    a UV layout of its own afterwards."""
    o = src.copy()
    o.data = src.data.copy()
    o.name = name
    bpy.context.scene.collection.objects.link(o)
    if weld:
        for uv in list(o.data.uv_layers):
            o.data.uv_layers.remove(uv)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=max(o.dimensions) * 2e-4)
        bm.to_mesh(o.data)
        bm.free()
    ratio = min(1.0, target / max(1, tris_of(o)))
    if ratio < 1:
        mod = o.modifiers.new("dec", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o


def unwrap(o):
    me = o.data
    for uv in list(me.uv_layers):
        me.uv_layers.remove(uv)
    me.uv_layers.new(name="bake")
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0)
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def ao_to_emission(high):
    """Route the scan's own occlusion (the red of its ARM map) to the material output as light, so
    an emission bake copies it (a real AO bake would see the low mesh sitting inside the scan)."""
    mat = high.data.materials[0]
    nt = mat.node_tree
    arm = next((n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image and "arm" in n.image.name.lower()), None)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    em = nt.nodes.new("ShaderNodeEmission")
    if arm:
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(arm.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs[0], em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = (1, 1, 1, 1)
    nt.links.new(em.outputs[0], out.inputs["Surface"])


def bake_into(high, low, img, kind, extent):
    """Bake `kind` from the scan onto the game mesh's image `img`."""
    mat = bpy.data.materials.new("bake_" + kind)
    mat.use_nodes = True
    nt = mat.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    low.data.materials.clear()
    low.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    args = dict(use_selected_to_active=True, cage_extrusion=extent * 0.02, max_ray_distance=extent * 0.06, margin=12, use_clear=True)
    if kind == "albedo":
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, **args)
    elif kind == "normal":
        bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", **args)
    elif kind == "rough":
        bpy.ops.object.bake(type="ROUGHNESS", **args)
    elif kind == "ao":
        ao_to_emission(high)
        bpy.ops.object.bake(type="EMIT", **args)
    elif kind == "mask":
        # (whatever the bake covers, margins included: everything else gets filled in)
        mask_emission(high)
        bpy.ops.object.bake(type="EMIT", **args)


def mask_emission(high):
    mat = high.data.materials[0]
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1, 1, 1, 1)
    nt.links.new(em.outputs[0], out.inputs["Surface"])


def pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def fill_empty(a, mask):
    """Push-pull: every pixel the bake left empty takes the blurred colour of the nearest baked
    ones, so the texture's smaller mip levels don't fade the model toward the black background."""
    levels = [(a * mask[..., None], mask.copy())]
    while levels[-1][1].shape[0] > 1:
        c, m = levels[-1]
        h, w = m.shape
        c2 = c.reshape(h // 2, 2, w // 2, 2, -1).sum((1, 3))
        m2 = m.reshape(h // 2, 2, w // 2, 2).sum((1, 3))
        levels.append((c2, m2))
    # normalise every level, then fill each level's holes from the next coarser one
    norm = [c / np.maximum(m, 1e-6)[..., None] for c, m in levels]
    for i in range(len(levels) - 2, -1, -1):
        up = np.repeat(np.repeat(norm[i + 1], 2, 0), 2, 1)
        hole = levels[i][1] <= 1e-6
        norm[i][hole] = up[hole]
    return norm[0]


def save_jpg(img, path, quality=92):
    img.filepath_raw = path
    img.file_format = "JPEG"
    img.save(quality=quality)


def build(scans, out, species, items):
    os.makedirs(os.path.join(out, "textures"), exist_ok=True)
    made = []
    for v, (asset, objname, o_) in enumerate(items):
        opt = dict(DEFAULTS, **o_)
        import_asset(scans, asset)
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.device = "CPU"
        sc.cycles.samples = 8
        high = pick(objname)
        normalise(high, opt)
        name = f"{species}_{v}"
        if opt["keep"]:
            high.name = name
            made.append((name, None, high))
            save_keep(high, out, name)
            export(out, species, v, [high])
            continue
        low = decimated_copy(high, opt["tris"], name, weld=True)
        unwrap(low)
        T = opt["tex"]
        imgs = {}
        extent = max(high.dimensions)
        for kind in ("albedo", "normal", "rough", "ao", "mask"):
            img = bpy.data.images.new(f"{name}_{kind}", T, T, alpha=False, float_buffer=(kind != "albedo"))
            img.colorspace_settings.name = "sRGB" if kind == "albedo" else "Non-Color"
            bake_into(high, low, img, kind, extent)
            imgs[kind] = img
        mask = (pixels(imgs["mask"])[..., 0] > 0.5).astype(np.float32)
        for kind in ("albedo", "normal", "rough", "ao"):
            img = imgs[kind]
            img.pixels.foreach_set(fill_empty(pixels(img), mask).astype(np.float32).ravel())
        tdir = os.path.join(out, "textures")
        save_jpg(imgs["albedo"], os.path.join(tdir, f"{name}_albedo.jpg"))
        save_jpg(imgs["normal"], os.path.join(tdir, f"{name}_normal.jpg"), 95)
        # occlusion, roughness, metal (none) in one map, as Godot's ORM materials read it
        orm = bpy.data.images.new(f"{name}_orm", T, T, alpha=False, float_buffer=True)
        orm.colorspace_settings.name = "Non-Color"
        ao = pixels(imgs["ao"]).ravel()
        ro = pixels(imgs["rough"]).ravel()
        px = np.zeros(T * T * 4, np.float32)
        px[0::4] = ao[0::4]
        px[1::4] = ro[0::4]
        px[3::4] = 1
        orm.pixels.foreach_set(px)
        save_jpg(orm, os.path.join(tdir, f"{name}_orm.jpg"))
        objs = [low]
        if opt["lod1"]:
            l1 = decimated_copy(low, opt["lod1"], name + "_lod1")
            objs.append(l1)
        # the scan itself stays out of the export
        bpy.data.objects.remove(high, do_unlink=True)
        for o in objs:
            o.data.materials.clear()
        print(f"[scans] {name}: {tris_of(low)} tris" + (f", lod1 {tris_of(objs[1])}" if len(objs) > 1 else "") + f", {low.dimensions.x:.2f} x {low.dimensions.y:.2f} x {low.dimensions.z:.2f} m", flush=True)
        export(out, species, v, objs)


def save_keep(o, out, name):
    """Cut-out leaves (ferns): the scan's own textures, copied at 1k."""
    mat = o.data.materials[0]
    tdir = os.path.join(out, "textures")
    for node in mat.node_tree.nodes:
        if node.type != "TEX_IMAGE" or not node.image:
            continue
        img = node.image
        label = img.name.lower()
        kind = "albedo" if "diff" in label or "col" in label else "normal" if "nor" in label else "orm" if "arm" in label else None
        if kind is None:
            continue
        img.scale(1024, 1024)
        save_jpg(img, os.path.join(tdir, f"{name}_{kind}.jpg"), 92 if kind == "albedo" else 95)
    o.data.materials.clear()


def export(out, species, v, objs):
    # one file per variant, joined into the species' file at the end
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    path = os.path.join(out, f".{species}_{v}.glb")
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format="GLB", export_materials="NONE", export_yup=True, export_apply=True)


def join(out, species, n):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for v in range(n):
        p = os.path.join(out, f".{species}_{v}.glb")
        bpy.ops.import_scene.gltf(filepath=p)
        os.remove(p)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, f"{species}.glb"), use_selection=True, export_format="GLB", export_materials="NONE", export_yup=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    scans, out = argv[0], argv[1]
    names = argv[2:] or list(SPECIES)
    for sp in names:
        build(scans, out, sp, SPECIES[sp])
        join(out, sp, len(SPECIES[sp]))
        print(f"[scans] wrote {sp}.glb", flush=True)


main()
