/// <reference types="vite/client" />
import './ui/app.js';
import { BANNER } from './config';
import { EXAMPLE } from './data/example';
import { copyText } from './app/copy';
import { prepareScene, setWho, WHO, type Orderer } from './app/controller';

prepareScene();

// the example's request in the order field (the same text is in index.html, so nothing flickers)
document.querySelectorAll<HTMLInputElement>('.order-in').forEach((i) => (i.value = EXAMPLE.request));

// "You / Your assistant" above the order field: same scene, same checks; only who created the order changes
document.querySelectorAll<HTMLButtonElement>('.who button').forEach((b) => b.addEventListener('click', () => setWho(b.dataset.who as Orderer)));
setWho(WHO);

// features switched on at build time (the catalog waits for the owner's go-ahead)
if (import.meta.env.VITE_CATALOG === '1') document.querySelectorAll<HTMLElement>('[data-feature="catalog"]').forEach((e) => (e.hidden = false));

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
