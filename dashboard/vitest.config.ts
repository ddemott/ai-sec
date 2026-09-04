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
    // MUST stay above `asyncUtilTimeout` in vitest.setup.ts (10s). Testing Library's
    // waitFor ceiling and vitest's per-test ceiling are two different clocks, and if
    // the test clock is the shorter one it fires first: a slow-but-correct waitFor is
    // killed at 5s with an opaque `Test timed out in 5000ms`, and a genuinely failing
    // one never reaches the Testing Library diagnostic that says WHICH element was
    // missing. T-007 raised asyncUtilTimeout to 10s without raising this, which left
    // the default 5s in charge and made two SetupWizard sad-path tests flaky at ~10%
    // (2 failures in 20 consecutive local runs on `main`, 2026-09-03).
    testTimeout: 15_000,
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
