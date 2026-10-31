# Impostors: every tree and big cactus seen from 8 sides, for the far rings where a full model
# would cost too much. Each view is rendered straight on (orthographic, from the side): its
# colour with the crown's own shading baked in (ambient occlusion), coverage in alpha, and the
# surface normal relative to the view. In the game a far tree is one card that turns to face the
# camera and shows the view it is seen from (shaders/impostor.gdshader).
#
#   blender -b --factory-startup --python tools/blender/impostors.py -- <plants dir> <twigs dir> <textures dir> <out dir> [species...]
#
# <plants dir> holds <species>.glb from tools/blender/plants.py; <textures dir> the bark and painted
# textures (assets/textures/plants). Writes <out>/<species>_impostor_{albedo,normal}.png (8 views
# across, one variant per row) and <out>/<species>_impostor.json (the card size of each variant).

import bpy
import json
import math
import os
import sys
import numpy as np

VIEWS = 8
CELL_H = 256
SPECIES = ["saguaro", "ocotillo", "joshua", "deadtree", "pine", "snowpine", "birch", "birchbare"]

# what FloraLibrary.cs tints each bark with (linear multipliers), so the far tree matches the near
TINT = {"bark_joshua": (0.62, 0.56, 0.5), "bark_ocotillo": (0.82, 0.8, 0.72), "bark_dead": (1.05, 1.02, 0.98), "bark_spruce": (0.62, 0.6, 0.6)}
SCAN = {"bark_pine": "bark_pine", "bark_spruce": "bark_pine", "bark_grey": "bark_grey", "bark_dead": "bark_grey", "bark_joshua": "bark_grey", "bark_ocotillo": "bark_grey"}


def image(path, colour=True):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    return img


