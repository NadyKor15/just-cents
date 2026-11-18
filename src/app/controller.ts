// Glue between the animated scene (ui/app.js) and the real order: the scene waits at gates until
// the real preview has arrived and the real check has run, and its texts come from the real verdicts.
// The scene's element names are older than this example: .t-icon holds the cover choice, .t-desc the subtitles,
// .t-voice the logo (gate names likewise: icon → cover, descBad/descGood → subtitles, voice → logo).
import qrcode from 'qrcode-generator';
import { Order, subsKey, SERVICE, COVER_KEY, type Checked, type Who } from './order';
import { EXAMPLE, pairName } from '../data/example';
import { readOrderId } from '../core/orderid';
import { offerHashHex } from '../core/offer';
import { srtToVtt } from '../core/subtitles';
import { zip } from './zip';
import { copyText } from './copy';
import { WalletLink, type WalletState } from '../core/wallet';
import { explorerTx, getRawTx, type Net } from '../core/chain';
import { parseNote } from '../core/tx';
import { checkPaid } from '../core/release';
import { decodeTransaction, hexToBin } from '@bitauth/libauth';
import { OFFERS } from '../data/offers';
import { PAYOUT } from '../config';

const Q = new URLSearchParams(location.search);
/** An order made by an assistant through the API: /?order=<id>. Its network and careless specialist come with it. */
export const FIXED = readOrderId(Q.get('order') ?? '');
export const NET: Net = FIXED ? FIXED.net : Q.get('net') === 'chipnet' ? 'chipnet' : 'mainnet';
/** When the careless one is Lena from the start, the scene's first plate shows Lena (labels swapped). */
const SWAPPED = FIXED?.careless === 'lena';
const plate = (who: Who) => (SWAPPED ? (who === 'lena' ? 'sam' : 'lena') : who);

/** Scene labels for an order whose careless specialist is Lena from the start. */
export function prepareScene(): void {
  if (!FIXED) return;
  all('.brk').forEach((b) => (b.style.display = 'none')); // the order is fixed; the person can still read who failed
  if (!SWAPPED) return;
  all('.tag-sam b').forEach((b) => (b.textContent = `${pairName('lena')} (demo specialist)`));
  all('.tag-lena b').forEach((b) => (b.textContent = `${pairName('sam')} (demo specialist)`));
  all('.receipt [data-sam]').forEach((e) => (e.innerHTML = e.dataset.lena ?? e.innerHTML));
}

type GateName = 'icon' | 'descBad' | 'descGood' | 'voice';

let order: Order | null = null;
let gates: Record<GateName, Promise<Checked>> | null = null;
let paid = false;

const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const short = (a: string) => `${a.split(':')[1]!.slice(0, 6)}…${a.slice(-6)}`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The careless plate's two lines: what was asked, what came. "subtitle 1 starts 1.1 s late" → "line 1 is 1.1 s late". */
export function tagText(reason: string): string {
  const m = /^subtitle (\d+) starts (.+)$/.exec(reason);
  return m ? `asked: on the voice,<br>line ${m[1]} is ${m[2]}` : reason.replace(/, /, ',<br>');
}

function setTagReason(who: Who, reason: string) {
  all(`.tag-${plate(who)} span`).forEach((s) => (s.innerHTML = tagText(reason)));
}

/** Subtitles preview in the tile: the first lines with their times; a line off the voice is marked. */
function showSubsPreview(c: Checked) {
  const lines = c.lines ?? [];
  all('.t-desc .desc-bar').forEach((bar) => {
    bar.classList.add('has-text');
    bar.innerHTML = '';
    lines.slice(0, 2).forEach((l, i) => {
      const row = document.createElement('span');
      row.className = `dl${!c.verdict.ok && i === 0 ? ' wrong' : ''}`;
      const b = document.createElement('b');
      b.textContent = mmss(l.start);
      const t = document.createElement('i');
      t.textContent = ` ${l.text}`;
      row.append(b, t);
      bar.appendChild(row);
    });
    bar.title = `${c.offer.offer.specialist}: first ${lines.length} lines of the SRT. ${c.verdict.ok ? 'On the voice.' : c.verdict.reason}`;
  });
}

