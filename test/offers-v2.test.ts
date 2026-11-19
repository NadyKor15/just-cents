// The v2 form of every demo offer: signed by the same offer key as v1, the same promise (facts, price, file, address),
// the claim key from config, and a sealed file on the site whose fingerprint is the one signed.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { binToHex, sha256 } from '@bitauth/libauth';
import { offerHash2Hex, verifyOffer2, type Offer, type Offer2 } from '../src/core/offer';
import { lockingFor } from '../src/core/tx';
import { CLAIM_PUBKEY, OFFER_PUBKEY } from '../src/config';
import { claimBook } from '../worker/claim';
import offers from '../src/data/offers.json';

type Row = { signed: { offer: Offer }; file: string; v2: { signed: { offer: Offer2; sig: string }; offerHashHex: string; payToLockingHex: string; sealed: string; sealedLight?: string } };
const book = offers as unknown as Record<'mainnet' | 'chipnet', Record<string, Row>>;

describe('v2 offer book', () => {
  for (const net of ['mainnet', 'chipnet'] as const) {
    for (const [key, row] of Object.entries(book[net]).filter(([k]) => !k.startsWith('_'))) {
      it(`${net} ${key}: v2 signed by the offer key, same promise as v1, claim key from config, sealed file matches`, () => {
        const slot = key.split(':')[0] as keyof typeof OFFER_PUBKEY;
        const v1 = row.signed.offer, v2 = row.v2.signed.offer;
        expect(verifyOffer2(row.v2.signed, { orderId: 'ab'.repeat(16), nowSec: 1_795_000_000, pubkey: OFFER_PUBKEY[slot] })).toEqual({ ok: true });
        for (const f of ['orderId', 'facts', 'specialist', 'part', 'priceCents', 'priceSats', 'fileSha256', 'expires', 'payTo', 'pubkey'] as const) expect(v2[f], f).toBe(v1[f]);
        expect(v2.claimPubkey).toBe(CLAIM_PUBKEY[slot]);
        expect(v2.claimPubkey).not.toBe(v2.pubkey);
        expect(row.v2.offerHashHex).toBe(offerHash2Hex(v2));
        expect(row.v2.payToLockingHex).toBe(binToHex(lockingFor(v2.payTo)));
        expect(row.v2.sealed).toBe(`/enc/${net}/${row.file}.jce`);
        const sealed = readFileSync(`public${row.v2.sealed}`);
        expect(binToHex(sha256.hash(sealed))).toBe(v2.cipherSha256);
        expect(sealed.length).toBe(4 + 12 + readFileSync(`public/files/${row.file}`).length + 16);
        if (key.startsWith('cover')) expect(row.v2.sealedLight).toBe(`/enc/${net}/${row.file.replace('.jpg', '-light.jpg')}.jce`);
      });
    }
    it(`${net}: every v2 offer is claimable by the worker, with its claim key`, () => {
      const b = claimBook(net);
      expect(Object.keys(b).sort()).toEqual(Object.keys(book[net]).filter((k) => !k.startsWith('_')).sort());
      for (const [k, e] of Object.entries(b)) expect(e.claimPubkey).toBe(book[net][k]!.v2.signed.offer.claimPubkey);
    });
  }
  it('mainnet and chipnet use different file keys', () => {
    expect(book.mainnet.logo!.v2.signed.offer.keyHash).not.toBe(book.chipnet.logo!.v2.signed.offer.keyHash);
  });
});
