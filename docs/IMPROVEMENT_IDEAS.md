# Improvement Ideas

## Ideas — 2026-04-10 (Developer Experience Reviewed)

### Task: Extract Super-Admin Tenant State Orchestration into a Dedicated Dashboard Hook
**Status:** proposed
**Files to change:** `dashboard/components/SuperAdminDashboard.tsx:L1-L359`, `dashboard/lib/SessionContext.tsx:L1-L240`, `dashboard/lib/hooks.ts:L1-L220` (or new `dashboard/lib/useSuperAdminTenants.ts`)
**What to do:** Move the tenant list loading, selected-tenant initialization, reorder state, delete modal state, create form state, and save flows out of `SuperAdminDashboard` into a dedicated hook or view-model module. Keep the component focused on rendering the sidebar, modals, and detail pane. Preserve the current `notifyTenantsChanged()` integration and keep create, update, delete, and reorder actions as explicit hook methods.
**Done when:**
- [ ] `SuperAdminDashboard` no longer owns raw fetch/save/delete/reorder implementations inline
- [ ] Selection, create, delete, and reorder state transitions are centralized in one hook or view-model
- [ ] Tenant change notifications still fire after create, delete, update, and reorder flows
- [ ] All existing tests pass, new tests cover the extracted state logic where practical
**Why it matters:** This screen is the control center for multi-tenant admin work, and pulling its orchestration into one place will make it easier to modify safely and reason about edge cases.
**Tradeoff:** Extracting a large stateful screen takes care to avoid regressions in selection and modal behavior.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Replace Ad Hoc Tenant Typing with a Shared Dashboard Tenant View Type
**Status:** proposed
**Files to change:** `dashboard/components/SuperAdminDashboard.tsx:L15-L36`, `dashboard/components/TenantCard.tsx:L5-L18`, `dashboard/components/TenantEditPanel.tsx:L28-L41`, `dashboard/lib/types.ts:L1-L260`
**What to do:** Define a shared tenant view type in `dashboard/lib/types.ts` for the fields these components actually use, then import it into `SuperAdminDashboard`, `TenantCard`, and `TenantEditPanel`. Remove the repeated local `type Tenant = ...` declarations and tighten any optional fields that are currently drifting between files.
**Done when:**
- [ ] All three tenant-management components import the same shared tenant type
- [ ] Local duplicate `Tenant` type declarations are removed from those files
- [ ] The shared type matches the data returned by tenant list/update APIs without `unknown` casts
- [ ] All existing tests pass, and TypeScript stays at zero errors
**Why it matters:** Reduces type drift across the admin surfaces and makes future tenant-field changes much safer and faster.
**Tradeoff:** Requires a quick pass through tenant API typings to make sure the shared shape is accurate.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Add Focused Tests for Super-Admin Destructive and Reorder Flows
**Status:** proposed
**Files to change:** `dashboard/components/SuperAdminDashboard.tsx:L108-L216`, `dashboard/components/SettingsView.test.tsx:L1-L240` (or new `dashboard/components/SuperAdminDashboard.test.tsx`)
**What to do:** Add component tests covering tenant reorder save/discard behavior, duplicate business-name rejection in the create flow, and the typed-name delete confirmation gate. Mock the relevant `Api.tenants.*` calls and assert that `notifyTenantsChanged()` and modal state transitions fire only when the action succeeds.
**Done when:**
- [ ] Reorder save and discard behavior are both covered by tests
- [ ] Duplicate tenant-name rejection is covered without calling the create API
- [ ] Delete confirmation requires an exact name match before enabling the destructive action
- [ ] All existing tests pass, new tests verify the critical admin paths
**Why it matters:** These are high-impact operator flows, and tighter coverage reduces the chance of regressions in the parts of the dashboard that can change or delete tenant data.
**Tradeoff:** Test setup will be a little heavier because this screen coordinates several API calls and modal states.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-10 (Architecture Reviewed)

### Task: Extract Appointment Persistence Flows into a Dedicated Appointments Controller Hook
**Status:** proposed
**Files to change:** `dashboard/components/AppointmentView.tsx:L62-L373`, `dashboard/lib/hooks.ts:L1-L260` (or new `dashboard/lib/useAppointmentController.ts`), `dashboard/lib/AppointmentDetailContext.tsx:L1-L240`
**What to do:** Move `fetchAppointments`, create, update, delete, cancel, and selection-reconciliation logic out of `AppointmentViewInner` into a dedicated controller hook that receives tenant/context dependencies and returns state plus actions. Keep the current `AppointmentDetailContext` for shared form state, but let the new hook own API calls, mock fallback behavior, and selected-appointment refresh after mutations.
**Done when:**
- [ ] `AppointmentViewInner` no longer defines inline create/update/delete/fetch flows
- [ ] Mock-data fallback and tenant edge cases are centralized in one appointments controller
- [ ] Appointment selection is rehydrated consistently after refreshes and mutations
- [ ] All existing tests pass, new tests cover controller success and fallback paths
**Why it matters:** The appointment screen currently mixes calendar rendering, mobile layout, form state wiring, and mutation logic in one file, which makes a critical workflow harder to evolve safely.
**Tradeoff:** Adds one more abstraction layer and needs careful migration to avoid breaking the existing detail context behavior.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Move Appointment Calendar Configuration and Event Mapping into Shared Helpers
**Status:** proposed
**Files to change:** `dashboard/components/AppointmentView.tsx:L25-L123`, `dashboard/lib/utils.ts:L1-L260` (or new `dashboard/lib/appointments/calendar.ts`), `dashboard/components/AppointmentView.test.tsx:L1-L220`
**What to do:** Pull the `react-big-calendar` localizer setup, event mapping, zoom constants, and calendar boundary values into shared helpers/constants near the appointments domain. Export a typed mapper from `Appointment` to calendar event shape and a config object for min/max/scroll/zoom settings. Leave `AppointmentView` responsible only for choosing the active values and passing them to the calendar.
**Done when:**
- [ ] `AppointmentView` no longer defines localizer, zoom constants, and event mapping inline
- [ ] Appointment-to-calendar mapping lives in a reusable typed helper
- [ ] Calendar config values are imported from one shared module
- [ ] All existing tests pass, new tests cover the event mapping helper
**Why it matters:** Reduces file weight in a large screen and makes calendar behavior easier to reuse or adjust without touching rendering logic.
**Tradeoff:** Slight indirection for developers reading the appointment screen for the first time.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Add Focused Tests for Appointment Mock-Mode and Super-Admin Tenant Routing Behavior
**Status:** proposed
**Files to change:** `dashboard/components/AppointmentView.tsx:L160-L294`, `dashboard/components/critical-fixes.test.tsx:L1-L260` (or new `dashboard/components/AppointmentView.test.tsx`)
**What to do:** Add component or controller-level tests that verify three high-risk paths: fallback to mock appointments when the API fails, create blocking when mock data is active, and `SUPER_ADMIN_TENANT_ID` create routing through the selected customer's tenant. Mock `Api.appointments.*` and static customer data so each path is deterministic.
**Done when:**
- [ ] API failure path shows mock appointments and marks mock mode in test coverage
- [ ] Create/update/delete guardrails in mock mode are covered by tests
- [ ] Super-admin create flow routes to the selected customer tenant instead of the super-admin tenant
- [ ] All existing tests pass, new tests lock the current edge-case behavior
**Why it matters:** These branches are easy to break quietly and have a big effect on whether booking changes hit the correct tenant or fail safely.
**Tradeoff:** Test setup will need heavier mocking around context and static data dependencies.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-10 (Ui/ux Patterns Reviewed)

### Task: Sync Knowledge Base Tab State and Document Search to the URL
**Status:** proposed
**Files to change:** `dashboard/components/KnowledgeBaseView.tsx:L155-L318`, `dashboard/components/OutlookLayout.tsx:L1-L220` (or the shared query-param tab utilities already used elsewhere), `dashboard/components/KnowledgeBaseView.test.tsx:L1-L220`
**What to do:** Replace the local-only `tab` and search initialization in `KnowledgeBaseView` with URL-backed query params so the selected sub-view and current document search survive refreshes and can be shared. Reuse the same tab-syncing pattern already established in other dashboard views, and keep invalid query values falling back to the questionnaire tab.
**Done when:**
- [ ] Reloading the page preserves the active knowledge tab
- [ ] The document search query is restored from the URL when present
- [ ] Invalid query values fall back safely to the questionnaire tab
- [ ] All existing tests pass, new tests cover query-param initialization
**Why it matters:** The knowledge workflow is multi-step and document-heavy, so preserving context reduces friction and aligns this screen with the rest of the dashboard shell.
**Tradeoff:** Adds routing plumbing to a screen that is currently simple local state.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Separate Voice Calls List Items into Reusable Row Components with Shared Status Styling
**Status:** proposed
**Files to change:** `dashboard/components/VoiceCallsView.tsx:L70-L320`, `dashboard/components/ui/Badge.tsx:L1-L200` (if the existing badge variants need extension), `dashboard/components/VoiceCallsView.test.tsx:L1-L240`
**What to do:** Extract the active-call row and history-call row into focused subcomponents that share one outcome/status presentation helper. Replace the current mix of raw `<button>`, `<select>`, and inline status pill classes with shared primitives where possible, and consolidate outcome badge color logic so the left panel reads as one coherent system.
**Done when:**
- [ ] Active call rows and history rows are rendered by dedicated subcomponents
- [ ] Outcome/status styling comes from one shared helper or primitive path
- [ ] Refresh, filter, and load-more controls use shared primitives where possible
- [ ] All existing tests pass, new tests cover row rendering for active and completed calls
**Why it matters:** This view presents dense operational data, and consistent row patterns will make scanning faster while also shrinking a large component.
**Tradeoff:** Requires some careful extraction so selected-row behavior and polling updates stay intact.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Replace Alert-Based Knowledge Base Deletion Feedback with Inline or Toast-Based Status
**Status:** proposed
**Files to change:** `dashboard/components/KnowledgeBaseView.tsx:L235-L261`, `dashboard/components/ui/Toast.tsx:L1-L220` (if needed), `dashboard/components/KnowledgeBaseView.test.tsx:L1-L220`
**What to do:** Remove the remaining `alert('Failed to delete')` path from `KnowledgeBaseView` and route delete success/failure feedback through the same inline banner or toast system already used for uploads and saves. Keep the existing confirm modal, but make post-confirm feedback consistent with the rest of the screen's messaging.
**Done when:**
- [ ] Knowledge entry deletion failures no longer use browser `alert()`
- [ ] Delete success/failure is surfaced through the existing message banner or toast system
- [ ] The confirm-delete flow still works without changing the deletion semantics
- [ ] All existing tests pass, new tests cover the error-feedback path
**Why it matters:** Browser alerts are jarring in an otherwise polished dashboard and break the product's interaction consistency right in a destructive workflow.
**Tradeoff:** Slightly more local state management for delete feedback.
**Size:** small (< 1hr)
**Impact:** medium

## Ideas — 2026-04-10 (Code Patterns Reviewed)

### Task: Extract Shared Tenant-Scoped Guard and Response Helpers from Route Modules
**Status:** proposed
**Files to change:** `src/routes/appointments.ts:L1-L320`, `src/routes/customers.ts:L1-L320`, `src/routes/tenants.ts:L1-L251`, `src/middleware.ts:L1-L260`
**What to do:** Pull repeated route concerns, such as auth checks, tenant-id extraction, validation-failure responses, and common `{ success: false, error, details }` branches, into shared helpers in `middleware.ts` or a focused route utility module. Keep each route file responsible for schema definitions and query logic, but stop repeating the same request/guard boilerplate in multiple handlers.
**Done when:**
- [ ] Appointments, customers, and tenants routes use shared helpers for common auth/validation/error patterns
- [ ] Validation failures are produced through one helper path with the same response shape everywhere
- [ ] Tenant extraction logic is not duplicated across those route modules
- [ ] All existing tests pass, new tests cover the shared helper behavior if needed
**Why it matters:** These route files are central to the app and already fairly large, so reducing repeated boilerplate makes them easier to scan and lowers the chance of subtle behavior drift between endpoints.
**Tradeoff:** Shared helpers can hide flow if they become too magical, so the abstraction needs to stay thin and explicit.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Batch Tenant Reorder Updates in One SQL Statement Instead of One Query Per Row
**Status:** proposed
**Files to change:** `src/routes/tenants.ts:L169-L190`, `src/routes/tenants.test.ts:L1-L220` (or the closest existing route test file)
**What to do:** Replace the current reorder loop that issues one `UPDATE tenants SET sort_order = ...` query per tenant with a single batched statement, such as an `UPDATE ... FROM (VALUES ...)` pattern inside the existing transaction. Keep the same request contract and logging behavior.
**Done when:**
- [ ] Tenant reorder no longer executes one update query per tenant id
- [ ] The reorder endpoint still preserves transaction semantics and logging
- [ ] Existing reorder behavior is covered by tests or updated assertions
- [ ] All existing tests pass, new tests verify the batched update path
**Why it matters:** This endpoint is a perfect candidate for a small efficiency win, and batching the write keeps the code cleaner while reducing database round-trips.
**Tradeoff:** The SQL gets a little more complex and needs clear comments to stay maintainable.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Centralize Duplicate-Name Conflict Handling for Create Flows
**Status:** proposed
**Files to change:** `src/routes/tenants.ts:L119-L167`, `src/routes/customers.ts:L1-L320`, `src/middleware.ts:L1-L260` (or a new shared route helper)
**What to do:** Identify create flows that manually pre-check for duplicates or convert database conflicts into bespoke 409 responses, then extract a shared conflict-handling pattern. Start with tenant creation and at least one other create flow if it has similar logic, using one helper to format conflict responses consistently.
**Done when:**
- [ ] Tenant creation conflict handling uses a shared helper or consistent pattern
- [ ] At least one additional create flow follows the same conflict-response structure
- [ ] 409 responses use a consistent payload shape and wording pattern
- [ ] All existing tests pass, new tests cover the shared conflict path where appropriate
**Why it matters:** Conflict handling is easy to let drift across endpoints, and standardizing it makes API behavior more predictable for the dashboard client.
**Tradeoff:** Requires a quick survey of existing create endpoints to avoid over-generalizing mismatched cases.
**Size:** medium (1-3hr)
**Impact:** medium

## Ideas — 2026-04-10 (Backend Consistency Reviewed)

### Task: Normalize Create/update/delete Route Structure across Services, Resources, and Skills
**Status:** proposed
**Files to change:** `src/routes/services.ts:L1-L320`, `src/routes/resources.ts:L1-L320`, `src/routes/skills.ts:L1-L61`, `src/middleware.ts:L1-L260`
**What to do:** Align these three tenant-management route modules on one consistent handler shape: shared schema parsing, tenant resolution, success payload naming, and not-found/error handling. Keep their domain-specific SQL, but remove avoidable differences in endpoint structure and response formatting so the dashboard can rely on a steadier contract.
**Done when:**
- [ ] Services, resources, and skills routes follow the same validation and error-response pattern
- [ ] Success payloads for create/update/delete operations use a predictable naming scheme
- [ ] Not-found branches are handled consistently across the three route modules
- [ ] All existing tests pass, new tests cover any normalized response behavior
**Why it matters:** These routes back closely related setup screens, so keeping them structurally aligned lowers frontend surprise and makes future maintenance faster.
**Tradeoff:** Some existing endpoint quirks may need to be preserved for compatibility, so the normalization should stay incremental.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Extract Shared Slug and Name-Normalization Utilities for Skill and Service Creation Flows
**Status:** proposed
**Files to change:** `src/routes/skills.ts:L27-L42`, `src/routes/services.ts:L1-L200`, `src/services/nameUtils.ts:L1-L220` (or a new shared utility file), `src/routes/services.test.ts:L1-L220`
**What to do:** Move ad hoc lowercasing, trimming, and slug-style normalization out of route handlers into a shared utility near `nameUtils.ts`. Use the same helper wherever service or skill names are normalized before insert/update so the rules live in one place and can be tested directly.
**Done when:**
- [ ] Skill creation no longer normalizes names inline inside the route handler
- [ ] At least one matching service normalization path uses the same shared helper
- [ ] The normalization helper has focused tests for spacing, casing, and special-character handling
- [ ] All existing tests pass, new tests cover the helper behavior
**Why it matters:** Name normalization rules are easy to let drift, and centralizing them reduces duplicate string-munging logic in route files.
**Tradeoff:** Requires checking that current stored-name expectations still match the extracted helper output.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Add Route Tests for Skill Deletion and Not-Found Handling Parity
**Status:** proposed
**Files to change:** `src/routes/skills.ts:L45-L60`, `src/routes/skills.test.ts:L1-L220` (new if needed), `src/routes/resources.test.ts:L1-L220` (for pattern reference)
**What to do:** Add focused tests for successful skill deletion, tenant-scoped not-found responses, and validation/auth guard behavior so the smallest of the three route modules is covered at the same quality bar as the others. Mirror the assertion style already used in the stronger route test suites.
**Done when:**
- [ ] Skill delete success path is covered by automated tests
- [ ] Skill delete returns the expected 404 payload when the record is missing or out of tenant scope
- [ ] Guard behavior for missing tenant/auth requirements is covered
- [ ] All existing tests pass, new tests verify route parity
**Why it matters:** The smallest route files are often the easiest to overlook, and this one has destructive behavior that deserves the same confidence as larger modules.
**Tradeoff:** Adds a bit of test scaffolding for a small module, though the behavior is important enough to justify it.
**Size:** small (< 1hr)
**Impact:** medium

## Ideas — 2026-04-10 (Route Ergonomics Reviewed)

### Task: Extract Shared UUID Param Validation for Mapping Assignment Endpoints
**Status:** proposed
**Files to change:** `src/routes/mappings.ts:L5-L105`, `src/middleware.ts:L1-L260` (or new route utility), `src/routes/mappings.test.ts:L1-L220` (new if needed)
**What to do:** Replace the repeated inline `UUID_RE.test(...)` checks across mapping assign/unassign handlers with a tiny shared helper that validates both ids and returns the same 400 payload shape. Keep the endpoint contract unchanged, but stop duplicating the same guard four times in one file.
**Done when:**
- [ ] Mapping assign/unassign handlers no longer inline duplicate UUID regex checks
- [ ] Invalid id responses are produced through one shared helper path
- [ ] The shared validation path is covered by focused tests
- [ ] All existing tests pass, new tests verify invalid-id behavior
**Why it matters:** This file is compact but repetitive, and removing boilerplate makes the assignment flows easier to scan and less error-prone to update.
**Tradeoff:** The helper must stay very small so it does not obscure otherwise straightforward handlers.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Align Employee and Shift Route Mutation Patterns on Shared Transactional Helpers
**Status:** proposed
**Files to change:** `src/routes/employees.ts:L1-L320`, `src/routes/shifts.ts:L1-L320`, `src/middleware.ts:L1-L260`
**What to do:** Identify the repeated transaction wrapper, tenant client flow, and mutation response handling in employees and shifts routes, then extract a shared helper pattern for "tenant-scoped mutation with logging". Leave SQL in place, but standardize how mutations acquire clients, return success payloads, and log changes.
**Done when:**
- [ ] Employees and shifts routes use one shared mutation helper pattern for common transactional structure
- [ ] Logging for successful mutations follows one consistent shape
- [ ] Success responses are formatted consistently across the extracted handlers
- [ ] All existing tests pass, new tests cover the shared mutation helper if added
**Why it matters:** Employees and shifts are tightly related operational domains, and consistent mutation structure makes backend maintenance less error-prone in scheduling-heavy code.
**Tradeoff:** Over-abstracting route logic would hurt readability, so the helper should cover only the shared scaffold, not the query details.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Add Mapping-Route Tests for Assign Idempotency and Tenant Scoping
**Status:** proposed
**Files to change:** `src/routes/mappings.ts:L12-L107`, `src/routes/mappings.test.ts:L1-L240` (new if needed)
**What to do:** Add route tests that verify repeated assign requests remain idempotent because of `ON CONFLICT DO NOTHING`, unassign requests succeed cleanly, and tenant-scoped reads only return rows for the active tenant. Use the current handler signatures and assert the exact success payloads.
**Done when:**
- [ ] Assign endpoints are tested for repeated calls without duplicate rows
- [ ] Unassign endpoints are tested for successful deletion behavior
- [ ] Mapping list endpoints are tested for tenant-scoped results
- [ ] All existing tests pass, new tests lock the current endpoint behavior
**Why it matters:** These routes are small but central to setup relationships, and their correctness depends on behavior that is easy to assume without explicitly testing.
**Tradeoff:** Adds a new test file for a compact module, though the coverage value is high because these endpoints wire core scheduling relationships.
**Size:** medium (1-3hr)
**Impact:** medium

## Ideas — 2026-04-10 (Backend Workflow Reviewed)

### Task: Centralize Shared Date-Range Query Parsing for Calendar and Coverage Endpoints
**Status:** proposed
**Files to change:** `src/routes/calendar.ts:L1-L320`, `src/routes/analytics.ts:L15-L44`, `src/middleware.ts:L1-L260` (or new query helper), `src/routes/calendar.test.ts:L1-L220`
**What to do:** Extract the repeated date and query-param parsing logic used by calendar-style endpoints into a shared helper that validates `YYYY-MM-DD` inputs, applies defaults, and returns one typed result. Use it in the calendar routes and the analytics coverage endpoint so date handling does not drift between screens.
**Done when:**
- [ ] Calendar and coverage endpoints no longer parse date-range params independently
- [ ] Invalid date input handling follows one shared code path
- [ ] Defaults for missing start/end dates are produced consistently
- [ ] All existing tests pass, new tests cover the shared date parsing behavior
**Why it matters:** Date-range bugs are easy to introduce and hard to spot, so one typed parser reduces duplication and keeps scheduling views aligned.
**Tradeoff:** The helper needs to stay focused on query parsing, not absorb unrelated route logic.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Split Knowledge Document Ingestion Helpers out of the Route Module
**Status:** proposed
**Files to change:** `src/routes/knowledge.ts:L1-L340`, `src/services/` (new `knowledgeIngestion.ts` or similar), `src/routes/knowledge.test.ts:L1-L240`
**What to do:** Move PDF/text extraction, normalization helpers, and document-ingestion preparation code out of `knowledge.ts` into a dedicated service module. Keep the route file responsible for request validation, tenant context, and HTTP responses while the new service owns content extraction and chunk preparation.
**Done when:**
- [ ] `knowledge.ts` no longer contains low-level document extraction/helper logic inline
- [ ] Document ingestion preparation lives in a dedicated service with focused inputs/outputs
- [ ] Route handlers call the service instead of manually coordinating each ingestion step
- [ ] All existing tests pass, new tests cover the extracted service behavior where practical
**Why it matters:** The knowledge route mixes HTTP concerns with document-processing work, and separating them will make both the upload flow and future debugging easier.
**Tradeoff:** Extraction touches a complex route, so the service boundary needs to be chosen carefully to avoid churn.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Add Explicit Tests for Analytics Feedback Access Rules and Call-Summary Validation
**Status:** proposed
**Files to change:** `src/routes/analytics.ts:L97-L175`, `src/routes/analytics.test.ts:L1-L260` (new if needed)
**What to do:** Add route tests covering missing `customer_id` on `/call-summaries`, tenant-scoped feedback reads, and super-admin feedback access to all tenants. Assert the exact 400 payload for invalid requests and the branching behavior between super-admin and normal tenant reads.
**Done when:**
- [ ] `/call-summaries` missing-parameter behavior is covered by tests
- [ ] Normal tenant feedback reads are tested as tenant-scoped
- [ ] Super-admin feedback reads are tested as cross-tenant
- [ ] All existing tests pass, new tests lock the current analytics route behavior
**Why it matters:** These routes power visible dashboard workflows, and their branching access logic is easy to regress without explicit tests.
**Tradeoff:** Requires fixture setup for both tenant and super-admin auth contexts.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-10 (Platform Routes Reviewed)

### Task: Standardize Success and Error Payload Shapes across Auth, Billing, and Provisioning Routes
**Status:** proposed
**Files to change:** `src/routes/auth.ts:L1-L220`, `src/routes/billing.ts:L1-L320`, `src/routes/provisioning.ts:L17-L244`, `src/middleware.ts:L1-L260`
**What to do:** Audit the response shapes in auth, billing, and provisioning endpoints, then introduce thin shared helpers so success payloads consistently include `success: true` where appropriate and error payloads consistently include `success: false` plus structured details. Preserve endpoint-specific fields, but remove the current mix of payload conventions.
**Done when:**
- [ ] Auth, billing, and provisioning endpoints use one consistent success/error envelope pattern
- [ ] Provisioning error branches no longer omit `success: false` while sibling branches include it
- [ ] Endpoint-specific metadata is preserved without changing the HTTP contract unnecessarily
- [ ] All existing tests pass, new tests cover the normalized payload shapes
**Why it matters:** These routes power critical account and monetization flows, and inconsistent envelopes create avoidable client-side branching and surprise.
**Tradeoff:** Requires care to avoid breaking any frontend code that implicitly depends on today's uneven response shapes.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Extract Provisioning Tenant-Status Transitions into a Dedicated Service Helper
**Status:** proposed (re-evaluate after migration to Telnyx; original wording assumed the deleted Vapi orchestration)
**Files to change:** `src/routes/provisioning.ts`, `src/services/telnyxNumbers.ts`, `src/services/` (new `provisioningService.ts` or similar), `src/provisioning.test.ts`
**What to do:** Move the tenant fetch, prerequisite checks, phone-status transitions, Telnyx number-order/assign/release orchestration, and rollback behavior out of the route file into a dedicated provisioning service. Keep the route responsible for request validation and HTTP responses while the service owns the activation/deactivation workflow and returns structured results.
**Done when:**
- [ ] `provisioning.ts` no longer contains the full activation/deactivation orchestration inline
- [ ] Phone status transitions and rollback behavior live in a dedicated service layer
- [ ] Route handlers map service results to HTTP responses without duplicating workflow logic
- [ ] All existing tests pass, new tests cover activation rollback and partial-cleanup warnings
**Why it matters:** Provisioning is one of the highest-risk operational workflows in the app, and isolating its state machine will make it easier to test and maintain safely.
**Tradeoff:** This is a meaningful extraction, so the service boundary needs to be chosen carefully to avoid making a simple route harder to follow.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Add Explicit Tests for Billing and Provisioning Unhappy Paths
**Status:** proposed
**Files to change:** `src/routes/billing.ts:L1-L320`, `src/routes/provisioning.ts:L17-L244`, `src/routes/billing.test.ts:L1-L260` (new if needed), `src/routes/provisioning.test.ts:L1-L260` (new if needed)
**What to do:** Add focused route tests for missing Stripe / Telnyx / SIP-connection configuration, invalid activate/deactivate payloads, provisioning conflict states (`active` and `provisioning`), and billing access failures. Assert both status codes and response-body structure so critical operational failures are locked down.
**Done when:**
- [ ] Billing routes are tested for missing Stripe configuration and guarded access behavior
- [ ] Provisioning routes are tested for invalid payloads and conflicting tenant phone states
- [ ] At least one partial-cleanup warning path in deactivation is covered
- [ ] All existing tests pass, new tests verify the unhappy-path contracts
**Why it matters:** These are business-critical flows, and explicit sad-path coverage gives much better confidence than relying on manual checks for payment and phone setup failures.
**Tradeoff:** Test setup will be heavier because Stripe and the Telnyx Numbers API need to be stubbed carefully.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-10 (Integration Routes Reviewed)

### Task: Unify CRM Integration Route Scaffolding across Jobber, HubSpot, and Square
**Status:** proposed
**Files to change:** `src/routes/jobber.ts:L1-L320`, `src/routes/hubspot.ts:L1-L320`, `src/routes/square.ts:L1-L176`, `src/services/oauthCallbackFactory.ts:L1-L220` (if needed), `src/middleware.ts:L1-L260`
**What to do:** Extract the repeated route scaffold used by these integrations, auth start, settings fetch, disconnect, sync trigger, and sync-status endpoints, into a shared helper pattern. Keep provider-specific clients and sync implementations intact, but stop re-implementing the same endpoint structure three times.
**Done when:**
- [ ] Jobber, HubSpot, and Square routes share one consistent pattern for auth/settings/disconnect/sync handlers
- [ ] Provider-specific behavior remains isolated to client/sync modules and config objects
- [ ] Repeated settings and sync-status query structure is reduced substantially
- [ ] All existing tests pass, new tests cover any shared helper behavior if added
**Why it matters:** These integrations are parallel products, and keeping their route scaffolding aligned will make future provider additions and fixes much faster and safer.
**Tradeoff:** Needs careful extraction so provider-specific quirks do not get flattened into an awkward generic abstraction.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Standardize OAuth Initiation Responses across CRM Providers
**Status:** proposed
**Files to change:** `src/routes/jobber.ts:L12-L40`, `src/routes/hubspot.ts:L12-L40`, `src/routes/square.ts:L12-L31`, `src/routes/servicetitan.ts:L1-L220` (if it follows the same pattern)
**What to do:** Align the auth-init endpoints so they all return the same response envelope, success flag behavior, and error wording pattern when provider config is missing or auth URL generation fails. Preserve provider-specific config text, but make the client-facing shape predictable.
**Done when:**
- [ ] CRM auth-init endpoints return the same envelope structure on success and failure
- [ ] Missing-provider-config responses follow one wording and payload pattern
- [ ] Auth URL generation failures are handled consistently across providers
- [ ] All existing tests pass, new tests cover the normalized auth-init contract
**Why it matters:** The dashboard integration cards should not need provider-specific branching for what is fundamentally the same user action.
**Tradeoff:** Some endpoint responses may currently be consumed loosely, so normalization should be checked against the dashboard client before merging.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Add Route Tests for CRM Disconnect and Sync-Status Parity
**Status:** proposed
**Files to change:** `src/routes/jobber.ts:L55-L160`, `src/routes/hubspot.ts:L55-L170`, `src/routes/square.ts:L55-L176`, `src/routes/jobber.test.ts:L1-L260` (new if needed), `src/routes/hubspot.test.ts:L1-L260` (new if needed), `src/routes/square.test.ts:L1-L260` (new if needed)
**What to do:** Add focused tests that verify each provider's disconnect flow clears integration settings plus sync maps, and that sync-status endpoints return the expected aggregate counts and `last_sync_at` fields. Use a common assertion shape so parity differences show up immediately.
**Done when:**
- [ ] Disconnect behavior is covered for Jobber, HubSpot, and Square
- [ ] Sync-status aggregate counts are tested for all three providers
- [ ] The response shapes are asserted consistently across providers
- [ ] All existing tests pass, new tests lock parity across the CRM integrations
**Why it matters:** These are repetitive operational routes, which makes them especially prone to subtle parity drift unless tests pin them down.
**Tradeoff:** Adds several similar tests, so the shared test helpers should be factored enough to avoid copy-paste bloat.
**Size:** medium (1-3hr)
**Impact:** medium

## Ideas — 2026-04-10 (Channel Routes Reviewed)

