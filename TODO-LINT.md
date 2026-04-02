# Lint & Code Quality TODO

**Generated:** April 1, 2026
**Source:** TypeScript strict checks, ESLint, manual audit

---

## High Priority (Type Safety)

### Backend: `any` types in service error handlers (30+ instances)
All CRM client/sync files use `catch (networkErr: any)` pattern. Should type as `unknown` and narrow.

| File | Count | Pattern |
|------|-------|---------|
| `src/services/squareClient.ts` | 5 | `networkErr: any`, `appointment_segments?: any[]` |
| `src/services/hubspotClient.ts` | 3 | `networkErr: any` |
| `src/services/servicetitanClient.ts` | 3 | `networkErr: any` |
| `src/services/outlookCalendar.ts` | 3 | `networkErr: any` |
| `src/services/jobberClient.ts` | 3 | `networkErr: any` |
| `src/services/vapiClient.ts` | 1 | `networkErr: any` |
| `src/services/oauthCallbackFactory.ts` | 2 | `req: any, reply: any` |
| `src/services/squareSync.ts` | 1 | `bookingData: any` |
| `src/index.ts` | 1 | `req: any` in raw body parser |

**Fix:** Replace `catch (networkErr: any)` with `catch (err: unknown)` and use type narrowing (`err instanceof Error`). Type the `oauthCallbackFactory` params with Fastify request/reply types.

### Backend: `any` types in route module signatures (4 instances)
| File | Line | Pattern |
|------|------|---------|
| `src/routes/skills.ts` | 13 | `app: any` |
| `src/routes/knowledge.ts` | 15 | `app: any` |
| `src/routes/employees.ts` | 28 | `app: any` |
| `src/routes/servicetitan.ts` | 8+ | Multiple `app: any` + handler params |

**Fix:** Type `app` as `FastifyInstance`. Other routes already do this.

---

## Medium Priority (Code Quality)

### Root vitest can't resolve dashboard `@/` aliases (16 test files)
When running `npx vitest run` from root, dashboard test files fail to resolve `@/lib/*` and `@/components/*` imports. Tests pass when run from `dashboard/` directory.

**Fix:** Add path aliases to root `vitest.config.ts` or exclude `dashboard/**` from root vitest config and rely on `cd dashboard && npx vitest run` for dashboard tests.

### Legacy files to remove
| File | Reason |
|------|--------|
| `vapi/agent.json` | Replaced by `vapi/agent.template.json` — contains hardcoded stale date (Feb 28), wrong model (Groq), old tenant IDs |
| `BUG-064-SPECIFIC-ERROR-CODES.md` | Duplicate — all info already in BUGS.md |
| `BUG-FIX-APRIL-1-2026.md` | Duplicate — all info already in BUGS.md |
| `BUG-FIXES-APRIL-1-VOICE-AI.md` | Duplicate — all info already in BUGS.md |
| `FIXES-COMPLETE-APRIL-1-2026.md` | Duplicate — all info already in BUGS.md |
| `scripts/fix-vapi-assistant.js` | One-off fix already applied — keep `.ts` version if needed for reference |
| `scripts/fix-vapi-assistant.ts` | One-off fix already applied — consider archiving |
| `run-tests.sh` | Untracked test wrapper script — add to git or remove |
| `dashboard/server.js` | Uses CommonJS `require()` — convert to ESM or delete if unused |
| `dashboard/test-fetch.js` | Uses CommonJS `require()` + has unused variable — delete if one-off |

### Soft delete filtering incomplete (BUG-038 PARTIAL)
Only 2 of 20 route files filter by `is_deleted = false`. Deleted records still appear in most query results.

**Affected routes:** appointments, customers, resources, services, shifts, mappings, skills, calendar, knowledge, analytics (partially done), billing, provisioning, and all CRM routes.

**Fix:** Add `WHERE is_deleted = false` (or `AND is_deleted = false`) to SELECT queries in routes that touch tables with soft-delete columns (appointments, customers, resources, employees).

---

## Low Priority (Style / Warnings)

### Dashboard: `any` types in test files (~20 instances)
Test files use `any` for mock fetch responses. Non-blocking but noisy in ESLint output.

| File | Count |
|------|-------|
| `dashboard/settings.test.tsx` | 8 |
| `dashboard/crm-unified.test.tsx` | 5 |
| `dashboard/crm.test.tsx` | 3 |
| `dashboard/components/TenantEditPanel.tsx` | 2 |
| Various test files | ~5 more |

**Fix:** Add `/* eslint-disable @typescript-eslint/no-explicit-any */` to test files, or type mock responses properly.

### Dashboard: type definition `any` (2 instances)
`dashboard/types/react-big-calendar.d.ts` lines 10, 14 — ambient type declarations use `any`. Acceptable for third-party type stubs.

### Dashboard: custom font warning
`dashboard/app/layout.tsx:20` — Next.js warns that custom fonts from `next/font` only load for a single page unless added in `_document.js`. Not a real bug for App Router (it uses `layout.tsx`).

### Billing TODO comment
`src/routes/billing.ts:227` — `TODO: Consider fail-closed for production after monitoring is in place`. Keep as a reminder.

---

## Completed (this session)

- [x] Removed `deleteme/` directory (old compiled scheduling/normalizer files)
- [x] Added `.Clairvoyance/` to `.gitignore`
- [x] Fixed `dashboard/superadmin.test.tsx` — added missing `// @vitest-environment jsdom`
- [x] Fixed `dashboard/appointment.test.tsx` — replaced hardcoded "March" with dynamic current month
- [x] Removed unused imports `Plus`, `Button` from `KnowledgeBaseView.tsx`
- [x] Removed unused `_trialParam` variable from `DashboardHome.tsx`
- [x] Removed empty `SchedulerViewProps` interface from `SchedulerView.tsx`
- [x] Replaced unused `catch (err)` with `catch` in `SoloWizard.tsx`
- [x] Fixed unescaped `'` entity in `Step7GoLive.tsx`
- [x] Fixed ES2018 regex flag `s` in `KnowledgeBaseView.tsx` (replaced with `[\s\S]`)
- [x] Zero TypeScript errors on both backend and dashboard
- [x] 1,031 backend tests + 313 dashboard tests = 1,344 all passing
