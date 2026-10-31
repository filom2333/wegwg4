# Re-encodes the building scans (CC0, Poly Haven; fetched with tools/blender/fetch_textures.py at
# 1k) for the game: colour and normal maps at 1024, the AO/roughness/metal map at 512 (the
# longer side; a scan that is not square keeps its shape).
#   python3 -I tools/build/pack_building.py <download dir> <out dir>
import os, sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
names = sorted({f.rsplit("_", 1)[0] for f in os.listdir(src) if f.endswith(".jpg")})
for n in names:
    for kind, size, q in (("diff", 1024, 86), ("nor", 1024, 92), ("arm", 512, 88)):
        im = Image.open(os.path.join(src, f"{n}_{kind}.jpg")).convert("RGB")
        # (the longer side to `size`, keeping the scan's shape)
        k = size / max(im.size)
        if k != 1:
            im = im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)
        im.save(os.path.join(out, f"{n}_{kind}.jpg"), quality=q, optimize=True)
    print(n)
