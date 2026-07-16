/**
 * Agent ESLint config — same shape as backend's, scoped to agent/src/.
 *
 * The LiveKit agent is a thinner codebase than the backend (10 tools +
 * session context + fallback). Same rules apply because the bug classes
 * we want to catch (floating promises, misused promises) are the exact
 * ones that bite long-running voice sessions.
 *
 * `noUnusedLocals: true` is already in agent/tsconfig.json — the
 * @typescript-eslint/no-unused-vars rule below catches the same shape
 * with finer-grained ignore patterns.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json'],
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
    '*.config.js',
    '*.config.cjs',
    '*.config.ts',
    // Standalone simulation helper aren't in tsconfig.json's `include`
    // (scoped to src/ for the build) and are run directly via tsx, never
    // compiled. Same treatment as the backend's scripts/**/*.mjs carve-out —
    // typed linting can't parse a file outside its project, so it's excluded
    // rather than force-included into the build tsconfig. Named explicitly
    // (not scripts/**/*.ts) so a future .ts file dropped in this dir still
    // gets linted by default.
    'scripts/sim-toolselect.ts',
    'scripts/sim-taskgroup.ts',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
    '@typescript-eslint/no-unsafe-argument': 'warn',

    // Same warn-then-promote model as the backend config — see comment there.
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/require-await': 'error',
    '@typescript-eslint/restrict-template-expressions': 'error',
    '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    '@typescript-eslint/no-base-to-string': 'error',
    '@typescript-eslint/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    }],
    '@typescript-eslint/consistent-type-imports': ['error', {
      prefer: 'type-imports',
      fixStyle: 'inline-type-imports',
    }],
    '@typescript-eslint/no-var-requires': 'off',
    // Enforced: passing an unbound class/interface method loses `this` (a real
    // runtime-crash bug class). Codebase is clean; keep it that way.
    '@typescript-eslint/unbound-method': 'error',
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/await-thenable': 'off',
        '@typescript-eslint/require-await': 'off',
      },
    },
  ],
}