### Task: Extract Shared Webhook Acknowledgment and Logging Patterns from Voice and Communications Routes
**Status:** proposed
**Files to change:** `src/routes/voice.ts:L1-L260`, `src/routes/communications.ts:L1-L260`, `src/middleware.ts:L1-L260`
**What to do:** Pull the repeated "accept request, log event, return immediate success envelope, then continue processing" structure into a thin helper for webhook-style endpoints. Use it where voice and communications routes share fast-ack patterns, while keeping provider-specific parsing and downstream work inside the route body.
**Done when:**
- [ ] Voice and communications webhook-like handlers no longer duplicate the same ack/log scaffolding
- [ ] Immediate success responses use one consistent helper path
- [ ] Provider-specific parsing stays inside route-level callbacks
- [ ] All existing tests pass, new tests cover the shared helper behavior if needed
**Why it matters:** Webhook handlers are easy to make inconsistent under pressure, and consolidating the scaffold lowers the chance of subtle response-time or logging drift.
**Tradeoff:** The helper must remain thin enough that the route flow still reads clearly during incident debugging.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Normalize ServiceTitan Route Envelopes to Match the Other CRM Integrations
**Status:** proposed
**Files to change:** `src/routes/servicetitan.ts:L1-L173`, `src/routes/jobber.ts:L1-L320`, `src/routes/hubspot.ts:L1-L320`, `src/routes/square.ts:L1-L176`
**What to do:** Update ServiceTitan auth-init, settings, disconnect, sync trigger, and sync-status endpoints so their success envelopes and error shapes line up with the same conventions recommended for the other CRM integrations. Keep ServiceTitan's provider-specific webhook secret handling intact.
**Done when:**
- [ ] ServiceTitan auth and sync endpoints use the same envelope conventions as the other CRM routes
- [ ] Error responses include the same `success: false` and `error` structure where applicable
- [ ] Sync trigger and settings responses match the cross-provider client expectations
- [ ] All existing tests pass, new tests cover the normalized response shapes if needed
**Why it matters:** ServiceTitan is functionally another CRM integration, and leaving it on a different response dialect adds unnecessary client complexity.
**Tradeoff:** Must be checked carefully against any current dashboard assumptions before changing visible payloads.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Add Tests for ServiceTitan Webhook Authentication and Async Processing Guards
**Status:** proposed
**Files to change:** `src/routes/servicetitan.ts:L68-L136`, `src/routes/servicetitan.test.ts:L1-L260` (new if needed)
**What to do:** Add route tests for missing or invalid webhook secrets, successful early acknowledgment, and guard behavior when incoming events lack `eventType`, `data`, or a resolvable tenant mapping. Assert that unauthorized requests fail fast and valid requests still return the immediate 200 response.
**Done when:**
- [ ] ServiceTitan webhook rejects bad secrets with the expected 401 payload
- [ ] Valid webhook requests are acknowledged immediately with success
- [ ] Missing event data and unmapped tenants are covered without throwing
- [ ] All existing tests pass, new tests verify webhook guard behavior
**Why it matters:** Webhook paths are hard to verify manually and easy to break silently, so explicit coverage here materially improves integration confidence.
**Tradeoff:** Async follow-up work may need to be stubbed carefully so tests stay deterministic.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-10 (Messaging Surfaces Reviewed)

### Task: Align Vocabulary, Voice, and Communications Routes on a Common Response-Envelope Policy
**Status:** proposed
**Files to change:** `src/routes/vocabulary.ts:L10-L34`, `src/routes/voice.ts:L1-L260`, `src/routes/communications.ts:L1-L260`, `src/middleware.ts:L1-L260`
**What to do:** Standardize whether these routes return raw payloads versus `{ success: true, ... }` envelopes, and extract a light helper policy so similar "dashboard data" endpoints behave consistently. Keep simple payloads where they materially help the client, but document and encode the rule so it is intentional instead of route-by-route drift.
**Done when:**
- [ ] Vocabulary, voice, and communications routes follow one explicit response-envelope convention
- [ ] Any exceptions to the convention are deliberate and documented in code comments or helpers
- [ ] Client-facing success/error payload shapes are predictable across these endpoints
- [ ] All existing tests pass, new tests cover normalized response behavior where needed
**Why it matters:** These routes feed user-facing dashboard surfaces, and inconsistent envelopes create small but persistent frontend complexity.
**Tradeoff:** Some current consumers may rely on today's raw vocabulary payload, so changes should preserve compatibility or be phased carefully.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Extract Shared Tenant + Contact Lookup Helpers from Voice and Communications Routes
**Status:** proposed
**Files to change:** `src/routes/voice.ts:L1-L260`, `src/routes/communications.ts:L1-L260`, `src/services/` (new helper such as `contactLookup.ts`), `src/routes/voice.test.ts:L1-L260` (new if needed)
**What to do:** Move repeated customer/tenant lookup and normalization logic out of the two route modules into a small shared helper service. Keep route handlers responsible for request parsing and response shaping, but centralize the data-fetching and normalization steps used to resolve customer context before sending or rendering communication data.
**Done when:**
- [ ] Voice and communications routes no longer duplicate the same tenant/customer lookup logic
- [ ] Shared lookup behavior lives in a focused helper/service with typed inputs and outputs
- [ ] Route handlers call the helper instead of reimplementing the same query/normalization steps
- [ ] All existing tests pass, new tests cover the helper or its route integration points
**Why it matters:** These routes are closely related and user-facing, so centralizing lookup logic reduces drift and makes customer-context bugs easier to fix once.
**Tradeoff:** The helper should stay narrowly scoped so it does not become a vague "misc route utils" bucket.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Add Tests for Vocabulary Fallback and Communications Preview Guards
**Status:** proposed
**Files to change:** `src/routes/vocabulary.ts:L10-L34`, `src/routes/communications.ts:L1-L260`, `src/routes/vocabulary.test.ts:L1-L220` (new if needed), `src/routes/communications.test.ts:L1-L260` (new if needed)
**What to do:** Add tests that verify vocabulary fallback behavior across tenant, business template, and hardcoded defaults, plus communications guard behavior for missing recipients or invalid preview/send inputs. Assert both the final returned labels and the exact 400/404 payload shapes.
**Done when:**
- [ ] Vocabulary route is tested for tenant override, template fallback, and hardcoded default behavior
- [ ] Communications routes are tested for invalid recipient/preview inputs and guarded failures
- [ ] Response payload shapes are asserted explicitly for both success and error paths
- [ ] All existing tests pass, new tests lock the route contracts
**Why it matters:** These endpoints influence visible copy and outbound communication behavior, so quiet regressions here are high-friction even when the code looks simple.
**Tradeoff:** Test setup will need a few representative tenant/template fixtures to cover the fallback chain clearly.
**Size:** medium (1-3hr)
**Impact:** medium

## Ideas — 2026-04-10 (Setup Data Flows Reviewed)

### Task: Extract Shared Setup Fallback Resolution between Tenants, Vocabulary, and Knowledge Ingestion
**Status:** proposed
**Files to change:** `src/routes/tenants.ts:L1-L251`, `src/routes/vocabulary.ts:L10-L34`, `src/routes/knowledge.ts:L1-L220`, `src/services/` (new helper such as `setupContext.ts`)
**What to do:** Pull the repeated setup-context lookups, such as tenant, business-type/template, and onboarding copy dependencies, into a focused helper layer used by setup-adjacent routes. Keep each route responsible for its own HTTP contract, but centralize the shared logic that resolves "what tenant/template context should this setup flow use?"
**Done when:**
- [ ] Setup-related routes no longer duplicate tenant/template context resolution logic
- [ ] Shared setup context lives in a focused helper with typed outputs
- [ ] Routes call the helper instead of manually rebuilding the same context lookup chain
- [ ] All existing tests pass, new tests cover the helper behavior where practical
**Why it matters:** Setup flows span multiple routes, and centralizing the context resolution makes onboarding bugs easier to diagnose and fix consistently.
**Tradeoff:** The helper boundary needs to stay clear so unrelated tenant logic does not get lumped into a vague setup service.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Add Explicit Tests for Knowledge Ingestion File-Type and Chunk-Limit Guards
**Status:** proposed
**Files to change:** `src/routes/knowledge.ts:L35-L92`, `src/routes/knowledge.test.ts:L1-L260` (new if needed)
**What to do:** Add tests covering unsupported file extensions, missing `tenant_id`, unreadable/too-short content, and oversized uploads that exceed the chunk cap. Assert the exact 400 payloads so these user-facing upload failures remain stable.
**Done when:**
- [ ] Unsupported file extension handling is covered by tests
- [ ] Missing tenant id and unreadable text paths are covered
- [ ] Chunk-limit guard is tested with a deterministic oversized input
- [ ] All existing tests pass, new tests lock the upload guard contracts
**Why it matters:** File ingestion failures are common in real onboarding, and explicit coverage here prevents regressions in the most frustrating part of knowledge setup.
**Tradeoff:** Multipart upload test setup is a little heavier than normal JSON route tests.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Standardize Tenant Setup Mutation Responses across Add, Update, and Ingest Flows
**Status:** proposed
**Files to change:** `src/routes/tenants.ts:L1-L251`, `src/routes/knowledge.ts:L93-L173`, `src/routes/vocabulary.ts:L10-L34`
**What to do:** Review the setup-adjacent mutation routes and align them on a consistent response pattern for success ids, `success: true`, and validation failures. Preserve route-specific payloads, but make sure the dashboard setup wizard can depend on one predictable mutation contract style.
**Done when:**
- [ ] Tenant setup-adjacent mutation routes use a consistent success envelope pattern
- [ ] Validation failures across these routes return a consistent structure
- [ ] Any route-specific return fields remain intact but no longer feel ad hoc
- [ ] All existing tests pass, new tests cover the normalized setup mutation shapes where needed
**Why it matters:** The setup wizard spans multiple API surfaces, and inconsistent mutation shapes create unnecessary UI branching in the most guided part of the product.
**Tradeoff:** Must avoid breaking any existing frontend assumptions while normalizing the contracts.
**Size:** medium (1-3hr)
**Impact:** medium

## Ideas — 2026-04-11 (Scheduler Route Consistency Reviewed)

### Task: Extract Shared Create-Update-Delete Route Helpers across Services, Resources, and Shifts
**Status:** proposed
**Files to change:** `src/routes/services.ts:L1-L320`, `src/routes/resources.ts:L1-L320`, `src/routes/shifts.ts:L1-L263`, `src/middleware.ts:L1-L260`
**What to do:** Introduce thin helper patterns for the repeated safe-parse, 400 validation response, 404 not-found response, and success-envelope flows used by these three route modules. Keep domain SQL inline, but stop re-implementing the same request skeleton for each create/update/delete endpoint family.
**Done when:**
- [ ] Services, resources, and shifts create/update/delete handlers use shared validation and response helpers
- [ ] 400 validation responses and 404 not-found responses are produced through consistent helper paths
- [ ] Success envelopes remain domain-specific but follow one predictable route pattern
- [ ] All existing tests pass, new tests cover helper behavior where needed
**Why it matters:** These routes back tightly related setup screens, and consolidating the repeated handler skeleton reduces maintenance cost and makes parity drift easier to spot.
**Tradeoff:** The helpers must stay thin so route readability does not get worse.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Batch Shift Week-Copy Inserts Instead of Looping Row-By-Row Queries
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L215-L262`, `src/routes/shifts.test.ts:L1-L260` (new if needed)
**What to do:** Replace the per-row `INSERT ... ON CONFLICT` loop inside `/shifts/copy-week` with a single batched insert/update statement built from the effective-shifts result set. Keep the current behavior and logging, but reduce repeated database round-trips for larger copied weeks.
**Done when:**
- [ ] `/shifts/copy-week` no longer issues one insert query per copied row
- [ ] Conflict-update behavior remains identical for copied overrides
- [ ] Log output and returned `copied` count remain unchanged
- [ ] All existing tests pass, new tests verify the batched copy path
**Why it matters:** Week-copy is exactly the kind of workflow that grows with real scheduler usage, and batching it will improve performance while simplifying the mutation block.
**Tradeoff:** The SQL becomes more complex and needs clear comments plus solid test coverage.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Add Route Tests for Shift Override RPC Branching and Fallback Behavior
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L127-L178`, `src/routes/shifts.test.ts:L1-L260` (new if needed)
**What to do:** Add tests covering the three `/shifts/overrides` branches: single-employee effective shifts, bulk effective shifts, and raw override listing. Assert that the correct query path is chosen based on query params and that missing/partial query combinations fall back to the raw override list.
**Done when:**
- [ ] Single-employee effective-shift branch is covered by tests
- [ ] Bulk effective-shift branch is covered by tests
- [ ] Raw override fallback branch is covered for partial or missing query params
- [ ] All existing tests pass, new tests lock the branching behavior
**Why it matters:** This endpoint has subtle branching that directly affects scheduler correctness, and explicit tests reduce the risk of a future regression sending the wrong data shape to the dashboard.
**Tradeoff:** Requires query-level test stubbing for several similar cases, though the coverage payoff is high.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-11 (Employee Setup Route Review)

### Task: Normalize Soft-Delete and Success Payload Behavior across Employees, Resources, and Services
**Status:** proposed
**Files to change:** `src/routes/employees.ts:L39-L87`, `src/routes/resources.ts:L1-L320`, `src/routes/services.ts:L1-L320`
**What to do:** Compare the delete/update success payloads and soft-delete semantics across these three setup routes, then align them on one predictable convention for `success`, returned entity payloads, and not-found handling. Keep domain-specific fields, but stop making the dashboard guess which entity routes return what after mutation.
**Done when:**
- [ ] Employee, resource, and service delete/update endpoints follow one consistent success-envelope pattern
- [ ] Not-found responses use the same structure and wording style
- [ ] Soft-delete behavior is documented or aligned where the routes currently differ
- [ ] All existing tests pass, new tests cover the normalized mutation contracts
**Why it matters:** These are sibling setup surfaces, and predictable mutation responses make the frontend simpler and less fragile.
**Tradeoff:** Must avoid changing any route contract the dashboard already depends on without updating tests and consumers together.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Extract Shared Name-Building Logic for Employee and Service/resource Display Fields
**Status:** proposed
**Files to change:** `src/routes/employees.ts:L24-L33`, `src/routes/services.ts:L1-L200`, `src/routes/resources.ts:L1-L200`, `src/services/nameUtils.ts:L1-L220`
**What to do:** Move employee display-name composition and any similar service/resource label normalization into a shared helper in `nameUtils.ts` or a nearby utility. Use one tested helper for concatenating first/last names, trimming blanks, and falling back cleanly when only partial inputs exist.
**Done when:**
- [ ] Employee route no longer builds display names inline
- [ ] At least one comparable service or resource naming path uses the same helper
- [ ] The helper is tested for blank, partial, and fully populated inputs
- [ ] All existing tests pass, new tests cover the shared naming behavior
**Why it matters:** Name composition bugs are small but visible, and centralizing them reduces duplicated string handling in the setup routes.
**Tradeoff:** The helper should stay tightly scoped to avoid becoming a catch-all formatting file.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Add Route Tests for Employee Union-List Behavior and Inactive Updates
**Status:** proposed
**Files to change:** `src/routes/employees.ts:L21-L36`, `src/routes/employees.ts:L88-L126`, `src/routes/employees.test.ts:L1-L260` (new if needed)
**What to do:** Add tests for the `/employees` union query returning both employee and user rows in sorted order, plus update tests for toggling `is_active`, partial first/last-name updates, and not-found behavior on delete. Assert the returned `type` values and success envelopes explicitly.
**Done when:**
- [ ] `/employees` list route is tested for combined employee + user rows and sort order
- [ ] Employee update route is tested for `is_active` changes and partial name updates
- [ ] Employee delete not-found behavior is covered by tests
- [ ] All existing tests pass, new tests lock the employee route contract
**Why it matters:** This route has a more complex data shape than it first appears, and explicit tests will keep its dashboard contract stable as the team surface evolves.
**Tradeoff:** Requires a bit more fixture setup because the list route spans two underlying tables.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-11 (CRM Parity Reviewed)

### Task: Normalize Settings and Sync-Status Response Envelopes across HubSpot, Jobber, and ServiceTitan
**Status:** proposed
**Files to change:** `src/routes/hubspot.ts:L40-L170`, `src/routes/jobber.ts:L40-L160`, `src/routes/servicetitan.ts:L39-L173`
**What to do:** Align the settings-fetch and sync-status endpoints for these CRM providers so they return the same top-level envelope shape, null-handling behavior, and aggregate field names. Preserve provider-specific data where needed, but make the client contract predictable across the provider set.
**Done when:**
- [ ] HubSpot, Jobber, and ServiceTitan settings endpoints use one consistent null/success response style
- [ ] Sync-status endpoints expose matching aggregate field names and envelope structure
- [ ] Provider-specific extras remain additive instead of changing the base shape
- [ ] All existing tests pass, new tests cover the normalized parity contract
**Why it matters:** These integrations back near-identical dashboard cards, and response drift forces unnecessary provider-specific client logic.
**Tradeoff:** Needs careful verification against current dashboard assumptions before changing any visible field names or wrappers.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Extract Shared Integration Webhook Auth Guard Utilities for ServiceTitan and Future Providers
**Status:** proposed
**Files to change:** `src/routes/servicetitan.ts:L68-L93`, `src/middleware.ts:L1-L260`, `src/routes/voice.ts:L1-L260` (if a shared webhook helper ends up relevant)
**What to do:** Move the "read expected secret, compare header/bearer input, emit 401 plus structured logging" logic into a tiny shared helper so current and future provider webhooks do not reimplement auth guards inconsistently. Start with ServiceTitan and keep the helper provider-agnostic.
**Done when:**
- [ ] ServiceTitan webhook auth no longer performs inline secret comparison logic
- [ ] Shared webhook auth helper supports header value normalization and structured failure logging
- [ ] Unauthorized responses stay consistent across any routes using the helper
- [ ] All existing tests pass, new tests cover the shared auth helper behavior
**Why it matters:** Webhook auth is small but security-critical, and a shared guard reduces the chance of subtle inconsistencies when more webhook routes appear.
**Tradeoff:** The helper must stay very small and auditable so security-sensitive code remains easy to inspect.
**Size:** small (< 1hr)
**Impact:** high

### Task: Add Parity Tests for CRM Auth-Init and Settings Null-State Behavior
**Status:** proposed
**Files to change:** `src/routes/hubspot.ts:L12-L54`, `src/routes/jobber.ts:L12-L54`, `src/routes/servicetitan.ts:L12-L64`, route test files for each provider (new if needed)
**What to do:** Add focused tests that verify auth-init failure behavior when provider config is missing and settings endpoints return the expected null/empty state when no integration exists. Use one shared assertion shape so parity drift becomes obvious in test output.
**Done when:**
- [ ] Auth-init missing-config behavior is covered for HubSpot, Jobber, and ServiceTitan
- [ ] Settings endpoints are tested for the no-integration/null-state case across the same providers
- [ ] Response payload structures are asserted consistently across providers
- [ ] All existing tests pass, new tests lock the parity contract
**Why it matters:** These are the first integration states users hit, and parity mistakes here create confusing UX long before sync logic runs.
**Tradeoff:** Adds several similar tests, so shared test helpers should be used to keep the suite readable.
**Size:** medium (1-3hr)
**Impact:** medium

## Ideas — 2026-04-11 (Channel Route Consistency Reviewed)

### Task: Extract Shared Tenant Identifier Normalization across Communications Endpoints
**Status:** proposed
**Files to change:** `src/routes/communications.ts:L1-L251`, `src/middleware.ts:L1-L260`, `src/services/consentService.ts:L1-L260`
**What to do:** Replace the repeated `parseInt(tenantId, 10) || 0` conversions in the communications routes with one shared tenant-id normalization helper that validates the expected identifier shape before passing it into consent and config services. Keep the current endpoint contracts, but stop letting invalid tenant ids silently degrade to `0` in consent, opt-out, and list flows.
**Done when:**
- [ ] Communications routes no longer inline `parseInt(tenantId, 10) || 0` conversions
- [ ] Invalid tenant identifiers fail through one explicit helper path instead of defaulting to `0`
- [ ] Consent and opt-out service calls receive a consistently normalized tenant identifier
- [ ] All existing tests pass, new tests cover the invalid-tenant normalization path
**Why it matters:** Silent fallback to tenant `0` is the kind of backend inconsistency that is easy to miss and hard to debug when communication records disappear or land in the wrong scope.
**Tradeoff:** Requires a careful pass over how tenant ids are typed across these services so the helper fixes the inconsistency without widening the route surface.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Add a Shared Query Builder Helper for Voice History Filters and Pagination
**Status:** proposed
**Files to change:** `src/routes/voice.ts:L157-L251`, `src/middleware.ts:L1-L260` (or new `src/routes/utils.ts`), `src/routes/voice.test.ts:L1-L260` (new if needed)
**What to do:** Pull the voice history route's dynamic `whereClause`, parameter indexing, and pagination parsing into a tiny helper that returns the SQL fragment plus bound params for `customer_id`, `status`, `limit`, and `offset`. Keep the exact endpoint behavior, but remove the inline mutable query construction from the route handler.
**Done when:**
- [ ] `/voice/history` no longer builds its SQL filter string inline inside the route handler
- [ ] Customer/status filtering and pagination params are produced by one shared helper
- [ ] The helper preserves the existing query behavior and response shape
- [ ] All existing tests pass, new tests cover filtered and unfiltered history queries
**Why it matters:** This route is already doing customer joins, count queries, and pagination, so extracting the query assembly makes it easier to maintain without changing the data contract.
**Tradeoff:** The helper must stay thin and SQL-focused so it does not hide the route behavior behind too much abstraction.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Add Route Tests for Voice and Communications Invalid-Input Guard Parity
**Status:** proposed
**Files to change:** `src/routes/voice.ts:L16-L371`, `src/routes/communications.ts:L17-L251`, `src/routes/voice.test.ts:L1-L260` (new if needed), `src/routes/communications.test.ts:L1-L260` (new if needed)
**What to do:** Add focused tests that verify both route modules return the expected 400 payload structure for schema failures, tenant guard failures, and invalid pagination/query inputs. Cover at least one send endpoint, one consent endpoint, and the voice history/session start flows so the two user-facing communication surfaces stay aligned on unhappy-path behavior.
**Done when:**
- [ ] Voice session start and history endpoints are tested for validation failures and tenant guard behavior
- [ ] Communications send and consent endpoints are tested for schema failure responses
- [ ] Error payload shapes are asserted consistently across both route modules
- [ ] All existing tests pass, new tests lock the unhappy-path parity contract
**Why it matters:** These routes back visible operator workflows, and parity in their guard behavior reduces dashboard-side branching and makes failures easier to reason about.
**Tradeoff:** Adds several similar test cases, so the suite should use shared helpers to avoid repetitive setup noise.
**Size:** medium (1-3hr)
**Impact:** medium

## Ideas — 2026-04-11 (Platform Contract Review)

### Task: Normalize Success Envelopes across Billing and Provisioning Status Endpoints
**Status:** proposed
**Files to change:** `src/routes/billing.ts:L150-L172`, `src/routes/provisioning.ts:L189-L213`, `dashboard/lib/api.ts:L1-L260` (if client typing needs alignment)
**What to do:** Update `/billing/status` and `/provisioning/status` so they return the same top-level success envelope pattern already used by sibling mutation routes, while preserving their existing domain fields. Then align any dashboard API typings that currently assume raw row payloads so account-status and phone-status screens read from one predictable contract shape.
**Done when:**
- [ ] Billing and provisioning status endpoints return a consistent `{ success: true, ... }` envelope
- [ ] Tenant-not-found and validation branches remain explicit and unchanged in meaning
- [ ] Dashboard API typings match the normalized response structure without `any` fallbacks
- [ ] All existing tests pass, new tests cover the normalized status endpoint contracts
**Why it matters:** These endpoints power critical account-state UI, and inconsistent raw-versus-enveloped responses create unnecessary client branching in exactly the flows that should feel most predictable.
**Tradeoff:** Requires checking current dashboard callers so the contract cleanup does not silently break existing status views.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Extract Shared Tenant Lookup and Not-Found Response Flow for Billing Checkout and Provisioning Activation
**Status:** proposed
**Files to change:** `src/routes/billing.ts:L22-L67`, `src/routes/provisioning.ts:L24-L70`, `src/middleware.ts:L1-L260`
**What to do:** Introduce a focused helper that loads a tenant by id and returns the standardized 404 response shape plus the small set of fields each route needs. Use it in billing checkout and provisioning activation so both routes stop hand-rolling tenant fetch, not-found handling, and partial metadata assembly.
**Done when:**
- [ ] Billing checkout and provisioning activation no longer perform inline tenant fetch + not-found response logic independently
- [ ] The shared helper returns only the required tenant fields for each route
- [ ] Not-found payloads follow one consistent structure across both routes
- [ ] All existing tests pass, new tests cover the shared tenant lookup helper behavior
**Why it matters:** These two routes are high-value account workflows with overlapping scaffolding, and centralizing the tenant lookup path reduces repeated logic in code that is expensive to get wrong.
**Tradeoff:** The helper must stay narrow so it supports the shared lookup concern without hiding route-specific business rules.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Add Route Tests for Auth, Billing, and Provisioning Response-Shape Parity
**Status:** proposed
**Files to change:** `src/routes/auth.ts:L1-L112`, `src/routes/billing.ts:L1-L172`, `src/routes/provisioning.ts:L1-L213`, route test files for each module (new if needed)
**What to do:** Add focused tests that assert the exact response payload shapes for login, register, checkout configuration failures, provisioning prerequisite failures, and status/not-found branches. Cover both success and sad paths so platform-critical account routes stop drifting on whether they include `success`, metadata fields, and structured details.
**Done when:**
- [ ] Auth login/register success and failure payloads are asserted explicitly in tests
- [ ] Billing checkout and status error payloads are covered for missing config and missing tenant cases
- [ ] Provisioning activation/status unhappy paths are covered for validation, missing tenant, and prerequisite failures
- [ ] All existing tests pass, new tests lock the response-shape parity contract
**Why it matters:** These routes sit at the platform boundary, and explicit contract tests are the fastest way to catch inconsistent payload drift before it reaches dashboard account flows.
**Tradeoff:** The test suite gets a bit broader, though the added coverage is concentrated in high-impact endpoints where contract stability matters.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-11 (Tenant-Scoped Route Review)

### Task: Extract Shared Tenant-Scoped List Query Helpers for Appointments and Customers
**Status:** proposed
**Files to change:** `src/routes/appointments.ts:L59-L123`, `src/routes/customers.ts:L39-L57`, `src/middleware.ts:L1-L260` (or new `src/routes/queryHelpers.ts`)
**What to do:** Pull the repeated limit/offset parsing, super-admin branching, and tenant-filtered list-query scaffolding out of the appointments and customers list handlers into a small shared helper layer. Keep each route's SELECT body intact, but centralize the request parsing and tenant-scope branching so both list endpoints follow one predictable pattern.
**Done when:**
- [ ] Appointments and customers list routes no longer parse pagination and super-admin branching independently
- [ ] Shared helper logic covers tenant-scoped and super-admin list execution paths without changing returned row data
- [ ] Route-specific SELECT statements remain local to each module
- [ ] All existing tests pass, new tests cover the shared list-query helper behavior
**Why it matters:** These list endpoints are foundational dashboard reads, and consolidating their common scaffolding reduces repeated logic in code paths that are touched constantly.
**Tradeoff:** The helper needs to stay small and explicit so route readability does not get buried under generic abstractions.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Add a Shared Mutation Result Guard for Appointment, Customer, and Tenant Updates
**Status:** proposed
**Files to change:** `src/routes/appointments.ts:L166-L248`, `src/routes/customers.ts:L87-L111`, `src/routes/tenants.ts:L58-L88`, `src/middleware.ts:L1-L260`
**What to do:** Introduce a thin helper that asserts whether an update/delete query actually affected a row and emits the route's standard 404-style failure when it did not. Use it in the appointment update/delete paths, customer update/delete paths, and tenant update paths so silent no-op mutations stop returning success when the target record was missing or out of scope.
**Done when:**
- [ ] Appointment, customer, and tenant mutation routes no longer return success after zero-row updates or deletes
- [ ] Missing-target failures use one consistent helper path and payload style
- [ ] Existing successful mutation behavior is preserved for real row changes
- [ ] All existing tests pass, new tests cover zero-row mutation outcomes
**Why it matters:** Silent success on no-op mutations is a subtle but high-friction backend bug pattern, especially in admin surfaces where operators expect clear confirmation that a real record changed.
**Tradeoff:** Tightening mutation semantics can expose places where the frontend currently assumes optimistic success, so the behavior change needs careful test coverage.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Add Route Tests for Super-Admin and Tenant-Scoped List Parity across Appointments and Customers
**Status:** proposed
**Files to change:** `src/routes/appointments.ts:L59-L123`, `src/routes/customers.ts:L39-L57`, route test files for both modules (new if needed)
**What to do:** Add focused tests that verify normal tenants only see their own rows, super-admin reads bypass tenant filters correctly, and limit/offset behavior stays consistent between the appointments and customers list endpoints. Assert the returned ordering and row counts explicitly so list parity is locked down.
**Done when:**
- [ ] Appointments list is tested for tenant scope, super-admin scope, and pagination behavior
- [ ] Customers list is tested for tenant scope, super-admin scope, and pagination behavior
- [ ] Ordering and count expectations are asserted consistently across both route modules
- [ ] All existing tests pass, new tests lock the list parity contract
**Why it matters:** These routes are central to the dashboard shell, and explicit tests make it much easier to catch cross-tenant regressions before they turn into data-isolation bugs.
**Tradeoff:** Requires a little more fixture setup for multi-tenant data, but the coverage payoff is high because these reads are so fundamental.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-11 (Scheduler Mutation Patterns Reviewed)