def albedo_material(name, twigs, tex, colour_layer):
    """Unlit: the surface's colour (texture x tint x vertex colour) darkened by its occlusion."""
    m = bpy.data.materials.new("imp_" + name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = colour_layer
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    col = vc.outputs["Color"]
    alpha = None

    def mul(a, b):
        n = nt.nodes.new("ShaderNodeMix")
        n.data_type = "RGBA"
        n.blend_type = "MULTIPLY"
        n.inputs["Factor"].default_value = 1
        if isinstance(b, tuple):
            n.inputs["B"].default_value = (*b, 1)
        else:
            nt.links.new(b, n.inputs["B"])
        nt.links.new(a, n.inputs["A"])
        return n.outputs["Result"]

    path = None
    if name.startswith("leaf_"):
        path = os.path.join(twigs, f"twig_{name[5:]}_albedo.png")
    elif name in SCAN:
        path = os.path.join(tex, f"{SCAN[name]}_diff.jpg")
    elif name.startswith("bark_") or name.startswith("cactus_"):
        path = os.path.join(tex, f"{name}_albedo.jpg")
    if path:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image(path)
        t.extension = "REPEAT" if not name.startswith("leaf_") else "CLIP"
        nt.links.new(uv.outputs["UV"], t.inputs["Vector"])
        col = mul(t.outputs["Color"], col)
        if name.startswith("leaf_"):
            alpha = t.outputs["Alpha"]
    if name in TINT:
        col = mul(col, TINT[name])
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.samples = 16
    ao.inputs["Distance"].default_value = 1.6
    shade = nt.nodes.new("ShaderNodeMapRange")
    shade.inputs["To Min"].default_value = 0.35
    shade.inputs["To Max"].default_value = 1.0
    nt.links.new(ao.outputs["AO"], shade.inputs["Value"])
    col = mul(col, shade.outputs["Result"])
    nt.links.new(col, em.inputs["Color"])
    surface = em.outputs[0]
    if alpha is not None:
        mix = nt.nodes.new("ShaderNodeMixShader")
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        cut = nt.nodes.new("ShaderNodeMath")
        cut.operation = "GREATER_THAN"
        cut.inputs[1].default_value = 0.42
        nt.links.new(alpha, cut.inputs[0])
        nt.links.new(cut.outputs[0], mix.inputs["Fac"])
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(surface, mix.inputs[2])
        surface = mix.outputs[0]
    nt.links.new(surface, out.inputs["Surface"])
    return m


def normal_material(name, twigs):
    """Unlit: the shading normal in camera space (x right, y up, z toward the camera) as colour."""
    m = bpy.data.materials.new("impn_" + name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    g = nt.nodes.new("ShaderNodeNewGeometry")
    tr = nt.nodes.new("ShaderNodeVectorTransform")
    tr.vector_type = "NORMAL"
    tr.convert_from = "WORLD"
    tr.convert_to = "CAMERA"
    nt.links.new(g.outputs["Normal"], tr.inputs["Vector"])
    # (Blender's camera space: x right, y up, the camera looking down -z, so a face turned to
    # the viewer has +z)
    flip = nt.nodes.new("ShaderNodeVectorMath")
    flip.operation = "MULTIPLY"
    flip.inputs[1].default_value = (0.5, 0.5, 0.5)
    nt.links.new(tr.outputs["Vector"], flip.inputs[0])
    add = nt.nodes.new("ShaderNodeVectorMath")
    add.operation = "ADD"
    add.inputs[1].default_value = (0.5, 0.5, 0.5)
    nt.links.new(flip.outputs[0], add.inputs[0])
    nt.links.new(add.outputs[0], em.inputs["Color"])
    surface = em.outputs[0]
    if name.startswith("leaf_"):
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UVMap"
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image(os.path.join(twigs, f"twig_{name[5:]}_albedo.png"))
        t.extension = "CLIP"
        nt.links.new(uv.outputs["UV"], t.inputs["Vector"])
        mix = nt.nodes.new("ShaderNodeMixShader")
        trn = nt.nodes.new("ShaderNodeBsdfTransparent")
        cut = nt.nodes.new("ShaderNodeMath")
        cut.operation = "GREATER_THAN"
        cut.inputs[1].default_value = 0.42
        nt.links.new(t.outputs["Alpha"], cut.inputs[0])
        nt.links.new(cut.outputs[0], mix.inputs["Fac"])
        nt.links.new(trn.outputs[0], mix.inputs[1])
        nt.links.new(surface, mix.inputs[2])
        surface = mix.outputs[0]
    nt.links.new(surface, out.inputs["Surface"])
    return m


def read_png(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1]  # top row first


def write_png(a, path):
    h, w, _ = a.shape
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.pixels.foreach_set(a[::-1].astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def fill(a):
    """Colour under the transparent pixels from the nearest opaque ones (push-pull)."""
    m = (a[..., 3] > 0.02).astype(np.float32)
    levels = [(a[..., :3] * m[..., None], m)]
    while max(levels[-1][1].shape) > 1:
        c, mm = levels[-1]
        ph, pw = mm.shape[0] % 2, mm.shape[1] % 2
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
    out = a.copy()
    out[..., :3] = norm[0]
    return out


def bake(species, plants, twigs, tex, out, tmp):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(plants, species + ".glb"))
    objs = {o.name: o for o in bpy.context.scene.objects if o.type == "MESH"}
    variants = sorted(n for n in objs if not n.endswith("_mid"))
    for n in list(objs):
        if n.endswith("_mid"):
            bpy.data.objects.remove(objs.pop(n), do_unlink=True)
    # each surface's two materials, by the name plants.py gave it
    alb, nrm, bases = {}, {}, {}
    # (the glTF import names the vertex colours its own way)
    layer = next(iter(objs.values())).data.color_attributes[0].name
    for o in objs.values():
        bases[o.name] = []
        for slot in o.material_slots:
            base = slot.material.name.split(".")[0]
            bases[o.name].append(base)
            if base not in alb:
                alb[base] = albedo_material(base, twigs, tex, layer)
                nrm[base] = normal_material(base, twigs)
    # the card size per variant: the widest it gets round its foot, and its height
    sizes = []
    for n in variants:
        o = objs[n]
        r = max(math.hypot(v.co.x, v.co.y) for v in o.data.vertices)
        zs = [v.co.z for v in o.data.vertices]
        sizes.append((2 * r * 1.02, max(zs) * 1.02, min(zs)))
    W = max(s[0] for s in sizes)
    H = max(s[1] for s in sizes)
    cell_w = min(CELL_H, int(math.ceil(CELL_H * W / H / 32)) * 32)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 24
    sc.cycles.use_denoising = False
    sc.render.film_transparent = True
    sc.render.resolution_x = cell_w
    sc.render.resolution_y = CELL_H
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.display_settings.display_device = "sRGB"
    sc.view_settings.look = "None"
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    # (the picture spans H tall, W * cell_w / CELL_H... the card is as wide as the picture shows)
    cam.data.ortho_scale = H
    cam.data.sensor_fit = "VERTICAL"
    card_w = H * cell_w / CELL_H
    atlas = {k: np.zeros((CELL_H * len(variants), cell_w * VIEWS, 4), np.float32) for k in ("albedo", "normal")}
    for vi, n in enumerate(variants):
        for o in objs.values():
            o.hide_render = o.name != n
        for k in range(VIEWS):
            phi = k / VIEWS * 2 * math.pi
            d = 60.0
            cam.location = (math.sin(phi) * d, -math.cos(phi) * d, H / 2)
            cam.rotation_euler = (math.pi / 2, 0, phi)
            for kind, mats in (("albedo", alb), ("normal", nrm)):
                o = objs[n]
                for slot, base in zip(o.material_slots, bases[n]):
                    slot.material = mats[base]
                sc.view_settings.view_transform = "Standard" if kind == "albedo" else "Raw"
                p = os.path.join(tmp, f"{species}_{vi}_{k}_{kind}.png")
                sc.render.filepath = p
                bpy.ops.render.render(write_still=True)
                a = read_png(p)
                atlas[kind][vi * CELL_H:(vi + 1) * CELL_H, k * cell_w:(k + 1) * cell_w] = a
                os.remove(p)
        print(f"[impostors] {n}: {sizes[vi][0]:.1f} x {sizes[vi][1]:.1f} m", flush=True)
    write_png(fill(atlas["albedo"]), os.path.join(out, f"{species}_impostor_albedo.png"))
    nm = atlas["normal"]
    # (the normals' transparent pixels face the viewer)
    empty = nm[..., 3] <= 0.02
    nm[empty, :3] = (0.5, 0.5, 1.0)
    write_png(nm, os.path.join(out, f"{species}_impostor_normal.png"))
    meta = {"views": VIEWS, "rows": len(variants), "card": [card_w, H], "foot": min(s[2] for s in sizes)}
    json.dump(meta, open(os.path.join(out, f"{species}_impostor.json"), "w"), indent=1)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    plants, twigs, tex, out = argv[:4]
    os.makedirs(out, exist_ok=True)
    tmp = os.path.join(out, ".tmp")
    os.makedirs(tmp, exist_ok=True)
    for sp in argv[4:] or SPECIES:
        bake(sp, plants, twigs, tex, out, tmp)
    os.rmdir(tmp)


main()
