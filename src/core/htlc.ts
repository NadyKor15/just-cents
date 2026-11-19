// The hash-lock contract: one small contract per accepted specialist, so money and the file key change hands in one
// transaction and nobody in the middle holds either.
//
// The buyer's one payment puts each accepted specialist's money into its own P2SH32 contract:
//   claim  — the specialist reveals the file key K, with sha256(K) equal to the contract's keyHash, and signs with the
//            key of its offer. The money goes where the specialist's signed transaction says; K is now on chain, and the
//            buyer's page reads it there and opens the sealed file.
//   refund — once the chain's median time passes refundTime, anyone, without any signature, may send the money back:
//            the output at the same index as the contract's input must pay the buyer's own locking bytecode at least the
//            contract's value minus FEE_SATS.
// The refund lock is a time (median time past of the chain), not a block height: on chipnet, since its switch to the
// next upgrade's rules (block 333055, 15 Nov 2026), every node calls a height locktime above 333054 non-final, while a
// time locktime is final as usual; on mainnet both work. One kind of lock on both networks keeps the chipnet test the
// same as the real thing.
// The contract also carries the fingerprint of the sealed (encrypted) file, so the specialist's claim signature covers
// exactly which sealed file was paid for.
//
// No WASM here (noble hashes and curves only): the same code runs in the browser, in Node and in Cloudflare Workers,
// where the demo specialists build their claims. test/htlc.test.ts runs every path through the libauth BCH 2026 VM.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

export type Net = 'mainnet' | 'chipnet';

/** Added by the buyer on top of each specialist's price: pays the claim's network fee, and caps what a refund may spend on fee. */
export const FEE_SATS = 500n;
/**
 * An hour of the chain's median time past (MTP): refundTime = MTP at payment + this. MTP moves at about real time,
 * so the money can go back about an hour after the payment, on either network.
 */
export const REFUND_AFTER_SECONDS = 3600;
/** A specialist reveals its key only while the chain's MTP is at least this far from refundTime. */
export const CLAIM_MARGIN_SECONDS = 600;
/** Locktimes from this value on are times (unix seconds), below it block heights. */
export const LOCKTIME_THRESHOLD = 500_000_000;
/** Network relay minimum. */
export const FEE_PER_BYTE = 1n;
/** Smallest output the network relays to a P2PKH address. */
export const P2PKH_DUST_SATS = 546n;

export type LockParams = {
  /** sha256 of the sealed file, 32 bytes hex */
  cipherSha256: string;
  /** sha256 of the file key K, 32 bytes hex */
  keyHash: string;
  /** compressed public key of the specialist's offer, 33 bytes hex */
  sellerPubkey: string;
  /** locking bytecode the refund must pay (the buyer's address), hex */
  buyerLockingHex: string;
  /** unix seconds; a refund is valid once the chain's median time past is past it */
  refundTime: number;
};

// ---------- bytes ----------

export const hex = bytesToHex;
export const unhex = hexToBytes;

export function hash256(b: Uint8Array): Uint8Array {
  return sha256(sha256(b));
}

export function sha256Hex(b: Uint8Array): string {
  return bytesToHex(sha256(b));
}

const u32le = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
};
const u64le = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};
function varint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  return concatBytes(Uint8Array.of(0xfe), u32le(n));
}
const reversed = (b: Uint8Array) => Uint8Array.from(b).reverse();

// ---------- script ----------

export const OP = {
  OP_0: 0x00,
  OP_PUSHDATA1: 0x4c,
  OP_PUSHDATA2: 0x4d,
  OP_1NEGATE: 0x4f,
  OP_1: 0x51,
  OP_IF: 0x63,
  OP_ELSE: 0x67,
  OP_ENDIF: 0x68,
  OP_DROP: 0x75,
  OP_EQUAL: 0x87,
  OP_EQUALVERIFY: 0x88,
  OP_SUB: 0x94,
  OP_GREATERTHANOREQUAL: 0xa2,
  OP_SHA256: 0xa8,
  OP_HASH256: 0xaa,
  OP_CHECKSIG: 0xac,
  OP_CHECKLOCKTIMEVERIFY: 0xb1,
  OP_INPUTINDEX: 0xc0,
  OP_UTXOVALUE: 0xc6,
  OP_OUTPUTVALUE: 0xcc,
  OP_OUTPUTBYTECODE: 0xcd,
} as const;

