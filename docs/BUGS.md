# Bugs & Issues

Found during full code review March 16, 2026; updated through April 21 for UX/a11y backlog.

**Summary:** 72 bugs tracked + 47 UX/a11y items. 71 FIXED, 2 NOT A BUG, 47 UX RESOLVED, 0 OPEN.

### April 9-10, 2026: UI/UX Audit (35 items, all resolved)

Full dashboard audit via code review: 7 Critical, 13 High, 15 Medium.

**Critical:** wizard step guards, toast system (dismissable, durations, max 5 stacked), `showToast` replaces silent catches in 4 components, `beforeunload` warning on dirty reorder, QuickBook + shift time validation, NaN guard on empty appointment times.

**High:** scheduler loading overlay, `ConfirmModal` + `useConfirm()` replaces all `confirm()` calls, calendar disconnect confirmation, empty states (scheduler, CRM search), TimeInput label + error prop, modal focus restoration fallback, keyboard accessibility (role/tabIndex on staff rows + appt list), mobile-responsive QuickBookPanel, StaffProfileCard Escape dismiss, Select arrow visibility in dark mode, VoiceCallsView CSS-var compliance, EmployeeDayFocusPanel shift calc (minutes ignored).

**Medium:** truncated name tooltips, business hours derived from shift data, tab state in URL (`?tab=`), loading spinner (was blank white), consistent appt status colors, CRM search empty state, dashboard "+X more" clickable, VoiceCallsView outcome filter + load count, mobile nav scrollable, skills row height capped, wizard auto-seed logging, Card/FolderTabs focus rings, "Staff & Shifts" clickable link.

### April 3-4, 2026: Architecture Review Fixes (BUG-065 → BUG-072)

| ID | Summary | Status |
|---|---|---|
| 065 | Booking RPC `shift_override is_off` bypass | FIXED migration `20260403000001` |
| 066 | `check_coverage_gaps()` ignored `employee_schedule` | FIXED migration `20260403000001` |
| 067 | Edge function hardcoded Central Time for all tenants | FIXED `dispatcher.ts` `applyTimezone` |
| 068 | RLS admin bypass policy too permissive on `employee_schedule` | FIXED migration `20260403000001` |
| 069 | No rate limiting on API | FIXED `@fastify/rate-limit`, 5 logins/5min |
| 070 | No security headers | FIXED `@fastify/helmet` |
| 071 | Night shifts (23:00-02:00) fail time comparison | FIXED migration `20260404000000` |
| 072 | Front Desk scheduler shift bars not rendering | OPEN — data confirmed in API, display issue in `NewSchedulerView`, debug log in place |

---

## Critical (Must fix before go-live)

### BUG-059: Timezone regression in `book_with_scheduling_atomic()` — VOICE AI BLOCKER
The March 24 RPC reintroduced BUG-001 by hardcoding `AT TIME ZONE 'UTC'` for shift validation. Friday 5pm Chicago → Saturday 12am UTC → wrong day_of_week. Voice AI couldn't book for non-UTC tenants.
**FIXED:** `supabase/migrations/20260401000000_fix_scheduling_timezone_bug.sql`, prod April 1; test `src/scheduling-timezone-bug.test.ts` (TDD).

### BUG-001: Shift timezone bug in `book_appointment_atomic()`
Used `AT TIME ZONE 'UTC'` for day-of-week extraction. America/Los_Angeles 9pm local → 5am UTC next day → wrong day_of_week.
**FIXED:** `20260316000000_fix_critical_bugs.sql`, tested `src/critical-bugs.test.ts`.

### BUG-002: `users.email` globally unique instead of per-tenant
`email TEXT UNIQUE` blocked two tenants from sharing an email (e.g., `admin@gmail.com`).
**FIXED:** changed to `UNIQUE(tenant_id, email)`, `20260316000000_fix_critical_bugs.sql`.

### BUG-003: Undefined `setDraftEvent` in AppointmentView
`setDraftEvent(null)` called without `useState` declaration — runtime crash on code path. **FIXED:** uncommented state declaration in `dashboard/components/AppointmentView.tsx`.

### BUG-004: Undefined `handleEditFormChange` in CRMView
Function called but never defined — crash on customer edit. **FIXED:** added `handleEditFormChange` in `dashboard/components/CRMView.tsx`.

### BUG-005: Dev bypass button in production
Button at `dashboard/app/page.tsx:94-101` allowed unauthenticated super-admin login. **FIXED:** removed.

