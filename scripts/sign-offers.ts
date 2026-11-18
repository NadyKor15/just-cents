// Builds the demo specialists' public offer book from the files laid out by specialists/scripts/lay-out-v3.py.
//   JC_OFFER_ICON_KEY=… JC_OFFER_SAM_KEY=… JC_OFFER_LENA_KEY=… JC_OFFER_VOICE_KEY=… node <bundle of this file>
// The keys come only from the environment (e.g. `infisical run`), are checked against the public keys in config,
// and are never printed or written. Output: src/data/offers.json (signed standing offers, public).
// Key names are historical: ICON signs the cover offers, VOICE the logo offer.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { binToHex, hexToBin, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { ANY_ORDER, offerHashHex, signOffer, type Offer } from '../src/core/offer';
import { lockingFor } from '../src/core/tx';
import { parseSrt } from '../src/core/subtitles';
import { inspectSvg } from '../src/core/logo';
import { PAYOUT, OFFER_PUBKEY } from '../src/config';

type Slot = 'cover' | 'sam' | 'lena' | 'logo';
const ENV: Record<Slot, string> = { cover: 'JC_OFFER_ICON_KEY', sam: 'JC_OFFER_SAM_KEY', lena: 'JC_OFFER_LENA_KEY', logo: 'JC_OFFER_VOICE_KEY' };
const keys = {} as Record<Slot, Uint8Array>;
for (const slot of Object.keys(ENV) as Slot[]) {
  const hex = process.env[ENV[slot]];
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`${ENV[slot]} is missing or not 32 bytes of hex`);
  const priv = hexToBin(hex);
  if (binToHex(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array) !== OFFER_PUBKEY[slot]) throw new Error(`${ENV[slot]} does not match the ${slot} public key in config`);
  keys[slot] = priv;
}

// Prices, fixed with the offers: cents at $210.27/BCH (CoinGecko, 2026-11-16 22:19:45Z), the same rate as the service's 1¢.
const RATE = 210.27;
const sats = (cents: number) => String(Math.round((cents / 100 / RATE) * 1e8));
const EXPIRES = Math.floor(Date.parse('2026-12-31T23:59:59Z') / 1000);

const F = (f: string) => `public/files/${f}`;
const fileHash = (f: string) => binToHex(sha256.hash(readFileSync(F(f))));
const coverFacts = (f: string) => {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', F(f)], { encoding: 'utf8' }).trim().split(',');
  return `${w}x${h};${statSync(F(f)).size}`;
};
const subsFacts = (f: string) => {
  const p = parseSrt(readFileSync(F(f), 'utf8'));
  if (!p.ok) throw new Error(`${f}: ${p.reason}`);
  return `srt;${p.cues.length};${p.cues[0]!.start.toFixed(3)}`;
};
const logoFacts = (f: string) => {
  const s = inspectSvg(readFileSync(F(f), 'utf8'));
  return `svg;${s.colors.length};${s.contours};${s.bytes}`;
};

type Spec = { key: string; slot: Slot; specialist: string; part: Offer['part']; cents: number; file: string; facts: string; preview: string };
const specs: Spec[] = [
  { key: 'cover', slot: 'cover', specialist: 'cover (demo specialist)', part: 'cover', cents: 2, file: 'cover-a.jpg', facts: coverFacts('cover-a.jpg'), preview: '/previews/cover-a.jpg' },
  { key: 'cover:b', slot: 'cover', specialist: 'cover (demo specialist)', part: 'cover', cents: 2, file: 'cover-b.jpg', facts: coverFacts('cover-b.jpg'), preview: '/previews/cover-b.jpg' },
  { key: 'sam:good', slot: 'sam', specialist: 'Sam (demo specialist)', part: 'subtitles', cents: 1, file: 'subs-sam.srt', facts: subsFacts('subs-sam.srt'), preview: '/previews/subs-sam.srt' },
  { key: 'sam:careless', slot: 'sam', specialist: 'Sam (demo specialist)', part: 'subtitles', cents: 1, file: 'subs-sam-careless.srt', facts: subsFacts('subs-sam-careless.srt'), preview: '/previews/subs-sam-careless.srt' },
  { key: 'lena:good', slot: 'lena', specialist: 'Lena (demo specialist)', part: 'subtitles', cents: 1, file: 'subs-lena.srt', facts: subsFacts('subs-lena.srt'), preview: '/previews/subs-lena.srt' },
  { key: 'lena:careless', slot: 'lena', specialist: 'Lena (demo specialist)', part: 'subtitles', cents: 1, file: 'subs-lena-careless.srt', facts: subsFacts('subs-lena-careless.srt'), preview: '/previews/subs-lena-careless.srt' },
  { key: 'logo', slot: 'logo', specialist: 'logo (demo specialist)', part: 'logo', cents: 1, file: 'logo.svg', facts: logoFacts('logo.svg'), preview: '/previews/logo-128.png' },
];

const book: Record<string, Record<string, unknown>> = { mainnet: {}, chipnet: {} };
for (const net of ['mainnet', 'chipnet'] as const) {
  for (const s of specs) {
    const offer: Offer = {
      v: 1,
      orderId: ANY_ORDER,
      facts: s.facts,
      specialist: s.specialist,
      part: s.part,
      priceCents: s.cents,
      priceSats: sats(s.cents),
      fileSha256: fileHash(s.file),
      expires: EXPIRES,
      payTo: PAYOUT[s.slot][net],
      pubkey: OFFER_PUBKEY[s.slot],
    };
    // payToLockingHex and offerHashHex are derived here so the worker needs no crypto library at all
    book[net]![s.key] = { signed: signOffer(offer, keys[s.slot]), file: s.file, preview: s.preview, payToLockingHex: binToHex(lockingFor(offer.payTo)), offerHashHex: offerHashHex(offer) };
  }
}
writeFileSync('src/data/offers.json', JSON.stringify({ ...book, _meta: { rateUsd: RATE, rateAt: '2026-11-16T22:19:45Z', source: 'CoinGecko simple/price' } }, null, 2) + '\n');
console.log('offers:', specs.map((s) => `${s.key}=${s.facts}`).join(' | '), '| check:', binToHex(sha256.hash(utf8ToBin(JSON.stringify(book)))).slice(0, 12));