### Task: Extract Shared Tenant-Scoped Mutation Response Helpers across Services, Resources, and Shifts
**Status:** proposed
**Files to change:** `src/routes/services.ts:L1-L320`, `src/routes/resources.ts:L1-L320`, `src/routes/shifts.ts:L1-L263`, `src/middleware.ts:L1-L260`
**What to do:** Introduce a small helper layer for the repeated mutation flow used by these three modules: parse body, execute tenant-scoped query, return 404 on zero rows when appropriate, log the domain event, and send the standard success envelope. Keep each route's SQL local, but remove the repeated request skeleton and zero-row handling scattered across create, update, and delete endpoints.
**Done when:**
- [ ] Services, resources, and shifts mutation routes use shared helper paths for common success/error response structure
- [ ] Zero-row update/delete outcomes are handled consistently across the three modules
- [ ] Route-specific SQL and log metadata remain local and readable
- [ ] All existing tests pass, new tests cover the shared mutation helper behavior
**Why it matters:** These routes back sibling setup flows, and standardizing the mutation scaffold reduces drift in the most repeated backend patterns.
**Tradeoff:** The helper must stay thin so it improves consistency without turning straightforward routes into indirect abstractions.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Add a Shared Override Persistence Helper for Shift Override Create, Update, and Week-Copy Flows
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L124-L263`, `src/middleware.ts:L1-L260` (or new `src/routes/shifts/helpers.ts`), `src/routes/shifts.test.ts:L1-L260` (new if needed)
**What to do:** Pull the repeated `employee_schedule` insert/update shape used by override create, override update, and `/shifts/copy-week` into one focused helper that accepts tenant, employee, date, times, and `is_off`, then performs the current upsert behavior. Keep route-specific validation and date-offset logic in place, but centralize the actual override write contract in one reusable function.
**Done when:**
- [ ] Shift override create and copy-week no longer duplicate the same upsert SQL block
- [ ] Override update shares the same field-normalization rules where applicable
- [ ] The helper preserves current `updated_at` and conflict-update behavior
- [ ] All existing tests pass, new tests cover the shared override persistence path
**Why it matters:** Override writes are a critical scheduler correctness path, and consolidating them reduces the chance of future drift between manual edits and copied weeks.
**Tradeoff:** Requires careful extraction so the helper stays specific to override persistence rather than swallowing route-level scheduling logic.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Add Route Tests for Services, Resources, and Shifts Zero-Row Mutation Behavior
**Status:** proposed
**Files to change:** `src/routes/services.ts:L1-L320`, `src/routes/resources.ts:L1-L320`, `src/routes/shifts.ts:L66-L223`, route test files for each module (new if needed)
**What to do:** Add focused tests that verify update and delete endpoints return the correct 404 payload when the target row is missing or outside tenant scope, and that successful mutations still return the current success envelopes. Cover at least one update and one delete case in each module so sibling setup routes stay aligned.
**Done when:**
- [ ] Services update/delete routes are tested for zero-row not-found behavior
- [ ] Resources update/delete routes are tested for zero-row not-found behavior
- [ ] Shifts update/delete routes are tested for zero-row not-found behavior
- [ ] All existing tests pass, new tests lock the mutation-parity contract
**Why it matters:** These endpoints support hands-on operational setup, and explicit not-found tests prevent silent success regressions that would be frustrating in the dashboard.
**Tradeoff:** Adds several similar route cases, so shared test helpers should be used to keep the suite maintainable.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-11 (Code Patterns Reviewed)

### Task: Extract Skill-Map Node State Styling into Shared View-Model Helpers
**Status:** proposed
**Files to change:** `dashboard/components/skill-map/SkillMapNode.tsx:L19-L104`, `dashboard/components/skill-map/SkillRelationshipMap.tsx:L70-L229`, `dashboard/components/skill-map/useSkillMapData.ts:L1-L260` (or new `dashboard/components/skill-map/viewState.ts`)
**What to do:** Move the repeated visual-state logic for selected, highlighted, broken, linking-source, and linking-target nodes out of `SkillMapNode` and the parent map into a small helper module that returns the computed class fragments and flags for each node. Keep rendering in the component, but stop recomputing the same presentation rules inline across the node and parent map layers.
**Done when:**
- [ ] `SkillMapNode` no longer builds its full visual state from multiple inline string fragments
- [ ] `SkillRelationshipMap` passes a simpler derived node-state object instead of several parallel booleans
- [ ] Node styling for selected, broken, and linking modes is defined in one helper path
- [ ] All existing tests pass, new tests cover the derived node-state helper behavior
**Why it matters:** The map's interaction richness is good, but its UI state is starting to sprawl across components, which makes behavior tweaks riskier than they need to be.
**Tradeoff:** Adds one more abstraction layer, so the helper needs to stay presentation-focused and not absorb rendering concerns.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Consolidate Skill-Map Fix Actions into a Single Assignment Helper with Surfaced Error State
**Status:** proposed
**Files to change:** `dashboard/components/skill-map/SkillMapFixPanel.tsx:L22-L123`, `dashboard/lib/api.ts:L1-L260`, `dashboard/components/ui/Toast.tsx:L1-L220` (if existing toast wiring is reused)
**What to do:** Replace the duplicated `assignEmployee` and `assignResource` flows in `SkillMapFixPanel` with one shared async assignment helper that accepts the mapping kind, performs the API call, and returns a surfaced success or failure result. Use that result to show inline or toast-based error feedback instead of only logging to the console when an assignment fails.
**Done when:**
- [ ] `SkillMapFixPanel` no longer defines separate near-duplicate employee and resource assignment functions
- [ ] Assignment failures are shown through inline state or the existing toast system instead of `console.error` only
- [ ] The fix panel still refreshes the map correctly after a successful assignment
- [ ] All existing tests pass, new tests cover success and failure behavior for both assignment types
**Why it matters:** The fix panel exists to unblock broken booking coverage quickly, so silent failures undermine the whole value of the recovery flow.
**Tradeoff:** Adds a little UI state to a small panel, though it pays off by making failures visible and the logic less repetitive.
**Size:** small (< 1hr)
**Impact:** high

### Task: Add Focused Interaction Tests for Skill-Map Linking, Disconnect, and Fix-Panel Recovery Paths
**Status:** proposed
**Files to change:** `dashboard/components/skill-map/SkillRelationshipMap.tsx:L15-L232`, `dashboard/components/skill-map/SkillMapConnections.tsx:L1-L176`, `dashboard/components/skill-map/SkillMapFixPanel.tsx:L22-L123`, `dashboard/components/skill-map/SkillRelationshipMap.test.tsx:L1-L260` (new if needed)
**What to do:** Add component tests covering link-mode start/cancel behavior, disconnect popup actions, and fix-panel assignment success/failure paths. Mock the mapping API calls so the tests assert that highlighted states, saving banners, and refresh callbacks behave correctly through the map's highest-risk interaction flows.
**Done when:**
- [ ] Link-mode start, valid target selection, and cancel behavior are covered by tests
- [ ] Connection disconnect popup behavior is covered for open, close, and confirm cases
- [ ] Fix-panel assignment success and failure paths are covered for both employee and resource actions
- [ ] All existing tests pass, new tests lock the skill-map interaction contract
**Why it matters:** This is one of the most interaction-dense views in the dashboard, and explicit tests would reduce the chance of subtle regressions in a flow that is hard to validate by inspection alone.
**Tradeoff:** Test setup will be more involved because the map depends on layout, SVG connections, and mocked mapping APIs.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-11 (Architecture Reviewed)

### Task: Extract Shared Tenant-Scoped Collection Route Helpers for Calendar, Resources, and Services
**Status:** proposed
**Files to change:** `src/routes/calendar.ts:L12-L120`, `src/routes/resources.ts:L35-L126`, `src/routes/services.ts:L30-L53`, `src/middleware.ts:L1-L260` (or new `src/routes/collectionHelpers.ts`)
**What to do:** Pull the repeated tenant-id resolution, limit/offset parsing, and tenant-scoped query wrapper patterns used by these list-style route modules into a small helper layer. Keep each route's SQL domain-specific, but centralize the scaffolding that decides tenant scope, validates common query params, and returns the query result consistently.
**Done when:**
- [ ] Calendar, resources, and services list handlers no longer inline the same tenant/query scaffolding independently
- [ ] Shared helpers handle common pagination and tenant resolution without changing route-specific result shapes
- [ ] Route SQL stays local to each module instead of being over-generalized
- [ ] All existing tests pass, new tests cover the shared collection helper behavior
**Why it matters:** These are foundational dashboard reads, and reducing repeated scaffolding lowers maintenance overhead while making route parity easier to spot.
**Tradeoff:** The helper needs to stay thin so it improves consistency without obscuring straightforward route logic.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Add Zero-Row Mutation Guards for Resources and Services Update-Delete Paths
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L59-L154`, `src/routes/services.ts:L73-L116`, `src/middleware.ts:L1-L260`
**What to do:** Update the resource and service mutation handlers so they check whether `UPDATE ... RETURNING` or `DELETE` statements actually affected a row, then return a not-found-style failure when the target record is missing or out of scope. Reuse one thin helper or shared pattern so the mutation routes stop reporting success after silent no-op operations.
**Done when:**
- [ ] Resource and service update routes no longer return `success: true` when no row was updated
- [ ] Resource and service delete routes detect missing targets before returning success
- [ ] Not-found responses follow one consistent payload pattern across both modules
- [ ] All existing tests pass, new tests cover zero-row update and delete outcomes
**Why it matters:** Silent mutation success is a subtle but costly backend behavior, especially in setup flows where operators expect a clear signal that a real entity changed.
**Tradeoff:** Tightening these contracts may expose frontend assumptions that were relying on optimistic success, so good regression coverage matters.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Add Route Tests for Collection and Mutation Parity across Calendar, Resources, and Services
**Status:** proposed
**Files to change:** `src/routes/calendar.ts:L12-L220`, `src/routes/resources.ts:L35-L154`, `src/routes/services.ts:L30-L116`, route test files for each module (new if needed)
**What to do:** Add focused tests that assert tenant scoping, pagination behavior where applicable, and zero-row update/delete handling across these three route groups. Use one shared assertion style so parity issues in success and failure payloads show up clearly in the test output.
**Done when:**
- [ ] Calendar collection routes are tested for tenant scope and query-param handling
- [ ] Resources and services routes are tested for list behavior plus update/delete not-found outcomes
- [ ] Success and failure payload shapes are asserted consistently across the three modules
- [ ] All existing tests pass, new tests lock the parity contract
**Why it matters:** These routes support core schedule and setup surfaces, and explicit parity tests are the fastest way to catch drift before it leaks into the dashboard.
**Tradeoff:** Adds some repetitive fixture setup, though shared helpers can keep the suite readable.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-11 (Developer Experience Reviewed)

### Task: Extract Shared Tenant-Scoped CRUD Response Helpers across Shifts, Mappings, and Skills
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L20-L263`, `src/routes/mappings.ts:L12-L107`, `src/routes/skills.ts:L17-L60`, `src/middleware.ts:L1-L260`
**What to do:** Introduce a thin set of helpers for the repeated validation-failure response, tenant-id requirement, success envelope, and not-found mutation response patterns used across these setup-oriented route modules. Keep each route's SQL and branching logic in place, but centralize the repeated request/response scaffold so the handlers read more consistently.
**Done when:**
- [ ] Shifts, mappings, and skills routes no longer hand-roll the same validation and not-found response patterns independently
- [ ] Shared helpers cover only request/response scaffolding, not the domain SQL itself
- [ ] Success and failure payloads remain compatible but follow one clearer route convention
- [ ] All existing tests pass, new tests cover helper behavior where appropriate
**Why it matters:** These modules are small enough to feel easy now, but the repeated scaffolding already creates maintenance drag and makes parity drift harder to spot.
**Tradeoff:** The abstraction has to stay very small or it will make simple route handlers feel more indirect than helpful.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Centralize Skill-Name Normalization with the Same Utility Path Used by Other Setup Entities
**Status:** proposed
**Files to change:** `src/routes/skills.ts:L27-L42`, `src/services/nameUtils.ts:L1-L220`, `src/routes/services.ts:L1-L200`
**What to do:** Move the inline `toLowerCase().trim().replace(/\s+/g, '-')` normalization in the skills create route into a shared helper in `nameUtils.ts`, then align at least one comparable service-name normalization path to use the same utility. Keep the resulting stored value unchanged unless tests reveal a deliberate exception.
**Done when:**
- [ ] Skill creation no longer normalizes names inline in the route handler
- [ ] A shared helper in `nameUtils.ts` owns the slug-style normalization behavior
- [ ] At least one comparable service normalization path uses the same helper
- [ ] All existing tests pass, new tests cover spacing, casing, and special-character normalization behavior
**Why it matters:** String normalization drift is easy to miss, and putting it behind one tested helper reduces duplicated logic in setup routes.
**Tradeoff:** Requires a careful check that existing stored names and client expectations really match the extracted helper output.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Add Route Tests for Shift, Mapping, and Skill Unhappy-Path Parity
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L20-L263`, `src/routes/mappings.ts:L12-L107`, `src/routes/skills.ts:L17-L60`, route test files for each module (new if needed)
**What to do:** Add focused tests that assert validation failures, missing-tenant guards, invalid-id handling, and not-found mutation responses across these three modules. Use a shared assertion style so response-shape drift shows up immediately when one route family starts behaving differently from the others.
**Done when:**
- [ ] Shifts routes are tested for validation and branch-specific unhappy paths
- [ ] Mapping routes are tested for invalid ids and tenant-scoped failure behavior
- [ ] Skills routes are tested for validation and delete not-found behavior
- [ ] All existing tests pass, new tests lock unhappy-path parity across the three modules
**Why it matters:** These routes support operational setup screens where small inconsistencies become repetitive UI edge cases, and parity tests are an efficient way to keep them aligned.
**Tradeoff:** Adds several similar tests, so shared fixtures and helpers will matter to keep the suite readable.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-11 (Backend Workflow Reviewed)

### Task: Extract Shared Normalized-Embedding Write Flow for Knowledge Add and Update Routes
**Status:** proposed
**Files to change:** `src/routes/knowledge.ts:L108-L175`, `src/services/` (new helper such as `knowledgeDocumentWriter.ts`), `src/routes/knowledge.test.ts:L1-L260` (new if needed)
**What to do:** Move the repeated "build Q/A content, normalize text, compute embedding, then write tenant_docs" flow out of the add and update handlers into a dedicated helper/service. Keep the route handlers responsible for validation and tenant resolution, but centralize the document-shaping and embedding-write pipeline so both routes use the same path.
**Done when:**
- [ ] `/knowledge/add` and `/knowledge/:id` no longer duplicate the combined-text, normalization, and embedding preparation steps inline
- [ ] One helper/service owns the tenant-doc payload assembly for Q&A entries
- [ ] Route handlers call the shared helper for both create and update flows
- [ ] All existing tests pass, new tests cover the shared knowledge write flow
**Why it matters:** The add and update handlers are nearly parallel today, and consolidating them reduces duplicated logic in a workflow that mixes validation, AI normalization, and DB writes.
**Tradeoff:** The helper boundary needs to stay focused on the write pipeline so the route files still read clearly.
**Size:** medium (1-3hr)
**Impact:** medium

### Task: Add Explicit Not-Found Guards for Knowledge Delete and Update Mutations
**Status:** proposed
**Files to change:** `src/routes/knowledge.ts:L34-L45`, `src/routes/knowledge.ts:L142-L175`, `src/middleware.ts:L1-L260`
**What to do:** Update the knowledge delete and update handlers so they check the affected row count and return a 404-style failure when the target document does not exist in tenant scope. Reuse a thin shared mutation-result helper if that pattern already exists elsewhere, but stop returning `success: true` after zero-row operations.
**Done when:**
- [ ] Knowledge delete returns a not-found response when no document row was deleted
- [ ] Knowledge update returns a not-found response when no document row was updated
- [ ] Success responses remain unchanged for real document mutations
- [ ] All existing tests pass, new tests cover zero-row delete and update outcomes
**Why it matters:** Silent success on missing knowledge entries makes admin workflows feel unreliable and hides genuine data-integrity problems.
**Tradeoff:** Tightening the contract may expose any frontend paths that were implicitly assuming all mutations succeed, so regression coverage matters.
**Size:** small (< 1hr)
**Impact:** high

### Task: Align Vocabulary and Communications Read Endpoints on a Documented Envelope Policy
**Status:** proposed
**Files to change:** `src/routes/vocabulary.ts:L10-L34`, `src/routes/communications.ts:L137-L251`, `src/middleware.ts:L1-L260`
**What to do:** Decide on one explicit policy for lightweight read endpoints in this part of the API, either raw row payloads or `{ success: true, ... }` envelopes, then update vocabulary and the communications read endpoints to follow it consistently. Preserve their domain fields, but remove the current mix where sibling reads use different top-level response shapes.
**Done when:**
- [ ] Vocabulary and communications read endpoints follow one explicit response-envelope convention
- [ ] Any exceptions are documented in code comments or helper usage instead of being accidental drift
- [ ] Route payload shapes remain predictable for dashboard consumers
- [ ] All existing tests pass, new tests cover the normalized read-endpoint contract
**Why it matters:** These routes feed visible dashboard copy and communication screens, and inconsistent envelopes create avoidable client branching in relatively simple reads.
**Tradeoff:** Must be checked against current frontend callers so the contract cleanup does not introduce accidental breakage.
**Size:** medium (1-3hr)
**Impact:** medium

## Ideas — 2026-04-11 (Integration Workflow Reviewed)

### Task: Extract Shared OAuth State-Token Helpers for Google and Outlook Calendar Services
**Status:** proposed
**Files to change:** `src/services/googleCalendar.ts:L40-L69`, `src/services/outlookCalendar.ts:L45-L79`, `src/services/tokenManagement.ts:L1-L260` (or new `src/services/oauthState.ts`)
**What to do:** Move the duplicated JWT state-signing and verification logic out of the Google and Outlook calendar service modules into one shared helper that accepts the provider purpose string and tenant id. Keep each service responsible for provider-specific URLs and token exchange, but stop repeating nearly identical OAuth state handling in both files.
**Done when:**
- [ ] Google and Outlook calendar services no longer inline their own JWT state creation and verification logic
- [ ] One shared helper owns state signing, verification, and purpose validation
- [ ] Provider-specific auth URL generation still stays inside each service module
- [ ] All existing tests pass, new tests cover valid, expired, and wrong-purpose state tokens
**Why it matters:** This is clear duplication in a security-sensitive path, and centralizing it reduces the chance of the two calendar integrations drifting on CSRF-state behavior.
**Tradeoff:** The helper has to stay narrowly scoped to OAuth state handling so it does not become a generic auth catch-all.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Consolidate Calendar Event Mapping into a Shared Builder Used for Create and Update Sync Paths
**Status:** proposed
**Files to change:** `src/services/calendarSync.ts:L89-L210`, `src/services/googleCalendar.ts:L124-L182`, `src/services/outlookCalendar.ts:L209-L260`
**What to do:** Refactor `calendarSync.ts` so the appointment fetch and event-payload assembly used by the create and update branches share one typed appointment-to-calendar-event builder with consistent service/resource/customer enrichment. Keep provider-specific request bodies inside the Google and Outlook service modules, but make the sync layer call one shared event-shaping path for both actions.
**Done when:**
- [ ] Calendar sync create and update branches no longer duplicate appointment-fetch plus event-build logic
- [ ] Appointment-to-calendar-event mapping lives in one typed helper inside the sync layer
- [ ] Google and Outlook providers still receive the same final event contract without behavioral drift
- [ ] All existing tests pass, new tests cover the shared event-builder behavior
**Why it matters:** The sync flow is operationally important, and removing duplicated fetch-and-build logic makes future calendar changes less risky.
**Tradeoff:** Requires care around the slight differences between the create and update SELECT queries so the consolidation does not accidentally drop needed fields.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Add Service Tests for Calendar Token-Refresh Failure and Create-Fallback Update Behavior
**Status:** proposed
**Files to change:** `src/services/calendarSync.ts:L22-L188`, `src/services/googleCalendar.ts:L88-L182`, `src/services/outlookCalendar.ts:L125-L260`, service test files for these modules (new if needed)
**What to do:** Add focused tests covering the two most fragile sync branches: token refresh failure marking the calendar inactive, and update sync falling back to create when no sync map row exists. Mock the provider modules and DB client interactions so the tests assert both DB side effects and logged branch behavior without requiring real provider calls.
**Done when:**
- [ ] Calendar sync tests cover token refresh failure deactivating the tenant calendar connection
- [ ] Update sync fallback-to-create behavior is covered when no sync mapping exists
- [ ] Provider mocks verify that Google and Outlook integrations both satisfy the same sync-layer contract
- [ ] All existing tests pass, new tests lock the high-risk sync branches
**Why it matters:** These branches are easy to miss in manual testing but have outsized impact on whether calendar sync quietly degrades or recovers correctly in production.
**Tradeoff:** The tests will need heavier mocking around DB and provider boundaries, though the payoff is strong for a business-critical integration path.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-11 (Architecture Reviewed)

### Task: Extract Shared Date and Tenant Query Parsing for Analytics Coverage Endpoints
**Status:** proposed
**Files to change:** `src/routes/analytics.ts:L15-L43`, `src/middleware.ts:L1-L260` (or new `src/routes/queryParsers.ts`), `src/routes/calendar.ts:L1-L220`
**What to do:** Move the `/coverage` route's inline date regex, fallback logic, and tenant-scoped query parsing into a shared helper that also matches the calendar route's date-range parsing conventions. Keep the analytics SQL in place, but make date validation and default handling come from one typed parser used by both scheduler-adjacent route families.
**Done when:**
- [ ] Analytics coverage route no longer defines date regex and fallback logic inline
- [ ] Shared date-range parsing is reusable by both analytics and calendar route code
- [ ] Invalid or missing date params follow one consistent parsing policy
- [ ] All existing tests pass, new tests cover the shared date parser behavior
**Why it matters:** Date handling is easy to let drift across scheduling endpoints, and one parser reduces duplicate logic in routes that should agree on time-window behavior.
**Tradeoff:** The helper needs to stay narrow so it improves consistency without turning simple handlers into indirection puzzles.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Fix Employee Update Tenant Scoping and Zero-Row Mutation Handling
**Status:** proposed
**Files to change:** `src/routes/employees.ts:L90-L123`, `src/middleware.ts:L1-L260`, `src/routes/employees.test.ts:L1-L260` (new if needed)
**What to do:** Update the employee update query so it scopes by both `id` and `tenant_id`, then return a 404-style failure when no row is updated. Keep the existing payload shape for successful updates, but stop allowing cross-tenant or missing-record updates to fall through as implicit success with an undefined employee payload.
**Done when:**
- [ ] Employee update query filters on both employee id and tenant id
- [ ] Zero-row employee updates return a not-found response instead of `success: true`
- [ ] Successful updates preserve the current response payload shape
- [ ] All existing tests pass, new tests cover out-of-scope and missing-record update cases
**Why it matters:** This is a real data-safety edge in a core admin flow, and tightening it removes a subtle cross-tenant mutation risk while making the API contract more honest.
**Tradeoff:** The stricter behavior may expose frontend code that assumed update success without checking for missing targets, so regression tests are important.
**Size:** small (< 1hr)
**Impact:** high

### Task: Add Parity Tests for Analytics Feedback Reads and Employee Mutation Guards
**Status:** proposed
**Files to change:** `src/routes/analytics.ts:L97-L175`, `src/routes/employees.ts:L49-L123`, route test files for both modules (new if needed)
**What to do:** Add focused tests that verify feedback list behavior for super-admin versus tenant-scoped reads, coverage date-param fallback behavior, and employee update/delete not-found handling. Use a shared assertion style so payload drift across these operator-facing endpoints is obvious in the test output.
**Done when:**
- [ ] Analytics feedback endpoints are tested for tenant-scoped and super-admin read behavior
- [ ] Analytics coverage route is tested for valid and fallback date-param handling
- [ ] Employee update and delete routes are tested for missing-record and wrong-tenant outcomes
- [ ] All existing tests pass, new tests lock the operator-facing contract behavior
**Why it matters:** These routes support visible management screens, and explicit parity tests make subtle access-control or contract drift much easier to catch.
**Tradeoff:** Requires a bit more multi-tenant fixture setup, though the coverage value is strong because these paths affect day-to-day operations.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-11 (Platform Contract Review)

### Task: Extract Shared Account Bootstrap Transaction Helper for Auth Register and Admin Tenant Create
**Status:** proposed
**Files to change:** `src/routes/auth.ts:L56-L115`, `src/routes/tenants.ts:L119-L167`, `src/services/nameUtils.ts:L1-L220` (if full-name helpers belong there), `src/middleware.ts:L1-L260` (or new `src/services/accountBootstrap.ts`)
**What to do:** Move the duplicated tenant-plus-owner creation transaction out of `/register` and `/tenants/create` into one helper that accepts business info, owner info, and password, then handles duplicate checks, tenant insert, password hashing, user insert, and transaction control. Preserve each route's endpoint contract and auth posture, but stop maintaining two near-parallel bootstrap flows.
**Done when:**
- [ ] Auth register and admin tenant create no longer inline the full tenant/user bootstrap transaction separately
- [ ] Shared helper owns duplicate detection, password hashing, and transaction control
- [ ] Route-specific response payloads remain unchanged for public register versus admin create
- [ ] All existing tests pass, new tests cover the shared bootstrap helper success and conflict cases
**Why it matters:** These two routes create the same core records with slightly different inputs, and centralizing that workflow reduces duplication in a sensitive account-creation path.
**Tradeoff:** The helper needs to stay explicit about the small differences between self-serve registration and admin provisioning so the abstraction does not hide policy decisions.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Add Explicit Zero-Row Guards for Tenant Delete and Update-Contract Endpoints
**Status:** proposed
**Files to change:** `src/routes/tenants.ts:L59-L117`, `src/middleware.ts:L1-L260`, `src/routes/tenants.test.ts:L1-L260` (new if needed)
**What to do:** Update tenant delete, update-attributes, and update-config so each handler checks whether its query actually affected a tenant row before returning success. Return a not-found-style failure when the tenant id is missing or stale instead of logging success after a no-op mutation.
**Done when:**
- [ ] Tenant delete returns a not-found response when no tenant row was removed
- [ ] Tenant attribute/config update endpoints return not-found when no tenant row was updated
- [ ] Success payloads remain unchanged for real mutations
- [ ] All existing tests pass, new tests cover zero-row delete and update cases
**Why it matters:** These are operator-facing admin routes, and silent success on stale tenant ids makes destructive and configuration workflows much harder to trust.
**Tradeoff:** Tightening the contract may expose callers that were assuming optimistic success, so regression coverage needs to be part of the change.
**Size:** small (< 1hr)
**Impact:** high

### Task: Add Route Tests for Auth, Tenant Admin, and Billing Contract Parity
**Status:** proposed
**Files to change:** `src/routes/auth.ts:L24-L129`, `src/routes/tenants.ts:L50-L220`, `src/routes/billing.ts:L18-L172`, route test files for these modules (new if needed)
**What to do:** Add focused tests that assert response shapes and failure behavior for login, register, tenant create/delete/update, billing checkout configuration failures, and billing status not-found paths. Use one shared assertion style so contract drift across these platform routes is obvious when a handler stops including `success`, returns a raw row unexpectedly, or silently succeeds on a stale id.
**Done when:**
- [ ] Auth routes are tested for success, validation, and conflict/failure payload shapes
- [ ] Tenant admin routes are tested for create conflicts and zero-row delete/update behavior
- [ ] Billing routes are tested for missing Stripe config and missing-tenant/status failure behavior
- [ ] All existing tests pass, new tests lock the platform contract parity behavior
**Why it matters:** These routes define core account and admin behavior, and explicit contract tests are the safest way to prevent subtle API drift from leaking into dashboard setup and billing flows.
**Tradeoff:** The tests will need broader fixture coverage across public, authenticated, and config-dependent paths, though the payoff is strong because these are foundational endpoints.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-11 (Code Patterns Reviewed)

### Task: Extract Shared Integration-Settings Upsert Helper for OAuth Callback Completion
**Status:** proposed
**Files to change:** `src/services/oauthCallbackFactory.ts:L75-L106`, `src/services/tokenManagement.ts:L1-L260` (or new `src/services/integrationSettingsStore.ts`), `src/routes/jobber.ts:L1-L220` (as a consumer reference)
**What to do:** Move the duplicated `tenant_integration_settings` insert-or-update SQL branches out of `createOAuthCallbackHandler` into a small helper that accepts provider, tenant id, token set, and optional settings payload. Keep redirect handling and provider-specific token exchange inside the callback factory, but centralize the persistence step so integrations all complete OAuth through one write path.
**Done when:**
- [ ] OAuth callback completion no longer contains two inline SQL upsert branches for integration settings
- [ ] One shared helper handles token persistence with and without extra settings payloads
- [ ] Existing redirect and logging behavior remains unchanged for successful and failed callbacks
- [ ] All existing tests pass, new tests cover the shared upsert helper behavior
**Why it matters:** This is a sensitive, cross-provider completion path, and centralizing the DB write reduces duplicated SQL in code that should stay boring and predictable.
**Tradeoff:** The helper boundary has to remain tightly scoped to persistence so the callback factory still reads clearly end-to-end.
**Size:** small (< 1hr)
**Impact:** medium

### Task: Unify Calendar and Integration Token Refresh Flows Behind One Row-Locking Helper
**Status:** proposed
**Files to change:** `src/services/tokenManagement.ts:L68-L139`, `src/services/tokenManagement.ts:L239-L340`, `src/services/calendarSync.ts:L1-L220`
**What to do:** Refactor `getIntegrationTokens()` and `getCalendarTokens()` to share a lower-level helper for row locking, expiry checks, refresh execution, inactive-on-failure handling, and logging. Keep the table-specific column names and return shapes at the wrapper layer, but stop maintaining two near-parallel refresh pipelines in the same module.
**Done when:**
- [ ] Integration-token and calendar-token refresh logic share one lower-level refresh helper
- [ ] Table-specific wrappers still return their current shapes without behavioral changes
- [ ] Refresh failure still marks the relevant row inactive and logs through the existing provider-specific context
- [ ] All existing tests pass, new tests cover both wrappers plus the shared refresh helper
**Why it matters:** Token refresh is security- and reliability-sensitive code, and consolidating the common mechanics lowers the risk of the two refresh paths drifting on expiry or failure behavior.
**Tradeoff:** The shared helper must stay low-level and explicit so differences between the two tables remain easy to understand.
**Size:** medium (1-3hr)
**Impact:** high

### Task: Add Service Tests for OAuth Callback Persistence and Token-Refresh Race Protection
**Status:** proposed
**Files to change:** `src/services/oauthCallbackFactory.ts:L48-L118`, `src/services/tokenManagement.ts:L68-L340`, service test files for these modules (new if needed)
**What to do:** Add focused tests that verify OAuth callback persistence with and without extra settings, token refresh deactivation on failure, and the row-locking refresh path when a token is near expiry. Mock the pool/client interactions so the tests assert SQL-side effects and returned values without hitting real providers.
**Done when:**
- [ ] OAuth callback factory is tested for successful persistence and token-exchange failure redirects
- [ ] Token-management tests cover refresh success, refresh failure marking inactive, and no-refresh-needed branches
- [ ] Tests assert that the shared row-locking flow preserves the current inactive-on-failure behavior
- [ ] All existing tests pass, new tests lock the integration-service contract
**Why it matters:** These services sit under multiple integrations, so a single regression here can quietly break several provider flows at once.
**Tradeoff:** The tests will require detailed pool/client mocks, though the coverage payoff is strong because these are shared infrastructure utilities.
**Size:** medium (1-3hr)
**Impact:** high

## Ideas — 2026-04-11 (Integration Workflow Reviewed)

### Task: Extract Shared Sync-Map Upsert Helpers for Jobber Pull and Push Flows
**Status:** proposed
**Files to change:** `src/services/jobberSync.ts:L79-L104`, `src/services/jobberSync.ts:L214-L239`, `src/services/jobberSync.ts:L310-L333`, `src/services/jobberSync.ts:L387-L390`
**What to do:** Move the repeated `entity_sync_map` insert/update SQL blocks in the Jobber push and pull flows into a small helper layer that accepts entity type, local id, external id, and timestamp fields. Keep the push/pull orchestration where it is, but centralize sync-map persistence so customer and appointment flows stop hand-maintaining parallel SQL branches.
**Done when:**
- [ ] Jobber sync push and pull paths no longer inline multiple near-duplicate `entity_sync_map` upsert statements
- [ ] Shared helpers cover both create and update sync-map persistence cases for customers and appointments
- [ ] Existing sync timestamps and status fields remain unchanged in behavior
- [ ] All existing tests pass, new tests cover the shared sync-map helper behavior
**Why it matters:** Jobber sync is one of the denser provider integrations, and removing repeated persistence SQL lowers maintenance cost in a high-change integration path.
**Tradeoff:** The helper must stay small and persistence-focused so it does not make the main sync flow harder to read.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, solid maintainability gain in one of the most repetitive provider sync modules.

### Task: Extract Shared Remote-Vs-Local Freshness Guards for Jobber Pull Merges
**Status:** proposed
**Files to change:** `src/services/jobberSync.ts:L267-L301`, `src/services/jobberSync.ts:L353-L381`, `src/services/tokenManagement.ts:L1-L260` (only if a generic helper belongs there, otherwise keep local to Jobber sync)
**What to do:** Pull the repeated "skip already-synced version, compare remote timestamp against local updated_at, then update sync_map" merge logic out of `pullJobberClient()` and `pullJobberVisit()` into a focused helper that decides whether remote data should overwrite the local record. Leave entity-specific field updates in each function, but centralize the freshness check and sync-map timestamp update pattern.
**Done when:**
- [ ] Jobber customer and visit pull flows no longer duplicate the same timestamp-merge guard logic
- [ ] One helper decides whether a remote record should update the local copy based on sync-map and local timestamps
- [ ] Entity-specific update SQL remains inside the customer and visit pull functions
- [ ] All existing tests pass, new tests cover remote-newer, local-newer, and already-synced cases
**Why it matters:** Timestamp merge rules are easy to drift in bidirectional sync code, and centralizing them reduces subtle data-reconciliation bugs.
**Tradeoff:** The helper has to stay narrowly focused on freshness decisions so it does not turn the sync functions into hard-to-follow callbacks.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high reliability gain because it consolidates conflict resolution in a business-critical sync path.