/** Minimal script number (little endian, sign bit in the top byte). */
export function scriptNum(n: bigint | number): Uint8Array {
  let v = BigInt(n);
  if (v === 0n) return new Uint8Array();
  const neg = v < 0n;
  if (neg) v = -v;
  const out: number[] = [];
  while (v > 0n) {
    out.push(Number(v & 0xffn));
    v >>= 8n;
  }
  if (out[out.length - 1]! & 0x80) out.push(neg ? 0x80 : 0x00);
  else if (neg) out[out.length - 1]! |= 0x80;
  return Uint8Array.from(out);
}

export function decodeScriptNum(b: Uint8Array): bigint {
  if (b.length === 0) return 0n;
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(i === b.length - 1 ? b[i]! & 0x7f : b[i]!);
  return b[b.length - 1]! & 0x80 ? -v : v;
}

/** The shortest push of these bytes, as the network requires. */
export function pushData(d: Uint8Array): Uint8Array {
  if (d.length === 0) return Uint8Array.of(OP.OP_0);
  if (d.length === 1 && d[0]! >= 1 && d[0]! <= 16) return Uint8Array.of(0x50 + d[0]!);
  if (d.length === 1 && d[0] === 0x81) return Uint8Array.of(OP.OP_1NEGATE);
  if (d.length <= 75) return concatBytes(Uint8Array.of(d.length), d);
  if (d.length <= 255) return concatBytes(Uint8Array.of(OP.OP_PUSHDATA1, d.length), d);
  if (d.length <= 520) return concatBytes(Uint8Array.of(OP.OP_PUSHDATA2, d.length & 0xff, d.length >> 8), d);
  throw new Error('push too long');
}

const pushNumber = (n: bigint | number) => pushData(scriptNum(n));

/** Reads a push-only script into its pushed items; null if it holds anything but pushes. */
export function readPushes(script: Uint8Array): Uint8Array[] | null {
  const items: Uint8Array[] = [];
  let i = 0;
  while (i < script.length) {
    const op = script[i++]!;
    let len: number;
    if (op === OP.OP_0) {
      items.push(new Uint8Array());
      continue;
    }
    if (op >= 0x51 && op <= 0x60) {
      items.push(Uint8Array.of(op - 0x50));
      continue;
    }
    if (op === OP.OP_1NEGATE) {
      items.push(Uint8Array.of(0x81));
      continue;
    }
    if (op <= 75) len = op;
    else if (op === OP.OP_PUSHDATA1) len = script[i++] ?? -1;
    else if (op === OP.OP_PUSHDATA2) {
      len = (script[i] ?? -1) | ((script[i + 1] ?? 0) << 8);
      i += 2;
    } else return null;
    if (len < 0 || i + len > script.length) return null;
    items.push(script.slice(i, i + len));
    i += len;
  }
  return items;
}

const isHex = (s: string, bytes: number) => new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(s);

function checkParams(p: LockParams): void {
  if (!isHex(p.cipherSha256, 32)) throw new Error('cipherSha256 must be 32 bytes hex');
  if (!isHex(p.keyHash, 32)) throw new Error('keyHash must be 32 bytes hex');
  if (!/^0[23][0-9a-f]{64}$/.test(p.sellerPubkey)) throw new Error('sellerPubkey must be a compressed public key');
  if (!/^([0-9a-f]{2}){1,40}$/.test(p.buyerLockingHex)) throw new Error('buyerLockingHex must be 1..40 bytes hex');
  if (!isRefundTime(p.refundTime)) throw new Error('refundTime must be unix seconds');
}

function isRefundTime(t: number): boolean {
  return Number.isInteger(t) && t >= LOCKTIME_THRESHOLD && t <= 0xffffffff;
}

