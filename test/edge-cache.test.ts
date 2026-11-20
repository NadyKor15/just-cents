// The edge cache in /full: only the public paid example is ever looked up in, or stored to, the edge cache; every
// other order goes to the network every time and stays private. The network is replaced by a stub here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../worker/fulcrum', () => ({ rpc: (...a: unknown[]) => rpc(...a) }));

import { release, isPaidExample, CACHE_PRIVATE } from '../worker/index';
import { EARLIER_PAID_EXAMPLES, PAID_EXAMPLE } from '../src/config';

const ORIGIN = 'https://justcents.retailbox-automation.com';
const OTHER = 'ab'.repeat(32);

function fakeCache(hit?: Response) {
  return { match: vi.fn(async () => hit?.clone()), put: vi.fn(async () => undefined) };
}
const env = { ASSETS: { fetch: vi.fn(async () => new Response('file bytes', { headers: { 'content-type': 'image/jpeg' } })) } };

describe('edge cache for the paid example', () => {
  let cache: ReturnType<typeof fakeCache>;
  beforeEach(() => {
    rpc.mockReset();
    env.ASSETS.fetch.mockClear();
  });
  afterEach(() => {
    delete (globalThis as { caches?: unknown }).caches;
  });

  it('knows the paid example and nothing else', () => {
    expect(isPaidExample(PAID_EXAMPLE.net, PAID_EXAMPLE.txid)).toBe(true);
    // the earlier (version 1) example stays known: old links to it keep opening from the edge
    expect(EARLIER_PAID_EXAMPLES.map((e) => isPaidExample(e.net, e.txid))).toEqual([true]);
    expect(EARLIER_PAID_EXAMPLES[0]!.txid).toBe('7c0d6eee018e53aa15c02b3111a26fe979dba7537a3b76abbce3b1382c8d0877');
    expect(isPaidExample(PAID_EXAMPLE.net, OTHER)).toBe(false);
    expect(isPaidExample(PAID_EXAMPLE.net === 'mainnet' ? 'chipnet' : 'mainnet', PAID_EXAMPLE.txid)).toBe(false);
  });

  it('serves the paid example from the edge cache without asking the network', async () => {
    cache = fakeCache(new Response('cached bytes', { headers: { 'cache-control': 'public, max-age=86400, s-maxage=604800' } }));
    (globalThis as { caches?: unknown }).caches = { default: cache };
    const r = await release(new URL(`${ORIGIN}/full/cover?net=${PAID_EXAMPLE.net}&txid=${PAID_EXAMPLE.txid}`), env);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('cached bytes');
    expect(r.headers.get('x-edge-cache')).toBe('hit');
    expect(rpc).not.toHaveBeenCalled();
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    // the key names the transaction, the offer and the view
    const key = (cache.match.mock.calls[0] as unknown as [Request])[0];
    expect(key.url).toBe(`${ORIGIN}/full/cover?net=${PAID_EXAMPLE.net}&txid=${PAID_EXAMPLE.txid}&view=full`);
  });

  it('keeps the light copy under its own key', async () => {
    cache = fakeCache();
    (globalThis as { caches?: unknown }).caches = { default: cache };
    rpc.mockRejectedValue(new Error('network down'));
    const r = await release(new URL(`${ORIGIN}/full/cover?net=${PAID_EXAMPLE.net}&txid=${PAID_EXAMPLE.txid}&view=light`), env);
    expect((cache.match.mock.calls[0] as unknown as [Request])[0].url).toMatch(/&view=light$/);
    // a miss goes through the payment check; when the network fails nothing is stored
    expect(r.status).toBe(502);
    expect(cache.put).not.toHaveBeenCalled();
  }, 15000);

  it('never looks up or stores any other order at the edge, and keeps it private', async () => {
    cache = fakeCache(new Response('cached bytes'));
    (globalThis as { caches?: unknown }).caches = { default: cache };
    rpc.mockRejectedValue(new Error('network down'));
    const r = await release(new URL(`${ORIGIN}/full/cover?net=mainnet&txid=${OTHER}`), env);
    expect(r.status).toBe(502);
    expect(rpc).toHaveBeenCalled();
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(CACHE_PRIVATE).toMatch(/^private/);
  }, 15000);
});
