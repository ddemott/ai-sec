# TODO

**Last updated:** 2026-04-27

Single source of truth for all remaining work. Organized by priority.

---

## Phase 13: Ship It (blocking launch)

- [x] **Deploy dashboard** — shipped 2026-04-21 (commit `fb216e0`), live at https://dashboard-production-cee3.up.railway.app/
- [ ] **Set `DASHBOARD_URL`** env var in Railway backend (needed for Stripe checkout + OAuth redirects). Value: `https://dashboard-production-cee3.up.railway.app`. ~2 min via Railway → ai-sec service → Variables.
- [x] **Apply migration `20260427000000_telnyx_provisioning.sql` to production Supabase.** Done 2026-04-27. Dropped `vapi_assistant_id`/`vapi_phone_number_id` (verified empty across all 3 tenants beforehand), added `telnyx_phone_number_id`. Side effect: also applied `20260423000000_phone_verifications.sql` which had been sitting unapplied — SMS OTP table now exists in prod, fixing a silent runtime gap.
- [ ] **Telnyx ticket #2850682** — phone number `+1-630-937-9478` returning "not in service" from PSTN. See `TICKET_SUPPORT.md`. Awaiting LERG investigation. Blocks all live-call testing.
- [ ] **Beta testing with DynaTire** — blocked on phone working
- [x] **BUG-072**: Front Desk scheduler shift bars not rendering — root cause: seed data populated legacy `employee_shifts` table instead of `employee_schedule`. Fixed seed to use `employee_schedule` (2 weeks of date-based shifts).

---

## CI Rot (deferred, not blocking launch)

