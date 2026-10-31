# Contact sheet of a plant species from tools/blender/plants.py: every variant (and its coarse
# model behind it) with its bark, twig cards and painted skins, rendered with Cycles in sun.
#
#   blender -b --factory-startup --python tools/blender/plant_preview.py -- <plants dir> <twigs dir> <bark dir> <species> <out.png>

import bpy
import math
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
root, twigs, barks, species, out = argv[:5]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(root, species + ".glb"))
objs = sorted([o for o in bpy.context.scene.objects if o.type == "MESH"], key=lambda o: o.name)

BARK = {"bark_pine": "pine_bark", "bark_grey": "bark_willow_02", "bark_dead": "bark_willow_02", "bark_joshua": "bark_willow_02", "bark_ocotillo": "bark_willow_02"}


def image(path, colour=True):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    return img


def material(name):
    m = bpy.data.materials.new(name + "_p")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    vc = nt.nodes.new("ShaderNodeVertexColor")
    tex = None
    if name.startswith("leaf_"):
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image(os.path.join(twigs, f"twig_{name[5:]}_albedo.png"))
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        # (cards carry the crown's outward normal on both sides, as the game shades them)
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        bsdf.inputs["Roughness"].default_value = 0.7
    elif name in BARK:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image(os.path.join(barks, BARK[name] + "_diff.jpg"))
    elif name in ("bark_birch", "cactus_saguaro", "cactus_barrel"):
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image(os.path.join(root, "textures", name + "_albedo.jpg"))
    elif name in ("grass", "meadow", "snowgrass", "reeds"):
        cols = {"grass": ((0.33, 0.27, 0.16), (0.72, 0.62, 0.4)), "meadow": ((0.2, 0.3, 0.08), (0.52, 0.56, 0.24)), "snowgrass": ((0.35, 0.3, 0.2), (0.7, 0.62, 0.45)), "reeds": ((0.25, 0.32, 0.12), (0.62, 0.6, 0.35))}[name]
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(uv.outputs["UV"], sep.inputs[0])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        nt.links.new(sep.outputs[1], mix.inputs["Factor"])
        mix.inputs["A"].default_value = (*cols[0], 1)
        mix.inputs["B"].default_value = (*cols[1], 1)
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        return m
    if tex:
        nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1
        nt.links.new(tex.outputs["Color"], mul.inputs["A"])
        nt.links.new(vc.outputs["Color"], mul.inputs["B"])
        nt.links.new(mul.outputs["Result"], bsdf.inputs["Base Color"])
    else:
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    return m


cache = {}
xs = {}
maxh = 0.0
for o in objs:
    for i, slot in enumerate(o.material_slots):
        n = slot.material.name.split(".")[0]
        if n not in cache:
            cache[n] = material(n)
        slot.material = cache[n]
    maxh = max(maxh, o.dimensions.z)
gap = max(1.6, max(max(o.dimensions.x, o.dimensions.y) for o in objs) * 1.15)
for o in objs:
    base = o.name.replace("_mid", "")
    v = int(base.split("_")[-1])
    o.location = (v * gap, gap * 1.3 if o.name.endswith("_mid") else 0.0, 0)

bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
g = bpy.context.object
gm = bpy.data.materials.new("ground")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.36, 0.3, 0.22, 1)
g.data.materials.append(gm)
bpy.ops.object.light_add(type="SUN", rotation=(math.radians(50), 0, math.radians(30)))
bpy.context.object.data.energy = 4
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.45, 0.55, 0.7, 1)
w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
sc = bpy.context.scene
sc.world = w
n = len([o for o in objs if not o.name.endswith("_mid")])
width = (n - 1) * gap
size = max(width + gap, maxh * 2.2)
bpy.ops.object.camera_add(location=(width / 2, -size * 1.25, maxh * 0.75))
cam = bpy.context.object
cam.rotation_euler = (math.radians(86), 0, 0)
cam.data.lens = 40
sc.camera = cam
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 24
sc.cycles.use_denoising = True
sc.render.resolution_x = 1400
sc.render.resolution_y = 700
sc.view_settings.view_transform = "AgX"
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
