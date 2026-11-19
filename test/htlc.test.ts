// The hash-lock contract, checked by an independent implementation: every claim and refund built by src/core/htlc.ts
// (noble, no WASM) goes through the libauth BCH 2026 virtual machine in standard mode, the rules the network applies.
import { describe, expect, it } from 'vitest';
import {
  binToHex,
  createVirtualMachineBch2026,
  decodeTransaction,
  encodeLockingBytecodeP2pkh,
  encodeTransaction,
  generateSigningSerializationBch,
  hash160,
  secp256k1 as libSecp,
  sha256 as libSha,
  utf8ToBin,
} from '@bitauth/libauth';
import {
  buildClaim,
  buildRefund,
  canClaimSafely,
  canRefund,
  claimUnlocking,
  contractLocking,
  contractsInPayment,
  decodeTx,
  encodeTx,
  FEE_SATS,
  hex,
  noteText2,
  opReturnBytecode2,
  parseNote2,
  parseRedeem,
  readSpend,
  redeemScript,
  refundUnlocking,
  sighashPreimage,
  signInput,
  txidOf,
  unhex,
  type LockParams,
  type Tx,
} from '../src/core/htlc';
import { deriveFileKey, keyHashHex, openFile, sealFile } from '../src/core/filebox';
import { buildPayment2, lockingFor, parseNote, type Utxo } from '../src/core/tx';
import { ANY_ORDER, offerHash2Hex, signOffer2, verifyOffer, verifyOffer2, type Offer2 } from '../src/core/offer';
import { readNote } from '../worker/txparse';
import { planClaim, type ClaimEntry } from '../worker/claim';
import { signLocally } from './helpers/signer';

const vm = createVirtualMachineBch2026(true);
const k = (s: string) => libSha.hash(utf8ToBin(s));
const pub = (priv: Uint8Array) => libSecp.derivePublicKeyCompressed(priv) as Uint8Array;

const sellerPriv = k('seller');
const otherPriv = k('someone else');
const buyerPriv = k('buyer');
const buyerLock = encodeLockingBytecodeP2pkh(hash160(pub(buyerPriv)));
const thiefLock = encodeLockingBytecodeP2pkh(hash160(pub(otherPriv)));
const sellerPayTo = encodeLockingBytecodeP2pkh(hash160(pub(sellerPriv)));

const K = k('the file key');
const params: LockParams = {
  cipherSha256: binToHex(k('sealed file bytes')),
  keyHash: keyHashHex(K),
  sellerPubkey: binToHex(pub(sellerPriv)),
  buyerLockingHex: binToHex(buyerLock),
  refundHeight: 978_100,
};
const FUND = 'aa'.repeat(32);
const PRICE = 4756n;
const VALUE = PRICE + FEE_SATS;

/** Runs a transaction built by our code through libauth's VM; the coins it spends are given as [locking, value]. */
function verify(tx: Tx, coins: [Uint8Array, bigint][]): true | string {
  const lt = decodeTransaction(encodeTx(tx));
  if (typeof lt === 'string') return `decode: ${lt}`;
  const sourceOutputs = lt.inputs.map((inp, i) => ({ ...inp, lockingBytecode: coins[i]![0], valueSatoshis: coins[i]![1] }));
  return vm.verify({ sourceOutputs, transaction: lt });
}

const contract = () => contractLocking(params);
const claimTx = (over: Partial<{ key: Uint8Array; priv: Uint8Array; value: bigint; params: LockParams }> = {}) =>
  buildClaim({ fundingTxid: FUND, vout: 0, value: over.value ?? VALUE, params: over.params ?? params, key: over.key ?? K, privateKey: over.priv ?? sellerPriv, payToLocking: sellerPayTo });

/** A claim assembled by hand, to try what buildClaim refuses to build (wrong key, foreign signature). */
function handClaim(key: Uint8Array, signer: Uint8Array): Tx {
  const redeem = redeemScript(params);
  const tx: Tx = { version: 2, inputs: [{ txid: FUND, vout: 0, unlocking: new Uint8Array(), sequence: 0xffffffff }], outputs: [{ value: VALUE - 400n, locking: sellerPayTo }], locktime: 0 };
  const sig = signInput(tx, 0, redeem, VALUE, signer);
  tx.inputs[0]!.unlocking = claimUnlocking(sig, key, redeem);
  return tx;
}

