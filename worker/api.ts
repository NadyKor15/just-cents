// HTTP API for people's assistants (and anyone else): create an order, read its previews and checks,
// get the link a person opens to pay in their own wallet, and fetch the kit once the payment is on chain.
// The assistant never holds money and never signs: payment always happens on the page, in the person's wallet.
//
// Nothing is stored when an order is created: the order id carries its network and its careless specialist.
// The only stored fact is "this order was paid by txid", written after the transaction is read from the
// network and its note names this order: JC2 (into one hash-lock contract per specialist) or, for older orders, JC1.
import offers from '../src/data/offers.json';
import { contractsInPayment, decodeTx, FEE_SATS, hex, parseNote2, readSpend, scripthashOf, unhex, type FoundContract } from '../src/core/htlc';
import speech from '../src/data/trailer-words.json';
import { readOrderId, newOrderId, type OrderMeta } from '../src/core/orderid';
import { checkCoverDeclared, checkLogoDeclared, checkSubtitlesDeclared, RULES, type Verdict } from '../src/core/rules';
import type { Speech } from '../src/core/subtitles';
import { EXAMPLE, pairName } from '../src/data/example';
import { PAYOUT } from '../src/config';
import { readOutputs, readNote, bytesToHex, checkOfferPaid } from './txparse';
import { bookFor } from './index';
import { rpc } from './fulcrum';
import { json } from './http';
import { history } from './history';

type Net = 'mainnet' | 'chipnet';
type V2 = { signed: { offer: { priceSats: string; fileSha256: string; cipherSha256: string; keyHash: string; claimPubkey: string }; sig: string }; offerHashHex: string; sealed: string };
type Entry = { signed: { offer: { priceCents: number; priceSats: string; fileSha256: string; facts: string; specialist: string; payTo: string } }; file: string; preview: string | Record<string, string>; payToLockingHex: string; offerHashHex: string; v2: V2 };
const OFFERS = offers as unknown as Record<Net, Record<string, Entry>>;
const SPEECH = speech as unknown as Speech;

/** The contracts a JC2 payment really funds (at least the price plus the claim's fee), by offer key. */
export function fundedContracts(net: Net, rawHex: string): Record<string, FoundContract> {
  const keys = Object.keys(OFFERS[net]).filter((k) => OFFERS[net][k]!.v2);
  const found = contractsInPayment(
    unhex(rawHex),
    keys.map((k) => {
      const o = OFFERS[net][k]!.v2.signed.offer;
      return { offerHashHex: OFFERS[net][k]!.v2.offerHashHex, lock: { cipherSha256: o.cipherSha256, keyHash: o.keyHash, sellerPubkey: o.claimPubkey } };
    }),
  );
  const out: Record<string, FoundContract> = {};
  for (const c of found?.contracts ?? []) {
    const k = keys.find((x) => OFFERS[net][x]!.v2.offerHashHex === c.offerHashHex)!;
    if (c.value >= BigInt(OFFERS[net][k]!.v2.signed.offer.priceSats) + FEE_SATS) out[k] = c;
  }
  return out;
}

/** The JC2 note of a payment, if it has exactly one. */
function note2Of(rawHex: string) {
  try {
    const notes = decodeTx(unhex(rawHex)).outputs.map((o) => parseNote2(o.locking)).filter((n) => n !== null);
    return notes.length === 1 ? notes[0]! : null;
  } catch {
    return null;
  }
}

/** How a contract ended, from the chain: claimed (with the key from the claim's input), refunded, or still open. */
async function contractOutcome(net: Net, paymentTxid: string, c: FoundContract): Promise<{ status: 'key_on_chain'; key: string; claim_txid: string } | { status: 'refunded'; refund_txid: string } | { status: 'waiting_for_specialist' }> {
  const hist = await rpc<{ tx_hash: string }[]>(net, 'blockchain.scripthash.get_history', [scripthashOf(unhex(c.lockingHex))]);
  for (const h of hist) {
    if (h.tx_hash === paymentTxid) continue;
    const raw = await rpc<string>(net, 'blockchain.transaction.get', [h.tx_hash, false]);
    const s = readSpend(unhex(raw), { txid: paymentTxid, vout: c.vout });
    if (s?.kind === 'claim') return { status: 'key_on_chain', key: hex(s.key), claim_txid: h.tx_hash };
    if (s?.kind === 'refund') return { status: 'refunded', refund_txid: h.tx_hash };
  }
  return { status: 'waiting_for_specialist' };
}