/**
 * The contract (redeem script). Stack on entry: claim = [sig, K, 1], refund = [0].
 *
 *   <cipherSha256> OP_DROP
 *   OP_IF
 *     OP_SHA256 <keyHash> OP_EQUALVERIFY                        K opens this lock
 *     <sellerPubkey> OP_CHECKSIG                               and the specialist signs
 *   OP_ELSE
 *     <refundTime> OP_CHECKLOCKTIMEVERIFY OP_DROP              not before refundTime (median time past)
 *     OP_INPUTINDEX OP_OUTPUTBYTECODE <buyerLocking> OP_EQUALVERIFY      the output at my index pays the buyer
 *     OP_INPUTINDEX OP_OUTPUTVALUE OP_INPUTINDEX OP_UTXOVALUE <FEE> OP_SUB OP_GREATERTHANOREQUAL   at least my value − FEE
 *   OP_ENDIF
 */
export function redeemScript(p: LockParams): Uint8Array {
  checkParams(p);
  return concatBytes(
    pushData(hexToBytes(p.cipherSha256)),
    Uint8Array.of(OP.OP_DROP),
    Uint8Array.of(OP.OP_IF),
    Uint8Array.of(OP.OP_SHA256),
    pushData(hexToBytes(p.keyHash)),
    Uint8Array.of(OP.OP_EQUALVERIFY),
    pushData(hexToBytes(p.sellerPubkey)),
    Uint8Array.of(OP.OP_CHECKSIG),
    Uint8Array.of(OP.OP_ELSE),
    pushNumber(p.refundTime),
    Uint8Array.of(OP.OP_CHECKLOCKTIMEVERIFY, OP.OP_DROP),
    Uint8Array.of(OP.OP_INPUTINDEX, OP.OP_OUTPUTBYTECODE),
    pushData(hexToBytes(p.buyerLockingHex)),
    Uint8Array.of(OP.OP_EQUALVERIFY),
    Uint8Array.of(OP.OP_INPUTINDEX, OP.OP_OUTPUTVALUE, OP.OP_INPUTINDEX, OP.OP_UTXOVALUE),
    pushNumber(FEE_SATS),
    Uint8Array.of(OP.OP_SUB, OP.OP_GREATERTHANOREQUAL),
    Uint8Array.of(OP.OP_ENDIF),
  );
}

/** Reads the parameters back from a redeem script; null unless it is exactly our contract. */
export function parseRedeem(redeem: Uint8Array): LockParams | null {
  // the fixed shape: walk the pushes we expect, then rebuild and compare byte for byte
  const take = (i: number): { data: Uint8Array; next: number } | null => {
    const op = redeem[i];
    if (op === undefined) return null;
    if (op >= 1 && op <= 75) return i + 1 + op <= redeem.length ? { data: redeem.slice(i + 1, i + 1 + op), next: i + 1 + op } : null;
    if (op >= 0x51 && op <= 0x60) return { data: Uint8Array.of(op - 0x50), next: i + 1 };
    return null;
  };
  try {
    let i = 0;
    const c = take(i);
    if (!c || c.data.length !== 32) return null;
    i = c.next + 3; // OP_DROP OP_IF OP_SHA256
    const k = take(i);
    if (!k || k.data.length !== 32) return null;
    i = k.next + 1; // OP_EQUALVERIFY
    const pk = take(i);
    if (!pk || pk.data.length !== 33) return null;
    i = pk.next + 2; // OP_CHECKSIG OP_ELSE
    const h = take(i);
    if (!h) return null;
    i = h.next + 4; // OP_CHECKLOCKTIMEVERIFY OP_DROP OP_INPUTINDEX OP_OUTPUTBYTECODE
    const b = take(i);
    if (!b) return null;
    const p: LockParams = {
      cipherSha256: bytesToHex(c.data),
      keyHash: bytesToHex(k.data),
      sellerPubkey: bytesToHex(pk.data),
      buyerLockingHex: bytesToHex(b.data),
      refundTime: Number(decodeScriptNum(h.data)),
    };
    return bytesToHex(redeemScript(p)) === bytesToHex(redeem) ? p : null;
  } catch {
    return null;
  }
}

