// Seals the demo specialists' full files for hash-lock (v2) orders: <outdir>/<net>/<file>.jce, one key per file and
// network, derived from JC_FILE_KEY_SEED (environment only; never printed or written). Prints, per network and file,
// the key lock (sha256 of the key) and the sealed file's fingerprint: the two values a v2 offer signs.
//   JC_FILE_KEY_SEED=<hex, ≥ 32 bytes> node <bundle of this file> [outdir, default public/enc]
// Sealing is reproducible: the same seed and files always give the same sealed bytes.
// An open specialist seals its own file with --specialist <dir> (sealSpecialist below); without it, as before.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import { deriveFileKey, keyHashHex, sealFile } from '../src/core/filebox';
import { netsOf, readEnvFile, readSpec, sealedPath, specialistDir } from './specialist-lib';

export const DEMO_FILES = ['cover-a.jpg', 'cover-b.jpg', 'subs-sam.srt', 'subs-sam-careless.srt', 'subs-lena.srt', 'subs-lena-careless.srt', 'logo.svg'];

export type Sealed = { net: 'mainnet' | 'chipnet'; file: string; sealedFile: string; fileSha256: string; keyHash: string; cipherSha256: string };

export async function sealDemoFiles(seed: Uint8Array, outDir: string, srcDir = 'public/files', files = DEMO_FILES): Promise<Sealed[]> {
  const out: Sealed[] = [];
  for (const net of ['mainnet', 'chipnet'] as const) {
    mkdirSync(join(outDir, net), { recursive: true });
    for (const file of files) {
      const plain = new Uint8Array(readFileSync(join(srcDir, file)));
      const fileSha256 = binToHex(sha256.hash(plain));
      const key = deriveFileKey(seed, net, fileSha256);
      const sealed = await sealFile(key, plain);
      const sealedFile = `${file}.jce`;
      writeFileSync(join(outDir, net, sealedFile), sealed);
      out.push({ net, file, sealedFile, fileSha256, keyHash: keyHashHex(key), cipherSha256: binToHex(sha256.hash(sealed)) });
    }
  }
  return out;
}

/**
 * An open specialist's file (specialists/template/README.md): sealed once per network it sells on, under keys from the
 * seed in <dir>/.dev.vars, into <dir>/public/enc/<net>/<file>.jce.
 *   node scripts/run.mjs scripts/seal-files.ts --specialist specialists/<you>
 */
export async function sealSpecialist(dir: string): Promise<Sealed[]> {
  const spec = readSpec(dir);
  const seedHex = readEnvFile(join(dir, '.dev.vars')).JC_FILE_KEY_SEED ?? '';
  if (!/^([0-9a-f]{2}){32,}$/i.test(seedHex)) throw new Error(`${dir}/.dev.vars: JC_FILE_KEY_SEED is missing or shorter than 32 bytes`);
  const seed = hexToBin(seedHex.toLowerCase());
  const plain = new Uint8Array(readFileSync(join(dir, spec.file)));
  const fileSha256 = binToHex(sha256.hash(plain));
  const out: Sealed[] = [];
  for (const net of netsOf(spec)) {
    const key = deriveFileKey(seed, net, fileSha256);
    const sealed = await sealFile(key, plain);
    const path = sealedPath(dir, spec, net);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, sealed);
    out.push({ net, file: spec.file, sealedFile: path, fileSha256, keyHash: keyHashHex(key), cipherSha256: binToHex(sha256.hash(sealed)) });
  }
  return out;
}

const specialistFolder = process.argv[1]?.includes('seal-files') ? specialistDir() : null;
if (specialistFolder) {
  for (const r of await sealSpecialist(specialistFolder)) console.log(`${r.net} ${r.file} → ${r.sealedFile} keyHash ${r.keyHash} cipherSha256 ${r.cipherSha256}`);
}

const seedHex = process.env.JC_FILE_KEY_SEED;
if (seedHex && !specialistFolder && process.argv[1]?.includes('seal-files')) {
  if (!/^([0-9a-f]{2}){32,}$/i.test(seedHex)) throw new Error('JC_FILE_KEY_SEED must be at least 32 bytes of hex');
  const rows = await sealDemoFiles(hexToBin(seedHex.toLowerCase()), process.argv[2] ?? 'public/enc');
  for (const r of rows) console.log(`${r.net} ${r.file} → ${r.sealedFile} keyHash ${r.keyHash} cipherSha256 ${r.cipherSha256}`);
}
