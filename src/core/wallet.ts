// The site's side of WizardConnect: pair with the person's wallet (Cashonize, Selene, Paytaca),
// read its public keys, find its coins, ask it to sign one payment. The wallet never gets our code;
// we never get its keys.
//
// Wallet facts we design around (read in their sources, see docs/WALLETS.md):
//  - Selene and Paytaca accept the transaction only as a hex string.
//  - Paytaca broadcasts by itself unless the request says broadcast: false. We always send false and broadcast ourselves.
//  - The relay carries plain JSON; bigint and bytes travel as libauth "extended JSON" strings (libauth stringify).
//  - The handshake does not name the network; the xpub prefix does (xpub = mainnet, tpub = test networks).
import { initiateDappRelay, type DappRelayResult } from '@wizardconnect/core';
import { DappConnectionManager } from '@wizardconnect/dapp';
import { binToHex, encodeTransaction, hash160, encodeCashAddress, stringify } from '@bitauth/libauth';
import type { Net } from './chain';
import { listUnspent } from './chain';
import { lockingFor, type BuiltPayment, type Utxo } from './tx';

export const RELAY_URLS = ['wss://relay.riften.net:443', 'wss://relay.cauldron.quest:443'];
export const SIGN_TIMEOUT_MS = 5 * 60_000;
/** How far we look for coins on each chain of addresses. */
export const SCAN_DEPTH = 20;

export type WalletState =
  | { kind: 'idle' }
  | { kind: 'pairing'; uri: string; qrUri: string }
  | { kind: 'waiting-wallet'; walletName: string | null }
  | { kind: 'connected'; walletName: string | null; net: Net | 'unknown' }
  | { kind: 'reconnecting' }
  | { kind: 'closed'; message?: string };

export type SignOutcome = { ok: true; signedHex: string } | { ok: false; error: string };

type PathName = 'receive' | 'change';
const CHILD: Record<PathName, number> = { receive: 0, change: 1 };

export class WalletLink {
  private mgr: DappConnectionManager | null = null;
  private relay: DappRelayResult | null = null;
  state: WalletState = { kind: 'idle' };

  constructor(
    private readonly onChange: (s: WalletState) => void,
    private readonly dappName = 'Just Cents',
    private readonly dappIcon?: string,
    private readonly relayUrls = RELAY_URLS,
  ) {}

  private set(s: WalletState) {
    this.state = s;
    this.onChange(s);
  }

  /** Opens a new pairing and returns the wiz:// link to show as QR or to paste into the wallet. */
  open(): { uri: string; qrUri: string } {
    this.close();
    const mgr = new DappConnectionManager(this.dappName, this.dappIcon, { session: false });
    this.mgr = mgr;
    mgr.on('walletready', () => {
      // Some wallets announce themselves before the person approves; no paths yet means "not approved yet".
      if (mgr.getSessionPaths().length === 0) return this.set({ kind: 'waiting-wallet', walletName: mgr.walletName });
      this.set({ kind: 'connected', walletName: mgr.walletName, net: this.net() });
    });
    mgr.on('reconnecting', () => {
      if (this.state.kind === 'connected') this.set({ kind: 'reconnecting' });
    });
    mgr.on('disconnect', (_reason: unknown, message?: string) => {
      this.set({ kind: 'closed', message: message ?? undefined });
    });
    const relay = initiateDappRelay((p) => mgr.updateConnection(p.client, p.status), { explicitRelayUrls: this.relayUrls });
    this.relay = relay;
    mgr.attachRelay(relay);
    this.set({ kind: 'pairing', uri: relay.uri, qrUri: relay.qrUri });
    return { uri: relay.uri, qrUri: relay.qrUri };
  }

  close(): void {
    if (this.mgr) {
      this.mgr.sendDisconnect().catch(() => {});
      this.mgr.destroy();
    }
    this.relay?.cleanup();
    this.mgr = null;
    this.relay = null;
    if (this.state.kind !== 'idle') this.set({ kind: 'idle' });
  }

  net(): Net | 'unknown' {
    const r = this.mgr?.getSessionPaths().find((p) => p.name === 'receive');
    if (!r) return 'unknown';
    if (r.xpub.startsWith('xpub')) return 'mainnet';
    if (r.xpub.startsWith('tpub')) return 'chipnet';
    return 'unknown';
  }

  address(path: PathName, index: number, net: Net): string {
    const pk = this.mgr?.getPubkey(CHILD[path], BigInt(index));
    if (!pk) throw new Error(`the wallet did not share its ${path} addresses`);
    return encodeCashAddress({ prefix: net === 'mainnet' ? 'bitcoincash' : 'bchtest', type: 'p2pkh', payload: hash160(pk) }).address;
  }

  /** Coins on the first SCAN_DEPTH receive and change addresses. Unconfirmed coins count: BCH 0-conf is normal. */
  async coins(net: Net): Promise<Utxo[]> {
    const out: Utxo[] = [];
    const jobs: Promise<void>[] = [];
    for (const path of ['receive', 'change'] as const) {
      for (let i = 0; i < SCAN_DEPTH; i++) {
        let addr: string;
        try {
          addr = this.address(path, i, net);
        } catch {
          break;
        }
        jobs.push(
          listUnspent(net, addr).then((list) => {
            for (const u of list) {
              out.push({ txid: u.tx_hash, vout: u.tx_pos, sats: BigInt(u.value), lockingBytecode: lockingFor(addr), path, index: i });
            }
          }),
        );
      }
    }
    await Promise.all(jobs);
    return out;
  }

  async sign(p: BuiltPayment, userPrompt: string): Promise<SignOutcome> {
    const mgr = this.mgr;
    if (!mgr || this.state.kind !== 'connected') return { ok: false, error: 'wallet not connected' };
    const transaction = JSON.parse(
      stringify({
        transaction: binToHex(encodeTransaction(p.transaction)),
        sourceOutputs: p.sourceOutputs,
        broadcast: false,
        userPrompt,
      }),
    );
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), SIGN_TIMEOUT_MS);
    try {
      const res = await mgr.signTransaction({ transaction, inputPaths: p.inputPaths }, { signal: ac.signal });
      if (res.error) return { ok: false, error: res.error };
      if (!res.signedTransaction) return { ok: false, error: 'the wallet returned nothing' };
      return { ok: true, signedHex: res.signedTransaction };
    } catch (e) {
      if (ac.signal.aborted) return { ok: false, error: 'no answer from the wallet in 5 minutes' };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }
}
