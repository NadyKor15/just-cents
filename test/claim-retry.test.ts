// The page asking a specialist to open its contract (POST /claim): on the free Workers plan a cold request can run out
// of CPU, and Cloudflare then answers 503 with its own HTML page "Error 1102". The page must ask again, and that is
// safe: the claim is deterministic, so a second request builds the same transaction ("already known" on the network)
// and never a second claim. The key is always read from the claim on the network, never from the answer.
// Asking again stops at once when the specialist says it is too late (409): the money then waits for its refund.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256, utf8ToBin } from '@bitauth/libauth';
import { buildClaim, contractLocking, hex, publicKeyOf, sha256Hex, type LockParams } from '../src/core/htlc';

const FUND = 'ab'.repeat(32);
const K = sha256.hash(utf8ToBin('claim-retry key'));
const seller = sha256.hash(utf8ToBin('claim-retry seller'));
const params: LockParams = {
  cipherSha256: 'cd'.repeat(32),
  keyHash: sha256Hex(K),
  sellerPubkey: publicKeyOf(seller),
  buyerLockingHex: '76a914' + '22'.repeat(20) + '88ac',
  refundTime: 1_795_100_000,
};
const claimTx = buildClaim({ fundingTxid: FUND, vout: 1, value: 5256n, params, key: K, privateKey: seller, payToLocking: Uint8Array.from([0x76, 0xa9, 0x14, ...new Uint8Array(20).fill(7), 0x88, 0xac]) });

const rawAsked: string[] = [];
vi.mock('../src/core/chain', () => ({
  broadcast: vi.fn(async () => ({ ok: true, txid: '' })),
  getRawTx: vi.fn(async (_net: string, txid: string) => {
    rawAsked.push(txid);
    if (txid !== claimTx.txid) throw new Error('unknown');
    return claimTx.hex;
  }),
}));
let state: { state: string } = { state: 'open' };
vi.mock('../src/core/htlc-chain', () => ({
  refundTimeFromNow: vi.fn(async () => 0),
  chainTime: vi.fn(async () => 0),
  contractState: vi.fn(async () => state),
}));

import { Order } from '../src/app/order';

const CF_1102 = '<!DOCTYPE html><html><head><title>Worker exceeded resource limits | just-cents.pages.dev | Cloudflare</title></head><body>Error 1102</body></html>';

/** The specialist's side as the page sees it: one scripted answer per POST /claim. */
function specialist(answers: (() => Response | Promise<Response>)[]) {
  const posts: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    if (!url.startsWith('/claim/') || init?.method !== 'POST') throw new Error(`unexpected ${url}`);
    posts.push(url);
    const a = answers.shift();
    if (!a) throw new Error('no more answers');
    return a();
  });
  return posts;
}

function paidOrder(): Order {
  const o = new Order('chipnet', 'sam');
  o.txid = FUND;
  o.contracts = { logo: { key: 'logo', vout: 1, sats: 5256n, params, lockingHex: hex(contractLocking(params)) } };
  return o;
}

const ok = () => new Response(JSON.stringify({ ok: true, claimTxid: claimTx.txid }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  rawAsked.length = 0;
  state = { state: 'open' };
});

describe('asking the specialist to claim, again when Cloudflare cuts it', () => {
  it('a 503 with Cloudflare\'s 1102 page, then an answer: the page asks again and reads the key from the chain', { timeout: 15_000 }, async () => {
    const posts = specialist([() => new Response(CF_1102, { status: 503, headers: { 'content-type': 'text/html' } }), ok]);
    const got = await paidOrder().obtainKey('logo');
    expect(posts).toHaveLength(2);
    expect(posts[0]).toBe(posts[1]); // the same request: the same claim
    expect(posts[0]).toBe(`/claim/logo?net=chipnet&txid=${FUND}`);
    expect(hex(got.key)).toBe(hex(K));
    expect(got.claimTxid).toBe(claimTx.txid);
    expect(rawAsked).toEqual([claimTx.txid]); // the key came from the claim on the network
  });

  it('the request fails on the way (network): asked again', { timeout: 15_000 }, async () => {
    const posts = specialist([() => Promise.reject(new TypeError('Failed to fetch')), ok]);
    expect(hex((await paidOrder().obtainKey('logo')).key)).toBe(hex(K));
    expect(posts).toHaveLength(2);
  });

  it('several 1102 in a row are still asked again, up to six times in all', { timeout: 60_000 }, async () => {
    const cut = () => new Response(CF_1102, { status: 503 });
    const posts = specialist([cut, cut, cut, cut, cut, ok]);
    expect(hex((await paidOrder().obtainKey('logo')).key)).toBe(hex(K));
    expect(posts).toHaveLength(6);
  });

  it('too late (409): not asked again; the order says why, and the money waits for its refund', { timeout: 15_000 }, async () => {
    const posts = specialist([() => new Response(JSON.stringify({ ok: false, reason: 'too late: the refund opens at …' }), { status: 409 })]);
    const o = paidOrder();
    await expect(o.obtainKey('logo')).rejects.toThrow(/too late/);
    expect(posts).toHaveLength(1);
    expect(o.stalled.logo).toMatch(/too late/);
  });

  it('an answer naming a claim that does not open this contract is not believed', { timeout: 15_000 }, async () => {
    const other = buildClaim({ fundingTxid: 'ef'.repeat(32), vout: 0, value: 5256n, params, key: K, privateKey: seller, payToLocking: Uint8Array.from([0x76, 0xa9, 0x14, ...new Uint8Array(20), 0x88, 0xac]) });
    const { getRawTx } = await import('../src/core/chain');
    vi.mocked(getRawTx).mockImplementationOnce(async () => other.hex);
    specialist([() => new Response(JSON.stringify({ ok: true, claimTxid: other.txid }), { status: 200 })]);
    await expect(paidOrder().obtainKey('logo')).rejects.toThrow(/does not open this contract/);
  });
});
