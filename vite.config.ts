import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  server: { host: true, port: 5173 },
  test: { environment: 'node', testTimeout: 60000 },
} as never);
