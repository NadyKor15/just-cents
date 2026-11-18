#!/usr/bin/env python3
"""
The author's logo sketch, photographed on a blanket, made ready for tracing — and nothing else:
1. find the sheet (bright, not blue) and its four corners;
2. straighten it (perspective) to a flat rectangle;
3. even out the white (divide by a heavy blur of the page, so shadows and the paper tint go) and turn it to grey;
4. crop to the drawing with a small margin.
Nothing is drawn, removed or retouched on the sheet. Needs numpy and ffmpeg.

usage: prepare-sketch.py PHOTO.jpg OUT.png [--width 1200] [--inset 0.012]
"""
import argparse, subprocess
import numpy as np

def load(path):
    w, h = map(int, subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
                                   capture_output=True, text=True, check=True).stdout.strip().split(","))
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(h, w, 3).astype(np.float32)

def sheet_corners(img):
    small = img[::8, ::8]
    r, g, b = small[..., 0], small[..., 1], small[..., 2]
    mask = (r > 140) & (r - b > 12)  # paper is warm (red over blue by ~27); the blanket is grey-blue (about -2)
    ys, xs = np.nonzero(mask)
    pts = np.stack([xs, ys], 1).astype(np.float32) * 8
    s, d = pts[:, 0] + pts[:, 1], pts[:, 0] - pts[:, 1]
    tl, br = pts[np.argmin(s)], pts[np.argmax(s)]
    tr, bl = pts[np.argmax(d)], pts[np.argmin(d)]
    return np.array([tl, tr, br, bl], np.float32)

def homography(src, dst):
    a = []
    for (x, y), (u, v) in zip(src, dst):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.array(a))
    return vt[-1].reshape(3, 3) / vt[-1][-1]

def warp(img, corners, w, h):
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], np.float32)
    hm = homography(dst, corners)  # output pixel -> photo pixel
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    p = hm @ np.stack([xx.ravel(), yy.ravel(), np.ones(w * h, np.float32)])
    x, y = p[0] / p[2], p[1] / p[2]
    x0, y0 = np.clip(np.floor(x).astype(int), 0, img.shape[1] - 2), np.clip(np.floor(y).astype(int), 0, img.shape[0] - 2)
    fx, fy = (x - x0)[:, None], (y - y0)[:, None]
    out = (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)
    return out.reshape(h, w, 3)

def box_blur(a, r):
    c = np.cumsum(np.cumsum(np.pad(a, ((r + 1, r), (r + 1, r)), mode="edge"), 0), 1)
    return (c[2 * r + 1:, 2 * r + 1:] - c[:-2 * r - 1, 2 * r + 1:] - c[2 * r + 1:, :-2 * r - 1] + c[:-2 * r - 1, :-2 * r - 1]) / (2 * r + 1) ** 2

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photo")
    ap.add_argument("out")
    ap.add_argument("--width", type=int, default=1200)
    ap.add_argument("--inset", type=float, default=0.012, help="fraction trimmed from each sheet edge (the paper's own border)")
    a = ap.parse_args()
    img = load(a.photo)
    c = sheet_corners(img)
    ratio = (np.linalg.norm(c[3] - c[0]) + np.linalg.norm(c[2] - c[1])) / (np.linalg.norm(c[1] - c[0]) + np.linalg.norm(c[2] - c[3]))
    w, h = a.width, int(round(a.width * ratio))
    flat = warp(img, c, w, h)
    i = int(round(a.inset * w))
    flat = flat[i:h - i, i:w - i]
    grey = flat @ np.array([0.299, 0.587, 0.114], np.float32)
    paper = box_blur(np.maximum(grey, np.percentile(grey, 60)), max(8, w // 30))  # the page without the ink
    even = np.clip(grey / np.maximum(paper, 1) * 255, 0, 255).astype(np.uint8)
    # 4. crop to the drawing with a margin, so the logo has no empty page around it
    ys, xs = np.nonzero(even < 110)
    m = int(0.04 * max(np.ptp(xs), np.ptp(ys)))
    even = even[max(0, ys.min() - m):ys.max() + m + 1, max(0, xs.min() - m):xs.max() + m + 1]
    hh, ww = even.shape
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{ww}x{hh}", "-i", "-", a.out], input=even.tobytes(), check=True)
    print(f"{a.out}: {ww}x{hh}, corners {np.round(c).astype(int).tolist()}")

main()
