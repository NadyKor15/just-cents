// One order, end to end: previews → checks against the published rules → one payment → full files.
import { verifyOffer, offerHashHex, type SignedOffer } from '../core/offer';
import { checkCoverDeclared, checkLogoDeclared, checkSubtitlesDeclared, type Verdict } from '../core/rules';
import { checkSubtitles, parseSrt, type Speech } from '../core/subtitles';
import { checkCover, measureCover } from '../core/cover';
import { checkLogo } from '../core/logo';
import { likeness } from '../core/image';
import { buildPayment, noteText, type BuiltPayment } from '../core/tx';
import { broadcast, type Net } from '../core/chain';
import type { WalletLink } from '../core/wallet';
import { OFFERS, type OfferEntry } from '../data/offers';
import { EXAMPLE } from '../data/example';
import TRAILER_WORDS from '../data/trailer-words.json';
import { PAYOUT } from '../config';
import { drawing, pixels, sha256Hex } from './measure';
import { newOrderId } from '../core/orderid';
import { txidOf } from '../core/release';
import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';

export type Who = 'sam' | 'lena';
export type CoverChoice = 'a' | 'b';
/** Offer keys of the two cover variants (variant A keeps the plain key). */
export const COVER_KEY: Record<CoverChoice, string> = { a: 'cover', b: 'cover:b' };
export const SERVICE = { cents: 1, sats: 4756n }; // Just Cents' own 1¢ for matching and checks; at $210.27/BCH (CoinGecko, 16.11.2026 22:19Z), fixed with the offers

/** The trailer's spoken words with their times: the yardstick for subtitle timing. */
export const SPEECH = TRAILER_WORDS as unknown as Speech;

export type Checked = {
  key: string;
  who?: Who;
  verdict: Verdict;
  offer: SignedOffer;
  detail: string;
  /** subtitles: the preview's lines, for the scene */
  lines?: { start: number; text: string }[];
};

const nowSec = () => Math.floor(Date.now() / 1000);

