# SecretaryHQ Architecture Review — April 3, 2026

Deep structural analysis across backend, dashboard, database, and edge functions.

---

## CRITICAL FINDINGS (Fix Before Production)

### 1. Booking RPC shift_override logic bug
**File:** `supabase/migrations/20260403000000_shift_overrides.sql` lines 217-225
**Issue:** If an employee has `is_off = true` override AND a weekly pattern for the same day, the LEFT JOIN can match the pattern row in the second OR branch, bypassing the day-off.
**Fix:** Add `AND (so.id IS NULL OR so.is_off = false)` to the pattern fallback condition.

### 2. check_coverage_gaps() ignores shift_overrides
**File:** `supabase/migrations/20260318000000_coverage_gaps.sql` lines 79-124
**Issue:** Only checks `employee_shifts`, never `shift_overrides`. Coverage reports will show full coverage on days employees have overrides marking them OFF.
**Fix:** Add LEFT JOIN to shift_overrides, same pattern as the booking RPC.

### 3. Edge function hardcodes Central Time
**File:** `supabase/functions/vapi-tools/core/dispatcher.ts` lines 38-51
**Issue:** `assumeCentralTime()` hardcodes CDT/CST offsets for all tenants. Non-Chicago tenants get wrong booking times via voice AI.
**Fix:** Query `tenants.timezone` from DB before converting times.

### 4. RLS admin bypass policy too permissive
**File:** `supabase/migrations/20260403000000_shift_overrides.sql` lines 27-28
**Issue:** Admin bypass policy allows access when `current_setting('app.current_tenant_id')` is NULL or empty. Should use the same NULLIF pattern as other tables.
**Fix:** Use `NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID` check.

### 5. No rate limiting on backend
**File:** `src/index.ts`
**Issue:** No rate limiting on login, webhooks, or API endpoints. Brute-force and DoS risk.
**Fix:** Add `@fastify/rate-limit` — e.g. 5 failed logins = 10min lockout, 100 webhook events/min per tenant.

### 6. No security headers (Helmet)
**File:** `src/index.ts`
**Issue:** No X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security headers.
**Fix:** `app.register(helmet)` — one line.

---

## HIGH PRIORITY

### Backend

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| 7 | CORS allows any origin (`origin: true`) | `src/index.ts:95-98` | Restrict to `process.env.CORS_ORIGIN` |
| 8 | Fire-and-forget sync errors use `console.error` not structured logging | `src/routes/appointments.ts:63-67`, `customers.ts:88-91` | Use `req.log.error()` or extract to service layer |
| 9 | Business logic (sync coordination) lives in routes, not services | `src/routes/appointments.ts`, `customers.ts` | Extract `syncAcrossProviders()` service function |
| 10 | `splitName()` duplicated in jobberSync.ts and hubspotSync.ts | `src/services/jobberSync.ts`, `hubspotSync.ts` | Extract to shared utils |

### Dashboard

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| 11 | SettingsView.tsx is 1,008 lines with 5 near-identical CRM sections | `dashboard/components/SettingsView.tsx` | Extract reusable `CRMIntegrationCard` component |
| 12 | Silent error swallowing — 40+ catch blocks just `console.error()` | Throughout SettingsView, SuperAdminDashboard, etc. | Add user-facing error feedback (toast or inline) |
| 13 | Knowledge ingest fetch missing auth headers | `dashboard/lib/api.ts:452-463` | Add `headers: getHeaders()` to formData fetch |
| 14 | No token refresh — 401 forces logout with no recovery | `dashboard/lib/api.ts:20-29` | Add token expiry check + refresh endpoint |
| 15 | AppointmentDetailPanel receives 20+ props | `dashboard/components/AppointmentDetailPanel.tsx:39-63` | Create AppointmentFormContext |

