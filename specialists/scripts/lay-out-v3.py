#!/usr/bin/env python3
"""
Lays out the kit v3 files from specialists/assets-v3 into the site (run from code/just-cents, before scripts/sign-offers.ts):
  public/files/      full files, served only after payment (through /full/<key>)
  public/previews/   what a person sees before paying: covers 320x200 with the brand mark, the first 3 subtitles, the logo at 128 px
  public/game-frames/ the game frames the covers were made from, and the logo sketch (the order's own inputs)
  src/data/trailer-words.json  the timing yardstick for subtitles
The logo is traced from the sketch here with VTracer (open source, MIT): `--logo` needs the vtracer Python package.

usage: lay-out-v3.py [--logo SKETCH.png]
"""
import argparse, json, shutil, subprocess
from pathlib import Path

A = Path("specialists/assets-v3")
FILES, PREV, FRAMES = Path("public/files"), Path("public/previews"), Path("public/game-frames")
MARK = Path("public/assets/sym/s5-icon.png")

def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)

def cover_preview(src, out):
    # 320x200, the brand mark at 40 % in the middle: enough to choose by taste, not enough to use
    ff("-i", str(src), "-i", str(MARK), "-filter_complex",
       "[0]scale=320:200:flags=lanczos[b];[1]scale=72:72,format=rgba,colorchannelmixer=aa=0.4[m];[b][m]overlay=(W-w)/2:(H-h)/2",
       "-q:v", "4", str(out))

def first_subtitles(src, out, n=3):
    blocks = Path(src).read_text().strip().split("\n\n")
    Path(out).write_text("\n\n".join(blocks[:n]) + "\n")

def trace_logo(sketch, out_svg):
    import vtracer
    vtracer.convert_image_to_svg_py(str(sketch), str(out_svg), colormode="binary", mode="spline",
                                    filter_speckle=8, corner_threshold=60, length_threshold=4.0, splice_threshold=45, path_precision=2)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--logo", help="sketch image to trace (PNG/JPEG)")
    a = ap.parse_args()
    for d in (FILES, PREV, FRAMES):
        d.mkdir(parents=True, exist_ok=True)
    for v in ("a", "b"):
        shutil.copyfile(A / f"cover-{v}.jpg", FILES / f"cover-{v}.jpg")
        shutil.copyfile(A / f"frame-{v}.png", FRAMES / f"cover-frame-{v}.png")
        cover_preview(A / f"cover-{v}.jpg", PREV / f"cover-{v}.jpg")
    for who in ("sam", "lena"):
        for kind in ("", "-careless"):
            shutil.copyfile(A / f"subs-{who}{kind}.srt", FILES / f"subs-{who}{kind}.srt")
            first_subtitles(A / f"subs-{who}{kind}.srt", PREV / f"subs-{who}{kind}.srt")
    shutil.copyfile(A / "yard-refined.json", "src/data/trailer-words.json")
    if a.logo:
        shutil.copyfile(a.logo, FRAMES / "logo-sketch.png")
        trace_logo(a.logo, FILES / "logo.svg")
        raster = PREV / "logo-raster.tmp.png"
        subprocess.run(["magick", "-background", "white", str(FILES / "logo.svg"), "-flatten", "-resize", "128x128", str(raster)], check=True)
        ff("-i", str(raster), "-i", str(MARK), "-filter_complex",
           "[0]scale=128:128[b];[1]scale=40:40,format=rgba,colorchannelmixer=aa=0.4[m];[b][m]overlay=(W-w)/2:(H-h)/2", str(PREV / "logo-128.png"))
        raster.unlink()
    print(json.dumps({"files": sorted(p.name for p in FILES.iterdir()), "previews": sorted(p.name for p in PREV.iterdir())}))

main()
