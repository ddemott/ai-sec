import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Exclude dashboard tests — they have their own config with jsdom + React + @/ aliases.
    // Run dashboard tests separately: cd dashboard && npx vitest run
    exclude: [
      'dashboard/**',
      'node_modules/**',
      'supabase/**',
    ],
    // DB integration tests share one Postgres instance and use TRUNCATE / savepoints for cleanup.
    // Parallel execution causes deadlocks (40P01) because TRUNCATE needs AccessExclusiveLock
    // while other test files hold RowShareLocks in open transactions. Sequential execution
    // ensures each file completes its cleanup before the next starts.
    fileParallelism: false,
  },
})
