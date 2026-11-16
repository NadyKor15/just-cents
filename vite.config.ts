import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5181, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: { input: { index: resolve(__dirname, 'index.html'), lab: resolve(__dirname, 'lab.html') } },
  },
});
