#!/bin/bash
# Variant B icon: rasterize icon-b.svg (Chrome for Testing headless shell, not Google Chrome.app)
# and build the watermarked 128 px preview (same treatment as icon-preview-128.png).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
A="$HERE/assets"
CHROME="$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell | tail -1)"
MARK="$HERE/../public/assets/sym/s5-icon.png"

cat > "$A/.wrap-b.html" <<EOF
<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}img{display:block;width:1024px;height:1024px}</style><img src="icon-b.svg">
EOF
"$CHROME" --no-sandbox --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,1024 \
  --screenshot="$A/icon-b-1024.png" "file://$A/.wrap-b.html" >/dev/null 2>&1
rm -f "$A/.wrap-b.html"
magick "$A/icon-b-1024.png" -strip "$A/icon-b-1024.png"

magick "$A/icon-b-1024.png" -filter Lanczos -resize 128x128 "$A/.pb128.png"
magick "$MARK" -background none -resize 84x84 -channel A -evaluate multiply 0.40 +channel "$A/.mark-c.png"
magick "$MARK" -background none -resize 40x40 -channel A -evaluate multiply 0.40 +channel "$A/.mark-s.png"
magick "$A/.pb128.png" \
  -fill none -stroke 'rgba(255,255,255,0.55)' -strokewidth 1.5 \
  -draw "line -10,40 70,-10" -draw "line -10,100 100,-10" -draw "line 20,140 140,20" -draw "line 80,140 140,80" \
  "$A/.pb128b.png"
magick "$A/.pb128b.png" "$A/.mark-c.png" -gravity center -compose over -composite \
  "$A/.mark-s.png" -gravity northwest -geometry +6+6 -compose over -composite \
  "$A/.mark-s.png" -gravity southeast -geometry +6+6 -compose over -composite \
  -strip "$A/icon-b-preview-128.png"
rm -f "$A"/.pb128.png "$A"/.pb128b.png "$A"/.mark-c.png "$A"/.mark-s.png
magick identify "$A"/icon-b-1024.png "$A"/icon-b-preview-128.png
