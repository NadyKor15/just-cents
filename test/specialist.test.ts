// The open-specialist template, offline, from a stranger's empty folder: new keys → sealed file → signed v2 offer →
// the book checks → a payment into the contract → the stranger's own claim (the template worker's code) passes the
// BCH 2026 VM → the key read from that claim opens the sealed file into exactly the offered file.
// Plus what must be refused: keys made twice, secret files others can read, a sealed file the key does not open,
// a changed price, a changed sealed file, a book that pays elsewhere, one key for both offer and claim.
import { describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, statSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binToHex, createVirtualMachineBch2026, decodeTransaction, encodeLockingBytecodeP2pkh, hash160, secp256k1 as libSecp, sha256 as libSha, utf8ToBin } from '@bitauth/libauth';
import offers from '../src/data/offers.json';
import { makeKeys } from '../scripts/specialist-keys';
import { sealSpecialist } from '../scripts/seal-files';
import { signSpecialist, type SpecialistBook } from '../scripts/sign-offers-v2';
import { verifyBook } from '../scripts/verify-specialist';
import { measureFacts, readEnvFile, readSpec } from '../scripts/specialist-lib';
import { claim, claimBook, planClaim, readKeys } from '../worker/claim';
import worker from '../specialists/template/worker';
import { openFile } from '../src/core/filebox';
import { readSpend, txidOf, unhex } from '../src/core/htlc';
import { buildPayment2, type Utxo } from '../src/core/tx';
import { signLocally } from './helpers/signer';

const SRT = '1\n00:00:01,000 --> 00:00:02,500\nHello from a stranger.\n\n2\n00:00:03,000 --> 00:00:04,000\nPaid in cents.\n';
const REFUND = 1_795_000_000;

/** A stranger's folder: the template copied, their own file, their own keys and payout address, sealed and signed. */
async function stranger(edit: (spec: Record<string, unknown>) => void = () => {}) {
  const dir = join(mkdtempSync(join(tmpdir(), 'jc-specialist-')), 'ada');
  cpSync('specialists/template', dir, { recursive: true });
  writeFileSync(join(dir, 'work/subtitles.srt'), SRT);
  const made = makeKeys(dir, true);
  const spec = JSON.parse(readFileSync(join(dir, 'specialist.json'), 'utf8'));
  Object.assign(spec, { key: 'ada', specialist: 'Ada (subtitles)', payTo: { chipnet: made.payout!.chipnet, mainnet: made.payout!.mainnet } });
  edit(spec);
  writeFileSync(join(dir, 'specialist.json'), JSON.stringify(spec, null, 2));
  await sealSpecialist(dir);
  const book = await signSpecialist(dir);
  return { dir, made, book };
}

const io = (dir: string) => ({ nowSec: 1_790_000_000, readSealed: async (_n: string, row: { v2: { sealed: string } }) => new Uint8Array(readFileSync(join(dir, 'public', row.v2.sealed))) });