/** Two cover previews; the person picks one by taste. Only the chosen one gets an output in the payment. */
function showCoverChoice(o: Order) {
  const render = () => {
    all('.icon-art').forEach((e) => {
      e.classList.add('two', 'cover');
      e.innerHTML = '';
      for (const v of ['a', 'b'] as const) {
        const c = o.results[COVER_KEY[v]];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `iv${o.coverChoice === v ? ' on' : ''}`;
        b.setAttribute('aria-pressed', String(o.coverChoice === v));
        b.setAttribute('aria-label', `${EXAMPLE.choice.label} variant ${v.toUpperCase()}: ${EXAMPLE.choice.variants[v]}${c && !c.verdict.ok ? ' (rejected)' : ''}`);
        const img = new Image();
        img.src = o.entry(COVER_KEY[v]).preview as string;
        img.alt = '';
        const tag = document.createElement('b');
        tag.textContent = v.toUpperCase();
        b.append(img, tag);
        b.onclick = (ev) => {
          ev.stopPropagation();
          if (paid || o.coverChoice === v || !c?.verdict.ok) return;
          o.coverChoice = v;
          render();
          renderReceiptPrices();
        };
        e.appendChild(b);
      }
    });
    const chosen = o.coverChoice.toUpperCase(), other = o.coverChoice === 'a' ? 'B' : 'A';
    all('.receipt .icon-chosen').forEach((s) => (s.textContent = `${EXAMPLE.choice.label} (${chosen})`));
    all('.receipt .icon-other').forEach((s) => (s.textContent = `${EXAMPLE.choice.label} (${other}) not chosen`));
  };
  render();
}

function fail(where: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(where, e);
  toast(`${where}: ${msg}`);
}

export function toast(text: string, ms = 6000) {
  let t = document.querySelector<HTMLElement>('.jc-toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'jc-toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('on');
  clearTimeout((t as unknown as { _h: number })._h);
  (t as unknown as { _h: number })._h = window.setTimeout(() => t!.classList.remove('on'), ms);
}

// ------------------------------------------------------------------ who orders: the person, or their assistant
export type Orderer = 'you' | 'assistant';
/** A link from an assistant (?order=…) opens in assistant mode; ?who=assistant does the same for a fresh order. */
export let WHO: Orderer = FIXED || Q.get('who') === 'assistant' ? 'assistant' : 'you';
export const ASSISTANT_ASK: string = EXAMPLE.assistantAsk;
export const ASSISTANT_PAY = 'Your assistant asked for this; you sign once in your own wallet';
export const ASSISTANT_KIT = 'Your assistant can now fetch the kit';
let youText = '';

/** The switch above the order field. Locked once the order has started. */
export function setWho(w: Orderer): void {
  if (gates) return;
  WHO = w;
  all('.who button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.who === w)));
  all('.order-in').forEach((i) => {
    const input = i as HTMLInputElement;
    if (!youText) youText = input.value;
    input.value = w === 'assistant' ? ASSISTANT_ASK : youText;
    input.readOnly = w === 'assistant';
  });
}

/** The assistant's side: the order is created through the public API, exactly as an assistant would do it. */
async function createByAssistant(careless: Who): Promise<Order> {
  const r = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ network: NET, careless }) });
  const j = (await r.json().catch(() => ({}))) as { id?: string; reason?: string };
  if (!r.ok || !j.id) throw new Error(j.reason ?? `the order API answered ${r.status}`);
  const meta = readOrderId(j.id);
  if (!meta || meta.net !== NET || meta.careless !== careless) throw new Error('the order API returned an order for another network or specialist');
  return new Order(NET, careless, j.id);
}

function runChecks(o: Order, careless: Who) {
  const other: Who = careless === 'sam' ? 'lena' : 'sam';
  if (Q.get('choice') === 'b') o.coverChoice = 'b';
  const covers = [o.checkCover('a'), o.checkCover('b')] as const;
  const icon = Promise.all(covers).then(([a]) => a);
  const descBad = o.checkSubtitles(careless);
  const descGood = o.checkSubtitles(other);
  const voice = o.checkLogo();
  icon.then(() => showCoverChoice(o)).catch((e) => fail(EXAMPLE.choice.label, e));
  descBad.then((c) => { showSubsPreview(c); if (!c.verdict.ok) setTagReason(careless, c.verdict.reason); }).catch((e) => fail(EXAMPLE.pair.label, e));
  descGood.catch((e) => fail(EXAMPLE.pair.label, e));
  voice.catch((e) => fail(EXAMPLE.single.label, e));
  return { icon, descBad, descGood, voice };
}

