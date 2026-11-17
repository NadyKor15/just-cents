# Just Cents

Cents for work you accept. Nothing else.

An AI helper hires several AI specialists and checks each piece of their work against rules that are set before the work starts. You pay in Bitcoin Cash with one signature in your own wallet, and only the accepted pieces get paid. A rejected piece costs 0¢ and shows up as a line on the receipt. Nothing is paid up front.

Built for BCH BLAZE 2026. MIT licensed.

## Two minutes on the live site

1. The order is filled in: "Make me a kit to list my game." Press **Start**.
2. Three parts appear: an icon, music for the clip, a voice-over. Previews arrive: a 128 px watermarked icon, the first three seconds of each music piece with its licence, the first three seconds of the voice.
3. Every preview is checked by code against the published rules. The demo musician Sam is careless on purpose and delivers 17.2 s where exactly 15 s was asked: rejected, 0¢. Just Cents then uses Lena's piece, which passes. **Break it yourself** lets you make Lena the careless one instead; both pieces are checked again.
4. **Pay 8¢ once**: connect a wallet over WizardConnect (tested with Cashonize, on mainnet and chipnet) and sign one transaction.
5. Each specialist sees its own output on chain and hands over the full file. The page checks every file's fingerprint against the signed offer, runs the rules again on the full files, puts a short clip together from the accepted parts, and gives you the kit and a receipt with the transaction link.

## How it works

**Rules before work, checked by plain code.**

| Part | Rule | How it is checked |
|---|---|---|
| Icon | 1024×1024, no text | size from the signed offer and the full file; OCR (tesseract.js, in the browser) on the preview and on the full file |
| Music for the clip | exactly 15 s (±0.1 s); CC0 1.0 or CC BY 4.0, the licence written into the file | length and licence declared in the signed offer; the licence frames (id, full licence text, source page; for CC BY the author) read from the file itself; the length measured on the full file (Web Audio) |
| Voice-over | 10 to 15 seconds | length declared in the signed offer, then measured on the full file (Web Audio) |

**A preview cannot be taken and used.** The icon preview is 128 px with a watermark, the music preview is three seconds, the voice preview is three seconds. With the preview comes a signed offer: price, fingerprint (sha256) of the full file, deadline, payout address, signed with the specialist's key (Schnorr, secp256k1).

**One payment reaches many recipients.** The browser builds one Bitcoin Cash transaction (libauth): one output per accepted specialist, 1¢ for the service, change back to the address of the first coin spent, and an OP_RETURN note. A rejected specialist gets no output. The wallet only signs (`broadcast: false`); the page broadcasts and shows the node's answer.

**The note ties the payment to the order.** One ASCII push: `JC1 <order id, 16 bytes hex> <first 16 bytes of each accepted offer's fingerprint>`. Every wallet shows it readably; a payment cannot be claimed for two orders.

**Delivery after payment, checked on chain.** `GET /full/<offer>?net=…&txid=…` reads the transaction from a public Fulcrum server and hands over the file only if the transaction pays that specialist's address at least the offer price and the note lists that offer's fingerprint. Full files are never served directly.

**Rules and taste.** The icon specialist sends two variants. Both pass the same rules; the person picks one by taste and pays only for that one. The other shows on the receipt as "not chosen, 0¢" and gets no output. Rules decide what is acceptable; taste decides between acceptable pieces.

**A catalog without reviews.** `/catalog` lists each specialist with an example, price, rule and terms. Instead of reviews it shows the specialist's paid work read from the network (`GET /api/specialists/<id>/history`): transactions that pay the specialist's address and carry a `JC1` note. Kinds of work with no specialist yet say so.

**Who is who in the demo.** The three demo specialists are ours, labeled "demo specialist, run by the Just Cents team". Sam is careless on purpose so you always see a rejection. All the checks are real.

### Code map

| Path | What |
|---|---|
| `src/core/tx.ts` | coin selection, the one payment transaction, the OP_RETURN note, fee at 1 sat/byte |
| `src/core/offer.ts` | signed offers (canonical form, Schnorr sign and verify) |
| `src/core/rules.ts` | the acceptance rules (pure functions) |
| `src/core/music.ts` | music rules: decoded length, licence frames (ID3) read from the file |
| `src/core/mesh.ts` | 3D model rules: watertight (every edge in exactly two triangles), fits a printer bed given as a parameter |
| `src/core/release.ts` | "my output is on chain" check (libauth) |
| `src/core/wallet.ts` | WizardConnect, site side: pairing, wallet coins from its shared public keys, sign request |
| `src/core/chain.ts` | Fulcrum (Electrum) access with a second server |
| `src/app/` | the order flow, browser measurements (OCR, audio), the clip, the kit (zip) |
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

Tools: `create_order`, `get_order`, `get_pay_link`, `get_kit`. The same over plain HTTP under `/api/orders`, described in [`/llms.txt`](public/llms.txt). The assistant never holds money: it hands the person a pay link, the person signs once in their own wallet, and the assistant fetches the kit. Creating an order stores nothing (the order id carries its own state); the only stored fact is "this order was paid by this transaction", written after the transaction is read from the network. OCR for "no text on the icon" runs in the person's browser on the pay page, not in the API.

## Limits, said plainly

- **OCR finds clear words, not every letter.** tesseract.js reads horizontal words of three or more letters with confidence 70 or more (the word "PLAY" on a test icon is found; shapes in a clean icon are not counted). Slanted or faint text can pass. The rule is published with this limit.
- **The demo specialists' offers are standing offers.** They are signed once, for any order; the order id and the offer fingerprint are tied together on chain by the note. A real specialist can sign per order.
- **The demo specialists' full files are in this repository**, because the demo specialists are open source. A real specialist keeps them on their own server.
- Prices are fixed in satoshis at $210.27/BCH (16 Nov 2026). A whole order is 8¢ plus a network fee of about 600 satoshis.
- The demo kit is for the store page of a separate, already published game, Autopilot: Summer Rules. The game has no Bitcoin Cash in it. Its stills and a few seconds of play are used in the kit's clip.

## Run it

```
npm install
npm test                 # offline tests
npm run dev              # the site at http://127.0.0.1:5181 (no /full/ endpoint in dev)
npm run build && npx wrangler pages dev dist --port 8787   # site + Pages Functions
```

Add `?net=chipnet` to use the test network. A live chipnet test of the whole payment path with a headless wallet: `LIVE=1 TEST_MNEMONIC_FILE=<file> npx vitest run test/live`.

## Credits

- Music in the demo, all CC0 1.0 (public domain dedication), from OpenGameArt.org, the same tracks as in the game. The CC0 field on each page was checked on 17 Nov 2026; the pages and the full CC0 text are kept in `specialists/source-music/`, and every mp3 carries the licence, its full text and its source page:
  - Town Theme RPG by cynicmusic, https://opengameart.org/content/town-theme-rpg
  - Hot Springs Town by Kistol, https://opengameart.org/content/hot-springs-town
- Voice-over: an AI voice, Kokoro-82M by hexgrad (weights and voices: Apache License 2.0), voice `af_heart`, run locally through kokoro-onnx (MIT). Details in `specialists/README-assets.md`.
- Stills, play footage and character art: from the game Autopilot: Summer Rules, by its author.

## License

MIT (code). The files under `specialists/` keep their own licences, listed above and in `specialists/README-assets.md`.
