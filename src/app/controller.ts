// Glue between the animated scene (ui/app.js) and the real order: the scene waits at gates until
// the real preview has arrived and the real check has run, and its texts come from the real verdicts.
import qrcode from 'qrcode-generator';
import { Order, descKey, HELPER, type Checked, type Who } from './order';
import { preloadOcr } from './measure';
import { checkLanguage, detectLanguage } from '../core/rules';
import { readOrderId } from '../core/orderid';
import { makeClip } from './clip';
import { zip } from './zip';
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

function showIconPreview(url: string) {
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

/** Start pressed: the helper splits the order and asks the specialists for previews; checks run as they arrive. */
export function start(careless: Who = 'sam'): void {
  preloadOcr();
  if (FIXED) careless = FIXED.careless;
  order = new Order(NET, careless, FIXED?.id);
  paid = false;
  const o = order;
  const other: Who = careless === 'sam' ? 'lena' : 'sam';
  const icon = o.checkIcon();
  const descBad = o.checkDescription(careless);
  const descGood = o.checkDescription(other);
  const voice = o.checkVoice();
  icon.then(() => showIconPreview(o.entry('icon').preview as string)).catch((e) => fail('Icon', e));
  descBad.then((c) => { showDescPreview(c); if (!c.verdict.ok) setTagReason(careless, c.verdict.reason); }).catch((e) => fail('Description', e));
  descGood.catch((e) => fail('Description', e));
  voice.catch((e) => fail('Voice-over', e));
  gates = { icon, descBad, descGood, voice };
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
  const total = cents('icon') + cents(descKey(good, order.careless)) + cents('voice') + HELPER.cents;
  all('.btn-pay').forEach((b) => (b.textContent = `Pay ${total}¢ once`));
}

/** "Break it yourself": the judge picks who is careless; both descriptions are checked again for real. */
export async function switchCareless(who: Who): Promise<boolean> {
  if (!order || order.careless === who) return false;
  if (paid) {
    toast('A new order starts, so you can pay again.');
    resetPayment();
  }
  order.careless = who;
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
  const rows: [string, string, string][] = o.accepted().map((c) => [
    c.key === 'icon' ? 'Icon' : c.key === 'voice' ? 'Voice-over' : `Description (${c.who === 'sam' ? 'Sam' : 'Lena'})`,
    short(c.offer.offer.payTo),
    `${c.offer.offer.priceCents}¢`,
  ]);
  rows.push(['Helper', short(helperAddr(o.net)), `${HELPER.cents}¢`]);
  const rej = o.results[o.careless];
  if (rej && !rej.verdict.ok) rows.splice(1, 0, [`Description (${o.careless === 'sam' ? 'Sam' : 'Lena'}) rejected`, 'no output', '0¢']);
  for (const r of rows) {
    const tr = el('tr');
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
  const sub = el('p', 'jc-sub', 'Bitcoin Cash · one signature in your own wallet');
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
      void reportPaid(o.id, r.txid);
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
    await navigator.clipboard.writeText(uri).catch(() => {});
    copy.textContent = 'Copied';
  };
  status.textContent = 'Scan with your wallet, or copy the link into it';
}

async function reportPaid(id: string, txid: string) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`/api/orders/${id}/paid`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txid }) });
      if (r.ok || r.status === 409) return;
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
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
      if (c.key === 'icon') icon = new Blob([f.bytes], { type: 'image/png' });
      else if (c.key === 'voice') voice = f.bytes;
      else texts = JSON.parse(new TextDecoder().decode(f.bytes));
    } catch (e) {
      li.className = 'bad';
      li.textContent = `${label(c)}: ${e instanceof Error ? e.message : e}`;
    }
  }
  const rej = o.results[o.careless];
  if (rej && !rej.verdict.ok) list.appendChild(el('li', 'zero', `Description (${o.careless === 'sam' ? 'Sam' : 'Lena'}): rejected, 0¢ (${rej.verdict.reason})`));
  const receipt = {
    order: o.id,
    network: o.net,
    txid: o.txid,
    explorer: explorerTx(o.net, o.txid),
    paid: o.accepted().map((c) => ({ part: c.key, specialist: c.offer.offer.specialist, cents: c.offer.offer.priceCents, sats: c.offer.offer.priceSats, payTo: c.offer.offer.payTo, offerFingerprint: c.offer.offer.fileSha256 })),
    helper: { cents: HELPER.cents, sats: HELPER.sats.toString() },
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
  return c.key === 'icon' ? 'Icon' : c.key === 'voice' ? 'Voice-over' : `Description (${c.who === 'sam' ? 'Sam' : 'Lena'})`;
}

export function currentOrder(): Order | null {
  return order;
}
