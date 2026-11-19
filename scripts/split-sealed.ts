// Cuts the big sealed files into the parts the page downloads (src/core/parts.ts), at build time, into the built site:
// <outDir>/enc/<net>/<file>.jce.p0 … — the parts are not kept in git (they are the whole file, cut).
// The sizes the page relies on are in src/data/sealed-sizes.json; a file whose size differs stops the build.
// Called by the build (vite.config.ts); can also run alone: node <bundle of this file> [publicDir] [outDir]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PART_BYTES, partCount, partLength, partPath } from '../src/core/parts';

/** Every sealed file under <publicDir>/enc, as the site path the page uses (/enc/<net>/<file>.jce). */
export function sealedPaths(publicDir: string): string[] {
  const out: string[] = [];
  for (const net of readdirSync(join(publicDir, 'enc')).sort()) {
    for (const f of readdirSync(join(publicDir, 'enc', net)).sort()) if (f.endsWith('.jce')) out.push(`/enc/${net}/${f}`);
  }
  return out;
}

/** Writes the parts of every sealed file larger than one part; returns how many parts each got. */
export function splitSealed(publicDir: string, outDir: string, sizes: Record<string, number>): { path: string; parts: number }[] {
  const listed = new Set(Object.keys(sizes));
  const done: { path: string; parts: number }[] = [];
  for (const path of sealedPaths(publicDir)) {
    if (!listed.has(path)) throw new Error(`${path} is not in src/data/sealed-sizes.json`);
    const bytes = readFileSync(join(publicDir, path));
    if (bytes.length !== sizes[path]) throw new Error(`${path}: ${bytes.length} bytes, sealed-sizes.json says ${sizes[path]}`);
    const n = partCount(bytes.length);
    for (let i = 0; i < n; i++) {
      const file = join(outDir, partPath(path, i));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes.subarray(i * PART_BYTES, i * PART_BYTES + partLength(bytes.length, i)));
    }
    listed.delete(path);
    done.push({ path, parts: n });
  }
  if (listed.size) throw new Error(`sealed-sizes.json lists files that are not there: ${[...listed].join(', ')}`);
  return done;
}

if (process.argv[1]?.includes('split-sealed')) {
  const sizes = JSON.parse(readFileSync('src/data/sealed-sizes.json', 'utf8')) as Record<string, number>;
  const rows = splitSealed(process.argv[2] ?? 'public', process.argv[3] ?? 'dist', sizes);
  for (const r of rows) if (r.parts) console.log(`${r.path} → ${r.parts} parts`);
}
