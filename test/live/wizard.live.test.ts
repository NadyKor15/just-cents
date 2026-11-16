// Live chipnet check of the whole payment path, minus the screen:
// site pairs with a wallet over the real WizardConnect relay → finds its coins → builds one payment
// (accepted specialists + helper + change + note) → wallet signs → we broadcast → each specialist's
// release check accepts it, and the rejected one has nothing.
// Run: LIVE=1 TEST_MNEMONIC_FILE=<file with the test phrase> npx vitest run test/live
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { binToHex, createVirtualMachineBch2026, decodeTransaction, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import { WalletLink, type WalletState } from '../../src/core/wallet';
import { broadcast, closeAll, getRawTx } from '../../src/core/chain';
import { buildPayment, noteText } from '../../src/core/tx';
import { checkPaid } from '../../src/core/release';
import { headlessWallet, type SignLog } from '../helpers/headless-wallet';

const LIVE = process.env.LIVE === '1';
const PAYEES = {
  icon: 'bchtest:qplw5l88wxt2chzufr3rm22pfxkgaeu3vsukqg96qk',
  lena: 'bchtest:qrzvk9ujc48fylttn48f3tkkjnmetpx6vqdhsxvdx3',
  voice: 'bchtest:qz7t9gc3y9m89wzmj3x7zderx2e9f72lrcczjzhcs2',
  helper: 'bchtest:qqczcf6dcqm62u0prm2qnre4655w5236qytf8scfkf',
  sam: 'bchtest:qpdsappf99xzval2l6ps8x29204y8uyasykmntg7ys',
};

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

describe.skipIf(!LIVE)('chipnet: pair, sign, broadcast, release', () => {
  it('pays three accepted specialists and the helper in one transaction', { timeout: 120_000 }, async () => {
    const mnemonic = readFileSync(process.env.TEST_MNEMONIC_FILE!, 'utf8').trim();
    const logs: SignLog[] = [];
    const w = headlessWallet(mnemonic, 'testnet', (l) => logs.push(l));
    const site = new WalletLink(() => {});
    const { uri } = site.open();
    w.mgr.connect(uri);
    await waitFor(() => site.state, 'connected', 30_000);
    expect(site.net()).toBe('chipnet');

    const coins = await site.coins('chipnet');
    expect(coins.length).toBeGreaterThan(0);

    const orderId = binToHex(sha256.hash(utf8ToBin(`live-${Date.now()}`)).slice(0, 16));
    const offerHashes = ['icon', 'lena', 'voice'].map((s) => binToHex(sha256.hash(utf8ToBin(`${orderId}-${s}`))));
    const p = buildPayment({
      utxos: coins,
      payouts: [
        { label: 'Icon', address: PAYEES.icon, sats: 1500n },
        { label: 'Description (Lena)', address: PAYEES.lena, sats: 1000n },
        { label: 'Voice-over', address: PAYEES.voice, sats: 1000n },
        { label: 'Helper', address: PAYEES.helper, sats: 600n },
      ],
      note: noteText(orderId, offerHashes),
    });
    const signed = await site.sign(p, 'Just Cents: pay 3 specialists + helper');
    expect(signed.ok, signed.ok ? '' : signed.error).toBe(true);
    if (!signed.ok) return;
    expect(logs[0]).toMatchObject({ rawTxType: 'string', broadcast: false, userPrompt: 'Just Cents: pay 3 specialists + helper', outputs: 6 });

    const vm = createVirtualMachineBch2026(true);
    const tx = decodeTransaction(hexToBin(signed.signedHex));
    if (typeof tx === 'string') throw new Error(tx);
    expect(vm.verify({ sourceOutputs: p.sourceOutputs, transaction: tx })).toBe(true);

    const sent = await broadcast('chipnet', signed.signedHex);
    expect(sent.ok, sent.ok ? '' : sent.nodeError).toBe(true);
    const txid = sent.ok ? sent.txid : '';
    console.log('chipnet txid', txid, 'fee', p.fee, 'size', p.size);

    const raw = await getRawTx('chipnet', txid);
    for (const [who, i] of [['icon', 0], ['lena', 1], ['voice', 2]] as const) {
      const r = checkPaid(raw, { payTo: PAYEES[who], minSats: who === 'icon' ? 1500n : 1000n, orderIdHex: orderId, offerHashHex: offerHashes[i]! });
      expect(r.ok, `${who}: ${r.ok ? '' : r.reason}`).toBe(true);
    }
    const sam = checkPaid(raw, { payTo: PAYEES.sam, minSats: 1n, orderIdHex: orderId, offerHashHex: offerHashes[1]! });
    expect(sam.ok).toBe(false);

    site.close();
    w.mgr.disconnectAll();
    await closeAll();
  });
});
