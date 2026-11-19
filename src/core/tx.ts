// One Bitcoin Cash transaction that pays every accepted specialist, the service, returns change,
// and carries an OP_RETURN note with the order id and the fingerprints of the accepted offers.
// The browser builds it; the person's wallet only signs the inputs.
import {
  binToHex,
  cashAddressToLockingBytecode,
  encodeTransaction,
  hexToBin,
  utf8ToBin,
  type Transaction,
} from '@bitauth/libauth';
import { FEE_SATS, contractLocking, dustFor, noteText2, opReturnBytecode2, type LockParams } from './htlc';

/** Outputs below this value are refused by the network as dust (P2PKH). */
export const DUST_SATS = 546n;
/** Network minimum relay fee is 1 sat/byte; we pay exactly that, rounded up. */
export const FEE_SATS_PER_BYTE = 1n;
/**
 * Size of a P2PKH input once signed: 141 bytes with a Schnorr signature, up to 149 with ECDSA (72-byte DER + sighash).
 * We size for ECDSA so the fee never falls below 1 sat/byte whichever scheme the wallet uses (Schnorr overpays ≤8 sat/input).
 */
export const P2PKH_INPUT_SIGNED_BYTES = 149;
/** Nodes relay at most 223 bytes of OP_RETURN script by default. */
export const MAX_OP_RETURN_BYTES = 223;
/** Text prefix of our OP_RETURN note: protocol name and version. */
export const NOTE_PREFIX = 'JC1';

export type Utxo = {
  txid: string;
  vout: number;
  sats: bigint;
  /** Locking bytecode of the coin (the wallet's P2PKH address). */
  lockingBytecode: Uint8Array;
  /** Where the wallet keeps the key: path name and address index. */
  path: 'receive' | 'change';
  index: number;
};

export type Payout = { label: string; address: string; sats: bigint };

export type BuiltPayment = {
  transaction: Transaction;
  /** Coins being spent, in input order, in the shape WizardConnect wallets expect. */
  sourceOutputs: SourceOutput[];
  /** [inputIndex, pathName, addressIndex] for each input the wallet must sign. */
  inputPaths: [number, 'receive' | 'change', number][];
  fee: bigint;
  change: bigint;
  /** Estimated size after signing, bytes. */
  size: number;
  noteHex: string;
};

export type SourceOutput = {
  outpointTransactionHash: Uint8Array;
  outpointIndex: number;
  sequenceNumber: number;
  unlockingBytecode: Uint8Array;
  lockingBytecode: Uint8Array;
  valueSatoshis: bigint;
};

export function lockingFor(address: string): Uint8Array {
  const r = cashAddressToLockingBytecode(address);
  if (typeof r === 'string') throw new Error(`bad address ${address}: ${r}`);
  return r.bytecode;
}

/**
 * The note text, one ASCII push so every wallet shows it readably:
 * "JC1 <order id, 32 hex> <first 16 bytes of each accepted offer hash, 32 hex each>".
 */
export function noteText(orderIdHex: string, offerHashesHex: string[]): string {
  if (!/^[0-9a-f]{32}$/.test(orderIdHex)) throw new Error('order id must be 16 bytes hex');
  for (const h of offerHashesHex) if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('offer hash must be 32 bytes hex');
  return [NOTE_PREFIX, orderIdHex, ...offerHashesHex.map((h) => h.slice(0, 32))].join(' ');
}

/** OP_RETURN locking bytecode with a single data push. */
export function opReturnBytecode(text: string): Uint8Array {
  const data = utf8ToBin(text);
  let push: number[];
  if (data.length <= 75) push = [data.length];
  else if (data.length <= 255) push = [0x4c, data.length];
  else throw new Error('note too long');
  const script = Uint8Array.from([0x6a, ...push, ...data]);
  if (script.length > MAX_OP_RETURN_BYTES) throw new Error(`note is ${script.length} bytes, limit ${MAX_OP_RETURN_BYTES}`);
  return script;
}

