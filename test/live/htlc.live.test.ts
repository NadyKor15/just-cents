// Live chipnet run of the hash-lock flow, minus the screen, with the site's and the specialist's own code:
//  1. claim — the site pairs with a wallet over the real WizardConnect relay; one payment puts the specialist's money
//     into a contract (plus the service output and the JC2 note); the specialist's claim (planClaim, the code behind
//     POST /claim) reveals the file key on chain; the buyer finds the claim from the chain alone, takes the key from the
//     claim's input, opens the sealed file it fetched before paying, and the fingerprint matches the signed offer.
//  2. the specialist vanishes — a refund before the refund time is refused by the node, the specialist can no longer
//     claim near it, a refund to someone else is refused by the contract, and the refund pays the buyer's own address.
//     Nobody signs it. (Short refund time here: 30 s of chain time instead of an hour.)
// Run: LIVE=1 TEST_MNEMONIC_FILE=<file with the test phrase> npx vitest run test/live/htlc.live.test.ts --silent=false
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { binToHex, decodeTransaction, hexToBin, sha256 } from '@bitauth/libauth';
import { WalletLink, type WalletState } from '../../src/core/wallet';
import { broadcast, closeAll, getRawTx } from '../../src/core/chain';
import { buildPayment2, lockingFor } from '../../src/core/tx';
import { buildRefund, contractLocking, contractsInPayment, encodeTx, FEE_SATS, publicKeyOf, REFUND_AFTER_SECONDS, txidOf, unhex, type LockParams } from '../../src/core/htlc';
import { chainTime, contractState, refundTimeFromNow } from '../../src/core/htlc-chain';
import { deriveFileKey, keyHashHex, openFile, sealFile } from '../../src/core/filebox';
import { planClaim, type ClaimEntry } from '../../worker/claim';
import { PAYOUT } from '../../src/config';
import { headlessWallet } from '../helpers/headless-wallet';

const LIVE = process.env.LIVE === '1';
const NET = 'chipnet' as const;
const PRICE = 1000n;
const iso = (t: number) => new Date(t * 1000).toISOString();

function waitFor(get: () => WalletState, kind: WalletState['kind'], ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (get().kind === kind) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error(`still ${get().kind} after ${ms} ms`));
      setTimeout(tick, 200);
    };
    tick();
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.getRandomValues(new Uint8Array(32));

async function paired() {
  const w = headlessWallet(readFileSync(process.env.TEST_MNEMONIC_FILE!, 'utf8').trim(), 'testnet');
  const site = new WalletLink(() => {});
  w.mgr.connect(site.open().uri);
  await waitFor(() => site.state, 'connected', 30_000);
  expect(site.net()).toBe('chipnet');
  return { site, close: () => { site.close(); w.mgr.disconnectAll(); } };
}

/** A fresh specialist for this run: its own signing key and seed; the demo logo as the full file; paid back to the test wallet. */
async function specialist(payTo: string) {
  const privateKey = rnd();
  const seed = rnd();
  const plain = new Uint8Array(readFileSync('public/files/logo.svg'));
  const fileSha256 = binToHex(sha256.hash(plain));
  const key = deriveFileKey(seed, NET, fileSha256);
  const sealed = await sealFile(key, plain);
  const entry: ClaimEntry = {
    offerHashHex: binToHex(sha256.hash(rnd())),
    priceSats: PRICE.toString(),
    payToLockingHex: binToHex(lockingFor(payTo)),
    claimPubkey: publicKeyOf(privateKey),
    keyHash: keyHashHex(key),
    cipherSha256: binToHex(sha256.hash(sealed)),
    fileSha256,
  };
  return { entry, keys: { seed, privateKeys: { [entry.claimPubkey]: privateKey } }, sealed, plain };
}

