// Order.pay (v2): a retry after a network failure must send the SAME signed transaction (never ask the wallet again,
// never pick other coins), the txid comes from the signed bytes, and a wallet that changes the transaction is refused.
// The payment puts each accepted specialist's money into its own contract (price + 500 sat for its claim), and it is
// built only after the page holds every sealed file and has checked it against the signed offer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { binToHex, decodeTransaction, encodeCashAddress, hash160, hexToBin, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';

const sent: string[] = [];
let answers: { ok: boolean; txid?: string; nodeError?: string }[] = [];
vi.mock('../src/core/chain', () => ({
  broadcast: vi.fn(async (_net: string, hex: string) => {
    sent.push(hex);
    return answers.shift() ?? { ok: true, txid: '' };
  }),
  getRawTx: vi.fn(async () => {
    throw new Error('not in this test');
  }),
}));
const REFUND_TIME = 1_795_100_000;
vi.mock('../src/core/htlc-chain', () => ({
  refundTimeFromNow: vi.fn(async () => REFUND_TIME),
  chainTime: vi.fn(async () => REFUND_TIME - 3600),
  contractState: vi.fn(async () => ({ state: 'open' })),
}));

import { Order } from '../src/app/order';
import { OFFERS } from '../src/data/offers';
import { lockingFor, type BuiltPayment, type Utxo } from '../src/core/tx';
import { contractLocking, FEE_SATS, parseNote2 } from '../src/core/htlc';
import { txidOf } from '../src/core/release';
import { signLocally } from './helpers/signer';
import { PART_BYTES, partCount, partLength } from '../src/core/parts';

const priv = sha256.hash(utf8ToBin('pay-test-wallet'));
const addr = encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: hash160(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array) }).address;

function readyOrder(): Order {
  const o = new Order('chipnet', 'sam');
  for (const [slot, key] of [['cover', 'cover'], ['lena', 'lena:good'], ['logo', 'logo']] as const) {
    o.results[slot] = { key, who: slot === 'lena' ? 'lena' : undefined, verdict: { ok: true, note: '' }, offer: OFFERS.chipnet[key]!.signed, detail: '' };
  }
  return o;
}

function wallet(opts: { coins: Utxo[][]; tamper?: boolean }) {
  let coinCalls = 0;
  let signCalls = 0;
  const link = {
    coins: async () => opts.coins[Math.min(coinCalls++, opts.coins.length - 1)]!,
    sign: async (p: BuiltPayment) => {
      signCalls++;
      const tx = opts.tamper ? { ...p.transaction, outputs: p.transaction.outputs.map((o, i) => (i === 0 ? { ...o, valueSatoshis: o.valueSatoshis + 1n } : o)) } : p.transaction;
      return { ok: true as const, signedHex: signLocally(tx, p.sourceOutputs, () => priv).hex };
    },
  };
  return { link: link as never, counts: () => ({ coinCalls, signCalls }) };
}

const coin = (sats: bigint, n: number): Utxo => ({ txid: n.toString(16).padStart(64, '0'), vout: 0, sats, lockingBytecode: lockingFor(addr), path: 'receive', index: 0 });

/**
 * The site, for the sealed files: served from public/ as the built static site would, the big ones also in parts
 * (<file>.p<i>, cut as the build cuts them); `tamper` changes the last byte of one file (and so of its last part).
 */
