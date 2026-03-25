# Suggested Refactorings

**Created:** 2026-03-24
**Last updated:** 2026-03-24

---

## Group 1: Quick Wins (can do right now)

| # | Item | Area | Severity |
|---|------|------|----------|
| 1 | **Add fetch timeouts** to `shared/getEmbedding.ts` and `normalizeForEmbedding.ts` — bare `fetch()` with no AbortController | Edge/Shared | Serious |
| 2 | **Standardize pool usage** — `tenants.ts` has 11 manual `pool.connect()` calls, `billing.ts` uses direct `pool.query()` — should all use `withPoolClient()` | Backend | Serious |
| 3 | **Extract auth logout utility** — logout logic duplicated 4x in `dashboard/lib/api.ts` + `hooks.ts` + `SessionContext.tsx` | Dashboard | Serious |
| 4 | **Fix Vapi error response format** — DomainError returns `{result: {success: false}}` with 200, but validation errors return `{error: "..."}` with 400. Vapi expects consistent shape | Edge | Serious |
| 5 | **Wrap all routes with `withHandler()`** — `auth.ts` and `billing.ts` use manual try/catch instead of the shared wrapper | Backend | Moderate |
| 6 | **Add env validation on startup** — `VAPI_API_KEY`, `STRIPE_SECRET_KEY`, `OPENAI_API_KEY` silently default to empty string | Backend + Edge | Moderate |
| 7 | **Button prop cleanup** — accepts both `isLoading` and `loading` (backwards-compat cruft) | Dashboard | Minor |
| 8 | **Modal Escape key** — no keyboard handler to close on Escape | Dashboard | Minor |

---

## Group 2: Structural Improvements (next session)

| # | Item | Area | Severity |
|---|------|------|----------|
| 9 | **Add Zod schemas to all routes** — only 3 of 16 routes validate input; rest use `req.body as {...}` casts | Backend | Serious |
| 10 | **Split large components** — AppointmentView (838 lines), SuperAdminDashboard (746), CRMView (560), SetupWizard/index (623) | Dashboard | Serious |
| 11 | **Remove `overrideTenantId` prop drilling** — passed through 49 components; should use SessionContext's `managedTenantId` instead | Dashboard | Serious |
| 12 | **Standardize error response format** — backend returns 3+ different error shapes (`{error}`, `{success, error}`, `{success, error, code}`) | Backend | Moderate |
| 13 | **Create `useFormState` hook** — every CRUD view manually manages form state with identical boilerplate | Dashboard | Moderate |
| 14 | **Fix edge function repo cleanup** — global `PostgresRepository` never calls `close()` after request; connections may leak | Edge | Serious |
| 15 | **Add connection pool timeout** — pool created with hardcoded size 3, no connection timeout set | Edge | Serious |
| 16 | **Consolidate SessionContext vs useSession** — two sources of truth for auth state | Dashboard | Moderate |

---

## Group 3: Production Hardening (before launch)

| # | Item | Area | Severity |
|---|------|------|----------|
| 17 | **Add retry logic for transient DB errors** in edge function `withClient()` — single attempt, no backoff | Edge | Moderate |
| 18 | **Create config constants file** — hardcoded pagination limits (200, 1000), default timezone scattered across routes | Backend | Moderate |
| 19 | **Dynamic SQL builder utility** — `appointments.ts` and `resources.ts` build UPDATE queries with fragile manual index tracking | Backend | Moderate |
| 20 | **Add request correlation ID** — no way to trace a request across backend + edge function logs | Backend + Edge | Moderate |
| 21 | **Activate RAG normalization** — `normalized_text` column exists but edge function never populates it; `search_tenant_docs()` still queries raw `content` | Edge | Moderate |
| 22 | **Add Zod validation for edge function dispatcher args** — `get_scheduling_options` and `book_with_scheduling` don't validate input structure | Edge | Moderate |
| 23 | **Hardcoded strings → constants** — error messages, labels, UI copy scattered throughout dashboard | Dashboard | Minor |
| 24 | **Granular data hooks** — `useStaticData` fetches all 5 resource types even when component only needs 1-2 | Dashboard | Minor |

---

## Progress

| # | Status | Date | Notes |
|---|--------|------|-------|
| 1 | Done | 2026-03-24 | AbortController + timeout on getEmbedding (10s) and normalizeForEmbedding (15s) |
| 2 | Done | 2026-03-24 | All 11 pool.connect() in tenants.ts replaced with withPoolClient() |
| 3 | Done | 2026-03-24 | Extracted forceLogout() + checkAuthFailure() in api.ts; hooks.ts + SessionContext use it |
| 4 | Done | 2026-03-24 | All edge function errors now return {result: {success: false, error}} with status 200 |
| 5 | Done | 2026-03-24 | auth.ts login + register wrapped with withHandler() + withPoolClient() |
| 6 | Done | 2026-03-24 | Production env validation (fatal on missing DB/JWT/OpenAI/Stripe); edge function warns |
| 7 | Done | 2026-03-24 | Removed deprecated `loading` prop; standardized on `isLoading` across 12 callers |
| 8 | Done | 2026-03-24 | Modal closes on Escape key + backdrop click |
| 9 | Done | 2026-03-24 | Zod schemas added to tenants, employees, shifts, resources, services, skills, calendar routes |
| 10 | Done | 2026-03-24 | Split 4 oversized components: AppointmentView (extracted AppointmentListSidebar + AppointmentDetailPanel), SuperAdminDashboard (extracted TenantCard + TenantCreateForm + TenantEditPanel), CRMView (extracted CustomerDetailPanel), SetupWizard/index (extracted WizardStepContent) |
| 11 | Done | 2026-03-24 | Removed overrideTenantId from ~20 components; useActiveTenantId() from SessionContext |
| 12 | Done | 2026-03-24 | All error responses standardized to `{ success: false, error, details? }` |
| 13 | Done | 2026-03-24 | useFormState hook created in hooks.ts (generic form state + dirty tracking) |
| 14 | Done | 2026-03-24 | connectWithTimeout() wrapper with 5s timeout; pool size reduced to 2 for serverless |
| 15 | Done | 2026-03-24 | (Combined with #14) |
| 16 | Done | 2026-03-24 | Removed useSession hook; all components use useActiveTenantId() from SessionContext |
| 17 | Done | 2026-03-24 | Retry logic for transient DB errors (connection_failure, deadlock, admin_shutdown). Up to 2 retries with 200ms backoff. Logs pg_code on retry. |
| 18 | Done | 2026-03-24 | Config constants (DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, DEFAULT_TIMEZONE, MAX_FILE_SIZE_BYTES) in src/constants.ts |
| 20 | Done | 2026-03-24 | X-Request-Id correlation header on all edge function responses. jsonResponse() helper standardizes response creation. |
| 19 | Done | 2026-03-24 | Replaced with book_with_scheduling_atomic() — single SQL function does the entire find+book flow, eliminating the dynamic query builder need |
| 21 | Done | 2026-03-24 | Edge function uses search_tenant_docs_normalized() RPC. Query normalization was already wired. |
| 22 | Done | 2026-03-24 | Zod schemas for get_scheduling_options and book_with_scheduling. All 7 edge function tools validated. Schema lookup table replaces if/else chain. |