/** P2SH32 locking bytecode: OP_HASH256 <hash256(redeem)> OP_EQUAL. */
export function p2sh32Locking(redeem: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(OP.OP_HASH256, 32), hash256(redeem), Uint8Array.of(OP.OP_EQUAL));
}

export function contractLocking(p: LockParams): Uint8Array {
  return p2sh32Locking(redeemScript(p));
}

/** Fulcrum's name for a locking bytecode: sha256, byte-reversed, hex. */
export function scripthashOf(locking: Uint8Array): string {
  return bytesToHex(reversed(sha256(locking)));
}

/** Network dust limit for an output with this locking bytecode (3 × (output size + 148) at 1 sat/byte). */
export function dustFor(locking: Uint8Array): bigint {
  return 3n * BigInt(8 + varint(locking.length).length + locking.length + 148);
}

export function claimUnlocking(sig: Uint8Array, key: Uint8Array, redeem: Uint8Array): Uint8Array {
  return concatBytes(pushData(sig), pushData(key), Uint8Array.of(OP.OP_1), pushData(redeem));
}

export function refundUnlocking(redeem: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(OP.OP_0), pushData(redeem));
}

// ---------- the payment note (JC2) ----------

/** Text prefix of the note of a payment into contracts. */
export const NOTE_PREFIX_2 = 'JC2';
export const MAX_OP_RETURN_BYTES = 223;

/**
 * One ASCII push: "JC2 <order id, 32 hex> <refund time, unix seconds> <buyer locking bytecode hex> <first 16 bytes of
 * each accepted offer hash, 32 hex each>". With it, a specialist (or anyone) can rebuild every contract of the order
 * from the chain.
 */
export function noteText2(orderIdHex: string, refundTime: number, buyerLockingHex: string, offerHashesHex: string[]): string {
  if (!/^[0-9a-f]{32}$/.test(orderIdHex)) throw new Error('order id must be 16 bytes hex');
  if (!isRefundTime(refundTime)) throw new Error('refund time must be unix seconds');
  if (!/^([0-9a-f]{2}){1,40}$/.test(buyerLockingHex)) throw new Error('buyer locking bytecode must be 1..40 bytes hex');
  for (const h of offerHashesHex) if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('offer hash must be 32 bytes hex');
  return [NOTE_PREFIX_2, orderIdHex, String(refundTime), buyerLockingHex, ...offerHashesHex.map((h) => h.slice(0, 32))].join(' ');
}

export function opReturnBytecode2(text: string): Uint8Array {
  const data = utf8ToBytes(text);
  let head: number[];
  if (data.length <= 75) head = [0x6a, data.length];
  else if (data.length <= 255) head = [0x6a, OP.OP_PUSHDATA1, data.length];
  else throw new Error('note too long');
  const script = concatBytes(Uint8Array.from(head), data);
  if (script.length > MAX_OP_RETURN_BYTES) throw new Error(`note is ${script.length} bytes, limit ${MAX_OP_RETURN_BYTES}`);
  return script;
}

export type Note2 = { orderIdHex: string; refundTime: number; buyerLockingHex: string; offerPrefixes: string[] };

export function parseNote2(locking: Uint8Array): Note2 | null {
  if (locking[0] !== 0x6a) return null;
  const items = readPushes(locking.slice(1));
  if (!items || items.length !== 1) return null;
  const parts = new TextDecoder().decode(items[0]).split(' ');
  if (parts[0] !== NOTE_PREFIX_2) return null;
  const [, order, time, buyer, ...offers] = parts;
  if (!order || !/^[0-9a-f]{32}$/.test(order)) return null;
  if (!time || !/^[1-9][0-9]{8,9}$/.test(time) || !isRefundTime(Number(time))) return null;
  if (!buyer || !/^([0-9a-f]{2}){1,40}$/.test(buyer)) return null;
  if (offers.some((p) => !/^[0-9a-f]{32}$/.test(p))) return null;
  return { orderIdHex: order, refundTime: Number(time), buyerLockingHex: buyer, offerPrefixes: offers };
}

// ---------- transactions ----------

