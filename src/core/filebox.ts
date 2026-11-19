// A specialist's full file, sealed before payment and opened with the key the specialist reveals on chain.
//
// Sealed file = "JCE1" | iv (12 bytes) | AES-256-GCM(K, iv, file) with its 16-byte tag. K is the 32-byte file key whose
// sha256 (keyHash) sits in the signed offer and in the payment's contract. The iv comes from K, so sealing is
// reproducible: the same key and file always give the same sealed bytes, and their fingerprint can be signed once.
// A wrong key fails the GCM tag, so a file never "opens" into garbage.
//
// WebCrypto for AES (browser, Node ≥ 20, Workers); noble for the hashes.
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const SEAL_MAGIC = 'JCE1';
const MAGIC = utf8ToBytes(SEAL_MAGIC);
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Copies into a fresh ArrayBuffer-backed array, the shape WebCrypto's typings want. */
const own = (b: Uint8Array): Uint8Array<ArrayBuffer> => {
  const c = new Uint8Array(new ArrayBuffer(b.length));
  c.set(b);
  return c;
};

function ivFor(key: Uint8Array): Uint8Array {
  return sha256(concatBytes(utf8ToBytes('JCE1 iv'), key)).slice(0, IV_BYTES);
}

async function aesKey(key: Uint8Array, use: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  if (key.length !== 32) throw new Error('the file key must be 32 bytes');
  return crypto.subtle.importKey('raw', own(key), { name: 'AES-GCM' }, false, [use]);
}

export async function sealFile(key: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  const iv = ivFor(key);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: own(iv), tagLength: TAG_BYTES * 8 }, await aesKey(key, 'encrypt'), own(plain)));
  return concatBytes(MAGIC, iv, ct);
}

/** Opens a sealed file; throws if the key does not open it (wrong key, or the sealed bytes were changed). */
export async function openFile(key: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < MAGIC.length + IV_BYTES + TAG_BYTES) throw new Error('not a sealed file: too short');
  for (let i = 0; i < MAGIC.length; i++) if (sealed[i] !== MAGIC[i]) throw new Error('not a sealed file: wrong header');
  const iv = sealed.slice(MAGIC.length, MAGIC.length + IV_BYTES);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: own(iv), tagLength: TAG_BYTES * 8 }, await aesKey(key, 'decrypt'), own(sealed.slice(MAGIC.length + IV_BYTES)));
    return new Uint8Array(plain);
  } catch {
    throw new Error('the key does not open this file');
  }
}

/** sha256 of the key, hex: the "lock" that the offer and the contract carry. */
export function keyHashHex(key: Uint8Array): string {
  return bytesToHex(sha256(key));
}

/**
 * The demo specialists' file key: HMAC-SHA256(seed, "JC2 file key|<net>|<sha256 of the plain file>").
 * One secret seed per specialist server; a different key per network, so a chipnet claim never reveals a mainnet key.
 */
export function deriveFileKey(seed: Uint8Array, net: string, fileSha256Hex: string): Uint8Array {
  if (seed.length < 32) throw new Error('the seed must be at least 32 bytes');
  if (!/^[0-9a-f]{64}$/.test(fileSha256Hex)) throw new Error('file fingerprint must be 32 bytes hex');
  return hmac(sha256, seed, utf8ToBytes(`JC2 file key|${net}|${fileSha256Hex}`));
}