/** The request was changed: the scene still plays the one example, and one line under the field says so. */
function noteChangedRequest(): void {
  const changed = WHO === 'you' && all('.order-in').some((i) => (i as HTMLInputElement).value.trim() !== EXAMPLE.request);
  all('.demo-note').forEach((n) => (n.hidden = !changed));
}

/** Start pressed: Just Cents splits the order and asks the specialists for previews; checks run as they arrive. */
export function start(careless: Who = 'sam'): void {
  all('.start-hint').forEach((h) => (h.hidden = true));
  noteChangedRequest();
  if (FIXED) careless = FIXED.careless;
  paid = false;
  all('.who button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
  if (WHO === 'assistant' && !FIXED) {
    // same scene, same checks; only the order comes from the API
    const made = createByAssistant(careless).catch((e) => {
      toast(`The order API did not answer (${e instanceof Error ? e.message : e}); this page made the order itself.`, 9000);
      return new Order(NET, careless);
    });
    const checks = made.then((o) => {
      order = o;
      renderReceiptPrices();
      return runChecks(o, careless);
    });
    gates = { icon: checks.then((g) => g.icon), descBad: checks.then((g) => g.descBad), descGood: checks.then((g) => g.descGood), voice: checks.then((g) => g.voice) };
    return;
  }
  order = new Order(NET, careless, FIXED?.id);
  const o = order;
  gates = runChecks(o, careless);
  renderReceiptPrices();
}

/** The scene calls this at each gate; it resolves when the real step is done (never rejects, the scene must not hang). */
export function wait(name: GateName): Promise<void> {
  if (!gates) return Promise.resolve();
  // ?hold=<gate> keeps the scene on that moment (for screenshots and the demo video), e.g. ?hold=descGood shows Sam's rejection
  if (Q.get('hold') === name) return new Promise(() => {});
  // the replacement's preview takes the tile when the scene reaches it
  if (name === 'descGood') return gates.descGood.then((c) => showSubsPreview(c), () => undefined);
  return gates[name].then(() => undefined, () => undefined);
}

function cents(key: string): number {
  return OFFERS[NET][key]?.signed.offer.priceCents ?? 0;
}

function renderReceiptPrices() {
  if (!order) return;
  const good = order.careless === 'sam' ? 'lena' : 'sam';
  // once every check has answered, the total counts only accepted pieces; before that, the planned total
  const settled = order.chosenCover() && order.results[good] && order.results.logo;
  const total = settled ? order.totalCents() : cents(COVER_KEY[order.coverChoice]) + cents(subsKey(good, order.careless)) + cents('logo') + SERVICE.cents;
  all('.btn-pay').forEach((b) => (b.textContent = `Pay ${total}¢ once`));
}

/** "Break it yourself": the judge picks who is careless; both subtitle files are checked again for real. */
export async function switchCareless(who: Who): Promise<boolean> {
  if (!order || order.careless === who) return false;
  if (paid) {
    toast('A new order starts, so you can pay again.');
    resetPayment();
  }
  // the careless specialist is part of the order id, so another choice is another order (new id);
  // cover and logo checks carry over (same offers), subtitles are checked again below
  const prev = order;
  const fresh = WHO === 'assistant' ? await createByAssistant(who).catch(() => new Order(NET, who)) : new Order(NET, who);
  fresh.coverChoice = prev.coverChoice;
  for (const k of Object.keys(prev.results)) if (k.startsWith('cover') || k === 'logo') fresh.results[k] = prev.results[k]!;
  order = fresh;
  const other: Who = who === 'sam' ? 'lena' : 'sam';
  try {
    const [bad, good] = await Promise.all([order.checkSubtitles(who), order.checkSubtitles(other)]);
    if (!bad.verdict.ok) setTagReason(who, bad.verdict.reason);
    if (!good.verdict.ok) toast(`${other}: ${good.verdict.reason}`);
    else showSubsPreview(good);
  } catch (e) {
    fail(EXAMPLE.pair.label, e);
  }
  renderReceiptPrices();
  return true;
}

// ------------------------------------------------------------------ payment
let link: WalletLink | null = null;
let modal: HTMLElement | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function closeModal() {
  modal?.remove();
  modal = null;
}

function payTable(o: Order): HTMLElement {
  const t = el('table', 'jc-paytable');
  // the 4th field is the row's kind: '' paid, 'taste' not chosen (grey, as in the receipt), 'rejected' broke a rule (pink)
  const rows: [string, string, string, string][] = o.accepted().map((c) => [label(c), short(c.offer.offer.payTo), `${c.offer.offer.priceCents}¢`, '']);
  rows.push(['Just Cents service', short(serviceAddr(o.net)), `${SERVICE.cents}¢`, '']);
  const rej = o.results[o.careless];
  if (rej && !rej.verdict.ok) rows.splice(1, 0, [`${EXAMPLE.pair.label} (${pairName(o.careless)}) rejected`, 'no output', '0¢', 'rejected']);
  const other = o.notChosenCover();
  if (other) rows.splice(1, 0, [`${label(other)} not chosen`, 'no output', '—', 'taste']);
  for (const [a, b, c, kind] of rows) {
    const tr = el('tr', kind);
    const r = [a, b, c];
    r.forEach((v) => tr.appendChild(el('td', '', v)));
    t.appendChild(tr);
  }
  return t;
}

function serviceAddr(net: Net): string {
  return PAYOUT.service[net];
}

export function resetPayment() {
  paid = false;
  if (order) order.txid = '';
  all('.txl-pill').forEach((p) => {
    p.textContent = 'link appears after payment';
    p.classList.remove('live');
  });
  document.querySelector('#kit')?.setAttribute('hidden', '');
}

/** Pay pressed: pair a wallet over WizardConnect, build one transaction, let the wallet sign, send it. */
export async function pay(onPaid: () => void): Promise<void> {
  if (!order) return;
  if (paid) {
    document.querySelector('#kit')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const o = order;
  // never build a payment before every check has answered
  if (gates) {
    toast('Checking the last pieces…', 2500);
    await Promise.allSettled(Object.values(gates));
  }
  if (!o.accepted().length) {
    toast('Nothing was accepted, so there is nothing to pay.');
    return;
  }
  closeModal();
  modal = el('div', 'jc-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Pay once');
  const card = el('div', 'jc-card');
  const h = el('h2', '', `Pay ${o.totalCents()}¢ once`);
  const sub = el('p', 'jc-sub', WHO === 'assistant' ? ASSISTANT_PAY : 'Bitcoin Cash · one signature in your own wallet');
  const qr = el('div', 'jc-qr');
  const linkRow = el('div', 'jc-linkrow');
  const copy = el('button', 'jc-btn ghost', 'Copy link');
  const open = el('a', 'jc-btn ghost', 'Open wallet app');
  linkRow.append(copy, open);
  const wallets = el('p', 'jc-wallets', 'Over WizardConnect · tested with Cashonize');
  const status = el('p', 'jc-status', 'Connecting…');
  const close = el('button', 'jc-x', '×');
  close.setAttribute('aria-label', 'Close');
  card.append(close, h, sub, payTable(o), qr, linkRow, wallets, status);
  modal.appendChild(card);
  document.body.appendChild(modal);
  close.onclick = () => {
    link?.close();
    closeModal();
  };
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close.click();
  });

  let busy = false;
  const onState = async (s: WalletState) => {
    if (s.kind === 'waiting-wallet') status.textContent = 'Approve the connection in your wallet';
    if (s.kind === 'closed') status.textContent = `The wallet disconnected${s.message ? `: ${s.message}` : ''}`;
    if (s.kind !== 'connected' || busy) return;
    if (s.net !== o.net) {
      status.textContent = `This wallet is on ${s.net}. This page pays on ${o.net}.`;
      return;
    }
    qr.innerHTML = '';
    linkRow.remove();
    wallets.textContent = `Connected: ${s.walletName ?? 'wallet'}`;
    await run();
  };
  const retry = el('button', 'jc-btn', 'Try again');
  retry.hidden = true;
  card.appendChild(retry);
  retry.onclick = () => void run();
  const run = async () => {
    if (busy) return;
    busy = true;
    retry.hidden = true;
    status.classList.remove('err');
    try {
      const r = await o.pay(link!, (step) => (status.textContent = step));
      paid = true;
      status.textContent = 'Paid. Specialists are handing over the files.';
      setTx(o.net, r.txid);
      // tell the order API, so an assistant waiting on this order can fetch the kit (the server checks the note on chain)
      const reported = reportPaid(o.id, r.txid);
      if (WHO === 'assistant') void reported.then((ok) => showAssistantKit(o.id, ok));
      setTimeout(closeModal, 900);
      onPaid();
      void deliver(o);
    } catch (e) {
      busy = false;
      status.textContent = e instanceof Error ? e.message : String(e);
      status.classList.add('err');
      retry.hidden = false;
    }
  };
  link?.close();
  link = new WalletLink((s) => void onState(s), 'Just Cents', `${location.origin}/assets/sym/s5-icon.png`);
  const { uri, qrUri } = link.open();
  const q = qrcode(0, 'M');
  q.addData(qrUri, 'Alphanumeric');
  q.make();
  qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  open.href = uri;
  copy.onclick = async () => {
    copy.textContent = (await copyText(uri)) ? 'Copied' : 'Could not copy: press and hold the QR or use Open wallet app';
  };
  status.textContent = 'Scan with your wallet, or copy the link into it';
}