export interface ApiEnv {
  ORDERS?: { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };
}

export const REQUEST: string = EXAMPLE.request;
const SERVICE_CENTS = 1; // Just Cents' own 1¢ for matching and checks
const RATE_PER_MINUTE = 20;

/** Per-IP limit on order creation, in the edge cache (no storage writes). */
export async function rateLimited(request: Request, bucket = 'create'): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const minute = Math.floor(Date.now() / 60000);
  const key = new Request(`https://rate.just-cents.invalid/${bucket}/${encodeURIComponent(ip)}/${minute}`);
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

type Choice = 'a' | 'b';
const COVER_KEY: Record<Choice, string> = { a: 'cover', b: 'cover:b' };

function describe(meta: OrderMeta, origin: string, txid: string | null, choice: Choice = 'a') {
  const net = meta.net;
  const book = OFFERS[net];
  const good = meta.careless === 'sam' ? 'lena' : 'sam';
  const name = (w: string) => pairName(w === 'lena' ? 'lena' : 'sam');
  const cover = book[COVER_KEY[choice]]!, logo = book['logo']!;
  const otherCover = book[COVER_KEY[choice === 'a' ? 'b' : 'a']]!;
  const bad = book[`${meta.careless}:careless`]!, ok = book[`${good}:good`]!;
  const coverCheck = checkCoverDeclared(cover.signed.offer.facts, EXAMPLE.choice.frameSize);
  const badCheck = checkSubtitlesDeclared(bad.signed.offer.facts, SPEECH);
  const okCheck = checkSubtitlesDeclared(ok.signed.offer.facts, SPEECH);
  const logoCheck = checkLogoDeclared(logo.signed.offer.facts);
  const part = (label: string, specialist: string, tool: string, e: Entry, check: Verdict, how: string) => ({
    part: label,
    specialist,
    demo_specialist: true,
    made_with: tool,
    price_cents: e.signed.offer.priceCents,
    price_sats: Number(e.signed.offer.priceSats),
    pay_to: e.signed.offer.payTo,
    offer: e.signed,
    offer_fingerprint: e.offerHashHex,
    // how it is paid now: into a contract that only opens when the specialist puts the file's key on chain
    contract_offer: e.v2.signed,
    contract_offer_fingerprint: e.v2.offerHashHex,
    sealed_file: abs(origin, e.v2.sealed),
    key_lock: e.v2.signed.offer.keyHash,
    preview: typeof e.preview === 'string' ? abs(origin, e.preview) : e.preview,
    check: check.ok ? { ok: true, note: check.note, how } : { ok: false, reason: check.reason, how },
  });
  const accepted = [
    part(`${EXAMPLE.choice.apiPart} (variant ${choice.toUpperCase()})`, EXAMPLE.choice.specialist, EXAMPLE.choice.tool, cover, coverCheck, EXAMPLE.choice.howApi),
    part(EXAMPLE.pair.apiPart, `${name(good)} (demo specialist)`, EXAMPLE.pair.tools[good], ok, okCheck, EXAMPLE.pair.howApi),
    part(EXAMPLE.single.apiPart, EXAMPLE.single.specialist, EXAMPLE.single.tool, logo, logoCheck, EXAMPLE.single.howApi),
  ];
  const total = accepted.reduce((s, p) => s + p.price_cents, 0) + SERVICE_CENTS;
  return {
    id: meta.id,
    network: net,
    request: REQUEST,
    rules: { [EXAMPLE.choice.apiPart]: RULES.cover.text, [EXAMPLE.pair.apiPart]: RULES.subtitles.text, [EXAMPLE.single.apiPart]: RULES.logo.text },
    inputs: {
      trailer_words: `${origin}/api/inputs/trailer-words`,
      cover_frames: { a: abs(origin, EXAMPLE.choice.frames.a), b: abs(origin, EXAMPLE.choice.frames.b) },
      logo_sketch: abs(origin, EXAMPLE.single.sketch),
    },
    cover_choice: {
      chosen: choice,
      note: 'Two cover variants pass the same rules; the person picks one by taste and pays only for that one. Change it with ?choice=a|b on GET /api/orders/{id}, /pay and in pay_url.',
      variants: (['a', 'b'] as Choice[]).map((v) => ({ variant: v, frame: EXAMPLE.choice.variants[v], preview: abs(origin, book[COVER_KEY[v]]!.preview as string), offer_fingerprint: book[COVER_KEY[v]]!.offerHashHex, price_cents: book[COVER_KEY[v]]!.signed.offer.priceCents })),
    },
    parts: accepted,
    not_chosen: [{ part: `${EXAMPLE.choice.apiPart} (variant ${choice === 'a' ? 'B' : 'A'})`, cents: 0, preview: abs(origin, otherCover.preview as string), reason: 'not chosen by the person (taste, not a rule: it passed the rules)' }],
    rejected: [
      {
        part: EXAMPLE.pair.apiPart,
        specialist: `${name(meta.careless)} (demo specialist, careless on purpose)`,
        cents: 0,
        reason: badCheck.ok ? null : badCheck.reason,
        replaced_by: `${name(good)} (demo specialist)`,
      },
    ],
    service: { cents: SERVICE_CENTS, pay_to: PAYOUT.service[net], note: 'Just Cents itself: matching and checks' },
    total_cents: total,
    status: txid ? 'paid' : 'awaiting_payment',
    txid,
    pay_url: `${origin}/?order=${meta.id}${choice === 'b' ? '&choice=b' : ''}`,
    pay_note: 'A person opens pay_url and signs one transaction in their own wallet over WizardConnect (tested with Cashonize and Selene). The assistant never holds money. Each accepted part\'s price goes into its own small contract; the specialist takes it only by putting the file\'s key on chain, and after about an hour without that, the money can go back to the person.',
    kit_url: `${origin}/api/orders/${meta.id}/kit`,
  };
}