export function subsKey(who: Who, careless: Who): string {
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

  /** Which cover variant the person picked (taste); both are checked by the same rules. */
  coverChoice: CoverChoice = 'a';

  /** Cover: size, proportions and file size as signed; sharpness is measured on the full file after payment. */
  async checkCover(variant: CoverChoice = 'a'): Promise<Checked> {
    const key = COVER_KEY[variant];
    const offer = this.verify(key);
    const verdict = checkCoverDeclared(offer.offer.facts, EXAMPLE.choice.frameSize);
    const detail = `declared ${offer.offer.facts.split(';')[0]} (signed); the full file is measured after payment`;
    return (this.results[key] = { key, verdict, offer, detail });
  }

  chosenCover(): Checked | undefined {
    return this.results[COVER_KEY[this.coverChoice]];
  }

  notChosenCover(): Checked | undefined {
    return this.results[COVER_KEY[this.coverChoice === 'a' ? 'b' : 'a']];
  }

  /** Subtitles by Sam or Lena: the first line as signed, then the preview's first lines against the spoken words. */
  async checkSubtitles(who: Who): Promise<Checked> {
    const key = subsKey(who, this.careless);
    const offer = this.verify(key);
    let verdict = checkSubtitlesDeclared(offer.offer.facts, SPEECH);
    const text = await (await fetch(this.entry(key).preview as string)).text();
    const p = parseSrt(text);
    if (verdict.ok) verdict = checkSubtitles(text, SPEECH);
    const lines = p.ok ? p.cues.map((c) => ({ start: c.start, text: c.lines.join(' ') })) : [];
    const detail = `declared first line at ${offer.offer.facts.split(';')[2]} s (signed); ${lines.length} lines of the preview checked against the trailer's words`;
    return (this.results[who] = { key, who, verdict, offer, detail, lines });
  }

  async checkLogo(): Promise<Checked> {
    const offer = this.verify('logo');
    const verdict = checkLogoDeclared(offer.offer.facts);
    return (this.results.logo = { key: 'logo', verdict, offer, detail: `declared ${offer.offer.facts} (signed); likeness to the sketch is measured after payment` });
  }

  /** The subtitles specialist that ended up accepted. */
  goodWho(): Who {
    return this.careless === 'sam' ? 'lena' : 'sam';
  }

  accepted(): Checked[] {
    return [this.chosenCover(), this.results[this.goodWho()], this.results.logo].filter((c): c is Checked => !!c && c.verdict.ok);
  }

  totalCents(): number {
    return this.accepted().reduce((s, c) => s + c.offer.offer.priceCents, 0) + (this.accepted().length ? SERVICE.cents : 0);
  }

  /** The transaction the wallet signed; kept so a retry sends THIS one again instead of paying twice. */
  signedHex = '';

  async pay(link: WalletLink, step: (s: string) => void): Promise<{ txid: string; payment: BuiltPayment }> {
    if (!this.signedHex) {
      const acc = this.accepted();
      if (!acc.length) throw new Error('nothing was accepted, nothing to pay');
      step('Looking for coins in your wallet');
      const coins = await link.coins(this.net);
      if (!coins.length) throw new Error('Your wallet has no coins on the addresses it shared.');
      const payouts = acc.map((c) => ({ label: c.key, address: c.offer.offer.payTo, sats: BigInt(c.offer.offer.priceSats) }));
      payouts.push({ label: 'service', address: PAYOUT.service[this.net], sats: SERVICE.sats });
      const p = buildPayment({ utxos: coins, payouts, note: noteText(this.id, acc.map((c) => offerHashHex(c.offer.offer))) });
      this.payment = p;
      step('Confirm in your wallet');
      const signed = await link.sign(p, `Just Cents: pay ${acc.length} specialist${acc.length > 1 ? 's' : ''} + service`);
      if (!signed.ok) throw new Error(`Wallet: ${signed.error}`);
      // the wallet must sign exactly what was built: same outputs, same inputs
      const got = decodeTransaction(hexToBin(signed.signedHex));
      if (typeof got === 'string') throw new Error(`Wallet returned an unreadable transaction: ${got}`);
      const same =
        got.outputs.length === p.transaction.outputs.length &&
        got.outputs.every((o, i) => o.valueSatoshis === p.transaction.outputs[i]!.valueSatoshis && binToHex(o.lockingBytecode) === binToHex(p.transaction.outputs[i]!.lockingBytecode)) &&
        got.inputs.length === p.transaction.inputs.length;
      if (!same) throw new Error('Wallet returned a different transaction than the one built; nothing was sent.');
      this.signedHex = signed.signedHex;
    }
    step('Sending');
    const txid = txidOf(this.signedHex); // from the signed bytes, never from a server's answer
    const b = await broadcast(this.net, this.signedHex);
    if (!b.ok) throw new Error(`Network: ${b.nodeError}`);
    this.txid = txid;
    return { txid, payment: this.payment! };
  }

  /** Ask each accepted specialist for the full file, check its fingerprint, then check the rules on the full file. */
  async fetchFull(c: Checked): Promise<{ bytes: ArrayBuffer; name: string; match: boolean; verdict: Verdict }> {
    const r = await fetch(`/full/${encodeURIComponent(c.key)}?net=${this.net}&txid=${this.txid}`);
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { reason?: string };
      throw new Error(`${c.key}: ${j.reason ?? r.status}`);
    }
    const bytes = await r.arrayBuffer();
    const match = (await sha256Hex(bytes)) === c.offer.offer.fileSha256;
    return { bytes, name: this.entry(c.key).file, match, verdict: await checkFull(c.key, bytes) };
  }
}

/** The rules on a full file, as delivered. */
export async function checkFull(key: string, bytes: ArrayBuffer): Promise<Verdict> {
  if (key.startsWith('cover')) {
    const frameUrl = key === COVER_KEY.b ? EXAMPLE.choice.frames.b : EXAMPLE.choice.frames.a;
    const [cover, frame] = await Promise.all([pixels(new Blob([bytes], { type: 'image/jpeg' })), pixels(frameUrl)]);
    return checkCover(measureCover({ ...cover, bytes: bytes.byteLength }, frame), frame);
  }
  if (key === 'logo') {
    const svg = new TextDecoder().decode(bytes);
    const [traced, sketch] = await Promise.all([drawing(new Blob([bytes], { type: 'image/svg+xml' })), drawing(EXAMPLE.single.sketch)]);
    return checkLogo(svg, likeness(sketch, traced));
  }
  return checkSubtitles(new TextDecoder().decode(bytes), SPEECH);
}
