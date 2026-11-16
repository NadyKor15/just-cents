// Eight symbol candidates (cut out of their PNG sheets, background removed).
// Each one has its own short "accepted" animation: s5 check draws itself, s6 crystal core
// flashes lime, s7 three tiles fold into a stack, s1 spark, s2 coin with a lime trail; s3/s4/s8 got one too.
// Coordinates below are in the natural pixels of assets/sym/sN-3d.png.

export const SYMS = [
  // home: where the Tick character stands when it is "back in the mark" (natural px of the PNG; feet point)
  { key: 's5', name: 'Check ¢', w: 400, h: 520, home: [196, 284], inMark: true },
  { key: 's6', name: 'Crystal', w: 372, h: 520, home: [214, 14] },
  { key: 's7', name: 'Stack', w: 489, h: 520, home: [262, 150] },
  { key: 's1', name: 'Spark ¢', w: 408, h: 520, home: [205, 52] },
  { key: 's2', name: 'Coin and spark', w: 408, h: 520, home: [200, 60] },
  { key: 's3', name: 'Route', w: 406, h: 520, home: [220, 8] },
  { key: 's4', name: 'Chip', w: 476, h: 520, home: [300, 22] },
  { key: 's8', name: 'Orbit', w: 520, h: 414, home: [300, 14], noPedestal: true },
];

const LIME = '#e4ff3c';
export const symfx = { s5out: 0 }; // 1 = the Tick is outside, s5 shows its no-check picture

// per-stage placement (stage units): centre x, bottom y, height
const PLACE = {
  d: { cx: 196, bottom: 838, h: 300, h8: 200, bottom8: 806 },
  m: { cx: 195, bottom: 316, h: 112, h8: 80, bottom8: 300 },
};

function overlay(sym) {
  const { key, w, h } = sym;
  const glow = `<defs><filter id="g${key}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0" stdDeviation="${w / 60}" flood-color="${LIME}" flood-opacity=".95"/></filter>
    <radialGradient id="r${key}"><stop offset="0" stop-color="#f6ffb0" stop-opacity="1"/><stop offset=".45" stop-color="${LIME}" stop-opacity=".85"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient></defs>`;
  let body = '';
  if (key === 's5') body = `<path class="fx-check" d="M150 222 L206 276 L304 114" fill="none" stroke="${LIME}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" filter="url(#g${key})" opacity="0"/>`;
  if (key === 's6') body = `<ellipse class="fx-core" cx="210" cy="262" rx="70" ry="140" fill="url(#r${key})" opacity="0"/>`;
  if (key === 's1') body = `<g transform="translate(265 235)"><g class="fx-star" opacity="0"><path d="M0 -150 C10 -30 30 -10 95 0 C30 10 10 30 0 150 C-10 30 -30 10 -95 0 C-30 -10 -10 -30 0 -150Z" fill="${LIME}" filter="url(#g${key})"/><circle r="22" fill="#fbffe0"/></g></g>`;
  if (key === 's2') body = `<path class="fx-trail" d="M20 70 Q140 -20 300 70" fill="none" stroke="${LIME}" stroke-width="12" stroke-linecap="round" filter="url(#g${key})" opacity="0"/>
    <g transform="translate(300 70)"><g class="fx-star" opacity="0"><path d="M0 -60 C5 -12 12 -5 40 0 C12 5 5 12 0 60 C-5 12 -12 5 -40 0 C-12 -5 -5 -12 0 -60Z" fill="#f8ffc8" filter="url(#g${key})"/></g></g>`;
  if (key === 's3') body = [[220, 45, 0], [95, 210, 1], [220, 210, 1], [345, 210, 1], [220, 378, 2]]
    .map(([x, y, r]) => `<circle class="fx-node fx-n${r}" cx="${x}" cy="${y}" r="${r === 2 ? 70 : 52}" fill="url(#r${key})" opacity="0"/>`).join('');
  if (key === 's4') body = `<circle class="fx-core" cx="300" cy="245" r="140" fill="url(#r${key})" opacity="0"/>`;
  if (key === 's8') body = `<g transform="rotate(-21.3 262 166)"><ellipse cx="262" cy="166" rx="262" ry="44" fill="none" stroke="none"/>
    <circle class="fx-orb" cx="0" cy="0" r="20" fill="#fbffe0" filter="url(#g${key})" opacity="0"/></g>`;
  return `<svg class="ov" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${glow}${body}</svg>`;
}

