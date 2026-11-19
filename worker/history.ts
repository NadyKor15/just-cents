// A specialist's paid work, read from the network instead of reviews: transactions that pay the specialist's address
// and either carry a Just Cents (JC1) note, or are its claims: they open a contract (JC2) with the specialist's claim
// key, revealing the file's key. Nothing here is stored by us.
import { CLAIM_PUBKEY, PAYOUT } from '../src/config';
import { decodeTx, parseNote2, readSpend, unhex } from '../src/core/htlc';
import { readOutputs, readNote, bytesToHex } from './txparse';
import { rpc, type Net } from './fulcrum';
import { json } from './http';
import offers from '../src/data/offers.json';

type Who = 'cover' | 'sam' | 'lena' | 'logo';
const OFFERS = offers as unknown as Record<Net, Record<string, { payToLockingHex: string; signed: { offer: { payTo: string } } }>>;

function lockingHex(net: Net, who: Who): string {
  const key = who === 'cover' || who === 'logo' ? who : `${who}:good`;
  return OFFERS[net][key]!.payToLockingHex;
}

export async function history(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const who = url.pathname.split('/')[3] as Who;
  const net: Net = url.searchParams.get('net') === 'chipnet' ? 'chipnet' : 'mainnet';
  if (!['cover', 'sam', 'lena', 'logo'].includes(who)) return json({ ok: false, reason: 'unknown specialist' }, 404);
  const address = PAYOUT[who][net];
  const mine = lockingHex(net, who);
  let hist: { tx_hash: string; height: number }[];
  try {
    hist = await rpc(net, 'blockchain.address.get_history', [address]);
  } catch (e) {
    return json({ ok: false, reason: `could not read the network: ${e instanceof Error ? e.message : e}` }, 502);
  }
  // newest first (unconfirmed have height 0 or -1)
  const recent = [...hist].sort((a, b) => (a.height <= 0 ? 1e12 : a.height) - (b.height <= 0 ? 1e12 : b.height)).reverse().slice(0, 12);
  const jobs = [];
  for (const h of recent) {
    try {
      const raw = await rpc<string>(net, 'blockchain.transaction.get', [h.tx_hash, false]);
      const outs = readOutputs(raw);
      const note = outs.map((o) => readNote(o.script)).find((n) => n);
      const paid = outs.filter((o) => bytesToHex(o.script) === mine).reduce((s, o) => s + o.value, 0n);
      if (note && paid > 0n) {
        jobs.push({ txid: h.tx_hash, height: h.height > 0 ? h.height : null, order: note.orderIdHex, sats: Number(paid), kind: 'paid directly' });
        continue;
      }
      if (paid <= 0n) continue;
      // a claim of this specialist: one input opens a contract whose specialist key is this specialist's claim key
      const bytes = unhex(raw);
      for (const inp of decodeTx(bytes).inputs) {
        const s = readSpend(bytes, { txid: inp.txid, vout: inp.vout });
        if (s?.kind !== 'claim' || s.params.sellerPubkey !== CLAIM_PUBKEY[who]) continue;
        let order: string | null = null;
        try {
          const pay = decodeTx(unhex(await rpc<string>(net, 'blockchain.transaction.get', [inp.txid, false])));
          order = pay.outputs.map((o) => parseNote2(o.locking)).find((n) => n)?.orderIdHex ?? null;
        } catch {
          /* the order stays unknown */
        }
        jobs.push({ txid: h.tx_hash, height: h.height > 0 ? h.height : null, order, sats: Number(paid), kind: 'claim', contract: `${inp.txid}:${inp.vout}` });
        break;
      }
    } catch {
      /* skip unreadable */
    }
  }
  return new Response(JSON.stringify({ specialist: who, network: net, address, paid_jobs: jobs, note: 'Read from the network just now: transactions that pay this address and carry a Just Cents note, and this specialist\'s claims (each opened a contract by putting a file\'s key on chain).' }, null, 2), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' },
  });
}