### Task: Add Service Tests for Jobber Sync-Map Persistence and Merge-Decision Branches
**Status:** proposed
**Files to change:** `src/services/jobberSync.ts:L23-L450`, `src/services/jobberSync.test.ts:L1-L320` (new if needed)
**What to do:** Add focused tests that verify customer and appointment push paths persist sync-map rows correctly, and that pull paths behave correctly when the remote record is newer, the local record is newer, or the sync-map already reflects the current remote version. Mock GraphQL responses and DB clients so the tests assert side effects without requiring a live Jobber account.
**Done when:**
- [ ] Push tests cover sync-map inserts/updates for customer and appointment create flows
- [ ] Pull tests cover remote-newer, local-newer, and already-synced branches for customers and visits
- [ ] Error-path tests verify the module does not write incorrect sync-map state when provider mutations fail
- [ ] All existing tests pass, new tests lock the Jobber sync decision branches
**Why it matters:** This service coordinates a lot of hidden business behavior, and explicit tests would make regression risk much lower in one of the most complex integrations.
**Tradeoff:** The test harness will need heavier DB and provider mocks, though the confidence payoff is strong for a critical sync service.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it secures a dense integration workflow that is hard to validate manually.

## Ideas — 2026-04-11 (Integration Workflow Reviewed)

### Task: Extract Shared Sync-Map Persistence Helpers for HubSpot Customer and Appointment Flows
**Status:** proposed
**Files to change:** `src/services/hubspotSync.ts:L55-L94`, `src/services/hubspotSync.ts:L176-L195`, `src/services/hubspotSync.ts:L266-L307`
**What to do:** Move the repeated `entity_sync_map` insert/update SQL used by HubSpot push and pull flows into a small helper layer that accepts provider entity type, local id, external id, and timestamp fields. Keep the push and pull orchestration in place, but centralize sync-map persistence so customer and appointment paths stop maintaining parallel SQL by hand.
**Done when:**
- [ ] HubSpot push and pull paths no longer inline multiple near-duplicate `entity_sync_map` insert/update statements
- [ ] Shared helpers cover both customer and appointment sync-map persistence cases
- [ ] Existing timestamp and sync-status behavior remains unchanged
- [ ] All existing tests pass, new tests cover the shared sync-map helper behavior
**Why it matters:** This integration repeats the same persistence patterns several times, and centralizing them reduces maintenance cost in a sensitive sync path.
**Tradeoff:** The helper needs to stay tightly focused on persistence so the surrounding business logic remains readable.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile maintainability gain in a provider module with repeated sync bookkeeping.

### Task: Extract Shared Freshness-Decision Helper for HubSpot Pull Merges
**Status:** proposed
**Files to change:** `src/services/hubspotSync.ts:L214-L307`, `src/services/nameUtils.ts:L1-L220` (only if a local helper belongs there, otherwise keep it within `hubspotSync.ts`)
**What to do:** Pull the repeated remote-vs-local timestamp comparison logic out of the HubSpot contact pull flow into a focused helper that decides whether a remote record should overwrite the local customer row, whether the sync map should update only, or whether the remote version is already fully synced. Keep entity-specific SQL inside the pull function, but centralize the merge-decision rules.
**Done when:**
- [ ] HubSpot pull flow no longer mixes sync-map version checks and timestamp merge rules inline with row updates
- [ ] One helper decides between already-synced, remote-newer, and local-newer outcomes
- [ ] Customer update SQL remains in the pull function, using the helper result to branch
- [ ] All existing tests pass, new tests cover all merge-decision outcomes
**Why it matters:** Merge-decision bugs in bidirectional sync code are subtle and expensive, and isolating the rules makes them easier to reason about and test.
**Tradeoff:** The helper must stay narrow so it clarifies the control flow rather than fragmenting it.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high reliability gain because it isolates conflict resolution in a tricky bidirectional-sync branch.

### Task: Add Service Tests for HubSpot Sync-Map Writes and Merge-Decision Branches
**Status:** proposed
**Files to change:** `src/services/hubspotSync.ts:L1-L357`, `src/services/hubspotSync.test.ts:L1-L320` (new if needed)
**What to do:** Add focused tests that verify customer and appointment push flows write sync-map rows correctly, and that contact pull behaves correctly when the remote record is newer, the local row is newer, or the sync map already matches the current remote version. Mock provider responses and DB clients so the tests assert side effects without live HubSpot calls.
**Done when:**
- [ ] Push tests cover sync-map insert/update behavior for customer and appointment flows
- [ ] Pull tests cover already-synced, remote-newer, and local-newer branches
- [ ] Error-path tests verify failed provider calls do not leave incorrect sync-map state behind
- [ ] All existing tests pass, new tests lock the HubSpot sync decision branches
**Why it matters:** This module coordinates hidden integration behavior that is hard to verify manually, and branch-focused tests would dramatically improve confidence in future changes.
**Tradeoff:** The test harness will need heavier DB and provider mocks, though the payoff is strong because the sync logic is both shared and business-critical.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects a dense integration service where regressions would be expensive.

## Ideas — 2026-04-11 (Integration Workflow Reviewed)

### Task: Extract Shared Sync-Map Persistence Helpers for Square and ServiceTitan Push Flows
**Status:** proposed
**Files to change:** `src/services/squareSync.ts:L76-L99`, `src/services/squareSync.ts:L197-L218`, `src/services/servicetitanSync.ts:L93-L119`, `src/services/servicetitanSync.ts:L216-L243`
**What to do:** Move the repeated `entity_sync_map` insert/update SQL used by Square and ServiceTitan customer and appointment push flows into a small helper that accepts provider, entity type, local id, external id, and timestamp values. Keep provider orchestration where it is, but centralize sync-map persistence so these two provider modules stop maintaining nearly identical bookkeeping SQL.
**Done when:**
- [ ] Square and ServiceTitan push flows no longer inline multiple near-duplicate sync-map insert/update statements
- [ ] One helper covers customer and appointment sync-map persistence for both providers
- [ ] Existing sync-status and timestamp behavior remains unchanged
- [ ] All existing tests pass, new tests cover the shared sync-map helper behavior
**Why it matters:** These provider modules already share the same sync bookkeeping shape, and centralizing that logic would cut repetition in integration code that is easy to regress quietly.
**Tradeoff:** The helper must remain persistence-focused so it does not blur provider-specific business behavior.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile maintainability gain by removing repeated bookkeeping from two provider modules at once.

### Task: Extract Shared Synced-Customer Resolution Helper for Appointment Push Paths
**Status:** proposed
**Files to change:** `src/services/squareSync.ts:L161-L178`, `src/services/servicetitanSync.ts:L181-L198`, `src/services/syncOrchestrator.ts:L1-L260` (only if a shared integration helper belongs there, otherwise add a local service helper)
**What to do:** Pull the repeated "look up synced customer id, create remote customer if missing, then re-read sync map" pattern out of the Square and ServiceTitan appointment push flows into a helper that guarantees a synced remote customer id before booking/job creation. Keep provider-specific customer sync functions intact, but centralize the orchestration pattern for dependent appointment pushes.
**Done when:**
- [ ] Square and ServiceTitan appointment push flows no longer inline the same synced-customer resolution sequence
- [ ] One helper guarantees a remote customer id or returns a clear null path before appointment creation
- [ ] Provider-specific customer sync functions remain unchanged and are called through the helper
- [ ] All existing tests pass, new tests cover already-synced and sync-on-demand customer resolution cases
**Why it matters:** This dependency chain is easy to get wrong in provider sync code, and centralizing it reduces duplicate control flow in two business-critical appointment push paths.
**Tradeoff:** The helper must stay narrow so it improves readability rather than hiding too much provider-specific nuance.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it consolidates a fragile prerequisite step in two operational sync flows.

### Task: Add Service Tests for Square and ServiceTitan Dependent-Sync Branches
**Status:** proposed
**Files to change:** `src/services/squareSync.ts:L27-L320`, `src/services/servicetitanSync.ts:L45-L360`, service test files for both modules (new if needed)
**What to do:** Add focused tests that verify customer sync-map writes, appointment push behavior when the customer is already synced, and appointment push fallback when the customer must be synced first. Also cover delete/cancel branches so the provider modules are tested across their most branch-heavy sync paths without requiring live external accounts.
**Done when:**
- [ ] Square service tests cover customer sync-map writes and appointment push with and without a pre-existing synced customer
- [ ] ServiceTitan service tests cover the same dependent-sync branches plus cancel/delete behavior
- [ ] Error-path tests verify provider failures do not leave incorrect sync-map state behind
- [ ] All existing tests pass, new tests lock the branch-heavy provider sync behavior
**Why it matters:** These services coordinate hidden integration behavior with several conditional branches, and targeted tests would make future provider changes much safer.
**Tradeoff:** The tests require detailed DB and provider mocking, though the payoff is strong because these branches are difficult to verify manually.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it secures provider flows that combine sync bookkeeping, dependency resolution, and destructive updates.

## Ideas — 2026-04-11 (Code Patterns Reviewed)

### Task: Extract Shared Provider Sync-Context Wrappers Inside ServiceTitan Sync Flows
**Status:** proposed
**Files to change:** `src/services/servicetitanSync.ts:L250-L420`, `src/services/tokenManagement.ts:L149-L226`
**What to do:** Replace the repeated `setSyncContext(...)`, `try/finally`, and `clearSyncContext(...)` blocks in the ServiceTitan pull mutation paths with the existing `withSyncContext()` helper from `tokenManagement.ts`. Keep the entity-specific SQL where it is, but route each sync mutation through the shared wrapper so cleanup logic is not duplicated by hand.
**Done when:**
- [ ] ServiceTitan pull mutation flows no longer inline manual sync-context setup and teardown blocks
- [ ] `withSyncContext()` is used for the relevant customer and job update paths
- [ ] Current change-source and changed-by values remain unchanged in behavior
- [ ] All existing tests pass, new tests cover cleanup-on-error behavior if needed
**Why it matters:** This is already-solved infrastructure duplication, and using the shared wrapper reduces the chance of future cleanup mistakes in provider sync code.
**Tradeoff:** The refactor is small, but it touches subtle bookkeeping code that deserves regression coverage.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good safety gain by eliminating hand-managed cleanup in a sensitive sync path.

### Task: Unify Token-Access Logging Prefixes across Integration and Calendar Refresh Helpers
**Status:** proposed
**Files to change:** `src/services/tokenManagement.ts:L41-L127`, `src/services/tokenManagement.ts:L210-L284`, `src/services/syncOrchestrator.ts:L1-L260`
**What to do:** Refactor the calendar token refresh helper to use the same `syncCtx()`-style prefix builder pattern already used by integration token refreshes, or extend `syncCtx()` to cover calendar providers explicitly. Keep existing log content, but stop maintaining parallel prefix-building conventions inside the same shared token module.
**Done when:**
- [ ] Integration and calendar token refresh helpers build their log prefixes through one shared path
- [ ] Provider and tenant identifiers remain visible in all refresh success/failure logs
- [ ] Existing refresh behavior and error handling stay unchanged
- [ ] All existing tests pass, new tests cover the shared prefix helper if added
**Why it matters:** Shared infrastructure logs are much easier to read and grep when they follow one predictable format, especially during sync incidents.
**Tradeoff:** This is mostly a maintainability cleanup, so the implementation should stay small and avoid over-designing the logger interface.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain through more consistent observability in shared sync utilities.

### Task: Add Shared-Service Tests for WithSyncContext and Calendar Token Deactivation Branches
**Status:** proposed
**Files to change:** `src/services/tokenManagement.ts:L149-L284`, `src/services/tokenManagement.test.ts:L1-L320` (new if needed)
**What to do:** Add focused tests that verify `withSyncContext()` always clears session variables on success and failure, and that `getCalendarTokens()` marks a calendar inactive when token refresh fails. Mock the query client and pool so the tests assert the exact cleanup and update behavior without calling real providers.
**Done when:**
- [ ] `withSyncContext()` is tested for normal completion and thrown-error cleanup behavior
- [ ] `getCalendarTokens()` is tested for refresh success, no-refresh-needed, and refresh-failure deactivation branches
- [ ] The tests assert the exact query/update side effects for cleanup and inactive marking
- [ ] All existing tests pass, new tests lock the shared token-management behavior
**Why it matters:** This module underpins several integrations, so strong tests here provide a lot of leverage against subtle cross-provider regressions.
**Tradeoff:** The tests require careful pool/client mocking, though the payoff is high because the helper behavior is shared widely.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it secures low-level shared behavior used by multiple integrations.

## Ideas — 2026-04-11 (Integration Workflow Reviewed)

### Task: Extract Shared Sync-Map Timestamp Update Helpers across Jobber, HubSpot, and Square Pull Flows
**Status:** proposed
**Files to change:** `src/services/jobberSync.ts:L267-L301`, `src/services/jobberSync.ts:L353-L381`, `src/services/hubspotSync.ts:L214-L307`, `src/services/squareSync.ts:L247-L303`
**What to do:** Pull the repeated "update `entity_sync_map` with `remote_updated_at`, `last_synced_at`, and `sync_status` after pull reconciliation" logic into a small helper shared by the provider sync services. Keep provider-specific entity update SQL in each module, but centralize the final sync-map timestamp write so pull reconciliation bookkeeping stops drifting provider by provider.
**Done when:**
- [ ] Jobber, HubSpot, and Square pull flows no longer inline their own near-duplicate sync-map timestamp update statements
- [ ] One helper handles post-pull sync-map timestamp persistence for customer and appointment entities
- [ ] Existing provider-specific pull decision logic remains unchanged
- [ ] All existing tests pass, new tests cover the shared sync-map timestamp helper behavior
**Why it matters:** This bookkeeping happens repeatedly across providers, and centralizing it reduces low-value duplication in some of the trickiest integration code.
**Tradeoff:** The helper must remain narrowly focused on the sync-map write so it does not obscure the real merge logic around it.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, solid maintainability gain across several provider sync modules at once.

### Task: Extract Shared "ensure Remote Customer before Appointment Push" Helper across Jobber and Square
**Status:** proposed
**Files to change:** `src/services/jobberSync.ts:L155-L178`, `src/services/squareSync.ts:L161-L178`, `src/services/syncOrchestrator.ts:L1-L260` (only if the helper belongs there, otherwise add a local sync utility)
**What to do:** Pull the repeated pattern of checking for an existing customer sync-map row, invoking customer sync when missing, and then re-reading the external id before appointment push into a shared helper. Keep provider-specific customer sync functions intact, but centralize this dependency-resolution sequence so appointment push flows do not keep re-implementing it.
**Done when:**
- [ ] Jobber and Square appointment push flows no longer inline the same customer-sync prerequisite sequence
- [ ] One helper guarantees a remote customer id is available or returns a clear null path
- [ ] Provider-specific customer sync functions remain unchanged and are called through the helper
- [ ] All existing tests pass, new tests cover already-synced and sync-on-demand prerequisite cases
**Why it matters:** This prerequisite logic is easy to get subtly wrong, and consolidating it reduces duplicate control flow in business-critical appointment push paths.
**Tradeoff:** The helper must stay small so it improves readability instead of hiding provider-specific nuances.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it consolidates a fragile dependency step in two core provider push paths.

### Task: Add Cross-Provider Sync-Service Tests for Pull Bookkeeping Parity
**Status:** proposed
**Files to change:** `src/services/jobberSync.ts:L236-L452`, `src/services/hubspotSync.ts:L200-L357`, `src/services/squareSync.ts:L236-L452`, service test files for these modules (new if needed)
**What to do:** Add focused tests that assert each provider's pull flow updates sync-map timestamps consistently after already-synced, remote-newer, and local-newer branches. Use a shared assertion helper so bookkeeping parity shows up clearly across the provider test suites.
**Done when:**
- [ ] Jobber pull tests cover already-synced, remote-newer, and local-newer sync-map bookkeeping outcomes
- [ ] HubSpot pull tests cover the same bookkeeping branches
- [ ] Square pull tests cover the same bookkeeping branches
- [ ] All existing tests pass, new tests lock cross-provider pull bookkeeping parity
**Why it matters:** These bookkeeping differences are subtle and easy to miss in review, and explicit parity tests would make future integration changes much safer.
**Tradeoff:** The tests require fairly detailed provider and DB mocks, though the payoff is strong because the bugs here are quiet and expensive.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects a subtle cross-provider consistency surface that is hard to verify manually.

## Ideas — 2026-04-11 (Code Patterns Reviewed)

### Task: Reuse WithSyncContext in Calendar Sync Delete and Update Mutation Paths
**Status:** proposed
**Files to change:** `src/services/calendarSync.ts:L157-L214`, `src/services/tokenManagement.ts:L149-L226`
**What to do:** Replace any remaining manual `setSyncContext(...)` / `clearSyncContext(...)` scaffolding in `calendarSync.ts` with the shared `withSyncContext()` helper from `tokenManagement.ts`. Keep the provider-specific delete and update orchestration where it is, but route the DB mutation portions through the shared wrapper so context cleanup is handled consistently.
**Done when:**
- [ ] Calendar sync mutation paths no longer manage sync context manually where `withSyncContext()` can be used
- [ ] Existing change-source and changed-by values remain unchanged in behavior
- [ ] Cleanup still happens on both success and thrown-error branches
- [ ] All existing tests pass, new tests cover cleanup behavior if needed
**Why it matters:** This is exactly the kind of shared low-level pattern that is easy to get subtly wrong when copied by hand.
**Tradeoff:** The refactor is small, but it touches bookkeeping code in a business-critical integration path, so regression coverage matters.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good safety gain by removing hand-managed context cleanup from calendar sync.

### Task: Extract Shared Calendar Sync Log-Prefix Helper from Token and Sync Modules
**Status:** proposed
**Files to change:** `src/services/tokenManagement.ts:L37-L58`, `src/services/calendarSync.ts:L15-L214`, `src/services/syncOrchestrator.ts:L1-L260`
**What to do:** Extend the existing `syncCtx()` helper, or add a tiny sibling helper, so calendar sync and calendar token refresh logs use the same prefix-construction path as the CRM provider sync services. Keep the current log detail, but stop maintaining raw string prefixes in multiple calendar-related modules.
**Done when:**
- [ ] Calendar sync and calendar token refresh logs build their prefixes through one shared helper path
- [ ] Existing provider and tenant identifiers remain visible in all log output
- [ ] CRM integration sync logs remain unchanged or use the same helper without behavioral drift
- [ ] All existing tests pass, new tests cover the shared prefix helper if added
**Why it matters:** Consistent log prefixes make debugging and grep-driven incident work much easier across related sync subsystems.
**Tradeoff:** This is mostly observability cleanup, so the helper should stay tiny and avoid turning into a generalized logging framework.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain through cleaner and more uniform sync observability.

### Task: Add Shared-Service Tests for Calendar Sync Context Cleanup and Token Refresh Deactivation Parity
**Status:** proposed
**Files to change:** `src/services/calendarSync.ts:L19-L214`, `src/services/tokenManagement.ts:L227-L304`, `src/services/calendarSync.test.ts:L1-L320` (new if needed), `src/services/tokenManagement.test.ts:L1-L320` (new if needed)
**What to do:** Add focused tests that verify calendar sync clears change-source context after success and failure paths, and that `getCalendarTokens()` deactivates the calendar setting row when token refresh fails. Assert the exact DB side effects and cleanup queries so these shared behaviors stay locked down.
**Done when:**
- [ ] Calendar sync tests cover context cleanup after both successful and thrown-error mutation paths
- [ ] Token-management tests cover calendar token refresh success, no-refresh-needed, and refresh-failure deactivation branches
- [ ] The tests assert exact cleanup and update side effects rather than only returned values
- [ ] All existing tests pass, new tests lock the shared calendar-service behavior
**Why it matters:** These shared behaviors sit under visible calendar integrations, and subtle regressions here can quietly break sync reliability in ways that are hard to diagnose later.
**Tradeoff:** The tests require detailed pool/client mocks, though the payoff is strong because they protect shared integration plumbing.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it secures low-level calendar integration behavior used repeatedly.

## Ideas — 2026-04-11 (Integration Workflow Reviewed)

### Task: Extract Shared Calendar Event Fetch Queries for Create and Update Sync Paths
**Status:** proposed
**Files to change:** `src/services/calendarSync.ts:L84-L157`, `src/services/calendarSync.ts:L167-L196`
**What to do:** Pull the repeated appointment-fetch logic in the create and update branches into one helper that loads the appointment plus customer/resource/service context and returns a typed event-input payload. Keep the create/update/delete orchestration where it is, but stop maintaining two slightly different SELECT blocks for the same calendar event data.
**Done when:**
- [ ] Calendar sync create and update branches no longer inline separate appointment-fetch queries for event building
- [ ] One helper returns the appointment context needed to build an external calendar event
- [ ] `buildCalendarEvent()` receives the same typed shape from both create and update flows
- [ ] All existing tests pass, new tests cover the shared event-fetch helper behavior
**Why it matters:** The current create and update branches are close cousins, and centralizing the shared fetch logic reduces duplication in a business-critical sync path.
**Tradeoff:** The helper needs to preserve the few differences between branches without becoming a vague "do everything" data loader.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low-to-moderate effort, solid maintainability gain in a sensitive integration path.

### Task: Extract Shared Token-Refresh Update Helper for Google and Outlook Calendar Services
**Status:** proposed
**Files to change:** `src/services/googleCalendar.ts:L93-L121`, `src/services/outlookCalendar.ts:L109-L157`, `src/services/tokenManagement.ts:L1-L260` (or new `src/services/calendarTokenRefresh.ts`)
**What to do:** Move the parallel refresh-response handling used by the Google and Outlook calendar service modules into one helper that normalizes the provider refresh result into `{ access_token, expiry_date }` and applies consistent error messaging. Keep provider-specific API calls in each module, but centralize the post-refresh normalization path.
**Done when:**
- [ ] Google and Outlook calendar service modules no longer inline similar refresh-response normalization logic
- [ ] One helper returns a consistent normalized token refresh shape for both providers
- [ ] Provider-specific HTTP/token exchange logic remains inside each calendar service
- [ ] All existing tests pass, new tests cover normalized refresh success and failure cases
**Why it matters:** Calendar refresh handling is duplicated in two security-sensitive modules, and centralizing the normalization step reduces drift without over-abstracting provider APIs.
**Tradeoff:** The shared helper must stay narrowly scoped to response normalization so the provider modules remain easy to inspect.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low-to-moderate effort, good consistency gain in a token-handling path where subtle drift is costly.

### Task: Add Service Tests for Calendar Sync Create-Update Query Parity and Delete Cleanup
**Status:** proposed
**Files to change:** `src/services/calendarSync.ts:L19-L214`, `src/services/calendarSync.test.ts:L1-L320` (new if needed)
**What to do:** Add focused tests that verify the create and update sync branches build equivalent calendar events from the loaded appointment context, that update falls back to create when no sync map row exists, and that delete removes the sync-map row even when the provider delete call reports a missing remote event. Mock provider modules and DB clients so the tests assert side effects without real calendar accounts.
**Done when:**
- [ ] Tests cover create and update branches producing equivalent event payloads from the same appointment data
- [ ] Tests cover update falling back to create when no `appointment_sync_map` row exists
- [ ] Tests cover delete cleanup behavior when provider deletion fails but DB cleanup should still proceed
- [ ] All existing tests pass, new tests lock the calendar sync branch behavior
**Why it matters:** This module controls a user-visible integration with several quiet fallback branches, and explicit tests would make future sync changes much safer.
**Tradeoff:** The tests need heavier provider and DB mocks, though the confidence gain is high because these branches are hard to validate manually.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it locks down subtle sync behavior in a business-critical calendar path.

## Ideas — 2026-04-11 (Integration Workflow Reviewed)

### Task: Extract Shared Remote-Version Guard Helper for Square Customer and Booking Pull Flows
**Status:** proposed
**Files to change:** `src/services/squareSync.ts:L247-L384`
**What to do:** Pull the repeated remote-version comparison logic out of `pullSquareCustomer()` and `pullSquareBooking()` into a focused helper that decides whether an incoming remote record should be skipped, merged, or fully updated. Keep entity-specific SQL inside each pull function, but centralize the remote-version guard rules.
**Done when:**
- [ ] Square customer and booking pull flows no longer duplicate the same remote-version guard pattern inline
- [ ] One helper decides between already-synced, remote-newer, and update-required outcomes
- [ ] Entity-specific customer and appointment update SQL remains in each pull function
- [ ] All existing tests pass, new tests cover all remote-version decision branches
**Why it matters:** Remote-version handling is subtle bidirectional-sync logic, and centralizing it reduces the chance of silent drift between customer and booking pull behavior.
**Tradeoff:** The helper has to stay narrow so it clarifies control flow instead of hiding the real business updates.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high reliability gain by isolating one of the trickier sync decision patterns.

### Task: Extract Shared Sync-Context Wrapper for Provider Pull Mutations
**Status:** proposed
**Files to change:** `src/services/squareSync.ts:L236-L388`, `src/services/servicetitanSync.ts:L250-L420`, `src/services/tokenManagement.ts:L1-L260` (or new `src/services/syncContextRunner.ts`)
**What to do:** Move the repeated `setSyncContext(...)`, `try/finally`, and `clearSyncContext(...)` scaffolding used around provider pull mutations into a small helper that runs a callback inside the correct sync context. Keep each provider's actual DB updates in place, but stop duplicating the same context-bookending pattern in pull flows.
**Done when:**
- [ ] Square and ServiceTitan pull functions no longer inline their own sync-context setup and teardown blocks
- [ ] One helper guarantees `clearSyncContext()` runs after every provider pull mutation path
- [ ] Provider-specific pull logic remains in the existing sync modules
- [ ] All existing tests pass, new tests cover normal and thrown-error cleanup behavior
**Why it matters:** Sync context is cross-cutting infrastructure logic, and centralizing it reduces the risk of forgetting cleanup in future provider pull changes.
**Tradeoff:** The wrapper must stay very small so the provider pull functions remain easy to follow during debugging.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low-to-moderate effort, good safety gain in shared sync infrastructure.

### Task: Add Service Tests for Square Remote-Version Guards and Sync-Context Cleanup
**Status:** proposed
**Files to change:** `src/services/squareSync.ts:L236-L452`, `src/services/squareSync.test.ts:L1-L320` (new if needed), `src/services/servicetitanSync.test.ts:L1-L320` (new if needed for shared cleanup coverage)
**What to do:** Add focused tests that verify Square pull skips already-synced remote versions, updates correctly when the remote record is newer, and always clears sync context even when a provider or DB operation throws. Cover the shared cleanup wrapper through at least one failure-path test so future refactors cannot silently leak sync context between operations.
**Done when:**
- [ ] Square pull tests cover already-synced, remote-newer, and update-required branches for customers and bookings
- [ ] At least one failure-path test proves sync context cleanup still runs after an exception
- [ ] Shared cleanup behavior is asserted explicitly, not just indirectly through success cases
- [ ] All existing tests pass, new tests lock remote-version and cleanup behavior
**Why it matters:** These are the kinds of invisible sync bugs that only show up under odd production timing, and targeted tests make them much less likely to slip through.
**Tradeoff:** The tests need some careful DB/client mocking, though the payoff is strong because the logic is subtle and hard to validate manually.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects nuanced sync behavior and cleanup guarantees.

## Ideas — 2026-04-11 (Integration Workflow Reviewed)

### Task: Extract Shared "ensure Synced Customer before Appointment Push" Helper across HubSpot and ServiceTitan
**Status:** proposed
**Files to change:** `src/services/hubspotSync.ts:L114-L157`, `src/services/servicetitanSync.ts:L152-L198`, `src/services/syncOrchestrator.ts:L1-L260` (only if the helper belongs there, otherwise add a local sync utility)
**What to do:** Pull the repeated pattern of checking for a synced customer external id, triggering customer sync if missing, and then re-reading the mapping before appointment/job push into a shared helper. Keep provider-specific customer sync functions intact, but centralize the dependency-resolution sequence so these push flows stop hand-maintaining the same prerequisite logic.
**Done when:**
- [ ] HubSpot and ServiceTitan appointment/job push flows no longer inline the same synced-customer prerequisite sequence
- [ ] One helper guarantees a remote customer id is available or returns a clear null path
- [ ] Provider-specific customer sync functions remain unchanged and are called through the helper
- [ ] All existing tests pass, new tests cover already-synced and sync-on-demand prerequisite cases
**Why it matters:** This prerequisite chain is easy to get subtly wrong, and consolidating it reduces duplicate control flow in business-critical push paths.
**Tradeoff:** The helper must stay small so it improves readability instead of hiding provider-specific nuances.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it consolidates a fragile dependency step in two core provider push flows.

### Task: Replace Manual HubSpot Pull Context Handling with WithSyncContext
**Status:** proposed
**Files to change:** `src/services/hubspotSync.ts:L210-L307`, `src/services/tokenManagement.ts:L149-L226`
**What to do:** Refactor `pullHubSpotContact()` so its mutation work runs inside the shared `withSyncContext()` helper instead of manually calling `setSyncContext(...)` and `clearSyncContext(...)`. Keep the existing merge logic and provider-specific logging unchanged, but route the context lifecycle through the shared wrapper.
**Done when:**
- [ ] `pullHubSpotContact()` no longer inlines manual sync-context setup and teardown
- [ ] `withSyncContext()` is used for the HubSpot pull mutation path
- [ ] Existing provider-specific logging and merge behavior stay unchanged
- [ ] All existing tests pass, new tests cover cleanup-on-error behavior if needed
**Why it matters:** This is already-solved infrastructure duplication, and centralizing cleanup reduces the chance of future context-leak bugs in provider pull code.
**Tradeoff:** The refactor is small, but it touches subtle bookkeeping in a business-critical sync path, so regression coverage matters.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good safety gain by removing hand-managed context cleanup from a shared integration path.

### Task: Replace Manual Square Pull Context Handling with WithSyncContext
**Status:** proposed
**Files to change:** `src/services/squareSync.ts:L236-L384`, `src/services/tokenManagement.ts:L149-L226`
**What to do:** Refactor `pullSquareCustomer()` and `pullSquareBooking()` so their mutation work runs inside the shared `withSyncContext()` helper instead of manually calling `setSyncContext(...)` and `clearSyncContext(...)`. Keep the entity-specific SQL and logging behavior unchanged, but route the context lifecycle through the shared wrapper.
**Done when:**
- [ ] Square pull mutation flows no longer inline manual sync-context setup and teardown
- [ ] `withSyncContext()` is used for both customer and booking pull updates
- [ ] Existing provider-specific logging and data-mapping behavior stays unchanged
- [ ] All existing tests pass, new tests cover cleanup-on-error behavior if needed
**Why it matters:** This is already-solved infrastructure duplication, and centralizing cleanup reduces the chance of future context-leak bugs in provider pull code.
**Tradeoff:** The refactor is small, but it touches subtle bookkeeping in a business-critical sync path, so regression coverage matters.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good safety gain by removing hand-managed context cleanup from a shared integration path.

