import './ui/app.js';
import { BANNER } from './config';
import { prepareScene } from './app/controller';

prepareScene();

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
