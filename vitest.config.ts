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
  },
})
