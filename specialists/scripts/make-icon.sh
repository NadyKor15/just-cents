#!/bin/bash
# Rasterize icon.svg -> icon-1024.png (Chrome headless shell from the Playwright cache),
# then build the watermarked 128 px preview and the deliberately wrong 512 px "PLAY" variant.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
A="$HERE/assets"
CHROME="$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell | tail -1)"
MARK="$HERE/../public/assets/sym/s5-icon.png"

cat > "$A/.wrap.html" <<EOF
<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}img{display:block;width:1024px;height:1024px}</style><img src="icon.svg">
EOF
"$CHROME" --no-sandbox --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,1024 \
  --screenshot="$A/icon-1024.png" "file://$A/.wrap.html" >/dev/null 2>&1
rm -f "$A/.wrap.html"
magick "$A/icon-1024.png" -strip "$A/icon-1024.png"

# 128 preview: downscale, then overlay the brand mark (no letters) at ~40 % + thin diagonals
magick "$A/icon-1024.png" -filter Lanczos -resize 128x128 "$A/.p128.png"
magick "$MARK" -background none -resize 84x84 -channel A -evaluate multiply 0.40 +channel "$A/.mark-c.png"
magick "$MARK" -background none -resize 40x40 -channel A -evaluate multiply 0.40 +channel "$A/.mark-s.png"
magick "$A/.p128.png" \
  -fill none -stroke 'rgba(255,255,255,0.55)' -strokewidth 1.5 \
  -draw "line -10,40 70,-10" -draw "line -10,100 100,-10" -draw "line 20,140 140,20" -draw "line 80,140 140,80" \
  "$A/.p128b.png"
magick "$A/.p128b.png" "$A/.mark-c.png" -gravity center -compose over -composite \
  "$A/.mark-s.png" -gravity northwest -geometry +6+6 -compose over -composite \
  "$A/.mark-s.png" -gravity southeast -geometry +6+6 -compose over -composite \
  -strip "$A/icon-preview-128.png"
rm -f "$A"/.p128.png "$A"/.p128b.png "$A"/.mark-c.png "$A"/.mark-s.png

# deliberately wrong variant: 512 px with a big word (tests only)
FONT="$(ls /System/Library/Fonts/Supplemental/Arial\ Bold.ttf 2>/dev/null || ls /System/Library/Fonts/Helvetica.ttc)"
magick "$A/icon-1024.png" -resize 512x512 \
  -gravity center -font "$FONT" -pointsize 190 -fill white -stroke '#0A4F86' -strokewidth 8 \
  -annotate +0+0 "PLAY" -strip "$A/icon-bad-512-with-text.png"
magick identify "$A"/icon-1024.png "$A"/icon-preview-128.png "$A"/icon-bad-512-with-text.png
