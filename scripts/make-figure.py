#!/usr/bin/env python3
"""
Turn a game sprite (PNG/WebP with transparency) into a printable flat figure (binary STL).

The silhouette is extruded into a slab, so the mesh is closed by construction:
top cap + bottom cap (the same triangulation) + one wall quad per contour edge.
Every edge then belongs to exactly two triangles (watertight), which the site checks
again in the browser on the delivered file.

Only numpy and Pillow. No 3D model, no network.

usage: make-figure.py SRC OUT.stl [--frame COL,ROW --grid COLS,ROWS] [--height-mm 80] [--thick-mm 6]
                      [--eps-px 1.2] [--preview OUT.png]
"""
import argparse
import json
import struct
from collections import deque

import numpy as np
from PIL import Image


# ------------------------------------------------------------------ mask
def load_mask(path, frame=None, grid=None, alpha=128):
    im = Image.open(path).convert('RGBA')
    if frame and grid:
        cols, rows = grid
        fw, fh = im.width // cols, im.height // rows
        c, r = frame
        im = im.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh))
    a = np.array(im)[:, :, 3] >= alpha
    return a, im


def dilate(m):
    p = np.pad(m, 1)
    return p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]


def erode(m):
    p = np.pad(m, 1)
    return p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]


def largest_component(m):
    h, w = m.shape
    lab = np.zeros(m.shape, np.int32)
    best, best_n, n = 0, 0, 0
    for y, x in zip(*np.nonzero(m)):
        if lab[y, x]:
            continue
        n += 1
        q = deque([(y, x)])
        lab[y, x] = n
        size = 0
        while q:
            cy, cx = q.popleft()
            size += 1
            for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = n
                    q.append((ny, nx))
        if size > best_n:
            best, best_n = n, size
    return lab == best


