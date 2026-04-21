## Ideas — 2026-04-20 (architecture reviewed)

### Task: Replace the placeholder /analytics/stats route with an explicit temporary contract
**Status:** proposed
**Files to change:** `src/routes/analytics.ts:L8-L12`
**What to do:** Remove the empty wrapped handler body for `POST /analytics/stats` and replace it with either an explicit stub response or route removal until real analytics logic exists. Keep the choice narrow and intentional, but stop exposing a route that currently communicates no meaningful contract.
**Done when:**
- [ ] `/analytics/stats` no longer points at an empty handler body
- [ ] The route either returns an explicit temporary response or is removed from registration
- [ ] Any callers/tests reflect the chosen temporary contract
- [ ] All existing tests pass, new tests cover the chosen behavior if needed
**Why it matters:** Placeholder endpoints create architectural ambiguity and make it harder to tell whether a workflow is unfinished or malfunctioning.
**Tradeoff:** A stub keeps intent visible but adds a temporary contract to maintain; removal is cleaner but may require caller cleanup.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it removes ambiguity from a currently non-functional endpoint.

### Task: Move coverage date parsing in analytics routes onto shared route helpers
**Status:** proposed
**Files to change:** `src/routes/analytics.ts:L14-L30`, `src/routes/routeHelpers.ts:L1-L160`
**What to do:** Replace the local `DATE_RE`, `start_date`, and `end_date` parsing in `/coverage` with the shared date-range helper path already used elsewhere in the backend. Preserve current defaults and null end-date behavior, but stop carrying one-off parsing inside this route file.
**Done when:**
- [ ] The coverage route no longer defines its own local date regex and parsing logic
- [ ] Shared helper parsing preserves current start/end defaults
- [ ] Coverage responses remain unchanged for the same query inputs
- [ ] All existing tests pass, new tests cover coverage query parsing if needed
**Why it matters:** Shared parsing rules are already a backend convention here, and local parsing branches make subtle drift more likely over time.
**Tradeoff:** The helper reuse should stay behavior-preserving and not force analytics-specific concerns into a generic parser.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, solid gain because it aligns another route with the codebase’s shared parsing conventions.

### Task: Extract coverage staffing row grouping into a dedicated transformer helper
**Status:** proposed
**Files to change:** `src/routes/analytics.ts:L32-L86`
**What to do:** Pull the manual `Map`-based grouping and dedupe logic used by `/coverage/staffing` into a small route-local transformer helper that accepts the query rows and returns the final service staffing payload. Keep SQL and response shape unchanged, but separate row shaping from route orchestration.
**Done when:**
- [ ] `/coverage/staffing` no longer inlines the full row-grouping and dedupe loop
- [ ] The extracted helper returns the same grouped service payload shape as today
- [ ] Duplicate employee/shift suppression still works exactly the same way
- [ ] All existing tests pass, new tests cover the staffing transformer behavior if added
**Why it matters:** Mixed SQL, grouping, and reply handling makes route handlers harder to scan and test than they need to be.
**Tradeoff:** The helper should stay route-specific and focused on data shaping, not become a generic aggregation abstraction.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it simplifies one of the denser handlers without changing behavior.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 0
**What's working:** The instructions handled the reset state cleanly, the missing root logs were detected before writing, and the workflow still produced a bounded first batch instead of assuming old history was present.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The existing process already says to create the output files if missing, which was the only adjustment needed here.

## Ideas — 2026-04-20 (developer experience reviewed)

### Task: Rename ScheduleEntry or explicitly document its distinction from EffectiveShift
**Status:** proposed
**Files to change:** `dashboard/lib/types.ts:L90-L130`, any scheduler or wizard callers using `ScheduleEntry`
**What to do:** Resolve the overlap between `ScheduleEntry` and the date-based shift types around it by either renaming `ScheduleEntry` to match the override terminology already used elsewhere or documenting why it represents a different concept. Keep runtime behavior unchanged.
**Done when:**
- [ ] The distinction between `ScheduleEntry` and `EffectiveShift` is explicit and easy to understand
- [ ] Type names or comments align better with the dashboard’s date-based scheduling terminology
- [ ] Existing call sites compile cleanly after the clarification
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** Scheduling is already a high-complexity area, and ambiguous type names make safe changes harder than they need to be.
**Tradeoff:** Renaming shared types creates a small ripple, so the cleanup should stay tightly scoped to genuine ambiguity.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it clarifies a confusing core type without changing behavior.

### Task: Introduce named appointment request payload types in dashboard/lib/types.ts and use them in Api.appointments
**Status:** proposed
**Files to change:** `dashboard/lib/types.ts:L1-L120`, `dashboard/lib/api.ts:L120-L220`
**What to do:** Add explicit request interfaces for appointment create and update payloads in `dashboard/lib/types.ts`, then replace the current broad appointment helper signatures in `Api.appointments` so they use those named types instead of loose composite payloads. Keep runtime behavior unchanged.
**Done when:**
- [ ] Appointment create/update request payloads have named shared types
- [ ] `Api.appointments.create` and `Api.appointments.update` stop relying on broad intersection payload types
- [ ] Existing call sites compile cleanly or reveal legitimate typing gaps that are fixed locally
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** Appointment mutations sit on a hot path, and broad payload typing weakens the strongest safety tool the dashboard has, strict TypeScript.
**Tradeoff:** Tightening the signatures may expose a few sloppy callers, so there can be a modest cleanup cost.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, strong return because it improves safety and readability at a central dashboard API boundary.

### Task: Add a shared appointment display model for customer/resource label fallback rules
**Status:** proposed
**Files to change:** `dashboard/lib/types.ts:L1-L120`, appointment-facing components such as `dashboard/components/AppointmentListSidebar.tsx:L1-L220`, `dashboard/components/AppointmentDetailPanel.tsx:L1-L260`, and scheduler appointment surfaces if applicable
**What to do:** Define a small shared display contract or helper type for appointment-facing customer/resource labels so UI code stops reasoning directly about multiple overlapping name shapes, nested `customers` objects, and legacy `name` fields in each component. Keep API payloads unchanged.
**Done when:**
- [ ] Appointment-facing UI shares one explicit display-data contract for customer/resource label fallback
- [ ] Legacy label fallback behavior is defined in one place
- [ ] The change stays scoped to appointment-facing display concerns rather than broad entity rewrites
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** Repeated ad hoc label fallback logic makes appointment UI code harder to keep consistent across list-detail and scheduler surfaces.
**Tradeoff:** The display model should stay thin and view-focused so it does not become a second entity layer.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it reduces repetitive field ambiguity across several important appointment surfaces.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The recreated root logs are stable again, and this cycle cleanly resumed the intended small-batch rhythm instead of getting derailed by the earlier file reset.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already handle missing-file recovery and normal continuation well enough, so there is no strong reason to tweak them.

## Ideas — 2026-04-20 (code patterns reviewed)

### Task: Replace resource route validation branches with sendValidationError
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L20-L70`, `src/routes/routeHelpers.ts:L1-L40`
**What to do:** Swap the inline validation-failure branches in resource create and update to use `sendValidationError`, keeping the response payload exactly the same while removing repeated envelope boilerplate from the route file.
**Done when:**
- [ ] Resource create uses `sendValidationError` for schema parse failures
- [ ] Resource update uses `sendValidationError` for schema parse failures
- [ ] Validation response payloads remain unchanged for callers
- [ ] All existing tests pass, new tests cover validation-failure behavior if needed
**Why it matters:** Shared response helpers only help if routes adopt them, and this CRUD file still repeats the same validation envelope manually.
**Tradeoff:** This is a narrow cleanup, so it should stay scoped to the resource file rather than triggering a broad rewrite.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it makes a representative CRUD route more consistent immediately.

### Task: Pilot sendSuccess adoption in resource mutation routes
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L40-L110`, `src/routes/routeHelpers.ts:L20-L40`
**What to do:** Replace a few direct `reply.send({ success: true, ... })` responses in resource mutations with `sendSuccess`, confirming the helper fits real CRUD usage without changing payload shape. Keep the rollout selective and behavior-preserving.
**Done when:**
- [ ] Selected resource mutation responses use `sendSuccess`
- [ ] Response payloads remain unchanged for callers
- [ ] The route stays readable and helper use does not feel forced
- [ ] All existing tests pass, new tests cover any helper-adopted paths if needed
**Why it matters:** Shared success helpers only become meaningful once a few real routes prove they improve clarity without hurting readability.
**Tradeoff:** Some responses may still read better inline, so the rollout should stay narrow and pragmatic.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it tests a shared helper under realistic CRUD conditions.

