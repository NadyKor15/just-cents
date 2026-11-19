// Just Cents worker: serves the site, and hands out each demo specialist's full file only after
// it sees, in the transaction on chain, an output to that specialist's address for at least the offer
// price and an OP_RETURN note that lists the offer's fingerprint. Everything else is static.
// No libauth here: it initialises WASM at import time, which Workers do not allow. The offer book carries
// the precomputed payout script and offer fingerprint, and worker/txparse.ts reads the transaction.
import offers from '../src/data/offers.json';
import { checkOfferPaid, type BookEntry } from './txparse';
import { rpc, type Net } from './fulcrum';
import { PAID_EXAMPLE } from '../src/config';

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

/** The edge cache of this Cloudflare location (Cache API); absent outside Workers, e.g. in tests or local tools. */
function edgeCache(): Cache | undefined {
  return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
}

/** The public paid example ("See a paid order"): one order everyone opens, so its released files may sit at the edge. */
export function isPaidExample(net: Net, txid: string): boolean {
  return net === PAID_EXAMPLE.net && txid === PAID_EXAMPLE.txid;
}

/** Cache headers of a released file: the paid example may be kept by any cache; every other order only by the payer's browser. */
export const CACHE_PUBLIC = 'public, max-age=86400, s-maxage=604800';
export const CACHE_PRIVATE = 'private, max-age=3600';

export async function release(url: URL, env: Env, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  // /full/<entry>   e.g. /full/cover, /full/lena:good
  const entryKey = decodeURIComponent(url.pathname.slice('/full/'.length));
  const net = url.searchParams.get('net') as Net | null;
  const txid = url.searchParams.get('txid') ?? '';
  if (net !== 'mainnet' && net !== 'chipnet') return json({ ok: false, reason: 'net must be mainnet or chipnet' }, 400);
  if (!/^[0-9a-f]{64}$/.test(txid)) return json({ ok: false, reason: 'txid must be 64 hex characters' }, 400);
  const entry: OfferEntry | undefined = OFFERS[net]?.[entryKey];
  if (!entry) return json({ ok: false, reason: `no such offer: ${entryKey}` }, 404);
  // ?view=light: a 1024 px copy of a cover, to show while the full file downloads and is checked; same payment check,
  // and never the file the offer's fingerprint is of
  const light = url.searchParams.get('view') === 'light' && /\.jpg$/.test(entry.file);
  // The paid example's files come from this location's edge cache once they are there. Only a response that passed the
  // payment check below is ever stored, under a key naming the transaction, the offer and the view; nothing signed
  // changes, and the page still checks each file's fingerprint itself.
  const cache = isPaidExample(net, txid) ? edgeCache() : undefined;
  const key = cache ? new Request(`${url.origin}/full/${encodeURIComponent(entryKey)}?net=${net}&txid=${txid}&view=${light ? 'light' : 'full'}`) : undefined;
  if (cache && key) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) {
      const h = new Headers(hit.headers);
      h.set('x-edge-cache', 'hit');
      return new Response(hit.body, { status: 200, headers: h });
    }
  }
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
  const name = light ? entry.file.replace(/\.jpg$/, '-light.jpg') : entry.file;
  const file = await env.ASSETS.fetch(new Request(new URL(`/files/${name}`, url.origin)));
  if (!file.ok) return json({ ok: false, reason: 'file missing on the specialist side' }, 500);
  const headers = new Headers(file.headers);
  // any other order: this person's browser may keep it (the URL names the paid transaction); shared caches may not
  headers.set('cache-control', cache ? CACHE_PUBLIC : CACHE_PRIVATE);
  if (light) headers.set('x-view', 'light copy for display; the offer fingerprint is of the full file');
  headers.set('x-paid-sats', paid.paidSats.toString());
  headers.set('x-order-id', paid.orderIdHex ?? '');
  headers.set('content-disposition', `attachment; filename="${name}"`);
  if (cache && key) {
    const res = new Response(file.body, { status: 200, headers });
    const put = cache.put(key, res.clone()).catch(() => undefined);
    if (waitUntil) waitUntil(put);
    else await put;
    res.headers.set('x-edge-cache', 'miss');
    return res;
  }
  return new Response(file.body, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/full/')) return release(url, env, (p) => ctx.waitUntil(p));
    // Full files live under /files/ and are never served directly.
    if (url.pathname.startsWith('/files/')) return json({ ok: false, reason: 'pay first: /full/<offer>?net=…&txid=…' }, 402);
    return env.ASSETS.fetch(request);
  },
};
