# Mocked-DB Test Audit — real-SQL coverage map

**Created 2026-07-01** (branch `test/blindspot-p0-verification`), fulfilling the
`docs/TODO_BLINDSPOT.md` P0 item: *"Audit every `*.test.ts` that mocks the DB and add
a real-DB companion for anything that builds SQL."* Rule of record (CLAUDE.md):
**mocked-API tests prove the mock works, not the integration** — any code that BUILDS
SQL (dynamic WHERE, interpolated identifiers, multi-row VALUES, RPC calls, casts) must
also be executed against real Postgres, or a typo/ambiguity/param-index bug ships green.

Method: every backend `*.test.ts` that mocks pg was classified by what its
code-under-test does with SQL. `scripts/` had no pg mocks. Files that mock a non-DB
surface (googleapis, Sentry, the typed repository layer) are excluded — their SQL
lives elsewhere or doesn't exist.

## Risk classes

- **HIGH** — code-under-test dynamically BUILDS SQL (interpolated identifiers,
  `conditions.push`/`join(' AND ')`, `paramIndex` bumping, multi-row `VALUES`,
  RPC signatures, `::date`/`::vector` casts).
- **MED** — static SQL with params only; a column typo would 500 but there's no
  dynamic assembly to get wrong.
- **LOW** — DB incidental / pure logic.

## HIGH-risk files and their real-DB companions

| Mocked test | Code under test (SQL risk) | Real-DB companion | Status |
|---|---|---|---|
| `src/services/serviceResolver.test.ts` | serviceResolver 3-branch SQL (the prod ambiguous-`name` 500) | `src/services/serviceResolver.realdb.test.ts` + `src/agentToolsBookingIntegration.test.ts` (route-level regression) | ✅ pre-existing + extended this branch |
| `src/analytics.test.ts` | `/analytics/*` date-range SQL (`$n::date`, COALESCE-interval, FILTER, GROUP BY, abandonment_by_service) | `src/analytics.realdb.test.ts` | ✅ added this branch |
| `src/routes/auditLog.test.ts` | dynamic WHERE + date casts + dynamic LIMIT/OFFSET indices | `src/routes/auditLog.realdb.test.ts` | ✅ added this branch |
| `src/versionHistory.test.ts` | **interpolated identifiers** `${table}`/`${pkColumn}` + dynamic whereClause | `src/versionHistory.realdb.test.ts` | ✅ added this branch |
| `src/voice.test.ts` | dynamic whereClause/paramIndex + LIMIT/OFFSET + is_deleted filters | `src/voice.realdb.test.ts` | ✅ added this branch |
| `src/services/reminders/scheduleForAppointment.test.ts` | dynamic multi-row INSERT into reminder_schedules | `src/services/reminders/scheduleForAppointment.realdb.test.ts` | ✅ added this branch |
| `src/agentTools.test.ts` (customer search) | concatenated-column ILIKE name search | `src/agentToolsCustomerSearch.realdb.test.ts` | ✅ added this branch |
| `src/agentTools.test.ts` (booking) | booking RPC calls + tz conversion | `src/agentToolsBookingIntegration.test.ts` | ✅ added this branch |
| `src/routes/appointments.test.ts` | dynamic date WHERE + dynamic UPDATE SET list | `appointment-date-filter.test.ts`, `appointment-mutations.test.ts` | ✅ pre-existing |
| `src/shifts-routes.test.ts` | `get_effective_shifts(_bulk)` RPC signatures + ::DATE casts | `shift-overrides-edge.test.ts` | ✅ pre-existing |
| `src/routes/knowledge.explain.test.ts` | `search_tenant_docs_normalized` RPC (::vector) | `knowledge-policy-answer.test.ts` | ✅ pre-existing (RPC level) |
| `src/routes/knowledge.importWebsite.test.ts` | ::vector INSERTs | `knowledge-import-document.test.ts` | ✅ pre-existing |
| `src/services/expandWeeklyToSchedule.test.ts` | dynamic multi-row INSERT into employee_schedule | `expand-weekly-integration.test.ts` | ✅ pre-existing |

**Every HIGH-risk SQL-building surface now has a real-DB companion.**

## MED backlog (static SQL, params only — add opportunistically)

No real-DB companion yet: `reminders.deliveryStats`, `crmSyncStatus`, `crmDisconnect`,
`exportData`, `selfService`, `users-routes`, `square-routes`/`square-sync`,
`calendar-sync`, `workers/voiceSessionReaper`. Partial (adjacent real suite exists but
not the exact statements): `conflictLookup`, `customerLookup`, `tenants/bootstrap`,
`mappings`, `communications`, `skills`, `agentToolsAiCost/Cancel/TakeMessage`.
These are static statements — a wrong column 500s loudly in dev — so they ride behind
the HIGH class. Promote any of them to HIGH the moment dynamic SQL is introduced.

## Real bugs surfaced by writing the companions (2026-07-01) — all FIXED same day

1. **`/agent-tools/find-customer-by-name` ILIKE wildcard over-disclosure** — the spoken
   name was interpolated into `'%' || $2 || '%'` without escaping `%`/`_`; a `%` in the
   term matched the tenant's whole address book (capped at LIMIT 5). Parameterized (no
   SQL injection), tenant-scoped, but over-disclosed names+phones. **Fixed**: LIKE
   metacharacters escaped; regression test asserts literal matching.
2. **`GET /voice/history` unvalidated query params** — `limit=abc` → `parseInt` NaN →
   pg `invalid input syntax for type bigint: "NaN"` → 500; `customer_id=not-a-uuid` →
   22P02 → 500. **Fixed**: digits-only limit/offset validation + `requireValidUUID` →
   clean 400s; regression tests added.
3. **`scheduleForAppointment` had no idempotency guard** — calling it twice seeded a
   duplicate 4-row reminder bundle (retry wrapper ⇒ double-reminded customers).
   **Fixed**: seed now skips when a `scheduled` bundle exists; reschedule (cancel-then-
   seed) unaffected.
4. **Version-history rot after the 2026-05 PK renames** (the audit's biggest catch) —
   `restore_fields_from_version()` and `copy_fields_between_records()` still queried
   bare `id` (`column "id" does not exist`) so field-restore/copy-fields 500'd in prod
   on EVERY table; the deleted-records list hardcoded `t.name, t.phone`, 500ing on 4 of
   6 supported tables. **Fixed**: migration `20260701010000_fix_version_rpc_pk_names.sql`
   (PK-aware, same pattern as `soft_delete_record`) + per-table display columns in
   `versionHistory.ts`. The 33-test real-DB suite locks all of it in.
5. **Restore stringified jsonb into text columns** (found only AFTER fixing #4 made the
   function runnable) — the original SET clause assigned raw jsonb, so a restored name
   came back literally `"Versioned Vera"` WITH quotes. Fixed in the same migration via
   `jsonb_populate_record` (decodes into each column's real type). A perfect
   demonstration of the audit's thesis: two layers of never-executed SQL, the second
   invisible until the first was fixed.

(Also pinned as documented behavior, not bugs: whitespace-only search names
short-circuit before SQL; reminder consent is deliberately deferred to the delivery
worker, not the write path.)

## The standing rule for new code

When a change introduces **dynamic SQL of any kind**, the PR must include (or extend) a
real-DB test that executes that statement shape. The mocked suite still owns
marshalling/validation/error-branch coverage — the two are companions, not substitutes.
