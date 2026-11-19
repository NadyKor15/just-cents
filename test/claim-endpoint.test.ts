// POST /claim/<offer>: the demo specialist's endpoint, with the network replaced by a stub. It must broadcast a claim
// the VM accepts, answer the same claim to a repeated request, refuse without its keys, and never broadcast when the
// payment does not fund its contract.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { binToHex, createVirtualMachineBch2026, decodeTransaction, encodeLockingBytecodeP2pkh, hash160, secp256k1 as libSecp, sha256 as libSha, utf8ToBin } from '@bitauth/libauth';

const rpc = vi.fn();
vi.mock('../worker/fulcrum', () => ({ rpc: (...a: unknown[]) => rpc(...a) }));

import { claim, claimBook, type ClaimEntry } from '../worker/claim';
import { deriveFileKey, keyHashHex, sealFile } from '../src/core/filebox';
import { FEE_SATS, txidOf, unhex } from '../src/core/htlc';
import { buildPayment2, lockingFor, type Utxo } from '../src/core/tx';
import { signLocally } from './helpers/signer';

const k = (s: string) => libSha.hash(utf8ToBin(s));
const pub = (p: Uint8Array) => libSecp.derivePublicKeyCompressed(p) as Uint8Array;
const seller = k('endpoint seller');
const SEED = k('endpoint seed');
const buyerPriv = k('endpoint buyer');
const buyerLock = encodeLockingBytecodeP2pkh(hash160(pub(buyerPriv)));
const PLAIN = utf8ToBin('subtitles');
const fileSha256 = binToHex(libSha.hash(PLAIN));
const fileKey = deriveFileKey(SEED, 'chipnet', fileSha256);
const env = { JC_FILE_KEY_SEED: binToHex(SEED), JC_CLAIM_KEYS: JSON.stringify({ [binToHex(pub(seller))]: binToHex(seller) }) };
const ORIGIN = 'https://justcents.retailbox-automation.com';
const T_REFUND = 1_795_100_000;

/** 11 block headers whose median time is `mtp` (only the time field matters here). */
function headers(mtp: number): string {
  let hex = '';
  for (let i = 0; i < 11; i++) {
    const b = new Uint8Array(80);
    new DataView(b.buffer).setUint32(68, mtp + (i - 5) * 60, true);
    hex += binToHex(b);
  }
  return hex;
}

let entry: ClaimEntry;
let paymentHex = '';
let paymentTxid = '';

beforeEach(async () => {
  rpc.mockReset();
  const sealed = await sealFile(fileKey, PLAIN);
  entry = {
    offerHashHex: binToHex(k('offer')),
    priceSats: '4756',
    payToLockingHex: binToHex(lockingFor('bchtest:qrzvk9ujc48fylttn48f3tkkjnmetpx6vqdhsxvdx3')),
    pubkey: binToHex(pub(seller)),
    keyHash: keyHashHex(fileKey),
    cipherSha256: binToHex(libSha.hash(sealed)),
    fileSha256,
  };
  const coin: Utxo = { txid: '12'.repeat(32), vout: 1, sats: 50_000n, lockingBytecode: buyerLock, path: 'receive', index: 0 };
  const p = buildPayment2({
    utxos: [coin],
    contracts: [{ label: 'lena', priceSats: 4756n, lock: { cipherSha256: entry.cipherSha256, keyHash: entry.keyHash, sellerPubkey: entry.pubkey } }],
    payouts: [],
    orderIdHex: 'ef'.repeat(16),
    offerHashesHex: [entry.offerHashHex],
    refundTime: T_REFUND,
  });
  paymentHex = signLocally(p.transaction, p.sourceOutputs, () => buyerPriv).hex;
  paymentTxid = txidOf(unhex(paymentHex));
});

