# Demo assets for the three specialists

Demo order: "Make me a kit to list my game." Game: "Autopilot: Summer Rules", a separate, already published
browser game. All text is based only on facts from its public store page.
Everything below is generated locally; no paid or remote APIs. Run from `code/just-cents`.

Files live in `specialists/assets/`; `MANIFEST.json` lists bytes, sha256 and measured facts for each.
Files marked TEST ONLY are deliberately wrong and are used only in tests.

## Icon (specialist "icon")
- `icon.svg` is hand-authored (sun, paper plane, dotted route, waves; no text elements).
- `bash specialists/scripts/make-icon.sh` rasterizes it with Chrome for Testing 154 (headless shell from the
  Playwright cache, not the installed Google Chrome) to `icon-1024.png`, then uses ImageMagick 7.1.2 to build
  - `icon-preview-128.png`: Lanczos downscale to 128 px, 4 thin diagonal lines, and the brand mark
    `docs/ui/2026-11-16-image-first-justcents/html-v2/assets/sym/s5-icon.png` at 40 % opacity (one 84 px copy in the centre,
    two 40 px copies in opposite corners). The mark contains a cent-sign glyph; no other letters or digits.
  - `icon-bad-512-with-text.png` (TEST ONLY): 512 px with the word PLAY.

## Descriptions (specialists "lena" and "sam")
- `description-en.txt` is written by hand from the itch page (109 words).
- Translations: `python3 -I specialists/scripts/translate.py <es|fr|de|pt> <out-file> ["extra instruction"]`
  using the local ollama (0.35.1) model `gemma4:26b-a4b-it-qat` (id 2dd70431afed, Q4_0, 25.2B); `SEED=<n>` env var changes the seed.
  Default seed 7. Final files came from re-prompts with extra instructions (faithfulness, no English leftovers, fixes of
  model typos such as "extractinto"): es seed 21, de seed 7, fr seed 7, pt seed 21. The first sentence is requested as a
  self-contained hook without the English title. `description-pt-instead-of-es.txt` (TEST ONLY) is the Portuguese version.
- `node specialists/scripts/check-langs.mjs` checks every file with franc 6.2.0 (whole text and first sentence alone),
  restricted to spa, fra, deu, por, ita, eng, cat, glg, nld. Exit code 1 if any result differs from the expected language.

## Voice-over (specialist "voice")
- `voice-script.txt` is the English trailer line (42 words).
- `bash specialists/scripts/make-voice.sh [rate]` (default 200 wpm) speaks it with macOS `say -v Samantha` (en_US),
  converts with ffmpeg 9.0.2 (`-ac 1 -ar 44100 -c:a libmp3lame -b:a 96k`) to `voice-full.mp3` (12.25 s),
  cuts `voice-preview-3s.mp3` (`-t 3.0`, `afade=t=out:st=2.6:d=0.4`), and makes `voice-bad-32s.mp3` (TEST ONLY, 30.17 s)
  from `scripts/voice-bad-script.txt`.

## Game material in the clip (not paid parts)
The game is the author's separate, already published project. `assets/game-frames/*.jpg` are stills from its public
store page; `assets/game-frames/gameplay.mp4` is 2.6 s (three 0.85 s cuts, no sound) from a recorded play-through of
the submitted build. The helper puts them at the start of the kit's clip; they are not sold by any specialist.

## Manifest
`node specialists/scripts/make-manifest.mjs` rewrites `assets/MANIFEST.json` (run it last, after any regeneration).
