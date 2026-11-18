// Rules for the kit v3 parts (subtitles, cover, logo) on synthetic files.
// Every rule has a case that must pass and a deliberately wrong case that must fail (the check is not blind).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkSubtitles, parseSrt, SUB_RULES, type Speech } from '../src/core/subtitles';
import { checkCover, measureCover, COVER_RULES } from '../src/core/cover';
import { checkLogo, inspectSvg, LOGO_RULES } from '../src/core/logo';
import { likeness, resizeBilinear, sharpness, ssim, toGray, type Gray } from '../src/core/image';

const F = (n: string) => readFileSync(new URL(`./fixtures/kit-v3/${n}`, import.meta.url), 'utf8');
const speech = JSON.parse(F('speech.json')) as Speech;
const good = F('good.srt');

describe('subtitles', () => {
  it('reads SRT', () => {
    const p = parseSrt(good);
    expect(p.ok && p.cues.map((c) => [c.n, c.start, c.end, c.lines.length])).toEqual([[1, 18.1, 20.4, 1], [2, 20.6, 23.1, 1], [3, 23.5, 26.3, 2]]);
    expect(parseSrt('hello\nthere')).toMatchObject({ ok: false });
    expect(parseSrt('')).toMatchObject({ ok: false });
  });
  it('accepts subtitles that land on the words, and a shift inside the 0.4 s tolerance', () => {
    expect(checkSubtitles(good, speech)).toMatchObject({ ok: true });
    expect(checkSubtitles(F('shifted-0.3s.srt'), speech)).toMatchObject({ ok: true });
  });
  it('rejects the careless file: every line 1.2 s late', () => {
    expect(checkSubtitles(F('shifted-1.2s.srt'), speech)).toEqual({ ok: false, reason: 'subtitle 1 starts 1.2 s late' });
  });
  it('rejects early lines too', () => {
    const early = good.replace('00:00:20,600 --> 00:00:23,100', '00:00:20,500 --> 00:00:22,900').replace('00:00:23,500 --> 00:00:26,300', '00:00:22,900 --> 00:00:26,300');
    expect(checkSubtitles(early, speech)).toEqual({ ok: false, reason: 'subtitle 3 starts 0.6 s early' });
  });
  it('rejects lines too fast to read', () => {
    expect(checkSubtitles(F('broken.srt'), speech)).toMatchObject({ ok: false, reason: expect.stringContaining('subtitle 2 is too fast to read') });
  });
  it('rejects a line over 42 characters and a subtitle of 3 lines', () => {
    const long = good.replace('Omar wants to borrow 50 dirhams', 'Omar wants to borrow fifty dirhams from you, today');
    expect(checkSubtitles(long, speech)).toMatchObject({ ok: false, reason: expect.stringContaining('characters, at most 42') });
    const three = good.replace('25 dirhams.', '25\ndirhams.');
    expect(checkSubtitles(three, speech)).toEqual({ ok: false, reason: 'subtitle 3 has 3 lines, at most 2' });
  });
  it('rejects overlapping lines', () => {
    const ov = good.replace('00:00:18,100 --> 00:00:20,400', '00:00:18,100 --> 00:00:20,800');
    expect(checkSubtitles(ov, speech)).toEqual({ ok: false, reason: 'subtitles 1 and 2 overlap' });
  });
  it('rejects a last line that stays long after the sound', () => {
    const tail = good.replace('00:00:23,500 --> 00:00:26,300', '00:00:23,500 --> 00:00:32,500');
    expect(checkSubtitles(tail, speech)).toEqual({ ok: false, reason: 'the last subtitle ends 2.5 s after the sound' });
  });
  it('rejects words that are not said, and a line that vanishes before its last word', () => {
    expect(checkSubtitles(good.replace('until Friday. No rule for this.', 'see you at the lake soon'), speech)).toEqual({ ok: false, reason: 'subtitle 2: its words are not in the speech' });
    const cut = good.replace('00:00:23,500 --> 00:00:26,300', '00:00:23,500 --> 00:00:25,500');
    expect(checkSubtitles(cut, speech)).toEqual({ ok: false, reason: 'subtitle 3 disappears before its last word is said' });
  });
  it('publishes its numbers', () => {
    expect(SUB_RULES).toMatchObject({ maxChars: 42, maxLines: 2, maxCps: 20, toleranceSec: 0.4, maxTailSec: 2 });
  });
});

