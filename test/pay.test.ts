// Order.pay: a retry after a network failure must send the SAME signed transaction (never ask the wallet again,
// never pick other coins), the txid comes from the signed bytes, and a wallet that changes the transaction is refused.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { binToHex, decodeTransaction, encodeCashAddress, hash160, hexToBin, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';

const sent: string[] = [];
let answers: { ok: boolean; txid?: string; nodeError?: string }[] = [];
vi.mock('../src/core/chain', () => ({
  broadcast: vi.fn(async (_net: string, hex: string) => {
    sent.push(hex);
    return answers.shift() ?? { ok: true, txid: '' };
  }),
}));

import { Order } from '../src/app/order';
import { OFFERS } from '../src/data/offers';
import { lockingFor, type BuiltPayment, type Utxo } from '../src/core/tx';
import { txidOf } from '../src/core/release';
import { signLocally } from './helpers/signer';

const priv = sha256.hash(utf8ToBin('pay-test-wallet'));
const addr = encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: hash160(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array) }).address;

function readyOrder(): Order {
  const o = new Order('chipnet', 'sam');
  for (const [slot, key] of [['icon', 'icon'], ['lena', 'lena:good'], ['voice', 'voice']] as const) {
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

beforeEach(() => {
  sent.length = 0;
  answers = [];
});

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

  it('pays the three accepted specialists and the service in one transaction', async () => {
    const o = readyOrder();
    const w = wallet({ coins: [[coin(200_000n, 3)]] });
    await o.pay(w.link, () => {});
    const tx = decodeTransaction(hexToBin(sent[0]!));
    if (typeof tx === 'string') throw new Error(tx);
    const outs = tx.outputs.map((x) => binToHex(x.lockingBytecode));
    for (const k of ['icon', 'lena:good', 'voice']) expect(outs).toContain(binToHex(lockingFor(OFFERS.chipnet[k]!.signed.offer.payTo)));
    expect(outs).not.toContain(binToHex(lockingFor(OFFERS.chipnet['sam:careless']!.signed.offer.payTo))); // the rejected one gets nothing
  });

  it('a wallet that returns a different transaction is refused and nothing is sent', async () => {
    const o = readyOrder();
    const w = wallet({ coins: [[coin(200_000n, 4)]], tamper: true });
    await expect(o.pay(w.link, () => {})).rejects.toThrow(/different transaction/);
    expect(sent).toHaveLength(0);
  });
});