/** Tell the order API about the payment; true once the server has checked it on chain and recorded it. */
async function reportPaid(id: string, txid: string): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`/api/orders/${id}/paid`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txid }) });
      if (r.ok) return true;
      if (r.status === 409 || r.status === 400) return false;
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  return false;
}

/** Assistant mode: show what the assistant gets now from GET /api/orders/{id}/kit (the same call it makes). */
async function showAssistantKit(id: string, recorded: boolean) {
  const kit = document.querySelector<HTMLElement>('#kit');
  if (!kit) return;
  let box = kit.querySelector<HTMLElement>('.kit-assistant');
  if (!box) {
    box = el('div', 'kit-assistant');
    kit.insertBefore(box, kit.querySelector('.kit-files'));
  }
  box.innerHTML = '';
  const h = el('h3', '', ASSISTANT_KIT);
  const call = el('p', 'kit-call');
  call.append(el('code', '', `GET /api/orders/${id.slice(0, 8)}…/kit`));
  box.append(h, call);
  if (!recorded) {
    box.append(el('p', 'kit-wait', 'The server has not recorded the payment yet; the assistant will see it once the network has the transaction.'));
    return;
  }
  try {
    const r = await fetch(`/api/orders/${id}/kit`);
    const j = (await r.json()) as { files?: { part: string; name: string; sha256: string }[]; rejected?: unknown; reason?: string };
    if (!r.ok || !j.files) throw new Error(j.reason ?? String(r.status));
    const ul = el('ul', 'kit-api');
    for (const f of j.files) ul.append(el('li', '', `${f.part}: ${f.name} · sha256 ${f.sha256.slice(0, 12)}…`));
    box.append(ul);
  } catch (e) {
    box.append(el('p', 'kit-wait', `The kit call answered: ${e instanceof Error ? e.message : e}`));
  }
}