export type TxIn = { txid: string; vout: number; unlocking: Uint8Array; sequence: number };
export type TxOut = { value: bigint; locking: Uint8Array };
export type Tx = { version: number; inputs: TxIn[]; outputs: TxOut[]; locktime: number };

function encodeOutput(o: TxOut): Uint8Array {
  return concatBytes(u64le(o.value), varint(o.locking.length), o.locking);
}

export function encodeTx(tx: Tx): Uint8Array {
  return concatBytes(
    u32le(tx.version),
    varint(tx.inputs.length),
    ...tx.inputs.map((i) => concatBytes(reversed(hexToBytes(i.txid)), u32le(i.vout), varint(i.unlocking.length), i.unlocking, u32le(i.sequence))),
    varint(tx.outputs.length),
    ...tx.outputs.map(encodeOutput),
    u32le(tx.locktime),
  );
}

export function decodeTx(raw: Uint8Array): Tx {
  let i = 0;
  const take = (n: number) => {
    if (i + n > raw.length) throw new Error('transaction ends early');
    const s = raw.slice(i, i + n);
    i += n;
    return s;
  };
  const u32 = () => new DataView(take(4).buffer).getUint32(0, true);
  const vi = () => {
    const f = take(1)[0]!;
    if (f < 0xfd) return f;
    if (f === 0xfd) return new DataView(take(2).buffer).getUint16(0, true);
    if (f === 0xfe) return u32();
    throw new Error('varint too large');
  };
  const version = u32();
  const inputs: TxIn[] = [];
  for (let n = vi(), k = 0; k < n; k++) {
    const txid = bytesToHex(reversed(take(32)));
    const vout = u32();
    const unlocking = take(vi());
    inputs.push({ txid, vout, unlocking, sequence: u32() });
  }
  const outputs: TxOut[] = [];
  for (let n = vi(), k = 0; k < n; k++) {
    const value = new DataView(take(8).buffer).getBigUint64(0, true);
    outputs.push({ value, locking: take(vi()) });
  }
  const locktime = u32();
  if (i !== raw.length) throw new Error('bytes left after the transaction');
  return { version, inputs, outputs, locktime };
}

export function txidOf(raw: Uint8Array): string {
  return bytesToHex(reversed(hash256(raw)));
}

/** SIGHASH_ALL | SIGHASH_FORKID */
export const SIGHASH_ALL_FORKID = 0x41;

/** BCH signing serialization (BIP143 with the fork id) for one input; the coin carries no tokens. */
export function sighashPreimage(tx: Tx, inputIndex: number, coveredBytecode: Uint8Array, value: bigint, type = SIGHASH_ALL_FORKID): Uint8Array {
  const input = tx.inputs[inputIndex];
  if (!input) throw new Error('no such input');
  const prevouts = concatBytes(...tx.inputs.map((x) => concatBytes(reversed(hexToBytes(x.txid)), u32le(x.vout))));
  const sequences = concatBytes(...tx.inputs.map((x) => u32le(x.sequence)));
  const outputs = concatBytes(...tx.outputs.map(encodeOutput));
  return concatBytes(
    u32le(tx.version),
    hash256(prevouts),
    hash256(sequences),
    reversed(hexToBytes(input.txid)),
    u32le(input.vout),
    varint(coveredBytecode.length),
    coveredBytecode,
    u64le(value),
    u32le(input.sequence),
    hash256(outputs),
    u32le(tx.locktime),
    u32le(type),
  );
}

/** ECDSA (DER, low S, deterministic) over the input's signing serialization, with the sighash byte appended. */
export function signInput(tx: Tx, inputIndex: number, coveredBytecode: Uint8Array, value: bigint, privateKey: Uint8Array): Uint8Array {
  const digest = hash256(sighashPreimage(tx, inputIndex, coveredBytecode, value));
  const der = secp256k1.sign(digest, privateKey, { prehash: false, lowS: true, format: 'der' });
  return concatBytes(der, Uint8Array.of(SIGHASH_ALL_FORKID));
}

export function publicKeyOf(privateKey: Uint8Array): string {
  return bytesToHex(secp256k1.getPublicKey(privateKey, true));
}

