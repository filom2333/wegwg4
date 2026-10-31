# A picture of a building from tools/blender/buildings.py with its scans on (the palette the game
# uses, assets/textures/building/palette.json), in sun, rendered with Cycles: for judging a model
# before it goes into the game.
#
#   blender -b --factory-startup --python tools/blender/building_preview.py -- <model.glb> <out.png> [view] [width]
#
# view: front (three quarters from the front left, the default), back, side, aerial, inside, door.

import bpy
import json
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
glb, out = argv[0], argv[1]
view = argv[2] if len(argv) > 2 else "front"
width = int(argv[3]) if len(argv) > 3 else 1280
HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.normpath(os.path.join(HERE, "..", "..", "assets", "textures"))
palette = json.load(open(os.path.join(TEX, "building", "palette.json")))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]


def image(path, colour):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    return img


def scan_material(m, d):
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], o.inputs[0])
    uv = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / d["metres"][0], 1 / d["metres"][1], 1)
    nt.links.new(uv.outputs["UV"], mp.inputs["Vector"])
    base = os.path.join(TEX, d["file"])

    def tex(kind, colour):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image(f"{base}_{kind}.jpg", colour)
        nt.links.new(mp.outputs[0], t.inputs["Vector"])
        return t

    diff, arm, nor = tex("diff", True), tex("arm", False), tex("nor", False)
    tint = d.get("tint", [1, 1, 1])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1
    nt.links.new(diff.outputs["Color"], mul.inputs["A"])
    mul.inputs["B"].default_value = (*tint, 1)
    col = mul.outputs["Result"]
    paint = d.get("paint")
    if paint:
        # the paint's colour carrying the scan's light and dark
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        nt.links.new(diff.outputs["Color"], bw.inputs[0])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = 0.0
        mr.inputs["From Max"].default_value = 0.5
        mr.inputs["To Min"].default_value = 0.7
        mr.inputs["To Max"].default_value = 1.15
        nt.links.new(bw.outputs[0], mr.inputs["Value"])
        pm = nt.nodes.new("ShaderNodeMix")
        pm.data_type = "RGBA"
        pm.blend_type = "MULTIPLY"
        pm.inputs["Factor"].default_value = 1
        pm.inputs["A"].default_value = (*paint[:3], 1)
        nt.links.new(mr.outputs[0], pm.inputs["B"])
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.inputs["Factor"].default_value = paint[3]
        nt.links.new(col, mx.inputs["A"])
        nt.links.new(pm.outputs["Result"], mx.inputs["B"])
        col = mx.outputs["Result"]
    nt.links.new(col, bsdf.inputs["Base Color"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(arm.outputs["Color"], sep.inputs[0])
    nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = d.get("normal", 1.0)
    nt.links.new(nor.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])


def plain_material(m, c, rough, metal, alpha=1.0):
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], o.inputs[0])
    bsdf.inputs["Base Color"].default_value = (*c, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Alpha"].default_value = alpha


for m in bpy.data.materials:
    tok = m.name.split(".")[0]
    m.use_nodes = True
    if tok in palette["scans"]:
        scan_material(m, palette["scans"][tok])
    elif tok in palette["plain"]:
        c, rough, metal = palette["plain"][tok]
        plain_material(m, c, rough, metal)
    elif tok in palette["glass"]:
        c, alpha, rough = palette["glass"][tok]
        plain_material(m, c, rough, 0.0, alpha)
    else:
        plain_material(m, (1, 0, 1), 0.5, 0)

# the ground, sun and sky
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
ground = bpy.context.object
gm = bpy.data.materials.new("ground")
gm.use_nodes = True
plain_material(gm, (0.42, 0.33, 0.22), 0.95, 0)
ground.data.materials.append(gm)
sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 4.5
sun.angle = math.radians(1.5)
so = bpy.data.objects.new("sun", sun)
bpy.context.scene.collection.objects.link(so)
so.rotation_euler = (math.radians(50), 0, math.radians(-35))
world = bpy.data.worlds.new("w")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.55, 0.68, 0.9, 1)
bg.inputs[1].default_value = 0.9

