# TODO

**Status at a Glance** (as of 2026-05-15)

- **Voice / Telnyx**: `+1-630-937-9478` unreachable from PSTN. New LERG ticket submitted 2026-05-01. Zero inbound CDRs. Blocks all live voice validation and DynaTire beta.
- **Env vars**: `DASHBOARD_URL` and `SENTRY_DSN` still need to be set on Railway (user action).
- **Migrations**: 122 total. Several critical ones still need production Supabase apply (atomic booking GiST, tenant cascades, reminders).
- **Browser validation**: Role gating + invite flow for front-desk users needs real-browser testing.
- **Open non-blocking**: First-run guided tour, `pw.txt` decision, expanded live QA.

Everything else is either complete or tracked below.

---

## In-flight markers

- **IN FLIGHT (external)**: Waiting on vendor/third party.
- **IN FLIGHT (user)**: Needs action from Dale.
- **IN FLIGHT (prod-apply)**: Code shipped; needs production DB/Infra apply.
- **IN FLIGHT (validation pending)**: Code + tests done; needs live condition (PSTN call, etc.).

---

## Phase 13 – Blocking Launch

- [ ] **IN FLIGHT (external)** Telnyx PSTN ticket for `+1-630-937-9478` (see `TICKET_SUPPORT.md`)
- [ ] **IN FLIGHT (user)** Set `DASHBOARD_URL=https://dashboard-production-cee3.up.railway.app` on Railway `ai-sec` service
- [ ] **IN FLIGHT (user)** Set `SENTRY_DSN` on Railway backend + agent
- [ ] **IN FLIGHT (prod-apply)** Apply pending migrations to production Supabase:
  - `20260501000000*` (atomic booking GiST constraints)
  - `20260511000000` (tenant FK cascade)
  - `20260513000000*` (service_employee + notifications)
  - `20260514000000*` (reminder retry)
- [ ] **IN FLIGHT (validation pending)** Browser-verify role gating + invite flow (see detailed checklist in previous version)
- [ ] **First-run guided tour** for new tenants after setup wizard

---

## Voice Validation (blocked on Telnyx)

- [ ] Call transcript + summary flow end-to-end
- [ ] Expanded live QA suite (`scripts/qa-live-test.py`)
- [ ] Reminder delivery monitoring dashboard
- [ ] Add coverage for OTP + all 5 booking error codes in live QA

---

## Non-blocking / Polish

- [ ] First-run guided tour for new tenants (interactive post-setup tour)
- [ ] Decide on `pw.txt` (gitignored file in root)
- [ ] Pricing tiers (Pro/Enterprise) positioning
- [ ] Dashboard Sentry integration (`@sentry/nextjs`)
- [x] Create `docs/README.md` (documentation index) — done 2026-05-15
- [ ] Continue `src/index.ts` extraction / cleanup
- [ ] Finish broader CRM sync structure extraction (NEEDS-REFACTORING #10)

## UX backlog (from 2026-05-16 `/ux-expert` audit)

Closed items moved to `RESOLVED.md` (see entries under 2026-05-16 and 2026-05-17).

Open:
- [ ] **D4** Persistent "Setup: N of 6 done" pill in top utility row
- [ ] **B1** Merge Service Assignments + Skill Map into one tab with Grid/Map toggle
- [ ] **B4** Reconsider sub-tab URL persistence (verify usage first)
- [ ] **C1 + C2** Schedule: 4 sub-views → 2 (Day/Month), unify the 3 separate headers
- [ ] **D3** Auto-create default resource for 1-location team wizards (skip a step)
- [ ] **E1** Threaded demo-mode (sample data via session flag, obsoletes static `/demo`)
- [ ] **E2** Consistent empty-state pattern across views
- [ ] **E3** Badge pattern on more nav tabs (Calls "new transcripts", etc.)

## Documentation

- [ ] Review and trim `CLAUDE.md`
- [ ] Review and trim `CODING_STANDARDS.md`

---

**Archived detailed history**: See `CURRENT_STATUS_ARCHIVED_2026-05-15.md` for previous session notes and long-form status.