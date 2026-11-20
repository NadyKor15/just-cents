# Just Cents

[Try it](https://justcents.retailbox-automation.com) · [Slides](https://justcents.retailbox-automation.com/just-cents-slides.pdf) · [Security](SECURITY.md) · [Become a specialist](specialists/template/README.md)

**Specialists do the work. You pay only for what passes.**

An AI helper hires AI specialists and checks every piece against rules set before the work starts. You pay in Bitcoin Cash with one signature in your own wallet. Each accepted specialist's money waits in its own small contract and is released only when the specialist puts the key to that file on chain. A rejected piece costs 0¢.

Nov 14: not started (first code Nov 16, commit c42478e). Built for BCH BLAZE 2026. MIT licensed.

## Judge it in 90 seconds

| Check | Link | What you will see |
|---|---|---|
| A paid order, no wallet needed | [See a paid order](https://justcents.retailbox-automation.com/?paid=9896c765fa549d1cade82034efcc8b557f6edbc8d54c9a2fbb7de0f499a03998) | "Files checked: 3 of 3", each line "key from the chain" |
| One payment into 3 contracts (mainnet, Selene) | [9896c765…3998](https://explorer.selene.cash/tx/9896c765fa549d1cade82034efcc8b557f6edbc8d54c9a2fbb7de0f499a03998?network=mainnet) | 3 P2SH32 contracts, the service, a `JC2` note, change |
| Specialists took the money by revealing the key | [8887e1bd…](https://explorer.selene.cash/tx/8887e1bd6e5e9830082a54f8d58812d5452ea10265325dbf29d441d3fec42df9?network=mainnet) · [56095d0b…](https://explorer.selene.cash/tx/56095d0bab9fc1fd7d933f090d8732e5090e82bd535256030933b6111c656297?network=mainnet) · [755b0e4d…](https://explorer.selene.cash/tx/755b0e4d2f2a6218620fc5bddab93935896d65d865f32a5484e63f597c4c59ad?network=mainnet) | the file key in each claim's input |
| Nobody claimed: the money came back (mainnet) | payment [29c9b46f…](https://explorer.selene.cash/tx/29c9b46fa5e5a67189c6e4bba685da1546d9c532f18f8ead8413f5e4742690dc?network=mainnet) → refund [2f0af2f2…](https://explorer.selene.cash/tx/2f0af2f2fc6c5d1b127cf78b4749a9249ff339c8787dbee90e84c0d8c26675b2?network=mainnet) | the node refused the early refund; after the refund time, 5,016 sat back with no signature |
| A rejected piece costs 0¢ | [Try it](https://justcents.retailbox-automation.com) → Start | Sam's subtitles are 1.1 s late: rejected, no contract for him |
| Attacks and what refuses them | [SECURITY.md](SECURITY.md) | 19 attacks in three tables, each with a test, a mutant or a transaction |
| The tests | `npm test` | 223 pass (4 more run live on chipnet with `LIVE=1`) |

## The problem

A game is done. To list it in a store you still need small jobs: subtitles for the trailer, a cover, a clean logo.

| | Card | Subscription | Just Cents |
|---|---|---|---|
| Smallest payment | 30¢ + 2.9% | $9.99–$19 a month | a fraction of a cent in network fees |
| You pay for bad work | yes | yes | no: 0¢ |
| You see the result before paying | no | no | the preview is checked; you already hold the full file, sealed |

Subscriptions: Otter Pro $16.99/month, Topaz $19/month, Vectorizer.ai $9.99/month.

## How it works

```mermaid
sequenceDiagram
  participant You as You (browser)
  participant S as Specialist
  participant C as Bitcoin Cash
  You->>S: the order: parts, rules, prices
  S-->>You: preview + signed offer
  Note over You: code checks the preview; a failed part is 0¢
  You->>S: download the sealed full file
  Note over You: its fingerprint must match the signed offer
  You->>C: one payment: a contract per accepted specialist, the service, JC2 note
  S->>C: claim: takes the money, puts the file key on chain
  C-->>You: the page reads the key from the chain, opens the file, checks it again
  Note over You,C: no claim within about an hour of chain time → you take it back, no signature
```

1. **Rules before work, checked by plain code.** Each part has a published rule (below). Previews are checked against it before you pay.
2. **The full file is yours before you pay, sealed** (AES-256-GCM). The specialist's signed offer carries the sealed file's fingerprint, the hash of the key and its claim key. The page checks the sealed file against the offer before the wallet is asked to sign.
3. **One payment, one contract per accepted specialist** (P2SH32, 152 bytes, `src/core/htlc.ts`): the price plus 500 sat for the claim fee. Two ways out:
   - **claim:** the key whose sha256 matches the lock, and the specialist's signature;
   - **refund:** after the refund time (chain median time at payment + 1 hour), to the buyer's own address only, with no signature. On the page: "Get my money back".
4. **The key comes from the chain**, never from a server's answer. The page opens the file and checks its fingerprint and the rules again.

| Part | Rule |
|---|---|
| Trailer subtitles | SRT; up to 42 characters a line, 2 lines, 20 characters a second; no overlap; each line starts within 0.4 s of its first spoken word |
| Store cover | at least 2560×1600, the frame's proportions, opaque, up to 25 MB, sharper than the frame simply stretched |
| Logo from a sketch | SVG of clean outlines, up to 3 colours and 200 outlines, no scripts, up to 100 KB, like the sketch |

## Proof on mainnet

| What | Transaction |
|---|---|
| Order 3 (Nov 20, Selene, contracts): 25,848 sat from the wallet, fee 568 | `9896c765fa549d1cade82034efcc8b557f6edbc8d54c9a2fbb7de0f499a03998` |
| Claims: cover 9,663 · Lena 4,907 · logo 4,907 sat | `8887e1bd…`, `56095d0b…`, `755b0e4d…` |
| Refund demo (Nov 20): 5,256 sat into one contract; early refund refused (`bad-txns-nonfinal`); refund to another address refused (`OP_EQUALVERIFY`); refund with no signature, 5,016 sat back | `29c9b46fa5e5a67189c6e4bba685da1546d9c532f18f8ead8413f5e4742690dc` → `2f0af2f2fc6c5d1b127cf78b4749a9249ff339c8787dbee90e84c0d8c26675b2` |
| Version 1 (direct payouts): order 1 (Nov 16), order 2 (Nov 18) | `c340c69b…dc2f`, `7c0d6eee…0877` |
| Chipnet, contracts: Cashonize, Selene | `aecfff33…50d3`, `2167d0e5…5ca8` |

We paid these orders ourselves, to our own demo specialists.

## What if something goes wrong?

| What goes wrong | What happens |
|---|---|
| A part breaks a rule | It is rejected before you pay: no contract, 0¢, "rejected" on the receipt. |
| The specialist never claims | After the refund time you take the money back, with no signature (mainnet `2f0af2f2…`). |
| Someone sends the refund elsewhere | The contract refuses it (mainnet: `OP_EQUALVERIFY`). |
| You pay less than the price | The specialist's server does not reveal the key; you take the money back after the refund time. |
| The key opens a different file | The chain cannot check this (it would take a zero-knowledge proof). The page shows it in red, and the specialist's claim signature on chain is public proof of what it sold. The money does not come back automatically. |
| A request is repeated | "Try again" sends the same signed payment; asking for a claim again gives the same claim. |
| No wallet app opens on a phone | The pay window shows how to pay from a computer, a Cashonize web link, and "See a paid order". |

## Business

+10% on top of the specialist's price (at least 1¢), only for accepted parts. The specialist gets 100%. Rejected work: 0¢. In the demo: work for 4¢, Just Cents 1¢.

## Become a specialist

[`specialists/template/README.md`](specialists/template/README.md): your own keys, your file sealed, your own claim server, your price. Tested from a clean copy of this repository on chipnet.

## For assistants

```
claude mcp add --transport http justcents https://justcents.retailbox-automation.com/mcp
```
Tools: `create_order`, `get_order`, `get_pay_link`, `get_kit`; the same over HTTP, described in [`/llms.txt`](public/llms.txt). The assistant never holds money: it hands you a pay link, and you sign.

## Built before and during BLAZE

| When | What |
|---|---|
| Before Nov 14 | nothing (first commit c42478e, Nov 16) |
| Nov 16 | version 1: one payment pays every accepted specialist; mainnet order 1 |
| Nov 18 | the three files for a game's store page; mainnet order 2 |
| Nov 19–20 | version 2: contracts, sealed files, claim and refund; mainnet order 3, the refund demo, the specialist template, SECURITY.md |

The game used as the example (Autopilot: Summer Rules) is a separate, already published game; it has no Bitcoin Cash in it.

## Limits, said plainly

- The key ↔ file match is not checked by the chain (see the table above).
- The demo offers are standing offers: after the first sale, the key is on chain and anyone can open that sealed file. A real specialist seals and signs per order.
- In the demo, our server claims for the demo specialists. A real specialist runs its own claim server.
- The refund time is chain time; it can run longer than an hour by the clock (Nov 20: about 78 minutes).
- Subtitle timing is measured against an open speech model, not the truth; sharpness and likeness are numbers, not taste.
- Prices are fixed in satoshis at $210.27/BCH (Nov 16, 2026).

## Code map

| Path | What |
|---|---|
| `src/core/htlc.ts`, `htlc-chain.ts` | the contract, claim, refund, `JC2` note; chain time and contract state |
| `src/core/filebox.ts`, `src/app/download.ts` | sealing; downloads in parts with a stall rule |
| `src/core/tx.ts`, `offer.ts`, `rules.ts` | the payment, signed offers, the rules |
| `worker/claim.ts` | the claim server (the demo specialists' and the template's) |
| `specialists/template/` | a specialist of your own |
| `scripts/refund-demo.ts` | one payment into one contract and the refund, from a local wallet |

## Run it

```
npm install
npm test                 # offline tests
npm run dev              # the site at http://127.0.0.1:5181
npm run build && npx wrangler pages dev dist --port 8787   # site + Pages Functions
```
Add `?net=chipnet` for the test network.

## Credits

Subtitles: Deepgram (Nova-3, Nova-2). Covers: Stability AI Fast Upscaler. Logo: VTracer 0.6.11 (MIT). Timing yardstick: faster-whisper small.en (MIT). Trailer and art: the game Autopilot: Summer Rules, by its author. Details in `specialists/README-assets.md`.

## License

MIT (code). Files under `specialists/` keep their own licences.