async function payInto(site: WalletLink, entry: ClaimEntry, refundTime: number) {
  const coins = await site.coins(NET);
  expect(coins.length).toBeGreaterThan(0);
  const p = buildPayment2({
    utxos: coins,
    contracts: [{ label: 'logo', priceSats: PRICE, lock: { cipherSha256: entry.cipherSha256, keyHash: entry.keyHash, sellerPubkey: entry.claimPubkey } }],
    payouts: [{ label: 'service', address: PAYOUT.service[NET], sats: 600n }],
    orderIdHex: binToHex(rnd().slice(0, 16)),
    offerHashesHex: [entry.offerHashHex],
    refundTime,
  });
  // public contract parameters first, so a run that stops halfway can still be refunded by hand
  console.log(`[pay] contract params ${JSON.stringify(p.contracts[0]!.params)}`);
  const signed = await site.sign(p, 'Just Cents: pay 1 specialist into its contract + service');
  if (!signed.ok) throw new Error(signed.error);
  const got = decodeTransaction(hexToBin(signed.signedHex));
  if (typeof got === 'string') throw new Error(got);
  expect(got.outputs.map((o) => binToHex(o.lockingBytecode))).toEqual(p.transaction.outputs.map((o) => binToHex(o.lockingBytecode)));
  const sent = await broadcast(NET, signed.signedHex);
  expect(sent.ok, sent.ok ? '' : sent.nodeError).toBe(true);
  const txid = txidOf(unhex(signed.signedHex));
  return { p, txid, raw: signed.signedHex };
}

async function rawWhenKnown(txid: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const r = await getRawTx(NET, txid).catch(() => '');
    if (r) return r;
    await sleep(2000);
  }
  throw new Error(`the network does not know ${txid}`);
}