// s7: three copies of the picture clipped to the three plates, so they can fold into a stack
const S7_LAYERS = [
  { cls: 'l-ped', clip: 'polygon(0% 76%, 100% 76%, 100% 100%, 0% 100%)' },
  { cls: 'l-bot', clip: 'polygon(14% 40%, 100% 40%, 100% 52%, 55% 81%, 14% 52%)', dy: 0 },
  { cls: 'l-mid', clip: 'polygon(14% 29%, 100% 29%, 100% 42%, 55% 69%, 14% 42%)', dy: 1 },
  { cls: 'l-top', clip: 'polygon(14% 25%, 54% 5%, 100% 25%, 100% 34%, 55% 56%, 14% 34%)', dy: 2 },
];

export function buildSymbols(st, key, gsap, sh = 0) {
  const P0 = PLACE[key], P = { ...P0, bottom: P0.bottom + sh, bottom8: P0.bottom8 + sh };
  const pod = st.querySelector('.sym-pod');
  pod.style.left = '0'; pod.style.top = '0'; pod.style.width = st.dataset.w + 'px'; pod.style.height = st.dataset.h + 'px';
  pod.innerHTML = '';
  const mini = st.querySelector('.wm-ic'); mini.innerHTML = '';
  const sw = st.querySelector('.sym-switch'); sw.innerHTML = '';
  const els = SYMS.map((sym, i) => {
    const hh = sym.noPedestal ? P.h8 : P.h, ww = hh * sym.w / sym.h, bottom = sym.noPedestal ? P.bottom8 : P.bottom;
    const s = document.createElement('div'); s.className = `s s-${sym.key}`;
    Object.assign(s.style, { left: `${P.cx - ww / 2}px`, top: `${bottom - hh}px`, width: `${ww}px`, height: `${hh}px`, opacity: i === 0 ? 1 : 0 });
    const src = `assets/sym/${sym.key}-3d.png`;
    const inner = sym.key === 's7'
      ? S7_LAYERS.map((l) => `<div class="lay ${l.cls}" style="clip-path:${l.clip};-webkit-clip-path:${l.clip}"><img src="${src}" alt="" style="width:100%;height:100%"></div>`).join('')
      : sym.key === 's5' ? `<img class="main" src="${src}" alt=""><img class="nochk" src="assets/sym/s5-3d-nocheck.png" alt="" style="opacity:0">`
      : `<img src="${src}" alt="">`;
    s.innerHTML = `<div class="sf"><div class="acc" style="position:absolute;inset:0;transform-origin:50% 100%">${inner}${overlay(sym)}</div></div>`;
    pod.appendChild(s);
    const m = document.createElement('div'); m.className = 'm'; m.style.backgroundImage = `url(assets/sym/${sym.key}-icon.png)`; m.style.opacity = i === 0 ? 1 : 0; mini.appendChild(m);
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
    b.setAttribute('aria-label', `Symbol ${sym.key}: ${sym.name}`); b.title = `${sym.key} · ${sym.name}`; b.style.backgroundImage = `url(assets/sym/${sym.key}-icon.png)`;
    sw.appendChild(b);
    return { sym, s, m, b, sf: s.querySelector('.sf'), acc: s.querySelector('.acc') };
  });

  const state = { idx: 0, cur: 0, s8: 0 }; // idx = last requested (build order), cur = shown now (seekable)

  function accept(i) {
    const { sym, s, acc } = els[i];
    const q = (sel) => s.querySelectorAll(sel);
    const tl = gsap.timeline();
    tl.to(acc, { scale: 1.06, duration: .16, ease: 'power2.out' }).to(acc, { scale: 1, duration: .5, ease: 'elastic.out(1, .45)' });
    switch (sym.key) {
      case 's5': { // the check mark draws itself in lime
        const p = q('.fx-check')[0], L = 290;
        tl.set(p, { attr: { 'stroke-dasharray': L, 'stroke-dashoffset': L }, opacity: 1 }, 0)
          .to(p, { attr: { 'stroke-dashoffset': 0 }, duration: .55, ease: 'power2.inOut' }, .05)
          .to(p, { opacity: 0, duration: .5 }, .9);
        break;
      }
      case 's6': // crystal core flashes lime
        tl.fromTo(q('.fx-core'), { opacity: 0, scale: .55, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1.15, duration: .3, ease: 'power2.out' }, 0)
          .to(q('.fx-core'), { opacity: 0, scale: 1, duration: .7 }, .35)
          .fromTo(q('.fx-core'), { opacity: 0 }, { opacity: .7, duration: .15, yoyo: true, repeat: 1 }, 1.0);
        break;
      case 's7': { // three tiles fold into one stack
        const top = q('.l-top'), mid = q('.l-mid'), bot = q('.l-bot');
        tl.to(top, { yPercent: -16, duration: .22, ease: 'power2.out' }, 0).to(mid, { yPercent: -8, duration: .22, ease: 'power2.out' }, 0)
          .to(bot, { yPercent: 0, duration: .22 }, 0)
          .to(top, { yPercent: 0, duration: .38, ease: 'bounce.out' }, .5).to(mid, { yPercent: 0, duration: .34, ease: 'bounce.out' }, .36);
        break;
      }
      case 's1': // spark
        tl.fromTo(q('.fx-star'), { opacity: 0, scale: .2, rotation: -45, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1.25, rotation: 0, duration: .35, ease: 'back.out(3)' }, 0)
          .to(q('.fx-star'), { opacity: 0, scale: .9, duration: .5 }, .55);
        break;
      case 's2': { // coin hops and leaves a lime trail
        const tr = q('.fx-trail')[0], L = 330;
        tl.to(acc, { y: -14, rotation: -6, duration: .25, ease: 'power2.out' }, 0).to(acc, { y: 0, rotation: 0, duration: .45, ease: 'bounce.out' }, .25)
          .set(tr, { attr: { 'stroke-dasharray': L, 'stroke-dashoffset': L }, opacity: 1 }, 0)
          .to(tr, { attr: { 'stroke-dashoffset': 0 }, duration: .45, ease: 'power2.out' }, 0)
          .to(tr, { opacity: 0, duration: .5 }, .55)
          .fromTo(q('.fx-star'), { opacity: 0, scale: .3, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1.3, duration: .25, ease: 'back.out(3)' }, .35)
          .to(q('.fx-star'), { opacity: 0, duration: .4 }, .7);
        break;
      }
      case 's3': // the route lights node by node: helper → three specialists → one payment
        [0, 1, 2].forEach((r) => tl.fromTo(q(`.fx-n${r}`), { opacity: 0 }, { opacity: 1, duration: .16, yoyo: true, repeat: 1 }, .05 + r * .22));
        break;
      case 's4':
        tl.fromTo(q('.fx-core'), { opacity: 0 }, { opacity: .95, duration: .18, yoyo: true, repeat: 3 }, 0);
        break;
      case 's8': { // spark runs along the orbit
        const o = q('.fx-orb')[0]; const obj = { a: 0 };
        tl.set(o, { opacity: 1 }, 0).to(obj, {
          a: Math.PI * 2, duration: 1.1, ease: 'power1.inOut', onUpdate: () => {
            o.setAttribute('cx', (262 + 262 * Math.cos(obj.a + .55)).toFixed(1)); o.setAttribute('cy', (166 + 44 * Math.sin(obj.a + .55)).toFixed(1));
            o.setAttribute('opacity', Math.sin(obj.a + .55) < -.2 ? '.25' : '1');
          },
        }, 0).set(o, { opacity: 0 }, 1.12);
        break;
      }
    }
    return tl;
  }

  // switch to symbol i: returns a timeline (seekable) — the caller adds it to the master or plays it
  function select(i) {
    const prev = els[state.idx], next = els[i];
    const tl = gsap.timeline();
    if (prev !== next) {
      tl.to(prev.s, { opacity: 0, scale: .82, y: 8, duration: .22, ease: 'power2.in' }, 0)
        .to(prev.m, { opacity: 0, duration: .2 }, 0)
        .fromTo(next.s, { opacity: 0, scale: .78, y: 14 }, { opacity: 1, scale: 1, y: 0, duration: .45, ease: 'back.out(2.2)', immediateRender: false }, .12)
        .fromTo(next.m, { opacity: 0, scale: .7 }, { opacity: 1, scale: 1, duration: .35, ease: 'back.out(2)', immediateRender: false }, .12)
        .to(state, { s8: next.sym.key === 's8' ? 1 : 0, duration: .01 }, .12);
    }
    tl.call(() => { els.forEach((e, k) => e.b.setAttribute('aria-checked', k === i ? 'true' : 'false')); }, null, .12);
    tl.set(state, { cur: i }, .12);
    tl.add(accept(i), .45);
    state.idx = i;
    return tl;
  }

  function idle(t, live) { // gentle float + turn so the mark is never still
    els.forEach((e, k) => {
      if (!live) { e.sf.style.transform = ''; return; }
      const y = Math.sin(t * 1.3 + k) * 4, ry = Math.sin(t * .6 + k) * 9;
      e.sf.style.transform = `translateY(${y.toFixed(2)}px) rotateY(${ry.toFixed(2)}deg)`;
    });
  }

  function home() { // stage coords of the current mark's home point
    const e = els[state.cur], s = e.s, k = s.offsetWidth / e.sym.w;
    return { x: s.offsetLeft + e.sym.home[0] * k, y: s.offsetTop + e.sym.home[1] * k, inMark: !!e.sym.inMark, k };
  }
  return { els, state, select, accept, idle, home, onPick: (fn) => els.forEach((e, k) => e.b.addEventListener('click', () => fn(k))) };
}
