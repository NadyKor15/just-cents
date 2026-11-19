// One order, end to end: previews → checks against the published rules → one payment → full files.
// v2 (hash-lock): the payment puts each accepted specialist's money into its own contract; the specialist opens it by
// revealing its file key on chain; the page reads that key from the chain and opens the sealed file it fetched and
// checked before paying. Orders paid before v2 (a JC1 note) are still read and delivered the v1 way (/full/).
import { verifyOffer, verifyOffer2, offerHashHex, type SignedOffer } from '../core/offer';
import { checkCoverDeclared, checkLogoDeclared, checkSubtitlesDeclared, type Verdict } from '../core/rules';
import { checkSubtitles, parseSrt, type Speech } from '../core/subtitles';
import { checkCover, measureCover } from '../core/cover';
import { checkLogo } from '../core/logo';
import { likeness } from '../core/image';
import { buildPayment2, type BuiltPayment, type BuiltPayment2 } from '../core/tx';
import { broadcast, getRawTx, type Net } from '../core/chain';
import { buildRefund, canRefund, readSpend, unhex, type LockParams } from '../core/htlc';
import { chainTime, contractState, refundTimeFromNow } from '../core/htlc-chain';
import { openFile } from '../core/filebox';
import type { WalletLink } from '../core/wallet';
import { OFFERS, type OfferEntry, type OfferEntry2 } from '../data/offers';
import { EXAMPLE } from '../data/example';
import TRAILER_WORDS from '../data/trailer-words.json';
import { PAYOUT } from '../config';
import { drawing, pixels, sha256Hex } from './measure';
import { newOrderId } from '../core/orderid';
import { txidOf } from '../core/release';
import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';

/** One accepted specialist's contract in a v2 payment: where the money sits until the key is on chain. */
export type Contract = { key: string; vout: number; sats: bigint; params: LockParams; lockingHex: string };

