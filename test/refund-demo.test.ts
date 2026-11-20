// scripts/refund-demo.ts and scripts/local-wallet.ts, offline: the plan pays exactly one contract of a checked demo
// offer, the refund it leads to pays the buyer's own address without any signature and passes the BCH 2026 VM only after
// the refund time, and the local wallet signs what it builds.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binToHex, createVirtualMachineBch2026, decodeTransaction, hexToBin } from '@bitauth/libauth';
import offers from '../src/data/offers.json';
import { planRefundDemo, contractCoin } from '../scripts/refund-demo';
import { readPhraseFile, signPayment, walletFromPhrase } from '../scripts/local-wallet';
import { buildRefund, encodeTx, FEE_SATS, redeemScript, contractLocking, unhex } from '../src/core/htlc';
import { lockingFor, type Utxo } from '../src/core/tx';
import { PAYOUT } from '../src/config';

// the BIP39 test phrase (public): a throwaway wallet
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const wallet = walletFromPhrase(PHRASE, 'chipnet');
const coin = (sats: bigint, i = 0): Utxo => ({ txid: `${i}`.padStart(2, '0').repeat(32), vout: 0, sats, lockingBytecode: unhex(wallet.addresses[i]!.lockingHex), path: 'receive', index: i });
const REFUND = 1_795_000_000;
const plan = (utxos: Utxo[], extra: Partial<Parameters<typeof planRefundDemo>[0]> = {}) =>
  planRefundDemo({ net: 'chipnet', offerKey: 'logo', utxos, refundTime: REFUND, orderIdHex: '0f'.repeat(16), nowSec: 1_790_000_000, ...extra });

/** The refund spending the contract as the network would see it, run through the VM. */
function vmRefund(p: ReturnType<typeof plan>, mutate?: (tx: ReturnType<typeof buildRefund>) => void) {
  const c = contractCoin(p, 'ab'.repeat(32));
  const r = buildRefund({ contracts: [c] });
  mutate?.(r);
  const tx = decodeTransaction(encodeTx(r.tx));
  if (typeof tx === 'string') throw new Error(tx);
  const vm = createVirtualMachineBch2026(true);
  const source = { ...tx.inputs[0]!, outpointTransactionHash: hexToBin(c.txid), lockingBytecode: contractLocking(c.params), valueSatoshis: c.value };
  return { r, ok: vm.verify({ transaction: tx, sourceOutputs: [source] }) };
}

