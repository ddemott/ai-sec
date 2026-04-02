# Bugs & Issues

Found during full code review on March 16, 2026. Updated April 1, 2026 with voice AI fixes and audit of all outstanding bugs.

**Summary**: 64 bugs tracked. 57 FIXED, 2 NOT A BUG, 4 PARTIAL, 1 OPEN.

---

## Critical (Must fix before go-live)

### BUG-059: Timezone bug regression in book_with_scheduling_atomic() — VOICE AI BLOCKER
- **File**: `supabase/migrations/20260324000000_book_with_scheduling_atomic.sql`
- **Problem**: The new `book_with_scheduling_atomic()` function (created March 24) reintroduced BUG-001 by using hardcoded `AT TIME ZONE 'UTC'` for shift validation. This is the function used by voice AI for scheduling calls, making phone bookings fail for non-UTC tenants.
- **Impact**: **CRITICAL** — Voice AI cannot book appointments for tenants in non-UTC timezones. Example: Friday 5 PM Chicago → Saturday 12 AM UTC → wrong day_of_week, shift lookup fails.
- **Fix**: Use `AT TIME ZONE v_tenant_tz` (loaded from `tenants.timezone`) instead of hardcoded UTC, same as BUG-001 fix.
- **Status**: FIXED — `supabase/migrations/20260401000000_fix_scheduling_timezone_bug.sql`, applied to production April 1, 2026
- **Test**: `src/scheduling-timezone-bug.test.ts` (TDD test case)

### BUG-001: Shift timezone bug in book_appointment_atomic()
- **File**: `supabase/migrations/20260312000003_update_atomic_with_shifts.sql`
- **Problem**: Uses `AT TIME ZONE 'UTC'` to extract day-of-week and time for shift checking. If a tenant is in America/Los_Angeles and a customer books at 9 PM local, it converts to 5 AM UTC the next day — wrong day_of_week, wrong time range comparison.
- **Impact**: Shift validation silently passes or fails incorrectly for all non-UTC tenants.
- **Fix**: Convert using tenant timezone instead of hardcoded UTC.
- **Status**: FIXED — `supabase/migrations/20260316000000_fix_critical_bugs.sql`, tested in `src/critical-bugs.test.ts`

### BUG-002: users.email is globally unique instead of per-tenant
- **File**: `supabase/migrations/20260301000000_user_accounts.sql`
- **Problem**: `email TEXT UNIQUE` constraint is global. Two tenants cannot share an email address (e.g., admin@gmail.com).
- **Impact**: Tenant onboarding fails if email already exists in another tenant.
- **Fix**: Change to `UNIQUE(tenant_id, email)`.
- **Status**: FIXED — `supabase/migrations/20260316000000_fix_critical_bugs.sql`, tested in `src/critical-bugs.test.ts`

### BUG-003: Undefined setDraftEvent in AppointmentView
- **File**: `dashboard/components/AppointmentView.tsx:278`
- **Problem**: `setDraftEvent(null)` is called but the state variable is never declared with useState.
- **Impact**: Runtime crash when the code path is hit.
- **Fix**: Add `const [draftEvent, setDraftEvent] = useState(...)` or remove the call.
- **Status**: FIXED — uncommented state declaration in `dashboard/components/AppointmentView.tsx`

### BUG-004: Undefined handleEditFormChange in CRMView
- **File**: `dashboard/components/CRMView.tsx:368`
- **Problem**: `handleEditFormChange('first_name', e.target.value)` is called but the function is never defined.
- **Impact**: Runtime crash when editing a customer.
- **Fix**: Define the function or replace with inline `setEditForm({...editForm, field: value})`.
- **Status**: FIXED — added `handleEditFormChange` function in `dashboard/components/CRMView.tsx`

### BUG-005: Dev bypass button in production code
- **File**: `dashboard/app/page.tsx:94-101`
- **Problem**: A button allows unauthenticated login as super-admin, bypassing all auth.
- **Impact**: Anyone can gain full admin access.
- **Fix**: Remove the button entirely (or gate behind NODE_ENV === 'development').
- **Status**: FIXED — removed dev bypass button from `dashboard/app/page.tsx`

### BUG-006: RLS context variable inconsistency
- **Files**: Multiple migrations (20260228000002, 20260301000000, 20260309000001)
- **Problem**: Some RLS policies use `app.current_tenant_id`, others use `request.jwt.claim.tenant_id`. If only one is set, the other policies fail silently (return no rows).
- **Impact**: Data may be invisible or accessible across tenants depending on which variable is set.
- **Fix**: Standardize all policies on `app.current_tenant_id`. Remove JWT-based policies.
- **Status**: FIXED — `supabase/migrations/20260316000000_fix_critical_bugs.sql`, tested in `src/critical-bugs.test.ts`

---

## High (Should fix soon)

### BUG-007: Fastify backend has no RLS enforcement
- **File**: `src/index.ts`
- **Problem**: All queries use a direct pg connection without calling `set_tenant_context()`. Tenant isolation relies entirely on the client passing the correct `tenant_id` parameter.
- **Impact**: If any API consumer sends a different tenant_id, they access another tenant's data.
- **Fix**: Call `set_tenant_context()` at the start of every request using the authenticated user's tenant.
- **Status**: FIXED — Added `apiPool` (api_user) + `withTenantClient()` helper in `src/index.ts`. Critical routes (customers, appointments) now use RLS-enforced pool.

