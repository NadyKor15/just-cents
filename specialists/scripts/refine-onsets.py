#!/usr/bin/env python3
"""
The yardstick for the subtitle timing rule, measured once on the trailer before any specialist works.
Word times come from an open speech model (faster-whisper small.en, run locally). Its word starts can be early by a
few tenths of a second, so each start is moved to a clear speech onset in the sound itself when there is one nearby:
the 300-3400 Hz energy (20 ms steps) rising by 15 dB or more from below -35 dB, within -0.3..+0.5 s of the model's start.
Only words after a pause of 0.25 s or more (where subtitle lines start) are moved; words inside running speech keep the model's time. The model's own start stays in the file as start_model.

usage: refine-onsets.py AUDIO WORDS_IN.json WORDS_OUT.json
"""
import json, subprocess, sys
import numpy as np

SR, HOP = 16000, 320  # 20 ms
FLOOR, RISE, BEFORE, AFTER, PAUSE = -35.0, 15.0, 0.3, 0.5, 0.25

def envelope_db(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X[(f < 300) | (f > 3400)] = 0
    y = np.fft.irfft(X, len(x))
    e = np.sqrt((y[: len(y) // HOP * HOP].reshape(-1, HOP) ** 2).mean(1))
    return 20 * np.log10(e + 1e-6)

def onset(db, t):
    a, b = max(1, int((t - BEFORE) * SR / HOP)), min(len(db) - 1, int((t + AFTER) * SR / HOP))
    for i in range(a, b):
        if db[i - 1] < FLOOR and db[i] - db[i - 1] >= RISE:
            return round(i * HOP / SR, 2)
    return None

def main():
    audio, src, out = sys.argv[1:4]
    d = json.load(open(src))
    db = envelope_db(audio)
    moved, prev_end = 0, -1.0
    for w in d["words"]:
        w["start_model"] = w["start"]
        after_pause = w["start"] - prev_end >= PAUSE
        prev_end = w["end"]
        o = onset(db, w["start"]) if after_pause else None
        if o is not None and abs(o - w["start"]) >= 0.02:
            w["start"] = o
            moved += 1
    d["_note"] = d.get("_note", "") + f" Starts refined to speech onsets by specialists/scripts/refine-onsets.py ({moved} moved)."
    json.dump(d, open(out, "w"), ensure_ascii=False, indent=1)
    print(f"{out}: {len(d['words'])} words, {moved} starts moved to an onset")

main()
