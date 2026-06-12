# Session Handoff — 2026-06-12

Pick-up notes for the next session / agent. Source of truth for the task queue
is `docs/TODO.md`; strategy is `docs/STRATEGY.md` + `docs/COMPETITOR_WEAKPOINTS.md`.

## Git state RIGHT NOW
- **`main`** (`c4585c7`) — deployed to prod. Has: live call-transfer + transcript capture, the simulation harness, baseline.sql fix + drift guard, gap #1 (call outcome/link/summary), gap #2 (real call analytics + tests).
- **Branch `feat/remove-competitor-crms`** (`403ac28`, 1 commit ahead, **NOT pushed/merged**) — removes Jobber/ServiceTitan/HubSpot CRM integrations; keeps Square. Build + 1770 backend + 747 dashboard tests green. **Next action: open its PR → main.**
- Prod deploys from **`main` via MERGE** (not branch push). Merge = instant deploy of all 3 Railway services. No migration pending for the CRM branch.

## Local dev stack (for `simulate` / E2E)
- Backend on `https://localhost:4001` (self-signed). Docker Postgres in container `ai-sec-db` on `localhost:5433`. After backend code changes: `kill $(lsof -ti :4001); npm run build && nohup node dist/src/index.js > /tmp/sim-backend.log 2>&1 &`.
- On-demand verify: `./scripts/simulate.sh status --env prod|local [--deep]` · `tools` (agent-tools journey) · `call` (browser voice test, no phone).
- The running backend may be stale after the CRM deletion — rebuild+restart before using it.

## What shipped this session (all on `main`, deployed)
1. **Live call-transfer** (`transfer_call`, SIP REFER to owner cell) + **transcript capture** (PR #7).
2. **Prod DB** migrations applied + `schema_migrations` reconciled.
3. **`scripts/simulate.sh`** — system simulation/health harness (replaced dead `qa-live-test.py`).
4. **baseline.sql fix** — was stale (missing `is_demo`/`tts_*`/`forward_phone`), broke every rebuilt DB + E2E; regenerated via `pg_dump` + self-maintaining drift guard (`verify-schema-alignment`).
5. **Gap #1** — agent sends call `outcome` + `appointment_id` (call→appointment link) + bounded/failsafe post-call summary to `voice-session-end`.
6. **Gap #2** — real call analytics: `GET /analytics/stats` + `/analytics/calls`; dashboard Volume/Conversion/Abandonment + "Why Callers Reached Out" WHY panel. Backend + component + E2E tests (all ran green).
7. **Strategy docs** — `docs/STRATEGY.md`, `docs/COMPETITOR_WEAKPOINTS.md`, `SECRETARYHQ_FEATURES.md`.
8. **CRM deletion** (on branch, not merged) — see git state above.

## NEXT — task queue (fresh branch off main, one PR each)
1. **Open the PR for `feat/remove-competitor-crms`** ← immediate.
2. **(cosmetic) Clean stale comments** in the shared CRM layer (~9 files: `crmRouteScaffold`, `tokenManagement`, `syncMapHelpers`, `oauthCallbackFactory`, `oauthStateJwt`, `syncPaginate`, `crmDisconnect`, `crmSyncStatus`, `jsonContentTypeParser`) — docstrings still name the deleted Jobber/HubSpot/ServiceTitan. Non-breaking.
3. **Richer WHY outcome classification** — agent classifies *why* a non-booking happened (price / no-availability / wrong-service / after-hours), not just booked/transferred/message. Unlocks the high-value reporting cut ("14 callers wanted Saturday slots you don't offer"). The gap #2 WHY panel + owner copilot consume it.
4. **Stripe — verify ALL paths** — built (`src/routes/billing.ts`), never tested. Use Stripe **test mode** (test keys + Stripe CLI webhook replay): checkout → webhook signature → subscription activates → payment_failed → cancellation → plan gating. Add a Stripe path-check to `simulate`. **Blocked on Dale: test account/keys** (drop `sk_test_…` in `/tmp/stripe`).
5. **Twilio SMS delivery receipts** + **communications-history** stub (lower priority).

## Blocked on Dale (can't be done by an agent)
- **Stripe test account + keys** (for #4 above).
- **Railway env check** — needs a fresh team token (`/tmp/rwtok`). Verify `BACKEND_URL` on `ai-sec-agent` (silent-failure risk for the shipped voice features), `TWILIO_*` (reminder SMS runs a MOCK in prod without it), `EMAIL_*` (email runs a mock), + the known-unset `METRICS_TOKEN`/`SENTRY_DSN`/`BETTER_STACK_TOKEN`/Stripe keys.
- **Live PSTN call** — needs a 2nd phone (different carrier) → `+1 630-822-9086`; validates the unverified inbound path + transcript landing. Plus enable **call transfer/REFER on the Telnyx SIP Connection** + set the **forward number** on dashboard AI Persona.
- **Rotate** the Railway team token created 2026-06-12 (`400a1ee0…`) — it was pasted in a session.

## Strategy in one breath (full: `docs/STRATEGY.md`)
Receptionist-first; **cross-platform / no-platform**; **non-trades verticals** (salons/auto/fitness/food) where no incumbent bundles a receptionist. **Freeze→removed** the 3 competitor CRMs (their vendors ship native receptionists); **Square stays** (payments partner). Build the **operational system-of-record, not a full CRM**; expand into add-ons later, per demand (build the safe ones, partner the regulated — payments→Square, payroll→Gusto). **Stripe = our SaaS billing only** (no service-payment processing). **Pricing (deferred):** value-aligned **volume** — meter on bookings/calls, never seats or minutes. **Heuristic:** a vendor's money model predicts if it competes — SaaS-seat-bundlers compete, transaction/volume/infra vendors partner. Captured ideas: owner AI copilot, website-scan onboarding, restaurant vertical add-on, WHY-reporting depth.