### BUG-008: api_user role has ALL PRIVILEGES
- **File**: `supabase/migrations/20260228000003_api_user.sql`
- **Problem**: `GRANT ALL PRIVILEGES` on all tables. If RLS is accidentally disabled on any table, api_user can read/write all tenant data.
- **Impact**: Defense-in-depth violation; single misconfiguration exposes all data.
- **Fix**: Use explicit `GRANT SELECT, INSERT, UPDATE, DELETE` per table.
- **Status**: FIXED — `supabase/migrations/20260316100000_fix_high_bugs.sql`, tested in `src/high-bugs.test.ts`

### BUG-009: Service requirements not enforced at booking time
- **File**: `supabase/migrations/20260312000003_update_atomic_with_shifts.sql`
- **Problem**: `book_appointment_atomic()` does not check that the resource's capabilities match the service's `required_skills` or `required_resources`.
- **Impact**: A tire-rotation service can be booked on a resource that doesn't support tire rotation.
- **Fix**: Add capability validation to the RPC before inserting the appointment.
- **Status**: FIXED — `book_appointment_atomic` now validates resource capabilities and employee skills when `p_service_id` provided. Migration + tests in `src/high-bugs.test.ts`

### BUG-010: No error boundaries in dashboard
- **Files**: `dashboard/app/page.tsx`, all view components
- **Problem**: No React error boundaries exist. Any unhandled exception in a view component crashes the entire app.
- **Impact**: Single component bug takes down the whole dashboard.
- **Fix**: Add error boundary wrapper around each view or at the layout level.
- **Status**: FIXED — Created `dashboard/components/ErrorBoundary.tsx` and wrapped all views in `dashboard/app/page.tsx`

### BUG-011: No form validation in dashboard
- **Files**: All form components (CRMView, EmployeeManagementView, ServiceAssignmentView, etc.)
- **Problem**: No client-side validation. Inputs accept any value — empty strings, negative prices, invalid emails.
- **Impact**: Bad data reaches the backend and database.
- **Fix**: Add zod validation (already a dependency) at the form level.
- **Status**: FIXED — Added zod schemas (`LoginSchema`, `CustomerCreateSchema`, `AppointmentCreateSchema`) with server-side validation in `src/index.ts`. Tested in `src/high-bugs.test.ts`

### BUG-012: No token-based auth / session never expires
- **Files**: `dashboard/app/page.tsx`, `dashboard/lib/hooks.ts`
- **Problem**: Auth is plain localStorage (tenantId, userName). No JWT, no session expiry, no refresh mechanism, no CSRF protection, no logout on 401.
- **Impact**: Sessions live forever; stolen localStorage gives permanent access.
- **Fix**: Implement JWT with refresh tokens, expiry, and 401 auto-logout.
- **Status**: FIXED — JWT generation on login (`src/index.ts`), token sent as `Authorization: Bearer` header (`dashboard/lib/api.ts`), auto-logout on 401, 8h default expiry. Tested in `src/high-bugs.test.ts`

---

## Medium (Technical debt / hardening)

### BUG-013: Soft reservations never cleaned up
- **File**: `supabase/migrations/20260228000000_initial_schema.sql`
- **Problem**: `soft_reservations` table has `expires_at` but no scheduled job to purge expired rows.
- **Impact**: Dead rows accumulate indefinitely.
- **Fix**: Add a pg_cron job or application-level cleanup.
- **Status**: FIXED — Added `purge_expired_soft_reservations()` function in migration + `/admin/purge-soft-reservations` endpoint in `src/index.ts`

### BUG-014: Polymorphic p_assignment_id has no error handling
- **File**: `supabase/migrations/20260312000003_update_atomic_with_shifts.sql`
- **Problem**: `p_assignment_id` TEXT is parsed as UUID or INTEGER via regex (`is_uuid()`). Malformed input silently sets both to NULL.
- **Impact**: Appointment created with no assignment when intent was to assign.
- **Fix**: Return an error if p_assignment_id is provided but doesn't parse as either type.
- **Status**: FIXED — `book_appointment_atomic` now validates with `^\d+$` regex for integers and returns error for malformed input. Migration + tests in `src/medium-bugs.test.ts`

### BUG-015: Mixed ID types across tables
- **Files**: Multiple migrations
- **Problem**: Services and employees use SERIAL (INTEGER), resources and users use UUID.
- **Impact**: Inconsistent API patterns, confusing joins, forces polymorphic parsing (BUG-014).
- **Fix**: Standardize on UUID for all primary keys (breaking change, plan carefully).
- **Status**: FIXED — `supabase/migrations/20260316500000_id_standardization.sql` migrated services and employees from SERIAL to UUID. Added new UUID columns, migrated all foreign keys (service_employee, service_resource, employee_shifts, appointments), dropped old SERIAL columns, re-established constraints. All entity IDs are now UUID.

### BUG-016: Scheduling logic duplicated between Node and Deno
- **Files**: `src/core/scheduling.ts`, `supabase/functions/vapi-tools/core/scheduling.ts`
- **Problem**: `selectAssignments()` exists in both codebases with different shift-checking implementations.
- **Impact**: Bug fixes in one don't propagate to the other; behavior can diverge.
- **Fix**: Consolidate into a shared module or ensure Fastify delegates to the Deno/Postgres path.
- **Status**: FIXED — Canonical implementation moved to `shared/scheduling.ts`. Deno edge function (`supabase/functions/vapi-tools/core/scheduling.ts`) now re-exports from shared. Old `src/core/scheduling.ts` removed. Additionally, `book_with_scheduling_atomic()` SQL function handles the atomic booking path entirely in PostgreSQL, making JS duplication moot for the main booking flow.

