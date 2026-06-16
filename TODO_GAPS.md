# TODO_GAPS.md — Actionable Checklist from GAPS.md

Derived from `GAPS.md` (2026-06-15 deep dive). Each item maps back to a GAPS.md section.  
**Key rule**: Ship = merge to main via PR + apply prod DB migration + validate with `./scripts/simulate.sh`.

---

## P0 — Unblock Real Customers / Beth Go-Live

### PSTN / Voice

- [ ] Dial `+1 630-866-1960` from a **different carrier** while watching `listRooms()` — confirm inbound PSTN path end-to-end
- [ ] Enable **Telnyx REFER / call transfer** on the SIP Connection (`livekit-outbound`) so `transfer_call` tool works live
- [ ] Set `forward_phone` on Beth's tenant dashboard (Phone Assistant → AI Persona) so live transfer has a destination

### Silent-Degrade Prod Fixes (code works in dev, silent no-op in prod)

- [ ] Set `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` on Railway **or** commit to `TELEPHONY_PROVIDER=telnyx` + fully wire `telnyxSms.ts` — currently `ProviderRegistry.ts:43` selects `MockAdapter` and every SMS silently "succeeds" without sending
- [ ] Set `EMAIL_USER` / `EMAIL_PASS` on Railway — email mock transporter sends nothing
- [ ] Set `AGENT_BACKEND_URL` on Railway agent service — `agent/src/config.ts:17` defaults to `http://localhost:4001`
- [ ] Set `STRIPE_WEBHOOK_SECRET` on Railway — `billing.ts:133` 400s every webhook without it
- [ ] Set `CORS_ORIGIN` on Railway — `index.ts` reflects any origin when unset
- [ ] Set `DASHBOARD_URL` on Railway — all emails, OAuth, Stripe URLs, provisioning links point to `https://localhost:4000` in prod

### Observability

- [ ] Set `METRICS_TOKEN` on Railway — `/metrics` returns 404 without it
- [ ] Set `BETTER_STACK_TOKEN` on Railway (backend + agent services) — logs are stdout-only
- [ ] Set `SENTRY_DSN` on Railway (backend + agent services) — no error grouping or alerts

### CI / Deploy Gate

- [ ] **Gate Railway deploys on CI green** — currently auto-deploys any push to `main` without waiting for tests (P0, hardest to fix silently)
  - [x] Add on-demand CI status tool (`./scripts/simulate.sh ci` + `npm run ci:status`/`ci:watch`) + local build staleness (src mtime vs dist/.next) for pre-merge visibility into the four jobs (backend, dashboard, agent, e2e) — developed 2026-06-15
  - [x] Update `.github/BRANCH_PROTECTION.md` to list the exact current required status check names from `.github/workflows/ci.yml` (Backend (typecheck + tests + integration), Dashboard (typecheck + tests), Agent (typecheck + tests), E2E (Playwright)) — updated to require all four for the full gate
  - [x] Apply GitHub branch protection rule on `main` (via Settings → Branches or `gh api`): Require a pull request before merging, Require status checks to pass before merging (the four jobs above), Require branches to be up to date before merging, Include administrators, Restrict who can push to PRs only (no direct pushes) — applied via gh api 2026-06-15 with exact 4 contexts + enforce_admins + required PR + conversation resolution
  - [ ] Review Railway dashboard settings for the three services (ai-sec backend, ai-sec-agent, dashboard); enable any "wait for successful GitHub checks" / check-suite gating or restrict auto-deploys to protected `main` branch only
  - [x] Update all references across `docs/TODO.md`, `CLAUDE.md`, `docs/DEVELOPMENT_WORKFLOW.md`, `README.md`, `GAPS.md` (and the protection doc itself) to document that merges now require green CI (GitHub protection applied) and Railway deploys are gated behind protected merges (Railway Wait for CI pending)
  - [ ] End-to-end verification of the gate: open a PR that causes a red CI (e.g. a deliberate test failure or type error), confirm the required status checks block the merge button, then fix and confirm merge is allowed only on green
  - [ ] Once the gate is live and verified, mark this item done, sync `GAPS.md`, and move the details + verification evidence into `RESOLVED.md`

### Stripe Live Verification

- [ ] Run Stripe in test mode + `stripe listen` — full round-trip: owner checkout → webhook → `subscription_status` set → `subscriptionGate` allows access
- [ ] Add `automatic_tax` to `stripe.checkout.sessions.create` in `billing.ts`
- [ ] Confirm prod price IDs are set in Railway env vars

### Legal / Ops (user actions — not code)

- [ ] Bonterms ToS + Privacy Policy + DPA published and linked from dashboard
- [ ] TCPA-compliant SMS opt-in language at booking time (see consent design in GAPS.md §9)
- [ ] E&O + Cyber Liability insurance
- [ ] LLC bank account open (Stripe payouts)

---

## P1 — Customer Success & Trust

### Customer Self-Service Links (highest-leverage single gap)

- [ ] Design: choose JWT signed tokens vs `appointment_action_tokens` table (opaque, one-time)
- [ ] New route: `POST /self-service/appointments/:id/cancel?token=...` — bypass tenantMiddleware, validate token, call existing cancel logic
- [ ] Extend `AppointmentData` interface (in `communications/types`) with `actionLinks?: { cancelUrl?, rescheduleUrl?, manageUrl? }`
- [ ] Update `appointmentService.ts` (lines 139-213) to generate tokens + inject `actionLinks` after booking
- [ ] Update `smsService.ts` `applySMSTemplate` — add cancel/reschedule URL to confirmation + reminder SMS (keep < 160 chars)
- [ ] Update Handlebars email templates in `src/templates/` to include action link buttons
- [ ] Dashboard: "Send self-service links" button (or auto-include on all confirmations) — `AppointmentDetailPanel.tsx` or new `SelfServiceLinks.tsx`
- [ ] Tests: token redemption (no auth header), E2E "book → SMS with link → link cancels", negative (expired, wrong tenant, double-use)

