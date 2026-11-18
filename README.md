# Just Cents

Cents for work you accept. Nothing else.

An AI helper hires several AI specialists and checks each piece of their work against rules that are set before the work starts. You pay in Bitcoin Cash with one signature in your own wallet, and only the accepted pieces get paid. A rejected piece costs 0¢ and shows up as a line on the receipt. Nothing is paid up front.

Built for BCH BLAZE 2026. MIT licensed.

## Two minutes on the live site

1. The order is filled in: "Make me a kit to list my game." Press **Start**.
2. Three parts for the game's store page appear: a store cover from a game frame (two variants), subtitles for the trailer, a logo traced from a sketch. Previews arrive: two 320 px watermarked covers, the first three subtitle lines, a 128 px watermarked logo.
3. Every preview is checked by code against the published rules. The demo subtitles specialist Sam is careless on purpose: every line of his comes 1.2 s after the voice. Rejected, 0¢. Just Cents then uses Lena's subtitles, which pass. **Break it yourself** lets you make Lena the careless one instead; both files are checked again.
4. **Pay 5¢ once**: connect a wallet over WizardConnect (tested with Cashonize, on mainnet and chipnet) and sign one transaction.
5. Each specialist sees its own output on chain and hands over the full file. The page checks every file's fingerprint against the signed offer, runs the rules again on the full files, and gives you the files and a receipt with the transaction link.

## How it works

**Rules before work, checked by plain code.**

| Part | Rule | How it is checked |
|---|---|---|
| Trailer subtitles | SRT; up to 42 characters a line, 2 lines, 20 characters a second; no overlap; each line starts within 0.4 s of its first spoken word; the last ends within 2 s of the sound | the first line's start declared in the signed offer against the trailer's first spoken word; the first three lines of the preview, then the full file, against the trailer's spoken words with their times (measured once before any work: an open speech model, starts moved to clear speech onsets in the sound) |
| Store cover | at least 2560×1600, the game frame's proportions, opaque, up to 25 MB, sharper than the frame simply stretched | size and file size declared in the signed offer; on the full file: size, proportions, transparency, and sharpness (variance of the Laplacian) against the frame stretched bilinearly to the same size |
| Logo from a sketch | SVG of clean outlines, up to 3 colours and 200 outlines, nothing pasted inside, no scripts, up to 100 KB, like the sketch | colours, outlines and size declared in the signed offer; on the full file: the SVG text itself, and likeness (SSIM on both drawings brought down to 32×32, drawn blocks only) to the sketch |

**A preview cannot be taken and used.** The cover previews are 320 px with a watermark, the subtitles preview is the first three lines, the logo preview is 128 px with a watermark. With the preview comes a signed offer: price, fingerprint (sha256) of the full file, deadline, payout address, signed with the specialist's key (Schnorr, secp256k1).

**One payment reaches many recipients.** The browser builds one Bitcoin Cash transaction (libauth): one output per accepted specialist, 1¢ for the service, change back to the address of the first coin spent, and an OP_RETURN note. A rejected specialist gets no output. The wallet only signs (`broadcast: false`); the page broadcasts and shows the node's answer.

**The note ties the payment to the order.** One ASCII push: `JC1 <order id, 16 bytes hex> <first 16 bytes of each accepted offer's fingerprint>`. Every wallet shows it readably; a payment cannot be claimed for two orders.

**Delivery after payment, checked on chain.** `GET /full/<offer>?net=…&txid=…` reads the transaction from a public Fulcrum server and hands over the file only if the transaction pays that specialist's address at least the offer price and the note lists that offer's fingerprint. Full files are never served directly.

**Rules and taste.** The cover specialist sends two variants. Both pass the same rules; the person picks one by taste and pays only for that one. The other shows on the receipt as "not chosen, 0¢" and gets no output. Rules decide what is acceptable; taste decides between acceptable pieces.

**Paid work instead of reviews.** A specialist's paid work can be read from the network (`GET /api/specialists/<id>/history`): transactions that pay the specialist's address and carry a `JC1` note.

**Who is who in the demo.** The demo specialists are ours, labeled "demo specialist, run by the Just Cents team", and each names what really made its file: Sam's subtitles come from Deepgram Nova-3 and Lena's from Deepgram Nova-2, the covers from Stability AI Fast Upscaler, the logo from VTracer (open source, MIT). Sam is careless on purpose so you always see a rejection. All the checks are real.

### Code map