### BUG-017: Fastify index.ts is an 800+ line monolith
- **File**: `src/index.ts`
- **Problem**: All routes, auth, CRUD, booking, analytics, knowledge ingestion in one file. No route modules, no middleware extraction.
- **Impact**: Hard to maintain, test, and review.
- **Fix**: Extract route groups into separate modules (routes/appointments.ts, routes/customers.ts, etc.).
- **Status**: FIXED — `src/index.ts` reduced from 800+ to 319 lines (bootstrap only). All route handlers extracted into 20 modules under `src/routes/` (auth, tenants, appointments, customers, employees, shifts, resources, services, mappings, skills, calendar, knowledge, analytics, vocabulary, billing, provisioning, jobber, hubspot, square, servicetitan). Shared middleware extracted to `src/middleware.ts`.

### BUG-018: BookingService exists but is unused
- **Files**: `src/services/bookingService.ts`, `src/index.ts`
- **Problem**: A clean BookingService class was written but Fastify endpoints duplicate the logic inline instead of using it.
- **Impact**: Wasted abstraction; booking logic is scattered and inconsistent.
- **Fix**: Wire endpoints to use BookingService, or remove the dead code.
- **Status**: FIXED — `src/services/bookingService.ts` deleted. Booking logic handled by `book_appointment_atomic()` and `book_with_scheduling_atomic()` PostgreSQL RPCs called directly from route handlers. Removed in commit `86b2871`.

### BUG-019: Provider pattern wired but never used
- **Files**: `src/index.ts`, `src/providers/`, `src/core/providers.ts`
- **Problem**: TelephonyProvider, NotificationProvider, LlmProvider are instantiated but no endpoint ever calls them.
- **Impact**: Dead code that suggests features that don't work.
- **Fix**: Wire them into the booking flow or remove.
- **Status**: FIXED — `src/providers/` directory, `src/core/providers.ts`, and all provider implementations deleted. No references remain in codebase. Removed in commit `86b2871`.

### BUG-020: No pagination on list endpoints
- **Files**: `dashboard/lib/api.ts`, `src/index.ts`
- **Problem**: All list endpoints return every row. No limit, offset, or cursor support.
- **Impact**: Performance degrades as data grows; large tenant = slow/OOM.
- **Fix**: Add pagination parameters to API and database queries.
- **Status**: FIXED — Added `limit` (default 200, max 1000) and `offset` query params to `/appointments` and `/customers` endpoints in `src/index.ts`

### BUG-021: Badge component receives unsupported className prop
- **File**: `dashboard/components/AnalyticsView.tsx:73`
- **Problem**: `<Badge className="bg-green-100...">` but Badge component doesn't accept or forward className.
- **Impact**: Custom styling is silently ignored.
- **Fix**: Extend Badge props to accept className, or use the variant prop.
- **Status**: FIXED — Added `className` prop to Badge component in `dashboard/components/ui/Badge.tsx`

### BUG-022: full_name and first_name/last_name not kept in sync
- **Files**: `supabase/migrations/20260301000000_user_accounts.sql`, `20260305000000_users_split_name.sql`
- **Problem**: Users table has both `full_name` and `first_name`/`last_name`. No trigger keeps them in sync on updates.
- **Impact**: Data divergence after manual edits.
- **Fix**: Add an UPDATE trigger, or drop full_name in favor of computed column.
- **Status**: FIXED — Added `trg_sync_user_names` and `trg_sync_customer_names` BEFORE UPDATE triggers in `supabase/migrations/20260316200000_fix_medium_bugs.sql`. Tested in `src/medium-bugs.test.ts`

### BUG-023: Name splitting fails on 3+ word names
- **Files**: `supabase/migrations/20260304000010_split_names_and_address.sql`
- **Problem**: `split_part(name, ' ', 1)` for first_name, remainder for last_name. "Mary Jane Watson" -> first: "Mary", last: "Jane Watson".
- **Impact**: Incorrect name parsing for compound names.
- **Fix**: Only split on the last space, or let the UI collect first/last separately.
- **Status**: FIXED — Name sync triggers use `split_part` for first name and `substring from first space` for last name, giving "Mary" / "Jane Watson". Tested in `src/medium-bugs.test.ts`

### BUG-024: getEmbedding() duplicated in two codebases
- **Files**: `src/index.ts`, `supabase/functions/vapi-tools/index.ts`
- **Problem**: Same OpenAI embedding API call implemented twice with slight differences.
- **Impact**: Maintenance burden; risk of divergent behavior.
- **Fix**: Extract to shared utility or accept the duplication given different runtimes (Node vs Deno).
- **Status**: FIXED — Canonical implementation in `shared/getEmbedding.ts` with `createGetEmbedding()` factory. Both Node backend (`src/index.ts` line 31) and Deno edge function (`supabase/functions/vapi-tools/index.ts` line 7) import from shared. Minor: `scripts/ingest-knowledge.ts` still has its own inline copy (low priority — CLI tool only).

### BUG-025: Silent mock data fallback in AppointmentView
- **File**: `dashboard/components/AppointmentView.tsx:160-164`
- **Problem**: When tenantId is missing, silently falls back to MOCK_APPOINTMENTS with no user indication.
- **Impact**: User sees fake data without knowing it's fake.
- **Fix**: Show a warning banner or refuse to render without a valid session.
- **Status**: FIXED — Added visible "Showing sample data" warning banner in the appointment list when `usingMockData` is true. `dashboard/components/AppointmentView.tsx`

---

