// Network access through public Fulcrum (Electrum) servers, with a second server if the first fails.
import { ElectrumClient } from '@electrum-cash/network';

export type Net = 'mainnet' | 'chipnet';

export const FULCRUM: Record<Net, string[]> = {
  mainnet: ['bch.imaginary.cash', 'electrum.imaginary.cash'],
  chipnet: ['chipnet.bch.ninja', 'chipnet.imaginary.cash'],
};

export const PREFIX: Record<Net, 'bitcoincash' | 'bchtest'> = { mainnet: 'bitcoincash', chipnet: 'bchtest' };

const EXPLORER: Record<Net, string> = {
  mainnet: 'https://explorer.bch.ninja', // bch.loping.net put a "checking you are not a bot" wall in front of the transaction
  chipnet: 'https://chipnet.imaginary.cash',
};

export function explorerTx(net: Net, txid: string): string {
  return `${EXPLORER[net]}/tx/${txid}`;
}

const REQUEST_TIMEOUT_MS = 12_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: no answer in ${ms / 1000} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const clients = new Map<string, Promise<ElectrumClient<any>>>();

function client(host: string): Promise<ElectrumClient<any>> {
  let c = clients.get(host);
  if (!c) {
    c = (async () => {
      const e = new ElectrumClient('Just Cents', '1.4.1', host);
      await withTimeout(e.connect(), REQUEST_TIMEOUT_MS, `connect ${host}`);
      return e;
    })();
    clients.set(host, c);
    c.catch(() => clients.delete(host));
  }
  return c;
}

/** Same request, server by server, until one answers. Rule rejections from a node are returned, not retried. */
export async function request<T>(net: Net, method: string, ...params: (string | number | boolean)[]): Promise<T> {
  let last: unknown;
  for (const host of FULCRUM[net]) {
    try {
      const c = await client(host);
      const r = await withTimeout(c.request(method, ...params), REQUEST_TIMEOUT_MS, `${method} @ ${host}`);
      if (r instanceof Error) throw r;
      return r as T;
    } catch (e) {
      last = e;
      clients.delete(host);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export type RawUtxo = { tx_hash: string; tx_pos: number; value: number; height: number };

/** Plain BCH coins only: coins that carry CashTokens are left alone, so a payment can never burn a token. */
export async function listUnspent(net: Net, address: string): Promise<RawUtxo[]> {
  const list = await request<(RawUtxo & { token_data?: unknown })[]>(net, 'blockchain.address.listunspent', address, 'exclude_tokens');
  return list.filter((u) => !u.token_data);
}

export function getRawTx(net: Net, txid: string): Promise<string> {
  return request<string>(net, 'blockchain.transaction.get', txid, false);
}

export type Broadcast = { ok: true; txid: string } | { ok: false; nodeError: string };

/** Sends exactly what was signed; if the network refuses, the node's own words come back. */
export async function broadcast(net: Net, rawHex: string): Promise<Broadcast> {
  let lastErr = '';
  for (const host of FULCRUM[net]) {
    try {
      const c = await client(host);
      const r = await withTimeout(c.request('blockchain.transaction.broadcast', rawHex), REQUEST_TIMEOUT_MS, `broadcast @ ${host}`);
      if (r instanceof Error) {
        const msg = r.message;
        // Already in the mempool (a wallet broadcast it too) counts as sent.
        if (/already|txn-already-known|transaction already in block chain/i.test(msg)) return { ok: true, txid: '' };
        return { ok: false, nodeError: msg };
      }
      return { ok: true, txid: String(r) };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      clients.delete(host);
    }
  }
  return { ok: false, nodeError: `could not reach any server: ${lastErr}` };
}

export async function closeAll(): Promise<void> {
  for (const c of clients.values()) {
    try {
      await (await c).disconnect(true);
    } catch {
      /* closed */
    }
  }
  clients.clear();
}