### Task: Add Cross-Provider Tests for Pull Bookkeeping Parity and Synced-Customer Prerequisites
**Status:** proposed
**Files to change:** `src/services/jobberSync.ts:L236-L452`, `src/services/hubspotSync.ts:L97-L357`, `src/services/servicetitanSync.ts:L152-L420`, service test files for these modules (new if needed)
**What to do:** Add focused tests that assert pull flows update sync-map timestamps/status consistently after already-synced, remote-newer, and local-newer branches, and that appointment/job push flows correctly resolve missing synced customers before creating remote appointments. Use a shared assertion helper so cross-provider parity is obvious in the test output.
**Done when:**
- [ ] Jobber, HubSpot, and ServiceTitan pull tests cover post-pull sync-map bookkeeping parity across main decision branches
- [ ] HubSpot and ServiceTitan push tests cover already-synced and sync-on-demand customer prerequisite branches
- [ ] Error-path tests verify failed provider calls do not leave incorrect sync-map state behind
- [ ] All existing tests pass, new tests lock cross-provider parity for these sync behaviors
**Why it matters:** These are exactly the sorts of subtle integration differences that create hard-to-diagnose production bugs, and explicit parity tests would make future changes much safer.
**Tradeoff:** The tests require fairly detailed DB and provider mocks, though the payoff is strong because the bugs here are quiet and expensive.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects subtle cross-provider sync behavior that is difficult to validate manually.

## Ideas — 2026-04-12 (developer experience reviewed)

### Task: Extract shared validation and not-found responders across shifts, mappings, and skills routes
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L21-L263`, `src/routes/mappings.ts:L1-L107`, `src/routes/skills.ts:L1-L60`, `src/middleware.ts:L1-L260`
**What to do:** Introduce a thin set of shared helpers for the repeated validation-failure responses, tenant-id requirement checks, and not-found mutation responses used across these setup-oriented route modules. Keep each route’s SQL and branching logic in place, but centralize the request/response scaffold so the handlers read more consistently.
**Done when:**
- [ ] Shifts, mappings, and skills routes no longer hand-roll the same validation and not-found response patterns independently
- [ ] Shared helpers cover only request/response scaffolding, not the domain SQL itself
- [ ] Success and failure payloads remain compatible but follow one clearer route convention
- [ ] All existing tests pass, new tests cover helper behavior where appropriate
**Why it matters:** These modules are small enough to feel easy now, but the repeated scaffolding already creates maintenance drag and makes parity drift harder to spot.
**Tradeoff:** The abstraction has to stay very small or it will make simple route handlers feel more indirect than helpful.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile maintainability gain by reducing low-value route boilerplate across several setup modules.

### Task: Centralize skill-name normalization with the same utility path used by other setup entities
**Status:** proposed
**Files to change:** `src/routes/skills.ts:L27-L42`, `src/services/nameUtils.ts:L1-L220`, `src/routes/services.ts:L1-L200`
**What to do:** Move the inline `toLowerCase().trim().replace(/\s+/g, '-')` normalization in the skills create route into a shared helper in `nameUtils.ts`, then align at least one comparable service-name normalization path to use the same utility. Keep the resulting stored value unchanged unless tests reveal a deliberate exception.
**Done when:**
- [ ] Skill creation no longer normalizes names inline in the route handler
- [ ] A shared helper in `nameUtils.ts` owns the slug-style normalization behavior
- [ ] At least one comparable service normalization path uses the same helper
- [ ] All existing tests pass, new tests cover spacing, casing, and special-character normalization behavior
**Why it matters:** String normalization drift is easy to miss, and putting it behind one tested helper reduces duplicated logic in setup routes.
**Tradeoff:** Requires a careful check that existing stored names and client expectations really match the extracted helper output.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, solid gain by removing a quiet source of normalization drift.

### Task: Add route tests for shift, mapping, and skill unhappy-path parity
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L21-L263`, `src/routes/mappings.ts:L1-L107`, `src/routes/skills.ts:L1-L60`, route test files for each module (new if needed)
**What to do:** Add focused tests that assert validation failures, missing-tenant guards, invalid-id handling, and not-found mutation responses across these three modules. Use a shared assertion style so response-shape drift shows up immediately when one route family starts behaving differently from the others.
**Done when:**
- [ ] Shifts routes are tested for validation and branch-specific unhappy paths
- [ ] Mapping routes are tested for invalid ids and tenant-scoped failure behavior
- [ ] Skills routes are tested for validation and delete not-found behavior
- [ ] All existing tests pass, new tests lock unhappy-path parity across the three modules
**Why it matters:** These routes support operational setup screens where small inconsistencies become repetitive UI edge cases, and parity tests are an efficient way to keep them aligned.
**Tradeoff:** Adds several similar tests, so shared fixtures and helpers will matter to keep the suite readable.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it prevents small setup-route inconsistencies from becoming repeated dashboard bugs.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit across the date boundary, and the current format continues to make repeated route-family work stay specific instead of collapsing into vague cleanup suggestions.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, bounded output with useful prioritization signals, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (integration workflow reviewed)

### Task: Replace manual Square pull context handling with withSyncContext
**Status:** proposed
**Files to change:** `src/services/squareSync.ts:L236-L384`, `src/services/tokenManagement.ts:L149-L226`
**What to do:** Refactor `pullSquareCustomer()` and `pullSquareBooking()` so their mutation work runs inside the shared `withSyncContext()` helper instead of manually calling `setSyncContext(...)` and `clearSyncContext(...)`. Keep the entity-specific SQL and logging behavior unchanged, but route the context lifecycle through the shared wrapper.
**Done when:**
- [ ] Square pull mutation flows no longer inline manual sync-context setup and teardown
- [ ] `withSyncContext()` is used for both customer and booking pull updates
- [ ] Existing provider-specific logging and data-mapping behavior stays unchanged
- [ ] All existing tests pass, new tests cover cleanup-on-error behavior if needed
**Why it matters:** This is already-solved infrastructure duplication, and centralizing cleanup reduces the chance of future context-leak bugs in provider pull code.
**Tradeoff:** The refactor is small, but it touches subtle bookkeeping in a business-critical sync path, so regression coverage matters.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good safety gain by removing hand-managed context cleanup from a shared integration path.

### Task: Extract shared Square pull sync-map bookkeeping helper
**Status:** proposed
**Files to change:** `src/services/squareSync.ts:L279-L384`
**What to do:** Move the repeated `entity_sync_map` insert/update statements used after Square customer and booking pulls into a small helper that accepts entity type, local id, external id, and `remote_updated_at`, then handles the insert-or-update bookkeeping write. Keep the local entity insert/update logic in place, but centralize sync-map persistence so the customer and appointment pull flows stop maintaining parallel SQL.
**Done when:**
- [ ] Square customer and booking pull flows no longer inline duplicate sync-map insert/update statements
- [ ] One helper handles post-pull sync-map persistence for both entity types
- [ ] Existing `remote_updated_at`, `last_synced_at`, and `sync_status` behavior remains unchanged
- [ ] All existing tests pass, new tests cover the shared pull sync-map helper behavior
**Why it matters:** This is repeated bookkeeping inside a dense sync module, and consolidating it lowers maintenance cost without changing business behavior.
**Tradeoff:** The helper must stay narrow so it does not blur the real import logic around it.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile maintainability gain in a repetitive provider sync module.

### Task: Add service tests for Square pull branch parity and cleanup behavior
**Status:** proposed
**Files to change:** `src/services/squareSync.ts:L236-L452`, `src/services/squareSync.test.ts:L1-L320` (new if needed)
**What to do:** Add focused tests that verify Square customer/booking pulls handle already-synced, remote-newer, and no-local-match branches correctly, and that sync context is always cleared even when a DB write throws. Mock the provider payloads and DB client so the tests assert both data writes and cleanup behavior without live Square access.
**Done when:**
- [ ] Square pull tests cover already-synced, remote-newer, and local-create paths for customers and bookings
- [ ] At least one failure-path test proves sync context cleanup still runs after an exception
- [ ] Sync-map persistence side effects are asserted explicitly for both entity types
- [ ] All existing tests pass, new tests lock the pull-branch and cleanup behavior
**Why it matters:** These branches are quiet but business-critical, and explicit tests would make future provider sync changes much safer.
**Tradeoff:** The tests require careful DB/client mocking, though the payoff is strong because the logic is subtle and not easy to validate manually.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it secures nuanced pull-sync behavior and cleanup guarantees.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit after the filename-case change, and the current format continues to make quick infrastructure cleanups stand out from broader refactor work.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output without much wasted motion, so there is no obvious tweak worth making right now.

## Ideas — 2026-04-12 (architecture reviewed)

### Task: Extract shared date and tenant query parsing for analytics coverage endpoints
**Status:** proposed
**Files to change:** `src/routes/analytics.ts:L15-L43`, `src/middleware.ts:L1-L260` (or new `src/routes/queryParsers.ts`), `src/routes/calendar.ts:L1-L220`
**What to do:** Move the `/coverage` route’s inline date regex, fallback logic, and tenant-scoped query parsing into a shared helper that also matches the calendar route’s date-range parsing conventions. Keep the analytics SQL in place, but make date validation and default handling come from one typed parser used by both scheduler-adjacent route families.
**Done when:**
- [ ] Analytics coverage route no longer defines date regex and fallback logic inline
- [ ] Shared date-range parsing is reusable by both analytics and calendar route code
- [ ] Invalid or missing date params follow one consistent parsing policy
- [ ] All existing tests pass, new tests cover the shared date parser behavior
**Why it matters:** Date handling is easy to let drift across scheduling endpoints, and one parser reduces duplicate logic in routes that should agree on time-window behavior.
**Tradeoff:** The helper needs to stay narrow so it improves consistency without turning simple handlers into indirection puzzles.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain in scheduling-adjacent route parsing.

### Task: Fix employee update tenant scoping and zero-row mutation handling
**Status:** proposed
**Files to change:** `src/routes/employees.ts:L90-L123`, `src/middleware.ts:L1-L260`, `src/routes/employees.test.ts:L1-L320` (new if needed)
**What to do:** Update the employee update query so it scopes by both `id` and `tenant_id`, then return a 404-style failure when no row is updated. Keep the existing payload shape for successful updates, but stop allowing cross-tenant or missing-record updates to fall through as implicit success with an undefined employee payload.
**Done when:**
- [ ] Employee update query filters on both employee id and tenant id
- [ ] Zero-row employee updates return a not-found response instead of `success: true`
- [ ] Successful updates preserve the current response payload shape
- [ ] All existing tests pass, new tests cover out-of-scope and missing-record update cases
**Why it matters:** This is a real data-safety edge in a core admin flow, and tightening it removes a subtle cross-tenant mutation risk while making the API contract more honest.
**Tradeoff:** The stricter behavior may expose frontend code that assumed update success without checking for missing targets, so regression tests are important.
**Size:** small (< 1hr)
**Impact:** high
**Effort vs Gain:** Low effort, high gain because it closes a real tenant-safety gap in a core admin route.

### Task: Add parity tests for analytics feedback reads and employee mutation guards
**Status:** proposed
**Files to change:** `src/routes/analytics.ts:L97-L175`, `src/routes/employees.ts:L49-L123`, route test files for both modules (new if needed)
**What to do:** Add focused tests that verify feedback list behavior for super-admin versus tenant-scoped reads, coverage date-param fallback behavior, and employee update/delete not-found handling. Use a shared assertion style so payload drift across these operator-facing endpoints is obvious in the test output.
**Done when:**
- [ ] Analytics feedback endpoints are tested for tenant-scoped and super-admin read behavior
- [ ] Analytics coverage route is tested for valid and fallback date-param handling
- [ ] Employee update and delete routes are tested for missing-record and wrong-tenant outcomes
- [ ] All existing tests pass, new tests lock the operator-facing contract behavior
**Why it matters:** These routes support visible management screens, and explicit parity tests make subtle access-control or contract drift much easier to catch.
**Tradeoff:** Requires a bit more multi-tenant fixture setup, though the coverage value is strong because these paths affect day-to-day operations.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects visible operator routes from subtle contract and scoping drift.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format continues to surface concrete route-level issues instead of repeating broad generic refactor themes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (architecture reviewed)

### Task: Extract shared tenant-scoped collection route helpers for calendar, resources, and services
**Status:** proposed
**Files to change:** `src/routes/calendar.ts:L12-L120`, `src/routes/resources.ts:L35-L126`, `src/routes/services.ts:L25-L53`, `src/middleware.ts:L1-L260` (or new `src/routes/collectionHelpers.ts`)
**What to do:** Pull the repeated tenant-id resolution, limit/offset parsing, and tenant-scoped query wrapper patterns used by these list-style route modules into a small helper layer. Keep each route’s SQL domain-specific, but centralize the scaffolding that decides tenant scope, validates common query params, and returns the query result consistently.
**Done when:**
- [ ] Calendar, resources, and services list handlers no longer inline the same tenant/query scaffolding independently
- [ ] Shared helpers handle common pagination and tenant resolution without changing route-specific result shapes
- [ ] Route SQL stays local to each module instead of being over-generalized
- [ ] All existing tests pass, new tests cover the shared collection helper behavior
**Why it matters:** These are foundational dashboard reads, and reducing repeated scaffolding lowers maintenance overhead while making route parity easier to spot.
**Tradeoff:** The helper needs to stay thin so it improves consistency without obscuring straightforward route logic.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile maintainability gain across several core collection routes.

### Task: Add zero-row mutation guards for resources and services update-delete paths
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L59-L154`, `src/routes/services.ts:L55-L116`, `src/routes/routeHelpers.ts:L1-L220`
**What to do:** Update the resource and service mutation handlers so they check whether `UPDATE ... RETURNING` or `DELETE` statements actually affected a row, then return a not-found-style failure when the target record is missing or out of scope. Reuse the existing `assertRowAffected` helper or extend it consistently so the mutation routes stop reporting success after silent no-op operations.
**Done when:**
- [ ] Resource and service update routes no longer return `success: true` when no row was updated
- [ ] Resource and service delete routes detect missing targets before returning success
- [ ] Not-found responses follow one consistent payload pattern across both modules
- [ ] All existing tests pass, new tests cover zero-row update and delete outcomes
**Why it matters:** Silent mutation success is a subtle but costly backend behavior, especially in setup flows where operators expect a clear signal that a real entity changed.
**Tradeoff:** Tightening these contracts may expose frontend assumptions that were relying on optimistic success, so good regression coverage matters.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain by making setup mutations more trustworthy and consistent.

### Task: Add route tests for collection and mutation parity across calendar, resources, and services
**Status:** proposed
**Files to change:** `src/routes/calendar.ts:L12-L220`, `src/routes/resources.ts:L35-L154`, `src/routes/services.ts:L25-L116`, route test files for each module (new if needed)
**What to do:** Add focused tests that assert tenant scoping, pagination behavior where applicable, and zero-row update/delete handling across these three route groups. Use one shared assertion style so parity issues in success and failure payloads show up clearly in the test output.
**Done when:**
- [ ] Calendar collection routes are tested for tenant scope and query-param handling
- [ ] Resources and services routes are tested for list behavior plus update/delete not-found outcomes
- [ ] Success and failure payload shapes are asserted consistently across the three modules
- [ ] All existing tests pass, new tests lock the parity contract
**Why it matters:** These routes support core schedule and setup surfaces, and explicit parity tests are the fastest way to catch drift before it leaks into the dashboard.
**Tradeoff:** Adds some repetitive fixture setup, though shared helpers can keep the suite readable.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects multiple core route families from subtle contract drift.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to surface concrete route-level work instead of recycling broad refactor themes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (integration workflow reviewed)

### Task: Extract shared OAuth state-token helper for Google and Outlook calendar services
**Status:** proposed
**Files to change:** `src/services/googleCalendar.ts:L32-L63`, `src/services/outlookCalendar.ts:L34-L65`, `src/services/tokenManagement.ts:L1-L320` (or new `src/services/oauthState.ts`)
**What to do:** Move the duplicated JWT state-signing and verification logic out of the Google and Outlook calendar service modules into one shared helper that accepts the provider purpose string and tenant id. Keep each service responsible for provider-specific auth URLs and token exchange, but stop repeating nearly identical OAuth state handling in both files.
**Done when:**
- [ ] Google and Outlook calendar services no longer inline their own JWT state creation and verification logic
- [ ] One shared helper owns state signing, verification, expiry handling, and purpose validation
- [ ] Provider-specific auth URL generation still stays inside each calendar service module
- [ ] All existing tests pass, new tests cover valid, expired, and wrong-purpose state tokens
**Why it matters:** This is clear duplication in a security-sensitive path, and centralizing it reduces the chance of the two calendar integrations drifting on CSRF-state behavior.
**Tradeoff:** The helper has to stay narrowly scoped to OAuth state handling so it does not become a generic auth catch-all.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain in a security-sensitive shared flow.

### Task: Extract shared token-refresh response normalization for Google and Outlook calendar services
**Status:** proposed
**Files to change:** `src/services/googleCalendar.ts:L92-L120`, `src/services/outlookCalendar.ts:L108-L156`, `src/services/tokenManagement.ts:L1-L320` (or new `src/services/calendarRefreshNormalization.ts`)
**What to do:** Move the parallel refresh-response handling in the Google and Outlook calendar service modules into one helper that normalizes provider refresh results into `{ access_token, expiry_date }` and applies consistent error phrasing. Keep provider-specific HTTP/token exchange logic in each service, but centralize the post-refresh normalization path.
**Done when:**
- [ ] Google and Outlook calendar services no longer inline similar refresh-response normalization logic
- [ ] One helper returns a consistent normalized token-refresh shape for both providers
- [ ] Provider-specific HTTP/token exchange logic remains inside each calendar service
- [ ] All existing tests pass, new tests cover normalized refresh success and failure cases
**Why it matters:** Calendar refresh handling is duplicated in two security-sensitive modules, and centralizing the normalization step reduces drift without over-abstracting provider APIs.
**Tradeoff:** The shared helper must stay narrowly scoped to response normalization so the provider modules remain easy to inspect.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain in a token-handling path where subtle drift is costly.

### Task: Add shared-service tests for calendar OAuth state handling and refresh normalization parity
**Status:** proposed
**Files to change:** `src/services/googleCalendar.ts:L1-L220`, `src/services/outlookCalendar.ts:L1-L260`, service test files for these modules (new if needed)
**What to do:** Add focused tests that verify Google and Outlook state-token generation/verification use the same expiry and purpose semantics, and that refresh success/failure normalize into the same shape and messaging expectations. Mock provider HTTP calls so the tests assert shared behavior without hitting real Google or Microsoft endpoints.
**Done when:**
- [ ] Google and Outlook tests cover valid, expired, and wrong-purpose OAuth state tokens
- [ ] Google and Outlook tests cover refresh success and refresh-failure normalization behavior
- [ ] Shared behavior expectations are asserted in the same style for both providers
- [ ] All existing tests pass, new tests lock parity for calendar auth and refresh handling
**Why it matters:** These calendar services are parallel integrations, and explicit parity tests make it much easier to catch subtle auth-flow drift before it reaches users.
**Tradeoff:** The tests require provider mock setup, though the payoff is strong because the behavior is shared and security-sensitive.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it secures shared calendar auth behavior that would be painful to debug live.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is helping repeated integration work stay concrete instead of collapsing into vague cleanup suggestions.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, bounded output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (code patterns reviewed)

### Task: Extract shared integration-settings persistence helper from OAuth callback completion
**Status:** proposed
**Files to change:** `src/services/oauthCallbackFactory.ts:L74-L107`, `src/services/tokenManagement.ts:L1-L320` (or new `src/services/integrationSettingsStore.ts`)
**What to do:** Move the duplicated `tenant_integration_settings` insert-or-update SQL branches out of `createOAuthCallbackHandler` into a small helper that accepts provider, tenant id, token set, and optional settings payload. Keep redirect handling and provider-specific token exchange inside the callback factory, but centralize the persistence step so integrations all complete OAuth through one write path.
**Done when:**
- [ ] OAuth callback completion no longer contains two inline SQL upsert branches for integration settings
- [ ] One shared helper handles token persistence with and without extra settings payloads
- [ ] Existing redirect and logging behavior remains unchanged for successful and failed callbacks
- [ ] All existing tests pass, new tests cover the shared upsert helper behavior
**Why it matters:** This is a sensitive, cross-provider completion path, and centralizing the DB write reduces duplicated SQL in code that should stay boring and predictable.
**Tradeoff:** The helper boundary has to remain tightly scoped to persistence so the callback factory still reads clearly end-to-end.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good maintainability gain in a shared integration entry point.

### Task: Unify token-refresh log prefix generation across integration and calendar helpers
**Status:** proposed
**Files to change:** `src/services/tokenManagement.ts:L41-L127`, `src/services/tokenManagement.ts:L227-L304`, `src/services/syncOrchestrator.ts:L1-L66`
**What to do:** Refactor the calendar token refresh helper to use the same `syncCtx()`-style prefix builder pattern already used by integration token refreshes, or extend `syncCtx()` to cover calendar providers explicitly. Keep existing log content, but stop maintaining parallel prefix-building conventions inside the same shared token module.
**Done when:**
- [ ] Integration and calendar token refresh helpers build their log prefixes through one shared path
- [ ] Provider and tenant identifiers remain visible in all refresh success/failure logs
- [ ] Existing refresh behavior and error handling stay unchanged
- [ ] All existing tests pass, new tests cover the shared prefix helper if added
**Why it matters:** Shared infrastructure logs are much easier to read and grep when they follow one predictable format, especially during sync incidents.
**Tradeoff:** This is mostly a maintainability cleanup, so the implementation should stay small and avoid over-designing the logger interface.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain through more consistent observability in shared sync utilities.

### Task: Add shared-service tests for OAuth callback persistence and token-refresh race protection
**Status:** proposed
**Files to change:** `src/services/oauthCallbackFactory.ts:L48-L118`, `src/services/tokenManagement.ts:L68-L340`, service test files for these modules (new if needed)
**What to do:** Add focused tests that verify OAuth callback persistence with and without extra settings, token refresh deactivation on failure, and the row-locking refresh path when a token is near expiry. Mock the pool/client interactions so the tests assert SQL-side effects and returned values without hitting real providers.
**Done when:**
- [ ] OAuth callback factory is tested for successful persistence and token-exchange failure redirects
- [ ] Token-management tests cover refresh success, refresh failure marking inactive, and no-refresh-needed branches
- [ ] Tests assert that the shared row-locking flow preserves the current inactive-on-failure behavior
- [ ] All existing tests pass, new tests lock the integration-service contract
**Why it matters:** These services sit under multiple integrations, so a single regression here can quietly break several provider flows at once.
**Tradeoff:** The tests will require detailed pool/client mocks, though the coverage payoff is strong because these are shared infrastructure utilities.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it secures low-level shared integration behavior used across providers.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to make shared-service ideas stay concrete instead of drifting into vague abstraction-for-its-own-sake.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, bounded output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (backend workflow reviewed)

### Task: Align analytics, voice, and communications read endpoints on one explicit response-envelope policy
**Status:** proposed
**Files to change:** `src/routes/analytics.ts:L11-L175`, `src/routes/voice.ts:L44-L370`, `src/routes/communications.ts:L78-L251`, `src/middleware.ts:L1-L260`
**What to do:** Decide on one explicit contract for lightweight read endpoints in this operator-facing surface, either raw row arrays/objects or `{ success: true, ... }` envelopes, then update analytics read endpoints, voice read endpoints, and communications read endpoints to follow it consistently. Preserve their domain fields, but remove the current mix of top-level response shapes.
**Done when:**
- [ ] Analytics, voice read endpoints, and communications read endpoints follow one documented response-envelope convention
- [ ] Any exceptions are intentional and documented in code comments or helper usage
- [ ] Dashboard consumers can rely on predictable top-level response shapes across this route family
- [ ] All existing tests pass, new tests cover the normalized read-endpoint contract
**Why it matters:** These endpoints feed visible operator screens, and inconsistent envelopes create unnecessary frontend branching in otherwise simple reads.
**Tradeoff:** Must be checked against current dashboard callers so the cleanup does not introduce accidental breakage.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile consistency gain across frequently used read endpoints.

### Task: Extract shared validation-failure responders for voice and communications mutation routes
**Status:** proposed
**Files to change:** `src/routes/voice.ts:L44-L370`, `src/routes/communications.ts:L78-L250`, `src/middleware.ts:L1-L260`
**What to do:** Introduce a tiny helper for common Zod validation failure responses so voice and communications mutation handlers stop rebuilding the same `{ success: false, error: 'Validation failed', details }` branches inline. Keep schema definitions local to each route module, but route parse failures through one shared responder.
**Done when:**
- [ ] Voice and communications mutation handlers no longer hand-roll duplicate validation-failure payloads
- [ ] The shared helper preserves the current status code and error-body shape
- [ ] Route-local schemas remain readable and unchanged in scope
- [ ] All existing tests pass, new tests cover the shared validation responder if added
**Why it matters:** This repeated boilerplate appears in route modules that already have a lot of branching, and centralizing it makes parity easier to maintain.
**Tradeoff:** The helper must stay tiny so it does not hide simple route flow behind unnecessary abstraction.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain through cleaner and more consistent route code.

### Task: Add parity tests for analytics, voice, and communications read/write contracts
**Status:** proposed
**Files to change:** `src/routes/analytics.ts:L11-L175`, `src/routes/voice.ts:L44-L370`, `src/routes/communications.ts:L78-L250`, route test files for these modules (new if needed)
**What to do:** Add focused tests that assert response shapes for analytics coverage/feedback reads, voice active/history/context reads, and communications history/consent reads, plus validation failure behavior for representative voice and communications mutation endpoints. Use a shared assertion style so contract drift across the three route families is obvious in test output.
**Done when:**
- [ ] Analytics read endpoints are tested for their expected response shapes and access branches
- [ ] Voice read endpoints are tested for expected envelopes and not-found behavior
- [ ] Communications read endpoints and representative mutation validation failures are tested for contract parity
- [ ] All existing tests pass, new tests lock response-shape consistency across the route family
**Why it matters:** These endpoints are operator-facing and lightly structured, which makes them prone to quiet contract drift unless tests pin them down.
**Tradeoff:** The tests will need some repetitive fixture setup, though shared helpers can keep the suite readable.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because explicit contract tests prevent small route inconsistencies from leaking into the dashboard.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still easy to audit, and the current format is helping repeated route-family work stay specific instead of collapsing into vague cleanup suggestions.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, bounded output with useful prioritization signals, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (developer experience reviewed)

### Task: Extract shared validation and not-found responders across shifts, mappings, and skills routes
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L1-L263`, `src/routes/mappings.ts:L1-L107`, `src/routes/skills.ts:L1-L60`, `src/middleware.ts:L1-L260`
**What to do:** Introduce a thin set of shared helpers for the repeated validation-failure responses, tenant-id requirement checks, and not-found mutation responses used across these setup-oriented route modules. Keep each route’s SQL and branching logic in place, but centralize the request/response scaffold so the handlers read more consistently.
**Done when:**
- [ ] Shifts, mappings, and skills routes no longer hand-roll the same validation and not-found response patterns independently
- [ ] Shared helpers cover only request/response scaffolding, not the domain SQL itself
- [ ] Success and failure payloads remain compatible but follow one clearer route convention
- [ ] All existing tests pass, new tests cover helper behavior where appropriate
**Why it matters:** These modules are small enough to feel easy now, but the repeated scaffolding already creates maintenance drag and makes parity drift harder to spot.
**Tradeoff:** The abstraction has to stay very small or it will make simple route handlers feel more indirect than helpful.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile maintainability gain by reducing low-value route boilerplate across several setup modules.

### Task: Centralize skill-name normalization with the same utility path used by other setup entities
**Status:** proposed
**Files to change:** `src/routes/skills.ts:L27-L42`, `src/services/nameUtils.ts:L1-L220`, `src/routes/services.ts:L1-L200`
**What to do:** Move the inline `toLowerCase().trim().replace(/\s+/g, '-')` normalization in the skills create route into a shared helper in `nameUtils.ts`, then align at least one comparable service-name normalization path to use the same utility. Keep the resulting stored value unchanged unless tests reveal a deliberate exception.
**Done when:**
- [ ] Skill creation no longer normalizes names inline in the route handler
- [ ] A shared helper in `nameUtils.ts` owns the slug-style normalization behavior
- [ ] At least one comparable service normalization path uses the same helper
- [ ] All existing tests pass, new tests cover spacing, casing, and special-character normalization behavior
**Why it matters:** String normalization drift is easy to miss, and putting it behind one tested helper reduces duplicated logic in setup routes.
**Tradeoff:** Requires a careful check that existing stored names and client expectations really match the extracted helper output.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, solid gain by removing a quiet source of normalization drift.

### Task: Add route tests for shift, mapping, and skill unhappy-path parity
**Status:** proposed
**Files to change:** `src/routes/shifts.ts:L1-L263`, `src/routes/mappings.ts:L1-L107`, `src/routes/skills.ts:L1-L60`, route test files for each module (new if needed)
**What to do:** Add focused tests that assert validation failures, missing-tenant guards, invalid-id handling, and not-found mutation responses across these three modules. Use a shared assertion style so response-shape drift shows up immediately when one route family starts behaving differently from the others.
**Done when:**
- [ ] Shifts routes are tested for validation and branch-specific unhappy paths
- [ ] Mapping routes are tested for invalid ids and tenant-scoped failure behavior
- [ ] Skills routes are tested for validation and delete not-found behavior
- [ ] All existing tests pass, new tests lock unhappy-path parity across the three modules
**Why it matters:** These routes support operational setup screens where small inconsistencies become repetitive UI edge cases, and parity tests are an efficient way to keep them aligned.
**Tradeoff:** Adds several similar tests, so shared fixtures and helpers will matter to keep the suite readable.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it prevents small setup-route inconsistencies from becoming repeated dashboard bugs.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to surface concrete route-level work instead of recycling broad generic refactor themes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to surface concrete route-level work instead of recycling broad refactor themes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (platform contract review)

### Task: Extract shared tenant bootstrap helper across auth register and admin tenant create flows
**Status:** proposed
**Files to change:** `src/routes/auth.ts:L56-L115`, `src/routes/tenants.ts:L119-L167`, `src/middleware.ts:L1-L260` (or new `src/services/accountBootstrap.ts`)
**What to do:** Move the duplicated tenant-plus-owner creation transaction out of `/register` and `/tenants/create` into one helper that accepts business info, owner info, and password, then handles duplicate checks, tenant insert, password hashing, user insert, and transaction control. Preserve each route’s endpoint contract and auth posture, but stop maintaining two near-parallel bootstrap flows.
**Done when:**
- [ ] Auth register and admin tenant create no longer inline the full tenant/user bootstrap transaction separately
- [ ] Shared helper owns duplicate detection, password hashing, and transaction control
- [ ] Route-specific response payloads remain unchanged for public register versus admin create
- [ ] All existing tests pass, new tests cover the shared bootstrap helper success and conflict cases
**Why it matters:** These two routes create the same core records with slightly different inputs, and centralizing that workflow reduces duplication in a sensitive account-creation path.
**Tradeoff:** The helper needs to stay explicit about the small differences between self-serve registration and admin provisioning so the abstraction does not hide policy decisions.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it removes duplicated transactional logic from foundational account-creation flows.

