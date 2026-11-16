// Builds the demo specialists' public offer book and lays out their files.
//   KEYS_FILE=<json {"ICON":hex,"SAM":hex,"LENA":hex,"VOICE":hex}> npx vite-node scripts/sign-offers.ts
// Outputs: src/data/offers.json (signed standing offers, public), public/previews/* (public),
// public/files/* (full files, served only through the worker after payment).
// Keys are read from KEYS_FILE and never written anywhere.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { binToHex, hexToBin, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { ANY_ORDER, offerHashHex, signOffer, type Offer } from '../src/core/offer';
import { lockingFor } from '../src/core/tx';
import { PAYOUT, OFFER_PUBKEY } from '../src/config';

const A = 'specialists/assets';
const keys = JSON.parse(readFileSync(process.env.KEYS_FILE!, 'utf8')) as Record<'ICON' | 'SAM' | 'LENA' | 'VOICE', string>;
for (const [k, v] of Object.entries(keys)) {
  const pub = binToHex(secp256k1.derivePublicKeyCompressed(hexToBin(v)) as Uint8Array);
  if (pub !== OFFER_PUBKEY[k.toLowerCase() as 'icon']) throw new Error(`key ${k} does not match its public key in config`);
}

// Prices, fixed with the offers: cents at $210.27/BCH (CoinGecko, 2026-11-16 22:19:45Z).
const RATE = 210.27;
const sats = (cents: number) => String(Math.round((cents / 100 / RATE) * 1e8));
const EXPIRES = Math.floor(Date.parse('2026-12-31T23:59:59Z') / 1000);

const firstSentence = (t: string) => t.trim().split(/(?<=[.!?])\s+/)[0]!;
const text = (f: string) => readFileSync(`${A}/${f}`, 'utf8').trim();
const es = text('description-es.txt'), fr = text('description-fr.txt'), de = text('description-de.txt'), pt = text('description-pt-instead-of-es.txt');
const good = { es, fr, de };
const careless = { es: pt, fr, de }; // asked for Spanish, delivers Portuguese

mkdirSync('public/files', { recursive: true });
mkdirSync('public/previews', { recursive: true });
copyFileSync(`${A}/icon-1024.png`, 'public/files/icon-1024.png');
copyFileSync(`${A}/voice-full.mp3`, 'public/files/voice-full.mp3');
writeFileSync('public/files/description-good.json', JSON.stringify(good, null, 2));
writeFileSync('public/files/description-careless.json', JSON.stringify(careless, null, 2));
copyFileSync(`${A}/icon-preview-128.png`, 'public/previews/icon-128.png');
copyFileSync(`${A}/icon-b-1024.png`, 'public/files/icon-b-1024.png');
copyFileSync(`${A}/icon-b-preview-128.png`, 'public/previews/icon-b-128.png');
copyFileSync(`${A}/voice-preview-3s.mp3`, 'public/previews/voice-3s.mp3');

const fileHash = (p: string) => binToHex(sha256.hash(readFileSync(p)));
const seconds = (p: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { encoding: 'utf8' }).trim()).toFixed(2);

type Spec = { key: string; who: 'ICON' | 'SAM' | 'LENA' | 'VOICE'; specialist: string; part: Offer['part']; cents: number; file: string; facts: string; preview: string | Record<string, string> };
const specs: Spec[] = [
  { key: 'icon', who: 'ICON', specialist: 'icon (demo specialist)', part: 'icon', cents: 3, file: 'icon-1024.png', facts: '1024x1024', preview: '/previews/icon-128.png' },
  { key: 'icon:b', who: 'ICON', specialist: 'icon (demo specialist)', part: 'icon', cents: 3, file: 'icon-b-1024.png', facts: '1024x1024', preview: '/previews/icon-b-128.png' },
  { key: 'sam:good', who: 'SAM', specialist: 'Sam (demo specialist)', part: 'description', cents: 2, file: 'description-good.json', facts: 'es,fr,de', preview: { es: firstSentence(es), fr: firstSentence(fr), de: firstSentence(de) } },
  { key: 'sam:careless', who: 'SAM', specialist: 'Sam (demo specialist)', part: 'description', cents: 2, file: 'description-careless.json', facts: 'es,fr,de', preview: { es: firstSentence(pt), fr: firstSentence(fr), de: firstSentence(de) } },
  { key: 'lena:good', who: 'LENA', specialist: 'Lena (demo specialist)', part: 'description', cents: 2, file: 'description-good.json', facts: 'es,fr,de', preview: { es: firstSentence(es), fr: firstSentence(fr), de: firstSentence(de) } },
  { key: 'lena:careless', who: 'LENA', specialist: 'Lena (demo specialist)', part: 'description', cents: 2, file: 'description-careless.json', facts: 'es,fr,de', preview: { es: firstSentence(pt), fr: firstSentence(fr), de: firstSentence(de) } },
  { key: 'voice', who: 'VOICE', specialist: 'voice (demo specialist)', part: 'voice', cents: 2, file: 'voice-full.mp3', facts: `${seconds('public/files/voice-full.mp3')}s`, preview: '/previews/voice-3s.mp3' },
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
      fileSha256: fileHash(`public/files/${s.file}`),
      expires: EXPIRES,
      payTo: PAYOUT[s.who.toLowerCase() as 'icon'][net],
      pubkey: OFFER_PUBKEY[s.who.toLowerCase() as 'icon'],
    };
    // payToLockingHex and offerHashHex are derived here so the worker needs no crypto library at all
    book[net]![s.key] = { signed: signOffer(offer, hexToBin(keys[s.who])), file: s.file, preview: s.preview, payToLockingHex: binToHex(lockingFor(offer.payTo)), offerHashHex: offerHashHex(offer) };
  }
}
writeFileSync('src/data/offers.json', JSON.stringify({ ...book, _meta: { rateUsd: RATE, rateAt: '2026-11-16T22:19:45Z', source: 'CoinGecko simple/price' } }, null, 2) + '\n');
console.log('offers:', Object.keys(book.mainnet!).join(', '), '| service 1¢ =', sats(1), 'sat | check:', binToHex(sha256.hash(utf8ToBin(JSON.stringify(book)))).slice(0, 12));
