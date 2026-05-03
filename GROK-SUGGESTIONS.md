# Secretary HQ Action Plan + Checklist

**Source:** External AI engine review of the project. Captured verbatim and reconciled with the existing internal backlog on 2026-05-01.

**Reconciliation status:** complete. Genuinely additive items have been lifted into `docs/TODO.md` under the new "Pre-launch hardening (from external review)" section. Items already tracked elsewhere are marked inline below with a pointer. **External review specifically flagged the dashboard as complex and tough to understand for non-technical users (shop owners, front-desk staff)** — that feedback is now a launch-blocker entry under the new "UX simplification" subsection in TODO.md.

**Project Goal:** Reach full production readiness and launch with first real customers (Phase 13 complete).

---

## Reconciliation key

- `[tracked]` — already in `docs/TODO.md` Phase 13 or `NEEDS-REFACTORING.md`. No new entry created.
- `[lifted → TODO.md]` — moved into `docs/TODO.md` under "Pre-launch hardening".
- `[shipped]` — already done; checkbox can stay checked.
- `[partial]` — partly tracked; the additive piece was lifted, the rest cross-references existing work.

---

## Action Plan (Prioritized Phases)

### Phase 1: Voice Reliability (1–2 weeks – Highest Priority)

- Complete the first live PSTN call test with the Telnyx number.
- Resolve the outstanding Telnyx ticket and confirm carrier propagation.
- Finish Phase 4 TTS swap to native xAI Grok (reduce OpenAI dependency).
- Run end-to-end tests with real calls and monitor for issues.

### Phase 2: Technical Debt Cleanup (1–2 weeks)

- Resolve the dormant CRM adapter layer (migrate or delete).
- Clean up UsageTrackingService (implement or remove).
- Finish documentation sweeps (remove remaining stale Vapi references).
- Address top items from NEEDS-REFACTORING.md.

### Phase 3: Polish & Beta Testing (2–3 weeks)

- Deploy and verify full dashboard integration.
- Run closed beta with DynaTire or first customer.
- Simplify "Front Desk Mode" in the dashboard for non-technical users.
- Expand monitoring and error handling.

### Phase 4: Launch & Scale (Ongoing)

- Go live with first paying customers.
- Monitor usage, performance, and billing.
- Plan next feature wave (reminders, advanced analytics).

---

## Detailed Checklist

### I. Voice & Telephony (Blocking)

- [ ] First successful live PSTN inbound call test — `[tracked]` TODO.md Phase 13
- [ ] Telnyx ticket #2850682 resolved — `[tracked]` TODO.md Phase 13, `docs/TICKET_SUPPORT.md`
- [x] Grok TTS fully wired and tested in agent — `[shipped]` 2026-05-01, `agent/src/grokTTS.ts`. End-to-end PSTN test still pending (blocked on Telnyx).
- [ ] Voice fallback messages and error handling validated — `[lifted → TODO.md]` "Voice validation (additive to Phase 13)"
- [ ] Call transcript + summary flow confirmed — `[lifted → TODO.md]` same section

### II. Core Booking & Scheduling

- [ ] Atomic booking RPC load-tested with concurrent calls — `[lifted → TODO.md]` "Pre-launch validation"
- [ ] Timezone / DST edge cases verified — `[lifted → TODO.md]` "Pre-launch validation". BUG-059 fixed one regression; sweep is new.
- [ ] Skill + resource matching working reliably — `[lifted → TODO.md]` "Pre-launch validation"
- [ ] Coverage gap detection accurate in both backend and UI — `[lifted → TODO.md]` "Pre-launch validation"

### III. Code Quality & Refactoring

- [ ] CRM adapter layer resolved (migrate or delete) — `[tracked]` NEEDS-REFACTORING #1 (P0)
- [ ] UsageTrackingService implemented or removed — `[tracked]` NEEDS-REFACTORING #3 (P0)
- [ ] Remaining dormant code cleaned up — `[tracked]` NEEDS-REFACTORING (multiple entries; CLAUDE.md "Migrated, Not Yet Wired")
- [ ] TypeScript strictness improvements applied — `[tracked]` TODO.md "Code Quality → Type Safety" (dashboard test mocks `any` cleanup)
- [ ] Soft-delete filtering consistent across queries — `[tracked]` TODO.md "Soft Delete Filtering (BUG-038)"

