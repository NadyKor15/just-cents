// Glue between the animated scene (ui/app.js) and the real order: the scene waits at gates until
// the real preview has arrived and the real check has run, and its texts come from the real verdicts.
import qrcode from 'qrcode-generator';
import { Order, descKey, HELPER, ICON_KEY, type Checked, type Who } from './order';
import { preloadOcr } from './measure';
import { checkLanguage, detectLanguage } from '../core/rules';
import { readOrderId } from '../core/orderid';
import { offerHashHex } from '../core/offer';
import { makeClip } from './clip';
import { zip } from './zip';
import { copyText } from './copy';
import { WalletLink, type WalletState } from '../core/wallet';
import { explorerTx, type Net } from '../core/chain';
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
  all('.tag-sam b').forEach((b) => (b.textContent = 'Lena (demo specialist)'));
  all('.tag-lena b').forEach((b) => (b.textContent = 'Sam (demo specialist)'));
  all('.receipt [data-sam]').forEach((e) => (e.innerHTML = e.dataset.lena ?? e.innerHTML));
}

type GateName = 'icon' | 'descBad' | 'descGood' | 'voice';

let order: Order | null = null;
let gates: Record<GateName, Promise<Checked>> | null = null;
let paid = false;

const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const short = (a: string) => `${a.split(':')[1]!.slice(0, 6)}…${a.slice(-6)}`;

function setTagReason(who: Who, text: string) {
  all(`.tag-${plate(who)} span`).forEach((s) => (s.innerHTML = text.replace(/, /, ',<br>')));
}

/** Description preview: the first sentence in each language and what the language detector says about it. */
function showDescPreview(c: Checked) {
  const firsts = order!.entry(c.key).preview as Record<string, string>;
  all('.t-desc .desc-bar').forEach((bar) => {
    bar.classList.add('has-text');
    bar.innerHTML = '';
    for (const lang of ['es', 'fr', 'de']) {
      const ok = checkLanguage(firsts[lang] ?? '', lang).ok;
      const row = document.createElement('span');
      row.className = `dl${ok ? '' : ' wrong'}`;
      const code = document.createElement('b');
      code.textContent = lang.toUpperCase();
      const text = document.createElement('i');
      text.textContent = ` ${firsts[lang] ?? ''}`;
      row.append(code, text);
      row.title = `${lang.toUpperCase()}: ${firsts[lang]} — detected ${detectLanguage(firsts[lang] ?? '')}`;
      bar.appendChild(row);
    }
  });
}

/** Two icon previews; the person picks one by taste. Only the chosen one gets an output in the payment. */
function showIconChoice(o: Order) {
  const render = () => {
    all('.icon-art').forEach((e) => {
      e.classList.add('two');
      e.innerHTML = '';
      for (const v of ['a', 'b'] as const) {
        const c = o.results[ICON_KEY[v]];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `iv${o.iconChoice === v ? ' on' : ''}`;
        b.setAttribute('aria-pressed', String(o.iconChoice === v));
        b.setAttribute('aria-label', `Icon variant ${v.toUpperCase()}${c && !c.verdict.ok ? ' (rejected)' : ''}`);
        const img = new Image();
        img.src = o.entry(ICON_KEY[v]).preview as string;
        img.alt = '';
        const tag = document.createElement('b');
        tag.textContent = v.toUpperCase();
        b.append(img, tag);
        b.onclick = (ev) => {
          ev.stopPropagation();
          if (paid || o.iconChoice === v || !c?.verdict.ok) return;
          o.iconChoice = v;
          render();
          renderReceiptPrices();
        };
        e.appendChild(b);
      }
    });
    const chosen = o.iconChoice.toUpperCase(), other = o.iconChoice === 'a' ? 'B' : 'A';
    all('.receipt .icon-chosen').forEach((s) => (s.textContent = `Icon (${chosen})`));
    all('.receipt .icon-other').forEach((s) => (s.textContent = `Icon (${other}) not chosen`));
  };
  render();
}