function refundTx(o: { locktime: number; sequence?: number; outputs: { value: bigint; locking: Uint8Array }[]; inputs?: number }): Tx {
  const redeem = redeemScript(params);
  const n = o.inputs ?? 1;
  return {
    version: 2,
    inputs: Array.from({ length: n }, (_, i) => ({ txid: FUND, vout: i, unlocking: refundUnlocking(redeem), sequence: o.sequence ?? 0xfffffffe })),
    outputs: o.outputs,
    locktime: o.locktime,
  };
}

describe('the contract', () => {
  it('is our exact template, reads back, and fits the limits', () => {
    const r = redeemScript(params);
    expect(r.length).toBeLessThan(520);
    expect(parseRedeem(r)).toEqual(params);
    const other = redeemScript({ ...params, refundHeight: params.refundHeight + 1 });
    expect(hex(contractLocking({ ...params, refundHeight: params.refundHeight + 1 }))).not.toBe(hex(contract()));
    // any other script, even one byte off, is not ours
    const tampered = Uint8Array.from(r);
    tampered[tampered.length - 3] = 0x93; // OP_ADD instead of OP_SUB
    expect(parseRedeem(tampered)).toBeNull();
    expect(parseRedeem(other)).toEqual({ ...params, refundHeight: params.refundHeight + 1 });
    expect(contract().length).toBe(35);
  });

  it('claim: the right key and the specialist signature open it', () => {
    const c = claimTx();
    expect(verify(c.tx, [[contract(), VALUE]])).toBe(true);
    // the specialist keeps at least its price: the claim fee fits in what the buyer added
    expect(c.fee).toBeLessThanOrEqual(FEE_SATS);
    expect(c.tx.outputs[0]!.value).toBeGreaterThanOrEqual(PRICE);
  });

  it('claim: a wrong key is refused, even with the specialist signature', () => {
    const r = verify(handClaim(k('a guessed key'), sellerPriv), [[contract(), VALUE]]);
    expect(r).not.toBe(true);
    expect(String(r)).toMatch(/OP_VERIFY/);
  });

  it('claim: the right key with someone else\'s signature is refused', () => {
    const r = verify(handClaim(K, otherPriv), [[contract(), VALUE]]);
    expect(r).not.toBe(true);
    expect(String(r)).toMatch(/signature verification/);
  });

  it('claim: the hand-built claim with the right key and signature passes (the two refusals above are not about the shape)', () => {
    expect(verify(handClaim(K, sellerPriv), [[contract(), VALUE]])).toBe(true);
  });

  it('buildClaim refuses a key that does not open the lock, and a key pair that is not the specialist\'s', () => {
    expect(() => claimTx({ key: k('wrong') })).toThrow(/does not open/);
    expect(() => claimTx({ priv: otherPriv })).toThrow(/specialist key/);
  });

  it('refund before the refund height is refused', () => {
    const tx = refundTx({ locktime: params.refundHeight - 1, outputs: [{ value: VALUE - FEE_SATS, locking: buyerLock }] });
    const r = verify(tx, [[contract(), VALUE]]);
    expect(r).not.toBe(true);
    expect(String(r)).toMatch(/requires a locktime greater than the transaction's locktime/);
  });

  it('refund from the refund height pays the buyer, with no signature', () => {
    const tx = refundTx({ locktime: params.refundHeight, outputs: [{ value: VALUE - FEE_SATS, locking: buyerLock }] });
    expect(verify(tx, [[contract(), VALUE]])).toBe(true);
  });

  it('refund with a final sequence is refused (locktime would not apply)', () => {
    const tx = refundTx({ locktime: params.refundHeight, sequence: 0xffffffff, outputs: [{ value: VALUE - FEE_SATS, locking: buyerLock }] });
    expect(String(verify(tx, [[contract(), VALUE]]))).toMatch(/locktime is disabled/);
  });

  it('refund to anyone but the buyer is refused', () => {
    const tx = refundTx({ locktime: params.refundHeight, outputs: [{ value: VALUE - FEE_SATS, locking: thiefLock }] });
    expect(String(verify(tx, [[contract(), VALUE]]))).toMatch(/input index 0: Program failed an OP_VERIFY/);
  });

  it('refund paying the buyer less than the value minus the fixed fee is refused', () => {
    const tx = refundTx({ locktime: params.refundHeight, outputs: [{ value: VALUE - FEE_SATS - 1n, locking: buyerLock }] });
    expect(String(verify(tx, [[contract(), VALUE]]))).toMatch(/non-truthy value/);
  });

  it('two contracts cannot share one refund output (the second one\'s money cannot go elsewhere)', () => {
    for (const outputs of [
      [{ value: VALUE - FEE_SATS, locking: buyerLock }, { value: VALUE - FEE_SATS, locking: thiefLock }],
      [{ value: VALUE - FEE_SATS, locking: thiefLock }, { value: VALUE - FEE_SATS, locking: buyerLock }],
    ]) {
      const tx = refundTx({ locktime: params.refundHeight, inputs: 2, outputs });
      expect(String(verify(tx, [[contract(), VALUE], [contract(), VALUE]]))).toMatch(/Program failed an OP_VERIFY/);
    }
    const ok = refundTx({ locktime: params.refundHeight, inputs: 2, outputs: [{ value: VALUE - FEE_SATS, locking: buyerLock }, { value: VALUE - FEE_SATS, locking: buyerLock }] });
    expect(verify(ok, [[contract(), VALUE], [contract(), VALUE]])).toBe(true);
  });

  it('buildRefund: one transaction for several contracts, each paid back at its own index', () => {
    const p2 = { ...params, keyHash: keyHashHex(k('another key')) };
    const r = buildRefund({
      contracts: [
        { txid: FUND, vout: 0, value: VALUE, params },
        { txid: FUND, vout: 3, value: 9512n + FEE_SATS, params: p2 },
      ],
    });
    expect(verify(r.tx, [[contract(), VALUE], [contractLocking(p2), 9512n + FEE_SATS]])).toBe(true);
    expect(r.tx.locktime).toBe(params.refundHeight);
    expect(r.tx.outputs.map((o) => hex(o.locking))).toEqual([hex(buyerLock), hex(buyerLock)]);
    expect(r.tx.outputs[0]!.value).toBeGreaterThanOrEqual(VALUE - FEE_SATS);
    expect(() => buildRefund({ contracts: [{ txid: FUND, vout: 0, value: VALUE, params }], feePerByte: 10n })).toThrow(/above/);
  });

  it('can a specialist still claim, can a buyer refund: the margins', () => {
    expect(canClaimSafely(params.refundHeight - 3, params.refundHeight)).toBe(true);
    expect(canClaimSafely(params.refundHeight - 2, params.refundHeight)).toBe(false);
    expect(canRefund(params.refundHeight - 1, params.refundHeight)).toBe(false);
    expect(canRefund(params.refundHeight, params.refundHeight)).toBe(true);
  });
});

describe('our transaction code agrees with libauth', () => {
  it('signing serialization, encoding and txid', () => {
    const c = claimTx();
    const lt = decodeTransaction(unhex(c.hex));
    if (typeof lt === 'string') throw new Error(lt);
    expect(binToHex(encodeTransaction(lt))).toBe(c.hex);
    const sourceOutputs = [{ ...lt.inputs[0]!, lockingBytecode: contract(), valueSatoshis: VALUE }];
    const theirs = generateSigningSerializationBch({ inputIndex: 0, sourceOutputs, transaction: lt }, { coveredBytecode: redeemScript(params), signingSerializationType: Uint8Array.of(0x41) });
    expect(hex(sighashPreimage(decodeTx(unhex(c.hex)), 0, redeemScript(params), VALUE))).toBe(binToHex(theirs));
    expect(decodeTx(unhex(c.hex))).toEqual(c.tx);
    expect(txidOf(unhex(c.hex))).toBe(c.txid);
  });

  it('the claim is deterministic: the same request gives the same transaction', () => {
    expect(claimTx().hex).toBe(claimTx().hex);
  });
});

describe('reading a spend from the chain', () => {
  it('a claim gives the key, checked against the lock', () => {
    const c = claimTx();
    const s = readSpend(unhex(c.hex), { txid: FUND, vout: 0 });
    expect(s?.kind).toBe('claim');
    expect(s && s.kind === 'claim' && hex(s.key)).toBe(hex(K));
    expect(s?.params).toEqual(params);
    expect(readSpend(unhex(c.hex), { txid: FUND, vout: 1 })).toBeNull();
  });

  it('a refund is a refund; a claim carrying a key that does not match the lock is not read as a key', () => {
    const r = buildRefund({ contracts: [{ txid: FUND, vout: 0, value: VALUE, params }] });
    expect(readSpend(unhex(r.hex), { txid: FUND, vout: 0 })?.kind).toBe('refund');
    const bad = handClaim(k('a guessed key'), sellerPriv);
    expect(readSpend(encodeTx(bad), { txid: FUND, vout: 0 })).toBeNull();
  });
});

describe('the JC2 note', () => {
  const order = 'ab'.repeat(16);
  const hashes = ['11', '22', '33'].map((b) => b.repeat(32));
  it('round-trips, fits the relay limit with three offers, and is not mistaken for JC1', () => {
    const t = noteText2(order, 978_106, binToHex(buyerLock), hashes);
    const s = opReturnBytecode2(t);
    expect(s.length).toBeLessThanOrEqual(223);
    expect(parseNote2(s)).toEqual({ orderIdHex: order, refundHeight: 978_106, buyerLockingHex: binToHex(buyerLock), offerPrefixes: hashes.map((h) => h.slice(0, 32)) });
    expect(parseNote(s)).toBeNull();
    expect(readNote(s)).toBeNull();
  });
  it('refuses malformed fields', () => {
    expect(() => noteText2(order, 5, binToHex(buyerLock), hashes)).toThrow();
    expect(() => noteText2('xy', 978_106, binToHex(buyerLock), hashes)).toThrow();
    expect(parseNote2(opReturnBytecode2('JC2 ' + order + ' 0123 ' + binToHex(buyerLock)))).toBeNull();
  });
});

describe('sealed files', () => {
  const file = utf8ToBin('1\n00:00:00,500 --> 00:00:02,000\nHello\n');
  it('seal and open with the right key; the same key and file always seal the same', async () => {
    const sealed = await sealFile(K, file);
    expect(binToHex(await openFile(K, sealed))).toBe(binToHex(file));
    expect(binToHex(await sealFile(K, file))).toBe(binToHex(sealed));
    expect(binToHex(sealed.slice(0, 4))).toBe(binToHex(utf8ToBin('JCE1')));
    // the format other implementations read: magic 4 | iv 12 | ciphertext | 16-byte tag
    expect(sealed.length).toBe(4 + 12 + file.length + 16);
  });
  it('a wrong key or a changed byte does not open it', async () => {
    const sealed = await sealFile(K, file);
    await expect(openFile(k('wrong'), sealed)).rejects.toThrow(/does not open/);
    const t = Uint8Array.from(sealed);
    t[t.length - 1]! ^= 1;
    await expect(openFile(K, t)).rejects.toThrow(/does not open/);
  });
  it('file keys differ per network and per file', () => {
    const seed = k('seed');
    const f = binToHex(k('file'));
    expect(hex(deriveFileKey(seed, 'mainnet', f))).not.toBe(hex(deriveFileKey(seed, 'chipnet', f)));
    expect(hex(deriveFileKey(seed, 'chipnet', f))).not.toBe(hex(deriveFileKey(seed, 'chipnet', binToHex(k('file2')))));
    expect(hex(deriveFileKey(seed, 'chipnet', f))).toBe(hex(deriveFileKey(seed, 'chipnet', f)));
  });
});

describe('v2 offers', () => {
  const base: Offer2 = {
    v: 2,
    orderId: ANY_ORDER,
    facts: 'svg;1;29;46029',
    specialist: 'logo (demo specialist)',
    part: 'logo',
    priceCents: 1,
    priceSats: '4756',
    fileSha256: binToHex(k('plain')),
    cipherSha256: params.cipherSha256,
    keyHash: params.keyHash,
    expires: 1_798_761_599,
    payTo: 'bchtest:qz7t9gc3y9m89wzmj3x7zderx2e9f72lrcczjzhcs2',
    pubkey: params.sellerPubkey,
  };
  it('sign and verify; changing the lock or the sealed fingerprint breaks the signature', () => {
    const s = signOffer2(base, sellerPriv);
    expect(verifyOffer2(s, { orderId: 'cd'.repeat(16), nowSec: 1_794_800_000 }).ok).toBe(true);
    expect(verifyOffer2({ ...s, offer: { ...base, keyHash: binToHex(k('x')) } }, { orderId: ANY_ORDER, nowSec: 0 }).ok).toBe(false);
    expect(verifyOffer2({ ...s, offer: { ...base, cipherSha256: binToHex(k('x')) } }, { orderId: ANY_ORDER, nowSec: 0 }).ok).toBe(false);
    // a v2 offer is never taken for a v1 one
    expect(verifyOffer(s as never, { orderId: ANY_ORDER, nowSec: 0 })).toEqual({ ok: false, reason: 'unknown offer version' });
  });
});

// ---------- the whole order, offline: payment into contracts → specialist's claim → key → file ----------

const coinPriv = buyerPriv;
const coinLock = buyerLock;
const coin = (sats: bigint, n: number): Utxo => ({ txid: n.toString(16).padStart(64, '0'), vout: 0, sats, lockingBytecode: coinLock, path: 'receive', index: 0 });
const SEED = k('specialist seed');
const PLAIN = utf8ToBin('<svg xmlns="http://www.w3.org/2000/svg"/>');
const plainSha = binToHex(libSha.hash(PLAIN));
const fileKey = deriveFileKey(SEED, 'chipnet', plainSha);

async function entryFor(): Promise<{ entry: ClaimEntry; offerHashHex: string; sealed: Uint8Array }> {
  const sealed = await sealFile(fileKey, PLAIN);
  const offer: Offer2 = {
    v: 2, orderId: ANY_ORDER, facts: 'svg;1;1;40', specialist: 'logo (demo specialist)', part: 'logo', priceCents: 1, priceSats: PRICE.toString(),
    fileSha256: plainSha, cipherSha256: binToHex(libSha.hash(sealed)), keyHash: keyHashHex(fileKey), expires: 1_798_761_599,
    payTo: 'bchtest:qz7t9gc3y9m89wzmj3x7zderx2e9f72lrcczjzhcs2', pubkey: binToHex(pub(sellerPriv)),
  };
  const offerHashHex = offerHash2Hex(offer);
  return {
    entry: { offerHashHex, priceSats: offer.priceSats, payToLockingHex: binToHex(lockingFor(offer.payTo)), pubkey: offer.pubkey, keyHash: offer.keyHash, cipherSha256: offer.cipherSha256, fileSha256: offer.fileSha256 },
    offerHashHex,
    sealed,
  };
}

function pay(e: ClaimEntry, offerHashHex: string, over: Partial<{ price: bigint; listed: string[]; refundHeight: number }> = {}) {
  const p = buildPayment2({
    utxos: [coin(3000n, 1), coin(20000n, 2)],
    contracts: [{ label: 'logo', priceSats: over.price ?? PRICE, lock: { cipherSha256: e.cipherSha256, keyHash: e.keyHash, sellerPubkey: e.pubkey } }],
    payouts: [{ label: 'service', address: 'bchtest:qqczcf6dcqm62u0prm2qnre4655w5236qytf8scfkf', sats: 4756n }],
    orderIdHex: 'cd'.repeat(16),
    offerHashesHex: over.listed ?? [offerHashHex],
    refundHeight: over.refundHeight ?? 338_600,
  });
  const signed = signLocally(p.transaction, p.sourceOutputs, () => coinPriv);
  return { p, raw: signed.hex };
}

describe('a whole v2 order, offline', () => {
  it('payment: contracts at the front, refunds and change to the largest coin, the wallet\'s signature passes the VM', async () => {
    const { entry, offerHashHex } = await entryFor();
    const { p, raw } = pay(entry, offerHashHex);
    expect(p.buyerLockingHex).toBe(binToHex(coinLock));
    expect(p.contracts).toHaveLength(1);
    expect(p.contracts[0]!.sats).toBe(PRICE + FEE_SATS);
    expect(binToHex(p.transaction.outputs[0]!.lockingBytecode)).toBe(p.contracts[0]!.lockingHex);
    expect(binToHex(p.transaction.outputs[p.transaction.outputs.length - 1]!.lockingBytecode)).toBe(binToHex(coinLock));
    expect(p.sourceOutputs[0]!.valueSatoshis).toBe(20000n);
    const found = contractsInPayment(unhex(raw), [{ offerHashHex, lock: { cipherSha256: entry.cipherSha256, keyHash: entry.keyHash, sellerPubkey: entry.pubkey } }]);
    expect(found?.contracts.map((c) => [c.vout, c.value])).toEqual([[0, PRICE + FEE_SATS]]);
  });

  it('specialist claims (the same code as the worker) → the page reads the key from the claim → the file opens and matches', async () => {
    const { entry, offerHashHex, sealed } = await entryFor();
    const { p, raw } = pay(entry, offerHashHex);
    const plan = planClaim(raw, entry, 'chipnet', { seed: SEED, privateKeys: { [entry.pubkey]: sellerPriv } }, 338_500);
    expect(plan.ok, plan.ok ? '' : plan.reason).toBe(true);
    if (!plan.ok) return;
    expect(plan.vout).toBe(0);
    const claim = decodeTx(unhex(plan.hex));
    expect(verify(claim, [[unhex(p.contracts[0]!.lockingHex), PRICE + FEE_SATS]])).toBe(true);
    expect(claim.outputs[0]!.value).toBeGreaterThanOrEqual(PRICE);
    expect(hex(claim.outputs[0]!.locking)).toBe(entry.payToLockingHex);
    // the page's side: from the claim transaction alone
    const s = readSpend(unhex(plan.hex), { txid: txidOf(unhex(raw)), vout: 0 });
    if (!s || s.kind !== 'claim') throw new Error('not read as a claim');
    expect(binToHex(libSha.hash(sealed))).toBe(entry.cipherSha256);
    const opened = await openFile(s.key, sealed);
    expect(binToHex(libSha.hash(opened))).toBe(entry.fileSha256);
  });

  it('the specialist refuses: offer not in the note, underpaid, too close to the refund, keys it does not hold', async () => {
    const { entry, offerHashHex } = await entryFor();
    const keys = { seed: SEED, privateKeys: { [entry.pubkey]: sellerPriv } };
    const notListed = pay(entry, offerHashHex, { listed: ['ee'.repeat(32)] }).raw;
    expect(planClaim(notListed, entry, 'chipnet', keys, 338_500)).toMatchObject({ ok: false, status: 402, reason: 'this offer is not in the note' });
    const under = pay(entry, offerHashHex, { price: PRICE - 1n }).raw;
    expect(planClaim(under, entry, 'chipnet', keys, 338_500)).toMatchObject({ ok: false, status: 402 });
    const { raw } = pay(entry, offerHashHex);
    expect(planClaim(raw, entry, 'chipnet', keys, 338_598)).toMatchObject({ ok: false, status: 409 });
    expect(planClaim(raw, entry, 'chipnet', keys, 338_597).ok).toBe(true);
    expect(planClaim(raw, entry, 'chipnet', { ...keys, seed: k('another seed') }, 338_500)).toMatchObject({ ok: false, status: 500 });
    expect(planClaim(raw, entry, 'mainnet', keys, 338_500)).toMatchObject({ ok: false, status: 500 });
    expect(planClaim(raw, entry, 'chipnet', { seed: SEED, privateKeys: {} }, 338_500)).toMatchObject({ ok: false, status: 500 });
    // a payment whose contract was made for another buyer than the note says: no contract found for this offer
    const other = { ...entry, pubkey: binToHex(pub(otherPriv)) };
    expect(planClaim(raw, other, 'chipnet', keys, 338_500)).toMatchObject({ ok: false, status: 402, reason: 'no contract for this offer in the transaction' });
  });

  it('nobody claims → after the refund height anyone refunds to the buyer, rebuilt from the payment alone', async () => {
    const { entry, offerHashHex } = await entryFor();
    const { raw } = pay(entry, offerHashHex);
    const found = contractsInPayment(unhex(raw), [{ offerHashHex, lock: { cipherSha256: entry.cipherSha256, keyHash: entry.keyHash, sellerPubkey: entry.pubkey } }])!;
    const r = buildRefund({ contracts: found.contracts.map((c) => ({ txid: txidOf(unhex(raw)), vout: c.vout, value: c.value, params: c.params })) });
    expect(verify(r.tx, [[unhex(found.contracts[0]!.lockingHex), found.contracts[0]!.value]])).toBe(true);
    expect(hex(r.tx.outputs[0]!.locking)).toBe(binToHex(coinLock));
    expect(r.tx.outputs[0]!.value).toBeGreaterThanOrEqual(PRICE);
  });
});