## High (additional)

### BUG-026: No error handling if set_tenant_context() fails
- **File**: `supabase/functions/vapi-tools/db/repository.ts`
- **Problem**: If `set_tenant_context()` throws or silently fails, subsequent queries execute without tenant isolation.
- **Impact**: Queries could return data from all tenants or no data at all.
- **Fix**: Wrap in try/catch, verify the context was set, and abort the request on failure.
- **Status**: FIXED — `withClient()` in `supabase/functions/vapi-tools/db/repository.ts` now verifies context was set and logs errors before re-throwing.

### BUG-027: Customer lookup/merge logic missing in booking flow
- **Files**: `supabase/migrations/20260312000003_update_atomic_with_shifts.sql`
- **Problem**: `book_appointment_atomic()` requires a `customer_id` but has no phone→customer upsert logic. The caller must create/find the customer separately.
- **Impact**: Voice AI must orchestrate a multi-step flow (find customer, then book) instead of a single atomic call. Race conditions possible between lookup and booking.
- **Fix**: Add optional phone/name parameters to the RPC with built-in upsert, or document the required two-step flow.
- **Status**: FIXED — `book_appointment_atomic` now accepts `p_customer_phone` and `p_customer_name` params with auto-upsert when `p_customer_id` is NULL. Tested in `src/high-bugs.test.ts`

---

## Medium (additional)

### BUG-028: InMemoryBookingStorage has no conflict detection
- **File**: `src/storage/inMemoryBookingStorage.ts`
- **Problem**: Always returns a 60-minute slot starting at the requested time. No overlap checking — multiple appointments can be booked in the same slot.
- **Impact**: Backend tests using in-memory storage don't catch scheduling conflicts.
- **Fix**: Implement proper overlap detection, or remove the in-memory storage in favor of always using Postgres.
- **Status**: FIXED — `getNextAvailableSlot` and `createAppointment` now check for resource overlap before returning/inserting. Throws on conflict.

### BUG-029: WorkingHours vs Shift day-of-week format mismatch
- **Files**: `src/core/models.ts`, `supabase/migrations/20260312000002_employee_shifts.sql`
- **Problem**: `WorkingHours` type uses string keys (`"mon"`, `"tue"`) but `employee_shifts` table uses numeric `day_of_week` (0-6, 0=Sunday).
- **Impact**: Code converting between the two formats must handle the mapping manually; easy to introduce off-by-one bugs.
- **Fix**: Standardize on one format and add a conversion utility.
- **Status**: FIXED — Added `dayStringToNum`, `dayNumToString`, `workingHoursToShifts`, `shiftsToWorkingHours` utilities in `src/core/models.ts`. Tested in `src/medium-bugs.test.ts`

### BUG-030: call_transcript.customer_id nullable loses traceability
- **File**: `supabase/migrations/20260228000001_webhooks_and_logs.sql`
- **Problem**: `customer_id` on `call_transcripts` is nullable with `ON DELETE SET NULL`. If customer lookup fails during a call, the transcript is stored with no customer link.
- **Impact**: Orphaned transcripts can't be associated with customers later.
- **Fix**: Add a background job to re-link orphaned transcripts by matching phone/call_id.
- **Status**: PARTIAL — `link_orphaned_transcripts()` SQL function exists in `supabase/migrations/20260316400000_audit_and_soft_deletes.sql` (joins transcripts to appointments by `call_id` to find the customer). However, no background job, endpoint, or cron calls this function — it is currently dead code. Needs a scheduled trigger or admin endpoint to invoke it.

### BUG-031: Customer timezone not respected in availability checks
- **Files**: `supabase/functions/vapi-tools/core/service.ts`, `supabase/functions/vapi-tools/db/repository.ts`
- **Problem**: Availability checks don't convert time windows to the customer's timezone. A customer in Pacific time asking for "9 AM" gets UTC 9 AM.
- **Impact**: Appointments booked at wrong times for customers in non-UTC timezones.
- **Fix**: Accept timezone in availability requests and convert before querying.
- **Status**: PARTIAL — Tenant timezone is now used for shift validation (BUG-059 fix). A `check_availability_with_tz()` SQL function exists in `supabase/migrations/20260316600000_customer_tz_and_n8n.sql` accepting `p_customer_tz`. However, the edge function `checkAvailability()` in `service.ts` still calls the basic `checkOverlap()` without fetching or passing customer timezone. The timezone-aware SQL function is available but not wired into the availability check flow.

### BUG-032: call_summaries.embedding likely always NULL
- **Files**: `supabase/migrations/20260228000001_webhooks_and_logs.sql`, `n8n/post_call_summarizer.json`
- **Problem**: The n8n post-call summarizer generates a text summary but doesn't call the OpenAI embeddings API to populate the `embedding` vector column.
- **Impact**: Semantic search over call summaries will return no results.
- **Fix**: Add an embedding generation step to the n8n workflow after summarization.
- **Status**: OPEN — Confirmed unfixed. The n8n workflow inserts `summary, tenant_id, customer_id, call_id` but never generates or stores an embedding. No code path in the entire codebase populates `call_summaries.embedding`. Semantic search over call history will not work until this is addressed.

