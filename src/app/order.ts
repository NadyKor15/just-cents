// One order, end to end: previews → checks against the published rules → one payment → full files.
import { verifyOffer, offerHashHex, type SignedOffer } from '../core/offer';
import { checkDescription, checkIcon, checkVoice, countLetters, checkLanguage, countWords, RULES, type Verdict } from '../core/rules';
import { buildPayment, noteText, type BuiltPayment } from '../core/tx';
import { broadcast, type Net } from '../core/chain';
import type { WalletLink } from '../core/wallet';
import { OFFERS, type OfferEntry } from '../data/offers';
import { PAYOUT } from '../config';
import { audioSeconds, loadImage, readText, sha256Hex } from './measure';

export type Who = 'sam' | 'lena';
export const HELPER = { cents: 1, sats: 4756n }; // 1¢ at $210.27/BCH (CoinGecko, 16.11.2026 22:19Z), fixed with the offers

export type Checked = { key: string; who?: Who; verdict: Verdict; offer: SignedOffer; detail: string };

import { newOrderId } from '../core/orderid';

const nowSec = () => Math.floor(Date.now() / 1000);

export function descKey(who: Who, careless: Who): string {
  return `${who}:${who === careless ? 'careless' : 'good'}`;
}

export class Order {
  readonly id: string;
  readonly results: Record<string, Checked> = {};
  txid = '';
  payment: BuiltPayment | null = null;

  constructor(
    readonly net: Net,
    public careless: Who,
    id?: string,
  ) {
    this.id = id ?? newOrderId(net, careless);
  }

  entry(key: string): OfferEntry {
    const e = OFFERS[this.net]?.[key];
    if (!e) throw new Error(`no offer ${key} on ${this.net}`);
    return e;
  }

  private verify(key: string): SignedOffer {
    const e = this.entry(key);
    const v = verifyOffer(e.signed, { orderId: this.id, nowSec: nowSec() });
    if (!v.ok) throw new Error(`${key}: ${v.reason}`);
    return e.signed;
  }

  async checkIcon(): Promise<Checked> {
    const offer = this.verify('icon');
    const [w, h] = offer.offer.facts.split('x').map(Number) as [number, number];
    const img = await loadImage(this.entry('icon').preview as string);
    const ocr = await readText(img);
    const letters = countLetters(ocr.words);
    const verdict = checkIcon({ width: w, height: h, letters, preview: false });
    const detail = `declared ${w}×${h} (signed); OCR on the ${img.naturalWidth}px preview: ${letters} letters`;
    return (this.results.icon = { key: 'icon', verdict, offer, detail });
  }

  async checkDescription(who: Who): Promise<Checked> {
    const key = descKey(who, this.careless);
    const offer = this.verify(key);
    const firsts = this.entry(key).preview as Record<string, string>;
    const verdict = checkDescription(firsts, { full: false });
    const detail = RULES.description.languages.map((l) => `${l}: ${checkLanguage(firsts[l] ?? '', l).ok ? 'ok' : 'wrong'}`).join(', ');
    return (this.results[who] = { key, who, verdict, offer, detail });
  }

  async checkVoice(): Promise<Checked> {
    const offer = this.verify('voice');
    const declared = parseFloat(offer.offer.facts);
    const preview = await (await fetch(this.entry('voice').preview as string)).arrayBuffer();
    const prevSec = await audioSeconds(preview);
    const verdict = checkVoice({ seconds: declared, preview: false });
    const detail = `declared ${declared} s (signed); preview plays ${prevSec.toFixed(1)} s`;
    return (this.results.voice = { key: 'voice', verdict, offer, detail });
  }

  /** The specialist that ended up accepted for the description. */
  goodWho(): Who {
    return this.careless === 'sam' ? 'lena' : 'sam';
  }

  accepted(): Checked[] {
    return [this.results.icon, this.results[this.goodWho()], this.results.voice].filter((c): c is Checked => !!c && c.verdict.ok);
  }

  totalCents(): number {
    return this.accepted().reduce((s, c) => s + c.offer.offer.priceCents, 0) + (this.accepted().length ? HELPER.cents : 0);
  }

  async pay(link: WalletLink, step: (s: string) => void): Promise<{ txid: string; payment: BuiltPayment }> {
    const acc = this.accepted();
    if (!acc.length) throw new Error('nothing was accepted, nothing to pay');
    step('Looking for coins in your wallet');
    const coins = await link.coins(this.net);
    if (!coins.length) throw new Error('Your wallet has no coins on the addresses it shared.');
    const payouts = acc.map((c) => ({ label: c.key, address: c.offer.offer.payTo, sats: BigInt(c.offer.offer.priceSats) }));
    payouts.push({ label: 'helper', address: PAYOUT.helper[this.net], sats: HELPER.sats });
    const p = buildPayment({ utxos: coins, payouts, note: noteText(this.id, acc.map((c) => offerHashHex(c.offer.offer))) });
    this.payment = p;
    step('Confirm in your wallet');
    const signed = await link.sign(p, `Just Cents: pay ${acc.length} specialist${acc.length > 1 ? 's' : ''} + helper`);
    if (!signed.ok) throw new Error(`Wallet: ${signed.error}`);
    step('Sending');
    const b = await broadcast(this.net, signed.signedHex);
    if (!b.ok) throw new Error(`Network: ${b.nodeError}`);
    this.txid = b.txid;
    return { txid: b.txid, payment: p };
  }

  /** Ask each accepted specialist for the full file, check its fingerprint, then re-check the rules on the full file. */
  async fetchFull(c: Checked): Promise<{ bytes: ArrayBuffer; name: string; match: boolean; verdict: Verdict }> {
    const r = await fetch(`/full/${encodeURIComponent(c.key)}?net=${this.net}&txid=${this.txid}`);
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { reason?: string };
      throw new Error(`${c.key}: ${j.reason ?? r.status}`);
    }
    const bytes = await r.arrayBuffer();
    const match = (await sha256Hex(bytes)) === c.offer.offer.fileSha256;
    let verdict: Verdict;
    if (c.key === 'icon') {
      const img = await loadImage(new Blob([bytes], { type: 'image/png' }));
      const ocr = await readText(img);
      verdict = checkIcon({ width: img.naturalWidth, height: img.naturalHeight, letters: countLetters(ocr.words), preview: false });
    } else if (c.key === 'voice') {
      verdict = checkVoice({ seconds: await audioSeconds(bytes), preview: false });
    } else {
      const texts = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>;
      verdict = checkDescription(texts, { full: true });
      if (verdict.ok) verdict = { ok: true, note: `${verdict.note}; ${RULES.description.languages.map((l) => countWords(texts[l]!)).join('/')} words` };
    }
    return { bytes, name: this.entry(c.key).file, match, verdict };
  }
}