### BUG-006: RLS context variable inconsistency
Mixed `app.current_tenant_id` vs `request.jwt.claim.tenant_id` across policies — silent filter failures.
**FIXED:** standardized on `app.current_tenant_id`; JWT-based policies removed. `20260316000000_fix_critical_bugs.sql`.

---

## High

### BUG-007: Fastify backend had no RLS enforcement
Queries used direct pg connection without `set_tenant_context()`. Tenant isolation depended on client passing correct `tenant_id`.
**FIXED:** added `apiPool` + `withTenantClient()` helper; critical routes (customers, appointments) use RLS-enforced pool.

### BUG-008: `api_user` role had ALL PRIVILEGES
Single RLS misconfiguration would have exposed all data. **FIXED:** explicit `GRANT SELECT, INSERT, UPDATE, DELETE` per table. `20260316100000_fix_high_bugs.sql`.

### BUG-009: Service requirements not enforced at booking
`book_appointment_atomic()` didn't check resource capabilities against `required_skills`/`required_resources`. **FIXED:** RPC validates resource capabilities + employee skills when `p_service_id` provided; tested in `src/high-bugs.test.ts`.

### BUG-010: No error boundaries in dashboard
Any unhandled exception crashed the whole app. **FIXED:** `dashboard/components/ErrorBoundary.tsx` wrapping all views.

### BUG-011: No form validation in dashboard
Forms accepted empty strings, negative prices, invalid emails. **FIXED:** Zod schemas (`LoginSchema`, `CustomerCreateSchema`, `AppointmentCreateSchema`) with server-side validation; tested.

### BUG-012: No token auth / session never expires
Plain localStorage, no JWT, no expiry, no 401 logout. **FIXED:** JWT (8h), `Authorization: Bearer` header, auto-logout on 401, tested.

### BUG-026: No error handling if `set_tenant_context()` fails
Silent failure → queries run without tenant isolation. **FIXED:** `withClient()` in edge function verifies context was set; logs + re-throws.

### BUG-027: Customer lookup/merge missing in booking flow
`book_appointment_atomic()` required `customer_id` with no phone→customer upsert — race-prone. **FIXED:** RPC now accepts `p_customer_phone` + `p_customer_name` with auto-upsert.

---

## Medium

### BUG-013: Soft reservations never cleaned up
`soft_reservations.expires_at` had no purge job. **FIXED:** `purge_expired_soft_reservations()` function + `/admin/purge-soft-reservations` endpoint.

### BUG-014: Polymorphic `p_assignment_id` had no error handling
Malformed input silently set assignment to NULL. **FIXED:** regex validation, errors on malformed input.

### BUG-015: Mixed ID types across tables (SERIAL vs UUID)
Services + employees used SERIAL; resources + users used UUID. **FIXED:** `20260316500000_id_standardization.sql` migrated services + employees to UUID; all FKs updated; old SERIAL columns dropped.

### BUG-016: Scheduling logic duplicated between Node and Deno
Diverged shift-checking implementations. **FIXED:** canonical impl in `shared/scheduling.ts`; edge function re-exports; old `src/core/scheduling.ts` removed. `book_with_scheduling_atomic()` SQL handles atomic path entirely in Postgres.

### BUG-017: Fastify `index.ts` was 800+ line monolith
**FIXED:** reduced to 319 lines (bootstrap only); 20 route modules under `src/routes/`; middleware in `src/middleware.ts`.

### BUG-018: BookingService class written but unused
**FIXED:** deleted in commit `86b2871`; logic handled by atomic RPCs called directly from routes.

### BUG-019: Provider pattern wired but never called
`TelephonyProvider`/`NotificationProvider`/`LlmProvider` instantiated but no endpoint used them. **FIXED:** deleted in `86b2871`.

### BUG-020: No pagination on list endpoints
**FIXED:** `limit` (default 200, max 1000) + `offset` on `/appointments` + `/customers`.

### BUG-021: Badge ignored `className` prop
**FIXED:** added `className` prop forwarding.

### BUG-022: `full_name` and `first_name`/`last_name` not in sync
**FIXED:** `trg_sync_user_names` + `trg_sync_customer_names` BEFORE UPDATE triggers. `20260316200000_fix_medium_bugs.sql`.

### BUG-023: Name splitting fails on 3+ word names
`split_part(name, ' ', 1)` → "Mary Jane Watson" became first:"Mary", last:"Jane". **FIXED:** sync triggers split first word only; "Mary" / "Jane Watson".

### BUG-024: `getEmbedding()` duplicated in two codebases
**FIXED:** canonical `shared/getEmbedding.ts` with `createGetEmbedding()` factory; both Node + Deno import from shared. (Minor: `scripts/ingest-knowledge.ts` retains inline copy — CLI tool only.)

