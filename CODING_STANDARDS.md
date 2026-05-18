# Coding Standards

Canonical reference for naming conventions and code-style rules that span the project. Updated when a new rule is locked down; checked when reviewing migrations, route handlers, or types that touch persistence.

CLAUDE.md may reference these rules inline for quick lookup. **This file is the source of truth — if CLAUDE.md and this file disagree, this file wins.** Update both when a rule changes.

---

## Tooling baseline

Static checks before review — keep these green per commit. Each one catches a class of bug that the human-reviewer pass routinely misses.

| Gate | Command | Catches |
|---|---|---|
| TypeScript strict | `npx tsc --noEmit` | Type mismatches, narrowing failures, missing required props |
| ESLint type-checked | `npm run lint` (per project) | Floating promises, misused promises, unused vars, unsafe `any` propagation |
| Unit tests | `npm test` (per project) | Behavior regressions |
| E2E | `cd dashboard && npx playwright test` | Cross-system integration regressions |
| Drift detector | `npx tsx scripts/verify-claude-md.ts` | CLAUDE.md claims drifting from filesystem reality |

### ESLint configuration

Backend (`.eslintrc.cjs`), agent (`agent/.eslintrc.cjs`), and dashboard (`dashboard/.eslintrc.json`) all extend `plugin:@typescript-eslint/recommended-type-checked` — the **official preset from the TypeScript team**. Type-checked rules use the full type-checker (not just the AST) so they catch real-world bugs that escape pure lint.

Run `npm run lint` per project. Backend uses `eslint . --max-warnings 999`; dashboard uses `next lint`; agent uses the same `eslint .` flow as backend.

#### Warn now, promote to error per family

Every rule lands as **`warn` initially** so the existing surface is visible without blocking CI. Each family promotes to `error` once its count hits zero. Current counts at adoption (2026-05-17):

| Rule family | Initial count | Status |
|---|---|---|
| `no-explicit-any` + `no-unsafe-*` family | ~1100 warnings | in-progress cleanup (`chore(types): batch N` commits) |
| `no-floating-promises` | ~27 | needs sweep |
| `require-await` | ~15 | needs sweep |
| `restrict-template-expressions` | ~10 | needs sweep |
| `consistent-type-imports` | ~61 | auto-fixable via `eslint --fix` |
| `no-unused-vars` | ~62 | mix of real cleanup + `_` prefix opt-outs |
| `unbound-method` | varies | fires heavily in test files; expected |
| `no-unnecessary-type-assertion` | ~5 | low priority |
| `no-base-to-string` | ~1 | one-off |

**Promotion rule**: when a family's count reaches zero (verified by `npx eslint . | grep <rule> | wc -l`), flip its level from `warn` to `error` in the relevant config. Add a `RESOLVED.md` entry naming the family + date.

#### Catches we want as errors eventually

| Rule | Bug class it catches |
|---|---|
| `no-floating-promises` | A promise nobody awaits silently drops errors. The reminder-retry bug surface lived here for weeks pre-2026-05-14. |
| `no-misused-promises` | Passing an `async` function where a sync one is expected silently swallows rejections. |
| `await-thenable` | `await` on a non-promise is a no-op — usually a sign the call signature changed. |
| `require-await` | `async` without `await` means someone meant to await something and forgot. |
| `no-unused-vars` | Dead variables drift into stale assumptions. `^_` prefix opts out per call site. |
| `consistent-type-imports` | Type-only imports are stripped at runtime — explicit `import type` keeps the runtime graph honest. |

Test files (`*.test.ts`, `*.spec.ts`, `e2e/**`) have looser rules — fixtures often need `any`-shapes to model unhappy paths the production types don't allow. The promise-related checks still apply because forgetting to `await` in a test produces silent green runs.

#### `tsconfig.eslint.json`