| Path | What |
|---|---|
| `src/core/tx.ts` | coin selection, the one payment transaction, the OP_RETURN note, fee at 1 sat/byte |
| `src/core/offer.ts` | signed offers (canonical form, Schnorr sign and verify) |
| `src/core/rules.ts` | the rule texts and the checks on what a signed offer declares (pure functions) |
| `src/core/subtitles.ts`, `cover.ts`, `logo.ts`, `image.ts` | the full rules for each part, and the image measurements they use (pure functions) |
| `src/core/release.ts` | "my output is on chain" check (libauth) |
| `src/core/wallet.ts` | WizardConnect, site side: pairing, wallet coins from its shared public keys, sign request |
| `src/core/chain.ts` | Fulcrum (Electrum) access with a second server |
| `src/app/` | the order flow, browser measurements (pixels, drawings, fingerprints), the files (zip) |
| `src/ui/` | the animated scene; it waits at gates for the real previews and checks |
| `worker/`, `functions/` | Cloudflare Pages Functions: `/full/*` delivery after payment (no crypto library: the offer book carries precomputed scripts and fingerprints), `/files/*` closed |
| `specialists/` | how the demo specialists' files were made, and the files themselves |
| `scripts/sign-offers.ts` | signs the demo specialists' standing offers |

## Become a specialist

Anyone can become a Just Cents specialist with two endpoints on their own server, their own price and rules, and a BCH address:

1. **Preview and offer.** Return a preview that cannot be used as the real thing, and a signed offer: price in cents and in satoshis, sha256 of the full file, deadline, your payout address, your public key. Use the canonical form in `src/core/offer.ts`.
2. **Full file after payment.** Given a transaction id, read the transaction from the network and hand over the file only if it pays your address at least your price and its `JC1` note lists your offer's fingerprint. `worker/txparse.ts` does exactly this in about 100 lines with no dependencies.

Your rules must be checkable by code, published before the work, the same for everyone.

**Example: an existing service joins.** Say you already run a voice service. Add two routes next to your API:

```
POST /just-cents/offer   {"order": "<id>", "text": "...", "seconds": 12}
  → {"preview": "<url of the first 3 s>", "offer": {...signed: price, sha256 of the full mp3, deadline, your BCH address}}
GET  /just-cents/file?order=<id>&txid=<txid>
  → the full mp3, once the transaction pays your address and its note lists your offer's fingerprint
```

Your price, your rules ("10 to 15 seconds"), your address. No account with us and no bank.

## For assistants

Assistants (Claude, GPT, developer agents) can place orders; a person still signs. Connect over MCP:

```
claude mcp add --transport http justcents https://justcents.retailbox-automation.com/mcp
```

Tools: `create_order`, `get_order`, `get_pay_link`, `get_kit`. The same over plain HTTP under `/api/orders`, described in [`/llms.txt`](public/llms.txt). The assistant never holds money: it hands the person a pay link, the person signs once in their own wallet, and the assistant fetches the kit. Creating an order stores nothing (the order id carries its own state); the only stored fact is "this order was paid by this transaction", written after the transaction is read from the network. The API checks what each signed offer declares; the cover's sharpness and the logo's likeness are measured on the full files in the person's browser.

## Limits, said plainly

- **Subtitle timing is measured against a yardstick, not against the truth.** The trailer's words and their times come from an open speech model, with starts moved to clear speech onsets in the sound. On this trailer Deepgram and the yardstick agree within about 0.35 s; the rule allows 0.4 s, so a careless shift of a second is caught, a shift of a tenth is not.
- **Sharpness and likeness are numbers, not taste.** A cover can be sharp and still ugly; that is why there are two variants and the person picks.
- **The demo specialists' offers are standing offers.** They are signed once, for any order; the order id and the offer fingerprint are tied together on chain by the note. A real specialist can sign per order.
- **The demo specialists' full files are in this repository**, because the demo specialists are open source. A real specialist keeps them on their own server.
- Prices are fixed in satoshis at $210.27/BCH (16 Nov 2026). A whole order is 5¢ plus a network fee of about 600 satoshis.
- The demo order is for the store page of a separate, already published game, Autopilot: Summer Rules. The game has no Bitcoin Cash in it. Its trailer and two frames are the order's inputs.

## Run it

```
npm install
npm test                 # offline tests
npm run dev              # the site at http://127.0.0.1:5181 (no /full/ endpoint in dev)
npm run build && npx wrangler pages dev dist --port 8787   # site + Pages Functions
```

Add `?net=chipnet` to use the test network. A live chipnet test of the whole payment path with a headless wallet: `LIVE=1 TEST_MNEMONIC_FILE=<file> npx vitest run test/live`.

## Credits

- Subtitles: transcribed by Deepgram (Nova-3 and Nova-2), laid out by `specialists/scripts/make-srt.py`.
- Covers: Stability AI Fast Upscaler, from two frames of the game.
- Logo: traced by VTracer 0.6.11 by Vision Cortex (MIT), https://www.visioncortex.org/vtracer
- The yardstick for subtitle timing: faster-whisper small.en (MIT), run locally. Details in `specialists/README-assets.md`.
- Trailer, frames, stills, play footage and character art: from the game Autopilot: Summer Rules, by its author.

## License

MIT (code). The files under `specialists/` keep their own licences, listed above and in `specialists/README-assets.md`.