### Task: Extract resource update field assembly into a tiny local helper
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L55-L95`
**What to do:** Pull the dynamic field/value assembly used by resource update into a small local helper that returns the set clause inputs or a no-fields error. Keep the SQL and behavior unchanged, but make the route easier to scan by separating update-field shaping from query execution.
**Done when:**
- [ ] Resource update no longer inlines all mutable field collection logic inside the query callback
- [ ] The helper stays local and focused on optional-field assembly rather than generic SQL generation
- [ ] Existing no-updatable-fields behavior remains unchanged
- [ ] All existing tests pass, new tests cover field assembly behavior if needed
**Why it matters:** Optional-field update logic is easy to misread and subtly break when field lists change over time.
**Tradeoff:** The helper should stay small and route-local so it clarifies the code instead of over-abstracting it.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it improves readability in a bug-prone pattern without changing semantics.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The rebuilt root logs are still behaving predictably, and this cycle stayed grounded by pairing a practical CRM/admin UX slice with one fully readable CRUD route instead of forcing broader synthesis from partial reads.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still steering the work toward specific, low-drift outputs without extra tuning.

## Ideas — 2026-04-20 (architecture reviewed)

### Task: Normalize requireTenantId onto the standard API error envelope
**Status:** proposed
**Files to change:** `src/middleware.ts:L105-L125`, route tests covering missing-tenant responses
**What to do:** Update `requireTenantId` so its 400 response uses the same `{ success: false, error: ... }` shape already used by `requireAuth` and `withHandler`. Keep the status code unchanged and limit the change to middleware-level consistency.
**Done when:**
- [ ] `requireTenantId` returns `{ success: false, error: 'tenant_id is required' }`
- [ ] Missing-tenant failures still use status 400
- [ ] Routes relying on `requireTenantId` continue behaving the same aside from the normalized error body
- [ ] All existing tests pass, new tests cover the missing-tenant response contract if needed
**Why it matters:** Shared guard behavior should be consistent so the frontend does not need special cases for one of the most common middleware failures.
**Tradeoff:** Any code depending on the bare `{ error }` shape needs to be checked before the contract is normalized.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it normalizes a central middleware response used across many routes.

### Task: Extract tenant extraction precedence into a named helper inside middleware.ts
**Status:** proposed
**Files to change:** `src/middleware.ts:L145-L190`
**What to do:** Pull the query/body/auth tenant lookup precedence into a small local helper, then have `tenantMiddleware` call it before logger enrichment. Preserve the existing query > body > auth precedence exactly while making the rule easier to read and test.
**Done when:**
- [ ] Tenant extraction precedence no longer lives inline inside `tenantMiddleware`
- [ ] Query > body > auth precedence remains unchanged
- [ ] `tenantMiddleware` reads more clearly around exemption check, extraction, and logger enrichment
- [ ] All existing tests pass, new tests cover precedence behavior if needed
**Why it matters:** Middleware precedence rules are subtle shared behavior, and naming them explicitly makes future changes less risky.
**Tradeoff:** The helper should stay local and obvious so it does not over-engineer a simple path.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it improves readability in a shared, easy-to-misread path.

### Task: Add a tiny shared guard-response helper for middleware auth and tenant failures
**Status:** proposed
**Files to change:** `src/middleware.ts:L105-L140`
**What to do:** Introduce one small internal helper for common middleware guard failures so `requireTenantId` and `requireAuth` stop assembling their reply bodies independently. Keep status codes and messages unchanged except where intentionally normalized.
**Done when:**
- [ ] `requireTenantId` and `requireAuth` share a small response-emission helper
- [ ] Guard messages and status codes remain unchanged unless deliberately normalized
- [ ] The helper stays local to middleware guard concerns and does not turn into a generic response abstraction
- [ ] All existing tests pass, new tests cover helper-driven guard responses if needed
**Why it matters:** Small shared guard helpers make it easier to evolve middleware response conventions consistently later.
**Tradeoff:** The helper must stay extremely small so it clarifies rather than hides straightforward logic.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it trims duplication in a central guard layer.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The rebuilt root logs are still continuing cleanly, and this cycle stayed grounded by pairing a practical recovery/customer UX slice with one fully readable shared backend layer.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current workflow is still producing specific, low-drift outputs without wasted cycles or obvious repetition pressure.

## Ideas — 2026-04-20 (architecture reviewed)

### Task: Replace duplicated provider arrays in syncOrchestrator with a single capability registry
**Status:** proposed
**Files to change:** `src/services/syncOrchestrator.ts:L1-L80`
**What to do:** Introduce one explicit provider registry that records whether each integration participates in appointment sync, customer sync, or both, then derive both fan-out loops from that registry. Preserve current ordering and behavior exactly, but eliminate the need to maintain support rules in two separate arrays.
**Done when:**
- [ ] Provider support is declared in one registry instead of separate appointment/customer arrays
- [ ] `syncAppointmentToAll` and `syncCustomerToAll` derive their loops from that registry
- [ ] Current provider order and function selection remain unchanged
- [ ] All existing tests pass, new tests cover registry-driven fan-out if needed
**Why it matters:** Central integration rules become brittle when support declarations live in more than one place.
**Tradeoff:** The registry should stay explicit and small so it improves clarity rather than adding abstraction noise.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, strong return because it removes a clear source of integration drift from a shared service.

### Task: Extract shared fan-out execution into a local helper inside syncOrchestrator
**Status:** proposed
**Files to change:** `src/services/syncOrchestrator.ts:L18-L80`
**What to do:** Pull the repeated provider iteration and catch-log pattern into a narrow local helper that accepts provider entries plus entity metadata, then use it for both appointment and customer fan-out. Preserve the current fire-and-forget semantics exactly.
**Done when:**
- [ ] Appointment and customer sync functions no longer each inline the same provider loop-and-catch pattern
- [ ] `logSyncError` usage and non-throwing behavior remain unchanged
- [ ] The helper stays local and specific to sync orchestration behavior
- [ ] All existing tests pass, new tests cover helper-driven fan-out if needed
**Why it matters:** Repeated orchestration mechanics make it harder to see the actual domain differences between the two sync paths.
**Tradeoff:** The helper must stay very small so the file remains easy to audit.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it trims repetition from a central integration file.

### Task: Add lightweight fan-out start logs to syncOrchestrator without provider-level success noise
**Status:** proposed
**Files to change:** `src/services/syncOrchestrator.ts:L1-L80`
**What to do:** Emit one structured start log at the beginning of appointment and customer fan-out when a logger is available, while keeping the current provider failure logs unchanged. Avoid adding per-provider success logs.
**Done when:**
- [ ] Appointment fan-out emits one structured start log when a logger exists
- [ ] Customer fan-out emits one structured start log when a logger exists
- [ ] Existing provider-level failure logging remains unchanged
- [ ] No noisy provider success logs are introduced
- [ ] All existing tests pass, new tests cover logger invocation if needed
**Why it matters:** Fire-and-forget orchestration is otherwise mostly invisible when nothing fails, which makes operational tracing harder.
**Tradeoff:** Even sparse logs add some noise, so the extra visibility should stay limited to high-value start events.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it improves observability in a mostly silent integration path.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The rebuilt root logs are still supporting clean continuation, and this cycle stayed concrete by pairing a straightforward UX trio with one fully readable shared service instead of stretching across clipped files.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing specific, useful outputs without wasted motion or obvious repetition pressure.

## Ideas — 2026-04-20 (code patterns reviewed)

### Task: Replace resource route validation branches with sendValidationError
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L20-L70`, `src/routes/routeHelpers.ts:L1-L40`
**What to do:** Swap the inline validation-failure branches in resource create and update to use `sendValidationError`, keeping the response payload exactly the same while removing repeated validation envelope boilerplate from the route file.
**Done when:**
- [ ] Resource create uses `sendValidationError` for schema parse failures
- [ ] Resource update uses `sendValidationError` for schema parse failures
- [ ] Validation response payloads remain unchanged for callers
- [ ] All existing tests pass, new tests cover validation-failure behavior if needed
**Why it matters:** Shared helper conventions only help if real CRUD routes adopt them, and this file still repeats the same envelope manually.
**Tradeoff:** This is a narrow consistency cleanup, so it should stay scoped to the resource file rather than prompting a broad rewrite.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it makes a representative CRUD route more consistent immediately.

