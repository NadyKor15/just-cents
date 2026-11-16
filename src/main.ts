/// <reference types="vite/client" />
import './ui/app.js';
import { BANNER } from './config';
import { prepareScene, setWho, WHO, type Orderer } from './app/controller';

prepareScene();

// "You / Your assistant" above the order field: same scene, same checks; only who created the order changes
document.querySelectorAll<HTMLButtonElement>('.who button').forEach((b) => b.addEventListener('click', () => setWho(b.dataset.who as Orderer)));
setWho(WHO);

// features switched on at build time (the catalog waits for the owner's go-ahead)
if (import.meta.env.VITE_CATALOG === '1') document.querySelectorAll<HTMLElement>('[data-feature="catalog"]').forEach((e) => (e.hidden = false));

// BLAZE banner: slides, code, CashTokens address (copy on click).
document.querySelectorAll<HTMLAnchorElement>('[data-banner]').forEach((a) => {
  const url = BANNER[a.dataset.banner as keyof typeof BANNER];
  if (url) a.href = url;
  else a.setAttribute('aria-disabled', 'true');
});
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) =>
  b.addEventListener('click', async () => {
    await navigator.clipboard.writeText(b.dataset.copy!).catch(() => {});
    b.classList.add('copied');
    setTimeout(() => b.classList.remove('copied'), 1200);
  }),
);
