// The order API with a JC2 payment (into contracts), the network replaced by a stub: /paid records it only when it
// fully funds a listed contract of this order; /kit then names, for each part, the sealed file, its fingerprints, the
// key lock, the contract and where its key stands on chain.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { binToHex, encodeLockingBytecodeP2pkh, hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';

const chain = new Map<string, string>();
let history: Record<string, { tx_hash: string; height: number }[]> = {};
vi.mock('../worker/fulcrum', () => ({
  rpc: vi.fn(async (_net: string, method: string, params: unknown[]) => {
    if (method === 'blockchain.transaction.get') {
      const raw = chain.get(params[0] as string);
      if (!raw) throw new Error('No such mempool or blockchain transaction');
      return raw;
    }
    if (method === 'blockchain.scripthash.get_history') return history[params[0] as string] ?? [];
    throw new Error(`unexpected ${method}`);
  }),
}));

import { api } from '../worker/api';
import { newOrderId } from '../src/core/orderid';
import { buildPayment2, type Utxo } from '../src/core/tx';
import { scripthashOf, txidOf, unhex } from '../src/core/htlc';
import { signLocally } from './helpers/signer';
import offers from '../src/data/offers.json';

type V2 = { signed: { offer: { priceSats: string; cipherSha256: string; keyHash: string; claimPubkey: string } }; offerHashHex: string; sealed: string };
const book = offers as unknown as Record<'chipnet', Record<string, { v2: V2 }>>;
const O = 'https://jc.test';
const store = new Map<string, string>();
const env = { ORDERS: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) } };
const call = async (method: string, path: string, body?: unknown) => {
  const r = await api(new Request(O + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, j: (await r.json()) as any };
};
const priv = sha256.hash(utf8ToBin('api v2 buyer'));
const lock = encodeLockingBytecodeP2pkh(hash160(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array));

function pay(orderId: string, keys: string[], short = 0n) {
  const coin: Utxo = { txid: '34'.repeat(32), vout: 0, sats: 100_000n, lockingBytecode: lock, path: 'receive', index: 0 };
  const p = buildPayment2({
    utxos: [coin],
    contracts: keys.map((k) => {
      const o = book.chipnet[k]!.v2.signed.offer;
      return { label: k, priceSats: BigInt(o.priceSats) - short, lock: { cipherSha256: o.cipherSha256, keyHash: o.keyHash, sellerPubkey: o.claimPubkey } };
    }),
    payouts: [{ label: 'service', address: 'bchtest:qqczcf6dcqm62u0prm2qnre4655w5236qytf8scfkf', sats: 4756n }],
    orderIdHex: orderId,
    offerHashesHex: keys.map((k) => book.chipnet[k]!.v2.offerHashHex),
    refundTime: 1_795_100_000,
  });
  const raw = signLocally(p.transaction, p.sourceOutputs, () => priv).hex;
  const txid = txidOf(unhex(raw));
  chain.set(txid, raw);
  return { p, txid };
}

beforeEach(() => {
  chain.clear();
  store.clear();
  history = {};
});

describe('order API, JC2 payments', () => {
  it('describes each part with its contract offer, sealed file and key lock', async () => {
    const { j } = await call('POST', '/api/orders', { network: 'chipnet' });
    for (const part of j.parts) {
      expect(part.contract_offer.offer.v).toBe(2);
      expect(part.sealed_file).toMatch(/^https:\/\/jc\.test\/enc\/chipnet\/.+\.jce$/);
      expect(part.key_lock).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(j.pay_note).toMatch(/own small contract/);
  });

  it('/paid records a JC2 payment of this order; the cover variant comes from the contracts it funds', async () => {
    const id = newOrderId('chipnet', 'sam');
    const { txid } = pay(id, ['cover:b', 'lena:good', 'logo']);
    const r = await call('POST', `/api/orders/${id}/paid`, { txid });
    expect(r.status).toBe(200);
    expect(r.j).toMatchObject({ ok: true, txid, cover_choice: 'b' });
    expect(r.j.contracts.sort()).toEqual(['cover:b', 'lena:good', 'logo']);
    expect(JSON.parse(store.get(`paid:${id}`)!)).toEqual({ txid, choice: 'b' });
  });

  it('/paid refuses a payment for another order, and one whose contracts hold less than price + fee', async () => {
    const id = newOrderId('chipnet', 'sam');
    const other = pay(newOrderId('chipnet', 'sam'), ['logo']);
    expect((await call('POST', `/api/orders/${id}/paid`, { txid: other.txid })).status).toBe(409);
    const under = pay(id, ['logo'], 1n);
    const r = await call('POST', `/api/orders/${id}/paid`, { txid: under.txid });
    expect(r.status).toBe(409);
    expect(r.j.reason).toMatch(/funds none/);
    expect(store.size).toBe(0);
  });

  it('/kit: sealed files and fingerprints; a key not on chain yet says so and gives the claim link', async () => {
    const id = newOrderId('chipnet', 'sam');
    const { p, txid } = pay(id, ['cover', 'lena:good', 'logo']);
    store.set(`paid:${id}`, JSON.stringify({ txid, choice: 'a' }));
    for (const c of p.contracts) history[scripthashOf(unhex(c.lockingHex))] = [{ tx_hash: txid, height: 0 }];
    const kit = await call('GET', `/api/orders/${id}/kit`);
    expect(kit.status).toBe(200);
    expect(kit.j.files).toHaveLength(3);
    for (const [i, f] of (kit.j.files as any[]).entries()) {
      const k = ['cover', 'lena:good', 'logo'][i]!;
      expect(f).toMatchObject({ status: 'waiting_for_specialist', sealed_url: `${O}${book.chipnet[k]!.v2.sealed}`, sealed_sha256: book.chipnet[k]!.v2.signed.offer.cipherSha256, key_lock: book.chipnet[k]!.v2.signed.offer.keyHash });
      expect(f.claim_url).toBe(`${O}/claim/${encodeURIComponent(k)}?net=chipnet&txid=${txid}`);
      expect(f.contract.vout).toBe(i);
    }
    expect(kit.j.note).toMatch(/AES-256-GCM/);
  });
});
