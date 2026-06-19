# Primary-Key Inventory

Single source of truth for every table's PK shape and the reason behind it. The CLAUDE.md "Composite / natural keys preferred" principle picks the default:

> Use a surrogate `<table>_id UUID` only when (a) the natural key is 3+ columns, (b) any part of it is mutable, or (c) the row needs a portable identifier in URLs / external systems.

When none of those apply, the natural key wins.

## Status — 2026-05-18

|                                | Count     |
| ------------------------------ | --------- |
| **Composite / natural PK**     | 9 tables  |
| **Surrogate UUID (justified)** | 21 tables |
| **Total**                      | 30 tables |

## ✅ Already on composite / natural PK (8)

| Table                         | PK                                     | Notes                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `business_templates`          | `(business_type)`                      | Text PK from origin — the catalog of industry vocab templates.                                                                                                                                                                                                                                                                                                     |
| `service_employee`            | `(service_id, employee_id)`            | Junction — composite IS the identity.                                                                                                                                                                                                                                                                                                                              |
| `service_resource`            | `(service_id, resource_id)`            | Junction — composite IS the identity.                                                                                                                                                                                                                                                                                                                              |
| `tenant_calendar_settings`    | `(tenant_id)`                          | 1:1 extension of `tenants`; PK-as-FK enforces "at most one row per tenant".                                                                                                                                                                                                                                                                                        |
| `appointment_sync_map`        | `(appointment_id)`                     | 1:1 extension of `appointments`; PK-as-FK.                                                                                                                                                                                                                                                                                                                         |
| `tenant_integration_settings` | `(tenant_id, provider)`                | **Pilot #1, 2026-05-18** (migration `20260518100000`).                                                                                                                                                                                                                                                                                                             |
| `tenant_skills`               | `(tenant_id, name)`                    | **Pilot #2, 2026-05-18** (migration `20260518110000`).                                                                                                                                                                                                                                                                                                             |
| `employee_schedule`           | `(tenant_id, employee_id, shift_date)` | **Pilot #3, 2026-05-18** (migration `20260518130000`) — borderline 3-column case, all parts stable per row; the URL routes (`POST /shifts/overrides/:employeeId/:shiftDate/update`, `DELETE /shifts/overrides/:employeeId/:shiftDate`) take the composite as path segments. RPC `get_effective_shifts` lost its `override_id` return column in the same migration. |
| `schema_migrations`           | `(version)`                            | Text filename PK (set up by `setup-db.sh`).                                                                                                                                                                                                                                                                                                                        |

## 🔒 Surrogate UUID PK — intentionally retained (22)

Each table fails at least one CLAUDE.md criterion. The "**Blocker**" column names which one.

### Mutable natural key — criterion (b)

| Table       | Surrogate     | Would-be natural key | Blocker                                |
| ----------- | ------------- | -------------------- | -------------------------------------- |
| `customers` | `customer_id` | `(tenant_id, phone)` | name / phone / email all user-editable |
| `employees` | `employee_id` | `(tenant_id, name)`  | name editable via PATCH                |
| `resources` | `resource_id` | `(tenant_id, name)`  | name editable via PATCH                |
| `services`  | `service_id`  | `(tenant_id, name)`  | name editable via PATCH                |

### Needs URL / external identity — criterion (c)

| Table              | Surrogate            | Notes                                                                                                                     |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `tenants`          | `tenant_id`          | Used in URLs (`?tenant_id=…`), JWT claims, foreign keys across the entire schema.                                         |
| `users`            | `user_id`            | Login identity, JWT subject.                                                                                              |
| `voice_sessions`   | `voice_session_id`   | LiveKit's externally-supplied `call_id` is the natural key but it's controlled by LiveKit/Telnyx; keep our own surrogate. |
| `call_summaries`   | `call_summary_id`    | Same — externally-keyed by `call_id`.                                                                                     |
| `call_transcripts` | `call_transcript_id` | Same.                                                                                                                     |

### 3+ column natural key — criterion (a)

| Table                | Surrogate              | Would-be natural key                                             |
| -------------------- | ---------------------- | ---------------------------------------------------------------- |
| `appointments`       | `appointment_id`       | start_time + end_time + resource_id + customer_id (also mutable) |
| `entity_sync_map`    | `entity_sync_map_id`   | (tenant_id, entity_type, local_id, provider)                     |
| `reminder_schedules` | `reminder_schedule_id` | (tenant_id, appointment_id, reminder_type, scheduled_for)        |

(Pilot #3 moved `employee_schedule` — also 3 columns but all immutable and zero FK references to the surrogate — to a composite PK; see "Already on composite / natural PK" above.)

### Append-only ledger — surrogate IS the natural identity

These tables have no row-level natural-uniqueness shape; rows are events / history records.

| Table                  | Surrogate                | Kind                                                 |
| ---------------------- | ------------------------ | ---------------------------------------------------- |
| `audit_log`            | `audit_log_id`           | event log (SECURITY DEFINER trigger output)          |
| `record_versions`      | `record_version_id`      | versioning history by sequence                       |
| `consent_records`      | `consent_record_id`      | append-only consent ledger                           |
| `opt_out_records`      | `opt_out_record_id`      | append-only opt-out ledger                           |
| `unanswered_questions` | `unanswered_question_id` | append-only Q log                                    |
| `user_feedback`        | `user_feedback_id`       | append-only feedback ledger                          |
| `soft_reservations`    | `soft_reservation_id`    | short-lived TTL-keyed reservations                   |
| `tenant_docs`          | `tenant_doc_id`          | document storage with mutable content + URL identity |

### Security tokens — surrogate is the only stable identifier

| Table                 | Surrogate               | Why                                                                            |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `password_resets`     | `password_reset_id`     | token itself IS the secret; the row needs an opaque ID separate from the token |
| `phone_verifications` | `phone_verification_id` | code-verification ledger; same shape                                           |

## How to add a new table

Before writing the `CREATE TABLE`, ask: what would the natural key be?

- **If 1-2 stable columns** (e.g. `(tenant_id, slug)`) — use that composite as the PK. No surrogate.
- **If 3+ columns, or any part is mutable, or the row needs URL identity** — use a `<table_singular>_id UUID PRIMARY KEY DEFAULT gen_random_uuid()` surrogate.

For 1:1 extension tables, reuse the parent's PK as your own (`<parent>_id UUID PRIMARY KEY REFERENCES <parent>(<parent>_id) ON DELETE CASCADE`).

## Retrofit cadence (for future criteria changes)

Composite-key retrofits land **one table per day**, CI-green per commit. Each retrofit:

1. Migration: drop redundant UNIQUE → drop old PK → drop surrogate column → add composite PK (in that order, so a partial apply leaves a recognizable half-state).
2. `baseline.sql` updated to match the post-state.
3. Every TS reference to the surrogate column is rewritten.
4. Full vitest + E2E green before the next pilot.

If you ever decide to relax a "Blocker" reason above (e.g., "we'll treat customer phone as immutable, just guard against rename in the route"), that table becomes a retrofit candidate. Add a row to **"Already on composite / natural PK"** with the pilot number + migration filename when it lands.

## See also

- CLAUDE.md → "Composite / natural keys preferred when the natural key is short and stable"
- CLAUDE.md → "PK column-name convention" (every single-column PK named `<table_singular>_id`, junction tables keep composite)
- Migrations `20260518100000_tenant_integration_settings_composite_pk.sql` and `20260518110000_tenant_skills_composite_pk.sql` — the two pilots that landed today
