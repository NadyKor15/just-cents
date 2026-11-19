// The demo files sealed for v2 orders: every file opens with its own key back to the exact bytes the v1 offers name,
// keys differ per network, and sealing again with the same seed gives the same bytes (so the fingerprints can be signed).
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { sealDemoFiles } from '../scripts/seal-files';
import { deriveFileKey, openFile } from '../src/core/filebox';
import offers from '../src/data/offers.json';

const SEED = sha256.hash(utf8ToBin('seal-files test seed, not a real one'));
const book = offers as unknown as Record<'mainnet' | 'chipnet', Record<string, { file: string; signed: { offer: { fileSha256: string } } }>>;

describe('sealing the demo files', () => {
  it('opens to the files the offers name; per-network keys; reproducible', { timeout: 30_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jc-seal-'));
    const again = mkdtempSync(join(tmpdir(), 'jc-seal-'));
    try {
      const rows = await sealDemoFiles(SEED, dir);
      const rows2 = await sealDemoFiles(SEED, again);
      expect(rows).toHaveLength(14);
      expect(rows2.map((r) => r.cipherSha256)).toEqual(rows.map((r) => r.cipherSha256));
      for (const r of rows) {
        const named = Object.values(book[r.net]).find((e) => e.file === r.file);
        expect(named?.signed.offer.fileSha256, r.file).toBe(r.fileSha256);
        const sealed = new Uint8Array(readFileSync(join(dir, r.net, r.sealedFile)));
        expect(binToHex(sha256.hash(sealed))).toBe(r.cipherSha256);
        const plain = await openFile(deriveFileKey(SEED, r.net, r.fileSha256), sealed);
        expect(binToHex(sha256.hash(plain))).toBe(r.fileSha256);
      }
      const logo = rows.filter((r) => r.file === 'logo.svg');
      expect(logo[0]!.keyHash).not.toBe(logo[1]!.keyHash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(again, { recursive: true, force: true });
    }
  });
});