### Agent Voice Tools (missing receptionist actions)

- [ ] Add `cancel_appointment` tool to `agent/src/tools.ts`
- [ ] Add `reschedule_appointment` tool
- [ ] Add `get_my_appointments` tool (for known caller — lookup by verified phone)
- [ ] Add `take_structured_message` tool (structured fields + notify owner via SMS/email)

### Live Communications Providers

- [ ] Decide: Twilio vs Telnyx SMS — commit and set creds on Railway
- [ ] Wire chosen SMS provider fully (`ProviderRegistry.ts:43` must not fall through to Mock in prod)
- [ ] Verify reminder delivery stats in prod after creds set

### Billing UI for Owners

- [ ] Add `createPortalSession` to `src/routes/billing.ts` — one `stripe.billingPortal.sessions.create` call
- [ ] Add `createPortalSession` to `dashboard/lib/api.ts` billing namespace (also fix: add `'professional'` to checkout type — currently only `'solo' | 'growth'`)
- [ ] New dashboard component: "Billing" card in My Business / Settings — shows `subscription_status`, `subscription_plan`, current period
- [ ] "Manage billing" button → redirect to Stripe portal session URL
- [ ] "Upgrade" button → call existing `/billing/checkout` → redirect to Stripe Checkout
- [ ] Surface 402 subscription gate errors gracefully in UI (toast + upgrade CTA)

### Owner Cost / Usage Meter

- [ ] Instrument AI cost at 5-6 call sites: `agent/src/toolsClient.ts`, `callSummary.ts`, `knowledgeIngestion.ts`, `knowledge.ts` policy-answer path, `grokTTS.ts`
- [ ] Choose data model: `cost_usd` column on `voice_sessions` (simple start) OR new `tenant_daily_usage` table
- [ ] Surface "Usage this month" card in Analytics (calls + estimated AI spend)

### Outcome-Driven Automations

- [ ] Wire `callClassify.ts` results (especially `price` + `no_availability` outcomes) into post-call comms (follow-up SMS offer)

### Calendar Sync Live Proof

- [ ] Set `GOOGLE_CLIENT_ID/SECRET/REDIRECT` on Railway for at least one tenant
- [ ] Prove a real Google Calendar sync round-trip using existing `calendarSync.ts` + `SYNC_TEST_RECORDER` pattern

---

## P2 — Quality, Scale & Defensibility

### Agent Reliability

- [ ] "Speak filler before slow tools" — inject filler phrase before `getAvailableSlots` / `checkAvailability` calls (open P3 item in `CLAUDE.md`)
- [ ] Idempotent-read retry for transient agent-tools failures

### Load Testing

- [ ] Load test booking path to find pool exhaustion cliff (pool `max=10`)
- [ ] Document scaling knobs (pool size, agent worker count per tenant)

### Data Portability & Retention

- [ ] `GET /export/tenant-data` route — streams ZIP of JSONL/CSV covering all tenant data (see GAPS.md §9 spec)
- [ ] Hard-purge (GDPR/CCPA) path: anonymize `voice_sessions` phone+transcript, delete customer notes/preferences, write to audit — UI trigger in Settings
- [ ] Automated retention/purge worker: configurable max age for `voice_sessions`, `communications_history`, soft-deleted rows
- [ ] Owner-facing audit log view (show own-data changes from `audit_log` table — already has SECURITY DEFINER trigger)

### Website Scan Polish (onboarding §5)

- [ ] Per-question review UI in Step 7 (`Step7WebsiteScan.tsx`) with accept/reject badges
- [ ] E2E coverage for website scan flow
- [ ] Rate-limit / cost guardrails on repeated scans
- [ ] Periodic re-scan scheduler (poll for stale KB entries)

### Analytics Depth

- [ ] Source citations shown to caller when answering from KB (RAG §5)
- [ ] Admin "explain this answer" debugger for KB RAG
- [ ] Deeper analytics: cohort / CLV / service-specific abandonment drill-down

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

---

## Quick Reference: Key Files Per Gap

| Gap                      | Primary Files                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Silent SMS mock          | `src/services/communications/ProviderRegistry.ts:43`, `telnyxSms.ts`                                                                  |
| Self-service cancel link | `src/routes/appointments.ts`, `smsService.ts`, `appointmentService.ts`, `emailTemplates.ts`                                           |
| Agent voice tools        | `agent/src/tools.ts` (lines 63-472)                                                                                                   |
| Billing UI               | `src/routes/billing.ts`, `dashboard/lib/api.ts:784-791`, `dashboard/components/`                                                      |
| AI cost meter            | `agent/src/toolsClient.ts`, `callSummary.ts`, `src/services/knowledgeIngestion.ts`, `src/routes/knowledge.ts`, `agent/src/grokTTS.ts` |
| DASHBOARD_URL prod       | Railway env + `src/services/communications/appointmentService.ts`                                                                     |
| Calendar sync live       | `src/services/calendar/googleCalendar.ts`, `calendarSync.ts`, Railway env                                                             |
| Outcome automations      | `agent/src/callClassify.ts` → `src/services/communications/`                                                                          |
| Data export / GDPR       | New `src/routes/export.ts` + DB migration for purge                                                                                   |

---

_Sync this file with `GAPS.md` after major shipments. Closed items → `RESOLVED.md`._
