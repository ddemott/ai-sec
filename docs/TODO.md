# TODO

**See also**: root `GAPS.md` (created 2026-06-15, last refreshed 2026-06-23) for the full deep-dive inventory of missing pieces across every angle (product, integrations, billing, ops, security, scaling, etc.). This file remains the active execution queue.

**Related lists (kept separate by role — this file is the single scheduled action queue):**

- `docs/AIASSISTANT_GO_LIVE_TODO.md` — **single source** for voice/Telnyx go-live operational detail (blockers tracked here as one-liners; step-by-step procedure lives there, not duplicated).
- `docs/IMPROVEMENT_IDEAS.md` — curated _idea_ backlog (categorized, not scheduled).
- `docs/IMPROVEMENTS_TODO.md` — `/continuously-improve` loop proposal inbox (needs review before acting).

(The standalone `UIUX_TODO.md` was folded into the UX backlog section below on 2026-06-30 — 70 audit items were already done; its remaining un-audited-surface reviews live here now. The raw `ux-review-notes.md` + dated ux-audit TODO snapshots were removed the same day. Any lingering mentions of `ux-review-notes.md` in other docs or generated audit reports are historical context only — not live pointers.)

**Status at a Glance** (as of 2026-06-23)

- **Recent (2026-06-22/23)**: merged PRs #56/#57/#58/#59 + #64/#65/#66/#67 (and #70/#71 fixes) — toolsClient retries, export/audit/RAG debugger/dashboard surfaces, website scan E2E, analytics (abandonment-by-service + date filters + cohorts compat), unbound-method lint to error. Tests green per CLAUDE: backend ~1,940 + ~790 dashboard + ~360 agent. 29 route modules. Doc hygiene pass (route counts, Vercel refs, phone quals, REFACTORING comments) done mechanically. **Additional mechanical doc hygiene (2026-06-23, on chore branch)**: 10 independent solo items (stale 134→142 migrations + 26→29 labels + test nums in README; ARCH header (27)→(29) + dedup; CLAUDE 12→17 tools; lingering NEEDS-REFACTORING.md live-ref removal; last-updated bumps; sweep). All per AGENTS mechanical scope. `verify:claude-md` + `npm run checks` + tsc clean. Recorded in RESOLVED.
- **Mechanical doc hygiene batch 2 (2026-06-23, branch chore/mechanical-todo-hygiene-batch-2)**: distinct from the above — (1) fixed stale `src/routes/export.ts` → `src/routes/exportData.ts` reference in the Gap inventory "Key files per gap" table; (2) populated the previously-empty "## Documentation" section with current small mechanical tasks; (3-10) standardized ~40+ remaining short "REFACTORING_TODO.md item 10" / "See REFACTORING_TODO.md item 10." references across scripts/, shared/, src/\*, tests/ to the canonical "historical … (see RESOLVED.md for details)" phrasing (grep+sed + targeted edits + 0-straggler grep confirmations). Per AGENTS.md mechanical scope; gates clean.
- **Drift guard gotcha**: any new `src/routes/*.ts` module must bump the `route modules` count in `CLAUDE.md` (`verify-claude-md`), and it's merge-order-fragile — rebase each route-adding branch onto latest main so the count reflects the union.

- **Security**: 2026-05-21 closed a CVE-class anonymous cross-tenant data hole (`04cb661`, live in prod). Production-hardening batch shipped (deep `/ready`, pool fail-fast, `errors_total`, bad-input→400, agent graceful-recovery). See "Production hardening" + `RESOLVED.md`.
- **CI**: green. Agent package gated in CI. Tests (as of 2026-06-22 per CLAUDE): backend ~1,940 · dashboard ~790 · agent ~360 · E2E (numbers from recent merges; CI includes simulate tools gate). Full 4-job gate on main.
- **Voice / Telnyx**: New live number **`+1-630-937-9478` is dead** (old order deleted, never kept). Live **`+1 630-822-9086`**. Previous `+1 630-866-1960` (2026-06-02) dead. Test verification number **`+1 630-822-9086`**. Old provisioning details in history below. **PSTN inbound CONFIRMED 2026-06-30** (real call to `822-9086` reached the agent + logged a session/transcript). **Remaining**: live call-transfer REFER enablement on Telnyx SIP; one live booking call to confirm the employee-skills fix end-to-end. Full checklist: `docs/AIASSISTANT_GO_LIVE_TODO.md`.
- **Env vars (user action)**: `SENTRY_DSN` + `BETTER_STACK_TOKEN` — ❌ **DROPPED 2026-07-02** (paid observability vendors declined; prod already emits `/metrics` + logs + `/ready` for free — see the DROPPED decision in "Prod config / observability" below). (`METRICS_TOKEN` **confirmed SET** 2026-06-29 — `/metrics` returns 401 not 404; `DASHBOARD_URL` confirmed set per the 2026-06-18 reconcile.) **P0 progress**: GitHub branch protection on `main` now gates merges/deploys on CI green (4 jobs, applied 2026-06-15). Enable Railway "Wait for CI" on services for full coverage. See the Production Wiring Checklist above.
- **Browser validation**: Role gating + invite flow — DONE 2026-06-03, proven by green e2e (`auth-flows` route-gate 403, `workflows:630` front-desk nav-hide/snap-back, `workflows:676` owner invite).
- **UX audit pass 2 (2026-05-19)**: Raw findings were in `ux-review-notes.md` (removed 2026-06-30; items triaged here). Actionable items triaged into the clusters below. Cluster-B defects closed 2026-05-21.

Everything else complete or tracked below.

---

## 🎯 Open Work — Master Backlog (canonical, consolidated 2026-06-23; post doc hygiene)

- [x] **P0 verification gaps — testing trio** — DONE 2026-07-01 (branch: `test/blindspot-p0-verification`; per-item detail: `docs/TODO.md` "Verification blind spots" section, audit: `docs/TEST_DB_AUDIT.md`)
  - Real-DB booking integration test in CI: `src/agentToolsBookingIntegration.test.ts` (mutation-verified against the tz bug).
  - Tool-selection eval: `agent/scripts/sim-toolselect.ts` via `./scripts/simulate.sh toolselect` (baseline 6/6).
  - Mocked-DB audit + 6 real-DB companion suites (analytics, auditLog, versionHistory, voice, reminders seed, customer search).
