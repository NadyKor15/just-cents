// HTTP API for people's assistants (and anyone else): create an order, read its previews and checks,
// get the link a person opens to pay in their own wallet, and fetch the kit once the payment is on chain.
// The assistant never holds money and never signs: payment always happens on the page, in the person's wallet.
//
// Nothing is stored when an order is created: the order id carries its network and its careless specialist.
// The only stored fact is "this order was paid by txid", written after the transaction is read from the
// network and its JC1 note names this order.
import offers from '../src/data/offers.json';
import { readOrderId, newOrderId, type OrderMeta } from '../src/core/orderid';
import { checkDescription, checkIcon, checkVoice, RULES } from '../src/core/rules';
import { PAYOUT } from '../src/config';
import { readOutputs, readNote, bytesToHex } from './txparse';
import { rpc } from './fulcrum';
import { json } from './http';

type Net = 'mainnet' | 'chipnet';
type Entry = { signed: { offer: { priceCents: number; priceSats: string; fileSha256: string; facts: string; specialist: string; payTo: string } }; file: string; preview: string | Record<string, string>; payToLockingHex: string; offerHashHex: string };
const OFFERS = offers as unknown as Record<Net, Record<string, Entry>>;

export interface ApiEnv {
  ORDERS?: { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };
}

export const REQUEST = 'Make me a kit to list my game.';
const HELPER_CENTS = 1;
const RATE_PER_MINUTE = 20;

/** Per-IP limit on order creation, in the edge cache (no storage writes). */
export async function rateLimited(request: Request): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const minute = Math.floor(Date.now() / 60000);
  const key = new Request(`https://rate.just-cents.invalid/${encodeURIComponent(ip)}/${minute}`);
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return false;
  const hit = await cache.match(key);
  const n = hit ? Number(await hit.text()) : 0;
  if (n >= RATE_PER_MINUTE) return true;
  await cache.put(key, new Response(String(n + 1), { headers: { 'cache-control': 'max-age=70' } }));
  return false;
}

function abs(origin: string, p: string) {
  return p.startsWith('/') ? origin + p : p;
}

function describe(meta: OrderMeta, origin: string, txid: string | null) {
  const net = meta.net;
  const book = OFFERS[net];
  const good = meta.careless === 'sam' ? 'lena' : 'sam';
  const name = (w: string) => (w === 'sam' ? 'Sam' : 'Lena');
  const icon = book['icon']!, voice = book['voice']!;
  const bad = book[`${meta.careless}:careless`]!, ok = book[`${good}:good`]!;
  const [w, h] = icon.signed.offer.facts.split('x').map(Number) as [number, number];
  const iconCheck = checkIcon({ width: w, height: h, letters: 0, preview: false });
  const badCheck = checkDescription(bad.preview as Record<string, string>, { full: false });
  const okCheck = checkDescription(ok.preview as Record<string, string>, { full: false });
  const voiceCheck = checkVoice({ seconds: parseFloat(voice.signed.offer.facts), preview: false });
  const part = (label: string, specialist: string, e: Entry, check: ReturnType<typeof checkIcon>, how: string) => ({
    part: label,
    specialist,
    demo_specialist: true,
    price_cents: e.signed.offer.priceCents,
    price_sats: Number(e.signed.offer.priceSats),
    pay_to: e.signed.offer.payTo,
    offer: e.signed,
    offer_fingerprint: e.offerHashHex,
    preview: typeof e.preview === 'string' ? abs(origin, e.preview) : e.preview,
    check: check.ok ? { ok: true, note: check.note, how } : { ok: false, reason: check.reason, how },
  });
  const accepted = [
    part('icon', 'icon (demo specialist)', icon, iconCheck, 'size from the signed offer here; "no letters" is checked by OCR in the browser on the pay page, before the wallet is asked'),
    part('description', `${name(good)} (demo specialist)`, ok, okCheck, 'language detection (franc) on the first sentence of each language, here'),
    part('voice', 'voice (demo specialist)', voice, voiceCheck, 'length from the signed offer here, measured again on the full file after payment'),
  ];
  const total = accepted.reduce((s, p) => s + p.price_cents, 0) + HELPER_CENTS;
  return {
    id: meta.id,
    network: net,
    request: REQUEST,
    rules: { icon: RULES.icon.text, description: RULES.description.text, voice: RULES.voice.text },
    parts: accepted,
    rejected: [
      {
        part: 'description',
        specialist: `${name(meta.careless)} (demo specialist, careless on purpose)`,
        cents: 0,
        reason: badCheck.ok ? null : badCheck.reason,
        replaced_by: `${name(good)} (demo specialist)`,
      },
    ],
    helper: { cents: HELPER_CENTS, pay_to: PAYOUT.helper[net] },
    total_cents: total,
    status: txid ? 'paid' : 'awaiting_payment',
    txid,
    pay_url: `${origin}/?order=${meta.id}`,
    pay_note: 'A person opens pay_url and signs one transaction in their own wallet over WizardConnect (tested with Cashonize). The assistant never holds money.',
    kit_url: `${origin}/api/orders/${meta.id}/kit`,
  };
}

