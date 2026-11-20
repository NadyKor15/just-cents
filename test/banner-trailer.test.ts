// The banner's Copy button, the trailer that loads only on Play, and what the page itself promises in its HTML.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyAndConfirm, type CopyButton } from '../src/app/copy';
import { armTrailer, trailerStarted, type PlayButton, type TrailerVideo } from '../src/app/trailer';
import { BANNER } from '../src/config';

const ROOT = resolve(__dirname, '..');
const ADDR = 'bitcoincash:zzjyky2y9eha9y6kya407vgf86dax2ausvzzrs90aq';

function button(label = 'Copy'): CopyButton & { classes: Set<string> } {
  const classes = new Set<string>();
  return { textContent: label, classes, classList: { add: (...t) => t.forEach((x) => classes.add(x)), remove: (...t) => t.forEach((x) => classes.delete(x)) } };
}

describe('Copy next to the address', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('copies the address, says "Copied" for a moment, then "Copy" again', async () => {
    const b = button();
    const copy = vi.fn(async () => true);
    expect(await copyAndConfirm(b, ADDR, copy)).toBe(true);
    expect(copy).toHaveBeenCalledWith(ADDR);
    expect(b.textContent).toBe('Copied');
    expect(b.classes.has('copied')).toBe(true);
    vi.advanceTimersByTime(1599);
    expect(b.textContent).toBe('Copied');
    vi.advanceTimersByTime(1);
    expect(b.textContent).toBe('Copy');
    expect(b.classes.size).toBe(0);
  });

  it('a second click while it says "Copied" keeps the label "Copy" afterwards', async () => {
    const b = button();
    const copy = vi.fn(async () => true);
    await copyAndConfirm(b, ADDR, copy);
    vi.advanceTimersByTime(800);
    await copyAndConfirm(b, ADDR, copy);
    expect(copy).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000); // the first timer would have fired here; it was replaced
    expect(b.textContent).toBe('Copied');
    vi.advanceTimersByTime(600);
    expect(b.textContent).toBe('Copy');
  });

  it('says so when the copy failed', async () => {
    const b = button();
    expect(await copyAndConfirm(b, ADDR, async () => false)).toBe(false);
    expect(b.textContent).toBe('Copy failed');
    expect(b.classes.has('copy-failed')).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(b.textContent).toBe('Copy');
  });
});

function video(): TrailerVideo & { plays: number } {
  const v = { src: '', controls: true, preload: 'metadata', plays: 0, play() { v.plays++; return Promise.resolve(); } };
  return v;
}

