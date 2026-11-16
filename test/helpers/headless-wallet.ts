// Test-only WizardConnect wallet that runs in Node: pairs through the real relay, shares tpub/xpub,
// signs requested P2PKH inputs with SIGHASH_ALL|FORKID|UTXOS (0x61) like real wallets do.
import {
  binToHex,
  decodeTransaction,
  deriveHdPath,
  deriveHdPrivateNodeFromBip39Mnemonic,
  deriveHdPublicNode,
  encodeHdPublicKey,
  encodeTransaction,
  hash256,
  hexToBin,
  secp256k1,
  sha256,
  utf8ToBin,
  generateSigningSerializationBch,
  type HdPrivateNodeValid,
} from '@bitauth/libauth';
import { WalletConnectionManager, DerivationPath, type WalletAdapter } from '@wizardconnect/wallet';
import { toBigInt, toUint8Array } from '@wizardconnect/core';

const SIGHASH = 0x61; // ALL | UTXOS | FORKID

export type SignLog = { inputs: number; outputs: number; userPrompt?: string; broadcast?: boolean; rawTxType: string };

export function headlessWallet(mnemonic: string, network: 'mainnet' | 'testnet', onSign?: (l: SignLog) => void) {
  const root = deriveHdPrivateNodeFromBip39Mnemonic(mnemonic);
  const account = (child: number) => {
    const n = deriveHdPath(root, `m/44'/145'/0'/${child}`);
    if (typeof n === 'string') throw new Error(n);
    return n as HdPrivateNodeValid;
  };
  const key = (child: number, index: number) => {
    const n = deriveHdPath(root, `m/44'/145'/0'/${child}/${index}`);
    if (typeof n === 'string') throw new Error(n);
    return n.privateKey;
  };
  const adapter: WalletAdapter = {
    walletName: 'Headless test wallet',
    walletIcon: '',
    getRelayPrivateKey: (uri) => sha256.hash(utf8ToBin(`relay|${mnemonic}|${uri}`)),
    getPublicKey: (path, index) => secp256k1.derivePublicKeyCompressed(key(path, Number(index))) as Uint8Array,
    getXpub: (path) => {
      const r = encodeHdPublicKey({ network, node: deriveHdPublicNode(account(path)) });
      return typeof r === 'string' ? r : r.hdPublicKey;
    },
    async signTransaction(req) {
      const wc = req.transaction;
      const rawTxType = typeof wc.transaction;
      if (typeof wc.transaction !== 'string') throw new Error('test wallet wants hex, like Selene');
      const tx = decodeTransaction(hexToBin(wc.transaction));
      if (typeof tx === 'string') throw new Error(tx);
      const source = (wc.sourceOutputs as any[]).map((s) => ({
        outpointTransactionHash: toUint8Array(s.outpointTransactionHash),
        outpointIndex: Number(s.outpointIndex),
        sequenceNumber: Number(s.sequenceNumber),
        unlockingBytecode: toUint8Array(s.unlockingBytecode),
        lockingBytecode: toUint8Array(s.lockingBytecode),
        valueSatoshis: toBigInt(s.valueSatoshis),
      }));
      onSign?.({ inputs: tx.inputs.length, outputs: tx.outputs.length, userPrompt: wc.userPrompt, broadcast: wc.broadcast, rawTxType });
      const signed = { ...tx, inputs: tx.inputs.map((i) => ({ ...i })) };
      for (const [inputIndex, pathName, addrIndex] of req.inputPaths) {
        const child = pathName === 'receive' ? 0 : pathName === 'change' ? 1 : 7;
        const priv = key(child, addrIndex);
        const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
        const ser = generateSigningSerializationBch(
          { inputIndex, sourceOutputs: source, transaction: tx },
          { coveredBytecode: source[inputIndex]!.lockingBytecode, signingSerializationType: Uint8Array.of(SIGHASH) },
        );
        const sig = secp256k1.signMessageHashSchnorr(priv, hash256(ser));
        if (typeof sig === 'string') throw new Error(sig);
        signed.inputs[inputIndex]!.unlockingBytecode = Uint8Array.from([65, ...sig, SIGHASH, 33, ...pub]);
      }
      return { signedTransaction: binToHex(encodeTransaction(signed)) };
    },
  };
  const mgr = new WalletConnectionManager(adapter);
  mgr.on('pendingSignRequest', async ({ connectionId, request }) => {
    try {
      const r = await adapter.signTransaction(request);
      await mgr.sendSignResponse(connectionId, request.sequence, r.signedTransaction);
    } catch (e) {
      await mgr.sendSignError(connectionId, request.sequence, e instanceof Error ? e.message : String(e));
    }
  });
  return { mgr, adapter, DerivationPath };
}
