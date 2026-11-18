// The real files the site sells, against the published rules and their signed offers.
// Needs ffmpeg/ffprobe on PATH (to read the covers' pixels), like the zip test needs unzip.
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { binToHex, sha256 } from '@bitauth/libauth';
import offers from '../src/data/offers.json';
import speech from '../src/data/trailer-words.json';
import { checkSubtitles, type Speech } from '../src/core/subtitles';
import { checkCover, measureCover } from '../src/core/cover';
import { inspectSvg, LOGO_RULES } from '../src/core/logo';
import { checkCoverDeclared, checkLogoDeclared, checkSubtitlesDeclared } from '../src/core/rules';
import { EXAMPLE } from '../src/data/example';

type Entry = { signed: { offer: { facts: string; fileSha256: string } }; file: string; preview: string };
const book = (offers as unknown as Record<string, Record<string, Entry>>).mainnet!;
const SPEECH = speech as unknown as Speech;
const file = (f: string) => readFileSync(`public/files/${f}`);

function rgba(p: string) {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', p], { encoding: 'utf8' }).trim().split(',').map(Number) as [number, number];
  return { rgba: new Uint8Array(execFileSync('ffmpeg', ['-v', 'error', '-i', p, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 })), width: w, height: h };
}

describe('kit v3 files', () => {
  it('every signed offer fingerprints exactly the file served after payment', () => {
    for (const [k, e] of Object.entries(book)) expect(binToHex(sha256.hash(file(e.file))), k).toBe(e.signed.offer.fileSha256);
  });
  it('subtitles: both good files pass in full, both careless ones are rejected 1.1 s late, in the offer and in the file', () => {
    for (const who of ['sam', 'lena']) {
      const good = book[`${who}:good`]!, bad = book[`${who}:careless`]!;
      expect(checkSubtitles(file(good.file).toString('utf8'), SPEECH)).toMatchObject({ ok: true });
      expect(checkSubtitlesDeclared(good.signed.offer.facts, SPEECH)).toMatchObject({ ok: true });
      expect(checkSubtitles(file(bad.file).toString('utf8'), SPEECH)).toEqual({ ok: false, reason: 'subtitle 1 starts 1.1 s late' });
      expect(checkSubtitlesDeclared(bad.signed.offer.facts, SPEECH)).toEqual({ ok: false, reason: 'subtitle 1 starts 1.1 s late' });
      // the preview (first lines) already shows the careless one
      expect(checkSubtitles(readFileSync(`public${bad.preview}`, 'utf8'), SPEECH)).toMatchObject({ ok: false });
      expect(checkSubtitles(readFileSync(`public${good.preview}`, 'utf8'), SPEECH)).toMatchObject({ ok: true });
    }
  });
  it('covers: both pass in full against their own frame; the frame simply stretched does not', () => {
    for (const v of ['a', 'b'] as const) {
      const e = book[v === 'a' ? 'cover' : 'cover:b']!;
      const frame = rgba(`public${EXAMPLE.choice.frames[v]}`);
      expect(frame.width / frame.height).toBeCloseTo(EXAMPLE.choice.frameSize.width / EXAMPLE.choice.frameSize.height, 5);
      const m = measureCover({ ...rgba(`public/files/${e.file}`), bytes: statSync(`public/files/${e.file}`).size }, frame);
      expect(checkCover(m, frame)).toMatchObject({ ok: true });
      expect(checkCoverDeclared(e.signed.offer.facts, EXAMPLE.choice.frameSize)).toMatchObject({ ok: true });
      expect(checkCover({ ...m, sharpness: m.baselineSharpness }, frame)).toMatchObject({ ok: false });
    }
  }, 60_000);
  it('logo: clean SVG within the rules, as declared', () => {
    const e = book['logo']!;
    const f = inspectSvg(file(e.file).toString('utf8'));
    expect(f).toMatchObject({ root: true, raster: false, active: false });
    expect(f.colors.length).toBeLessThanOrEqual(LOGO_RULES.maxColors);
    expect(f.contours).toBeLessThanOrEqual(LOGO_RULES.maxContours);
    expect(e.signed.offer.facts).toBe(`svg;${f.colors.length};${f.contours};${f.bytes}`);
    expect(checkLogoDeclared(e.signed.offer.facts)).toMatchObject({ ok: true });
  });
});