### BUG-025: Silent mock data fallback in AppointmentView
**FIXED:** added "Showing sample data" warning banner when `usingMockData` is true.

### BUG-028: `InMemoryBookingStorage` had no conflict detection
Returned 60-min slot regardless of overlap. **FIXED:** `getNextAvailableSlot` + `createAppointment` check for resource overlap; throws on conflict.

### BUG-029: `WorkingHours` vs Shift day-of-week format mismatch
String keys (`"mon"`) vs numeric (0-6, 0=Sunday). **FIXED:** `dayStringToNum`/`dayNumToString`/`workingHoursToShifts`/`shiftsToWorkingHours` utilities in `src/core/models.ts`.

### BUG-030: `call_transcript.customer_id` nullable lost traceability
Orphaned transcripts on customer-lookup failure. **FIXED:** `link_orphaned_transcripts()` runs from `dispatcher.handleCallEnded()` after every call.

### BUG-031: Customer timezone not respected in availability checks
Pacific "9 AM" got UTC 9 AM. **FIXED:** `service.checkAvailability()` calls `check_availability_with_tz()` RPC; returns `tenant_timezone`, `local_start`, `local_end`.

### BUG-032: `call_summaries.embedding` likely always NULL
n8n workflow generated summary text but skipped embeddings. **FIXED:** added "OpenAI: Generate Embedding" node (text-embedding-3-small) between Summarize and Save.

### BUG-033: Calendar sync Outlook branch empty, no token refresh
**FIXED:** Google Calendar reimplemented in `src/services/googleCalendar.ts` + `src/services/calendarSync.ts` with full OAuth, auto refresh, fire-and-forget sync on mutations. Outlook implemented in `src/services/outlookCalendar.ts` via Microsoft Graph.

### BUG-034: `notify_n8n_on_appointment` trigger was a placeholder
Only did `RAISE NOTICE`, no actual webhook. **FIXED:** `20260316600000_customer_tz_and_n8n.sql` uses `pg_net` → `net.http_post()`; falls back to `RAISE NOTICE` on local dev.

### BUG-035: `Promise.all` in `useStaticData` — one failure killed all fetches
**FIXED:** `Promise.allSettled()` with per-result status checking.

### BUG-036: `skill` property accessed but never populated
**FIXED:** added `skills` state + `Api.skills.list(tenantId)` to `Promise.allSettled`.

### BUG-037: No audit logging
**FIXED:** `audit_log` table (id, tenant_id, table_name, record_id, action, old_data JSONB, new_data JSONB, changed_by, created_at) with indexes + RLS; `fn_audit_trigger()` on appointments/customers/resources. `20260316400000`. Cascade-delete edge case fixed in `20260319000003_audit_log_cascade_delete.sql`.

### BUG-038: No soft deletes on core tables
Hard deletes cascaded irreversibly. **FIXED:** `is_deleted` + `deleted_at` schema in `20260316400000`. Backend routes filter `is_deleted = false` on appointments/customers/resources/provisioning. Edge function `repository.ts` filters all 7 soft-deletable queries. `deleteEmployee()` converted to soft delete.

### BUG-039: No accessibility — ARIA labels missing
**FIXED:** all UI primitives have ARIA — Toast (`aria-live`/`role=status`/`alert`), Card (`role=button`+keyboard when clickable), FeedbackButton (`role=radiogroup`/`radio`/`aria-checked`), CoverageBar (`role=img`+label), OutlookLayout (`role=tablist`/`tab`/`aria-selected`).

### BUG-046: DST transitions not handled in shift validation
9am-5pm shifted an hour twice a year. **FIXED:** `book_appointment_atomic` uses `AT TIME ZONE` once (TIMESTAMPTZ handles DST); cross-day validation added. `20260316200000_fix_medium_bugs.sql`.

### BUG-047: ShiftManagementView had no edit or delete
**FIXED:** edit button + `handleUpdateShift` + `/shifts/:id/update` endpoint + `Api.shifts.update`. Modal toggles create/edit.

### BUG-048: CRM activity history fetched but never rendered
**NOT A BUG** — CRMView already renders `summaries` in "AI Call History" section (line 411-431).

### BUG-049: Vapi `agent.json` had hardcoded tenant ID and date
**FIXED:** `vapi/agent.template.json` with Mustache vars (`{{TENANT_NAME}}`, `{{CURRENT_DATE}}`, etc.); `src/services/vapiClient.ts` `buildAssistantPayload()` substitutes at provisioning time.

