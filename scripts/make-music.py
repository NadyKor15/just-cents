#!/usr/bin/env python3
"""
Cut a music piece of an exact length from a licensed track and write the licence into the file itself.

The tags travel with the mp3 (ID3v2.4): title, artist, copyright, and custom TXXX frames
  LICENSE      — SPDX id, e.g. CC0-1.0 or CC-BY-4.0
  LICENSE_URL  — the licence's page
  SOURCE_URL   — the page the track was taken from (checked live)
  LICENSE_TEXT — the full licence text
The site reads these frames and the decoded length on the delivered file.

usage: make-music.py SRC OUT.mp3 --seconds 15 --start 0 --title T --artist A --license CC0-1.0
                     --license-url URL --source-url URL --license-text FILE
"""
import argparse
import subprocess


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--seconds', type=float, required=True)
    ap.add_argument('--start', type=float, default=0.0)
    ap.add_argument('--fade-out', type=float, default=1.0)
    ap.add_argument('--title', required=True)
    ap.add_argument('--artist', required=True)
    ap.add_argument('--license', required=True)
    ap.add_argument('--license-url', required=True)
    ap.add_argument('--source-url', required=True)
    ap.add_argument('--license-text', required=True)
    a = ap.parse_args()
    text = open(a.license_text, encoding='utf-8').read()
    fo = max(0.0, a.seconds - a.fade_out)
    cmd = [
        'ffmpeg', '-v', 'error', '-y',
        '-ss', f'{a.start:.3f}', '-i', a.src,
        '-t', f'{a.seconds:.3f}',
        '-af', f'afade=t=in:d=0.05,afade=t=out:st={fo:.3f}:d={a.fade_out:.3f}',
        '-ar', '44100', '-ac', '2', '-b:a', '160k',
        '-map_metadata', '-1', '-id3v2_version', '4',
        '-metadata', f'title={a.title}',
        '-metadata', f'artist={a.artist}',
        '-metadata', f'copyright={a.license} ({a.license_url})',
        '-metadata', f'LICENSE={a.license}',
        '-metadata', f'LICENSE_URL={a.license_url}',
        '-metadata', f'SOURCE_URL={a.source_url}',
        '-metadata', f'LICENSE_TEXT={text}',
        a.out,
    ]
    subprocess.run(cmd, check=True)


if __name__ == '__main__':
    main()
