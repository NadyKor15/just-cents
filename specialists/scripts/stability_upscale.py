"""Stability Fast Upscaler (4x, 2 credits per success, per docs.stability.ai pricing.md and upscale/fast.md read 2026-11-18).
Key from env STABILITY_API_KEY (run under vaultenv.py); never printed.
usage: stability_upscale.py IN.png OUT.jpg [--dry]   prints balance before/after and the output size."""
import json, os, sys, urllib.error, urllib.request, uuid

KEY = os.environ.get("STABILITY_API_KEY", "")
if not KEY:
    sys.exit("no STABILITY_API_KEY in env")

def balance():
    req = urllib.request.Request("https://api.stability.ai/v1/user/balance", headers={"Authorization": "Bearer " + KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("credits")

src, out = sys.argv[1], sys.argv[2]
b0 = balance()
print(f"balance before: {b0}", flush=True)
if "--dry" in sys.argv:
    sys.exit(0)
if b0 is None or b0 < 2 + 5:
    sys.exit("refuse: balance would drop below 5 after a 2-credit call")
bnd = uuid.uuid4().hex
img = open(src, "rb").read()
body = (f"--{bnd}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"frame.png\"\r\nContent-Type: image/png\r\n\r\n").encode() + img + \
       (f"\r\n--{bnd}\r\nContent-Disposition: form-data; name=\"output_format\"\r\n\r\njpeg\r\n--{bnd}--\r\n").encode()
req = urllib.request.Request("https://api.stability.ai/v2beta/stable-image/upscale/fast", data=body, method="POST",
                             headers={"Authorization": "Bearer " + KEY, "Accept": "image/*", "Content-Type": f"multipart/form-data; boundary={bnd}"})
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
        print(f"status {r.status} finish-reason {r.headers.get('finish-reason')} seed {r.headers.get('seed')} content-type {r.headers.get('content-type')} bytes {len(data)}", flush=True)
        open(out, "wb").write(data)
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read()[:300].decode(errors='replace')}", flush=True)
b1 = balance()
print(f"balance after: {b1} (spent {None if b0 is None or b1 is None else round(b0 - b1, 3)})", flush=True)
