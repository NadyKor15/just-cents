// Remote MCP server (Streamable HTTP, stateless JSON responses) over the same order API.
// Connect: claude mcp add --transport http justcents https://<host>/mcp
import { api, type ApiEnv } from './api';
import { EXAMPLE } from '../src/data/example';

const TOOLS = [
  {
    name: 'create_order',
    description:
      `${EXAMPLE.mcpOrder} Returns the rules, prices in cents, previews and the result of each check. Nothing is paid here.`,
    inputSchema: {
      type: 'object',
      properties: {
        network: { type: 'string', enum: ['mainnet', 'chipnet'], description: 'Bitcoin Cash network, mainnet by default' },
        careless: { type: 'string', enum: ['sam', 'lena'], description: 'Which demo musician is careless on purpose (default sam)' },
        choice: { type: 'string', enum: ['a', 'b'], description: 'Which of the two icon variants the person prefers (default a); only the chosen one is paid' },
      },
    },
  },
  {
    name: 'get_order',
    description: 'Read an order: previews, checks, the rejected piece (0 cents) and whether it is paid.',
    inputSchema: { type: 'object', properties: { order_id: { type: 'string' }, choice: { type: 'string', enum: ['a', 'b'] } }, required: ['order_id'] },
  },
  {
    name: 'get_pay_link',
    description:
      'Get the link a person opens to pay the order with one signature in their own wallet over WizardConnect (tested with Cashonize). The assistant never holds money and cannot pay; give this link to the person. Pass choice to set the icon variant the person picked.',
    inputSchema: { type: 'object', properties: { order_id: { type: 'string' }, choice: { type: 'string', enum: ['a', 'b'] } }, required: ['order_id'] },
  },
  {
    name: 'get_kit',
    description: 'After the person has paid: links to the full files and their sha256 fingerprints. Returns "awaiting_payment" before that.',
    inputSchema: { type: 'object', properties: { order_id: { type: 'string' }, txid: { type: 'string', description: 'optional, if the person gives it' } }, required: ['order_id'] },
  },
];

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };

const reply = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const error = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function callApi(origin: string, method: string, path: string, env: ApiEnv, body?: unknown, ip?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ip) headers['cf-connecting-ip'] = ip;
  const r = await api(new Request(origin + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, body: await r.json() };
}

async function handle(msg: Rpc, origin: string, env: ApiEnv, ip?: string): Promise<unknown | null> {
  if (msg.id === undefined) return null; // notification
  switch (msg.method) {
    case 'initialize':
      return reply(msg.id, {
        protocolVersion: (msg.params?.protocolVersion as string) ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'just-cents', version: '0.1.0' },
        instructions:
          'Just Cents: order small jobs from AI specialists, checked by rules set before the work. Only accepted pieces get paid; a rejected piece costs 0 cents. You never pay: give the person the pay link; they sign once in their own Bitcoin Cash wallet. Then fetch the kit.',
      });
    case 'ping':
      return reply(msg.id, {});
    case 'tools/list':
      return reply(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name as string;
      const a = (msg.params?.arguments ?? {}) as Record<string, string>;
      let r;
      const ch = a.choice === 'b' ? '?choice=b' : '';
      if (name === 'create_order') r = await callApi(origin, 'POST', '/api/orders', env, { network: a.network, careless: a.careless, choice: a.choice }, ip);
      else if (name === 'get_order') r = await callApi(origin, 'GET', `/api/orders/${a.order_id}${ch}`, env);
      else if (name === 'get_pay_link') r = await callApi(origin, 'GET', `/api/orders/${a.order_id}/pay${ch}`, env);
      else if (name === 'get_kit') r = await callApi(origin, 'GET', `/api/orders/${a.order_id}/kit${a.txid ? `?txid=${a.txid}` : ''}`, env);
      else return error(msg.id, -32602, `unknown tool ${name}`);
      return reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(r.body, null, 2) }], isError: r.status >= 400 && r.status !== 409 });
    }
    default:
      return error(msg.id, -32601, `method not found: ${msg.method}`);
  }
}

export async function mcp(request: Request, env: ApiEnv): Promise<Response> {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id', 'access-control-allow-methods': 'POST, GET, OPTIONS' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return new Response('Method Not Allowed: this MCP server answers POST (Streamable HTTP, stateless).', { status: 405, headers: { ...cors, allow: 'POST' } });
  let body: Rpc | Rpc[];
  try {
    body = (await request.json()) as Rpc | Rpc[];
  } catch {
    return new Response(JSON.stringify(error(null, -32700, 'parse error')), { status: 400, headers: { ...cors, 'content-type': 'application/json' } });
  }
  const origin = new URL(request.url).origin;
  const ip = request.headers.get('cf-connecting-ip') ?? undefined;
  const list = Array.isArray(body) ? body : [body];
  const out = (await Promise.all(list.map((m) => handle(m, origin, env, ip)))).filter((x) => x !== null);
  if (!out.length) return new Response(null, { status: 202, headers: cors });
  return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]), { status: 200, headers: { ...cors, 'content-type': 'application/json' } });
}
