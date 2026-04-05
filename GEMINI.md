# SecretaryHQ — Gemini Handoff Guide

This document provides complete context for working on this codebase. Read this FIRST, then CLAUDE.md for conventions, then CURRENT_STATUS.md for what to work on next.

## What This Project Is

Multi-tenant AI receptionist SaaS for service businesses. An AI answers phone calls, books appointments, answers policy questions, and syncs with CRMs. The dashboard lets business owners manage staff, resources, services, schedules, and integrations.

**NOT for HIPAA verticals** — medical, dental, chiropractic, optometry, veterinary are permanently excluded.

## Tech Stack

| Layer | Technology | Location |
|-------|-----------|----------|
| Backend API | Fastify 5, Node.js, TypeScript | `src/` (20 route modules under `src/routes/`) |
| Dashboard | Next.js 14, React 18, Tailwind, TypeScript | `dashboard/` |
| Voice AI | Vapi (orchestrator) + Telnyx (telephony) | `supabase/functions/vapi-tools/` |
| Edge Functions | Deno, Supabase Edge Functions | `supabase/functions/vapi-tools/` |
| Database | PostgreSQL + pgvector | `supabase/migrations/` (67 migrations) |
| Shared Code | TypeScript (Node + Deno compatible) | `shared/` |
| Async Workers | n8n workflows | `n8n/` |
| Billing | Stripe (Checkout + webhooks) | `src/routes/billing.ts` |

## How to Run

```bash
npm run bootstrap    # Install deps, start DB, apply migrations, seed
npm start            # Backend (https://localhost:3000) + Dashboard (https://localhost:3001)
npm test             # Backend tests (1,118 tests)
cd dashboard && npx vitest run  # Dashboard tests (347 tests)
```

Login: `admin@secretaryhq.com` / `password`

## Architecture Overview

### Request Flow
1. Browser → Next.js dashboard (port 3001) → Fastify API (port 3000) → PostgreSQL
2. Phone call → Telnyx → Vapi → Edge Function → PostgreSQL → Vapi → caller

### Multi-Tenancy
- Row Level Security (RLS) on ALL tenant-scoped tables
- `FORCE ROW LEVEL SECURITY` enforced (even superuser)
- `withTenantClient()` sets `app.current_tenant_id` context before queries
- JWT contains `tenant_id`, extracted in middleware

### Key Database Tables
- `tenants` — businesses (name, type, timezone, billing)
- `employees` — staff members (name, skills, is_active)
- `resources` — bookable units (bays, chairs, rooms)
- `services` — what the business offers (duration, price, required skills)
- `appointments` — bookings (resource, customer, employee, time)
- `customers` — contact info, address, notes
- `shift_overrides` — **THE schedule table**. Date-specific employee shifts. Both Working Hours UI and Front Desk scheduler read from here.
- `employee_shifts` — Legacy weekly patterns (day_of_week 0-6). Still used by booking RPCs as fallback but NOT used by dashboard UI.
- `tenant_integration_settings` — OAuth tokens for CRM/calendar providers
- `entity_sync_map` — maps local IDs to external provider IDs

### Key RPCs (PostgreSQL functions)
- `book_with_scheduling_atomic()` — main booking function. Finds resource+employee, checks shifts (overrides first, then patterns), night shift support, specific error codes
- `book_appointment_atomic()` — simpler booking (resource+customer only)
- `check_availability_with_tz()` — checks resource availability AND employee shift coverage
- `check_coverage_gaps()` — per-service coverage analysis with shift override support
- `get_effective_shifts()` — merges shift_overrides + employee_shifts for a date range
- `search_tenant_docs()` — RAG via pgvector cosine similarity

## Key Services

| Service | File | Purpose |
|---------|------|---------|
| Sync Orchestrator | `src/services/syncOrchestrator.ts` | Fire-and-forget sync to all CRM + calendar providers |
| Calendar Sync | `src/services/calendarSync.ts` | Google + Outlook calendar push |
| Token Management | `src/services/tokenManagement.ts` | Shared OAuth token refresh (5-min buffer) |
| OAuth Factory | `src/services/oauthCallbackFactory.ts` | Generic OAuth callback handler |
| Name Utils | `src/services/nameUtils.ts` | Shared splitName/joinName for CRM sync |
| Vapi Client | `src/services/vapiClient.ts` | Vapi REST API for phone provisioning |

CRM sync services: `jobberSync.ts`, `hubspotSync.ts`, `squareSync.ts`, `servicetitanSync.ts`

## Dashboard Structure

### Navigation: Front Desk / Back Office tabs
- **Front Desk**: Dashboard Home, Schedule (staff swimlanes), Customers (CRM)
- **Back Office**: My Team (employees, skills, skill map), My Business (services, resources, working hours), AI Insights, Settings

