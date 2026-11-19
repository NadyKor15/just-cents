// A demo specialist's side of a v2 order: "I see my contract on chain → I reveal my file key in a claim and take the money."
// POST /claim/<offer>?net=…&txid=<payment> reads the payment from a public Fulcrum server, rebuilds this offer's
// contract from the payment's JC2 note, checks the amount and the time left before a refund (the chain's median time
// past against the contract's refund time), and broadcasts the claim.
// The answer names the claim transaction; the buyer's page reads the key from the chain, not from this answer.
// The specialist's file keys (from a seed) and claim keys are secrets of this server (environment), never in the code.
// The keys that sign offers are not here: a v2 offer names a separate claim key (src/core/offer.ts).
// No libauth here (Workers refuse its WASM): src/core/htlc.ts and src/core/filebox.ts are WASM-free.
import offers from '../src/data/offers.json';
import { buildClaim, canClaimSafely, contractLocking, decodeTx, FEE_SATS, hex, medianTimePast, parseNote2, txidOf, unhex, type LockParams } from '../src/core/htlc';
import { deriveFileKey, keyHashHex } from '../src/core/filebox';
import { rpc, type Net } from './fulcrum';
import { json } from './http';

/** What the specialist needs to know about one of its v2 offers (all public, precomputed in the offer book). */
export type ClaimEntry = {
  offerHashHex: string;
  priceSats: string;
  payToLockingHex: string;
  /** the offer's claim key: the contract's specialist key (not the key that signs offers) */
  claimPubkey: string;
  keyHash: string;
  cipherSha256: string;
  fileSha256: string;
};

/** The specialist's secrets: the seed its file keys come from, and the private key of each claim public key. */
export type ClaimKeys = { seed: Uint8Array; privateKeys: Record<string, Uint8Array> };

export type ClaimPlan =
  | { ok: true; paymentTxid: string; vout: number; value: bigint; params: LockParams; hex: string; txid: string; fee: bigint }
  | { ok: false; status: number; reason: string };

/** Pure: everything the endpoint decides, given the payment, the offer, the keys and the chain's median time past. */
export function planClaim(paymentHex: string, e: ClaimEntry, net: Net, keys: ClaimKeys, mtp: number): ClaimPlan {
  let raw: Uint8Array;
  let tx: ReturnType<typeof decodeTx>;
  try {
    raw = unhex(paymentHex);
    tx = decodeTx(raw);
  } catch (err) {
    return { ok: false, status: 400, reason: `cannot read transaction: ${err instanceof Error ? err.message : err}` };
  }
  const notes = tx.outputs.map((o) => parseNote2(o.locking)).filter((n) => n !== null);
  if (notes.length !== 1) return { ok: false, status: 402, reason: notes.length ? 'more than one Just Cents note' : 'no Just Cents contract note (JC2) in this transaction' };
  const note = notes[0]!;
  if (!note.offerPrefixes.includes(e.offerHashHex.slice(0, 32))) return { ok: false, status: 402, reason: 'this offer is not in the note' };
  const params: LockParams = {
    cipherSha256: e.cipherSha256,
    keyHash: e.keyHash,
    sellerPubkey: e.claimPubkey,
    buyerLockingHex: note.buyerLockingHex,
    refundTime: note.refundTime,
  };
  let lockingHex: string;
  try {
    lockingHex = hex(contractLocking(params));
  } catch (err) {
    return { ok: false, status: 402, reason: `the note does not describe a valid contract: ${err instanceof Error ? err.message : err}` };
  }
  const outs = tx.outputs.map((o, i) => (hex(o.locking) === lockingHex ? i : -1)).filter((i) => i >= 0);
  if (outs.length === 0) return { ok: false, status: 402, reason: 'no contract for this offer in the transaction' };
  if (outs.length > 1) return { ok: false, status: 409, reason: 'more than one contract for this offer in the transaction' };
  const vout = outs[0]!;
  const value = tx.outputs[vout]!.value;
  const want = BigInt(e.priceSats) + FEE_SATS;
  if (value < want) return { ok: false, status: 402, reason: `the contract holds ${value} sat, the offer asks ${e.priceSats} sat plus ${FEE_SATS} sat for the network` };
  if (!canClaimSafely(mtp, note.refundTime)) return { ok: false, status: 409, reason: `too late: the refund opens at ${new Date(note.refundTime * 1000).toISOString()} (chain time ${new Date(mtp * 1000).toISOString()}); the key stays secret` };
  const key = deriveFileKey(keys.seed, net, e.fileSha256);
  if (keyHashHex(key) !== e.keyHash) return { ok: false, status: 500, reason: 'this server does not hold the key of this offer' };
  const privateKey = keys.privateKeys[e.claimPubkey];
  if (!privateKey) return { ok: false, status: 500, reason: 'this server does not hold the claim key of this offer' };
  const paymentTxid = txidOf(raw);
  try {
    const c = buildClaim({ fundingTxid: paymentTxid, vout, value, params, key, privateKey, payToLocking: unhex(e.payToLockingHex) });
    return { ok: true, paymentTxid, vout, value, params, hex: c.hex, txid: c.txid, fee: c.fee };
  } catch (err) {
    return { ok: false, status: 500, reason: `could not build the claim: ${err instanceof Error ? err.message : err}` };
  }
}

