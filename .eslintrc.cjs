/**
 * Backend ESLint config — extends @typescript-eslint/recommended-type-checked,
 * the official preset from the TypeScript team that uses the type-checker
 * to catch real bugs `tsc` alone misses (floating promises, misused promises,
 * unsafe-any propagation).
 *
 * Scope: src/, shared/, scripts/. Tests are linted too — same rules apply.
 * Agent has its own config under agent/.eslintrc.cjs. Dashboard layers
 * these rules on top of next/core-web-vitals in dashboard/.eslintrc.json.
 *
 * Coexists with the in-progress any-types cleanup (commits
 * `chore(types): clean up backend any-types — batch N`): the `no-explicit-any`
 * family is set to `warn` so existing sites are visible in CI output
 * without blocking green builds. Flip to `error` once the cleanup lands.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    // tsconfig.eslint.json includes test files + scripts/ + tests/ which
    // the main tsconfig.json excludes from the build. Without this,
    // ESLint can't type-check those files and falls back to parsing
    // errors. Keep tsconfig.json as the build's source of truth.
    project: ['./tsconfig.eslint.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
  ],
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'coverage/',
    'coverage_data/',
    'dashboard/',
    'agent/',
    'supabase/',
    'docs/',
    '*.config.js',
    '*.config.cjs',
    '*.config.ts',
  ],
  rules: {
    // ── In-progress cleanup: warn, not error ─────────────────────────
    // The backend has an active any-types cleanup series. These rules
    // surface remaining sites without blocking CI. Promote to 'error'
    // once `noImplicitAny: true` lands in tsconfig.json (currently
    // explicitly set to false as a transition carve-out).
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
    '@typescript-eslint/no-unsafe-argument': 'warn',

    // ── Real-bug catchers ─────────────────────────────────────────────
    // These catch entire bug classes that tsc + unit tests routinely miss.
    // First pass lands them as `warn` so the existing surface is visible
    // (27 floating promises, 15 require-await, etc.) without blocking
    // CI. Promote to 'error' per family once the count hits zero — same
    // play as the no-explicit-any cleanup.
    '@typescript-eslint/no-floating-promises': 'warn',
    '@typescript-eslint/no-misused-promises': ['warn', {
      // Allow void-returning async handlers in places that expect
      // void callbacks (e.g., Fastify route handlers — handled via
      // `withHandler`, so the floating-promise check is enough).
      checksVoidReturn: false,
    }],
    '@typescript-eslint/await-thenable': 'warn',
    '@typescript-eslint/require-await': 'warn',
    '@typescript-eslint/restrict-template-expressions': 'warn',
    '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
    '@typescript-eslint/no-base-to-string': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      // Allow unused destructured siblings — common when extracting a
      // single field: `const { foo, ...rest } = obj`.
      ignoreRestSiblings: true,
    }],
    // Auto-fixable by `eslint --fix`; warn for now so an incremental
    // sweep doesn't block the lint adoption.
    '@typescript-eslint/consistent-type-imports': ['warn', {
      prefer: 'type-imports',
      fixStyle: 'inline-type-imports',
    }],
    // `require()` in .cjs config files is normal; turn off the rule
    // entirely rather than try to scope it per-file.
    '@typescript-eslint/no-var-requires': 'off',
    // unbound-method fires heavily inside vitest matchers + test spies
    // where `this` rebinding is intentional. Warn instead of error.
    '@typescript-eslint/unbound-method': 'warn',
    'no-constant-condition': ['warn', { checkLoops: false }],
  },
  overrides: [
    {
      // Tests can use looser rules — fixtures often need any-shapes
      // to model unhappy paths the production types don't allow.
      files: ['**/*.test.ts', '**/*.spec.ts', 'src/test-utils*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        // Tests use `expect(value).toBe(...)` patterns that
        // typescript-eslint sometimes flags as await-thenable false-positives.
        '@typescript-eslint/await-thenable': 'off',
      },
    },
  ],
}