/** Reads our note back from an OP_RETURN script; null if it is not ours. */
export function parseNote(lockingBytecode: Uint8Array): { orderIdHex: string; offerPrefixes: string[] } | null {
  if (lockingBytecode[0] !== 0x6a) return null;
  let i = 1;
  let len = lockingBytecode[i]!;
  if (len === 0x4c) {
    i++;
    len = lockingBytecode[i]!;
  }
  i++;
  const data = lockingBytecode.slice(i, i + len);
  if (data.length !== len) return null;
  const text = new TextDecoder().decode(data);
  const parts = text.split(' ');
  if (parts[0] !== NOTE_PREFIX || !parts[1] || !/^[0-9a-f]{32}$/.test(parts[1])) return null;
  const offers = parts.slice(2);
  if (offers.some((p) => !/^[0-9a-f]{32}$/.test(p))) return null;
  return { orderIdHex: parts[1], offerPrefixes: offers };
}

function varIntSize(n: number): number {
  return n < 0xfd ? 1 : n <= 0xffff ? 3 : 5;
}

function outputSize(lockingBytecode: Uint8Array): number {
  return 8 + varIntSize(lockingBytecode.length) + lockingBytecode.length;
}

export function estimateSize(inputs: number, outputs: Uint8Array[]): number {
  return 4 + varIntSize(inputs) + inputs * P2PKH_INPUT_SIGNED_BYTES + varIntSize(outputs.length) + outputs.reduce((s, o) => s + outputSize(o), 0) + 4;
}

/**
 * Picks coins (largest first) and builds the unsigned transaction.
 * Change goes back to the address of the first coin spent: every wallet recognises that address as its own,
 * so the wallet's "balance change" line is right.
 */
export function buildPayment(args: { utxos: Utxo[]; payouts: Payout[]; note: string }): BuiltPayment {
  const { payouts, note } = args;
  if (payouts.length === 0) throw new Error('nothing to pay');
  for (const p of payouts) {
    if (p.sats < DUST_SATS) throw new Error(`${p.label}: ${p.sats} sat is below the dust limit ${DUST_SATS}`);
  }
  const noteScript = opReturnBytecode(note);
  const payoutOutputs = payouts.map((p) => ({ lockingBytecode: lockingFor(p.address), valueSatoshis: p.sats }));
  const need = payouts.reduce((s, p) => s + p.sats, 0n);
  const coins = [...args.utxos].sort((a, b) => (b.sats > a.sats ? 1 : b.sats < a.sats ? -1 : 0));
  const picked: Utxo[] = [];
  let have = 0n;
  for (const c of coins) {
    picked.push(c);
    have += c.sats;
    const changeLocking = picked[0]!.lockingBytecode;
    const size = estimateSize(picked.length, [...payoutOutputs.map((o) => o.lockingBytecode), noteScript, changeLocking]);
    const fee = BigInt(size) * FEE_SATS_PER_BYTE;
    if (have >= need + fee + DUST_SATS) {
      const change = have - need - fee;
      return assemble(picked, payoutOutputs, noteScript, changeLocking, change, fee, size);
    }
    // No change output: allowed only if the leftover is too small to be its own output.
    const sizeNoChange = estimateSize(picked.length, [...payoutOutputs.map((o) => o.lockingBytecode), noteScript]);
    const feeNoChange = BigInt(sizeNoChange) * FEE_SATS_PER_BYTE;
    if (have >= need + feeNoChange) {
      return assemble(picked, payoutOutputs, noteScript, null, 0n, have - need, sizeNoChange);
    }
  }
  const short = need - have;
  throw new Error(`not enough coins: need ${need} sat plus fee, wallet has ${have} sat (short by at least ${short} sat)`);
}

function assemble(
  picked: Utxo[],
  payoutOutputs: { lockingBytecode: Uint8Array; valueSatoshis: bigint }[],
  noteScript: Uint8Array,
  changeLocking: Uint8Array | null,
  change: bigint,
  fee: bigint,
  size: number,
): BuiltPayment {
  const inputs = picked.map((c) => ({
    outpointTransactionHash: hexToBin(c.txid),
    outpointIndex: c.vout,
    sequenceNumber: 0,
    unlockingBytecode: new Uint8Array(),
  }));
  const outputs = [...payoutOutputs, { lockingBytecode: noteScript, valueSatoshis: 0n }];
  if (changeLocking) outputs.push({ lockingBytecode: changeLocking, valueSatoshis: change });
  const transaction: Transaction = { version: 2, inputs, outputs, locktime: 0 };
  const sourceOutputs = picked.map((c, i) => ({
    ...inputs[i]!,
    lockingBytecode: c.lockingBytecode,
    valueSatoshis: c.sats,
  }));
  const inputPaths = picked.map((c, i) => [i, c.path, c.index] as [number, 'receive' | 'change', number]);
  return { transaction, sourceOutputs, inputPaths, fee, change, size, noteHex: binToHex(noteScript) };
}

