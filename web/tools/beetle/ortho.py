# Tiny z-buffered orthographic rasterizer for labelled component plots (top/side/front/rear).
import numpy as np
from PIL import Image, ImageDraw

VIEWS = {
    'side': (lambda p: (-p[:, 2], -p[:, 1], -p[:, 0])),  # looking at the left side (+x), front to the left
    'top': (lambda p: (-p[:, 2], -p[:, 0], -p[:, 1])),
    'front': (lambda p: (-p[:, 0], -p[:, 1], -p[:, 2])),
    'rear': (lambda p: (p[:, 0], -p[:, 1], p[:, 2])),
    'under': (lambda p: (-p[:, 2], p[:, 0], p[:, 1])),
    'rside': (lambda p: (p[:, 2], -p[:, 1], p[:, 0])),
}


def render(tris_list, view, px_per_m=180, bounds=((-2.3, 2.3), (-1.9, 0.1)), labels=None, clip=None):
    """tris_list: [(P (n,3,3) car-space triangles, rgb)], labels: [(xyz, text)]"""
    fx = VIEWS[view]
    (u0, u1), (v0, v1) = bounds
    W, H = int((u1 - u0) * px_per_m), int((v1 - v0) * px_per_m)
    img = np.full((H, W, 3), 235, np.uint8)
    zb = np.full((H, W), np.inf)
    L = np.array([0.3, 0.8, 0.5]); L /= np.linalg.norm(L)
    for P, col in tris_list:
        if len(P) == 0:
            continue
        if clip is not None:
            keep = clip(P.mean(1))
            P = P[keep]
        flat = P.reshape(-1, 3)
        u, v, d = fx(flat)
        u = ((u - u0) * px_per_m).reshape(-1, 3)
        v = ((v - v0) * px_per_m).reshape(-1, 3)
        d = d.reshape(-1, 3)
        n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        sh = 0.45 + 0.55 * np.abs(n @ L)
        for k in range(len(P)):
            x = u[k]; y = v[k]
            xmin, xmax = int(max(0, np.floor(x.min()))), int(min(W - 1, np.ceil(x.max())))
            ymin, ymax = int(max(0, np.floor(y.min()))), int(min(H - 1, np.ceil(y.max())))
            if xmin > xmax or ymin > ymax:
                continue
            gx, gy = np.meshgrid(np.arange(xmin, xmax + 1) + 0.5, np.arange(ymin, ymax + 1) + 0.5)
            x0, x1, x2 = x; y0, y1, y2 = y
            den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(den) < 1e-9:
                continue
            a = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / den
            b = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / den
            c = 1 - a - b
            m = (a >= -1e-3) & (b >= -1e-3) & (c >= -1e-3)
            if not m.any():
                continue
            z = a * d[k][0] + b * d[k][1] + c * d[k][2]
            sub = zb[ymin:ymax + 1, xmin:xmax + 1]
            m &= z < sub
            sub[m] = z[m]
            img[ymin:ymax + 1, xmin:xmax + 1][m] = (np.array(col) * sh[k]).astype(np.uint8)
    im = Image.fromarray(img)
    if labels:
        dr = ImageDraw.Draw(im)
        for xyz, text in labels:
            u, v, _ = fx(np.array([xyz]))
            dr.text(((u[0] - u0) * px_per_m, (v[0] - v0) * px_per_m), text, fill=(0, 0, 0))
    return im