### BUG-050: Knowledge ingestion used naive chunking
Split on `\n\n` — context lost at boundaries. **FIXED:** `chunkDocument()` paragraph-aware with configurable max (1500 chars) + overlap (200 chars).

### BUG-051: No duplicate detection in knowledge ingestion
**FIXED:** ingestion deletes existing chunks for same `(tenant_id, source)` before re-inserting.

---

## Low

### BUG-040: Service `duration_minutes` not used to auto-calc `end_time`
30-min service could be booked in 2-hour slot. **FIXED:** `book_appointment_atomic` auto-calculates `end_time = start_time + duration_minutes` when `p_end_time` is NULL.

### BUG-041: Seed data hardcoded UUIDs — not idempotent
**FIXED:** `ON CONFLICT (id) DO NOTHING` / `ON CONFLICT (tenant_id, email)` for users.

### BUG-042: `business_templates` voice IDs hardcoded in migrations
**FIXED:** added `voice_provider` + `voice_name` columns; updates via existing `ON CONFLICT DO UPDATE`.

### BUG-043: No request debouncing on rapid actions
**FIXED:** ref-based `pendingToggle` guard prevents duplicate requests for same entity+service.

### BUG-044: Zod validation happened twice in edge function
**FIXED:** entry point stores `parsedArgs` on toolCall; dispatcher skips redundant `JSON.parse`.

### BUG-045: No global state management in dashboard
**FIXED:** `SessionProvider` React Context centralizes session state; `page.tsx` consumes via `useSessionContext()`.

### BUG-052: JSONB metadata had no schema validation
**FIXED:** `customers_metadata_is_object` + `appointments_metadata_is_object` CHECK constraints.

### BUG-053: `appointments.call_id` had no FK
FK not feasible (appointments created before transcripts). **FIXED:** documented as loose correlation ID; added partial index `idx_appointments_call_id`.

### BUG-054: `@supabase/supabase-js` imported in dashboard but unused
**FIXED:** added `/call-summaries` endpoint + `Api.callSummaries.list()`; CRMView uses Api client; `dashboard/lib/supabase.ts` deleted.

### BUG-055: Dashboard had no structured logging
**FIXED:** `dashboard/lib/logger.ts` with `createLogger(component)` — JSON output, levels, timestamps; `NEXT_PUBLIC_LOG_LEVEL` env-configurable.

### BUG-056: Dark mode missing system-preference detection
**NOT A BUG** — `OutlookLayout.tsx:56-61` already checks `prefers-color-scheme: dark` when no localStorage value.

### BUG-057: Timezone detection covered only ~10 cities
**FIXED:** `CITY_TIMEZONE_MAP` expanded to 60+ US cities; `STATE_TIMEZONE_MAP` to all 50 states.

### BUG-058: Appointment type field duplication
`name` vs `customers.name`. **FIXED:** made `name` optional; all code uses `customers.name`.

### BUG-060: Phone number capture incomplete — VOICE AI
Customers stored with `+1` instead of full E.164; `normalizePhone()` didn't reject < 10 digits. **FIXED:** returns null for partial phones; comprehensive logging added. Deployed April 1, 2026.

### BUG-061: Wrong date booked (hardcoded date in system prompt) — VOICE AI
Vapi prompt had `"Today is Saturday, Feb 28, 2026"` hardcoded — "tomorrow" calculated wrong dates. **FIXED:** `scripts/fix-vapi-assistant.js` updates assistant via API with dynamic current date + relative-date instructions. April 1, 2026 06:12 CDT.

### BUG-062: No employee assigned to booking — VOICE AI
Prompt wasn't passing `requiredEmployeeSkills`, bookings ran resource-only. **FIXED:** prompt extracts service, converts to skill format (lowercase-hyphenated), passes as `requiredEmployeeSkills`. Service→skill mapping table added. April 1, 2026.

### BUG-063: Call hangs up when booking fails — VOICE AI
No instructions for handling tool errors. **FIXED:** prompt has per-error-code handling (offer alternatives, explain unavailability). April 1, 2026.

### BUG-064: Generic booking error messages — VOICE AI / DATABASE
All failures returned same message. **FIXED:** `error_code TEXT` column added to `book_with_scheduling_atomic()`; codes `TIMESLOT_OCCUPIED`/`NO_SKILLED_EMPLOYEE`/`EMPLOYEE_NOT_SCHEDULED`/`NO_AVAILABILITY`/`INVALID_PARAMS`. Edge function + prompt updated per code. Migration `20260401000001_specific_booking_errors.sql`.