### Key Components
- `OutlookLayout.tsx` — main layout with sidebar navigation
- `NewSchedulerView.tsx` — staff swimlane scheduler (24hr, zoom, shift bars)
- `ShiftManagementView.tsx` — date-based schedule editor (click day → set times)
- `AppointmentView.tsx` → `AppointmentDetailPanel.tsx` (uses AppointmentDetailContext)
- `CRMIntegrationCard.tsx` — reusable card for Jobber/HubSpot/Square/ServiceTitan
- `SetupWizard/index.tsx` + `useWizardCrud.ts` — 7-step onboarding wizard
- `SettingsView.tsx` — calendar, CRM integrations, resources, onboarding

### UI Primitives (`dashboard/components/ui/`)
- `Modal.tsx` — focus trap, Escape close, disableBackdropClose option
- `Input.tsx` / `Select.tsx` — auto-generate id via useId() for label association
- `Button.tsx` — isLoading state, icon prop, variants
- `Card.tsx`, `Badge.tsx`, `Toast.tsx`

### State Management
- `SessionContext` — auth, tenant, managed tenant for super admin
- `AppointmentDetailContext` — editing state shared between parent/detail panel
- `VocabularyContext` — business-type-specific labels (Bay/Chair, Technician/Stylist)
- `useStaticData()` hook — fetches employees, resources, services, shifts, skills
- `useFormState()` hook — generic form state + dirty tracking

### API Client (`dashboard/lib/api.ts`)
- Namespaced: `Api.appointments.list()`, `Api.shifts.schedule.save()`, etc.
- Auto token refresh (10min before expiry via `ensureTokenFresh()`)
- `forceLogout()` on 401

## Scheduling Model (IMPORTANT)

**The UI uses date-based scheduling only. No weekly patterns.**

- Click a day → set start/end time (default 8am-5pm) → save
- Data stored in `shift_overrides` table (ignore the name — it's THE schedule)
- API: `Api.shifts.schedule.save()`, `.forDate()`, `.remove()`
- Backend: `GET/POST /shifts/overrides`, `DELETE /shifts/overrides/:id`
- Both Working Hours (Back Office) and Front Desk scheduler read from same table
- The `employee_shifts` table (weekly patterns) still exists for booking RPC fallback
- Do NOT add pattern/override complexity — keep it simple

## Security

- `@fastify/helmet` — security headers
- `@fastify/rate-limit` — 100 req/min global, 5/5min on login
- CORS via `CORS_ORIGIN` env var (defaults to `true` for dev)
- JWT auth (8h expiry) with refresh endpoint (`POST /auth/refresh`)
- Zod validation on all route inputs
- RLS on all tenant tables
- Webhook signature verification (Stripe, Jobber, HubSpot, Square, ServiceTitan)

## Testing

```
1,468 tests total, 0 failures
├── Backend: 68 files, 1,118 tests (npm test)
├── Dashboard: 18 files, 347 tests (cd dashboard && npx vitest run)
└── Edge Functions: 3 tests (deno test)
```

- All tests have happy + sad paths with 5W diagnostic context
- Backend tests use `test_db` (separate database) with savepoint isolation
- Test helpers in `src/test-utils.ts` (createTenant, createEmployee, etc.)
- DO NOT run `npx vitest run` from root — it runs tests in parallel and they clobber test_db. Use `npm test` instead.

## Known Issues (as of April 5, 2026)

### BUG-072: Front Desk Shift Bars Not Rendering (OPEN)
- Working Hours shows shifts correctly
- Front Desk scheduler does NOT display shift bars
- Data confirmed in API response
- Debug console.log in `NewSchedulerView.tsx` (~line 213) — needs browser console output
- `useSchedulerData` fetches all shift_overrides and filters by date
- This is the #1 priority to fix

### Other Notes
- `DASHBOARD_URL` env var not set on Railway (needs dashboard deployed first)
- Dashboard not yet deployed (Railway incident blocked it April 2)
- OpenAI API quota needs monitoring
- Voice AI filler phrases ("Absolutely!", "Great!") still slip through

## Environment Variables

### Backend (Railway)
Required: `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`
Optional: `CORS_ORIGIN`, `DASHBOARD_URL`, `VAPI_API_KEY`, `VAPI_SERVER_URL_SECRET`
CRM OAuth: Various `*_CLIENT_ID`, `*_CLIENT_SECRET`, `*_CALLBACK_URL` (not set yet)

### Dashboard
`NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Design Philosophy
- We show data. They manage their business. No warnings, no grades, no opinions.
- Business-appropriate UX (delete confirmations, not bare confirms)
- All themes dark. Fonts: Bebas Neue (display) + DM Sans (body). Use CSS variables only.
- "Secretary HQ" (space between words)

## Files to Read First
1. This file (GEMINI.md)
2. `CLAUDE.md` — detailed conventions, code patterns, project structure
3. `CURRENT_STATUS.md` — what to work on next, active bugs, resume points
4. `BUGS.md` — 72 bugs tracked, 70 fixed, 1 open
5. `docs/ARCHITECTURE_REVIEW_20260403.md` — comprehensive architecture analysis
