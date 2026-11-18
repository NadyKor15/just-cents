// Dependency-free reading of a raw BCH transaction's outputs, for the worker (no WASM at startup).
// Kept small on purpose; test/worker.test.ts checks it against libauth on real built transactions.

const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
export const bytesToHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

class Reader {
  i = 0;
  constructor(readonly b: Uint8Array) {}
  take(n: number): Uint8Array {
    if (this.i + n > this.b.length) throw new Error('transaction ends early');
    const s = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return s;
  }
  u32(): number {
    const s = this.take(4);
    return (s[0]! | (s[1]! << 8) | (s[2]! << 16)) + s[3]! * 0x1000000;
  }
  u64(): bigint {
    const s = this.take(8);
    let v = 0n;
    for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(s[k]!);
    return v;
  }
  varint(): number {
    const f = this.take(1)[0]!;
    if (f < 0xfd) return f;
    if (f === 0xfd) {
      const s = this.take(2);
      return s[0]! | (s[1]! << 8);
    }
    if (f === 0xfe) return this.u32();
    throw new Error('varint too large');
  }
}

export type RawOutput = { value: bigint; script: Uint8Array };

export function readOutputs(rawHex: string): RawOutput[] {
  const r = new Reader(hexToBytes(rawHex));
  r.u32(); // version
  const nIn = r.varint();
  for (let k = 0; k < nIn; k++) {
    r.take(36);
    r.take(r.varint());
    r.u32();
  }
  const nOut = r.varint();
  const outs: RawOutput[] = [];
  for (let k = 0; k < nOut; k++) {
    const value = r.u64();
    let script = r.take(r.varint());
    // CashTokens prefix (0xef) sits before the locking script; the demo never uses tokens, so skip such outputs.
    if (script[0] === 0xef) script = new Uint8Array([0xff]);
    outs.push({ value, script });
  }
  r.u32(); // locktime
  return outs;
}

/** Our OP_RETURN note: "JC1 <order 32 hex> <offer prefixes, 32 hex each>". */
export function readNote(script: Uint8Array): { orderIdHex: string; offerPrefixes: string[] } | null {
  if (script[0] !== 0x6a) return null;
  let i = 1;
  let len = script[i]!;
  if (len === 0x4c) len = script[++i]!;
  i++;
  const data = script.subarray(i, i + len);
  if (data.length !== len) return null;
  const parts = new TextDecoder().decode(data).split(' ');
  if (parts[0] !== 'JC1' || !/^[0-9a-f]{32}$/.test(parts[1] ?? '')) return null;
  const offers = parts.slice(2);
  if (offers.some((p) => !/^[0-9a-f]{32}$/.test(p))) return null;
  return { orderIdHex: parts[1]!, offerPrefixes: offers };
}

export type Paid = { ok: true; paidSats: bigint; orderIdHex: string } | { ok: false; reason: string };

export type BookEntry = { payToLockingHex: string; offerHashHex: string; priceSats: string };

/**
 * One payment must not unlock two offers of the same specialist (two cover variants share one address).
 * The amount paid to this offer's address must cover the prices of ALL offers in the note that pay to
 * that same address.
 */
export function checkOfferPaid(rawHex: string, book: Record<string, BookEntry>, key: string): Paid {
  const entry = book[key];
  if (!entry) return { ok: false, reason: `no such offer: ${key}` };
  let outs: RawOutput[];
  try {
    outs = readOutputs(rawHex);
  } catch (e) {
    return { ok: false, reason: `cannot read transaction: ${e instanceof Error ? e.message : e}` };
  }
  const notes = outs.map((o) => readNote(o.script)).filter((n) => n !== null);
  if (notes.length !== 1) return { ok: false, reason: notes.length ? 'more than one Just Cents note' : 'no Just Cents note in this transaction' };
  const listed = new Set(notes[0]!.offerPrefixes);
  let required = 0n;
  for (const e of Object.values(book)) {
    if (e.payToLockingHex === entry.payToLockingHex && listed.has(e.offerHashHex.slice(0, 32))) required += BigInt(e.priceSats);
  }
  return checkPaidRaw(rawHex, { payToLockingHex: entry.payToLockingHex, minSats: required > 0n ? required : BigInt(entry.priceSats), offerHashHex: entry.offerHashHex });
}

export function checkPaidRaw(rawHex: string, want: { payToLockingHex: string; minSats: bigint; offerHashHex: string }): Paid {
  let outs: RawOutput[];
  try {
    outs = readOutputs(rawHex);
  } catch (e) {
    return { ok: false, reason: `cannot read transaction: ${e instanceof Error ? e.message : e}` };
  }
  let paid = 0n;
  const notes = [];
  for (const o of outs) {
    if (bytesToHex(o.script) === want.payToLockingHex) paid += o.value;
    const n = readNote(o.script);
    if (n) notes.push(n);
  }
  if (notes.length !== 1) return { ok: false, reason: notes.length ? 'more than one Just Cents note' : 'no Just Cents note in this transaction' };
  const note = notes[0]!;
  if (!note.offerPrefixes.includes(want.offerHashHex.slice(0, 32))) return { ok: false, reason: 'this offer is not in the note' };
  if (paid < want.minSats) return { ok: false, reason: `paid ${paid} sat, the offer asks ${want.minSats} sat` };
  return { ok: true, paidSats: paid, orderIdHex: note.orderIdHex };
}
