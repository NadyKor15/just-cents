// The buyer's side of a v2 order on the network: the chain tip, and how each contract of a payment ended —
// claimed (with the key, read from the claim's own input), refunded, or still open.
import { request, getRawTx, broadcast, type Net } from './chain';
import { readSpend, scripthashOf, unhex, type Spend } from './htlc';

export async function tipHeight(net: Net): Promise<number> {
  return (await request<{ height: number }>(net, 'blockchain.headers.subscribe')).height;
}

type HistoryRow = { tx_hash: string; height: number };

/** Every transaction that touched this locking bytecode (Fulcrum history, mempool included). */
export async function lockingHistory(net: Net, locking: Uint8Array): Promise<HistoryRow[]> {
  return request<HistoryRow[]>(net, 'blockchain.scripthash.get_history', scripthashOf(locking));
}

export type ContractState = { state: 'open' } | ({ state: 'claimed' | 'refunded'; txid: string } & Spend);

/**
 * Finds the transaction that spent the contract output txid:vout, if any, and reads how: the key of a claim is taken
 * from that transaction's input and checked against the contract's keyHash (src/core/htlc.ts readSpend).
 */
export async function contractState(net: Net, locking: Uint8Array, outpoint: { txid: string; vout: number }): Promise<ContractState> {
  for (const row of await lockingHistory(net, locking)) {
    if (row.tx_hash === outpoint.txid) continue;
    const raw = unhex(await getRawTx(net, row.tx_hash));
    const spend = readSpend(raw, outpoint);
    if (spend) return { ...spend, state: spend.kind === 'claim' ? 'claimed' : 'refunded', txid: row.tx_hash };
  }
  return { state: 'open' };
}

export { broadcast };
