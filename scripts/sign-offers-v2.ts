// Adds the v2 (hash-lock) form to every offer of the book, beside the v1 offer, which stays as it is:
//   1. seals each full file (and the cover's light copy) under its own key: public/enc/<net>/<file>.jce
//   2. signs a v2 offer: the v1 offer's fields + the sealed file's fingerprint + the key lock + the claim key,
//      with the same offer key as v1.
//   JC_FILE_KEY_SEED=… JC_OFFER_ICON_KEY=… JC_OFFER_SAM_KEY=… JC_OFFER_LENA_KEY=… JC_OFFER_VOICE_KEY=… node <bundle of this file>
// Keys come only from the environment (e.g. `infisical run`), are checked against the public keys in config, and are
// never printed or written. The claim keys are not needed here: only their public halves, from config.
// An open specialist signs its own offers with --specialist <dir> (signSpecialist below); without it, as before.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { binToHex, hexToBin, secp256k1, sha256 } from '@bitauth/libauth';
import { ANY_ORDER, offerHash2Hex, signOffer2, verifyOffer2, type Offer, type Offer2, type SignedOffer } from '../src/core/offer';
import { deriveFileKey, keyHashHex, openFile, sealFile } from '../src/core/filebox';
import { measureFacts, netsOf, readEnvFile, readSpec, sealedPath, sealedUrlPath, specialistDir } from './specialist-lib';
import { lockingFor } from '../src/core/tx';
import { CLAIM_PUBKEY, OFFER_PUBKEY } from '../src/config';
import { mkdirSync } from 'node:fs';

type Slot = 'cover' | 'sam' | 'lena' | 'logo';
type Net = 'mainnet' | 'chipnet';
export const OFFER_KEY_ENV: Record<Slot, string> = { cover: 'JC_OFFER_ICON_KEY', sam: 'JC_OFFER_SAM_KEY', lena: 'JC_OFFER_LENA_KEY', logo: 'JC_OFFER_VOICE_KEY' };
/** The display copy of a cover, sealed under the cover's key with the label " light". */
export const LIGHT: Record<string, string> = { 'cover-a.jpg': 'cover-a-light.jpg', 'cover-b.jpg': 'cover-b-light.jpg' };

export type V2Entry = { signed: { offer: Offer2; sig: string }; offerHashHex: string; payToLockingHex: string; sealed: string; sealedLight?: string };
type Row = { signed: SignedOffer; file: string; preview: unknown; payToLockingHex: string; offerHashHex: string; v2?: V2Entry };
type Book = Record<Net, Record<string, Row>> & { _meta?: unknown };

const slotOf = (key: string): Slot => key.split(':')[0] as Slot;

export async function addV2(book: Book, seed: Uint8Array, offerKeys: Record<Slot, Uint8Array>, filesDir = 'public/files', outDir = 'public/enc'): Promise<Book> {
  for (const slot of Object.keys(OFFER_KEY_ENV) as Slot[]) {
    if (binToHex(secp256k1.derivePublicKeyCompressed(offerKeys[slot]) as Uint8Array) !== OFFER_PUBKEY[slot]) throw new Error(`the ${slot} offer key does not match config`);
  }
  for (const net of ['mainnet', 'chipnet'] as const) {
    mkdirSync(join(outDir, net), { recursive: true });
    for (const [key, row] of Object.entries(book[net])) {
      if (key.startsWith('_')) continue;
      const v1: Offer = row.signed.offer;
      const slot = slotOf(key);
      const plain = new Uint8Array(readFileSync(join(filesDir, row.file)));
      if (binToHex(sha256.hash(plain)) !== v1.fileSha256) throw new Error(`${net} ${key}: the file is not the one the v1 offer names`);
      const fileKey = deriveFileKey(seed, net, v1.fileSha256);
      const sealedBytes = await sealFile(fileKey, plain);
      writeFileSync(join(outDir, net, `${row.file}.jce`), sealedBytes);
      let sealedLight: string | undefined;
      if (LIGHT[row.file]) {
        const light = new Uint8Array(readFileSync(join(filesDir, LIGHT[row.file]!)));
        writeFileSync(join(outDir, net, `${LIGHT[row.file]}.jce`), await sealFile(fileKey, light, ' light'));
        sealedLight = `/enc/${net}/${LIGHT[row.file]}.jce`;
      }
      const { v: _v, ...rest } = v1;
      const offer: Offer2 = { ...rest, v: 2, cipherSha256: binToHex(sha256.hash(sealedBytes)), keyHash: keyHashHex(fileKey), claimPubkey: CLAIM_PUBKEY[slot] };
      const signed = signOffer2(offer, offerKeys[slot]);
      const check = verifyOffer2(signed, { orderId: '00'.repeat(16), nowSec: 0, pubkey: OFFER_PUBKEY[slot] });
      if (!check.ok) throw new Error(`${net} ${key}: ${check.reason}`);
      row.v2 = { signed, offerHashHex: offerHash2Hex(offer), payToLockingHex: binToHex(lockingFor(offer.payTo)), sealed: `/enc/${net}/${row.file}.jce`, ...(sealedLight ? { sealedLight } : {}) };
    }
  }
  return book;
}

/** One row of an open specialist's book: the same v2 entry as the site's rows, plus where its claim server answers. */
export type SpecialistRow = { file: string; claimUrl: string; v2: V2Entry };
export type SpecialistBook = Partial<Record<Net, Record<string, SpecialistRow>>>;