function setTx(net: Net, txid: string) {
  all('.txl-pill').forEach((p) => {
    p.innerHTML = '';
    const a = el('a', '', `${txid.slice(0, 8)}…${txid.slice(-6)}`);
    a.href = explorerTx(net, txid);
    a.target = '_blank';
    a.rel = 'noopener';
    p.appendChild(a);
    p.classList.add('live');
  });
}

// ------------------------------------------------------------------ delivery
async function deliver(o: Order) {
  const kit = document.querySelector<HTMLElement>('#kit');
  if (!kit) return;
  kit.removeAttribute('hidden');
  const list = kit.querySelector<HTMLElement>('.kit-files')!;
  const btn = kit.querySelector<HTMLButtonElement>('.kit-download')!;
  const tx = kit.querySelector<HTMLAnchorElement>('.kit-tx')!;
  tx.href = explorerTx(o.net, o.txid);
  tx.textContent = o.txid;
  list.innerHTML = '';
  const R = EXAMPLE.ready;
  kit.setAttribute('aria-label', R.title);
  kit.querySelector('.ready-title')!.textContent = R.title;
  for (const [part, caption] of [['trailer', R.trailer], ['cover', R.cover], ['logo', R.logo]] as const) {
    const f = kit.querySelector<HTMLElement>(`.ready-${part}`)!;
    f.hidden = true; // shown only once its accepted file has arrived and passed
    f.querySelector('figcaption')!.textContent = caption;
  }
  btn.disabled = true;
  btn.textContent = 'Preparing the files…';
  const files: { name: string; data: Uint8Array }[] = [];
  for (const c of o.accepted()) {
    const li = el('li', 'pending', `${label(c)}: waiting for the specialist`);
    list.appendChild(li);
    try {
      const f = await o.fetchFull(c);
      li.className = f.match && f.verdict.ok ? 'ok' : 'bad';
      li.textContent = `${label(c)}: ${f.match ? 'fingerprint matches the offer' : 'fingerprint does NOT match the offer'} · ${f.verdict.ok ? f.verdict.note : f.verdict.reason}`;
      files.push({ name: f.name, data: new Uint8Array(f.bytes) });
      if (f.match && f.verdict.ok) showReady(kit, c, f.bytes);
    } catch (e) {
      li.className = 'bad';
      li.textContent = `${label(c)}: ${e instanceof Error ? e.message : e}`;
    }
  }
  const otherCover = o.notChosenCover();
  if (otherCover) list.appendChild(el('li', 'taste', `${label(otherCover)}: not chosen (taste, not a rule: it passed the rules, you picked the other one), nothing paid`));
  const rej = o.results[o.careless];
  if (rej && !rej.verdict.ok) list.appendChild(el('li', 'zero', `${EXAMPLE.pair.label} (${pairName(o.careless)}): rejected, 0¢ (${rej.verdict.reason})`));
  const receipt = {
    order: o.id,
    network: o.net,
    txid: o.txid,
    explorer: explorerTx(o.net, o.txid),
    // what was paid = the outputs of the transaction actually built and signed
    paid: o.accepted().map((c) => ({
      part: c.key,
      specialist: c.offer.offer.specialist,
      cents: c.offer.offer.priceCents,
      sats: c.offer.offer.priceSats,
      payTo: c.offer.offer.payTo,
      offerFingerprint: offerHashHex(c.offer.offer), // as listed (first 16 bytes) in the OP_RETURN note
      fileSha256: c.offer.offer.fileSha256,
    })),
    service: { cents: SERVICE.cents, sats: SERVICE.sats.toString() },
    networkFeeSats: o.payment ? o.payment.fee.toString() : null,
    outputs: o.payment ? o.payment.transaction.outputs.map((x) => x.valueSatoshis.toString()) : null,
    rejected: rej && !rej.verdict.ok ? { part: EXAMPLE.pair.apiPart, specialist: o.careless, cents: 0, reason: rej.verdict.reason } : null,
    note: o.payment?.noteHex,
  };
  files.push({ name: 'receipt.json', data: new TextEncoder().encode(JSON.stringify(receipt, null, 2)) });
  const blob = new Blob([zip(files) as BlobPart], { type: 'application/zip' });
  btn.disabled = false;
  btn.textContent = R.download;
  btn.onclick = () => {
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = `just-cents-${o.id.slice(0, 8)}.zip`;
    a.click();
  };
}

