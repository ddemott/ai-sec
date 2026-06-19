# TODO_GAPS.md — Actionable Checklist from GAPS.md

Derived from `GAPS.md` (2026-06-15 deep dive). Each item maps back to a GAPS.md section.  
**Key rule**: Ship = merge to main via PR + apply prod DB migration + validate with `./scripts/simulate.sh`.  
**Last synced**: 2026-06-18 against commits through PR #31 + prod env audit.

---

## P0 — Unblock Real Customers / Beth Go-Live

### PSTN / Voice

- [ ] Dial `+1 630-866-1960` from a **different carrier** while watching `listRooms()` — confirm inbound PSTN path end-to-end
- [ ] Enable **Telnyx REFER / call transfer** on the SIP Connection (`livekit-outbound`) so `transfer_call` tool works live
- [ ] Set `forward_phone` on Beth's tenant dashboard (Phone Assistant → AI Persona) so live transfer has a destination. Verified 2026-06-18: `null`/`""` already handled — agent falls back to `take_message` when unset (`transferClient.ts:62`).

### Silent-Degrade Prod Fixes

- [x] **SMS mock → Telnyx** — DONE 2026-06-16 (PR #23). `ProviderRegistry` defaults to Telnyx. `TELNYX_PHONE_NUMBER` confirmed set prod 2026-06-18 (corrected from wrong `+16308229086` to `+16308661960`). Dead vars `VAPI_API_KEY` + `SUPABASE_ACCESS_TOKEN` removed from prod.
- [x] **Email mock** — DONE. Boot warning fires (PR #25). `EMAIL_USER=daledemott@gmail.com` + `EMAIL_PASS` confirmed set prod 2026-06-18.
- [x] **Agent `BACKEND_URL`** — DONE 2026-06-16. Agent exits at startup if unset. `BACKEND_URL=https://ai-sec-production.up.railway.app` confirmed set prod. Typo duplicate `BACKND_URL` removed from agent service 2026-06-18.
- [x] **`STRIPE_WEBHOOK_SECRET`** — DONE. Boot warning fires (PR #22 bundle). `STRIPE_WEBHOOK_SECRET` confirmed set prod 2026-06-18.
- [x] **`CORS_ORIGIN`** — DONE. Boot warning fires. `CORS_ORIGIN=https://www.secretaryhq.com` confirmed set prod 2026-06-18.
- [x] **`DASHBOARD_URL`** — DONE. Boot warning fires. `DASHBOARD_URL=https://www.secretaryhq.com` confirmed set prod 2026-06-18.

### Observability

- [x] `METRICS_TOKEN` — confirmed set prod 2026-06-18. `/metrics` endpoint live.
- [ ] Set `BETTER_STACK_TOKEN` on Railway (backend + agent services) — logs are stdout-only; non-blocking
- [ ] Set `SENTRY_DSN` on Railway (backend + agent services) — no error grouping; non-blocking

### CI / Deploy Gate

- [ ] **Gate Railway deploys on CI green** — GitHub branch protection on `main` applied 2026-06-15 (4 jobs + enforce admins + required PR + conversation resolution). **Remaining**: Enable "Wait for CI" toggle on the 3 Railway services.
  - [x] On-demand CI status tool (`./scripts/simulate.sh ci` + `npm run ci:status`/`ci:watch`) — 2026-06-15
  - [x] `.github/BRANCH_PROTECTION.md` updated with exact required check names — 2026-06-15
  - [x] Branch protection applied on `main` via `gh api` — 2026-06-15
  - [ ] Enable "Wait for CI" on Railway services (ai-sec backend, ai-sec-agent, dashboard)
  - [x] All `docs/` references updated to document merge-gate flow — 2026-06-15
  - [ ] End-to-end gate verification: open a deliberate-fail PR, confirm block, fix, confirm green unblocks

### Stripe Live Verification

- [x] **`automatic_tax`** — DONE 2026-06-16. Gated on `STRIPE_AUTO_TAX=true` env var. **User actions**: enable Stripe Tax in Stripe dashboard, register IL nexus, set `STRIPE_AUTO_TAX=true` on Railway.
- [x] **`simulate stripe`** — DONE 2026-06-16 (PR #24). `./scripts/simulate.sh stripe` checks checkout + webhook + subscription gate.
- [ ] Run Stripe in test mode + `stripe listen` — full round-trip: owner checkout → webhook → `subscription_status` set → `subscriptionGate` allows access
- [x] Prod price IDs — `STRIPE_SOLO_PRICE_ID` + `STRIPE_GROWTH_PRICE_ID` confirmed set prod 2026-06-18. `STRIPE_PRO_PRICE_ID` not needed (Pro tier not in UI yet).

### Legal / Ops (user actions — not code)

- [ ] Bonterms ToS + Privacy Policy + DPA published and linked from dashboard
- [ ] TCPA-compliant SMS opt-in language at booking time (see consent design in GAPS.md §9)
- [ ] E&O + Cyber Liability insurance
- [ ] LLC bank account open (Stripe payouts)

---

## P1 — Customer Success & Trust

### Customer Self-Service Links

- [x] **Cancel link in appointment confirmation SMS** — DONE 2026-06-16 (`feat/self-service`: signed JWT token, `/self-service/appointments/:id/cancel?token=`, wired into `smsService.ts` confirmation SMS template). Security review passed (Copilot thread resolved).
- [x] **Reschedule link** — DONE 2026-06-18 (PR #34). `GET /self/reschedule?token=` validates JWT, fires owner SMS, returns human-readable confirmation. `buildRescheduleLink()` in `appointmentService.ts`; reschedule link appended to SMS confirmation + reminder.
- [x] **Email action links** — DONE 2026-06-18 (PR #34). `buildCancelLink()` + `buildRescheduleLink()` both injected into email confirmation + reminder templateData; HTML templates replaced `<a href="#">` placeholders with conditional real buttons; text version appends URLs.
- [ ] Dashboard: "Send self-service links" button in `AppointmentDetailPanel.tsx` (shows which links were sent)
- [ ] Tests: E2E "book → SMS with link → link reschedules", negative (expired, wrong tenant, double-use for reschedule)

### Agent Voice Tools

- [x] **`take_message`** — DONE 2026-06-16 (PR #22). Collects caller name + message + callback phone, persists to `customer_messages`, SMS-notifies owner.
- [x] **`get_my_appointments`** — DONE 2026-06-16 (PR #22 commit). Known caller lookup by verified phone.
- [x] **`cancel_appointment`** — DONE 2026-06-16 (PR #22 commit). Voice-driven cancellation.
- [x] **`reschedule_appointment`** — DONE 2026-06-18 (PR #34). `POST /agent-tools/reschedule-appointment` UPDATE-in-place with phone ownership guard; GiST exclusion catches slot conflicts (23P01); fires calendar sync. Agent tool in `agent/src/tools.ts` with filler phrase.

### Live Communications Providers

- [x] **Commit to Telnyx SMS** — DONE 2026-06-16 (PR #23). `ProviderRegistry` defaults to Telnyx; `telnyxSms.ts` fully wired. Boot warning on missing `TELNYX_PHONE_NUMBER`.
- [ ] Set `TELNYX_PHONE_NUMBER=+16308661960` on Railway (user action — code done)
- [ ] Verify reminder delivery stats in prod after creds set

### Billing UI for Owners

- [x] **`createPortalSession`** — DONE 2026-06-16 (PR #22 commit). `src/routes/billing.ts` gains `POST /billing/portal`; creates Stripe Billing Portal session.
- [x] **api.ts billing namespace** — DONE 2026-06-16. Added `billing.portal()`, fixed `'professional'` missing from plan type union.
- [x] **Billing UI component** — DONE 2026-06-16. Plan cards with current plan highlight, "Upgrade" → Stripe Checkout, "Manage Billing" → Stripe Portal. Wired into dashboard My Business / Settings.
- [x] **Surface 402 errors in UI** — DONE 2026-06-18 (PR #34). Module-level `subscriptionRequiredCallback` in `api.ts`; `DashboardPage` registers on mount → toast "Upgrade required" with "Go to Billing" action navigating to billing subtab.

### Owner Notification Phone

- [x] **Owner notification phone self-serve** — DONE 2026-06-17 (PR #29). `owner_phone` exposed in `getConfig` GET + `update-config` POST; AI Persona page now shows editable "Notification Number" field; E.164-normalizes on save.

### Comms History

- [x] **Sent tab in Calls** — DONE 2026-06-17 (PR #28). Outbound comms history table with channel filter (SMS/email/all) + pagination; shows status, delivery receipt, channel, message preview.
- [x] **Messages inbox in Calls** — DONE 2026-06-16 (PR #22). Owner inbox for `take_message` entries; mark-read/unread actions.

### Owner Cost / Usage Meter

- [ ] Instrument AI cost at 5-6 call sites: `agent/src/toolsClient.ts`, `callSummary.ts`, `knowledgeIngestion.ts`, `knowledge.ts` policy-answer path, `grokTTS.ts`
- [ ] Choose data model: `cost_usd` column on `voice_sessions` vs new `tenant_daily_usage` table
- [ ] Surface "Usage this month" card in Analytics (calls + estimated AI spend)

### Outcome-Driven Automations

- [x] **Outcome-driven owner SMS** — DONE 2026-06-18 (PR #34). `voice-session-end` fires fire-and-forget owner SMS when outcome is `price` or `no_availability`, prompting follow-up on lost leads.

### Calendar Sync Live Proof

- [ ] Set `GOOGLE_CLIENT_ID/SECRET/REDIRECT` on Railway for at least one tenant
- [ ] Prove a real Google Calendar sync round-trip using existing `calendarSync.ts` + `SYNC_TEST_RECORDER` pattern

---

## P2 — Quality, Scale & Defensibility

### Agent Reliability

- [x] **Filler phrases before slow tools** — DONE 2026-06-16 (PR #22 commit). Injected before `getAvailableSlots`, `book_appointment`, `book_appointment_with_scheduling`, `answer_policy_question` via `speakFiller` callback.
- [ ] Idempotent-read retry for transient agent-tools failures (backed out 2026-05-21; revisit)

### Call Summary

- [x] **Call summary timeout 3s → 8s** — DONE 2026-06-18 (PR #30). OpenAI p95 exceeds 3000ms; bumped to 8000ms so summaries no longer time out on real calls.

### Load Testing

- [ ] Load test booking path to find pool exhaustion cliff (pool `max=10`)
- [ ] Document scaling knobs (pool size, agent worker count per tenant)

### Data Portability & Retention

- [ ] `GET /export/tenant-data` route — streams ZIP of JSONL/CSV covering all tenant data
- [ ] Hard-purge (GDPR/CCPA) path: anonymize `voice_sessions` phone+transcript, delete customer notes/preferences, write to audit
- [ ] Automated retention/purge worker: configurable max age for `voice_sessions`, `communications_history`, soft-deleted rows
- [ ] Owner-facing audit log view (show own-data changes from `audit_log` table)

### Website Scan Polish (onboarding §5)

- [x] **Per-question review UI** — DONE 2026-06-16 (`feat(knowledge): suggestion review UI for website-scan Q&A`). Accept/reject badges in Step 7 (`Step7WebsiteScan.tsx`).
- [ ] E2E coverage for website scan flow
- [ ] Rate-limit / cost guardrails on repeated scans
- [ ] Periodic re-scan scheduler (poll for stale KB entries)

### Analytics Depth

- [ ] Source citations shown to caller when answering from KB (RAG §5)
- [ ] Admin "explain this answer" debugger for KB RAG
- [ ] Deeper analytics: cohort / CLV / service-specific abandonment drill-down

### Dashboard / UX

- [x] **Inbound phone on Home tab** — DONE 2026-06-18 (PR #31). `getConfig` SELECT now includes `inbound_phone`; Home tab AI Receptionist card shows "Active on (630) 866-1960" when a DID is provisioned.
- [x] **Demo phone on landing page** — DONE 2026-06-17. `(630) 866-1960` in nav bar (desktop + mobile menu).
- [x] **NaN availability tiles** — DONE 2026-06-18 (PR #30). `shift_date` ISO timestamp normalized with `.slice(0, 10)` before date construction; regression test added.
- [x] **NaN service update validation** — DONE 2026-06-18 (PR #30). `Number.isFinite` guards prevent NaN from reaching Zod `min(5)` on `duration_minutes` / `price`.

### Docs / Runbook Gaps

- [ ] Owner admin guides ("how to read analytics", FAQ)
- [ ] Telephony troubleshooting playbook (Telnyx, LiveKit, PSTN issues)
- [ ] Prod incident runbook: "agent silent", "reminders not sending", "Stripe webhook 400"
- [ ] Stale references: remove edge-function mentions from `docs/DEPLOYMENT.md`

---

## P3 — Moat & Expansion

### Integrations

- [ ] Square CRM: deeper bidirectional reads (pull open jobs into voice context)
- [ ] Real external OAuth + Stripe + live CRM round-trips in CI (currently recorder-only)

### Customer Self-Service — Extended

- [ ] Public customer portal / login (manage all appointments, not single-action token)
- [ ] Waitlist / callback queue tool
- [ ] No-show auto-marking + auto-rebook offers

### Voice Enhancements

- [ ] Post-call SMS "how did we do?" review link / NPS
- [ ] Multi-language surface (when tenant demand appears)
- [ ] Real-time owner listen-in / barge capability

### Product Expansion

- [ ] Public booking widget / embed
- [ ] Granular RBAC beyond `owner` / `front_desk`
- [ ] White-label / reseller dashboard theming
- [ ] Public API (external integrators / power users)
- [ ] CSV/PDF export: calls, appointments, customers, analytics
- [ ] SSO / SAML
- [ ] International phone numbers / multi-country (Telnyx capable; code is US-centric)
- [ ] Multi-DID per tenant (multiple locations) — defer until a customer asks; today = one DID per tenant account

---

## Quick Reference: Key Files Per Gap

| Gap                     | Primary Files                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Self-service reschedule | `src/routes/selfService.ts`, `smsService.ts`, `appointmentService.ts`, `emailTemplates.ts`                                            |
| Billing 402 gate UI     | `dashboard/components/BillingView.tsx`, `dashboard/app/dashboard/page.tsx`                                                            |
| AI cost meter           | `agent/src/toolsClient.ts`, `callSummary.ts`, `src/services/knowledgeIngestion.ts`, `src/routes/knowledge.ts`, `agent/src/grokTTS.ts` |
| DASHBOARD_URL prod      | Railway env + `src/services/communications/appointmentService.ts`                                                                     |
| Calendar sync live      | `src/services/calendar/googleCalendar.ts`, `calendarSync.ts`, Railway env                                                             |
| Outcome automations     | `agent/src/callClassify.ts` → `src/services/communications/`                                                                          |
| Data export / GDPR      | New `src/routes/export.ts` + DB migration for purge                                                                                   |

---

_Sync this file with `GAPS.md` after major shipments. Closed items → `RESOLVED.md`._
