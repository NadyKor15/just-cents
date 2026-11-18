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
  it('stamps every file with the time of the download, not 1979 (empty DOS date)', () => {
    const when = new Date(2026, 10, 18, 15, 44, 58); // local time, as zip dates are
    const z = zip([{ name: 'a.txt', data: new TextEncoder().encode('a') }, { name: 'b.txt', data: new TextEncoder().encode('bb') }], when);
    const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
    const decode = (time: number, date: number) => [(date >> 9) + 1980, (date >> 5) & 15, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2];
    const want = [2026, 11, 18, 15, 44, 58];
    // local headers: time at +10, date at +12
    expect(decode(v.getUint16(10, true), v.getUint16(12, true))).toEqual(want);
    const second = 30 + 'a.txt'.length + 1;
    expect(decode(v.getUint16(second + 10, true), v.getUint16(second + 12, true))).toEqual(want);
    // central directory: time at +12, date at +14
    const cd = v.getUint32(z.byteLength - 22 + 16, true);
    expect(decode(v.getUint16(cd + 12, true), v.getUint16(cd + 14, true))).toEqual(want);
    // without a date given: now, so never the empty date
    const now = new DataView(zip([{ name: 'x', data: new Uint8Array([1]) }]).buffer);
    expect((now.getUint16(12, true) >> 9) + 1980).toBeGreaterThanOrEqual(2026);
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
