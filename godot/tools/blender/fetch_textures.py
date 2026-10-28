# Downloads Poly Haven textures (CC0): <out>/<asset>_{diff,nor,arm}.jpg at the given size, md5 checked.
#   python3 -I tools/blender/fetch_textures.py <out dir> 1k <asset> [asset...]
# The bark scans tools/blender/plants.py uses: pine_bark bark_brown_02 bark_willow_02
import json, sys, os, hashlib, urllib.request
UA = {"User-Agent": "DustRoad-asset-fetch/1.0"}
def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA))
out, res = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for a in sys.argv[3:]:
    d = json.load(get(f"https://api.polyhaven.com/files/{a}"))
    ok = True
    for key, name in (("Diffuse", "diff"), ("nor_gl", "nor"), ("arm", "arm")):
        f = d[key][res]["jpg"]
        p = os.path.join(out, f"{a}_{name}.jpg")
        if not (os.path.exists(p) and hashlib.md5(open(p, "rb").read()).hexdigest() == f["md5"]):
            open(p, "wb").write(get(f["url"]).read())
        ok &= hashlib.md5(open(p, "rb").read()).hexdigest() == f["md5"]
    print(a, "ok" if ok else "FAILED")
