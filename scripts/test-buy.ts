// CHIPNET ONLY. Buys your own offer the way a buyer's page does, to prove your setup end to end:
//   1. takes your book and checks the offer (signature, fingerprints) — as the page does before paying
//   2. downloads your sealed file from YOUR claim server and checks its fingerprint against the signed offer
//   3. pays your contract (price + 500 sat) from a chipnet test wallet, refund time = chain time + 1 hour
//   4. asks YOUR claim server: POST <claimUrl>/claim/<key>?net=chipnet&txid=<payment>
//   5. finds the claim on chain, takes the key from the claim's own input, opens the sealed file,
//      and checks the opened file's fingerprint against the signed offer
//   node scripts/run.mjs scripts/test-buy.ts --specialist specialists/<you> --phrase-file <chipnet wallet phrase> [--rm-phrase] [--out opened-file]
// Free chipnet coins: a chipnet faucet (e.g. https://tbch.googol.cash). The phrase is never printed.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { binToHex, sha256 } from '@bitauth/libauth';
import { broadcast, closeAll, explorerTx, getRawTx } from '../src/core/chain';
import { unhex } from '../src/core/htlc';
import { contractState, refundTimeFromNow } from '../src/core/htlc-chain';
import { openFile } from '../src/core/filebox';
import { offerHash2Hex, verifyOffer2 } from '../src/core/offer';
import { buildPayment2 } from '../src/core/tx';
import { readPhraseFile, signPayment, walletCoins, walletFromPhrase } from './local-wallet';
import type { SpecialistBook } from './sign-offers-v2';
import { specialistDir } from './specialist-lib';

const NET = 'chipnet' as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const dir = specialistDir();
  const phraseFile = arg('--phrase-file');
  if (!dir || !phraseFile) throw new Error('--specialist <your folder> --phrase-file <chipnet wallet phrase file>');
  const logFile = arg('--log');
  const say = (event: string, data: Record<string, unknown> = {}) => {
    const line = { t: new Date().toISOString(), event, ...data };
    console.log(JSON.stringify(line));
    if (logFile) appendFileSync(logFile, JSON.stringify(line) + '\n');
  };
  const book = JSON.parse(readFileSync(join(dir, 'offers.json'), 'utf8')) as SpecialistBook;
  const rows = Object.entries(book.chipnet ?? {});
  if (rows.length !== 1) throw new Error('your book needs exactly one chipnet offer to test');
  const [key, row] = rows[0]!;
  const offer = row.v2.signed.offer;
  const check = verifyOffer2(row.v2.signed, { orderId: '00'.repeat(16), nowSec: Math.floor(Date.now() / 1000), pubkey: offer.pubkey });
  if (!check.ok || offerHash2Hex(offer) !== row.v2.offerHashHex) throw new Error(`the offer does not check: ${check.ok ? 'fingerprint' : check.reason}`);

  const r = await fetch(`${row.claimUrl}${row.v2.sealed}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`your server does not give the sealed file: ${row.claimUrl}${row.v2.sealed} → ${r.status}`);
  const sealed = new Uint8Array(await r.arrayBuffer());
  if (binToHex(sha256.hash(sealed)) !== offer.cipherSha256) throw new Error('the sealed file on your server is not the one your offer signs');
  say('offer and sealed file checked', { key, sealedBytes: sealed.length, from: `${row.claimUrl}${row.v2.sealed}` });

  const { phrase, removedAt } = readPhraseFile(phraseFile, process.argv.includes('--rm-phrase'));
  say('phrase read', { removedAt });
  const wallet = walletFromPhrase(phrase, NET);
  const utxos = await walletCoins(wallet);
  const p = buildPayment2({
    utxos,
    contracts: [{ label: key, priceSats: BigInt(offer.priceSats), lock: { cipherSha256: offer.cipherSha256, keyHash: offer.keyHash, sellerPubkey: offer.claimPubkey } }],
    payouts: [],
    orderIdHex: binToHex(crypto.getRandomValues(new Uint8Array(16))),
    offerHashesHex: [row.v2.offerHashHex],
    refundTime: await refundTimeFromNow(NET),
  });
  const signed = signPayment(p.transaction, p.sourceOutputs, wallet);
  const sent = await broadcast(NET, signed.hex);
  if (!sent.ok) throw new Error(`the network refused the payment: ${sent.nodeError}`);
  say('paid', { txid: signed.txid, contractSats: p.contracts[0]!.sats.toString(), fee: p.fee.toString(), explorer: explorerTx(NET, signed.txid) });
  for (let i = 0; i < 15 && !(await getRawTx(NET, signed.txid).catch(() => '')); i++) await sleep(2000);

  let claimTxid = '';
  for (let attempt = 0; attempt < 6 && !claimTxid; attempt++) {
    const c = await fetch(`${row.claimUrl}/claim/${encodeURIComponent(key)}?net=${NET}&txid=${signed.txid}`, { method: 'POST', signal: AbortSignal.timeout(60_000) }).catch((e) => e as Error);
    if (c instanceof Error) {
      say('claim server did not answer', { attempt, error: c.message });
    } else {
      const body = (await c.json().catch(() => ({}))) as { ok?: boolean; claimTxid?: string; reason?: string };
      say('claim server answered', { attempt, status: c.status, ...body });
      if (body.ok && body.claimTxid) claimTxid = body.claimTxid;
      else if (c.status === 409 || c.status === 402 || c.status === 400) throw new Error(`your claim server refused: ${body.reason}`);
    }
    if (!claimTxid) await sleep(3000);
  }
  if (!claimTxid) throw new Error('no claim from your server');

  const locking = unhex(p.contracts[0]!.lockingHex);
  let st = await contractState(NET, locking, { txid: signed.txid, vout: 0 });
  for (let i = 0; i < 20 && st.state === 'open'; i++) {
    await sleep(3000);
    st = await contractState(NET, locking, { txid: signed.txid, vout: 0 });
  }
  if (st.state !== 'claimed' || st.kind !== 'claim') throw new Error(`the contract is ${st.state}, not claimed`);
  const opened = await openFile(st.key, sealed);
  const ok = binToHex(sha256.hash(opened)) === offer.fileSha256;
  say('opened', { claimOnChain: st.txid, sameAsServerSaid: st.txid === claimTxid, keyFromInput: st.inputIndex, openedBytes: opened.length, fingerprintMatches: ok, explorer: explorerTx(NET, st.txid) });
  if (!ok) throw new Error('the opened file is not the one the offer signs');
  const out = arg('--out');
  if (out) writeFileSync(out, opened);
}

if (process.argv[1]?.includes('test-buy')) {
  try {
    await main();
  } finally {
    await closeAll();
  }
}