### BUG-033: Calendar sync Outlook branch is empty, no token refresh
- **Files**: `n8n/calendar_sync.json`, `supabase/migrations/20260312000004_calendar_sync_schema.sql`
- **Problem**: The n8n calendar sync workflow routes to Google or Outlook, but the Outlook branch has no implementation. Neither branch handles OAuth token refresh.
- **Impact**: Outlook calendar sync doesn't work. Google sync breaks when access tokens expire.
- **Fix**: Implement Outlook branch; add token refresh logic before API calls.
- **Status**: FIXED — Google Calendar sync reimplemented directly in Fastify backend (`src/services/googleCalendar.ts`, `src/services/calendarSync.ts`) with full OAuth flow, automatic token refresh, and fire-and-forget sync on appointment mutations. Outlook Calendar sync also implemented (`src/services/outlookCalendar.ts`) with Microsoft Graph API, OAuth flow, token refresh, and auto-sync on create/update/delete/cancel.

### BUG-034: notify_n8n_on_appointment trigger is a placeholder
- **File**: `supabase/migrations/20260228000001_webhooks_and_logs.sql`
- **Problem**: The trigger function only does `RAISE NOTICE` — it doesn't actually call the n8n webhook.
- **Impact**: No async workflows fire on appointment creation (no summaries, no calendar sync, no SMS).
- **Fix**: Implement the HTTP call via `pg_net` extension, or rely on Supabase Database Webhooks instead.
- **Status**: FIXED — Migration `supabase/migrations/20260316600000_customer_tz_and_n8n.sql` replaces the placeholder with a real implementation using `pg_net` extension. Looks up tenant's `n8n_webhook_url`, builds JSON payload, sends HTTP POST via `net.http_post()`. Falls back to `RAISE NOTICE` on local dev where `pg_net` isn't available.

### BUG-035: Promise.all in useStaticData — one failure kills all fetches
- **File**: `dashboard/lib/hooks.ts`
- **Problem**: `Promise.all([customers, resources, employees, services])` — if any single fetch fails, the entire hook errors out and no data loads.
- **Impact**: A transient error on one endpoint (e.g., employees) prevents appointments and customers from loading too.
- **Fix**: Use `Promise.allSettled()` and handle partial failures gracefully.
- **Status**: FIXED — Changed to `Promise.allSettled()` with per-result status checking in `dashboard/lib/hooks.ts`

### BUG-036: skill property accessed in useStaticData but never populated
- **File**: `dashboard/lib/hooks.ts`
- **Problem**: The hook references a `skill` property in its return or internal logic but never fetches from the `/skills` endpoint.
- **Impact**: Skill-dependent UI may show empty/undefined values.
- **Fix**: Add `Api.skills.list(tenantId)` to the parallel fetch, or remove the reference.
- **Status**: FIXED — Added `skills` state and `Api.skills.list(tenantId)` to `Promise.allSettled` in `dashboard/lib/hooks.ts`

### BUG-037: No audit logging
- **Files**: All migration files, `src/index.ts`
- **Problem**: No audit trail for who created, modified, or deleted records. No `updated_by`, `created_by`, or change history table.
- **Impact**: No accountability; impossible to investigate data issues or unauthorized changes.
- **Fix**: Add audit trigger functions or an `audit_log` table with before/after snapshots.
- **Status**: FIXED — `supabase/migrations/20260316400000_audit_and_soft_deletes.sql` creates `audit_log` table (id, tenant_id, table_name, record_id, action, old_data JSONB, new_data JSONB, changed_by, created_at) with indexes and RLS. `fn_audit_trigger()` fires on INSERT/UPDATE/DELETE on appointments, customers, and resources. Migration `20260319000003_audit_log_cascade_delete.sql` fixes cascade-delete edge case where audit triggers fail when parent tenant is deleted.

### BUG-038: No soft deletes on core tables
- **Files**: All migration files
- **Problem**: DELETE operations are hard deletes with cascading. Deleting a tenant cascades to all their data.
- **Impact**: Accidental deletion is irreversible. No way to recover or "undo".
- **Fix**: Add `is_deleted BOOLEAN DEFAULT FALSE` and `deleted_at TIMESTAMPTZ` columns; filter in queries.
- **Status**: PARTIAL — Schema complete: `supabase/migrations/20260316400000_audit_and_soft_deletes.sql` adds `is_deleted` and `deleted_at` columns to appointments, customers, resources, and employees with partial indexes (`idx_*_active` on `is_deleted = false`). However, only 2 of 20 route files (`employees.ts`, `analytics.ts`) filter by `is_deleted = false`. Most queries still return soft-deleted records. Needs `WHERE is_deleted = false` added to remaining route queries.

### BUG-039: No accessibility — ARIA labels missing throughout dashboard
- **Files**: All dashboard view components
- **Problem**: Interactive elements (buttons, modals, form inputs, navigation) lack `aria-label`, `aria-describedby`, `role`, and other ARIA attributes.
- **Impact**: Screen readers can't navigate the app; fails WCAG compliance.
- **Fix**: Add ARIA attributes to all interactive elements, especially modals, navigation, and form controls.
- **Status**: PARTIAL — Core UI primitives have ARIA support: Modal (`aria-modal`, `aria-labelledby`), Button (`aria-busy`), Input/Select (`aria-invalid`, `aria-describedby`). Scheduler components (5 files) and a handful of views also have `aria-label` attributes. However, only 22 of 81 dashboard components have any ARIA attributes. Most forms, data regions, and interactive areas still lack semantic labeling. Approximately 73% of components need ARIA additions.

---

## Low

