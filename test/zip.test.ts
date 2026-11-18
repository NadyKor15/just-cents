import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { crc32, zip } from '../src/app/zip';

describe('kit zip', () => {
  it('crc32 matches the known value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('is a valid archive that unzip accepts and extracts byte for byte', () => {
    const files = [
      { name: 'receipt.json', data: new TextEncoder().encode('{"ok":true}') },
      { name: 'cover-a.jpg', data: readFileSync('public/files/cover-a.jpg') },
      { name: 'subs-lena.srt', data: readFileSync('public/files/subs-lena.srt') },
      { name: 'logo.svg', data: readFileSync('public/files/logo.svg') },
    ];
    const dir = mkdtempSync(join(tmpdir(), 'jczip-'));
    try {
      writeFileSync(join(dir, 'kit.zip'), zip(files));
      const t = execFileSync('unzip', ['-t', join(dir, 'kit.zip')], { encoding: 'utf8' });
      expect(t).toMatch(/No errors detected/);
      execFileSync('unzip', ['-q', join(dir, 'kit.zip'), '-d', join(dir, 'out')]);
      for (const f of files) expect(Buffer.compare(readFileSync(join(dir, 'out', f.name)), Buffer.from(f.data))).toBe(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
