/// <reference types="vite/client" />
import './ui/app.js';
import { BANNER, PAID_EXAMPLE, REFUND_PROOF } from './config';
import { explorerTx } from './core/chain';
import { EXAMPLE } from './data/example';
import { copyAndConfirm, copyText } from './app/copy';
import { paidExampleHref } from './app/nowallet';
import { NET, openPaidOrder, prepareScene, setWho, WHO, type Orderer } from './app/controller';

prepareScene();

// the example's request in the order field (the same text is in index.html, so nothing flickers)
document.querySelectorAll<HTMLInputElement>('.order-in').forEach((i) => (i.value = EXAMPLE.request));

// "You / Your assistant" above the order field: same scene, same checks; only who created the order changes
document.querySelectorAll<HTMLButtonElement>('.who button').forEach((b) => b.addEventListener('click', () => setWho(b.dataset.who as Orderer)));
setWho(WHO);

// no wallet? a real paid order: a second button next to Start, from the first screen on (only when one is configured:
// no placeholder link). It replaces the small line that used to appear next to Pay only after the scene.
if (PAID_EXAMPLE.txid) {
  document.querySelectorAll<HTMLAnchorElement>('[data-paid-example]').forEach((a) => {
    a.href = paidExampleHref();
    a.hidden = false;
  });
}
// next to it, the refund proof: mainnet refused an early refund, then paid it back with no signature (two explorer links)
if (REFUND_PROOF.payment && REFUND_PROOF.refund) {
  document.querySelectorAll<HTMLElement>('[data-refund-proof]').forEach((p) => {
    p.querySelectorAll<HTMLAnchorElement>('a[data-tx]').forEach((a) => (a.href = explorerTx(REFUND_PROOF.net, REFUND_PROOF[a.dataset.tx as 'payment' | 'refund'])));
    p.hidden = false;
  });
}
const paidTx = new URLSearchParams(location.search).get('paid');
if (paidTx && /^[0-9a-f]{64}$/.test(paidTx)) void openPaidOrder(paidTx, NET);

// BLAZE banner: slides, code, CashTokens address (copy on click).
document.querySelectorAll<HTMLAnchorElement>('[data-banner]').forEach((a) => {
  const url = BANNER[a.dataset.banner as keyof typeof BANNER];
  if (url) a.href = url;
  else {
    // not published yet: shown greyed, and a click goes nowhere (no empty tab)
    a.removeAttribute('href');
    a.removeAttribute('target');
    a.setAttribute('aria-disabled', 'true');
    a.title = 'Coming soon';
  }
});
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) =>
  b.addEventListener('click', async () => {
    const ok = await copyText(b.dataset.copy!);
    b.classList.add(ok ? 'copied' : 'copy-failed');
    b.title = ok ? 'Copied' : 'Could not copy: select the address and copy it';
    setTimeout(() => b.classList.remove('copied', 'copy-failed'), 1600);
  }),
);
document.querySelectorAll<HTMLButtonElement>('[data-copy-btn]').forEach((b) => b.addEventListener('click', () => void copyAndConfirm(b, b.dataset.copyBtn!)));