# frame the building
lo = Vector((1e9, 1e9, 1e9))
hi = -lo
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
centre = (lo + hi) / 2
size = (hi - lo).length
cam = bpy.data.cameras.new("cam")
cam.lens = 28
co = bpy.data.objects.new("cam", cam)
bpy.context.scene.collection.objects.link(co)
bpy.context.scene.camera = co
# (the game's front, +z, is Blender's -y). Views stand off far enough to take in the building,
# at a person's height or above.
ext = hi - lo
reach = max(ext.x, ext.y) * 0.5 + 2
views = {
    "front": (Vector((-0.65, -1.0, 0.0)), 2.2, 4.0),
    "back": (Vector((0.65, 1.0, 0.0)), 2.2, 4.0),
    "side": (Vector((1.0, -0.2, 0.0)), 2.0, 3.0),
    "aerial": (Vector((-0.6, -0.9, 0.0)), 2.0, ext.z + 9),
    "door": (Vector((-0.2, -1.0, 0.0)), 0.75, 1.7),
}
meta_path = glb[:-4] + ".json"
meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}


def B(p):
    """The game's (x, y, z) in Blender's frame."""
    return Vector((p[0], -p[2], p[1]))


if view == "inside" and meta.get("rooms"):
    # from a corner of the living room toward the far one
    rm = next((r for r in meta["rooms"] if r["type"] == "living"), meta["rooms"][0])
    fy = meta.get("floor_y", 0)
    a = B((rm["x0"] + 0.35, fy + 1.55, rm["z1"] - 0.35))
    b = B((rm["x1"], fy + 1.1, rm["z0"]))
    co.location = a
    co.rotation_euler = (b - a).to_track_quat("-Z", "Y").to_euler()
    cam.lens = 14
    # (a lamp in the room: the sun alone leaves it black in a picture)
    lamp = bpy.data.lights.new("lamp", "POINT")
    lamp.energy = 400
    lo_ = bpy.data.objects.new("lamp", lamp)
    bpy.context.scene.collection.objects.link(lo_)
    lo_.location = B(((rm["x0"] + rm["x1"]) / 2, fy + 2.3, (rm["z0"] + rm["z1"]) / 2))
elif view == "door" and meta.get("doors"):
    d = next(d for d in meta["doors"] if d.get("ext"))
    along = Vector((math.cos(d["rot"]), math.sin(d["rot"]), 0))
    mid = B(d["hinge"]) + along * d["w"] / 2
    away = Vector((-along.y, along.x, 0))
    if (mid + away - Vector((centre.x, centre.y, mid.z))).length < (mid - Vector((centre.x, centre.y, mid.z))).length:
        away = -away
    co.location = mid + away * 3.6 + along * 1.2 + Vector((0, 0, 0.5))
    tgt = mid + Vector((0, 0, 0.1))
    co.rotation_euler = (tgt - co.location).to_track_quat("-Z", "Y").to_euler()
    cam.lens = 24
else:
    d, k, hgt = views[view]
    d = d.normalized()
    co.location = Vector((centre.x, centre.y, 0)) + d * reach * k + Vector((0, 0, hgt))
    tgt = Vector((centre.x, centre.y, min(centre.z, 2.2) if view != "aerial" else centre.z * 0.6))
    if view == "door":
        tgt = Vector((centre.x, lo.y, 1.6))
    co.rotation_euler = (tgt - co.location).to_track_quat("-Z", "Y").to_euler()

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 40
sc.cycles.use_denoising = True
sc.render.resolution_x = width
sc.render.resolution_y = width * 9 // 16
sc.view_settings.view_transform = "AgX"
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("[preview] saved", out, flush=True)