### Task: Normalize provisioning prerequisite failure envelopes with auth and billing routes
**Status:** proposed
**Files to change:** `src/routes/provisioning.ts:L31-L136`, `src/routes/auth.ts:L24-L129`, `src/routes/billing.ts:L18-L172`, `src/middleware.ts:L1-L260`
**What to do:** Update provisioning prerequisite, conflict, and downstream-failure branches so they consistently include `success: false` and align with the broader platform-route error envelope used by auth and billing. Preserve the useful extra fields like `missing_fields`, `tenant_name`, `current_status`, and rollback metadata, but make the top-level failure contract predictable.
**Done when:**
- [ ] Provisioning prerequisite, conflict, and upstream-failure responses include a consistent `success: false` top-level envelope
- [ ] Helpful metadata fields like `missing_fields`, `current_status`, and `rolled_back` remain intact
- [ ] Auth, billing, and provisioning platform failures follow one clearer envelope convention
- [ ] All existing tests pass, new tests cover the normalized provisioning error contracts
**Why it matters:** These are high-visibility admin flows, and inconsistent top-level error shapes create avoidable client branching in exactly the parts of the app that should feel most predictable.
**Tradeoff:** Must be checked against current dashboard callers so envelope cleanup does not create accidental regressions.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain in a business-critical route family.

### Task: Add route tests for auth, tenant admin, and provisioning contract parity
**Status:** proposed
**Files to change:** `src/routes/auth.ts:L24-L129`, `src/routes/tenants.ts:L50-L220`, `src/routes/provisioning.ts:L22-L213`, route test files for these modules (new if needed)
**What to do:** Add focused tests that assert response shapes and failure behavior for login, register, tenant create/delete/update, provisioning prerequisite failures, provisioning conflict states, and provisioning status/not-found branches. Use a shared assertion style so contract drift across these platform routes is obvious when a handler returns a raw row unexpectedly or omits `success` on failure.
**Done when:**
- [ ] Auth routes are tested for success, validation, and conflict/failure payload shapes
- [ ] Tenant admin routes are tested for create conflicts and zero-row delete/update behavior
- [ ] Provisioning routes are tested for prerequisite failures, conflict states, and status not-found behavior
- [ ] All existing tests pass, new tests lock platform contract parity behavior
**Why it matters:** These routes define core account and admin behavior, and explicit contract tests are the safest way to prevent subtle API drift from leaking into dashboard setup and provisioning flows.
**Tradeoff:** The tests will need broader fixture coverage across public, authenticated, and config-dependent paths, though the payoff is strong because these are foundational endpoints.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects foundational route contracts other admin surfaces depend on.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to surface concrete contract cleanup work instead of broad repetitive refactor themes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to surface concrete route-level work instead of broad repetitive refactor themes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to make shared-service ideas stay concrete instead of drifting into vague abstraction-for-its-own-sake.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, bounded output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (integration workflow reviewed)

### Task: Extract shared OAuth state-token helper for Google and Outlook calendar services
**Status:** proposed
**Files to change:** `src/services/googleCalendar.ts:L32-L63`, `src/services/outlookCalendar.ts:L39-L70`, `src/services/tokenManagement.ts:L1-L320` (or new `src/services/oauthState.ts`)
**What to do:** Move the duplicated JWT state-signing and verification logic out of the Google and Outlook calendar service modules into one shared helper that accepts the provider purpose string and tenant id. Keep each service responsible for provider-specific auth URLs and token exchange, but stop repeating nearly identical OAuth state handling in both files.
**Done when:**
- [ ] Google and Outlook calendar services no longer inline their own JWT state creation and verification logic
- [ ] One shared helper owns state signing, verification, expiry handling, and purpose validation
- [ ] Provider-specific auth URL generation still stays inside each calendar service module
- [ ] All existing tests pass, new tests cover valid, expired, and wrong-purpose state tokens
**Why it matters:** This is clear duplication in a security-sensitive path, and centralizing it reduces the chance of the two calendar integrations drifting on CSRF-state behavior.
**Tradeoff:** The helper has to stay narrowly scoped to OAuth state handling so it does not become a generic auth catch-all.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain in a security-sensitive shared flow.

### Task: Extract shared token-refresh response normalization for Google and Outlook calendar services
**Status:** proposed
**Files to change:** `src/services/googleCalendar.ts:L92-L120`, `src/services/outlookCalendar.ts:L108-L156`, `src/services/tokenManagement.ts:L1-L320` (or new `src/services/calendarRefreshNormalization.ts`)
**What to do:** Move the parallel refresh-response handling in the Google and Outlook calendar service modules into one helper that normalizes provider refresh results into `{ access_token, expiry_date }` and applies consistent error phrasing. Keep provider-specific HTTP/token exchange logic in each service, but centralize the post-refresh normalization path.
**Done when:**
- [ ] Google and Outlook calendar services no longer inline similar refresh-response normalization logic
- [ ] One helper returns a consistent normalized token-refresh shape for both providers
- [ ] Provider-specific HTTP/token exchange logic remains inside each calendar service
- [ ] All existing tests pass, new tests cover normalized refresh success and failure cases
**Why it matters:** Calendar refresh handling is duplicated in two security-sensitive modules, and centralizing the normalization step reduces drift without over-abstracting provider APIs.
**Tradeoff:** The shared helper must stay narrowly scoped to response normalization so the provider modules remain easy to inspect.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain in a token-handling path where subtle drift is costly.

### Task: Add shared-service tests for calendar OAuth state handling and refresh normalization parity
**Status:** proposed
**Files to change:** `src/services/googleCalendar.ts:L1-L220`, `src/services/outlookCalendar.ts:L1-L260`, service test files for these modules (new if needed)
**What to do:** Add focused tests that verify Google and Outlook state-token generation/verification use the same expiry and purpose semantics, and that refresh success/failure normalize into the same shape and messaging expectations. Mock provider HTTP calls so the tests assert shared behavior without hitting real Google or Microsoft endpoints.
**Done when:**
- [ ] Google and Outlook tests cover valid, expired, and wrong-purpose OAuth state tokens
- [ ] Google and Outlook tests cover refresh success and refresh-failure normalization behavior
- [ ] Shared behavior expectations are asserted in the same style for both providers
- [ ] All existing tests pass, new tests lock parity for calendar auth and refresh handling
**Why it matters:** These calendar services are parallel integrations, and explicit parity tests make it much easier to catch subtle auth-flow drift before it reaches users.
**Tradeoff:** The tests require provider mock setup, though the payoff is strong because the behavior is shared and security-sensitive.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it secures shared calendar auth behavior that would be painful to debug live.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to make repeated integration work stay concrete instead of collapsing into vague cleanup suggestions.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, bounded output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still easy to audit, and the current format is helping repeated route-family work stay specific instead of collapsing into vague cleanup suggestions.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, bounded output with useful prioritization signals, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (platform contract review)

### Task: Extract shared tenant bootstrap helper across auth register and admin tenant create flows
**Status:** proposed
**Files to change:** `src/routes/auth.ts:L56-L115`, `src/routes/tenants.ts:L119-L167`, `src/middleware.ts:L1-L260` (or new `src/services/accountBootstrap.ts`)
**What to do:** Move the duplicated tenant-plus-owner creation transaction out of `/register` and `/tenants/create` into one helper that accepts business info, owner info, and password, then handles duplicate checks, tenant insert, password hashing, user insert, and transaction control. Preserve each route’s endpoint contract and auth posture, but stop maintaining two near-parallel bootstrap flows.
**Done when:**
- [ ] Auth register and admin tenant create no longer inline the full tenant/user bootstrap transaction separately
- [ ] Shared helper owns duplicate detection, password hashing, and transaction control
- [ ] Route-specific response payloads remain unchanged for public register versus admin create
- [ ] All existing tests pass, new tests cover the shared bootstrap helper success and conflict cases
**Why it matters:** These two routes create the same core records with slightly different inputs, and centralizing that workflow reduces duplication in a sensitive account-creation path.
**Tradeoff:** The helper needs to stay explicit about the small differences between self-serve registration and admin provisioning so the abstraction does not hide policy decisions.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it removes duplicated transactional logic from foundational account-creation flows.

### Task: Normalize billing and provisioning status envelopes with auth-style platform contracts
**Status:** proposed
**Files to change:** `src/routes/billing.ts:L162-L175`, `src/routes/provisioning.ts:L188-L214`, `src/routes/auth.ts:L24-L129`, `src/middleware.ts:L1-L260`
**What to do:** Update the billing and provisioning status endpoints so they return the same top-level success envelope pattern used by the rest of the platform-route family, while preserving their existing domain fields. Keep tenant-not-found behavior explicit, but remove the current raw-row response shape mismatch across these admin surfaces.
**Done when:**
- [ ] Billing and provisioning status endpoints return a consistent `{ success: true, ... }` style envelope
- [ ] Tenant-not-found failures remain explicit and consistent with sibling platform routes
- [ ] Existing domain fields like subscription status, plan, and phone state remain intact inside the envelope
- [ ] All existing tests pass, new tests cover the normalized status contracts
**Why it matters:** These endpoints back high-visibility admin status surfaces, and consistent envelopes reduce client branching in the parts of the app that should feel most predictable.
**Tradeoff:** Must be checked against current dashboard callers so the envelope cleanup does not introduce accidental regressions.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain in a business-critical route family.

### Task: Add route tests for auth, tenant admin, billing, and provisioning contract parity
**Status:** proposed
**Files to change:** `src/routes/auth.ts:L24-L129`, `src/routes/tenants.ts:L50-L220`, `src/routes/billing.ts:L18-L175`, `src/routes/provisioning.ts:L22-L214`, route test files for these modules (new if needed)
**What to do:** Add focused tests that assert response shapes and failure behavior for login, register, tenant create/delete/update, billing configuration failures, billing/provisioning status responses, provisioning prerequisite failures, and provisioning conflict states. Use a shared assertion style so contract drift across these platform routes is obvious when a handler returns a raw row unexpectedly or omits `success` on failure.
**Done when:**
- [ ] Auth routes are tested for success, validation, and conflict/failure payload shapes
- [ ] Tenant admin routes are tested for create conflicts and zero-row delete/update behavior
- [ ] Billing and provisioning routes are tested for status envelopes and representative failure branches
- [ ] All existing tests pass, new tests lock platform contract parity behavior
**Why it matters:** These routes define core account and admin behavior, and explicit contract tests are the safest way to prevent subtle API drift from leaking into dashboard setup and billing/provisioning flows.
**Tradeoff:** The tests will need broader fixture coverage across public, authenticated, and config-dependent paths, though the payoff is strong because these are foundational endpoints.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects foundational route contracts other admin surfaces depend on.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to surface concrete contract cleanup work instead of broad repetitive refactor themes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (integration workflow reviewed)

### Task: Replace manual ServiceTitan pull context handling with withSyncContext
**Status:** proposed
**Files to change:** `src/services/servicetitanSync.ts:L250-L420`, `src/services/tokenManagement.ts:L149-L226`
**What to do:** Refactor `pullServiceTitanCustomer()` and `pullServiceTitanJob()` so their mutation work runs inside the shared `withSyncContext()` helper instead of manually calling `setSyncContext(...)` and `clearSyncContext(...)`. Keep the entity-specific SQL and logging behavior unchanged, but route the context lifecycle through the shared wrapper.
**Done when:**
- [ ] ServiceTitan pull mutation flows no longer inline manual sync-context setup and teardown
- [ ] `withSyncContext()` is used for both customer and job pull updates
- [ ] Existing provider-specific logging and data-mapping behavior stays unchanged
- [ ] All existing tests pass, new tests cover cleanup-on-error behavior if needed
**Why it matters:** This is already-solved infrastructure duplication, and centralizing cleanup reduces the chance of future context-leak bugs in provider pull code.
**Tradeoff:** The refactor is small, but it touches subtle bookkeeping in a business-critical sync path, so regression coverage matters.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good safety gain by removing hand-managed context cleanup from a shared integration path.

### Task: Extract shared ServiceTitan pull sync-map bookkeeping helper
**Status:** proposed
**Files to change:** `src/services/servicetitanSync.ts:L286-L415`
**What to do:** Move the repeated `entity_sync_map` insert/update statements used after ServiceTitan customer and job pulls into a small helper that accepts entity type, local id, external id, and `remote_updated_at`, then handles the insert-or-update bookkeeping write. Keep the local entity insert/update logic in place, but centralize sync-map persistence so the customer and appointment pull flows stop maintaining parallel SQL.
**Done when:**
- [ ] ServiceTitan customer and job pull flows no longer inline duplicate sync-map insert/update statements
- [ ] One helper handles post-pull sync-map persistence for both entity types
- [ ] Existing `remote_updated_at`, `last_synced_at`, and `sync_status` behavior remains unchanged
- [ ] All existing tests pass, new tests cover the shared pull sync-map helper behavior
**Why it matters:** This is repeated bookkeeping inside a dense sync module, and consolidating it lowers maintenance cost without changing business behavior.
**Tradeoff:** The helper must stay narrow so it does not blur the real import logic around it.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile maintainability gain in a repetitive provider sync module.

### Task: Add service tests for ServiceTitan pull branch parity and cleanup behavior
**Status:** proposed
**Files to change:** `src/services/servicetitanSync.ts:L250-L420`, `src/services/servicetitanSync.test.ts:L1-L320` (new if needed)
**What to do:** Add focused tests that verify ServiceTitan customer/job pulls handle already-synced, remote-newer, and no-local-match branches correctly, and that sync context is always cleared even when a DB write throws. Mock the provider payloads and DB client so the tests assert both data writes and cleanup behavior without live ServiceTitan access.
**Done when:**
- [ ] ServiceTitan pull tests cover already-synced, remote-newer, and local-create paths for customers and jobs
- [ ] At least one failure-path test proves sync context cleanup still runs after an exception
- [ ] Sync-map persistence side effects are asserted explicitly for both entity types
- [ ] All existing tests pass, new tests lock the pull-branch and cleanup behavior
**Why it matters:** These branches are quiet but business-critical, and explicit tests would make future provider sync changes much safer.
**Tradeoff:** The tests require careful DB/client mocking, though the payoff is strong because the logic is subtle and not easy to validate manually.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it secures nuanced pull-sync behavior and cleanup guarantees.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the file history easy to audit, and the current format is continuing to make quick infrastructure cleanups stand out from broader refactor work.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output without much wasted motion, so there is no obvious tweak worth making right now.

## Ideas — 2026-04-12 (architecture reviewed)

### Task: Extract shared tenant-scoped collection route helpers for calendar, resources, and services
**Status:** proposed
**Files to change:** `src/routes/calendar.ts:L12-L120`, `src/routes/resources.ts:L35-L126`, `src/routes/services.ts:L25-L53`, `src/middleware.ts:L1-L260` (or new `src/routes/collectionHelpers.ts`)
**What to do:** Pull the repeated tenant-id resolution, limit/offset parsing, and tenant-scoped query wrapper patterns used by these list-style route modules into a small helper layer. Keep each route’s SQL domain-specific, but centralize the scaffolding that decides tenant scope, validates common query params, and returns the query result consistently.
**Done when:**
- [ ] Calendar, resources, and services list handlers no longer inline the same tenant/query scaffolding independently
- [ ] Shared helpers handle common pagination and tenant resolution without changing route-specific result shapes
- [ ] Route SQL stays local to each module instead of being over-generalized
- [ ] All existing tests pass, new tests cover the shared collection helper behavior
**Why it matters:** These are foundational dashboard reads, and reducing repeated scaffolding lowers maintenance overhead while making route parity easier to spot.
**Tradeoff:** The helper needs to stay thin so it improves consistency without obscuring straightforward route logic.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile maintainability gain across several core collection routes.

