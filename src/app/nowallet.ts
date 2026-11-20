// "Open wallet app" on a device with no wallet: the browser just stays put, silently. This module notices that
// and tells the pay window to show a way on (pay from a computer, Cashonize in the browser, or a paid order).
//
// What the wallets accept (read in their sources, 20.11.2026):
//  - WizardConnect links are wiz:// only; there is no https form in the protocol.
//  - Selene registers wiz: on iOS and Android. Cashonize registers it on Android and desktop; on iPhone it is a web
//    wallet, which takes the link as https://cashonize.com/?uri=<link>. Paytaca reads the link from a QR or paste only.
import { PAID_EXAMPLE } from '../config';

/** How long the page waits for the wallet app to take over before it says nothing opened. */
export const NO_WALLET_MS = 2000;

export const NO_WALLET_TITLE = 'No wallet app opened on this device.';
export const NO_WALLET_TEXT =
  'To pay, open this page on a computer and scan the QR with the wallet on your phone, or copy the link into your wallet.';
export const NO_WALLET_PAID = 'See a paid order';
export const NO_WALLET_CASHONIZE = 'Open in Cashonize web wallet';

/** The paid example order, the same address as the button next to Start. */
export function paidExampleHref(): string {
  return `/?paid=${PAID_EXAMPLE.txid}${PAID_EXAMPLE.net === 'chipnet' ? '&net=chipnet' : ''}`;
}

/** Cashonize's web wallet opens its connect window for a wiz:// link passed as ?uri= (when a wallet exists in that browser). */
export function cashonizeWebLink(wizUri: string): string {
  return `https://cashonize.com/?uri=${encodeURIComponent(wizUri)}`;
}

type Listen = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
export interface PageSignals {
  /** where pagehide and focus arrive (window) */
  win: Listen;
  /** where visibilitychange arrives (document); hidden = the page went to the background */
  doc: Listen & { readonly visibilityState: string; hasFocus(): boolean };
}

/** idle: not tapped · waiting: tapped, timer runs · away: focus left, waiting for it to come back · left: the wallet took over · shown · closed */
export type FallbackState = 'idle' | 'waiting' | 'away' | 'left' | 'shown' | 'closed';

/**
 * Call tap() when "Open wallet app" is pressed. If within `ms` the page neither goes to the background nor loses focus,
 * show() runs once. If focus left (a desktop "Open this app?" dialog) the decision waits until focus returns: back
 * without the page ever hiding means nothing opened. Pressing again while waiting, or after the hint is up, adds nothing.
 */
export function walletFallback(env: PageSignals, show: () => void, ms = NO_WALLET_MS) {
  let state: FallbackState = 'idle';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onVisibility = () => {
    if (env.doc.visibilityState === 'hidden') leave();
  };
  const onPageHide = () => leave();
  const onFocus = () => {
    if (state === 'away') fire();
  };

  function listen(on: boolean) {
    const f = on ? 'addEventListener' : 'removeEventListener';
    env.doc[f]('visibilitychange', onVisibility);
    env.win[f]('pagehide', onPageHide);
    env.win[f]('focus', onFocus);
  }
  function stop() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    listen(false);
  }
  function leave() {
    if (state !== 'waiting' && state !== 'away') return;
    state = 'left';
    stop();
  }
  function fire() {
    state = 'shown';
    stop();
    show();
  }
  function deadline() {
    timer = undefined;
    if (state !== 'waiting') return;
    if (env.doc.hasFocus()) fire();
    else state = 'away';
  }

  return {
    get state(): FallbackState {
      return state;
    },
    tap(): void {
      if (state !== 'idle' && state !== 'left') return;
      state = 'waiting';
      listen(true);
      timer = setTimeout(deadline, ms);
    },
    /** the pay window closed or a wallet connected: nothing more to wait for */
    dispose(): void {
      stop();
      state = 'closed';
    },
  };
}