- [x] **🐛 BUG — `/agent-tools/find-customer-by-name` ILIKE wildcard over-disclosure** — FOUND + FIXED same day (2026-07-01, by `agentToolsCustomerSearch.realdb.test.ts`). LIKE metacharacters (`%`/`_`/`\`) are now escaped before interpolation into `'%' || $2 || '%'`, so a `%` in a transcribed name matches literally instead of dumping the tenant address book. Regression test asserts zero matches for bare `%` and `___`.
- [x] **🐛 BUG — `GET /voice/history` unvalidated query params → 500s** — FOUND + FIXED same day (2026-07-01, by `voice.realdb.test.ts`). `limit`/`offset` now digits-only-validated and `customer_id` UUID-validated (`requireValidUUID`) → clean 400s instead of pg `NaN`/22P02 500s. Regression tests added.
- [x] **`scheduleForAppointment` reminder double-seed** — FOUND + FIXED same day (2026-07-01, by `scheduleForAppointment.realdb.test.ts`). Idempotency enforced at the DB layer: partial unique index `reminder_schedules_one_scheduled_per_type` (migration `20260701020000`) + `ON CONFLICT DO NOTHING` on the seed INSERT — race-safe under concurrency (parallel-seed test) with no cross-statement locks. (First attempt used an app-level probe, then a transaction + advisory lock per Copilot review — the lock deadlocked the appointments cascade in CI E2E; the unique index is the durable design.) Reschedule still reseeds (cancel-then-seed vacates the partial index).
- [x] **🐛 BUG — version-history: deleted-list 500s on 4/6 tables + `restore_fields_from_version()` / `copy_fields_between_records()` dead on ALL tables** — FOUND + FIXED same day (2026-07-01, by `versionHistory.realdb.test.ts`, 33 tests). The two RPCs still queried bare `id` after the 2026-05 PK renames (`column "id" does not exist` — field-restore/copy-fields were 500ing in prod for every table); the deleted-records list hardcoded `t.name, t.phone` which don't exist on appointments/voice_sessions/services/resources. Fix: migration `20260701010000_fix_version_rpc_pk_names.sql` (PK-aware RPCs, same pattern as `soft_delete_record`, PLUS `jsonb_populate_record` decode — the original SET clause stringified jsonb, so a restored text field came back JSON-quoted; only reachable once the PK fix made the functions run) + per-table display columns in `versionHistory.ts`. **Prod migration apply needed before/at merge** (fix-forward: the functions are already dead in prod, so ordering can't make anything worse).

- [x] **Blindspot P0 round 2 — multi-employee scheduling coverage + agent tool-call arg logging** — DONE 2026-07-02 (branch `test/blindspot-p0-round2`; detail: `docs/TODO.md` "Verification blind spots"). (1) `src/multiEmployeeScheduling.realdb.test.ts` — 7 real-DB tests proving skill matching, employee spillover, shift-aware assignment, capability-gated resource exhaustion, and the first true PARALLEL GiST double-book race (exactly 1 winner, 3 clean TIMESLOT_OCCUPIED). (2) `agent/src/redactToolArgs.ts` — the `function_tools_executed` log line now carries each tool call's ARGS (PII-redacted: phone/code keys digit-masked, time strings + names preserved) + per-call `is_error`; 13 unit tests. Remaining P0 observability: paid vendors (SENTRY_DSN / BETTER_STACK_TOKEN) ❌ DROPPED by decision (2026-07-02); alert rules stay optional/free — see "Prod config / observability" below.
- [x] **UI — hero feature grid looks incomplete (empty 4th slot)** — DONE 2026-07-01. Added a 4th `feat-tile` to the hero `feat-grid-hero`: **"Shows You Why You're Losing Jobs"** (green bar-chart icon) — the WHY differentiator — so the 2-col grid is a full 2×2. `dashboard/app/page.tsx`.
- [x] **🐛 BUG — deleting a customer orphans their appointments (can't cancel)** — FIXED 2026-07-02 (branch `fix/customer-delete-cancels-upcoming`). (Reported 2026-07-01, Dale — "Ab Smith".) `DELETE /customers/:id` now runs soft-delete + **auto-cancel of the customer's UPCOMING scheduled appointments in one transaction** (frees the slots; past/completed kept for history; already-canceled untouched), and mirrors `/appointments/:id/cancel` by dispatching `syncAppointmentToAll(…,'delete')` per canceled appointment so external calendars free too. One-time backfill migration `20260702000000_cancel_orphaned_appointments_of_deleted_customers` cancels the pre-fix orphans (data-only, no baseline regen; verified against a seeded orphan on local DB). 3 real-DB route tests (`src/customerDelete.realdb.test.ts`): upcoming-canceled/past-kept/already-canceled-stays, other-customer untouched, 404-path cancels nothing. **Prod migration APPLIED + VERIFIED 2026-07-02** (`schema_migrations` head = `20260702000000`, 154 total; the backfill matched zero rows on prod — no soft-deleted customers exist there, so it was a safety no-op).
- [x] **🐛 BUG — landing page: pricing toggle + mobile hamburger menu are dead** — FIXED 2026-07-02 (branch `fix/landing-pricing-toggle-hamburger`). (Found 2026-07-01.) Root cause confirmed: `<script>` inside `dangerouslySetInnerHTML` never executes. Moved BOTH the pricing toggle (Monthly/Annual price swap + active state + annual note) and the full hamburger menu (open/close, backdrop tap, link-click close, Escape, body scroll lock, icon animation) into `useEffect`s in `LandingPage` — same pattern as the capability grid (PR #151); deleted the entire dead inline `<script>` (its `.reveal` observer part was already duplicated in a working effect) and the dead `onclick=` attributes. 5 component tests (`dashboard/app/page.test.tsx`): price swap both directions, annual-note visibility, hamburger open/backdrop-close, Escape/link-close, auth-redirect sad path.
- [x] **Voice: "thinking" cover — looping key-typing bed** — DONE 2026-06-29 (`feat/thinking-sound-bed`), part (b). The SFX bed ships via LiveKit's built-in `voice.BackgroundAudioPlayer` (`thinkingSound: KEYBOARD_TYPING`, the clip ships in `@livekit/agents/resources` — no asset to source). `agent/src/session/thinkingSound.ts` (`attachThinkingSound`) wires it on a started session whose room is connected; the framework owns the 2nd-track publish, loop, mix, and `agent_state=thinking`→play / `speaking`→stop. Flag `ENABLE_THINKING_SOUND` (default OFF, RULE 10.2) + `THINKING_SOUND_VOLUME` env (0–1, default 0.5, live-tunable). 3 wiring unit tests (start / detach-idempotent / start-failure-swallowed); 402 agent tests green. **Part (a)** — the spoken cached filler — was already built as the output watchdog (`watchdog.ts`, `ENABLE_OUTPUT_WATCHDOG`); left as-is. The two are **independent, not layered** (watchdog `say()`→`speaking` would stop the bed; composing is a future real-call design). **Caveats stand:** the bed plays before ~every reply in pipeline (no per-turn deadline; fine as ambient); it MASKS a stall, doesn't fix it (RULE 2.4 — raise TPM / fix the tool). **Real-call validation (Dale, not CI):** does the 2nd track mix through to PSTN, volume, feel — flag stays OFF until confirmed. See VOICE_AGENT_PLAYBOOK §8.2.
- [x] **Dashboard: "Delete old calls" button** — DONE 2026-06-29 (`feat/delete-old-calls`). Owner-gated **soft-delete** (recoverable; sets the already-existing `voice_sessions.is_deleted/deleted_at/deleted_by` — no migration needed). Backend: `DELETE /voice/session/:id` (single) + `POST /voice/delete-old {older_than_days}` (bulk, excludes `status='active'`); both owner-gated (front-desk 403, super-admin bypass) + RLS-scoped; also fixed `/voice/active` + `/voice/history` to filter `is_deleted = false` (they were leaking soft-deleted rows). Dashboard: `useConfirm()` dialogs + per-call delete (detail pane) + bulk "older than 30/90/180/365 days" control in the Call History header — both owner-only. Hard-delete (true PII erasure of caller_phone/transcripts) deliberately deferred to the legal-held GDPR/retention work (#68/#69). Tests: 8 backend (`src/voice.test.ts`) + 3 dashboard (`VoiceCallsView.test.tsx`); SQL + full owner JWT→gate→RLS path smoke-verified against a real local DB. Analytics already filtered `is_deleted = false`, so deleted calls drop out of stats too.

**This is the single canonical list of every OPEN item.** The dated sections that
follow (Active build queue, Production Wiring, Phase 13, Voice Validation, Back-to-Front,
UX audit pass 2, …) are the **detail/history dossier** — full IDs, env specifics, status
notes, and the `[x]` DONE log for each item below. `GAPS.md` remains the category
inventory ("did we miss a whole angle?").

_Status reconciled 2026-06-18 (from the former `TODO_GAPS.md` prod audit): `DASHBOARD_URL`,
`METRICS_TOKEN`, `CORS_ORIGIN`, `EMAIL_USER`/`EMAIL_PASS`, `BACKEND_URL`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO`/`GROWTH_PRICE_ID`, and `TELNYX_PHONE_NUMBER` are
**confirmed set in prod** — they are NOT in the open list below even though older dossier
sections still show them as "IN FLIGHT (user)"._

### 🌿 Parked feature branches (unmerged work — purpose preserved 2026-06-23)

These branches survived the 2026-06-23 cleanup because each holds real unmerged work that hit a hard gate (prod migration / legal / active-work collision). Captured here so the intent isn't lost if a branch is ever pruned. Triage method + full context: `RESOLVED.md` (2026-06-23 entry).

- [x] **Per-tenant default buffer between appointments — SHIPPED 2026-07-01 via PR #137** (superseded the parked `feat/default-appointment-buffer`/PR #41, now CLOSED). `src/services/tenantBuffer.ts` + `getTenantBufferMinutes()` wired into the agent booking tools, buffer UI on the AI Persona / preferences page, and both migrations (`20260607000000_tenants_default_buffer` + `20260607000001_booking_buffer_enforcement`) — all in main. **Prod: both migrations applied + `tenants.default_buffer_minutes` column verified present 2026-07-02.** (The old #41 line here claimed "genuinely missing" — stale; reconciled 2026-07-02.)
- [x] **`feat/knowledge-suggestions` (PR #42) — improved variant of the website-scan Q&A review UI. DONE 2026-06-23, re-landed as PR #82 (`6afed91`) → merged to main.** Recovered from `refs/pull/42/head` after the branch was deleted, re-applied clean on current main. Matched items now enter as `'suggested'` (owner reviews everything before live KB); approve path wrapped in a try/catch txn with ROLLBACK; the 0-row status-guard race now throws a 409 (was a reply.send() inside the txn callback → double-send + false approval log — fixed + tested). Also updated the `kb-import-website-stub` E2E to the new all-items-suggested contract (0 confirmed, ≥4 suggested) and renamed `confirmedItems`→`matchedItems`. No migration (table+statuses already in main). Grok's `feat/website-knowledge-import` overlaps the same handler — rebase that work on this.
- [ ] **`feat/gdpr-customer-purge` (PR #68) — owner-gated single-customer GDPR/CCPA erasure** `POST /customers/:id/purge` (typed phone confirmation, atomic anonymize-in-place + audit_log PII redact, runtime kill-switch `ENABLE_CUSTOMER_PURGE` — inert/404 until enabled; 8 tests). **Blocked on:** LEGAL SIGN-OFF (erases PII irreversibly). Do not merge/enable without it.
- [ ] **`feat/data-retention-worker` (PR #69) — disabled-by-default automated retention/purge worker** (`ENABLE_RETENTION_WORKER` + explicit `RETENTION_DAYS`, no default window, anonymize-in-place, per-tenant-failure-isolated; 9 tests). **Blocked on:** LEGAL SIGN-OFF (irreversible PII erasure). Broader-PII scope (`voice_sessions`/transcripts/appointment descriptions) is a deliberate follow-up.
- [x] **`docs/website-import-priority` — RESOLVED 2026-07-02 (landed/superseded).** The branch no longer exists (not on origin, not local — verified). The feature it specced **shipped**: `src/routes/knowledge.ts` carries the website-import path (`knowledge.importWebsite.test.ts`), the review-UI landed via PR #82 (knowledge-suggestions, MERGED), and the design specs live in main under `docs/superpowers/plans/2026-06-09-website-knowledge-import-plan1-question-bank.md` + `docs/superpowers/specs/2026-06-09-website-knowledge-import-design.md`. Nothing to recover.
- [x] **`fix/agent-tenant-resolution` — RESOLVED 2026-07-02 (superseded).** The branch no longer exists (not on origin, not local — verified) and its go-live-docs commits (`GO_LIVE_FINDINGS.md` / `TELNYX_HANDOVER.md`) are unreachable in git (no PR to restore). The Telnyx go-live ops detail they held is now covered in `docs/RUNBOOK.md` (12 Telnyx/REFER/SIP references) and `docs/AIASSISTANT_GO_LIVE_TODO.md` (40) — closed as superseded, no unique delta to fold.

### P0 — Launch blockers (clear before first paying customer)

**Voice path — live inbound + transfer** (dossier: _Voice Validation_, _Phase 13_)

- [x] **PSTN inbound — CONFIRMED 2026-06-30.** A real call to `+1 630-822-9086` reached the agent (Beth) and held a full ~3-min conversation (`voice_sessions` row + transcript landed). Inbound path Telnyx → LiveKit → `ai-sec-agent` works; the `ai-sec-agent` deploy is validated. (The earlier "wrong number" symptom was a documentation transcription error — `866-9086` was never ours; `822-9086` is the real owned+routed DID.) Booking on that call failed for a separate reason — the employee-skills gap, root-caused + prod-patched same day; needs one more live call to confirm end-to-end (see below).
- [ ] **Telnyx REFER** — enable call-transfer / REFER on the SIP Connection (`livekit-outbound`); else `transfer_call` fails at runtime.
- [ ] **Forward number** — set on dashboard AI Persona → "Forward Calls to a Person" (Dale's cell `+1 608 217 5303`).
- [ ] **Telnyx prod creds** — verify `TELNYX_API_KEY` + `TELNYX_SIP_CONNECTION_ID` set on Railway (local `.env` only today); else OTP + provisioning 503.
- [ ] **Manual conversation testing** — full voice calls (booking + preference capture); confirm natural dialog flow (asks preferred time, widens, never imposes). Blocked on live inbound.

**Prod config / observability** — ❌ **PAID VENDORS DROPPED by decision 2026-07-02 (Dale).** (dossier: _Production hardening_, _Phase 13_)

> **Decision:** paid observability vendors (Sentry, Better Stack) are declined — not worth a paid signup at this stage, and dropped from the backlog (not merely deferred). Prod already emits everything needed with zero extra cost — `GET /metrics` (Prometheus, `METRICS_TOKEN` set + live), structured JSON logs to Railway live-tail, and `/ready` (DB + pool health). The only missing piece is *automated paging*, a convenience, not an outage risk — the data is readable manually. If it's ever wanted, do it via a **free path** (Grafana Cloud free tier scraping the existing `/metrics`, or Railway-native alerts). The code hooks for Sentry/Better Stack stay in place and no-op until env vars are set — nothing to remove.

- ❌ **`SENTRY_DSN`** — DROPPED. Code keeps the optional integration (no-op until set); not going to pay for it.
- ❌ **`BETTER_STACK_TOKEN`** — DROPPED. Same call; logs already reach Railway live-tail free.
- [ ] **Alert rules** (optional, free) — NOT dropped; rules are written + ready in `docs/ALERTS.md` (PromQL for error-rate, http-5xx, p95, booking-failure, pool-waiting) and could be wired off the free `/metrics` + `/ready` signals without a paid vendor. Low priority; do it if/when a paging path is stood up (Grafana Cloud free tier over the existing `/metrics`).

**Billing** (dossier: _Active build queue_, _Phase 13_)

- [ ] **Stripe — verify ALL paths in test mode** (`stripe listen` round-trip): checkout → webhook verifies → subscription activates (gate flips) → `payment_failed` → `subscription.deleted` revokes → plan gating (Solo/Growth/Pro). Confirm `STRIPE_SECRET_KEY` + webhook registered at `/billing/webhook`. [x] **`simulate stripe` path-check DONE** (`scripts/sim-stripe.mjs` via `./scripts/simulate.sh stripe`): demo-tenant JWT → `/billing/status` → webhook sig gate → **per-plan checkout probes (Solo/Growth/Professional)** reporting each plan's `STRIPE_<PLAN>_PRICE_ID` wiring → portal route; GAPs (key/price missing) vs hard FAILs (route broken). **Remaining (user)**: the real `stripe listen` round-trip with test keys (webhook event handling: activate/payment_failed/deleted-revoke) needs real Stripe + the CLI.
- [ ] **Stripe Tax** — user actions: enable Stripe Tax dashboard, register IL + customer-state nexus, set `STRIPE_AUTO_TAX=true` on Railway (code done).

**CI / deploy gate** (dossier: _Production hardening → Gap 2_)

- [ ] **Enable "Wait for CI"** toggle on the 3 Railway services (branch protection already gates merges).
- [ ] **Gate end-to-end verification** — open a deliberate-fail PR → confirm block → fix → confirm green unblocks.

**Legal / ops — user actions, not code** (dossier: _Phase 13_)

- [ ] **LLC bank account** for Thinking Hammer LLC (required before Stripe payouts).
- [ ] **Legal docs** — Bonterms ToS + Privacy Policy + DPA, published + linked from dashboard.
- [ ] **TCPA SMS opt-in** consent language at booking time — before any confirmation texts. (Public templates from carriers are fine to reference.)
- [ ] **E&O insurance** before first paying customer (~$800–1,200/yr; Next/Hiscox).
- [ ] **Cyber Liability insurance** before first paying customer (often bundled with E&O).
- [ ] _FUTURE_: at ~$60K taxable income, elect S-Corp taxation (IRS Form 2553; consult a CPA).

**Security housekeeping**

- [ ] **Rotate Railway team token** created 2026-06-12 — pasted into a Claude session; burn + reissue.
- [x] **Remove DynaTire rows from prod DB** — DONE 2026-06-29: prod inspected, **zero DynaTire rows** present — already clean, no-op. Same pass found + removed a **stray duplicate demo-tenant row** (older seed superseded by the canonical one; no transactional data). The dup carried a second owner row for the same email → nondeterministic login (email is unique PER-tenant, not global). Removed; canonical intact. Login query hardened in PR #123 (`ORDER BY` + multi-tenant warning). Operational specifics in session memory, not the repo.

### P1 — Customer success & trust (dossier: _Back-to-Front_, _Non-blocking_)

- [x] **AI cost / usage meter** — instrument spend at call sites (added recording via aiCost helper to kb_ingestion, kb_query/policy paths in knowledge routes + agentTools; voice session via existing record-ai-cost + LiveKit collector; summary/classify costs folded into model_usage). Uses ai_cost_events table (data model chosen). "Usage this month" surfaced via /analytics/ai-cost + breakdown in AnalyticsView (partial UI pre-existed). 2026-06. (Remaining agent-side explicit TTS etc. covered by session usage.)
- [x] **Self-service links — dashboard surface** — "Send self-service links" button (with loading + toast) in `AppointmentDetailPanel.tsx`; API client + POST /appointments/:id/send-self-service-links (generates tokens, sends via Telnyx SMS, returns links; also embedded in normal booking confirmations via appointmentService + templates). Backend + unit tests complete. (PR #34 + follow-ups.) 2026-06.
- [x] **Self-service E2E** — added in workflows.spec.ts: book via helper → send-links trigger (API) → customer uses public /self/cancel and /self/reschedule pages (confirm, success states, DB effect) → negatives (invalid token UI) + double-use (idempotent already-canceled). Uses generated tokens matching backend + e2e fixtures. 2026-06.
- [ ] **Verify reminder delivery stats in prod** after Telnyx creds set.
- [ ] **Pricing tiers (Pro/Enterprise) positioning.**

### P1 — Optional integrations (turn on per business need) (dossier: _Production Wiring → optional integrations_)

- [ ] **Google Calendar live proof** — `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` + GCP OAuth app; prove a real round-trip via `calendarSync.ts` + `SYNC_TEST_RECORDER`.
- [ ] **Outlook Calendar** — `OUTLOOK_CLIENT_ID/SECRET/CALLBACK_URL` + Azure app.
- [ ] **Square CRM** — `SQUARE_CLIENT_ID/SECRET/CALLBACK_URL` + `SQUARE_WEBHOOK_SIGNATURE_KEY` + provider OAuth app (code no-ops safely until set).

### P2 — Quality, scale & defensibility (dossier: _Back-to-Front_, _Production hardening_, _Tooling harness_)

- [ ] **Data portability & retention** — **export + audit-log APIs DONE 2026-06-22**: `GET /export/tenant-data` (`src/routes/exportData.ts` — owner-gated, tenant-scoped JSON dump of 25 tables; `users` column-restricted, no `password_hash`; excludes `tenant_integration_settings`/security-token tables; `record_counts` + attachment header; 4 tests; JSON not ZIP-of-CSV to avoid a new dep) **+** `GET /audit-log` (`src/routes/auditLog.ts` — owner-gated, paginated 500-max, `table_name` filter + date range, newest-first; 6 tests). **Dashboard surfaces DONE 2026-06-22**: `AuditLogView` (Setup → "Audit Log" sub-tab — paginated table + table filter **+ date-range filter + row drill-down modal showing the old→new field diff**; 6 tests) and a "Download my data" export button in `BusinessSettingsView` (client-side JSON download; 2 tests). [x] **audit trail extended to services + employees DONE 2026-06-22**: migration `20260622000000` adds `service_id`/`employee_id` PK cases to `fn_audit_trigger` + the trigger on both tables (owners now get a change history for prices + staff, not just bookings); `AUDITED_TABLES` + dashboard filter options updated; baseline regenerated (141 migrations); backend test + a real-DB E2E (`audit-log.spec.ts` — create+update a service → INSERT/UPDATE rows appear). Forward-compatible: deploy is safe pre-migration (just no service/employee rows until applied). **Prod action DONE 2026-06-23**: migration `20260622000000` applied + verified on prod (`trg_audit_services` + `trg_audit_employees` triggers present). **Remaining → both PRs (#68/#69) CLOSED 2026-06-23 in the branch cleanup (branches deleted; restorable from the PR page), still HELD for owner/legal review**: (a) GDPR/CCPA single-customer erasure `POST /customers/:id/purge` — **PR #68** — owner-gated, typed phone confirmation, atomic anonymize-in-place + audit_log PII redact, runtime kill-switch `ENABLE_CUSTOMER_PURGE` (inert/404 until enabled); 8 tests. (b) automated retention/purge worker — **PR #69** — disabled by default (`ENABLE_RETENTION_WORKER` + explicit `RETENTION_DAYS`, no default window), anonymize-in-place, per-tenant-failure-isolated; 9 tests. **Both erase PII irreversibly → do NOT merge/enable without legal sign-off.** Deliberately tight scope: they erase the canonical `customers` row + its audit snapshots only; PII in `voice_sessions.caller_phone` / transcripts / appointment descriptions is the flagged follow-up.
- [ ] **Website scan polish** — [x] **rate-limit DONE 2026-06-22**: per-tenant token-bucket guardrail on `POST /knowledge/import-website` (`src/services/scanRateLimit.ts`, default 3-scan burst + 3/hour refill, env-tunable) → 429 when dry; skipped in the E2E stub path; 6 unit tests + a route 429 test. [x] **scan happy-path E2E DONE 2026-06-22**: `kb-website-import-happy` in `knowledge-base.spec.ts` — exercises the full scan → staged-suggestions path via `KNOWLEDGE_IMPORT_E2E_STUB` (closes the gap the old test documented as "not CI-safe"; guarded to skip when the stub is off). [x] **wizard browser click-path E2E DONE 2026-06-22**: `wizard-website-scan.spec.ts` — drives the real UI (welcome → mode chooser → business-type picker → wizard → "Import from website" step → type URL → Scan → success message), pre-seeding one employee so the step-7 chip is reachable; stub-guarded. (Added a `data-testid="wizard-biztype-option"` hook to `BusinessTypePicker`.) **Remaining**: periodic re-scan scheduler for stale KB (deferred — needs a `last_scanned` column/migration + is a cost/product call).
- [x] **Analytics depth — DONE 2026-06-22..23** (reconciled 2026-07-02: item was still `[ ]` though the body shows every sub-part shipped; the one genuine remainder — pure-inquiry abandonment — is carved out as its own item below). **RAG debugger API DONE 2026-06-22** (dashboard surface DONE — `ExplainAnswerView.tsx` in Setup → "Answer Debugger", verified 2026-07-02): `POST /knowledge/explain` (`src/routes/knowledge.ts`) — owner-gated; embeds the question the SAME way `/agent-tools/policy-answer` does (normalize → embed) and runs the real `search_tenant_docs_normalized` retrieval, returning ranked candidate chunks + similarity scores annotated with `above_threshold` / `used_in_production` (top-3 above 0.5) + a `would_answer` flag, so an owner sees WHY the AI answered (or didn't); 5 tests. **Dashboard DONE 2026-06-22**: `ExplainAnswerView` (Setup → "Answer Debugger" sub-tab — question box → ranked candidates with % match + "Used by AI" badges + a would-answer verdict + a **"What the AI would draw from" composed-answer box** (the exact cited context the agent would relay, via `composed_answer` on `/knowledge/explain`); tests updated). [x] **caller-facing source citations DONE 2026-06-22**: `/agent-tools/policy-answer` now resolves each matched chunk's source-doc title (joins `tenant_docs`) and prefixes the context with `[From "<title>"]` so the agent can attribute answers; prompt updated to use the marker naturally; agentTools + integration tests cover it. [x] **cohort + bookings-by-service DONE 2026-06-22**: `GET /analytics/cohorts` (`src/routes/analytics.ts`) — repeat-caller cohorts (grouped on phone DIGITS so format variants collapse; `HAVING count>1`) + bookings-by-service (join booked calls → appointment → service) + a repeat-caller summary (distinct/repeat/share); dashboard "Repeat Callers" + "Bookings by Service" panels in `AnalyticsView`; backend (2) + component (1) + E2E (1) tests. [x] **CLV DONE 2026-06-22**: `/analytics/cohorts` also returns `top_customers` (top 20 by lifetime booked revenue = `sum(service.price)` per customer, ::float8) + a "Top Customers" panel in `AnalyticsView`; unit + component + E2E-shape tests. [x] **abandonment-by-service DONE 2026-06-22**: migration `20260622010000` adds `voice_sessions.requested_service_id`; the `book-with-scheduling` agent tool best-effort fuzzy-resolves the requested service name → `service_id` and records it on the call's `voice_session` **whether the booking succeeds or fails** (no agent-worker change needed — that handler already carries `call_id` + `serviceType`); `/analytics/cohorts` returns `abandonment_by_service` (abandoned calls `appointment_id IS NULL` grouped by requested service) + an "Abandoned by Service" panel; backend capture test + analytics test + component + E2E-shape. **Prod action DONE 2026-06-23**: migration `20260622010000` applied + verified on prod (`voice_sessions.requested_service_id` column present). (Pure-inquiry abandonment — callers who only asked availability without a booking attempt — still untracked: the `available-slots`/`scheduling-options` tools don't carry `call_id`; would need an agent-worker change.) **Analytics depth complete** except that inquiry-only edge. [x] **From/To date-range filtering DONE 2026-06-22** (PRs #65/#66): `/analytics/calls` + `/analytics/cohorts` take optional `start_date`/`end_date` via new `optionalDateBounds` (all-time when absent; calendar-invalid dates like `2026-02-30` rejected to null by `isValidDateOnly` so they never reach a `$n::date` cast; `end` is day-inclusive; voice queries bound on `started_at`, revenue query on `start_time`); `AnalyticsView` gets From/To controls (range-change refetch keeps the page + controls on screen); backend + component tests. (#66 was a fix-forward for #65: a watcher race merged #65 before its review-fix commit registered, so the calendar-invalid-date guard + two other Copilot fixes landed via #66.)
- [x] **Docs / runbooks** — DONE 2026-06-22: `docs/RUNBOOK.md` (incident + telephony playbook — triage, agent-silent, reminders-not-sending, Stripe-webhook-400, backend-down, DB-pool-saturation, full Telnyx→LiveKit→agent path incl. REFER + blocked-caller-ID OTP) **and** `docs/OWNER_GUIDE.md` (owner admin guide — dashboard tour, how-to-read-analytics: Call Volume / Booking Conversion / Caller Abandonment / Why Callers Reached Out, + FAQ). All three sub-parts (owner guide, telephony playbook, prod incident runbook) covered.
- [x] **Agent reliability — idempotent-read retry** in `toolsClient` — DONE 2026-06-22: code wired (`agent/src/toolsClient.ts:50` `maxAttempts = opts.isReadOnly ? 2 : 1` — mutations never retried; one retry on transient 5xx / network throw; 7 read-tool call sites in `agent/src/tools.ts`) **+ now tested** — added 5 cases to `toolsClient.test.ts` (read retry→success, read exhaust both-5xx, mutation no-retry on 5xx, read retry on network throw, mutation no-retry on throw). The mutation-no-retry cases are the double-book guardrail. 14/14 green.
- [x] **`simulate tools` → CI** — DONE: wired as a hard regression gate in `.github/workflows/ci.yml:269` ("Run simulate tools" step, `./scripts/simulate.sh tools --env local`; non-zero exit fails the E2E job). Runs the booking + recall journey against the live servers and flags `[dev]` gaps the same way the local harness does.
- [x] **Remove vestigial edge-function section** from `docs/DEPLOYMENT.md` — DONE 2026-06-22: dropped the dead "Phase 3: Deploy Edge Functions" section (incl. vestigial `3.1 Link the Supabase CLI` — migrations apply via `setup-db.sh`, no CLI link needed) and renumbered Phases 4–8 → 3–7 + subsections.
- [x] **Booking RPCs ignore `is_deleted` in overlap/availability checks** — **DONE 2026-07-01 (PR #139, migration `20260701000000`, prod-applied + verified).** Added `AND (is_deleted IS NULL OR is_deleted = false)` to all 8 appointment subqueries in `book_appointment_atomic` (3: resource/employee/user overlap) + `book_with_scheduling_atomic` (5: resource+employee availability, unskilled-branch resource, timeslot-occupied + employee-occupied diagnostics); `check_availability_with_tz` already filtered. Confirmed the bug was reachable (`soft_delete_record` is PK-aware since `20260513000004` → soft-deleting an appointment sets `is_deleted=true`, leaves `status='scheduled'`). Offer/book symmetry verified intact (the slot-offering reads already filtered). Also guarded 3 agentTools reads (`get_my_appointments`, cancel, reschedule) that still counted soft-deleted rows. Real-DB TDD (RED→GREEN, `booking-soft-delete.test.ts`); full suite 2020/2020.
- [ ] _(Optional)_ Repoint Railway `healthcheckPath` → `/ready` (gates deploy promotion on DB reachability — Dale's call).

### P3 — Moat & expansion (deferred until a customer asks) (dossier: _Production Wiring → future candidates_)

- [ ] **Square CRM deeper reads** (pull open jobs into voice context); real external OAuth + Stripe + live CRM round-trips in CI (recorder-only today).
- [x] **Pure-inquiry abandonment tracking** — DONE 2026-07-02. `get_available_slots` + `get_scheduling_options` agent tools now thread `call_id` (schemas accept optional `call_id`); both handlers fire the same best-effort `requested_service_id` write as `book-with-scheduling`, extracted into a shared `captureRequestedService()` helper (fire-and-forget, COALESCE-guarded, never blocks the call). So a caller who only asks availability and never books is now attributed to their `voice_session` → counted in abandonment-by-service. Tests: 3 mocked route tests (available-slots + scheduling-options fire the capture with the right params; no `call_id` → no write) mirroring the existing book-with-scheduling capture test. Backend 2179 + agent 423 green.
- [ ] **Extended self-service** — public portal/login (manage all appointments); waitlist / callback-queue tool; no-show auto-marking + auto-rebook.
- [ ] **Voice enhancements** — post-call "how did we do?" SMS/NPS link; multi-language; real-time owner listen-in / barge.
- [ ] **Product expansion** — booking widget/embed; granular RBAC beyond owner/front_desk; white-label / reseller theming; public API; CSV/PDF export (calls/appointments/customers/analytics); SSO/SAML; international numbers (US-centric today); multi-DID per tenant.
- [ ] **Future CRM/platform candidates** (build-deferred per the `docs/STRATEGY.md` vendor heuristic) — QuickBooks/Xero, Toast, Apple Calendar (safe partners); Teams (notify-only); Vagaro/Mindbody, Acuity/Calendly (competitor-ish → shallow or import-only).

### UX backlog (separate workstream — `/ux-expert` audits) (dossier: _UX audit pass 2_)

- [ ] **BLOCKER (Dale)** — review live scheduling coloring/grading so Cluster A neutral-language work can proceed (de-grade slices reverted 2026-05-20; do not re-apply unprompted).
- [ ] **Cluster A — neutral-language / no-grading** (8 surfaces, blocked on the Dale review): `StepReview`, `SkillRelationshipMap`/`SkillMapNode`, `ResourceColumnsView`, `AppointmentListView`, `EmployeeDayFocusPanel`, `AnalyticsView`, `AppointmentDetailPanel`.
- [ ] **Wizard Phase B** — full draft-commit model (hold wizard state local, commit on Step-7 Done; ~5K-line infra; coordinate with overlay work).
- [ ] **P3 dense-view decomposition** — track-don't-piecemeal (`SettingsView`, `TenantEditPanel`, `CRMView`, `AppointmentView`, `DashboardHome`, `CustomerDetailPanel`, scheduler orchestration, …).

#### Pending UX reviews — un-audited surfaces (merged from `UIUX_TODO.md`, 2026-06-30)

Each screen below has had NO dedicated UX review; review before beta. (Full P0/P1/P2 UX-audit action list from the 2026-05-28 `/ux-audit` was completed — 70 items closed — and its remaining cross-referenced items are Cluster A / Wizard Phase B / dense-view above. Audit report: `scripts/ux-audit/reports/2026-05-28T0853/ux-audit.html`.)

- [ ] **[REVIEW]** `AIConfigView` — "Voice Settings" (raw system-prompt editing exposed to non-technical owners; "System Instructions (The 'Brain')" is dev language; dirty-save uses `warning` variant).
  - _Partial (2026-07-03, branch `fix/aiconfig-silent-save-copy`):_ fixed a silent save-failure (rejected saves gave the owner zero feedback) + dropped the dead-brand DynaTire placeholder copy. **Still open:** the "Brain" dev-language, raw-prompt exposure to non-technical owners, and the dirty-save `warning` variant.
- [ ] **[REVIEW]** `AnalyticsView` — full layout, empty states, date-range controls, metric usefulness to an owner.
  - _Partial (2026-07-03, branch `fix/analytics-copy-defects`):_ fixed 3 copy/label defects — dead "xAI TTS cost TBD" footer → OpenAI TTS; dev-language endpoint leak `(server aggregates via /analytics/stats)`; and a Call Volume subtitle that said "last 30 days" over an all-time count. **Still open (owner judgment):** full layout, which metrics matter, and the no-show/"abandoned" semantics.
- [ ] **[REVIEW]** `VoiceCallsView` — list layout, outcome-badge legibility, transcript/summary display, filter UX, meaning of "abandoned".
  - _Partial (2026-07-03, branch `fix/analytics-copy-defects`):_ the badge label/color map + outcome filter were built on a phantom vocabulary the agent never writes (`appointment_booked`/`voicemail`/`abandoned`), so booked calls showed a grey "booked" badge and 4 of 5 filters matched nothing. Realigned to the true stored vocabulary (`booked`/`transferred`/`message`/`no_availability`/`wrong_service`/`price`/`info`/null) + a working "No clear outcome" (abandoned) filter + outcome-select aria-label; the badge maps also keep backward-compat aliases for the legacy vocabulary (per Copilot review). **Follow-up (separate): DONE 2026-07-03** (branch `chore/voice-outcome-vocab-align-and-doc-fixes`). The shared `VoiceSessionOutcome` type (`shared/voiceCrm.ts`) + the `/voice/session/end` Zod enum (`src/routes/voice.ts`) now include the live `callOutcome`/`callClassify` vocabulary (`booked`/`transferred`/`no_availability`/`wrong_service`/`price`/`message`/`info`) **additively** — the legacy members (`appointment_booked`/`info_provided`/`voicemail`/`abandoned`/`other`) are KEPT for backward-compat per the earlier Copilot review. Before this, `/voice/session/end` 400'd on a real `booked` outcome (the live agent path `/agent-tools/voice-session-end` was unaffected — it uses `outcome: z.string()`). Regression test `16b` in `src/voice.test.ts` pins each live string is accepted. **Still open (owner judgment):** list layout, transcript/summary rendering.
- [ ] **[REVIEW]** `AppointmentView` + `AppointmentDetailPanel` + `AppointmentListSidebar` — 3-panel flow, mobile behavior, status-change communication (high-density).
  - _Partial (2026-07-03, branch `fix/dashboard-ux-review-batch2`):_ list rows made keyboard-selectable (role/tabIndex/Enter-Space/aria-label); description content text gray-400 → theme token; mobile back-button aria-label; and the Summary's false "The AI has verified availability" claim (rendered even for manually-created appointments) reworded to a factual recap. **Still open (owner judgment):** 3-panel/high-density layout, status-change communication.
- [ ] **[REVIEW]** `CRMView` + `CustomerDetailPanel` — search, customer/appointment history, edit + delete/restore, how AI call summaries surface.
  - _Partial (2026-07-03, same branch):_ fixed a mock-data leak (real-tenant fetch errors showed fabricated demo customers "Bob Smith"/"Alice Johnson" as real — now gated on `!tenantId` + error toast); added error toasts to the silent create/edit/cancel handlers; refresh + mobile-back a11y labels. **Still open (owner judgment):** search UX, how AI call summaries surface.
- [ ] **[REVIEW]** `ProfileView` — password-change discoverability, "My Profile" vs "Business Settings" boundary, role visibility.
  - _Partial (2026-07-03, same branch):_ theme buttons now expose selected state via `aria-pressed` (was color-only, invisible to assistive tech). **Still open (owner judgment):** password-change discoverability (email-reset flow), My-Profile vs Business-Settings boundary.
- [ ] **[REVIEW]** `BusinessSettingsView` — what stays here post-IA-merge vs moved to Setup.
  - _Partial (2026-07-03, same branch):_ fixed the assistant-name save false-success (rejected saves toasted success while the agent kept the old name on calls); calendar connect/disconnect now surface failures; two gray-500 content spots → theme tokens. **Still open (owner judgment):** what belongs here vs Setup / AI Persona.
- [ ] **[REVIEW]** `SettingsView` — owner vs super-admin split, overlap with BusinessSettingsView.
  - _Partial (2026-07-03, same branch):_ onboarding form's six fields now programmatically labeled (switched hand-rolled unassociated `<label>`s to the Input/Select `label` prop). **Still open (owner judgment):** owner vs super-admin split, overlap with BusinessSettingsView.
- [ ] **[REVIEW]** `EmployeeManagementView` — add-employee form, per-card skill assignment, deactivated-employee surfacing.
- [ ] **[REVIEW]** `ShiftManagementView` — team-size-conditional paths, copy-week discoverability.
- [ ] **[REVIEW]** `ResourceManagerView` — zero-resource state, service-mapping checkboxes, "capabilities" meaning.
- [ ] **[REVIEW]** `ServiceAssignmentView` — is 3 steps correct, no-assignment case, cancel/exit flow.
- [ ] **[REVIEW]** `SkillMatrixView` + `SkillAssignmentsView` + `SkillRelationshipMap` — grid legibility at scale, map value vs confusion, both-views-necessary.
- [ ] **[REVIEW]** `DeletedRecordsPanel` + `RecordHistoryModal` — discoverability, restore flow, version-history comprehensibility.
- [ ] **[REVIEW]** `/register` — form flow, field order, error handling, post-signup first experience.
- [ ] **[REVIEW]** `LoginView` + `/forgot-password` + `/reset-password` — forgot-password end-to-end, error quality, mobile.
- [ ] **[REVIEW]** `SuperAdminDashboard` + `TenantCard`/`TenantCreateForm`/`TenantEditPanel` — admin interface usability (Dale-facing; slows onboarding if painful).
- [ ] **[REVIEW]** `FirstRunTour` — post-wizard overlay tour; content/flow review (behavior already correct).

### Tooling cleanup (dossier: _Tooling cleanup_)

- [x] `@typescript-eslint/unbound-method` — DONE 2026-06-22. Zero violations across all 3 packages (the "heavy in tests" concern never materialized — vitest `vi.fn()` mocks are plain object properties the rule ignores); promoted to `error` in all three eslint configs. Also fixed a stray `no-unnecessary-type-assertion` error in `agent/src/tools.test.ts` that had slipped past CI (agent CI runs tsc+tests, not lint).

---

## Active build queue (2026-06-12)

- [x] **🐛 BUG (infra) — `supabase/baseline.sql` was STALE; local E2E used a schema missing 3 shipped tables.** Found + FIXED 2026-06-19 (`fix/baseline-sql-drift`). `rebuild-db.sh` prefers the single-file `baseline.sql` then `setup-db.sh --baseline` marks every later migration applied **without running it** — so tables created after the 2026-05-18 squash (`knowledge_suggestion`, `customer_messages`, `ai_cost_events`) were absent from any baseline-built DB (local Playwright `globalSetup`, `npm run db:rebuild`) while CI dodged it (builds from the chain + `PLAYWRIGHT_SKIP_DB_RESET=1`). **Fix:** (1) regenerated `baseline.sql` from the chain (33→36 tables); (2) added `scripts/generate-baseline.sh` + `npm run db:baseline` (spins a throwaway DB, applies the chain, `pg_dump --schema-only --no-owner --no-privileges`) as the canonical regen so it can't silently rot; (3) closed the guard hole — `verify-schema-alignment.ts` only scanned `ADD COLUMN`, so `CREATE TABLE` (inline columns) escaped it; added `checkMigrationTablesInBaseline` (every migration-created table, minus dropped/renamed, must appear in baseline) + 4 unit tests. Verified: full KB e2e 15/15 green via the **baseline** path; guard catches the old drift, passes the new baseline. Note: CI exercises the _chain_ path, not baseline — this drift class is only observable locally, so the guard now runs in prepare-commit/CI as the catch.

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

- [x] **[prod]** **Reminder/comms SMS silently runs MockAdapter** — FIXED 2026-06-16: ProviderRegistry now defaults to Telnyx; boot warning fires if `TELNYX_PHONE_NUMBER` unset. **Prod action**: set `TELNYX_PHONE_NUMBER=+16308229086` on Railway.
- [x] **[prod]** **Email silently runs mock transporter** — code FIXED: boot warning fires when `EMAIL_USER`/`EMAIL_PASS` unset (`envWarnings.ts:35`), matching the Telnyx/CORS/`DASHBOARD_URL` silent-degrade siblings. (Without the env, `emailService.ts:22` installs a mock returning a fake messageId → emails never send.) **Prod action**: set Gmail app-password env (`EMAIL_USER`/`EMAIL_PASS`) on Railway.
- [x] **[prod]** **Agent `BACKEND_URL` defaults to `http://localhost:4001`** — FIXED 2026-06-16: `.default()` removed; agent now exits at startup if unset. **Prod action**: confirm `BACKEND_URL=https://ai-sec-production.up.railway.app` is set on `ai-sec-agent` Railway service.
- [x] **[prod]** **`STRIPE_WEBHOOK_SECRET` empty → every webhook 400s** — FIXED 2026-06-17: boot warning now fires when `STRIPE_SECRET_KEY` is set but `STRIPE_WEBHOOK_SECRET` is missing. **Prod action**: set `STRIPE_WEBHOOK_SECRET` on Railway.
- [x] **[prod] (security)** **`CORS_ORIGIN` unset reflects ANY origin** — FIXED 2026-06-16: boot warning now fires. **Prod action**: set `CORS_ORIGIN=<dashboard URL>` on Railway.
- [x] **[prod]** **`DASHBOARD_URL` defaults to `https://localhost:4000`** — FIXED 2026-06-16: boot warning now fires. **Prod action**: set `DASHBOARD_URL=<dashboard URL>` on Railway.

### `[prod]` — required env for core launch (already tracked, consolidated)

- [ ] **[prod]** Stripe live: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO/GROWTH/PRO_PRICE_ID` on Railway + webhook registered at `/billing/webhook` (3 events). Missing secret → billing 503; missing price → that plan's checkout 503.
- [ ] **[prod]** `DASHBOARD_URL`, `SENTRY_DSN` (backend + agent), `METRICS_TOKEN`, `BETTER_STACK_TOKEN` (backend + agent) on Railway. Observability is dark until set (`/metrics` 404, no Sentry, stdout-only logs).
- [ ] **[prod]** Telnyx voice OTP: confirm `TELNYX_API_KEY` + `TELNYX_SIP_CONNECTION_ID` set in prod — else `send_verification_code` fails (blocked-caller-ID bookings can't verify) + provisioning 503.
- [ ] **[prod]** Telnyx call-transfer / REFER enabled on the SIP Connection + dashboard forward number (carried from the transfer ship list above).

### `[prod]` — optional integrations (each needs env + external OAuth/webhook app; turn on per business need)

- [ ] **[prod]** Google Calendar — `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` + GCP OAuth app + redirect URI. Code complete (`googleCalendar.ts`); `/calendar` route 503s until set.
- [ ] **[prod]** Outlook Calendar — `OUTLOOK_CLIENT_ID/SECRET/CALLBACK_URL` + Azure app.
- [ ] **[prod]** CRM — Square: needs `SQUARE_CLIENT_ID/SECRET/CALLBACK_URL` + `SQUARE_WEBHOOK_SIGNATURE_KEY` + an OAuth app registered provider-side. Real implementation (`src/services/crm/squareClient.ts`/`squareSync.ts`), no-ops safely until configured. (Jobber/HubSpot/ServiceTitan removed 2026-06-12 as competitors — see `docs/STRATEGY.md`.)

### Future platform / CRM-sync candidates (backlog — BUILD DEFERRED until a real customer ask)

Captured 2026-06-19 (Dale brainstorming migration targets). **Decision rule = the vendor-business-model heuristic from `docs/STRATEGY.md`:** integrate transaction/volume vendors (POS) + infra vendors (calendars) that want more bookings; integrate shallow-or-not the SaaS-seat bundlers that ship a native AI receptionist (they're competitors we'd feed). Ask "how does this vendor make money?" first. Each below stays unbuilt until a beta customer can't operate without it (build principle: no integrations on spec).

- **Microsoft Teams** — NOT a calendar/CRM; chat+meetings. Only plausible use = "post new bookings to a Teams channel" (notification, not sync). Hold; cheap to add if a customer asks.
- **QuickBooks / Xero (accounting)** — infra/transaction; safe partner; ties into the MyAccountant federation direction. Sync customers/appointments → invoices. Strong candidate when accounting demand is real.
- **Toast (food & bev POS)** — transaction vendor (payment volume), safe partner; fits the non-trades vertical focus. Booking/customer sync.
- **Vagaro / Mindbody (salon + fitness)** — POS BUT ship their own booking/front-desk → **partial competitors** by the heuristic; integrate shallow (read customers) or not. Evaluate per-customer.
- **Acuity / Calendly (scheduling)** — overlap directly with our booking engine → competitor-ish; likely import-once (migration) rather than ongoing sync.
- **Apple Calendar (iCloud / CalDAV)** — infra, safe; rounds out calendar coverage alongside Google + Outlook.

### `[dev]` — NOT wired anywhere, needs code

- [x] **[dev]** **Voice-session capture (outcome + appointment link + summary)** — DONE 2026-06-12. `CallOutcomeTracker` (`agent/src/callOutcome.ts`) is mutated by the booking tools (`recordBooking(appointment_id)`, guarded on a real id in the response) and the transfer tool (`recordTransfer`); the shutdown hook reads it and sends `outcome` + `appointment_id` + a bounded/failsafe post-call `summary` (`agent/src/callSummary.ts` — never throws, can't drop the session-end write) to `voice-session-end`. Backend `VoiceSessionEndSchema` now accepts `summary` + UUID-validated `appointment_id` and forwards them to the RPC (was hardcoded null). +14 agent + 2 backend tests; `simulate tools` now proves the link **persisted** via a `voice_sessions` DB read-back (appointment_id matches the booking, outcome=booked, summary stored).
- [x] **[dev]** **Transfers invisible in Calls tab** — DONE (see Back-to-Front section line 215 + Gap #1). `recordTransfer()` sets `outcome='transferred'`; `end_voice_session` RPC sets `status='transferred'` when outcome matches. UI badge wired.
- [x] **[dev]** **`GET /analytics/stats` missing** — DONE 2026-06-12 (Gap #2). Route at `src/routes/analytics.ts:24`; dashboard panels fully wired. See active build queue above.
- [x] **[dev] SMS delivery monitoring** — DONE 2026-06-12: Delivery status webhooks + `message_delivery_status` table + metrics for Telnyx (legacy provider path removed 2026-06). `POST /communications/telnyx/status` wired.
- [x] **[dev] `GET /communications/history` implemented** — DONE 2026-06-12 (`feat/communications-history`): real `communications_history` table, written on the Email/SMS send-success path, tenant-scoped paginated query. No live UI consumer yet (backend-only).
- [x] **[dev]** **Stripe tax code wired** — `automatic_tax: { enabled: true }` added to checkout session in `billing.ts`, gated on `STRIPE_AUTO_TAX=true` env var. Set that on Railway after: (1) enable Stripe Tax in Stripe dashboard, (2) register nexus for IL + customer states. See Phase 13 user-action item.

### `[dev]` — test/build infra (surfaced by `simulate tools` 2026-06-12)

- [x] **[dev] — HIGH** **`supabase/baseline.sql` stale → drift guard** — DONE 2026-06-12. Baseline was missing `is_demo`/`demo_expires_at`/`tts_*`/`forward_phone`, so every `db:rebuild` + Playwright `globalSetup` DB lacked columns (`/demo/start` 500'd). Fix: proved the migration chain replays clean on empty (131 applied), regenerated `baseline.sql` via `pg_dump --schema-only` from the chain-built DB (now all 8 columns), and verified a full baseline rebuild → `simulate tools` journey passes. Added a **self-maintaining drift guard** (`checkMigrationColumnsInBaseline` in `scripts/verify-schema-alignment.ts` + 3 tests): scans every `ADD COLUMN` across migrations (minus dropped/renamed) and fails if any is absent from baseline — so this can't silently recur. Found by `scripts/simulate.sh tools`.

### Tooling — system simulation harness (built 2026-06-12)

`scripts/simulate.sh` now provides on-demand verification at any time:

- `status [--deep]` — health board (backend `/health`+`/ready`, dashboard, agent worker via LiveKit dispatch). **Verified prod 4/4 up incl. agent worker.**
- `tools` — realistic agent-tools journey (demo tenant → catalog → book → preference → recall) that PASSES wired links and flags `[dev]` gaps. **Verified local: 9 links pass, 4 gaps mapped.**
- `call` — dispatch agent + browser join URL (real voice, no phone).
- [x] Replace the dead `qa-live-test.py` references — DONE 2026-06-17: updated DEVELOPMENT_WORKFLOW.md, TEST_COVERAGE.md, ARCHITECTURE.md to reference `simulate.sh tools`.
- [x] Add `simulate tools` (or an E2E equivalent) to CI — DONE: `ci.yml:269` runs `./scripts/simulate.sh tools --env local` as a hard gate in the E2E job (non-zero exit fails). (Canonical entry in the P2 master list above.)
- [x] **Test RAG accuracy — DONE 2026-06-12.** `scripts/sim-rag.mjs` + `./scripts/simulate.sh rag` — seeds a known KB into a demo tenant (real embeddings via `/knowledge/add`), asks paraphrased caller questions through `/agent-tools/policy-answer`, grades retrieval (expected content present, + out-of-scope must fall back not hallucinate), reports a hit-rate and exits non-zero below 80%. On-demand quality tool (real OpenAI → not a CI gate; non-deterministic + costs). Run-verified: **9/9 (100%)** after query expansion fix. **Gates the website-scan onboarding idea** (`docs/STRATEGY.md`).
  - [x] **Finding from the eval — FIXED 2026-06-12.** _"what's your address"_ fell back instead of retrieving the location doc — `address`↔`located` shares no vocabulary and scored 0.31 below threshold. Root cause: reductive `normalizeForEmbedding` applied to _query_ collapsed terse inputs below out-of-scope floor. Fix: new `shared/expandQueryForEmbedding.ts` (additive synonym expansion, inverse of normalize) on policy-answer path only + threshold 0.5→0.30. Docs/ingest untouched (no re-embed needed). See `shared/expandQueryForEmbedding.ts` + `src/queryExpander.test.ts`. Now ready for website-scan reliance.

### Reassuring — audited and found FULLY wired (no action)

CRM sync status fields · reminder-outcome metrics · SMS rate-limiting · retry policy · calendar-sync orchestration · all 4 CRM client API/OAuth/webhook code · Telnyx agent OTP path · LiveKit/Deepgram/OpenAI (TTS fully OpenAI post-2026-06-25 Grok removal) voice stack. None are scaffold — all real code.

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
- [ ] **IN FLIGHT (user)** Legal docs — use Bonterms (bonterms.com) for SaaS Terms of Service, Privacy Policy, and Data Processing Agreement (free, open source, lawyer-drafted). Add to site before first paying customer. Separately: add TCPA-compliant SMS opt-in consent language at booking time — required before sending any confirmation texts.
- [ ] **FUTURE (user)** Get E&O (Errors & Omissions) insurance before first paying customer. Quote via Next Insurance or Hiscox (~$800–1,200/yr for solo SaaS). Covers:
  - Customer claims Secretary HQ missed a booking or double-booked and they lost business
  - Customer claims the AI gave wrong information (pricing, hours, services) during a call
  - Legal defense costs even if the claim is frivolous
- [ ] **FUTURE (user)** Get Cyber Liability insurance before first paying customer. Often bundled with E&O. Covers:
  - Data breach notification costs (state laws require notifying affected customers — can be expensive)
  - Legal fees if a customer sues over their data being exposed
  - Regulatory fines if the FTC or a state AG investigates
  - You hold phone numbers, call recordings, names, and appointment history — this is real exposure
- [~] **Telnyx provisioning — DONE 2026-06-02.** Account for Thinking Hammer LLC funded ($10) + upgraded (trial 1-order cap lifted). SIP Connection `livekit-outbound` (`2945038451784812111`) → FQDN `ai-secretary-nmlkkmgf.sip.livekit.cloud:5060`. `TELNYX_API_KEY` + `TELNYX_SIP_CONNECTION_ID` set (local `.env`; verify on Railway `ai-sec`). Number **`+1 630-866-1960`** purchased (id `2973794140900296302`), routed to `livekit-outbound`, connection activated. Old `+1-630-937-9478` is dead (order deleted). **2026-06-04 UPDATE:** LiveKit creds work (not dead); inbound trunk `ST_aUM3GuCuc9wL` already points at the numbers (normalized to +E.164). `+16308661960` is a dead recycled DID — **new test number `+1 630-822-9086` (id `2975078589701031880`) bought + fully wired.** Config verified clean end-to-end; remaining blocker is PSTN carrier propagation, not config. **NEXT:** different-carrier call to `+16308229086` while watching LiveKit `listRooms()`. See `docs/TICKET_SUPPORT.md` (the 2026-06-04 provisioning audit detail was folded in there; the standalone `PROVISIONING_AUDIT.md` was removed).
  **2026-06-30 UPDATE:** Live number `+1 630-822-9086` — the real owned + routed DID (dial for the PSTN test). The long-documented `+1 630-866-9086` was a transcription error: never owned (routes to another business). `+1 630-866-1960` dead. Landing pages, dashboard constants, tests, and docs all corrected to 822-9086.
- [ ] **IN FLIGHT (user)** Set `DASHBOARD_URL=https://dashboard-production-cee3.up.railway.app` on Railway `ai-sec` service
- ❌ **DROPPED 2026-07-02** `SENTRY_DSN` — paid vendor declined (prod emits `/metrics`+logs+`/ready` free). See "Prod config / observability".
- [ ] **IN FLIGHT (user)** Stripe setup — set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_PRO_PRICE_ID` on Railway. Register webhook at `https://ai-sec-production.up.railway.app/billing/webhook` (3 events). See `docs/DEPLOYMENT.md` for full env-var list.
- [ ] **IN FLIGHT (user)** Stripe Tax — code done (`automatic_tax` gated behind `STRIPE_AUTO_TAX=true`, shipped `8fed5da`). User actions remaining: (1) enable Stripe Tax in Stripe dashboard, (2) register tax nexus for IL + customer states, (3) set `STRIPE_AUTO_TAX=true` on Railway.
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

- [x] **`METRICS_TOKEN` on Railway backend — DONE** (confirmed set 2026-06-29: prod `/metrics` returns 401 not 404, i.e. the token gate is active). The metric data is exposed; standing up a scraper over it is optional (free path) per the observability decision above.
- ❌ **DROPPED 2026-07-02** `BETTER_STACK_TOKEN` — paid vendor declined (logs already reach Railway live-tail free). See "Prod config / observability".
- [ ] **IN FLIGHT (user)** (Optional) Repoint Railway healthcheck → `/ready` if you want deploy promotion gated on DB reachability (note: Railway healthcheck gates promotion, not per-request traffic).
- [ ] **Alert rules (optional, free)** — not dropped; rules stay ready in `docs/ALERTS.md`; wire them (on `rate(errors_total[5m])`, `booking_attempts_total{outcome="failure"}`, http 5xx rate, p95 `http_request_duration_ms`, sustained `/ready` `waiting>0`) if/when a paging path is stood up (Grafana Cloud free tier over the existing `/metrics`, or Railway-native).

**Open — LOAD TESTING (deferred — not a current concern, Dale 2026-05-21):**

- [x] **Load-test the booking path** — DONE 2026-06-19 (`feat/booking-load-probe`). Built `scripts/sim-load.mjs` (localhost-guarded — refuses any non-localhost backend without `--force` so a decrypted prod URL can't be blasted): provisions/uses a tenant, fires ramping concurrency (5/10/20/40) at `/agent-tools/book-with-scheduling`, buckets outcomes (success/conflict/pool-or-5xx/other/net) with p50/p95/p99 + throughput. **Finding (reframed per the architecture):** the deliverable is the failure MODE, not an absolute ceiling — a local dev-box + docker-Postgres number doesn't transfer to Railway. At 4× pool concurrency (40 vs `max=10`) the path **fails fast and cleanly** — flat p99 (~30–60ms locally), **zero pool-checkout-timeout / 5xx / dropped-connection errors**; contention is handled gracefully, validating the `connectionTimeoutMillis=5000` fail-fast design. **Context:** the agent runs ONE LiveKit worker per tenant, so concurrent bookings are bounded by simultaneous calls across DISTINCT tenants — a handful at beta scale — so `pool=10` is near-certainly fine for real load today; revisit pool/LiveKit sizing only when multi-tenant concurrency grows. Run: `SIM_AGENT_SECRET=… node scripts/sim-load.mjs` (optional `SIM_TENANT=…`).
- [x] **Pool-exhaustion integration test** — DONE 2026-06-07 (`src/poolExhaustion.test.ts`). Real `Pool({max:1, connectionTimeoutMillis:500})`, holds the only client, hits a `withHandler`+`withPoolClient` route → checkout rejects at ~504ms (bounded, not a hang) → 500 + `errors_total{unhandled_route_error}` ticks via `withHandler`→`logError`. Control tests (free slot → 200; release → 200 again) prevent false-pass and prove recovery. Closes the gap left by the synthetic `middleware.test.ts` version.

**Gap 2 — CI / deploy gate (prioritized; agent job already DONE above):**

- [ ] **P0 — Gate Railway deploy on CI green.** GitHub branch protection applied 2026-06-15 (exact 4 jobs from ci.yml + enforce admins + required PR + strict checks + conversation resolution). This blocks merges to `main` (and thus deploys) on red CI. **Still needed**: Enable "Wait for CI" toggle on the 3 Railway services (see the Production Wiring Checklist above). Update: use `npm run ci:status` / `./scripts/simulate.sh ci` before merging. Highest priority.
- [x] **P1 — Add E2E (Playwright) job to CI.** DONE 2026-05-28. `e2e` job added to `.github/workflows/ci.yml`: pgvector service, migrations + seed, backend build + start, dashboard build + start, `wait-on`, Playwright chromium install + test run, artifact upload on failure. **Needs first-run green in Actions before marking required.** The runtime security proof (anonymous-401, cross-tenant 403, `/ready`) runs only locally today. Concrete plan: new `e2e` job — `ankane/pgvector` service (mirror backend job) → `npm ci` (root + dashboard) → `npm run build` (backend) → start backend + dashboard → `npx playwright install --with-deps chromium` → `cd dashboard && npx playwright test`. **Needs first-run validation in Actions** (browser install + server startup are the usual flake sources) — don't mark required until one green run.
- [ ] **P2 — Repoint Railway `healthcheckPath` → `/ready`.** `railway.json` currently `/health` (shallow); `/ready` would gate deploy _promotion_ on DB reachability. Behavior change (could block promotion during a DB blip) — Dale's call.

**Gap 1 — agent resilience (1A done; remainder):**

- [x] **P2 — Wrap the agent `entry` tail in try/catch → `runFallback`.** DONE 2026-05-28. Added outer try/catch around ToolsClient + buildTools + fetchTenantConfig + buildSystemPrompt. Inner session.start catch retained; outer catch catches setup failures before session.start. Agent TS clean, 1397 tests passing.
- [x] **P3 — (B) idempotent-read retry** in `toolsClient` — DONE 2026-06-22: one retry on transient 5xx / network throw for READ tools only (never mutations: a timed-out booking may have succeeded server-side → double-book). Wired (`toolsClient.ts:50`, gated `isReadOnly ? 2 : 1`; 7 read-tool call sites) + 5 tests added to `toolsClient.test.ts` (incl. the mutation-no-retry double-book guardrail). See canonical item above.
- [x] **P3 — (C) latency filler** — DONE 2026-06-16. `buildTools` accepts optional `speakFiller` callback; wired into `get_available_slots`, `book_appointment`, `book_appointment_with_scheduling`, `answer_policy_question`. `index.ts` passes `session.say` (builds tools inside session try-block). Also fixed pre-existing TS error (`AgentHandoffItem` type narrowing in transcript handler).

**Gap 3 — follow-through (core fix done above):**

- [x] **P3 — Audit the ~12 `:id` routes** — DONE 2026-05-28. All 26 route files use `withHandler` (class-22 mapper fires automatically). One route (`jobber.ts:95`) bypasses `withHandler` but has its own manual UUID check. `requireValidUUID` is defined but unused — not needed since the mapper covers every route. No gaps found.

---

## Voice Validation (Telnyx done; now blocked on LiveKit trunk — see `docs/AIASSISTANT_GO_LIVE_TODO.md`)

- [x] Call transcript + summary flow end-to-end — DONE 2026-06-12 (TranscriptRecorder + callSummary.ts + callOutcome.ts, all wired into shutdown hook)
- [x] Expanded live QA suite — REPLACED by `./scripts/simulate.sh tools` (qa-live-test.py deleted)
- [x] Reminder delivery monitoring dashboard — DONE (`GET /reminders/delivery-stats` + ReminderDeliveryStats component in AnalyticsView)
- [x] Add coverage for OTP + booking error codes — covered by agent unit tests; qa-live-test.py path is gone

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
- [ ] **IN FLIGHT (validation — BLOCKED on a 2nd phone)** Different-carrier call to test number `+1 630-822-9086` → ask for a person → confirm the cell rings + Calls tab shows the transcript. Live is 9086. Dale has no spare phone right now; do later. Also validates the still-open PSTN inbound path + the agent (`ai-sec-agent`) deploy.
- [ ] **Housekeeping** Rotate the Railway team token created 2026-06-12 — it was pasted into a Claude session; burn + reissue.

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

- [x] **Implement `GET /analytics/stats`** — DONE 2026-06-12. Route live at `src/routes/analytics.ts`; dashboard panels fully wired with real `voice_sessions` data.
- [x] **Wire the 3 stubbed call-based panels** — DONE 2026-06-12. Call Volume / Booking Conversion / Caller Abandonment all pull from real `voice_sessions`; "Why Callers Reached Out" breakdown wired via `callClassify.ts`.
- [decided: leave to ops dashboards] **(Optional) Owner-facing reliability tiles** — `booking_attempts_total`, `tool_calls_total` (`src/services/metrics.ts:284,291`) are Prometheus-only (`/metrics`, token-gated). **Decision 2026-06-19: NOT building a bespoke in-app view.** These counters are labeled `{outcome,source}` / `{tool,outcome}` — **no tenant label** — so an _owner-facing per-tenant_ tile is impossible without new per-tenant tracking; any view would be platform-wide and would duplicate what `/metrics` + Grafana already serve. Per build principles (no speculative/duplicative surfaces; observability tokens aren't even set in prod yet) the right home is an ops dashboard. Owners already get the per-tenant booking-conversion view in `AnalyticsView` (from `voice_sessions`). Revisit only if a customer asks for an in-app reliability tile, at which point add a `tenant` label to the counters first. (Reopen if you want the super-admin platform view built anyway.)

### Reminder delivery monitoring (Phase 5 — never built)

- [x] **Reminder delivery dashboard** — landing via PR #50 (`feat/reminder-delivery-stats`, cherry-picked from the never-merged `feat/transfers-invisible-calls`); mark fully done once #50 merges. `GET /reminders/delivery-stats` (tenant-isolated `reminder_schedules` aggregates: sent total/7d/30d, failed total/7d, scheduled, cancelled) + `ReminderDeliveryStats` cards wired into `AnalyticsView`. + route unit test (happy + empty/zeros, asserts tenant-scoped query). NOTE: the prior "[x] DONE" claims here and at the top of this file were premature — the code lived only on an unmerged branch and was absent from main until this cherry-pick (a baseline-drift-class bookkeeping gap). Now actually in main.

### CRM sync status (`CRMIntegrationCard.tsx`)

- [x] **Surface pending/error sync counts** — Extended `CRMIntegrationCard` (and square provider config) to fetch + display `pending_count` / `error_count` / `total_mapped` from the existing `/.../sync/status` endpoints below the last-sync line. See list work on backfill branch. Prometheus metrics remain for ops.

### Onboarding / Website knowledge import (new step for reduced manual entry)

Backend fetch+LLM extract core now wired (`/knowledge/import-website` + helpers + `knowledge_suggestion` staging + migration). Designed as optional early step in SetupWizard flow (paste URL after business type → suggestions prefill questionnaire). Full details and remaining dashboard/review/ingest wiring in the spec and worktree.

- [x] **Dedicated "Import from website" step in the SetupWizard (right before the questions/policy step).** Inserted as step 7 ("Import from website") after the review step (6), immediately before the "Teach Your AI" questions step (now 8). New component `Step7WebsiteScan.tsx` with URL input + scan button that runs the backend extract and saves matching starter answers via knowledge.add. The questions step now loads pre-existing answers (by matching question text in the tenant_docs) on mount and prefills + marks saved, so the scan directly helps answer the questions in the following step. Wizard updated (type to 9 steps, labels, arrays, "of 9", next button text, expand timing, comments). User-facing explanatory copy added to scan page per spec: "when questions are asked of your AI Assistant, the information from your company comes from here. Our system will scan your website... The following page is to answer any...". Also cleaned duplicate import box from questions step in main wizard (kept for Solo via prop). See the implementation in `Step7WebsiteScan.tsx`, updates to `Step7CallerQuestions.tsx` (load prefill + conditional import box), `index.tsx`, `WizardStepContent.tsx`, `types.ts`. Advanced per-question suggestion review UI with badges still pending (see other sub-items).
- [x] **Wire question bank resolver into import + wizard.** DONE 2026-06-19 (`feat/question-bank-shared`). Moved the question bank to `shared/questionBank.ts` (single cross-runtime source) — killed the brittle backend→dashboard runtime import (`import('../../dashboard/lib/policyQuestions.js')`); `dashboard/lib/policyQuestions.ts` is now a thin re-export so all wizard / `KnowledgeBaseView` imports are unchanged. Added `resolveQuestions({ customs })` = static bank + tenant custom questions (`tenant_docs` source='custom-question'), deduped by normalized text. `import-website` now resolves via this (direct in-process resolve). **Deliberately NOT built** (build-principle / no dormant abstraction): `GET /knowledge/questions` endpoint (no HTTP consumer — backend resolves in-process, dashboard imports shared directly), `business_type` filtering (all 9 categories are universal across verticals), and a `question_bank` DB table. Unit + handler regression tests guard the silent-`[]` path.
- [~] **E2E + simulate coverage for the step.** PARTIAL 2026-06-19 (`feat/question-bank-shared`). Added to `dashboard/e2e/knowledge-base.spec.ts`: tests 11-13 (suggestion review lifecycle — seed `knowledge_suggestion` → GET queue → PATCH confirmed ingests into live KB source=`website-scan` + status flips / PATCH rejected discards / cross-tenant approve → 404) and test 14 (`kb-import-website-stub`) which drives the REAL import-website handler — `resolveQuestions` (static bank + tenant custom questions) → real staging INSERT — with deterministic canned extraction via `KNOWLEDGE_IMPORT_E2E_STUB=1` (set on the e2e backend in `ci.yml`; CI's OPENAI key is `sk-dummy` so a real scan can't run there). Asserts the owner's custom question reaches the DB. Plus backend handler unit test (`src/routes/knowledge.importWebsite.test.ts`, mocked fetch). Run-verified 15/15 green against a migration-chain DB. **Real OpenAI scan path: live-smoke verified 2026-06-19** — real `POST /knowledge/import-website` against a local fixture site (`Joe's Auto Shop`) extracted 8 answers → 8 confirmed staged rows (real fetch + real GPT-4o-mini + real DB); not automated (cost/flake/network). **Still TODO (deferred):** wizard UI click-path E2E (paste URL → suggestions render → approve in the React UI). Deferred 2026-06-19 after a feasibility probe: the Suggestions surface sits under `AIInsightsView`'s `activeSubTab` (internal React state, NOT URL-routable — only `KnowledgeBaseView`'s inner `?tab=suggestions` is), and no existing e2e asserts KB UI _content_ as the super-admin storageState user (active-tenant selection is the blocker). Forcing one risks a flaky test; the approve logic is already covered at the component-unit (`KnowledgeSuggestions.test.tsx`) + API-E2E (tests 11-14) layers. Also `simulate.sh tools` import coverage (OpenAI-dependent — on-demand, like `simulate rag`). Gate on the RAG accuracy eval.
- [x] **Docs / UX polish.** DONE 2026-06-19 (`feat/knowledge-import-polish`). (1) **Docs**: `docs/BETA_ONBOARDING.md` now documents the optional "Import from website" wizard step + the scan/review flow + "from your website" provenance (wizard section + Knowledge base section). (`aiassistant-knowledge-base.md` is tenant content, not onboarding — left alone.) (2) **Empty-vs-unanswered**: `KnowledgeBaseView` PolicyQuestionRow now shows a persistent green "Answered" marker for answers loaded from the DB (previously only current-session saves showed a marker, so a prior-session answer looked identical to a blank one). Per-category `answeredCount` badge already existed. (3) **Cost guardrails**: added `fetchWithTimeout` (AbortController) to the scan path — 8s per site page + 30s on the OpenAI extract — matching the codebase's OpenAI-timeout discipline; combined with existing bounds (maxPages 6, 8KB/page, 12KB prompt, max_tokens 3000, customs LIMIT 50) the endpoint can't hang a request/pool slot. Per-tenant scan rate-limit deferred (no abuse evidence; YAGNI). Verified: tsc clean (backend+dashboard), KB e2e 15/15 green.
  - [x] **Per-row "from your website" provenance badge** — DONE 2026-06-19 (`feat/knowledge-import-low-items`). The wizard scan now saves matched answers with `source='website-scan'`; `KnowledgeBaseView` prefill accepts BOTH `policy-questionnaire` and `website-scan` (additive — scanned answers still pre-fill), carries `source` through the saved-answers map, and renders a distinct "From your website" marker (vs "Answered") on scan-sourced rows; scanned answers are excluded from the uploaded-files list + labeled "From website" in Review Everything. Editing a scanned answer drops the badge (server resets source on update — once edited it's owner-authored). The wizard's own questions-step prefill is title-based (not source-keyed) so onboarding is unaffected. **Regression guard:** new `KnowledgeBaseView.test.tsx` asserts both sources pre-fill + the two markers render. (Low-risk path chosen after confirming `tenant_docs` has no metadata column — `source` change was the only option short of a migration.)

- [x] **RAG: "address" queries don't retrieve the address doc — FIXED 2026-06-29 (`fix/rag-address-vocab`).** Both the durable doc-side fix and the query-side palliative shipped (owner chose "both"). Original diagnosis (2026-06-23, real `text-embedding-3-small` cosines): every other positive scored 0.59–0.63; both address phrasings scored an outlier-low **0.302**; out-of-scope negatives ≤0.20. At the strict `> 0.30` threshold the address case cleared by only 0.002 → run-to-run embedding variance flipped hit/miss (nondeterministic at the boundary). Two root causes, both now addressed:
  - **(1) Doc-side — the real fix.** The ingest normalizer was reducing the Q/A pair to a declarative `"Located at 123 Main Street downtown."`, **dropping the question form** `"Where are you located?"` — exactly the retrieval signal a caller asking "what's your address" needs. `prepareQADocument` (`src/services/knowledgeIngestion.ts`) now **prepends the raw question** to the normalized body before embedding, so the interrogative form always survives. NEW ingests benefit immediately; existing docs are backfilled by `scripts/reembed-qa-docs.mjs` (re-runs the same `prepareQADocument` over `tenant_docs` Q/A rows — pure data backfill, no schema change). **Manual prod step:** `npm run build && DATABASE_URL=… OPENAI_API_KEY=… node scripts/reembed-qa-docs.mjs --yes` (preview with `--dry-run`, scope with `--tenant <uuid>`).
  - **(2) Query-side palliative.** `shared/expandQueryForEmbedding.ts` prompt now instructs the expander to emit **morphological / doc word-forms** (address→`located locate location where situated directions`), not just abstract synonyms — so it matches the doc's actual word "located" instead of "location".
  - **Threshold untouched (0.30).** The "do NOT just lower the global threshold" guidance still holds — the fix raises the address vector above the cutoff rather than widening it, so the safe fall-back for genuinely-unknown topics is preserved.
  - **Measured (real `text-embedding-3-small`, direct cosine probe over a 5-doc KB incl. deliberate near-neighbors):** address now scores **0.394** (was 0.302) — clears the strict `>0.30` cutoff by **~0.09** (vs 0.002 before, which is what made it flaky); nearest other real topic 0.255, true out-of-scope ≤0.19. **Not** the ~0.6 of lexically-overlapping positives — address↔located is a genuine semantic gap; 0.394 with ~0.09 headroom is enough to kill the boundary nondeterminism, not more. **False-positive check** (the dangerous direction, since both doc-prepend and a more aggressive expander widen the surface): "how much to color my hair" correctly ranks coloring (0.609) above haircut (0.382) — right doc wins by 0.23; out-of-scope "hamburgers" peaks at 0.191, all below 0.30 → still falls back. No new confident-wrong-answer surface observed on this corpus (still worth a re-check against a real dense tenant KB).
  - **Verified:** `./scripts/simulate.sh rag --env local` (real OpenAI embeddings) PASS **9/9 (100%)** across **3 consecutive runs**, both address phrasings HIT every time, all out-of-scope falls back. `scripts/reembed-qa-docs.mjs` run-verified (`--dry-run` + a real `--yes` pass: 15/15 processed, 0 failed). Unit: `src/services/knowledgeIngestion.test.ts` (regression test asserting the question survives) + `src/queryExpander.test.ts` green.

See also the RAG accuracy eval and question bank migration (20260609... in feature worktree).

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

Source: Raw UX audit performed 2026-05-19 (previously in `ux-review-notes.md`, removed 2026-06-30). High/medium findings triaged below. No separate source-of-truth file is maintained for the raw notes.

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

Small mechanical hygiene pass completed: cleaned up remaining references to the now-historical NEEDS-REFACTORING.md in source comments (updated to point to RESOLVED.md for accuracy).

Most of the 2026-05-17 lint adoption already promoted to `error`. Still at `warn`:

- [x] `@typescript-eslint/no-explicit-any` + `no-unsafe-*` family — DONE 2026-05-28. Fixed all 13 files / 59 warnings: typed `response.json()` casts in `api.ts`, `hooks.ts`, `LoginView`, `register`, `forgot-password`, `reset-password`; cast `JSON.parse` returns in `NewSchedulerView`; eslint-disable for `react-big-calendar` third-party `any` (unfixable at source); removed unused `Wrench`/`QuickAction`/`Save`/`rate` symbols; fixed unescaped entities in `Step7CallerQuestions`. Dashboard lint: **0 warnings, 0 errors**.
- [x] `@typescript-eslint/no-misused-promises` — DONE 2026-05-28. Zero violations across all 3 packages; promoted to `error` in all three eslint configs.
- [x] `@typescript-eslint/await-thenable` — DONE 2026-05-28. Zero violations; promoted to `error` in all three eslint configs.
- [x] `@typescript-eslint/unbound-method` — DONE 2026-06-22. Zero violations across all 3 packages; promoted to `error` in all three eslint configs (matches the no-misused-promises / await-thenable pattern above). Stray pre-existing `no-unnecessary-type-assertion` error in `agent/src/tools.test.ts` fixed in the same PR.

Closed: `consistent-type-imports`, `no-unused-vars`, `no-floating-promises`, `require-await`, `restrict-template-expressions`, `no-unnecessary-type-assertion`, `no-base-to-string`, `ban-types`, `prefer-promise-reject-errors` (all promoted to error 2026-05-17/18); Prettier format sweep across all three projects (`79b227c`).

## Documentation

- [ ] Continue mechanical doc hygiene passes (count drift, old REFACTORING_TODO/NEEDS references in comments, Gap inventory table sync when filenames change, footer "Last updated" alignment).
- [ ] Review and trim any remaining historical narrative in active docs that can be archived to RESOLVED.md.
- [ ] Ensure all secondary docs (GAPS.md, IMPROVEMENT_IDEAS.md, DEPLOYMENT.md, etc.) reflect current 29 route modules / 154 migrations after any new route or migration.
- [ ] Keep the Gap inventory "Key files per gap" table in sync with actual filenames (e.g. exportData.ts not export.ts).

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

## Gap inventory — folded from `TODO_GAPS.md` (2026-06-19)

`TODO_GAPS.md` was a derived checklist of `GAPS.md`; it was deleted 2026-06-19 and all its
still-open items were consolidated into the **Open Work — Master Backlog** at the top of
this file (status reconciled to its 2026-06-18 prod audit). `GAPS.md` remains the
category-completeness inventory. Below is the key-files map kept for reference.

### Key files per gap

| Gap                     | Primary files                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-service reschedule | `src/routes/selfService.ts`, `smsService.ts`, `appointmentService.ts`, `emailTemplates.ts`                                                                                            |
| AI cost meter           | `agent/src/toolsClient.ts`, `callSummary.ts`, `src/services/knowledgeIngestion.ts`, `src/routes/knowledge.ts` (Grok TTS path removed 2026-06-25; historical rows may reference 'xai') |
| Calendar sync live      | `src/services/calendar/googleCalendar.ts`, `calendarSync.ts`, Railway env                                                                                                             |
| Data export / GDPR      | `src/routes/exportData.ts` (owner-gated tenant data export) + audit log for purge                                                                                                     |

---

**Archived detailed history**: previous session notes and long-form status are consolidated in `docs/RESOLVED.md` (the standalone `CURRENT_STATUS_ARCHIVED_2026-05-15.md` was removed).

---

## Verification blind spots — folded from `TODO_BLINDSPOT.md` (2026-07-02)

`TODO_BLINDSPOT.md` (created 2026-07-01) tracked the *verification* holes — the "green CI but broken in prod" seams. It was folded into this file 2026-07-02 to keep one backlog; the standalone file was deleted. `GAPS.md` remains the separate category-completeness inventory.

**Why this exists:** four bugs shipped to prod through a green CI suite, each found only by Dale dialing in: (1) `serviceResolver` ambiguous `name` → `available-slots` 500 (SQL never ran in tests — mock pg client); (2) timezone: a 3:30 PM request booked at 10:30 AM (no agent→route→RPC→DB clock test); (3) tool-selection: `available_slots → book_appointment` dead-ended on a missing `resource_id`; (4) booking landed Unassigned + at the wrong time (no end-to-end assertion of the stored row).

### P0 — Stop the "green but broken" cycle (testing) — ALL DONE

- [x] **End-to-end booking integration test in CI** — DONE 2026-07-01 (`src/agentToolsBookingIntegration.test.ts`): real route → `book_with_scheduling_atomic` → real Postgres; asserts stored UTC instant, assigned employee, `status='scheduled'`, local read-back, EMPLOYEE_NOT_SCHEDULED + TIMESLOT_OCCUPIED sad paths, + the serviceResolver ambiguous-`name` regression. Mutation-verified. Runs in CI.
- [x] **Agent tool-selection eval** — DONE 2026-07-01 (`agent/scripts/sim-toolselect.ts`, `./scripts/simulate.sh toolselect`): replays the REAL prompt + 20 tool schemas through gpt-4o-mini, grades the chosen tool sequence. 6 cases incl. bug-#3 regression. On-demand (OpenAI-gated), not CI. Baseline 6/6.
- [x] **Audit every DB-mocking `*.test.ts`** — DONE 2026-07-01: full audit in `docs/TEST_DB_AUDIT.md`. All HIGH-risk gaps got real-DB companions (surfaced 3 real issues). MED round-2 companions added 2026-07-02; advisor verdict: MED vein exhausted.
- [x] **Multi-employee / multi-service scheduling coverage** — DONE 2026-07-02 (`src/multiEmployeeScheduling.realdb.test.ts`, 7 tests): skill matching, employee spillover, shift-aware assignment, capability-gated resource exhaustion, first true PARALLEL GiST double-book race. Runs in CI.

### P0 — Observability — paid vendors DROPPED (decision 2026-07-02)

- ❌ **`SENTRY_DSN` / `BETTER_STACK_TOKEN` — DROPPED.** Decided against paid observability vendors at this stage. Prod already emits `/metrics` (Prometheus-style, `METRICS_TOKEN`-gated), structured Pino logs (Railway live-tail), and `/ready` (deep DB/pool readiness) — all free. Only revisit via a **free path** (e.g. Grafana Cloud free tier scraping `/metrics`) if the need ever names itself.
- [ ] **Alerting** (optional, free) — `docs/ALERTS.md` rules aren't wired; could be driven off the free `/metrics` + `/ready` signals without a paid vendor. Low priority.
- [x] **Agent logs tool-call ARGS** (PII-redacted) — DONE 2026-07-02 (`agent/src/redactToolArgs.ts` + 13 tests). `function_tools_executed` carries `tool_calls:[{name,args,is_error}]`; phone/code keys digit-masked, time strings + names preserved.

### P1 — Booking correctness (agent-behavior; need agent/LLM work + live calls — not clean-autonomous)

- [ ] **Books 30 min early** — a 4:30 request stored 4:00. Fix: agent sends a TIGHT window = exactly the picked slot.
- [ ] **Agent confirms the REQUESTED time, not the actual `booked_start`** — it said "4:30" while booking 4:00. Confirm back the real booked slot.
- [ ] **Offers alternatives when the caller named a specific time** — verify + confirm THAT; only offer options if it's taken.
- [x] **`book_appointment` / `check_availability` resource_id trap** — **FIXED 2026-07-03 (branch `fix/booking-tool-resource-id-trap`).** Both require a `resource_id` that only `get_scheduling_options` returns; `get_available_slots` yields spoken times with NO resource_id, so the LLM would dead-end here (prod bug #3). Made misuse fail loudly instead of removing the valid path: (1) sharpened the three tool descriptions (`get_available_slots` now states it returns no bookable resource_id → use `book_with_scheduling`; `book_appointment`/`check_availability` state the resource_id must come from `get_scheduling_options`, else use `book_with_scheduling`); (2) added a runtime guard — an empty/blank `resource_id` short-circuits to a `RESOURCE_ID_REQUIRED` redirect toward `book_with_scheduling` **without hitting the backend** (which would 400 on the non-UUID anyway). 3 new unit tests in `agent/src/tools.test.ts` (guard fires + no backend call, for both tools; plus a check_availability happy path); 42/42 green, agent tsc clean. The `toolselect` eval already pins the bug-#3 sequence (`get_available_slots → book_with_scheduling`, never `book_appointment`) — run `./scripts/simulate.sh toolselect` (OpenAI-gated, on-demand) to confirm the sharpened descriptions hold.

### P1 — Voice paths never validated live · go-live blockers → see `docs/AIASSISTANT_GO_LIVE_TODO.md` (single source)

- [ ] **Real PSTN inbound** — CONFIRMED 2026-06-30 for a plain call; a live *booking* call still needed to confirm the employee-skills fix end-to-end.
- [ ] **Transfer to a human (REFER)** — not enabled on the Telnyx SIP connection, never tested.
- [ ] **Cancel / reschedule by voice** — untested live.
- [ ] **Blocked caller-ID / OTP verification** flow — untested live.

### P1 — Features that have NEVER run in prod

- [ ] **Stripe billing** — built, never live-tested. Cannot take money yet.
- [ ] **Calendar sync (Google / Outlook)** — no proven real round-trip.
- [ ] **Reminders delivery in prod** — unverified (needs Telnyx creds confirmed on Railway).
- [ ] **SMS + TCPA consent language** — not validated; legal exposure before any confirmation texts.

### P2 — Data integrity / hygiene

- [ ] **Duplicate `Dale DeMott` employee** in prod (one soft-deleted, one active) — clean up + add a guard.
- [~] **No cleanup pass** for soft-deleted employees/services lingering in mapping tables (`service_employee`). **INVESTIGATED 2026-07-03 → not a live problem; do NOT auto-clean.** Soft-deleting an employee/service leaves its `service_employee`/`service_resource` rows in place, but since PR #139 (migration `20260701000000`) the booking RPCs filter `is_deleted` employees out of every availability/overlap check, so a stale mapping can never surface a deleted employee/service in a booking — the rows are inert. Hard-deleting them on a *soft*-delete would also break restore symmetry (a restored employee would silently lose their skill/service mappings). Any future cleanup must be a scoped hard-delete-only pass (drop mappings only when the parent is HARD-deleted), not wired into the soft-delete path.
- [x] **`password_resets` RLS conflicts with the invite flow (latent, prod-safe today)** — **FIXED 2026-07-03 (branch `fix/password-resets-rls-invite`, option b).** `POST /users/invite` used to INSERT `password_resets` inside `withTenantClient` (tenant context set), tripping the `password_resets_unauthenticated_only` `WITH CHECK` → `42501` under a non-`BYPASSRLS` role (latent — prod's `postgres`/`rolbypassrls=true` bypassed it). Fix: the token INSERT now runs via `withPoolClient(pool, …)` with **no** tenant context — structurally identical to how the forgot/reset-password flow writes the table (`auth.ts`), honoring the policy's intent (only the unauthenticated flow writes `password_resets`). No migration; pure code. The real-DB suite's invite **HAPPY** path is now exercisable under the locked-down `api_user` (was previously un-testable) — `src/routes/users.realdb.test.ts` asserts both the `users` row and the `password_resets` token land; 7/7 green. Chose (b) over (a) a scoped policy because (a) would poke an authenticated-write hole in a table that has no tenant isolation to enforce (keyed by `user_id`), weakening the invariant.

### P2 — Process

- [ ] **A real QA loop that isn't "Dale dials in."** Define a pre-deploy voice smoke test (scripted sim-call asserting a booking lands) that runs before merge. (Related: the `simulate tools` agent-tools journey now runs in CI — a functional, non-voice guard.)
- [ ] **`simulate.sh call` echo caveat** — browser-sim turn-taking is unreliable (echo); require headphones or PSTN for interruption judgments.

**Bottom line:** the plumbing is largely correct; the remaining gap is **verification** — tool-selection evals (built), observability (paid vendors dropped; free `/metrics`+logs+`/ready` stand), and live-proofing of voice/billing/calendar/reminders.
