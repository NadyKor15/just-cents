// "The specialist vanished": one real payment into ONE hash-lock contract, and the money coming back without anyone's
// signature, with the network itself refusing the refund before its time.
//   1. pays one demo offer (src/data/offers.json, version 2, signature checked against config) into its contract, from a
//      wallet whose phrase is read from a file; refundTime = the chain's median time past + --after seconds
//   2. at once tries the refund: the node must refuse it as non-final; its words are printed as they came
//   3. nobody claims; once the chain's time passes refundTime, tries a refund that pays someone else (the contract must
//      refuse it), then the real refund: no signature, the output pays the buyer's own address
//   4. reads how the contract ended from the chain: "refunded"
//
//   node scripts/run.mjs scripts/refund-demo.ts --net chipnet --phrase-file <file> [--rm-phrase] [--offer logo]
//        [--after 3600] [--max-sats 6000] [--log run.jsonl] [--send]
// Without --send it only prints the plan (coins, outputs, fees, the total leaving the wallet) and signs nothing.
// --max-sats stops before signing if the payment would take more than that from the wallet, fees included.
// The phrase and keys are never printed; --rm-phrase deletes the phrase file right after reading it.
import { appendFileSync } from 'node:fs';
import { binToHex } from '@bitauth/libauth';
import offers from '../src/data/offers.json';
import { OFFER_PUBKEY, PAYOUT } from '../src/config';
import { broadcast, closeAll, getRawTx, type Net } from '../src/core/chain';
import { buildRefund, encodeTx, txidOf, unhex, type ContractCoin } from '../src/core/htlc';
import { chainTime, contractState } from '../src/core/htlc-chain';
import { offerHash2Hex, verifyOffer2, type SignedOffer2 } from '../src/core/offer';
import { buildPayment2, lockingFor, type BuiltPayment2, type Utxo } from '../src/core/tx';
import { readPhraseFile, signPayment, walletCoins, walletFromPhrase } from './local-wallet';

type Slot = keyof typeof OFFER_PUBKEY;
type Row = { v2?: { signed: SignedOffer2; offerHashHex: string } };

export type RefundDemoPlan = {
  payment: BuiltPayment2;
  offerKey: string;
  priceSats: bigint;
  /** what leaves the wallet: the contract plus the payment's network fee */
  walletSpend: bigint;
};

/** Checks the offer the way the page does, then builds the one-contract payment. Pure: no network. */
export function planRefundDemo(a: { net: Net; offerKey: string; utxos: Utxo[]; refundTime: number; orderIdHex: string; nowSec: number; book?: Record<string, Record<string, Row>> }): RefundDemoPlan {
  const book = a.book ?? (offers as unknown as Record<string, Record<string, Row>>);
  const row = Object.hasOwn(book[a.net] ?? {}, a.offerKey) ? book[a.net]![a.offerKey] : undefined;
  if (!row?.v2) throw new Error(`no version 2 offer "${a.offerKey}" on ${a.net}`);
  const slot = a.offerKey.split(':')[0] as Slot;
  if (!OFFER_PUBKEY[slot]) throw new Error(`"${a.offerKey}" is not a demo specialist's offer`);
  const check = verifyOffer2(row.v2.signed, { orderId: a.orderIdHex, nowSec: a.nowSec, pubkey: OFFER_PUBKEY[slot] });
  if (!check.ok) throw new Error(`offer ${a.offerKey}: ${check.reason}`);
  const offer = row.v2.signed.offer;
  if (offerHash2Hex(offer) !== row.v2.offerHashHex) throw new Error(`offer ${a.offerKey}: the book's fingerprint is not the offer's`);
  const priceSats = BigInt(offer.priceSats);
  const payment = buildPayment2({
    utxos: a.utxos,
    contracts: [{ label: a.offerKey, priceSats, lock: { cipherSha256: offer.cipherSha256, keyHash: offer.keyHash, sellerPubkey: offer.claimPubkey } }],
    payouts: [],
    orderIdHex: a.orderIdHex,
    offerHashesHex: [row.v2.offerHashHex],
    refundTime: a.refundTime,
  });
  const inputs = payment.sourceOutputs.reduce((s, o) => s + o.valueSatoshis, 0n);
  return { payment, offerKey: a.offerKey, priceSats, walletSpend: inputs - payment.change };
}

/** The contract coin of a sent payment, as a refund needs it. */
export function contractCoin(plan: RefundDemoPlan, paymentTxid: string): ContractCoin {
  const c = plan.payment.contracts[0]!;
  return { txid: paymentTxid, vout: c.vout, value: c.sats, params: c.params };
}