/**
 * An open specialist's offers (specialists/template/README.md): for each network it sells on, checks that the sealed
 * file made by seal-files.ts --specialist opens with the key from its seed into exactly its file, then signs a v2 offer
 * with its own offer key (<dir>/.env.offer), naming its own claim key (<dir>/.dev.vars). Writes <dir>/offers.json.
 *   node scripts/run.mjs scripts/sign-offers-v2.ts --specialist specialists/<you>
 */
export async function signSpecialist(dir: string): Promise<SpecialistBook> {
  const spec = readSpec(dir);
  const vars = readEnvFile(join(dir, '.dev.vars'));
  const offerHex = readEnvFile(join(dir, '.env.offer')).JC_OFFER_KEY ?? '';
  if (!/^[0-9a-f]{64}$/i.test(offerHex)) throw new Error(`${dir}/.env.offer: JC_OFFER_KEY is missing or not 32 bytes of hex`);
  const offerKey = hexToBin(offerHex.toLowerCase());
  const seedHex = vars.JC_FILE_KEY_SEED ?? '';
  if (!/^([0-9a-f]{2}){32,}$/i.test(seedHex)) throw new Error(`${dir}/.dev.vars: JC_FILE_KEY_SEED is missing or shorter than 32 bytes`);
  const claimKeys = Object.keys(JSON.parse(vars.JC_CLAIM_KEYS ?? '{}') as Record<string, string>);
  if (claimKeys.length !== 1 || !/^0[23][0-9a-f]{64}$/.test(claimKeys[0]!)) throw new Error(`${dir}/.dev.vars: JC_CLAIM_KEYS must hold exactly one claim key`);
  const plain = new Uint8Array(readFileSync(join(dir, spec.file)));
  const fileSha256 = binToHex(sha256.hash(plain));
  const facts = spec.facts ?? measureFacts(spec.part, plain);
  const book: SpecialistBook = {};
  for (const net of netsOf(spec)) {
    const fileKey = deriveFileKey(hexToBin(seedHex.toLowerCase()), net, fileSha256);
    const path = sealedPath(dir, spec, net);
    let sealedBytes: Uint8Array;
    try {
      sealedBytes = new Uint8Array(readFileSync(path));
    } catch {
      throw new Error(`${path} is missing: seal your file first (scripts/seal-files.ts --specialist ${dir})`);
    }
    const opened = await openFile(fileKey, sealedBytes).catch(() => null);
    if (!opened || binToHex(sha256.hash(opened)) !== fileSha256) throw new Error(`${net}: ${path} does not open into ${spec.file} with your key: seal it again`);
    const offer: Offer2 = {
      orderId: ANY_ORDER,
      facts,
      specialist: spec.specialist,
      part: spec.part,
      priceCents: spec.priceCents,
      priceSats: spec.priceSats,
      fileSha256,
      expires: Math.floor(Date.parse(spec.expires) / 1000),
      payTo: spec.payTo[net]!,
      pubkey: binToHex(secp256k1.derivePublicKeyCompressed(offerKey) as Uint8Array),
      v: 2,
      cipherSha256: binToHex(sha256.hash(sealedBytes)),
      keyHash: keyHashHex(fileKey),
      claimPubkey: claimKeys[0]!,
    };
    const signed = signOffer2(offer, offerKey);
    const check = verifyOffer2(signed, { orderId: '00'.repeat(16), nowSec: Math.floor(Date.now() / 1000), pubkey: offer.pubkey });
    if (!check.ok) throw new Error(`${net}: ${check.reason}`);
    book[net] = { [spec.key]: { file: basename(spec.file), claimUrl: spec.claimUrl, v2: { signed, offerHashHex: offerHash2Hex(offer), payToLockingHex: binToHex(lockingFor(offer.payTo)), sealed: sealedUrlPath(spec, net) } } };
  }
  writeFileSync(join(dir, 'offers.json'), JSON.stringify(book, null, 2) + '\n');
  return book;
}

const specialistFolder = process.argv[1]?.includes('sign-offers-v2') ? specialistDir() : null;
if (specialistFolder) {
  const book = await signSpecialist(specialistFolder);
  for (const [net, rows] of Object.entries(book)) {
    for (const [key, row] of Object.entries(rows)) console.log(`${net} ${key}: offer ${row.v2.offerHashHex} · ${row.v2.signed.offer.priceSats} sat · facts ${row.v2.signed.offer.facts} · sealed ${row.v2.sealed}`);
  }
  console.log(`signed; your book: ${specialistFolder}/offers.json`);
}

if (process.argv[1]?.includes('sign-offers-v2') && !specialistFolder) {
  const seedHex = process.env.JC_FILE_KEY_SEED ?? '';
  if (!/^([0-9a-f]{2}){32,}$/i.test(seedHex)) throw new Error('JC_FILE_KEY_SEED is missing or shorter than 32 bytes');
  const keys = {} as Record<Slot, Uint8Array>;
  for (const slot of Object.keys(OFFER_KEY_ENV) as Slot[]) {
    const hex = process.env[OFFER_KEY_ENV[slot]];
    if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`${OFFER_KEY_ENV[slot]} is missing or not 32 bytes of hex`);
    keys[slot] = hexToBin(hex.toLowerCase());
  }
  const book = JSON.parse(readFileSync('src/data/offers.json', 'utf8')) as Book;
  await addV2(book, hexToBin(seedHex.toLowerCase()), keys);
  writeFileSync('src/data/offers.json', JSON.stringify(book, null, 2) + '\n');
  console.log('v2 offers added beside v1; sealed files in public/enc/');
}