function network(o: { broadcast?: () => unknown; mtp?: number } = {}) {
  const sent: string[] = [];
  rpc.mockImplementation(async (_net: string, method: string, params: unknown[]) => {
    if (method === 'blockchain.transaction.get') return paymentHex;
    if (method === 'blockchain.headers.subscribe') return { height: 338_500, hex: '' };
    if (method === 'blockchain.block.headers') {
      expect(params).toEqual([338_490, 11]);
      return { hex: headers(o.mtp ?? T_REFUND - 3600), count: 11, max: 2016 };
    }
    if (method === 'blockchain.transaction.broadcast') {
      sent.push(params[0] as string);
      if (o.broadcast) return o.broadcast();
      return txidOf(unhex(params[0] as string));
    }
    throw new Error(`unexpected ${method}`);
  });
  return sent;
}

const post = (key = 'lena:good', e: Record<string, string> = env) =>
  claim(new URL(`${ORIGIN}/claim/${encodeURIComponent(key)}?net=chipnet&txid=${paymentTxid}`), 'POST', e, { 'lena:good': entry });

describe('POST /claim', () => {
  it('broadcasts a claim the VM accepts and names it', async () => {
    const sent = network();
    const r = await post();
    const j = (await r.json()) as { ok: boolean; claimTxid: string; payment: { vout: number; sats: string } };
    expect(r.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(j.claimTxid).toBe(txidOf(unhex(sent[0]!)));
    expect(j.payment).toMatchObject({ txid: paymentTxid, vout: 0, sats: (4756n + FEE_SATS).toString() });
    const pay = decodeTransaction(unhex(paymentHex));
    const tx = decodeTransaction(unhex(sent[0]!));
    if (typeof tx === 'string' || typeof pay === 'string') throw new Error('decode');
    const vm = createVirtualMachineBch2026(true);
    expect(vm.verify({ sourceOutputs: [{ ...tx.inputs[0]!, lockingBytecode: pay.outputs[0]!.lockingBytecode, valueSatoshis: pay.outputs[0]!.valueSatoshis }], transaction: tx })).toBe(true);
  });

  it('a repeated request gives the same claim; "already known" from the node is success', async () => {
    const first = network();
    const a = (await (await post()).json()) as { claimTxid: string };
    const again = network({ broadcast: () => { throw new Error('the transaction was rejected by network rules.\n\ntxn-already-known'); } });
    const r = await post();
    const b = (await r.json()) as { claimTxid: string };
    expect(r.status).toBe(200);
    expect(b.claimTxid).toBe(a.claimTxid);
    expect(again[0]).toBe(first[0]);
  });

  it('the contract already spent elsewhere (a refund): 409, nothing claimed', async () => {
    network({ broadcast: () => { throw new Error('bad-txns-inputs-missingorspent'); } });
    const r = await post();
    expect(r.status).toBe(409);
  });

  it('too close to the refund time: 409 and nothing is broadcast, the key stays secret', async () => {
    const sent = network({ mtp: T_REFUND - 600 });
    const r = await post();
    expect(r.status).toBe(409);
    expect(sent).toHaveLength(0);
  });

  it('without its keys the server refuses (503) and never reads the network', async () => {
    network();
    expect((await post('lena:good', {})).status).toBe(503);
    expect((await post('lena:good', { JC_FILE_KEY_SEED: env.JC_FILE_KEY_SEED, JC_CLAIM_KEYS: '{}x' })).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('GET, a bad txid, an unknown offer', async () => {
    network();
    expect((await claim(new URL(`${ORIGIN}/claim/lena:good?net=chipnet&txid=${paymentTxid}`), 'GET', env, { 'lena:good': entry })).status).toBe(405);
    expect((await claim(new URL(`${ORIGIN}/claim/lena:good?net=chipnet&txid=xyz`), 'POST', env, { 'lena:good': entry })).status).toBe(400);
    expect((await post('nobody')).status).toBe(404);
  });

  it('the shipped offer book has no claimable offers until v2 offers are signed (stage 2)', () => {
    expect(Object.keys(claimBook('mainnet'))).toEqual([]);
    expect(Object.keys(claimBook('chipnet'))).toEqual([]);
  });
});
