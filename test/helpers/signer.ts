// Test-only signer: signs the P2PKH inputs of a built payment with local keys, as a wallet would.
// Also verifies the result with the BCH 2026 virtual machine, so a test fails if the network would refuse it.
import {
  binToHex,
  createVirtualMachineBch2026,
  encodeTransaction,
  generateTransaction,
  walletTemplateP2pkhNonHd,
  walletTemplateToCompilerBch,
  type Transaction,
} from '@bitauth/libauth';
import type { SourceOutput } from '../../src/core/tx';

const compiler = walletTemplateToCompilerBch(walletTemplateP2pkhNonHd);

export function signLocally(tx: Transaction, sourceOutputs: SourceOutput[], keyFor: (inputIndex: number) => Uint8Array): { hex: string; size: number } {
  const result = generateTransaction({
    version: tx.version,
    locktime: tx.locktime,
    inputs: tx.inputs.map((inp, i) => ({
      outpointIndex: inp.outpointIndex,
      outpointTransactionHash: inp.outpointTransactionHash,
      sequenceNumber: inp.sequenceNumber,
      unlockingBytecode: {
        compiler,
        data: { keys: { privateKeys: { key: keyFor(i) } } },
        script: 'unlock',
        valueSatoshis: sourceOutputs[i]!.valueSatoshis,
      },
    })),
    outputs: tx.outputs.map((o) => ({ lockingBytecode: o.lockingBytecode, valueSatoshis: o.valueSatoshis })),
  });
  if (!result.success) throw new Error(`signing failed: ${JSON.stringify(result.errors).slice(0, 300)}`);
  const signed = result.transaction;
  const vm = createVirtualMachineBch2026(true);
  const ok = vm.verify({ sourceOutputs: sourceOutputs.map((s) => ({ ...s })), transaction: signed });
  if (ok !== true) throw new Error(`VM refuses: ${ok}`);
  const bin = encodeTransaction(signed);
  return { hex: binToHex(bin), size: bin.length };
}