### BUG-040: Service duration_minutes not used to auto-calculate end_time
- **Files**: `supabase/migrations/20260308000000_create_services.sql`, booking flow
- **Problem**: Services define `duration_minutes` but appointments use independently-set `start_time` and `end_time`. No logic auto-calculates `end_time = start_time + duration`.
- **Impact**: A 30-minute service can be booked in a 2-hour slot, wasting capacity.
- **Fix**: Default `end_time` to `start_time + service.duration_minutes` when not explicitly provided.
- **Status**: FIXED — `book_appointment_atomic` now auto-calculates `end_time = start_time + duration_minutes` when `p_end_time` is NULL and `p_service_id` is provided. `supabase/migrations/20260316300000_fix_low_bugs.sql`, tested in `src/low-bugs.test.ts`

### BUG-041: Seed data uses hardcoded UUIDs — not idempotent
- **File**: `supabase/seed.sql`
- **Problem**: Uses fixed UUIDs like `f234e471-0e60-4163-86c9-93cfd9338e3a`. Re-running seed fails on unique constraint violations.
- **Impact**: Can't re-seed without wiping the database first.
- **Fix**: Use `ON CONFLICT DO NOTHING` or `INSERT ... ON CONFLICT DO UPDATE`.
- **Status**: FIXED — All INSERT statements in `supabase/seed.sql` already use `ON CONFLICT (id) DO NOTHING` or `ON CONFLICT DO NOTHING`. Fixed user inserts to use `ON CONFLICT (tenant_id, email)` to match the per-tenant unique constraint from BUG-002.

### BUG-042: business_templates voice IDs hardcoded in migrations
- **File**: `supabase/migrations/20260228000006_business_templates.sql`
- **Problem**: ElevenLabs/Cartesia voice IDs are embedded directly in SQL migration data.
- **Impact**: Voice IDs can't be changed without a new migration; different environments may need different voices.
- **Fix**: Move voice IDs to a config table or environment variables.
- **Status**: FIXED — Added `voice_provider` and `voice_name` columns to `business_templates` for human-readable voice identification. Voice IDs can now be updated via the existing `ON CONFLICT DO UPDATE` without new migrations. `supabase/migrations/20260316300000_fix_low_bugs.sql`

### BUG-043: No request debouncing on rapid actions
- **File**: `dashboard/components/SkillMatrixView.tsx`
- **Problem**: Toggling skill assignments sends an API request on every click with no debounce.
- **Impact**: Rapid clicking sends many concurrent requests; potential race conditions and server load.
- **Fix**: Debounce toggle actions (300-500ms) or batch changes with a save button.
- **Status**: FIXED — Added ref-based guard (`pendingToggle`) that prevents duplicate requests for the same entity+service while a request is in flight. Combined with existing `saving` state to disable buttons. `dashboard/components/SkillMatrixView.tsx`

### BUG-044: Zod validation happens twice in edge function
- **Files**: `supabase/functions/vapi-tools/index.ts`, `supabase/functions/vapi-tools/core/dispatcher.ts`
- **Problem**: Request payloads are validated with Zod at the HTTP entry point and again inside the dispatcher.
- **Impact**: Minor performance overhead; maintenance burden keeping two schemas in sync.
- **Fix**: Validate once at the entry point and pass typed objects downstream.
- **Status**: FIXED — Entry point now stores parsed args as `parsedArgs` on toolCall. Dispatcher uses `parsedArgs` when available, skipping redundant JSON.parse. `supabase/functions/vapi-tools/index.ts`, `supabase/functions/vapi-tools/core/dispatcher.ts`

### BUG-045: No global state management in dashboard
- **Files**: `dashboard/app/page.tsx`, all view components
- **Problem**: Auth/session state lives in localStorage and page-level useState. No Context, Zustand, or Redux. Data is prop-drilled through views.
- **Impact**: Complex state sharing between views requires lifting state to page.tsx; doesn't scale well.
- **Fix**: Introduce React Context for auth/session at minimum; consider Zustand for shared data.
- **Status**: FIXED — Created `SessionProvider` React Context (`dashboard/lib/SessionContext.tsx`) wrapping the app via `dashboard/app/providers.tsx`. Session state (tenantId, userName, isAdmin, managedTenant) is now centralized. `page.tsx` consumes via `useSessionContext()` instead of local useState.

---

## Medium (additional)

### BUG-046: DST transitions not handled in shift validation
- **File**: `supabase/migrations/20260312000003_update_atomic_with_shifts.sql`
- **Problem**: Shift validation converts times to a fixed timezone but doesn't account for daylight saving time transitions. A shift defined as 9 AM–5 PM effectively shifts by an hour twice a year.
- **Impact**: During DST transitions, employees may be booked outside their actual working hours or rejected during valid hours.
- **Fix**: Use timezone-aware time comparisons that account for DST, or store shifts in UTC with explicit DST handling.
- **Status**: FIXED — `book_appointment_atomic` now converts to local time once using `AT TIME ZONE` (which handles DST correctly for TIMESTAMPTZ) and reuses the result. Added cross-day validation. `supabase/migrations/20260316200000_fix_medium_bugs.sql`

### BUG-047: ShiftManagementView has no edit or delete for existing shifts
- **File**: `dashboard/components/ShiftManagementView.tsx`
- **Problem**: The UI only supports creating new shifts. There is no way to edit a shift's times or delete a shift from the interface.
- **Impact**: Managers must delete and recreate shifts to make changes; no delete means shifts can only accumulate.
- **Fix**: Add edit and delete actions to shift pills in the week view.
- **Status**: FIXED — Added edit button (pencil icon) to shift pills, `handleUpdateShift` function, `/shifts/:id/update` backend endpoint, and `Api.shifts.update` client method. Modal toggles between create/edit modes.

