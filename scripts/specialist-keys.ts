// Makes a new open specialist's keys, from this machine's random generator:
//   <dir>/.dev.vars   0600  JC_FILE_KEY_SEED (your file keys come from it) and JC_CLAIM_KEYS (signs your claims):
//                           what your claim server needs — `wrangler dev` reads this file, `wrangler secret put` uploads it
//   <dir>/.env.offer  0600  JC_OFFER_KEY: signs your offers; never put it on a server
//   <dir>/.env.payout 0600  only with --new-payout-address: a fresh address to be paid on, if you have no wallet at hand
// Prints only public keys and addresses. Refuses to overwrite: losing these files means losing your claims.
//   node scripts/run.mjs scripts/specialist-keys.ts --specialist specialists/<you> [--new-payout-address]
import { existsSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { binToHex, encodeCashAddress, encodePrivateKeyWif, hash160, secp256k1 } from '@bitauth/libauth';
import { specialistDir } from './specialist-lib';

const pub = (k: Uint8Array) => binToHex(secp256k1.derivePublicKeyCompressed(k) as Uint8Array);

/** A valid secp256k1 private key from the system's random generator. */
export function newKey(): Uint8Array {
  for (;;) {
    const k = crypto.getRandomValues(new Uint8Array(32));
    if (secp256k1.validatePrivateKey(k)) return k;
  }
}

export type MadeKeys = { offerPubkey: string; claimPubkey: string; payout?: { mainnet: string; chipnet: string } };

function writeSecret(path: string, text: string): void {
  writeFileSync(path, text, { mode: 0o600, flag: 'wx' }); // wx: never over an existing file
  chmodSync(path, 0o600);
}

export function makeKeys(dir: string, withPayout = false): MadeKeys {
  const files = [join(dir, '.dev.vars'), join(dir, '.env.offer'), ...(withPayout ? [join(dir, '.env.payout')] : [])];
  for (const f of files) if (existsSync(f)) throw new Error(`${f} already exists: keys are made once (move it away yourself if you really mean to start over)`);
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const claim = newKey();
  const offer = newKey();
  const claimPubkey = pub(claim);
  writeSecret(files[0]!, `JC_FILE_KEY_SEED=${binToHex(seed)}\nJC_CLAIM_KEYS=${JSON.stringify({ [claimPubkey]: binToHex(claim) })}\n`);
  writeSecret(files[1]!, `JC_OFFER_KEY=${binToHex(offer)}\n`);
  const made: MadeKeys = { offerPubkey: pub(offer), claimPubkey };
  if (withPayout) {
    const k = newKey();
    const payload = hash160(secp256k1.derivePublicKeyCompressed(k) as Uint8Array);
    writeSecret(files[2]!, `JC_PAYOUT_WIF_MAINNET=${encodePrivateKeyWif(k, 'mainnet')}\nJC_PAYOUT_WIF_CHIPNET=${encodePrivateKeyWif(k, 'testnet')}\n`);
    made.payout = {
      mainnet: encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload }).address,
      chipnet: encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload }).address,
    };
  }
  return made;
}

if (process.argv[1]?.includes('specialist-keys')) {
  const dir = specialistDir();
  if (!dir) throw new Error('--specialist <your folder, e.g. specialists/ada>');
  const m = makeKeys(dir, process.argv.includes('--new-payout-address'));
  console.log(`keys made in ${dir} (.dev.vars, .env.offer${m.payout ? ', .env.payout' : ''}; mode 600, ignored by git)`);
  console.log(`offer public key  ${m.offerPubkey}`);
  console.log(`claim public key  ${m.claimPubkey}`);
  if (m.payout) console.log(`payout address    ${m.payout.mainnet}\n                  ${m.payout.chipnet}  (put these in specialist.json "payTo")`);
}
