// A specialist's signed offer: order id, price, fingerprint of the full file, deadline, payout address.
// Signed with the specialist's key (Schnorr over sha256 of the canonical text). Anyone can check it.
import { binToHex, hexToBin, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';

/** An offer made for any order: the order id and the offer fingerprint are tied together on chain by the OP_RETURN note. */
export const ANY_ORDER = '*';

export type Offer = {
  v: 1;
  orderId: string; // 16 bytes hex, or ANY_ORDER for a standing offer
  /** What the specialist promises about the full file, checked again after download (e.g. "4096x2560;4488737", "srt;9;18.375"). */
  facts: string;
  specialist: string; // e.g. "Lena (demo specialist)"
  part: 'cover' | 'subtitles' | 'logo';
  priceCents: number;
  priceSats: string; // decimal string, satoshis
  fileSha256: string; // 32 bytes hex of the full file
  expires: number; // unix seconds
  payTo: string; // cash address
  pubkey: string; // 33 bytes hex, compressed
};

export type SignedOffer = { offer: Offer; sig: string };

/** Fixed field order, so the same offer always gives the same bytes. */
export function canonical(o: Offer): string {
  return JSON.stringify([o.v, o.orderId, o.facts, o.specialist, o.part, o.priceCents, o.priceSats, o.fileSha256, o.expires, o.payTo, o.pubkey]);
}

export function offerHash(o: Offer): Uint8Array {
  return sha256.hash(utf8ToBin(canonical(o)));
}

export function offerHashHex(o: Offer): string {
  return binToHex(offerHash(o));
}

export function signOffer(o: Offer, privateKey: Uint8Array): SignedOffer {
  const sig = secp256k1.signMessageHashSchnorr(privateKey, offerHash(o));
  if (typeof sig === 'string') throw new Error(sig);
  return { offer: o, sig: binToHex(sig) };
}

export type OfferCheck = { ok: true } | { ok: false; reason: string };

export function verifyOffer(s: SignedOffer, expect: { orderId: string; nowSec: number; pubkey?: string }): OfferCheck {
  const o = s.offer;
  if (o.v !== 1) return { ok: false, reason: 'unknown offer version' };
  if (o.orderId !== expect.orderId && o.orderId !== ANY_ORDER) return { ok: false, reason: 'offer is for another order' };
  if (expect.pubkey && o.pubkey !== expect.pubkey) return { ok: false, reason: 'offer signed by another key' };
  if (o.expires < expect.nowSec) return { ok: false, reason: 'offer expired' };
  if (!/^[0-9a-f]{64}$/.test(o.fileSha256)) return { ok: false, reason: 'bad file fingerprint' };
  if (!/^\d+$/.test(o.priceSats)) return { ok: false, reason: 'bad price' };
  let good = false;
  try {
    good = secp256k1.verifySignatureSchnorr(hexToBin(s.sig), hexToBin(o.pubkey), offerHash(o));
  } catch {
    good = false;
  }
  return good ? { ok: true } : { ok: false, reason: 'signature does not match' };
}

export function fileSha256Hex(bytes: Uint8Array): string {
  return binToHex(sha256.hash(bytes));
}

// ---------- v2: offers whose full file is sealed, paid through a hash-lock contract (src/core/htlc.ts) ----------

/**
 * A v2 offer adds two fingerprints to v1: the sealed (encrypted) full file, and the lock of its key (sha256 of K).
 * The buyer pays into a contract that only the specialist can open, and only by putting K on chain.
 */
export type Offer2 = Omit<Offer, 'v'> & {
  v: 2;
  /** sha256 of the sealed full file (src/core/filebox.ts), 32 bytes hex */
  cipherSha256: string;
  /** sha256 of the file key K, 32 bytes hex */
  keyHash: string;
};

export type SignedOffer2 = { offer: Offer2; sig: string };

export function canonical2(o: Offer2): string {
  return JSON.stringify([o.v, o.orderId, o.facts, o.specialist, o.part, o.priceCents, o.priceSats, o.fileSha256, o.cipherSha256, o.keyHash, o.expires, o.payTo, o.pubkey]);
}

export function offerHash2(o: Offer2): Uint8Array {
  return sha256.hash(utf8ToBin(canonical2(o)));
}

export function offerHash2Hex(o: Offer2): string {
  return binToHex(offerHash2(o));
}

export function signOffer2(o: Offer2, privateKey: Uint8Array): SignedOffer2 {
  const sig = secp256k1.signMessageHashSchnorr(privateKey, offerHash2(o));
  if (typeof sig === 'string') throw new Error(sig);
  return { offer: o, sig: binToHex(sig) };
}

export function verifyOffer2(s: SignedOffer2, expect: { orderId: string; nowSec: number; pubkey?: string }): OfferCheck {
  const o = s.offer;
  if (o.v !== 2) return { ok: false, reason: 'unknown offer version' };
  if (o.orderId !== expect.orderId && o.orderId !== ANY_ORDER) return { ok: false, reason: 'offer is for another order' };
  if (expect.pubkey && o.pubkey !== expect.pubkey) return { ok: false, reason: 'offer signed by another key' };
  if (o.expires < expect.nowSec) return { ok: false, reason: 'offer expired' };
  if (!/^[0-9a-f]{64}$/.test(o.fileSha256)) return { ok: false, reason: 'bad file fingerprint' };
  if (!/^[0-9a-f]{64}$/.test(o.cipherSha256)) return { ok: false, reason: 'bad sealed file fingerprint' };
  if (!/^[0-9a-f]{64}$/.test(o.keyHash)) return { ok: false, reason: 'bad key lock' };
  if (!/^0[23][0-9a-f]{64}$/.test(o.pubkey)) return { ok: false, reason: 'bad public key' };
  if (!/^\d+$/.test(o.priceSats)) return { ok: false, reason: 'bad price' };
  let good = false;
  try {
    good = secp256k1.verifySignatureSchnorr(hexToBin(s.sig), hexToBin(o.pubkey), offerHash2(o));
  } catch {
    good = false;
  }
  return good ? { ok: true } : { ok: false, reason: 'signature does not match' };
}