/** One accepted, checked file on the "ready" screen: the subtitles play over the game's trailer, the cover and logo as they are. */
function showReady(kit: HTMLElement, c: Checked, bytes: ArrayBuffer) {
  if (c.key.startsWith('cover') || c.key === 'logo') {
    const fig = kit.querySelector<HTMLElement>(c.key === 'logo' ? '.ready-logo' : '.ready-cover')!;
    const img = fig.querySelector('img')!;
    img.src = URL.createObjectURL(new Blob([bytes], { type: c.key === 'logo' ? 'image/svg+xml' : 'image/jpeg' }));
    img.alt = label(c);
    fig.hidden = false;
    return;
  }
  const fig = kit.querySelector<HTMLElement>('.ready-trailer')!;
  const video = fig.querySelector('video')!;
  video.querySelectorAll('track').forEach((t) => t.remove());
  const track = el('track');
  track.kind = 'subtitles';
  track.srclang = 'en';
  track.label = `English (${pairName(c.who ?? 'sam')})`;
  track.default = true;
  track.src = URL.createObjectURL(new Blob([srtToVtt(new TextDecoder().decode(bytes))], { type: 'text/vtt' }));
  video.appendChild(track);
  video.src = EXAMPLE.trailer.video;
  fig.hidden = false;
}

function label(c: Checked): string {
  if (c.key.startsWith('cover')) return `${EXAMPLE.choice.label} (${c.key === COVER_KEY.a ? 'A' : 'B'})`;
  return c.key === 'logo' ? EXAMPLE.single.label : `${EXAMPLE.pair.label} (${pairName(c.who ?? 'sam')})`;
}

