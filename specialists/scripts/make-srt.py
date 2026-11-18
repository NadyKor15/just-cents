#!/usr/bin/env python3
"""
Lay out spoken words (with start/end times, e.g. from Deepgram) as an SRT file that keeps the published rules:
up to 42 characters a line, 2 lines a subtitle, 20 characters a second, no overlap.
A new subtitle starts after a sentence end, after a pause over 0.7 s, or when the text would not fit two lines.
--shift S moves every time by S seconds: the careless demo specialist's mistake, made on purpose and labelled so.

usage: make-srt.py WORDS.json OUT.srt [--shift 1.2]
WORDS.json: {"words": [{"text": "Omar", "start": 18.47, "end": 18.95}, ...]}
"""
import argparse, json

MAX_LINE, MAX_LINES, MAX_CPS, GAP, MAX_DUR, LEAD = 42, 2, 20, 0.7, 6.0, 0.1

def two_lines(text):
    if len(text) <= MAX_LINE:
        return [text]
    words = text.split(" ")
    best = None
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        if len(a) <= MAX_LINE and len(b) <= MAX_LINE:
            score = abs(len(a) - len(b))
            if best is None or score < best[0]:
                best = (score, [a, b])
    return best[1] if best else None

def cues_of(words):
    cues, cur = [], []
    for w in words:
        if cur:
            text = " ".join(x["text"] for x in cur + [w])
            gap = w["start"] - cur[-1]["end"]
            ended = cur[-1]["text"][-1:] in ".?!"
            if ended or gap > GAP:
                cues.append(cur)
                cur = []
            elif two_lines(text) is None or w["end"] - cur[0]["start"] > MAX_DUR:
                # break after the last comma if there is one, so a sentence does not end in a one-word subtitle
                k = max((i for i, x in enumerate(cur[:-1]) if x["text"].endswith(",")), default=None)
                if k is not None and k >= 1:
                    cues.append(cur[: k + 1])
                    cur = cur[k + 1:]
                else:
                    cues.append(cur)
                    cur = []
        cur.append(w)
    if cur:
        cues.append(cur)
    return cues

def ts(s):
    ms = max(0, round(s * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("words")
    ap.add_argument("out")
    ap.add_argument("--shift", type=float, default=0.0)
    a = ap.parse_args()
    words = json.load(open(a.words))["words"]
    cues = cues_of(words)
    out, out_end = [], []
    for i, c in enumerate(cues):
        text = " ".join(x["text"] for x in c)
        prev_end = float(out_end[-1]) + 0.05 if out_end else 0.0
        start = max(prev_end, c[0]["start"] - LEAD)  # a subtitle shows a moment before the voice
        need = len(text) / (MAX_CPS - 2)  # a little under the limit
        nxt = cues[i + 1][0]["start"] - LEAD - 0.05 if i + 1 < len(cues) else None
        end = max(c[-1]["end"], start + need)
        if nxt is not None:
            end = min(end, nxt)
        if len(text) / (end - start) > MAX_CPS:
            raise SystemExit(f"subtitle {i + 1} cannot be read in time: {text!r}")
        lines = two_lines(text)
        if lines is None:
            raise SystemExit(f"subtitle {i + 1} does not fit {MAX_LINES} lines of {MAX_LINE}: {text!r}")
        out_end.append(end)
        out.append(f"{i + 1}\n{ts(start + a.shift)} --> {ts(end + a.shift)}\n" + "\n".join(lines) + "\n")
    open(a.out, "w").write("\n".join(out))
    print(f"{a.out}: {len(out)} subtitles, shift {a.shift}")

main()
