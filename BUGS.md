# Bugs & Issues

Found during full code review on March 16, 2026.

---

## Critical (Must fix before go-live)

### BUG-001: Shift timezone bug in book_appointment_atomic()
- **File**: `supabase/migrations/20260312000003_update_atomic_with_shifts.sql`
- **Problem**: Uses `AT TIME ZONE 'UTC'` to extract day-of-week and time for shift checking. If a tenant is in America/Los_Angeles and a customer books at 9 PM local, it converts to 5 AM UTC the next day — wrong day_of_week, wrong time range comparison.
- **Impact**: Shift validation silently passes or fails incorrectly for all non-UTC tenants.
- **Fix**: Convert using tenant timezone instead of hardcoded UTC.

### BUG-002: users.email is globally unique instead of per-tenant
- **File**: `supabase/migrations/20260301000000_user_accounts.sql`
- **Problem**: `email TEXT UNIQUE` constraint is global. Two tenants cannot share an email address (e.g., admin@gmail.com).
- **Impact**: Tenant onboarding fails if email already exists in another tenant.
- **Fix**: Change to `UNIQUE(tenant_id, email)`.

### BUG-003: Undefined setDraftEvent in AppointmentView
- **File**: `dashboard/components/AppointmentView.tsx:278`
- **Problem**: `setDraftEvent(null)` is called but the state variable is never declared with useState.
- **Impact**: Runtime crash when the code path is hit.
- **Fix**: Add `const [draftEvent, setDraftEvent] = useState(...)` or remove the call.

### BUG-004: Undefined handleEditFormChange in CRMView
- **File**: `dashboard/components/CRMView.tsx:368`
- **Problem**: `handleEditFormChange('first_name', e.target.value)` is called but the function is never defined.
- **Impact**: Runtime crash when editing a customer.
- **Fix**: Define the function or replace with inline `setEditForm({...editForm, field: value})`.

### BUG-005: Dev bypass button in production code
- **File**: `dashboard/app/page.tsx:94-101`
- **Problem**: A button allows unauthenticated login as super-admin, bypassing all auth.
- **Impact**: Anyone can gain full admin access.
- **Fix**: Remove the button entirely (or gate behind NODE_ENV === 'development').

### BUG-006: RLS context variable inconsistency
- **Files**: Multiple migrations (20260228000002, 20260301000000, 20260309000001)
- **Problem**: Some RLS policies use `app.current_tenant_id`, others use `request.jwt.claim.tenant_id`. If only one is set, the other policies fail silently (return no rows).
- **Impact**: Data may be invisible or accessible across tenants depending on which variable is set.
- **Fix**: Standardize all policies on `app.current_tenant_id`. Remove JWT-based policies.

---

## High (Should fix soon)

### BUG-007: Fastify backend has no RLS enforcement
- **File**: `src/index.ts`
- **Problem**: All queries use a direct pg connection without calling `set_tenant_context()`. Tenant isolation relies entirely on the client passing the correct `tenant_id` parameter.
- **Impact**: If any API consumer sends a different tenant_id, they access another tenant's data.
- **Fix**: Call `set_tenant_context()` at the start of every request using the authenticated user's tenant.

### BUG-008: api_user role has ALL PRIVILEGES
- **File**: `supabase/migrations/20260228000003_api_user.sql`
- **Problem**: `GRANT ALL PRIVILEGES` on all tables. If RLS is accidentally disabled on any table, api_user can read/write all tenant data.
- **Impact**: Defense-in-depth violation; single misconfiguration exposes all data.
- **Fix**: Use explicit `GRANT SELECT, INSERT, UPDATE, DELETE` per table.

### BUG-009: Service requirements not enforced at booking time
- **File**: `supabase/migrations/20260312000003_update_atomic_with_shifts.sql`
- **Problem**: `book_appointment_atomic()` does not check that the resource's capabilities match the service's `required_skills` or `required_resources`.
- **Impact**: A tire-rotation service can be booked on a resource that doesn't support tire rotation.
- **Fix**: Add capability validation to the RPC before inserting the appointment.