ESLint's type-checked rules need every file under lint to be in some `tsconfig.json`'s `include`. The build `tsconfig.json` excludes `**/*.test.ts` (tests aren't built), so we use a separate `tsconfig.eslint.json` that extends the main config and includes `src/**`, `shared/**`, `scripts/**`, `tests/**`. This is the standard pattern — see [typescript-eslint troubleshooting](https://typescript-eslint.io/troubleshooting/typed-linting).

### Published standards referenced

When a house rule echoes a published item, cite by name + number so the rationale is recognizable to anyone reaching for shorthand:

- **`@typescript-eslint/recommended-type-checked`** — official preset; what our lint extends. See [typescript-eslint.io/users/configs](https://typescript-eslint.io/users/configs).
- ***Effective TypeScript*** by Dan Vanderkam (83 numbered items) — de facto reference for TS idioms. Inline rules cite items by number, e.g. "Item 6: Use Your Editor to Interrogate and Explore the Type System."
- **TypeScript Handbook** (official) — for language-level questions (variance, overloads, conditional types). [typescriptlang.org/docs/handbook](https://www.typescriptlang.org/docs/handbook).

What we deliberately **do not** adopt:
- **Google `gts`** — too prescriptive for an existing codebase; would fight our snake_case JSON wire format and React conventions.
- **Airbnb JS Style Guide** — JS-first; its TS port feels grafted. Cherry-pick via the ESLint preset above instead.

---

## Database naming standards

### Table names

- **Plural, snake_case.** `customers`, `appointments`, `employee_schedule`, `reminder_schedules`, `tenant_skills`, `record_versions`.
- **Junction / mapping tables**: `<left_singular>_<right_singular>` (singular-singular). Existing: `service_employee`, `service_resource`.
- No `tbl_` prefix, no `t_` prefix, no Hungarian notation.

### Column case

- **All columns use lowercase snake_case.** `tenant_id`, `start_time`, `created_at`, `is_deleted`.
- Postgres folds unquoted identifiers to lowercase at parse time, so writing `CUSTOMER_ID` in SQL source actually stores `customer_id`. Don't fight the database — match what it stores. Uppercase identifiers would require double-quoting everywhere (`"CUSTOMER_ID"`), which breaks ORMs, breaks `pg_dump` round-trips, and fights every reference codebase. **Locked: snake_case, lowercase, no exceptions.**

### Primary key column names

- **Every single-column PK is named `<table_singular>_id`, never bare `id`.**

| Table | PK column |
|---|---|
| `tenants` | `tenant_id` |
| `customers` | `customer_id` |
| `appointments` | `appointment_id` |
| `employees` | `employee_id` |
| `services` | `service_id` |
| `resources` | `resource_id` |
| `skills` | `skill_id` |
| `users` | `user_id` |
| `voice_sessions` | `voice_session_id` |
| `record_versions` | `record_version_id` |
| `reminder_schedules` | `reminder_schedule_id` |
| `consent_records` | `consent_record_id` |
| `opt_out_records` | `opt_out_record_id` |
| `employee_schedule` | `employee_schedule_id` |

**Why:** JOIN symmetry. `appointments.customer_id = customers.customer_id` lets queries use `USING (customer_id)`, and `SELECT *` across joined tables produces unambiguous column names with no aliasing. `SELECT customer_id FROM appointments JOIN customers USING (customer_id)` is unambiguous; `SELECT id FROM appointments JOIN customers ON customers.id = appointments.customer_id` requires aliasing every column.

**Abbreviations are forbidden.** `voice_session_id` not `vs_id`, `reminder_schedule_id` not `rs_id`. Self-derivability beats brevity — given a table name, you should be able to write the PK + every FK without looking at the schema.

### Foreign key column names

- **Plain FK (unambiguous role): `<referenced_table_singular>_id`.** Same name as the target's PK. Example: `appointments.customer_id` → `customers.customer_id`. JOIN can use `USING (customer_id)`.
- **Role-based FK (ambiguous when there's more than one FK to the same table): `<role>_<referenced_table_singular>_id`.** Keep the `_<table>_id` suffix so the column name still tells you what table it points at.
  - Example: a hypothetical `audit_log.created_by_user_id` and `audit_log.edited_by_user_id` both referencing `users.user_id`. JOIN can't use `USING` for these — falls back to explicit `ON users.user_id = audit_log.created_by_user_id`.
- **Existing exceptions to be migrated:** `opt_out_records.original_consent_id` should become `original_consent_record_id` to comply with the role-based rule.

### Junction tables

- **Keep composite PKs `(left_id, right_id)`** — no surrogate `<junction>_id` added.
- Rationale: the composite IS the identity. A separate surrogate PK adds a column nobody references and forces an extra unique index on the composite anyway.
- Existing: `service_employee (service_id, employee_id)`, `service_resource (service_id, resource_id)`.

### 1:1 extension tables

- **Reuse the parent's PK as the child's PK** — no surrogate `<extension>_id` added.
- Shape: `parent_id UUID PRIMARY KEY REFERENCES parent(parent_id) ON DELETE CASCADE` — the table holds zero-or-one row per parent, attaching optional/specialized fields to a single parent row.
- Rationale: same reason as junction tables — the relationship IS the identity. The PK-as-FK enforces the "at most one row per parent" invariant at the primary-key level (strictly stronger than a surrogate + a separate `UNIQUE` constraint, which could be dropped or forgotten). A surrogate UUID here would only ever be referenced via the parent's id; nothing else needs it.
- Existing: `tenant_calendar_settings (tenant_id PRIMARY KEY REFERENCES tenants)` — at most one calendar integration per tenant. `appointment_sync_map (appointment_id PRIMARY KEY REFERENCES appointments)` — at most one external-event link per appointment.
- JOIN symmetry already holds without a rename: both child PKs share the parent's column name, so `USING (tenant_id)` / `USING (appointment_id)` Just Works.

### Primary key data types

Two patterns, decided by what kind of row the table holds:

#### Domain entity tables → `UUID PRIMARY KEY DEFAULT gen_random_uuid()`

For things the user reasons about, has a lifecycle, or could ever be referenced from another system.

- `tenants`, `customers`, `appointments`, `employees`, `resources`, `services`, `skills`, `users`, `voice_sessions`, `record_versions`, `tenant_skills`, …

**Why UUID:** globally unique, safe to expose in URLs, no enumeration attacks, no cross-tenant collision, FKs across tenants stay distinct.

#### Audit / event tables → `SERIAL PRIMARY KEY`

For append-only logs where the row's identity is its sequence number.

- `reminder_schedules`, `consent_records`, `opt_out_records`. (Likely also `audit_log`, `entity_sync_map` — yet to be enumerated.)
- **The FK columns *inside* these tables that point at domain entities still use `UUID`.** Example: `reminder_schedules.reminder_schedule_id` is SERIAL, but `reminder_schedules.appointment_id` is UUID referencing `appointments.appointment_id`.

**Why SERIAL:** cheaper, ordered, simpler `WHERE id BETWEEN x AND y` queries by sequence. No one outside the worker cares which one.

#### The mental rule

> If an id is referenced from outside its own table (FKs from other tables, URLs, external systems), it's **UUID**. If it's only ever an internal sequence number for "which row was written first," it's **SERIAL**.

### TypeScript type matching

- **`string` for UUID columns, `number` for SERIAL.** Postgres returns UUID as a hex string via the pg driver, and SERIAL as a number.
- The TS field name should match the column name unless the type's other fields already follow a different convention. Mixed conventions within a type are worse than minor cross-type inconsistency.
  - Example: `ReminderSchedule.reminder_schedule_id: number` (snake_case matches the type's other snake_case fields like `appointment_id`, `tenant_id`).
  - Example: `OptOutRecord.optOutRecordId: number` (camelCase matches the type's other camelCase fields like `tenantId`, `customerEmail`). The DB layer aliases via `RETURNING opt_out_record_id as "optOutRecordId"`.
- **Origin lesson (2026-05-11):** `ReminderSchedule.appointment_id` was typed `number` against a UUID FK column. Seven `parseInt(uuid, 10)` calls would have crashed every real INSERT, but 24 mocked unit tests passed because `mockDb.createReminderSchedule` was mocked. The lie hid for weeks until a new caller was about to wire it. Mocked tests prove the mock works, not the integration.

### JSON wire format

- **API responses use snake_case throughout.** No camelCase conversion at the boundary.
- The TS type's field name and the JSON wire key are the same. `{ appointment_id: "abc" }` stays `{ appointment_id: "abc" }` end-to-end.

---

## Test fixture standards

### IDs in test fixtures should be UUID-shaped strings

For any field typed `string` (UUID columns), tests should use UUID-shaped string literals — **even in mocked tests** that never touch real Postgres.

```ts
// ✅ recommended
const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CUSTOMER_ID = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';
const APPOINTMENT_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

// ❌ avoid (breaks if test ever migrates to real DB, hides UUID/integer bugs)
const TENANT_ID = '1';
const CUSTOMER_ID = 'c1';
const EMPLOYEE_ID = 123;
```

**Why:** UUID-shaped strings are *more representative* of production data, port cleanly when a mocked test is later upgraded to a real-DB integration test, and can't be silently swallowed by a `parseInt`/`Number()` coercion bug. The reminder bug above would have been caught earlier if mocked tests had used UUID-shaped strings — `parseInt('aaaaaaaa-...', 10)` returns `NaN` exactly like it does in production.

### Style for UUID-shaped strings

Letter-based v4-shaped strings are easy to type and read in test output:
- `'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'` — tenant A
- `'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'` — appointment 1
- `'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa'` — customer 1

Already in use in `src/routes/appointments.test.ts:49-54`.

### Known constants

- `SUPER_ADMIN_TENANT_ID` = `'00000000-0000-0000-0000-000000000000'`
- `DYNATIRE_TENANT_ID` = `'f234e471-0e60-4163-86c9-93cfd9338e3a'`

### Full sweep before declaring a rename done

Targeted test runs miss real-DB SQL strings outside the obvious files. Every PK-rename pilot in this codebase (2026-05-11 / 2026-05-12) has surfaced at least one extra test file the targeted run missed, caught only by the full backend sweep. **Always run `npx vitest run` to completion before pushing a rename.**

---

## Migration patterns

### Naming

- `YYYYMMDDhhmmss_<short_description>.sql`. Example: `20260512000003_consent_records_pk_rename.sql`.
- Description is snake_case, terse, describes intent not mechanism. "Pk rename" beats "alter table".

### PK rename recipe

Established across pilots 1–6 (`record_versions`, `tenant_skills`, `reminder_schedules`, `consent_records`, `opt_out_records`, `voice_sessions`); applied unchanged through the 26-pilot sprint that closed every single-column PK rename (see `RESOLVED.md` 2026-05-12 for Part 1 + Part 2):

1. **Inventory:** schema + RPCs + views + types + route SQL + dashboard renders + tests. Use `pg_proc` / `pg_views` + grep for `<table>.id` / `<alias>.id` patterns.
2. **Migration:**
   - `ALTER TABLE <name> RENAME COLUMN id TO <name_singular>_id;`
   - For any RPC whose body references the column: `DROP FUNCTION IF EXISTS <fn>(...)` then `CREATE OR REPLACE FUNCTION ...`. `CREATE OR REPLACE` alone cannot change a function's `RETURNS TABLE` shape.
   - For any view whose output includes the renamed column: `DROP VIEW IF EXISTS <view>` then `CREATE OR REPLACE VIEW ...`. `CREATE OR REPLACE VIEW` cannot rename output columns in-place.
3. **TS types:** update both `src/types/*` and `dashboard/lib/types.ts` (and `agent/src/*` if applicable).
4. **DB layer SQL:** route handlers, service files, RPC bodies — every `WHERE id =`, `RETURNING id`, `vs.id`, `r.id`, etc.
5. **Test fixtures:** mock data structures that previously used `id` need the new field name. The targeted reminder/consent/voice tests pass after these updates; the *full* sweep catches the extras.
6. **Drift detector:** bump migration count in CLAUDE.md (`92 SQL migrations` → `93` etc.) and run `npx tsx scripts/verify-claude-md.ts` to confirm clean.
7. **Full sweep:** `npx vitest run` (backend) + `cd dashboard && npm test` + `cd agent && npm test` + drift + (optional) E2E.
8. **Commit + push.** CI is the canonical green gate.

### Inbound-FK behavior

`ALTER TABLE … RENAME COLUMN` automatically updates inbound FK targets — Postgres tracks FKs by column identity, not name. The FK columns in OTHER tables keep their existing names (often role-based or already correct).

---

## Testing conventions

### 5W diagnostic comments on every test

Every test (`test(...)` / `it(...)`) carries a comment block answering five questions, so the next debugger can understand the failure without spelunking through callers:

```ts
test('SAD: one call fails → retryable error banner appears', async () => {
  // WHO: Owner opens the dashboard while the appointments API is flaky
  // WHAT: The component must NOT show an empty "no appointments" state
  //        — it must surface the failure with a retry option
  // WHEN: any time a single backing fetch returns 5xx during dashboard load
  // WHERE: dashboard/components/DashboardHome.tsx loadError surface
  // WHY: Prior code used `.catch(() => [])` which made a network failure
  //        look identical to "no bookings today" — a trust-eroding lie
  ...
})
```

**Why:** when a test fails 6 months from now, the failure message is one line; the 5W block is the rest of the story. Without it, every regression triage starts with archaeology. Skipping the 5Ws on a new test is a review-blocker.

### `HAPPY:` / `SAD:` prefixes

Test names that drive a happy path start with `HAPPY:`. Test names that exercise a sad path (rejection, validation failure, network error, conflict) start with `SAD:`. Lets reviewers scan a 20-test describe block and confirm both paths exist for every behavior.

```ts
test('HAPPY: clicking "Got it" closes without navigating', ...)
test('SAD: no pending flag → tour renders nothing', ...)
```

### Independent test data lifecycle

Every test owns its full data lifecycle: **setup → assert → teardown**, no shared state, no test depending on another's residue. See [`feedback_test_isolation.md`](./.claude/projects/-home-dale-projects-ai-sec/memory/feedback_test_isolation.md) for the rule's origin.

For E2E: register a fresh tenant via `registerFreshTenant()`, run the scenario, `cleanTenantData()` in `finally`. Cascade-delete handles all dependent rows. See `dashboard/e2e/helpers/fixtures.ts`.

For backend integration: same shape — each test creates its rows under a uniquely-suffixed name and tears them down.

### Mocked tests prove the mock works, not the integration

A mocked test is only a real test if a UUID-shaped string would survive its full path. See the test-fixture section above for the 2026-05-11 reminder-bug origin lesson. **Mocked unit tests are not a substitute for integration tests against real surfaces.**

### Full sweep before claiming a rename done

Always `npx vitest run` to completion before pushing a column rename / type rename / large refactor. Targeted test runs miss SQL strings outside the obvious files; every PK-rename pilot has surfaced at least one extra test file caught only by the full sweep.

---

## Backend route conventions

### Response shape

Every mutation returns exactly one of two shapes, never a bare value:

```ts
// success
{ success: true, /* domain payload */ }

// failure
{ success: false, error: 'human-readable message', details?: <zod issues | extra context> }
```

The agent worker relies on this contract — both shapes return HTTP 200 so the LLM can relay the message naturally.

### `withHandler` wraps every route

Every route handler runs inside `withHandler(async (req, reply) => {...}, 'fallback error message')` (`src/middleware.ts`). Provides:
- Unified `AppError` → status mapping
- Structured error logging (Pino + Sentry + metrics)
- Fallback error message for unexpected throws (never leaks stack traces)

**Don't** write a try/catch in a route handler. Let `withHandler` catch and route to the error pipeline. Throw `AppError` (or domain-specific subclass) when a specific HTTP status / error code is needed.

### `assertRowAffected` for UPDATE / DELETE

`assertRowAffected(result, reply, 'not found')` (`src/routes/routeHelpers.ts`) returns 404 when the row count is zero — never a silent 200 with stale state. Use it after every `UPDATE` and `DELETE` query.

### Zod-validated inputs

Every mutation route validates its body against a Zod schema and returns 400 + the Zod issues array on failure:

```ts
const parsed = MySchema.safeParse(req.body)
if (!parsed.success) {
  return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues })
}
```

Helper: `sendValidationError(reply, parsed.error)` collapses the boilerplate.

### Tenant isolation

Tenant-scoped routes use `withTenantClient()` — sets `app.current_tenant_id` for RLS. Cross-tenant routes (`/tenants/*`, super-admin operations) use `requireSuperAdmin` and pass `null` to `withTenantClient` for the admin-bypass branch.

`tenantMiddleware` rejects 403 when any user-supplied `tenant_id` doesn't match the JWT's (unless super-admin) — added 2026-05-06 after the multi-tenant-isolation probe.

---

## Dashboard conventions

### API client namespacing

All backend calls go through `dashboard/lib/api.ts`, namespaced as `Api.{resource}.{action}()`:

```ts
Api.customers.list(tenantId)
Api.appointments.create(tenantId, body)
Api.shifts.schedule.bulkForDate(tenantId, start, end)
```

Returns are fully typed. **Never `fetch()` directly from a component** — the api.ts layer handles auth-failure detection (`forceLogout()` on 401) and the per-request envelope shape.

### Hook usage

- **`useActiveTenantId()`** for the current tenant. Returns `managedTenantId || tenantId` so super-admins see the tenant they switched into.
- **`useFormState<T>()`** for form state + dirty tracking. Don't roll a new useState for forms.
- **`useConfirm()` + `<ConfirmModal />`** for destructive actions. Never `window.confirm()`.
- **`useVocabulary()`** for industry-template vocabulary (`Stylist` vs `Tech` vs `Truck`). Never hardcode "employee" or "bay" in a view that ships to multiple verticals.

### Component shape

- `'use client'` at the top of any component using hooks or browser APIs.
- Default export for the primary component; named exports for sub-components in the same file.
- Props interface declared above the component (`interface FooProps { ... }`), not inline.
- One CSS theme var per visual property — never hardcoded color strings. See `dashboard/styles/globals.css` for the full token list.

### Empty states

Use `EmptyState` from `components/ui/EmptyState.tsx` for the canonical "nothing here yet" affordance. Variants: `centered` (fills parent) / `compact` (inline). See E2 (2026-05-17) in `RESOLVED.md`.

---

## Commit message conventions

[Conventional Commits](https://www.conventionalcommits.org/) with optional scope:

```
<type>(<scope>): <subject>

<body>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ui`, `style`, `perf`, `ci`.

Scopes (used in this repo): `ui`, `reminders`, `observability`, `theme`, `types`, `sms`, `e2e`, plus ad-hoc subsystem names.

Examples from `git log`:
- `feat(ui): D4 persistent setup-progress pill in top utility row`
- `chore(types): clean up backend any-types — batch 4 (AppFastifyInstance alias)`
- `test(e2e): cover D1 wizard-welcome auto-open path on fresh-tenant landing`
- `fix(test): align architecture-review-fixes fallback to test_db`

Subject ≤72 chars, imperative mood, no period. Body explains *why* + notable *what*; bullet groups OK; mention migrations / breaking changes / follow-ups.

---

## Code-review checklist

Before opening a PR (or before clicking commit if you're the only one reviewing):

- [ ] **Tests**: new tests have 5W comments, happy + sad paths covered, `HAPPY:` / `SAD:` prefixes
- [ ] **Mocks**: any new mocked test uses UUID-shaped strings, not numeric IDs
- [ ] **Routes**: response shape `{ success, error?, details? }`, wrapped in `withHandler`, mutations use `assertRowAffected` on UPDATE/DELETE
- [ ] **Tenant safety**: tenant-scoped reads go through `withTenantClient`; cross-tenant operations use `requireSuperAdmin`
- [ ] **PKs**: new columns follow `<table_singular>_id`, FKs match, junction tables use composite PKs
- [ ] **Types**: TS field name matches column case; UUID columns typed `string`, SERIAL columns typed `number`
- [ ] **Migrations**: full rename recipe followed (see above), drift detector clean
- [ ] **Docs**: CLAUDE.md / TODO.md / RESOLVED.md / TEST_COVERAGE.md updated to reflect the change
- [ ] **Sweep**: full `npx vitest run` + dashboard tests + agent tests + lint, not just a targeted run

---

## Formatting

Prettier owns formatting. The repo-root `.prettierrc.json` is the source of truth — don't argue with the tool, let it decide.

Run `npm run format` in any of the three projects (backend root, `agent/`, `dashboard/`) to apply. `npm run format:check` is the CI gate. The dashboard and agent scripts pass `--config ../.prettierrc.json` so all three projects share the same rules.

### Settings (locked in `.prettierrc.json`)

| Setting | Value | Why this choice |
|---|---|---|
| `semi` | `true` | Backend was already using semis; standardize across the codebase rather than the other way around. Less ASI ambiguity. |
| `singleQuote` | `true` | TS strings — matches existing code in both backend and dashboard. |
| `jsxSingleQuote` | `false` | JSX attributes use double quotes — matches existing code and HTML convention. |
| `trailingComma` | `"es5"` | Multi-line arrays / objects / function args. ES5-safe so older transpile targets don't choke. |
| `tabWidth` | `2` | Existing convention. |
| `printWidth` | `100` | Compromise between Prettier's default 80 (too narrow for this codebase's typical lines) and the existing ~120 norm (allows wall-of-text). |
| `arrowParens` | `"always"` | Cheap to read, consistent with multi-param arrows. |
| `bracketSameLine` | `false` | JSX closing `>` on its own line — easier to spot in diffs. |
| `endOfLine` | `"lf"` | Cross-platform consistency; matches Linux/macOS dev environments. |

### What Prettier doesn't own

- **Code structure** — function length, file organization, when to extract sub-components. See "Function and file size" below.
- **Identifier names** — covered in the existing Database naming standards (DB columns) + the TypeScript identifier-naming section.
- **Import order** — currently informal; future ESLint rule (`import/order` or `@typescript-eslint/sort-imports`) could enforce.
- **Comment quality** — 5W comments on tests (see "Testing conventions"), explanatory comments where rationale isn't obvious.

### What's deliberately not in `.prettierignore`

The full list lives in `.prettierignore` — notable inclusions:
- `supabase/migrations/` — hand-written SQL with intentional formatting; reformatting risks breaking the migration chain.
- `RESOLVED.md` and `docs/CURRENT_STATUS_ARCHIVED_*.md` — historical post-mortem narrative; reformatting would rewrite the past.

---

## Function and file size

Soft heuristics, not hard rules. When a number is crossed, **look for** a natural split — don't always make one. Premature extraction is worse than a long function; see the Build Principle "Working flat code beats a dormant abstraction."

### Functions

- **>50 lines** in a route handler → the business logic probably belongs in a service file. The handler should be parse → validate → call service → format response.
- **>4 positional parameters** → switch to an options object. Positional-param order is invisible at the call site; named keys self-document.
- **Cyclomatic complexity > ~10** (gut-check, not measured) → extract a helper. A function with seven nested if/else branches is hard to read AND hard to test.
- **Async functions without `await`** → ESLint `require-await` catches this. If you genuinely need a Promise-returning function with no awaits inside, return the promise directly without `async`.

### Files

- **Components > 300 lines** → look for sub-components. Pattern: extract a sub-component for any visual region that has its own state or its own children-prop API.
  - Real examples that crossed the threshold and were left intentionally: `OutlookLayout.tsx` (~400 lines — the layout chrome is one coherent surface), `DashboardHome.tsx` (~480 lines — includes `WeekView` and `QuickAction` as in-file sub-components, which is the right shape).
- **Modules > 400 lines** → consider splitting. `dashboard/lib/api.ts` is large (~800 lines) but namespaces all backend calls; splitting it would force every component to track which sub-file owns which resource.
- **Test files > 600 lines** → split by describe block. `SetupWizard.test.tsx` (~500 lines, 84 tests) is at the edge but cohesive.

### React components

- **Hooks at the top, computed values next, handlers next, render last.** A reader scanning a 200-line component should know "this is what the component depends on" by line 30.
- **Don't return JSX from a component-level conditional that's longer than ~30 lines.** Pull it into a named function (`renderEmptyState()`) or a sub-component. Long conditional JSX trees are the most common reason a component crosses the 300-line threshold.
- **`useState` for local state, `useFormState<T>()` for forms.** Don't reach for `useReducer` unless three different events need to update the same state atomically.
- **Don't introduce React Context unless prop-drilling crosses 3+ layers.** `SessionContext`, `VocabularyContext`, `ThemeContext` are the four contexts in the codebase — they earn the cost. New contexts need a clear "3+ layers" justification.

---

## Pattern guidance

### Composition over inheritance

The codebase uses **almost no classes**. `AppError` (and its subclasses for HTTP error mapping) is essentially the only class, because the runtime needs `instanceof AppError` to route errors. Everything else is functions + hooks + plain data.

When in doubt: write a function. Reach for a class only when the runtime needs identity (`instanceof`), the type system needs a structural distinction that interfaces can't model, or the data has methods that genuinely belong with it (rare in this codebase).

### Hooks, not HOCs

React shared logic goes in custom hooks (`useFormState`, `useSetupProgress`, `useConfirm`). The codebase doesn't use higher-order components or render props — they're harder to type and harder to compose.

### Errors: throw `AppError`, don't return Result types

For HTTP-mappable errors (validation failed, not found, conflict, forbidden), **throw** an `AppError` and let `withHandler` convert it to a status code + envelope. The codebase does NOT use Result-style return types (`{ ok: true, value } | { ok: false, error }`) — they fragment error handling across every call site and the existing throw-based pipeline already routes through Pino + Sentry + metrics.

Return error info as data only when the caller genuinely needs to branch on the failure shape (e.g., booking RPCs return error codes like `TIMESLOT_OCCUPIED` so the agent can phrase the response differently per code).

### Services: flat files until a third caller asks for shape

From Build Principles: "Working flat code beats a dormant abstraction." `src/services/*.ts` is mostly flat files — each provider gets its own pair (e.g., `jobberClient.ts` + `jobberSync.ts`). Don't introduce a `ProviderRegistry` or `BaseSyncService` interface until a third real caller asks for the shared shape.

When a shared shape DOES emerge (consent-gated communications got `CommunicationService` + `ProviderRegistry` at three+ providers), the abstraction lives in its own subdirectory (`src/services/communications/`) and the flat files migrate into it.

### Tenant isolation is non-negotiable

Every tenant-scoped read goes through `withTenantClient()`. Every cross-tenant operation uses `requireSuperAdmin`. Never bypass with raw `pool.query()` from a route — the RLS context var won't be set and the query will either return zero rows (worst case: a confusing 404) or, if you accidentally use the admin-bypass pool, leak across tenants.

The 2026-05-06 multi-tenant-isolation probe found `?tenant_id=<other>` could override the JWT's `tenant_id`. `tenantMiddleware` now rejects 403 on that shape. Don't write new routes that re-introduce the bug — read the user's `tenant_id` from `req.auth.tenant_id`, never from query / body.

### Reach for shipped tools before writing new ones

Before adding a custom hook, helper, or component: grep `dashboard/components/ui/` and `dashboard/lib/` (or backend `src/services/`). The codebase has accumulated `useFormState`, `useConfirm`, `useVocabulary`, `EmptyState`, `Button`, `Card`, `Modal`, `Toast`, `ConfirmModal`, plus the routeHelpers family. Re-implementing one of these because you didn't find it is the most common cause of inconsistency.

---

## Build principles already in CLAUDE.md

Cross-reference, not duplicated here. See `CLAUDE.md` → "Build Principles":

- **Test it or delete it.** Mocked tests prove the mock works, not the integration.
- **Build for real customers, not the imagined Pro tier.**
- **Working flat code beats a dormant abstraction.**
- **HIPAA verticals are permanently excluded.**