type V2Entry = { offerHashHex: string; payToLockingHex: string; signed: { offer: { priceSats: string; claimPubkey: string; keyHash: string; cipherSha256: string; fileSha256: string } } };
type BookRow = { v2?: V2Entry };
const BOOK = offers as unknown as Record<Net, Record<string, BookRow>>;

/** The v2 offers of the book, as the claim needs them; offers without a v2 form are not claimable. */
export function claimBook(net: Net, book: Record<Net, Record<string, BookRow>> = BOOK): Record<string, ClaimEntry> {
  const out: Record<string, ClaimEntry> = {};
  for (const [k, row] of Object.entries(book[net] ?? {})) {
    if (k.startsWith('_') || !row?.v2) continue;
    const o = row.v2.signed.offer;
    out[k] = { offerHashHex: row.v2.offerHashHex, priceSats: o.priceSats, payToLockingHex: row.v2.payToLockingHex, claimPubkey: o.claimPubkey, keyHash: o.keyHash, cipherSha256: o.cipherSha256, fileSha256: o.fileSha256 };
  }
  return out;
}

export interface ClaimEnv {
  /** hex, at least 32 bytes: the seed of the demo specialists' file keys */
  JC_FILE_KEY_SEED?: string;
  /** JSON {"<claim public key hex>": "<private key hex>"} */
  JC_CLAIM_KEYS?: string;
}

export function readKeys(env: ClaimEnv): ClaimKeys | null {
  try {
    if (!env.JC_FILE_KEY_SEED || !/^([0-9a-f]{2}){32,}$/i.test(env.JC_FILE_KEY_SEED)) return null;
    const map = JSON.parse(env.JC_CLAIM_KEYS ?? '') as Record<string, string>;
    const privateKeys: Record<string, Uint8Array> = {};
    for (const [pub, priv] of Object.entries(map)) {
      if (!/^0[23][0-9a-f]{64}$/.test(pub) || !/^[0-9a-f]{64}$/i.test(priv)) return null;
      privateKeys[pub] = unhex(priv.toLowerCase());
    }
    return { seed: unhex(env.JC_FILE_KEY_SEED.toLowerCase()), privateKeys };
  } catch {
    return null;
  }
}

async function rawTx(net: Net, txid: string): Promise<string> {
  // right after the buyer's broadcast a server may not know the transaction yet
  for (let i = 0; ; i++) {
    try {
      return await rpc<string>(net, 'blockchain.transaction.get', [txid, false]);
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}

const ALREADY = /already|txn-already-known|transaction already in block chain/i;

export async function claim(url: URL, method: string, env: ClaimEnv, book: Record<string, ClaimEntry> | null = null): Promise<Response> {
  if (method !== 'POST') return json({ ok: false, reason: 'POST /claim/<offer>?net=…&txid=…' }, 405);
  const key = decodeURIComponent(url.pathname.slice('/claim/'.length));
  const net = url.searchParams.get('net') as Net | null;
  const txid = url.searchParams.get('txid') ?? '';
  if (net !== 'mainnet' && net !== 'chipnet') return json({ ok: false, reason: 'net must be mainnet or chipnet' }, 400);
  if (!/^[0-9a-f]{64}$/.test(txid)) return json({ ok: false, reason: 'txid must be 64 hex characters' }, 400);
  const entry = (book ?? claimBook(net))[key];
  if (!entry) return json({ ok: false, reason: `no claimable offer: ${key}` }, 404);
  const keys = readKeys(env);
  if (!keys) return json({ ok: false, reason: 'the specialist keys are not set up on this server' }, 503);
  let raw: string;
  let mtp: number;
  try {
    raw = await rawTx(net, txid);
    const tip = (await rpc<{ height: number }>(net, 'blockchain.headers.subscribe', [])).height;
    const h = await rpc<{ hex: string; count: number }>(net, 'blockchain.block.headers', [tip - 10, 11]);
    mtp = medianTimePast(h.hex);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/No such mempool|not found/i.test(msg)) return json({ ok: false, reason: 'the network does not know this transaction (yet)' }, 404);
    return json({ ok: false, reason: `could not read the network: ${msg}` }, 502);
  }
  const plan = planClaim(raw, entry, net, keys, mtp);
  if (!plan.ok) return json({ ok: false, reason: plan.reason }, plan.status);
  if (plan.paymentTxid !== txid) return json({ ok: false, reason: 'the network returned another transaction' }, 502);
  try {
    await rpc<string>(net, 'blockchain.transaction.broadcast', [plan.hex]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // the claim is deterministic: the same request builds the same transaction, so "already known" means it is out
    if (!ALREADY.test(msg)) {
      if (/missing|mempool-conflict|spent/i.test(msg)) return json({ ok: false, reason: `the contract is already spent (a refund?): ${msg}` }, 409);
      return json({ ok: false, reason: `the network refused the claim: ${msg}` }, 502);
    }
  }
  return json({ ok: true, claimTxid: plan.txid, payment: { txid, vout: plan.vout, sats: plan.value.toString() }, fee: plan.fee.toString(), refundTime: plan.params.refundTime });
}