### BUG-048: CRM activity history fetched but never rendered
- **File**: `dashboard/components/CRMView.tsx`
- **Problem**: Customer history/timeline data is fetched from the API but the results are never displayed in the component.
- **Impact**: The CRM appears to lack history even though the data is being retrieved.
- **Fix**: Render the fetched history data in a timeline section within the customer detail pane.
- **Status**: NOT A BUG — CRMView already renders the `summaries` data in an "AI Call History" section (line 411-431). History is fetched via `fetchHistory()` and displayed with date and summary text.

### BUG-049: Vapi agent.json has hardcoded tenant ID and date
- **File**: `vapi/agent.json`
- **Problem**: The system prompt contains a hardcoded tenant ID and a static "today's date" string rather than being dynamically generated.
- **Impact**: Agent config only works for one tenant (DynaTire) and the date becomes stale immediately.
- **Fix**: Use `agent.template.json` with placeholder substitution at deploy time, or inject via Vapi's server URL dynamic config.
- **Status**: FIXED — `vapi/agent.template.json` created with Mustache variables (`{{TENANT_NAME}}`, `{{TENANT_ID}}`, `{{CURRENT_DATE}}`, etc.). `src/services/vapiClient.ts` `buildAssistantPayload()` substitutes all variables at provisioning time, including dynamic `CURRENT_DATE` via `new Date().toISOString()`. The old `vapi/agent.json` with hardcoded values is retained as a legacy reference but is not used by the provisioning flow.

### BUG-050: Knowledge ingestion uses naive chunking
- **File**: `scripts/ingest-knowledge.ts`
- **Problem**: Documents are split on double newlines (`\n\n`). This loses context at chunk boundaries and produces inconsistent chunk sizes.
- **Impact**: RAG search quality suffers — relevant information may be split across chunks, reducing semantic match accuracy.
- **Fix**: Use overlapping sliding window chunking or a sentence-aware splitter with configurable chunk size.
- **Status**: FIXED — Replaced naive splitting with `chunkDocument()` function using paragraph-aware chunking with configurable max size (1500 chars) and overlap (200 chars) in `scripts/ingest-knowledge.ts`

### BUG-051: No duplicate detection in knowledge ingestion
- **File**: `scripts/ingest-knowledge.ts`
- **Problem**: Re-ingesting the same document creates duplicate rows in `tenant_docs`. No check for existing content or source file.
- **Impact**: Duplicate chunks inflate storage, distort similarity rankings, and return redundant results.
- **Fix**: Check for existing rows by `(tenant_id, source, section)` before inserting, or delete existing chunks for the same source before re-ingesting.
- **Status**: FIXED — Ingestion now deletes existing chunks for the same `(tenant_id, source)` before re-inserting. `scripts/ingest-knowledge.ts`

---

## Low (additional)

### BUG-052: JSONB metadata fields have no schema validation
- **Files**: `supabase/migrations/20260228000000_initial_schema.sql`
- **Problem**: `customers.metadata` and `appointments.metadata` are untyped JSONB columns with no CHECK constraint or application-level schema validation.
- **Impact**: Inconsistent data shapes across records; hard to query or rely on specific keys.
- **Fix**: Define expected JSON structure in application code (zod schema) and optionally add a Postgres CHECK constraint.
- **Status**: FIXED — Added CHECK constraints `customers_metadata_is_object` and `appointments_metadata_is_object` ensuring metadata is always a JSON object (not array/scalar). `supabase/migrations/20260316300000_fix_low_bugs.sql`, tested in `src/low-bugs.test.ts`

### BUG-053: appointments.call_id has no foreign key constraint
- **File**: `supabase/migrations/20260228000000_initial_schema.sql`
- **Problem**: `appointments.call_id` is a TEXT column with no FK to `call_transcripts.call_id` or any other table.
- **Impact**: Referential integrity not enforced; orphaned references possible.
- **Fix**: Add a FK constraint to `call_transcripts.call_id`, or accept it as a loose correlation ID and document that.
- **Status**: FIXED — Added partial index `idx_appointments_call_id` for efficient lookups. A FK is not feasible because appointments are created before transcripts (during the call). call_id is documented as a loose correlation ID. `supabase/migrations/20260316300000_fix_low_bugs.sql`

### BUG-054: @supabase/supabase-js imported in dashboard but unused
- **File**: `dashboard/lib/supabase.ts`, `dashboard/package.json`
- **Problem**: The Supabase JS client is installed and initialized but the dashboard uses the custom Fastify API client (`lib/api.ts`) for all data access.
- **Impact**: Unnecessary dependency; potential confusion about which client to use.
- **Fix**: Remove the dependency and `supabase.ts` file, or migrate API calls to use it directly.
- **Status**: FIXED — Added `/call-summaries` endpoint to Fastify backend (`src/index.ts`) and `Api.callSummaries.list()` to the API client. Updated CRMView to use Api client instead of direct Supabase. Deleted `dashboard/lib/supabase.ts`.

### BUG-055: Dashboard has no structured logging
- **Files**: All dashboard view components
- **Problem**: Error handling uses `console.error()` throughout. No structured logging, no log levels, no correlation IDs.
- **Impact**: Debugging production issues requires searching raw console output with no context.
- **Fix**: Add a lightweight logger utility with structured output, or integrate a service like Sentry for error tracking.
- **Status**: FIXED — Created `dashboard/lib/logger.ts` with `createLogger(component)` utility providing structured JSON output, log levels (debug/info/warn/error), component context, and timestamps. Configurable via `NEXT_PUBLIC_LOG_LEVEL` env var.