describe('open specialist, from an empty folder', () => {
  it('keys: 0600 files git ignores, separate offer and claim keys, made once', async () => {
    const { dir, made } = await stranger();
    for (const f of ['.dev.vars', '.env.offer', '.env.payout']) expect(statSync(join(dir, f)).mode & 0o777).toBe(0o600);
    expect(made.offerPubkey).not.toBe(made.claimPubkey);
    const before = readFileSync(join(dir, '.dev.vars'), 'utf8');
    expect(() => makeKeys(dir)).toThrow(/keys are made once/);
    expect(readFileSync(join(dir, '.dev.vars'), 'utf8')).toBe(before);
    const gi = readFileSync('.gitignore', 'utf8');
    expect(gi).toMatch(/^\.dev\.vars$/m);
    expect(gi).toMatch(/^\.env\.\*$/m);
    chmodSync(join(dir, '.dev.vars'), 0o644);
    expect(() => readEnvFile(join(dir, '.dev.vars'))).toThrow(/read by others/);
  });

  it('the signed book passes every check a buyer\'s page makes', async () => {
    const { dir, book } = await stranger();
    const checks = await verifyBook(book, io(dir));
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.length).toBe(14);
    const o = book.chipnet!.ada!.v2.signed.offer;
    expect(o.facts).toBe('srt;2;1.000');
    expect(o.priceSats).toBe('4756');
    expect(book.chipnet!.ada!.v2.sealed).toBe('/enc/chipnet/subtitles.srt.jce');
    expect(book.mainnet!.ada!.v2.signed.offer.keyHash).not.toBe(o.keyHash); // a chipnet claim never reveals the mainnet key
  });

  it('a payment into the contract → the stranger\'s claim passes the VM → its key opens the sealed file into the offered file', async () => {
    const { dir, book } = await stranger();
    const entry = claimBook('chipnet', book as never).ada!;
    const keys = readKeys(readEnvFile(join(dir, '.dev.vars')))!;
    expect(keys).not.toBeNull();
    const buyerPriv = libSha.hash(utf8ToBin('buyer'));
    const buyerLock = encodeLockingBytecodeP2pkh(hash160(libSecp.derivePublicKeyCompressed(buyerPriv) as Uint8Array));
    const coin: Utxo = { txid: '34'.repeat(32), vout: 0, sats: 60_000n, lockingBytecode: buyerLock, path: 'receive', index: 0 };
    const p = buildPayment2({ utxos: [coin], contracts: [{ label: 'ada', priceSats: 4756n, lock: { cipherSha256: entry.cipherSha256, keyHash: entry.keyHash, sellerPubkey: entry.claimPubkey } }], payouts: [], orderIdHex: '12'.repeat(16), offerHashesHex: [entry.offerHashHex], refundTime: REFUND });
    const pay = signLocally(p.transaction, p.sourceOutputs, () => buyerPriv);
    const plan = planClaim(pay.hex, entry, 'chipnet', keys, REFUND - 3600);
    expect(plan.ok, plan.ok ? '' : plan.reason).toBe(true);
    if (!plan.ok) return;
    const payTx = decodeTransaction(unhex(pay.hex));
    const claimTx = decodeTransaction(unhex(plan.hex));
    if (typeof payTx === 'string' || typeof claimTx === 'string') throw new Error('decode');
    const vm = createVirtualMachineBch2026(true);
    expect(vm.verify({ sourceOutputs: [{ ...claimTx.inputs[0]!, lockingBytecode: payTx.outputs[0]!.lockingBytecode, valueSatoshis: payTx.outputs[0]!.valueSatoshis }], transaction: claimTx })).toBe(true);
    expect(binToHex(claimTx.outputs[0]!.lockingBytecode)).toBe(book.chipnet!.ada!.v2.payToLockingHex); // paid to the stranger
    const spend = readSpend(unhex(plan.hex), { txid: txidOf(unhex(pay.hex)), vout: 0 });
    expect(spend?.kind).toBe('claim');
    if (spend?.kind !== 'claim') return;
    const opened = await openFile(spend.key, new Uint8Array(readFileSync(join(dir, 'public/enc/chipnet/subtitles.srt.jce'))));
    expect(new TextDecoder().decode(opened)).toBe(SRT);
  });

  it('the template worker claims only the stranger\'s own offers, never the site\'s demo offers', async () => {
    const env = { JC_FILE_KEY_SEED: 'ab'.repeat(32), JC_CLAIM_KEYS: '{}' };
    const r = await worker.fetch(new Request('http://localhost:8787/claim/logo?net=chipnet&txid=' + 'ab'.repeat(32), { method: 'POST' }), env);
    expect(r.status).toBe(404);
    expect(((await r.json()) as { reason: string }).reason).toMatch(/no claimable offer: logo/);
    expect((await worker.fetch(new Request('http://localhost:8787/'), env)).status).toBe(404);
    const g = await worker.fetch(new Request('http://localhost:8787/claim/ada?net=chipnet'), env);
    expect(g.status).toBe(405);
    // and the site's own endpoint still claims from the site's book when given nothing
    const site = await claim(new URL('https://x/claim/logo?net=chipnet&txid=' + 'ab'.repeat(32)), 'POST', {});
    expect(site.status).toBe(503); // found the demo offer, then stopped for lack of keys
    const fn = await claim(new URL('https://x/claim/__proto__?net=chipnet&txid=' + 'ab'.repeat(32)), 'POST', {}, () => ({}));
    expect(fn.status).toBe(404);
    // a book given per network is the one searched: the stranger's offer is found (then: no keys here → 503)
    const { book } = await stranger();
    const own = await claim(new URL('https://x/claim/ada?net=chipnet&txid=' + 'ab'.repeat(32)), 'POST', {}, (net) => claimBook(net, book as never));
    expect(own.status).toBe(503);
  });
});

