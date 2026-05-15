# SecretaryHQ — Resolved Issues Archive

Historical session journals, completed phases, and resolved bug logs. Moved out of `CLAUDE.md` on 2026-05-05 to keep always-loaded context lean. Newest first.

---

## 2026-05-14 — Per-tenant SMS rate limiter + 429 retry-policy carve-out

Closes TODO Phase 5 Ops "Rate limiting for SMS sends." Pre-fix, the project relied entirely on Twilio's account-wide throttle — a tenant batching 200 reminders could exhaust the per-second budget for everyone. Now each tenant is capped individually.

**Implementation:**

- New `src/services/communications/smsRateLimit.ts` — `SmsRateLimiter` class, token bucket per `tenantId`, lazy refill on `acquire()` based on wall clock. Defaults: capacity=60, refillRate=1/sec (matches TODO spec "1 SMS/sec, 60/min"). Env-configurable: `SMS_RATE_LIMIT_CAPACITY` / `SMS_RATE_LIMIT_REFILL_PER_SEC`. `acquire(tenantId)` throws `RateLimitedError` with `status: 429` + `retryAfterMs`. Fresh tenants start full. Backwards-clock defense. Process-singleton `smsRateLimiter`.
- Wiring in `src/services/communications/smsService.ts`: `sendSMS` acquires after consent check, before provider call; re-throws on 429 so the worker's retry policy sees it. `sendSystemSMS` (opt-out confirmations) deliberately bypasses — already bounded by inbound STOP volume, can't be dropped.
- Retry-policy carve-out in `src/services/reminders/retryPolicy.ts`: `isRetryable` now special-cases HTTP 429 as retryable before the generic "4xx → don't retry" rule. Without this, rate-limited rows mark failed immediately.

**Composition with retry logic:** rate-limited → `RateLimitedError 429` → retry policy sees retryable → row's `retry_count++`, `next_retry_at = now + 5/30/120 min` → worker picks up after backoff → bucket refilled → succeeds.

**Tests added (+10 backend):**
- `smsRateLimit.test.ts` (9): fresh-bucket-full; drain-and-block; refill math; capacity-cap; RateLimitedError shape; **separate-tenants-have-independent-buckets** (load-bearing); tryAcquire; reset(); clock-going-backwards.
- `retryPolicy.test.ts` (+1): 429 retryable carve-out (pairs with the existing 4xx-non-retryable test).

Backend 1,893 → 1,903. No migration. Zero TS errors. Drift detector clean.

---

## 2026-05-14 — Beta customer onboarding guide

Closes TODO "Beta customer onboarding guide." Pre-fix, the next beta customer needed a founder screen-share to get from "I'd like to try this" to "my AI is taking calls." Now `docs/BETA_ONBOARDING.md` (~280 lines) covers it.

**Contents:** Day-1 pre-flight checklist (8 items, timezone flagged as "get right on Day 1"); 4-primary-tab tour + 3 Back Office sub-tabs; 7-step wizard walkthrough with common mistakes; 4-scenario first test call script; KB setup across 9 policy categories; 5-min daily morning check; weekly Copy Week ritual with failure symptom (>4-week-out → "no availability"); 7 admin tasks with locations; 6 troubleshooting modes with diagnostic order; escalation path; HIPAA-excluded-verticals note.

**Out of scope:** screenshots/recordings, video walkthrough, per-template playbooks. Day-1 unblocker without a human in the loop.

Docs-only. Tests unchanged.

---

## 2026-05-14 — Retry logic for failed reminder sends

Closes TODO Phase 5 Ops "Retry logic for failed sends." Pre-fix, `reminderScheduler.ts` flipped any failure to `status='failed'` — a transient Twilio 5xx lost the reminder permanently. Now bounded retries with backoff.

**Migration `20260514000000_reminder_retry_columns.sql`:** adds `retry_count INT DEFAULT 0` + `next_retry_at TIMESTAMPTZ` to `reminder_schedules`, plus partial index on `(scheduled_for, next_retry_at) WHERE status='scheduled'`.

**Policy module `src/services/reminders/retryPolicy.ts`** (pure, no DB/provider):
- `MAX_RETRIES = 3` (4 total attempts), `BACKOFF_MIN = [5, 30, 120]` minutes.
- `isRetryable(err)` — false for 4xx (re-send is broken), true for 5xx/no-status (conservative).
- `nextRetryAt(count, now?)` — timestamp for next try or null when budget exhausted.
- `decideRetry(err, count, now?)` — composition; returns `{action: 'retry', nextRetryCount, nextRetryAt}` or `{action: 'fail', reason}`.

**Worker rewrite (`reminderScheduler.ts` catch block):** error → `decideRetry` → either `UPDATE … status='scheduled', retry_count=N+1, next_retry_at=…` or `UPDATE … status='failed', error='msg (reason: max_retries_exceeded)'`. The 4xx vs max-retries distinction is logged for operator diagnostics.

**Pickup query change (`database/index.ts:getDueReminders`):** added `AND (next_retry_at IS NULL OR next_retry_at <= NOW())`. NULL branch preserves back-compat for never-failed and pre-migration rows.

**Tests added:**
- `retryPolicy.test.ts` (13 unit): `isRetryable` (4xx/5xx/network/no-status/3xx-6xx edges); `nextRetryAt` (each slot + exhausted); `decideRetry` composition; `BACKOFF_MIN.length === MAX_RETRIES` invariant.
- `reminder-retry-worker.test.ts` (7 real-DB): schema introspection of new columns; pickup query across the 3 next_retry_at states; end-to-end for 5xx-retry / 4xx-fail / 5xx-at-MAX.

Backend 1,873 → 1,893. Migration count 121 → 122. **Outstanding for prod:** migration `20260514000000` joins 35 pending. Worker code is backward-compatible (reads `retry_count ?? 0`).

---

## 2026-05-12 → 2026-05-13 — PK naming convention conversion sprint (28 pilots, 26 migrations)

**The full domain entity + leaf-table surface of `public` was migrated to the `<table_singular>_id` PK convention** (ratified in CLAUDE.md 2026-05-11). Verification query `SELECT … WHERE column_name = 'id'` against `information_schema` returns zero rows. JOIN symmetry payoff: `appointments.customer_id = customers.customer_id` is now `USING (customer_id)`-friendly across all 20+ inbound FKs.

### Pilots