export function showIconPreview(url: string) {
  all('.icon-art').forEach((e) => {
    e.innerHTML = '';
    const img = new Image();
    img.src = url;
    img.alt = 'Icon preview, 128 px, watermarked';
    img.className = 'icon-prev-img';
    e.appendChild(img);
  });
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
export const ASSISTANT_ASK = 'Asking for: a kit to list my game.';
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
  if (Q.get('choice') === 'b') o.iconChoice = 'b';
  const icons = [o.checkIcon('a'), o.checkIcon('b')] as const;
  const icon = Promise.all(icons).then(([a]) => a);
  const descBad = o.checkDescription(careless);
  const descGood = o.checkDescription(other);
  const voice = o.checkVoice();
  icon.then(() => showIconChoice(o)).catch((e) => fail('Icon', e));
  descBad.then((c) => { showDescPreview(c); if (!c.verdict.ok) setTagReason(careless, c.verdict.reason); }).catch((e) => fail('Description', e));
  descGood.catch((e) => fail('Description', e));
  voice.catch((e) => fail('Voice-over', e));
  return { icon, descBad, descGood, voice };
}

/** Start pressed: the helper splits the order and asks the specialists for previews; checks run as they arrive. */
export function start(careless: Who = 'sam'): void {
  preloadOcr();
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
  if (name === 'descGood') return gates.descGood.then((c) => showDescPreview(c), () => undefined);
  return gates[name].then(() => undefined, () => undefined);
}

function cents(key: string): number {
  return OFFERS[NET][key]?.signed.offer.priceCents ?? 0;
}

function renderReceiptPrices() {
  if (!order) return;
  const good = order.careless === 'sam' ? 'lena' : 'sam';
  // once every check has answered, the total counts only accepted pieces; before that, the planned total
  const settled = order.chosenIcon() && order.results[good] && order.results.voice;
  const total = settled ? order.totalCents() : cents('icon') + cents(descKey(good, order.careless)) + cents('voice') + HELPER.cents;
  all('.btn-pay').forEach((b) => (b.textContent = `Pay ${total}¢ once`));
}

