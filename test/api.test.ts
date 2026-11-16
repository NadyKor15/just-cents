import { describe, expect, it } from 'vitest';
import { newOrderId, readOrderId } from '../src/core/orderid';
import { api } from '../worker/api';
import { mcp } from '../worker/mcp';

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
    expect(j.parts.map((p: any) => [p.part, p.price_cents, p.check.ok])).toEqual([['icon', 3, true], ['description', 2, true], ['voice', 2, true]]);
    expect(j.rejected[0]).toMatchObject({ cents: 0, reason: 'asked for Spanish, got Portuguese' });
    expect(j.total_cents).toBe(8);
    expect(j.status).toBe('awaiting_payment');
    expect(j.pay_url).toBe(`${O}/?order=${j.id}`);
    expect(j.parts[0].check.how).toMatch(/OCR in the browser/);
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
    expect(pay.j.wallet_prompt).toBe('Just Cents: pay 3 specialists + helper');
    const kit = await call('GET', `/api/orders/${id}/kit`);
    expect(kit.status).toBe(409);
  });
  it('gives file links and fingerprints once a txid is known', async () => {
    const id = newOrderId('chipnet', 'sam');
    store.set(`paid:${id}`, 'ab'.repeat(32));
    const kit = await call('GET', `/api/orders/${id}/kit`);
    expect(kit.status).toBe(200);
    expect(kit.j.files.map((f: any) => f.part)).toEqual(['icon', 'description', 'voice']);
    expect(kit.j.files[1].url).toContain('/full/lena%3Agood?net=chipnet&txid=');
    expect(kit.j.files.every((f: any) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
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
    expect(order.total_cents).toBe(8);
    const kit = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_kit', arguments: { order_id: order.id } } });
    expect(JSON.parse(kit.j.result.content[0].text).status).toBe('awaiting_payment');
    expect(kit.j.result.isError).toBe(false);
  });
  it('answers GET with 405', async () => {
    expect((await mcp(new Request(O + '/mcp'), env)).status).toBe(405);
  });
});
