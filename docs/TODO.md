# TODO

**Last updated:** 2026-04-17

Single source of truth for all remaining work. Organized by priority.

---

## Phase 13: Ship It (blocking launch)

- [ ] **Deploy dashboard** to Railway or Vercel (currently local only)
- [ ] **Set `DASHBOARD_URL`** env var in Railway (needed for Stripe checkout + OAuth redirects)
- [ ] **Database webhooks for n8n** (post-call summaries, calendar sync triggers)
- [ ] **Beta testing with DynaTire** (needs dashboard deployed first)
- [ ] **BUG-072**: Front Desk scheduler shift bars not rendering (data confirmed in API, display issue in NewSchedulerView)

---

## Voice AI Migration: Vapi → LiveKit Agents

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
- [ ] Replace `catch (networkErr: any)` with `catch (err: unknown)` + type narrowing (30+ instances across CRM clients/sync files)
- [ ] Type `app: any` as `FastifyInstance` in skills.ts, knowledge.ts, employees.ts, servicetitan.ts route modules
- [ ] Clean up `any` types in dashboard test mocks (~20 instances)

### Legacy Cleanup
- [ ] Delete `vapi/agent.json` (replaced by `agent.template.json`, contains stale data)
- [ ] Delete duplicate bug-fix markdown files: `BUG-064-SPECIFIC-ERROR-CODES.md`, `BUG-FIX-APRIL-1-2026.md`, `BUG-FIXES-APRIL-1-VOICE-AI.md`, `FIXES-COMPLETE-APRIL-1-2026.md`
- [ ] Delete or archive one-off scripts: `scripts/fix-vapi-assistant.js`, `scripts/fix-vapi-assistant.ts`
- [ ] Remove `dashboard/server.js` (CommonJS) and `dashboard/test-fetch.js` if unused

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

## UX / Accessibility Backlog

From April 10-11 UX review. Grouped by severity.

### High Priority
- [ ] **TenantCard**: Convert clickable div to semantic button/listbox with `aria-selected` + keyboard handlers
- [ ] **TenantEditPanel**: Replace `confirm()`/`alert()`/`getElementById()` with shared ConfirmModal + Input + Button
- [ ] **SkillManagementView**: Replace `confirm()`/`alert()` delete flow with shared confirm modal
- [ ] **AppointmentListSidebar**: Convert clickable div rows to semantic button/option with `aria-selected`
- [ ] **RecordHistoryModal**: Rebuild on shared `Modal` component (currently hand-rolled)
- [ ] **WizardModeChooser**: Rebuild on shared `Modal` (no Escape handling, no dialog semantics)
- [ ] **AppointmentBlock**: Add `role="button"`, tabIndex, Enter/Space keyboard handling
- [ ] **EmployeeDayFocusPanel**: Convert timeline div rows to semantic buttons
- [ ] **NewSchedulerView**: Split staff row into button + separate drag handle
- [ ] **StaffSwimLaneView**: Add keyboard-accessible shift actions, replace `confirm()` with shared modal
- [ ] **AppointmentPopover**: Add `role="dialog"`, focus management, focus return on close
- [ ] **AIConfigView**: Replace MOCK_TENANT with real session-backed tenant context

### Medium Priority
- [ ] LoginView: Use shared Input/Button primitives, add `role="alert"` to error banner
- [ ] TenantCard: Split drag grip into separate handle element
- [ ] TenantEditPanel: Stacked action layout for small screens
- [ ] AIConfigView: Use shared Textarea variant, remove duplicate modal close button
- [ ] MyBusinessView: Sync sub-tab state to URL query params
- [ ] TenantCreateForm: Collapse credential grid to single column on narrow screens
- [ ] DashboardHome: Show empty/unavailable state instead of returning null
- [ ] ErrorBoundary: Add retry/reset action and route back to safe view
- [ ] OutlookLayout: Add listbox semantics or keyboard filtering to tenant switcher
- [ ] BusinessSettingsView: Standardize on shared form primitives
- [ ] MyTeamView: Sync sub-tab to URL query params
- [ ] ResourceManagerView: Consolidate on shared form-group patterns
- [ ] ServiceAssignmentView: Add shared textarea primitive, expose selection semantics
- [ ] KnowledgeBaseView: Increase separation between questionnaire/uploads/search
- [ ] SchedulerView: Anchor active mode and date range visually
- [ ] QuickBookPanel: Rebuild customer search with shared primitives, add `aria-live` for errors
- [ ] ResourceColumnsView: Add text coverage summary per row
- [ ] SkillMapConnections: Add keyboard-reachable disconnect, clearer legend
- [ ] SkillMapFixPanel: Surface assignment failures via toast/inline feedback
- [ ] SkillMapNode: Add interactive semantics and keyboard handling
- [ ] SkillRelationshipMap: Add mode cues, improve small-screen overflow
- [ ] AppointmentPopover: Measure rendered height instead of hardcoded 220px
- [ ] AnalyticsView: Add loading skeleton and empty-data state
- [ ] AIInsightsView: Add per-tab empty/loading states

### Low Priority
- [ ] TenantEditPanel: `aria-live` for provisioning status changes
- [ ] AIConfigView: Expose voice choices as semantic radio group
- [ ] MyBusinessView: Replace Setup Assistant trigger with shared Button
- [ ] TenantCreateForm: Add explicit labels instead of placeholder-only
- [ ] DashboardHome: Rebuild quick-action tiles on shared primitives
- [ ] ErrorBoundary: Align fallback with shared Card/Button styling
- [ ] OutlookLayout: Consolidate shell action patterns into shared primitive
- [ ] ProfileView: Add field grouping and fallback copy for empty fields
- [ ] AppointmentBlock: Add compact status cue for narrow blocks
- [ ] AppointmentListSidebar: Wire search to filtering or remove until functional
- [ ] AppointmentDetailPanel: Strengthen action labelling for edit/cancel/delete
- [ ] CustomerDetailPanel: Add in-panel navigation for profile/bookings/calls
- [ ] AnalyticsView: Differentiate "coming later" cards with roadmap messaging

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