// ---------- the run ----------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);
const iso = (t: number) => new Date(t * 1000).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const net = arg('--net') as Net;
  if (net !== 'mainnet' && net !== 'chipnet') throw new Error('--net mainnet|chipnet');
  const phraseFile = arg('--phrase-file');
  if (!phraseFile) throw new Error('--phrase-file <file with the wallet phrase>');
  const offerKey = arg('--offer') ?? 'logo';
  const after = Number(arg('--after') ?? 3600);
  if (!Number.isInteger(after) || after < 30 || after > 7200) throw new Error('--after: 30…7200 seconds');
  const maxSats = BigInt(arg('--max-sats') ?? 6000);
  const send = flag('--send');
  const logFile = arg('--log');
  const log = (event: string, data: Record<string, unknown> = {}) => {
    const line = { t: new Date().toISOString(), event, ...data };
    console.log(JSON.stringify(line));
    if (logFile) appendFileSync(logFile, JSON.stringify(line) + '\n');
  };

  const { phrase, removedAt } = readPhraseFile(phraseFile, flag('--rm-phrase'));
  log('phrase read', { removedAt });
  const wallet = walletFromPhrase(phrase, net);
  const utxos = await walletCoins(wallet);
  log('coins', { count: utxos.length, sats: utxos.reduce((s, u) => s + u.sats, 0n).toString() });

  const mtp0 = await chainTime(net);
  const refundTime = mtp0 + after;
  const orderIdHex = binToHex(crypto.getRandomValues(new Uint8Array(16)));
  const plan = planRefundDemo({ net, offerKey, utxos, refundTime, orderIdHex, nowSec: Math.floor(Date.now() / 1000) });
  const p = plan.payment;
  const buyer = wallet.addresses.find((x) => x.lockingHex === p.buyerLockingHex)!;
  log('plan', {
    net,
    offer: offerKey,
    chainTime: iso(mtp0),
    refundTime: iso(refundTime),
    inputs: p.sourceOutputs.map((o) => o.valueSatoshis.toString()),
    outputs: p.transaction.outputs.map((o, i) => ({ vout: i, sats: o.valueSatoshis.toString(), kind: i === 0 ? 'contract P2SH32' : o.lockingBytecode[0] === 0x6a ? 'note JC2' : 'change' })),
    contract: { sats: p.contracts[0]!.sats.toString(), price: plan.priceSats.toString(), locking: p.contracts[0]!.lockingHex, params: p.contracts[0]!.params },
    buyer: buyer.address,
    paymentFee: p.fee.toString(),
    walletSpend: plan.walletSpend.toString(),
    maxSats: maxSats.toString(),
  });
  if (plan.walletSpend > maxSats) throw new Error(`the payment would take ${plan.walletSpend} sat from the wallet, above --max-sats ${maxSats}: stopped, nothing signed`);
  if (!send) {
    log('dry run: nothing signed, nothing sent');
    return;
  }

  const signed = signPayment(p.transaction, p.sourceOutputs, wallet);
  const sent = await broadcast(net, signed.hex);
  if (!sent.ok) throw new Error(`the network refused the payment: ${sent.nodeError}`);
  const txid = signed.txid;
  log('payment sent', { txid, size: signed.size });
  for (let i = 0; i < 15; i++) {
    if (await getRawTx(net, txid).catch(() => '')) break;
    await sleep(2000);
  }

  const coin = contractCoin(plan, txid);
  const refund = buildRefund({ contracts: [coin] });
  const tEarly = await chainTime(net);
  const early = await broadcast(net, refund.hex);
  log('early refund', { chainTime: iso(tEarly), refundTime: iso(refundTime), accepted: early.ok, node: early.ok ? null : early.nodeError });
  if (early.ok) throw new Error('the network took the refund before its time: stopped');

  const locking = unhex(p.contracts[0]!.lockingHex);
  let t = tEarly;
  let lastSay = Date.now();
  while (t <= refundTime) {
    await sleep(net === 'mainnet' ? 60_000 : 15_000);
    t = await chainTime(net).catch(() => t);
    const st = await contractState(net, locking, { txid, vout: coin.vout }).catch(() => ({ state: 'open' as const }));
    if (st.state !== 'open') throw new Error(`the contract was spent while waiting: ${st.state} ${'txid' in st ? st.txid : ''}`);
    if (Date.now() - lastSay > 300_000) {
      log('waiting', { chainTime: iso(t), refundTime: iso(refundTime) });
      lastSay = Date.now();
    }
  }
  log('refund time passed', { chainTime: iso(t) });

  // a refund that pays someone else: the contract itself must refuse it (not the time lock)
  const thief = buildRefund({ contracts: [coin] });
  thief.tx.outputs[0]!.locking = lockingFor(PAYOUT.service[net]);
  const th = await broadcast(net, binToHex(encodeTx(thief.tx)));
  log('refund to another address', { accepted: th.ok, node: th.ok ? null : th.nodeError });
  if (th.ok) throw new Error('the network took a refund to another address: stopped');

  let back = await broadcast(net, refund.hex);
  for (let i = 0; i < 10 && !back.ok && /non-final/i.test(back.nodeError); i++) {
    await sleep(30_000); // servers can lag a block behind each other
    back = await broadcast(net, refund.hex);
  }
  if (!back.ok) throw new Error(`the network refused the refund: ${back.nodeError}`);
  log('refund sent', { txid: refund.txid, toBuyer: buyer.address, sats: refund.tx.outputs[0]!.value.toString(), fee: refund.fee.toString(), contract: coin.value.toString() });

  let st = await contractState(net, locking, { txid, vout: coin.vout });
  for (let i = 0; i < 20 && st.state === 'open'; i++) {
    await sleep(3000);
    st = await contractState(net, locking, { txid, vout: coin.vout });
  }
  log('contract state', { state: st.state, by: 'txid' in st ? st.txid : null });
  log('summary', {
    payment: txid,
    refund: refund.txid,
    earlyRefusal: early.ok ? null : early.nodeError,
    walletSpend: plan.walletSpend.toString(),
    paymentFee: p.fee.toString(),
    refundFee: refund.fee.toString(),
    backToBuyer: refund.tx.outputs[0]!.value.toString(),
    netCost: (plan.walletSpend - refund.tx.outputs[0]!.value).toString(),
    check: txidOf(unhex(refund.hex)) === refund.txid,
  });
}

if (process.argv[1]?.includes('refund-demo')) {
  try {
    await main();
  } finally {
    await closeAll();
  }
}
