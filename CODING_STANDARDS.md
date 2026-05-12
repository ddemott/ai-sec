# Coding Standards

Canonical reference for naming conventions and code-style rules that span the project. Updated when a new rule is locked down; checked when reviewing migrations, route handlers, or types that touch persistence.

CLAUDE.md may reference these rules inline for quick lookup. **This file is the source of truth — if CLAUDE.md and this file disagree, this file wins.** Update both when a rule changes.

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

## Build principles already in CLAUDE.md

Cross-reference, not duplicated here. See `CLAUDE.md` → "Build Principles":

- **Test it or delete it.** Mocked tests prove the mock works, not the integration.
- **Build for real customers, not the imagined Pro tier.**
- **Working flat code beats a dormant abstraction.**
- **HIPAA verticals are permanently excluded.**
