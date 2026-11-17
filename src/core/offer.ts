// A specialist's signed offer: order id, price, fingerprint of the full file, deadline, payout address.
// Signed with the specialist's key (Schnorr over sha256 of the canonical text). Anyone can check it.
import { binToHex, hexToBin, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';

/** An offer made for any order: the order id and the offer fingerprint are tied together on chain by the OP_RETURN note. */
export const ANY_ORDER = '*';

export type Offer = {
  v: 1;
  orderId: string; // 16 bytes hex, or ANY_ORDER for a standing offer
  /** What the specialist promises about the full file, checked again after download (e.g. "1024x1024", "12.34s", "es,fr,de"). */
  facts: string;
  specialist: string; // e.g. "lena"
  part: 'icon' | 'music' | 'voice' | 'model';
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
