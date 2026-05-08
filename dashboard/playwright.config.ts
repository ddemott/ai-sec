import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  // workers:1 forces serial execution across spec files. fullyParallel:false
  // only disables WITHIN-file parallelism; without this setting Playwright
  // runs spec files in parallel by default (workers = half CPU cores), which
  // breaks the test-isolation principle when two specs touch the same tenant
  // at overlapping today-times — the GiST exclusion fails the loser.
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'https://localhost:4000',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    storageState: 'e2e/.auth/user.json',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { storageState: undefined },
    },
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      dependencies: ['setup'],
    },
  ],
});