### Task: Pilot sendSuccess adoption in resource mutation routes
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L40-L110`, `src/routes/routeHelpers.ts:L20-L40`
**What to do:** Replace a few direct `reply.send({ success: true, ... })` responses in resource mutations with `sendSuccess`, confirming the helper fits real CRUD usage without changing payload shape. Keep the rollout selective and behavior-preserving.
**Done when:**
- [ ] Selected resource mutation responses use `sendSuccess`
- [ ] Response payloads remain unchanged for callers
- [ ] The route stays readable and helper use does not feel forced
- [ ] All existing tests pass, new tests cover any helper-adopted paths if needed
**Why it matters:** It is hard to know whether a shared success helper is genuinely useful unless a few real routes prove it in practice.
**Tradeoff:** Some responses may still read better inline, so the rollout should stay narrow and pragmatic.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it tests a shared helper under realistic CRUD conditions.

### Task: Extract resource update field assembly into a tiny local helper
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L55-L95`
**What to do:** Pull the dynamic field/value assembly used by resource update into a small local helper that returns the set-clause inputs or throws the same no-fields error. Keep SQL behavior unchanged, but make the route easier to scan by separating update-field shaping from query execution.
**Done when:**
- [ ] Resource update no longer inlines all mutable field collection logic inside the query callback
- [ ] The helper stays local and focused on optional-field assembly rather than generic SQL generation
- [ ] Existing no-updatable-fields behavior remains unchanged
- [ ] All existing tests pass, new tests cover field assembly behavior if needed
**Why it matters:** Optional-field update logic is easy to misread and subtly break when fields change over time.
**Tradeoff:** The helper should stay small and route-local so it clarifies the code instead of over-abstracting it.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it improves readability in a bug-prone pattern without changing semantics.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The rebuilt root log is still continuing cleanly, and this cycle stayed grounded by pairing a practical account/team UX slice with one fully readable CRUD route rather than stretching across clipped files.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still steering the work toward specific, low-drift outputs without extra tuning.

## Ideas — 2026-04-20 (architecture reviewed)

### Task: Replace duplicated provider arrays in syncOrchestrator with a single capability registry
**Status:** proposed
**Files to change:** `src/services/syncOrchestrator.ts:L1-L80`
**What to do:** Introduce one explicit provider registry that records whether each integration participates in appointment sync, customer sync, or both, then derive both fan-out loops from that registry. Preserve current ordering and behavior exactly, but eliminate the need to maintain support rules in two separate arrays.
**Done when:**
- [ ] Provider support is declared in one registry instead of separate appointment/customer arrays
- [ ] `syncAppointmentToAll` and `syncCustomerToAll` derive their loops from that registry
- [ ] Current provider order and function selection remain unchanged
- [ ] All existing tests pass, new tests cover registry-driven fan-out if needed
**Why it matters:** Central integration rules become brittle when support declarations live in more than one place.
**Tradeoff:** The registry should stay explicit and small so it improves clarity rather than adding abstraction noise.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, strong return because it removes a clear source of integration drift from a shared service.

### Task: Extract shared fan-out execution into a local helper inside syncOrchestrator
**Status:** proposed
**Files to change:** `src/services/syncOrchestrator.ts:L18-L80`
**What to do:** Pull the repeated provider iteration and catch-log pattern into a narrow local helper that accepts provider entries plus entity metadata, then use it for both appointment and customer fan-out. Preserve the current fire-and-forget semantics exactly.
**Done when:**
- [ ] Appointment and customer sync functions no longer each inline the same provider loop-and-catch pattern
- [ ] `logSyncError` usage and non-throwing behavior remain unchanged
- [ ] The helper stays local and specific to sync orchestration behavior
- [ ] All existing tests pass, new tests cover helper-driven fan-out if needed
**Why it matters:** Repeated orchestration mechanics make it harder to see the actual domain differences between the two sync paths.
**Tradeoff:** The helper must stay very small so the file remains easy to audit.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it trims repetition from a central integration file.

### Task: Add lightweight fan-out start logs to syncOrchestrator without provider-level success noise
**Status:** proposed
**Files to change:** `src/services/syncOrchestrator.ts:L1-L80`
**What to do:** Emit one structured start log at the beginning of appointment and customer fan-out when a logger is available, while keeping the current provider failure logs unchanged. Avoid adding per-provider success logs.
**Done when:**
- [ ] Appointment fan-out emits one structured start log when a logger exists
- [ ] Customer fan-out emits one structured start log when a logger exists
- [ ] Existing provider-level failure logging remains unchanged
- [ ] No noisy provider success logs are introduced
- [ ] All existing tests pass, new tests cover logger invocation if needed
**Why it matters:** Fire-and-forget orchestration is otherwise mostly invisible when nothing fails, which makes operational tracing harder.
**Tradeoff:** Even sparse logs add some noise, so the extra visibility should stay limited to high-value start events.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it improves observability in a mostly silent integration path.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The rebuilt root logs are still continuing cleanly, and this cycle stayed grounded by pairing a focused onboarding slice with one fully readable shared service rather than stretching across clipped backend files.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing specific, useful outputs without wasted motion or obvious repetition pressure.

## Ideas — 2026-04-20 (architecture reviewed)

### Task: Normalize requireTenantId onto the standard API error envelope
**Status:** proposed
**Files to change:** `src/middleware.ts:L105-L125`, route tests covering missing-tenant responses
**What to do:** Update `requireTenantId` so its 400 response uses the same `{ success: false, error: ... }` shape already used by `requireAuth` and `withHandler`. Keep the status code unchanged and limit the change to middleware-level consistency.
**Done when:**
- [ ] `requireTenantId` returns `{ success: false, error: 'tenant_id is required' }`
- [ ] Missing-tenant failures still use status 400
- [ ] Routes relying on `requireTenantId` continue behaving the same aside from the normalized error body
- [ ] All existing tests pass, new tests cover the missing-tenant contract if needed
**Why it matters:** Shared guard behavior should be consistent so the frontend does not need special cases for one common middleware failure.
**Tradeoff:** Any code depending on the bare `{ error }` shape needs to be checked before the contract is normalized.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it normalizes a central middleware response used across many routes.

### Task: Extract tenant extraction precedence into a named helper inside middleware.ts
**Status:** proposed
**Files to change:** `src/middleware.ts:L145-L190`
**What to do:** Pull the query/body/auth tenant lookup precedence into a small local helper, then have `tenantMiddleware` call it before logger enrichment. Preserve the existing query > body > auth precedence exactly while making the rule easier to read and test.
**Done when:**
- [ ] Tenant extraction precedence no longer lives inline inside `tenantMiddleware`
- [ ] Query > body > auth precedence remains unchanged
- [ ] `tenantMiddleware` reads more clearly around exemption check, extraction, and logger enrichment
- [ ] All existing tests pass, new tests cover precedence behavior if needed
**Why it matters:** Middleware precedence rules are subtle shared behavior, and naming them explicitly makes future changes less risky.
**Tradeoff:** The helper should stay local and obvious so it does not over-engineer a simple path.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it improves readability in a shared, easy-to-misread path.

### Task: Add a tiny shared guard-response helper for middleware auth and tenant failures
**Status:** proposed
**Files to change:** `src/middleware.ts:L105-L140`
**What to do:** Introduce one small internal helper for common middleware guard failures so `requireTenantId` and `requireAuth` stop assembling their reply bodies independently. Keep status codes and messages unchanged except where intentionally normalized.
**Done when:**
- [ ] `requireTenantId` and `requireAuth` share a small response-emission helper
- [ ] Guard messages and status codes remain unchanged unless deliberately normalized
- [ ] The helper stays local to middleware guard concerns and does not turn into a generic response abstraction
- [ ] All existing tests pass, new tests cover helper-driven guard responses if needed
**Why it matters:** Small shared guard helpers make it easier to evolve middleware response conventions consistently later.
**Tradeoff:** The helper must stay extremely small so it clarifies rather than hides straightforward logic.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it trims duplication in a central guard layer.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The rebuilt root logs are still continuing predictably, and this cycle stayed concrete by pairing a focused wizard-finishing slice with one fully readable shared backend layer.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current workflow is still producing specific, low-drift outputs and does not yet look stale enough to justify instruction churn.

