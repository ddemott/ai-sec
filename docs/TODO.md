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

## CI Rot — RESOLVED (2026-04-30)

Done in a focused pass. Two-job CI gate now runs on every push/PR to main:

- **Backend job:** `npm ci`, `npx tsc --noEmit`, `npm test` (1,477 tests).
- **Dashboard job:** `npm ci`, `npm test` (495 tests). Typecheck step
  intentionally skipped — see follow-up below.

**Deleted as zombies** (referenced paths/scripts that don't exist in this
repo, leftover from the ai-secretary import):

- `pnpm-workspace-sanity.yml` — no `pnpm-workspace.yaml` exists.
- `ci-smoke-assume-tenant.yml` — references `__tests__/auth.assume-tenant.test.ts`.
- `ci-smoke-calendar-appointments.yml` — references `__tests__/calendar.test.ts`.
- `pr-smoke-servers.yml` — references `seed-demo.sh`, port 3000, `admin@test.com`.

The smoke workflows' value is subsumed by the unit suite (calendar, auth,
appointment tests live under `src/` and run via the new backend job).

### Follow-up

- [ ] **Re-enable dashboard typecheck in CI.** Currently dropped because
  `npx tsc --noEmit` fails on pre-existing test-file type errors:
  `process.env.NODE_ENV` writes (read-only since newer @types/node),
  `Boom` JSX return type (`void` not assignable to `ReactNode`),
  `window.location` assignment in `BusinessSettingsView.test.tsx`.
  Vitest tolerates them via SWC transform; `tsc` doesn't. Fix in a
  focused dashboard-tests cleanup pass, then add `npx tsc --noEmit` to
  the dashboard CI job.

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

- [x] **Phase 2a (mechanical):** Category A + C renames across the authoritative docs. Done 2026-04-27 in commit `33b685c` — README, CLAUDE.md, docs/CURRENT_STATUS.md, docs/DEPLOYMENT.md (incl. Phase 6 rewrite), docs/IMPROVEMENT_IDEAS.md updated; every remaining Vapi mention in those files is correctly historical.
- [x] **Phase 2b:** done 2026-04-30. Reviewed all 9 actionable Vapi-shaped references across both files. Result: 5 tasks dropped (3 TTS — `src/routes/tts.ts` deleted in `661d21d`; 1 provisioning Vapi-cleanup helper — single-step Telnyx release doesn't justify extraction; 1 analytics placeholder copy — already shipped with LiveKit wording). 2 tasks reworded (provisioning status helper, voice.ts route split — still valid, just stale terminology). 1 Status parenthetical cleaned up in `docs/IMPROVEMENT_IDEAS.md`. Remaining Vapi mentions are tombstones marking dropped tasks, not actionable work.
- [ ] **Reconcile the stale Voice AI Migration section above** with truth from `docs/FRAMEWORK_MIGRATIONS.md` (status note added in `33b685c`; still need to delete the stale phase list entirely).
- [x] **Role clarity for improvement-ideas files (instead of consolidation).** Done 2026-04-30. Phase 1 inventory mislabeled these as duplicates. They are two distinct files with different origins and formats: `docs/IMPROVEMENT_IDEAS.md` is the curated review-phase backlog (160 tasks across 10 phases, dated 2026-04-10/11, capitalized titles, no Self-Review footers). `improvement-ideas.md` is an automated daily-journal feed (dates 2026-04-20–25, "Self-Review" sections after each batch, lowercase titles, includes Tradeoff/Effort vs Gain blocks). Both stay; consolidation would lose information. `docs/TODO.md:172` already treats `docs/IMPROVEMENT_IDEAS.md` as the authoritative backlog.
- [x] **Within-file dedup pass on `improvement-ideas.md`.** Done 2026-04-30. Awk-based dedup keyed on exact `### Task:` titles: 13 distinct titles had duplicates, totaling 21 dropped task blocks (4× of the syncOrchestrator fan-out execution and fan-out logs tasks; 3× of the resource-route validation, ScheduleEntry rename, sendSuccess pilot, and resource update field assembly tasks; 2× of seven other tasks). File shrank 1641 → 1323 lines (-318). Tombstones, Self-Review structure, and tenant-Vapi historical references all preserved. **Open follow-up:** the automated journal generator that writes this file is producing the duplicates — without fixing it, the next run re-introduces them. Track that as a generator-side fix, not a doc fix.

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

### Soft Delete Filtering (BUG-038)
- [x] Add `WHERE is_deleted = false` to SELECT queries in routes touching soft-deletable tables. Audit done 2026-04-30 — most routes already filter (appointments, customers, employees, resources, services, agentTools). Four remaining gaps fixed: `voice.ts:321` (customer phone lookup), `voice.ts:393` (customer ID verify for note add), `agentTools.ts:602` (services CTE in available-time-slots), `analytics.ts:55` (service-employee skill matrix). All 1,468 backend tests pass.
- [ ] Service-layer SELECT queries in CRM/calendar sync code (`hubspotSync`, `squareSync`, `jobberSync`, `servicetitanSync`, `calendarSync`, `syncMapHelpers`) currently include soft-deleted records. Decide whether sync should push deletions to external systems (push the soft-delete state) or just exclude — needs a product call before changing.

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
