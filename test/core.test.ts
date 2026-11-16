import { describe, expect, it } from 'vitest';
import {
  binToHex,
  decodeTransaction,
  encodeTransaction,
  hash160,
  hexToBin,
  encodeCashAddress,
  secp256k1,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import { buildPayment, DUST_SATS, estimateSize, lockingFor, noteText, opReturnBytecode, parseNote, MAX_OP_RETURN_BYTES, type Utxo } from '../src/core/tx';
import { ANY_ORDER, offerHashHex, signOffer, verifyOffer, type Offer } from '../src/core/offer';
import { checkPaid, txidOf } from '../src/core/release';
import { signLocally } from './helpers/signer';
import { checkDescription, checkIcon, checkLanguage, checkVoice, countLetters, detectLanguage } from '../src/core/rules';

function keyAddr(seed: number, prefix: 'bitcoincash' | 'bchtest' = 'bchtest') {
  const priv = sha256.hash(utf8ToBin(`test-key-${seed}`));
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const address = encodeCashAddress({ prefix, type: 'p2pkh', payload: hash160(pub) }).address;
  return { priv, pub, address };
}

const ORDER = '00112233445566778899aabbccddeeff';
const wallet = keyAddr(1);
const coin = (sats: bigint, n = 0): Utxo => ({
  txid: binToHex(sha256.hash(utf8ToBin(`coin-${n}`))),
  vout: n,
  sats,
  lockingBytecode: lockingFor(wallet.address),
  path: 'receive',
  index: n,
});

describe('note (OP_RETURN)', () => {
  it('round-trips and stays under the relay limit with 4 offers', () => {
    const hashes = [1, 2, 3, 4].map((i) => binToHex(sha256.hash(utf8ToBin(`o${i}`))));
    const text = noteText(ORDER, hashes);
    const script = opReturnBytecode(text);
    expect(script.length).toBeLessThanOrEqual(MAX_OP_RETURN_BYTES);
    const back = parseNote(script)!;
    expect(back.orderIdHex).toBe(ORDER);
    expect(back.offerPrefixes).toEqual(hashes.map((h) => h.slice(0, 32)));
  });
  it('rejects malformed ids', () => {
    expect(() => noteText('xyz', [])).toThrow();
  });
  it('ignores foreign OP_RETURN', () => {
    expect(parseNote(opReturnBytecode('hello world'))).toBeNull();
    expect(parseNote(lockingFor(wallet.address))).toBeNull();
  });
});

describe('payment transaction', () => {
  const payees = [2, 3, 4, 5].map((i) => keyAddr(i));
  const payouts = [
    { label: 'Icon', address: payees[0]!.address, sats: 14000n },
    { label: 'Description (Lena)', address: payees[1]!.address, sats: 9500n },
    { label: 'Voice-over', address: payees[2]!.address, sats: 9500n },
    { label: 'Helper', address: payees[3]!.address, sats: 4800n },
  ];
  const note = noteText(ORDER, [1, 2, 3].map((i) => binToHex(sha256.hash(utf8ToBin(`o${i}`)))));

  it('has one output per accepted payee, the note, and change; values add up', () => {
    const p = buildPayment({ utxos: [coin(100000n)], payouts, note });
    const outs = p.transaction.outputs;
    expect(outs.length).toBe(6); // 4 payees + OP_RETURN + change
    expect(outs.slice(0, 4).map((o) => o.valueSatoshis)).toEqual(payouts.map((x) => x.sats));
    expect(outs[4]!.valueSatoshis).toBe(0n);
    expect(binToHex(outs[4]!.lockingBytecode)).toBe(p.noteHex);
    expect(binToHex(outs[5]!.lockingBytecode)).toBe(binToHex(lockingFor(wallet.address)));
    const totalOut = outs.reduce((s, o) => s + o.valueSatoshis, 0n);
    expect(100000n - totalOut).toBe(p.fee);
    expect(p.fee).toBe(BigInt(p.size));
    expect(p.inputPaths).toEqual([[0, 'receive', 0]]);
  });

  it('fee is 1 sat/byte of the signed size (unsigned size + signature bytes)', () => {
    const p = buildPayment({ utxos: [coin(100000n)], payouts, note });
    const unsigned = encodeTransaction(p.transaction).length;
    expect(p.size - unsigned).toBe(149 - 41); // the unlocking script, sized for ECDSA (worst case)
  });

  it('round-trips through the wire encoding, outpoint in txid order', () => {
    const p = buildPayment({ utxos: [coin(100000n)], payouts, note });
    const d = decodeTransaction(encodeTransaction(p.transaction));
    if (typeof d === 'string') throw new Error(d);
    expect(binToHex(d.inputs[0]!.outpointTransactionHash)).toBe(coin(1n).txid);
  });

  it('uses several coins when one is not enough', () => {
    const p = buildPayment({ utxos: [coin(20000n, 0), coin(25000n, 1), coin(1000n, 2)], payouts, note });
    expect(p.transaction.inputs.length).toBe(2);
    expect(p.inputPaths.map((x) => x[2]).sort()).toEqual([0, 1]);
  });

  it('drops change below dust into the fee instead of making a dust output', () => {
    const need = payouts.reduce((s, x) => s + x.sats, 0n);
    const size = estimateSize(1, [...payouts.map((x) => lockingFor(x.address)), opReturnBytecode(note)]);
    const p = buildPayment({ utxos: [coin(need + BigInt(size) + 100n)], payouts, note });
    expect(p.transaction.outputs.length).toBe(5);
    expect(p.change).toBe(0n);
  });

  it('refuses dust payouts and says how much is missing', () => {
    expect(() => buildPayment({ utxos: [coin(100000n)], payouts: [{ label: 'x', address: payees[0]!.address, sats: DUST_SATS - 1n }], note })).toThrow(/dust/);
    expect(() => buildPayment({ utxos: [coin(1000n)], payouts, note })).toThrow(/not enough coins/);
  });

  it('signed result passes the BCH 2026 VM (standard rules) and the fee estimate is not below the real size', () => {
    const utxos = [coin(20000n, 0), coin(30000n, 1)];
    const p = buildPayment({ utxos, payouts, note });
    const { size } = signLocally(p.transaction, p.sourceOutputs, () => wallet.priv);
    expect(size).toBeLessThanOrEqual(p.size); // fee never below 1 sat/byte
    expect(p.size - size).toBeLessThanOrEqual(8 * p.transaction.inputs.length + 4); // Schnorr overpays at most 8 sat per input
  });

  it('a rejected specialist simply has no output', () => {
    const p = buildPayment({ utxos: [coin(100000n)], payouts: payouts.filter((x) => x.label !== 'Description (Lena)'), note });
    const lena = binToHex(lockingFor(payees[1]!.address));
    expect(p.transaction.outputs.some((o) => binToHex(o.lockingBytecode) === lena)).toBe(false);
  });
});

describe('offers', () => {
  const spec = keyAddr(7);
  const offer: Offer = {
    v: 1,
    orderId: ORDER,
    facts: 'es,fr,de',
    specialist: 'lena',
    part: 'description',
    priceCents: 2,
    priceSats: '9500',
    fileSha256: binToHex(sha256.hash(utf8ToBin('full file'))),
    expires: 2_000_000_000,
    payTo: spec.address,
    pubkey: binToHex(spec.pub),
  };
  it('signs and verifies', () => {
    const s = signOffer(offer, spec.priv);
    expect(verifyOffer(s, { orderId: ORDER, nowSec: 1_900_000_000 })).toEqual({ ok: true });
  });
  it('catches tampering, wrong order, expiry, wrong key', () => {
    const s = signOffer(offer, spec.priv);
    expect(verifyOffer({ ...s, offer: { ...offer, priceSats: '9501' } }, { orderId: ORDER, nowSec: 0 }).ok).toBe(false);
    expect(verifyOffer(s, { orderId: 'ff'.repeat(16), nowSec: 0 }).ok).toBe(false);
    expect(verifyOffer(s, { orderId: ORDER, nowSec: 2_000_000_001 }).ok).toBe(false);
    expect(verifyOffer(s, { orderId: ORDER, nowSec: 0, pubkey: '02' + '11'.repeat(32) }).ok).toBe(false);
    expect(verifyOffer({ ...s, offer: { ...offer, facts: 'pt,fr,de' } }, { orderId: ORDER, nowSec: 0 }).ok).toBe(false);
  });
  it('a standing offer (any order) verifies for every order id', () => {
    const s = signOffer({ ...offer, orderId: ANY_ORDER }, spec.priv);
    expect(verifyOffer(s, { orderId: 'ab'.repeat(16), nowSec: 0 }).ok).toBe(true);
  });
});

describe('release on chain', () => {
  const spec = keyAddr(8);
  const offer: Offer = {
    v: 1, orderId: ORDER, facts: '1024x1024', specialist: 'icon-studio', part: 'icon', priceCents: 3, priceSats: '14000',
    fileSha256: '11'.repeat(32), expires: 2_000_000_000, payTo: spec.address, pubkey: binToHex(spec.pub),
  };
  const h = offerHashHex(offer);
  const other = binToHex(sha256.hash(utf8ToBin('other')));
  const raw = (sats: bigint, hashes: string[], order = ORDER) =>
    binToHex(encodeTransaction(buildPayment({ utxos: [coin(100000n)], payouts: [{ label: 'Icon', address: spec.address, sats }], note: noteText(order, hashes) }).transaction));

  it('pays out when my output and my offer are there', () => {
    const r = checkPaid(raw(14000n, [other, h]), { payTo: spec.address, minSats: 14000n, orderIdHex: ORDER, offerHashHex: h });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.txid).toBe(txidOf(raw(14000n, [other, h])));
  });
  it('refuses underpayment, missing offer, another order', () => {
    expect(checkPaid(raw(13999n, [h]), { payTo: spec.address, minSats: 14000n, orderIdHex: ORDER, offerHashHex: h }).ok).toBe(false);
    expect(checkPaid(raw(14000n, [other]), { payTo: spec.address, minSats: 14000n, orderIdHex: ORDER, offerHashHex: h }).ok).toBe(false);
    expect(checkPaid(raw(14000n, [h], 'ee'.repeat(16)), { payTo: spec.address, minSats: 14000n, orderIdHex: ORDER, offerHashHex: h }).ok).toBe(false);
  });
  it('refuses a payment to someone else', () => {
    const r = checkPaid(raw(14000n, [h]), { payTo: keyAddr(9).address, minSats: 14000n, orderIdHex: ORDER, offerHashHex: h });
    expect(r.ok).toBe(false);
  });
  it('txid is the reversed double sha256', () => {
    expect(txidOf('00')).toBe(binToHex(sha256.hash(sha256.hash(hexToBin('00'))).reverse()));
  });
});

