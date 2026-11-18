# Demo assets for the kit: subtitles, cover, logo

Demo order: "Make me a kit to list my game." Game: "Autopilot: Summer Rules", a separate, already published browser game
by the same author. Its trailer and frames are the order's own inputs; they are not sold by any specialist.
Run everything from `code/just-cents`. Service keys come only from the environment and are never written to a file.

## Subtitles (specialists "sam" and "lena")
- Input: the game's gameplay trailer (116.9 s, English voice over music), audio sent as mono mp3.
- `python3 specialists/scripts/deepgram_words.py <audio> nova-3 assets-v3/dg-nova3.json` (Sam) and `… nova-2 … dg-nova2.json` (Lena):
  Deepgram pre-recorded transcription, `smart_format`, `punctuate`; the files keep the words with their times and the request id.
- `python3 specialists/scripts/make-srt.py dg-nova3.json subs-sam.srt` lays the words out within the published rules
  (42 characters a line, 2 lines, 20 characters a second, no overlap; a line shows 0.1 s before the voice).
- The careless copies (`subs-*-careless.srt`) are the same files with every time 1.2 s late (`--shift 1.2`), made on purpose
  so every order shows a rejection.
- The timing yardstick (`yard-refined.json`, copied to `src/data/trailer-words.json`): the trailer's words with their times,
  measured once with faster-whisper small.en (open model, run locally), then `specialists/scripts/refine-onsets.py` moves
  the start of each word that follows a pause to the clear speech onset in the sound (300–3400 Hz energy rising 15 dB from
  below −35 dB). Measured before any specialist worked; the specialists' files are checked against it.

## Cover (specialist "cover", two variants to choose from by taste)
- Inputs: two frames of the game (`frame-a.png` "Your first call", `frame-b.png` "Sticker stall"), 1024×640, cut down
  with Lanczos from the game's 1920×1200 store screenshots. They stay public at `/game-frames/cover-frame-*.png`:
  the cover rule compares the cover with its frame.
- `python3 specialists/scripts/stability_upscale.py frame-a.png cover-a.jpg`: Stability AI Fast Upscaler (×4, 2 credits per
  image), jpeg. Result 4096×2560.

## Logo (specialist "logo")
- Input: the author's sketch, `/game-frames/logo-sketch.png`.
- Traced by VTracer 0.6.11 (open source, MIT, https://www.visioncortex.org/vtracer), binary colour mode, run by the
  Just Cents team inside `specialists/scripts/lay-out-v3.py --logo <sketch>` (needs the `vtracer` Python package).

## Laying out the site files
`python3 specialists/scripts/lay-out-v3.py [--logo <sketch>]` copies the full files to `public/files/` (served only after
payment), makes the previews in `public/previews/` (covers 320×200 with the brand mark at 40 %, the first 3 subtitles,
the logo at 128 px with the mark) and the yardstick. Then `scripts/sign-offers.ts` signs the offers.