### BUG-010: No error boundaries in dashboard
- **Files**: `dashboard/app/page.tsx`, all view components
- **Problem**: No React error boundaries exist. Any unhandled exception in a view component crashes the entire app.
- **Impact**: Single component bug takes down the whole dashboard.
- **Fix**: Add error boundary wrapper around each view or at the layout level.

### BUG-011: No form validation in dashboard
- **Files**: All form components (CRMView, EmployeeManagementView, ServiceAssignmentView, etc.)
- **Problem**: No client-side validation. Inputs accept any value — empty strings, negative prices, invalid emails.
- **Impact**: Bad data reaches the backend and database.
- **Fix**: Add zod validation (already a dependency) at the form level.

### BUG-012: No token-based auth / session never expires
- **Files**: `dashboard/app/page.tsx`, `dashboard/lib/hooks.ts`
- **Problem**: Auth is plain localStorage (tenantId, userName). No JWT, no session expiry, no refresh mechanism, no CSRF protection, no logout on 401.
- **Impact**: Sessions live forever; stolen localStorage gives permanent access.
- **Fix**: Implement JWT with refresh tokens, expiry, and 401 auto-logout.

---

## Medium (Technical debt / hardening)

### BUG-013: Soft reservations never cleaned up
- **File**: `supabase/migrations/20260228000000_initial_schema.sql`
- **Problem**: `soft_reservations` table has `expires_at` but no scheduled job to purge expired rows.
- **Impact**: Dead rows accumulate indefinitely.
- **Fix**: Add a pg_cron job or application-level cleanup.

### BUG-014: Polymorphic p_assignment_id has no error handling
- **File**: `supabase/migrations/20260312000003_update_atomic_with_shifts.sql`
- **Problem**: `p_assignment_id` TEXT is parsed as UUID or INTEGER via regex (`is_uuid()`). Malformed input silently sets both to NULL.
- **Impact**: Appointment created with no assignment when intent was to assign.
- **Fix**: Return an error if p_assignment_id is provided but doesn't parse as either type.

### BUG-015: Mixed ID types across tables
- **Files**: Multiple migrations
- **Problem**: Services and employees use SERIAL (INTEGER), resources and users use UUID.
- **Impact**: Inconsistent API patterns, confusing joins, forces polymorphic parsing (BUG-014).
- **Fix**: Standardize on UUID for all primary keys (breaking change, plan carefully).

### BUG-016: Scheduling logic duplicated between Node and Deno
- **Files**: `src/core/scheduling.ts`, `supabase/functions/vapi-tools/core/scheduling.ts`
- **Problem**: `selectAssignments()` exists in both codebases with different shift-checking implementations.
- **Impact**: Bug fixes in one don't propagate to the other; behavior can diverge.
- **Fix**: Consolidate into a shared module or ensure Fastify delegates to the Deno/Postgres path.

### BUG-017: Fastify index.ts is an 800+ line monolith
- **File**: `src/index.ts`
- **Problem**: All routes, auth, CRUD, booking, analytics, knowledge ingestion in one file. No route modules, no middleware extraction.
- **Impact**: Hard to maintain, test, and review.
- **Fix**: Extract route groups into separate modules (routes/appointments.ts, routes/customers.ts, etc.).

### BUG-018: BookingService exists but is unused
- **Files**: `src/services/bookingService.ts`, `src/index.ts`
- **Problem**: A clean BookingService class was written but Fastify endpoints duplicate the logic inline instead of using it.
- **Impact**: Wasted abstraction; booking logic is scattered and inconsistent.
- **Fix**: Wire endpoints to use BookingService, or remove the dead code.

### BUG-019: Provider pattern wired but never used
- **Files**: `src/index.ts`, `src/providers/`, `src/core/providers.ts`
- **Problem**: TelephonyProvider, NotificationProvider, LlmProvider are instantiated but no endpoint ever calls them.
- **Impact**: Dead code that suggests features that don't work.
- **Fix**: Wire them into the booking flow or remove.

### BUG-020: No pagination on list endpoints
- **Files**: `dashboard/lib/api.ts`, `src/index.ts`
- **Problem**: All list endpoints return every row. No limit, offset, or cursor support.
- **Impact**: Performance degrades as data grows; large tenant = slow/OOM.
- **Fix**: Add pagination parameters to API and database queries.