describe('the trailer loads only on Play', () => {
  const URL_ = '/game-frames/trailer-720.mp4';

  it('has no src until Play is pressed, then gets it once and plays', () => {
    const v = video();
    const p: PlayButton = { hidden: true, onclick: null };
    armTrailer(v, p, URL_);
    expect(v.src).toBe('');
    expect(v.preload).toBe('none');
    expect(v.controls).toBe(false);
    expect(p.hidden).toBe(false);
    expect(trailerStarted(v)).toBe(false);
    p.onclick!();
    expect(v.src).toBe(URL_);
    expect(v.plays).toBe(1);
    expect(v.controls).toBe(true);
    expect(p.hidden).toBe(true);
    expect(trailerStarted(v)).toBe(true);
    p.onclick!();
    expect(v.plays).toBe(1);
  });

  it('once started, filling the screen again does not hide the video behind Play again', () => {
    const v = video();
    const p: PlayButton = { hidden: true, onclick: null };
    armTrailer(v, p, URL_);
    p.onclick!();
    const p2: PlayButton = { hidden: false, onclick: null };
    armTrailer(v, p2, URL_);
    expect(p2.hidden).toBe(true);
    expect(v.controls).toBe(true);
    expect(v.src).toBe(URL_);
  });

  it('Play turns the subtitles on (a default track alone stays off in Safari with captions on "Automatic")', () => {
    const v = video();
    const subs = { kind: 'subtitles', mode: 'disabled' };
    v.textTracks = [{ kind: 'metadata', mode: 'hidden' }, subs];
    const p: PlayButton = { hidden: true, onclick: null };
    armTrailer(v, p, URL_);
    expect(subs.mode).toBe('disabled'); // nothing before Play
    p.onclick!();
    expect(subs.mode).toBe('showing');
    expect(v.textTracks[0]!.mode).toBe('hidden');
    // the screen fills again with a new track: it is shown too
    const subs2 = { kind: 'subtitles', mode: 'disabled' };
    v.textTracks = [subs2];
    armTrailer(v, { hidden: false, onclick: null }, URL_);
    expect(subs2.mode).toBe('showing');
  });

  it('a play() that throws or is refused does not break the button', () => {
    const v = video();
    v.play = () => { throw new Error('NotAllowedError'); };
    const p: PlayButton = { hidden: true, onclick: null };
    armTrailer(v, p, URL_);
    expect(() => p.onclick!()).not.toThrow();
    expect(v.src).toBe(URL_);
    expect(v.controls).toBe(true);
    const v2 = video();
    v2.play = () => Promise.reject(new Error('NotAllowedError'));
    const p2: PlayButton = { hidden: true, onclick: null };
    armTrailer(v2, p2, URL_);
    expect(() => p2.onclick!()).not.toThrow();
  });

  it('the page HTML gives the video no src and preload="none"', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    const tag = html.match(/<video[^>]*>/g) ?? [];
    expect(tag.length).toBe(1);
    expect(tag[0]).not.toMatch(/\bsrc=/);
    expect(tag[0]).toMatch(/preload="none"/);
    expect(html).toMatch(/class="trailer-play"/);
  });
});

describe('the banner', () => {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

  // the banner's links, as the page HTML has them (main.ts sets the same from BANNER)
  const link = (key: string) => {
    const m = html.match(new RegExp(`<a [^>]*data-banner="${key}"[^>]*>([^<]*)</a>`));
    return { tag: m?.[0] ?? '', href: m?.[0].match(/href="([^"]*)"/)?.[1] ?? '', text: m?.[1] ?? '' };
  };

  it('Slides opens the Google Slides deck; the PDF deck stays on this site', () => {
    expect(BANNER.slides).toBe('https://docs.google.com/presentation/d/1iy5GfTxaN05aO6pZPD9KZJh1KxygnOBR9O_AsPVu-oE/view');
    expect(link('slides')).toMatchObject({ href: BANNER.slides, text: 'Slides' });
    const f = resolve(ROOT, 'public', 'just-cents-slides.pdf');
    expect(existsSync(f)).toBe(true);
    expect(readFileSync(f).subarray(0, 5).toString()).toBe('%PDF-');
    expect(statSync(f).size).toBeGreaterThan(100_000);
  });

  it('Code opens the public repository', () => {
    expect(BANNER.repo).toBe('https://github.com/NadyKor15/just-cents');
    expect(link('repo')).toMatchObject({ href: BANNER.repo, text: 'Code' });
  });

  it('"Nov 14: not started" links to the first commit (full sha), and every banner link opens in a new tab', () => {
    expect(BANNER.firstCommit).toBe('https://github.com/NadyKor15/just-cents/commit/c42478e7b8430f2c3844a23963ffe688da564f8e');
    expect(link('firstCommit')).toMatchObject({ href: BANNER.firstCommit, text: 'Nov 14: not started (first code Nov 16)' });
    for (const k of ['slides', 'repo', 'firstCommit']) expect(link(k).tag).toMatch(/target="_blank" rel="noopener"/);
  });

  it('says where the project was on Nov 14, and has Copy next to the address', () => {
    expect(html).toContain('Nov 14: not started (first code Nov 16)');
    expect(html).toContain(`data-copy-btn="${ADDR}"`);
    expect(html).toContain(`data-copy="${ADDR}"`);
  });
});
