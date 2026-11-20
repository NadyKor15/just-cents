# Become a Just Cents specialist in 10 minutes

Anyone can sell work on Just Cents: you set your price, your file stays sealed until you are paid, and you are paid
by your own server revealing the file's key on chain. Nobody in the middle holds your money or your file.

What happens when someone buys from you:

1. Before paying, the buyer's page downloads your **sealed** (encrypted) file and checks its fingerprint against your
   **signed offer**.
2. The buyer pays into a small contract on Bitcoin Cash: your price + 500 sat for the network fee.
3. Your **claim server** sees the contract and takes the money with a transaction that puts your file key on chain.
   The money and the key change hands in that one transaction.
4. The buyer's page reads the key from the chain, opens your file and checks it again.
5. If your server never claims, the buyer takes the money back after about an hour, without anyone's signature.
   Your server refuses to reveal a key in the last 10 minutes before that.

Everything below runs from this repository. Commands are run from the repository's root folder.

## 0. What you need

- Node 22 or newer, git, and this repository: `npm ci` once.
- A file to sell: subtitles (`.srt`), a logo (`.svg`) or a cover (`.jpg` / `.png`).
- A Bitcoin Cash address to be paid on (any wallet), or let step 2 make a fresh one.
- To test for free: a chipnet wallet (Cashonize or Selene in chipnet mode) with a few thousand test sat from a
  chipnet faucet, and its 12 words in a file only you can read (`chmod 600`).
- To go live: a free Cloudflare account (`npx wrangler login`).

## 1. Your folder

```sh
cp -R specialists/template specialists/ada
cp ~/my-subtitles.srt specialists/ada/work/subtitles.srt
```

Edit `specialists/ada/specialist.json`:

| Field | What it is |
|---|---|
| `key` | your offer's name, lowercase: `ada`. It is part of your claim URL. |
| `specialist` | the name buyers see: `Ada (subtitles)` |
| `part` | `subtitles`, `logo` or `cover` |
| `priceCents`, `priceSats` | your price in cents and in satoshis (decimal string). The buyer locks `priceSats` + 500. |
| `file` | your file, inside your folder |
| `payTo` | your address per network: `chipnet` (`bchtest:…`) to test, `mainnet` (`bitcoincash:…`) to sell. Leave one empty to skip that network. |
| `expires` | when your offer stops being valid |
| `claimUrl` | where your claim server answers: `http://localhost:8787` while testing, your `https://…workers.dev` URL when live |
| `facts` | optional: left out, measured from the file (subtitle count and first start, SVG colours and outlines, image size) |

## 2. Your keys

```sh
node scripts/run.mjs scripts/specialist-keys.ts --specialist specialists/ada --new-payout-address
```

This writes three files, readable only by you and ignored by git:

- `.dev.vars` — your file-key seed and your claim key: the two secrets your claim server holds.
- `.env.offer` — your offer key: it signs your offers. It never goes to a server.
- `.env.payout` — only with `--new-payout-address`: the key of the fresh address it printed. Put that address in
  `payTo`. (Skip the flag if you use your own wallet's address.)

Keep a copy of these files somewhere safe. The script refuses to overwrite them.

## 3. Seal your file

```sh
node scripts/run.mjs scripts/seal-files.ts --specialist specialists/ada
```

Your file is sealed once per network (AES-256-GCM, a different key per network) into
`specialists/ada/public/enc/<network>/<file>.jce`. The sealed file is public; only the key opens it.

## 4. Sign your offer

```sh
node scripts/run.mjs scripts/sign-offers-v2.ts --specialist specialists/ada
```

It checks that the sealed file opens with your key into exactly your file, then signs a version 2 offer with your offer
key: price, file fingerprint, sealed file fingerprint, the key's lock (sha256 of the key), your claim key, your payout
address, expiry. Result: `specialists/ada/offers.json`. Sign again whenever you change `specialist.json`.

## 5. Start your claim server

Locally, to test:

```sh
cd specialists/ada && npx wrangler dev
```

It serves your sealed file at `/enc/…` and claims at `POST /claim/<key>?net=…&txid=…`, with the same claim code as
the demo specialists (`worker/claim.ts`).

Live, on Cloudflare Workers (change `"name"` in `wrangler.jsonc` first):

```sh
cd specialists/ada
npx wrangler secret put JC_FILE_KEY_SEED   # paste the value from .dev.vars
npx wrangler secret put JC_CLAIM_KEYS      # paste the value from .dev.vars
npx wrangler deploy
```

Put the URL it prints into `claimUrl` and sign again (step 4).

## 6. Check your entry

```sh
node scripts/run.mjs scripts/verify-specialist.ts --specialist specialists/ada --remote
```

The checks a buyer's page makes before paying, plus that your server answers: your signature, the fingerprints, your
payout address, a claim key separate from the offer key, the sealed file as your server serves it.

## 7. Sell to yourself on chipnet

```sh
node scripts/run.mjs scripts/test-buy.ts --specialist specialists/ada --phrase-file ~/chipnet-words.txt
```

A real chipnet purchase of your offer: it takes your sealed file from your server, pays your contract from the
chipnet wallet, asks your server to claim, reads your key from the chain and opens the file. The last line says
`"fingerprintMatches": true` and links the claim on the chipnet explorer.

## 8. Get listed

Open a pull request with your folder: `specialist.json`, `offers.json`, `public/enc/`, `worker.ts`, `wrangler.jsonc`.
Never `.dev.vars` or `.env.*` (git ignores them). We run `verify-specialist.ts --remote` on your entry before it goes
into the catalog. At the time of writing the site's pages show only the demo specialists; open entries are reviewed
by hand.

## Good to know

- **Your keys stay yours.** The offer key never leaves your machine; your server holds only the claim key and the seed.
  Nothing of yours is on the Just Cents servers.
- **The key-for-money swap is atomic; "the key opens exactly the promised file" is not proven by the chain.** The
  buyer checks your sealed file against your signed offer before paying, and your claim signature on chain covers
  that sealed file's fingerprint: a key that opens something else would be public proof against you.
- **A standing offer sells the same file to everyone.** After your first claim the key is on chain and anyone holding
  the sealed file can open it. For one-buyer work, sign an offer for that one order.
- **Late is refunded.** Your server will not reveal a key within 10 minutes of a contract's refund time.
- See `SECURITY.md` at the repository's root for what each part of the contract refuses, with tests and chain proofs.
