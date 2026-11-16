#!/usr/bin/env python3
"""Translate description-en.txt with the LOCAL ollama model (no remote API).

usage: translate.py <lang-code> <output-file> [extra instruction ...]
  lang-code: es | fr | de | pt
Model: gemma4:26b-a4b-it-qat (fallback granite4.2:8b if the first is missing).
"""
import json, sys, urllib.request, pathlib, re

HERE = pathlib.Path(__file__).resolve().parent.parent
SRC = (HERE / "assets" / "description-en.txt").read_text(encoding="utf-8").strip()
LANGS = {"es": "Spanish (neutral, Latin American/Spain-safe)", "fr": "French", "de": "German", "pt": "Brazilian Portuguese"}
MODELS = ["gemma4:26b-a4b-it-qat", "granite4.2:8b"]


def have(model):
    with urllib.request.urlopen("http://localhost:11434/api/tags") as r:
        return any(m["name"] == model for m in json.load(r)["models"])


def main():
    lang, out = sys.argv[1], sys.argv[2]
    extra = " ".join(sys.argv[3:])
    model = next(m for m in MODELS if have(m))
    prompt = (
        f"Translate the store-page description below into {LANGS[lang]}.\n"
        "Rules:\n"
        "- Natural, fluent store-page copy, not word-for-word. Keep every fact, add none.\n"
        "- Length: between 90 and 105 words in the translation.\n"
        "- The FIRST sentence must be a self-contained hook sentence of 14 to 24 words that makes sense on its own and is written entirely in the target language "
        "(do not put the English game title in it; you may use the title in a later sentence). It must be about an agent that handles a teenager's money strictly by the rules the player writes.\n"
        "- Keep 'Autopilot: Summer Rules' (title), 'Autopilot', 'Sara', 'AED 350' and 'Dubai' as they are.\n"
        "- Output ONLY the translated text as one paragraph. No quotes, no notes, no headings.\n"
        f"{extra}\n\n--- DESCRIPTION ---\n{SRC}\n"
    )
    body = json.dumps({"model": model, "prompt": prompt, "stream": False, "think": False,
                       "options": {"temperature": 0.3, "seed": int(__import__("os").environ.get("SEED", "7")), "num_predict": 600}}).encode()
    req = urllib.request.Request("http://localhost:11434/api/generate", body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        txt = json.load(r)["response"].strip()
    txt = re.sub(r"\s*\n\s*", " ", txt).strip().strip('"')
    pathlib.Path(out).write_text(txt + "\n", encoding="utf-8")
    print(model, lang, len(txt.split()), "words")
    print(txt)


main()