/** "Break it yourself": the judge picks who is careless; both descriptions are checked again for real. */
export async function switchCareless(who: Who): Promise<boolean> {
  if (!order || order.careless === who) return false;
  if (paid) {
    toast('A new order starts, so you can pay again.');
    resetPayment();
  }
  // the careless specialist is part of the order id, so another choice is another order (new id);
  // icon and voice checks carry over (same offers), descriptions are checked again below
  const prev = order;
  const fresh = WHO === 'assistant' ? await createByAssistant(who).catch(() => new Order(NET, who)) : new Order(NET, who);
  fresh.iconChoice = prev.iconChoice;
  for (const k of Object.keys(prev.results)) if (k.startsWith('icon') || k === 'voice') fresh.results[k] = prev.results[k]!;
  order = fresh;
  const other: Who = who === 'sam' ? 'lena' : 'sam';
  try {
    const [bad, good] = await Promise.all([order.checkDescription(who), order.checkDescription(other)]);
    if (!bad.verdict.ok) setTagReason(who, bad.verdict.reason);
    if (!good.verdict.ok) toast(`${other}: ${good.verdict.reason}`);
    else showDescPreview(good);
  } catch (e) {
    fail('Description', e);
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
  rows.push(['Helper', short(helperAddr(o.net)), `${HELPER.cents}¢`, '']);
  const rej = o.results[o.careless];
  if (rej && !rej.verdict.ok) rows.splice(1, 0, [`Description (${o.careless === 'sam' ? 'Sam' : 'Lena'}) rejected`, 'no output', '0¢', 'rejected']);
  const other = o.notChosenIcon();
  if (other) rows.splice(1, 0, [`${label(other)} not chosen`, 'no output', '—', 'taste']);
  for (const [a, b, c, kind] of rows) {
    const tr = el('tr', kind);
    const r = [a, b, c];
    r.forEach((v) => tr.appendChild(el('td', '', v)));
    t.appendChild(tr);
  }
  return t;
}

function helperAddr(net: Net): string {
  return PAYOUT.helper[net];
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
  btn.disabled = true;
  btn.textContent = 'Preparing the kit…';
  const files: { name: string; data: Uint8Array }[] = [];
  let icon: Blob | null = null;
  let voice: ArrayBuffer | null = null;
  let texts: Record<string, string> | null = null;
  for (const c of o.accepted()) {
    const li = el('li', 'pending', `${label(c)}: waiting for the specialist`);
    list.appendChild(li);
    try {
      const f = await o.fetchFull(c);
      li.className = f.match && f.verdict.ok ? 'ok' : 'bad';
      li.textContent = `${label(c)}: ${f.match ? 'fingerprint matches the offer' : 'fingerprint does NOT match the offer'} · ${f.verdict.ok ? f.verdict.note : f.verdict.reason}`;
      files.push({ name: f.name, data: new Uint8Array(f.bytes) });
      if (c.key.startsWith('icon')) icon = new Blob([f.bytes], { type: 'image/png' });
      else if (c.key === 'voice') voice = f.bytes;
      else texts = JSON.parse(new TextDecoder().decode(f.bytes));
    } catch (e) {
      li.className = 'bad';
      li.textContent = `${label(c)}: ${e instanceof Error ? e.message : e}`;
    }
  }
  const otherIcon = o.notChosenIcon();
  if (otherIcon) list.appendChild(el('li', 'taste', `${label(otherIcon)}: not chosen (taste, not a rule: it passed the rules, you picked the other one), nothing paid`));
  const rej = o.results[o.careless];
  if (rej && !rej.verdict.ok) list.appendChild(el('li', 'zero', `Description (${o.careless === 'sam' ? 'Sam' : 'Lena'}): rejected, 0¢ (${rej.verdict.reason})`));
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
    helper: { cents: HELPER.cents, sats: HELPER.sats.toString() },
    networkFeeSats: o.payment ? o.payment.fee.toString() : null,
    outputs: o.payment ? o.payment.transaction.outputs.map((x) => x.valueSatoshis.toString()) : null,
    rejected: rej && !rej.verdict.ok ? { part: 'description', specialist: o.careless, cents: 0, reason: rej.verdict.reason } : null,
    note: o.payment?.noteHex,
  };
  files.push({ name: 'receipt.json', data: new TextEncoder().encode(JSON.stringify(receipt, null, 2)) });
  if (icon && voice && texts) {
    const li = el('li', 'pending', 'Clip: the helper is putting it together');
    list.appendChild(li);
    try {
      const t = texts as Record<string, string>;
      const clip = await makeClip(
        { icon, voice, lines: ['es', 'fr', 'de'].map((lang) => ({ lang, text: (t[lang] ?? '').split(/(?<=[.!?])\s/)[0]! })) },
        (p) => (li.textContent = `Clip: the helper is putting it together (${Math.round(p * 100)}%)`),
      );
      files.push({ name: `clip.${clip.ext}`, data: new Uint8Array(await clip.blob.arrayBuffer()) });
      li.className = 'ok';
      li.textContent = `Clip: ${clip.seconds.toFixed(1)} s, made from the accepted parts`;
    } catch (e) {
      li.className = 'bad';
      li.textContent = `Clip: ${e instanceof Error ? e.message : e}`;
    }
  }
  const blob = new Blob([zip(files) as BlobPart], { type: 'application/zip' });
  btn.disabled = false;
  btn.textContent = 'Download kit';
  btn.onclick = () => {
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = `just-cents-kit-${o.id.slice(0, 8)}.zip`;
    a.click();
  };
}

function label(c: Checked): string {
  if (c.key.startsWith('icon')) return `Icon (${c.key === ICON_KEY.a ? 'A' : 'B'})`;
  return c.key === 'voice' ? 'Voice-over' : `Description (${c.who === 'sam' ? 'Sam' : 'Lena'})`;
}

export function currentOrder(): Order | null {
  return order;
}
