# Improvement Ideas — Daily Journal Feed

> Automated daily journal of refactoring suggestions. Each batch is dated and labelled by area (`## Ideas — DATE (X reviewed)`) and ends with a `## Self-Review — DATE` footer. Tasks include `Tradeoff` and `Effort vs Gain` blocks beyond the standard Status/Files/Done-when fields.
>
> **For the curated review-phase backlog, see [`docs/IMPROVEMENT_IDEAS.md`](docs/IMPROVEMENT_IDEAS.md).** That file holds tasks organized for review (10 phases, ~160 tasks, dated 2026-04-10/11). The two files are deliberately distinct — see `docs/TODO.md` "Role clarity for improvement-ideas files" for the rationale.
>
> **This file is generator output, not a curated backlog.** If a proposed task here matters enough to act on, promote it to `NEEDS-REFACTORING.md` (durable structural concern) or `docs/TODO.md` (operational work). Otherwise it decays — and that is fine, because the journal-loop generator produces ideas faster than anyone can act on them. Periodic prune passes remove (a) `Status: resolved` / `Status: dropped` entries (NEEDS-REFACTORING #12, 2026-05-04), (b) duplicate task titles produced by the generator's known dedup gap, and (c) tasks whose extraction target has already shipped — most recently 2026-05-05, which dropped 21 exact-title duplicates + 3 near-dups (e.g. "single capability registry" vs "one capability registry") + 2 already-shipped tasks (`getCrmSyncStatus`, `disconnectCrmIntegration` extractions): 117 tasks → 93, 2180 → 1818 lines.

---

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

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The rebuilt root log is still continuing cleanly, and this cycle stayed grounded by pairing a practical account/team UX slice with one fully readable CRUD route rather than stretching across clipped files.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still steering the work toward specific, low-drift outputs without extra tuning.

## Ideas — 2026-04-20 (architecture reviewed)

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The rebuilt root logs are still continuing cleanly, and this cycle stayed grounded by pairing a focused onboarding slice with one fully readable shared service rather than stretching across clipped backend files.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing specific, useful outputs without wasted motion or obvious repetition pressure.

## Ideas — 2026-04-20 (architecture reviewed)

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

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The task definitions are still clear, the latest UX and idea entries remain specific rather than generic, and the rebuilt-log workflow is still producing fresh slices without obvious drift.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current process is still doing what it should, giving enough structure to keep the outputs useful without adding unnecessary instruction churn.

## Ideas — 2026-04-20 (code patterns reviewed)

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

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The remaining UX backlog is small enough that each cycle can stay sharply focused, and this pass kept the ideas log fresh by returning to the dashboard type/api layer instead of repeating recent backend helper patterns.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing useful, bounded outputs without obvious repetition or wasted effort.

## Ideas — 2026-04-20 (architecture reviewed)

## Self-Review — 2026-04-20
**Cycles since last self-review:** 1
**What's working:** The remaining UX backlog is now small enough that each cycle can stay sharply focused, and the ideas pass remains useful because it is still tied to fully readable shared service code rather than guesswork.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing specific, bounded outputs without obvious repetition or wasted effort in the endgame.

## Ideas — 2026-04-20 (developer experience reviewed)

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

## Ideas — 2026-04-21 (architecture reviewed)

### Task: Extract reminder ownership verification into a route-local helper in reminders.ts
**Status:** proposed
**Files to change:** `src/routes/reminders.ts:L70-L180`
**What to do:** Pull the repeated reminder lookup and tenant-ownership verification logic into a small helper that returns the reminder row plus any status checks needed by trigger/cancel flows. Keep route behavior unchanged, but stop re-implementing reminder existence/ownership checks in multiple handlers.
**Done when:**
- [ ] Trigger and cancel routes no longer each inline their own reminder ownership lookup flow
- [ ] Not-found and wrong-status behavior remain unchanged
- [ ] The helper stays local to reminder-route concerns and does not become a generic repository layer
- [ ] All existing tests pass, new tests cover the helper-driven ownership checks if needed
**Why it matters:** Shared verification logic is easy to drift when it is repeated across multiple mutation handlers in the same file.
**Tradeoff:** The helper should stay narrowly scoped so it improves readability without hiding straightforward route behavior.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it reduces duplication in a route file with clearly repeated guard logic.

### Task: Consolidate reminder status transition checks into a small route-local policy helper
**Status:** proposed
**Files to change:** `src/routes/reminders.ts:L90-L200`
**What to do:** Introduce a tiny helper or constant map that defines which reminder statuses can be triggered or cancelled, then have the trigger and cancel endpoints use that instead of embedding status checks separately. Preserve the current error messages and behavior exactly.
**Done when:**
- [ ] Trigger and cancel routes no longer inline their own reminder status transition checks independently
- [ ] Current status-specific error messages and allowed transitions remain unchanged
- [ ] The transition rules are easy to inspect in one place
- [ ] All existing tests pass, new tests cover helper-driven transition logic if needed
**Why it matters:** State-transition rules are policy logic, and centralizing them makes future edits safer and easier to verify.
**Tradeoff:** The helper should stay tiny and route-local so it does not add unnecessary abstraction for a small policy surface.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it makes reminder state rules more explicit and less repetitive.

### Task: Extract reminder list query construction into a focused builder helper
**Status:** proposed
**Files to change:** `src/routes/reminders.ts:L35-L90`
**What to do:** Move the dynamic SQL assembly for listing reminders, including optional status filtering and pagination parameter wiring, into a small helper that returns the query text and params. Keep the final SQL behavior unchanged, but make the list route easier to scan by separating query building from response flow.
**Done when:**
- [ ] `GET /reminders` no longer assembles dynamic SQL inline inside the route handler
- [ ] Optional status filtering, ordering, and pagination behavior remain unchanged
- [ ] The builder stays local to reminders route concerns and does not become a generic SQL abstraction
- [ ] All existing tests pass, new tests cover builder output if needed
**Why it matters:** Dynamic query assembly mixed directly into route handlers makes even simple list endpoints noisier and harder to maintain than they need to be.
**Tradeoff:** The helper should remain narrowly focused on this route’s query needs rather than trying to generalize SQL construction.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest but real gain because it separates query construction from endpoint flow in a readable way.

## Self-Review — 2026-04-21
**Cycles since last self-review:** 1
**What's working:** UX review is still correctly staying skipped, and this cycle found a genuinely fresh route family, reminders, instead of stretching another near-duplicate batch out of already heavily reviewed dashboard and sync areas.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still handling the post-UX-completion phase well, and they are not pushing me into repetitive output yet.

## Ideas — 2026-04-22 (architecture reviewed)

### Task: Extract communications send-route execution into one shared helper
**Status:** proposed
**Files to change:** `src/routes/communications.ts:L86-L159`
**What to do:** Introduce one route-local helper that accepts the parsed payload, invokes either `communicationService.sendEmail` or `communicationService.sendSMS`, and emits the shared `{ success, messageId }` or `{ success: false, error }` response envelope. Keep route URLs and validation schemas unchanged, but stop maintaining nearly identical send-flow branches twice.
**Done when:**
- [ ] `/communications/email` and `/communications/sms` no longer duplicate the same service-result response handling
- [ ] Validation behavior and response payload shapes remain unchanged for both routes
- [ ] The helper stays local to communications route concerns and does not become a generic transport abstraction
- [ ] All existing tests pass, new tests cover helper-driven email and SMS success/failure behavior if needed
**Why it matters:** These two mutation routes already share the same orchestration pattern, and keeping them duplicated makes future behavior tweaks drift-prone for no real gain.
**Tradeoff:** The helper should stay narrow enough that the route file still reads clearly from top to bottom.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Well under an hour of cleanup would remove obvious duplication from two production mutation paths, a solid maintenance win.

### Task: Split Stripe checkout customer lookup from customer creation in billing.ts
**Status:** proposed
**Files to change:** `src/routes/billing.ts:L44-L79`
**What to do:** Extract the tenant lookup plus "find existing Stripe customer or create and persist one" flow into a small billing-local helper that returns the Stripe customer id. Keep the checkout route behavior unchanged, but separate subscription session creation from customer bootstrapping so the route body reads as one checkout flow instead of two mixed concerns.
**Done when:**
- [ ] `/billing/checkout` no longer inlines tenant fetch, Stripe customer creation, and tenant persistence inside the main route body
- [ ] Existing customer reuse and first-time customer creation behavior remain unchanged
- [ ] Missing-tenant and missing-price error behavior remain unchanged
- [ ] All existing tests pass, new tests cover helper-driven customer bootstrap behavior if needed
**Why it matters:** Checkout is a high-consequence route, and pulling customer bootstrap into one named step makes the remaining subscription logic easier to audit safely.
**Tradeoff:** The helper should stay billing-local and explicit, not become a broad Stripe service layer.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it makes an important payment path easier to reason about without changing behavior.

### Task: Isolate provisioning status transitions and rollback writes in provisioning.ts
**Status:** proposed
**Files to change:** `src/routes/provisioning.ts:L44-L147`, `src/routes/provisioning.ts:L177-L218`
**What to do:** Add small route-local helpers for the repeated tenant phone-status writes, for example setting `provisioning`, `failed`, `active`, and `deprovisioned`, then reuse them in activate/deactivate flows. Keep all response payloads and Telnyx calls unchanged, but make the route’s state-machine behavior explicit instead of burying it inside raw update queries.
**Done when:**
- [ ] Activate and deactivate flows no longer inline every phone-status update query separately
- [ ] Current status values and transition timing remain unchanged
- [ ] Rollback on activation failure still marks the tenant as `failed`
- [ ] All existing tests pass, new tests cover helper-driven status transitions if needed
**Why it matters:** Provisioning is already doing external side effects plus rollback, so naming the status transitions would make a fragile operational path easier to verify and extend safely.
**Tradeoff:** The helpers should stay tiny and route-local so the flow remains obvious during incident debugging.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it clarifies a stateful integration path where subtle mistakes would be expensive.

## Self-Review — 2026-04-22
**Cycles since last self-review:** 1
**What's working:** UX review is correctly staying skipped now that the component backlog is exhausted, and this cycle still found a fresh route cluster instead of circling back to the same dashboard helper files.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The anti-duplication rule added yesterday seems to be doing its job, and the current instructions still give a fresh agent enough structure to keep outputs specific without wasting cycles.

## Ideas — 2026-04-23 (architecture reviewed)

### Task: Extract voice-session list query construction into a route-local helper
**Status:** proposed
**Files to change:** `src/routes/voice.ts:L120-L220`
**What to do:** Move the `whereClause`, params array, optional customer/status filters, and count/list query wiring for `GET /voice/calls` into a small route-local helper that returns the query fragments plus params. Keep SQL behavior and response shape identical, but separate dynamic query construction from endpoint flow.
**Done when:**
- [ ] `GET /voice/calls` no longer assembles dynamic where-clause logic inline inside the route handler
- [ ] Count query and list query still use identical filter inputs and produce unchanged results
- [ ] Pagination and optional customer/status filters behave exactly as they do today
- [ ] All existing tests pass, new tests cover helper-driven query construction if needed
**Why it matters:** Dynamic query assembly mixed directly into route handlers makes even straightforward list endpoints harder to scan and maintain than they need to be.
**Tradeoff:** The helper should stay route-local and query-specific rather than becoming a generic SQL builder.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it simplifies a moderately dense route without changing behavior.

### Task: Consolidate customer existence checks for voice note and context endpoints into a shared helper
**Status:** proposed
**Files to change:** `src/routes/voice.ts:L220-L360`
**What to do:** Introduce a small route-local helper that verifies customer ownership and returns the key customer fields needed by the customer-context and add-note endpoints. Keep current 404 behavior and query results unchanged, but stop repeating customer existence and tenant-ownership verification inline.
**Done when:**
- [ ] Customer context and add-note flows no longer each inline their own customer existence checks
- [ ] Existing 404 behavior and returned data remain unchanged
- [ ] The helper stays local to voice-route customer checks and does not become a repository layer
- [ ] All existing tests pass, new tests cover helper-driven customer lookup if needed
**Why it matters:** Repeated tenant-ownership checks are easy to drift when multiple handlers in one file need the same guarantee.
**Tradeoff:** The helper should stay narrowly focused so it improves readability without hiding straightforward logic.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it reduces duplication in a route file with repeated customer verification logic.

### Task: Split CRM-facing customer routes from phone-context routes in voice.ts
**Status:** proposed
**Files to change:** `src/routes/voice.ts:L1-L360`, optional new files such as `src/routes/voice.crm.ts` and `src/routes/voice.context.ts`
**What to do:** Separate the voice session history and CRM-facing customer note/context endpoints from the agent-facing phone-context endpoint (`GET /voice/context/:phone`, called by the LiveKit agent at call time) so the route file stops mixing dashboard-style customer operations with telephony context delivery in one module. Keep URLs and payloads unchanged.
**Done when:**
- [ ] CRM-style voice/customer endpoints are registered separately from the phone-context endpoint
- [ ] Public route paths and response payloads remain unchanged
- [ ] Shared helper extraction happens only where it clearly reduces duplication between the split files
- [ ] All existing tests pass, new tests cover moved registration if needed
**Why it matters:** This route file already serves distinct consumers, dashboard CRM flows and call-time AI context, and splitting those responsibilities will make future changes safer and easier to reason about.
**Tradeoff:** File count increases, so the split should follow clear consumer boundaries rather than scattering logic too aggressively.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it clarifies ownership inside a route module that already spans multiple responsibilities.

## Self-Review — 2026-04-23
**Cycles since last self-review:** 1
**What's working:** UX is still correctly skipped, and this cycle kept the improvement log fresh by moving into the voice route family instead of repeating the recent reminders, version-history, dashboard, or sync batches.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still handling the post-UX-completion phase well, and they are still steering me away from obviously repetitive output.

## Ideas — 2026-04-23 (architecture reviewed)

(All tasks from this batch were dropped 2026-04-30 — they targeted `src/routes/tts.ts`, which was deleted in commit `661d21d` along with the rest of the Vapi custom-voice proxy. Phase 4 of the LiveKit migration replaces that route with a native `GrokTTS` class inside the agent worker.)

## Self-Review — 2026-04-23
**Cycles since last self-review:** 1
**What's working:** UX is still correctly skipped, and this cycle still found one genuinely new route family, TTS, after checking whether other candidate areas would just produce duplicates or dead ends.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still helping me stop and sanity-check freshness before writing, which is the right behavior now that the UX backlog is complete and the ideas log is mature.

## Ideas — 2026-04-24 (code patterns reviewed)

### Task: Replace skill-route validation and delete miss handling with shared route helpers
**Status:** proposed
**Files to change:** `src/routes/skills.ts:L1-L55`, `src/routes/routeHelpers.ts:L1-L80`
**What to do:** Update `POST /skills/create` to use `sendValidationError` instead of assembling its own validation-failure envelope, and update `DELETE /skills/:id` to use `assertRowAffected` or the same shared not-found path used by the other CRUD routes. Keep response payloads unchanged where practical, but stop leaving this small route on older one-off patterns.
**Done when:**
- [ ] Skill create no longer hand-builds its validation failure response
- [ ] Skill delete no longer checks `res.rows.length === 0` inline
- [ ] Success and not-found behavior stay consistent with the rest of the route layer
- [ ] All existing tests pass, new tests cover skill validation and missing-delete behavior if needed
**Why it matters:** `skills.ts` is a tiny route module, which makes it a good cleanup target for finishing the shared-helper rollout without much risk.
**Tradeoff:** The cleanup is mostly about consistency, so it should stay behavior-preserving and avoid broader skill-domain changes.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Well under an hour of cleanup would remove obvious legacy response patterns from a small CRUD file, a good maintenance return.

### Task: Extract employee name shaping into shared name utilities before create and update writes
**Status:** proposed
**Files to change:** `src/routes/employees.ts:L1-L120`, `src/services/nameUtils.ts:L1-L80`
**What to do:** Replace the route-local `firstName` / `lastName` / `displayName` assembly in employee create and update with the existing name utility layer, adding any tiny helper needed there for the current fallback rules. Preserve current persisted values and API behavior, but stop maintaining employee name composition logic separately from the rest of the backend’s name helpers.
**Done when:**
- [ ] Employee create no longer assembles display names inline in the route
- [ ] Employee update no longer recomputes display names inline in the route
- [ ] Persisted `name`, `first_name`, and `last_name` values stay unchanged for current inputs
- [ ] All existing tests pass, new tests cover helper-driven employee name shaping if needed
**Why it matters:** Name composition rules are easy to drift when some routes use shared utilities and others quietly keep local fallback logic.
**Tradeoff:** The helper change should stay narrowly focused on employee-name shaping and not turn `nameUtils` into a grab bag for unrelated field normalization.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it aligns a common write path with an existing shared utility instead of preserving another local variation.

### Task: Split date-specific schedule endpoints away from legacy weekly shift endpoints in shifts.ts
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L1-L260`, optional new files such as `src/routes/shifts.legacy.ts` and `src/routes/shifts.schedule.ts`
**What to do:** Separate the legacy `employee_shifts` CRUD endpoints from the date-specific `employee_schedule` and `copy-week` endpoints so the route file no longer mixes deprecated weekly-pattern flows with the production schedule model. Keep URLs and payloads unchanged, but make the file structure reflect the current architecture described in `CLAUDE.md`.
**Done when:**
- [ ] Legacy weekly-shift endpoints are registered separately from date-specific schedule/override endpoints
- [ ] Public route paths and response payloads remain unchanged
- [ ] Shared validation or helper extraction happens only where it clearly reduces duplication between the split files
- [ ] All existing tests pass, new tests cover moved registration if needed
**Why it matters:** `shifts.ts` currently mixes a legacy model with the live scheduling model, which makes one of the project’s trickiest domains harder to reason about than it should be.
**Tradeoff:** File count increases, so the split should follow the real domain boundary, legacy weekly shifts versus production date-specific scheduling, rather than scattering handlers too aggressively.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** A couple of careful hours would pay off well here because it would make a high-complexity scheduling file match the product’s actual architecture more honestly.

## Self-Review — 2026-04-24
**Cycles since last self-review:** 1
**What's working:** UX review is still correctly skipped, the latest idea batches remain bounded and file-specific, and the anti-duplication rule is still steering the work toward fresh route families instead of rehashing the same helper cleanups.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The process is still clear for a fresh agent, the output quality is holding up, and nothing in the current instructions looks stale enough to justify a tweak yet.

## Ideas — 2026-04-25 (architecture reviewed)

### Task: Separate webhook acknowledgement from provider-specific event processing in CRM routes
**Status:** proposed
**Files to change:** `src/routes/jobber.ts:L77-L140`, `src/routes/hubspot.ts:L76-L145`
**What to do:** In each webhook route, split the flow into three named steps: request validation/signature verification, immediate acknowledgement decision, and provider-specific async event processing. Keep the current URLs, status codes, and fire-and-forget behavior unchanged, but move the async post-ack work into small route-local functions like `processJobberWebhookEvent` and `processHubSpotWebhookEvent` so the handlers read as ingress flows instead of mixed ingress-plus-sync logic.
**Done when:**
- [ ] Jobber webhook route has a clearly separated async processing function after the immediate reply path
- [ ] HubSpot webhook route has a clearly separated async processing function after the immediate reply path
- [ ] Existing signature validation, status codes, and async sync behavior remain unchanged
- [ ] All existing tests pass, new tests cover helper-driven webhook processing if needed
**Why it matters:** Webhook endpoints are easiest to debug when request admission and background work are clearly separated, especially once signature checks, tenant lookup, and sync fan-out accumulate in the same handler.
**Tradeoff:** The extraction adds a couple of local helper functions, so it should stop at readability and not try to force both providers into one shared webhook framework.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Less than an hour of restructuring would make two high-sensitivity ingress routes easier to audit and debug, a worthwhile return.

## Self-Review — 2026-04-25
**Cycles since last self-review:** 1
**What's working:** UX review is correctly staying skipped now that the component backlog is done, and the improvement pass can still stay concrete when it deliberately moves into a fresh integration route family.
**What I changed in HEARTBEAT.md:** Added one Continuous Improvement rule to prefer a different review area than the most recent idea entry unless other areas do not yield enough concrete, non-duplicate tasks.
**Why:** The duplicate-file guard helped, but the recent log still leaned too heavily on architecture batches in a row. This small rotation nudge should keep the improvement pass fresher without weakening the existing constraints.

## Ideas — 2026-04-25 (code patterns reviewed)

### Task: Replace repeated shift-route validation branches with sendValidationError
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L1-L260`, `src/routes/routeHelpers.ts:L1-L40`
**What to do:** Swap the repeated inline validation-failure branches across shift create, update, override create/update, and copy-week routes to use `sendValidationError`, keeping the payloads identical while removing duplicated error-envelope boilerplate from the file.
**Done when:**
- [ ] Shift create/update routes use `sendValidationError`
- [ ] Shift override create/update routes use `sendValidationError`
- [ ] Copy-week validation uses `sendValidationError`
- [ ] Validation response payloads remain unchanged for callers
- [ ] All existing tests pass, new tests cover validation-failure behavior if needed
**Why it matters:** This file repeats the same validation envelope pattern many times, and adopting the shared helper would make it easier to keep behavior consistent.
**Tradeoff:** The cleanup should stay scoped to envelope reuse and not turn into a larger shift-route refactor.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it removes repeated boilerplate from one of the denser CRUD route files.

### Task: Standardize zero-row not-found handling in shift and override mutations on assertRowAffected
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L60-L220`, `src/routes/routeHelpers.ts:L40-L70`
**What to do:** Replace the repeated `res.rows.length === 0` checks in shift and override update/delete routes with `assertRowAffected` or an equivalent shared helper path, preserving current 404 behavior and messages while aligning these mutations with the backend’s shared zero-row handling pattern.
**Done when:**
- [ ] Shift update/delete routes use shared zero-row mutation handling
- [ ] Shift override update/delete routes use shared zero-row mutation handling
- [ ] Current not-found behavior remains unchanged for callers
- [ ] All existing tests pass, new tests cover zero-row mutation cases if needed
**Why it matters:** Repeated zero-row handling is exactly the kind of thing that drifts subtly across multiple mutation endpoints in one file.
**Tradeoff:** The rollout should stay behavior-preserving and not broaden into unrelated route cleanup.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, solid gain because it aligns several closely related mutation routes with an existing shared convention.

### Task: Extract target-week override write loop from copy-week into a route-local helper
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L220-L320`
**What to do:** Pull the loop that transforms effective shifts into target-week override upserts into a small route-local helper that accepts tenant, employee, day offset, and effective rows. Keep copy-week behavior unchanged, but separate the transformation/upsert mechanics from the endpoint flow.
**Done when:**
- [ ] The copy-week route no longer inlines the full effective-row transform and upsert loop
- [ ] The helper stays local to shift copy-week behavior and does not become a generic scheduling abstraction
- [ ] Current copied-count behavior and upsert semantics remain unchanged
- [ ] All existing tests pass, new tests cover helper-driven copy-week behavior if needed
**Why it matters:** The copy-week route mixes validation, date math, data fetching, transformation, and writes in one flow, and splitting out the write loop would make it easier to reason about safely.
**Tradeoff:** The helper should stay tight and file-local so it clarifies the endpoint instead of hiding important scheduling details.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it simplifies the densest part of a multi-step scheduling mutation without changing behavior.

## Self-Review — 2026-04-25
**Cycles since last self-review:** 1
**What's working:** UX is still correctly skipped, and this cycle found another concrete, non-duplicate code-pattern slice in shifts without falling back to the heavily used api/hooks/sync families.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still giving enough guidance to find fresh route families and avoid repetitive output in the post-UX phase.

## Ideas — 2026-04-25 (architecture reviewed)

### Task: Extract tenant provisioning preflight checks into a route-local helper in provisioning.ts
**Status:** proposed
**Files to change:** `src/routes/provisioning.ts:L15-L80`
**What to do:** Pull the tenant lookup, missing-field detection, and phone-status conflict checks in `/provisioning/activate` into a small helper that returns either a normalized tenant provisioning context or the exact current error payload. Keep all behavior and messages unchanged, but separate preflight validation from the provisioning transaction flow.
**Done when:**
- [ ] `/provisioning/activate` no longer inlines tenant lookup plus prerequisite/status validation in one long block
- [ ] Missing-field and already-active/provisioning responses remain unchanged
- [ ] The helper stays local to provisioning-route concerns and does not become a service layer
- [ ] All existing tests pass, new tests cover helper-driven preflight behavior if needed
**Why it matters:** Provisioning already has a multi-step external side-effect flow, so pulling preflight checks out of the happy path will make the route safer and easier to reason about.
**Tradeoff:** The helper should stay narrowly scoped so it improves clarity without obscuring the actual provisioning sequence.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it shortens the riskiest route in the file without changing behavior.

### Task: Align provisioning status query validation with shared helper conventions
**Status:** proposed
**Files to change:** `src/routes/provisioning.ts:L200-L235`, `src/routes/routeHelpers.ts:L1-L160` if a tiny helper addition is warranted
**What to do:** Replace the ad hoc `tenant_id` query check in `/provisioning/status` with an existing shared validation helper or a very small addition to the helper layer so query-parameter validation looks like the rest of the backend. Preserve the current error payload and status unless a consciously shared contract is adopted.
**Done when:**
- [ ] `/provisioning/status` no longer uses a one-off inline query-param validation pattern if a shared helper can express it cleanly
- [ ] Current validation behavior remains unchanged unless deliberately normalized
- [ ] The solution stays small and does not invent a broad new abstraction for one route
- [ ] All existing tests pass, new tests cover provisioning status validation if needed
**Why it matters:** Small validation inconsistencies accumulate quickly across route files, and this endpoint is a clean place to validate a lightweight shared approach.
**Tradeoff:** If a shared helper would feel more awkward than the inline check, the change is not worth forcing.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it can reduce another small source of route-level inconsistency.

## Self-Review — 2026-04-25
**Cycles since last self-review:** 1
**What's working:** UX is still correctly skipped, and this cycle found one last clearly worthwhile route family, provisioning, without falling back to increasingly repetitive dashboard or helper-only variants.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still handling the mature post-UX phase well, and I do not see a process problem that needs fixing right now.

## Ideas — 2026-04-26 (UI/UX patterns reviewed)

### Task: Sync AI insights subtabs to the URL query state
**Status:** proposed
**Files to change:** `dashboard/components/AIInsightsView.tsx:L1-L30`, any shared tab/query helper already used by dashboard view shells if applicable
**What to do:** Replace the local `useState('persona')` tab selection with the same query-param pattern used elsewhere in the dashboard, for example `?subtab=persona` and `?subtab=analytics`. Validate the incoming value against the two allowed subtabs, default safely to `persona`, and keep back/forward navigation working when users switch between the AI Persona and Analytics panes.
**Done when:**
- [ ] Reloading the page preserves the active AI insights subtab
- [ ] Browser back/forward restores prior AI insights subtab changes
- [ ] Invalid or missing query values fall back cleanly to `persona`
- [ ] All existing tests pass, new tests cover the query-backed tab behavior
**Why it matters:** The rest of the dashboard already treats tab state as navigable state, so this view currently feels less consistent and easier to lose your place in.
**Tradeoff:** This adds a little routing plumbing to a tiny component, so the gain is mostly consistency and recoverability rather than new capability.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Less than an hour of small shell-state wiring would make this view behave like the rest of the dashboard, a good return for a high-visibility navigation surface.

### Task: Add explicit filtered-empty and detail-loading states to VoiceCallsView
**Status:** proposed
**Files to change:** `dashboard/components/VoiceCallsView.tsx:L69-L139`, `dashboard/components/VoiceCallsView.tsx:L160-L260`, `dashboard/components/VoiceCallsView.tsx:L271-L420`
**What to do:** Introduce a derived filtered-history array before render, then use it to show a dedicated empty state when the selected outcome filter returns zero visible calls even though history exists. In the same pass, add a small loading and failure state for `Api.voice.getSession()` when an active call row is clicked, so the right pane can show “loading details” or a retry affordance instead of silently leaving stale details on screen if the fetch is slow or fails.
**Done when:**
- [ ] Outcome filtering shows an explicit no-matching-calls state instead of an empty list with no explanation
- [ ] The call-history header or body reflects the filtered result count clearly
- [ ] Clicking an active call shows a visible detail-loading state until the full session arrives
- [ ] Active-call detail fetch failures surface a retry path instead of only logging to the console
- [ ] All existing tests pass, new tests cover filtered-empty and detail-loading/error states
**Why it matters:** This screen is operational and time-sensitive, so silent filter results and silent detail fetches make it feel less trustworthy exactly when someone is trying to move quickly.
**Tradeoff:** The component will carry a bit more local UI state, so the implementation should stay disciplined and avoid turning into a larger refactor.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** A couple of focused hours would remove two of the most confusing silent states in an operations view, a strong payoff for a screen people read under pressure.

## Self-Review — 2026-04-26
**Cycles since last self-review:** 1
**What's working:** UX review is now correctly staying skipped, and the output quality is still strongest when the improvement pass picks a concrete front-end slice instead of defaulting back to route-helper cleanup.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still clear for a fresh agent, and today’s pass did not show a process problem severe enough to justify another tweak.

## Ideas — 2026-04-27 (developer experience reviewed)

### Task: Extract session persistence keys and hydration logic into a dedicated dashboard session-storage helper
**Status:** proposed
**Files to change:** `dashboard/lib/SessionContext.tsx:L6-L89`, optional new helper file such as `dashboard/lib/sessionStorage.ts`
**What to do:** Move the raw `localStorage` key names and the repeated read/write/clear logic for `tenantId`, `userName`, `userEmail`, `managedTenantId`, and `managedTenantName` into one small helper module. Have `SessionProvider` call that helper for initial hydration, managed-tenant selection persistence, and logout cleanup so the context focuses on session state transitions rather than browser storage plumbing.
**Done when:**
- [ ] `SessionContext.tsx` no longer hardcodes the session-related localStorage keys in multiple places
- [ ] Initial session hydration, managed-tenant persistence, and logout cleanup all flow through one small helper API
- [ ] Existing super-admin and regular-user behavior remains unchanged
- [ ] All existing tests pass, new tests cover the helper-driven persistence behavior if needed
**Why it matters:** Session persistence is core dashboard infrastructure, and centralizing the storage contract would make future auth or tenant-selection changes easier to follow safely.
**Tradeoff:** This is mostly structural cleanup, so the helper needs to stay small and behavior-preserving instead of becoming a second session layer.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Less than an hour of focused extraction would remove a lot of quiet duplication from a critical context module, a solid maintenance return.

### Task: Make ThemeContext and VocabularyContext fail loudly when used outside their providers
**Status:** proposed
**Files to change:** `dashboard/lib/ThemeContext.tsx:L25-L75`, `dashboard/lib/VocabularyContext.tsx:L23-L79`
**What to do:** Change both contexts from default-value `createContext(...)` patterns to nullable contexts plus guarded hooks, matching the existing `useSessionContext` style. Keep `ThemeProvider` and `VocabularyProvider` behavior the same, but make `useTheme`, `useVocabulary`, and `useVocabularyRefresh` throw a clear error if someone forgets the provider instead of silently falling back to no-op state.
**Done when:**
- [ ] `ThemeContext` no longer exposes a silent default `setTheme: () => {}` fallback
- [ ] `VocabularyContext` no longer exposes a silent default refresh no-op fallback
- [ ] `useTheme`, `useVocabulary`, and `useVocabularyRefresh` throw descriptive provider-missing errors
- [ ] Existing runtime behavior remains unchanged when the providers are mounted correctly
- [ ] All existing tests pass, new tests cover the guard behavior
**Why it matters:** Silent context fallbacks make wiring mistakes harder to catch, especially in shared dashboard infrastructure that many views depend on.
**Tradeoff:** Missing-provider mistakes will fail fast instead of degrading quietly, which is the right developer experience but may require a couple of tests to be updated if they were mounting hooks incorrectly.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Very low effort for a worthwhile safety win, because it turns subtle integration mistakes into immediate, obvious failures.

### Task: Add provider-level tests for managed-tenant vocabulary refresh behavior
**Status:** proposed
**Files to change:** `dashboard/lib/SessionContext.tsx:L25-L127`, `dashboard/lib/VocabularyContext.tsx:L30-L79`, new tests such as `dashboard/lib/SessionContext.test.tsx` and `dashboard/lib/VocabularyContext.test.tsx`
**What to do:** Add focused tests that mount the real providers together and verify the behavior that is easiest to regress here: super-admin hydration from saved managed-tenant keys, regular-user fallback to their own tenant, vocabulary reset to defaults when no effective tenant exists, and vocabulary fallback to defaults when the fetch fails. Mock `Api.vocabulary.get` in the vocabulary tests, but keep the assertions at the provider contract level rather than unit-testing implementation details.
**Done when:**
- [ ] Session-provider tests cover super-admin managed-tenant hydration and regular-user effective-tenant behavior
- [ ] Vocabulary-provider tests cover default reset when no tenant is active
- [ ] Vocabulary-provider tests cover API failure fallback and refresh-triggered re-fetch behavior
- [ ] All existing tests pass, new tests exercise the provider contracts directly
**Why it matters:** These providers sit under most of the dashboard, and a small amount of contract-level coverage would catch regressions that are currently easy to miss until much later in UI testing.
**Tradeoff:** The cost is some provider test setup and mocking, so the value is mostly regression protection rather than immediate user-facing improvement.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** A couple of hours of targeted test setup would meaningfully harden dashboard infrastructure that many screens quietly depend on, a strong return.

## Self-Review — 2026-04-27
**Cycles since last self-review:** 1
**What's working:** The output format is still useful and the improvement pass stayed fresh by moving into dashboard context infrastructure instead of repeating another backend route family.
**What I changed in HEARTBEAT.md:** Clarified the UX file-selection rule to exclude `*.test.tsx` files when listing review targets.
**Why:** The UX review is already complete, but the old wording still technically pulled test components into the file list, which could make a fresh agent think the review was unfinished when only test files remained.

## Ideas — 2026-04-28 (architecture reviewed)

### Task: Split session auth endpoints from password-recovery flows in auth.ts
**Status:** proposed
**Files to change:** `src/routes/auth.ts:L35-L227`, optional new files such as `src/routes/auth.session.ts` and `src/routes/auth.passwordRecovery.ts`
**What to do:** Separate the login/register/refresh handlers from the forgot-password/reset-password handlers so the auth route registration stops mixing session issuance with recovery-token lifecycle management in one module. Keep URLs, rate limits, payloads, and token/email behavior unchanged, but move the password-reset token hashing and email-link flow into a dedicated route module or clearly isolated registration function.
**Done when:**
- [ ] Login, register, and refresh routes are registered separately from forgot-password and reset-password routes
- [ ] Public endpoint paths, rate limits, and response payloads remain unchanged
- [ ] Password-reset token hashing and email dispatch still behave exactly as they do today
- [ ] All existing tests pass, new tests cover moved route registration if needed
**Why it matters:** `auth.ts` currently spans two distinct responsibilities, normal session auth and recovery-token workflows, which makes a security-sensitive file harder to scan and audit than it needs to be.
**Tradeoff:** File count goes up slightly, so the split should follow the real domain boundary instead of creating a generic auth framework.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** A couple of careful hours would make one of the more security-sensitive route files easier to reason about without changing any public contract, a worthwhile return.

### Task: Separate tenant management routes from business-template administration in tenants.ts
**Status:** proposed
**Files to change:** `src/routes/tenants.ts:L52-L256`, optional new files such as `src/routes/tenants.templates.ts` and `src/routes/tenants.admin.ts`
**What to do:** Split the tenant CRUD/config/reorder handlers from the business-template listing and upsert handlers so the file structure matches the two different domains it currently serves. Keep all route paths and payloads unchanged, but stop maintaining tenant operations and template-catalog administration in one long route module.
**Done when:**
- [ ] Tenant CRUD/config/reorder handlers are registered separately from template list/create handlers
- [ ] `/tenants*` and `/templates*` URLs and payloads remain unchanged
- [ ] Shared schemas or helpers are extracted only where they clearly reduce duplication between the split files
- [ ] All existing tests pass, new tests cover moved registration if needed
**Why it matters:** Tenant administration and business-template administration have different consumers and different change rhythms, so keeping them interleaved makes a central admin route file noisier than it should be.
**Tradeoff:** The split adds a little navigation overhead, so it should follow the existing domain boundary cleanly rather than scattering logic too aggressively.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, good return because it aligns a busy admin module with the product’s actual domain split and should make future edits safer.

### Task: Replace the tenant-exempt path list with route-local preHandler guards for truly public endpoints
**Status:** proposed
**Files to change:** `src/middleware.ts:L147-L200`, `src/routes/auth.ts:L35-L227`, `src/routes/tenants.ts:L52-L256`, plus any other route modules that intentionally stay public
**What to do:** Reduce reliance on the global `TENANT_EXEMPT_ROUTES` string list by moving public-route intent closer to route registration, for example through small route-local `preHandler` guards or a narrow helper that marks routes as tenant-exempt when they are declared. Keep current public behavior unchanged, but stop making middleware correctness depend on one growing central list of hardcoded paths and prefixes.
**Done when:**
- [ ] Public auth/template routes no longer depend solely on a central hardcoded exemption list for tenant bypass
- [ ] Tenant middleware still skips the same public endpoints it skips today
- [ ] The replacement stays small and explicit, not a broad metadata system
- [ ] All existing tests pass, new tests cover tenant-middleware behavior for public and tenant-scoped routes
**Why it matters:** The current exemption list is easy to drift because every new public route requires remembering one far-away middleware file, which is exactly the sort of coupling that causes accidental auth or tenant-context regressions.
**Tradeoff:** This introduces a little route-registration ceremony, so it is only worth doing if the helper stays simple and makes intent more obvious than the current string list.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** A small amount of careful plumbing would remove a subtle cross-file maintenance hazard from the request pipeline, a strong payoff for core infrastructure.

## Self-Review — 2026-04-28
**Cycles since last self-review:** 1
**What's working:** UX review is correctly staying skipped now that every component file has been logged, and this pass stayed fresh by moving into auth and admin route boundaries instead of repeating another helper-adoption batch.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already handled the finished-UX state cleanly, and today’s outputs were still specific, non-duplicate, and easy for a fresh agent to reproduce.

## Ideas — 2026-04-30 (code patterns reviewed)

### Task: Extract communications send-result handling into one route-local helper
**Status:** proposed
**Files to change:** `src/routes/communications.ts:L86-L159`
**What to do:** Add one small helper in `communications.ts` that accepts the `CommunicationService` result and the fallback error message, then emits the shared `{ success: true, messageId }` or `{ success: false, error }` reply used by both `/communications/email` and `/communications/sms`. Keep the schemas, route URLs, and service calls unchanged, but stop maintaining the same success/failure reply branches twice.
**Done when:**
- [ ] `/communications/email` and `/communications/sms` no longer duplicate the same result-to-reply mapping
- [ ] Validation behavior and response payloads remain unchanged for both routes
- [ ] The helper stays local to communications route concerns and does not become a generic response abstraction
- [ ] All existing tests pass, new tests cover helper-driven email and SMS success/failure behavior if needed
**Why it matters:** These two mutation routes already share the same orchestration pattern, and leaving the reply handling duplicated makes small behavior tweaks drift-prone for no real benefit.
**Tradeoff:** The helper should stay narrow enough that the route file still reads clearly from schema to service call.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Well under an hour of cleanup would remove obvious duplication from two production mutation paths, a solid maintenance win.

### Task: Replace billing checkout plan parsing with a narrow Zod request schema
**Status:** proposed
**Files to change:** `src/routes/billing.ts:L21-L42`
**What to do:** Add a small `CheckoutSchema` near the top of `billing.ts` that validates `plan` against the existing `solo | growth | professional` set, then use `safeParse(req.body)` instead of the current `(req.body as any)` extraction and inline inclusion check. Keep the accepted plans, error message intent, and downstream Stripe logic unchanged.
**Done when:**
- [ ] `/billing/checkout` no longer casts `req.body` to `any` to read `plan`
- [ ] Plan validation is handled through a route-local schema rather than an inline array check
- [ ] Accepted plan values and billing behavior remain unchanged
- [ ] All existing tests pass, new tests cover invalid and valid plan payloads if needed
**Why it matters:** This route is security- and money-adjacent, so using the same schema-first pattern as the rest of the backend makes its request contract easier to trust and maintain.
**Tradeoff:** The gain is mostly consistency and type safety, so the change should stay tightly scoped to request validation rather than broader billing refactors.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it removes one of the file’s few `any`-shaped request paths from a high-consequence endpoint.

### Task: Reuse one provisioning validation schema for deactivate and status tenant lookup
**Status:** proposed
**Files to change:** `src/routes/provisioning.ts:L7-L10`, `src/routes/provisioning.ts:L148-L152`, `src/routes/provisioning.ts:L199-L204`
**What to do:** Add a shared `TenantIdSchema` or `TenantIdBodySchema` beside `ActivateSchema`, then use it for `/provisioning/deactivate` body validation and for `/provisioning/status` query validation. Keep the existing response behavior as close as possible, but stop defining one-off validation logic for the same tenant-id requirement in multiple places.
**Done when:**
- [ ] `/provisioning/deactivate` no longer inlines its own one-use `z.object({ tenant_id: ... })` schema
- [ ] `/provisioning/status` validates `tenant_id` through a schema instead of an ad hoc presence check
- [ ] Current error semantics remain unchanged unless a deliberately shared validation envelope is adopted
- [ ] All existing tests pass, new tests cover deactivate/status validation behavior if needed
**Why it matters:** Repeated tiny validation patterns are easy to let drift, and provisioning is exactly the kind of operational route file where small inconsistencies add up over time.
**Tradeoff:** This is a narrow consistency cleanup, so it should stay local to provisioning validation rather than expanding into a larger route rewrite.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Very low effort, modest but real gain because it removes two little validation inconsistencies from a stateful route family.

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** UX review is correctly staying skipped now that the component backlog is exhausted, and the latest idea entries are still concrete enough to hand to an engineer without extra interpretation.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already handle the finished-UX phase well, and this cycle still produced fresh, bounded work without obvious duplication pressure.

## Ideas — 2026-04-30 (architecture reviewed)

### Task: Extract Google OAuth client creation and config guards into one shared access helper
**Status:** proposed
**Files to change:** `src/services/googleCalendar.ts:L1-L80`
**What to do:** Replace the repeated `getConfig()` plus `createOAuth2Client()` null-check pattern with one small internal helper that either returns a configured OAuth client plus config or throws a route/service-friendly error. Preserve all current behavior, including `isGoogleCalendarEnabled`, but reduce the number of places that have to remember the same config guard sequence.
**Done when:**
- [ ] Google Calendar helper functions no longer each repeat the same config/client null-check pattern
- [ ] `isGoogleCalendarEnabled` still works exactly as it does today
- [ ] Current thrown error behavior remains unchanged where configuration is missing
- [ ] All existing tests pass, new tests cover helper-driven config access if needed
**Why it matters:** Repeated setup guards around external clients are easy to drift subtly, and consolidating them makes the service easier to modify safely.
**Tradeoff:** The helper should stay tiny and service-local so it improves clarity without hiding obvious behavior.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it reduces repeated configuration plumbing in a shared integration client.

### Task: Extract shared Google event requestBody shaping for createEvent and updateEvent
**Status:** proposed
**Files to change:** `src/services/googleCalendar.ts:L90-L170`
**What to do:** Move the repeated `summary/description/location/start/end/timeZone` requestBody construction into one helper used by both `createEvent` and `updateEvent`. Keep the exact Google API payload unchanged, but stop duplicating event-body shaping logic in two separate functions.
**Done when:**
- [ ] `createEvent` and `updateEvent` share one helper for Google Calendar requestBody construction
- [ ] Default timezone behavior remains unchanged
- [ ] The generated payload sent to Google is identical to current behavior
- [ ] All existing tests pass, new tests cover helper-driven event-body shaping if needed
**Why it matters:** Duplicated outbound payload construction is a classic source of subtle drift when new fields or defaults are added later.
**Tradeoff:** The helper should stay narrowly scoped to Google event-body shaping and not become a generic calendar abstraction.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it consolidates a repeated integration detail with almost no risk.

### Task: Split Google OAuth token lifecycle helpers from calendar event CRUD helpers
**Status:** proposed
**Files to change:** `src/services/googleCalendar.ts:L1-L170`, optional new files such as `src/services/googleCalendarAuth.ts` and `src/services/googleCalendarEvents.ts`
**What to do:** Separate auth-url/state/token lifecycle helpers from event create/update/delete helpers so the file stops mixing OAuth flow management with event CRUD in one module. Keep public behavior and exports stable if possible, but draw a clearer boundary between auth concerns and calendar event operations.
**Done when:**
- [ ] OAuth URL/state/token helpers are separated from event CRUD helpers by file or clearly isolated module sections
- [ ] Existing public behavior and caller expectations remain unchanged
- [ ] Shared helper extraction happens only where it clearly reduces duplication between the split concerns
- [ ] All existing tests pass, new tests cover any moved exports if needed
**Why it matters:** Auth lifecycle and event CRUD are distinct responsibilities, and separating them makes future changes easier to reason about and test.
**Tradeoff:** The split adds a little indirection, so it should follow a clear concern boundary rather than scattering tiny files.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it clarifies one of the codebase’s core external integration clients without expanding scope.

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** UX is still correctly skipped, and even this late in the process there are still a few genuinely different integration-service slices left if I sanity-check freshness before writing.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still steering me toward a good stop rule, only keep going when a materially fresh slice exists, and this cycle still met that bar.

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The process correctly treated the missing canonical UX notes file as a real state change instead of assuming prior completion still applied, which keeps the HEARTBEAT outputs aligned to the files it actually governs.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already describe the right behavior when the canonical output file disappears, recreate it and resume from there.

## Ideas — 2026-04-30 (architecture reviewed)

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The recreated root UX log is behaving as expected again, and this cycle resumed the canonical backlog cleanly while using one fully readable shared backend file to keep the ideas pass concrete.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still handling missing-file recovery and normal continuation well enough, so there is no strong reason to tweak them.

## Ideas — 2026-04-30 (architecture reviewed)

### Task: Split OAuth callback persistence from redirect construction in createOAuthCallbackHandler
**Status:** proposed
**Files to change:** `src/services/oauthCallbackFactory.ts:L1-L130`
**What to do:** Refactor `createOAuthCallbackHandler` so token exchange plus DB upsert live in one small internal persistence step, while success/error redirect URL construction lives in another. Keep the public factory contract and runtime behavior unchanged, but separate the side-effect-heavy persistence logic from navigation branching.
**Done when:**
- [ ] OAuth callback token persistence is isolated from redirect URL construction inside `oauthCallbackFactory.ts`
- [ ] Success and failure redirects behave exactly as they do today
- [ ] The persistence step can be tested or reasoned about without reading redirect branching at the same time
- [ ] All existing tests pass, new tests cover the separated persistence and redirect paths if needed
**Why it matters:** OAuth callbacks combine side effects and navigation decisions in one place, and separating them makes the shared integration layer easier to reason about and safer to change.
**Tradeoff:** The extraction should stay local to the factory and not expand into a larger OAuth framework rewrite.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it clarifies a shared multi-provider integration choke point without changing behavior.

### Task: Extract tenant_integration_settings upsert SQL assembly into a route-local helper within oauthCallbackFactory
**Status:** proposed
**Files to change:** `src/services/oauthCallbackFactory.ts:L40-L110`
**What to do:** Move the two-branch upsert logic, with and without `extraSettings`, into one small helper that returns the query text and params or performs the upsert directly. Keep the stored values and ON CONFLICT behavior unchanged, but reduce the duplicated SQL shape inside the callback handler.
**Done when:**
- [ ] The OAuth callback handler no longer carries two near-duplicate upsert query blocks inline
- [ ] Upsert behavior remains identical for both plain-token and extra-settings providers
- [ ] The helper stays local to callback persistence concerns and does not become a generic DB abstraction
- [ ] All existing tests pass, new tests cover helper-driven upsert behavior if needed
**Why it matters:** Duplicated persistence branches are easy to drift, especially in a shared multi-provider factory that several integrations depend on.
**Tradeoff:** The helper should remain very small so it clarifies the handler rather than hiding straightforward SQL behavior.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it removes duplication from a shared integration path with little risk.

### Task: Add a small provider-display metadata helper in oauthCallbackFactory
**Status:** proposed
**Files to change:** `src/services/oauthCallbackFactory.ts:L20-L45`
**What to do:** Replace the ad hoc `displayName` and query-param naming assembly with a small helper that returns the provider’s display label plus success/error query parameter names. Preserve all current redirect URLs and log messages unchanged, but make provider-specific naming logic explicit in one place.
**Done when:**
- [ ] Provider display label and success/error query param names are derived through one helper
- [ ] Redirect URLs and log messages remain unchanged for all current providers
- [ ] The handler body reads more clearly by separating provider metadata from control flow
- [ ] All existing tests pass, new tests cover helper-driven naming if needed
**Why it matters:** Small provider-specific naming rules are easy to scatter in shared factories, and collecting them improves readability and future extension safety.
**Tradeoff:** The helper should stay tiny and local so it adds clarity rather than ceremony.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest but real gain because it trims repeated provider-metadata logic from a shared factory.

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The recreated root UX log is still progressing cleanly, and this cycle stayed grounded by pairing a concrete CRM/admin UX slice with a fully readable shared integration factory instead of stretching across partially clipped files.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing specific, useful outputs and handling the rebuilt-root state without confusion.

## Ideas — 2026-04-30 (code patterns reviewed)

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The recreated root UX log is continuing predictably, and this cycle stayed concrete by pairing a clear customer/recovery UX slice with one fully readable CRUD route instead of stretching across clipped files.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still handling the rebuilt-root workflow and small-batch continuation without confusion or wasted work.

## Ideas — 2026-04-30 (architecture reviewed)

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The recreated root UX log is still progressing cleanly, and this cycle stayed grounded by pairing a practical UX slice with one fully readable shared integration factory instead of stretching across clipped files.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing specific, useful outputs and handling the rebuilt-root state without confusion.

## Ideas — 2026-04-30 (code patterns reviewed)

### Task: Replace employee route validation branches with sendValidationError
**Status:** proposed
**Files to change:** `src/routes/employees.ts:L40-L110`, `src/routes/routeHelpers.ts:L1-L40`
**What to do:** Swap the inline validation-failure branches in employee create and update to use `sendValidationError`, keeping the response payload exactly the same while removing repeated validation envelope boilerplate from the route file.
**Done when:**
- [ ] Employee create uses `sendValidationError` for schema parse failures
- [ ] Employee update uses `sendValidationError` for schema parse failures
- [ ] Validation response payloads remain unchanged for callers
- [ ] All existing tests pass, new tests cover validation-failure behavior if needed
**Why it matters:** Shared helper conventions only pay off if real CRUD routes adopt them, and this file still repeats the same validation envelope manually.
**Tradeoff:** This is a narrow consistency cleanup, so it should stay scoped to the employee file rather than triggering a broad rewrite.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it makes a representative CRUD route more consistent immediately.

### Task: Standardize employee delete not-found handling on assertRowAffected
**Status:** proposed
**Files to change:** `src/routes/employees.ts:L70-L100`, `src/routes/routeHelpers.ts:L40-L70`
**What to do:** Replace the route-local `res.rows.length === 0` check in employee delete with `assertRowAffected` or a closely related shared helper path, preserving the current 404 behavior and message while aligning this mutation with the rest of the backend’s shared zero-row handling pattern.
**Done when:**
- [ ] Employee delete no longer uses its own inline zero-row not-found branch
- [ ] Current 404 behavior and message remain unchanged for callers
- [ ] Employee delete follows the same shared zero-row handling pattern already used in employee update
- [ ] All existing tests pass, new tests cover zero-row delete behavior if needed
**Why it matters:** Inconsistent zero-row handling is a subtle reliability problem, especially when two mutation endpoints in the same file already use different patterns.
**Tradeoff:** The change should stay behavior-preserving and not expand into unrelated employee-route cleanup.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, solid gain because it aligns a common mutation path with the route’s existing shared-helper pattern.

### Task: Extract employee display-name normalization into a small route-local helper
**Status:** proposed
**Files to change:** `src/routes/employees.ts:L45-L80`, `src/services/nameUtils.ts:L1-L80` only if a shared helper fit is clearly better
**What to do:** Pull the repeated first-name/last-name to display-name composition logic used in employee create/update into one small helper, either route-local or shared via `nameUtils` if that remains clean. Keep current fallback behavior identical.
**Done when:**
- [ ] Employee create/update no longer each shape display names inline
- [ ] Current fallback behavior for `name`, `first_name`, and `last_name` remains unchanged
- [ ] The helper sits in the smallest scope that keeps the code clear
- [ ] All existing tests pass, new tests cover display-name composition behavior if needed
**Why it matters:** Name-shaping logic is easy to drift when it is repeated across multiple mutations in the same route file.
**Tradeoff:** The helper should only move to shared scope if it remains obviously useful there; otherwise route-local is better.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest but real gain because it reduces repetition in a route that already mixes several employee name fields.

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The rebuilt root UX backlog is still progressing in clear slices, and this cycle kept the ideas pass fresh by switching from shared integration factories to a fully readable employee-route CRUD pattern.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still supporting clean rotation and concrete outputs without pushing me into repetitive filler.

## Ideas — 2026-04-30 (code patterns reviewed)

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The rebuilt root UX backlog is still progressing in clean slices, and this cycle stayed grounded by pairing a coherent onboarding trio with one fully readable CRUD route instead of stretching across clipped files.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still supporting small-batch continuation and producing specific, useful outputs without confusion.

## Ideas — 2026-04-30 (architecture reviewed)

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The recreated root UX log is still moving predictably, and this cycle paired a clean shell-and-recovery UX slice with one fully readable shared service to keep the ideas pass concrete.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing specific, useful outputs and handling the rebuilt-root state without confusion.

## Ideas — 2026-04-30 (developer experience reviewed)

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The rebuilt root UX backlog is still shrinking in coherent slices, and this cycle kept the improvement pass fresh by returning to shared dashboard infrastructure instead of repeating another route-helper or service-factory batch.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still supporting small-batch continuation and producing specific, useful outputs without confusion.

## Ideas — 2026-04-30 (code patterns reviewed)

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The root UX backlog is narrowing into a clear setup-wizard cluster, and the ideas pass is still finding concrete, non-duplicate helper adoption work by switching route families instead of reusing the same CRUD file over and over.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still giving enough structure to keep the rebuilt-root workflow productive without added churn.

## Ideas — 2026-04-30 (architecture reviewed)

### Task: Split appointment fetch and external-event sync-map handling out of syncAppointmentToCalendar branches
**Status:** proposed
**Files to change:** `src/services/calendarSync.ts:L40-L165`
**What to do:** Extract the repeated appointment fetch and sync-map lookup/update steps from the create/update/delete branches of `syncAppointmentToCalendar` into small internal helpers so the main function reads more clearly as token acquisition plus action dispatch. Keep behavior unchanged, including current log messages and fallback-to-create logic.
**Done when:**
- [ ] Appointment fetch logic is no longer duplicated across create/update branches
- [ ] Sync-map lookup/update/delete mechanics are isolated in small internal helpers
- [ ] Fallback-to-create behavior for missing sync entries remains unchanged
- [ ] All existing tests pass, new tests cover helper-driven sync-map behavior if needed
**Why it matters:** Multi-branch sync code becomes harder to reason about when each branch repeats its own DB lookup scaffolding around the real provider action.
**Tradeoff:** The helpers should stay local and action-specific so they clarify the flow without hiding important sequencing details.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it simplifies a dense integration flow without altering semantics.

### Task: Extract provider-specific delete warning handling into a small helper in calendarSync
**Status:** proposed
**Files to change:** `src/services/calendarSync.ts:L110-L150`
**What to do:** Move the “delete may fail because the event is already gone, warn but continue cleanup” behavior into a small helper used by the delete branch. Preserve logging text and map cleanup behavior, but separate provider-delete failure tolerance from the rest of the delete path.
**Done when:**
- [ ] The delete branch no longer inlines its provider delete warning/continue logic
- [ ] Existing warning text and cleanup semantics remain unchanged
- [ ] The helper stays local to calendar-sync delete behavior and does not become a generic error wrapper
- [ ] All existing tests pass, new tests cover helper-driven delete tolerance if needed
**Why it matters:** Partial-failure tolerance is the subtle part of the delete flow, and isolating it makes that policy easier to verify safely.
**Tradeoff:** The helper should remain tiny and route-local so it improves clarity without hiding straightforward control flow.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest but real gain because it isolates the trickiest branch-specific policy in the file.

### Task: Separate calendar event payload shaping from Google-specific return typing in buildCalendarEvent
**Status:** proposed
**Files to change:** `src/services/calendarSync.ts:L150-L190`, `src/services/googleCalendar.ts:L1-L40` if a shared type extraction is warranted
**What to do:** Decouple `buildCalendarEvent` from the Google-specific `CalendarEventInput` return type by moving the shared event-shape contract into a neutral local or shared type that both provider modules can consume. Keep the payload fields unchanged.
**Done when:**
- [ ] `buildCalendarEvent` no longer depends directly on a Google-specific exported type unless that type is intentionally promoted as shared calendar contract
- [ ] Event payload fields remain unchanged for Google and Outlook providers
- [ ] The shared contract stays small and clearly scoped to cross-provider calendar event sync
- [ ] All existing tests pass, new tests cover the shared event payload contract if needed
**Why it matters:** A cross-provider sync service should not need to lean on one provider’s type name for its core event payload contract if the shape is conceptually shared.
**Tradeoff:** The type extraction should stay modest and avoid inventing a large new shared calendar abstraction.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it makes the service boundary more provider-neutral with minimal code churn.

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The UX backlog is now collapsing into a clear SetupWizard cluster, and this cycle paired that with a genuinely different integration-service architecture slice instead of more CRUD helper reuse.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still steering the work toward fresh, bounded slices without forcing repetitive output.

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The rebuilt root UX backlog is still the highest-value work, and this cycle correctly prioritized fully readable UI surfaces over forcing another improvement batch that would likely have been repetitive.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already allow skipping a lower-value slice when another task, here the recreated UX backlog, is clearly more useful to continue.

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** Skipping the lower-value improvement pass this cycle was the right call, because the recreated root UX backlog is still substantial and the tenant/admin cluster yielded more concrete value than another near-duplicate ideas batch would have.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already allow prioritizing the most useful outstanding task, and right now the recreated UX notes backlog is still that task.

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The remaining value is still concentrated in the recreated UX backlog, and this cycle kept following that signal by clearing a dense scheduler cluster instead of forcing another lower-value improvement batch.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already support prioritizing the most useful remaining work, and right now that is still finishing the rebuilt UX notes file.

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The recreated UX backlog is now almost fully burned down, and skipping extra improvement work in favor of the remaining scheduler cluster is still the highest-value choice.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already support prioritizing the most useful remaining task, and right now that is clearly finishing the rebuilt UX notes backlog.

## Self-Review — 2026-04-30
**Cycles since last self-review:** 1
**What's working:** The recreated UX backlog is now fully cleared again, and prioritizing the remaining skill-map cluster over another low-value improvement batch was the right endgame move.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already supported the right finish, keep focusing on the highest-value remaining task until the canonical UX log is complete again.

## Ideas — 2026-05-01 (code patterns reviewed)

### Task: Introduce a shared agent-tool response contract across route, client, and agent formatter
**Status:** proposed
**Files to change:** `src/routes/agentTools.ts:L124-L167`, `src/routes/agentTools.ts:L566-L571`, `agent/src/toolsClient.ts:L17-L118`, `agent/src/tools.ts:L23-L33`
**What to do:** Add one small shared contract for `/agent-tools/*` success and failure envelopes, including the optional `error_code` field, then update the Fastify route helpers, the `ToolsClient` envelope parsing, and `formatResponse()` so they all consume the same shape instead of each re-declaring it locally. Keep runtime payloads unchanged, but stop making the route, client, and agent formatter each carry their own parallel idea of the response contract.
**Done when:**
- [ ] `/agent-tools/*` success and failure envelope types are declared in one shared location
- [ ] `ok()`, `fail()`, and the `book-with-scheduling` error branch use that shared contract
- [ ] `ToolsClient.call()` parses the shared envelope shape without its own inline envelope type literal
- [ ] `formatResponse()` still preserves `error_code` for the LLM and all existing tests pass, new tests cover the shared contract if needed
**Why it matters:** This is a three-hop boundary, route to HTTP client to LLM formatter, and duplicated envelope definitions make subtle drift easy when one side adds or changes a field.
**Tradeoff:** The shared contract should stay tiny and transport-focused, not turn into a large cross-runtime abstraction layer.
**Size:** small (< 1hr)
**Impact:** high
**Effort vs Gain:** Under an hour of shared typing would remove a real drift risk from one of the app’s most sensitive integration seams, a strong return.

### Task: Extract repetitive LiveKit tool execute wiring into small helper builders in agent/src/tools.ts
**Status:** proposed
**Files to change:** `agent/src/tools.ts:L35-L306`
**What to do:** Add one or two tiny local helpers in `agent/src/tools.ts` for the common execute patterns, for example no-arg passthrough tools and argument-mapping tools that end with `client.call(...)` plus `formatResponse(res)`. Keep every tool name, description, and parameter schema unchanged, but stop repeating the same execute boilerplate across the whole tool map.
**Done when:**
- [ ] No-arg tools like `get_service_catalog` and `get_customer_context` share one obvious execute helper where it improves clarity
- [ ] Argument-mapping tools use a small helper only when it reduces repetition without hiding request-shaping details
- [ ] Tool names, descriptions, parameter schemas, and request bodies remain unchanged
- [ ] All existing tests pass, and the file is easier to scan from tool description to request shape
**Why it matters:** The interesting parts of this file are the tool contracts and payload mapping, but the repeated async-call-format wrapper makes those differences harder to see than they need to be.
**Tradeoff:** The helpers must stay very small and local, otherwise they will obscure the request-shaping logic they are meant to clarify.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it trims boilerplate from a central agent boundary without changing behavior.

### Task: Reuse one scheduling-window parser across availability and booking agent-tool routes
**Status:** proposed
**Files to change:** `src/routes/agentTools.ts:L245-L276`, `src/routes/agentTools.ts:L399-L408`, `src/routes/agentTools.ts:L514-L525`
**What to do:** Extract the repeated date parsing and range validation for agent scheduling routes into a narrow helper, for example one path for `start/end` validation and one for `{ from, to }` windows. Preserve the current conversational error messages and the existing `dateStr` derivation behavior, but stop open-coding `Date.parse`, `new Date(...)`, and end-after-start checks in multiple handlers.
**Done when:**
- [ ] `check-availability`, `scheduling-options`, and `book-with-scheduling` no longer each inline their own date parsing and end-after-start checks
- [ ] Current conversational validation messages remain unchanged for callers
- [ ] `dateStr` and ISO window behavior remain unchanged for scheduling lookups and RPC calls
- [ ] All existing tests pass, new tests cover the shared parsing helper behavior if needed
**Why it matters:** Time-window validation is subtle shared policy in the live-call path, and repeating it makes future timezone or validation edits easier to miss in one route than another.
**Tradeoff:** The helper should stay route-local and specific to these agent-tool handlers, not become a generic date utility grab bag.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good return because it consolidates a bug-prone validation pattern in a live-call codepath.

## Self-Review — 2026-05-01
**Cycles since last self-review:** 1
**What's working:** The UX notes are useful again now that the last unreviewed SetupWizard/settings files have been covered, and the improvement pass stayed fresh by moving into the LiveKit agent-tool boundary instead of rehashing another CRUD helper family.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already handled the finished-UX state correctly, and this cycle still produced a concrete, non-duplicate improvement slice without extra steering.

## Ideas — 2026-05-02 (architecture reviewed)

### Task: Fetch live tenant prompt config before starting the agent session
**Status:** ALREADY SHIPPED — closed by commit `e92b3bf` on 2026-05-01 (NEEDS-REFACTORING #2 P0). The journal-loop run that produced this entry was scheduled before that commit landed and didn't see the change. New `POST /agent-tools/tenant-config` route reads `name`+`timezone` from `tenants`; `agent/src/tenantConfig.ts` calls it on connect; the hardcoded `DYNATIRE_TENANT_ID` / `TENANT_DEFAULTS` block is gone. 10 new tests cover the route + agent fallback. Leaving this entry in place as a marker of the duplicate so the loop generator's behavior is auditable later — see the Self-Review at the bottom of this batch.

### Task: Extract agent session construction into a shared worker helper
**Status:** proposed
**Files to change:** `agent/src/index.ts:L118-L156`, optional new helper such as `agent/src/sessionFactory.ts`
**What to do:** Move the repeated `new voice.AgentSession({ vad, stt, llm, tts })` construction used in both the normal entry path and `runFallback()` into one small helper that accepts `ctx.proc.userData.vad` and returns the configured session. Keep model choices, TTS voice selection, and runtime behavior unchanged, but stop maintaining the primary and fallback session wiring in two places.
**Done when:**
- [ ] Normal startup and fallback startup both create their `voice.AgentSession` through one shared helper
- [ ] Deepgram, OpenAI, and Grok TTS config remain identical to current behavior
- [ ] The fallback path still says the provided message and the normal path still starts the full tool-backed agent
- [ ] All existing tests pass, new tests cover the shared session-construction helper if added
**Why it matters:** The worker’s most important runtime wiring currently exists in duplicate, which makes future model or provider changes easy to apply to one path and forget in the other.
**Tradeoff:** The helper should stay tiny and worker-local so it removes duplication without hiding the bootstrap flow.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Well under an hour would remove a meaningful drift risk from the worker’s two startup paths, a solid maintenance return.

### Task: Isolate SIP participant wait logic from the rest of agent bootstrap
**Status:** proposed
**Files to change:** `agent/src/index.ts:L71-L97`, `agent/src/sessionContext.ts:L1-L88`, optional new tests alongside existing session-context tests
**What to do:** Extract the `Promise.race([ctx.waitForParticipant(), timeout])` block and the follow-up attribute normalization into one small bootstrap helper that returns `participantAttributes` plus any timeout outcome needed for logging. Keep the 5-second timeout and current non-fatal fallback behavior unchanged, but separate caller-info acquisition from the rest of the entry flow so tenant parsing, tool construction, and prompt assembly are easier to read.
**Done when:**
- [ ] `entry()` no longer inlines the full SIP participant wait and timeout block
- [ ] The 5-second timeout and non-fatal null-participant behavior remain unchanged
- [ ] Caller phone and call ID extraction still flow through `buildSessionContext` exactly as they do today
- [ ] All existing tests pass, new tests cover the helper’s timeout and success paths if added
**Why it matters:** The agent bootstrap currently mixes transport waiting, metadata parsing, prompt setup, and session startup in one function, which makes the entry path harder to reason about than it needs to be.
**Tradeoff:** This is mostly readability work, so the helper should stay narrow and avoid turning the worker bootstrap into a mini-framework.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it makes the live-call bootstrap easier to audit without changing behavior.

## Self-Review — 2026-05-02
**Cycles since last self-review:** 1
**What's working:** UX review is genuinely complete now, and the latest improvement entries are still actionable, but the file-completion check was a little too stem-based for alias components like `SetupWizard.tsx` and `SetupWizard/index.tsx`.
**What I changed in HEARTBEAT.md:** Added a UX-review note to match reviewed items by full file path, not just component name.
**Why:** That keeps future agents from wasting a cycle on false “unreviewed” results when two files share the same component stem.

## Ideas — 2026-05-03 (UI/UX patterns reviewed)

### Task: Separate live booking metrics from Phase 2 placeholders in AnalyticsView
**Status:** proposed
**Files to change:** `dashboard/components/AnalyticsView.tsx:L147-L295`
**What to do:** Split the current six-card grid into two clearly labeled groups inside the same page: one section for booking-data metrics that are live today, and one section for metrics that are intentionally unavailable until call-log integration lands. Keep the existing metric content and copy style, but stop mixing interactive live data and placeholder cards in one undifferentiated grid. Use the existing card styling and theme tokens rather than introducing a new visual system.
**Done when:**
- [ ] AnalyticsView renders a clearly labeled live-data section and a clearly labeled coming-later section
- [ ] The three booking-backed metrics stay visible without placeholder cards visually competing with them
- [ ] Phase 2 metrics still explain why they are unavailable, but no longer read like half-working cards in the main results grid
- [ ] All existing tests pass, new tests cover the grouped render states
**Why it matters:** The current layout makes the screen feel more incomplete than it is, because real insights and deferred metrics share the same visual weight.
**Tradeoff:** This is mostly presentation restructuring, so it improves clarity without increasing capability, and it carries some regression risk around spacing and responsive layout.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Under an hour of layout cleanup would make this page feel much more intentional, a good return for a high-visibility dashboard surface.

### Task: Replace silent mock fallback in AIConfigView with explicit load-failure and retry states
**Status:** proposed
**Files to change:** `dashboard/components/AIConfigView.tsx:L24-L89`, `dashboard/components/AIConfigView.tsx:L118-L141`
**What to do:** Remove the current "failed fetch means show `MOCK_TENANT`" behavior for persona settings and replace it with explicit shell states: loading, loaded, and load failed with a retry action. Keep template browsing available only when the real config is present, or clearly mark it unavailable during failure. Preserve the existing save flow, but stop rendering fake tenant data that can be mistaken for the business’s real prompt and greeting.
**Done when:**
- [ ] AIConfigView no longer falls back to `MOCK_TENANT` when config loading fails
- [ ] The screen shows a clear retryable failure state for config fetch problems
- [ ] Save controls are disabled or withheld until real tenant config has loaded
- [ ] All existing tests pass, new tests cover config-load failure and retry behavior
**Why it matters:** Showing mock content on fetch failure is a trust problem on a settings screen, because operators can believe they are editing live AI behavior when they are not.
**Tradeoff:** This adds a little shell-state branching and may leave the screen temporarily less populated during failures, but that honesty is preferable to silent fake data.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** 1-2 hours of shell-state cleanup would remove a misleading fallback from a high-stakes configuration surface, a strong return.

### Task: Move AIConfigView preview and test surfaces onto shared theme-token styling
**Status:** proposed
**Files to change:** `dashboard/components/AIConfigView.tsx:L267-L351`
**What to do:** Replace the hardcoded `bg-gray-*`, `text-gray-*`, `dark:bg-[#1a1a1a]`, and raw close `<button>` styling in the test card and template-preview modal with the same CSS-variable surfaces and shared button treatment used elsewhere in the dashboard. Keep the structure and copy the same, but make the card and modal match the project’s eight dark themes and primitive conventions.
**Done when:**
- [ ] The "Ready to test?" card uses theme-token backgrounds and text colors instead of hardcoded gray values
- [ ] Template preview sections use theme-token surfaces consistently across all preview blocks
- [ ] The modal close action uses shared button styling or a clearly consistent primitive treatment
- [ ] All existing tests pass, and the screen remains visually consistent across themes
**Why it matters:** This file currently drifts from the rest of the dashboard in one of the more visible persona-management flows, which weakens visual consistency across themes.
**Tradeoff:** The gain is polish and consistency rather than new behavior, so the work should stay tightly scoped and avoid turning into a broader AIConfig refactor.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Less than an hour of styling cleanup would remove obvious theme drift from a prominent settings view, a solid payoff.

## Self-Review — 2026-05-03
**Cycles since last self-review:** 1
**What's working:** UX review is now correctly skippable, and the strongest improvement output comes from concrete front-end slices like the AI insights cluster, where the tasks can be specific without repeating old backend helper cleanups.
**What I changed in HEARTBEAT.md:** Added a Continuous Improvement note to treat recently shipped or dropped file clusters as recent churn and move to a different slice unless the next task is materially different.
**Why:** The improvement log is mature enough now that stale or already-invalidated ideas are a bigger risk than under-specification, so this small rule should cut down on rediscovering work that just changed.

## Ideas — 2026-05-04 (developer experience reviewed)

### Task: Split agent tool registration by conversation domain
**Status:** proposed
**Files to change:** `agent/src/tools.ts:L35-L345`, `agent/src/tools.test.ts:L54-L325`, new files such as `agent/src/tools.booking.ts` and `agent/src/tools.customer.ts`
**What to do:** Break the single `buildTools()` return object into 2-3 small domain builders, for example customer/context, scheduling/booking, and policy/verification, then merge them in `tools.ts` for the final export. Keep the public tool names, descriptions, parameter schemas, payload shapes, and context injection behavior exactly the same. Update `tools.test.ts` so the top-level contract tests still pin the full 10-tool registry while new focused tests cover each domain builder where it reduces duplication.
**Done when:**
- [ ] `agent/src/tools.ts` no longer holds all 10 tool definitions inline in one return object
- [ ] Public tool names and backend route payloads remain unchanged
- [ ] The top-level `buildTools()` export still returns the exact same tool registry contract
- [ ] All existing tests pass, new tests cover the split builders where helpful
**Why it matters:** This file is now one of the worker's core contracts, and packing every tool schema, description, and execute body into one module makes routine edits harder to scan and review than they need to be.
**Tradeoff:** More files adds a little navigation overhead, so the split should follow obvious conversation domains and stop there instead of turning into a micro-module maze.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** 1-2 hours of structural cleanup would make a high-signal worker boundary much easier to maintain without changing runtime behavior, a solid return.

### Task: Introduce a typed agent-tool contract map for ToolsClient and tool tests
**Status:** proposed
**Files to change:** `agent/src/toolsClient.ts:L17-L118`, `agent/src/tools.ts:L35-L345`, `agent/src/tools.test.ts:L21-L325`, `agent/src/toolsClient.test.ts:L25-L224`
**What to do:** Add a shared TypeScript contract map that ties each `/agent-tools/*` path to its request body and expected result shape, then make `ToolsClient.call()` generic over that map instead of accepting an arbitrary `string` path plus `unknown` body. Update `buildTools()` and the tests to use the typed paths and payloads so route-name drift, missing required fields, and mismatched result assumptions fail at compile time before they reach a live call.
**Done when:**
- [ ] `ToolsClient.call()` is constrained by a shared path-to-request/result contract instead of raw string + unknown inputs
- [ ] `agent/src/tools.ts` uses the typed route contracts for its backend calls
- [ ] `tools.test.ts` and `toolsClient.test.ts` compile against the same shared path contract
- [ ] All existing tests pass, TypeScript remains clean
**Why it matters:** The worker/backend boundary is one of the easiest places for subtle drift to sneak in, and right now a misspelled route or payload mismatch can compile cleanly until it breaks in-call.
**Tradeoff:** The type map adds some upfront ceremony, so it is only worth doing if it stays tightly scoped to the existing 10 agent-tool routes.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** A couple of careful hours would buy stronger compile-time protection on a live-call integration boundary, which is a strong payoff for the amount of code involved.

## Self-Review — 2026-05-04
**Cycles since last self-review:** 1
**What's working:** UX review is genuinely complete now, and the process correctly skipped it while still producing a fresh improvement slice by moving to the agent-side tool boundary instead of revisiting recently changed dashboard files.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already handled the finished-UX state and recent-churn avoidance well, and this cycle still produced concrete, non-duplicate tasks without extra tuning.

## Ideas — 2026-05-05 (developer experience reviewed)

### Task: Normalize SessionProvider login and hydration transitions to clear stale managed-tenant state
**Status:** proposed
**Files to change:** `dashboard/lib/SessionContext.tsx:L35-L69`, new tests such as `dashboard/lib/SessionContext.test.tsx`
**What to do:** Refactor the SessionProvider hydration and `login()` path so they both run through one small session-normalization helper that explicitly handles the two supported modes: super-admin and regular user. Preserve the current storage keys and public context API, but make the transition logic clear stale `managedTenantId` and `managedTenantName` when switching from a super-admin session to a regular tenant, and avoid leaving old managed-tenant state hanging around when a new login payload does not provide it.
**Done when:**
- [ ] Hydration and `login()` share one normalization path for super-admin versus regular-user session state
- [ ] Logging in as a regular user clears any prior managed-tenant selection and name from in-memory state
- [ ] Super-admin hydration still restores a saved managed tenant only when both saved values are present
- [ ] All existing tests pass, new tests cover super-admin-to-regular-user and regular-user hydration cases
**Why it matters:** Session context sits under the whole dashboard, and stale managed-tenant state is the kind of subtle bug that can make the UI show the wrong business context without an obvious failure.
**Tradeoff:** This is mostly correctness and readability work, so the helper should stay small and avoid turning session state into a second auth layer.
**Size:** small (< 1hr)
**Impact:** high
**Effort vs Gain:** Under an hour of careful cleanup would remove a quiet but high-consequence state-leak risk from a central provider, a strong return.

### Task: Reset VocabularyProvider immediately on tenant changes and expose an explicit loading state
**Status:** proposed
**Files to change:** `dashboard/lib/VocabularyContext.tsx:L23-L79`, callers that need the new loading flag such as `dashboard/components/OutlookLayout.tsx` or other vocabulary-driven shells if applicable, new tests such as `dashboard/lib/VocabularyContext.test.tsx`
**What to do:** Extend the vocabulary context contract so it exposes `loading` alongside `vocab` and `refreshVocabulary`, then update the effect to reset to defaults and mark loading immediately whenever the effective tenant changes or a manual refresh starts. Reuse `useActiveTenantId()` instead of re-deriving tenant precedence locally. Keep the same fallback defaults, but stop leaving the previous tenant’s labels on screen while a new tenant vocabulary request is in flight.
**Done when:**
- [ ] Vocabulary context exposes a `loading` flag in addition to `vocab` and `refreshVocabulary`
- [ ] Tenant changes and manual refreshes immediately clear stale tenant-specific labels before the next fetch resolves
- [ ] `VocabularyProvider` uses `useActiveTenantId()` instead of duplicating managed-tenant precedence logic
- [ ] All existing tests pass, new tests cover tenant-switch loading and fetch-failure fallback behavior
**Why it matters:** Vocabulary is part of the product’s core wording, so briefly showing the wrong tenant’s labels during tenant switches is a trust issue even if the data eventually corrects itself.
**Tradeoff:** Adding a loading state nudges a few consumers to acknowledge the fetch lifecycle, so the rollout should stay focused on shell-level callers that actually need to react.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** A couple of focused hours would tighten one of the dashboard’s cross-tenant seams and remove a subtle source of misleading UI copy, a strong payoff.

### Task: Initialize ThemeProvider from storage synchronously and add provider-level hydration tests
**Status:** proposed
**Files to change:** `dashboard/lib/ThemeContext.tsx:L31-L76`, new tests such as `dashboard/lib/ThemeContext.test.tsx`
**What to do:** Replace the current `mounted` gate with a single initialization path that reads and validates the saved theme once, applies the chosen theme to `document.documentElement`, and keeps the dark class + `data-theme` attribute in sync without a default-theme first paint. Keep the public `useTheme()` contract and supported theme IDs unchanged. Add provider-level tests that cover saved-theme hydration, invalid saved-theme fallback, and DOM side effects for `data-theme` and `dark` class updates.
**Done when:**
- [ ] ThemeProvider no longer needs a separate `mounted` state just to avoid writing before hydration
- [ ] A saved valid theme is applied without first painting the default `navy` theme in the provider lifecycle
- [ ] Invalid saved values still fall back cleanly to `navy`
- [ ] All existing tests pass, new tests cover theme hydration and DOM attribute/class updates
**Why it matters:** Theme is global shell state, and first-paint drift plus missing provider tests make a high-visibility piece of infrastructure easier to regress than it should be.
**Tradeoff:** The implementation needs to stay SSR-safe and avoid over-engineering a tiny provider just to shave a small flicker.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** 1-2 hours of focused provider cleanup and tests would harden a global UI primitive and reduce theme flicker risk, a worthwhile return.

## Self-Review — 2026-05-05
**Cycles since last self-review:** 1
**What's working:** UX review is still correctly skipped now that the component pass is complete, and the freshest improvement output comes from small shared dashboard infrastructure slices where the tasks can stay concrete without falling back into repeated backend helper cleanup.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions already pushed this cycle toward a different, low-churn slice and still produced specific file-level tasks with clear stop conditions.