describe('what the template refuses', () => {
  it('a sealed file the stranger\'s key does not open is not signed', async () => {
    const { dir } = await stranger();
    writeFileSync(join(dir, 'public/enc/chipnet/subtitles.srt.jce'), readFileSync(join(dir, 'public/enc/mainnet/subtitles.srt.jce')));
    await expect(signSpecialist(dir)).rejects.toThrow(/does not open/);
  });

  it('a changed price, a changed sealed file, a book paying elsewhere, one key for both: each fails its check', async () => {
    const { dir, book } = await stranger();
    const fails = async (b: SpecialistBook, what: RegExp) => {
      const bad = (await verifyBook(b, io(dir))).filter((c) => !c.ok).map((c) => c.what);
      expect(bad.length, `expected a failure on ${what}`).toBeGreaterThan(0);
      expect(bad.join('\n')).toMatch(what);
    };
    const price = structuredClone(book);
    price.chipnet!.ada!.v2.signed.offer.priceSats = '1';
    await fails(price, /signed by its own key/);
    const elsewhere = structuredClone(book);
    elsewhere.chipnet!.ada!.v2.payToLockingHex = (offers.chipnet.logo as { payToLockingHex: string }).payToLockingHex;
    await fails(elsewhere, /locking bytecode is that address/);
    const sealedFile = join(dir, 'public/enc/chipnet/subtitles.srt.jce');
    const b = readFileSync(sealedFile);
    b[b.length - 1]! ^= 1;
    writeFileSync(sealedFile, b);
    await fails(book, /fingerprint is the signed one/);
  });

  it('one key for offer and claim fails; a claim URL must be https or localhost', async () => {
    const { dir, book } = await stranger();
    const same = structuredClone(book);
    same.chipnet!.ada!.v2.signed.offer.claimPubkey = same.chipnet!.ada!.v2.signed.offer.pubkey;
    const bad = (await verifyBook(same, io(dir))).filter((c) => !c.ok).map((c) => c.what).join('\n');
    expect(bad).toMatch(/claim key is not the offer key/);
    const url = structuredClone(book);
    url.chipnet!.ada!.claimUrl = 'http://example.com';
    expect((await verifyBook(url, io(dir))).filter((c) => !c.ok).map((c) => c.what).join('\n')).toMatch(/claim URL/);
  });

  it('specialist.json is checked before anything is made', async () => {
    await expect(stranger((s) => (s.payTo = { chipnet: 'bitcoincash:qqczcf6dcqm62u0prm2qnre4655w5236qy0mrh6734' }))).rejects.toThrow(/payTo.chipnet/);
    await expect(stranger((s) => (s.key = 'Ada!'))).rejects.toThrow(/"key"/);
    await expect(stranger((s) => (s.claimUrl = 'http://localhost:8787/'))).rejects.toThrow(/claimUrl/);
    expect(() => readSpec('specialists/template')).toThrow(/"file"|payTo/);
  });

  it('facts are measured exactly as for the demo specialists (cover, subtitles, logo)', () => {
    const demo = offers.mainnet as Record<string, { file: string; signed: { offer: { facts: string; part: string } } }>;
    for (const k of ['cover', 'cover:b', 'sam:good', 'lena:careless', 'logo']) {
      const row = demo[k]!;
      expect(measureFacts(row.signed.offer.part as never, new Uint8Array(readFileSync(`public/files/${row.file}`)))).toBe(row.signed.offer.facts);
    }
    expect(existsSync('specialists/template/README.md')).toBe(true);
  });
});
