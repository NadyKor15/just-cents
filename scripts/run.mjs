// Runs one of the repo's TypeScript scripts with plain Node, no build step:
//   node scripts/run.mjs scripts/<name>.ts [arguments…]
// Vite (already a dev dependency) loads the file and its imports; the script sees its own path as process.argv[1]
// and its arguments from process.argv[2] on, as if it had been started directly.
import { runnerImport } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const file = process.argv[2];
if (!file || !file.endsWith('.ts')) {
  console.error('usage: node scripts/run.mjs scripts/<name>.ts [arguments…]');
  process.exit(2);
}
const path = resolve(file);
process.argv.splice(1, 2, path);
try {
  await runnerImport(path, { root: ROOT, configFile: false, logLevel: 'error' });
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
