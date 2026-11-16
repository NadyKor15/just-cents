// Minimal Fulcrum (Electrum) JSON-RPC over WebSocket for Cloudflare Workers.
// One request per connection; a second server is tried if the first fails.
export type Net = 'mainnet' | 'chipnet';

export const SERVERS: Record<Net, string[]> = {
  mainnet: ['https://bch.imaginary.cash:50004', 'https://electrum.imaginary.cash:50004'],
  chipnet: ['https://chipnet.bch.ninja:50004', 'https://chipnet.imaginary.cash:50004'],
};

async function once<T>(url: string, method: string, params: unknown[], timeoutMs: number): Promise<T> {
  const resp = await fetch(url, { headers: { Upgrade: 'websocket' } });
  const ws = (resp as unknown as { webSocket: WebSocket | null }).webSocket;
  if (!ws) throw new Error(`no websocket from ${url} (HTTP ${resp.status})`);
  (ws as unknown as { accept(): void }).accept();
  return await new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      try { ws.close(); } catch { /* closed */ }
      reject(new Error(`${method}: no answer in ${timeoutMs} ms`));
    }, timeoutMs);
    ws.addEventListener('message', (ev: MessageEvent) => {
      const lines = String(ev.data).split('\n').filter(Boolean);
      for (const line of lines) {
        const m = JSON.parse(line) as { id?: number; result?: T; error?: { message?: string } };
        if (m.id !== 1) continue;
        clearTimeout(t);
        try { ws.close(); } catch { /* closed */ }
        if (m.error) reject(new Error(m.error.message ?? JSON.stringify(m.error)));
        else resolve(m.result as T);
      }
    });
    ws.addEventListener('error', () => { clearTimeout(t); reject(new Error(`socket error ${url}`)); });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n');
  });
}

export async function rpc<T>(net: Net, method: string, params: unknown[], timeoutMs = 8000): Promise<T> {
  let last: unknown;
  for (const url of SERVERS[net]) {
    try {
      return await once<T>(url, method, params, timeoutMs);
    } catch (e) {
      last = e;
      // A "not found" from a working server is an answer, not an outage.
      if (e instanceof Error && /not found|No such mempool|missing/i.test(e.message)) throw e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
