#!/bin/bash
# Voice-over with the built-in macOS voice, converted with ffmpeg.
# usage: make-voice.sh [rate-wpm]   (default 200)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
A="$HERE/assets"
VOICE="Samantha"
RATE="${1:-200}"
TMP="$(mktemp -d)"

say -v "$VOICE" -r "$RATE" -o "$TMP/full.aiff" -f "$A/voice-script.txt"
say -v "$VOICE" -r "$RATE" -o "$TMP/bad.aiff" -f "$HERE/scripts/voice-bad-script.txt"

ENC=(-ac 1 -ar 44100 -c:a libmp3lame -b:a 96k)
ffmpeg -y -loglevel error -i "$TMP/full.aiff" "${ENC[@]}" "$A/voice-full.mp3"
ffmpeg -y -loglevel error -i "$TMP/bad.aiff" "${ENC[@]}" "$A/voice-bad-32s.mp3"
# first 3.0 s with a 0.4 s fade-out at the end
ffmpeg -y -loglevel error -i "$A/voice-full.mp3" -t 3.0 -af "afade=t=out:st=2.6:d=0.4" "${ENC[@]}" "$A/voice-preview-3s.mp3"
rm -rf "$TMP"
for f in voice-full voice-preview-3s voice-bad-32s; do
  printf '%s ' "$f"; ffprobe -v error -show_entries format=duration -of csv=p=0 "$A/$f.mp3"
done
