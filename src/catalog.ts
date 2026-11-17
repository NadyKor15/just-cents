// Catalog: six kinds of work, live demo specialists where we have them, and an honest empty slot elsewhere.
import { OFFERS } from './data/offers';
import { RULES } from './core/rules';
import { explorerTx } from './core/chain';

type Live = { id: 'icon' | 'sam' | 'lena' | 'voice'; title: string; who: string; offerKey: string; example: () => HTMLElement; rule: string; extra?: string };
/** main: what the live specialists here do, with their rule; also: the example job from the home page, no specialist yet. */
type Section = { title: string; main?: string; rule: string; live: Live[] };

const el = <K extends keyof HTMLElementTagNameMap>(t: K, cls?: string, text?: string) => {
  const e = document.createElement(t);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const NET = 'mainnet' as const;

function img(src: string, alt: string) {
  const i = new Image();
  i.src = src;
  i.alt = alt;
  i.loading = 'lazy';
  return i;
}

function musicLine(key: string) {
  const e = OFFERS[NET][key]!;
  const [sec, lic, author] = e.signed.offer.facts.split(';');
  const d = el('div', 'c-ex');
  d.appendChild(el('div', 'c-lines', `${author ?? ''} · ${lic ?? ''} · ${parseFloat(sec ?? '').toFixed(1)} s`));
  const a = el('audio');
  a.controls = true;
  a.preload = 'metadata';
  a.src = e.preview as string;
  d.appendChild(a);
  return d;
}

const SECTIONS: Section[] = [
  {
    title: '3D and games',
    main: 'A game icon. Rule: 1024×1024, no letters.',
    rule: 'A 3D model for printing. Rule: the model is watertight and fits your printer bed.',
    live: [
      {
        id: 'icon',
        title: 'Game icon, two variants',
        who: 'icon (demo specialist)',
        offerKey: 'icon',
        rule: RULES.icon.text,
        extra: 'Two variants pass the same rules; you pay only for the one you pick.',
        example: () => {
          const d = el('div', 'c-ex');
          d.append(img(OFFERS[NET]['icon']!.preview as string, 'Icon preview A'), img(OFFERS[NET]['icon:b']!.preview as string, 'Icon preview B'));
          return d;
        },
      },
    ],
  },
  { title: 'Documents', rule: 'A receipt photo turned into a table. Rule: the rows add up to the receipt total.', live: [] },
  { title: 'Texts', rule: 'A product description. Rule: under 300 characters, in the language you asked for.', live: [] },
  {
    title: 'Sound',
    main: 'Music for a clip. Rule: exactly 15 seconds, CC0 or CC BY, the licence written into the file.',
    rule: 'Sound effects for a game. Rule: each one under 2 seconds, CC0 or CC BY.',
    live: [
      { id: 'lena', title: 'Music for a clip, 15 s', who: 'Lena (demo specialist)', offerKey: 'lena:good', rule: RULES.music.text, example: () => musicLine('lena:good') },
      {
        id: 'sam',
        title: 'Music for a clip, 15 s',
        who: 'Sam (demo specialist, careless on purpose)',
        offerKey: 'sam:careless',
        rule: RULES.music.text,
        extra: 'Sam often sends 17.2 s where exactly 15 s was asked. That piece is rejected and costs 0¢.',
        example: () => musicLine('sam:careless'),
      },
      {
        id: 'voice',
        title: 'Voice-over for a store page',
        who: 'voice (demo specialist)',
        offerKey: 'voice',
        rule: RULES.voice.text,
        example: () => {
          const d = el('div', 'c-ex');
          const a = el('audio');
          a.controls = true;
          a.preload = 'metadata';
          a.src = OFFERS[NET]['voice']!.preview as string;
          d.appendChild(a);
          return d;
        },
      },
    ],
  },
  { title: 'Video', rule: 'Subtitles for your video. Rule: every line lands on the right second.', live: [] },
  { title: 'Code', rule: 'A small web page. Rule: every link on it opens.', live: [] },
];

async function paidJobs(id: string, into: HTMLElement) {
  into.textContent = 'Reading paid work from the network…';
  try {
    const r = await fetch(`/api/specialists/${id}/history?net=${NET}`);
    const j = (await r.json()) as { paid_jobs?: { txid: string; sats: number; height: number | null }[]; reason?: string };
    if (!r.ok) throw new Error(j.reason ?? String(r.status));
    into.textContent = '';
    const jobs = j.paid_jobs ?? [];
    into.appendChild(el('div', '', jobs.length ? `Paid work on chain (${jobs.length}):` : 'No paid work on chain yet.'));
    const ul = el('ul');
    for (const x of jobs.slice(0, 5)) {
      const li = el('li');
      const a = el('a', '', `${x.txid.slice(0, 10)}…${x.txid.slice(-6)}`);
      a.href = explorerTx(NET, x.txid);
      a.target = '_blank';
      a.rel = 'noopener';
      li.append(a, document.createTextNode(` · ${x.sats.toLocaleString('en-US')} sat${x.height ? '' : ' · unconfirmed'}`));
      ul.appendChild(li);
    }
    into.appendChild(ul);
  } catch (e) {
    into.textContent = `Could not read the network right now (${e instanceof Error ? e.message : e}).`;
  }
}

const root = document.getElementById('sections')!;
for (const s of SECTIONS) {
  const sec = el('section', 'c-sect');
  sec.appendChild(el('h2', '', s.title));
  const ruleLine = (text: string, prefix = '', suffix = '') => {
    const [card, rule] = text.split(' Rule: ');
    const r = el('p', 'c-rule');
    r.append(document.createTextNode(`${prefix}${card} `), el('b', '', 'Rule:'), document.createTextNode(` ${rule}${suffix}`));
    return r;
  };
  if (s.main) {
    sec.appendChild(ruleLine(s.main));
    const also = ruleLine(s.rule, 'Also here: ', ' No specialist yet.');
    also.classList.add('c-also');
    sec.appendChild(also);
  } else sec.appendChild(ruleLine(s.rule));
  if (!s.live.length) {
    const e = el('div', 'c-empty');
    e.append(document.createTextNode('No specialists yet — be the first. '));
    const a = el('a', '', 'Become a specialist');
    a.href = '/#specialist';
    e.appendChild(a);
    sec.appendChild(e);
  } else {
    const grid = el('div', 'c-specs');
    for (const l of s.live) {
      const o = OFFERS[NET][l.offerKey]!.signed.offer;
      const c = el('article', 'c-spec');
      c.append(el('h3', '', l.title), el('p', 'c-who', l.who), l.example());
      const dl = el('dl');
      const row = (k: string, v: string) => dl.append(el('dt', '', k), el('dd', '', v));
      row('Price', `${o.priceCents}¢ (${Number(o.priceSats).toLocaleString('en-US')} sat)`);
      row('Rule', l.rule);
      row('Terms', 'Signed offer with the fingerprint of the full file; the full file after the payment is seen on chain.');
      if (l.extra) row('Note', l.extra);
      c.appendChild(dl);
      const paid = el('div', 'c-paid');
      c.appendChild(paid);
      void paidJobs(l.id, paid);
      const btn = el('a', 'c-order', 'Order the game kit');
      btn.href = '/';
      c.appendChild(btn);
      grid.appendChild(c);
    }
    sec.appendChild(grid);
  }
  root.appendChild(sec);
}