describe('rules', () => {
  it('icon: size and letters', () => {
    expect(checkIcon({ width: 1024, height: 1024, letters: 0, preview: false }).ok).toBe(true);
    expect(checkIcon({ width: 512, height: 512, letters: 0, preview: false })).toEqual({ ok: false, reason: 'asked for 1024×1024, got 512×512' });
    expect(checkIcon({ width: 128, height: 128, letters: 4, preview: true })).toEqual({ ok: false, reason: 'asked for no text, the icon has letters' });
    expect(countLetters([{ text: 'PLAY', confidence: 77 }])).toBe(4);
    expect(countLetters([{ text: 'PLAY', confidence: 30 }])).toBe(0);
    expect(countLetters([{ text: 'LJ', confidence: 73 }, { text: 'i', confidence: 88 }, { text: 'RZ', confidence: 25 }])).toBe(0); // shapes in a clean icon
    expect(countLetters([{ text: '—~·', confidence: 95 }])).toBe(0);
  });
  it('voice: length', () => {
    expect(checkVoice({ seconds: 12.4, preview: false })).toEqual({ ok: true, note: '12.4 s' });
    expect(checkVoice({ seconds: 32, preview: false })).toEqual({ ok: false, reason: 'asked for up to 15 s, got 32 s' });
    expect(checkVoice({ seconds: 3, preview: true, declaredSeconds: 8 }).ok).toBe(false);
  });
  it('language: Spanish vs Portuguese on one sentence', () => {
    const es = 'Un juego de verano donde tú pones las reglas y el piloto automático hace el resto.';
    const pt = 'Um jogo de verão onde você define as regras e o piloto automático faz o resto.';
    expect(detectLanguage(es)).toBe('es');
    expect(detectLanguage(pt)).toBe('pt');
    expect(checkLanguage(pt, 'es')).toEqual({ ok: false, reason: 'asked for Spanish, got Portuguese' });
  });
  it('description: all three languages', () => {
    const v = checkDescription(
      {
        es: 'Un juego de verano donde tú pones las reglas y el piloto automático hace el resto.',
        fr: "Un jeu d'été où vous fixez les règles et le pilote automatique fait le reste.",
        de: 'Ein Sommerspiel, in dem du die Regeln festlegst und der Autopilot den Rest erledigt.',
      },
      { full: false },
    );
    expect(v).toEqual({ ok: true, note: 'Spanish, French and German, as asked' });
  });
});