let tamper = '';
const fetched: string[] = [];
beforeEach(() => {
  sent.length = 0;
  answers = [];
  tamper = '';
  fetched.length = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    const part = /^(.*)\.part(\d+)$/.exec(url);
    const path = part ? part[1]! : url;
    const bytes = new Uint8Array(readFileSync(`public${path}`));
    if (path === tamper) bytes[bytes.length - 1]! ^= 1;
    if (!part) return new Response(bytes);
    const i = Number(part[2]);
    if (i >= partCount(bytes.length)) return new Response('not found', { status: 404 });
    return new Response(bytes.slice(i * PART_BYTES, i * PART_BYTES + partLength(bytes.length, i)));
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('paying once, even when sending fails', () => {
  it('a retry sends the same signed transaction and does not ask the wallet again', async () => {
    const o = readyOrder();
    // second coins call would return OTHER coins: a rebuilt payment would spend them (a double payment)
    const w = wallet({ coins: [[coin(200_000n, 1)], [coin(500_000n, 2)]] });
    answers = [{ ok: false, nodeError: 'timeout' }, { ok: true, txid: '' }]; // the second server says "already known" with no txid
    await expect(o.pay(w.link, () => {})).rejects.toThrow(/Network: timeout/);
    const r = await o.pay(w.link, () => {});
    expect(w.counts()).toEqual({ coinCalls: 1, signCalls: 1 });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
    expect(r.txid).toBe(txidOf(sent[0]!)); // from the signed bytes, not the empty server answer
    expect(r.txid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pays the three accepted specialists into their contracts and the service, in one transaction', async () => {
    const o = readyOrder();
    const w = wallet({ coins: [[coin(200_000n, 3)]] });
    await o.pay(w.link, () => {});
    const tx = decodeTransaction(hexToBin(sent[0]!));
    if (typeof tx === 'string') throw new Error(tx);
    const outs = tx.outputs.map((x) => [binToHex(x.lockingBytecode), x.valueSatoshis] as const);
    for (const k of ['cover', 'lena:good', 'logo']) {
      const v2 = OFFERS.chipnet[k]!.v2!.signed.offer;
      const want = binToHex(contractLocking({ cipherSha256: v2.cipherSha256, keyHash: v2.keyHash, sellerPubkey: v2.claimPubkey, buyerLockingHex: binToHex(lockingFor(addr)), refundTime: REFUND_TIME }));
      expect(outs).toContainEqual([want, BigInt(v2.priceSats) + FEE_SATS]);
      expect(o.contracts[k]?.lockingHex).toBe(want);
      // the money no longer goes straight to the specialist's address
      expect(outs.map((x) => x[0])).not.toContain(binToHex(lockingFor(v2.payTo)));
    }
    expect(outs).toContainEqual([binToHex(lockingFor('bchtest:qqczcf6dcqm62u0prm2qnre4655w5236qytf8scfkf')), 4756n]);
    // the rejected one gets nothing; the note names this order, the refund time, the buyer and the three v2 offers
    const note = tx.outputs.map((x) => parseNote2(x.lockingBytecode)).find((n) => n)!;
    expect(note).toMatchObject({ orderIdHex: o.id, refundTime: REFUND_TIME, buyerLockingHex: binToHex(lockingFor(addr)) });
    expect(note.offerPrefixes).toEqual(['cover', 'lena:good', 'logo'].map((k) => OFFERS.chipnet[k]!.v2!.offerHashHex.slice(0, 32)));
    expect(note.offerPrefixes).not.toContain(OFFERS.chipnet['sam:careless']!.v2!.offerHashHex.slice(0, 32));
    // the sealed files were fetched (and checked) before the wallet was asked: the cover in its 9 parts, once each,
    // the small ones whole; nothing else
    const cover = OFFERS.chipnet['cover']!.v2!.sealed;
    expect(fetched.sort()).toEqual([...Array.from({ length: 9 }, (_, i) => `${cover}.part${i}`), ...['lena:good', 'logo'].map((k) => OFFERS.chipnet[k]!.v2!.sealed)].sort());
  });

  it('Pay shows how many sealed files are in and how far the cover is', async () => {
    const o = readyOrder();
    const w = wallet({ coins: [[coin(200_000n, 6)]] });
    const steps: string[] = [];
    await o.pay(w.link, (s) => steps.push(s));
    const fetching = steps.filter((s) => s.startsWith('Fetching the sealed files'));
    expect(fetching[0]).toMatch(/^Fetching the sealed files \(0 of 3\)/);
    expect(fetching.some((s) => / · cover \d{1,2}%$/.test(s))).toBe(true);
    expect(fetching.at(-1)).toBe('Fetching the sealed files (3 of 3)');
    expect(steps.indexOf('Fetching the sealed files (3 of 3)')).toBeLessThan(steps.indexOf('Looking for coins in your wallet'));
  });

  it('a part that does not join into the offered file: the file is fetched whole once more, and used if it is right', async () => {
    const o = readyOrder();
    const w = wallet({ coins: [[coin(200_000n, 7)]] });
    const cover = OFFERS.chipnet['cover']!.v2!.sealed;
    const real = globalThis.fetch;
    // a stale part 4 (same length, other bytes), as an out-of-date cache could serve
    vi.stubGlobal('fetch', async (url: string) => {
      const r = await real(url);
      if (url !== `${cover}.part4`) return r;
      const b = new Uint8Array(await r.arrayBuffer());
      b[0]! ^= 0xff;
      return new Response(b);
    });
    await o.pay(w.link, () => {});
    expect(fetched.filter((u) => u === cover)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('a cover that is not the offered one, in parts and whole: no payment, the wallet is never asked', async () => {
    const o = readyOrder();
    const w = wallet({ coins: [[coin(200_000n, 8)]] });
    const cover = OFFERS.chipnet['cover']!.v2!.sealed;
    tamper = cover;
    await expect(o.pay(w.link, () => {})).rejects.toThrow(/cover: the sealed file is not the one the offer names/);
    expect(fetched.filter((u) => u === cover)).toHaveLength(1);
    expect(w.counts()).toEqual({ coinCalls: 0, signCalls: 0 });
    expect(sent).toHaveLength(0);
  });

  it('a sealed file that is not the one the offer names: no payment is built, the wallet is never asked', async () => {
    const o = readyOrder();
    const w = wallet({ coins: [[coin(200_000n, 5)]] });
    tamper = OFFERS.chipnet['logo']!.v2!.sealed;
    await expect(o.pay(w.link, () => {})).rejects.toThrow(/not the one the offer names/);
    expect(w.counts()).toEqual({ coinCalls: 0, signCalls: 0 });
    expect(sent).toHaveLength(0);
  });

  it('a wallet that returns a different transaction is refused and nothing is sent', async () => {
    const o = readyOrder();
    const w = wallet({ coins: [[coin(200_000n, 4)]], tamper: true });
    await expect(o.pay(w.link, () => {})).rejects.toThrow(/different transaction/);
    expect(sent).toHaveLength(0);
  });
});
