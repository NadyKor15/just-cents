import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5181, strictPort: true },
  build: {
    target: 'es2022',
    // lab.html (wallet lab) stays a dev-only page and is not built into the site
    rollupOptions: { input: { index: resolve(__dirname, 'index.html'), agents: resolve(__dirname, 'agents.html'), catalog: resolve(__dirname, 'catalog.html') } },
  },
});