All 5 remaining GitHub Actions workflows assume a pnpm workspace structure that this repo never adopted (`pnpm-workspace.yaml` doesn't exist — repo uses `npm` at root with separate npm packages in `agent/` and `dashboard/`). Every workflow has been failing on every commit since at least 2026-04-08. `check-docs.yml` was deleted 2026-04-27 to stop email notifications; the rest are still red but quieter.

**What this means:** the 1,468 backend + 495 dashboard tests we run locally are *not* running on push. No automated regression check exists right now.

**To fix (one focused session, ~30-60 min):**

- [ ] Rewrite `ci.yml` for npm: `npm install`, `npx tsc --noEmit`, `npm test`, then `cd dashboard && npm install && npm test`
- [ ] Delete `pnpm-workspace-sanity.yml` (no workspace to sanity-check)
- [ ] Rewrite `ci-smoke-assume-tenant.yml`, `ci-smoke-calendar-appointments.yml`, `pr-smoke-servers.yml` to use npm install
- [ ] Bump `actions/checkout` and `actions/setup-node` to current versions to clear the Node 20 deprecation warning
- [ ] Optionally add a real "check-docs" gate (e.g., "fail if any non-historical doc mentions Vapi outside the migration index") — useful guardrail given the recent migration

**Why deferred:** doesn't block phone/docs/ship, and rewriting 6 workflows deserves its own focused pass instead of a sidebar.

---

## Voice AI Migration: Vapi → LiveKit Agents

See `docs/FRAMEWORK_MIGRATIONS.md` for the full list of in-flight framework swaps (LiveKit, Edge Functions → Fastify, TTS).

Plan file: `.claude/plans/federated-snacking-puffin.md`

> **Status note (2026-04-27):** This phase list pre-dates the actual migration work and is now stale. Phases 1a/1b/2/3 shipped (commits `18caffe`, `661d21d`). Vapi account deleted. The list below should be reconciled with `docs/FRAMEWORK_MIGRATIONS.md` during the doc sweep. Truth-of-state: only Phase 4 (TTS native) and Phase 5 (DynaTire integration test) are still open.

- [x] Phase 2: Port 8 edge function tools to `/agent-tools/*` Fastify routes — done in `661d21d`
- [x] Phase 3: Build LiveKit agent worker (Node.js, Deepgram STT, OpenAI LLM) — done in `18caffe`; agent registers as worker `AW_vPmGExrgTeGn`
- [x] SIP trunk setup (Telnyx → LiveKit Cloud) — done; FQDN `ai-secretary-nmlkkmgf.sip.livekit.cloud:5060` wired to connection `livekit-outbound` (ID `2945038451784812111`)
- [ ] **Phase 4: native xAI Grok TTS in agent worker.** Replace `openai.TTS` at `agent/src/index.ts:122,150` with a custom `GrokTTS` class hitting `https://api.x.ai/v1/tts` directly. Removes the deleted `tts.ts` proxy contract entirely. Validate via unit tests + LiveKit playground call (no PSTN dependency). ~1-2 hr.
- [ ] Phase 5: Integration testing with DynaTire — blocked on Telnyx ticket #2850682
- [ ] Phase 6: Dashboard updates (call status, live transcription) — design TBD; currently shows post-call summaries only
- [x] Phase 7: Cutover (retire Vapi, update provisioning) — done in `661d21d`; Vapi account deleted; provisioning rewritten for Telnyx + LiveKit

---

## Documentation Cleanup (Vapi → Telnyx/LiveKit)

Doc Phase 1 inventory completed 2026-04-27. 17 files contain 177 Vapi references; 76 are historical (leave alone), 101 are actionable. Three classes:

- **Category A — pure renames** (41 hits): stack listings, env var lists, file references. Mechanical.
- **Category C — stale env vars** (22 hits): `VAPI_API_KEY`, `VAPI_SERVER_URL_SECRET` documented in setup guides. Mechanical removal.
- **Category B — architectural** (38 hits): `improvement-ideas.md` and `docs/IMPROVEMENT_IDEAS.md` have proposed refactor tasks that assume the old Vapi shape. Need review — some tasks may need rewording, others may need to be dropped entirely now that the architecture changed.

**Files affected** (from inventory): README.md, CLAUDE.md, SUMMARY-2026-04-24-0030.md, improvement-ideas.md, docs/IMPROVEMENT_IDEAS.md, docs/CURRENT_STATUS.md, docs/ARCHITECTURE.md, docs/DEPLOYMENT.md, docs/FRAMEWORK_MIGRATIONS.md, docs/TODO.md, docs/PLAN.md, docs/UI_UX_DESIGN.md, docs/DESIGN_HANDOFF.md, docs/DIAGRAMS.md, docs/BUGS.md, .remember/state.md, src/services/MIGRATED_FROM_AI_SECRETARY.md.

- [ ] **Phase 2a (mechanical, ~45-60 min):** apply Category A + C renames across 17 files. No architectural decisions.
- [ ] **Phase 2b (~1-2 hr):** review and edit Category B items in `improvement-ideas.md` and `docs/IMPROVEMENT_IDEAS.md`. Some tasks now obsolete, others need new wording for LiveKit shape.
- [ ] **Reconcile the stale Voice AI Migration section above** with truth from `docs/FRAMEWORK_MIGRATIONS.md` (already partially done with status note).
- [ ] Consolidate duplicate `improvement-ideas.md` ↔ `docs/IMPROVEMENT_IDEAS.md` (flagged in Phase 1 inventory as duplicates).

---

## Code Quality

### Type Safety (from lint audit)
- [x] Replace `catch (err: any)` with `catch (err: unknown)` + type narrowing (provisioning.ts, TenantEditPanel.tsx)
- [x] Type `app: any` as `FastifyInstance<any, any, any>` in all 25 route modules + fix OAuth callback factory
- [ ] Clean up `any` types in dashboard test mocks (~20 instances)

### Legacy Cleanup
- [x] `vapi/agent.json`, bug-fix markdown files, `fix-vapi-assistant.js/.ts`, `dashboard/test-fetch.js` — all already deleted in prior commits
- [x] `dashboard/server.js` — verified ACTIVE (dev HTTPS server + Railway deploy), not legacy
- [x] `scripts/configure-vapi-agent.sh` — deleted (superseded by provisioning API)
- [x] `n8n/` directory + `docs/N8N_WORKFLOWS.md` — deleted (functionality built into Fastify routes)
- [x] `shift_overrides` → `employee_schedule` rename, `employee_shifts` fallback removed from booking RPCs

### Soft Delete Filtering (BUG-038 partial)
- [ ] Add `WHERE is_deleted = false` to SELECT queries in routes touching soft-deletable tables (appointments, customers, resources, employees) — only 2 of 20 routes currently filter

---

## CRM Sync Unification (completed 2026-04-17, next steps)

Shared `syncMapHelpers.ts` extracted. Remaining opportunities:
- [ ] Unify calendar token refresh (Google + Outlook duplicate OAuth state/refresh logic)
- [ ] Extract shared tenant bootstrap helper (auth register + admin tenant create duplicate the same flow)

---

## Communications & Reminders Integration

Migrated from ai-secretary, stub implementations need wiring to production DB.

### Phase 1: Database Adapter
- [ ] Create DatabaseService adapter wrapping ai-sec's pool with reminder methods
- [ ] Create `reminder_schedules` table migration
- [ ] Wire TenantConfigService to DB (replace InMemoryTenantConfigService)

### Phase 2: Communications
- [ ] Install and configure nodemailer
- [ ] Install and configure Twilio SDK for SMS
- [ ] Wire email/SMS services to real providers
- [ ] Create tenant notification preferences columns

### Phase 3: Reminders
- [ ] Wire ReminderScheduler to real cron/timer system
- [ ] Connect ReminderProcessor to communications service
- [ ] Add appointment lifecycle hooks (create/update/cancel → schedule/reschedule/cancel reminders)

### Phase 4: Testing
- [ ] Integration tests with real DB for reminder CRUD
- [ ] E2e test: appointment created → reminder scheduled → sent

### Phase 5: Ops
- [ ] Monitoring dashboard for reminder delivery rates
- [ ] Retry logic for failed sends
- [ ] Rate limiting for SMS sends

---

## UX / Accessibility Backlog — COMPLETE (2026-04-20)

All 47 items from April 10-11 UX review resolved in commit `f9ffa8e`. Key changes:
- Clickable divs → semantic buttons with keyboard handlers across 8 components
- Hand-rolled modals → shared Modal (RecordHistoryModal, WizardModeChooser)
- All confirm()/alert() → ConfirmModal + showToast
- ARIA roles, aria-selected, aria-live, role="dialog" added throughout
- URL query param sync on sub-tabs (MyBusinessView, MyTeamView)
- Loading skeletons, empty states, dynamic popover height
- Radiogroup semantics, fieldset grouping, explicit labels
- In-panel nav, compact status dots, improved button labels

---

## Improvement Ideas (from code review)

160 proposed refactoring tasks in 10 phases. Top items by impact:

### Highest Impact (do first)
- [ ] Unify calendar service token refresh (Google + Outlook)
- [ ] Extract shared tenant bootstrap helper (auth register + admin create)
- [ ] Extract dashboard controller hooks (AppointmentView + SuperAdminDashboard)
- [ ] Add tests for destructive flows (tenant delete/reorder, mock-mode booking, shift override RPC)
- [ ] Replace ad hoc tenant typing with shared dashboard tenant view type
- [ ] Normalize response envelopes across CRM disconnect/sync-status routes

Full backlog: see `docs/IMPROVEMENT_IDEAS.md` (160 tasks across 10 review phases)