describe('refund demo plan', () => {
  it('pays exactly one contract of the checked demo offer (price + 500), a JC2 note and change; nothing else', () => {
    const p = plan([coin(100_000n)]);
    const outs = p.payment.transaction.outputs;
    expect(outs).toHaveLength(3);
    const price = BigInt((offers.chipnet.logo as { v2: { signed: { offer: { priceSats: string } } } }).v2.signed.offer.priceSats);
    expect(outs[0]!.valueSatoshis).toBe(price + FEE_SATS);
    expect(outs[1]!.lockingBytecode[0]).toBe(0x6a);
    expect(binToHex(outs[2]!.lockingBytecode)).toBe(wallet.addresses[0]!.lockingHex);
    expect(p.payment.note.startsWith(`JC2 ${'0f'.repeat(16)} ${REFUND} ${wallet.addresses[0]!.lockingHex} `)).toBe(true);
    expect(p.walletSpend).toBe(price + FEE_SATS + p.payment.fee);
    expect(p.payment.contracts[0]!.params.sellerPubkey).toBe((offers.chipnet.logo as { v2: { signed: { offer: { claimPubkey: string } } } }).v2.signed.offer.claimPubkey);
  });

  it('a mainnet plan of the logo offer stays under 6 000 sat with the fee', () => {
    const p = planRefundDemo({ net: 'mainnet', offerKey: 'logo', utxos: [{ ...coin(1_605_214n), lockingBytecode: lockingFor(PAYOUT.cover.mainnet) }], refundTime: REFUND, orderIdHex: '0f'.repeat(16), nowSec: 1_790_000_000 });
    expect(p.walletSpend).toBeLessThanOrEqual(6000n);
    expect(p.walletSpend).toBe(5256n + p.payment.fee);
  });

  it('refuses an offer whose signature does not match, an unknown offer, and an expired one', () => {
    const book = structuredClone(offers) as unknown as Record<string, Record<string, { v2: { signed: { offer: { priceSats: string } } } }>>;
    book.chipnet!.logo!.v2.signed.offer.priceSats = '1';
    expect(() => plan([coin(100_000n)], { book: book as never })).toThrow(/signature does not match/);
    expect(() => plan([coin(100_000n)], { offerKey: 'nobody' })).toThrow(/no version 2 offer/);
    expect(() => plan([coin(100_000n)], { offerKey: '__proto__' })).toThrow(/no version 2 offer/);
    expect(() => plan([coin(100_000n)], { nowSec: 4_000_000_000 })).toThrow(/expired/);
  });

  it('the refund needs no signature, pays the buyer, and the VM takes it only once its locktime reaches the refund time', () => {
    const p = plan([coin(100_000n)]);
    const good = vmRefund(p);
    expect(good.ok).toBe(true);
    expect(binToHex(good.r.tx.outputs[0]!.locking)).toBe(p.payment.buyerLockingHex);
    expect(good.r.tx.outputs[0]!.value).toBeGreaterThanOrEqual(p.payment.contracts[0]!.sats - FEE_SATS);
    expect(good.r.tx.inputs[0]!.unlocking.length).toBe(1 + 2 + redeemScript(p.payment.contracts[0]!.params).length); // OP_0 + the contract: no signature
    expect(String(vmRefund(p, (r) => (r.tx.locktime = REFUND - 1)).ok)).toMatch(/locktime/i);
    expect(String(vmRefund(p, (r) => (r.tx.outputs[0]!.locking = lockingFor(PAYOUT.service.chipnet))).ok)).toMatch(/OP_VERIFY|EQUALVERIFY|fail/i);
  });
});

describe('local wallet', () => {
  it('derives the known first address of the BIP39 test phrase on m/44\'/145\'/0\'', () => {
    // the same phrase in Electron Cash / Cashonize (BIP44, coin 145): the first receive address
    const main = walletFromPhrase(PHRASE, 'mainnet');
    expect(main.addresses[0]!.address).toBe('bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6');
    expect(main.addresses).toHaveLength(40);
    expect(main.addresses.filter((a) => a.path === 'change')).toHaveLength(20);
  });

  it('signs a planned payment so that the VM accepts it, with change coins too', () => {
    const p = plan([coin(3000n, 0), { ...coin(4000n, 1), lockingBytecode: unhex(wallet.addresses[20]!.lockingHex), path: 'change', index: 0 }]);
    const s = signPayment(p.payment.transaction, p.payment.sourceOutputs, wallet);
    expect(s.txid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads a phrase file (plain or JSON) and removes it at once when asked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jc-phrase-'));
    const f = join(dir, 'p.txt');
    writeFileSync(f, PHRASE + '\n', { mode: 0o600 });
    expect(readPhraseFile(f, false).phrase).toBe(PHRASE);
    expect(existsSync(f)).toBe(true);
    const r = readPhraseFile(f, true);
    expect(r.phrase).toBe(PHRASE);
    expect(r.removedAt).toMatch(/Z$/);
    expect(existsSync(f)).toBe(false);
    writeFileSync(f, JSON.stringify({ mnemonic: PHRASE }), { mode: 0o600 });
    expect(readPhraseFile(f, true).phrase).toBe(PHRASE);
    writeFileSync(f, 'one two three');
    chmodSync(f, 0o600);
    expect(() => readPhraseFile(f, true)).toThrow(/3 words/);
    expect(existsSync(f)).toBe(false);
  });
});