### BUG-021: Badge component receives unsupported className prop
- **File**: `dashboard/components/AnalyticsView.tsx:73`
- **Problem**: `<Badge className="bg-green-100...">` but Badge component doesn't accept or forward className.
- **Impact**: Custom styling is silently ignored.
- **Fix**: Extend Badge props to accept className, or use the variant prop.

### BUG-022: full_name and first_name/last_name not kept in sync
- **Files**: `supabase/migrations/20260301000000_user_accounts.sql`, `20260305000000_users_split_name.sql`
- **Problem**: Users table has both `full_name` and `first_name`/`last_name`. No trigger keeps them in sync on updates.
- **Impact**: Data divergence after manual edits.
- **Fix**: Add an UPDATE trigger, or drop full_name in favor of computed column.

### BUG-023: Name splitting fails on 3+ word names
- **Files**: `supabase/migrations/20260304000010_split_names_and_address.sql`
- **Problem**: `split_part(name, ' ', 1)` for first_name, remainder for last_name. "Mary Jane Watson" -> first: "Mary", last: "Jane Watson".
- **Impact**: Incorrect name parsing for compound names.
- **Fix**: Only split on the last space, or let the UI collect first/last separately.

### BUG-024: getEmbedding() duplicated in two codebases
- **Files**: `src/index.ts`, `supabase/functions/vapi-tools/index.ts`
- **Problem**: Same OpenAI embedding API call implemented twice with slight differences.
- **Impact**: Maintenance burden; risk of divergent behavior.
- **Fix**: Extract to shared utility or accept the duplication given different runtimes (Node vs Deno).

### BUG-025: Silent mock data fallback in AppointmentView
- **File**: `dashboard/components/AppointmentView.tsx:160-164`
- **Problem**: When tenantId is missing, silently falls back to MOCK_APPOINTMENTS with no user indication.
- **Impact**: User sees fake data without knowing it's fake.
- **Fix**: Show a warning banner or refuse to render without a valid session.

---

## High (additional)

### BUG-026: No error handling if set_tenant_context() fails
- **File**: `supabase/functions/vapi-tools/db/repository.ts`
- **Problem**: If `set_tenant_context()` throws or silently fails, subsequent queries execute without tenant isolation.
- **Impact**: Queries could return data from all tenants or no data at all.
- **Fix**: Wrap in try/catch, verify the context was set, and abort the request on failure.

### BUG-027: Customer lookup/merge logic missing in booking flow
- **Files**: `supabase/migrations/20260312000003_update_atomic_with_shifts.sql`
- **Problem**: `book_appointment_atomic()` requires a `customer_id` but has no phone→customer upsert logic. The caller must create/find the customer separately.
- **Impact**: Voice AI must orchestrate a multi-step flow (find customer, then book) instead of a single atomic call. Race conditions possible between lookup and booking.
- **Fix**: Add optional phone/name parameters to the RPC with built-in upsert, or document the required two-step flow.

---

## Medium (additional)

### BUG-028: InMemoryBookingStorage has no conflict detection
- **File**: `src/storage/inMemoryBookingStorage.ts`
- **Problem**: Always returns a 60-minute slot starting at the requested time. No overlap checking — multiple appointments can be booked in the same slot.
- **Impact**: Backend tests using in-memory storage don't catch scheduling conflicts.
- **Fix**: Implement proper overlap detection, or remove the in-memory storage in favor of always using Postgres.

### BUG-029: WorkingHours vs Shift day-of-week format mismatch
- **Files**: `src/core/models.ts`, `supabase/migrations/20260312000002_employee_shifts.sql`
- **Problem**: `WorkingHours` type uses string keys (`"mon"`, `"tue"`) but `employee_shifts` table uses numeric `day_of_week` (0-6, 0=Sunday).
- **Impact**: Code converting between the two formats must handle the mapping manually; easy to introduce off-by-one bugs.
- **Fix**: Standardize on one format and add a conversion utility.

### BUG-030: call_transcript.customer_id nullable loses traceability
- **File**: `supabase/migrations/20260228000001_webhooks_and_logs.sql`
- **Problem**: `customer_id` on `call_transcripts` is nullable with `ON DELETE SET NULL`. If customer lookup fails during a call, the transcript is stored with no customer link.
- **Impact**: Orphaned transcripts can't be associated with customers later.
- **Fix**: Add a background job to re-link orphaned transcripts by matching phone/call_id.

