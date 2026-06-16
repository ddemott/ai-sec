# TODO

**See also**: root `GAPS.md` (2026-06-15) for the full deep-dive inventory of missing pieces across every angle (product, integrations, billing, ops, security, scaling, etc.). This file remains the active execution queue.

**Status at a Glance** (as of 2026-05-28 — UX pass + solo-mode dedup shipped)

- **Security**: 2026-05-21 closed a CVE-class anonymous cross-tenant data hole (`04cb661`, live in prod). Production-hardening batch shipped (deep `/ready`, pool fail-fast, `errors_total`, bad-input→400, agent graceful-recovery). See "Production hardening" + `RESOLVED.md`.
- **CI**: green. Agent package gated in CI. Tests (2026-06-11): backend 2,017 · dashboard 744 · agent 122 · E2E 113 (CI green for the first time — getPool db-name bug + 9 other infra fixes in PR #4). Includes the uncommitted live call-transfer feature.
- **Voice / Telnyx**: New live number **`+1-630-937-9478` is dead** (old order deleted, never kept). Replaced by **`+1 630-866-1960`** — DONE 2026-06-02: account funded + upgraded (trial cap lifted), number purchased (Telnyx id `2973794140900296302`), routed to SIP connection `livekit-outbound` (`2945038451784812111`), connection activated. **Remaining**: local `.env` LiveKit API key is dead (rotated at Railway) → need fresh creds → update LiveKit inbound trunk OLD→`+16308661960` → write tenant phone fields → live test. Full checklist: `docs/BETH_GO_LIVE_TODO.md`. Still zero inbound CDRs until trunk wired.
- **Env vars (user action)**: `DASHBOARD_URL` + `SENTRY_DSN` + `METRICS_TOKEN` + `BETTER_STACK_TOKEN` not yet set on Railway. **P0 progress**: GitHub branch protection on `main` now gates merges/deploys on CI green (4 jobs, applied 2026-06-15). Enable Railway "Wait for CI" on services for full coverage. See root `TODO_GAPS.md` subtasks.
- **Browser validation**: Role gating + invite flow — DONE 2026-06-03, proven by green e2e (`auth-flows` route-gate 403, `workflows:630` front-desk nav-hide/snap-back, `workflows:676` owner invite).
- **UX audit pass 2 (2026-05-19)**: Raw findings were in `ux-review-notes.md` (now archived/reduced). Actionable items triaged into the clusters below. Cluster-B defects closed 2026-05-21.

Everything else complete or tracked below.

---

## Active build queue (2026-06-12)

- [x] **Gap #2: Analytics — DONE 2026-06-12** (shipped to main, deployed). `GET /analytics/stats` + `GET /analytics/calls` built; dashboard panels now real — Call Volume / Booking Conversion / Caller Abandonment from `voice_sessions` ("booked" keyed on `appointment_id IS NOT NULL`), + a first "Why Callers Reached Out" outcome breakdown. Backend unit + dashboard component + `analytics.spec.ts` E2E all green; harness asserts both routes.
  - [x] **Follow-up: richer WHY classification — DONE 2026-06-12.** Agent's post-call classifier (`agent/src/callClassify.ts`, bounded/failsafe) categorizes non-booking calls into `no_availability` / `wrong_service` / `price` / `message` / `info` (null when unclear → stays `no_outcome` = abandoned, preserving that metric). Wired into the shutdown hook (only when no booking/transfer tool already set the outcome). Dashboard "Why Callers Reached Out" panel renders friendly labels. +8 agent + dashboard component tests; analytics E2E extended to seed a `no_availability` call and assert the label (run-verified).
- [ ] **Stripe — incorporate + verify ALL paths.** Built (`src/routes/billing.ts`), never tested live. Verify against **Stripe test mode** (test keys + Stripe CLI webhook replay — no real money): checkout → session/customer created; webhook signature verifies (`STRIPE_WEBHOOK_SECRET`); `checkout.session.completed` → subscription activates (tenant gate flips); `invoice.payment_failed` handled; `customer.subscription.deleted` revokes access; plan gating (Solo/Growth/Pro) enforces; 5 env vars set on Railway + webhook registered. Add a Stripe path-check to `simulate` so it's a one-command answer.
- [x] **Website-scan as onboarding step (fetch + LLM extract to KB).** Core backend + dedicated wizard step implemented: new step 7 "Import from website" (right before the policy questions step 8) with scan that prefills and saves answers for the starter questions. The questions step loads prefilled from DB. See details in the Back-to-Front subsection below. Backend, migration, UI step, prefill logic done. Advanced suggestion review still pending.

## 🚀 Production Wiring Checklist (backend audit 2026-06-12)

Full backend wiring audit (3 parallel investigators over `src/` + `agent/src/`).
**Tag key:** `[prod]` = code works in dev, needs production config/creds to
function · `[dev]` = NOT wired anywhere, needs code before it can work.

> **Verification caveat:** which `[prod]` env vars are _actually set_ in prod
> needs a Railway env read (token burned 2026-06-12 — reissue to confirm).
> Items below marked "unknown in prod" are code-complete; only the config state
> is unconfirmed.

### `[prod]` — code works, needs prod config — SILENT-DEGRADE (highest risk: no error, no startup warning)

- [ ] **[prod]** **Reminder/comms SMS silently runs MockAdapter** — without `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`, `ProviderRegistry.ts:43` selects the **mock**, so every reminder/`/communications` SMS reports success but **never sends**. No prod-validation, no boot warning. Project standardized on Telnyx for voice — **DECIDE:** set Twilio creds (+`TWILIO_PHONE_NUMBER`) OR refactor reminders onto the Telnyx path (`telnyxSms.ts`). Until then reminders are dead-in-prod with zero signal.
- [ ] **[prod]** **Email silently runs mock transporter** — without `EMAIL_USER`/`EMAIL_PASS`, `emailService.ts:22` installs a mock returning a fake messageId → confirmation/notification emails never send, no error. Set Gmail app-password env on Railway.
- [ ] **[prod]** **Agent `BACKEND_URL` defaults to `http://localhost:4001`** (`agent/src/config.ts:17`, a `.default()` — no fail-fast). If unset on `ai-sec-agent`, the agent calls localhost → **every `/agent-tools/*` request misroutes silently**. MUST confirm set in prod.
- [ ] **[prod]** **`STRIPE_WEBHOOK_SECRET` empty → every webhook 400s** (`billing.ts:133`) → subscriptions never activate even though checkout works. Distinct from `STRIPE_SECRET_KEY`.
- [ ] **[prod] (security)** **`CORS_ORIGIN` unset reflects ANY origin** (`index.ts:134` `|| true`). Set the dashboard origin in prod.
- [ ] **[prod]** **`DASHBOARD_URL` defaults to `https://localhost:4000`** → prod emails / OAuth redirects / Stripe success+cancel URLs point at localhost (`constants.ts:2`, `billing.ts:91`, `calendar.ts:56`, `auth.ts:185`). Already on the env-var list below — flagged here for blast radius.

### `[prod]` — required env for core launch (already tracked, consolidated)

- [ ] **[prod]** Stripe live: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO/GROWTH/PRO_PRICE_ID` on Railway + webhook registered at `/billing/webhook` (3 events). Missing secret → billing 503; missing price → that plan's checkout 503.
- [ ] **[prod]** `DASHBOARD_URL`, `SENTRY_DSN` (backend + agent), `METRICS_TOKEN`, `BETTER_STACK_TOKEN` (backend + agent) on Railway. Observability is dark until set (`/metrics` 404, no Sentry, stdout-only logs).
- [ ] **[prod]** Telnyx voice OTP: confirm `TELNYX_API_KEY` + `TELNYX_SIP_CONNECTION_ID` set in prod — else `send_verification_code` fails (blocked-caller-ID bookings can't verify) + provisioning 503.
- [ ] **[prod]** Telnyx call-transfer / REFER enabled on the SIP Connection + dashboard forward number (carried from the transfer ship list above).

### `[prod]` — optional integrations (each needs env + external OAuth/webhook app; turn on per business need)

- [ ] **[prod]** Google Calendar — `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` + GCP OAuth app + redirect URI. Code complete (`googleCalendar.ts`); `/calendar` route 503s until set.
- [ ] **[prod]** Outlook Calendar — `OUTLOOK_CLIENT_ID/SECRET/CALLBACK_URL` + Azure app.
- [ ] **[prod]** CRM — Square: needs `SQUARE_CLIENT_ID/SECRET/CALLBACK_URL` + `SQUARE_WEBHOOK_SIGNATURE_KEY` + an OAuth app registered provider-side. Real implementation (`src/services/crm/squareClient.ts`/`squareSync.ts`), no-ops safely until configured. (Jobber/HubSpot/ServiceTitan removed 2026-06-12 as competitors — see `docs/STRATEGY.md`.)

### `[dev]` — NOT wired anywhere, needs code

- [x] **[dev]** **Voice-session capture (outcome + appointment link + summary)** — DONE 2026-06-12. `CallOutcomeTracker` (`agent/src/callOutcome.ts`) is mutated by the booking tools (`recordBooking(appointment_id)`, guarded on a real id in the response) and the transfer tool (`recordTransfer`); the shutdown hook reads it and sends `outcome` + `appointment_id` + a bounded/failsafe post-call `summary` (`agent/src/callSummary.ts` — never throws, can't drop the session-end write) to `voice-session-end`. Backend `VoiceSessionEndSchema` now accepts `summary` + UUID-validated `appointment_id` and forwards them to the RPC (was hardcoded null). +14 agent + 2 backend tests; `simulate tools` now proves the link **persisted** via a `voice_sessions` DB read-back (appointment_id matches the booking, outcome=booked, summary stored).
- [x] **[dev]** **Transfers invisible in Calls tab** — DONE (see Back-to-Front section line 215 + Gap #1). `recordTransfer()` sets `outcome='transferred'`; `end_voice_session` RPC sets `status='transferred'` when outcome matches. UI badge wired.
- [x] **[dev]** **`GET /analytics/stats` missing** — DONE 2026-06-12 (Gap #2). Route at `src/routes/analytics.ts:24`; dashboard panels fully wired. See active build queue above.
- [x] **[dev] Twilio delivery monitoring** — DONE 2026-06-12 (`feat/twilio-delivery-receipts`): `TwilioAdapter.sendSMS` attaches a `statusCallback` (`BACKEND_PUBLIC_URL`-gated) -> `POST /communications/twilio/status` webhook, which verifies `X-Twilio-Signature`, upserts into `message_delivery_status` by SID, increments `message_delivery_receipts_total{status}`. Needs `BACKEND_PUBLIC_URL` on Railway to activate.
- [x] **[dev] `GET /communications/history` implemented** — DONE 2026-06-12 (`feat/communications-history`): real `communications_history` table, written on the Email/SMS send-success path, tenant-scoped paginated query. No live UI consumer yet (backend-only).
- [x] **[dev]** **Stripe tax code wired** — `automatic_tax: { enabled: true }` added to checkout session in `billing.ts`, gated on `STRIPE_AUTO_TAX=true` env var. Set that on Railway after: (1) enable Stripe Tax in Stripe dashboard, (2) register nexus for IL + customer states. See Phase 13 user-action item.

### `[dev]` — test/build infra (surfaced by `simulate tools` 2026-06-12)

- [x] **[dev] — HIGH** **`supabase/baseline.sql` stale → drift guard** — DONE 2026-06-12. Baseline was missing `is_demo`/`demo_expires_at`/`tts_*`/`forward_phone`, so every `db:rebuild` + Playwright `globalSetup` DB lacked columns (`/demo/start` 500'd). Fix: proved the migration chain replays clean on empty (131 applied), regenerated `baseline.sql` via `pg_dump --schema-only` from the chain-built DB (now all 8 columns), and verified a full baseline rebuild → `simulate tools` journey passes. Added a **self-maintaining drift guard** (`checkMigrationColumnsInBaseline` in `scripts/verify-schema-alignment.ts` + 3 tests): scans every `ADD COLUMN` across migrations (minus dropped/renamed) and fails if any is absent from baseline — so this can't silently recur. Found by `scripts/simulate.sh tools`.

### Tooling — system simulation harness (built 2026-06-12)

`scripts/simulate.sh` now provides on-demand verification at any time:

- `status [--deep]` — health board (backend `/health`+`/ready`, dashboard, agent worker via LiveKit dispatch). **Verified prod 4/4 up incl. agent worker.**
- `tools` — realistic agent-tools journey (demo tenant → catalog → book → preference → recall) that PASSES wired links and flags `[dev]` gaps. **Verified local: 9 links pass, 4 gaps mapped.**
- `call` — dispatch agent + browser join URL (real voice, no phone).
- [ ] Replace the dead `qa-live-test.py` references (done in CLAUDE.md; file deleted).
- [ ] Add `simulate tools` (or an E2E equivalent) to CI once the `[dev]` links are wired, so journeys are regression-guarded.
- [x] **Test RAG accuracy — DONE 2026-06-12.** `scripts/sim-rag.mjs` + `./scripts/simulate.sh rag` — seeds a known KB into a demo tenant (real embeddings via `/knowledge/add`), asks paraphrased caller questions through `/agent-tools/policy-answer`, grades retrieval (expected content present, + out-of-scope must fall back not hallucinate), reports a hit-rate and exits non-zero below 80%. On-demand quality tool (real OpenAI → not a CI gate; non-deterministic + costs). Run-verified: **9/9 (100%)** after query expansion fix. **Gates the website-scan onboarding idea** (`docs/STRATEGY.md`).
  - [x] **Finding from the eval — FIXED 2026-06-12.** _"what's your address"_ fell back instead of retrieving the location doc — `address`↔`located` shares no vocabulary and scored 0.31 below threshold. Root cause: reductive `normalizeForEmbedding` applied to _query_ collapsed terse inputs below out-of-scope floor. Fix: new `shared/expandQueryForEmbedding.ts` (additive synonym expansion, inverse of normalize) on policy-answer path only + threshold 0.5→0.30. Docs/ingest untouched (no re-embed needed). See `shared/expandQueryForEmbedding.ts` + `src/queryExpander.test.ts`. Now ready for website-scan reliance.

### Reassuring — audited and found FULLY wired (no action)

CRM sync status fields · reminder-outcome metrics · SMS rate-limiting · retry policy · calendar-sync orchestration · all 4 CRM client API/OAuth/webhook code · Telnyx agent OTP path · LiveKit/Deepgram/OpenAI/Grok voice stack. None are scaffold — all real code.

---

## In-flight markers

- **IN FLIGHT (external)**: Waiting on vendor/third party.
- **IN FLIGHT (user)**: Needs action from Dale.
- **IN FLIGHT (prod-apply)**: Code shipped; needs production DB/Infra apply.
- **IN FLIGHT (validation pending)**: Code + tests done; needs live condition (PSTN call, etc.).

---

## Phase 13 – Blocking Launch

- [ ] **IN FLIGHT (user)** Open LLC bank account for Thinking Hammer LLC (required before Stripe payouts can be configured)
- [ ] **FUTURE (user)** At ~$60K taxable income, elect S Corp taxation on the LLC (file IRS Form 2553). Thinking Hammer LLC stays as-is legally — the S Corp election just changes how it's taxed, letting you split income between salary and distributions to reduce self-employment tax. Talk to a CPA before filing.
- [ ] **IN FLIGHT (user)** Legal docs — use Bonterms (bonterms.com) for SaaS Terms of Service, Privacy Policy, and Data Processing Agreement (free, open source, lawyer-drafted). Add to site before first paying customer. Separately: add TCPA-compliant SMS opt-in consent language at booking time (Twilio publishes a copy-ready template) — required before sending any confirmation texts.
- [ ] **FUTURE (user)** Get E&O (Errors & Omissions) insurance before first paying customer. Quote via Next Insurance or Hiscox (~$800–1,200/yr for solo SaaS). Covers:
  - Customer claims Secretary HQ missed a booking or double-booked and they lost business
  - Customer claims the AI gave wrong information (pricing, hours, services) during a call
  - Legal defense costs even if the claim is frivolous
- [ ] **FUTURE (user)** Get Cyber Liability insurance before first paying customer. Often bundled with E&O. Covers:
  - Data breach notification costs (state laws require notifying affected customers — can be expensive)
  - Legal fees if a customer sues over their data being exposed
  - Regulatory fines if the FTC or a state AG investigates
  - You hold phone numbers, call recordings, names, and appointment history — this is real exposure
- [~] **Telnyx provisioning — DONE 2026-06-02.** Account for Thinking Hammer LLC funded ($10) + upgraded (trial 1-order cap lifted). SIP Connection `livekit-outbound` (`2945038451784812111`) → FQDN `ai-secretary-nmlkkmgf.sip.livekit.cloud:5060`. `TELNYX_API_KEY` + `TELNYX_SIP_CONNECTION_ID` set (local `.env`; verify on Railway `ai-sec`). Number **`+1 630-866-1960`** purchased (id `2973794140900296302`), routed to `livekit-outbound`, connection activated. Old `+1-630-937-9478` is dead (order deleted). **2026-06-04 UPDATE:** LiveKit creds work (not dead); inbound trunk `ST_aUM3GuCuc9wL` already points at the numbers (normalized to +E.164). `+16308661960` is a dead recycled DID — **new test number `+1 630-822-9086` (id `2975078589701031880`) bought + fully wired.** Config verified clean end-to-end; remaining blocker is PSTN carrier propagation, not config. **NEXT:** different-carrier call to `+16308229086` while watching LiveKit `listRooms()`. See `docs/TICKET_SUPPORT.md` + `docs/PROVISIONING_AUDIT.md` (2026-06-04).
- [ ] **IN FLIGHT (user)** Set `DASHBOARD_URL=https://dashboard-production-cee3.up.railway.app` on Railway `ai-sec` service
- [ ] **IN FLIGHT (user)** Set `SENTRY_DSN` on Railway backend + agent (dashboard Sentry already wired client+server, just needs DSN)
- [ ] **IN FLIGHT (user)** Stripe setup — set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_PRO_PRICE_ID` on Railway. Register webhook at `https://ai-sec-production.up.railway.app/billing/webhook` (3 events). See `docs/DEPLOYMENT.md` for full env-var list.
- [ ] **IN FLIGHT (user)** Stripe Tax — enable in Stripe dashboard before going live in multiple states. Stripe Tax automatically calculates state/local sales tax per customer location. Requires: (1) enable Stripe Tax in dashboard, (2) add `automatic_tax: { enabled: true }` to checkout session creation in `src/routes/billing.ts`, (3) register tax nexus for IL + any state where you have customers.
- [x] **Browser-verify role gating + invite flow** — DONE 2026-06-03. Covered by green e2e: `auth-flows.spec.ts` (front_desk → 403 on /users/invite, /users/:id/role, GET /users), `workflows.spec.ts:630` (front-desk sees only Primary tabs; stale `?tab=my-business` URL snaps back to Home), `workflows.spec.ts:676` (owner invite creates user + reset token). Full suite 111 passed / 7 skipped.

- [ ] **IN FLIGHT (validation pending)** Manual conversation testing — exercise full voice calls (esp. booking + customer-preference capture) and confirm the AI follows a logical progression: asks the caller's preferred day/time, offers open slots, widens to the next window when none fit, confirms the caller's choice (never imposes a time), and saves/recalls preferences across calls. Code + unit/prompt tests are green; this is the human-in-the-loop check that the dialog actually flows naturally. Blocked on live inbound (Telnyx). See `agent/src/prompt.ts` "# Availability discipline" + "# Customer preferences".

- [x] **Apply migration `20260606000000_tenants_customer_preferences.sql` to prod DB** — DONE 2026-06-11. Audit found the two columns (`save_preferences_enabled`, `preferences_instructions`) were already present in prod (hand-applied, untracked), so the AI-config page was NOT broken. `npm run db:migrate` against prod reconciled the tracker (recorded `20260606000000` + `20260610000000_tenant_grok_voice` which was in the same untracked-gap) and the run was a safe no-op on the existing columns.

Closed: prod migrations apply (36 applied 2026-05-17 → version `20260514000000`); first-run guided tour (`20838a4`).

---

## Production hardening (2026-05-21)

Opened after a perf check accidentally surfaced a CVE-class auth hole — the lesson being we can't rely on luck: under real call volume we must fail closed, fail fast, and stay observable. Some items shipped same-session (code), the rest need Dale/Railway.

**Done 2026-05-21 (committed + pushed, `2461f08..cd185dd`; CI green):**

- [x] **SECURITY** Unauthenticated cross-tenant data access via `?tenant_id=` (read+write+delete) closed — `tenantMiddleware` 401s non-public/non-exempt requests with no `req.auth`; `requireTenantId` drops the body fallback. Probe 8 added (isolation suite now 39 probes). See `RESOLVED.md` + `docs/SECURITY.md`.
- [x] **Deep `/ready` endpoint** — DB ping + pool saturation stats (`total/idle/waiting`); 503 when DB unreachable. `/health` stays shallow (liveness). A monitoring signal, not yet a traffic gate.
- [x] **Pool fail-fast** — added `connectionTimeoutMillis: 5000`; pool-checkout under exhaustion now errors fast instead of hanging forever (the "many callers" failure mode).
- [x] **Alerting visibility** — `withHandler` unhandled errors now route through `logError` → `errors_total` ticks (pre-fix pool-exhaustion errors were invisible to `rate(errors_total)` alerting).
- [x] **Threadpool** — `GET /` + `/demo` no longer `fs.readFileSync` per request.
- [x] **Gap 3 — client-error 500s → 400** `withHandler` now maps Postgres class-22 data exceptions (`22P02`/`22003`/`22007`/`22008` — e.g. a non-UUID `:id`) to 400 and does NOT tick `errors_total`. Confirmed live: `GET /records/customers/not-a-uuid/history` 500→400. Unit tests added (incl. a guard that non-class-22 errors stay 500). Fixes the ~12 unvalidated `:id` routes in one place + stops client garbage polluting 5xx/error-rate alerts.
- [x] **Gap 1A — agent graceful recovery** `agent/src/prompt.ts` "Technical glitches" section: never speak raw error text (`500`/`timed out`/`backend`), recover in-character, never stall silently. Regression test pins it. (Wording is a placeholder for Dale to tune.)
- [x] **Gap 2 — agent CI job** `agent/` (tsc + 99 tests) now runs in CI — was previously ungated entirely.
- [x] **Testability extractions** `jsonContentTypeParser` (+ 400-on-bad-JSON fix) and `readinessHandler` extracted to modules with unit tests (incl. the `/ready` 503 DB-down branch). E2E added: anonymous-tenant 401, `/ready`, malformed-JSON.

**Open — needs Dale / Railway (config, can't be done from here):**

- [ ] **IN FLIGHT (user)** Set `METRICS_TOKEN` on Railway backend (Prometheus `/metrics` returns 404 until set — currently no metrics scrape in prod).
- [ ] **IN FLIGHT (user)** Set `BETTER_STACK_TOKEN` on Railway backend + agent (no log aggregation in prod until set).
- [ ] **IN FLIGHT (user)** (Optional) Repoint Railway healthcheck → `/ready` if you want deploy promotion gated on DB reachability (note: Railway healthcheck gates promotion, not per-request traffic).
- [ ] **Alert rules** — once `METRICS_TOKEN`/`BETTER_STACK_TOKEN` are live, wire alerts on `rate(errors_total[5m])`, `booking_attempts_total{outcome="failure"}`, http 5xx rate, p95 `http_request_duration_ms`, and sustained `/ready` `waiting>0`. Route to a channel Dale watches.

**Open — LOAD TESTING (deferred — not a current concern, Dale 2026-05-21):**

- [ ] **Load-test the booking path** to find the concurrent-call ceiling before pool exhaustion / latency cliff. Pool `max=10`, single agent worker per tenant — ceiling currently unknown. Define expected concurrency, size pool + LiveKit accordingly.
- [x] **Pool-exhaustion integration test** — DONE 2026-06-07 (`src/poolExhaustion.test.ts`). Real `Pool({max:1, connectionTimeoutMillis:500})`, holds the only client, hits a `withHandler`+`withPoolClient` route → checkout rejects at ~504ms (bounded, not a hang) → 500 + `errors_total{unhandled_route_error}` ticks via `withHandler`→`logError`. Control tests (free slot → 200; release → 200 again) prevent false-pass and prove recovery. Closes the gap left by the synthetic `middleware.test.ts` version.

**Gap 2 — CI / deploy gate (prioritized; agent job already DONE above):**

- [ ] **P0 — Gate Railway deploy on CI green.** GitHub branch protection applied 2026-06-15 (exact 4 jobs from ci.yml + enforce admins + required PR + strict checks + conversation resolution). This blocks merges to `main` (and thus deploys) on red CI. **Still needed**: Enable "Wait for CI" toggle on the 3 Railway services (see root TODO_GAPS.md for full subtask list). Update: use `npm run ci:status` / `./scripts/simulate.sh ci` before merging. Highest priority.
- [x] **P1 — Add E2E (Playwright) job to CI.** DONE 2026-05-28. `e2e` job added to `.github/workflows/ci.yml`: pgvector service, migrations + seed, backend build + start, dashboard build + start, `wait-on`, Playwright chromium install + test run, artifact upload on failure. **Needs first-run green in Actions before marking required.** The runtime security proof (anonymous-401, cross-tenant 403, `/ready`) runs only locally today. Concrete plan: new `e2e` job — `ankane/pgvector` service (mirror backend job) → `npm ci` (root + dashboard) → `npm run build` (backend) → start backend + dashboard → `npx playwright install --with-deps chromium` → `cd dashboard && npx playwright test`. **Needs first-run validation in Actions** (browser install + server startup are the usual flake sources) — don't mark required until one green run.
- [ ] **P2 — Repoint Railway `healthcheckPath` → `/ready`.** `railway.json` currently `/health` (shallow); `/ready` would gate deploy _promotion_ on DB reachability. Behavior change (could block promotion during a DB blip) — Dale's call.

**Gap 1 — agent resilience (1A done; remainder):**

- [x] **P2 — Wrap the agent `entry` tail in try/catch → `runFallback`.** DONE 2026-05-28. Added outer try/catch around ToolsClient + buildTools + fetchTenantConfig + buildSystemPrompt. Inner session.start catch retained; outer catch catches setup failures before session.start. Agent TS clean, 1397 tests passing.
- [ ] **P3 — (B) idempotent-read retry** in `toolsClient` — one retry on a transient 5xx for READ tools only (never mutations: a timed-out booking may have succeeded server-side → double-book). Backed out 2026-05-21 (not approved); revisit.
- [x] **P3 — (C) latency filler** — DONE 2026-06-16. `buildTools` accepts optional `speakFiller` callback; wired into `get_available_slots`, `book_appointment`, `book_appointment_with_scheduling`, `answer_policy_question`. `index.ts` passes `session.say` (builds tools inside session try-block). Also fixed pre-existing TS error (`AgentHandoffItem` type narrowing in transcript handler).

**Gap 3 — follow-through (core fix done above):**

- [x] **P3 — Audit the ~12 `:id` routes** — DONE 2026-05-28. All 26 route files use `withHandler` (class-22 mapper fires automatically). One route (`jobber.ts:95`) bypasses `withHandler` but has its own manual UUID check. `requireValidUUID` is defined but unused — not needed since the mapper covers every route. No gaps found.

---

## Voice Validation (Telnyx done; now blocked on LiveKit trunk — see `docs/BETH_GO_LIVE_TODO.md`)

- [ ] Call transcript + summary flow end-to-end
- [ ] Expanded live QA suite (`scripts/qa-live-test.py`)
- [ ] Reminder delivery monitoring dashboard
- [ ] Add coverage for OTP + all 5 booking error codes in live QA

### Live call-transfer (`transfer_call`) + transcript capture — SHIPPED 2026-06-12

Code shipped to prod via **PR #7 merged to main** (`66adafe`); all 3 Railway
services redeployed from main (backend cycled, verified `/health` `started_at
2026-06-12T03:54:12Z`). Agent cold-transfers the live PSTN leg to the owner's
cell via SIP REFER through the inbound trunk; NULL `forward_phone` → AI takes a
message. Transcript capture also live (Calls tab now gets real transcripts).
**Deploy = MERGE to main, not branch push (corrected 2026-06-12 — all 3 services
track main; see CLAUDE.md Project Status).**

- [x] Apply migration `20260611000000_tenant_forward_phone.sql` to prod DB — DONE 2026-06-12 (column live, tracker records it).
- [x] Commit + merge the transfer + transcript feature — DONE 2026-06-12 (PR #7 → main, CI green on all 4 checks, all 3 services deployed).
- [ ] **IN FLIGHT (user) — REMAINING** Enable call transfer / REFER on the Telnyx SIP Connection — else every transfer fails at runtime.
- [ ] **IN FLIGHT (user) — REMAINING** Set the forward number on dashboard AI Persona → "Forward Calls to a Person" (Dale's cell `+1 608 217 5303`).
- [ ] **IN FLIGHT (validation — BLOCKED on a 2nd phone)** Different-carrier call to `+1 630-822-9086` → ask for a person → confirm the cell rings + Calls tab shows the transcript. Dale has no spare phone right now; do later. Also validates the still-open PSTN inbound path + the agent (`ai-sec-agent`) deploy.
- [ ] **Housekeeping** Rotate the Railway team token created 2026-06-12 (`400a1ee0…`) — it was pasted into a Claude session; burn + reissue.

---

## Back-to-Front Wiring — backend built, dashboard not surfacing (audit 2026-06-10)

Gap inventory: functionality the backend already captures or can produce, but the
dashboard does not register/display. Grouped by surface. Each line cites where the
gap lives.

### Calls registration (Calls tab — `voice_sessions`)

The Calls tab (`VoiceCallsView.tsx`) and the `end_voice_session` RPC already
support transcript / summary / outcome / appointment link — the **agent never
captures or sends them**, so every logged call is duration-only.

- [x] **Capture + send transcript** — DONE 2026-06-10. New `agent/src/transcript.ts` `TranscriptRecorder` accumulates `conversation_item_added` turns (caller STT + agent replies incl. greeting); shutdown callback sends `transcript.render()` to `voice-session-end`; `agentTools.ts` schema gains `transcript` (max 100k) → `end_voice_session` param 5. DB column + `VoiceCallsView.tsx:611` display already existed. +5 agent + 2 backend tests; agent 127 / backend voice-session 7 green, both typecheck clean. **Validation pending: live call to confirm real transcript lands.**
- [x] **Generate + send call summary** — DONE (Gap #1, 2026-06-12). `callSummary.ts` post-call GPT-4o-mini summary in shutdown hook → `voice-session-end`.
- [x] **Set call outcome** — DONE (Gap #1, 2026-06-12). `CallOutcomeTracker` set by booking + transfer + `callClassify.ts`; shutdown hook sends `outcome` to `voice-session-end`.
- [x] **Link booked appointment to the call** — DONE (Gap #1, 2026-06-12). `recordBooking(appointment_id)` in tools → shutdown hook → `voice-session-end` param.
- [x] **Register transfer events in the call record** — DONE (via `recordTransfer()` setting outcome + migration-updated `end_voice_session` that sets status='transferred' when outcome='transferred'). UI already supported it. See feat/transfers-invisible-calls + related list work.

### Analytics (`AnalyticsView.tsx`)

- [ ] **Implement `GET /analytics/stats`** — `dashboard/lib/api.ts:607` calls it and expects `{ calls, appointments, customers, recent_activity }`, but **no backend route exists** (only `src/routes/analytics.ts` aggregations). Frontend currently falls back to manual appointment aggregation with no call data.
- [ ] **Wire the 3 stubbed call-based panels** — `AnalyticsView.tsx` marks "Call Volume Over Time", "Call → Booking Conversion", and "Caller Abandonment Point" as _"Requires call log integration Phase 2"_. Now that inbound calls ARE logged to `voice_sessions`, these can be built from real data (depends on outcome capture above for conversion/abandonment).
- [ ] **(Optional) Owner-facing reliability tiles** — `booking_attempts_total`, `tool_calls_total` (`src/services/metrics.ts:284,291`) are Prometheus-only (`/metrics`, token-gated). Consider a lightweight owner view of booking success rate + agent tool success rate (or leave to ops dashboards — decide).

### Reminder delivery monitoring (Phase 5 — never built)

- [x] **Reminder delivery dashboard** — Added `GET /reminders/delivery-stats` (table aggregates: sent/failed by recency for the tenant) + `ReminderDeliveryStats` component (cards with rates) wired into `AnalyticsView.tsx`. Uses DB (not just in-memory metrics) for per-tenant owner view. See feat/transfers-invisible-calls (progress on list). Full dashboard panel polish possible later.

### CRM sync status (`CRMIntegrationCard.tsx`)

- [x] **Surface pending/error sync counts** — Extended `CRMIntegrationCard` (and square provider config) to fetch + display `pending_count` / `error_count` / `total_mapped` from the existing `/.../sync/status` endpoints below the last-sync line. See list work on backfill branch. Prometheus metrics remain for ops.

### Onboarding / Website knowledge import (new step for reduced manual entry)

Backend fetch+LLM extract core now wired (`/knowledge/import-website` + helpers + `knowledge_suggestion` staging + migration). Designed as optional early step in SetupWizard flow (paste URL after business type → suggestions prefill questionnaire). Full details and remaining dashboard/review/ingest wiring in the spec and worktree.

- [x] **Dedicated "Import from website" step in the SetupWizard (right before the questions/policy step).** Inserted as step 7 ("Import from website") after the review step (6), immediately before the "Teach Your AI" questions step (now 8). New component `Step7WebsiteScan.tsx` with URL input + scan button that runs the backend extract and saves matching starter answers via knowledge.add. The questions step now loads pre-existing answers (by matching question text in the tenant_docs) on mount and prefills + marks saved, so the scan directly helps answer the questions in the following step. Wizard updated (type to 9 steps, labels, arrays, "of 9", next button text, expand timing, comments). User-facing explanatory copy added to scan page per spec: "when questions are asked of your AI Assistant, the information from your company comes from here. Our system will scan your website... The following page is to answer any...". Also cleaned duplicate import box from questions step in main wizard (kept for Solo via prop). See the implementation in `Step7WebsiteScan.tsx`, updates to `Step7CallerQuestions.tsx` (load prefill + conditional import box), `index.tsx`, `WizardStepContent.tsx`, `types.ts`. Advanced per-question suggestion review UI with badges still pending (see other sub-items).
- [ ] **Wire question bank resolver into import + wizard.** Ensure `GET /knowledge/questions` (or direct resolve) is used for the extract prompt (business_type filtered + customs). Update SetupWizard / `KnowledgeBaseView` to consume the resolved set instead of (or in addition to) static. Seed the bank from `shared/questionBank.ts` via the script (already in worktree scaffold).
- [ ] **E2E + simulate coverage for the step.** Add Playwright spec exercising wizard → URL paste → suggestions appear → approve one → verify in KB / policy-answer works. Extend `simulate.sh tools` or new harness to cover import path (demo tenant with sample site? or mock). Gate on the RAG accuracy eval.
- [ ] **Docs / UX polish.** Update SetupWizard copy and `docs/beth-knowledge-base.md` (or onboarding docs) to describe the new optional step and "from your website" provenance. Add empty-vs-unanswered visual distinction (per design). Cost guardrails / rate limits if needed for LLM calls during onboarding.

See also the RAG accuracy eval (now unblocks this) and question bank migration (20260609... in feature worktree).

---

## Non-blocking / Polish

- [ ] Pricing tiers (Pro/Enterprise) positioning
- [x] Continue `src/index.ts` extraction / cleanup — DONE 2026-05-28. Health/admin inline routes (/, /demo, /health, /ready, /metrics, /admin/purge-soft-reservations) extracted to `src/routes/health.ts`. index.ts: 386→303 lines. `/admin/purge-soft-reservations` now wrapped in `withHandler` (was bare try/catch). health.ts has no file-wide eslint-disable (targeted inline disables only).
- [x] Finish broader CRM sync structure extraction (NEEDS-REFACTORING #10) — DONE (verified 2026-06-03). Clients + adapters moved to `src/services/crm/` (`e75b029`); shared layer fully extracted: `tokenManagement.getIntegrationTokens` (OAuth refresh), `syncMapHelpers` (sync-map/dedup incl. `ensureRemoteCustomer`/`isAlreadySynced`), `crmSyncStatus`, `syncPaginate`, `crmDisconnect`, `syncOrchestrator` dispatch loop. The remaining per-adapter code (jobber/hubspot/square/servicetitan) is genuinely provider-specific CRM-API logic over that shared layer — kept flat per "working flat beats a dormant abstraction." No further extraction warranted.

Closed: `pw.txt` decision (`ac61161` — deleted, NEEDS-REFACTORING #14 closed); dashboard Sentry integration (`c3e679e` — `@sentry/nextjs` server+client wired); `docs/README.md` (2026-05-15).

## UX backlog (from 2026-05-16 `/ux-expert` audit)

Closed items in `RESOLVED.md` under 2026-05-16 + 2026-05-17.

Open:

- [x] **B4** Sub-tab URL persistence — verified working (2026-05-28). `?tab=` init + `history.pushState` on change + `popstate` for back/forward all wired in `dashboard/app/dashboard/page.tsx:70–95`. No changes needed.
- [x] **C1 + C2** Schedule: 4 sub-views → 2, unify the 3 headers — DONE 2026-05-29 (`1a269ab`, verified 2026-06-03). `SchedulerView` now has 2 top-level tabs (`day`/`calendar`) + a segmented Day-mode control (Staff/Resources/List), one unified header bar (3 dup headers removed), and the "More" overflow dropdown gone. URL syncs `?subtab=day|calendar&daymode=…`. The TODO predated the commit.
- [x] **E1** Demo mode — DONE 2026-05-29 (`4934ed5`, verified 2026-06-03). `/demo` now provisions a per-session isolated demo tenant (`is_demo=true`, 30-min TTL) seeded with automotive sample data — no real account needed. `src/routes/demo.ts` + `src/services/demoSeed.ts` + `dashboard/app/demo`. The TODO predated the commit.

## UX audit pass 2 (2026-05-19)

Source: Raw UX audit performed 2026-05-19 (previously captured in `ux-review-notes.md`, now archived). High/medium findings triaged below. No separate source-of-truth file is maintained for the raw notes.

### P0 — verified rule violations + real defects (small, concrete)

- [ ] **BLOCKER (Dale)** Dale needs to go over the scheduling and how the coloring, grading, etc. work in the live UI so he can guide the system on how to deal with grading. Cluster A below is **on hold** until then — a first attempt (wizard review + skill-map de-grade) was built and reverted 2026-05-20 (`git reset --hard 0f7f1d0`) because the right neutral treatment depends on how each surface actually works. Do not re-apply the de-grade slices unprompted. See memory `feedback-no-coverage-grading`.
- [ ] **Cluster A — neutral-language / no-grading** (8 surfaces) — _blocked on the Dale review above._ Violates the explicit product rule "no percentages, no warnings, no opinions" (`docs/DESIGN_HANDOFF.md:284`, `docs/UI_UX_DESIGN.md:30`). Same fix shape everywhere: rename grading tokens → neutral connection/availability state, drop green/yellow/red threshold colors, factual copy.
  - ~~`SoloStepReview.tsx`~~ DONE 2026-05-28 (`b140f98`) — coverage pills replaced with neutral language. + `StepReview.tsx` — still open — `allCovered`/`partial` + green/yellow/red readiness badges
  - ~~WCAG `text-[10px]`~~ DONE 2026-05-28 — 45 replacements across 25 files; 0 remaining occurrences
  - `skill-map/SkillRelationshipMap.tsx` + `SkillMapNode.tsx` — footer `full`/`partial`/`uncovered` + warning/danger colors
  - `scheduler/ResourceColumnsView.tsx` — empty slots classed as `gap`
  - `scheduler/AppointmentListView.tsx` — long gaps as amber alert rows
  - `scheduler/EmployeeDayFocusPanel.tsx` — utilization color-graded green/yellow/gray
  - `AnalyticsView.tsx` — keep summaries neutral, no implicit scoring
  - (related medium) `AppointmentDetailPanel.tsx` — alignment-blocked message reads as warning banner; make factual
- [x] **Cluster B — verified defects** (3 sites, all done)
  - [x] `SetupWizard/StepServices.tsx` — DONE 2026-05-21. Duration field now uses a raw-text display state; clearing leaves it empty (was forced to `0`), empty propagates `0` (saveService's `< 1` guard rejects it), never NaN. +3-test regression spec `StepServices.test.tsx`. (Note: it was an input-UX bug, not silent data loss — `saveService` already rejected `0`.)
  - [x] `SuperAdminDashboard.tsx` — DONE 2026-05-21. Search input now controlled; filters sidebar cards by name (case-insensitive), shows a no-match message, and **disables drag-reorder while filtering** (added `draggable` prop to `TenantCard`; reorder math is by full-array index so a filtered subset would corrupt order). +3 tests in `superadmin.test.tsx`.
  - [x] `SetupWizard/index.tsx` — DONE 2026-05-21. Seed hoisted to `runSeed` (reconcile by name-diff via `seedTargetRef`, so partial-failure retry finishes without topping-up a user's own services); failure now surfaces a Retry banner instead of a silent `console.warn`. +2 tests. **All three Cluster-B defects closed.**

### P1 — a11y + shared-primitive consistency (cluster fixes)

- [x] **Cluster C — overlay/dialog focus management.** DONE 2026-05-28. `useFocusTrap` hook (`dashboard/lib/useFocusTrap.ts`) added; all 8 surfaces updated: `WizardModeChooser` (role/aria + trap + backdrop), `WizardWelcome` (trap + Escape + backdrop), `FirstRunTour` (trap + Escape + backdrop), `SetupWizard/index` (trap + Escape), `AppointmentPopover` (Tab trap + X button), `StaffProfileCard` (role + X + focus management), `EmployeeDayFocusPanel` (role + aria-labelledby + trap), `SkillMapFixPanel` (aria-label on ✕). 743 tests passing (+17 new).
- [x] **Cluster D — accessible action controls.** DONE 2026-05-28. All 7 surfaces: Step{Employees,Services,Resources} — `onMouseEnter/Leave` → CSS `hover:` + `focus-visible:` + rings; SkillManagementView delete — `focus-visible:ring-2`; StaffSwimLaneView — aria-label specific with shift times; AppointmentBlock — `role="button"`, `tabIndex=0`, `onKeyDown` Enter/Space, `aria-label`. 746 tests (+3 new).
- [x] **Cluster E — empty / loading / filtered-no-results distinctness.** DONE 2026-05-28. `AppointmentListSidebar` — skeleton rows during load; `VoiceCallsView` — Filter icon + "Clear filter" CTA for no-results (vs PhoneOff for "no calls ever"); `EmployeeManagementView` — dashed empty state after load; `CustomerDetailPanel` — 3 italic-text empties → `EmptyState` compact with icons. `KnowledgeBaseView`/`DeletedRecordsPanel` already had strong distinction; `MyTeamView` is routing-only. 746 tests passing.

### P2 — copy / trust polish

- [x] `SetupWizard/WizardWelcome.tsx` — DONE 2026-05-28 (`c804025`). Removed inaccurate "10 minutes / 6 quick questions" copy.
- [x] `SkillMatrixView.tsx` footer + `Step7GoLive.tsx` — drop persuasive/reassurance phrasing; state what changes factually. Done 2026-05-28.
- [x] `SetupProgressPill.tsx` — DONE 2026-05-28 (`bdd549e`). Removed `hidden` class; pill visible on all screen sizes.
- [x] `ProfileView.tsx` — "Security" card "coming soon" placeholder → replaced with factual account info (session expiry 8h + password-change instruction). DONE 2026-05-28.

### P2.5 — Wizard Phase B: full draft commit model

- [ ] **`SetupWizard` + `SoloWizard` draft state.** Phase A (2026-05-27) added back-at-every-stage + auto-seed rollback on re-pick, which solves the visible bug Dale flagged ("all of the businesses have the same data when picking services"). Phase B is the principled fix for the parallel ask ("data shouldn't be solid until we are out of the wizard"): hold services/resources/employees/shifts/mappings in local state during the wizard, commit to DB only on the Step 7 Done click, discard on dismiss. Touches ~5K lines of wizard infrastructure (`useWizardCrud.ts` rewrite, `WizardStepContent` props, all `Step*.tsx` components, 5 test files). Needs `VocabularyProvider` to accept an `overrideTemplate` so vocab follows draft business_type without DB write. Open in a fresh branch; coordinate with P1 Cluster C (Modal primitive migration) since both touch overlay shells. See `dashboard/components/SetupWizard/SetupWizard.backToPicker.test.tsx` for the auto-seed-rollback contract Phase B must preserve.
- [x] **`tenants /update-config` partial-update safety.** Already implemented — read-then-merge in place (lines 204–207 `body.field !== undefined` check inside the `FOR UPDATE` transaction). Verified 2026-05-28. Standalone small PR.

### P3 — large structural decomposition (defer; medium-high effort, vague-per-finding)

- [ ] Dense-view chunking / shell-continuity `[high]`s — track but don't action piecemeal: `SettingsView` (split owner vs super-admin), `TenantEditPanel` (separate provisioning from AI-config), `CRMView`, `AppointmentView`, `DashboardHome` hierarchy, `CustomerDetailPanel`, `DeletedRecordsPanel`, `RecordHistoryModal`, `NewSchedulerView` / `SchedulerView` orchestration overlap, `ShiftManagementView` changed-vs-saved, `ServiceAssignmentView` / `SkillAssignmentsView` / `SkillMatrixView` completion cues. Several overlap with **C1+C2** (scheduler consolidation) above — sequence with that work.
- [x] Responsive fallbacks for wide matrices/maps — verified present 2026-06-03. `ResourceColumnsView`/`SkillRelationshipMap` already scroll (`overflow-x-auto`/`overflow-auto`); `OutlookLayout` has an `md:hidden` mobile nav; `SchedulerDateNav` is compact. `mobile-responsive.spec.ts` covers no-horizontal-overflow on 390px + Android. No change needed.

## Tooling cleanup (remaining ESLint promotions)

Small mechanical hygiene pass completed: cleaned up remaining references to the now-historical NEEDS-REFACTORING.md in source comments (updated to point to RESOLVED.md / REFACTORING_TODO.md for accuracy).

Most of the 2026-05-17 lint adoption already promoted to `error`. Still at `warn`:

- [x] `@typescript-eslint/no-explicit-any` + `no-unsafe-*` family — DONE 2026-05-28. Fixed all 13 files / 59 warnings: typed `response.json()` casts in `api.ts`, `hooks.ts`, `LoginView`, `register`, `forgot-password`, `reset-password`; cast `JSON.parse` returns in `NewSchedulerView`; eslint-disable for `react-big-calendar` third-party `any` (unfixable at source); removed unused `Wrench`/`QuickAction`/`Save`/`rate` symbols; fixed unescaped entities in `Step7CallerQuestions`. Dashboard lint: **0 warnings, 0 errors**.
- [x] `@typescript-eslint/no-misused-promises` — DONE 2026-05-28. Zero violations across all 3 packages; promoted to `error` in all three eslint configs.
- [x] `@typescript-eslint/await-thenable` — DONE 2026-05-28. Zero violations; promoted to `error` in all three eslint configs.
- [ ] `@typescript-eslint/unbound-method` (heavy in tests — may stay warn forever)

Closed: `consistent-type-imports`, `no-unused-vars`, `no-floating-promises`, `require-await`, `restrict-template-expressions`, `no-unnecessary-type-assertion`, `no-base-to-string`, `ban-types`, `prefer-promise-reject-errors` (all promoted to error 2026-05-17/18); Prettier format sweep across all three projects (`79b227c`).

## Documentation

(empty)

---

## E2E suite broken by seed-strip — RESOLVED 2026-06-03 (`f1666e8`)

The bare-bones seed (commit `9e9f186`) deletes the DynaTire tenant, but the e2e
fixture `seedDynaTireBusinessConfig` was NOT updated to recreate it — it inserted
resources/services/employees under `DYNATIRE_TENANT_ID` while never inserting the
tenant + owner, so it FK-failed on `resources_tenant_id_fkey` and broke all ~16
specs that call it. The suite had been red since `9e9f186`.

**Fixed via option (A):** `seedDynaTireBusinessConfig` now creates the test-only
DynaTire tenant + owner (idempotent) before the rest; `auth-flows.spec.ts` (never
migrated) now calls the helper in beforeAll/afterAll. This DynaTire is a fictional
TEST fixture in the ephemeral rebuilt DB, NOT the removed real customer. Verified:
full Playwright suite **111 passed / 7 skipped**.

Still open: **prod DB DynaTire removal** — gated on the Railway token (`/tmp/rwtok`);
local dev DB already clean (0 DynaTire rows).

## E2E Known Issues (Playwright)

Three failures were observed on **2026-05-27** (110 tests; 100 passed, 3 failed, 7 skipped). All three fixed 2026-05-28 — see RESOLVED.md.

**Fix summary (2026-05-28)**:

1. `booking-alignment.spec.ts` — replaced `waitForTimeout(800)` with `expect(view-tab-list).toBeVisible()`, added `expect(Refresh btn).toBeVisible()` + `waitForLoadState('networkidle')` after click. Also fixed same pattern in `appointment-cancel-ui.spec.ts` helper (`openAppointmentPopoverFromList`).
2. `wizard-welcome-auto-open.spec.ts` — replaced `waitForTimeout(600)` + `waitForTimeout(2000)` in `switchToFreshTenant` with `waitForLoadState('networkidle')` so all 6 `loadData()` API calls settle before the auto-open effect fires.

**New E2E coverage added 2026-05-27**:

- `customer-notes.spec.ts` (Gap 1) — Internal Notes persistence + visibility. Research surfaced likely latent bug: CRMView sends top-level `notes` on PUT but backend schema drops it.
- `appointment-cancel-ui.spec.ts` (Gap 2) — Cancel from List, Customer history, and popover surfaces (hardened version of the known flake at booking-alignment:295 using response waits + status polling).
- `owner-config-to-booking.spec.ts` (Gap 3) — Owner adds employee + shifts (via expand-weekly) + service/resource, then successfully books against them; plus the sad path of no shifts configured.

Cross-references:

- Original raw UX audit notes (archived; key findings triaged here)
- `docs/TODO.md` → UX audit pass 2 → P1 Cluster C and P2 wizard copy items
- CI section: "P1 — Add E2E job to CI"

---

**Archived detailed history**: See `CURRENT_STATUS_ARCHIVED_2026-05-15.md` for previous session notes and long-form status.