export type BuiltTx = { hex: string; txid: string; fee: bigint; size: number; tx: Tx };

/**
 * The specialist's claim: spends one contract output, reveals K, pays `payToLocking` the value minus the fee.
 * Deterministic (RFC 6979 signature, fixed fee rule): asking twice gives the same transaction, so a repeated
 * broadcast is "already known", never a second claim.
 */
export function buildClaim(a: {
  fundingTxid: string;
  vout: number;
  value: bigint;
  params: LockParams;
  key: Uint8Array;
  privateKey: Uint8Array;
  payToLocking: Uint8Array;
  feePerByte?: bigint;
}): BuiltTx {
  const redeem = redeemScript(a.params);
  if (sha256Hex(a.key) !== a.params.keyHash) throw new Error('this key does not open the lock');
  if (publicKeyOf(a.privateKey) !== a.params.sellerPubkey) throw new Error('this private key is not the contract\'s specialist key');
  const feeRate = a.feePerByte ?? FEE_PER_BYTE;
  const tx: Tx = {
    version: 2,
    inputs: [{ txid: a.fundingTxid, vout: a.vout, unlocking: new Uint8Array(), sequence: 0xffffffff }],
    outputs: [{ value: 0n, locking: a.payToLocking }],
    locktime: 0,
  };
  // size with the longest signature (72-byte DER + sighash byte), so the fee never falls below the rate
  tx.inputs[0]!.unlocking = claimUnlocking(new Uint8Array(73), a.key, redeem);
  const size = encodeTx(tx).length;
  const fee = BigInt(size) * feeRate;
  const pay = a.value - fee;
  if (pay < dustFor(a.payToLocking)) throw new Error(`claim would pay ${pay} sat, below dust`);
  tx.outputs[0]!.value = pay;
  tx.inputs[0]!.unlocking = new Uint8Array();
  const sig = signInput(tx, 0, redeem, a.value, a.privateKey);
  tx.inputs[0]!.unlocking = claimUnlocking(sig, a.key, redeem);
  const raw = encodeTx(tx);
  return { hex: bytesToHex(raw), txid: txidOf(raw), fee: a.value - pay, size: raw.length, tx };
}

export type ContractCoin = { txid: string; vout: number; value: bigint; params: LockParams };

/**
 * The refund: no signature at all. Input i spends contract i, output i pays that contract's buyer its value minus its
 * share of the fee (never more than FEE_SATS). The network takes it once the chain's median time past is past the
 * latest refundTime among them.
 */
export function buildRefund(a: { contracts: ContractCoin[]; feePerByte?: bigint }): BuiltTx {
  if (a.contracts.length === 0) throw new Error('nothing to refund');
  const feeRate = a.feePerByte ?? FEE_PER_BYTE;
  const tx: Tx = {
    version: 2,
    // CHECKLOCKTIMEVERIFY needs a sequence below 0xffffffff
    inputs: a.contracts.map((c) => ({ txid: c.txid, vout: c.vout, unlocking: refundUnlocking(redeemScript(c.params)), sequence: 0xfffffffe })),
    outputs: a.contracts.map((c) => ({ value: c.value, locking: hexToBytes(c.params.buyerLockingHex) })),
    locktime: Math.max(...a.contracts.map((c) => c.params.refundTime)),
  };
  const size = encodeTx(tx).length;
  const fee = BigInt(size) * feeRate;
  const n = BigInt(a.contracts.length);
  const share = (fee + n - 1n) / n;
  if (share > FEE_SATS) throw new Error(`refund fee ${share} sat per contract is above the contract's ${FEE_SATS} sat`);
  a.contracts.forEach((c, i) => {
    const v = c.value - share;
    if (v < dustFor(tx.outputs[i]!.locking)) throw new Error(`refund of ${c.txid}:${c.vout} would be below dust`);
    tx.outputs[i]!.value = v;
  });
  const raw = encodeTx(tx);
  return { hex: bytesToHex(raw), txid: txidOf(raw), fee: share * n, size: raw.length, tx };
}