### IV. Dashboard & UX

- [ ] DASHBOARD_URL properly configured — `[tracked]` TODO.md Phase 13 (6+ days outstanding)
- [ ] Simplified Front Desk view implemented — `[lifted → TODO.md]` "UX simplification — directional feedback (NEW, blocking beta)". **External review's emphasis on app complexity is captured here as a beta-blocker, not a generic polish item.** Concrete sub-tasks: audit click counts on daily flows, hide Back Office from Front-Desk-only logins, vocabulary pass on jargon (tenant/RLS/RPC/embedding/skill matrix), first-run guided tour.
- [x] Accessibility & keyboard navigation complete — `[shipped]` 2026-04-20, see TODO.md "UX/Accessibility Backlog — COMPLETE"
- [ ] Mobile responsiveness validated for shop owners — `[lifted → TODO.md]` "UX simplification". Tire shop / salon owners check schedules on phones; daily flows need iOS Safari + Android Chrome verification.

### V. Integrations & Billing

- [ ] Calendar sync (Google + Outlook) fully tested — `[partial]` Services + tests exist; "fully tested" against real OAuth tokens is informally tracked in CLAUDE.md "Integration Summary". No new entry — informal verification when first beta runs.
- [ ] CRM syncs (Jobber, HubSpot, etc.) stable — `[partial]` 4 CRMs wired (Jobber, HubSpot, Square, ServiceTitan); they are the only CRMs in the codebase. The dormant adapter library at `src/services/crm/` was deleted 2026-05-02 (commit `2cc782a`, NEEDS-REFACTORING #1) under a new policy: anything we can't test against gets deleted; CRMs we don't have a flat client for get wired up when a beta customer brings one. "Stable" in production sense piggybacks on first-beta validation.
- [ ] Stripe subscription + webhook handling confirmed — `[partial]` Wired in commit history; webhook registered at `/billing/webhook`. End-to-end test (real test-mode checkout → webhook → subscription gate) not formalized. No new entry — runs implicitly during beta.
- [ ] Multi-tenant isolation verified in production-like environment — `[lifted → TODO.md]` "Pre-launch validation". RLS + FORCE RLS should hold but explicit cross-tenant probe hasn't been run against Supabase production.

### VI. Testing & Observability

- [x] All tests passing (backend + dashboard + e2e) — `[shipped]` continuously enforced. 1,973 tests + 19 Playwright e2e + 29 live QA passing as of 2026-05-02 (1,475 backend + 498 dashboard, with 2 documented skips). CI gate runs them on every push.
- [ ] Live QA suite expanded — `[lifted → TODO.md]` "Observability". Add OTP flow, specific booking error codes, DST edge cases.
- [ ] Structured logging and basic metrics in place — `[lifted → TODO.md]` "Observability". Today: stdout via Pino/Fastify/Next.js with no aggregation. Beta-blocker for support.
- [ ] Error rates monitored for first beta users — `[lifted → TODO.md]` "Observability". Sentry-or-equivalent on dashboard + backend + agent.

### VII. Documentation & Launch Prep

- [ ] All docs updated and consistent — `[tracked]` continuous; CLAUDE.md drift detection is NEEDS-REFACTORING #13.
- [ ] Security review completed — `[lifted → TODO.md]` "Launch prep". Webhook signature verification, RLS on new tables, JWT lifetime, agent-secret rotation plan.
- [ ] Beta customer onboarding guide written — `[lifted → TODO.md]` "Launch prep". Currently no doc for first-time tenants beyond the in-app setup wizard.
- [ ] Pricing and subscription tiers finalized — `[lifted → TODO.md]` "Launch prep". Solo + Growth shipped; Pro + Enterprise have price IDs but no positioning.

---

## Working source

After this reconciliation, `docs/TODO.md` is the working source of truth for every actionable item from this review. This file remains as a record of the external review and the disposition of each suggestion — useful for re-running the same exercise with another reviewer later.

The single most important thing this review surfaced that wasn't already on the radar: **the dashboard is too complex for the target audience.** It's the new launch-blocker entry, not just a polish task.