/** What a delivered file comes with. */
export type Delivered = { bytes: ArrayBuffer; name: string; match: boolean; verdict: Verdict; claimTxid?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  /** v2: the contracts of this order's payment, by offer key (from the payment built here, or read from the chain). */
  contracts: Record<string, Contract> = {};
  /** v1: an order paid before contracts (JC1 note), read from the chain; its files come through /full/. */
  legacy = false;
  private sealedFiles = new Map<string, Promise<Uint8Array>>();

  v2(key: string): OfferEntry2 {
    const e = this.entry(key).v2;
    if (!e) throw new Error(`${key}: no v2 offer on ${this.net}`);
    return e;
  }

  /**
   * The sealed full file, fetched from the site and checked against the signed v2 offer. The page holds it before it
   * pays: after the payment the specialist can only reveal the key, it cannot swap the file.
   */
  sealedFile(key: string): Promise<Uint8Array> {
    let p = this.sealedFiles.get(key);
    if (!p) {
      const e = this.v2(key);
      p = (async () => {
        const r = await fetch(e.sealed);
        if (!r.ok) throw new Error(`${key}: the sealed file did not load (${r.status})`);
        const bytes = await r.arrayBuffer();
        if ((await sha256Hex(bytes)) !== e.signed.offer.cipherSha256) throw new Error(`${key}: the sealed file is not the one the offer names`);
        return new Uint8Array(bytes);
      })();
      p.catch(() => this.sealedFiles.delete(key));
      this.sealedFiles.set(key, p);
    }
    return p;
  }

  /** The v2 offer must promise the same as the v1 offer the checks ran on, and be signed by the same key. */
  private checkV2(c: Checked): void {
    const e = this.v2(c.key);
    const v = verifyOffer2(e.signed, { orderId: this.id, nowSec: nowSec(), pubkey: c.offer.offer.pubkey });
    if (!v.ok) throw new Error(`${c.key}: ${v.reason}`);
    const a = c.offer.offer, b = e.signed.offer;
    if (a.fileSha256 !== b.fileSha256 || a.priceSats !== b.priceSats || a.payTo !== b.payTo || a.facts !== b.facts) throw new Error(`${c.key}: the v2 offer promises something else than the checked offer`);
  }

  async pay(link: WalletLink, step: (s: string) => void): Promise<{ txid: string; payment: BuiltPayment }> {
    if (!this.signedHex) {
      const acc = this.accepted();
      if (!acc.length) throw new Error('nothing was accepted, nothing to pay');
      for (const c of acc) this.checkV2(c);
      step('Fetching the sealed files');
      await Promise.all(acc.map((c) => this.sealedFile(c.key)));
      step('Looking for coins in your wallet');
      const coins = await link.coins(this.net);
      if (!coins.length) throw new Error('Your wallet has no coins on the addresses it shared.');
      step('Reading the network time');
      const refundTime = await refundTimeFromNow(this.net);
      const p: BuiltPayment2 = buildPayment2({
        utxos: coins,
        contracts: acc.map((c) => {
          const o = this.v2(c.key).signed.offer;
          return { label: c.key, priceSats: BigInt(o.priceSats), lock: { cipherSha256: o.cipherSha256, keyHash: o.keyHash, sellerPubkey: o.claimPubkey } };
        }),
        payouts: [{ label: 'service', address: PAYOUT.service[this.net], sats: SERVICE.sats }],
        orderIdHex: this.id,
        offerHashesHex: acc.map((c) => this.v2(c.key).offerHashHex),
        refundTime,
      });
      this.payment = p;
      this.contracts = Object.fromEntries(p.contracts.map((c) => [c.label, { key: c.label, vout: c.vout, sats: c.sats, params: c.params, lockingHex: c.lockingHex }]));
      this.onBuilt?.(p);
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

  /** Called once the v2 payment is built, before the wallet signs: the page shows the contract addresses to compare. */
  onBuilt?: (p: BuiltPayment2) => void;

  /** The accepted file, delivered and checked: v2 (key from the chain, sealed file) or, for an older order, v1 (/full/). */
  async deliverFile(c: Checked, chainFirst = false): Promise<Delivered> {
    if (this.legacy) return this.fetchFull(c);
    const { key, claimTxid } = await this.obtainKey(c.key, chainFirst);
    const plain = await openFile(key, await this.sealedFile(c.key));
    const bytes = plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer;
    const match = (await sha256Hex(bytes)) === c.offer.offer.fileSha256;
    return { bytes, name: this.entry(c.key).file, match, verdict: await checkFull(c.key, bytes), claimTxid };
  }

  /** The cover's light copy, for display while the full file is checked: v2 opens it with the cover's key. */
  async lightCopy(c: Checked): Promise<Blob> {
    if (this.legacy) {
      const r = await fetch(`/full/${encodeURIComponent(c.key)}?net=${this.net}&txid=${this.txid}&view=light`);
      if (!r.ok) throw new Error(String(r.status));
      return r.blob();
    }
    const path = this.v2(c.key).sealedLight;
    if (!path) throw new Error('no light copy');
    const [{ key }, r] = await Promise.all([this.obtainKey(c.key, true), fetch(path)]);
    if (!r.ok) throw new Error(String(r.status));
    return new Blob([(await openFile(key, new Uint8Array(await r.arrayBuffer()))) as BlobPart], { type: 'image/jpeg' });
  }

  private keys = new Map<string, Promise<{ key: Uint8Array; claimTxid: string }>>();

  /**
   * The file key of one accepted part, always taken from the chain: the input of the claim that spent this part's
   * contract, checked against the contract's lock. The specialist is asked to claim (POST /claim/…, the same request
   * gives the same claim, so asking again is safe); its answer only names the claim, the key is read from the network.
   * chainFirst: look on the chain before asking (an order paid earlier, perhaps on another device).
   */
  obtainKey(key: string, chainFirst = false): Promise<{ key: Uint8Array; claimTxid: string }> {
    let p = this.keys.get(key);
    if (!p) {
      p = this.findKey(key, chainFirst);
      p.catch(() => this.keys.delete(key));
      this.keys.set(key, p);
    }
    return p;
  }

  /** Why a part's key is not there yet (shown, and used to offer a refund). */
  stalled: Record<string, string> = {};

  private async findKey(key: string, chainFirst: boolean): Promise<{ key: Uint8Array; claimTxid: string }> {
    const k = this.contracts[key];
    if (!k) throw new Error(`${key}: no contract for this part in the payment`);
    const outpoint = { txid: this.txid, vout: k.vout };
    const fromChain = async (): Promise<{ key: Uint8Array; claimTxid: string } | null> => {
      const st = await contractState(this.net, unhex(k.lockingHex), outpoint);
      if (st.state === 'claimed' && st.kind === 'claim') return { key: st.key, claimTxid: st.txid };
      if (st.state === 'refunded') throw new Error('the money went back to the buyer; the specialist did not open its contract');
      return null;
    };
    if (chainFirst) {
      const got = await fromChain().catch((e: Error) => (/went back/.test(e.message) ? Promise.reject(e) : null));
      if (got) return got;
    }
    let lastReason = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      let claimTxid = '';
      try {
        const r = await fetch(`/claim/${encodeURIComponent(key)}?net=${this.net}&txid=${this.txid}`, { method: 'POST' });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; claimTxid?: string; reason?: string };
        if (r.ok && j.claimTxid) claimTxid = j.claimTxid;
        else {
          lastReason = j.reason ?? `the specialist answered ${r.status}`;
          // too late to reveal the key, or the contract is already spent: asking again will not change it
          if (r.status === 409) break;
        }
      } catch (e) {
        lastReason = `the specialist did not answer (${e instanceof Error ? e.message : e})`;
      }
      if (claimTxid) {
        // the key from the claim on the network, never from the answer
        for (let i = 0; i < 6; i++) {
          const raw = await getRawTx(this.net, claimTxid).catch(() => '');
          const s = raw ? readSpend(unhex(raw), outpoint) : null;
          if (s?.kind === 'claim') return { key: s.key, claimTxid };
          if (raw) throw new Error(`${key}: the claim ${claimTxid.slice(0, 8)}… does not open this contract`);
          await sleep(1500);
        }
        lastReason = 'the network does not show the claim yet';
      }
      await sleep(1500 * (attempt + 1));
    }
    // the specialist may still have claimed by itself: one last look on the chain
    const got = await fromChain().catch(() => null);
    if (got) return got;
    this.stalled[key] = lastReason;
    throw new Error(lastReason || 'the specialist has not opened its contract');
  }

  /** Contracts of this order still holding money (not claimed, not refunded), read from the chain. */
  async openContracts(): Promise<Contract[]> {
    const out: Contract[] = [];
    for (const k of Object.values(this.contracts)) {
      const st = await contractState(this.net, unhex(k.lockingHex), { txid: this.txid, vout: k.vout }).catch(() => null);
      if (st?.state === 'open') out.push(k);
    }
    return out;
  }

  /** The refund of every open contract, once the network's time has passed their refund time. No signature. */
  async refund(contracts: Contract[]): Promise<{ ok: true; txid: string; sats: bigint } | { ok: false; reason: string; refundTime?: number }> {
    if (!contracts.length) return { ok: false, reason: 'nothing to refund' };
    const when = Math.max(...contracts.map((c) => c.params.refundTime));
    const mtp = await chainTime(this.net);
    if (!canRefund(mtp, when)) return { ok: false, reason: 'not yet', refundTime: when };
    const r = buildRefund({ contracts: contracts.map((c) => ({ txid: this.txid, vout: c.vout, value: c.sats, params: c.params })) });
    const b = await broadcast(this.net, r.hex);
    if (!b.ok) return { ok: false, reason: b.nodeError, refundTime: when };
    return { ok: true, txid: r.txid, sats: r.tx.outputs.reduce((s, o) => s + o.value, 0n) };
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