### Database / Edge Functions

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| 16 | Edge function repository has no shift_overrides support | `supabase/functions/vapi-tools/db/repository.ts:377-385` | Add override-aware queries |
| 17 | `get_effective_shifts()` RPC not used by edge functions or shared code | `20260403000000_shift_overrides.sql:37-86` | Use in repository.ts for voice AI scheduling |
| 18 | `shared/scheduling.ts` doesn't support shift_overrides | `shared/scheduling.ts:86-100` | Extend `isEmployeeOnShift()` with override support |
| 19 | employee_shifts table missing `updated_at` column | `20260312000002_employee_shifts.sql` | ADD COLUMN migration |
| 20 | Seed.sql may be out of sync with UUID employee IDs | `supabase/seed.sql:122` | Verify employee ID types match schema |

---

## MEDIUM PRIORITY

### Backend
| # | Issue | Location |
|---|-------|----------|
| 21 | `app: any` on all 20 route registration functions | All `src/routes/*.ts` |
| 22 | Inconsistent error logging — some services log, others don't | CRM sync services |
| 23 | Silent JWT failure (invalid tokens return null, not logged) | `src/index.ts:165-170` |

### Dashboard
| # | Issue | Location |
|---|-------|----------|
| 24 | Modal has no focus trap (tab can escape modal) | `dashboard/components/ui/Modal.tsx` |
| 25 | Form inputs missing `htmlFor`/`id` associations | Throughout CRMView, SettingsView |
| 26 | No lazy loading for tab content (all views imported eagerly) | `dashboard/app/dashboard/page.tsx` |
| 27 | `certRedirectTriggered` flag never resets after successful redirect | `dashboard/lib/api.ts:95-108` |
| 28 | `useFormState()` hook exists but many components duplicate the pattern manually | CRMView, SettingsView |
| 29 | SetupWizard/index.tsx is 584 lines with mixed concerns | `dashboard/components/SetupWizard/index.tsx` |

### Database
| # | Issue | Location |
|---|-------|----------|
| 30 | Night shifts (23:00-02:00) fail time comparison in booking RPC | `20260403000000_shift_overrides.sql:219-220` |
| 31 | N+1 queries in `getAvailableSlots()` (3 separate queries) | `repository.ts:507-543` |
| 32 | `check_availability_with_tz()` likely doesn't check shift_overrides | Coverage RPCs |

---

## WHAT'S WORKING WELL

These areas are solid and don't need changes:

- **SQL injection protection** — All queries parameterized across all 20 routes. Zero risk detected.
- **Zod validation** — Every route validates input with schemas. No raw body access.
- **withTenantClient / RLS** — Tenant isolation is comprehensive with FORCE RLS on all tables.
- **Token management** — `tokenManagement.ts` handles refresh for all 4 CRM providers + 2 calendars with expiry buffers.
- **Webhook signature verification** — All 5 providers (Stripe, Jobber, HubSpot, Square, ServiceTitan) properly verify signatures.
- **OAuth state parameter** — CSRF protection implemented on all OAuth flows.
- **Graceful shutdown** — SIGTERM/SIGINT handlers close Fastify + drain DB pool.
- **Connection handling** — All routes use try/finally with client.release(). No leaks.
- **Transactions** — Critical operations (register, update appointment) use BEGIN/COMMIT/ROLLBACK.
- **Dashboard API client** — Well-organized namespaced `Api.{resource}.{action}()` pattern with typed returns.
- **Scheduler components** — Good use of useMemo/useCallback for expensive computations.
- **Time formatting** — Now consolidated in `dashboard/lib/utils.ts` (done today).

---

## RECOMMENDED FIX ORDER

**Phase 1 — Critical (before production)**
1. Fix booking RPC override logic bug (#1)
2. Fix RLS admin bypass policy (#4)
3. Add rate limiting (#5)
4. Add Helmet.js security headers (#6)
5. Restrict CORS (#7)
6. Fix hardcoded Central Time in edge function (#3)

**Phase 2 — High (this week)**
7. Update check_coverage_gaps() for shift_overrides (#2)
8. Add shift_overrides to edge function repository (#16, #17)
9. Update shared/scheduling.ts for overrides (#18)
10. Fix knowledge ingest auth headers (#13)
11. Add structured error logging for sync calls (#8)

**Phase 3 — Medium (ongoing)**
12. Split SettingsView.tsx (#11)
13. Add user-facing error feedback (#12)
14. Modal focus trap (#24)
15. Lazy load dashboard tabs (#26)
16. Token refresh strategy (#14)
