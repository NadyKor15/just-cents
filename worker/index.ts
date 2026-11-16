// Just Cents worker: serves the site, and hands out each demo specialist's full file only after
// it sees, in the transaction on chain, an output to that specialist's address for at least the offer
// price and an OP_RETURN note that lists the offer's fingerprint. Everything else is static.
// No libauth here: it initialises WASM at import time, which Workers do not allow. The offer book carries
// the precomputed payout script and offer fingerprint, and worker/txparse.ts reads the transaction.
import offers from '../src/data/offers.json';
import { checkOfferPaid, type BookEntry } from './txparse';
import { rpc, type Net } from './fulcrum';

type OfferEntry = { signed: { offer: { priceSats: string } }; file: string; payToLockingHex: string; offerHashHex: string };
const OFFERS = offers as unknown as Record<Net, Record<string, OfferEntry>>;

/** The offer book as the payment checks need it. */
export function bookFor(net: Net): Record<string, BookEntry> {
  const b: Record<string, BookEntry> = {};
  for (const [k, e] of Object.entries(OFFERS[net] ?? {})) {
    if (k.startsWith('_')) continue;
    b[k] = { payToLockingHex: e.payToLockingHex, offerHashHex: e.offerHashHex, priceSats: e.signed.offer.priceSats };
  }
  return b;
}

export interface Env {
  ASSETS: { fetch(req: Request | string): Promise<Response> };
}

import { json } from './http';
export { json };

async function rawTx(net: Net, txid: string): Promise<string | null> {
  // Right after broadcast a server may not know the transaction yet: ask a few times.
  for (let i = 0; i < 4; i++) {
    try {
      return await rpc<string>(net, 'blockchain.transaction.get', [txid, false]);
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  return null;
}

export async function release(url: URL, env: Env): Promise<Response> {
  // /full/<entry>   e.g. /full/icon, /full/lena:good
  const entryKey = decodeURIComponent(url.pathname.slice('/full/'.length));
  const net = url.searchParams.get('net') as Net | null;
  const txid = url.searchParams.get('txid') ?? '';
  if (net !== 'mainnet' && net !== 'chipnet') return json({ ok: false, reason: 'net must be mainnet or chipnet' }, 400);
  if (!/^[0-9a-f]{64}$/.test(txid)) return json({ ok: false, reason: 'txid must be 64 hex characters' }, 400);
  const entry: OfferEntry | undefined = OFFERS[net]?.[entryKey];
  if (!entry) return json({ ok: false, reason: `no such offer: ${entryKey}` }, 404);
  let raw: string | null;
  try {
    raw = await rawTx(net, txid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/No such mempool|not found/i.test(msg)) return json({ ok: false, reason: 'the network does not know this transaction (yet)' }, 404);
    return json({ ok: false, reason: `could not read the transaction from the network: ${msg}` }, 502);
  }
  if (!raw) return json({ ok: false, reason: 'transaction not found' }, 404);
  const paid = checkOfferPaid(raw, bookFor(net), entryKey);
  if (!paid.ok) return json({ ok: false, reason: paid.reason }, 402);
  const file = await env.ASSETS.fetch(new Request(new URL(`/files/${entry.file}`, url.origin)));
  if (!file.ok) return json({ ok: false, reason: 'file missing on the specialist side' }, 500);
  const headers = new Headers(file.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-paid-sats', paid.paidSats.toString());
  headers.set('x-order-id', paid.orderIdHex ?? '');
  headers.set('content-disposition', `attachment; filename="${entry.file}"`);
  return new Response(file.body, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/full/')) return release(url, env);
    // Full files live under /files/ and are never served directly.
    if (url.pathname.startsWith('/files/')) return json({ ok: false, reason: 'pay first: /full/<offer>?net=…&txid=…' }, 402);
    return env.ASSETS.fetch(request);
  },
};