export type Spend =
  | { kind: 'claim'; key: Uint8Array; params: LockParams; inputIndex: number }
  | { kind: 'refund'; params: LockParams; inputIndex: number };

/**
 * How a transaction spends the contract output txid:vout, read from its input: a claim (with the revealed key,
 * checked against the contract's keyHash) or a refund. Null if the transaction does not spend that output our way.
 */
export function readSpend(raw: Uint8Array, outpoint: { txid: string; vout: number }): Spend | null {
  const tx = decodeTx(raw);
  const inputIndex = tx.inputs.findIndex((i) => i.txid === outpoint.txid && i.vout === outpoint.vout);
  if (inputIndex < 0) return null;
  const items = readPushes(tx.inputs[inputIndex]!.unlocking);
  if (!items || items.length < 2) return null;
  const params = parseRedeem(items[items.length - 1]!);
  if (!params) return null;
  if (items.length === 4 && items[2]!.length === 1 && items[2]![0] === 1) {
    const key = items[1]!;
    if (key.length !== 32 || sha256Hex(key) !== params.keyHash) return null;
    return { kind: 'claim', key, params, inputIndex };
  }
  if (items.length === 2 && items[0]!.length === 0) return { kind: 'refund', params, inputIndex };
  return null;
}

/** May the specialist reveal its key now? Only with CLAIM_MARGIN_SECONDS of median time to spare before a refund opens. */
export function canClaimSafely(medianTimePast: number, refundTime: number): boolean {
  return medianTimePast + CLAIM_MARGIN_SECONDS < refundTime;
}

/** Will the network take a refund now? A time locktime is final once it is below the tip's median time past. */
export function canRefund(medianTimePast: number, refundTime: number): boolean {
  return medianTimePast > refundTime;
}

/** Median time past from the chain's last 11 block headers (80 bytes each, hex, oldest first), as the network computes it. */
export function medianTimePast(headersHex: string): number {
  if (headersHex.length % 160 !== 0 || headersHex.length === 0) throw new Error('headers must be whole 80-byte headers');
  const times: number[] = [];
  for (let i = 0; i < headersHex.length; i += 160) {
    const b = hexToBytes(headersHex.slice(i, i + 160));
    times.push(new DataView(b.buffer).getUint32(68, true));
  }
  const last = times.slice(-11).sort((x, y) => x - y);
  return last[Math.floor(last.length / 2)]!;
}

/** What a page or a refunder knows about an offer: its fingerprint and lock (from the signed v2 offer). */
export type OfferLock = { offerHashHex: string; lock: Pick<LockParams, 'cipherSha256' | 'keyHash' | 'sellerPubkey'> };

export type FoundContract = { offerHashHex: string; vout: number; value: bigint; params: LockParams; lockingHex: string };

/**
 * Rebuilds, from a payment alone, the contract of every listed offer that the payment really funds: the JC2 note gives
 * the order, the refund time and the buyer; each offer gives its lock. Works on any device, from the chain only.
 */
export function contractsInPayment(raw: Uint8Array, offers: OfferLock[]): { orderIdHex: string; refundTime: number; buyerLockingHex: string; contracts: FoundContract[] } | null {
  const tx = decodeTx(raw);
  const notes = tx.outputs.map((o) => parseNote2(o.locking)).filter((n) => n !== null);
  if (notes.length !== 1) return null;
  const note = notes[0]!;
  const contracts: FoundContract[] = [];
  for (const o of offers) {
    if (!note.offerPrefixes.includes(o.offerHashHex.slice(0, 32))) continue;
    const params: LockParams = { ...o.lock, buyerLockingHex: note.buyerLockingHex, refundTime: note.refundTime };
    const lockingHex = bytesToHex(contractLocking(params));
    tx.outputs.forEach((out, vout) => {
      if (bytesToHex(out.locking) === lockingHex) contracts.push({ offerHashHex: o.offerHashHex, vout, value: out.value, params, lockingHex });
    });
  }
  return { orderIdHex: note.orderIdHex, refundTime: note.refundTime, buyerLockingHex: note.buyerLockingHex, contracts };
}