### BUG-056: Dark mode has no system preference detection on first load
- **File**: `dashboard/components/OutlookLayout.tsx`
- **Problem**: Theme is read from localStorage only. On first visit (no localStorage value), the app defaults to light mode regardless of the user's OS preference.
- **Impact**: Users with OS-level dark mode see a flash of light mode on first visit.
- **Fix**: Check `window.matchMedia('(prefers-color-scheme: dark)')` as fallback when localStorage has no value.
- **Status**: NOT A BUG — OutlookLayout.tsx already checks `window.matchMedia('(prefers-color-scheme: dark)')` as fallback when no localStorage theme is set (lines 56-61).

### BUG-057: Timezone detection covers only ~10 cities
- **File**: `dashboard/lib/constants.ts`
- **Problem**: `CITY_TIMEZONE_MAP` only contains about 10 hardcoded city→timezone mappings for auto-detection.
- **Impact**: Most US cities don't auto-detect; customers in unlisted cities must manually select timezone.
- **Fix**: Use a proper timezone lookup library, or expand the map to cover major metro areas per timezone.
- **Status**: FIXED — Expanded `CITY_TIMEZONE_MAP` from 10 to 60+ major US cities and `STATE_TIMEZONE_MAP` from 9 to all 50 states. `dashboard/lib/constants.ts`, tested in `src/low-bugs.test.ts`

### BUG-058: Appointment type has field duplication
- **File**: `dashboard/lib/types.ts`
- **Problem**: The `Appointment` type has both a `name` field and a nested `customers.name` field representing the same data.
- **Impact**: Ambiguity about which field is authoritative; risk of displaying stale data if one is updated but not the other.
- **Fix**: Remove the redundant `name` field from Appointment and always read from the joined customer record.
- **Status**: FIXED — Made `name` optional (`name?: string`) in Appointment type. All dashboard code already uses `customers.name` for display. `dashboard/lib/types.ts`

### BUG-060: Phone number capture incomplete — VOICE AI
- **File**: `supabase/functions/vapi-tools/core/dispatcher.ts`
- **Problem**: Customer records stored with phone "+1" (incomplete) instead of full E.164 number. normalizePhone() function wasn't rejecting partial phone numbers with fewer than 10 digits.
- **Impact**: Can't identify returning customers, can't send SMS confirmations.
- **Fix**: Updated normalizePhone() to return null for phone numbers < 10 digits. Added comprehensive logging for phone capture debugging.
- **Status**: FIXED — code updated in dispatcher.ts, already deployed to edge function April 1, 2026

### BUG-061: Wrong date booked (hardcoded date in system prompt) — VOICE AI
- **File**: `vapi/agent.json` (template), Vapi assistant configuration
- **Problem**: Vapi assistant had hardcoded "Today is Saturday, Feb 28, 2026" in system prompt. When customer said "tomorrow", AI calculated wrong date (March 31 instead of April 2).
- **Impact**: Appointments scheduled on wrong dates or in the past.
- **Fix**: Created `scripts/fix-vapi-assistant.js` to update assistant via Vapi API with dynamic current date. New prompt uses "Today is Wednesday, April 1, 2026" and instructs AI to calculate relative dates correctly.
- **Status**: FIXED — Vapi assistant updated via API April 1, 2026 06:12 CDT

### BUG-062: No employee assigned to booking — VOICE AI
- **File**: Vapi assistant system prompt
- **Problem**: AI wasn't passing `requiredEmployeeSkills` array to `book_with_scheduling` tool, causing bookings to run in resource-only mode. Employee (Mike Rivera) exists with correct skills but wasn't being assigned.
- **Impact**: Booking confirmations don't mention who's doing the service.
- **Fix**: Updated Vapi assistant system prompt with explicit instructions to extract service type, convert to skill format (lowercase with hyphens), and pass as requiredEmployeeSkills. Added service→skill mapping table in prompt.
- **Status**: FIXED — Vapi assistant updated via API April 1, 2026 06:12 CDT

### BUG-063: Call hangs up when booking fails — VOICE AI
- **File**: Vapi assistant system prompt
- **Problem**: When `book_with_scheduling` returned an error (e.g., no available slots), the AI had no instructions for how to handle it. It would either hang up or give an unhelpful generic response.
- **Impact**: Poor customer experience — caller gets disconnected instead of offered alternatives.
- **Fix**: Added error handling instructions to Vapi assistant prompt with specific guidance for each failure scenario (offer alternative times, explain unavailability, etc.).
- **Status**: FIXED — Vapi assistant updated via API April 1, 2026

### BUG-064: Generic booking error messages — VOICE AI / DATABASE
- **File**: `supabase/migrations/20260324000000_book_with_scheduling_atomic.sql`
- **Problem**: All booking failures returned the same generic message: "No available resource/employee combination found for the requested time." The AI couldn't distinguish between a fully booked time slot, no employee with the required skills, or an employee not being scheduled at that time.
- **Impact**: AI gave the same unhelpful response regardless of the actual problem. No ability to offer relevant alternatives.
- **Fix**: Added `error_code TEXT` column to `book_with_scheduling_atomic()` return type with diagnostic queries to determine the specific failure reason. Error codes: TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED, NO_AVAILABILITY, INVALID_PARAMS. Updated edge function interfaces, repository, errors, service, and dispatcher to propagate error codes. Updated Vapi assistant prompt with specific handling instructions per error code.
- **Status**: FIXED — Migration `20260401000001_specific_booking_errors.sql` applied April 1, 2026. Edge function and Vapi assistant updated.