### BUG-031: Customer timezone not respected in availability checks
- **Files**: `supabase/functions/vapi-tools/core/service.ts`, `supabase/functions/vapi-tools/db/repository.ts`
- **Problem**: Availability checks don't convert time windows to the customer's timezone. A customer in Pacific time asking for "9 AM" gets UTC 9 AM.
- **Impact**: Appointments booked at wrong times for customers in non-UTC timezones.
- **Fix**: Accept timezone in availability requests and convert before querying.

### BUG-032: call_summaries.embedding likely always NULL
- **Files**: `supabase/migrations/20260228000001_webhooks_and_logs.sql`, `n8n/post_call_summarizer.json`
- **Problem**: The n8n post-call summarizer generates a text summary but doesn't call the OpenAI embeddings API to populate the `embedding` vector column.
- **Impact**: Semantic search over call summaries will return no results.
- **Fix**: Add an embedding generation step to the n8n workflow after summarization.

### BUG-033: Calendar sync Outlook branch is empty, no token refresh
- **Files**: `n8n/calendar_sync.json`, `supabase/migrations/20260312000004_calendar_sync_schema.sql`
- **Problem**: The n8n calendar sync workflow routes to Google or Outlook, but the Outlook branch has no implementation. Neither branch handles OAuth token refresh.
- **Impact**: Outlook calendar sync doesn't work. Google sync breaks when access tokens expire.
- **Fix**: Implement Outlook branch; add token refresh logic before API calls.

### BUG-034: notify_n8n_on_appointment trigger is a placeholder
- **File**: `supabase/migrations/20260228000001_webhooks_and_logs.sql`
- **Problem**: The trigger function only does `RAISE NOTICE` — it doesn't actually call the n8n webhook.
- **Impact**: No async workflows fire on appointment creation (no summaries, no calendar sync, no SMS).
- **Fix**: Implement the HTTP call via `pg_net` extension, or rely on Supabase Database Webhooks instead.

### BUG-035: Promise.all in useStaticData — one failure kills all fetches
- **File**: `dashboard/lib/hooks.ts`
- **Problem**: `Promise.all([customers, resources, employees, services])` — if any single fetch fails, the entire hook errors out and no data loads.
- **Impact**: A transient error on one endpoint (e.g., employees) prevents appointments and customers from loading too.
- **Fix**: Use `Promise.allSettled()` and handle partial failures gracefully.

### BUG-036: skill property accessed in useStaticData but never populated
- **File**: `dashboard/lib/hooks.ts`
- **Problem**: The hook references a `skill` property in its return or internal logic but never fetches from the `/skills` endpoint.
- **Impact**: Skill-dependent UI may show empty/undefined values.
- **Fix**: Add `Api.skills.list(tenantId)` to the parallel fetch, or remove the reference.

### BUG-037: No audit logging
- **Files**: All migration files, `src/index.ts`
- **Problem**: No audit trail for who created, modified, or deleted records. No `updated_by`, `created_by`, or change history table.
- **Impact**: No accountability; impossible to investigate data issues or unauthorized changes.
- **Fix**: Add audit trigger functions or an `audit_log` table with before/after snapshots.

### BUG-038: No soft deletes on core tables
- **Files**: All migration files
- **Problem**: DELETE operations are hard deletes with cascading. Deleting a tenant cascades to all their data.
- **Impact**: Accidental deletion is irreversible. No way to recover or "undo".
- **Fix**: Add `is_deleted BOOLEAN DEFAULT FALSE` and `deleted_at TIMESTAMPTZ` columns; filter in queries.

### BUG-039: No accessibility — ARIA labels missing throughout dashboard
- **Files**: All dashboard view components
- **Problem**: Interactive elements (buttons, modals, form inputs, navigation) lack `aria-label`, `aria-describedby`, `role`, and other ARIA attributes.
- **Impact**: Screen readers can't navigate the app; fails WCAG compliance.
- **Fix**: Add ARIA attributes to all interactive elements, especially modals, navigation, and form controls.