### Task: Extend assertRowAffected coverage across resources and services delete flows
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L121-L156`, `src/routes/services.ts:L93-L116`, `src/routes/routeHelpers.ts:L1-L220`
**What to do:** Audit the remaining resource and service destructive/update handlers and make sure they consistently run through `assertRowAffected` or an equivalent shared helper after `UPDATE ... RETURNING` and `DELETE ... RETURNING` queries. Keep the current success payloads, but eliminate any remaining silent no-op mutation paths in these setup routes.
**Done when:**
- [ ] Resource and service update/delete routes consistently use shared zero-row guards
- [ ] No remaining resource/service mutation route returns success after a zero-row `RETURNING` result
- [ ] Not-found responses follow one consistent payload pattern across both modules
- [ ] All existing tests pass, new tests cover any newly guarded zero-row outcomes
**Why it matters:** Silent mutation success is a subtle but costly backend behavior, especially in setup flows where operators expect a clear signal that a real entity changed.
**Tradeoff:** Tightening these contracts may expose frontend assumptions that were relying on optimistic success, so good regression coverage matters.
**Size:** small (< 1hr)
**Impact:** high
**Effort vs Gain:** Low effort, high gain by making setup mutations more trustworthy and consistent.

### Task: Add route tests for collection and mutation parity across calendar, resources, and services
**Status:** proposed
**Files to change:** `src/routes/calendar.ts:L12-L220`, `src/routes/resources.ts:L35-L156`, `src/routes/services.ts:L25-L116`, route test files for each module (new if needed)
**What to do:** Add focused tests that assert tenant scoping, pagination behavior where applicable, and zero-row update/delete handling across these three route groups. Use one shared assertion style so parity issues in success and failure payloads show up clearly in the test output.
**Done when:**
- [ ] Calendar collection routes are tested for tenant scope and query-param handling
- [ ] Resources and services routes are tested for list behavior plus update/delete not-found outcomes
- [ ] Success and failure payload shapes are asserted consistently across the three modules
- [ ] All existing tests pass, new tests lock the parity contract
**Why it matters:** These routes support core schedule and setup surfaces, and explicit parity tests are the fastest way to catch drift before it leaks into the dashboard.
**Tradeoff:** Adds some repetitive fixture setup, though shared helpers can keep the suite readable.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects multiple core route families from subtle contract drift.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to surface concrete route-level work instead of broad repetitive refactor themes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to make shared-service ideas stay concrete instead of drifting into vague abstraction-for-its-own-sake.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, bounded output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to surface concrete route-level work instead of recycling broad generic refactor themes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (backend workflow reviewed)

### Task: Align vocabulary, voice, and communications read endpoints on one explicit envelope contract
**Status:** proposed
**Files to change:** `src/routes/vocabulary.ts:L8-L33`, `src/routes/voice.ts:L44-L370`, `src/routes/communications.ts:L78-L251`, `src/middleware.ts:L1-L260`
**What to do:** Decide on one explicit response contract for lightweight read endpoints in this surface, either raw row payloads or `{ success: true, ... }` envelopes, then update vocabulary, voice read endpoints, and communications read endpoints to follow it consistently. Preserve their domain fields, but remove the current mix of top-level response shapes.
**Done when:**
- [ ] Vocabulary, voice read endpoints, and communications read endpoints follow one documented response-envelope convention
- [ ] Any exceptions are intentional and documented in code comments or helper usage
- [ ] Dashboard consumers can rely on predictable top-level response shapes across this route family
- [ ] All existing tests pass, new tests cover the normalized read-endpoint contract
**Why it matters:** These endpoints feed visible operator screens, and inconsistent envelopes create unnecessary frontend branching in otherwise simple reads.
**Tradeoff:** Must be checked against current dashboard callers so the cleanup does not introduce accidental breakage.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile consistency gain across frequently consumed read endpoints.

### Task: Extract shared validation-failure responders for voice and communications mutation routes
**Status:** proposed
**Files to change:** `src/routes/voice.ts:L44-L370`, `src/routes/communications.ts:L78-L250`, `src/middleware.ts:L1-L260`
**What to do:** Introduce a tiny helper for common Zod validation failure responses so voice and communications mutation handlers stop rebuilding the same `{ success: false, error: 'Validation failed', details }` branches inline. Keep schema definitions local to each route module, but route parse failures through one shared responder.
**Done when:**
- [ ] Voice and communications mutation handlers no longer hand-roll duplicate validation-failure payloads
- [ ] The shared helper preserves the current status code and error-body shape
- [ ] Route-local schemas remain readable and unchanged in scope
- [ ] All existing tests pass, new tests cover the shared validation responder if added
**Why it matters:** This repeated boilerplate appears in route modules that already have a lot of branching, and centralizing it makes parity easier to maintain.
**Tradeoff:** The helper must stay tiny so it does not hide simple route flow behind unnecessary abstraction.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain through cleaner and more consistent route code.

### Task: Add parity tests for vocabulary, voice, and communications read/write contracts
**Status:** proposed
**Files to change:** `src/routes/vocabulary.ts:L8-L33`, `src/routes/voice.ts:L44-L370`, `src/routes/communications.ts:L78-L250`, route test files for these modules (new if needed)
**What to do:** Add focused tests that assert response shapes for vocabulary reads, voice active/history/context reads, and communications history/consent reads, plus validation failure behavior for representative voice and communications mutation endpoints. Use a shared assertion style so contract drift across the three route families is obvious in test output.
**Done when:**
- [ ] Vocabulary route is tested for tenant-not-found and successful fallback payload behavior
- [ ] Voice read endpoints are tested for their expected response envelopes and not-found behavior
- [ ] Communications read endpoints and representative mutation validation failures are tested for contract parity
- [ ] All existing tests pass, new tests lock response-shape consistency across the route family
**Why it matters:** These endpoints are operator-facing and lightly structured, which makes them especially prone to quiet contract drift unless tests pin them down.
**Tradeoff:** The tests will need some repetitive fixture setup, though shared helpers can keep the suite readable.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because explicit contract tests prevent small route inconsistencies from leaking into the dashboard.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still easy to audit, and the current format is helping repeated route-family work stay specific instead of collapsing into vague cleanup suggestions.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, bounded output with useful prioritization signals, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (platform contract review)

### Task: Extract shared tenant bootstrap helper across auth register and admin tenant create flows
**Status:** proposed
**Files to change:** `src/routes/auth.ts:L56-L115`, `src/routes/tenants.ts:L119-L167`, `src/middleware.ts:L1-L260` (or new `src/services/accountBootstrap.ts`)
**What to do:** Move the duplicated tenant-plus-owner creation transaction out of `/register` and `/tenants/create` into one helper that accepts business info, owner info, and password, then handles duplicate checks, tenant insert, password hashing, user insert, and transaction control. Preserve each route’s endpoint contract and auth posture, but stop maintaining two near-parallel bootstrap flows.
**Done when:**
- [ ] Auth register and admin tenant create no longer inline the full tenant/user bootstrap transaction separately
- [ ] Shared helper owns duplicate detection, password hashing, and transaction control
- [ ] Route-specific response payloads remain unchanged for public register versus admin create
- [ ] All existing tests pass, new tests cover the shared bootstrap helper success and conflict cases
**Why it matters:** These two routes create the same core records with slightly different inputs, and centralizing that workflow reduces duplication in a sensitive account-creation path.
**Tradeoff:** The helper needs to stay explicit about the small differences between self-serve registration and admin provisioning so the abstraction does not hide policy decisions.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it removes duplicated transactional logic from foundational account-creation flows.

### Task: Normalize billing and provisioning status envelopes with auth-style platform contracts
**Status:** proposed
**Files to change:** `src/routes/billing.ts:L162-L175`, `src/routes/provisioning.ts:L188-L214`, `src/routes/auth.ts:L24-L129`, `src/middleware.ts:L1-L260`
**What to do:** Update the billing and provisioning status endpoints so they return the same top-level success envelope pattern used by the rest of the platform-route family, while preserving their existing domain fields. Keep tenant-not-found behavior explicit, but remove the current raw-row response shape mismatch across these admin surfaces.
**Done when:**
- [ ] Billing and provisioning status endpoints return a consistent `{ success: true, ... }` style envelope
- [ ] Tenant-not-found failures remain explicit and consistent with sibling platform routes
- [ ] Existing domain fields like subscription status, plan, and phone state remain intact inside the envelope
- [ ] All existing tests pass, new tests cover the normalized status contracts
**Why it matters:** These endpoints back high-visibility admin status surfaces, and consistent envelopes reduce client branching in the parts of the app that should feel most predictable.
**Tradeoff:** Must be checked against current dashboard callers so the envelope cleanup does not introduce accidental regressions.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain in a business-critical route family.

### Task: Normalize provisioning prerequisite and failure responses with auth/billing contracts
**Status:** proposed
**Files to change:** `src/routes/provisioning.ts:L22-L136`, `src/routes/auth.ts:L24-L129`, `src/routes/billing.ts:L18-L172`, `src/middleware.ts:L1-L260`
**What to do:** Update provisioning prerequisite, conflict, and upstream-failure branches so they consistently include `success: false` while preserving the useful extra fields like `missing_fields`, `tenant_name`, `current_status`, and `rolled_back`. Keep the same HTTP status codes, but make the top-level failure contract predictable across platform routes.
**Done when:**
- [ ] Provisioning prerequisite, conflict, and upstream-failure responses include a consistent `success: false` top-level envelope
- [ ] Helpful metadata fields like `missing_fields`, `current_status`, and `rolled_back` remain intact
- [ ] Auth, billing, and provisioning platform failures follow one clearer envelope convention
- [ ] All existing tests pass, new tests cover the normalized provisioning failure contracts
**Why it matters:** These are high-visibility admin flows, and inconsistent top-level error shapes create avoidable client branching in exactly the parts of the app that should feel most predictable.
**Tradeoff:** Must be checked against current dashboard callers so envelope cleanup does not create accidental regressions.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain in a business-critical route family.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the file history easy to audit, and the current format is continuing to surface concrete contract cleanup work instead of broad repetitive refactor themes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the file history easy to audit, and the current format is continuing to make quick infrastructure cleanups stand out from broader refactor work.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output without much wasted motion, so there is no obvious tweak worth making right now.

## Ideas — 2026-04-12 (platform contract review)

### Task: Normalize provisioning prerequisite and upstream failure envelopes with auth/billing contracts
**Status:** proposed
**Files to change:** `src/routes/provisioning.ts:L31-L136`, `src/routes/auth.ts:L24-L129`, `src/routes/billing.ts:L18-L175`, `src/middleware.ts:L1-L260`
**What to do:** Update provisioning prerequisite, conflict, and upstream-failure branches so they consistently include `success: false` while preserving useful extra fields like `missing_fields`, `tenant_name`, `current_status`, `assistant_created`, and `rolled_back`. Keep the same HTTP status codes, but make the top-level failure contract predictable across the platform-route family.
**Done when:**
- [ ] Provisioning prerequisite, conflict, and upstream-failure responses include a consistent `success: false` top-level envelope
- [ ] Helpful metadata fields like `missing_fields`, `current_status`, `assistant_created`, and `rolled_back` remain intact
- [ ] Auth, billing, and provisioning platform failures follow one clearer envelope convention
- [ ] All existing tests pass, new tests cover the normalized provisioning failure contracts
**Why it matters:** These are high-visibility admin flows, and inconsistent top-level error shapes create avoidable client branching in exactly the parts of the app that should feel most predictable.
**Tradeoff:** Must be checked against current dashboard callers so envelope cleanup does not create accidental regressions.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain in a business-critical route family.

### Task: Normalize billing and provisioning status responses with auth-style platform envelopes
**Status:** proposed
**Files to change:** `src/routes/billing.ts:L162-L175`, `src/routes/provisioning.ts:L188-L214`, `src/routes/auth.ts:L24-L129`, `src/middleware.ts:L1-L260`
**What to do:** Update the billing and provisioning status endpoints so they return the same top-level success envelope pattern used by the rest of the platform-route family, while preserving their existing domain fields. Keep tenant-not-found behavior explicit, but remove the current raw-row response shape mismatch across these admin surfaces.
**Done when:**
- [ ] Billing and provisioning status endpoints return a consistent `{ success: true, ... }` style envelope
- [ ] Tenant-not-found failures remain explicit and consistent with sibling platform routes
- [ ] Existing domain fields like subscription status, plan, and phone state remain intact inside the envelope
- [ ] All existing tests pass, new tests cover the normalized status contracts
**Why it matters:** These endpoints back high-visibility admin status surfaces, and consistent envelopes reduce client branching in the parts of the app that should feel most predictable.
**Tradeoff:** Must be checked against current dashboard callers so the envelope cleanup does not introduce accidental regressions.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain in a business-critical route family.

### Task: Add route tests for auth, billing, and provisioning contract parity
**Status:** proposed
**Files to change:** `src/routes/auth.ts:L24-L129`, `src/routes/billing.ts:L18-L175`, `src/routes/provisioning.ts:L22-L214`, route test files for these modules (new if needed)
**What to do:** Add focused tests that assert response shapes and failure behavior for login/register, billing configuration failures, billing/provisioning status responses, provisioning prerequisite failures, provisioning conflict states, and provisioning upstream-failure branches. Use a shared assertion style so contract drift across these platform routes is obvious when a handler returns a raw row unexpectedly or omits `success` on failure.
**Done when:**
- [ ] Auth routes are tested for success, validation, and conflict/failure payload shapes
- [ ] Billing routes are tested for status envelopes and representative failure branches
- [ ] Provisioning routes are tested for prerequisite failures, conflict states, upstream failures, and status behavior
- [ ] All existing tests pass, new tests lock platform contract parity behavior
**Why it matters:** These routes define core account and admin behavior, and explicit contract tests are the safest way to prevent subtle API drift from leaking into dashboard setup and billing/provisioning flows.
**Tradeoff:** The tests will need broader fixture coverage across public, authenticated, and config-dependent paths, though the payoff is strong because these are foundational endpoints.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects foundational route contracts other admin surfaces depend on.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the file history easy to audit, and the current format is continuing to surface concrete contract cleanup work instead of broad repetitive refactor themes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-12 (architecture reviewed)

### Task: Extract shared date and tenant query parsing for analytics coverage endpoints
**Status:** proposed
**Files to change:** `src/routes/analytics.ts:L15-L43`, `src/middleware.ts:L1-L260` (or new `src/routes/queryParsers.ts`), `src/routes/calendar.ts:L1-L220`
**What to do:** Move the `/coverage` route’s inline date regex, fallback logic, and tenant-scoped query parsing into a shared helper that also matches the calendar route’s date-range parsing conventions. Keep the analytics SQL in place, but make date validation and default handling come from one typed parser used by both scheduler-adjacent route families.
**Done when:**
- [ ] Analytics coverage route no longer defines date regex and fallback logic inline
- [ ] Shared date-range parsing is reusable by both analytics and calendar route code
- [ ] Invalid or missing date params follow one consistent parsing policy
- [ ] All existing tests pass, new tests cover the shared date parser behavior
**Why it matters:** Date handling is easy to let drift across scheduling endpoints, and one parser reduces duplicate logic in routes that should agree on time-window behavior.
**Tradeoff:** The helper needs to stay narrow so it improves consistency without turning simple handlers into indirection puzzles.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain in scheduling-adjacent route parsing.

### Task: Fix employee update tenant scoping and zero-row mutation handling
**Status:** proposed
**Files to change:** `src/routes/employees.ts:L90-L123`, `src/middleware.ts:L1-L260`, `src/routes/employees.test.ts:L1-L320` (new if needed)
**What to do:** Update the employee update query so it scopes by both `id` and `tenant_id`, then return a 404-style failure when no row is updated. Keep the existing payload shape for successful updates, but stop allowing cross-tenant or missing-record updates to fall through as implicit success with an undefined employee payload.
**Done when:**
- [ ] Employee update query filters on both employee id and tenant id
- [ ] Zero-row employee updates return a not-found response instead of `success: true`
- [ ] Successful updates preserve the current response payload shape
- [ ] All existing tests pass, new tests cover out-of-scope and missing-record update cases
**Why it matters:** This is a real data-safety edge in a core admin flow, and tightening it removes a subtle cross-tenant mutation risk while making the API contract more honest.
**Tradeoff:** The stricter behavior may expose frontend code that assumed update success without checking for missing targets, so regression tests are important.
**Size:** small (< 1hr)
**Impact:** high
**Effort vs Gain:** Low effort, high gain because it closes a real tenant-safety gap in a core admin route.

### Task: Extend shared zero-row guards across resource update and delete flows
**Status:** proposed
**Files to change:** `src/routes/resources.ts:L55-L111`, `src/routes/resources.ts:L113-L141`, `src/routes/routeHelpers.ts:L1-L220`
**What to do:** Update the resources route module so both the update and delete handlers consistently rely on `assertRowAffected` or one shared zero-row helper path, instead of mixing the helper in one branch and a hand-rolled `res.rows.length === 0` branch in another. Keep the current success payloads, but unify the not-found handling path so resource mutations behave like the rest of the route family.
**Done when:**
- [ ] Resource update and delete both use the same shared zero-row guard path
- [ ] Not-found responses for resource mutations follow one consistent helper-driven payload shape
- [ ] Existing success behavior remains unchanged for real row mutations
- [ ] All existing tests pass, new tests cover any newly unified zero-row outcomes
**Why it matters:** The route is already mostly standardized, and finishing the last bit of parity removes a small but recurring source of inconsistency in setup flows.
**Tradeoff:** This is a relatively small cleanup, so the implementation should stay narrow and avoid broader refactoring churn.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, good consistency gain by finishing an already-started route standardization.

## Self-Review — 2026-04-12
**Cycles since last self-review:** 1
**What's working:** The append-only structure is still keeping the history easy to audit, and the current format is continuing to surface concrete route-level work instead of broad repetitive refactor themes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current instructions are still producing clear, prioritized output with useful effort-vs-gain framing, so I do not see a worthwhile tweak right now.

## Ideas — 2026-04-17 (UI/UX patterns reviewed)

### Task: Replace blocking confirm/alert flows in EmployeeManagementView with shared modal and toast feedback
**Status:** proposed
**Files to change:** `dashboard/components/EmployeeManagementView.tsx:L1-L360`, `dashboard/components/ui/ConfirmModal.tsx:L1-L220`, `dashboard/components/ui/Toast.tsx:L1-L220`, `dashboard/components/ui/useConfirm.tsx:L1-L220` if present
**What to do:** Refactor employee delete and mapping-update failure flows so they use the shared confirm-modal and non-blocking feedback patterns instead of browser `confirm()` and `alert()`. Keep the current delete and service-toggle behavior, but make destructive confirmation and error reporting match the rest of the dashboard’s UI system.
**Done when:**
- [ ] EmployeeManagementView no longer uses browser `confirm()` for delete confirmation
- [ ] Delete and service-toggle failures no longer use blocking `alert()` dialogs
- [ ] Confirmation, success, and failure feedback use the shared modal/toast approach already present elsewhere in the dashboard
- [ ] All existing tests pass, new tests cover confirm/cancel/delete and mapping-failure feedback
**Why it matters:** Browser-native dialogs feel jarring on a polished admin surface, and blocking error popups make staffing edits feel less trustworthy and less consistent than the rest of the app.
**Tradeoff:** This should stay scoped to feedback mechanics, not a larger redesign of the employee-management workflow.
**Size:** small (< 1hr)
**Impact:** high
**Effort vs Gain:** Low effort, high gain because it removes the last bits of browser-native friction from a frequently used management screen.

### Task: Add explicit mapping-load and empty-assignment states to EmployeeManagementView
**Status:** proposed
**Files to change:** `dashboard/components/EmployeeManagementView.tsx:L1-L360`
**What to do:** Refactor the employee cards and quick-edit modal so mapping fetches, unmapped employees, and missing-services prerequisites are communicated through deliberate loading and empty states instead of silent fallbacks like "No services provided" or an empty matrix of pills. Keep the card-and-modal layout, but make it obvious whether services are still loading, not configured, or simply not assigned to a given employee.
**Done when:**
- [ ] Employee cards distinguish between loading mappings, no available services, and no assignments for that employee
- [ ] The quick-edit modal communicates when service assignment data is unavailable or still loading
- [ ] Empty-state messaging explains the next useful action, such as creating services first
- [ ] All existing tests pass, new tests cover mapping-loading and empty-assignment rendering
**Why it matters:** Staffing setup depends on service relationships, and unclear empty states make it hard to tell whether the system is empty, broken, or just still loading.
**Tradeoff:** The extra messaging should stay compact so the screen does not become visually noisy once data is present.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it clarifies a common setup workflow that currently has ambiguous silent fallbacks.

### Task: Add workforce-screen tests for employee delete confirmation, mapping feedback, and empty assignment states
**Status:** proposed
**Files to change:** `dashboard/components/EmployeeManagementView.tsx:L1-L360`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin delete confirmation behavior, mapping-toggle error feedback, unmapped/no-services messaging, and quick-edit modal assignment-state handling in EmployeeManagementView. Keep the suite focused on visible interaction states so staffing-screen feedback stays reliable as the implementation evolves.
**Done when:**
- [ ] EmployeeManagementView is tested for confirm/cancel delete behavior
- [ ] Mapping-toggle failures are tested for visible non-blocking feedback
- [ ] Empty assignment and no-services states are tested in both the card list and quick-edit modal where relevant
- [ ] All existing tests pass, new tests protect the employee-management UX contract
**Why it matters:** Employee management is a high-frequency admin surface, and regressions in destructive actions or assignment feedback create day-to-day friction quickly.
**Tradeoff:** The tests should stay centered on visible UI states and not expand into deeper mapping business logic coverage.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it protects a key workforce-management workflow with focused UI-state coverage.

## Self-Review — 2026-04-17
**Cycles since last self-review:** 1
**What's working:** The recent-entry skim is still surfacing sharper issues inside familiar areas, and this cycle found a concrete browser-dialog inconsistency instead of another broad state-pattern note.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current structure already gives enough room to revisit important screens productively, so I do not think more rules would improve the output.

## Ideas — 2026-04-17 (UI/UX patterns reviewed)

### Task: Add consistent prerequisite and no-employee messaging across wizard staffing steps
**Status:** proposed
**Files to change:** `dashboard/components/SetupWizard/StepEmployees.tsx:L1-L260`, `dashboard/components/SetupWizard/StepShifts.tsx:L1-L220`, `dashboard/components/SetupWizard/Step7GoLive.tsx:L1-L260`
**What to do:** Align the way the staffing-related wizard steps explain missing employees, incomplete shift setup, and phone-activation blockers so the user gets one consistent “what’s missing and what next” pattern across the flow. Keep each step’s current layout, but standardize the shell-level prerequisite messaging and action copy instead of letting each stage invent its own empty/problem state treatment.
**Done when:**
- [ ] Employee, shifts, and go-live steps use a visibly consistent prerequisite/next-action pattern
- [ ] Missing employees or incomplete staffing setup are explained clearly before the user hits phone activation
- [ ] Go-live step blocker messaging feels like a continuation of earlier staffing guidance rather than a separate system
- [ ] All existing tests pass, new tests cover aligned prerequisite messaging where added
**Why it matters:** Wizard trust comes from continuity, and inconsistent blocker messaging across adjacent steps makes setup feel more brittle than it is.
**Tradeoff:** The guidance should stay concise so it helps users move forward without turning the wizard into a wall of instructional text.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it improves continuity in one of the setup flow’s most important handoffs.

### Task: Add explicit async state continuity between shift setup and go-live phone activation
**Status:** proposed
**Files to change:** `dashboard/components/SetupWizard/StepShifts.tsx:L1-L220`, `dashboard/components/SetupWizard/Step7GoLive.tsx:L1-L260`
**What to do:** Refine the handoff between schedule configuration and phone activation so loading, saving, and blocking states carry through more deliberately instead of resetting the user’s context at the final step. Keep the current separate steps, but make the go-live screen acknowledge recent schedule/setup work and show clear in-progress or blocked states tied to that context.
**Done when:**
- [ ] Step7GoLive shows clear blocked/in-progress messaging when earlier staffing prerequisites are incomplete
- [ ] StepShifts communicates completion in a way that flows naturally into go-live expectations
- [ ] Phone-activation loading and failure states feel connected to the broader setup flow rather than isolated to a single button
- [ ] All existing tests pass, new tests cover shift-to-go-live state continuity where added
**Why it matters:** The final setup step is where users decide whether the system is ready, so context loss here disproportionately hurts confidence.
**Tradeoff:** This is continuity work, so it should avoid expanding into a broader redesign of phone provisioning itself.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it sharpens the most consequential transition in the wizard.

### Task: Add staffing-to-go-live wizard tests for blocker messaging, async feedback, and completion continuity
**Status:** proposed
**Files to change:** `dashboard/components/SetupWizard/StepEmployees.tsx:L1-L260`, `dashboard/components/SetupWizard/StepShifts.tsx:L1-L220`, `dashboard/components/SetupWizard/Step7GoLive.tsx:L1-L260`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin missing-employee guidance, shift-step completion messaging, go-live blocker states, and phone-activation loading/failure feedback. Use shared assertions for prerequisite messaging so the staffing-to-launch part of the wizard stays coherent as individual steps evolve.
**Done when:**
- [ ] StepEmployees is tested for visible prerequisite/empty-state guidance
- [ ] StepShifts is tested for completion and blocked-state messaging
- [ ] Step7GoLive is tested for blocker, loading, success, and failure feedback around phone activation
- [ ] All existing tests pass, new tests protect the staffing-to-go-live wizard UX contract
**Why it matters:** These steps form the emotional endgame of onboarding, and regressions in blocker or activation feedback are especially damaging when the user is trying to finish setup.
**Tradeoff:** The tests should stay focused on visible interaction and messaging behavior, not deeper provisioning logic.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects the most important handoff in the guided setup flow.

## Self-Review — 2026-04-17
**Cycles since last self-review:** 1
**What's working:** Re-checking actual artifact paths caught the docs/ drift cleanly, and the recent-entry skim still let me revisit the wizard from a genuinely different handoff-focused angle.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The process itself is still doing the right thing, the main lesson this cycle was to keep verifying where the project is really writing its artifacts.

## Ideas — 2026-04-17 (UI/UX patterns reviewed)

### Task: Add shared empty-search and no-match treatment to BusinessTypePicker and WizardModeChooser
**Status:** proposed
**Files to change:** `dashboard/components/SetupWizard/BusinessTypePicker.tsx:L1-L260`, `dashboard/components/SetupWizard/WizardModeChooser.tsx:L1-L200`, optional new small empty-state helper in `dashboard/components/ui/`
**What to do:** Align the way the wizard entry surfaces communicate no matching business types, unavailable choices, and next actions when the user’s search or mode selection yields a dead end. Keep the current card/grid layouts, but replace silent filtered emptiness or sparse fallback copy with one consistent, actionable empty-state pattern.
**Done when:**
- [ ] BusinessTypePicker shows a clear no-match state when search filtering removes all templates
- [ ] WizardModeChooser communicates unavailable or not-yet-applicable choices with a consistent visual pattern
- [ ] Empty/no-match treatment across both entry surfaces suggests the next useful action, such as clearing search or choosing the other wizard mode
- [ ] All existing tests pass, new tests cover no-match and unavailable-choice rendering
**Why it matters:** These are the first decision points in setup, and empty or under-explained dead ends make the wizard feel fragile before it really starts.
**Tradeoff:** The empty-state treatment should stay lightweight so it does not overpower the normal card-selection flow.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it clarifies the earliest branch points in the onboarding experience.

### Task: Add pre-finalize prerequisite and success-transition continuity to SoloStepReview
**Status:** proposed
**Files to change:** `dashboard/components/SetupWizard/SoloStepReview.tsx:L1-L220`
**What to do:** Refine SoloStepReview so the user sees clearer prerequisite messaging before finalization, better disabled-button reasoning when no services exist, and a more deliberate transition from in-progress setup to the success state. Keep the current single-button flow, but make the final step explain why completion is blocked and what changed after setup finishes.
**Done when:**
- [ ] The review step explains why the finalize button is disabled when prerequisites are missing
- [ ] Finalizing state provides more context than a generic loading label alone
- [ ] The success state makes the transition from setup-in-progress to configured/completed feel more explicit
- [ ] All existing tests pass, new tests cover blocked, finalizing, and finalized state messaging
**Why it matters:** The review step is the emotional commit point of the solo wizard, so vague disabled or success states undercut confidence at exactly the wrong moment.
**Tradeoff:** This should stay focused on feedback continuity and not turn the review step into a longer summary page.
**Size:** small (< 1hr)
**Impact:** high
**Effort vs Gain:** Low effort, high gain because it sharpens the most consequential moment in the solo setup flow.

### Task: Add wizard-entry tests for search dead ends, mode selection, and review-step completion states
**Status:** proposed
**Files to change:** `dashboard/components/SetupWizard/BusinessTypePicker.tsx:L1-L260`, `dashboard/components/SetupWizard/WizardModeChooser.tsx:L1-L200`, `dashboard/components/SetupWizard/SoloStepReview.tsx:L1-L220`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin business-type search no-match behavior, wizard-mode selection messaging, review-step disabled/finalizing/finalized states, and next-action copy. Use shared assertions for visible wizard-entry feedback so the onboarding flow keeps a coherent first-impression contract.
**Done when:**
- [ ] BusinessTypePicker is tested for search filtering and no-match rendering
- [ ] WizardModeChooser is tested for visible option selection and unavailable-choice messaging
- [ ] SoloStepReview is tested for disabled, finalizing, and finalized states
- [ ] All existing tests pass, new tests protect the wizard-entry UX contract
**Why it matters:** These small entry and review surfaces frame the whole onboarding experience, and regressions here are disproportionately noticeable because they shape first impressions.
**Tradeoff:** The tests should stay focused on visible entry/review behavior rather than broad wizard internals.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it protects several pivotal wizard touchpoints with one focused suite.

## Self-Review — 2026-04-17
**Cycles since last self-review:** 1
**What's working:** Re-checking the active artifact path avoided another bad write target, and the recent-entry skim still let me revisit setup from a lighter entry/review angle instead of repeating the deeper step-workflow batches.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current process is doing its job, the biggest practical lesson is still to verify the live artifact location before appending.

## Ideas — 2026-04-17 (UI/UX patterns reviewed)

### Task: Align login and top-level shell surfaces on shared empty/error/retry treatment
**Status:** proposed
**Files to change:** `dashboard/components/LoginView.tsx:L1-L140`, `dashboard/components/DashboardHome.tsx:L1-L260`, `dashboard/components/OutlookLayout.tsx:L1-L260`, shared UI primitives if needed
**What to do:** Refine the login screen and top-level shell components so they use one coherent pattern for first-load, failure, and retry states instead of each screen inventing its own isolated treatment. Keep the current layouts, but make entry and shell surfaces feel like the same product when users hit a network problem or no-data condition.
**Done when:**
- [ ] LoginView, DashboardHome, and OutlookLayout show visibly compatible failure/retry treatment patterns
- [ ] First-load and no-data messaging are clearer and more deliberate across the three shells
- [ ] Shared UI primitives are used where that reduces one-off shell-state markup
- [ ] All existing tests pass, new tests cover shell-level error/retry behavior where added
**Why it matters:** These components frame the whole app experience, so inconsistent shell-state treatment makes the product feel stitched together even before users reach deeper workflows.
**Tradeoff:** This should stay focused on shell-state consistency, not drift into a broader shell redesign.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it improves coherence at the app’s highest-visibility surfaces.

### Task: Replace raw LoginView fields with shared input/button primitives and consistent auth messaging
**Status:** proposed
**Files to change:** `dashboard/components/LoginView.tsx:L1-L140`, `dashboard/components/ui/Input.tsx:L1-L220`, `dashboard/components/ui/Button.tsx:L1-L220`, optional shared alert/message primitive if present
**What to do:** Refactor LoginView so its email/password fields, submit button, and error messaging use the same primitives and feedback language as the rest of the dashboard. Keep the branded login card, but stop hand-rolling the primary auth controls and error treatment in isolation.
**Done when:**
- [ ] LoginView no longer uses raw `<input>` fields and a bespoke submit button
- [ ] Auth error treatment uses the shared UI system instead of a one-off banner block
- [ ] Disabled/loading/focus behavior matches dashboard primitives
- [ ] All existing tests pass, new tests cover primitive-driven auth loading/error states if relevant
**Why it matters:** Login is still the app’s first impression, and inconsistent primitives there make the rest of the polished dashboard feel disconnected.
**Tradeoff:** This is a contained consistency fix, so it should not expand into a broader auth-flow redesign.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it aligns the app’s first interaction with the rest of the design system.

### Task: Add shell-entry tests for login, dashboard-home, and layout retry/no-data behavior
**Status:** proposed
**Files to change:** `dashboard/components/LoginView.tsx:L1-L140`, `dashboard/components/DashboardHome.tsx:L1-L260`, `dashboard/components/OutlookLayout.tsx:L1-L260`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin login error/loading states, dashboard-home loading/no-data treatment, and OutlookLayout shell retry or empty behavior. Use shared assertions around visible shell-state messaging so the app’s entry surfaces do not drift apart over time.
**Done when:**
- [ ] LoginView is tested for loading, auth failure, and network failure states
- [ ] DashboardHome is tested for loading and no-data/retry shell behavior
- [ ] OutlookLayout is tested for shell-level empty/retry state handling where applicable
- [ ] All existing tests pass, new tests protect the app-entry UX contract
**Why it matters:** These screens shape first impressions and app-level trust, so shell-state regressions here are disproportionately noticeable.
**Tradeoff:** The tests should stay on visible shell behavior and avoid duplicating deeper feature coverage.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it protects the app’s first-contact surfaces with a shared lens.

## Self-Review — 2026-04-17
**Cycles since last self-review:** 1
**What's working:** Verifying the live artifact path up front is preventing wasted writes now, and the recent-entry skim still lets me revisit broad shell surfaces from a different consistency angle instead of duplicating earlier notes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The process is holding up well, the main thing that matters now is staying disciplined about path verification and angle selection rather than changing the instructions again.

## Ideas — 2026-04-17 (UI/UX patterns reviewed)

### Task: Replace ad hoc search and close controls in BusinessTypePicker and WizardModeChooser with shared primitives
**Status:** proposed
**Files to change:** `dashboard/components/SetupWizard/BusinessTypePicker.tsx:L1-L260`, `dashboard/components/SetupWizard/WizardModeChooser.tsx:L1-L220`, `dashboard/components/ui/Input.tsx:L1-L220`, `dashboard/components/ui/Button.tsx:L1-L220`
**What to do:** Refactor the wizard-entry search field, dismiss controls, and mode-selection actions so they use shared input/button primitives instead of bespoke icon-button and inline control styling. Keep the current compact onboarding cards, but move focus, disabled, hover, and close-button behavior onto the common UI layer.
**Done when:**
- [ ] BusinessTypePicker search and dismiss controls no longer rely on one-off control markup
- [ ] WizardModeChooser action controls use shared button primitives for focus and disabled states
- [ ] Entry-surface controls remain visually compact while aligning with the dashboard design system
- [ ] All existing tests pass, new tests cover any primitive-driven state behavior if relevant
**Why it matters:** These are the wizard’s first touchpoints, and consistent controls there help the whole onboarding flow feel more deliberate and polished.
**Tradeoff:** This is primitive-reuse cleanup, so it should avoid broad visual redesign of the entry cards.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it improves consistency at the first interaction surfaces of onboarding.

### Task: Add blocked-state reasoning and next-action copy to SoloStepReview completion gating
**Status:** proposed
**Files to change:** `dashboard/components/SetupWizard/SoloStepReview.tsx:L1-L180`
**What to do:** Expand the review step’s disabled-finalize treatment so it explains why completion is blocked, what prerequisite is missing, and what the user should do next instead of only disabling the button when `services.length === 0`. Keep the current simple review card, but make blocked states feel intentional and actionable.
**Done when:**
- [ ] SoloStepReview explains why completion is blocked when prerequisites are missing
- [ ] Disabled finalize state includes a concise next action rather than relying on the button state alone
- [ ] Finalizing and finalized states remain visually distinct from the blocked state
- [ ] All existing tests pass, new tests cover blocked, finalizing, and finalized messaging
**Why it matters:** The review step is the last point before completion, so unexplained disabled states create unnecessary uncertainty at the most important moment in the solo flow.
**Tradeoff:** The copy should stay brief so it clarifies the state without turning the review card into a verbose help screen.
**Size:** small (< 1hr)
**Impact:** high
**Effort vs Gain:** Low effort, high gain because it makes the wizard’s finish line much clearer when the user is blocked.

### Task: Add wizard-entry parity tests for primitive controls and blocked review states
**Status:** proposed
**Files to change:** `dashboard/components/SetupWizard/BusinessTypePicker.tsx:L1-L260`, `dashboard/components/SetupWizard/WizardModeChooser.tsx:L1-L220`, `dashboard/components/SetupWizard/SoloStepReview.tsx:L1-L180`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin search-field behavior, dismiss/control affordances, mode-selection feedback, and blocked/finalizing/finalized review states. Use shared assertions around visible entry/review behavior so the wizard’s first and last touchpoints stay aligned.
**Done when:**
- [ ] BusinessTypePicker is tested for search control behavior and no-match interaction states
- [ ] WizardModeChooser is tested for visible mode-selection and close/control behavior
- [ ] SoloStepReview is tested for blocked, finalizing, and finalized state messaging
- [ ] All existing tests pass, new tests protect the wizard entry/review UX contract
**Why it matters:** These components bookend the onboarding flow, and regressions here are especially noticeable because they shape first and last impressions.
**Tradeoff:** The tests should stay centered on visible UI behavior and not expand into broader wizard internals.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it protects the onboarding bookends with a tight, coherent suite.

## Self-Review — 2026-04-17
**Cycles since last self-review:** 1
**What's working:** Re-verifying the active docs/ artifact path is preventing bad writes now, and the recent-entry skim still lets me revisit onboarding surfaces from a distinct control-and-blocked-state angle instead of repeating the prior step-guidance batch.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The process is holding up well, the main thing that matters is staying disciplined about path verification and picking a genuinely different slice each cycle.

## Ideas — 2026-04-17 (UI/UX patterns reviewed)

### Task: Replace remaining blocking delete alert in KnowledgeBaseView with shared in-flow feedback
**Status:** proposed
**Files to change:** `dashboard/components/KnowledgeBaseView.tsx:L180-L260`, `dashboard/components/ui/Toast.tsx:L1-L220` or existing message treatment
**What to do:** Remove the remaining `alert('Failed to delete')` path from KnowledgeBaseView and route delete failures through the same inline/toast feedback system already used for uploads and other knowledge actions. Keep the existing confirm-modal delete flow, but make failure handling consistent and non-blocking.
**Done when:**
- [ ] KnowledgeBaseView no longer uses a blocking alert for delete failures
- [ ] Delete failures surface through the same visible feedback treatment as upload/save errors
- [ ] Success and failure feedback for knowledge actions follow one consistent pattern
- [ ] All existing tests pass, new tests cover delete-failure feedback
**Why it matters:** A single blocking alert on an otherwise polished content-authoring surface feels jarring and breaks the interaction consistency the rest of the screen is already moving toward.
**Tradeoff:** This is a small cleanup, so it should stay tightly scoped to failure feedback and not reopen unrelated knowledge-view concerns.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it removes a visible inconsistency from a high-interaction admin screen.

### Task: Add unified action-feedback treatment across CRMView and KnowledgeBaseView side effects
**Status:** proposed
**Files to change:** `dashboard/components/CRMView.tsx:L1-L320`, `dashboard/components/KnowledgeBaseView.tsx:L1-L420`, shared toast/message primitive files if needed
**What to do:** Align the way CRM sync/integration actions and knowledge upload/delete/save actions surface success, failure, and retry feedback so content-management and integration-management screens speak the same feedback language. Keep each view’s workflows intact, but standardize the top-level feedback treatment and action-result visibility.
**Done when:**
- [ ] CRMView and KnowledgeBaseView use visibly consistent success/failure feedback patterns for async actions
- [ ] Retryable failures are surfaced in a similar way across both screens
- [ ] Shared primitives or helpers reduce one-off message rendering differences where practical
- [ ] All existing tests pass, new tests cover the aligned action-feedback treatment where added
**Why it matters:** These are both admin heavy-lifting screens, and consistent action feedback helps users trust that the system is responding predictably across different domains.
**Tradeoff:** The alignment should stay at the feedback-pattern level and not force unrelated workflows into the same detailed UI.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it improves coherence across two interaction-heavy admin surfaces.

### Task: Add admin-surface tests for delete-failure feedback and cross-screen action-result consistency
**Status:** proposed
**Files to change:** `dashboard/components/KnowledgeBaseView.tsx:L1-L420`, `dashboard/components/CRMView.tsx:L1-L320`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin non-blocking delete-failure feedback in KnowledgeBaseView and visible success/failure treatment for CRM async actions, then compare those screens with shared assertions around action-result messaging. Keep the tests centered on visible behavior so future cleanup work cannot quietly reintroduce blocking dialogs or inconsistent feedback.
**Done when:**
- [ ] KnowledgeBaseView is tested for visible non-blocking delete-failure feedback
- [ ] CRMView is tested for async action success/failure feedback visibility
- [ ] Shared assertions compare the action-result messaging patterns across both admin surfaces
- [ ] All existing tests pass, new tests protect the cross-screen feedback contract
**Why it matters:** These screens perform consequential admin actions, so visible and consistent result feedback is a core trust requirement rather than a polish detail.
**Tradeoff:** The tests should stay focused on action-result behavior and not sprawl into full feature suites for both screens.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it protects a subtle but important consistency line across two major admin workflows.

## Self-Review — 2026-04-17
**Cycles since last self-review:** 1
**What's working:** Verifying the live docs/ log path is routine now, and the recent-entry skim still lets me revisit a broad admin area by targeting a smaller leftover inconsistency instead of producing a duplicate batch.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The process is already giving enough structure to catch these smaller follow-up issues without more workflow changes.

## Ideas — 2026-04-18 (UI/UX patterns reviewed)

### Task: Add cross-step completion summaries between employee, shift, and go-live wizard steps
**Status:** proposed
**Files to change:** `dashboard/components/SetupWizard/StepEmployees.tsx:L1-L240`, `dashboard/components/SetupWizard/StepShifts.tsx:L1-L220`, `dashboard/components/SetupWizard/Step7GoLive.tsx:L1-L260`
**What to do:** Add a lightweight completion-summary pattern to the staffing-related wizard steps so each step shows what has already been configured before the user advances to the next one. Keep the current layouts, but expose concise “X employees added” or “Y shifts configured” summaries so the go-live step feels like the continuation of prior work rather than a fresh isolated screen.
**Done when:**
- [ ] StepEmployees and StepShifts show a concise completion summary when data exists
- [ ] Step7GoLive acknowledges staffing setup state before the activation call-to-action
- [ ] Summary treatment is visually consistent across the three steps and stays lightweight
- [ ] All existing tests pass, new tests cover summary rendering where added
**Why it matters:** The wizard feels more trustworthy when users can see continuity between completed setup work and the final launch step.
**Tradeoff:** The summaries should stay compact so they reinforce progress without cluttering already busy steps.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it improves continuity at a critical setup handoff.

### Task: Add richer retry and fallback affordances to Step7GoLive activation failures
**Status:** proposed
**Files to change:** `dashboard/components/SetupWizard/Step7GoLive.tsx:L1-L260`
**What to do:** Refine the failed activation state so it offers a clearer retry path, preserves the prior status context, and explains whether the user can proceed later without losing setup progress. Keep the existing activation card, but make failure recovery feel like part of the guided flow rather than a dead-end error panel.
**Done when:**
- [ ] Failed activation state includes a clear retry action and preserves relevant context
- [ ] The user can tell whether setup progress is intact and activation can be retried later
- [ ] Error and fallback copy feel consistent with the rest of the wizard’s guidance language
- [ ] All existing tests pass, new tests cover failure, retry, and fallback messaging
**Why it matters:** Go-live is the most emotionally loaded step in the wizard, so weak failure recovery there damages confidence disproportionately.
**Tradeoff:** This is recovery-state polish, so it should avoid expanding into provisioning logic changes.
**Size:** small (< 1hr)
**Impact:** high
**Effort vs Gain:** Low effort, high gain because it improves resilience at the wizard’s most consequential failure point.

### Task: Add staffing-to-launch wizard tests for progress summaries and activation recovery
**Status:** proposed
**Files to change:** `dashboard/components/SetupWizard/StepEmployees.tsx:L1-L240`, `dashboard/components/SetupWizard/StepShifts.tsx:L1-L220`, `dashboard/components/SetupWizard/Step7GoLive.tsx:L1-L260`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin completion-summary rendering, go-live prerequisite continuity, activation failure/retry behavior, and fallback messaging. Use shared assertions so the staffing-to-launch part of the wizard keeps a coherent progress-and-recovery contract.
**Done when:**
- [ ] StepEmployees and StepShifts are tested for summary/progress rendering
- [ ] Step7GoLive is tested for success, failure, retry, and later-activation fallback messaging
- [ ] Shared assertions compare continuity cues across the staffing-to-launch steps
- [ ] All existing tests pass, new tests protect this wizard handoff contract
**Why it matters:** These steps define the finish line of onboarding, and regressions in progress or recovery feedback are especially painful when users are trying to launch.
**Tradeoff:** The tests should stay focused on visible guidance and recovery behavior rather than provisioning internals.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects the most consequential wizard handoff with focused UX coverage.

## Self-Review — 2026-04-18
**Cycles since last self-review:** 1
**What's working:** The live docs/ artifact check is still necessary, and the recent-entry skim let me stay in the onboarding area while shifting from blocker messaging to progress-and-recovery continuity, which kept this batch distinct.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The process is still producing useful variety within a narrow area, so the main discipline remains path verification and angle selection rather than process edits.

## Ideas — 2026-04-18 (UI/UX patterns reviewed)

### Task: Extract shared search/filter toolbar primitives across customer and appointment list surfaces
**Status:** proposed
**Files to change:** `dashboard/components/AppointmentListSidebar.tsx:L1-L260`, `dashboard/components/CustomerListSidebar.tsx:L1-L260` if present, `dashboard/components/CRMView.tsx:L1-L320`, new `dashboard/components/ui/ListToolbar.tsx` or similar
**What to do:** Pull the repeated search input, result count, and quick-filter toolbar pattern used across customer- and appointment-oriented list surfaces into a narrow shared primitive. Keep each screen’s domain-specific filters local, but stop hand-authoring similar top-of-list controls with slightly different spacing and feedback treatment.
**Done when:**
- [ ] Appointment and customer list surfaces no longer duplicate the same search/filter toolbar markup inline
- [ ] Shared toolbar primitive supports search input, result count, and optional action/filter slots
- [ ] Existing dark-theme spacing and compact density remain intact across the surfaces that adopt it
- [ ] All existing tests pass, new tests cover the primitive’s supported toolbar variants if introduced
**Why it matters:** List/tooling headers are becoming a recurring pattern, and shared primitives would reduce drift while making adjacent operational views feel more cohesive.
**Tradeoff:** The toolbar should stay narrow so it does not become a generic layout shell for every list in the app.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it strengthens consistency across several high-traffic list workflows.

### Task: Add explicit no-selection and stale-selection clearing states to detail panels tied to list surfaces
**Status:** proposed
**Files to change:** `dashboard/components/AppointmentDetailPanel.tsx:L1-L420`, `dashboard/components/CustomerDetailPanel.tsx:L1-L344`, `dashboard/components/CRMView.tsx:L1-L320`
**What to do:** Standardize how list-driven detail panels behave when nothing is selected, the selected record disappears from filtered results, or the parent view reloads. Keep the existing list-plus-detail layouts, but ensure the detail area communicates no-selection and stale-selection transitions instead of quietly holding old context.
**Done when:**
- [ ] Appointment and customer detail panels show a deliberate no-selection state when nothing is selected
- [ ] Parent views clear or explain stale selections when filtering/reloading removes the active record
- [ ] Detail surfaces do not silently retain outdated data after list-driven context changes
- [ ] All existing tests pass, new tests cover no-selection and stale-selection behavior
**Why it matters:** Operators rely on list-detail coherence, and stale detail context is one of the easiest ways for these workflows to feel unreliable.
**Tradeoff:** This is state-coordination work, so it should avoid expanding into a broader rewrite of list data fetching.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it improves trust in the app’s most common list-detail interaction model.

### Task: Add list-detail parity tests for search filtering, no-selection, and stale-detail clearing
**Status:** proposed
**Files to change:** `dashboard/components/AppointmentListSidebar.tsx:L1-L260`, `dashboard/components/AppointmentDetailPanel.tsx:L1-L420`, `dashboard/components/CustomerDetailPanel.tsx:L1-L344`, `dashboard/components/CRMView.tsx:L1-L320`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin search/filter behavior, no-selection messaging, and stale-detail clearing across appointment and customer list-detail flows. Use shared assertions for the list-to-detail contract so regressions in one workflow are easy to compare with the other.
**Done when:**
- [ ] Appointment list/detail flow is tested for search filtering, no-selection, and stale-detail clearing
- [ ] Customer/CRM detail flow is tested for the same visible state transitions where applicable
- [ ] Shared assertions compare list-detail UX contract behavior across both domains
- [ ] All existing tests pass, new tests protect the app’s core list-detail interaction model
**Why it matters:** List-detail screens are the backbone of the dashboard, and consistent clearing and no-selection behavior directly affects day-to-day operator trust.
**Tradeoff:** The tests should stay on visible interaction-state behavior and not grow into exhaustive feature coverage of every sidebar or panel field.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it protects one of the dashboard’s most fundamental UX patterns.

## Self-Review — 2026-04-18
**Cycles since last self-review:** 1
**What's working:** Path verification is still catching the live docs/ append target reliably, and the recent-entry skim let me revisit familiar detail surfaces from the higher-level list-detail contract angle instead of repeating prior panel-specific notes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current process already encourages the right discipline, verify the live files, then choose a genuinely different angle on the code.

## Ideas — 2026-04-18 (UI/UX patterns reviewed)

### Task: Replace remaining raw action controls in TenantEditPanel and TenantCreateForm with shared primitives
**Status:** proposed
**Files to change:** `dashboard/components/TenantEditPanel.tsx:L260-L460`, `dashboard/components/TenantCreateForm.tsx:L1-L160`, `dashboard/components/ui/Button.tsx:L1-L220`, `dashboard/components/ui/Input.tsx:L1-L220`
**What to do:** Refactor the remaining custom-styled action controls in the tenant create/edit flow, especially the phone activation button and any raw submit/cancel affordances, so they use the shared button/input primitives consistently. Keep the existing admin layout and hierarchy, but move the last one-off controls back onto the dashboard’s design system.
**Done when:**
- [ ] TenantEditPanel no longer uses a raw styled button for phone activation
- [ ] TenantCreateForm and TenantEditPanel share the same primitive-driven submit/cancel interaction style
- [ ] Focus, disabled, loading, and failure-adjacent states are handled through shared primitives instead of inline control styling
- [ ] All existing tests pass, new tests cover any changed primitive-driven action states if relevant
**Why it matters:** The tenant flow is a core super-admin path, and every remaining one-off control makes the admin experience feel less cohesive than the rest of the dashboard.
**Tradeoff:** This is a targeted consistency pass, so it should avoid expanding into a larger redesign of tenant management.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it removes some of the last obvious primitive-reuse gaps from a high-traffic admin surface.

### Task: Add explicit no-selection and empty-detail continuity to tenant list/edit surfaces
**Status:** proposed
**Files to change:** `dashboard/components/TenantCard.tsx:L1-L220`, `dashboard/components/TenantEditPanel.tsx:L1-L460`, parent super-admin container if needed
**What to do:** Tighten the no-selection and empty-detail experience around the tenant list and edit panel so operators get a clearer explanation when no tenant is active, when a selected tenant disappears after changes, or when the panel is waiting on a newly created tenant. Keep the current list-plus-detail pattern, but make the empty/detail transitions feel deliberate rather than incidental.
**Done when:**
- [ ] Tenant detail surfaces show a clear no-selection state when no tenant is active
- [ ] The edit panel handles stale or recently deleted tenant selection with deliberate UI feedback
- [ ] Creating or switching tenants does not leave ambiguous blank detail space while the new context loads
- [ ] All existing tests pass, new tests cover no-selection and stale-selection behavior in the tenant workflow
**Why it matters:** Tenant management is one of the most consequential admin workflows, and unclear detail-panel transitions make the system feel riskier than it needs to.
**Tradeoff:** This is state-coordination work, so it should stay focused on visible transitions rather than broader tenant data-flow changes.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it improves trust in a central admin list-detail workflow.

### Task: Add tenant-admin parity tests for list selection, action states, and create/edit continuity
**Status:** proposed
**Files to change:** `dashboard/components/TenantCard.tsx:L1-L220`, `dashboard/components/TenantCreateForm.tsx:L1-L160`, `dashboard/components/TenantEditPanel.tsx:L1-L460`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin tenant-card selection, create-form submit states, edit-panel action feedback, phone-activation button behavior, and no-selection/stale-selection transitions. Use shared assertions for the tenant create/edit contract so the super-admin workflow stays coherent as individual screens change.
**Done when:**
- [ ] TenantCard is tested for selection and status-display behavior
- [ ] TenantCreateForm is tested for visible submit/disabled states
- [ ] TenantEditPanel is tested for action feedback, phone activation behavior, and no-selection/stale-selection transitions
- [ ] All existing tests pass, new tests protect the tenant-admin UX contract
**Why it matters:** This workflow spans list, create, and edit surfaces, and testing their visible contract together is the best way to prevent subtle admin regressions.
**Tradeoff:** The tests should stay on visible interaction-state behavior and avoid becoming deep end-to-end coverage of tenant provisioning logic.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it protects one of the dashboard’s most important admin flows with a coherent test lens.

## Self-Review — 2026-04-18
**Cycles since last self-review:** 1
**What's working:** Verifying the live docs/ append target has become routine, and the recent-entry skim let me revisit tenant admin from a narrower list-detail-and-primitive angle instead of repeating the earlier tenant UI pass.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current process is still producing distinct, bounded batches, so the main discipline remains path verification and angle selection rather than changing the workflow itself.

## Ideas — 2026-04-18 (UI/UX patterns reviewed)

### Task: Extract shared shell header and empty-state cards across OutlookLayout, DashboardHome, and ProfileView
**Status:** proposed
**Files to change:** `dashboard/components/OutlookLayout.tsx:L1-L260`, `dashboard/components/DashboardHome.tsx:L1-L260`, `dashboard/components/ProfileView.tsx:L1-L140`, new `dashboard/components/ui/PageHeader.tsx` and/or `dashboard/components/ui/EmptyStateCard.tsx`
**What to do:** Pull the repeated page-header and centered empty-state card patterns from the main shell surfaces into a couple of narrow UI primitives. Keep each view’s content and icons local, but stop hand-authoring similar title/subtitle/icon blocks and “coming soon”/no-data cards across top-level dashboard shells.
**Done when:**
- [ ] OutlookLayout, DashboardHome, and ProfileView no longer duplicate the same page-header structure inline
- [ ] Shared header/empty-state primitives support the existing icon, title, subtitle, and optional action variants
- [ ] Current dark-theme visual hierarchy remains intact or intentionally improved
- [ ] All existing tests pass, new tests cover the primitive variants if introduced
**Why it matters:** These shell surfaces define the app’s visual rhythm, and shared primitives would make them feel more coherent while reducing repeated presentational code.
**Tradeoff:** The primitives need to stay narrow so they improve consistency without turning into generic catch-all layout wrappers.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it improves consistency at the app’s most frequently seen shell level.

### Task: Add explicit unavailable and coming-soon shell treatment to ProfileView instead of static placeholder copy
**Status:** proposed
**Files to change:** `dashboard/components/ProfileView.tsx:L1-L140`
**What to do:** Replace the current italic “coming soon” placeholder block in ProfileView with a more deliberate unavailable/future-settings state that matches other dashboard shell feedback patterns. Keep the profile card layout, but make the unresolved settings area feel intentional and informative rather than like a stray temporary note.
**Done when:**
- [ ] ProfileView no longer uses a plain italic placeholder line for future settings
- [ ] The unavailable/future-settings state uses a structured card treatment consistent with other shell states
- [ ] The profile page communicates what is currently available versus what will be configurable later
- [ ] All existing tests pass, new tests cover the shell-level unavailable state
**Why it matters:** Static placeholder copy is easy to read as unfinished product residue, and ProfileView is visible enough that this weakens the perceived polish of the settings area.
**Tradeoff:** The replacement should stay lightweight so it clarifies the state without adding unnecessary detail to a simple page.
**Size:** small (< 1hr)
**Impact:** low
**Effort vs Gain:** Low effort, modest gain because it makes a visible shell surface feel more intentional.

### Task: Add shell-surface tests for shared header patterns and unavailable-state consistency
**Status:** proposed
**Files to change:** `dashboard/components/OutlookLayout.tsx:L1-L260`, `dashboard/components/DashboardHome.tsx:L1-L260`, `dashboard/components/ProfileView.tsx:L1-L140`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin shell-header rendering, icon/title/subtitle consistency, and unavailable/empty-state treatment across these top-level surfaces. Use shared assertions so future shell cleanups cannot quietly reintroduce inconsistent header or placeholder behavior.
**Done when:**
- [ ] OutlookLayout, DashboardHome, and ProfileView are tested for visible shell-header rendering
- [ ] ProfileView unavailable-state treatment is covered explicitly
- [ ] Shared assertions compare top-level shell-state and header patterns across the three views
- [ ] All existing tests pass, new tests protect the shell-surface consistency contract
**Why it matters:** Small shell inconsistencies compound quickly because users see these containers constantly, and focused tests make that drift easier to catch.
**Tradeoff:** The tests should stay centered on visible shell patterns rather than deep child-content coverage.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it protects the visual rhythm of the app’s top-level shell layer.

## Self-Review — 2026-04-18
**Cycles since last self-review:** 1
**What's working:** The live docs/ artifact check is still necessary, and the recent-entry skim helped me stay in the shell layer while shifting to a narrower header-and-empty-state consistency angle instead of repeating the last shell-state batch.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current workflow is already producing distinct batches inside the same broad area, so the main value remains disciplined file/path checks rather than more instruction changes.

## Ideas — 2026-04-18 (UI/UX patterns reviewed)

### Task: Add shared panel-shell primitives across scheduler side panels
**Status:** proposed
**Files to change:** `dashboard/components/scheduler/AppointmentPopover.tsx:L1-L220`, `dashboard/components/scheduler/QuickBookPanel.tsx:L1-L320`, `dashboard/components/scheduler/EmployeeDayFocusPanel.tsx:L1-L220`, new `dashboard/components/ui/SidePanel.tsx` or scheduler-local shell primitive
**What to do:** Extract the repeated side-panel shell structure used by scheduler overlays, title row, close action, scroll body, and padded sections, into a narrow shared panel primitive. Keep each panel’s booking/detail logic local, but stop hand-authoring similar fixed-position shell markup with slightly different spacing and close-control treatment.
**Done when:**
- [ ] QuickBookPanel and EmployeeDayFocusPanel no longer duplicate side-panel shell markup inline
- [ ] AppointmentPopover and other scheduler overlays can share the same close/header/body pattern where appropriate
- [ ] Shared shell supports title, optional icon, close action, and scrollable body without forcing identical inner layouts
- [ ] All existing tests pass, new tests cover the shell primitive variants if introduced
**Why it matters:** The scheduler is becoming a mini-product inside the dashboard, and shared overlay shells would make it feel much more cohesive while reducing repetitive layout code.
**Tradeoff:** The primitive should stay scheduler-focused so it does not become an awkward generic overlay abstraction for unrelated screens.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it improves consistency across several high-visibility scheduler overlays.

### Task: Add explicit loading, empty, and handoff states to EmployeeDayFocusPanel timeline content
**Status:** proposed
**Files to change:** `dashboard/components/scheduler/EmployeeDayFocusPanel.tsx:L1-L220`
**What to do:** Refine the focus panel so it distinguishes between “loading appointments”, “no appointments today”, and “no employee selected” instead of only rendering nothing or the final empty timeline message. Keep the current right-side panel layout, but make panel opening and data-refresh states feel deliberate rather than instantaneous or silent.
**Done when:**
- [ ] EmployeeDayFocusPanel has a visible loading state before appointment/shifts data is ready
- [ ] Empty-day messaging is distinct from the not-open/not-selected case
- [ ] Opening the panel does not briefly rely on stale prior data or silent blank content
- [ ] All existing tests pass, new tests cover loading and empty timeline states
**Why it matters:** This panel is designed for quick operator decisions, and ambiguous opening states make it harder to trust the day snapshot at a glance.
**Tradeoff:** The extra state handling should stay lightweight so it does not slow down the panel’s quick-inspection feel.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it clarifies a fast, decision-oriented scheduler panel.

### Task: Add scheduler-overlay tests for shell consistency, close controls, and empty/loading panel states
**Status:** proposed
**Files to change:** `dashboard/components/scheduler/AppointmentPopover.tsx:L1-L220`, `dashboard/components/scheduler/QuickBookPanel.tsx:L1-L320`, `dashboard/components/scheduler/EmployeeDayFocusPanel.tsx:L1-L220`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin overlay close behavior, shell header consistency, focus-panel loading/empty states, and quick-book panel open/close interactions. Use shared assertions so scheduler overlays maintain a coherent interaction contract as they evolve separately.
**Done when:**
- [ ] Scheduler overlays are tested for visible close controls and dismissal behavior
- [ ] EmployeeDayFocusPanel is tested for loading and empty timeline states
- [ ] QuickBookPanel and other overlay shells are compared for consistent header/body behavior where applicable
- [ ] All existing tests pass, new tests protect the scheduler-overlay UX contract
**Why it matters:** These overlays are some of the most interactive surfaces in the scheduler, and consistency across them directly affects usability during rapid front-desk work.
**Tradeoff:** The tests should focus on visible overlay behavior and not turn into broad scheduler integration tests.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it protects a cluster of interaction-heavy scheduler surfaces with one coherent test lens.

## Self-Review — 2026-04-18
**Cycles since last self-review:** 1
**What's working:** The live docs/ path check is still catching the real append target, and the recent-entry skim let me move into scheduler overlays with a clearly different shell-and-handoff angle instead of repeating prior scheduler notes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current process is still yielding distinct, bounded batches, so the value is in disciplined file selection and path verification rather than more instruction changes.

## Ideas — 2026-04-18 (UI/UX patterns reviewed)

### Task: Replace bespoke ErrorBoundary fallback styling with shared failure-state primitives
**Status:** proposed
**Files to change:** `dashboard/components/ErrorBoundary.tsx:L1-L52`, `dashboard/components/ui/Card.tsx:L1-L220`, `dashboard/components/ui/Button.tsx:L1-L220`
**What to do:** Rebuild the default ErrorBoundary fallback using the shared dashboard card and button primitives instead of a custom red panel and raw button styling. Keep the simple retry/reset interaction, but make the failure surface feel like part of the same design system as the rest of the app.
**Done when:**
- [ ] ErrorBoundary fallback no longer uses bespoke container and button markup/styles
- [ ] Retry action uses the shared button primitive with consistent focus and disabled behavior
- [ ] Failure-state container uses a shared card-style treatment that still preserves error emphasis
- [ ] All existing tests pass, new tests cover default fallback rendering and reset behavior
**Why it matters:** Error boundaries are globally visible recovery surfaces, and a custom fallback makes failures feel disconnected from the dashboard’s otherwise consistent UI.
**Tradeoff:** This should stay a narrow consistency pass, not expand into a full-blown error-reporting component.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it cleans up a globally visible failure state.

### Task: Add explicit action-result feedback to deleted-record restore and history-copy flows
**Status:** proposed
**Files to change:** `dashboard/components/DeletedRecordsPanel.tsx:L1-L320`, `dashboard/components/RecordHistoryModal.tsx:L1-L360`
**What to do:** Refine the restore and copy-fields flows so success, failure, and in-progress feedback appears next to the relevant action instead of relying mainly on indirect state changes or broad panel refreshes. Keep the current workflows, but make action outcomes obvious before the user has to infer success from disappearing items or changed history.
**Done when:**
- [ ] Restore actions show visible in-progress and post-action feedback near the trigger point
- [ ] Copy-fields/history actions expose clear success/failure states without requiring the user to infer results indirectly
- [ ] Recovery panels remain readable while making action outcomes more explicit
- [ ] All existing tests pass, new tests cover visible action-result feedback
**Why it matters:** Recovery flows are inherently high-trust, and users should not have to guess whether a restore or history action actually succeeded.
**Tradeoff:** The added feedback should stay lightweight so it improves clarity without cluttering already dense recovery surfaces.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it improves confidence in sensitive recovery workflows.

### Task: Add recovery-surface tests for error fallback consistency and action-result visibility
**Status:** proposed
**Files to change:** `dashboard/components/ErrorBoundary.tsx:L1-L52`, `dashboard/components/DeletedRecordsPanel.tsx:L1-L320`, `dashboard/components/RecordHistoryModal.tsx:L1-L360`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin default error-boundary fallback behavior, visible restore/copy feedback, and recovery action progress states across the deleted-record and version-history surfaces. Use shared assertions so these failure/recovery surfaces keep a coherent interaction contract.
**Done when:**
- [ ] ErrorBoundary is tested for default fallback rendering and retry/reset behavior
- [ ] DeletedRecordsPanel is tested for visible restore progress/success/failure feedback
- [ ] RecordHistoryModal is tested for copy/history action-result visibility
- [ ] All existing tests pass, new tests protect the recovery-surface UX contract
**Why it matters:** These components only matter when something goes wrong or needs restoration, so regressions in their visible behavior are especially damaging to user trust.
**Tradeoff:** The tests should stay on visible interaction states rather than over-specifying cosmetic details.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it protects several high-sensitivity recovery experiences with one focused suite.

## Self-Review — 2026-04-18
**Cycles since last self-review:** 1
**What's working:** The live docs/ path check is still paying for itself, and revisiting recovery surfaces from a clearer primitive-and-action-feedback angle kept this batch distinct from the earlier recovery notes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current process already supports useful revisits as long as I keep validating the live files and picking a sharper sub-angle instead of repeating the same broad critique.

## Ideas — 2026-04-18 (UI/UX patterns reviewed)

### Task: Replace blocking confirm/alert flows in EmployeeManagementView with shared modal and toast feedback
**Status:** proposed
**Files to change:** `dashboard/components/EmployeeManagementView.tsx:L1-L360`, `dashboard/components/ui/ConfirmModal.tsx:L1-L220`, `dashboard/components/ui/Toast.tsx:L1-L220`, `dashboard/components/ui/useConfirm.tsx:L1-L220` if present
**What to do:** Refactor employee delete and service-mapping failure flows so they use the shared confirm-modal and non-blocking feedback patterns instead of browser `confirm()` and `alert()`. Keep the current delete and service-toggle behavior, but make destructive confirmation and error reporting consistent with the rest of the dashboard’s UI system.
**Done when:**
- [ ] EmployeeManagementView no longer uses browser `confirm()` for delete confirmation
- [ ] Delete and service-toggle failures no longer use blocking `alert()` dialogs
- [ ] Confirmation, success, and failure feedback use the shared modal/toast approach already present elsewhere in the dashboard
- [ ] All existing tests pass, new tests cover confirm/cancel/delete and mapping-failure feedback
**Why it matters:** Browser-native dialogs feel jarring on a polished admin surface, and blocking error popups make staffing edits feel less trustworthy and less consistent than the rest of the app.
**Tradeoff:** This should stay scoped to feedback mechanics, not a larger redesign of the employee-management workflow.
**Size:** small (< 1hr)
**Impact:** high
**Effort vs Gain:** Low effort, high gain because it removes the last bits of browser-native friction from a frequently used management screen.

### Task: Add explicit mapping-load and empty-assignment states to EmployeeManagementView cards and quick-edit modal
**Status:** proposed
**Files to change:** `dashboard/components/EmployeeManagementView.tsx:L1-L360`
**What to do:** Refactor the employee cards and quick-edit modal so mapping fetches, unmapped employees, and missing-services prerequisites are communicated through deliberate loading and empty states instead of silent fallbacks like "No services provided" or an empty matrix of pills. Keep the card-and-modal layout, but make it obvious whether services are still loading, not configured, or simply not assigned to a given employee.
**Done when:**
- [ ] Employee cards distinguish between loading mappings, no available services, and no assignments for that employee
- [ ] The quick-edit modal communicates when service assignment data is unavailable or still loading
- [ ] Empty-state messaging explains the next useful action, such as creating services first
- [ ] All existing tests pass, new tests cover mapping-loading and empty-assignment rendering
**Why it matters:** Staffing setup depends on service relationships, and unclear empty states make it hard to tell whether the system is empty, broken, or just still loading.
**Tradeoff:** The extra messaging should stay compact so the screen does not become visually noisy once data is present.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it clarifies a common setup workflow that currently has ambiguous silent fallbacks.

### Task: Add workforce-screen tests for employee delete confirmation, mapping feedback, and empty assignment states
**Status:** proposed
**Files to change:** `dashboard/components/EmployeeManagementView.tsx:L1-L360`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin delete confirmation behavior, mapping-toggle error feedback, unmapped/no-services messaging, and quick-edit modal assignment-state handling in EmployeeManagementView. Keep the suite focused on visible interaction states so staffing-screen feedback stays reliable as the implementation evolves.
**Done when:**
- [ ] EmployeeManagementView is tested for confirm/cancel delete behavior
- [ ] Mapping-toggle failures are tested for visible non-blocking feedback
- [ ] Empty assignment and no-services states are tested in both the card list and quick-edit modal where relevant
- [ ] All existing tests pass, new tests protect the employee-management UX contract
**Why it matters:** Employee management is a high-frequency admin surface, and regressions in destructive actions or assignment feedback create day-to-day friction quickly.
**Tradeoff:** The tests should stay centered on visible UI states and not expand into deeper mapping business logic coverage.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it protects a key workforce-management workflow with focused UI-state coverage.

## Self-Review — 2026-04-18
**Cycles since last self-review:** 1
**What's working:** Verifying the live docs/ path is still saving wasted writes, and this cycle surfaced a very concrete browser-dialog inconsistency in a high-frequency admin workflow instead of another broad shell-level note.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The current process is already good at finding sharp, bounded issues as long as I keep validating the active files and choosing a fresh angle.

## Ideas — 2026-04-18 (UI/UX patterns reviewed)

### Task: Add explicit no-selection and no-call-context treatment to VoiceCallsView side panels
**Status:** proposed
**Files to change:** `dashboard/components/VoiceCallsView.tsx:L1-L520`
**What to do:** Refine the voice-call detail panes so transcript, summary, and customer-context sections distinguish between “no call selected”, “call selected but no data captured yet”, and “data unavailable due to fetch failure”. Keep the current two-pane layout, but remove cases where blank card bodies force the operator to guess why detail content is missing.
**Done when:**
- [ ] VoiceCallsView shows a clear no-selection state before a call is chosen
- [ ] Transcript, summary, and customer-context panels distinguish empty data from unavailable/failed data
- [ ] Visible detail content does not silently collapse into blank card space when a section has no payload
- [ ] All existing tests pass, new tests cover no-selection and no-data detail states
**Why it matters:** Voice-call review is a trust-heavy workflow, and ambiguous blank detail regions make operators doubt whether the system captured the call correctly.
**Tradeoff:** The extra messaging should stay lightweight so it clarifies missing data without making the detail pane noisy.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it sharpens clarity in a complex, high-trust operational surface.

### Task: Add shell-level unavailable-state messaging to AIInsightsView tab handoff
**Status:** proposed
**Files to change:** `dashboard/components/AIInsightsView.tsx:L1-L80`, `dashboard/components/AIConfigView.tsx:L1-L360`, `dashboard/components/AnalyticsView.tsx:L1-L320`
**What to do:** Add a light shell-level unavailable/empty handoff state in AIInsightsView so the tab container can communicate when underlying persona or analytics content is unavailable before the child view fully renders. Keep the current FolderTab layout, but make the parent shell do a bit more explanatory work when one sub-view is blocked or not configured.
**Done when:**
- [ ] AIInsightsView can render a shell-level unavailable/empty message before delegating fully to child content
- [ ] Tab switches do not leave the shell looking blank while blocked child views decide what to show
- [ ] The shell-level message remains lightweight and consistent with FolderTab visual language
- [ ] All existing tests pass, new tests cover unavailable/empty shell handoff behavior
**Why it matters:** The AI section is a nested shell, and without lightweight parent-level guidance, blocked child content can feel like a rendering bug instead of an intentional state.
**Tradeoff:** This should stay a thin shell enhancement, not duplicate the full empty-state logic already owned by child views.
**Size:** small (< 1hr)
**Impact:** medium
**Effort vs Gain:** Low effort, worthwhile gain because it improves perceived continuity across the AI section tabs.

### Task: Add insight-surface tests for voice no-data detail states and AI shell handoff behavior
**Status:** proposed
**Files to change:** `dashboard/components/VoiceCallsView.tsx:L1-L520`, `dashboard/components/AnalyticsView.tsx:L1-L320`, `dashboard/components/AIInsightsView.tsx:L1-L80`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin no-selection/no-data detail behavior in VoiceCallsView, loading/no-data handling in AnalyticsView, and shell-level handoff behavior in AIInsightsView. Use shared assertions around visible unavailable-state treatment so the product’s insight surfaces keep a coherent UX contract.
**Done when:**
- [ ] VoiceCallsView is tested for no-selection and empty-detail panel behavior
- [ ] AnalyticsView is tested for loading and no-data shell treatment
- [ ] AIInsightsView is tested for tab-shell handoff behavior when child content is unavailable
- [ ] All existing tests pass, new tests protect the insight-surface UX contract
**Why it matters:** These surfaces present interpreted operational information, and users need a clear, consistent explanation when that information is absent or delayed.
**Tradeoff:** The tests should stay at the visible-shell/detail state level and avoid deep chart or data-transform assertions.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it protects the most ambiguity-prone parts of the app’s insight layer.

## Self-Review — 2026-04-18
**Cycles since last self-review:** 1
**What's working:** The live docs/ path check is still necessary, and the recent-entry skim let me revisit the insight area from a more specific empty-detail and shell-handoff angle instead of repeating the earlier stat-card batch.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The process is already giving me enough structure to revisit broad areas productively as long as I keep choosing a genuinely narrower slice.

## Ideas — 2026-04-18 (UI/UX patterns reviewed)

### Task: Replace console-only analytics failure handling with visible shell feedback across analytics and insights surfaces
**Status:** proposed
**Files to change:** `dashboard/components/AnalyticsView.tsx:L1-L260`, `dashboard/components/AIInsightsView.tsx:L1-L120`, `dashboard/components/VoiceCallsView.tsx:L1-L520`, shared toast/empty-state primitives if needed
**What to do:** Refactor the analytics and insights shells so failed data loads use visible in-flow feedback rather than `console.error` or silent fallbacks to empty UI. Keep the current layouts, but ensure users can distinguish between “no data yet” and “failed to load the data” across analytics, AI insights, and voice insights surfaces.
**Done when:**
- [ ] AnalyticsView no longer relies on console-only failure handling for load errors
- [ ] AIInsightsView and VoiceCallsView follow the same visible failure-state pattern when underlying insight data is unavailable
- [ ] “No data” and “load failed” states are visually distinct across the three screens
- [ ] All existing tests pass, new tests cover visible failure-state rendering where added
**Why it matters:** Insight surfaces are only useful if users can trust what missing content means, and silent failure handling undermines that trust immediately.
**Tradeoff:** The added feedback should stay lightweight so it clarifies failure without drowning the screens in extra chrome.
**Size:** medium (1-3hr)
**Impact:** high
**Effort vs Gain:** Moderate effort, high gain because it fixes a trust issue across several summary-driven operational screens.

### Task: Extract shared no-data and unavailable-state cards for analytics-style screens
**Status:** proposed
**Files to change:** `dashboard/components/AnalyticsView.tsx:L1-L320`, `dashboard/components/AIInsightsView.tsx:L1-L120`, `dashboard/components/VoiceCallsView.tsx:L1-L520`, new `dashboard/components/ui/InsightEmptyState.tsx` or similar
**What to do:** Pull the repeated “no data yet”, “placeholder”, and unavailable-state card treatments from analytics-oriented screens into a narrow reusable primitive. Keep each screen’s copy and icon choices local, but standardize the shell treatment so insight surfaces feel like one coherent family.
**Done when:**
- [ ] Analytics, AI insights, and voice insights surfaces no longer hand-roll their empty/unavailable card structures independently
- [ ] Shared primitive supports icon, title, short description, and optional action/retry affordance
- [ ] Existing visual hierarchy remains consistent with the dark theme and insight-card layouts
- [ ] All existing tests pass, new tests cover the empty-state primitive variants if introduced
**Why it matters:** These surfaces are all communicating absence or partial availability of insight data, so consistent empty-state treatment helps users parse them faster.
**Tradeoff:** The primitive should stay tightly scoped to insight-state cards, not become another generic container abstraction.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it reduces drift across a growing family of analytics-style screens.

### Task: Add insight-surface tests for failure visibility, no-data cards, and placeholder consistency
**Status:** proposed
**Files to change:** `dashboard/components/AnalyticsView.tsx:L1-L320`, `dashboard/components/AIInsightsView.tsx:L1-L120`, `dashboard/components/VoiceCallsView.tsx:L1-L520`, corresponding dashboard test files (new if needed)
**What to do:** Add focused component tests that pin load-failure visibility, no-data card rendering, placeholder card treatment, and unavailable-state messaging across analytics, AI insights, and voice insights views. Use shared assertions so the product’s insight layer maintains one clear contract for absent or failed data.
**Done when:**
- [ ] AnalyticsView is tested for visible load-failure and no-data states
- [ ] AIInsightsView is tested for tab-shell unavailable/placeholder treatment
- [ ] VoiceCallsView is tested for no-selection/no-data insight-card behavior
- [ ] All existing tests pass, new tests protect the insight-surface empty/failure contract
**Why it matters:** These screens summarize important operational signals, and users need consistent cues when the signal is absent, delayed, or broken.
**Tradeoff:** The tests should remain focused on visible shell/card behavior rather than deeper data-calculation logic.
**Size:** medium (1-3hr)
**Impact:** medium
**Effort vs Gain:** Moderate effort, worthwhile gain because it protects a subtle but important trust layer in the product.

## Self-Review — 2026-04-18
**Cycles since last self-review:** 1
**What's working:** The live docs/ target check remains necessary, and this cycle revisited the insight layer from a sharper failure-visibility angle instead of duplicating the earlier no-selection and stat-card notes.
**What I changed in HEARTBEAT.md:** No changes needed
**Why:** The process is still producing distinct, bounded follow-ups as long as I keep validating the active files and choosing a genuinely narrower angle within a broader area.