// Synthetic pictures: a sharp 2560×1600 cover (hard-edged blocks and thin lines), and the "frame" it was made from:
// the same picture boxed down 4× to 640×400.
function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function sharpCover(w: number, h: number): Uint8ClampedArray {
  const r = lcg(7), shade: number[] = [];
  for (let i = 0; i < 4096; i++) shade.push(Math.floor(r() * 256));
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = shade[(Math.floor(y / 37) * 97 + Math.floor(x / 41)) % 4096]!;
    if (x % 23 === 0 || y % 29 === 0) v = 255 - v;
    const i = (y * w + x) * 4; px[i] = v; px[i + 1] = (v * 3) % 256; px[i + 2] = 255 - v; px[i + 3] = 255;
  }
  return px;
}
function boxDown(src: Uint8ClampedArray, w: number, h: number, k: number): Uint8ClampedArray {
  const W = w / k, H = h / k, out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += src[((y * k + dy) * w + x * k + dx) * 4 + c]!;
    out[(y * W + x) * 4 + c] = s / (k * k);
  }
  return out;
}
function grayToRgba(g: Gray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.w * g.h * 4);
  g.px.forEach((v, i) => { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255; });
  return out;
}

describe('cover', () => {
  const W = 2560, H = 1600;
  const cover = sharpCover(W, H);
  const frame = { rgba: boxDown(cover, W, H, 4), width: 640, height: 400 };
  const fr = { width: 640, height: 400 };

  it('accepts a sharp cover of the right size and shape', () => {
    const m = measureCover({ rgba: cover, width: W, height: H, bytes: 6_000_000 }, frame);
    const v = checkCover(m, fr);
    expect(v).toMatchObject({ ok: true });
    expect(m.sharpness / m.baselineSharpness).toBeGreaterThan(COVER_RULES.sharpnessGain);
  });
  it('rejects the frame just stretched to the size (no new detail)', () => {
    const stretched = grayToRgba(resizeBilinear(toGray(frame.rgba, 640, 400), W, H));
    const m = measureCover({ rgba: stretched, width: W, height: H, bytes: 6_000_000 }, frame);
    expect(checkCover(m, fr)).toEqual({ ok: false, reason: 'no sharper than the frame simply stretched' });
  });
  it('rejects a cover stretched out of the frame proportions (16:9 from a 16:10 frame)', () => {
    expect(checkCover({ width: 2880, height: 1620, bytes: 1, alphaMin: 255, sharpness: 9, baselineSharpness: 1 }, fr)).toMatchObject({ ok: false, reason: expect.stringContaining('stretched') });
  });
  it('rejects too small, transparent and too heavy files', () => {
    const ok = { width: W, height: H, bytes: 1, alphaMin: 255, sharpness: 9, baselineSharpness: 1 };
    expect(checkCover({ ...ok, width: 1920, height: 1200 }, fr)).toEqual({ ok: false, reason: 'asked for at least 2560×1600, got 1920×1200' });
    expect(checkCover({ ...ok, alphaMin: 0 }, fr)).toEqual({ ok: false, reason: 'the cover has transparent parts' });
    expect(checkCover({ ...ok, bytes: 30 * 1024 * 1024 }, fr)).toMatchObject({ ok: false, reason: expect.stringContaining('at most 25 MB') });
    expect(checkCover(ok, fr)).toMatchObject({ ok: true });
  });
  it('sharpness measure itself sees the difference (must differ)', () => {
    const g = toGray(cover, W, H);
    expect(sharpness(g)).toBeGreaterThan(2 * sharpness(resizeBilinear(toGray(frame.rgba, 640, 400), W, H)));
  });
});