---

## Low

### BUG-040: Service duration_minutes not used to auto-calculate end_time
- **Files**: `supabase/migrations/20260308000000_create_services.sql`, booking flow
- **Problem**: Services define `duration_minutes` but appointments use independently-set `start_time` and `end_time`. No logic auto-calculates `end_time = start_time + duration`.
- **Impact**: A 30-minute service can be booked in a 2-hour slot, wasting capacity.
- **Fix**: Default `end_time` to `start_time + service.duration_minutes` when not explicitly provided.

### BUG-041: Seed data uses hardcoded UUIDs — not idempotent
- **File**: `supabase/seed.sql`
- **Problem**: Uses fixed UUIDs like `f234e471-0e60-4163-86c9-93cfd9338e3a`. Re-running seed fails on unique constraint violations.
- **Impact**: Can't re-seed without wiping the database first.
- **Fix**: Use `ON CONFLICT DO NOTHING` or `INSERT ... ON CONFLICT DO UPDATE`.

### BUG-042: business_templates voice IDs hardcoded in migrations
- **File**: `supabase/migrations/20260228000006_business_templates.sql`
- **Problem**: ElevenLabs/Cartesia voice IDs are embedded directly in SQL migration data.
- **Impact**: Voice IDs can't be changed without a new migration; different environments may need different voices.
- **Fix**: Move voice IDs to a config table or environment variables.

### BUG-043: No request debouncing on rapid actions
- **File**: `dashboard/components/SkillMatrixView.tsx`
- **Problem**: Toggling skill assignments sends an API request on every click with no debounce.
- **Impact**: Rapid clicking sends many concurrent requests; potential race conditions and server load.
- **Fix**: Debounce toggle actions (300-500ms) or batch changes with a save button.

### BUG-044: Zod validation happens twice in edge function
- **Files**: `supabase/functions/vapi-tools/index.ts`, `supabase/functions/vapi-tools/core/dispatcher.ts`
- **Problem**: Request payloads are validated with Zod at the HTTP entry point and again inside the dispatcher.
- **Impact**: Minor performance overhead; maintenance burden keeping two schemas in sync.
- **Fix**: Validate once at the entry point and pass typed objects downstream.

### BUG-045: No global state management in dashboard
- **Files**: `dashboard/app/page.tsx`, all view components
- **Problem**: Auth/session state lives in localStorage and page-level useState. No Context, Zustand, or Redux. Data is prop-drilled through views.
- **Impact**: Complex state sharing between views requires lifting state to page.tsx; doesn't scale well.
- **Fix**: Introduce React Context for auth/session at minimum; consider Zustand for shared data.

---

## Medium (additional)

### BUG-046: DST transitions not handled in shift validation
- **File**: `supabase/migrations/20260312000003_update_atomic_with_shifts.sql`
- **Problem**: Shift validation converts times to a fixed timezone but doesn't account for daylight saving time transitions. A shift defined as 9 AM–5 PM effectively shifts by an hour twice a year.
- **Impact**: During DST transitions, employees may be booked outside their actual working hours or rejected during valid hours.
- **Fix**: Use timezone-aware time comparisons that account for DST, or store shifts in UTC with explicit DST handling.

### BUG-047: ShiftManagementView has no edit or delete for existing shifts
- **File**: `dashboard/components/ShiftManagementView.tsx`
- **Problem**: The UI only supports creating new shifts. There is no way to edit a shift's times or delete a shift from the interface.
- **Impact**: Managers must delete and recreate shifts to make changes; no delete means shifts can only accumulate.
- **Fix**: Add edit and delete actions to shift pills in the week view.

### BUG-048: CRM activity history fetched but never rendered
- **File**: `dashboard/components/CRMView.tsx`
- **Problem**: Customer history/timeline data is fetched from the API but the results are never displayed in the component.
- **Impact**: The CRM appears to lack history even though the data is being retrieved.
- **Fix**: Render the fetched history data in a timeline section within the customer detail pane.

### BUG-049: Vapi agent.json has hardcoded tenant ID and date
- **File**: `vapi/agent.json`
- **Problem**: The system prompt contains a hardcoded tenant ID and a static "today's date" string rather than being dynamically generated.
- **Impact**: Agent config only works for one tenant (DynaTire) and the date becomes stale immediately.
- **Fix**: Use `agent.template.json` with placeholder substitution at deploy time, or inject via Vapi's server URL dynamic config.

