// A wallet in this process, for the command-line scripts (refund-demo.ts, test-buy.ts): keys from a BIP39 phrase
// read from a file, coins from the public Fulcrum servers, P2PKH inputs signed here and checked with the BCH 2026 VM
// before anything is sent. The phrase and the keys are never printed or written anywhere.
// The site itself never does this: there a person's own wallet signs over WizardConnect.
import { readFileSync, rmSync, statSync } from 'node:fs';
import {
  binToHex,
  createVirtualMachineBch2026,
  deriveHdPath,
  deriveHdPrivateNodeFromBip39Mnemonic,
  encodeCashAddress,
  encodeLockingBytecodeP2pkh,
  encodeTransaction,
  generateTransaction,
  hash160,
  secp256k1,
  walletTemplateP2pkhNonHd,
  walletTemplateToCompilerBch,
  type Transaction,
} from '@bitauth/libauth';
import { listUnspent, PREFIX, type Net } from '../src/core/chain';
import { txidOf, unhex } from '../src/core/htlc';
import type { SourceOutput, Utxo } from '../src/core/tx';

/** The usual BCH account path (Cashonize, Selene, Electron Cash BIP44). */
export const ACCOUNT_PATH = "m/44'/145'/0'";
/** Addresses looked at on each of the receive and change paths. */
export const DEPTH = 20;

export type WalletAddress = { path: 'receive' | 'change'; index: number; address: string; lockingHex: string };
export type LocalWallet = { net: Net; addresses: WalletAddress[]; keyFor: (lockingHex: string) => Uint8Array };

/**
 * Reads the phrase from a file and, with remove = true, deletes the file at once, before anything else happens.
 * Returns the phrase and the moment the file was removed (ISO), for the run's log.
 */
export function readPhraseFile(path: string, remove: boolean): { phrase: string; removedAt: string | null } {
  const mode = statSync(path).mode & 0o777;
  const text = readFileSync(path, 'utf8').trim();
  let removedAt: string | null = null;
  if (remove) {
    rmSync(path);
    removedAt = new Date().toISOString();
  }
  // a plain phrase, or a JSON record with a "mnemonic" field (as some vault entries keep it)
  let phrase = text;
  if (text.startsWith('{')) {
    const m = (JSON.parse(text) as { mnemonic?: unknown }).mnemonic;
    if (typeof m !== 'string') throw new Error('the JSON phrase file has no "mnemonic" field');
    phrase = m.trim();
  }
  if (mode & 0o077) console.warn(`warning: ${path} was readable by others (mode ${mode.toString(8)}); keep phrase files 0600`);
  const words = phrase.split(/\s+/).length;
  if (words !== 12 && words !== 24) throw new Error(`the phrase file holds ${words} words, not 12 or 24`);
  return { phrase, removedAt };
}

export function walletFromPhrase(phrase: string, net: Net, account = ACCOUNT_PATH, depth = DEPTH): LocalWallet {
  const root = deriveHdPrivateNodeFromBip39Mnemonic(phrase);
  const keys = new Map<string, Uint8Array>();
  const addresses: WalletAddress[] = [];
  for (const [child, path] of [[0, 'receive'], [1, 'change']] as const) {
    for (let index = 0; index < depth; index++) {
      const node = deriveHdPath(root, `${account}/${child}/${index}`);
      if (typeof node === 'string') throw new Error(node);
      const pkh = hash160(secp256k1.derivePublicKeyCompressed(node.privateKey) as Uint8Array);
      const lockingHex = binToHex(encodeLockingBytecodeP2pkh(pkh));
      keys.set(lockingHex, node.privateKey);
      addresses.push({ path, index, address: encodeCashAddress({ prefix: PREFIX[net], type: 'p2pkh', payload: pkh }).address, lockingHex });
    }
  }
  return {
    net,
    addresses,
    keyFor: (lockingHex) => {
      const k = keys.get(lockingHex);
      if (!k) throw new Error('this wallet holds no key for that coin');
      return k;
    },
  };
}

/** Every plain BCH coin on the wallet's addresses (tokens are left alone, as on the site). */
export async function walletCoins(w: LocalWallet): Promise<Utxo[]> {
  const out: Utxo[] = [];
  for (const a of w.addresses) {
    for (const u of await listUnspent(w.net, a.address)) {
      out.push({ txid: u.tx_hash, vout: u.tx_pos, sats: BigInt(u.value), lockingBytecode: unhex(a.lockingHex), path: a.path, index: a.index });
    }
  }
  return out;
}

const compiler = walletTemplateToCompilerBch(walletTemplateP2pkhNonHd);

/** Signs every P2PKH input of an unsigned payment, then makes the BCH 2026 VM check the whole transaction. */
export function signPayment(tx: Transaction, sourceOutputs: SourceOutput[], w: LocalWallet): { hex: string; txid: string; size: number } {
  const result = generateTransaction({
    version: tx.version,
    locktime: tx.locktime,
    inputs: tx.inputs.map((inp, i) => ({
      outpointIndex: inp.outpointIndex,
      outpointTransactionHash: inp.outpointTransactionHash,
      sequenceNumber: inp.sequenceNumber,
      unlockingBytecode: {
        compiler,
        data: { keys: { privateKeys: { key: w.keyFor(binToHex(sourceOutputs[i]!.lockingBytecode)) } } },
        script: 'unlock',
        valueSatoshis: sourceOutputs[i]!.valueSatoshis,
      },
    })),
    outputs: tx.outputs.map((o) => ({ lockingBytecode: o.lockingBytecode, valueSatoshis: o.valueSatoshis })),
  });
  if (!result.success) throw new Error(`signing failed: ${JSON.stringify(result.errors).slice(0, 300)}`);
  const vm = createVirtualMachineBch2026(true);
  const ok = vm.verify({ sourceOutputs: sourceOutputs.map((s) => ({ ...s })), transaction: result.transaction });
  if (ok !== true) throw new Error(`the VM refuses the signed payment: ${ok}`);
  const raw = encodeTransaction(result.transaction);
  return { hex: binToHex(raw), txid: txidOf(raw), size: raw.length };
}
