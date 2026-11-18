// Just Cents — first screen design reference v2 (image-first-ui).
// three.js (bundled locally, r170) + GSAP 3.12.5 (local). No network.
// URL flags: ?static (final still frame, = image), ?demo (auto-press "Pay 8¢ once" at 8.2 s),
//            ?capture (paused; window.__seek(t) drives everything — used for the mp4).
import * as THREE from 'three';
import { SYMS, buildSymbols, symfx } from './symbols.js';
import * as ctl from '../app/controller';

const gsap = window.gsap;
const Q = new URLSearchParams(location.search);
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const STATIC = Q.has('static') || REDUCED;
const DEMO = Q.has('demo');
const CAPTURE = Q.has('capture');
const TOUR = Q.has('tour');
const BREAK = Q.has('break'); // capture: the judge breaks Lena instead of Sam (video 3)
const LIVE = !STATIC && !DEMO && !CAPTURE; // the real product: the scene waits for real previews, checks and payment
const OFF = .9;               // intro before the main story: only headline, field and Start
const SYM0 = Math.max(0, SYMS.findIndex((x) => x.key === Q.get('sym')));
if (TOUR) document.documentElement.classList.add('tour');

// ---------------------------------------------------------------- helpers
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
function bez(a, c, b, t) { const u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; }

// ---------------------------------------------------------------- tile art before the order: the specialists' own previews
// .icon-art holds the cover (choice), .wave the logo (single); the controller swaps in the checked previews later
const COVER_PREVIEW = '/previews/cover-a.jpg';
const LOGO_PREVIEW = '/previews/logo-128.png';

// ---------------------------------------------------------------- stage
const STAGES = { d: document.querySelector('.stage-d'), m: document.querySelector('.stage-m') };
const page = document.querySelector('.page');
document.querySelectorAll('.icon-art').forEach((e) => (e.innerHTML = `<img class="cover-prev" src="${COVER_PREVIEW}" alt="">`));
document.querySelectorAll('.wave').forEach((e) => (e.innerHTML = `<img class="logo-prev" src="${LOGO_PREVIEW}" alt="">`));
{ // phone: the scene block lives in one wrapper (it fills the lower third before the receipt prints)
  const sm = document.querySelector('.stage-m'); const sc = document.createElement('div'); sc.className = 'scene';
  sm.querySelectorAll(':scope > .gl-back, :scope > .podium-glow, :scope > .sym-pod, :scope > .tw, :scope > .tag, :scope > .rw, :scope > .char, :scope > .char-help, :scope > .gl-front').forEach((e) => sc.appendChild(e));
  sm.insertBefore(sc, sm.querySelector('.foot'));
}
document.querySelectorAll('.tile.accepted').forEach((t) => { const r = document.createElement('div'); r.className = 'rim'; t.appendChild(r); });

const CFG = {
  d: { podium: { cx: 720, cy: 816, w: 1337, eh: 66, fh: 47 }, base: { cx: 196, cy: 796, w: 150, fh: 20 }, dust: 140, k: 1 },
  m: { podium: { cx: 195, cy: 392, w: 362, eh: 62, fh: 22 }, base: { cx: 195, cy: 292, w: 62, fh: 8 }, dust: 40, k: .42 },
};

let cur = null; // active stage key
let world = null;

function activeKey() { return window.matchMedia('(max-width: 899px)').matches ? 'm' : 'd'; }

function layout() {
  const key = activeKey();
  const st = STAGES[key];
  const W = +st.dataset.w, H0 = +st.dataset.h;
  const vw = document.documentElement.clientWidth;
  const s = vw / W;
  // phone: the chosen picture is 2:3, a real phone is ~9:19 — spread the extra height through the layout instead of an empty band
  // keep the first extra height while the layout stays the same: iPhone hides its toolbar on scroll, a height-only resize must not rebuild the scene
  // at least 120: with less, the line under the receipt sits on the receipt (a short first height, e.g. the Telegram in-app browser)
  const ex = world && key === cur ? world.ex : key === 'm' && !CAPTURE ? Math.max(120, Math.min(340, Math.round((window.innerHeight / s - H0) / 4) * 4)) : 0;
  const H = H0 + ex;
  st.style.transform = `scale(${s})`; st.style.height = `${H}px`; st.style.setProperty('--ex', `${ex}px`);
  page.style.height = `${H * s}px`;
  if (key !== cur || (world && world.ex !== ex)) { if (world) world.dispose(); cur = key; world = buildWorld(st, key, W, H, ex); window.__w = world; startTimeline(world); }
  world.resize(s);
}

// ---------------------------------------------------------------- particles (deterministic, seekable)
function makePool(n) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { uPR: { value: 1 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float uPR;
      void main(){ vA=alpha; vC=color; gl_PointSize=size*uPR; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){ float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0) discard; float a=vA*pow(1.0-d,1.5);
        vec3 c=mix(vC, vec3(1.0), smoothstep(0.45,0.0,d)*0.55); gl_FragColor=vec4(c,a); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false;
  let i = 0;
  return {
    pts, mat: m,
    begin() { i = 0; },
    push(x, y, z, c, s, a) {
      if (i >= n || a <= 0.003) return; const j = i * 3;
      pos[j] = x; pos[j + 1] = -y; pos[j + 2] = z; col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b; size[i] = s; alpha[i] = a; i++;
    },
    end() { for (let j = i; j < n; j++) alpha[j] = 0; g.setDrawRange(0, Math.max(i, 1));
      for (const k of ['position', 'color', 'size', 'alpha']) g.attributes[k].needsUpdate = true; },
  };
}

function softTex(stops) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 8; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1024, 0); stops.forEach(([o, s]) => g.addColorStop(o, s)); x.fillStyle = g; x.fillRect(0, 0, 1024, 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}

function coinFaceTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  const g = x.createRadialGradient(100, 90, 10, 128, 128, 128); g.addColorStop(0, '#ffffff'); g.addColorStop(.75, '#f3eef8'); g.addColorStop(1, '#e5dcef');
  x.fillStyle = g; x.beginPath(); x.arc(128, 128, 128, 0, 7); x.fill();
  x.lineWidth = 14; x.strokeStyle = '#d9f45f'; x.beginPath(); x.arc(128, 128, 118, 0, 7); x.stroke();
  x.lineWidth = 3; x.strokeStyle = 'rgba(168,102,164,.55)'; x.beginPath(); x.arc(128, 128, 100, 0, 7); x.stroke();
  x.fillStyle = '#9a4f95'; x.font = '800 168px Figtree, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('¢', 128, 138);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.center.set(.5, .5); t.rotation = window.__coinRot ?? Math.PI / 2; return t;
}