export function unsignedHex(tx: Transaction): string {
  return binToHex(encodeTransaction(tx));
}

// ---------- v2: one payment into hash-lock contracts (src/core/htlc.ts) ----------

/** What the buyer locks for one accepted specialist: price + FEE_SATS, under the offer's key lock and sealed file. */
export type ContractPayout = { label: string; priceSats: bigint; lock: Pick<LockParams, 'cipherSha256' | 'keyHash' | 'sellerPubkey'> };

export type BuiltPayment2 = BuiltPayment & {
  /** One per accepted specialist, in output order. */
  contracts: { label: string; vout: number; sats: bigint; params: LockParams; lockingHex: string }[];
  buyerLockingHex: string;
  refundHeight: number;
  note: string;
};

/**
 * The v2 payment: one contract output per accepted specialist (price + FEE_SATS), the plain outputs (the service's 1¢),
 * the JC2 note, change. Refunds and change go to the address of the largest coin, which is always spent first, so the
 * buyer's refund address is one the wallet already knows as its own.
 */
export function buildPayment2(args: {
  utxos: Utxo[];
  contracts: ContractPayout[];
  payouts: Payout[];
  orderIdHex: string;
  offerHashesHex: string[];
  refundHeight: number;
}): BuiltPayment2 {
  if (args.contracts.length === 0) throw new Error('nothing to pay');
  const coins = [...args.utxos].sort((a, b) => (b.sats > a.sats ? 1 : b.sats < a.sats ? -1 : 0));
  if (coins.length === 0) throw new Error('not enough coins: the wallet has none');
  const buyer = coins[0]!.lockingBytecode;
  const buyerLockingHex = binToHex(buyer);
  const note = noteText2(args.orderIdHex, args.refundHeight, buyerLockingHex, args.offerHashesHex);
  const noteScript = opReturnBytecode2(note);
  const contracts = args.contracts.map((c) => {
    const params: LockParams = { ...c.lock, buyerLockingHex, refundHeight: args.refundHeight };
    const locking = contractLocking(params);
    const sats = c.priceSats + FEE_SATS;
    if (sats < dustFor(locking)) throw new Error(`${c.label}: ${sats} sat is below the dust limit`);
    return { label: c.label, sats, params, locking };
  });
  for (const p of args.payouts) if (p.sats < DUST_SATS) throw new Error(`${p.label}: ${p.sats} sat is below the dust limit ${DUST_SATS}`);
  const outputs = [
    ...contracts.map((c) => ({ lockingBytecode: c.locking, valueSatoshis: c.sats })),
    ...args.payouts.map((p) => ({ lockingBytecode: lockingFor(p.address), valueSatoshis: p.sats })),
  ];
  const need = outputs.reduce((s, o) => s + o.valueSatoshis, 0n);
  const picked: Utxo[] = [];
  let have = 0n;
  for (const c of coins) {
    picked.push(c);
    have += c.sats;
    const size = estimateSize(picked.length, [...outputs.map((o) => o.lockingBytecode), noteScript, buyer]);
    const fee = BigInt(size) * FEE_SATS_PER_BYTE;
    let built: BuiltPayment | null = null;
    if (have >= need + fee + DUST_SATS) built = assemble(picked, outputs, noteScript, buyer, have - need - fee, fee, size);
    else {
      const sizeNoChange = estimateSize(picked.length, [...outputs.map((o) => o.lockingBytecode), noteScript]);
      const feeNoChange = BigInt(sizeNoChange) * FEE_SATS_PER_BYTE;
      if (have >= need + feeNoChange) built = assemble(picked, outputs, noteScript, null, 0n, have - need, sizeNoChange);
    }
    if (built) {
      return {
        ...built,
        contracts: contracts.map((c, i) => ({ label: c.label, vout: i, sats: c.sats, params: c.params, lockingHex: binToHex(c.locking) })),
        buyerLockingHex,
        refundHeight: args.refundHeight,
        note,
      };
    }
  }
  throw new Error(`not enough coins: need ${need} sat plus fee, wallet has ${have} sat (short by at least ${need - have} sat)`);
}