async function paidTx(env: ApiEnv, id: string): Promise<string | null> {
  return env.ORDERS ? await env.ORDERS.get(`paid:${id}`) : null;
}

/** /api/orders… router. */
export async function api(request: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(2); // ['orders', id?, action?]
  if (parts[0] !== 'orders') return json({ ok: false, reason: 'see /llms.txt' }, 404);

  if (parts.length === 1) {
    if (request.method !== 'POST') return json({ ok: false, reason: 'POST to create an order' }, 405);
    if (await rateLimited(request)) return json({ ok: false, reason: `at most ${RATE_PER_MINUTE} new orders per minute` }, 429);
    const body = (await request.json().catch(() => ({}))) as { network?: string; careless?: string };
    const net: Net = body.network === 'chipnet' ? 'chipnet' : 'mainnet';
    const careless = body.careless === 'lena' ? 'lena' : 'sam';
    return json(describe({ id: newOrderId(net, careless), net, careless }, origin, null), 201);
  }

  const meta = readOrderId(parts[1] ?? '');
  if (!meta) return json({ ok: false, reason: 'order id must be 32 hex characters' }, 400);
  const action = parts[2] ?? '';

  if (action === '' && request.method === 'GET') return json(describe(meta, origin, await paidTx(env, meta.id)));

  if (action === 'pay' && request.method === 'GET') {
    const d = describe(meta, origin, await paidTx(env, meta.id));
    return json({ id: meta.id, status: d.status, pay_url: d.pay_url, total_cents: d.total_cents, pay_note: d.pay_note, wallet_prompt: 'Just Cents: pay 3 specialists + helper' });
  }

  if (action === 'paid' && request.method === 'POST') {
    const { txid } = (await request.json().catch(() => ({}))) as { txid?: string };
    if (!txid || !/^[0-9a-f]{64}$/.test(txid)) return json({ ok: false, reason: 'txid must be 64 hex characters' }, 400);
    let raw: string;
    try {
      raw = await rpc<string>(meta.net, 'blockchain.transaction.get', [txid, false]);
    } catch (e) {
      return json({ ok: false, reason: `the network does not know this transaction yet: ${e instanceof Error ? e.message : e}` }, 404);
    }
    const note = readOutputs(raw).map((o) => readNote(o.script)).find((n) => n);
    if (!note || note.orderIdHex !== meta.id) return json({ ok: false, reason: 'this transaction is not a payment for this order' }, 409);
    if (env.ORDERS) await env.ORDERS.put(`paid:${meta.id}`, txid, { expirationTtl: 60 * 60 * 24 * 30 });
    return json({ ok: true, id: meta.id, txid });
  }

  if (action === 'kit' && request.method === 'GET') {
    const txid = url.searchParams.get('txid') ?? (await paidTx(env, meta.id));
    if (!txid) return json({ ok: false, status: 'awaiting_payment', reason: 'not paid yet: a person opens pay_url and signs in their wallet', pay_url: `${origin}/?order=${meta.id}` }, 409);
    const d = describe(meta, origin, txid);
    const book = OFFERS[meta.net];
    const good = meta.careless === 'sam' ? 'lena' : 'sam';
    const keys = ['icon', `${good}:good`, 'voice'];
    return json({
      id: meta.id,
      txid,
      files: keys.map((k) => ({
        part: k.split(':')[0] === good ? 'description' : k,
        name: book[k]!.file,
        url: `${origin}/full/${encodeURIComponent(k)}?net=${meta.net}&txid=${txid}`,
        sha256: book[k]!.signed.offer.fileSha256,
      })),
      note: 'Each file is handed over only if this transaction pays its specialist; compare sha256 with the signed offer. The page also builds a short clip from the accepted parts.',
      rejected: d.rejected,
    });
  }

  return json({ ok: false, reason: 'unknown action' }, 404);
}

export { bytesToHex };
