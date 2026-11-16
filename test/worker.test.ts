import { describe, expect, it } from 'vitest';
import { binToHex, encodeCashAddress, encodeTransaction, hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { buildPayment, lockingFor, noteText, type Utxo } from '../src/core/tx';
import { checkPaid } from '../src/core/release';
import { offerHashHex, verifyOffer, ANY_ORDER } from '../src/core/offer';
import { OFFER_PUBKEY, PAYOUT } from '../src/config';
import { checkPaidRaw, checkOfferPaid, readOutputs } from '../worker/txparse';
import { bookFor } from '../worker/index';
import offers from '../src/data/offers.json';

const priv = sha256.hash(utf8ToBin('worker-test'));
const addr = encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: hash160(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array) }).address;
const coin: Utxo = { txid: '11'.repeat(32), vout: 0, sats: 200000n, lockingBytecode: lockingFor(addr), path: 'receive', index: 0 };
const ORDER = 'ab'.repeat(16);

type Entry = { signed: { offer: any; sig: string }; payToLockingHex: string; offerHashHex: string; file: string };
const book = offers as unknown as Record<'mainnet' | 'chipnet', Record<string, Entry>>;

describe('worker transaction reader', () => {
  it('reads the same outputs as libauth', () => {
    const p = buildPayment({ utxos: [coin], payouts: [{ label: 'a', address: PAYOUT.icon.chipnet, sats: 14267n }], note: noteText(ORDER, ['cd'.repeat(32)]) });
    const raw = binToHex(encodeTransaction(p.transaction));
    const outs = readOutputs(raw);
    expect(outs.map((o) => [o.value, binToHex(o.script)])).toEqual(p.transaction.outputs.map((o) => [o.valueSatoshis, binToHex(o.lockingBytecode)]));
  });

  it('agrees with the full release check, for paid, underpaid and missing offers', () => {
    const e = book.chipnet['icon']!;
    const sats = BigInt(e.signed.offer.priceSats);
    for (const [paySats, hashes, expectOk] of [
      [sats, [e.offerHashHex], true],
      [sats - 1n, [e.offerHashHex], false],
      [sats, ['ee'.repeat(32)], false],
    ] as const) {
      const p = buildPayment({ utxos: [coin], payouts: [{ label: 'icon', address: e.signed.offer.payTo, sats: paySats }], note: noteText(ORDER, [...hashes]) });
      const raw = binToHex(encodeTransaction(p.transaction));
      const w = checkPaidRaw(raw, { payToLockingHex: e.payToLockingHex, minSats: sats, offerHashHex: e.offerHashHex });
      const l = checkPaid(raw, { payTo: e.signed.offer.payTo, minSats: sats, orderIdHex: ORDER, offerHashHex: e.offerHashHex });
      expect(w.ok).toBe(expectOk);
      expect(l.ok).toBe(expectOk);
    }
  });
});

describe('one payment cannot unlock two offers of the same specialist', () => {
  const book = bookFor('chipnet');
  const a = book['icon']!, b = book['icon:b']!;
  const pay = (sats: bigint, hashes: string[]) =>
    binToHex(encodeTransaction(buildPayment({ utxos: [coin], payouts: [{ label: 'icon', address: PAYOUT.icon.chipnet, sats }], note: noteText(ORDER, hashes) }).transaction));
  it('one price paid, both variants listed: neither file is released', () => {
    const raw = pay(BigInt(a.priceSats), [a.offerHashHex, b.offerHashHex]);
    expect(checkOfferPaid(raw, book, 'icon').ok).toBe(false);
    expect(checkOfferPaid(raw, book, 'icon:b').ok).toBe(false);
  });
  it('one price paid, one variant listed: only that file', () => {
    const raw = pay(BigInt(b.priceSats), [b.offerHashHex]);
    expect(checkOfferPaid(raw, book, 'icon:b').ok).toBe(true);
    expect(checkOfferPaid(raw, book, 'icon').ok).toBe(false);
  });
  it('both prices paid, both listed: both files', () => {
    const raw = pay(BigInt(a.priceSats) + BigInt(b.priceSats), [a.offerHashHex, b.offerHashHex]);
    expect(checkOfferPaid(raw, book, 'icon').ok).toBe(true);
    expect(checkOfferPaid(raw, book, 'icon:b').ok).toBe(true);
  });
  it('Sam careless and good share an address: one payment opens one of them', () => {
    const raw = pay(0n + BigInt(book['sam:good']!.priceSats), [book['sam:good']!.offerHashHex, book['sam:careless']!.offerHashHex]).replace(binToHex(lockingFor(PAYOUT.icon.chipnet)), binToHex(lockingFor(PAYOUT.sam.chipnet)));
    expect(checkOfferPaid(raw, book, 'sam:good').ok).toBe(false);
  });
});

describe('offer book', () => {
  for (const net of ['mainnet', 'chipnet'] as const) {
    for (const [key, e] of Object.entries(book[net])) {
      it(`${net} ${key}: signed by its specialist, precomputed values match`, () => {
        const who = key.split(':')[0] as keyof typeof OFFER_PUBKEY;
        expect(verifyOffer(e.signed, { orderId: ORDER, nowSec: 1_794_800_000, pubkey: OFFER_PUBKEY[who] }).ok).toBe(true);
        expect(e.signed.offer.orderId).toBe(ANY_ORDER);
        expect(e.signed.offer.payTo).toBe(PAYOUT[who][net]);
        expect(e.payToLockingHex).toBe(binToHex(lockingFor(e.signed.offer.payTo)));
        expect(e.offerHashHex).toBe(offerHashHex(e.signed.offer));
        expect(BigInt(e.signed.offer.priceSats)).toBeGreaterThanOrEqual(546n);
      });
    }
  }
});
