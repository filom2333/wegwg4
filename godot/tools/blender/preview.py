# Contact sheet of a species' game models as the scan pipeline made them: each variant (and its
# coarse mesh behind it) with the baked textures, lit by a low sun, rendered with Cycles.
#
#   blender -b --factory-startup --python tools/blender/preview.py -- <dir with species.glb> <species> <out.png>

import bpy
import math
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
root, species, out = argv[0], argv[1], argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(root, species + ".glb"))
objs = sorted([o for o in bpy.context.scene.objects if o.type == "MESH"], key=lambda o: o.name)


def material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tdir = os.path.join(root, "textures")

    def tex(kind, colour):
        p = os.path.join(tdir, f"{name}_{kind}.jpg")
        if not os.path.exists(p):
            return None
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(p)
        n.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        return n

    a = tex("albedo", True)
    if a:
        nt.links.new(a.outputs["Color"], bsdf.inputs["Base Color"])
    n = tex("normal", False)
    if n:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(n.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    o = tex("orm", False)
    if o:
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(o.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"])
    return m


x = 0.0
for o in objs:
    base = o.name.replace("_lod1", "")
    o.data.materials.clear()
    o.data.materials.append(bpy.data.materials.get(base) or material(base))
    v = int(base.split("_")[-1])
    o.location = (v * 3.0, 3.0 if o.name.endswith("_lod1") else 0.0, 0)

# ground, sun, sky, camera
bpy.ops.mesh.primitive_plane_add(size=60, location=(4, 2, 0))
g = bpy.context.object
gm = bpy.data.materials.new("ground")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.3, 0.24, 1)
g.data.materials.append(gm)
bpy.ops.object.light_add(type="SUN", rotation=(math.radians(55), 0, math.radians(35)))
bpy.context.object.data.energy = 4
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.45, 0.55, 0.7, 1)
w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
sc = bpy.context.scene
sc.world = w
n = len([o for o in objs if not o.name.endswith("_lod1")])
cx = (n - 1) * 1.5
bpy.ops.object.camera_add(location=(cx, -7.5 - n * 0.9, 3.2))
cam = bpy.context.object
cam.rotation_euler = (math.radians(74), 0, 0)
cam.data.lens = 35
sc.camera = cam
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 24
sc.cycles.use_denoising = True
sc.render.resolution_x = 1280
sc.render.resolution_y = 640
sc.view_settings.view_transform = "AgX"
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