export function currentOrder(): Order | null {
  return order;
}

// ------------------------------------------------------------------ a paid order, without a wallet (/?paid=<txid>)
/**
 * Shows an order someone already paid: the transaction is read from the network, its JC1 note names the order and the
 * offers it lists; a part counts as paid only if the transaction really pays it (same check as the specialists').
 * The files then come from the specialists exactly as after one's own payment, and the "ready" screen fills.
 */
export async function openPaidOrder(txid: string, net: Net): Promise<void> {
  // The ready screen comes up at once, with one line while the order is read, and the page goes there now. Going there
  // only after the files took 6–17 s on a phone, and all that time the page showed Start, as if the scene had reset.
  const reading = showReading(net, txid);
  try {
    const raw = await getRawTx(net, txid);
    const tx = decodeTransaction(hexToBin(raw));
    if (typeof tx === 'string') throw new Error(tx);
    const note = tx.outputs.map((x) => parseNote(x.lockingBytecode)).find((n) => n);
    const meta = note ? readOrderId(note.orderIdHex) : null;
    if (!note || !meta || meta.net !== net) throw new Error('this transaction is not a Just Cents order on this network');
    const o = new Order(net, meta.careless, meta.id);
    for (const [key, e] of Object.entries(OFFERS[net])) {
      const h = offerHashHex(e.signed.offer);
      if (!note.offerPrefixes.includes(h.slice(0, 32))) continue;
      if (!checkPaid(raw, { payTo: e.signed.offer.payTo, minSats: BigInt(e.signed.offer.priceSats), orderIdHex: meta.id, offerHashHex: h }).ok) continue;
      const slot = key.startsWith('cover') ? key : key === 'logo' ? 'logo' : key.split(':')[0]!;
      o.results[slot] = { key, who: key.startsWith('sam') ? 'sam' : key.startsWith('lena') ? 'lena' : undefined, verdict: { ok: true, note: '' }, offer: e.signed, detail: 'paid on chain' };
    }
    if (o.results[COVER_KEY.b]) o.coverChoice = 'b';
    if (!o.accepted().length) throw new Error('this transaction pays none of the current offers');
    // the careless specialist's rejection, checked again on its preview, for the receipt
    await o.checkSubtitles(o.careless).catch(() => undefined);
    // the other cover variant, for "not chosen"
    await o.checkCover(o.coverChoice === 'a' ? 'b' : 'a').catch(() => undefined);
    o.txid = txid;
    order = o;
    paid = true;
    setTx(net, txid);
    await deliver(o);
  } catch (e) {
    if (reading?.isConnected) {
      reading.className = 'bad';
      reading.textContent = `Paid order: ${e instanceof Error ? e.message : e}`;
    }
    fail('Paid order', e);
  }
}

/** The ready screen before anything is known: title, the transaction, one line while the order is read; then go there. */
function showReading(net: Net, txid: string): HTMLElement | null {
  const kit = document.querySelector<HTMLElement>('#kit');
  if (!kit) return null;
  kit.removeAttribute('hidden');
  kit.setAttribute('aria-label', EXAMPLE.ready.title);
  kit.querySelector('.ready-title')!.textContent = EXAMPLE.ready.title;
  kit.querySelectorAll<HTMLElement>('.ready > figure').forEach((f) => (f.hidden = true)); // no empty frames
  const tx = kit.querySelector<HTMLAnchorElement>('.kit-tx')!;
  tx.href = explorerTx(net, txid);
  tx.textContent = txid;
  const list = kit.querySelector<HTMLElement>('.kit-files')!;
  list.innerHTML = '';
  const line = el('li', 'pending', 'Reading the paid order from the network…');
  list.appendChild(line);
  const btn = kit.querySelector<HTMLButtonElement>('.kit-download')!;
  btn.disabled = true;
  btn.textContent = 'Preparing the files…';
  // instant, not smooth: on a phone a smooth scroll here was cut off after ~130 px in 3 runs of 4, leaving the screen
  // below; one more look a moment later, in case the page was still settling (it does not fight someone who scrolled)
  const go = () => kit.scrollIntoView({ block: 'start' });
  requestAnimationFrame(go);
  setTimeout(() => { if (kit.getBoundingClientRect().top > innerHeight / 2) go(); }, 800);
  return line;
}
