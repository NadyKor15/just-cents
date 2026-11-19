import { describe, expect, it, vi } from 'vitest';
import { binToHex, encodeTransaction, encodeLockingBytecodeP2pkh, hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';

// the network, replaced: /kit reads the paying transaction to tell an older JC1 order from a JC2 one
const chain = new Map<string, string>();
vi.mock('../worker/fulcrum', () => ({
  rpc: vi.fn(async (_net: string, method: string, params: unknown[]) => {
    const raw = method === 'blockchain.transaction.get' ? chain.get(params[0] as string) : undefined;
    if (!raw) throw new Error('No such mempool or blockchain transaction');
    return raw;
  }),
}));

import { newOrderId, readOrderId } from '../src/core/orderid';
import { api } from '../worker/api';
import { mcp } from '../worker/mcp';
import { EXAMPLE } from '../src/data/example';
import { buildPayment, noteText, type Utxo } from '../src/core/tx';
import { txidOf } from '../src/core/release';
import offers from '../src/data/offers.json';

/** An older (JC1) payment of this order straight to the listed specialists, on the stub network; returns its txid. */
function jc1(id: string, keys: string[]): string {
  const b = (offers as any).chipnet;
  const lock = encodeLockingBytecodeP2pkh(hash160(secp256k1.derivePublicKeyCompressed(sha256.hash(utf8ToBin('api jc1'))) as Uint8Array));
  const coin: Utxo = { txid: '56'.repeat(32), vout: 0, sats: 100_000n, lockingBytecode: lock, path: 'receive', index: 0 };
  const p = buildPayment({ utxos: [coin], payouts: keys.map((k) => ({ label: k, address: b[k].signed.offer.payTo, sats: BigInt(b[k].signed.offer.priceSats) })), note: noteText(id, keys.map((k) => b[k].offerHashHex)) });
  const raw = binToHex(encodeTransaction(p.transaction));
  const txid = txidOf(raw);
  chain.set(txid, raw);
  return txid;
}

const O = 'https://jc.test';
const store = new Map<string, string>();
const env = { ORDERS: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) } };
const call = async (method: string, path: string, body?: unknown) => {
  const r = await api(new Request(O + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, j: (await r.json()) as any };
};

describe('order ids carry their own state', () => {
  it('round-trips network and careless specialist', () => {
    for (const net of ['mainnet', 'chipnet'] as const)
      for (const c of ['sam', 'lena'] as const) {
        const id = newOrderId(net, c);
        expect(readOrderId(id)).toEqual({ id, net, careless: c });
      }
    expect(readOrderId('xyz')).toBeNull();
  });
});

describe('order API', () => {
  it('creates an order with rules, prices, checks and a rejected piece at 0 cents', async () => {
    const { status, j } = await call('POST', '/api/orders', {});
    expect(status).toBe(201);
    expect(j.network).toBe('mainnet');
    expect(j.parts.map((p: any) => [p.part, p.price_cents, p.check.ok])).toEqual([['cover (variant A)', 2, true], ['subtitles', 1, true], ['logo', 1, true]]);
    expect(j.rejected[0]).toMatchObject({ part: 'subtitles', cents: 0, reason: 'subtitle 1 starts 1.1 s late' });
    expect(j.total_cents).toBe(5);
    expect(j.status).toBe('awaiting_payment');
    expect(j.pay_url).toBe(`${O}/?order=${j.id}`);
    expect(j.parts[0].check.how).toMatch(/sharper than the frame simply stretched/);
    // who did the work is named only as what was really used
    expect(j.parts.map((p: any) => p.made_with)).toEqual(['Stability AI Fast Upscaler', 'Deepgram Nova-2', 'VTracer (open source, MIT), run by the Just Cents team']);
    expect(j.inputs.trailer_words).toBe(`${O}/api/inputs/trailer-words`);
    // what the example is about comes from src/data/example.ts, not from the mechanics
    expect(j.request).toBe(EXAMPLE.request);
    expect(Object.keys(j.rules)).toEqual([EXAMPLE.choice.apiPart, EXAMPLE.pair.apiPart, EXAMPLE.single.apiPart]);
  });
  it('makes Lena careless when asked, and Sam is then accepted', async () => {
    const { j } = await call('POST', '/api/orders', { careless: 'lena', network: 'chipnet' });
    expect(j.network).toBe('chipnet');
    expect(j.parts[1].specialist).toMatch(/^Sam/);
    expect(j.rejected[0].specialist).toMatch(/^Lena/);
    expect(j.parts[0].pay_to).toMatch(/^bchtest:/);
  });
  it('reads, gives the pay link, and refuses the kit before payment', async () => {
    const id = newOrderId('mainnet', 'sam');
    expect((await call('GET', `/api/orders/${id}`)).j.id).toBe(id);
    const pay = await call('GET', `/api/orders/${id}/pay`);
    expect(pay.j.pay_url).toContain(id);
    expect(pay.j.wallet_prompt).toBe('Just Cents: pay 3 specialists + service');
    const kit = await call('GET', `/api/orders/${id}/kit`);
    expect(kit.status).toBe(409);
  });
  it('gives file links and fingerprints once a txid is known (an older JC1 order: /full/ links)', async () => {
    const id = newOrderId('chipnet', 'sam');
    store.set(`paid:${id}`, jc1(id, ['cover', 'lena:good', 'logo']));
    const kit = await call('GET', `/api/orders/${id}/kit`);
    expect(kit.status).toBe(200);
    expect(kit.j.files.map((f: any) => f.part)).toEqual(['cover', 'subtitles', 'logo']);
    expect(kit.j.files[1].url).toContain('/full/lena%3Agood?net=chipnet&txid=');
    expect(kit.j.files.every((f: any) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
  });
  it('offers two cover variants; only the chosen one is a paid part, the other is "not chosen, 0 cents"', async () => {
    const a = (await call('POST', '/api/orders', {})).j;
    expect(a.cover_choice.chosen).toBe('a');
    expect(a.cover_choice.variants.map((v: any) => v.variant)).toEqual(['a', 'b']);
    expect(a.parts[0].part).toBe('cover (variant A)');
    expect(a.not_chosen[0]).toMatchObject({ part: 'cover (variant B)', cents: 0 });
    expect(a.total_cents).toBe(5);
    const b = (await call('GET', `/api/orders/${a.id}?choice=b`)).j;
    expect(b.parts[0].part).toBe('cover (variant B)');
    expect(b.parts[0].offer_fingerprint).toBe(a.cover_choice.variants[1].offer_fingerprint);
    expect(b.pay_url).toBe(`${O}/?order=${a.id}&choice=b`);
    const id = newOrderId('chipnet', 'sam');
    store.set(`paid:${id}`, JSON.stringify({ txid: jc1(id, ['cover:b', 'lena:good', 'logo']), choice: 'b' }));
    const kit = (await call('GET', `/api/orders/${id}/kit`)).j;
    expect(kit.cover_choice).toBe('b');
    expect(kit.files[0].url).toContain('/full/cover%3Ab?');
    // a transaction the network does not know: said so, no links
    const id2 = newOrderId('chipnet', 'sam');
    store.set(`paid:${id2}`, 'cd'.repeat(32));
    const none = await call('GET', `/api/orders/${id2}/kit`);
    expect(none.status).toBe(404);
  });
  it('rejects bad ids and bad txids', async () => {
    expect((await call('GET', '/api/orders/nothex')).status).toBe(400);
    expect((await call('POST', `/api/orders/${newOrderId('mainnet', 'sam')}/paid`, { txid: 'x' })).status).toBe(400);
  });
});

describe('MCP', () => {
  const rpc = async (body: unknown) => {
    const r = await mcp(new Request(O + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
    return { status: r.status, j: r.status === 202 ? null : ((await r.json()) as any) };
  };
  it('initializes, lists four tools, creates an order and refuses the kit before payment', async () => {
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(init.j.result.serverInfo.name).toBe('just-cents');
    expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const tools = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(tools.j.result.tools.map((t: any) => t.name)).toEqual(['create_order', 'get_order', 'get_pay_link', 'get_kit']);
    const created = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_order', arguments: {} } });
    const order = JSON.parse(created.j.result.content[0].text);
    expect(order.total_cents).toBe(5);
    const kit = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_kit', arguments: { order_id: order.id } } });
    expect(JSON.parse(kit.j.result.content[0].text).status).toBe('awaiting_payment');
    expect(kit.j.result.isError).toBe(false);
  });
  it('answers GET with 405', async () => {
    expect((await mcp(new Request(O + '/mcp'), env)).status).toBe(405);
  });
});