| # | Migration | Table | Notes |
|---|---|---|---|
| 1+2 | `20260512000000`/`000001` | `record_versions`, `tenant_skills` | Set the recipe template. `record_versions` had 2 RPCs (`create_record_version`, `get_record_history`) + 1 view (`recent_record_changes`) recreated. |
| 3 | `20260512000002` | `reminder_schedules` | First SERIAL-PK pilot — convention works on integers. |
| 4 | `20260512000003` | `consent_records` | SERIAL. |
| 5 | `20260512000004` | `opt_out_records` | SERIAL. |
| 6 | `20260512000005` | `voice_sessions` | `start_voice_session` RPC's `RETURNING id INTO …` recreated. |
| 7+8 | `20260512000006` | `tenant_docs`, `tenant_integration_settings` | No-inbound-FK config tables. `tenant_calendar_settings` deferred (composite PK, no surrogate to rename). |
| 9 | `20260512000007` | `users` | Auth + JWT payload + polymorphic `book_appointment_atomic` assignment lookup. |
| 10 | `20260512000008`-`10` | `services` | `book_appointment_atomic` + `check_coverage_gaps` recreated. **Surfaced `auto_version_trigger` `OLD.id`/`NEW.id` hardcoding** — broken for voice_sessions since pilot 6, surfaced broadly here. Trigger rewritten as `CASE TG_TABLE_NAME`. Migration `…000010` restored `SECURITY DEFINER` + cascade-delete guard the first rewrite dropped. |
| 11 | `20260512000011` | `resources` | 3 RPCs recreated. **Surfaced second trigger bug** — `fn_audit_trigger` (separate trigger from `auto_version_trigger`) had same hardcoded refs. Same `CASE` fix. |
| 12 | `20260512000012` | `employees` | 4 RPCs recreated, plus a 5th (`check_availability_with_tz`) caught only when night-shift tests went red. Backend keeps `employee_id::text AS id` alias on GET /employees so polymorphic employees+users UNION stays intact. |
| 13 | `20260512000013` | `employee_schedule` | 2 RPCs (`get_effective_shifts`, `get_effective_shifts_bulk`). |
| 14 | `20260512000014` | `appointments` | Largest blast-radius. 4 RPCs recreated with **`RETURNING appointments.appointment_id INTO …`** (table-qualified — plpgsql raises ambiguous-reference otherwise against the RPC's `RETURNS TABLE(appointment_id, …)` OUT param). Both audit/version triggers extended. 19 backend tests + 14 dashboard files swept. |
| 15 | `20260512000015` | `customers` | 4 RPCs recreated; JSONB `'id'` output keys preserved as agent contracts. 18 test files swept. |
| 16 | `20260512000016` | `tenants` | Sprint promise — `tenants.tenant_id = <other>.tenant_id` works as `USING (tenant_id)` for every inbound FK. Both trigger cascade-guards updated. **Surfaced + fixed two more triggers**: `notify_n8n_on_appointment` (stale `NEW.id` from pilot-14 residue) and `create_default_resources` (`NEW.id` referencing the renamed-away column — caught when tenant inserts started failing). |
| 17 | `20260512000017` | `user_feedback` | **Surfaced + fixed stale JOINs** in `analytics.ts` from pilots 9 + 16 residue. |
| 18 | `20260512000018` | `soft_reservations` | Pure rename. |
| 19 | `20260512000019` | `audit_log` | Destination of `fn_audit_trigger`; trigger uses explicit columns so no update needed. |
| 20 | `20260512000020` | `unanswered_questions` | Route GET keeps `unanswered_question_id AS id` for API shape compat. |
| 21 | `20260512000021` | `phone_verifications` | `/verify-phone-code` keeps backward-compat alias. |
| 22 | `20260512000022` | `password_resets` | **Surfaced two more latent bugs** from pilot 9 residue: `/users/invite` had `RETURNING id` against renamed `users` (mocked test hid it); e2e teardown had stale `DELETE FROM users WHERE id`. |
| 23 | `20260512000023` | `call_transcripts` | `link_orphaned_transcripts()` recreated. |
| 24 | `20260512000024` | `call_summaries` | Pure rename. |
| 25 | `20260512000025` | `entity_sync_map` | Largest surface (20 backend files), zero PK references. **Surfaced 3 latent bugs**: `syncMapHelpers.ts:325+371` had stale `UPDATE customers … WHERE id` (would break every CRM pull-merge); `jobberSync.ts:303` had stale `RETURNING id` (would break every Jobber-sourced appointment create). |
| 26 | code-residue sweep | — | ~50 stale `WHERE id`/`RETURNING id`/`JOIN ….id` refs across 12 Playwright spec files (e2e not in unit-CI gate). Multi-line SQL templates that escaped per-pilot one-liners. Plus stale `SELECT id, …` projections in `database/index.ts:343`, `tenants.ts` GET config, `provisioning/activate`, `billing.ts` checkout, `reminders.ts /cancel`. |
| 27 | test-mock alignment | — | 8 test-mock alignments (`{id: …}` → `{<table>_id: …}`) — **plus 1 real production bug**: `agentTools.ts /service-catalog` had bare `SELECT id, name … FROM services`; would have errored at runtime on every LLM service-catalog tool call. Aliased to `service_id AS id`. |
| 28 | real-DB coverage | — | New `src/pk-rename-coverage.test.ts` (626 lines, 30 tests). Every renamed PK exercised by name against real Postgres. INSERT returns the column; SELECT/UPDATE/DELETE bind on it. A future regression to bare `id` now fails loudly instead of passing on mocks. Backend 1,781 → 1,860. |

### Trigger evolution

Both `auto_version_trigger` (fires on customers/appointments/employees/services/resources/voice_sessions) and `fn_audit_trigger` (appointments/customers/resources) now `CASE TG_TABLE_NAME` to map each table to its renamed PK column. With every domain entity renamed, cascade-delete guards reference `tenants.tenant_id` directly. The `CASE` is load-bearing because the triggers fire polymorphically.

### Same-day follow-ups (2026-05-13)

- **Two live-traffic bugs** surfaced after super-admin login: (1) `scripts/start-all.sh` only rebuilt backend, not dashboard — bundled-pre-rename `TenantCard.tsx` read `tenant.id` against `/tenants` response now returning `tenant_id`; React error boundary fired. Fix: added `cd dashboard && npm run build` to start-all. (2) Backend 500'd on `tenant_id=undefined` (literal string) — dashboard fired requests before `useActiveTenantId()` resolved, literal "undefined" flowed to Postgres UUID parser → 22P02 → 500. Fix: UUID-format gate in `tenantMiddleware`, returns 400 with the offending value echoed. +5 isolation probes pin the gate.
- **`scripts/rebuild-db.sh` + `npm run db:rebuild`** built as the from-scratch validation path: drops schema, re-applies 120 migrations, seeds. Three safety gates (host allowlist, `--force` for remote, `--yes` for non-interactive). Deleted `scripts/reset-and-seed.sh` — its TRUNCATE list referenced the dropped `employee_shifts` table and bare `id` columns.
- **`deleted_customers` view recreated** under the convention (`20260513000003`) — was the last `AS id` alias in the schema after pilot 15 auto-rewrote its body.
- **Pilot 4 deferred FK closed**: `opt_out_records.original_consent_id` → `original_consent_record_id` (`20260513000002`). All 45 FKs in the schema now align with their target PK or use role-prefixed `_<table>_id` suffix.
- **E2E watchdog migration**: all 20 specs migrated from `@playwright/test` to wrapped `dashboard/e2e/helpers/test.ts` that catches silent JS errors / error-boundary renders. Caught zero new regressions — every page surface is genuinely clean.
- **E2E triage** found 4 more PK-rename gaps in spec files + **a real production RPC bug**: `soft_delete_record()` and `restore_deleted_record()` built dynamic SQL with hardcoded `WHERE id = $1`. Sweep audit missed them because the column ref is inside `format(…)`. Migration `20260513000004` rewrites both to look up the PK column from `information_schema` — self-healing for any future rename. Plus 8 focused probes for thinly-covered tables (`password_resets`, `unanswered_questions`, `tenant_docs`, `tenant_skills`) so a regression on any fails in a test named for the table.

### After-state

Backend 1,781 → 1,868; dashboard 620 → 631; agent 85 unchanged. Zero TS errors. Drift detector clean. Migration count 90 → 121.

### Outstanding (decision-pending)

- `tenant_calendar_settings` + `appointment_sync_map`: 1:1 extension tables that reuse parent PK. Strict rule says add surrogate `*_id` UUID; practical rule says they're indistinguishable from junction tables and the FK column already uniquely identifies. Worth one decision rather than two ALTERs.
- All 26 PK-rename migrations + `20260511000000_employees_services_tenant_fk_cascade.sql` are **forward-only** and must land in order on production Supabase.

---

## 2026-05-11 — E2E coverage sprint: 5 P1/P2 items + real schema bug

Seven commits closing the largest single-session block of E2E coverage to date — and surfacing a real data-integrity bug.

- `1fb8b11` — **`/appointments/:id/reactivate`** (canceled → scheduled). Returns 409 + `TIMESLOT_OCCUPIED` + conflict block when slot rebooked while canceled; 400 `NOT_CANCELED` on duplicate. Dashboard wires from customer-history rows (the only UI surface where canceled rows are reachable). +5 backend + 3 dashboard + 3 E2E (`appointment-cancel-restore.spec.ts`).
- `492b4cf` — **Scheduler real-time refresh after Quick Book** — pins `handleQuickBooked → refresh → setAppointments → render` without page reload. +1 E2E.
- `04a96b4` — Stabilized 2 latent flakes: weekday-only seed customer check (was failing on weekends); `quick-book-shift-overrides` used `today` for booking date + broken `/shifts/overrides` URL hitting dashboard catch-all instead of backend.
- `07103cc` — **Mobile-responsive E2E** (iPhone 14 + Pixel 7 viewports via `page.setViewportSize`). Three daily-use flows audited; no regressions.
- `ae7dd12` — **Schema bug**: `employees.tenant_id` + `services.tenant_id` were `NOT NULL UUID` but missing the `REFERENCES tenants(id) ON DELETE CASCADE` constraint (other tenant-scoped tables had it; a later column-rename appears to have dropped it). Local DB had 77 orphan employees + 8 orphan services. Migration `20260511000000_employees_services_tenant_fk_cascade.sql`: delete orphans → add FK CASCADE. Pre-fix, tenant offboarding silently leaked rows — GDPR posture issue at beta scale. **Production Supabase still needs this applied.** Plus `tenant-delete-cascade.spec.ts` (3 tests).
- `f43e535` — **`/restore` round-trip E2E** (3 tests): happy soft-delete → restore on customers; sad `RECORD_NOT_DELETED`; sad `INVALID_TABLE` whitelist (pins SQL-injection defense on the route's inlined table name).

Backend 1,770 → 1,775; dashboard 617 → 620; agent 85; E2E 55 → 69.

---

## 2026-05-09 — Booking-RPC granular errors restored + 12 pre-existing failures closed

Migration `20260508000001`'s assignment-policy rewrite accidentally collapsed `NO_SKILLED_EMPLOYEE` / `EMPLOYEE_NOT_SCHEDULED` / `TIMESLOT_OCCUPIED` into a single `NO_AVAILABILITY` return — agent prompt's per-code messaging broke (callers heard "nothing's open" when the real issue was "no tech with that skill").

**Fix:** migration `20260509000002_restore_granular_booking_errors.sql` restores the four-code diagnostic block from `20260401000001`, updated to read `employee_schedule` (the `employee_shifts` table the original used was dropped 2026-04-30). Keeps the 2026-05-08 fewest-skills + least-busy + random assignment policy.

**Side fixes:**
- 2 tests needed `DELETE FROM resources` after `createTenant` (auto-shop + salon templates seed resources via trigger; new `random()` tiebreaker broke deterministic assertions).
- 3 `crm-appointments.test.ts` tests violated the new 15-min CHECK from `20260508000000` — switched to `date_trunc('hour', NOW() + …)`.
- 1 booking-concurrency test was `Promise.all` over 20 deadlocking transactions — GiST exclusion can deadlock under extreme load, one rolls back with `40P01`. Switched to `allSettled` + 30s timeout + row-count defense-in-depth. Data integrity preserved, error-code is best-effort under that load.

Backend 1,758 → 1,770 (was 1,758/1,770 with 12 failing earlier).

---

## 2026-05-09 — Security review pass 2 (RLS + JWT + AGENT_SECRET rotation)

Three sub-audits. New `docs/SECURITY.md` documents the as-shipped posture.

**RLS coverage gaps closed.** Three tables added since 2026-03 lacked FORCE (or RLS at all):
1. `password_resets` (`20260422000000`) had **zero RLS** — short-lived recovery tokens at risk. Migration `20260509000000`: ENABLE + FORCE + policy allowing access only when `app.current_tenant_id` is empty (the `/forgot-password` + `/reset-password` unauthenticated flows). Authenticated tenant sessions get no access.
2. `voice_sessions` (`20260409000000`) had RLS + policy but lacked FORCE. Holds call_id + transcript + outcome.
3. `record_versions` (same date) same shape. Stores soft-delete + version-history rows.

Migration `20260509000001_force_rls_voice_sessions_record_versions.sql` applies FORCE. Probe 6 in `multi-tenant-isolation.test.ts` (4 tests on `pg_class.relrowsecurity` / `relforcerowsecurity` + `pg_policies` row + positive-control INSERT/SELECT under empty context). Local test postgres is SUPERUSER+BYPASSRLS so behavioral cross-tenant probes are meaningless locally; metadata probes catch future migrations that drop RLS.

**JWT/refresh.** No fixes — current shape is robust: 8h stateless tokens, sliding `/auth/refresh`, every request looks up `users.password_changed_at` and rejects tokens with `iat < password_changed_at` epoch (password rotation IS revocation). Documented gaps: no admin "lock account" UI (workaround: SQL `UPDATE password_changed_at = NOW()`), no per-token denylist (acceptable for stateless at this scale).

**AGENT_SECRET timing-safe + rotation.** Was plain `!==` — timing oracle in principle. Switched to `crypto.timingSafeEqual` with length-mismatch guard. Added `AGENT_SECRET_OLD` for hot rotation: backend accepts either during transition. 3 new auth tests.

Backend 1,763 → 1,770 (+7).

---

## 2026-05-09 — Security review pass 1 (webhook signatures + CRM HMAC bug)

**Finding 1 — Stripe webhook contract had zero tests.** Route correctly used `stripe.webhooks.constructEvent` against raw body, but a refactor that reordered or replaced it would slip past. New `src/webhook-signatures.test.ts` adds 3 contract tests using `Stripe.webhooks.generateTestHeaderString` (real signature math, not stubbed): missing-sig → 400 no DB activity, invalid-sig → 400 logged, valid-sig → 200 with handler running.

**Finding 2 — HubSpot/Square/Jobber webhooks had broken HMAC.** All three did `const rawBody = JSON.stringify(req.body)` and passed that into `verifyWebhookSignature`. Re-serializing through V8 doesn't byte-match (whitespace/order/escapes differ) — providers sign exact bytes they sent. Production-impact contained because no real CRM is wired today, but would have surfaced on the first real webhook. Fixed all three to use `req.rawBody` (already preserved globally). New tests pin contract per provider: bad-sig → 401, valid → 200, HubSpot replay-protection on timestamp-freshness, Jobber no-active-integration → 404 short-circuit.

`buildRouteTestApp` updated to mirror prod's content-type parser so `req.rawBody` is available in tests.

Backend 1,752 → 1,763 (+11).

---

## 2026-05-09 — Booking enforcement chain closed (5 sub-slices)

Backend 1,733 → 1,747 (+14). Agent 81 → 85 (+4). Six TODO entries closed under `Booking enforcement hardening`. Only `pre-flight tool fallback` remains (deferred: "only ship if beta data shows the prompt rule is unreliable").

- **Slice 1 — backend conflict-details on overlap.** Wired `findOverlappingAppointment` + `isOverlapError` into `/agent-tools/book-appointment`: on `"already booked"`, runs lookup in same txn and returns `{success: false, error_code: 'TIMESLOT_OCCUPIED', conflict}` at 200. Non-overlap errors keep plain `{success: false, error}` shape. +7 conflictLookup tests (4 geometries × 2 flavors), +2 agentTools tests.
- **Slice 1.5 — 15-min increment.** Refactored `validateAppointmentTimeRange` to return `{error, code}` with stable `AppointmentValidationCode` union. Threaded through `/appointments/create`, `/appointments/:id/update`, `/agent-tools/book-appointment`. +1 unparseable-date test, +3 route tests, +2 agent tests.
- **Slice 2 — dashboard conflict modal + 15-min picker.** Audit-only — already shipped. Spec said "dropdown of options", impl uses `step="900"` (browser snap + `reportValidity()`) — functionally equivalent.
- **Slice 3 — E2E with self-contained data.** New `helpers/fixtures.ts` exports `registerFreshTenant()`, `seedBookingScenario()`, `seedAppointment()`, `bookAppointmentAs()`, `updateAppointmentAs()`, `cleanTenantData()`. Refactored `booking-enforcement.spec.ts` tests 1-4 + 7 to drop the DynaTire seed dependency. API tests went from ~4.8s (Page-mediated) to ~100-460ms each.
- **AI prevention prompt-only.** Tightened `agent/src/prompt.ts` "Availability discipline": "hard rule, not a guideline"; 15-min spoken grid (":00, :15, :30, :45 — never :07"); take-a-message escalation when alternatives exhausted; `check_availability` added as third gate entry-point. +4 prompt-content tests. LLM-in-loop conversation harness deferred to `qa-live-test.py`.

---

## 2026-05-08 — Sessions (5 entries)

**Quick-book e2e deflake.** Two compounding bugs: (1) test booked +35 days but seed only extended ~12 days → `EMPLOYEE_NOT_SCHEDULED`. (2) `setHours(9,15)` sets local; `toISOString()` returns UTC; `<input type="datetime-local">` interprets as local again → hour 9 local → "T13:00Z" → form reads 13:00 local on UTC machine but 18:00 on CDT → outside Mike's shift. Fix: walk +3 days skipping weekend; build datetime-local from local Y/M/D + HH:mm directly (no toISOString round-trip); narrowed random range to 10-14 local.

**Observability slice 2 — Prometheus metrics.** Backend 1,719 → 1,733 (+14 registry tests). New `src/services/metrics.ts`: counter + histogram, Prometheus text format, no external deps, cardinality cap 1000 series (overflow → `overflow="true"`). Six pre-declared metrics: `http_requests_total{route,method,status}` (rolled to 2xx/4xx/5xx; uses `req.routerPath`), `http_request_duration_ms` histogram, `booking_attempts_total{outcome,source}` (8 outcomes × api/agent), `tool_calls_total{tool,outcome}`, `sync_dispatches_total{provider,entity,action}`, `errors_total{event}`. Auto HTTP via Fastify `onResponse` (skips `/health` + `/metrics`). Domain counters wired at `/appointments/create`, agent booking routes (via `toolRoute` wrapper using `_toolOutcome` marker), `syncOrchestrator`, `logError()`. `GET /metrics` gated by `METRICS_TOKEN`: 404 unset (no public leak), 401 wrong, 200 text/plain.

**Calendar + CRM sync E2E (last beta-blocker P1).** Backend 1,712 → 1,719. E2E 52 → 58. New `SYNC_TEST_RECORDER=1` test-only ring buffer (cap 500) in `syncOrchestrator.ts`; `record()` is no-op outside test mode, runs synchronously inside dispatch loop before provider promises fire (reflects intent-to-dispatch). New `/agent-tools/_test/sync-events` route (GET reads, DELETE clears) gated by env var AND agent-secret hook. `calendar-sync.spec.ts` (6 tests): each appointment lifecycle event dispatches all 5 providers; each customer event dispatches the 4 CRMs (no calendar — by contract); fire-and-forget returns <3s with 5 promises in flight. Logs in as `admin@dynatire.com` (DELETE/PUT routes read tenant_id from JWT only, no super-admin override). Each test creates own data in try/clean in finally. +7 unit tests pin recorder semantics.

**7 prod migrations applied (3 silently overdue).** Initial intent: apply `20260505000000_user_roles.sql` only (Logins UI was missing the column in prod). `setup-db.sh` run picked up other pending work; **surprise: `20260430000000` + `…000001` + `…000002` had not been prod-applied** despite docs claiming 8 days prior. Prod was running `check_coverage_gaps()` + `check_availability_with_tz()` RPCs still referencing the dropped `shift_overrides` table; `employee_shifts` legacy table still alive. No traffic hit them so it went unnoticed. All 7 applied cleanly via `--single-transaction` with `ON_ERROR_STOP=1`. Pre-flight scanned for overlapping appointments (GiST exclusion pair `20260501000000` + `…000001`) — 0 conflicts. New `scripts/preflight-booking-overlap.sql` + `scripts/audit-test-data.sql` (re-runnable 8-section sweep) added.

**Customer-create as separate transaction.** Pre-fix, `/agent-tools/book-with-scheduling` did customer get-or-create INSIDE `book_with_scheduling_atomic`'s plpgsql — row persistence on RPC failure was a side-effect of auto-commit. A future `BEGIN/COMMIT` wrap would silently roll back the customer on every booking failure. Fix: new `src/services/customerLookup.ts` with `getOrCreateCustomerByPhone(withTenantClient, tenantId, phone, name)`. Each call acquires its own pool client → auto-committed → releases, so the write is structurally a separate transaction. Both booking routes now call helper before RPC in distinct `withTenantClient` blocks. RPC bodies untouched (still support inline-create for any future direct caller). +4 helper tests, +3 persistence regressions in `agentTools.test.ts`, 3 existing tests updated with new fixture shape.

---

## 2026-05-07 — Front-desk audit punch list (13 pieces, all shipped)

Audit doc: `docs/sessions/2026-05-07-front-desk-audit.md`. Found 3 of 4 daily front-desk tasks failed the ≤3-decision threshold. Headline finding: two parallel schedulers on Schedule tab (`AppointmentView` calendar default, `NewSchedulerView` staff sub-tab), with Quick Book — the only sane create flow — appearing only on Resources/List.

**Punch list:**

| # | Item | Decision-count delta |
|---|---|---|
| 1 | Quick Book hoisted to Schedule toolbar (visible on all sub-tabs). Consolidated `SchedulerView` returns; `QuickBookPanel`/`EmployeeDayFocusPanel`/`AppointmentPopover` now render at outer level. +3 trigger tests. | 8+ → 5 |
| 2 | **Mark off today** on `StaffProfileCard` — closes biggest functional gap (front-desk role literally could not mark someone unavailable; off-day affordance lived only in owner-only Staff & Shifts). Optional `onMarkOff`/`markOffLabel`/`isMarkingOff` props; parent owns confirm + API + toast + refresh. Label adapts ("Mark off today" vs "Mark off Mon, May 11"). +6 card + 6 wiring tests. | ∞ → 3 |
| 3 | **Searchable customer combobox** — extracted `dashboard/components/ui/CustomerCombobox.tsx` (search input + filtered native `<select>`, name + phone-substring filter, no-name/no-phone fallbacks). Replaces 50+-item `<select>` in `AppointmentDetailPanel`. Both surfaces now consume one component. AppointmentDetailPanel's address pre-fill side effect preserved at parent. +11 unit tests. | Hick's Law gone |
| 4 | **Empty-cell click → Quick Book prefilled.** Staff sub-tab cells get `role=button` + `aria-label` + tabIndex + cursor only when row's employee has a shift covering that hour. Out-of-shift cells stay passive (booking would land `EMPLOYEE_NOT_SCHEDULED` — invitation to guaranteed failure). Calendar sub-tab: optional `onSelectSlot` prop wires BigCalendar `selectable=true`. +10 contract tests including per-employee gate. | One click |
| 5 | Default Schedule sub-tab flipped Calendar → Staff. Subtitle copy reworked (was "Start with the calendar. Switch to staff or resources only when you need detail" — contradicted the flip). | Friction removed |
| 6 | Yesterday \| Today \| Tomorrow chips on `SchedulerDateNav`. WCAG 2.5.5 min `48×48px`, `aria-pressed` reflects state. Outside today±1 all un-pressed. ChevronLeft/Right preserved for further dates. +5 tests. | 3 → 1 |

**Other landings same day:**

- **Cross-view Edit + Cancel** (+ soft-cancel switch). Pre-fix `AppointmentDetailPanel` rendered only inside `<AppointmentView />`; popover on Resources/List/Staff was read-only. Plus the existing "Cancel" button was wired to hard-DELETE — stale re-click returned 404. `AppointmentPopover` gains optional `onEdit`/`onCancel`; `SchedulerView` wires them (Edit switches to Calendar sub-tab + pre-selects via new `initialEditAppointmentId` prop; Cancel calls `Api.appointments.cancel`). `AppointmentView.handleDelete` switched from `delete` to `cancel`. Soft-cancel preserves row + audit trail; backend drops slot from calendars + CRMs. +5 popover tests.
- **Booking alignment slice 2 — backend enforcement.** Pre-fix, curl/Postman could bypass UI alignment because `book_appointment_atomic` checked `services.required_skills` text array against `employees.skills`; seed populates `service_employee` mapping but not arrays → array check passed everything. Migration `20260507000000`: `appointments.service_id UUID FK ON DELETE SET NULL` + index. RPC updated: when `p_service_id` provided, prefer `service_employee` mapping when populated, fall back to array only when empty; same for `service_resource`. Schema: `AppointmentCreateSchema.service_id` optional. Dashboard: `QuickBookPanel` + `AppointmentView` thread it through. Backward-compat: callers omitting `service_id` get unchanged behavior. +6 real-DB tests. Backend 1,653 → 1,659.
- **Booking alignment slice 1 — dashboard dropdown filtering.** New `dashboard/lib/availability.ts` + `useServiceMappings(tenantId)` hook. Both `QuickBookPanel` and `AppointmentDetailPanel` filter Tech + Bay dropdowns when a service is picked; stale selection auto-clears. Zero qualified options → inline `role=status` block ("No Tech is configured…") + button disabled. Open services (no `service_employee` rows) keep all options. +8 availability tests + 5 panel tests.
- **Coverage gap detection backend↔UI consistency.** Surfaced a bug while writing the test: both wizard review components derived the badge from `coverage_pct`, and the RPC returns `100.0` for divide-by-zero — a zero-employee tenant saw green "Full Coverage / You're ready to go!" Fix: extracted `dashboard/lib/coverage.ts` with `statusToBadge(status)` + `isAllCovered(rows)`. Both wizards now derive from backend's 5-state `status` field. 9 edge cases pinned.
- **E2E coverage for booking alignment.** Closed the user's question "does E2E verify booking with people + resources + skills + availability + time alignment?" New `booking-alignment.spec.ts` (4 tests): UI alignment filter (Balancing → only Mike + Unassigned), RPC enforcement (Balancing + Carlos → 400 + zero rows), cross-view popover Cancel from List sub-tab (asserts soft-cancel + row preserved), cancel-frees-slot (book A → cancel → book B at same resource+time succeeds).
- **Observability slice 1 — structured-log aggregation.** Picked Better Stack (free 1 GB / 3 days). Backend `src/services/logger.ts`: Pino factory, stdout always; when `BETTER_STACK_TOKEN` set, forwards via `@logtail/pino` worker-thread transport. Agent `agent/src/logger.ts` mirrors with singleton cache. Both tag every line with `service` + `env`. Per-call agent child logger adds `tenant_id` + `call_id` + `caller_phone` + `room` after `sessionCtx` resolves. Lifecycle events: `call_start`, `session_context_resolved`, `tenant_config_fetched`, `session_started`, `fallback_triggered` (reason: `dispatch_metadata_invalid` / `session_context_lost`). Worker-thread transport means token-side outages never block main thread. +13 tests (7 backend + 6 agent) pin token-absent fallback (most important — missing token must never crash boot).
- **Removed unused Jest from devDependencies** (`7658fc5`). Audit confirmed Vitest 4.0.18 across all three workspaces; zero Jest API calls. Dropped `jest` + `@types/jest`; shrank `package-lock.json` by 4,384 lines.

**Standing-authorization rule activated.** User granted blanket commit+push authority conditional on four objective gates (docs updated / 5W tests / tests pass / coverage good). Encoded in `feedback_per_commit_approval.md` + `~/.claude/skills/commit-code/SKILL.md`.

---

## 2026-05-06 — Multi-tenant isolation audit + CI rot + skill-resource sweep

**`3a72f0d` — Multi-tenant isolation probe.** Built `src/multi-tenant-isolation.test.ts` (25 tests across 5 probe categories: query-string override, cross-tenant id under JWT-only, body-tenant_id FK injection, positive controls, admin-only `/tenants/*` gating). Two findings, both closed:
- **Finding 1 — application-layer cross-tenant override (read + write).** `tenantMiddleware` precedence (`query > body > JWT`) had no auth gate; any non-admin could pass `?tenant_id=<other>` or POST `body.tenant_id=<other>`. 12 of 21 initial probes failed (8 read-leak + 4 write-injection). Closed by 403 gate in `tenantMiddleware` unless caller is super-admin; mismatched query-vs-body returns 400.
- **Finding 2 — `/tenants/*` admin routes had no super-admin gate.** Every route used `requireAuth()` only. Any tenant user could `GET /tenants` (enumerate every customer), `DELETE /tenants/<other>`, `POST /tenants/reorder`. Added `requireSuperAdmin()` helper; `GET /tenants/:id/config` + `POST .../update-config` get "super-admin OR own-tenant" gate. **Fallout:** `tenant-routes.test.ts` `authStub` used camelCase `tenantId` while production JWT is snake_case — gate exposed the mismatch via undefined `req.auth.tenant_id`. Fixed stub. +10 middleware tests.

Severity: pre-beta no customer data at risk, but would have been critical breach in a paying-tenant SaaS.

**CI rot recurrence — 3 days red on main.** Three independent root causes, all fixed in one commit:
- CI postgres image was vanilla `postgres:16`; first migration calls `CREATE EXTENSION vector` and silently failed. Switched to `ankane/pgvector:v0.5.1` matching local Docker.
- `scripts/setup-db.sh` swallowed migration errors: `OUTPUT=$(psql … 2>&1); RC=$?` looks like it captures exit code, but `set -e` exits on the `OUTPUT=…` failure before `RC=$?` runs. 3 days showed `exit 3` with no message. Wrapped psql call with `set +e` / `set -e`.
- `dashboard/tsconfig.json` had `"types": ["vitest", "jest"]` at JSON root instead of inside `compilerOptions`. TypeScript silently ignored. Worked locally because `tsc` auto-discovers `node_modules/@types/*`; fresh CI installs didn't. Moved into `compilerOptions`, switched to `["vitest/globals", "@testing-library/jest-dom/vitest"]`.

**Skill-resource matching sweep** (`src/skill-resource-matching-sweep.test.ts`, 13 tests, 5W-annotated). Closes "Skill + resource matching reliability sweep — across all 5 industry templates." Three sections: per-industry HAPPY paths (5 templates including hyphenated `tire-mount`, empty capabilities, cross-axis joins); error-code matrix pinning all 5 codes; cross-template guards (tenant isolation under skill-name collision, exact-match-not-substring). Catches what prior tests don't: hyphenated names breaking under future regex changes; empty-capabilities vocabulary-colliding with no-skill ELSE branch; substring matching being introduced "for convenience".

`@vitest/coverage-v8` wired into `vitest.config.ts`. First baseline: lines 62.67%, branches 53.80%, functions 64.47%. Logic coverage strong (95%+ on auth/users/voice/agentTools/booking RPCs/CRM clients); route-handler coverage 5-50% (tests exercise RPC/service layer rather than going through `fastify.inject()`).

Backend 1,551 → 1,592 (+41 across the day).

---

## 2026-05-05 — Cleanup sweep (7 commits)

Backend 1,514 → 1,536 (+22). Dashboard 500 → 504 (+4). Skip count 0.

- **5W backfill** across `rls`, `schema`, `customer`, `tenant-reorder`, `critical-bugs` test suites (23 tests). Coverage: 64 → 70/90 files.
- **Backend test `any`-type cleanup.** Top-5 offenders (reminders, consentService, communications, middleware, bugfix-comprehensive) cleaned with `vi.mocked(…)` + `as unknown as Type` + proper Fastify/Pool imports. 215 → 129 instances (40% cleared).
- **Destructive-flow tests** (NEW): tenant DELETE (3), tenant POST /reorder (5 incl. `sort_order = 0..N-1` invariant + ROLLBACK on partial UPDATE failure + auth gates), shift override CRUD (9), AppointmentView mock-mode guards (2 verifying no `/update` POST or DELETE fetch when `usingMockData=true`).
- **NEEDS-REFACTORING #11 deferred-part verify-first.** Reusable pieces already extracted; remaining orchestration is component-specific.
- **Dashboard test `any`-type cleanup.** ~27 instances → 0 across `superadmin.test.tsx` + `settings.test.tsx`. New `dashboard/lib/test-utils.ts` exports typed `mockJsonResponse(body, init?)`. **Caught a real latent bug:** a `lastCall = .find(…)` deref of `T | undefined` that the prior `as any` cast had been hiding.
- **Vocabulary pass on UI strings.** 4 jargon strings replaced: "Multi-Tenant Management" → "Multi-Business Management", "Skill Matrix"/"Service Assignment Matrix" → "Service Assignments", "coverage gaps" → "aren't fully staffed yet". `vocabulary-guard.test.ts` extended with 4 banned-pattern regexes.
- **`disconnectCrmIntegration` helper.** 4 × 16-line handlers differing only in provider literal collapsed to `src/services/crmDisconnect.ts`. +5 tests. ~30 lines deduped.
- **Canonical `TenantFull` typing.** Three components (TenantCard, SuperAdminDashboard, TenantEditPanel) had local `type Tenant = {…}`. Migrated to shared `TenantFull`. Relaxed `Tenant.{voice_id, system_prompt, first_message}` to `string | null` (matches DB nullability).

---

## 2026-05-04 — Refactor marathon (8 commits, ~−800 lines net)

Backend 1,456 → 1,514 (+58, mostly new helper tests). Skip count 2 → 0. Pattern: extract-helper-then-migrate-callers, with verify-first redirecting two original framings.

- **`9b0a572` — UsageTrackingService deleted** (NEEDS-REFACTORING #3). In-memory stub with no DB persistence, no Stripe meter, no metered customer. Removed `src/services/usage/`, `src/types/usage.ts`, optional `usageTracker?` constructor param on `CommunicationService` + `SMSService`, `await trackSMS(...)` block.
- **`f4ac89a` — `paginateSync()` helper** (NEEDS-REFACTORING #10 narrow). 7 inline pagination loops across 4 CRM modules collapsed into `src/services/syncPaginate.ts`. Generic over item + cursor types (Jobber GraphQL `pageInfo`, HubSpot `paging.next.after`, Square `result.cursor`, ServiceTitan page-number `hasMore`). +9 tests including null-initial-cursor regression caught mid-refactor.
- **`c12d075` — CLAUDE.md drift detector** (NEEDS-REFACTORING #13). `scripts/verify-claude-md.ts` runs 5 checks (route count, migration count, template count, listed-directory existence, commit reachability from main). Wired into CI + `npm run verify:claude-md`. Numeric counts scope to current-state portion (skip Resolved archive); commit-reachability scans full doc. `<!-- verify-claude-md: unmerged -->` marker opts known-unreachable hashes out. +25 tests on pure check functions.
- **`24a2e47` — `improvement-ideas.md` pruned** (NEEDS-REFACTORING #12). 6 closed task blocks deleted; 1 ALREADY SHIPPED preserved as audit evidence. Preamble rewritten to declare file as generator output, not curated backlog. 2137 → 2089 lines.
- **`cdfd0b4` — Mock test helpers extracted** (~350 lines deduped). 13 test files duplicated `createMockClient` / `createMockPool` / `mockWithTenantClient`. New `src/services/test-utils-mock.ts` — always tracks queries, always bypasses `SET LOCAL`/`RESET` scaffolding, mock pool exposes both `connect()` and `query()`. +12 helper tests.
- **`647866a` — OAuth state JWT helpers** (~72 lines deduped). The shared code wasn't token refresh (Google SDK vs Outlook fetch differ) but **state JWT** — sign + verify duplicated across 6 files with only the `purpose` discriminator differing. New `src/services/oauthStateJwt.ts`. +10 tests covering round-trip, env-secret fallback, custom expiry, cross-provider replay defense.
- **`ed26cbc` — Tenant bootstrap doc cleanup.** Verify-first found `src/services/tenants/bootstrap.ts` was already shipped 2026-04-30; both call sites already consumed it; 9 unit tests already passed. Pure `docs/TODO.md` truth-up.
- **`f686672` — `get_effective_shifts` skips re-enabled.** Both `it.skip`'d tests in `src/shift-overrides-edge.test.ts` replaced with new tests under the `employee_schedule`-only contract: HAPPY multi-day range (5 weekday seeds, row order + content) + SAD rows outside range filtered out (3 seeds Mon/Wed/Fri, query Wed-only).

---

## 2026-05-03 — Voice fallback validation + tenant-config redo on main

**Voice fallback path** (queue #9). CLAUDE.md / ARCHITECTURE.md / NEEDS-REFACTORING #9 all claimed `runFallback()` used OpenAI TTS as guard against Grok outage, but actual code on main wired GrokTTS in BOTH paths — a Grok outage would leave fallback unable to speak.

- Extracted `runFallback()` to `agent/src/fallback.ts` with injectable provider deps.
- Switched fallback TTS to OpenAI (matches what docs claimed). Provider keys passed as `FallbackConfig` arg rather than imported — testable without going through env-validation `process.exit(1)`.
- Awaited `session.say()` so synthesis-time failure is caught inside try instead of escaping as unhandled rejection.
- +13 tests in `agent/src/fallback.test.ts`: happy path, interruption blocking, start-before-say ordering, VAD wiring; OpenAI-not-Grok contract (3 tests including negative); never-throw under each failure mode.

**Tenant-config wiring redone on main** (NEEDS-REFACTORING #2). Same investigation found commit `e92b3bf` <!-- verify-claude-md: unmerged --> claimed shipped 2026-05-01, actually lived on `hold-tenant-config` branch, never merged.

- New `POST /agent-tools/tenant-config` returns `{name, timezone}`; null tz → `'America/Chicago'`. +4 backend tests.
- New `agent/src/tenantConfig.ts` with `fetchTenantConfig(client, tenantId)` + `TENANT_FALLBACK` constant. Returns fallback on any non-success envelope. +6 agent tests.
- `agent/src/index.ts` now calls `await fetchTenantConfig(…)`; hardcoded DynaTire block deleted.

Backend 1,475 → 1,479. Agent 53 → 72.

---

## 2026-05-02 — Concurrency fix + structural refactors + test-or-delete

**Booking concurrency closed** (`55be6dc`). Race confirmed under READ COMMITTED with 20-caller load test: 9/20 winners on resource race, 20/20 on employee race. Find-then-insert could pass two `NOT EXISTS` checks before either committed. Closed by GiST exclusion constraints (`appointments_no_resource_overlap`, `appointments_no_employee_overlap`) scoped to scheduled non-deleted appointments + `exclusion_violation` handlers in both RPCs returning `TIMESLOT_OCCUPIED`. +2 real-DB race tests in `booking-concurrency.test.ts`. Migrations `20260501000000` + `20260501000001` shipped to repo, **not yet applied to prod** — pre-flight overlap-scan needed first.

**`src/index.ts` 385 → 279 lines** across three commits:
- `fbc1eaf` — JWT preHandler extracted to `src/middleware.ts:registerJwtAuthHook(app, pool)` (incl. `JWT_SECRET`/`JWT_EXPIRY`/`generateToken`/`verifyToken`/`PUBLIC_ROUTES` + password-rotation check).
- `9b78030` — DB pool config consolidated. `src/database/index.ts:getPool()` is canonical singleton with deadlock-prevention timeouts.
- `5077fd6` — `withTenantClient` factory moved to `src/database/index.ts:createWithTenantClient(pool)`.

**`src/services/crm/` deleted** (`2cc782a`, NEEDS-REFACTORING #1). 21 dormant adapters + `BaseCRMAdapter` + `createCRMAdapter()` factory + mocked-API test (3,480 lines). `dentrix.ts` + `eaglesoft.ts` were dental-practice CRMs violating HIPAA-excluded-vertical policy. Decision locked: **anything we can't test gets deleted; new CRMs wire up when a beta customer brings one.** Four working flat clients (jobber/hubspot/square/servicetitan) unaffected.

**Build Principles captured in CLAUDE.md** (`18181bc`): Test it or delete it. Build for real customers. Working flat code beats a dormant abstraction. HIPAA verticals permanently excluded. NEEDS-REFACTORING.md gained "Resolution lens" preamble.

**Other:**
- `c9f40c6` — `setup-db.sh` bootstrap bug (psql `-c` + stdin heredoc mutually exclusive).
- `6f91b7b` — OTP Phase 3 status truthed up (already shipped in `18caffe` on 2026-04-24).
- `c18c996` — Telnyx ticket re-submitted to LERG/porting team after `#2850682` went 4 days silent.
- `444dad1` — Last 3 pre-existing test files (`index.test.ts`, `normalizer.test.ts`, `scheduling.test.ts`) gained 5W annotations. 5W convention now universal.

State at session close: 1,475 backend + 498 dashboard = 1,973 passing + 2 documented skips, 0 failures.

---

## 2026-04-24 — UX review & polish batch (14 of 20 items shipped)

Commits `dac97cb`, `91c9903`, `7042a8e`, `3954d4c` + supporting `2f74991`. Deferred items need design input (admin-mode color, theme-selector placement, first-run nav callout) or bigger investment (skeleton screens, Remember-me refresh tokens).

**P0 trust fixes:** visible load-error banner + retry on `DashboardHome` (uses `Promise.allSettled`); login copy stripped of developer terminology; `ErrorBoundary` shows friendly message in prod, raw `Error.message` only when `NODE_ENV !== 'production'`.

**P1 affordances:** login create-account link, password show/hide, `autoComplete="username"`, label/input a11y; Today's Schedule empty-state CTAs; unanswered-questions badge bubbles to Back Office tab; Fitts's Law on Today's Schedule card; `aria-label` on icon-only buttons + `aria-expanded`/`aria-haspopup` on profile button; `ErrorBoundary` Reload escape hatch.

**P2 polish:** tenant switcher dropdown uses CSS vars (themes across all 8 palettes); quick-actions grid `md:grid-cols-2 lg:grid-cols-3`; "Setup Assistant" → "Services & Resources"; user-facing "tenant" → "business" in errors (`vocabulary-guard.test.ts` prevents regression).

**Backend hardening:** startup warnings extracted from `index.ts` to `src/services/envWarnings.ts` (pure function, +10 tests). Added `TELNYX_API_KEY` warning.

+50 dashboard tests, +10 backend tests.

---

## 2026-04-23 — Phone verification (SMS OTP)

- Table `phone_verifications` (tenant_id, phone, code_hash, expires_at, attempt_count, verified_at). RLS + FORCE. Migration `20260423000000`.
- `src/services/telnyxSms.ts` — Telnyx Messaging API wrapper + `generateVerificationCode(digits)` using `crypto.randomInt`.
- `POST /agent-tools/send-verification-code` (rate-limited 3/phone/hour, 100/tenant/day) + `POST /agent-tools/verify-phone-code` (5 tries, 10-min TTL, bcrypt-hashed).
- SMS body locked: `Your SecretaryHQ verification code is: 123456. Reply STOP to opt out.` (TCPA).
- Booking routes gate on `isValidPhone(args.phone)` — invalid → ask-for-phone message → OTP flow. Valid caller-ID skips.
- +12 agentTools tests, +7 telnyxSms tests, +3 booking-route gates.
- System prompt shipped in `18caffe` (2026-04-24) when `agent/src/prompt.ts` was created.

---

## 2026-04-12 — Improvement hardening

- Employee update route was missing `AND tenant_id` in WHERE — cross-tenant updates were possible. Fixed + `assertRowAffected` guard.
- Zero-row mutation guards added to employees / customers / appointments / tenants / knowledge / resources / services routes — all previously returned `{success: true}` on 0-row UPDATE/DELETE.
- Shared route helpers extracted to `src/routes/routeHelpers.ts`.
- `nameUtils.ts` extended with `slugify()` + `buildDisplayName()`.

---

## 2026-04-01 — Voice AI bug fixes + remaining bug fixes

- **BUG-059**: Timezone regression in `book_with_scheduling_atomic()` — hardcoded UTC. Migration `20260401000000`.
- **BUG-060**: Phone stored as `+1` (incomplete) — `normalizePhone()` rejects < 10 digits.
- **BUG-061**: Wrong date booked — Vapi assistant had stale hardcoded date, now dynamic.
- **BUG-062**: No employee assigned — AI wasn't passing `requiredEmployeeSkills`; prompt updated with service-to-skill mapping.
- **BUG-063**: Call hangs up on booking failure — added error handling to Vapi prompt.
- **BUG-064**: Generic error messages — specific codes (`TIMESLOT_OCCUPIED`/`NO_SKILLED_EMPLOYEE`/`EMPLOYEE_NOT_SCHEDULED`) via `20260401000001`.
- **BUG-030**: `link_orphaned_transcripts()` called automatically in `dispatcher.handleCallEnded()`.
- **BUG-031**: `checkAvailability()` uses `check_availability_with_tz()` RPC.
- **BUG-032**: n8n workflow generates embeddings (text-embedding-3-small) and stores in `call_summaries.embedding`.
- **BUG-038**: All edge function queries on soft-deletable tables filter `is_deleted`; `deleteEmployee()` uses soft delete.
- **BUG-039**: ARIA attributes added to Toast, Card, FeedbackButton, CoverageBar, OutlookLayout tabs.

---

## March 2026 — Full code review

58 bugs identified and resolved across Critical/High/Medium/Low. Highlights: `users.email` scoped to per-tenant (BUG-002); RLS standardized on `app.current_tenant_id` (BUG-006); dev bypass button removed (BUG-005); Fastify monolith broken into 20 route modules (BUG-017); scheduling logic consolidated into `shared/scheduling.ts` (BUG-016). Full detail in `docs/BUGS.md`.

---

## Phase 12 — Scheduler, Assignments & Coverage Visibility

- **12A** — Repeatable Setup Wizard: 7-step (Services, Resources, Employees, Shifts, Assignments, Review, Go Live), live coverage badges, phone activation.
- **12B** — Scheduler views: staff swimlanes (24hr, zoom), resource columns, appointment list, calendar sub-view. Quick Book panel, Employee Day Focus.
- **12C** — Skill Relationship Map: interactive 3-column mind map, click-to-connect/disconnect.
- **12D** — Coverage Visibility: `check_coverage_gaps()` RPC, coverage bars, status badges, `GET /coverage` endpoint.
- **12E** — RAG Normalization: `shared/normalizeForEmbedding.ts` (gpt-4o-mini), `normalized_text` column, query normalization in edge functions.
- **12F** — Stripe Lite: Solo ($129/mo) + Growth ($279/mo), Checkout, webhook (3 events), subscription gate middleware (402).

**Additional with Phase 12:** 8-theme system (light, dark, midnight, nord, sunset, forest, high-contrast, solarized); admin tenant reorder with drag-and-drop + save/discard (`sort_order` column, `POST /tenants/reorder`); type-to-confirm tenant deletion; `tenantsVersion` counter in SessionContext.

---

## Design Session — 2026-03-24

Full UI/UX session. Decisions in `docs/UI_UX_DESIGN.md`, `docs/DECISIONS.md`, `docs/DESIGN_HANDOFF.md`. Do not second-guess without explicit instruction.

**Work items (complete as of 2026-03-25):**
1. Dark sidebar visual style — all components use CSS vars.
2. Theme system rebuilt — `--font-display`/`--font-body` in all 8 themes, dropdown switcher.
3. Scheduler flipped — `NewSchedulerView`: rows=staff, cols=hours, 24hr, split-panel scroll sync, business-hours shading, zoom.
4. Staff quick profile card — read-only, anchored, outside-click dismiss, skills as indented vertical list.
5. Skills toggle — Hours mode / Skills mode (stacked skill-colored bars).
6. Drag to reorder staff rows — save/discard, persists per tenant.
7. Analytics rebuilt — 3 active (booking data), 3 Phase 2 placeholders (Vapi).
8. Coverage Map removed — `ServiceCoverageView.tsx` deleted.

**Locked decisions:**
- **Fonts:** Bebas Neue (`--font-display`) + DM Sans (`--font-body`). Universal. CSS variables only.
- **Coverage Map:** removed. `CoverageBar` + `CoverageStatusBadge` primitives retained (used by SetupWizard, SkillMap, ResourceColumns).
- **Analytics:** 6 metrics — 3 active from booking data (Busiest Hours, Return Rate, No-Show Pattern), 3 pending call log.
- **Logo:** "Secretary HQ" (space).
- **Philosophy:** We show data. They manage their business. No warnings, no grades, no opinions.
