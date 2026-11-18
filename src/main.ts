/// <reference types="vite/client" />
import './ui/app.js';
import { BANNER, PAID_EXAMPLE } from './config';
import { EXAMPLE } from './data/example';
import { copyText } from './app/copy';
import { NET, openPaidOrder, prepareScene, setWho, WHO, type Orderer } from './app/controller';

prepareScene();

// the example's request in the order field (the same text is in index.html, so nothing flickers)
document.querySelectorAll<HTMLInputElement>('.order-in').forEach((i) => (i.value = EXAMPLE.request));

// "You / Your assistant" above the order field: same scene, same checks; only who created the order changes
document.querySelectorAll<HTMLButtonElement>('.who button').forEach((b) => b.addEventListener('click', () => setWho(b.dataset.who as Orderer)));
setWho(WHO);

// no wallet? a real paid order, next to Pay (only when one is configured: no placeholder link)
if (PAID_EXAMPLE.txid) {
  document.querySelectorAll<HTMLElement>('.foot').forEach((f) => {
    const a = document.createElement('a');
    a.className = 'paid-example';
    a.href = `/?paid=${PAID_EXAMPLE.txid}${PAID_EXAMPLE.net === 'chipnet' ? '&net=chipnet' : ''}`;
    a.textContent = 'See a paid order (no wallet)';
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = ' · ';
    f.append(sep, a);
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