## Ideas — 2026-04-20 (code patterns reviewed)

### Task: Replace service route validation branches with sendValidationError
**Status:** proposed
**Files to change:** `src/routes/services.ts:L20-L90`, `src/routes/routeHelpers.ts:L1-L40`
**What to do:** Swap the inline validation-failure branches in service create and update to use `sendValidationError`, keeping the response payload exactly the same while removing repeated validation envelope boilerplate from the route file.
**Done when:**
- [ ] Service create uses `sendValidationError` for schema parse failures
- [ ] Service update uses `sendValidationError` for schema parse failures
- [ ] Validation response payloads remain unchanged for callers
- [ ] All existing tests pass, new tests cover validation-failure behavior if needed
**Why it matters:** Shared helper conventions only pay off if real CRUD routes adopt them, and this file still repeats the same validation envelope manually.
**Tradeoff:** This is a narrow consistency cleanup, so it should stay scoped to the service file rather than triggering a broad rewrite.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it makes a central CRUD route more consistent immediately.

### Task: Normalize service create payload defaults before the insert query
**Status:** proposed
**Files to change:** `src/routes/services.ts:L52-L70`
**What to do:** Move the fallback normalization for `subtitle`, `description`, `required_skills`, and `required_resources` into a small local normalization step before the insert query so the SQL parameter list reads as already-shaped data. Keep stored values identical to current behavior.
**Done when:**
- [ ] Service create no longer mixes fallback normalization directly inside the SQL parameter array
- [ ] Inserted values remain identical for missing subtitle, description, skills, and resources
- [ ] The normalization step stays local and obvious inside the service route module
- [ ] All existing tests pass, new tests cover create normalization if needed
**Why it matters:** Inline fallback shaping inside parameter arrays is harder to scan and makes future payload adjustments more error-prone than they need to be.
**Tradeoff:** The gain is mostly readability, so the helper should stay tiny and local.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest but real gain because it makes a common mutation path easier to modify safely.

### Task: Extract the service delete transaction wrapper into a narrow shared helper
**Status:** proposed
**Files to change:** `src/routes/services.ts:L95-L125`, `src/routes/routeHelpers.ts:L1-L200` or a nearby shared transaction helper
**What to do:** Pull the `BEGIN/COMMIT/ROLLBACK` wrapper used for service deletion into a minimal shared helper that accepts a client callback, then keep mapping cleanup and service deletion local to the route. Preserve the current deletion order and rollback semantics exactly.
**Done when:**
- [ ] Service delete no longer hand-writes its full transaction wrapper inline
- [ ] Mapping cleanup and service delete still happen atomically in the same order
- [ ] Rollback behavior remains unchanged on failure
- [ ] All existing tests pass, new tests cover rollback behavior if needed
**Why it matters:** Transaction wrappers are repetitive and easy to get subtly wrong, especially in routes that already carry real business logic.
**Tradeoff:** The helper must stay minimal so transaction boundaries remain obvious during debugging.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it trims repetitive scaffolding from a representative CRUD route.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The rebuilt root logs are still progressing in clean, specific slices, and this cycle stayed grounded by pairing a practical operations UX trio with one fully readable CRUD route.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current workflow is still producing useful, bounded outputs without obvious repetition or wasted motion.

## Ideas — 2026-04-20 (architecture reviewed)

### Task: Replace duplicated provider arrays in syncOrchestrator with one capability registry
**Status:** proposed
**Files to change:** `src/services/syncOrchestrator.ts:L1-L80`
**What to do:** Define one explicit provider registry that records whether each integration supports appointment sync, customer sync, or both, then derive both fan-out loops from that registry. Preserve current provider ordering and behavior exactly, but eliminate the need to maintain support rules in two separate arrays.
**Done when:**
- [ ] Provider support is declared in one registry instead of separate appointment/customer arrays
- [ ] `syncAppointmentToAll` and `syncCustomerToAll` derive their loops from that registry
- [ ] Current provider order and function selection remain unchanged
- [ ] All existing tests pass, new tests cover registry-driven fan-out if needed
**Why it matters:** Central integration rules become brittle when support declarations live in more than one place.
**Tradeoff:** The registry should stay explicit and small so it improves clarity rather than adding abstraction noise.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, strong return because it removes a clear source of integration drift from a shared service.

### Task: Extract shared fan-out execution into a local helper inside syncOrchestrator
**Status:** proposed
**Files to change:** `src/services/syncOrchestrator.ts:L18-L80`
**What to do:** Pull the repeated provider iteration and catch-log pattern into a narrow local helper that accepts provider entries plus entity metadata, then use it for both appointment and customer fan-out. Preserve the current fire-and-forget semantics exactly.
**Done when:**
- [ ] Appointment and customer sync functions no longer each inline the same provider loop-and-catch pattern
- [ ] `logSyncError` usage and non-throwing behavior remain unchanged
- [ ] The helper stays local and specific to sync orchestration behavior
- [ ] All existing tests pass, new tests cover helper-driven fan-out if needed
**Why it matters:** Repeated orchestration mechanics make it harder to see the actual domain differences between the two sync paths.
**Tradeoff:** The helper must stay very small so the file remains easy to audit.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it trims repetition from a central integration file.

### Task: Add lightweight fan-out start logs to syncOrchestrator without provider-level success noise
**Status:** proposed
**Files to change:** `src/services/syncOrchestrator.ts:L1-L80`
**What to do:** Emit one structured start log at the beginning of appointment and customer fan-out when a logger is available, while keeping the current provider failure logs unchanged. Avoid adding per-provider success logs.
**Done when:**
- [ ] Appointment fan-out emits one structured start log when a logger exists
- [ ] Customer fan-out emits one structured start log when a logger exists
- [ ] Existing provider-level failure logging remains unchanged
- [ ] No noisy provider success logs are introduced
- [ ] All existing tests pass, new tests cover logger invocation if needed
**Why it matters:** Fire-and-forget orchestration is otherwise mostly invisible when nothing fails, which makes operational tracing harder.
**Tradeoff:** Even sparse logs add some noise, so the extra visibility should stay limited to high-value start events.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it improves observability in a mostly silent integration path.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The task definitions are still clear, the latest UX and idea entries remain specific rather than generic, and the rebuilt-log workflow is still producing fresh slices without obvious drift.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current process is still doing what it should, giving enough structure to keep the outputs useful without adding unnecessary instruction churn.

## Ideas — 2026-04-20 (code patterns reviewed)

### Task: Replace resource route validation branches with sendValidationError
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L20-L70`, `src/routes/routeHelpers.ts:L1-L40`
**What to do:** Swap the inline validation-failure branches in resource create and update to use `sendValidationError`, keeping the response payload exactly the same while removing repeated validation envelope boilerplate from the route file.
**Done when:**
- [ ] Resource create uses `sendValidationError` for schema parse failures
- [ ] Resource update uses `sendValidationError` for schema parse failures
- [ ] Validation response payloads remain unchanged for callers
- [ ] All existing tests pass, new tests cover validation-failure behavior if needed
**Why it matters:** Shared helper conventions only pay off if real CRUD routes adopt them, and this file still repeats the same validation envelope manually.
**Tradeoff:** This is a narrow consistency cleanup, so it should stay scoped to the resource file rather than triggering a broad rewrite.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it makes a representative CRUD route more consistent immediately.

### Task: Pilot sendSuccess adoption in resource mutation routes
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L40-L110`, `src/routes/routeHelpers.ts:L20-L40`
**What to do:** Replace a few direct `reply.send({ success: true, ... })` responses in resource mutations with `sendSuccess`, confirming the helper fits real CRUD usage without changing payload shape. Keep the rollout selective and behavior-preserving.
**Done when:**
- [ ] Selected resource mutation responses use `sendSuccess`
- [ ] Response payloads remain unchanged for callers
- [ ] The route stays readable and helper use does not feel forced
- [ ] All existing tests pass, new tests cover any helper-adopted paths if needed
**Why it matters:** Shared success helpers only become meaningful once a few real routes prove they improve clarity without hurting readability.
**Tradeoff:** Some responses may still read better inline, so the rollout should stay narrow and pragmatic.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it tests a shared helper under realistic CRUD conditions.