type Paid = { txid: string; choice: Choice };

/** Stored as JSON {txid, choice}; older records are a bare txid with variant A. */
async function paidTx(env: ApiEnv, id: string): Promise<Paid | null> {
  const v = env.ORDERS ? await env.ORDERS.get(`paid:${id}`) : null;
  if (!v) return null;
  if (v.startsWith('{')) return JSON.parse(v) as Paid;
  return { txid: v, choice: 'a' };
}

/** Which cover variant a payment's note lists. */
function choiceFromNote(net: Net, prefixes: string[]): Choice {
  return prefixes.includes(OFFERS[net][COVER_KEY.b]!.offerHashHex.slice(0, 32)) ? 'b' : 'a';
}

const askChoice = (url: URL): Choice => (url.searchParams.get('choice') === 'b' ? 'b' : 'a');

/** /api/orders… router. */
export async function api(request: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(2); // ['orders', id?, action?]
  if (parts[0] === 'specialists' && parts[2] === 'history' && request.method === 'GET') return history(request);
  if (parts[0] === 'inputs' && parts[1] === 'trailer-words' && request.method === 'GET') return json({ note: 'the trailer\'s spoken words with their times: the yardstick for subtitle timing, measured before any specialist worked', ...SPEECH });
  if (parts[0] !== 'orders') return json({ ok: false, reason: 'see /llms.txt' }, 404);

  if (parts.length === 1) {
    if (request.method !== 'POST') return json({ ok: false, reason: 'POST to create an order' }, 405);
    if (await rateLimited(request)) return json({ ok: false, reason: `at most ${RATE_PER_MINUTE} new orders per minute` }, 429);
    const body = (await request.json().catch(() => ({}))) as { network?: string; careless?: string; choice?: string };
    const net: Net = body.network === 'chipnet' ? 'chipnet' : 'mainnet';
    const careless = body.careless === 'lena' ? 'lena' : 'sam';
    return json(describe({ id: newOrderId(net, careless), net, careless }, origin, null, body.choice === 'b' ? 'b' : 'a'), 201);
  }

  const meta = readOrderId(parts[1] ?? '');
  if (!meta) return json({ ok: false, reason: 'order id must be 32 hex characters' }, 400);
  const action = parts[2] ?? '';

  if (action === '' && request.method === 'GET') {
    const p = await paidTx(env, meta.id);
    return json(describe(meta, origin, p?.txid ?? null, p?.choice ?? askChoice(url)));
  }

  if (action === 'pay' && request.method === 'GET') {
    const p = await paidTx(env, meta.id);
    const d = describe(meta, origin, p?.txid ?? null, p?.choice ?? askChoice(url));
    return json({ id: meta.id, status: d.status, pay_url: d.pay_url, total_cents: d.total_cents, pay_note: d.pay_note, wallet_prompt: 'Just Cents: pay 3 specialists + service' });
  }

  if (action === 'paid' && request.method === 'POST') {
    const { txid } = (await request.json().catch(() => ({}))) as { txid?: string };
    if (!txid || !/^[0-9a-f]{64}$/.test(txid)) return json({ ok: false, reason: 'txid must be 64 hex characters' }, 400);
    if (await rateLimited(request, 'paid')) return json({ ok: false, reason: `at most ${RATE_PER_MINUTE} reports per minute` }, 429);
    const existing = await paidTx(env, meta.id);
    if (existing) return existing.txid === txid ? json({ ok: true, id: meta.id, txid, cover_choice: existing.choice }) : json({ ok: false, reason: 'this order is already paid by another transaction' }, 409);
    let raw: string;
    try {
      raw = await rpc<string>(meta.net, 'blockchain.transaction.get', [txid, false]);
    } catch (e) {
      return json({ ok: false, reason: `the network does not know this transaction yet: ${e instanceof Error ? e.message : e}` }, 404);
    }
    let notes: ReturnType<typeof readNote>[];
    try {
      notes = readOutputs(raw).map((o) => readNote(o.script)).filter((n) => n);
    } catch (e) {
      return json({ ok: false, reason: `cannot read the transaction: ${e instanceof Error ? e.message : e}` }, 400);
    }
    const note = notes.length === 1 ? notes[0]! : null;
    if (!note) {
      // JC2: one contract per accepted specialist; it counts if it funds at least one listed contract fully
      const n2 = note2Of(raw);
      if (!n2 || n2.orderIdHex !== meta.id) return json({ ok: false, reason: 'this transaction is not a payment for this order' }, 409);
      const funded = fundedContracts(meta.net, raw);
      if (!Object.keys(funded).length) return json({ ok: false, reason: 'this transaction funds none of the contracts in its note' }, 409);
      const choice2: Choice = funded[COVER_KEY.b] ? 'b' : 'a';
      if (env.ORDERS) await env.ORDERS.put(`paid:${meta.id}`, JSON.stringify({ txid, choice: choice2 }), { expirationTtl: 60 * 60 * 24 * 30 });
      return json({ ok: true, id: meta.id, txid, cover_choice: choice2, contracts: Object.keys(funded) });
    }
    if (note.orderIdHex !== meta.id) return json({ ok: false, reason: 'this transaction is not a payment for this order' }, 409);
    // it must actually pay at least one listed offer, not just carry the order id
    const book = bookFor(meta.net);
    const paidAny = Object.keys(book).some((k) => note.offerPrefixes.includes(book[k]!.offerHashHex.slice(0, 32)) && checkOfferPaid(raw, book, k).ok);
    if (!paidAny) return json({ ok: false, reason: 'this transaction pays none of the offers in its note' }, 409);
    const choice = choiceFromNote(meta.net, note.offerPrefixes);
    if (env.ORDERS) await env.ORDERS.put(`paid:${meta.id}`, JSON.stringify({ txid, choice }), { expirationTtl: 60 * 60 * 24 * 30 });
    return json({ ok: true, id: meta.id, txid, cover_choice: choice });
  }

  if (action === 'kit' && request.method === 'GET') {
    const given = url.searchParams.get('txid');
    const p = given ? { txid: given, choice: askChoice(url) } : await paidTx(env, meta.id);
    if (!p) return json({ ok: false, status: 'awaiting_payment', reason: 'not paid yet: a person opens pay_url and signs in their wallet', pay_url: `${origin}/?order=${meta.id}` }, 409);
    const { txid, choice } = p;
    const d = describe(meta, origin, txid, choice);
    const book = OFFERS[meta.net];
    const good = meta.careless === 'sam' ? 'lena' : 'sam';
    const keys = [COVER_KEY[choice], `${good}:good`, 'logo'];
    const partName = (k: string) => (k.startsWith('cover') ? EXAMPLE.choice.apiPart : k === 'logo' ? EXAMPLE.single.apiPart : EXAMPLE.pair.apiPart);
    // how was it paid? JC2: into contracts; the files are sealed on the site and each key is on chain in its claim
    let raw: string;
    try {
      raw = await rpc<string>(meta.net, 'blockchain.transaction.get', [txid, false]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/No such mempool|not found/i.test(msg)) return json({ ok: false, reason: 'the network does not know this transaction (yet)' }, 404);
      return json({ ok: false, reason: `could not read the transaction from the network: ${msg}` }, 502);
    }
    const n2 = note2Of(raw);
    if (n2) {
      if (n2.orderIdHex !== meta.id) return json({ ok: false, reason: 'this transaction is not a payment for this order' }, 409);
      const funded = fundedContracts(meta.net, raw);
      const files = [];
      for (const k of keys) {
        const e = book[k]!;
        const c = funded[k];
        const base = { part: partName(k), name: e.file, sealed_url: abs(origin, e.v2.sealed), sealed_sha256: e.v2.signed.offer.cipherSha256, sha256: e.signed.offer.fileSha256, key_lock: e.v2.signed.offer.keyHash };
        if (!c) {
          files.push({ ...base, status: 'not_paid' });
          continue;
        }
        let outcome: Awaited<ReturnType<typeof contractOutcome>> | { status: 'unknown'; reason: string };
        try {
          outcome = await contractOutcome(meta.net, txid, c);
        } catch (err) {
          outcome = { status: 'unknown', reason: `could not read the network: ${err instanceof Error ? err.message : err}` };
        }
        files.push({ ...base, contract: { vout: c.vout, sats: c.value.toString(), refund_after: new Date(c.params.refundTime * 1000).toISOString() }, claim_url: `${origin}/claim/${encodeURIComponent(k)}?net=${meta.net}&txid=${txid}`, ...outcome });
      }
      return json({
        id: meta.id,
        txid,
        cover_choice: choice,
        files,
        note: 'Each file is sealed (AES-256-GCM: "JCE1", a 12-byte iv, the ciphertext with its 16-byte tag). Its key is on chain, in the specialist\'s claim that took the payment out of the contract; sha256(key) equals key_lock. Check sha256 of the sealed file against sealed_sha256, open it with the key, and compare sha256 of the result with the signed offer. A key not there yet: POST claim_url asks the specialist to claim.',
        rejected: d.rejected,
        not_chosen: d.not_chosen,
      });
    }
    return json({
      id: meta.id,
      txid,
      cover_choice: choice,
      files: keys.map((k) => ({
        part: k.startsWith('cover') ? EXAMPLE.choice.apiPart : k === 'logo' ? EXAMPLE.single.apiPart : EXAMPLE.pair.apiPart,
        name: book[k]!.file,
        url: `${origin}/full/${encodeURIComponent(k)}?net=${meta.net}&txid=${txid}`,
        sha256: book[k]!.signed.offer.fileSha256,
      })),
      note: 'Each file is handed over only if this transaction pays its specialist; compare sha256 with the signed offer.',
      rejected: d.rejected,
      not_chosen: d.not_chosen,
    });
  }

  return json({ ok: false, reason: 'unknown action' }, 404);
}

export { bytesToHex };
