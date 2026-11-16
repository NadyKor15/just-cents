// A specialist's paid work, read from the network instead of reviews: transactions that pay the
// specialist's address and carry a Just Cents (JC1) note. Nothing here is stored by us.
import { PAYOUT } from '../src/config';
import { readOutputs, readNote, bytesToHex } from './txparse';
import { rpc, type Net } from './fulcrum';
import { json } from './http';
import offers from '../src/data/offers.json';

type Who = 'icon' | 'sam' | 'lena' | 'voice';
const OFFERS = offers as unknown as Record<Net, Record<string, { payToLockingHex: string; signed: { offer: { payTo: string } } }>>;

function lockingHex(net: Net, who: Who): string {
  const key = who === 'icon' ? 'icon' : who === 'voice' ? 'voice' : `${who}:good`;
  return OFFERS[net][key]!.payToLockingHex;
}

export async function history(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const who = url.pathname.split('/')[3] as Who;
  const net: Net = url.searchParams.get('net') === 'chipnet' ? 'chipnet' : 'mainnet';
  if (!['icon', 'sam', 'lena', 'voice'].includes(who)) return json({ ok: false, reason: 'unknown specialist' }, 404);
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
      if (note && paid > 0n) jobs.push({ txid: h.tx_hash, height: h.height > 0 ? h.height : null, order: note.orderIdHex, sats: Number(paid) });
    } catch {
      /* skip unreadable */
    }
  }
  return new Response(JSON.stringify({ specialist: who, network: net, address, paid_jobs: jobs, note: 'Read from the network just now; only transactions that pay this address and carry a Just Cents note.' }, null, 2), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' },
  });
}