### Task: Extract resource update field assembly into a tiny local helper
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L55-L95`
**What to do:** Pull the dynamic field/value assembly used by resource update into a small local helper that returns the set-clause inputs or throws the same no-fields error. Keep SQL behavior unchanged, but make the route easier to scan by separating update-field shaping from query execution.
**Done when:**
- [ ] Resource update no longer inlines all mutable field collection logic inside the query callback
- [ ] The helper stays local and focused on optional-field assembly rather than generic SQL generation
- [ ] Existing no-updatable-fields behavior remains unchanged
- [ ] All existing tests pass, new tests cover field assembly behavior if needed
**Why it matters:** Optional-field update logic is easy to misread and subtly break when fields change over time.
**Tradeoff:** The helper should stay small and route-local so it clarifies the code instead of over-abstracting it.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it improves readability in a bug-prone pattern without changing semantics.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The process is still producing useful outputs at the 10-cycle checkpoint, the UX notes remain actionable, the ideas remain bounded, and the rebuilt-log workflow is no longer causing confusion.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still clear enough for a fresh agent and are not yet causing obvious repetition or wasted work.

## Ideas — 2026-04-20 (code patterns reviewed)

### Task: Reuse parsePagination and parseDateRange in GET /appointments
**Status:** proposed
**Files to change:** `src/routes/appointments.ts:L60-L120`, `src/routes/routeHelpers.ts:L70-L140` if any tiny helper option tweak is needed
**What to do:** Replace the route-local parsing of `limit`, `offset`, `start_date`, and `end_date` in `GET /appointments` with `parsePagination` and `parseDateRange`, preserving current defaults, caps, and null end-date behavior. Keep super-admin and tenant behavior unchanged.
**Done when:**
- [ ] `GET /appointments` no longer parses limit/offset/date filters inline
- [ ] Shared helper usage preserves current defaults, caps, and null end-date behavior
- [ ] Super-admin and tenant-scoped list behavior remain unchanged
- [ ] All existing tests pass, new tests cover appointments list parsing if needed
**Why it matters:** Appointments are a core route, and leaving local parsing here weakens the value of the backend’s shared helper conventions.
**Tradeoff:** The helper reuse must stay behavior-preserving and not force awkward appointments-specific logic into generic utilities.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, solid gain because it aligns a high-traffic route with existing shared parsing rules.

### Task: Standardize appointment cancel and update zero-row handling on assertRowAffected
**Status:** proposed
**Files to change:** `src/routes/appointments.ts:L120-L260`, `src/routes/routeHelpers.ts:L1-L70` if a tiny helper tweak is needed
**What to do:** Refine the cancel and update mutation flows so zero-row operations use `assertRowAffected` or a closely related shared helper instead of a route-local `rows.length === 0` branch and an unchecked update path. Keep current response semantics as much as possible while making mutation guarantees consistent.
**Done when:**
- [ ] Appointment cancel uses shared zero-row mutation handling instead of its own not-found branch
- [ ] Appointment update verifies that the target appointment still exists before returning success
- [ ] Mutation not-found responses follow the same envelope and message style as other route modules
- [ ] All existing tests pass, new tests cover zero-row cancel/update cases
**Why it matters:** Inconsistent zero-row handling is exactly the kind of subtle reliability issue that confuses both the frontend and future backend maintenance.
**Tradeoff:** There is some regression risk if any caller relied on silent update success, so route-level tests need to pin the intended behavior.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, strong return because it tightens correctness on one of the app’s most important mutation surfaces.

### Task: Extract the appointment update transaction wrapper into a narrow shared helper
**Status:** proposed
**Files to change:** `src/routes/appointments.ts:L160-L260`, `src/routes/routeHelpers.ts:L1-L200` or a nearby shared transaction helper
**What to do:** Pull the `BEGIN/COMMIT/ROLLBACK` wrapper used by appointment updates into a very small transaction helper that accepts a client callback, then keep the field updates and customer-sync logic local to the appointments route. Preserve the current mutation steps exactly, but reduce the amount of handwritten transaction scaffolding in the route body.
**Done when:**
- [ ] Appointment update no longer inlines its full transaction wrapper
- [ ] Field update and customer update logic stay local and readable inside the route
- [ ] Rollback behavior remains unchanged if any step fails
- [ ] All existing tests pass, new tests cover rollback behavior if needed
**Why it matters:** Transaction wrappers are repetitive and easy to get subtly wrong, and this route already has enough business logic without also carrying all the transaction ceremony.
**Tradeoff:** The helper must stay tiny and explicit so it clarifies the route rather than hiding where transaction boundaries really are.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it simplifies one of the denser route handlers without changing behavior.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The rebuilt root logs remain stable, the UX backlog is shrinking in meaningful slices, and the ideas pass is still alternating between shared backend layers instead of collapsing onto one repeated theme.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current process is still producing specific, bounded outputs and does not show enough staleness to justify instruction changes.

## Ideas — 2026-04-20 (developer experience reviewed)

### Task: Extract settled-result unwrapping from useStaticData into a tiny typed helper
**Status:** proposed
**Files to change:** `dashboard/lib/hooks.ts:L35-L95`
**What to do:** Pull the repeated `Promise.allSettled` success-array checks in `useStaticData` into a small local helper that returns typed arrays plus first-failure information. Keep the hook API and behavior the same, but make the partial-failure handling shorter and easier to maintain.
**Done when:**
- [ ] `useStaticData` no longer repeats the same fulfilled/array checks for every resource fetch
- [ ] The helper is small, typed, and local to the hook module unless reuse is clearly warranted
- [ ] Returned data, loading, error, and refresh behavior stay unchanged
- [ ] All existing tests pass, new tests cover the helper if added
**Why it matters:** `useStaticData` is foundational dashboard plumbing, and reducing repetitive settled-result handling will make future edits less noisy and less error-prone.
**Tradeoff:** The helper should stay very small so it clarifies the hook instead of abstracting away obvious behavior.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it trims a repeated pattern in a central hook without changing functionality.

### Task: Replace useFormState JSON-stringify dirty tracking with a narrow equality strategy
**Status:** proposed
**Files to change:** `dashboard/lib/hooks.ts:L1-L35`
**What to do:** Refine `useFormState` so dirty tracking no longer relies on `JSON.stringify(form) !== JSON.stringify(original)`. Replace it with a narrow equality helper or field-by-field comparison strategy suitable for the simple form objects this hook manages. Preserve current API and behavior for consumers.
**Done when:**
- [ ] `useFormState` no longer uses `JSON.stringify` for dirty tracking
- [ ] Dirty detection remains accurate for the form shapes currently passed to the hook
- [ ] The hook API stays unchanged for consumers
- [ ] All existing tests pass, new tests cover dirty tracking behavior if needed
**Why it matters:** Stringify-based equality is brittle, order-sensitive, and easy to forget about when form shapes evolve.
**Tradeoff:** The replacement should stay simple and tailored to current usage rather than becoming a generic deep-equality abstraction.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, solid gain because it removes a subtle implementation hazard from a shared form helper.

### Task: Add a named partial-load result type for useStaticData instead of six parallel state updates
**Status:** proposed
**Files to change:** `dashboard/lib/hooks.ts:L35-L100`, `dashboard/lib/types.ts:L1-L80` if the type belongs there
**What to do:** Introduce a small named result type that represents the loaded static dashboard datasets and any partial-failure state, then shape the `useStaticData` implementation around that model instead of six largely parallel `setX` calls. Keep the returned hook API unchanged if possible, but use the type to make the internal fetch result handling easier to reason about.
**Done when:**
- [ ] `useStaticData` has one named internal result model for its combined datasets and partial-failure state
- [ ] The hook implementation is easier to scan than the current repeated set-state pattern
- [ ] The public hook return shape remains unchanged or changes only in a tightly controlled, documented way
- [ ] All existing tests pass, new tests cover the internal result shaping if needed
**Why it matters:** When one hook owns this much cross-entity loading, a named internal model can reduce mental overhead and make future maintenance safer.
**Tradeoff:** The type should improve clarity, not add ceremony, so it should stay small and local unless broader reuse becomes obvious.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it can make a foundational shared hook much easier to maintain.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The remaining UX backlog is now small enough that each pass can stay highly targeted, and the idea log is still rotating cleanly by shifting between backend helper layers and shared dashboard infrastructure.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing specific, fresh outputs without obvious drift or wasted cycles.

## Ideas — 2026-04-20 (code patterns reviewed)

### Task: Reuse parsePagination in GET /customers
**Status:** proposed
**Files to change:** `src/routes/customers.ts:L35-L60`, `src/routes/routeHelpers.ts:L100-L140` if any default tweak is needed
**What to do:** Replace the inline `limit` and `offset` parsing in `GET /customers` with `parsePagination`, preserving the current defaults and caps while aligning the route with the shared helper conventions already established in `routeHelpers.ts`.
**Done when:**
- [ ] `GET /customers` uses `parsePagination` instead of route-local `parseInt` logic
- [ ] Current limit/offset defaults and cap behavior remain unchanged
- [ ] Super-admin and tenant-scoped list behavior remain unchanged
- [ ] All existing tests pass, new tests cover customer pagination behavior if needed
**Why it matters:** Customer listing is a core route pattern, and leaving it on local parsing weakens the value of the shared helper layer.
**Tradeoff:** This is mostly consistency work, so it should stay behavior-preserving and avoid broader query refactors.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, solid gain because it aligns a common list route with an existing shared convention.

### Task: Replace customer route validation branches with sendValidationError
**Status:** proposed
**Files to change:** `src/routes/customers.ts:L55-L120`, `src/routes/routeHelpers.ts:L1-L40`
**What to do:** Swap the inline validation-failure branches in customer create and update to use `sendValidationError`, keeping the response payload exactly the same while removing repeated validation envelope boilerplate from the route file.
**Done when:**
- [ ] Customer create uses `sendValidationError` for schema parse failures
- [ ] Customer update uses `sendValidationError` for schema parse failures
- [ ] Validation response payloads remain unchanged for callers
- [ ] All existing tests pass, new tests cover validation-failure behavior if needed
**Why it matters:** Shared helper conventions only pay off if real CRUD routes adopt them, and this file still repeats the same validation envelope manually.
**Tradeoff:** This is a narrow consistency cleanup, so it should stay scoped to the customer file rather than triggering a broad rewrite.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it makes a representative CRUD route more consistent immediately.

### Task: Pilot sendSuccess adoption in customer mutation routes
**Status:** proposed
**Files to change:** `src/routes/customers.ts:L80-L170`, `src/routes/routeHelpers.ts:L20-L40`
**What to do:** Replace a few direct `reply.send({ success: true, ... })` responses in customer mutations with `sendSuccess`, confirming the helper fits real CRUD usage without changing payload shape. Keep the rollout selective and behavior-preserving.
**Done when:**
- [ ] Selected customer mutation responses use `sendSuccess`
- [ ] Response payloads remain unchanged for callers
- [ ] The route stays readable and helper use does not feel forced
- [ ] All existing tests pass, new tests cover any helper-adopted paths if needed
**Why it matters:** It is hard to know whether a shared success helper is genuinely useful unless a few real routes prove it in practice.
**Tradeoff:** Some responses may still read better inline, so the rollout should stay narrow and pragmatic.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it tests a shared helper under realistic CRUD conditions.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The remaining UX backlog is now concentrated enough that each cycle can stay sharply focused, and this pass kept the ideas log fresh by switching from resource-route cleanup to the customer-route version of the same helper-adoption pattern.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing useful, bounded outputs without obvious repetition or wasted effort.

## Ideas — 2026-04-20 (developer experience reviewed)

### Task: Introduce named appointment request payload types in dashboard/lib/types.ts and use them in Api.appointments
**Status:** proposed
**Files to change:** `dashboard/lib/types.ts:L1-L140`, `dashboard/lib/api.ts:L120-L260`
**What to do:** Add explicit request interfaces for appointment create and update payloads in `dashboard/lib/types.ts`, then replace the current broad appointment helper signatures in `Api.appointments` so they use those named types instead of loose composite payloads. Keep runtime behavior unchanged.
**Done when:**
- [ ] Appointment create/update request payloads have named shared types
- [ ] `Api.appointments.create` and `Api.appointments.update` stop relying on broad intersection payload types
- [ ] Existing call sites compile cleanly or reveal legitimate typing gaps that are fixed locally
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** Appointment mutations sit on a hot path, and broad payload typing weakens the strongest safety tool the dashboard has, strict TypeScript.
**Tradeoff:** Tightening the signatures may expose a few sloppy callers, so there can be a modest cleanup cost.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, strong return because it improves safety and readability at a central dashboard API boundary.

### Task: Rename ScheduleEntry or explicitly document its distinction from EffectiveShift
**Status:** proposed
**Files to change:** `dashboard/lib/types.ts:L90-L130`, any scheduler or wizard callers using `ScheduleEntry`
**What to do:** Resolve the overlap between `ScheduleEntry` and the date-based shift types around it by either renaming `ScheduleEntry` to match the override terminology already used elsewhere or documenting why it represents a different concept. Keep runtime behavior unchanged.
**Done when:**
- [ ] The distinction between `ScheduleEntry` and `EffectiveShift` is explicit and easy to understand
- [ ] Type names or comments align better with the dashboard’s date-based scheduling terminology
- [ ] Existing call sites compile cleanly after the clarification
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** Scheduling is already a high-complexity area, and ambiguous type names make safe changes harder than they need to be.
**Tradeoff:** Renaming shared types creates a small ripple, so the cleanup should stay tightly scoped to genuine ambiguity.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it clarifies a confusing core type without changing behavior.

### Task: Add a shared appointment display model for customer/resource label fallback rules
**Status:** proposed
**Files to change:** `dashboard/lib/types.ts:L1-L140`, appointment-facing components such as `dashboard/components/AppointmentListSidebar.tsx:L1-L220`, `dashboard/components/AppointmentDetailPanel.tsx:L1-L260`, and scheduler appointment surfaces if applicable
**What to do:** Define a small shared display contract or helper type for appointment-facing customer/resource labels so UI code stops reasoning directly about multiple overlapping name shapes, nested `customers` objects, and legacy `name` fields in each component. Keep API payloads unchanged.
**Done when:**
- [ ] Appointment-facing UI shares one explicit display-data contract for customer/resource label fallback
- [ ] Legacy label fallback behavior is defined in one place
- [ ] The change stays scoped to appointment-facing display concerns rather than broad entity rewrites
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** Repeated ad hoc label fallback logic makes appointment UI code harder to keep consistent across list-detail and scheduler surfaces.
**Tradeoff:** The display model should stay thin and view-focused so it does not become a second entity layer.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it reduces repetitive field ambiguity across several important appointment surfaces.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The remaining UX backlog is small enough that each cycle can stay sharply focused, and this pass kept the ideas log fresh by returning to the dashboard type/api layer instead of repeating recent backend helper patterns.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing useful, bounded outputs without obvious repetition or wasted effort.

## Ideas — 2026-04-20 (architecture reviewed)

### Task: Replace duplicated provider arrays in syncOrchestrator with one capability registry
**Status:** proposed
**Files to change:** `src/services/syncOrchestrator.ts:L1-L80`
**What to do:** Define one explicit provider registry that records whether each integration supports appointment sync, customer sync, or both, then derive both fan-out loops from that registry. Preserve current provider ordering and behavior exactly, but eliminate the need to maintain support rules in two separate arrays.
**Done when:**
- [ ] Provider support is declared in one registry instead of separate appointment/customer arrays
- [ ] `syncAppointmentToAll` and `syncCustomerToAll` derive their loops from that registry
- [ ] Current provider order and function selection remain unchanged
- [ ] All existing tests pass, new tests cover registry-driven fan-out if needed
**Why it matters:** Central integration rules become brittle when support declarations live in more than one place.
**Tradeoff:** The registry should stay explicit and small so it improves clarity rather than adding abstraction noise.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, strong return because it removes a clear source of integration drift from a shared service.

### Task: Extract shared fan-out execution into a local helper inside syncOrchestrator
**Status:** proposed
**Files to change:** `src/services/syncOrchestrator.ts:L18-L80`
**What to do:** Pull the repeated provider iteration and catch-log pattern into a narrow local helper that accepts provider entries plus entity metadata, then use it for both appointment and customer fan-out. Preserve the current fire-and-forget semantics exactly.
**Done when:**
- [ ] Appointment and customer sync functions no longer each inline the same provider loop-and-catch pattern
- [ ] `logSyncError` usage and non-throwing behavior remain unchanged
- [ ] The helper stays local and specific to sync orchestration behavior
- [ ] All existing tests pass, new tests cover helper-driven fan-out if needed
**Why it matters:** Repeated orchestration mechanics make it harder to see the actual domain differences between the two sync paths.
**Tradeoff:** The helper must stay very small so the file remains easy to audit.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it trims repetition from a central integration file.

### Task: Add lightweight fan-out start logs to syncOrchestrator without provider-level success noise
**Status:** proposed
**Files to change:** `src/services/syncOrchestrator.ts:L1-L80`
**What to do:** Emit one structured start log at the beginning of appointment and customer fan-out when a logger is available, while keeping the current provider failure logs unchanged. Avoid adding per-provider success logs.
**Done when:**
- [ ] Appointment fan-out emits one structured start log when a logger exists
- [ ] Customer fan-out emits one structured start log when a logger exists
- [ ] Existing provider-level failure logging remains unchanged
- [ ] No noisy provider success logs are introduced
- [ ] All existing tests pass, new tests cover logger invocation if needed
**Why it matters:** Fire-and-forget orchestration is otherwise mostly invisible when nothing fails, which makes operational tracing harder.
**Tradeoff:** Even sparse logs add some noise, so the extra visibility should stay limited to high-value start events.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it improves observability in a mostly silent integration path.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The remaining UX backlog is now small enough that each cycle can stay sharply focused, and the ideas pass remains useful because it is still tied to fully readable shared service code rather than guesswork.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing specific, bounded outputs without obvious repetition or wasted effort in the endgame.

## Ideas — 2026-04-20 (developer experience reviewed)

### Task: Rename ScheduleEntry or explicitly document its distinction from EffectiveShift
**Status:** proposed
**Files to change:** `dashboard/lib/types.ts:L90-L130`, any scheduler or wizard callers using `ScheduleEntry`
**What to do:** Resolve the overlap between `ScheduleEntry` and the date-based shift types around it by either renaming `ScheduleEntry` to match the override terminology already used elsewhere or documenting why it represents a different concept. Keep runtime behavior unchanged.
**Done when:**
- [ ] The distinction between `ScheduleEntry` and `EffectiveShift` is explicit and easy to understand
- [ ] Type names or comments align better with the dashboard’s date-based scheduling terminology
- [ ] Existing call sites compile cleanly after the clarification
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** Scheduling is already a high-complexity area, and ambiguous type names make safe changes harder than they need to be.
**Tradeoff:** Renaming shared types creates a small ripple, so the cleanup should stay tightly scoped to genuine ambiguity.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it clarifies a confusing core type without changing behavior.

### Task: Add a shared scheduler display model for appointment and employee label fallback rules
**Status:** proposed
**Files to change:** `dashboard/lib/types.ts:L1-L140`, scheduler components such as `dashboard/components/scheduler/AppointmentBlock.tsx:L1-L220`, `dashboard/components/scheduler/AppointmentListView.tsx:L1-L240`, `dashboard/components/scheduler/StaffProfileCard.tsx:L1-L240`
**What to do:** Define a small scheduler-focused display contract or helper type that captures preferred appointment, customer, resource, and employee label fields so scheduler surfaces stop each reasoning directly about overlapping legacy and nested name shapes. Keep API payloads unchanged.
**Done when:**
- [ ] Scheduler surfaces share one explicit display-data contract for label fallback
- [ ] Legacy and nested label fallback behavior is defined in one place
- [ ] The change stays scoped to scheduler display concerns rather than broad entity rewrites
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** Scheduler components are dense, high-frequency UI and benefit from one consistent interpretation of ambiguous display fields.
**Tradeoff:** The display model should stay thin and view-focused so it does not become a second entity layer.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it reduces repetitive field ambiguity across several core scheduler components.

### Task: Introduce a named scheduler shell-state type for no-selection, empty-day, and loading modes
**Status:** proposed
**Files to change:** `dashboard/lib/types.ts:L1-L180`, `dashboard/components/scheduler/EmployeeDayFocusPanel.tsx:L1-L220`, `dashboard/components/scheduler/NewSchedulerView.tsx:L1-L360`, `dashboard/components/scheduler/QuickBookPanel.tsx:L1-L320`
**What to do:** Add a small shared type for the scheduler shell states that currently appear implicitly through scattered booleans and empty checks, for example no selection, empty day, loading, blocked quick-book prerequisites. Keep behavior unchanged, but give the scheduler shell a clearer internal contract.
**Done when:**
- [ ] Scheduler shell-state concepts are represented by one named shared type or closely related contract
- [ ] At least a few core scheduler surfaces use that type for their shell-state handling
- [ ] The change stays scoped to scheduler shell-state concerns and does not trigger unrelated refactors
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** Shared state semantics become easier to maintain when they are named instead of implied through scattered conditionals.
**Tradeoff:** The type should stay small and meaningful, otherwise it adds ceremony without reducing complexity.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it can clarify a dense feature cluster with minimal code churn.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The endgame is now very clear, and this cycle used that well by clearing the remaining non-skill-map scheduler/wizard items while keeping the idea pass focused on the same dense domain from a different angle.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still giving enough structure to finish the backlog cleanly without extra steering.

## Ideas — 2026-04-21 (developer experience reviewed)

### Task: Split dashboard auth/session helpers out of api.ts into a focused client module
**Status:** proposed
**Files to change:** `dashboard/lib/api.ts:L12-L181`, `dashboard/lib/SessionContext.tsx` if it shares the same localStorage keys, `dashboard/lib/authClient.ts` (new)
**What to do:** Move the auth-token freshness logic, localStorage key access, logout cleanup, and self-signed-cert redirect handling out of `dashboard/lib/api.ts` into a small `authClient` module. Keep `apiFetch` and `apiMutate` as callers of that module, but stop mixing transport helpers with session-state concerns in the same file.
**Done when:**
- [ ] `api.ts` no longer owns token decoding, refresh, logout, and cert-redirect helpers inline
- [ ] The extracted module exposes a small, explicit API for `ensureTokenFresh`, auth cleanup, and key access
- [ ] Existing login/logout/401 refresh behavior stays unchanged in the dashboard
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** `api.ts` is carrying transport, auth state, storage keys, and browser redirect behavior at once, which makes a high-traffic file harder to reason about than it needs to be.
**Tradeoff:** This is mostly structural cleanup, so the extraction needs to stay tight and behavior-preserving instead of becoming a generic client framework.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** 1-2 hours of careful extraction would make one of the dashboard’s densest shared files much easier to navigate, a solid return for future maintenance.

### Task: Normalize tenant-aware mutation signatures across dashboard API helpers
**Status:** proposed
**Files to change:** `dashboard/lib/api.ts:L48-L54`, `dashboard/lib/api.ts:L311-L387`, `dashboard/lib/api.ts:L722-L782`
**What to do:** Introduce one small helper pattern for tenant-aware mutations, then apply it to the resource, service, shift, and record-history mutation helpers that currently mix optional tenant bodies, query-string tenant IDs, and entity-tenant overrides. Keep backend endpoints unchanged, but make the dashboard API layer consistent about how a caller supplies tenant context and how super-admin overrides are resolved.
**Done when:**
- [ ] Resource, service, shift, and record-history mutation helpers follow one documented tenant-passing pattern
- [ ] Query-string tenant injection is only used where it is actually required by the backend contract
- [ ] Super-admin-safe paths still preserve entity-tenant behavior where needed
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** Right now the dashboard API layer makes tenant handling feel incidental, which raises the chance of subtle caller mistakes in a multi-tenant product.
**Tradeoff:** Tightening shared helper signatures can expose a few inconsistent callers, so the cleanup may ripple slightly beyond `api.ts`.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** A couple of hours spent normalizing tenant semantics in the shared client would pay off well because it reduces ambiguity on many mutation paths.

### Task: Introduce shared provider union types for calendar and CRM integrations
**Status:** proposed
**Files to change:** `dashboard/lib/types.ts:L176-L210`, `dashboard/lib/api.ts:L427-L455`, `dashboard/components/SettingsView.tsx:L41-L42`, `dashboard/components/CRMIntegrationCard.tsx:L1-L220`
**What to do:** Add explicit provider unions, for example a `CalendarProvider` type and a CRM provider type, then use them anywhere the dashboard currently falls back to raw `string` provider fields. Keep the rendered UI unchanged, but stop letting provider names drift across settings state, API helper signatures, and integration card props.
**Done when:**
- [ ] Calendar settings and auth helpers no longer use raw `string` for known provider names
- [ ] CRM integration card props and related settings helpers use shared provider types where practical
- [ ] Existing provider-specific UI branches still compile cleanly without stringly-typed fallbacks
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** Provider names are part of the app’s integration contract, and keeping them as loose strings weakens autocomplete and makes typos easier to miss.
**Tradeoff:** The unions should stay limited to known provider surfaces so they improve clarity without forcing premature abstraction onto unrelated settings code.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Less than an hour of type cleanup would remove a recurring source of low-grade drift across several integration-facing files, a good return.

## Self-Review — 2026-04-21
**Cycles since last self-review:** 1
**What's working:** The UX pass is nearly complete and still producing concrete file-level findings, but the improvement log has started repeating near-duplicate helper tasks across the same files, so the freshness problem is now clear.
**What I changed in HEARTBEAT.md:** Added one Continuous Improvement rule to scan recent task titles and file references, and skip proposals that touch the same primary files for substantially the same cleanup.
**Why:** The task format is still strong, but it needed a small anti-duplication guard so future cycles spend less time rediscovering the same api/hooks cleanup ideas.

## Ideas — 2026-04-20 (developer experience reviewed)

### Task: Add concise contract comments around tenant targeting and auth refresh helpers in dashboard/lib/api.ts
**Status:** proposed
**Files to change:** `dashboard/lib/api.ts:L20-L140`
**What to do:** Add one compact, high-signal comment block near `getTargetTenantId`, token refresh, auth failure handling, and the generic fetch/mutate helpers that explains the intended contract for tenant targeting, proactive refresh, and forced logout behavior. Keep the comments factual and brief, with no runtime changes.
**Done when:**
- [ ] `dashboard/lib/api.ts` has concise documentation covering tenant targeting, proactive token refresh, auth failure logout, and generic fetch/mutate flow
- [ ] The comments describe current behavior accurately and do not drift into aspirational architecture
- [ ] The file remains easy to scan and is not over-commented
- [ ] All existing tests pass, no runtime behavior changes are introduced
**Why it matters:** This file is a central dashboard integration boundary, and a little embedded guidance can save a lot of re-reading for future maintenance.
**Tradeoff:** Comments can drift, so the documentation should stay sparse and anchored to stable behavior.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Very low effort, modest but real gain because it improves maintainability in a central helper module.

### Task: Extract a small appointment request type alias layer from dashboard/lib/api.ts call sites
**Status:** proposed
**Files to change:** `dashboard/lib/types.ts:L1-L140`, `dashboard/lib/api.ts:L220-L340`
**What to do:** Introduce a few named type aliases for the appointment payload shapes currently passed through `Api.appointments` and use them at the helper boundary so the request contracts are easier to discover without reading every caller. Keep runtime behavior unchanged and avoid a broad entity rewrite.
**Done when:**
- [ ] Appointment helper payloads are represented by named types or aliases in a shared location
- [ ] `Api.appointments` signatures reference those names instead of only inline broad payload shapes
- [ ] Existing callers compile cleanly or reveal legitimate typing gaps that are resolved locally
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** Named request contracts improve discoverability and reduce cognitive load around one of the busiest dashboard API surfaces.
**Tradeoff:** The type layer should stay lightweight so it clarifies the helper boundary without adding ceremony.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it makes a central mutation boundary easier to understand and safer to use.

### Task: Add a small internal load-result helper type for useStaticData in dashboard/lib/hooks.ts
**Status:** proposed
**Files to change:** `dashboard/lib/hooks.ts:L35-L100`, optionally `dashboard/lib/types.ts:L1-L80` if the type belongs there
**What to do:** Introduce a small named internal result type for the combined datasets and partial-failure state handled by `useStaticData`, then use it to make the hook’s load flow easier to read. Keep the public hook return shape unchanged.
**Done when:**
- [ ] `useStaticData` has one named internal result model for its combined datasets and partial-failure state
- [ ] The hook implementation is easier to scan than the current repeated state-setting pattern
- [ ] The public hook API remains unchanged
- [ ] All existing tests pass, new tests cover internal result shaping if needed
**Why it matters:** When one hook owns this much cross-entity loading, a named internal model can reduce mental overhead and make maintenance safer.
**Tradeoff:** The type should improve clarity, not add ceremony, so it should stay small and local unless broader reuse becomes obvious.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it can clarify a foundational shared hook with minimal code churn.

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The UX review backlog is now genuinely complete, and the workflow handled that transition well by skipping the finished task while still producing one more bounded improvement pass.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already define the correct endgame behavior, skip finished UX review, keep doing the other tasks, and only return HEARTBEAT_OK when nothing else remains to do.

## Ideas — 2026-04-21 (architecture reviewed)

### Task: Extract version-history error-response factories into a shared route-local helper module
**Status:** proposed
**Files to change:** `src/routes/versionHistory.ts:L1-L130`, optional new route-local helper file such as `src/routes/versionHistory.helpers.ts`
**What to do:** Move `createErrorResponse`, `validateTable`, and `validateBody` into a small route-local helper module or clearly separated helper section so the main route registration flow starts closer to endpoint logic instead of front-loading all validation and error factory code. Keep payloads and behavior unchanged.
**Done when:**
- [ ] Version-history error-response and validation helpers are separated from the main route registration flow
- [ ] All error payload shapes and validation behavior remain unchanged
- [ ] `registerVersionHistoryRoutes` becomes easier to scan from route to route
- [ ] All existing tests pass, new tests cover helper behavior if needed
**Why it matters:** This route file already carries a lot of endpoint logic, and reducing the helper noise at the top will make future maintenance easier.
**Tradeoff:** The extraction should stay local to version-history concerns and not create a generic helper layer that is harder to navigate.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it improves readability in one of the more complex route files without changing behavior.

### Task: Split record-history reads from restore/delete/copy mutations in versionHistory routes
**Status:** proposed
**Files to change:** `src/routes/versionHistory.ts:L1-L700`, optional new files such as `src/routes/versionHistory.reads.ts` and `src/routes/versionHistory.mutations.ts`
**What to do:** Separate the read-only history/version/recent-changes endpoints from the restore/delete/copy mutation endpoints so the route file stops mixing exploratory read flows with state-changing recovery operations in one large module. Keep URLs and payloads unchanged.
**Done when:**
- [ ] Read-only version-history endpoints are registered separately from mutation/recovery endpoints
- [ ] Public route paths and response payloads remain unchanged
- [ ] Shared helper code is extracted only where it clearly reduces duplication between the split files
- [ ] All existing tests pass, new tests cover moved registration if needed
**Why it matters:** This file spans multiple distinct responsibilities, and splitting reads from mutations will make future changes safer and easier to reason about.
**Tradeoff:** File count increases, so the split should follow clear domain boundaries rather than scattering logic too aggressively.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it clarifies ownership inside one of the more complex route modules.

### Task: Extract versionHistory table-validation and endpoint-context assembly into reusable route-local utilities
**Status:** proposed
**Files to change:** `src/routes/versionHistory.ts:L40-L180`
**What to do:** Introduce small route-local helpers that build the repeated endpoint context strings and table-validation flow used across version-history endpoints, then reuse them so each handler focuses on its specific record/version logic instead of rebuilding endpoint metadata inline. Preserve current messages and error structure.
**Done when:**
- [ ] Endpoint context string assembly is no longer repeated inline across multiple version-history handlers
- [ ] Table validation flow is reused consistently through named helpers
- [ ] Existing error messages and payload shapes remain unchanged
- [ ] All existing tests pass, new tests cover helper-driven context generation if needed
**Why it matters:** Repeated endpoint metadata assembly adds noise to already long handlers and makes subtle message drift more likely over time.
**Tradeoff:** The helpers should stay tightly scoped to this file so they improve readability without creating indirection for its own sake.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it trims repeated scaffolding from a complex route without changing semantics.

## Self-Review — 2026-04-21
**Cycles since last self-review:** 1
**What's working:** UX review is correctly staying skipped now that it is complete, and the ideas pass still found a genuinely different architecture area instead of repeating the dashboard and sync themes from the last few cycles.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still handling the post-UX-completion phase well, and a fresh agent could still follow this process without confusion.