def fill_holes(m):
    """Background not reachable from the border is a hole: fill it (a solid figure)."""
    h, w = m.shape
    seen = np.zeros(m.shape, bool)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if not m[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if not m[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        cy, cx = q.popleft()
        for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
            if 0 <= ny < h and 0 <= nx < w and not m[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return ~seen


def remove_pinches(m):
    """Two pixels touching only at a corner make the outline touch itself: fill one of the gaps."""
    for _ in range(20):
        a, b, c, d = m[:-1, :-1], m[:-1, 1:], m[1:, :-1], m[1:, 1:]
        p1 = a & d & ~b & ~c
        p2 = b & c & ~a & ~d
        if not (p1.any() or p2.any()):
            return m
        m = m.copy()
        m[:-1, 1:] |= p1
        m[:-1, :-1] |= p2
    return m


def clean_mask(m, close=2):
    m = np.pad(m, 2)
    for _ in range(close):
        m = dilate(m)
    for _ in range(close):
        m = erode(m)
    m = largest_component(m)
    m = fill_holes(m)
    m = remove_pinches(m)
    return m


# ------------------------------------------------------------------ outline
def trace_outline(m):
    """Walk the pixel-edge boundary of a single filled, hole-free region. Returns corner points, CCW in y-up."""
    h, w = m.shape
    nxt = {}
    # directed edges with the filled pixel on the left (image coords, y down → this is clockwise on screen)
    for y, x in zip(*np.nonzero(m)):
        if y == 0 or not m[y - 1, x]:
            nxt[(x + 1, y)] = (x, y)  # top edge, right→left
        if y == h - 1 or not m[y + 1, x]:
            nxt[(x, y + 1)] = (x + 1, y + 1)  # bottom edge, left→right
        if x == 0 or not m[y, x - 1]:
            nxt[(x, y)] = (x, y + 1)  # left edge, down
        if x == w - 1 or not m[y, x + 1]:
            nxt[(x + 1, y + 1)] = (x + 1, y)  # right edge, up
    start = min(nxt)
    pts = [start]
    cur = nxt[start]
    guard = 0
    while cur != start:
        pts.append(cur)
        cur = nxt[cur]
        guard += 1
        if guard > len(nxt) + 2:
            raise RuntimeError('outline did not close')
    if len(pts) != len(nxt):
        raise RuntimeError(f'outline is not a single loop ({len(pts)} of {len(nxt)} edges)')
    return np.array(pts, float)


def dp(pts, eps):
    """Douglas–Peucker on an open polyline."""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    L = np.hypot(*ab)
    if L == 0:
        d = np.hypot(*(pts - a).T)
    else:
        d = np.abs(ab[0] * (pts[:, 1] - a[1]) - ab[1] * (pts[:, 0] - a[0])) / L
    i = int(np.argmax(d))
    if d[i] <= eps:
        return np.array([a, b])
    left = dp(pts[: i + 1], eps)
    right = dp(pts[i:], eps)
    return np.vstack([left[:-1], right])


def simplify_closed(pts, eps):
    # split the loop at the two points farthest apart, simplify both halves
    i = 0
    j = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
    a = dp(np.vstack([pts[i : j + 1]]), eps)
    b = dp(np.vstack([pts[j:], pts[:1]]), eps)
    out = np.vstack([a[:-1], b[:-1]])
    return out


def seg_intersect(p1, p2, p3, p4):
    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    d1, d2 = orient(p3, p4, p1), orient(p3, p4, p2)
    d3, d4 = orient(p1, p2, p3), orient(p1, p2, p4)
    return (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0) and d1 * d2 < 0 and d3 * d4 < 0


def is_simple(poly):
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            if seg_intersect(a, b, poly[j], poly[(j + 1) % n]):
                return False
    return True


def signed_area(poly):
    x, y = poly[:, 0], poly[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


# ------------------------------------------------------------------ triangulation (ear clipping, CCW polygon)
def triangulate(poly):
    n = len(poly)
    idx = list(range(n))
    tris = []

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def inside(p, a, b, c):
        return cross(a, b, p) >= 0 and cross(b, c, p) >= 0 and cross(c, a, p) >= 0

    guard = 0
    while len(idx) > 3:
        guard += 1
        if guard > 10 * n * n:
            raise RuntimeError('ear clipping stuck')
        found = False
        m = len(idx)
        for k in range(m):
            i0, i1, i2 = idx[(k - 1) % m], idx[k], idx[(k + 1) % m]
            a, b, c = poly[i0], poly[i1], poly[i2]
            if cross(a, b, c) <= 1e-12:
                continue  # reflex or degenerate
            if any(inside(poly[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append((i0, i1, i2))
            del idx[k]
            found = True
            break
        if not found:
            # drop a collinear vertex, if any, and retry
            for k in range(len(idx)):
                i0, i1, i2 = idx[(k - 1) % len(idx)], idx[k], idx[(k + 1) % len(idx)]
                if abs(cross(poly[i0], poly[i1], poly[i2])) <= 1e-12:
                    del idx[k]
                    found = True
                    break
        if not found:
            raise RuntimeError('no ear found: polygon is not simple')
    tris.append(tuple(idx))
    return tris


# ------------------------------------------------------------------ mesh
def extrude(poly_mm, tris, thick):
    """Closed slab: bottom (z=0, facing down), top (z=thick, facing up), walls. Outward normals for a CCW polygon."""
    n = len(poly_mm)
    V = [(x, y, 0.0) for x, y in poly_mm] + [(x, y, thick) for x, y in poly_mm]
    F = []
    for a, b, c in tris:
        F.append((n + a, n + b, n + c))  # top, CCW seen from +z
        F.append((c, b, a))  # bottom, reversed
    for i in range(n):
        j = (i + 1) % n
        F.append((i, j, n + j))
        F.append((i, n + j, n + i))
    return np.array(V, float), F


def write_stl(path, V, F, name=b'just-cents figure'):
    with open(path, 'wb') as f:
        f.write(name.ljust(80, b' ')[:80])
        f.write(struct.pack('<I', len(F)))
        for a, b, c in F:
            p, q, r = V[a], V[b], V[c]
            nrm = np.cross(q - p, r - p)
            L = np.linalg.norm(nrm)
            nrm = nrm / L if L else nrm
            f.write(struct.pack('<12fH', *nrm, *p, *q, *r, 0))


def edge_report(F):
    from collections import Counter

    und = Counter()
    dirs = Counter()
    for a, b, c in F:
        for u, v in ((a, b), (b, c), (c, a)):
            und[(min(u, v), max(u, v))] += 1
            dirs[(u, v)] += 1
    open_edges = sum(1 for k in und.values() if k != 2)
    bad_dir = sum(1 for k in dirs.values() if k != 1)
    return open_edges, bad_dir, len(und)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--frame')
    ap.add_argument('--grid')
    ap.add_argument('--height-mm', type=float, default=80.0)
    ap.add_argument('--thick-mm', type=float, default=6.0)
    ap.add_argument('--eps-px', type=float, default=1.2)
    ap.add_argument('--preview')
    a = ap.parse_args()
    frame = tuple(int(v) for v in a.frame.split(',')) if a.frame else None
    grid = tuple(int(v) for v in a.grid.split(',')) if a.grid else None
    m, im = load_mask(a.src, frame, grid)
    m = clean_mask(m)
    outline = trace_outline(m)
    eps = a.eps_px
    while True:
        poly = simplify_closed(outline, eps)
        if is_simple(poly) or eps < 0.3:
            break
        eps *= 0.7
    if not is_simple(poly):
        raise SystemExit('outline is not simple even at small tolerance')
    # image y goes down: flip to y-up, then make it CCW
    poly = np.column_stack([poly[:, 0], -poly[:, 1]])
    if signed_area(poly) < 0:
        poly = poly[::-1]
    poly -= poly.min(axis=0)
    scale = a.height_mm / poly[:, 1].max()
    poly_mm = poly * scale
    tris = triangulate(poly_mm)
    V, F = extrude(poly_mm, tris, a.thick_mm)
    write_stl(a.out, V, F)
    open_edges, bad_dir, edges = edge_report(F)
    size = (V.max(axis=0) - V.min(axis=0)).round(2).tolist()
    info = {
        'src': a.src.split('/')[-1],
        'frame': a.frame,
        'outline_points': len(poly_mm),
        'triangles': len(F),
        'size_mm': size,
        'open_edges': open_edges,
        'misoriented_edges': bad_dir,
        'eps_px': round(eps, 3),
    }
    print(json.dumps(info))
    if a.preview:
        from PIL import ImageDraw

        k = 4
        W, H = int(poly_mm[:, 0].max() * k) + 20, int(poly_mm[:, 1].max() * k) + 20
        img = Image.new('RGB', (W, H), (245, 240, 242))
        d = ImageDraw.Draw(img)
        P = [(10 + x * k, H - 10 - y * k) for x, y in poly_mm]
        for t in tris:
            d.polygon([P[i] for i in t], outline=(200, 190, 200), fill=(150, 90, 160))
        d.line(P + [P[0]], fill=(40, 30, 40), width=2)
        img.save(a.preview)


if __name__ == '__main__':
    main()