// ---------------------------------------------------------------- world
function buildWorld(st, key, W, H, ex = 0) {
  const c0 = CFG[key], sh = ex * .42;
  const cfg = { ...c0, podium: { ...c0.podium, cy: c0.podium.cy + sh }, base: { ...c0.base, cy: c0.base.cy + sh } };
  const backCv = st.querySelector('.gl-back'), frontCv = st.querySelector('.gl-front');
  // no WebGL (old device, blocked GPU) → the page still works: DOM scene + CSS podium, no particles
  const NOGL = { render() {}, setPixelRatio() {}, setSize() {}, dispose() {}, setClearColor() {}, autoClear: true };
  let rB, rF;
  try {
    rB = new THREE.WebGLRenderer({ canvas: backCv, antialias: true, alpha: true, preserveDrawingBuffer: CAPTURE });
    rF = new THREE.WebGLRenderer({ canvas: frontCv, antialias: true, alpha: true, preserveDrawingBuffer: CAPTURE });
  } catch (e) { rB = { ...NOGL }; rF = { ...NOGL }; document.documentElement.classList.add('no-gl'); }
  for (const r of [rB, rF]) { r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NoToneMapping; r.setClearColor(0x000000, 0); }

  // ---- back: tilted orthographic camera so a horizontal disc reads as the podium ellipse
  const P = cfg.podium;
  const theta = Math.asin(P.eh / P.w);
  const camB = new THREE.OrthographicCamera(0, W, 0, -H, -6000, 6000);
  camB.rotation.x = -theta; camB.updateMatrixWorld();
  const toWorld = (sx, sy, d) => new THREE.Vector3(sx, -sy, -d).applyMatrix4(camB.matrixWorld);
  const sceneB = new THREE.Scene();
  sceneB.add(new THREE.HemisphereLight(0xfffaf7, 0xa39088, 2.7));
  const key1 = new THREE.DirectionalLight(0xfff3ec, 1.1); key1.position.copy(toWorld(W * .45, -400, -1500)); sceneB.add(key1);
  const fill = new THREE.DirectionalLight(0xf0e6ff, .35); fill.position.copy(toWorld(W, H * .2, -800)); sceneB.add(fill);
  const rimL = new THREE.DirectionalLight(0xe2ff5a, .9); rimL.position.copy(toWorld(-W * .3, H * .3, 3500)); sceneB.add(rimL);


  const R = P.w / 2, h = P.fh / Math.cos(theta);
  const podium = new THREE.Group();
  const top = toWorld(P.cx, P.cy, 3000);
  podium.position.copy(top).add(new THREE.Vector3(0, -h / 2, 0));
  sceneB.add(podium);
  const podMat = new THREE.MeshStandardMaterial({ color: 0xf4efec, roughness: .7, metalness: 0 });
  { // lathe profile: flat top, rounded front edge, straight face
    const bv = Math.min(14, h * .35), pts = [new THREE.Vector2(0, h / 2)];
    for (let a = 0; a <= 12; a++) { const f = a / 12 * Math.PI / 2; pts.push(new THREE.Vector2(R - bv + Math.sin(f) * bv, h / 2 - bv + Math.cos(f) * bv)); }
    pts.push(new THREE.Vector2(R, -h / 2 + 3)); pts.push(new THREE.Vector2(R - 3, -h / 2)); pts.push(new THREE.Vector2(0, -h / 2));
    podium.add(new THREE.Mesh(new THREE.LatheGeometry(pts.reverse(), 200), podMat));
  }
  // slow sweep of light around the podium side: makes the slow rotation readable
  const sweepTex = softTex([[0, 'rgba(255,255,255,0)'], [.42, 'rgba(255,255,255,0)'], [.5, 'rgba(255,255,255,.75)'], [.58, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)']]);
  const sweep = new THREE.Mesh(new THREE.CylinderGeometry(R - 2.5, R - 2.5, h * .8, 160, 1, true),
    new THREE.MeshBasicMaterial({ map: sweepTex, transparent: true, depthWrite: false, opacity: .55 }));
  podium.add(sweep);
  const lime = new THREE.Color('#d6f45a');
  const rimTex = softTex([[0, 'rgba(214,244,90,.15)'], [.25, 'rgba(214,244,90,.9)'], [.5, 'rgba(214,244,90,.25)'], [.75, 'rgba(214,244,90,.9)'], [1, 'rgba(214,244,90,.15)']]);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 3, 1.2 * cfg.k + .6, 8, 200), new THREE.MeshBasicMaterial({ map: rimTex, transparent: true, opacity: 0 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = h / 2 - 2; podium.add(rim);

  // symbol base (place for the mark)
  const B = cfg.base, bR = B.w / 2, bh = B.fh / Math.cos(theta);
  const base = new THREE.Group(); base.position.copy(toWorld(B.cx, B.cy, 1200)).add(new THREE.Vector3(0, -bh / 2, 0)); sceneB.add(base);
  const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .25, metalness: 0, transparent: true, opacity: .9 });
  base.add(new THREE.Mesh(new THREE.CylinderGeometry(bR, bR * 1.04, bh, 96), glass));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(bR * .98, Math.max(1, 1.8 * cfg.k), 10, 120), new THREE.MeshBasicMaterial({ color: lime }));
  ring.rotation.x = Math.PI / 2; ring.position.y = -bh / 2 + 1.2; base.add(ring);

  // dust: soft particles with depth (front-on camera, behind the DOM)
  const camF0 = new THREE.OrthographicCamera(0, W, 0, -H, -2000, 2000);
  const sceneDust = new THREE.Scene();
  const dust = makePool(cfg.dust); sceneDust.add(dust.pts);
  const rnd = mulberry32(7);
  const dustSeed = Array.from({ length: cfg.dust }, () => ({ x: rnd() * W, y: H * (.42 + rnd() * .5), z: rnd(), p: rnd() * 6.28, c: rnd() }));
  const cLime = new THREE.Color('#c9e83a'), cOrch = new THREE.Color('#b77ab3'), cWhite = new THREE.Color('#ffffff'), cKiwi = new THREE.Color('#a9bf1c'), cGreen = new THREE.Color('#43c23c');

  // ---- front: effects above the DOM
  const camF = new THREE.OrthographicCamera(0, W, 0, -H, -2000, 2000);
  const sceneF = new THREE.Scene();
  sceneF.add(new THREE.HemisphereLight(0xffffff, 0xd8cdd9, 2.2));
  const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(.3, .7, 1); sceneF.add(dl);
  const fx = makePool(1600); sceneF.add(fx.pts);
  const faceTex = coinFaceTex();
  const coinR = 24 * cfg.k + 3, coinH = 5 * cfg.k + 1.5;
  const coins = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(coinR, coinR, coinH, 48), [
      new THREE.MeshStandardMaterial({ color: 0xcfe84f, roughness: .35, metalness: .1 }),
      new THREE.MeshStandardMaterial({ map: faceTex, roughness: .35 }),
      new THREE.MeshStandardMaterial({ map: faceTex, roughness: .35 }),
    ]);
    const g = new THREE.Group(); m.rotation.x = Math.PI / 2; g.add(m); g.visible = false; sceneF.add(g); return g;
  });

  // DOM anchors in stage units
  const center = (sel) => { const e = st.querySelector(sel); let x = 0, y = 0, n = e; while (n && n !== st) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return [x + e.offsetWidth / 2, y + e.offsetHeight / 2, e.offsetWidth, e.offsetHeight]; };
  const A = {
    slot: center('.sym-pod'), pay: center('.btn-pay'), icon: center('.tw-icon'), voice: center('.tw-voice'),
    desc: center('.tw-desc'), sam: center('.tag-sam'), lena: center('.tag-lena'),
  };

  const syms = buildSymbols(st, key, gsap, sh);
  let amb = st.querySelector('.amb'); if (!amb) { amb = document.createElement('div'); amb.className = 'amb'; st.prepend(amb); }
  { const s0 = st.querySelector('.s-s5'); A.slot = [s0.offsetLeft + s0.offsetWidth / 2, s0.offsetTop + s0.offsetHeight * .45, s0.offsetWidth, s0.offsetHeight]; }
  if (SYM0) { syms.select(SYM0).progress(1); }
  // ---- Tick character: cut-outs of the character sheet poses (2D pictures, no 3D model)
  const HC = key === 'm' ? 50 : 136, FLOOR = (key === 'm' ? 420 : 852) + sh, HOME_SC = key === 'm' ? .55 : .72;
  const POSES = { run: [228, 215, .42], check: [245, 227, .2], sign: [339, 254, .21, 1.06], idle: [276, 360, .22], idle2: [100, 112, .45], idle3: [97, 107, .42], idle4: [108, 111, .5] };
  const fig = st.querySelector('.char-fig'); fig.innerHTML = '';
  const poseEls = {};
  for (const [name, [pw, ph, ax, f = 1]] of Object.entries(POSES)) {
    const im = document.createElement('img'); im.src = `assets/char/tick-${name}.png`; im.alt = '';
    const hh = HC * f, ww = hh * pw / ph; im.style.height = `${hh}px`; im.style.width = `${ww}px`; im.style.left = `${-ax * ww}px`;
    im.style.transformOrigin = `${ax * 100}% 100%`; fig.appendChild(im); poseEls[name] = im;
  }
  const s5El = st.querySelector('.s-s5'), s5Main = s5El.querySelector('img.main'), s5No = s5El.querySelector('img.nochk');
  const scn = st.querySelector('.scene');
  const ch = { el: st.querySelector('.char'), say: st.querySelector('.char-say'), help: st.querySelector('.char-help'), shadow: st.querySelector('.char-shadow'),
    x: key === 'm' ? 70 : 330, homeW: 1, hidden: 1, signOn: 0, checkOn: 0, jump: 0, follow: false, px: null, cur: '', vx: 0, face: 1, pose: '', idleT: 0 };
  const RULES = {
    icon: 'Big enough, the frame\'s proportions, sharper than a plain stretch',
    desc: 'Every line starts on its spoken word',
    voice: 'Clean outlines that look like the sketch',
    help: 'Only the accepted pieces get paid. A rejected piece costs 0¢.',
  };
  const state = { careless: 'sam' };   // the visitor can pick who is careless ("Break it yourself")
  const hot = [['icon', A.icon], ['desc', A.desc], ['voice', A.voice], ['sam', A.sam], ['lena', A.lena]];
  const badKind = (k) => (k === 'sam' || k === 'lena') && k === state.careless;
  let backTimer = null;
  function goOut(x) { // jump out of the mark
    if (ch.homeW < .5 && !gsap.isTweening(ch)) return;
    const h = syms.home(); ch.x = h.x; gsap.killTweensOf(ch, 'homeW');   // step out of the ¢, stand a moment, then a slow jump
    ch.hidden = 0; gsap.to(symfx, { s5out: 1, duration: .3 });
    gsap.to(ch, { homeW: 0, duration: 1.3, delay: .7, ease: 'sine.inOut' });
  }
  function goHome() { // walk to the mark, slow jump in, then settle into the ¢ and hold still for a moment
    gsap.killTweensOf(ch, 'homeW'); gsap.to(ch, { x: syms.home().x, duration: .6, ease: 'sine.inOut' });
    gsap.to(ch, { homeW: 1, duration: 1.3, delay: .55, ease: 'sine.inOut', onComplete: () => { ch.hidden = 1; gsap.to(symfx, { s5out: 0, duration: .35 }); syms.accept(syms.state.idx); } });
  }
  function sayLive(kind) {
    if (ch.cur === kind) return; ch.cur = kind;
    gsap.to(ch, { signOn: badKind(kind) ? 1 : 0, checkOn: kind && !badKind(kind) ? 1 : 0, duration: .01 });
    if (!kind) { gsap.to(ch.say, { opacity: 0, duration: .25 }); return; }
    ch.say.classList.toggle('side', kind === 'lena' || kind === 'sam'); ch.say.textContent = RULES[kind === 'lena' || kind === 'sam' ? 'desc' : kind];
    gsap.fromTo(ch.say, { opacity: 0 }, { opacity: 1, duration: .3 });

  }
  function hoverAt(sx, sy) {
    for (const [k, a] of hot) if (Math.abs(sx - a[0]) < a[2] / 2 && Math.abs(sy - a[1]) < a[3] / 2) return [k, a[0]];
    return [null, sx];
  }
  ch.help.addEventListener('click', () => {
    ch.cur = 'help'; ch.say.classList.remove('side'); ch.say.textContent = RULES.help;
    gsap.fromTo(ch.say, { opacity: 0 }, { opacity: 1, duration: .3 });
    gsap.fromTo(ch, { jump: 0 }, { jump: 1, duration: .5, ease: 'sine.inOut', yoyo: true, repeat: 1 });
    gsap.delayedCall(3.5, () => { if (ch.cur === 'help') { ch.cur = ''; gsap.to(ch.say, { opacity: 0, duration: .3 }); } });
  });
  syms.onPick((k) => { const tl = syms.select(k); if (STATIC) tl.progress(1); });

  // events: { type, t0, ... } — evaluated purely from the clock
  const events = [];
  const tilesEls = [...st.querySelectorAll('.tile')], receiptEl = st.querySelector('.receipt');
  let pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e) => {
    const r = st.getBoundingClientRect(); pointer.tx = (e.clientX - r.left) / r.width - .5; pointer.ty = (e.clientY - r.top) / r.height - .5;
    if (!ch.follow) return;
    const sx = (pointer.tx + .5) * W, sy = (pointer.ty + .5) * H; const [k, x] = hoverAt(sx, sy);
    if (ch.homeW > .5) goOut(); ch.px = x; if ((ch.cur !== 'help' && ch.cur !== 'spec') || k) sayLive(k);
    clearTimeout(backTimer); backTimer = setTimeout(() => { if (ch.follow) { sayLive(null); goHome(); } }, 4000);
  };
  const onLeave = () => { pointer.tx = 0; pointer.ty = 0; if (ch.follow && ch.cur !== 'help' && ch.cur !== 'spec') sayLive(null); };
  if (!STATIC && !CAPTURE) st.addEventListener('pointerdown', (e) => { // touch: tap a tile → the character walks there
    if (!ch.follow) return; const r = st.getBoundingClientRect(); const [k, x] = hoverAt((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H);
    if (k) { if (ch.homeW > .5) goOut(); ch.px = x; sayLive(k); clearTimeout(backTimer); backTimer = setTimeout(() => { sayLive(null); goHome(); }, 4000); } });
  if (!STATIC && !CAPTURE) { st.addEventListener('pointermove', onMove); st.addEventListener('pointerleave', onLeave); }

  let pr = 1;
  function resize(s) {
    pr = Math.min(2.5, (window.devicePixelRatio || 1) * s);
    if (key === 'm') pr = Math.min(pr, 2.6);
    for (const r of [rB, rF]) { r.setPixelRatio(pr); r.setSize(W, H, false); }
    dust.mat.uniforms.uPR.value = pr; fx.mat.uniforms.uPR.value = pr;
    render(lastT);
  }

  function burst(e, t) {
    const dt = t - e.t0; if (dt < 0 || dt > e.dur) return;
    const rr = mulberry32(e.seed); const [cx, cy, w, hh] = e.at;
    for (let i = 0; i < e.n; i++) {
      // spawn on the rim of the rectangle, fly outwards
      const side = rr(), u = rr();
      let x, y, nx, ny;
      if (side < .25) { x = cx - w / 2 + u * w; y = cy - hh / 2; nx = 0; ny = -1; }
      else if (side < .5) { x = cx + w / 2; y = cy - hh / 2 + u * hh; nx = 1; ny = 0; }
      else if (side < .75) { x = cx - w / 2; y = cy - hh / 2 + u * hh; nx = -1; ny = 0; }
      else { x = cx - w / 2 + u * w; y = cy + hh / 2; nx = 0; ny = 1; }
      const sp = (40 + rr() * 120) * cfg.k * e.power, ang = (rr() - .5) * 1.4;
      const vx = (nx * Math.cos(ang) - ny * Math.sin(ang)) * sp, vy = (nx * Math.sin(ang) + ny * Math.cos(ang)) * sp - 40 * cfg.k;
      const life = .45 + rr() * .5; const lt = dt / life; if (lt > 1) continue;
      const px = x + vx * dt, py = y + vy * dt + 90 * cfg.k * dt * dt;
      const c = rr() < .6 ? cLime : (rr() < .5 ? cKiwi : cOrch);
      fx.push(px, py, 10, c, (7 + rr() * 8) * Math.max(.55, cfg.k * 1.2) * (1 - lt * .5), (1 - lt) * .95);
    }
  }
  function flight(e, t) { // glowing light from the symbol to an accepted piece
    const dt = t - e.t0; if (dt < 0 || dt > e.dur + .35) return;
    const p = clamp01(dt / e.dur), q = easeInOut(p);
    const a = e.from, b = e.to, c = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - e.arc];
    const fade = dt > e.dur ? 1 - (dt - e.dur) / .35 : 1;
    for (let k = 0; k < 16; k++) {
      const qq = clamp01(q - k * .018); const [x, y] = bez(a, c, b, qq);
      fx.push(x, y, 12, k < 2 ? cWhite : cLime, (k === 0 ? 30 : 20 - k * .8) * Math.max(.5, cfg.k * 1.1), (k === 0 ? .95 : .7 - k * .04) * fade);
    }
    const [hx, hy] = bez(a, c, b, q);
    fx.push(hx, hy, 13, cLime, 70 * Math.max(.5, cfg.k * 1.1), .4 * fade);
  }
  function coinFly(e, t) {
    const g = coins[e.idx]; const dt = t - e.t0;
    if (dt < 0 || dt > e.dur + .5) { g.visible = false; return; }
    const p = clamp01(dt / e.dur), q = easeInOut(p);
    const a = e.from, b = e.to, c = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - e.arc];
    const [x, y] = bez(a, c, b, q);
    const land = dt > e.dur ? clamp01((dt - e.dur) / .5) : 0;
    g.visible = land < 1;
    g.position.set(x, -y, 40);
    const sc = (.6 + .4 * Math.sin(p * Math.PI) + .15) * (1 - land);
    g.scale.setScalar(Math.max(.001, sc));
    g.rotation.y = window.__coinStill ? 0 : Math.sin(dt * 4.5) * 1.1; g.rotation.x = .2;
    // green trail
    for (let k = 1; k <= 22; k++) {
      const qq = easeInOut(clamp01(p - k * .022)); if (p - k * .022 < 0) break;
      const [tx, ty] = bez(a, c, b, qq);
      fx.push(tx, ty, 5, k < 6 ? cLime : cGreen, (20 - k * .7) * Math.max(.5, cfg.k * 1.1), (.85 - k * .035) * (1 - land));
    }
  }

  let lastT = 0;
  function render(t) {
    lastT = t;
    const live = !STATIC;
    // podium slow turn (light sweep) and rim intensity
    sweep.rotation.y = live ? t * .22 : 1.1; sweep.visible = live;
    rim.rotation.z = live ? t * .3 : 0; rim.material.opacity = live ? world.rimLevel * .9 : 0;
    // tiles: glass slabs sway slowly + follow the cursor
    pointer.x += (pointer.tx - pointer.x) * .08; pointer.y += (pointer.ty - pointer.y) * .08;
    if (live) tilesEls.forEach((el, i) => {
      const ry = Math.sin(t * .55 + i * 1.7) * 3.2 + pointer.x * 12, rx = Math.cos(t * .45 + i) * 1.6 - pointer.y * 9;
      el.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    });
    if (live && receiptEl) receiptEl.style.transform = `rotateX(${(-pointer.y * 5).toFixed(2)}deg) rotateY(${(pointer.x * 6 + Math.sin(t * .4) * 1.2).toFixed(2)}deg)`;
    syms.idle(t, live);
    if (live) { amb.style.transform = `translate(${(Math.sin(t * .31) * 22).toFixed(2)}%, ${(Math.cos(t * .23) * 10).toFixed(2)}%)`; amb.style.opacity = (.55 + Math.sin(t * .7) * .25).toFixed(3); }
    base.visible = syms.state.s8 > .5;
    // Tick: scripted by the timeline, then follows the cursor; homeW = 1 → standing in/on the mark
    if (ch.follow && ch.px != null && ch.homeW < .02) ch.x += (Math.max(40, Math.min(W - 40, ch.px)) - ch.x) * .06;
    const hm = syms.home(), hw = ch.homeW;
    const fx_ = hm.x + (ch.x - hm.x) * (1 - hw), fy = hm.y + (FLOOR - hm.y) * (1 - hw);
    const lift = Math.sin(Math.PI * Math.min(1, Math.max(0, hw))) * (key === 'm' ? 40 : 110);
    const dx = fx_ - (ch.lx ?? fx_); ch.lx = fx_; ch.vx = ch.vx * .7 + dx * .3;
    if (Math.abs(ch.vx) > .3 * cfg.k) ch.face = ch.vx > 0 ? 1 : -1;
    const moving = Math.abs(ch.vx) > .25 * cfg.k || (hw > .02 && hw < .98);
    let pose = ch.signOn > .5 ? 'sign' : ch.checkOn > .5 ? 'check' : moving ? 'run' : ['idle', 'idle3', 'idle', 'idle4'][Math.floor(t / 1.3) % 4];
    ch.pose = pose;
    const bob = live ? (moving ? -Math.abs(Math.sin(t * 11)) * 5 * cfg.k : -Math.abs(Math.sin(t * 2.4)) * 2.5 * cfg.k) : 0;
    const inMark = hm.inMark && ch.hidden > .5;  // s5: settled — the Tick IS the check of the mark
    ch.el.style.opacity = inMark ? 0 : 1;
    const sc = 1 - Math.min(1, Math.max(0, hw)) * (1 - HOME_SC);
    ch.el.style.transform = `translate(${fx_.toFixed(1)}px, ${(fy - lift + bob - ch.jump * 18 * cfg.k).toFixed(1)}px) scale(${sc.toFixed(3)})`;
    if (pose !== ch.shown) { if (poseEls[ch.shown]) poseEls[ch.shown].classList.remove('on'); poseEls[pose].classList.add('on'); ch.shown = pose; }
    poseEls[pose].style.transform = `scaleX(${pose === 'sign' ? 1 : ch.face}) rotate(${(live ? Math.sin(t * 3) * (moving ? 4 : 1.5) : 0).toFixed(1)}deg)`;
    // s5 has no check while the Tick is outside
    s5Main.style.opacity = (1 - symfx.s5out).toFixed(3); s5No.style.opacity = symfx.s5out.toFixed(3);
    ch.shadow.style.opacity = hw > .5 ? 0 : 1 - hw * 2;
    { // keep the speech bubble inside the stage
      if (ch.say.classList.contains('side')) ch.say.style.transform = '';
      else { const bw = ch.say.offsetWidth, left = fx_ - bw / 2, ssc = scn ? +gsap.getProperty(scn, 'scale') || 1 : 1, ox = W / 2;
        const lo = (6 - ox) / ssc + ox, hi = (W - 6 - ox) / ssc + ox, sh = Math.max(lo - left, Math.min(0, hi - (left + bw)));
        ch.say.style.transform = `translateX(calc(-50% + ${sh.toFixed(1)}px))`; ch.say.style.setProperty('--ax', `${(-sh).toFixed(1)}px`); }
    }
    // back
    rB.autoClear = true; rB.render(sceneB, camB);
    if (live) {
      dust.begin();
      for (const d of dustSeed) {
        const x = d.x + Math.sin(t * .2 + d.p) * 18 * cfg.k, y = d.y - ((t * (6 + d.z * 10) * cfg.k) % (H * .5)) + Math.cos(t * .3 + d.p) * 8;
        dust.push(x, y, -10, d.c < .55 ? cLime : (d.c < .8 ? cOrch : cKiwi), (2 + d.z * 4) * Math.max(.6, cfg.k * 1.2), .18 + d.z * .25);
      }
      dust.end(); rB.autoClear = false; rB.render(sceneDust, camF0);
    }
    // front
    fx.begin(); coins.forEach((c) => (c.visible = false));
    if (live) for (const e of events) { if (e.type === 'burst') burst(e, t); else if (e.type === 'flight') flight(e, t); else if (e.type === 'coin') coinFly(e, t); }
    fx.end(); rF.render(sceneF, camF);
  }

  function payFx(t0) {
    const targets = [A.icon, state.careless === 'sam' ? A.lena : A.sam, A.voice];
    targets.forEach((tg, i) => {
      events.push({ type: 'flight', t0: t0 + .05 + i * .1, dur: .8, from: [A.slot[0], A.slot[1]], to: [tg[0], tg[1]], arc: 120 * cfg.k });
      events.push({ type: 'coin', idx: i, t0: t0 + .15 + i * .12, dur: 1.05, from: [A.pay[0], A.pay[1]], to: [tg[0], tg[1]], arc: (170 + i * 30) * cfg.k });
      events.push({ type: 'burst', t0: t0 + .15 + i * .12 + 1.05, dur: 1, at: tg, n: 26, seed: 900 + i, power: .8 });
    });
  }

  // the careless tag becomes the hero: big, readable, the Tick raises «0¢» next to it
  function hero(tag, at = 0) {
    const tl = gsap.timeline(), big = key === 'm' ? 1.85 : 1.9;
    tl.to(tag, { scale: big, zIndex: 9, boxShadow: '0 0 0 3px rgba(228,70,93,.35),0 24px 50px rgba(90,40,40,.28)', duration: .4, ease: 'back.out(1.8)' }, at)
      .to(tag, { scale: 1, boxShadow: '0 8px 20px rgba(90,60,60,.10)', duration: .45, ease: 'power2.inOut' }, at + 1.25).set(tag, { zIndex: 5 }, at + 1.7);
    return tl;
  }
  function heroX(who) { const a = who === 'sam' ? A.sam : A.lena; return a[0] + a[2] * (key === 'm' ? 1.85 : 1.9) / 2 + (key === 'm' ? 16 : 34); }
  function setCareless(who) { // returns a seekable timeline
    const tl = gsap.timeline(); if (who === state.careless) return tl;
    const bad = st.querySelector(`.tag-${who}`), good = st.querySelector(`.tag-${state.careless}`);
    const flip = () => {
      state.careless = who; bad.classList.add('bad'); bad.classList.remove('good'); good.classList.add('good'); good.classList.remove('bad');
      st.querySelectorAll('.receipt [data-sam]').forEach((e) => { e.innerHTML = e.dataset[who]; });
      st.querySelectorAll('.brk button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.c === who ? 'true' : 'false'));
    };
    const back = () => { state.careless = who === 'sam' ? 'lena' : 'sam'; };
    tl.call(() => { if (state.careless !== who) flip(); else back(); }, null, 0);
    tl.to(bad, { backgroundColor: '#f7b1b5', boxShadow: '0 8px 20px rgba(90,60,60,.10)', duration: .3 }, 0)
      .to(good, { backgroundColor: '#d7f468', boxShadow: '0 0 14px rgba(214,246,74,.55),0 8px 20px rgba(90,60,60,.08)', duration: .3 }, 0)
      .fromTo(st.querySelectorAll('.row.r2, .row.r3'), { backgroundColor: 'rgba(214,246,74,.0)' }, { backgroundColor: 'rgba(214,246,74,.45)', duration: .2, yoyo: true, repeat: 1 }, .05)
      .to(ch, { x: heroX(who), duration: .55, ease: 'sine.inOut' }, 0)
      .add(hero(bad), .55)
      .set(ch, { signOn: 1 }, .6).set(ch, { signOn: 0 }, 1.9);
    return tl;
  }
  st.querySelectorAll('.brk button').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.c === state.careless) return;
    if (LIVE) { // real: both descriptions are checked again before the scene shows the result
      st.querySelectorAll('.brk button').forEach((x) => (x.disabled = true));
      const changed = await ctl.switchCareless(b.dataset.c);
      st.querySelectorAll('.brk button').forEach((x) => (x.disabled = false));
      if (!changed) return;
    }
    if (ch.homeW > .5) goOut(); gsap.delayedCall(ch.homeW > .5 ? 2 : 0, () => { setCareless(b.dataset.c); });
  }));
  st.querySelector('.btn-spec').addEventListener('click', () => {
    if (LIVE) { document.querySelector('#specialist')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (ch.homeW > .5) goOut(); ch.cur = 'spec'; ch.say.classList.remove('side'); ch.say.textContent = 'Anyone can become a Just Cents specialist.';
    gsap.fromTo(ch.say, { opacity: 0 }, { opacity: 1, duration: .3 }); gsap.delayedCall(3.5, () => { if (ch.cur === 'spec') { ch.cur = ''; gsap.to(ch.say, { opacity: 0, duration: .3 }); } });
  });

  function dispose() {
    st.removeEventListener('pointermove', onMove); st.removeEventListener('pointerleave', onLeave);
    rB.dispose(); rF.dispose(); if (master) { master.kill(); master = null; }
  }
  return { st, key, W, H, ex, A, events, render, resize, payFx, dispose, rimLevel: STATIC ? 0 : 0, k: cfg.k, syms, ch, RULES, goHome, hero, heroX, setCareless, state };
}

