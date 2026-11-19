// The parts the build cuts join back into each sealed file, byte for byte; the sizes the page relies on match the
// files; every sealed file the offers name is listed; a file that changed without its size stops the build.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sealedPaths, splitSealed } from '../scripts/split-sealed';
import { partCount, partPath } from '../src/core/parts';
import SIZES from '../src/data/sealed-sizes.json';
import { OFFERS } from '../src/data/offers';

const sizes = SIZES as Record<string, number>;

describe('sealed files in parts', () => {
  it('sizes match the files, and every sealed file the offers name is listed', () => {
    expect(Object.keys(sizes).sort()).toEqual(sealedPaths('public'));
    for (const [p, n] of Object.entries(sizes)) expect(readFileSync(join('public', p)).length, p).toBe(n);
    for (const net of ['mainnet', 'chipnet'] as const) {
      for (const [k, e] of Object.entries(OFFERS[net])) {
        if (k.startsWith('_') || !e.v2) continue;
        expect(sizes[e.v2.sealed], `${net} ${k}`).toBeGreaterThan(0);
        if (e.v2.sealedLight) expect(sizes[e.v2.sealedLight], `${net} ${k} light`).toBeGreaterThan(0);
      }
    }
  });

  it('the parts join back into each file; only the big files are cut', { timeout: 30_000 }, () => {
    const out = mkdtempSync(join(tmpdir(), 'jc-parts-'));
    try {
      const rows = splitSealed('public', out, sizes);
      expect(rows.filter((r) => r.parts).map((r) => [r.path, r.parts])).toEqual([
        ['/enc/chipnet/cover-a.jpg.jce', 9],
        ['/enc/chipnet/cover-b.jpg.jce', 8],
        ['/enc/mainnet/cover-a.jpg.jce', 9],
        ['/enc/mainnet/cover-b.jpg.jce', 8],
      ]);
      for (const r of rows) {
        const whole = readFileSync(join('public', r.path));
        expect(r.parts).toBe(partCount(whole.length));
        const joined = Buffer.concat(Array.from({ length: r.parts }, (_, i) => readFileSync(join(out, partPath(r.path, i)))));
        if (r.parts) expect(joined.equals(whole), r.path).toBe(true);
        expect(existsSync(join(out, partPath(r.path, r.parts)))).toBe(false);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('a sealed file whose size is not the listed one stops the build', () => {
    const pub = mkdtempSync(join(tmpdir(), 'jc-pub-'));
    try {
      cpSync(join('public', 'enc'), join(pub, 'enc'), { recursive: true });
      writeFileSync(join(pub, 'enc/chipnet/logo.svg.jce'), new Uint8Array(10));
      expect(() => splitSealed(pub, join(pub, 'out'), sizes)).toThrow(/logo\.svg\.jce: 10 bytes/);
    } finally {
      rmSync(pub, { recursive: true, force: true });
    }
  });
});
