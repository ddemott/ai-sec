import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    // CI on Node 20 hit repeated fork-worker startup failures inside jsdom/undici
    // (`webidl.util.markAsUncloneable is not a function`). Thread workers avoid the
    // child-process clone path and match the green local runs.
    pool: 'threads',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['components/**', 'lib/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