// ---------------------------------------------------------------- timeline (first ~10 s)
let master = null, clock0 = 0, captureT = 0;
const clock = () => (CAPTURE ? captureT : gsap.ticker.time - clock0);

function startTimeline(w) {
  const st = w.st;
  if (master) master.kill();
  if (STATIC) { w.render(0); return; }
  st.classList.add('is-anim');
  const $ = (s) => st.querySelectorAll(s);
  const M = gsap.timeline({ paused: CAPTURE || LIVE });
  // LIVE: the scene waits at gates for the real step (preview arrived, check done) before it shows it
  const gate = (t, name) => { if (LIVE) M.addPause(OFF + t, () => { ctl.wait(name).then(() => M.resume()); }); };  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  master = M; clock0 = gsap.ticker.time;
  // intro: only the headline, the field and Start; the scene rises after Start
  const later = $('.tw, .tag, .rw, .char, .char-help, .brk, .spec, .foot, .podium-glow');
  M.set(later, { opacity: 0 }, 0).set($('.sym-pod, .gl-back'), { opacity: 0, y: 30 }, 0);
  if (!LIVE) M.to($('.btn-start'), { scale: .93, duration: .12, ease: 'power1.in' }, .3).to($('.btn-start'), { scale: 1, duration: .35, ease: 'back.out(3)' }, .42);
  M
    .to($('.sym-pod, .gl-back'), { opacity: 1, y: 0, duration: .6, ease: 'power2.out' }, .45)
    .set($('.char'), { opacity: 1 }, OFF);
  M.add(tl, OFF);
  // gates: icon preview + check (2.3), the careless description rejected (3.3), the replacement accepted (4.4), voice (5.05)
  gate(2.29, 'icon'); gate(3.29, 'descBad'); gate(4.39, 'descGood'); gate(5.05, 'voice');
  if (LIVE) {
    M.pause(.01); // render the intro state: only the headline, the field and Start
    const go = () => {
      if (M.time() > .2) return; // one order per page view; "Break it yourself" re-checks in place
      const b = $('.btn-start');
      gsap.timeline().to(b, { scale: .93, duration: .12, ease: 'power1.in' }).to(b, { scale: 1, duration: .35, ease: 'back.out(3)' });
      ctl.start(w.state.careless);
      clock0 = gsap.ticker.time - .45; M.play(.45);
    };
    $('.btn-start').forEach((b) => b.addEventListener('click', go));
    $('.order').forEach((f) => f.addEventListener('submit', (e) => { e.preventDefault(); go(); }));
  }
  tl.set($('.char-help, .brk, .spec, .foot'), { opacity: 0 }, 0).to($('.char-help, .brk, .spec, .foot'), { opacity: 1, duration: .5, stagger: .12 }, 7.5);

  // start states
  tl.set($('.tw'), { y: 70 * (w.key === 'm' ? .45 : 1), opacity: 0 }, 0)
    .set($('.prev'), { opacity: 0 }, 0)
    .set($('.icon-art'), { clipPath: 'inset(50% 50% 50% 50% round 20%)', scale: .9 }, 0)
    .set($('.desc-bar'), { scaleX: 0 }, 0)
    .set($('.logo-prev'), { scale: .4, opacity: 0, transformOrigin: '50% 50%' }, 0)
    .set($('.rim, .ok'), { opacity: 0 }, 0)
    .set($('.ok'), { scale: .4 }, 0)
    .set($('.tag-sam'), { opacity: 0, y: -8, backgroundColor: 'rgba(247,245,243,.85)' }, 0)
    .set($('.tag-sam span'), { opacity: 0 }, 0)
    .set($('.tag-lena'), { opacity: 0, x: -12, backgroundColor: 'rgba(247,245,243,.85)', boxShadow: '0 8px 20px rgba(90,60,60,.08)' }, 0)
    .set($('.tag-lena .ck'), { opacity: 0, scale: .4 }, 0)
    .set($('.row'), { opacity: 0, y: 6, clipPath: 'inset(0 100% 0 0)' }, 0)
    .set($('.row i'), { opacity: 0, scale: .3 }, 0)
    .set($('.btn-pay'), { opacity: 0, scale: .94 }, 0)
    .set($('.podium-glow'), { opacity: 0 }, 0)
    .set($('.rw'), { opacity: 0, scale: .9, y: 16 }, 0);


  // 0.8–2.4 tiles rise onto the podium one by one
  ['.tw-icon', '.tw-desc', '.tw-voice'].forEach((s, i) => tl.to($(s), { y: 0, opacity: 1, duration: .75, ease: 'back.out(1.6)' }, .25 + i * .3));
  tl.to($('.rw'), { opacity: 1, scale: 1, y: 0, duration: .45, ease: 'back.out(1.8)' }, 5.6);
  { // the receipt grows row by row — no empty white card
    const rc = st.querySelector('.receipt'), rr = w.key === 'm' ? 13 : 22, H = rc.offsetHeight;
    const rows = [...st.querySelectorAll('.row')], bot = (r) => r.offsetTop + r.offsetHeight + 8;
    tl.set(rc, { clipPath: `inset(0px 0px ${H - bot(rows[0])}px 0px round ${rr}px)` }, 0);
    rows.forEach((r, i) => tl.to(rc, { clipPath: `inset(0px 0px ${H - bot(r)}px 0px round ${rr}px)`, duration: .3, ease: 'power2.out' }, 5.9 + i * .3));
    tl.to(rc, { clipPath: `inset(0px 0px 0px 0px round ${rr}px)`, duration: .35, ease: 'power2.out' }, 7.35).set(rc, { clipPath: 'none' }, 7.75);
    tl.set(st.querySelector('.rw'), { y: 0 }, 0);
  }
  if (w.key === 'm') { // phone: until the receipt arrives the scene sits lower and bigger, filling the lower third
    const scn = st.querySelector('.scene');
    tl.set(scn, { y: 64, scale: 1.18, transformOrigin: `195px ${300 + w.ex * .42}px` }, 0).to(scn, { y: 0, scale: 1, duration: .8, ease: 'power2.inOut' }, 5.0);
  }
  // character placeholder walks the podium and checks each piece against its rule
  const C = w.ch, R = w.RULES, xs = { start: C.x, icon: w.A.icon[0], sam: w.A.sam[0], voice: w.A.voice[0], rec: w.key === 'm' ? 330 : 1060 };
  const say = (txt, t0, t1, side) => {
    tl.call(() => { C.say.textContent = txt; C.say.classList.toggle('side', !!side); }, null, t0 - .01)
      .fromTo(C.say, { opacity: 0 }, { opacity: 1, duration: .25, immediateRender: false }, t0).to(C.say, { opacity: 0, duration: .2 }, t1);
    if (!side) tl.set(C, { checkOn: 1 }, t0).set(C, { checkOn: 0 }, t1);
  };
  // 0.3 the Tick jumps out of the mark onto the podium
  // 0.25 the Tick steps out of the ¢ (the mark loses its check), stands a moment, then a slow jump onto the podium
  tl.set(C, { homeW: 1, hidden: 1 }, 0).set(symfx, { s5out: 0 }, 0)
    .set(C, { hidden: 0 }, .25).to(symfx, { s5out: 1, duration: .3 }, .25)
    .to(C, { homeW: 0, duration: 1.3, ease: 'sine.inOut' }, 1.0);
  tl.to(C, { x: xs.icon, duration: .35, ease: 'sine.inOut' }, 2.3);
  say(R.icon, 2.6, 3.25);
  tl.to(C, { x: w.heroX('sam'), duration: .5, ease: 'sine.inOut' }, 3.25);   // stands beside the hero, never in front of its text
  say(R.desc, 3.75, 5.1, true);
  tl.set(C, { signOn: 1 }, 3.8).set(C, { signOn: 0 }, 5.1);
  tl.add(w.hero(st.querySelector('.tag-sam')), 3.95);   // Sam's rejection is the hero shot
  tl.to(C, { x: xs.voice, duration: .55, ease: 'sine.inOut' }, 5.1);
  say(R.voice, 5.65, 6.25);
  tl.to(C, { x: xs.rec, duration: .8, ease: 'sine.inOut' }, 6.3);
  // after paying: back into the mark
  if (DEMO || CAPTURE) {
    tl.to(C, { jump: 1, duration: .2, ease: 'power2.out', yoyo: true, repeat: 1 }, 8.25);
    // slow jump back, settle into the ¢ and hold still
    tl.to(C, { x: () => w.syms.home().x, duration: .8, ease: 'sine.inOut' }, 8.7).to(C, { homeW: 1, duration: 1.3, ease: 'sine.inOut' }, 9.5);
    tl.set(C, { hidden: 1 }, 10.85).to(symfx, { s5out: 0, duration: .35 }, 10.85);
    tl.add(w.syms.accept(w.syms.state.idx), 10.9);
  }

  // 2.3 previews appear
  tl.to(st.querySelector('.t-icon .prev'), { opacity: 1, clipPath: 'inset(0% 0% 0% 0% round 20%)', scale: 1, duration: .7 }, 2.3)
    .to(st.querySelector('.t-desc .prev'), { opacity: 1, duration: .2 }, 2.5).to($('.desc-bar'), { scaleX: 1, duration: .6 }, 2.5)
    .to(st.querySelector('.t-voice .prev'), { opacity: 1, duration: .2 }, 2.7)
    .to($('.logo-prev'), { scale: 1, opacity: 1, duration: .5, ease: 'back.out(2)' }, 2.7);
  // 3.3 Sam: plate turns red with the reason
  tl.to($('.tag-sam'), { opacity: 1, y: 0, duration: .4 }, 3.3)
    .to($('.tag-sam'), { backgroundColor: '#f7b1b5', duration: .35, ease: 'power1.out' }, 3.8)
    .to($('.tag-sam'), { x: -5, duration: .06, repeat: 5, yoyo: true, ease: 'none' }, 3.8).set($('.tag-sam'), { x: 0 }, 4.17)
    .to($('.tag-sam span'), { opacity: 1, duration: .4 }, 3.9);
  // 4.4 Lena appears next to it and lights up lime
  tl.to($('.tag-lena'), { opacity: 1, x: 0, duration: .45 }, 4.4)
    .to($('.tag-lena'), { backgroundColor: '#d7f468', boxShadow: '0 0 14px rgba(214,246,74,.55),0 8px 20px rgba(90,60,60,.08)', duration: .4 }, 4.85)
    .to($('.tag-lena .ck'), { opacity: 1, scale: 1, duration: .4, ease: 'back.out(3)' }, 4.95);
  // 5.1 accepted tiles flash their rim + sparks
  const acc = [['.t-icon', 5.1, w.A.icon], ['.tag-lena', 5.35, w.A.lena], ['.t-voice', 5.6, w.A.voice]];
  acc.forEach(([s, t, at], i) => {
    const rim = st.querySelector(`${s} .rim`), ok = st.querySelector(`${s} .ok`);
    if (rim) tl.to(rim, { opacity: 1, duration: .12 }, t).fromTo(rim, { filter: 'brightness(1.6)' }, { filter: 'brightness(1)', duration: .7 }, t + .12);
    if (ok) tl.to(ok, { opacity: 1, scale: 1, duration: .45, ease: 'back.out(3)' }, t + .1);
    if (LIVE) tl.call(() => w.events.push({ type: 'burst', t0: clock(), dur: 1.1, at, n: i === 1 ? 30 : 46, seed: 100 + i, power: 1 }), null, t);
    else w.events.push({ type: 'burst', t0: t + OFF, dur: 1.1, at, n: i === 1 ? 30 : 46, seed: 100 + i, power: 1 });
  });
  tl.to($('.podium-glow'), { opacity: 1, duration: .8 }, 5.2).to(w, { rimLevel: 1, duration: 1 }, 5.2);
  if (w.syms.state.idx !== 0) tl.add(w.syms.accept(w.syms.state.idx), 5.15); // s5: its check is the Tick, which is out now
  // 5.9 the receipt prints line by line up to 8¢
  $('.row').forEach((r, i) => {
    tl.to(r, { opacity: 1, y: 0, clipPath: 'inset(0 0% 0 0)', duration: .32, ease: 'power2.out' }, 5.9 + i * .3);
    const ic = r.querySelector('i.ck'); if (ic) tl.to(ic, { opacity: 1, scale: 1, duration: .3, ease: 'back.out(3)' }, 6.1 + i * .3);
  });
  tl.to($('.btn-pay'), { opacity: 1, scale: 1, duration: .45, ease: 'back.out(2)' }, 7.4);
  // soft pulse of "Pay 8¢ once"
  const pulse = gsap.timeline({ repeat: CAPTURE || DEMO ? 2 : -1 })
    .to($('.btn-pay'), { scale: 1.035, boxShadow: '0 0 0 6px rgba(168,102,164,.16), 0 10px 26px rgba(150,70,140,.38)', duration: .55, ease: 'sine.inOut' })
    .to($('.btn-pay'), { scale: 1, boxShadow: '0 6px 16px rgba(150,70,140,.28), 0 0 0 0 rgba(168,102,164,0)', duration: .55, ease: 'sine.inOut' });
  tl.add(pulse, 7.9);

  const press = (t0, atTl) => {
    const b = $('.btn-pay');
    const p = gsap.timeline().to(b, { scale: .95, duration: .1, ease: 'power1.in' }).to(b, { scale: 1, duration: .4, ease: 'back.out(3)' });
    if (atTl) { tl.add(p, t0); w.payFx(t0 + OFF); } else w.payFx(t0);
  };
  if (DEMO || CAPTURE) { press(8.2, true); tl.to($('.txl'), { opacity: 1, duration: .4 }, 8.6); }
  tl.set($('.txl'), { opacity: 0 }, 0);
  if (BREAK) { // video 3: the judge breaks Lena instead — the Tick steps out again, shows «0¢» at Lena, then goes home
    tl.set(C, { hidden: 0 }, 11.6).to(symfx, { s5out: 1, duration: .3 }, 11.6).to(C, { homeW: 0, duration: 1.1, ease: 'sine.inOut' }, 11.9);
    tl.add(w.setCareless('lena'), 13.0);
    tl.to(C, { x: () => w.syms.home().x, duration: .7, ease: 'sine.inOut' }, 15.0).to(C, { homeW: 1, duration: 1.2, ease: 'sine.inOut' }, 15.7)
      .set(C, { hidden: 1 }, 16.95).to(symfx, { s5out: 0, duration: .35 }, 16.95).add(w.syms.accept(w.syms.state.idx), 17.0);
  }
  if (TOUR) { // all eight marks in action, one after another
    const order = [1, 2, 3, 4, 5, 6, 7, 0].map((k) => (k + SYM0) % SYMS.length);
    order.forEach((k, j) => tl.add(w.syms.select(k), 12.6 + j * 1.45));
  }
  if (!CAPTURE) tl.call(() => { C.follow = true; C.px = C.x; }, null, TOUR ? 24.5 : DEMO ? 12.2 : 7.6);
  const paidFx = () => { pulse.pause(); press(clock(), false); gsap.to($('.txl'), { opacity: 1, duration: .4, delay: .4 }); gsap.to(C, { jump: 1, duration: .2, yoyo: true, repeat: 1 }); gsap.delayedCall(1.2, () => w.goHome()); };
  if (LIVE) { tl.to($('.txl'), { opacity: 1, duration: .4 }, 7.6); st.querySelectorAll('.btn-pay').forEach((b) => b.addEventListener('click', () => ctl.pay(paidFx))); }
  else if (!CAPTURE) st.querySelectorAll('.btn-pay').forEach((b) => b.addEventListener('click', paidFx));

  if (!CAPTURE) gsap.ticker.add(() => w.render(clock()));
}

// ---------------------------------------------------------------- boot
window.__seek = (t) => { captureT = t; if (master) master.seek(Math.max(t, 0.001), false); world.render(t); return true; };
document.fonts.ready.then(() => {
  layout();
  window.addEventListener('resize', layout);
  document.documentElement.dataset.ready = '1';
});