// Synthetic line drawings, 256×256, dark ink on white.
function drawing(shape: 'circle' | 'square', thick: number, off = 0): Gray {
  const w = 256, px = new Float32Array(w * w).fill(255), c = 128 + off;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const d = shape === 'circle' ? Math.abs(Math.hypot(x - c, y - c) - 80) : Math.min(Math.abs(Math.max(Math.abs(x - c), Math.abs(y - c)) - 80), 999);
    if (d <= thick / 2) px[y * w + x] = 20;
  }
  return { w, h: w, px };
}

describe('logo', () => {
  const sketch = drawing('circle', 6);
  const like = likeness(sketch, drawing('circle', 6));
  const traced = likeness(sketch, drawing('circle', 9));
  const offHand = likeness(sketch, drawing('circle', 6, 2));
  const other = likeness(sketch, drawing('square', 6));
  const otherThick = likeness(sketch, drawing('square', 9, 3));

  it('likeness: same drawing 1, a close trace and a slightly shifted one high, a different drawing low', () => {
    expect(like).toBeCloseTo(1, 5);
    expect(traced).toBeGreaterThanOrEqual(LOGO_RULES.minSsim);
    expect(offHand).toBeGreaterThanOrEqual(LOGO_RULES.minSsim);
    expect(other).toBeLessThan(LOGO_RULES.minSsim);
    expect(otherThick).toBeLessThan(LOGO_RULES.minSsim);
    // full-size SSIM is too strict for line art (a stroke 1 px thicker already drops below the bar) …
    expect(ssim(sketch, drawing('circle', 7), true)).toBeLessThan(LOGO_RULES.minSsim);
    // … and without inkOnly the white background makes a square look almost like the circle (0.81): the reasons for likeness()
    expect(ssim(sketch, drawing('square', 6))).toBeGreaterThan(0.8);
  });
  it('accepts clean outlines like the sketch', () => {
    const f = inspectSvg(F('logo-good.svg'));
    expect(f).toMatchObject({ root: true, raster: false, active: false, contours: 4 });
    expect(f.colors.sort()).toEqual(['#1d1d1f', '#8a4fa0', '#ffffff']);
    expect(checkLogo(F('logo-good.svg'), traced)).toMatchObject({ ok: true });
  });
  it('rejects a picture pasted inside an SVG', () => {
    expect(checkLogo(F('logo-raster-inside.svg'), 0.99)).toEqual({ ok: false, reason: 'a picture is pasted inside, not outlines' });
  });
  it('rejects more than 3 colours, more than 200 outlines, a heavy file, a script, a non-SVG', () => {
    expect(checkLogo(F('logo-five-colours.svg'), 0.99)).toEqual({ ok: false, reason: '5 colours, at most 3' });
    const many = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${'<path d="M0 0 L1 1 Z" fill="#000"/>'.repeat(201)}</svg>`;
    expect(checkLogo(many, 0.99)).toEqual({ ok: false, reason: '201 outlines, at most 200' });
    const heavy = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 ${'L1 1 '.repeat(25000)}Z" fill="#000"/></svg>`;
    expect(checkLogo(heavy, 0.99)).toMatchObject({ ok: false, reason: expect.stringContaining('at most 100 KB') });
    expect(checkLogo(F('logo-script.svg'), 0.99)).toEqual({ ok: false, reason: 'the SVG has scripts in it' });
    expect(checkLogo('PNG not svg', 0.99)).toEqual({ ok: false, reason: 'not an SVG file' });
  });
  it('rejects outlines not like the sketch', () => {
    expect(checkLogo(F('logo-good.svg'), other)).toMatchObject({ ok: false, reason: expect.stringContaining('not like the sketch') });
  });
});
