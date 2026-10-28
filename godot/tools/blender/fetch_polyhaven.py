# Downloads Poly Haven glTF models into <out>/<asset>/ and checks every file's md5 (CC0 assets).
#   python3 -I tools/blender/fetch_polyhaven.py <out dir> 2k <asset> [asset...]
# The scans tools/blender/scans.py uses: namaqualand_boulder_03 namaqualand_boulder_04
# namaqualand_boulder_05 namaqualand_boulder_06 stone_01 rock_09 boulder_01
# rock_moss_set_01 rock_moss_set_02 namaqualand_stones_01 namaqualand_rocks_01 tree_stump_01
# tree_stump_02 dead_tree_trunk dead_tree_trunk_02 fern_02
import json, sys, os, hashlib, urllib.request
UA = {"User-Agent": "DustRoad-asset-fetch/1.0"}
def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA))
out = sys.argv[1]
res = sys.argv[2]
for a in sys.argv[3:]:
    d = json.load(get(f"https://api.polyhaven.com/files/{a}"))
    r = d["gltf"][res]["gltf"]
    files = [(os.path.basename(r["url"]), r)] + list(r["include"].items())
    os.makedirs(os.path.join(out, a), exist_ok=True)
    ok = True
    for rel, f in files:
        p = os.path.join(out, a, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if not (os.path.exists(p) and hashlib.md5(open(p, "rb").read()).hexdigest() == f["md5"]):
            open(p, "wb").write(get(f["url"]).read())
        if hashlib.md5(open(p, "rb").read()).hexdigest() != f["md5"]:
            ok = False
            print("BAD md5", a, rel)
    print(a, "ok" if ok else "FAILED")
