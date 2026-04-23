# TODO

**Last updated:** 2026-04-23

Single source of truth for all remaining work. Organized by priority.

---

## Phase 13: Ship It (blocking launch)

- [x] **Deploy dashboard** — shipped 2026-04-21 (commit `fb216e0`), live at https://dashboard-production-cee3.up.railway.app/
- [ ] **Set `DASHBOARD_URL`** env var in Railway backend (needed for Stripe checkout + OAuth redirects)
- [ ] **Beta testing with DynaTire**
- [x] **BUG-072**: Front Desk scheduler shift bars not rendering — root cause: seed data populated legacy `employee_shifts` table instead of `employee_schedule`. Fixed seed to use `employee_schedule` (2 weeks of date-based shifts).

---

## Voice AI Migration: Vapi → LiveKit Agents

See `docs/FRAMEWORK_MIGRATIONS.md` for the full list of in-flight framework swaps (LiveKit, Edge Functions → Fastify, TTS).

Plan file: `.claude/plans/federated-snacking-puffin.md`

- [ ] Phase 2: Port 8 edge function tools to `/agent-tools/*` Fastify routes
- [ ] Phase 3: Build LiveKit agent worker (Node.js, Deepgram STT, OpenAI LLM, xAI Grok TTS)
- [ ] Phase 4: SIP trunk setup (Telnyx → LiveKit Cloud)
- [ ] Phase 5: Integration testing with DynaTire
- [ ] Phase 6: Dashboard updates (call status, live transcription)
- [ ] Phase 7: Cutover (retire Vapi, update provisioning)
- **Blocked on**: LiveKit API Secret + WSS URL from Dale

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
