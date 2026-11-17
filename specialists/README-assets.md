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
    `public/assets/sym/s5-icon.png` at 40 % opacity (one 84 px copy in the centre,
    two 40 px copies in opposite corners). The mark contains a cent-sign glyph; no other letters or digits.
  - `icon-bad-512-with-text.png` (TEST ONLY): 512 px with the word PLAY.

## Icon variant B (pick by taste)
- Variant A (above): daytime, blue/orange, paper plane over a sun. Variant B: dusk, pink-purple sky, a camp tent with a
  pennant on a hill, mountains, a setting sun, a dotted route leading to the tent door, and a small smiling agent orb.
- `icon-b.svg` is hand-authored (no text elements). `bash specialists/scripts/make-icon-b.sh` rasterizes it the same way
  (Chrome for Testing headless shell) to `icon-b-1024.png` and builds `icon-b-preview-128.png` with the same watermark
  treatment, using the mark at `code/just-cents/public/assets/sym/s5-icon.png`.

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
- `voice-script.txt` is the English trailer line about the game (42 words).
- `<venv>/bin/python -I specialists/scripts/make-voice-kokoro.py --model-dir <dir> --text specialists/assets/voice-script.txt --out specialists/assets/voice-full.mp3 --preview specialists/assets/voice-preview-3s.mp3`
  speaks it with **Kokoro-82M** by hexgrad (weights and voices: Apache License 2.0, https://huggingface.co/hexgrad/Kokoro-82M),
  voice `af_heart` (the voice of the game's own agent), through **kokoro-onnx** 0.6.1 (MIT) and onnxruntime (MIT), locally;
  model files `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the kokoro-onnx release `model-files-v1.0`. Loudness normalised
  with ffmpeg `loudnorm` (−16 LUFS target). Result: `voice-full.mp3` 13.67 s, `voice-preview-3s.mp3` 3.0 s. It is an AI voice.
- `voice-bad-32s.mp3` (TEST ONLY, 30.17 s) is the older macOS `say` take from `scripts/voice-bad-script.txt` (`scripts/make-voice.sh`).

## Game material in the clip (not paid parts)
The game is the author's separate, already published project. `assets/game-frames/*.jpg` are stills from its public
store page; `assets/game-frames/gameplay.mp4` is 2.6 s (three 0.85 s cuts, no sound) from a recorded play-through of
the submitted build. Just Cents puts them at the start of the kit's clip; they are not sold by any specialist.

## Manifest
`node specialists/scripts/make-manifest.mjs` rewrites `assets/MANIFEST.json` (run it last, after any regeneration).
