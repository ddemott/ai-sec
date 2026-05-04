# SecretaryHQ — Current Status
**Last updated:** 2026-05-04 (NEEDS-REFACTORING #3 closed — UsageTrackingService deleted under the test-or-delete lens)

---

## Where We Are

Phase 13 (Production Readiness) in progress. Backend live on Railway. Vapi → LiveKit migration complete (commit `661d21d`, 2026-04-27). Phone provisioned via Telnyx (`+1-630-937-9478`) but currently unreachable from PSTN — see `TICKET_SUPPORT.md` (Telnyx ticket re-submitted 2026-05-01 after the original #2850682 went 4 days without a human response). Voice AI is wired end-to-end and waiting on the carrier issue to validate live.

## What's in flight (between repo and prod)

Code shipped to `main` and merged on origin, but not yet exercised in production. Each item has an explicit reason it's still in flight rather than complete.

| Item | State | Why it's in flight | Action to close |
|---|---|---|---|
| **Telnyx PSTN reachability** | IN FLIGHT (external) | Re-submitted 2026-05-01 to LERG/porting team after the original ticket went 4 days without a human response. Zero inbound CDRs at Telnyx 2026-04-25 → 2026-05-03. | Telnyx reviewer responds; or fallback diagnostic = provision a second DID. |
| **`DASHBOARD_URL` env var** | IN FLIGHT (user) | Outstanding 6+ days. Stripe checkout + OAuth redirects depend on it. | User sets it on Railway → ai-sec service → Variables (~2 min). |
| **Atomic-booking migrations `20260501000000` + `20260501000001`** | IN FLIGHT (prod-apply) | Code green on main; CI applies them on every push against the test DB. Pre-flight on prod: scan `appointments` for existing overlapping rows on `(resource_id, time-range)` or `(employee_id, time-range)` where `status='scheduled'` AND `is_deleted=false`. Any overlap blocks the `ALTER TABLE ... ADD CONSTRAINT EXCLUDE`. | User runs `npm run db:migrate -- "$SUPABASE_URL"` after the pre-flight. |
| **Voice fallback dead-air guard** | IN FLIGHT (validation pending) | Unit-level closed 2026-05-03 (commit `6488dc4`); 13 5W tests pin the contract. Live-PSTN exercise of the fallback message still blocked on the Telnyx unblock above. | Live call once Telnyx clears. |
| **Tenant-config display path** | IN FLIGHT (validation pending) | Code on main 2026-05-03 (commit `2119451`); 10 tests green. Live-PSTN exercise pending Telnyx. | Live call once Telnyx clears. |
| **Beta with DynaTire** | IN FLIGHT (external, transitive) | Blocked transitively on the Telnyx unblock. | Auto-unblocks when Telnyx clears. |
| **NEEDS-REFACTORING #14 (`pw.txt`)** | IN FLIGHT (decision pending) | Gitignored, never committed; could be a real password or a deliberate scratch note. | User confirms whether to keep or delete. |
| **`hold-tenant-config` branch** | superseded, can be deleted | Original 2026-05-01 commit (`e92b3bf`) found unmerged 2026-05-03 during voice-fallback validation. Work redone on main 2026-05-03 as commit `2119451`; nothing on the branch is uniquely valuable now. | User can `git branch -D hold-tenant-config` and `git push origin --delete hold-tenant-config` whenever convenient. |

### May 4 Session: NEEDS-REFACTORING #3 closed (UsageTrackingService deleted)

- **`src/services/usage/` deleted** — UsageTrackingService.ts was an in-memory map with no DB persistence, no `usage_events` table, no Stripe metered-billing reporter, and no metered-tier customer requesting it. Resolved under the test-or-delete lens (same disposition as #1, the CRM adapters). Also deleted `src/types/usage.ts` (`Provider` enum + `UsageRecord` interface had no other consumers). The optional `usageTracker?` constructor param was removed from `CommunicationService` and `SMSService`; no production caller was passing it (`src/routes/communications.ts`, `src/services/reminders/index.ts`, and `communications.test.ts` all used the 2-arg form). Re-add when a metered-tier customer signs up — the shape will need to change anyway, so re-implementing from scratch is cheaper than evolving the stub.

### May 3 Session: voice fallback path validation + tenant-config redo on main

- **Voice fallback path validation** (queue #9). The validation surfaced a real dead-air gap: docs across CLAUDE.md / ARCHITECTURE.md / NEEDS-REFACTORING.md #9 had claimed `runFallback()` used OpenAI TTS as a guard against Grok outage, but the actual code on main wired GrokTTS in both the primary path AND the fallback — meaning a Grok outage would leave the fallback unable to speak either. Closed by extracting `runFallback()` to `agent/src/fallback.ts` (injectable provider deps), switching its TTS to OpenAI, awaiting `say()` so synthesis failures are caught, and pinning the contract with 13 new 5W tests. Agent suite: 53 → 66 tests, all green.
- **Tenant-config wiring redone on main** (closes NEEDS-REFACTORING #2). The voice-fallback validation surfaced that commit `e92b3bf` ("feat(agent): fetch tenant display config from backend at call start"), claimed on 2026-05-01 to close NEEDS-REFACTORING #2, actually lived on a `hold-tenant-config` branch and was never merged to main. Path B taken: redone directly on main, reusing the branch's design as a reference. New `POST /agent-tools/tenant-config` route in `src/routes/agentTools.ts` (4 backend tests). New `agent/src/tenantConfig.ts` module (6 agent-side tests). Hardcoded `DYNATIRE_TENANT_ID` / `TENANT_DEFAULTS` block deleted from `agent/src/index.ts`. The agent now greets with the real business name and reasons about "today" in the tenant's IANA zone. Soft-fails to "this business" / America/Chicago on any backend error so a config blip never hangs up a live caller. Agent suite: 66 → 72 tests. Backend: 1,475 → 1,479 tests. Multi-tenant production no longer blocked by the agent worker's display path.

### May 1-2 Sessions: concurrency fix + structural refactors

- **Atomic-booking concurrency hole closed** (commit `55be6dc`). Race confirmed under READ COMMITTED — find-then-insert in `book_appointment_atomic` / `book_with_scheduling_atomic` could pass two `NOT EXISTS` checks before either committed (9/20 winners on resource race, 20/20 on employee race). Closed by two GiST exclusion constraints (`appointments_no_resource_overlap`, `appointments_no_employee_overlap`, migration `20260501000000`) plus `exclusion_violation` handlers in both RPCs (`20260501000001`). Race losers receive `TIMESLOT_OCCUPIED` and the agent prompt's "that time just got taken" mapping continues to apply. **Migration not yet applied to production Supabase** — see TODO.md Phase 13 entry for the pre-flight overlap-scan step.
- **xAI Grok TTS shipped** (commit `f6cc1d4`, 2026-05-01). `agent/src/grokTTS.ts` implements the LiveKit `tts.TTS` plugin against `https://api.x.ai/v1/tts`; primary session uses Grok, `runFallback()` claimed (but pre-2026-05-03, did not actually) use OpenAI TTS as the dead-air guard — see May 3 entry above. End-to-end PSTN validation still pending Telnyx.
- **Tenant config wiring** — commit `e92b3bf` originally claimed to close NEEDS-REFACTORING #2 P0 on 2026-05-01 actually lived on a `hold-tenant-config` branch and was never merged. Properly redone on main 2026-05-03 — see the May 3 entry above for the actual landing.
- **`src/index.ts` slimmed 385 → 279 lines** across three commits:
  - `fbc1eaf` — JWT preHandler + PUBLIC_ROUTES + generateToken/verifyToken extracted to `src/middleware.ts` as `registerJwtAuthHook(app, pool)`.
  - `9b78030` — Pool config consolidated. `src/database/index.ts:getPool()` is now the canonical singleton with the deadlock-prevention timeouts (`statement_timeout`/`lock_timeout`/`idle_in_transaction_session_timeout`); reminder scheduler + communications no longer get a softer pool than routes.
  - `5077fd6` — `withTenantClient` factory extracted to `src/database/index.ts` as `createWithTenantClient(pool)`. Routes and tests unchanged (still receive it as injected).
- **`scripts/setup-db.sh` bootstrap bug fixed** (commit `c9f40c6`). The `psql -c "SET ..."` + heredoc combo silently dropped the `CREATE TABLE schema_migrations` because `-c` and stdin are mutually exclusive. CI workaround removed.
- **OTP system prompt status truthed up** (commit `6f91b7b`). The "Phase 3 TODO" line in CLAUDE.md was stale — Phase 3 had already shipped in the LiveKit `agent/src/prompt.ts` since commit `18caffe`.
- **`src/services/crm/` deleted** (NEEDS-REFACTORING #1, P0). 21 dormant adapters + `BaseCRMAdapter` interface + factory + the mocked-API test file removed (3,480 lines). Decision policy locked: anything we can't validate against a real CRM gets deleted; when a beta customer brings a CRM we don't have a flat client for, we wire it then. The four working flat clients (jobber/hubspot/square/servicetitan) are unaffected. Two of the deleted adapters (`dentrix.ts`, `eaglesoft.ts`) violated the platform's HIPAA-excluded-vertical policy. Backend test count: 1,495 → 1,475.

### April 20-21 Session: UX/a11y backlog complete + migration docs

- **All 47 UX/accessibility items resolved** (commit `f9ffa8e`, tracked in `docs/TODO.md`). Clickable divs → semantic buttons with keyboard handlers across 8 components. Hand-rolled modals consolidated onto shared `Modal`. All `confirm()`/`alert()` calls replaced with `ConfirmModal` + `showToast`. ARIA roles, `aria-selected`, `aria-live`, `role="dialog"` added throughout. URL query param sync on sub-tabs. Loading skeletons, empty states. Radiogroup semantics, fieldset grouping, explicit labels.
- **Framework migration index** — `docs/FRAMEWORK_MIGRATIONS.md` tracks three migrations: Vapi→LiveKit (orchestrator, **done**), Supabase Edge Functions→Fastify (tool runtime, 10 tools, **done**), OpenAI TTS→xAI Grok TTS native in agent (**Phase 4 pending**).
- **Docs audit + sync** — CLAUDE.md, README.md, BUGS.md, ARCHITECTURE.md, DEPLOYMENT.md, PLAN.md all updated to reflect current state.

### April 9-10 Session: UI/UX Audit + Shift Bar Fix

- **Front Desk shift bars fixed** (BUG-072): scheduler now uses `get_effective_shifts_bulk()` RPC (single-query, date-based only); shift bar styling matches Front Desk and Working Hours.
- **UI/UX audit** — 35 items resolved (Critical 7, High 13, Medium 15): wizard guards, ConfirmModal rollout, keyboard a11y, mobile responsive, theme compliance, URL-synced tab state, empty/loading states. See `docs/BUGS.md` for the per-item record.
- **Playwright e2e** — 7 fix tests + 12-step functional audit. All pass.
- **5W diagnostic compliance** — All 498 dashboard tests carry WHO/WHAT/WHEN/WHERE/WHY comments.

### April 3-4 Session: Architecture Review + Scheduling Overhaul

**Architecture review completed** — 32 items across Critical/High/Medium all resolved. See `docs/ARCHITECTURE_REVIEW_20260403.md` for full report. Key changes:
- Rate limiting (`@fastify/rate-limit`) + security headers (`@fastify/helmet`) added
- CORS restricted via `CORS_ORIGIN` env var
- Token refresh endpoint (`POST /auth/refresh`) + client-side auto-refresh (10min before expiry)
- Sync orchestrator (`src/services/syncOrchestrator.ts`) replaces 35 scattered fire-and-forget calls
- SettingsView split: 1,008 → 467 lines (extracted `CRMIntegrationCard.tsx`)
- SetupWizard split: 584 → 203 lines (extracted `useWizardCrud.ts`)
- Night shift support (cross-midnight time comparison)
- `check_availability_with_tz()` now checks employee shift coverage + overrides
- `getAvailableSlots()` consolidated from 13 DB round trips to 1
- Modal focus trap, form label auto-ids (`useId()`), lazy loading for dashboard tabs

**Scheduling simplified** — User rejected pattern+override model as too complex:
- **New model**: date-based only. Click a day → set times → save. No weekly patterns.
- Data lives in `employee_schedule` table (API: `Api.shifts.schedule.*`)
- Both Working Hours and Front Desk scheduler read from same table
- Default times: 8:00 AM - 5:00 PM
- `employee_shifts` (weekly patterns) was dropped 2026-04-30 (NEEDS-REFACTORING #4 Phase 2). Setup wizard now collects the weekly grid in form state and posts the pattern to `POST /shifts/expand-weekly`, which fans it into `employee_schedule` for 4 weeks at finalize.

### Other UI Work Done
- Landing page `public/index.html`: added "Log in" button (was missing entirely)
- Skill map connection lines: brightened opacity and colors for dark themes
- Modal: fixed focus trap stealing keystrokes (useEffect now stable on `[isOpen]` only)

## What's Left

See `docs/TODO.md` for the unified task list.

### Test Count (verified 2026-05-02 against real Postgres + dashboard)
- **1,479 backend tests + 498 dashboard tests = 1,977 total**, 0 failures, 2 documented skips
- 19 Playwright e2e tests (7 critical + 12 functional audit)
- 29 live QA tool calls (88 assertions)
- Zero TypeScript errors (`npx tsc --noEmit` clean on backend + dashboard)
- CI now provisions Postgres 16 + applies migrations, so DB-level tests
  actually run on every push (previously they silently skipped without Docker)

---

## What's Working

| Component | Status | Details |
|-----------|--------|---------|
| **Backend API** | Live | `https://ai-sec-production.up.railway.app/` — Fastify, 25 route modules, Railway auto-deploy from main |
| **Landing page** | Live | Full marketing page at root URL with features, pricing, demo mockup |
| **Database** | Live | Supabase Postgres (managed), 80 migrations applied, FORCE RLS on all tables. Two new migrations (`20260501000000` exclusion constraints + `20260501000001` RPC handlers) shipped to repo 2026-05-02 but not yet applied to prod — pre-flight overlap-scan needed first. |
| **LiveKit agent worker** | Live | Railway service `ai-sec-agent`, worker `AW_vPmGExrgTeGn` registered with LiveKit Cloud |
| **Phone provisioning** | Working (code) | `POST /provisioning/activate` searches Telnyx inventory, purchases, assigns to SIP Connection `livekit-outbound` |
| **DynaTire phone** | Provisioned, **unreachable** | `+1-630-937-9478` (Telnyx) — Telnyx-side config verified clean; calls return "not in service" upstream. Original ticket `#2850682` superseded 2026-05-01 after 4 days without a human response; new ticket awaiting LERG/porting reviewer. |
| **Voice AI (end-to-end)** | Wired, awaiting first live call | Telnyx → LiveKit Cloud → agent worker → `/agent-tools/*` → Postgres. Blocked on the carrier-side LERG/PSTN propagation issue above. |
| **Knowledge base** | Working | 40 policy Q&A pairs across 9 categories, document upload (PDF/TXT/DOC/DOCX/MD), auto-save |
| **QA test suite** | Working | `scripts/qa-live-test.py` — 29 tool calls, 88 assertions against `/agent-tools/*` Fastify routes |
| **Stripe billing** | Configured | Webhook registered at `/billing/webhook`, test keys + price IDs set |
| **Local dev** | Working | `npm start` runs backend (4001) + dashboard (4000), dotenv loads `.env` |
| **Tests** | 1,479 backend + 498 dashboard = 1,977 passing + 88 QA assertions | All green (verified 2026-05-03 against real DB + dashboard), 2 documented skips, zero TS errors |
| **Playwright e2e** | 19 tests (7 critical + 12 functional audit) | Against live dashboard |
| **Google Calendar sync** | Working | OAuth flow, token refresh, auto-sync on create/update/delete/cancel |
| **Outlook Calendar sync** | Working | Microsoft Graph API, OAuth flow, token refresh, auto-sync on create/update/delete/cancel |
| **Jobber CRM sync** | Working | Bidirectional sync (push+pull), timestamp-based merge, OAuth, GraphQL API, webhooks |
| **HubSpot CRM sync** | Working | Bidirectional sync (push+pull), REST API (contacts+meetings), OAuth, webhook v3 verification |
| **Push triggers wired** | Working | Appointment + customer mutations fire-and-forget to all connected calendars + CRMs |
| **Supabase CLI** | v2.83.0 | Updated from 2.77.1 |

## What's Broken / Blocked

### ~~Voice AI Scheduling Bug~~ — RESOLVED (2026-04-01)

**BUG-059**: `book_with_scheduling_atomic()` was using hardcoded UTC timezone for shift validation, causing bookings to fail for non-UTC tenants (e.g., Chicago tenant booking at 5 PM Friday would fail because function checked for Saturday shifts in UTC).

**Fixed**: Applied migration `20260401000000_fix_scheduling_timezone_bug.sql` — now uses tenant's actual timezone from `tenants.timezone` column.

**Impact**: Voice AI can now successfully book appointments for tenants in any timezone.

**Test**: Created `src/scheduling-timezone-bug.test.ts` to verify fix (TDD approach).

### ~~Edge Functions Not Responding~~ — RESOLVED (2026-03-30)

Supabase project is no longer stuck in "pausing" state. Edge functions were reachable until commit `661d21d` (2026-04-27) deleted them entirely as part of the LiveKit migration; tool execution now lives in `src/routes/agentTools.ts`.

### Minor Issues (non-blocking)
- **OpenAI API quota** — Edge functions use GPT-4o-mini for LLM + embeddings. Monitor usage as call volume grows.
- **Filler phrases** — Voice AI occasionally says "Absolutely!" or "Great!" despite prompt engineering. Iterating on system prompt.

---

## Integration Architecture

### Calendar Sync (Push-only: SecretaryHQ → Calendar)
| Provider | Service file | Route file | How it works |
|----------|-------------|------------|-------------|
| Google Calendar | `src/services/googleCalendar.ts` | `src/routes/calendar.ts` | googleapis SDK, OAuth 2.0, Events API |
| Outlook Calendar | `src/services/outlookCalendar.ts` | `src/routes/calendar.ts` | Raw fetch to Microsoft Graph API v1.0 |
| Sync orchestrator | `src/services/calendarSync.ts` | — | Provider-agnostic, 5-min token refresh buffer, 5W logging |

### CRM Sync (Bidirectional: push + pull with timestamp merge)
| Provider | Client file | Sync file | Route file | API type |
|----------|------------|-----------|------------|----------|
| Jobber | `src/services/jobberClient.ts` | `src/services/jobberSync.ts` | `src/routes/jobber.ts` | GraphQL |
| HubSpot | `src/services/hubspotClient.ts` | `src/services/hubspotSync.ts` | `src/routes/hubspot.ts` | REST v3 |
| Square | `src/services/squareClient.ts` | `src/services/squareSync.ts` | `src/routes/square.ts` | REST v2 |
| ServiceTitan | `src/services/servicetitanClient.ts` | `src/services/servicetitanSync.ts` | `src/routes/servicetitan.ts` | REST v2 |

### Shared OAuth/Token Infrastructure
| File | Purpose |
|------|---------|
| `src/services/oauthCallbackFactory.ts` | Generic OAuth callback handler factory — eliminates duplication across 4 CRM integrations |
| `src/services/tokenManagement.ts` | Shared token refresh logic with 5-min buffer for all OAuth integrations |

### Push Triggers (fire-and-forget, wired in route handlers)
| Mutation | Calendar sync | Jobber sync | HubSpot sync | Square sync | ServiceTitan sync |
|----------|--------------|-------------|--------------|-------------|-------------------|
| Appointment create | ✓ | ✓ | ✓ | ✓ | ✓ |
| Appointment update | ✓ | ✓ | ✓ | ✓ | ✓ |
| Appointment delete | ✓ | ✓ | ✓ | ✓ | ✓ |
| Appointment cancel | ✓ | ✓ | ✓ | ✓ | ✓ |
| Customer create | — | ✓ | ✓ | ✓ | ✓ |
| Customer update | — | ✓ | ✓ | ✓ | ✓ |
| Customer delete | — | ✓ | ✓ | ✓ | ✓ |

### Sync Strategy
- **Calendar**: Push-only. Calendar is display-only, not source of truth.
- **CRM**: Bidirectional with timestamp-based merge. Most recent `updated_at` wins per record. Non-conflicting fields merge via COALESCE.
- **Pull triggers**: Webhook receivers (`POST /jobber/webhook/:tenantId`, `POST /hubspot/webhook`, `POST /square/webhook`, `POST /servicetitan/webhook`) + periodic full sync (`POST /{provider}/sync`).
- **DB tables**: `tenant_integration_settings` (OAuth tokens per provider), `entity_sync_map` (local↔external ID mapping with timestamps).

---

## Environment Variables

### Railway (Backend) — Set
| Variable | Status |
|----------|--------|
| `DATABASE_URL` | Set (Supabase session pooler) |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Set |
| `JWT_EXPIRY` | `8h` |
| `OPENAI_API_KEY` | Set |
| `TELNYX_API_KEY` | Set (carrier + SMS OTP) |
| `TELNYX_SIP_CONNECTION_ID` | `2945038451784812111` |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Set (project "AI-Secretary") |
| `DEEPGRAM_API_KEY` | Set (Nova-3 STT in agent) |
| `AGENT_SECRET` | Set (LiveKit agent → Fastify auth) |
| `STRIPE_SECRET_KEY` | Set (test mode) |
| `STRIPE_WEBHOOK_SECRET` | Set |
| `STRIPE_SOLO_PRICE_ID` | Set |
| `STRIPE_GROWTH_PRICE_ID` | Set |
| `STRIPE_PRO_PRICE_ID` | Set |
| `STRIPE_ENTERPRISE_PRICE_ID` | Set |
| `DASHBOARD_URL` | **NOT SET** (need dashboard deployed first) |
| `GOOGLE_CLIENT_ID` | **NOT SET** (need Google Cloud OAuth app) |
| `GOOGLE_CLIENT_SECRET` | **NOT SET** |
| `GOOGLE_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/calendar/auth/google/callback`) |
| `OUTLOOK_CLIENT_ID` | **NOT SET** (need Azure AD app registration) |
| `OUTLOOK_CLIENT_SECRET` | **NOT SET** |
| `OUTLOOK_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/calendar/auth/outlook/callback`) |
| `JOBBER_CLIENT_ID` | **NOT SET** (need Jobber developer app) |
| `JOBBER_CLIENT_SECRET` | **NOT SET** |
| `JOBBER_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/jobber/auth/callback`) |
| `HUBSPOT_CLIENT_ID` | **NOT SET** (need HubSpot developer app) |
| `HUBSPOT_CLIENT_SECRET` | **NOT SET** |
| `HUBSPOT_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/hubspot/auth/callback`) |
| `SQUARE_CLIENT_ID` | **NOT SET** (need Square developer app) |
| `SQUARE_CLIENT_SECRET` | **NOT SET** |
| `SQUARE_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/square/auth/callback`) |
| `SERVICETITAN_CLIENT_ID` | **NOT SET** (need ServiceTitan developer app) |
| `SERVICETITAN_CLIENT_SECRET` | **NOT SET** |
| `SERVICETITAN_APP_KEY` | **NOT SET** (ST-App-Key header) |
| `SERVICETITAN_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/servicetitan/auth/callback`) |

### Supabase Edge Function Secrets

The Supabase edge function `vapi-tools` was deleted in commit `661d21d`. No edge-function secrets are read by the current stack. Tools live at Fastify `/agent-tools/*` and authenticate via `AGENT_SECRET` set on Railway.

---

## Remaining TODO (Priority Order)

1. ~~Deploy dashboard~~ — Done (commit `fb216e0`, live at https://dashboard-production-cee3.up.railway.app/)
2. **Set `DASHBOARD_URL`** in Railway — for Stripe checkout + OAuth redirects
3. ~~Apply new migrations to Supabase~~ — Done through `20260430000002_drop_employee_shifts.sql`. **Two newer migrations** (`20260501000000_atomic_booking_exclusion_constraints.sql` + `20260501000001_booking_rpcs_handle_exclusion.sql`) shipped 2026-05-02 but not yet applied to prod — pre-flight overlap scan needed first. See TODO.md Phase 13.
4. ~~**UI/UX flow improvements**~~ — Done (April 9-10 audit 35 items + April 20 a11y 47 items, commit `f9ffa8e`)
5. ~~**Voice AI migration**: Vapi → LiveKit Agents~~ — Done in commit `661d21d` (2026-04-27). Awaiting Telnyx (original ticket `#2850682` superseded 2026-05-01; new ticket open) to unblock first live call.
6. **Beta testing with DynaTire** — blocked on the carrier issue above

### Done This Session (2026-04-01)
- ~~BUG-059: Timezone regression~~ — `book_with_scheduling_atomic()` used hardcoded UTC for shift validation; now uses tenant timezone. Migration `20260401000000`
- ~~BUG-060: Phone number incomplete~~ — `normalizePhone()` now rejects < 10 digits (was accepting "+1" as valid)
- ~~BUG-061: Wrong date booked~~ — Vapi assistant had hardcoded stale date in system prompt; updated with dynamic date handling
- ~~BUG-062: No employee assigned~~ — AI wasn't passing `requiredEmployeeSkills`; prompt updated with service-to-skill mapping
- ~~BUG-063: Call hangs up on booking failure~~ — Added error handling instructions to Vapi assistant prompt
- ~~BUG-064: Generic booking errors~~ — Added specific error codes (TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED) via migration `20260401000001`
- ~~OAuth callback refactoring~~ — Created `oauthCallbackFactory.ts` + `tokenManagement.ts` to eliminate duplication across Jobber, HubSpot, Square, ServiceTitan
- ~~Test expansion~~ — Added scheduling timezone bug test, voice AI fixes test, available slots test, comprehensive bug fix regression tests (rounds 1-5)
- ~~BUG-030: Orphaned transcripts~~ — `link_orphaned_transcripts()` now called in `dispatcher.handleCallEnded()` after every call
- ~~BUG-031: Timezone availability~~ — `service.checkAvailability()` now calls `check_availability_with_tz()` RPC for timezone-aware results
- ~~BUG-032: Call summary embeddings~~ — n8n workflow now generates embeddings (text-embedding-3-small) and stores them in `call_summaries.embedding`
- ~~BUG-038: Soft delete filtering~~ — All 7 edge function queries on soft-deletable tables now filter `is_deleted`. `deleteEmployee()` converted to soft delete
- ~~BUG-039: ARIA accessibility~~ — Toast, Card, FeedbackButton, CoverageBar, OutlookLayout tabs all have proper ARIA attributes

### Done Previous Session (2026-03-30)
- ~~Supabase blocker resolved~~ — Project no longer stuck in "pausing" state
- ~~Voice AI end-to-end working~~ — 8 critical fixes (tool response format, Zod relaxation, caller ID, timezone, natural errors)
- ~~LLM switched~~ — Groq/Llama 3.3 → OpenAI GPT-4o-mini (better instruction following)
- ~~Voice switched~~ — Vapi "Elliot" (male) → Vapi "Clara" (young American female)
- ~~Vapi assistant configured~~ — Smart endpointing, background denoising, Deepgram keywords, speaking plans
- ~~Booking validation~~ — Past-time rejection, business hours check, fuzzy service matching, timezone conversion (America/Chicago)
- ~~Knowledge base questionnaire~~ — 40 policy Q&A pairs across 9 categories, auto-save, document upload, embedding generation
- ~~DynaTire data cleanup~~ — 1 employee (Mike Rivera), 1 truck, all 5 services assigned, Mon-Fri 8-6
- ~~System prompt engineering~~ — Name spelling, no phone collection (use caller ID), no filler, natural datetime speech
- ~~QA test suite~~ — `scripts/qa-live-test.py` — 29 tool calls, 88 assertions, all passing
- ~~tools.json updated~~ — Added `get_company_policy_answer` and `get_service_catalog` tools

### Done Previous Session (2026-03-26)
- ~~Outlook calendar sync~~ — Microsoft Graph API, OAuth, full CRUD
- ~~Jobber CRM integration~~ — Bidirectional GraphQL sync with timestamp merge
- ~~HubSpot CRM integration~~ — Bidirectional REST sync with meetings + contacts
- ~~Square CRM integration~~ — Bidirectional REST v2 sync with customers + bookings
- ~~ServiceTitan CRM integration~~ — Bidirectional REST v2 sync with customers + jobs
- ~~CRM push triggers wired~~ — appointments.ts + customers.ts fire to all connected integrations (4 CRMs + 2 calendars)
- ~~Comprehensive sad path coverage~~ — 1,319 total tests with 5W diagnostics
- ~~30 unused variable warnings cleaned~~ — zero TS errors with strict checks
- ~~Scheduling diagnostics~~ — `selectAssignments()` returns reason strings ("all 3 bays busy", etc.)
- ~~All refactoring items complete~~ — 24/24 done in March 2026 sweep; that tracking file has since been removed from the repo

---

## Provisioned Resources

| Resource | Value |
|----------|-------|
| Railway backend URL | `https://ai-sec-production.up.railway.app/` |
| Supabase project | `sgibijfchvfuizudrmir` (us-west-2) |
| Active phone number | `+1-630-937-9478` (Telnyx) — see `TICKET_SUPPORT.md` for status |
| Telnyx SIP connection | `livekit-outbound`, ID `2945038451784812111`, FQDN `daleaisec24.sip.telnyx.com` |
| LiveKit SIP target | `ai-secretary-nmlkkmgf.sip.livekit.cloud:5060` |
| LiveKit dispatch rule | `SDR_if97ky4Zf7e6` (one rule routes all tenants to agent name `ai-secretary-agent`) |
| Stripe webhook URL | `https://ai-sec-production.up.railway.app/billing/webhook` |

---

## Test Coverage Summary

| Area | Test files | Test count | Coverage |
|------|-----------|------------|----------|
| Calendar sync (Google + Outlook) | 3 files | 102 | OAuth, sync orchestration, happy + sad |
| Jobber CRM | 3 files | 82 | Client, sync, routes — happy + sad |
| HubSpot CRM | 3 files | 74 | Client, sync, routes — happy + sad |
| Square CRM | 3 files | ~70 | Client, sync, routes — happy + sad |
| ServiceTitan CRM | 3 files | ~70 | Client, sync, routes — happy + sad |
| Provisioning | 1 file | 8 | Telnyx Numbers API (search/order/assign/release), DB schema, rollback |
| Scheduling + timezone | 2 files | 34 | Diagnostics, edge cases, UTC drift, DST transitions, midnight boundary, 5W sad paths |
| Voice AI fixes | 1 file | 22 | Phone normalization (E.164, partial, garbage), date calc (month/year boundary), skill mapping, error codes — all with 5W |
| OAuth/token management | 2 files | 20+ | Generic callback factory, token refresh |
| Normalizer | 1 file | 17 | Timeouts, API errors, unicode |
| Bug fix regression | 6 files | 80+ | April 1 rounds 1-5, comprehensive, regression |
| Dashboard (all) | 16 files | 313 | Components, wizards, scheduler, CRM, settings |
| Other backend | 11+ files | 281 | Auth, CRUD, billing, bugs, middleware, etc. |
| QA live tests | 1 file | 29 calls / 88 assertions | Live `/agent-tools/*` Fastify route calls with DB verification |
| **Total** | **75 backend + 23 dashboard + 1 QA** | **1,991 + 88 QA** | Happy + sad paths, 5W diagnostics, live integration (verified 2026-04-30) |