### BUG-050: Knowledge ingestion uses naive chunking
- **File**: `scripts/ingest-knowledge.ts`
- **Problem**: Documents are split on double newlines (`\n\n`). This loses context at chunk boundaries and produces inconsistent chunk sizes.
- **Impact**: RAG search quality suffers — relevant information may be split across chunks, reducing semantic match accuracy.
- **Fix**: Use overlapping sliding window chunking or a sentence-aware splitter with configurable chunk size.

### BUG-051: No duplicate detection in knowledge ingestion
- **File**: `scripts/ingest-knowledge.ts`
- **Problem**: Re-ingesting the same document creates duplicate rows in `tenant_docs`. No check for existing content or source file.
- **Impact**: Duplicate chunks inflate storage, distort similarity rankings, and return redundant results.
- **Fix**: Check for existing rows by `(tenant_id, source, section)` before inserting, or delete existing chunks for the same source before re-ingesting.

---

## Low (additional)

### BUG-052: JSONB metadata fields have no schema validation
- **Files**: `supabase/migrations/20260228000000_initial_schema.sql`
- **Problem**: `customers.metadata` and `appointments.metadata` are untyped JSONB columns with no CHECK constraint or application-level schema validation.
- **Impact**: Inconsistent data shapes across records; hard to query or rely on specific keys.
- **Fix**: Define expected JSON structure in application code (zod schema) and optionally add a Postgres CHECK constraint.

### BUG-053: appointments.call_id has no foreign key constraint
- **File**: `supabase/migrations/20260228000000_initial_schema.sql`
- **Problem**: `appointments.call_id` is a TEXT column with no FK to `call_transcripts.call_id` or any other table.
- **Impact**: Referential integrity not enforced; orphaned references possible.
- **Fix**: Add a FK constraint to `call_transcripts.call_id`, or accept it as a loose correlation ID and document that.

### BUG-054: @supabase/supabase-js imported in dashboard but unused
- **File**: `dashboard/lib/supabase.ts`, `dashboard/package.json`
- **Problem**: The Supabase JS client is installed and initialized but the dashboard uses the custom Fastify API client (`lib/api.ts`) for all data access.
- **Impact**: Unnecessary dependency; potential confusion about which client to use.
- **Fix**: Remove the dependency and `supabase.ts` file, or migrate API calls to use it directly.

### BUG-055: Dashboard has no structured logging
- **Files**: All dashboard view components
- **Problem**: Error handling uses `console.error()` throughout. No structured logging, no log levels, no correlation IDs.
- **Impact**: Debugging production issues requires searching raw console output with no context.
- **Fix**: Add a lightweight logger utility with structured output, or integrate a service like Sentry for error tracking.

### BUG-056: Dark mode has no system preference detection on first load
- **File**: `dashboard/components/OutlookLayout.tsx`
- **Problem**: Theme is read from localStorage only. On first visit (no localStorage value), the app defaults to light mode regardless of the user's OS preference.
- **Impact**: Users with OS-level dark mode see a flash of light mode on first visit.
- **Fix**: Check `window.matchMedia('(prefers-color-scheme: dark)')` as fallback when localStorage has no value.

### BUG-057: Timezone detection covers only ~10 cities
- **File**: `dashboard/lib/constants.ts`
- **Problem**: `CITY_TIMEZONE_MAP` only contains about 10 hardcoded city→timezone mappings for auto-detection.
- **Impact**: Most US cities don't auto-detect; customers in unlisted cities must manually select timezone.
- **Fix**: Use a proper timezone lookup library, or expand the map to cover major metro areas per timezone.

### BUG-058: Appointment type has field duplication
- **File**: `dashboard/lib/types.ts`
- **Problem**: The `Appointment` type has both a `name` field and a nested `customers.name` field representing the same data.
- **Impact**: Ambiguity about which field is authoritative; risk of displaying stale data if one is updated but not the other.
- **Fix**: Remove the redundant `name` field from Appointment and always read from the joined customer record.
