import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { splitSealed } from './scripts/split-sealed';
import sealedSizes from './src/data/sealed-sizes.json';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5181, strictPort: true },
  plugins: [
    {
      // the big sealed files also go out in parts (src/core/parts.ts): a stalled download then loses one part, not all
      name: 'sealed-parts',
      apply: 'build',
      writeBundle(o) {
        const rows = splitSealed(resolve(__dirname, 'public'), o.dir ?? resolve(__dirname, 'dist'), sealedSizes);
        console.log(`sealed parts: ${rows.reduce((s, r) => s + r.parts, 0)} parts of ${rows.filter((r) => r.parts).length} files`);
      },
    },
  ],
  build: {
    target: 'es2022',
    // lab.html (wallet lab) stays a dev-only page and is not built into the site
    // the catalog is a section of the home page (#catalog)
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        agents: resolve(__dirname, 'agents.html'),
      },
    },
  },
});
