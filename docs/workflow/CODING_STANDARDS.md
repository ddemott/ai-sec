# Coding Standards

General standards for any project. Adapt per stack (TS/JS, Python, Go, etc.). Project-specific details (DB schema names, dashboard hooks, route wrappers, migration recipes) belong in ARCHITECTURE.md, DEVELOPMENT_WORKFLOW.md or domain docs. No duplication.

## Tooling Gates

Static analysis before review. Green per commit.

- Type checking (`tsc --noEmit` or equivalent strict mode).
- Linter with type-aware rules where available (`eslint` with `@typescript-eslint/recommended-type-checked` or language equivalent). Start rules at `warn`; promote to `error` when count hits zero.
- Formatting (Prettier or equivalent). Shared `.prettierrc` across projects.
- Unit + E2E tests.
- Drift detectors for docs vs code where practical.

Reference published standards: Effective TypeScript (items by number), TypeScript Handbook, language official style guides. Cite them.

Do not adopt overly prescriptive guides (gts, Airbnb) that fight existing conventions without strong reason.

## Naming Conventions

- Consistent casing per layer: camelCase in code, snake_case for DB columns/tables and JSON wire formats.
- Descriptive names. Avoid heavy abbreviations.
- For primary keys in relational DBs: `<table_singular>_id` (e.g. `user_id`, `order_id`). Enables clean JOINs with `USING`.
- Foreign keys: `<role>_<target>_id` when ambiguous, else match target PK name.
- Table names: plural, snake_case.
- Test constants: use production-like values (UUID strings for ID fields).

## Testing Standards

- Every test includes context (5W: who, what, when, where, why) or equivalent.
- Prefix names to signal path: `HAPPY:` / `SAD:` or Given-When-Then.
- Independent lifecycle per test: setup, assert, teardown. No shared state.
- Cover happy path, error paths, boundaries, concurrency, exhaustion.
- Every bug fix includes regression test that fails before fix, passes after.
- Mocked tests must use realistic data or they only test the mock. Prefer integration tests against real surfaces.
- Full suite run (not targeted) before large refactors or renames.

## Code Structure

- Functions <50 lines ideal; >4 params → options object.
- Components <300 lines; extract subcomponents for coherent regions.
- Prefer composition, plain functions, custom hooks over classes/inheritance. Use classes only for runtime needs (`instanceof`) or language idioms.
- Hooks at top of React components, then computed, handlers, render.
- Flat files until 3+ callers demand shared abstraction. Then extract to subdirectory.
- Throw domain errors for expected failures; let framework/middleware map to responses. Avoid silent error swallowing (no-floating-promises, require-await).

## Error & Validation

- Use typed schemas (Zod or equivalent) at boundaries.
- Consistent response envelopes for APIs: `{ success: true, ... }` or `{ success: false, error: string, details? }`.
- Assert affected rows on mutations.

## Commits & Review

- Conventional Commits: `type(scope): subject`. Types: feat, fix, refactor, test, docs, chore. Imperative, <72 chars subject.
- Body explains why.
- Branch hygiene: one active branch at a time. Pick TODO → solve it (code + tests + docs) → PR → merge to main → delete working branch (local + remote). No open branches or unsolved TODOs. Prevents context loss and dead branches. Enforced in checklists, prepare-commit, PR template.
- Pre-PR checklist: gates green, tests updated (skip unit/E2E for pure *.md/doc-only changes), docs synced, full verification run (format/lint/drift detectors always), self-review.
- Fix root causes across similar call sites, not symptoms.

## Formatting

Prettier decides. Typical locked settings:
- semi: true
- singleQuote: true
- trailingComma: "es5"
- printWidth: 100
- tabWidth: 2

Ignore generated, migrations (if hand-formatted SQL), historical docs.

## Principles (Stark follows these)

- Architecture before code: name components, boundaries, data flow, irreversible decisions. Say what is deliberately not built.
- Verify with real execution. Run commands, read full output, try to break it. No "looks good". Green suite without watching it is rumor.
- Coverage claims must name untested paths (`retry_handler` has no exhausted-attempts test).
- Tests first for bug fixes.
- Own outcome end-to-end. Delegate execution but not verdict.
- No unearned confidence. "This works" only after verification.
- Keep context disciplined per model (prune on local tight-context models).

Update this file for new general rules. Reference it from project docs. Specifics stay local.

---
*Derived from secretary-hq practices generalized for reuse. Last updated 2026-09-04.*
