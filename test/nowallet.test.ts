// "Open wallet app" with no wallet on the device: the hint appears only when the page stayed put.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  walletFallback,
  cashonizeWebLink,
  paidExampleHref,
  NO_WALLET_MS,
  NO_WALLET_TITLE,
  NO_WALLET_TEXT_PHONE,
  NO_WALLET_TEXT_COMPUTER,
  noWalletText,
  NO_WALLET_PAID,
  NO_WALLET_CASHONIZE,
  type PageSignals,
} from '../src/app/nowallet';
import { PAID_EXAMPLE } from '../src/config';

class FakeDoc extends EventTarget {
  visibilityState = 'visible';
  focused = true;
  hasFocus() {
    return this.focused;
  }
  hide() {
    this.visibilityState = 'hidden';
    this.dispatchEvent(new Event('visibilitychange'));
  }
  show() {
    this.visibilityState = 'visible';
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function page() {
  const win = new EventTarget();
  const doc = new FakeDoc();
  const env: PageSignals = { win, doc };
  const show = vi.fn();
  const fb = walletFallback(env, show);
  return { win, doc, show, fb };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('walletFallback', () => {
  it('waits 2 s', () => expect(NO_WALLET_MS).toBe(2000));

  it('the page stayed put for 2 s → the hint, once', () => {
    const { show, fb } = page();
    fb.tap();
    vi.advanceTimersByTime(NO_WALLET_MS - 1);
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledTimes(1);
    expect(fb.state).toBe('shown');
  });

  it('the page went to the background (a wallet app opened) → no hint', () => {
    const { doc, show, fb } = page();
    fb.tap();
    vi.advanceTimersByTime(500);
    doc.hide();
    vi.advanceTimersByTime(5000);
    doc.show(); // back from the wallet
    vi.advanceTimersByTime(5000);
    expect(show).not.toHaveBeenCalled();
    expect(fb.state).toBe('left');
  });

  it('pagehide → no hint', () => {
    const { win, show, fb } = page();
    fb.tap();
    win.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(5000);
    expect(show).not.toHaveBeenCalled();
  });

  it('a visibilitychange that stays visible does not count as leaving', () => {
    const { doc, show, fb } = page();
    fb.tap();
    doc.show();
    vi.advanceTimersByTime(NO_WALLET_MS);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('pressing again and again adds no second hint', () => {
    const { show, fb } = page();
    fb.tap();
    vi.advanceTimersByTime(800);
    fb.tap();
    fb.tap();
    vi.advanceTimersByTime(NO_WALLET_MS);
    expect(show).toHaveBeenCalledTimes(1);
    fb.tap();
    vi.advanceTimersByTime(NO_WALLET_MS * 3);
    expect(show).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('after a wallet opened and the person came back, a new press can still lead to the hint', () => {
    const { doc, show, fb } = page();
    fb.tap();
    doc.hide();
    doc.show();
    fb.tap();
    vi.advanceTimersByTime(NO_WALLET_MS);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('focus left at 2 s (a desktop "Open this app?" dialog) → wait; the app opened → no hint', () => {
    const { doc, show, fb } = page();
    fb.tap();
    doc.focused = false;
    vi.advanceTimersByTime(NO_WALLET_MS);
    expect(show).not.toHaveBeenCalled();
    expect(fb.state).toBe('away');
    doc.hide();
    expect(fb.state).toBe('left');
    expect(show).not.toHaveBeenCalled();
  });

  it('focus left and came back without the page ever hiding (dialog cancelled) → the hint', () => {
    const { win, doc, show, fb } = page();
    fb.tap();
    doc.focused = false;
    vi.advanceTimersByTime(NO_WALLET_MS + 4000);
    expect(show).not.toHaveBeenCalled();
    doc.focused = true;
    win.dispatchEvent(new Event('focus'));
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('focus events before the 2 s are not a decision', () => {
    const { win, show, fb } = page();
    fb.tap();
    win.dispatchEvent(new Event('focus'));
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(NO_WALLET_MS);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('nothing happens before a press', () => {
    const { doc, win, show, fb } = page();
    win.dispatchEvent(new Event('focus'));
    doc.hide();
    vi.advanceTimersByTime(NO_WALLET_MS * 2);
    expect(show).not.toHaveBeenCalled();
    expect(fb.state).toBe('idle');
  });

  it('the window closed (or a wallet connected) while waiting → no hint, no timer left, presses ignored', () => {
    const { win, show, fb } = page();
    fb.tap();
    fb.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(NO_WALLET_MS * 2);
    win.dispatchEvent(new Event('focus'));
    fb.tap();
    vi.advanceTimersByTime(NO_WALLET_MS * 2);
    expect(show).not.toHaveBeenCalled();
    expect(fb.state).toBe('closed');
  });

  it('listeners are removed after a decision', () => {
    const win = new EventTarget();
    const doc = new FakeDoc();
    const rm = vi.spyOn(win, 'removeEventListener');
    const rmDoc = vi.spyOn(doc, 'removeEventListener');
    const fb = walletFallback({ win, doc }, () => {});
    fb.tap();
    vi.advanceTimersByTime(NO_WALLET_MS);
    expect(rm.mock.calls.map((c) => c[0]).sort()).toEqual(['focus', 'pagehide']);
    expect(rmDoc.mock.calls.map((c) => c[0])).toEqual(['visibilitychange']);
  });
});

describe('hint links and text', () => {
  it('Cashonize web link carries the whole wiz:// link as ?uri=', () => {
    const wiz = 'wiz://?p=qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce6mua7l&s=qpzry9x8';
    const u = new URL(cashonizeWebLink(wiz));
    expect(u.origin).toBe('https://cashonize.com');
    expect(u.pathname).toBe('/');
    expect(u.searchParams.get('uri')).toBe(wiz);
    expect([...u.searchParams.keys()]).toEqual(['uri']);
  });

  it('"See a paid order" goes to the configured paid example', () => {
    expect(PAID_EXAMPLE.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(paidExampleHref()).toBe(`/?paid=${PAID_EXAMPLE.txid}${PAID_EXAMPLE.net === 'chipnet' ? '&net=chipnet' : ''}`);
  });

  it('short, plain English, no "kit"', () => {
    const all = [NO_WALLET_TITLE, NO_WALLET_TEXT_PHONE, NO_WALLET_TEXT_COMPUTER, NO_WALLET_PAID, NO_WALLET_CASHONIZE].join(' ');
    expect(all).not.toMatch(/\bkits?\b|набор/i);
    expect(NO_WALLET_TITLE.length + NO_WALLET_TEXT_PHONE.length).toBeLessThan(180);
    for (const t of [NO_WALLET_TEXT_PHONE, NO_WALLET_TEXT_COMPUTER]) expect(t).toMatch(/scan the QR.*copy the link into your wallet/);
  });

  it('a phone is told to use a computer for the QR; a computer is not', () => {
    expect(noWalletText(true)).toBe(NO_WALLET_TEXT_PHONE);
    expect(noWalletText(false)).toBe(NO_WALLET_TEXT_COMPUTER);
    expect(NO_WALLET_TEXT_PHONE).toMatch(/open this page on a computer/);
    expect(NO_WALLET_TEXT_COMPUTER).not.toMatch(/computer/);
  });
});
