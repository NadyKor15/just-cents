// Live chipnet run of the kit v3 order, end to end minus the screen, with the site's own code:
// wallet pairs over the real WizardConnect relay → Order.pay builds one payment (cover A, Lena's subtitles, logo, service)
// → wallet signs → broadcast → the release check (libauth, same rules as the worker's /full/) accepts each paid offer
// and refuses Sam's careless file and cover B; the paid files pass their rules.
// The worker itself (API, /full/) reaches the network through a Workers-only WebSocket fetch, so it is checked over HTTP
// against `wrangler pages dev` instead (see build/qa, verify-http).
// Run: LIVE=1 TEST_MNEMONIC=<phrase, from the environment only> npx vitest run test/live/kit-v3.live.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { binToHex, sha256 } from '@bitauth/libauth';
import { WalletLink, type WalletState } from '../../src/core/wallet';
import { closeAll, getRawTx } from '../../src/core/chain';
import { checkPaid } from '../../src/core/release';
import { offerHashHex } from '../../src/core/offer';
import { Order, SPEECH } from '../../src/app/order';
import { OFFERS } from '../../src/data/offers';
import { checkSubtitles } from '../../src/core/subtitles';
import { inspectSvg } from '../../src/core/logo';
import { headlessWallet } from '../helpers/headless-wallet';

const LIVE = process.env.LIVE === '1';

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

describe.skipIf(!LIVE)('chipnet: the kit v3 order, paid and delivered', () => {
  it('pays cover A, Lena and the logo in one transaction; each paid file is released and passes; the rest are refused', { timeout: 180_000 }, async () => {
    const w = headlessWallet(process.env.TEST_MNEMONIC!.trim(), 'testnet');
    const site = new WalletLink(() => {});
    w.mgr.connect(site.open().uri);
    await waitFor(() => site.state, 'connected', 30_000);

    const o = new Order('chipnet', 'sam');
    for (const [slot, key, who] of [['cover', 'cover', undefined], ['lena', 'lena:good', 'lena'], ['logo', 'logo', undefined]] as const) {
      o.results[slot] = { key, who, verdict: { ok: true, note: '' }, offer: OFFERS.chipnet[key]!.signed, detail: '' };
    }
    expect(o.totalCents()).toBe(5);
    const { txid } = await o.pay(site, () => {});
    expect(txid).toMatch(/^[0-9a-f]{64}$/);
    console.log(`chipnet txid ${txid}`);

    // read the transaction back from the network, as a specialist would
    let raw = '';
    for (let i = 0; i < 8 && !raw; i++) {
      raw = await getRawTx('chipnet', txid).catch(() => '');
      if (!raw) await new Promise((r) => setTimeout(r, 2500));
    }
    expect(raw).not.toBe('');
    const paid = (key: string) => {
      const e = OFFERS.chipnet[key]!;
      return checkPaid(raw, { payTo: e.signed.offer.payTo, minSats: BigInt(e.signed.offer.priceSats), orderIdHex: o.id, offerHashHex: offerHashHex(e.signed.offer) });
    };
    for (const key of ['cover', 'lena:good', 'logo']) {
      expect(paid(key).ok, key).toBe(true);
      const bytes = readFileSync(`public/files/${OFFERS.chipnet[key]!.file}`);
      expect(binToHex(sha256.hash(bytes)), key).toBe(OFFERS.chipnet[key]!.signed.offer.fileSha256);
      if (key === 'lena:good') expect(checkSubtitles(bytes.toString('utf8'), SPEECH)).toMatchObject({ ok: true });
      if (key === 'logo') expect(inspectSvg(bytes.toString('utf8'))).toMatchObject({ root: true, raster: false, active: false });
    }
    for (const key of ['sam:careless', 'sam:good', 'cover:b']) expect(paid(key).ok, key).toBe(false);
    site.close();
    closeAll();
  });
});
