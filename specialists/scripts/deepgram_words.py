"""Deepgram pre-recorded transcription → words with times (JSON). Key from env DEEPGRAM_API_KEY (vaultenv.py), never printed.
usage: deepgram_words.py AUDIO MODEL OUT.json      e.g. nova-3 / nova-2"""
import json, os, sys, urllib.error, urllib.request

KEY = os.environ.get("DEEPGRAM_API_KEY", "")
if not KEY:
    sys.exit("no DEEPGRAM_API_KEY in env")
audio, model, out = sys.argv[1], sys.argv[2], sys.argv[3]
url = f"https://api.deepgram.com/v1/listen?model={model}&language=en&smart_format=true&punctuate=true"
req = urllib.request.Request(url, data=open(audio, "rb").read(), method="POST",
                             headers={"Authorization": "Token " + KEY, "Content-Type": "audio/mpeg"})
try:
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.load(r)
except urllib.error.HTTPError as e:
    sys.exit(f"HTTP {e.code}: {e.read()[:300].decode(errors='replace')}")
meta = d.get("metadata", {})
alt = d["results"]["channels"][0]["alternatives"][0]
words = [{"text": w.get("punctuated_word", w["word"]), "start": w["start"], "end": w["end"], "confidence": w.get("confidence")} for w in alt["words"]]
json.dump({"model": model, "request_id": meta.get("request_id"), "duration": meta.get("duration"), "model_info": meta.get("model_info"),
           "transcript": alt.get("transcript"), "words": words}, open(out, "w"), indent=1)
print(json.dumps({"model": model, "request_id": meta.get("request_id"), "duration_s": meta.get("duration"), "words": len(words),
                  "first": words[0] if words else None, "last": words[-1] if words else None}))
