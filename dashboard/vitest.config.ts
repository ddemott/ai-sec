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
    // GitHub Actions dashboard CI is currently forced onto a newer runner/runtime
    // combination where jsdom/undici can fail while starting parallel thread workers
    // (`webidl.util.markAsUncloneable is not a function`). Keep this suite on forks
    // and disable file-level parallelism so it runs in one stable process model in CI
    // and locally. The suite is still fast enough (~10s locally) that reliability wins.
    pool: 'forks',
    fileParallelism: false,
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
