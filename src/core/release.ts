// "I see my output on chain → I hand over the full file." The specialist's side of the deal.
// Given the raw transaction, it checks: an output to my address with at least my price, and an OP_RETURN
// note for this order that lists my offer's fingerprint.
import { decodeTransaction, hexToBin, binToHex, hash256 } from '@bitauth/libauth';
import { lockingFor, parseNote } from './tx';

export type PaymentCheck = { ok: true; txid: string; paidSats: bigint } | { ok: false; reason: string };

export function txidOf(rawHex: string): string {
  return binToHex(hash256(hexToBin(rawHex)).slice().reverse());
}

/** Reads the order id from the transaction's own note, then runs checkPaid against it (standing offers). */
export function checkPaidStanding(rawHex: string, want: { payTo: string; minSats: bigint; offerHashHex: string }): PaymentCheck & { orderIdHex?: string } {
  const decoded = decodeTransaction(hexToBin(rawHex));
  if (typeof decoded === 'string') return { ok: false, reason: `cannot read transaction: ${decoded}` };
  const notes = decoded.outputs.map((o) => parseNote(o.lockingBytecode)).filter((n) => n !== null);
  if (notes.length !== 1) return { ok: false, reason: notes.length ? 'more than one Just Cents note' : 'no Just Cents note in this transaction' };
  const orderIdHex = notes[0]!.orderIdHex;
  return { ...checkPaid(rawHex, { ...want, orderIdHex }), orderIdHex };
}

export function checkPaid(rawHex: string, want: { payTo: string; minSats: bigint; orderIdHex: string; offerHashHex: string }): PaymentCheck {
  const decoded = decodeTransaction(hexToBin(rawHex));
  if (typeof decoded === 'string') return { ok: false, reason: `cannot read transaction: ${decoded}` };
  const mine = binToHex(lockingFor(want.payTo));
  let paid = 0n;
  let note: ReturnType<typeof parseNote> = null;
  for (const out of decoded.outputs) {
    if (binToHex(out.lockingBytecode) === mine) paid += out.valueSatoshis;
    const n = parseNote(out.lockingBytecode);
    if (n) {
      if (note) return { ok: false, reason: 'more than one Just Cents note' };
      note = n;
    }
  }
  if (!note) return { ok: false, reason: 'no Just Cents note in this transaction' };
  if (note.orderIdHex !== want.orderIdHex) return { ok: false, reason: 'note is for another order' };
  if (!note.offerPrefixes.includes(want.offerHashHex.slice(0, 32))) return { ok: false, reason: 'my offer is not in the note' };
  if (paid < want.minSats) return { ok: false, reason: `paid ${paid} sat, offer asked ${want.minSats} sat` };
  return { ok: true, txid: txidOf(rawHex), paidSats: paid };
}