describe.skipIf(!LIVE)('chipnet: the hash-lock flow', () => {
  it('claim: the key comes from the chain and opens the sealed file', { timeout: 240_000 }, async () => {
    const { site, close } = await paired();
    const buyerAddr = site.address('receive', 0, NET);
    const s = await specialist(buyerAddr);
    // before paying, the buyer holds the sealed file and checks it is the one the offer names
    expect(binToHex(sha256.hash(s.sealed))).toBe(s.entry.cipherSha256);
    const refundTime = await refundTimeFromNow(NET);
    const { p, txid } = await payInto(site, s.entry, refundTime);
    console.log(`[claim] payment ${txid} contract vout 0 = ${p.contracts[0]!.sats} sat, refund time ${iso(refundTime)} (chain time + ${REFUND_AFTER_SECONDS} s), fee ${p.fee}, size ${p.size}`);
    console.log(`[claim] contract P2SH32 ${p.contracts[0]!.lockingHex}`);

    // the specialist's side: the same planClaim the worker runs behind POST /claim
    const raw = await rawWhenKnown(txid);
    const plan = planClaim(raw, s.entry, NET, s.keys, await chainTime(NET));
    expect(plan.ok, plan.ok ? '' : plan.reason).toBe(true);
    if (!plan.ok) return;
    const sent = await broadcast(NET, plan.hex);
    expect(sent.ok, sent.ok ? '' : sent.nodeError).toBe(true);
    const again = planClaim(raw, s.entry, NET, s.keys, await chainTime(NET));
    console.log(`[claim] claim ${plan.txid} fee ${plan.fee}; asking again builds the same transaction: ${again.ok && again.hex === plan.hex}`);
    console.log(`[claim] second broadcast of the same claim: ${JSON.stringify(await broadcast(NET, plan.hex))}`);

    // the buyer's side, from the chain alone: find who spent the contract, take the key from that input
    let st = await contractState(NET, unhex(p.contracts[0]!.lockingHex), { txid, vout: 0 });
    for (let i = 0; i < 15 && st.state === 'open'; i++) {
      await sleep(2000);
      st = await contractState(NET, unhex(p.contracts[0]!.lockingHex), { txid, vout: 0 });
    }
    expect(st.state).toBe('claimed');
    if (st.state !== 'claimed' || st.kind !== 'claim') return;
    expect(st.txid).toBe(plan.txid);
    expect(binToHex(sha256.hash(st.key))).toBe(s.entry.keyHash);
    const opened = await openFile(st.key, s.sealed);
    expect(binToHex(sha256.hash(opened))).toBe(s.entry.fileSha256);
    expect(binToHex(opened)).toBe(binToHex(s.plain));
    console.log(`[claim] key read from claim ${st.txid} input ${st.inputIndex}; sealed ${s.sealed.length} B opened → ${opened.length} B, fingerprint matches the offer`);
    close();
    await closeAll();
  });

  it('the specialist vanishes: refused before the refund time, refused to anyone else, refunded to the buyer after', { timeout: 1_500_000 }, async () => {
    const { site, close } = await paired();
    const buyerAddr = site.address('receive', 0, NET);
    const s = await specialist(buyerAddr);
    const mtp0 = await chainTime(NET);
    const refundTime = mtp0 + 30;
    const { p, txid, raw } = await payInto(site, s.entry, refundTime);
    console.log(`[refund] payment ${txid} contract ${p.contracts[0]!.sats} sat, refund time ${iso(refundTime)} (chain time ${iso(mtp0)} + 30 s), buyer ${p.buyerLockingHex}`);
    close();

    // anyone can rebuild the contract from the payment alone
    const found = contractsInPayment(unhex(raw), [{ offerHashHex: s.entry.offerHashHex, lock: { cipherSha256: s.entry.cipherSha256, keyHash: s.entry.keyHash, sellerPubkey: s.entry.claimPubkey } }]);
    expect(found?.contracts).toHaveLength(1);
    const coin = { txid, vout: found!.contracts[0]!.vout, value: found!.contracts[0]!.value, params: found!.contracts[0]!.params as LockParams };
    expect(binToHex(contractLocking(coin.params))).toBe(p.contracts[0]!.lockingHex);

    // too early: the node refuses
    const early = buildRefund({ contracts: [coin] });
    const tEarly = await chainTime(NET);
    const e = await broadcast(NET, early.hex);
    console.log(`[refund] early refund at chain time ${iso(tEarly)}: ${JSON.stringify(e)}`);
    if (tEarly <= refundTime) {
      expect(e.ok).toBe(false);
      expect(e.ok ? '' : e.nodeError).toMatch(/non-final/i);
    }

    // the specialist cannot reveal its key this close to the refund time
    expect(planClaim(raw, s.entry, NET, s.keys, tEarly)).toMatchObject({ ok: false, status: 409 });

    // wait for chain time to pass the refund time (chipnet: about a block a minute)
    let t = tEarly;
    const w0 = Date.now();
    while (t <= refundTime) {
      if (Date.now() - w0 > 1_200_000) throw new Error(`chain time still ${iso(t)}, refund time ${iso(refundTime)}`);
      await sleep(15_000);
      t = await chainTime(NET);
    }
    console.log(`[refund] chain time ${iso(t)} after ${Math.round((Date.now() - w0) / 1000)} s`);

    // a refund paying someone else is refused by the contract (and not for the time lock)
    const thief = buildRefund({ contracts: [coin] });
    thief.tx.outputs[0]!.locking = lockingFor(PAYOUT.service[NET]);
    const th = await broadcast(NET, binToHex(encodeTx(thief.tx)));
    console.log(`[refund] refund to another address: ${JSON.stringify(th)}`);
    expect(th.ok).toBe(false);
    expect(th.ok ? '' : th.nodeError).not.toMatch(/non-final/i);

    // the refund: no signature, pays the buyer's own address
    const r = buildRefund({ contracts: [coin] });
    expect(binToHex(r.tx.outputs[0]!.locking)).toBe(binToHex(lockingFor(buyerAddr)));
    expect(binToHex(r.tx.outputs[0]!.locking)).toBe(p.buyerLockingHex);
    expect(r.tx.outputs[0]!.value).toBeGreaterThanOrEqual(coin.value - FEE_SATS);
    const ok = await broadcast(NET, r.hex);
    expect(ok.ok, ok.ok ? '' : ok.nodeError).toBe(true);
    console.log(`[refund] refund ${r.txid}: ${r.tx.outputs[0]!.value} sat back to the buyer (contract ${coin.value}, fee ${r.fee})`);
    let st = await contractState(NET, unhex(p.contracts[0]!.lockingHex), { txid, vout: coin.vout });
    for (let i = 0; i < 15 && st.state === 'open'; i++) {
      await sleep(2000);
      st = await contractState(NET, unhex(p.contracts[0]!.lockingHex), { txid, vout: coin.vout });
    }
    expect(st).toMatchObject({ state: 'refunded', txid: r.txid });
    await closeAll();
  });
});
