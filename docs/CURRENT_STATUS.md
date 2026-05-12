# SecretaryHQ — Current Status
**Last updated:** 2026-05-12 (PK naming convention conversion sprint **complete** — shipped pilots 1 through 16 in a single day. Tables renamed: `record_versions`, `tenant_skills`, `reminder_schedules`, `consent_records`, `opt_out_records`, `voice_sessions`, `tenant_docs`, `tenant_integration_settings`, `users`, `services`, `resources`, `employees`, `employee_schedule`, `appointments`, `customers`, `tenants`. 17 new migrations (20260512000000–16). Trigger rewrites: `auto_version_trigger` and `fn_audit_trigger` are now PK-aware via TG_TABLE_NAME CASE mapping; `create_default_resources` updated for `NEW.tenant_id`. Backend 1,781 / dashboard 620 / agent 85 all green. Migration count 90 → 107. Every domain entity table now satisfies the JOIN-symmetry promise of CODING_STANDARDS.md: `customers.customer_id = appointments.customer_id` etc. Only `tenant_calendar_settings` remains (decision-pending: it has a composite PK, no surrogate `id` to rename).)

---

## Where We Are

Phase 13 (Production Readiness) in progress. Backend live on Railway. Vapi → LiveKit migration complete (commit `661d21d`, 2026-04-27). Phone provisioned via Telnyx (`+1-630-937-9478`) but currently unreachable from PSTN — see `TICKET_SUPPORT.md` (Telnyx ticket re-submitted 2026-05-01 after the original #2850682 went 4 days without a human response). Voice AI is wired end-to-end and waiting on the carrier issue to validate live.

## What's in flight (between repo and prod)

Code shipped to `main` and merged on origin, but not yet exercised in production. Each item has an explicit reason it's still in flight rather than complete.

| Item | State | Why it's in flight | Action to close |
|---|---|---|---|
| **Telnyx PSTN reachability** | IN FLIGHT (external) | Re-submitted 2026-05-01 to LERG/porting team after the original ticket went 4 days without a human response. Zero inbound CDRs at Telnyx 2026-04-25 → 2026-05-03. | Telnyx reviewer responds; or fallback diagnostic = provision a second DID. |
| **`DASHBOARD_URL` env var** | IN FLIGHT (user) | Outstanding 6+ days. Stripe checkout + OAuth redirects depend on it. | User sets it on Railway → ai-sec service → Variables (~2 min). |
| **Voice fallback dead-air guard** | IN FLIGHT (validation pending) | Unit-level closed 2026-05-03 (commit `6488dc4`); 13 5W tests pin the contract. Live-PSTN exercise of the fallback message still blocked on the Telnyx unblock above. | Live call once Telnyx clears. |
| **Tenant-config display path** | IN FLIGHT (validation pending) | Code on main 2026-05-03 (commit `2119451`); 10 tests green. Live-PSTN exercise pending Telnyx. | Live call once Telnyx clears. |
| **Beta with DynaTire** | IN FLIGHT (external, transitive) | Blocked transitively on the Telnyx unblock. | Auto-unblocks when Telnyx clears. |
| **NEEDS-REFACTORING #14 (`pw.txt`)** | IN FLIGHT (decision pending) | Gitignored, never committed; could be a real password or a deliberate scratch note. | User confirms whether to keep or delete. |
| **Role gating + Logins UI browser-verify** | IN FLIGHT (validation pending) | Unit tests pin both contracts (4 layout + 2 auth backend + 13 user-route + 5 TeamAccessView). Real browser session has not exercised either yet. | `npm start` and walk the test plan in `docs/TODO.md` (Browser-verify entry). |
| **`hold-tenant-config` branch** | superseded, can be deleted | Original 2026-05-01 commit (`e92b3bf`) found unmerged 2026-05-03 during voice-fallback validation. Work redone on main 2026-05-03 as commit `2119451`; nothing on the branch is uniquely valuable now. | User can `git branch -D hold-tenant-config` and `git push origin --delete hold-tenant-config` whenever convenient. |

### May 11 (continued): Reminder-on-create wired + UUID schema bug fixed (backend 1,775 → 1,781, E2E 69 → 71)

Closes the TODO P2 "Reminder scheduled on appointment create" — no production caller had ever wired `scheduleAppointmentReminders` into the appointment-create route despite the service + worker + 24 unit tests + `reminder_schedules` migration all being in place. Picked under "wire + test" disposition (not delete) per the in-flight scope decision.

Surfaced a second schema-bug-hidden-by-mocks: the `ReminderSchedule` and `ReminderData` types in `src/types/index.ts:58-84` (and a duplicate in `src/services/reminders/types.ts`) declared `appointment_id: number` and `tenant_id: number`, but the DB migration (`20260409200000_reminder_and_consent_tables.sql:22-23`) declares both as `UUID NOT NULL REFERENCES …`. Three service files (`reminders/index.ts`, `reminderRepository.ts`, `reminderScheduler.ts`) carried seven `parseInt(uuid, 10)` calls that would have produced `NaN` and crashed every INSERT against real Postgres. The 24 pre-existing unit tests passed because `mockDb.createReminderSchedule` is mocked — exact match for the Build Principle "test it or delete it" failure mode, and the same shape as last week's tenant-FK-cascade find (mock proves the mock works, not the integration).

Fix shape:
- **Types**: `appointment_id` / `tenant_id` flipped from `number` → `string` in both `src/types/index.ts` and `src/services/reminders/types.ts`. `DatabaseService` interface signatures for `getReminderSchedulesByTenant` / `getReminderSchedulesByAppointment` (and the `PostgresDatabaseService` impl) updated correspondingly. The pre-existing 24 reminder unit tests pass unchanged — the integer IDs they pass in are now structurally wrong, but the mock layer doesn't enforce it.
- **`parseInt` strips**: 7 calls removed across `reminders/index.ts` (5), `reminderRepository.ts` (1), `reminderScheduler.ts` (1). The `.toString()` calls in `reminderProcessor.ts` are kept — they're no-ops on strings, harmless, removing them is unrequested cleanup.
- **New focused helper** `src/services/reminders/scheduleForAppointment.ts` (75 lines): takes `withTenantClient + tenantId + appointmentId + logger`, does the customer JOIN + 4 INSERTs in one tenant-scoped transaction. Fire-and-forget — all errors swallowed and logged. Skips silently on past/unparseable start_time or vanished appointment row. Why not reuse `ReminderService.scheduleAppointmentReminders`: that class pulls in `CommunicationService` + `ConsentService` + `TenantConfigService` just to write 4 rows; the heavyweight chain is for the send path, not the schedule path.
- **Wire** in `src/routes/appointments.ts`: 1-line call after `syncAppointmentToAll`, same fire-and-forget shape (logger-only error path; the booking already committed).

Tests added:
- 6 helper unit tests in `src/services/reminders/scheduleForAppointment.test.ts` (HAPPY: 4-row offsets + customer info; HAPPY: phone-only customer still writes 4 rows; SAD: past appointment → 0 rows; SAD: vanished appointment → 0 rows; SAD: unparseable start_time → 0 rows; SAD: DB error swallowed + logged, never bubbles).
- 2 assertions on `src/routes/appointments.test.ts` HAPPY (wire invoked with correct args) + SAD non-overlap rejection (wire NOT invoked when booking fails).
- 2 new E2E in `dashboard/e2e/reminder-on-create.spec.ts` (HAPPY: 4 rows produced for a future appointment with correct `scheduled_for` math, phone-only customer leaves email NULL; HAPPY: customer with both email + phone populates both columns).

After-state: backend 1,775 → 1,781, dashboard 620 (unchanged), agent 85 (unchanged), E2E 69 → 71 + 7 skipped. Zero TS errors across backend / dashboard / agent. Worker delivery (send path) deliberately out of scope — the ticket's "in dev, no-ops without crashing" parenthetical reflects that the worker has its own consent gate + provider fallback story that doesn't need separate E2E coverage at this layer.

### May 10-11: E2E coverage sprint — 5 P1/P2 items closed, 1 real data-integrity bug surfaced + fixed, 2 latent E2E flakes stabilized (backend 1,770 → 1,775, dashboard 617 → 620, E2E 55 → 69)

Seven commits across two days, all on `origin/main`:

- **`1fb8b11` feat(appointments): reactivate route + UI** — new `POST /appointments/:id/reactivate` (canceled → scheduled with 409 conflict block when slot was rebooked; 400 NOT_CANCELED guard); customer-history rows for canceled appointments are now clickable → ConfirmModal → API → toast (only UI surface for restoring canceled appointments). +5 backend + 3 dashboard + 3 E2E.

- **`492b4cf` test(e2e): real-time scheduler refresh** — pins that QuickBook submit → SchedulerView.handleQuickBooked → useSchedulerData.refresh → grid renders the new AppointmentBlock without a page reload. Captures appointment_id from the live POST response via waitForResponse. +1 E2E.

- **`04a96b4` fix(e2e): stabilize two latent flakes** — workflows smoke replaced seed-dependent customer-name assertion with unconditional scheduler-date-display check (weekend runs had no appointments rendering); quick-book-shift-overrides walked forward to next weekday + fixed broken relative `/shifts/overrides` URL (was hitting dashboard catch-all instead of backend) + skipped service selection (orthogonal to shift-coverage contract) + added try/finally cleanup (test had been "passing by failing" pre-fix).

- **`07103cc` test(e2e): mobile-responsiveness audit** — `mobile-responsive.spec.ts` emulates iPhone 14 (390×844) + Pixel 7 (412×915) viewports via page.setViewportSize, drives the three daily-use flows (today's schedule, Quick Book, customer lookup), asserts no horizontal page overflow + mobile-nav surfaces primary tabs. Audit found no regressions — OutlookLayout's `md:hidden` nav + Tailwind responsive classes work cleanly. +4 E2E.

- **`ae7dd12` feat(schema): tenant-delete cascade gap fix** — new `tenant-delete-cascade.spec.ts` (3 tests: full cascade, cross-tenant isolation, owner-403 authz) **surfaced a real schema bug** — `employees.tenant_id` and `services.tenant_id` were `NOT NULL UUID` but missing the `REFERENCES tenants(id) ON DELETE CASCADE` constraint despite the initial-schema migration declaring it. 77 orphan employee rows + 8 orphan service rows accumulated in local DB. Migration `20260511000000_employees_services_tenant_fk_cascade.sql` cleans orphans + adds the FKs. Pre-fix, tenant offboarding silently leaked employee + service rows — GDPR-grade promise we'd have been breaking at beta scale. **Production Supabase still needs this migration applied.** Migration count 89 → 90. +3 E2E.

- **`f43e535` test(e2e): version-history restore round-trip** — soft-delete a customer → filtered from `/customers` + appears in `/records/customers/deleted` → `/restore` → back in active list + gone from deleted list. Plus two sad-path guards: 404 RECORD_NOT_DELETED on never-deleted, 400 INVALID_TABLE on non-whitelisted table name (pins SQL-injection defense since the route inlines table name). Audit found no regressions — feature was already solid. +3 E2E.

- **`4d30eff` / interleaved docs commits** — TODO.md marks all 5 closed items with detailed notes; TEST_COVERAGE.md tracks the 14 new workflow rows across 4 new spec files.

After-state: backend 1,775/1,775 + dashboard 620/620 + agent 85/85 + 69/69 E2E (7 intentional skips). Zero TS errors. All gates green.

**Outstanding from this sprint:** apply migration `20260511000000` to production Supabase — every tenant offboarding between now and then will leak employee + service rows.

### May 6: multi-tenant isolation probe + cross-tenant leak fixes (backend 1,551 → 1,592)

Closes the pre-launch validation entry "Multi-tenant isolation verification in production-like environment." Verify-first approach: built a real-Fastify + real-Postgres + RLS-enforced probe (`src/multi-tenant-isolation.test.ts`, 25 tests) before assuming RLS plus the existing `rls.test.ts` were sufficient. Probe found two real findings, both closed in the same session.

**Finding 1 — application-layer cross-tenant override (read + write).** `tenantMiddleware`'s precedence (`query > body > JWT`) had no auth gate, so any authenticated user could pass `?tenant_id=<other>` and silently switch the request's RLS scope, OR POST `body.tenant_id=<other>` to insert rows under another tenant. 12 of the initial 21 probes failed — 8 read-leak shapes (customers/employees/services/resources/appointments/skills/knowledge/users) and 4 write-injection shapes (customers/employees/services/resources). The leak existed at the *application* layer; RLS itself was correctly enforcing whatever context the app set — the bug was that the app set the wrong context. Closed in `src/middleware.ts` `tenantMiddleware`: gate added that 403s any cross-tenant override unless the caller is super-admin; mismatched query-vs-body returns 400. The DB-level `rls.test.ts` did not catch this because RLS is the *floor*, not the gate — the gate is the middleware.

**Finding 2 — `/tenants/*` admin routes had no super-admin gate.** Every `/tenants/*` admin route used `requireAuth()` only, which checks "is authenticated" but not "is super-admin." Any tenant user with a valid JWT could `GET /tenants` (enumerate every customer's tenant + voice config), `DELETE /tenants/<other>` (destructive), `POST /tenants/reorder`, etc. Added `requireSuperAdmin()` helper to `src/middleware.ts` and applied to the destructive surface: `GET /tenants`, `DELETE /tenants/:id`, `POST /tenants/:id/update-attributes`, `POST /tenants/create`, `POST /tenants/reorder`, `POST /templates/create`. `GET /tenants/:id/config` + `POST /tenants/:id/update-config` get a "super-admin OR own-tenant" gate (tenant users legitimately read/edit their own config from the dashboard's BusinessSettingsView / AIConfigView).

**Fallout repaired:** `src/tenant-routes.test.ts` had its `authStub` shape using camelCase (`tenantId`) while the production JWT payload is snake_case (`tenant_id`). The new `requireSuperAdmin` exposed the mismatch by failing fast on undefined `req.auth.tenant_id` — fixed the stub shape to match the verified-JWT contract.

**Severity context:** pre-beta, no real customer data was at risk because DynaTire isn't live. But either finding alone would have been a critical breach in a paying-tenant SaaS once even one beta customer was on the platform; both closed before launch. The probe is now permanent regression coverage. After-state: backend 1,551 → 1,592 tests pass (+25 isolation probe + 10 new middleware unit tests pinning the gate behavior at the unit layer). Dashboard 514/514 still pass. Both `tsc --noEmit` clean.

**Out of scope this session (deliberate):** `/agent-tools/*` is exempt from `tenantMiddleware` (different threat model — shared-secret auth via `x-agent-secret` header, not JWT — anyone with `AGENT_SECRET` can act as any tenant by design, scoped by Railway env). `body.tenantId` (camelCase) and header-based tenant ingestion: audit found zero usages across the codebase. The inline cross-tenant check in `appointments.ts:182` (added before this session) is now redundant with the middleware gate but left as defense-in-depth.

### May 6: CI rot fixed — pgvector image, set-e blind spot, dashboard tsconfig

Discovered after pushing the security fix above: CI on main had been red since 2026-05-04 (every commit failed). Three independent root causes:

- **CI postgres image had no pgvector.** `.github/workflows/ci.yml` used `postgres:16` (vanilla), but the very first migration (`20260228000000_initial_schema.sql`) calls `CREATE EXTENSION vector` and the local Docker stack uses `ankane/pgvector` per CLAUDE.md. CI silently failed on the first migration. Switched the CI service image to `ankane/pgvector:v0.5.1` to match local.
- **`scripts/setup-db.sh` swallowed the actual error.** `OUTPUT=$(psql ... 2>&1); RC=$?` looks like it captures the exit code, but with `set -e` the script exits on `OUTPUT=...` failure *before* `RC=$?` runs — so the FAIL handler that prints the error never ran. Three days of red CI showed nothing but `exit 3` with no message. Wrapped the psql call with `set +e` / `set -e` so the FAIL block actually fires and prints the psql output.
- **`dashboard/tsconfig.json` had `"types": ["vitest", "jest"]` placed at the JSON root level instead of inside `compilerOptions`.** TypeScript silently ignores misplaced fields, so the directive was dead config. It worked locally because `tsc` auto-discovers everything in `node_modules/@types/*` and lifecycle-hook globals leaked in transitively. Fresh CI installs didn't get the same lucky tree, so `afterAll`/`afterEach` resolved as `Cannot find name`. Moved the directive into `compilerOptions` and switched to the proper values: `["vitest/globals", "@testing-library/jest-dom/vitest"]`.

**Verified against fresh `npm ci` install** to simulate CI: dashboard `tsc --noEmit` clean, 514/514 tests pass, lint clean. Backend 1,592/1,592 tests pass, build clean. Setup-db script tested locally — exits 1 with a visible psql error on a real failure (was silent exit-3 before).

### May 5 Afternoon: role gating + invite/role-management UI (backend 1,536 → 1,551, dashboard 504 → 513)

Closes the external-review beta-blocker "Hide Back Office surface from front-desk-only logins" and the natural extension "Owner-facing UI to invite + assign role." Three commits, both shipped same day.

- **`8683222` — Role gate.** Migration `20260505000000_user_roles.sql` adds `users.role TEXT DEFAULT 'owner' CHECK (role IN ('owner','front_desk'))`. Backend: `JwtPayload`, `AppRequest.auth`, `generateToken` carry the role; `/login` returns + signs it; `/auth/refresh` preserves it; unrecognized values coerce to `'owner'` (defense against future schema additions). Frontend: `SessionContext` exposes `role` (persisted to localStorage); `OutlookLayout` hides Back Office in desktop nav + mobile mode-toggle when `role === 'front_desk' && !isAdmin`; a useEffect snaps front-desk users back to `dashboard` if they land on `my-business` / `my-team` / `ai-insights` via a stale URL. Super-admins keep full access regardless of the column. **Tests:** +2 auth-handler (front_desk role round-trip; unknown-role coercion), +4 layout (owner sees both / front_desk hides both / URL redirect / super-admin override). Browser validation deliberately deferred and tracked.
- **`e65c833` — Invite + role-management UI.** New `/users` route module: `GET /users` (list with `is_self` flag so the UI can disable own-row dropdown), `POST /users/invite` (creates user with placeholder bcrypt hash + writes a `password_resets` token + sends `sendUserInviteEmail` with 3-day TTL — invitee chooses their own password from a magic link), `PATCH /users/:id/role`. All three are owner-only via a `requireOwner()` gate; super-admins always pass; front_desk callers get 403. The role-update route also rejects same-user role changes (a 400 + clear error) so an owner can't accidentally lock themselves out — the UI's own-row dropdown is also disabled as a UX guardrail. New `TeamAccessView.tsx` lists users with role badges + invite modal (radio role picker, default Front Desk). Wired into `MyTeamView` as a fifth sub-tab "Logins". **Tests:** +13 backend route (happy + sad for all three routes including the front_desk-403 gate, same-user-self-edit guard, super-admin self-edit carve-out, dup-email 409, invalid-role 400, missing-tenant 404), +5 dashboard component (list rendering with own-row "You" badge, empty-state copy, own-row dropdown disabled, invite-modal default role front_desk, end-to-end submit POSTs the right payload).
- **`d0277d9` — Validation entry consolidated in TODO.** Yesterday's role-gate browser-verify entry was extended to cover today's invite/role-management flow with explicit step-by-step plans for both halves and the relevant commit IDs for traceability. The completed invite-UI line was trimmed of its dangling "validation pending" note since the validation now lives in the proper unchecked entry above it.

**Out of scope this afternoon (deliberate):** browser-verification, prod migration apply, and any tightening of the existing email transporter (still no-op in dev/test). All three are in the IN FLIGHT table above.

### May 5 Morning: cleanup sweep (backend tests 1,514 → 1,536, dashboard 500 → 504)

Continuation of the verify-first pattern. Backend +22 tests, dashboard +4 (new vocabulary-guard regex patterns). Skip count: 0 (held). Dominant theme: drive down `any`-type debt across backend tests + extract two more shared helpers + ship a UX vocabulary pass + truth up TODO entries that had drifted from reality.

- **`9364773` — High-value 5W backfill.** Added WHO/WHAT/WHEN/WHERE/WHY annotations to 23 tests across security-critical (`rls`), schema/contract (`schema`, `customer`, `tenant-reorder`), and explicit regression suites (`critical-bugs` for BUG-001/002/006). Backend 5W coverage: 64 → 69/89 files (now 70/90 after `crmDisconnect.test.ts`). Remaining 23 backend test files without 5W tracked in TODO.md as a per-file pickup item — most are mechanical schema/utility tests where descriptive test names already serve as documentation.
- **`33f83cd` + `01b7009` — Backend test `any`-type cleanup, top-5 offenders.** Cleared 86 instances across reminders / consentService / communications / middleware / bugfix-comprehensive using `vi.mocked(...)`, `as unknown as Type` for partial-mock structural casts, and proper Fastify/Pool type imports. Net: 215 → 129 instances across backend tests (40% cleared); rest tracked in TODO.md.
- **`5f12215` + `2cd381a` — Destructive-flow test coverage.** Four flows pinned: tenant DELETE (3 tests, happy + 404 + 401), tenant POST /reorder (5 tests including the `sort_order = 0..N-1` invariant + ROLLBACK on partial UPDATE failure), shift override CRUD (9 tests across 3 routes — happy + Zod validation + 404), and AppointmentView mock-mode `handleUpdate` + `handleDelete` guards (2 tests pinning that no destructive fetch happens when `usingMockData=true`). Mock-mode `handleCreate` guard test deliberately deferred (driving the create form needs fixture work) and tracked.
- **`88701c0` — Verify-first deferral of NEEDS-REFACTORING #11's deferred part.** Reusable pieces (`useStaticData`, `useActiveTenantId`, `useVocabulary`, `AppointmentDetailContext`) were already extracted in earlier work; what remains is component-specific orchestration with one consumer each. Documented the lens reasoning in TODO.md.
- **`cbf22b0` — Dashboard test `any`-type cleanup.** ~27 instances → 0 across `superadmin.test.tsx` + `settings.test.tsx`. New `dashboard/lib/test-utils.ts` exports a typed `mockJsonResponse(body, init?)` helper. Caught a real latent bug along the way: an unguarded `lastCall = .find(...)` deref of `T | undefined` that the prior `as any` cast had been hiding.
- **`b293813` — Vocabulary pass on UI strings.** Replaced 4 user-visible jargon strings: "Multi-Tenant Management" → "Multi-Business Management", "Skill Matrix" tab + "Service Assignment Matrix" page heading → "Service Assignments", "coverage gaps" → "aren't fully staffed yet". Extended `vocabulary-guard.test.ts` with 4 new banned-pattern regexes so regressions fail fast with a named description pointing at the right replacement. Verified zero remaining occurrences of any of the 6 originally-listed jargon terms across the dashboard.
- **`3eba91b` — `disconnectCrmIntegration` helper extracted.** Verify-first found CRM disconnect/sync-status response *shapes* were already normalized; the duplication was at the *implementation* level — 4 × 16-line disconnect handlers differing only in the provider literal. Extracted to `src/services/crmDisconnect.ts` mirroring the `crmSyncStatus.ts` shape. 5 unit tests (happy + 2 sad paths). ~30 lines deduped.
- **`faf3056` — Canonical `TenantFull` typing for the dashboard.** Three components (TenantCard, SuperAdminDashboard, TenantEditPanel) had local `type Tenant = { ... }` declarations — each subsets/supersets of `TenantFull` in `dashboard/lib/types.ts`. Migrated to `import type { TenantFull }`. Two canonical-type fixes shipped along: relaxed `Tenant.{voice_id, system_prompt, first_message}` from non-null `string` to `string | null` (matches DB nullability + the local types' more accurate shape), and added `TenantFull.{system_prompt_template, first_message_template}` as optional read-only fields projected by the SuperAdmin /tenants list query.

### May 4 Session: 8 commits — refactor marathon (skip count 2 → 0, backend tests 1,456 → 1,514)

A focused day on durable cleanups. Each item below is a separate commit; the verify-first pass redirected two original framings ("unify token refresh", "drop withTenantClient param") toward higher-ROI orthogonal extractions.

- **`9b0a572` — UsageTrackingService deleted (NEEDS-REFACTORING #3).** In-memory stub; no DB persistence, no Stripe meter reporter, no metered-tier customer. Removed under the test-or-delete lens (same disposition as 2026-05-02 CRM adapters, #1). Deleted `src/services/usage/`, `src/types/usage.ts`, the optional `usageTracker?` constructor param on `CommunicationService` + `SMSService`, and the `await trackSMS(...)` block. No production caller had been passing it.
- **`f4ac89a` — `paginateSync()` helper extracted (NEEDS-REFACTORING #10, narrow).** 7 inline pagination loops across the 4 CRM sync modules collapsed into calls to a new `src/services/syncPaginate.ts`. Generic over both item type and cursor type. 9 5W tests including a regression test for the null-initial-cursor case caught mid-refactor. Broader push/pull skeleton extraction deferred — provider quirks defeat clean parameterization.
- **`c12d075` — CLAUDE.md drift detector (NEEDS-REFACTORING #13).** `scripts/verify-claude-md.ts` runs five checks: route count, migration count, template count, listed-directory existence, commit reachability from main. Wired into backend CI job + `npm run verify:claude-md`. Numeric counts skip the historical Resolved Issues archive; commit reachability scans the full doc. Inline `<!-- verify-claude-md: unmerged -->` marker opts known-unreachable hashes out. 25 5W tests.
- **`24a2e47` — `improvement-ideas.md` pruned (NEEDS-REFACTORING #12).** 6 closed task blocks deleted; 1 ALREADY SHIPPED entry preserved as audit evidence. Preamble rewritten to declare the file as generator output, not a curated backlog. 2137 → 2089 lines.
- **`cdfd0b4` — Mock test helpers extracted (~350 lines deduped).** Surfaced by the verify-first on NEEDS-REFACTORING #11's deferred part: 13 test files duplicated `createMockClient` / `createMockPool` / `mockWithTenantClient` (~25 lines each). New `src/services/test-utils-mock.ts` is a strict superset of every prior copy. 12 5W tests.
- **`647866a` — OAuth state JWT helpers extracted (~72 lines deduped).** Verify-first reframed "unify calendar token refresh" — the actual shared code was the OAuth state JWT, duplicated across 6 files (Google + Outlook calendars + 4 CRM clients) with only the `purpose` discriminator differing. New `src/services/oauthStateJwt.ts`. 10 5W tests including cross-provider-replay defense. Token refresh itself deliberately NOT unified (Google SDK vs Outlook fetch defeat clean abstraction).
- **`ed26cbc` — Tenant bootstrap doc cleanup.** Verify-first found `src/services/tenants/bootstrap.ts` was already shipped on 2026-04-30 (commit `19d6b8b`); both call sites already consumed it; 9 unit tests already covered happy + sad. Pure `docs/TODO.md` truth-up.
- **`f686672` — `get_effective_shifts` skips re-enabled (2 → 0).** Both `it.skip`'d tests in `src/shift-overrides-edge.test.ts` replaced with new tests under the `employee_schedule`-only contract: HAPPY multi-day range returns every row in date order; SAD rows outside the queried range are filtered out. Both verified against real Postgres.

### May 3 Session: voice fallback path validation + tenant-config redo on main

- **Voice fallback path validation** (queue #9). The validation surfaced a real dead-air gap: docs across CLAUDE.md / ARCHITECTURE.md / NEEDS-REFACTORING.md #9 had claimed `runFallback()` used OpenAI TTS as a guard against Grok outage, but the actual code on main wired GrokTTS in both the primary path AND the fallback — meaning a Grok outage would leave the fallback unable to speak either. Closed by extracting `runFallback()` to `agent/src/fallback.ts` (injectable provider deps), switching its TTS to OpenAI, awaiting `say()` so synthesis failures are caught, and pinning the contract with 13 new 5W tests. Agent suite: 53 → 66 tests, all green.
- **Tenant-config wiring redone on main** (closes NEEDS-REFACTORING #2). The voice-fallback validation surfaced that commit `e92b3bf` ("feat(agent): fetch tenant display config from backend at call start"), claimed on 2026-05-01 to close NEEDS-REFACTORING #2, actually lived on a `hold-tenant-config` branch and was never merged to main. Path B taken: redone directly on main, reusing the branch's design as a reference. New `POST /agent-tools/tenant-config` route in `src/routes/agentTools.ts` (4 backend tests). New `agent/src/tenantConfig.ts` module (6 agent-side tests). Hardcoded `DYNATIRE_TENANT_ID` / `TENANT_DEFAULTS` block deleted from `agent/src/index.ts`. The agent now greets with the real business name and reasons about "today" in the tenant's IANA zone. Soft-fails to "this business" / America/Chicago on any backend error so a config blip never hangs up a live caller. Agent suite: 66 → 72 tests. Backend: 1,475 → 1,479 tests. Multi-tenant production no longer blocked by the agent worker's display path.

### May 1-2 Sessions: concurrency fix + structural refactors

- **Atomic-booking concurrency hole closed** (commit `55be6dc`). Race confirmed under READ COMMITTED — find-then-insert in `book_appointment_atomic` / `book_with_scheduling_atomic` could pass two `NOT EXISTS` checks before either committed (9/20 winners on resource race, 20/20 on employee race). Closed by two GiST exclusion constraints (`appointments_no_resource_overlap`, `appointments_no_employee_overlap`, migration `20260501000000`) plus `exclusion_violation` handlers in both RPCs (`20260501000001`). Race losers receive `TIMESLOT_OCCUPIED` and the agent prompt's "that time just got taken" mapping continues to apply. **Migration not yet applied to production Supabase** — see TODO.md Phase 13 entry for the pre-flight overlap-scan step.
- **xAI Grok TTS shipped** (commit `f6cc1d4`, 2026-05-01). `agent/src/grokTTS.ts` implements the LiveKit `tts.TTS` plugin against `https://api.x.ai/v1/tts`; primary session uses Grok, `runFallback()` claimed (but pre-2026-05-03, did not actually) use OpenAI TTS as the dead-air guard — see May 3 entry above. End-to-end PSTN validation still pending Telnyx.
- **Tenant config wiring** — commit `e92b3bf` originally claimed to close NEEDS-REFACTORING #2 P0 on 2026-05-01 actually lived on a `hold-tenant-config` branch and was never merged. Properly redone on main 2026-05-03 — see the May 3 entry above for the actual landing.
- **`src/index.ts` slimmed 385 → 279 lines** across three commits:
  - `fbc1eaf` — JWT preHandler + PUBLIC_ROUTES + generateToken/verifyToken extracted to `src/middleware.ts` as `registerJwtAuthHook(app, pool)`.
  - `9b78030` — Pool config consolidated. `src/database/index.ts:getPool()` is now the canonical singleton with the deadlock-prevention timeouts (`statement_timeout`/`lock_timeout`/`idle_in_transaction_session_timeout`); reminder scheduler + communications no longer get a softer pool than routes.
  - `5077fd6` — `withTenantClient` factory extracted to `src/database/index.ts` as `createWithTenantClient(pool)`. Routes and tests unchanged (still receive it as injected).
- **`scripts/setup-db.sh` bootstrap bug fixed** (commit `c9f40c6`). The `psql -c "SET ..."` + heredoc combo silently dropped the `CREATE TABLE schema_migrations` because `-c` and stdin are mutually exclusive. CI workaround removed.
- **OTP system prompt status truthed up** (commit `6f91b7b`). The "Phase 3 TODO" line in CLAUDE.md was stale — Phase 3 had already shipped in the LiveKit `agent/src/prompt.ts` since commit `18caffe`.
- **`src/services/crm/` deleted** (NEEDS-REFACTORING #1, P0). 21 dormant adapters + `BaseCRMAdapter` interface + factory + the mocked-API test file removed (3,480 lines). Decision policy locked: anything we can't validate against a real CRM gets deleted; when a beta customer brings a CRM we don't have a flat client for, we wire it then. The four working flat clients (jobber/hubspot/square/servicetitan) are unaffected. Two of the deleted adapters (`dentrix.ts`, `eaglesoft.ts`) violated the platform's HIPAA-excluded-vertical policy. Backend test count: 1,495 → 1,475.

### April 20-21 Session: UX/a11y backlog complete + migration docs

- **All 47 UX/accessibility items resolved** (commit `f9ffa8e`, tracked in `docs/TODO.md`). Clickable divs → semantic buttons with keyboard handlers across 8 components. Hand-rolled modals consolidated onto shared `Modal`. All `confirm()`/`alert()` calls replaced with `ConfirmModal` + `showToast`. ARIA roles, `aria-selected`, `aria-live`, `role="dialog"` added throughout. URL query param sync on sub-tabs. Loading skeletons, empty states. Radiogroup semantics, fieldset grouping, explicit labels.
- **Framework migration index** — `docs/FRAMEWORK_MIGRATIONS.md` tracks three migrations: Vapi→LiveKit (orchestrator, **done**), Supabase Edge Functions→Fastify (tool runtime, 10 tools, **done**), OpenAI TTS→xAI Grok TTS native in agent (**Phase 4 pending**).
- **Docs audit + sync** — CLAUDE.md, README.md, BUGS.md, ARCHITECTURE.md, DEPLOYMENT.md, PLAN.md all updated to reflect current state.

### April 9-10 Session: UI/UX Audit + Shift Bar Fix

- **Front Desk shift bars fixed** (BUG-072): scheduler now uses `get_effective_shifts_bulk()` RPC (single-query, date-based only); shift bar styling matches Front Desk and Working Hours.
- **UI/UX audit** — 35 items resolved (Critical 7, High 13, Medium 15): wizard guards, ConfirmModal rollout, keyboard a11y, mobile responsive, theme compliance, URL-synced tab state, empty/loading states. See `docs/BUGS.md` for the per-item record.
- **Playwright e2e** — 7 fix tests + 12-step functional audit. All pass.
- **5W diagnostic compliance** — All 498 dashboard tests carry WHO/WHAT/WHEN/WHERE/WHY comments.

### April 3-4 Session: Architecture Review + Scheduling Overhaul

**Architecture review completed** — 32 items across Critical/High/Medium all resolved. See `docs/ARCHITECTURE_REVIEW_20260403.md` for full report. Key changes:
- Rate limiting (`@fastify/rate-limit`) + security headers (`@fastify/helmet`) added
- CORS restricted via `CORS_ORIGIN` env var
- Token refresh endpoint (`POST /auth/refresh`) + client-side auto-refresh (10min before expiry)
- Sync orchestrator (`src/services/syncOrchestrator.ts`) replaces 35 scattered fire-and-forget calls
- SettingsView split: 1,008 → 467 lines (extracted `CRMIntegrationCard.tsx`)
- SetupWizard split: 584 → 203 lines (extracted `useWizardCrud.ts`)
- Night shift support (cross-midnight time comparison)
- `check_availability_with_tz()` now checks employee shift coverage + overrides
- `getAvailableSlots()` consolidated from 13 DB round trips to 1
- Modal focus trap, form label auto-ids (`useId()`), lazy loading for dashboard tabs

**Scheduling simplified** — User rejected pattern+override model as too complex:
- **New model**: date-based only. Click a day → set times → save. No weekly patterns.
- Data lives in `employee_schedule` table (API: `Api.shifts.schedule.*`)
- Both Working Hours editor and the Schedule tab read from same table
- Default times: 8:00 AM - 5:00 PM
- `employee_shifts` (weekly patterns) was dropped 2026-04-30 (NEEDS-REFACTORING #4 Phase 2). Setup wizard now collects the weekly grid in form state and posts the pattern to `POST /shifts/expand-weekly`, which fans it into `employee_schedule` for 4 weeks at finalize.

### Other UI Work Done
- Landing page `public/index.html`: added "Log in" button (was missing entirely)
- Skill map connection lines: brightened opacity and colors for dark themes
- Modal: fixed focus trap stealing keystrokes (useEffect now stable on `[isOpen]` only)

## What's Left

See `docs/TODO.md` for the unified task list.

### Test Count (verified 2026-05-11 against real Postgres + dashboard)
- **1,781 backend tests + 620 dashboard tests = 2,401 passing**, 0 failures, 0 skips
- 85 agent tests (`cd agent && npm test`)
- 71 Playwright e2e + 7 skip-guarded (run with `SYNC_TEST_RECORDER=1` to flip them on)
- 29 live QA tool calls (88 assertions)
- Zero TypeScript errors (`npx tsc --noEmit` clean on backend + dashboard + agent)
- CI now provisions Postgres 16 + applies migrations, so DB-level tests
  actually run on every push (previously they silently skipped without Docker)

---

## What's Working

| Component | Status | Details |
|-----------|--------|---------|
| **Backend API** | Live | `https://ai-sec-production.up.railway.app/` — Fastify, 26 route modules, Railway auto-deploy from main |
| **Landing page** | Live | Full marketing page at root URL with features, pricing, demo mockup |
| **Database** | Live | Supabase Postgres (managed), 107 migrations in repo, FORCE RLS on all tables. **18 migrations awaiting prod apply:** `20260501000000` (exclusion constraints) + `20260501000001` (RPC handlers); `20260505000000_user_roles.sql`; `20260511000000_employees_services_tenant_fk_cascade.sql` (orphan-row leak fix — see [[in-flight]]); the **17-migration PK rename sprint `20260512000000–16` — complete** (every domain entity table now uses `<table_singular>_id` as its PK; auto_version_trigger + fn_audit_trigger CASE TG_TABLE_NAME-aware; one create_default_resources trigger function fix). The PK renames are forward-only and have to land in pilot order on prod — any application code deployed against prod expects the renamed columns post-trigger-rewrite. |
| **LiveKit agent worker** | Live | Railway service `ai-sec-agent`, worker `AW_vPmGExrgTeGn` registered with LiveKit Cloud |
| **Phone provisioning** | Working (code) | `POST /provisioning/activate` searches Telnyx inventory, purchases, assigns to SIP Connection `livekit-outbound` |
| **DynaTire phone** | Provisioned, **unreachable** | `+1-630-937-9478` (Telnyx) — Telnyx-side config verified clean; calls return "not in service" upstream. Original ticket `#2850682` superseded 2026-05-01 after 4 days without a human response; new ticket awaiting LERG/porting reviewer. |
| **Voice AI (end-to-end)** | Wired, awaiting first live call | Telnyx → LiveKit Cloud → agent worker → `/agent-tools/*` → Postgres. Blocked on the carrier-side LERG/PSTN propagation issue above. |
| **Knowledge base** | Working | 40 policy Q&A pairs across 9 categories, document upload (PDF/TXT/DOC/DOCX/MD), auto-save |
| **QA test suite** | Working | `scripts/qa-live-test.py` — 29 tool calls, 88 assertions against `/agent-tools/*` Fastify routes |
| **Stripe billing** | Configured | Webhook registered at `/billing/webhook`, test keys + price IDs set |
| **Local dev** | Working | `npm start` runs backend (4001) + dashboard (4000), dotenv loads `.env` |
| **Tests** | 1,781 backend + 620 dashboard + 85 agent = 2,486 passing + 88 QA assertions | All green (verified 2026-05-11 against real DB + dashboard), 0 skips, zero TS errors |
| **Playwright e2e** | 71 passed / 7 skipped | Against live dashboard |
| **Google Calendar sync** | Working | OAuth flow, token refresh, auto-sync on create/update/delete/cancel |
| **Outlook Calendar sync** | Working | Microsoft Graph API, OAuth flow, token refresh, auto-sync on create/update/delete/cancel |
| **Jobber CRM sync** | Working | Bidirectional sync (push+pull), timestamp-based merge, OAuth, GraphQL API, webhooks |
| **HubSpot CRM sync** | Working | Bidirectional sync (push+pull), REST API (contacts+meetings), OAuth, webhook v3 verification |
| **Push triggers wired** | Working | Appointment + customer mutations fire-and-forget to all connected calendars + CRMs |
| **Supabase CLI** | v2.83.0 | Updated from 2.77.1 |

## What's Broken / Blocked

### ~~Voice AI Scheduling Bug~~ — RESOLVED (2026-04-01)

**BUG-059**: `book_with_scheduling_atomic()` was using hardcoded UTC timezone for shift validation, causing bookings to fail for non-UTC tenants (e.g., Chicago tenant booking at 5 PM Friday would fail because function checked for Saturday shifts in UTC).

**Fixed**: Applied migration `20260401000000_fix_scheduling_timezone_bug.sql` — now uses tenant's actual timezone from `tenants.timezone` column.

**Impact**: Voice AI can now successfully book appointments for tenants in any timezone.

**Test**: Created `src/scheduling-timezone-bug.test.ts` to verify fix (TDD approach).

### ~~Edge Functions Not Responding~~ — RESOLVED (2026-03-30)

Supabase project is no longer stuck in "pausing" state. Edge functions were reachable until commit `661d21d` (2026-04-27) deleted them entirely as part of the LiveKit migration; tool execution now lives in `src/routes/agentTools.ts`.

### Minor Issues (non-blocking)
- **OpenAI API quota** — Edge functions use GPT-4o-mini for LLM + embeddings. Monitor usage as call volume grows.
- **Filler phrases** — Voice AI occasionally says "Absolutely!" or "Great!" despite prompt engineering. Iterating on system prompt.

---

## Integration Architecture

### Calendar Sync (Push-only: SecretaryHQ → Calendar)
| Provider | Service file | Route file | How it works |
|----------|-------------|------------|-------------|
| Google Calendar | `src/services/googleCalendar.ts` | `src/routes/calendar.ts` | googleapis SDK, OAuth 2.0, Events API |
| Outlook Calendar | `src/services/outlookCalendar.ts` | `src/routes/calendar.ts` | Raw fetch to Microsoft Graph API v1.0 |
| Sync orchestrator | `src/services/calendarSync.ts` | — | Provider-agnostic, 5-min token refresh buffer, 5W logging |

### CRM Sync (Bidirectional: push + pull with timestamp merge)
| Provider | Client file | Sync file | Route file | API type |
|----------|------------|-----------|------------|----------|
| Jobber | `src/services/jobberClient.ts` | `src/services/jobberSync.ts` | `src/routes/jobber.ts` | GraphQL |
| HubSpot | `src/services/hubspotClient.ts` | `src/services/hubspotSync.ts` | `src/routes/hubspot.ts` | REST v3 |
| Square | `src/services/squareClient.ts` | `src/services/squareSync.ts` | `src/routes/square.ts` | REST v2 |
| ServiceTitan | `src/services/servicetitanClient.ts` | `src/services/servicetitanSync.ts` | `src/routes/servicetitan.ts` | REST v2 |

### Shared OAuth/Token Infrastructure
| File | Purpose |
|------|---------|
| `src/services/oauthCallbackFactory.ts` | Generic OAuth callback handler factory — eliminates duplication across 4 CRM integrations |
| `src/services/tokenManagement.ts` | Shared token refresh logic with 5-min buffer for all OAuth integrations |

### Push Triggers (fire-and-forget, wired in route handlers)
| Mutation | Calendar sync | Jobber sync | HubSpot sync | Square sync | ServiceTitan sync |
|----------|--------------|-------------|--------------|-------------|-------------------|
| Appointment create | ✓ | ✓ | ✓ | ✓ | ✓ |
| Appointment update | ✓ | ✓ | ✓ | ✓ | ✓ |
| Appointment delete | ✓ | ✓ | ✓ | ✓ | ✓ |
| Appointment cancel | ✓ | ✓ | ✓ | ✓ | ✓ |
| Customer create | — | ✓ | ✓ | ✓ | ✓ |
| Customer update | — | ✓ | ✓ | ✓ | ✓ |
| Customer delete | — | ✓ | ✓ | ✓ | ✓ |

### Sync Strategy
- **Calendar**: Push-only. Calendar is display-only, not source of truth.
- **CRM**: Bidirectional with timestamp-based merge. Most recent `updated_at` wins per record. Non-conflicting fields merge via COALESCE.
- **Pull triggers**: Webhook receivers (`POST /jobber/webhook/:tenantId`, `POST /hubspot/webhook`, `POST /square/webhook`, `POST /servicetitan/webhook`) + periodic full sync (`POST /{provider}/sync`).
- **DB tables**: `tenant_integration_settings` (OAuth tokens per provider), `entity_sync_map` (local↔external ID mapping with timestamps).

---

## Environment Variables

### Railway (Backend) — Set
| Variable | Status |
|----------|--------|
| `DATABASE_URL` | Set (Supabase session pooler) |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Set |
| `JWT_EXPIRY` | `8h` |
| `OPENAI_API_KEY` | Set |
| `TELNYX_API_KEY` | Set (carrier + SMS OTP) |
| `TELNYX_SIP_CONNECTION_ID` | `2945038451784812111` |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Set (project "AI-Secretary") |
| `DEEPGRAM_API_KEY` | Set (Nova-3 STT in agent) |
| `AGENT_SECRET` | Set (LiveKit agent → Fastify auth) |
| `STRIPE_SECRET_KEY` | Set (test mode) |
| `STRIPE_WEBHOOK_SECRET` | Set |
| `STRIPE_SOLO_PRICE_ID` | Set |
| `STRIPE_GROWTH_PRICE_ID` | Set |
| `STRIPE_PRO_PRICE_ID` | Set |
| `STRIPE_ENTERPRISE_PRICE_ID` | Set |
| `DASHBOARD_URL` | **NOT SET** (need dashboard deployed first) |
| `GOOGLE_CLIENT_ID` | **NOT SET** (need Google Cloud OAuth app) |
| `GOOGLE_CLIENT_SECRET` | **NOT SET** |
| `GOOGLE_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/calendar/auth/google/callback`) |
| `OUTLOOK_CLIENT_ID` | **NOT SET** (need Azure AD app registration) |
| `OUTLOOK_CLIENT_SECRET` | **NOT SET** |
| `OUTLOOK_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/calendar/auth/outlook/callback`) |
| `JOBBER_CLIENT_ID` | **NOT SET** (need Jobber developer app) |
| `JOBBER_CLIENT_SECRET` | **NOT SET** |
| `JOBBER_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/jobber/auth/callback`) |
| `HUBSPOT_CLIENT_ID` | **NOT SET** (need HubSpot developer app) |
| `HUBSPOT_CLIENT_SECRET` | **NOT SET** |
| `HUBSPOT_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/hubspot/auth/callback`) |
| `SQUARE_CLIENT_ID` | **NOT SET** (need Square developer app) |
| `SQUARE_CLIENT_SECRET` | **NOT SET** |
| `SQUARE_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/square/auth/callback`) |
| `SERVICETITAN_CLIENT_ID` | **NOT SET** (need ServiceTitan developer app) |
| `SERVICETITAN_CLIENT_SECRET` | **NOT SET** |
| `SERVICETITAN_APP_KEY` | **NOT SET** (ST-App-Key header) |
| `SERVICETITAN_CALLBACK_URL` | **NOT SET** (`https://ai-sec-production.up.railway.app/servicetitan/auth/callback`) |

### Supabase Edge Function Secrets

The Supabase edge function `vapi-tools` was deleted in commit `661d21d`. No edge-function secrets are read by the current stack. Tools live at Fastify `/agent-tools/*` and authenticate via `AGENT_SECRET` set on Railway.

---

## Remaining TODO (Priority Order)

1. ~~Deploy dashboard~~ — Done (commit `fb216e0`, live at https://dashboard-production-cee3.up.railway.app/)
2. **Set `DASHBOARD_URL`** in Railway — for Stripe checkout + OAuth redirects
3. ~~Apply new migrations to Supabase~~ — Done through `20260430000002_drop_employee_shifts.sql`. **Two newer migrations** (`20260501000000_atomic_booking_exclusion_constraints.sql` + `20260501000001_booking_rpcs_handle_exclusion.sql`) shipped 2026-05-02 but not yet applied to prod — pre-flight overlap scan needed first. See TODO.md Phase 13.
4. ~~**UI/UX flow improvements**~~ — Done (April 9-10 audit 35 items + April 20 a11y 47 items, commit `f9ffa8e`)
5. ~~**Voice AI migration**: Vapi → LiveKit Agents~~ — Done in commit `661d21d` (2026-04-27). Awaiting Telnyx (original ticket `#2850682` superseded 2026-05-01; new ticket open) to unblock first live call.
6. **Beta testing with DynaTire** — blocked on the carrier issue above

### Done This Session (2026-04-01)
- ~~BUG-059: Timezone regression~~ — `book_with_scheduling_atomic()` used hardcoded UTC for shift validation; now uses tenant timezone. Migration `20260401000000`
- ~~BUG-060: Phone number incomplete~~ — `normalizePhone()` now rejects < 10 digits (was accepting "+1" as valid)
- ~~BUG-061: Wrong date booked~~ — Vapi assistant had hardcoded stale date in system prompt; updated with dynamic date handling
- ~~BUG-062: No employee assigned~~ — AI wasn't passing `requiredEmployeeSkills`; prompt updated with service-to-skill mapping
- ~~BUG-063: Call hangs up on booking failure~~ — Added error handling instructions to Vapi assistant prompt
- ~~BUG-064: Generic booking errors~~ — Added specific error codes (TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED) via migration `20260401000001`
- ~~OAuth callback refactoring~~ — Created `oauthCallbackFactory.ts` + `tokenManagement.ts` to eliminate duplication across Jobber, HubSpot, Square, ServiceTitan
- ~~Test expansion~~ — Added scheduling timezone bug test, voice AI fixes test, available slots test, comprehensive bug fix regression tests (rounds 1-5)
- ~~BUG-030: Orphaned transcripts~~ — `link_orphaned_transcripts()` now called in `dispatcher.handleCallEnded()` after every call
- ~~BUG-031: Timezone availability~~ — `service.checkAvailability()` now calls `check_availability_with_tz()` RPC for timezone-aware results
- ~~BUG-032: Call summary embeddings~~ — n8n workflow now generates embeddings (text-embedding-3-small) and stores them in `call_summaries.embedding`
- ~~BUG-038: Soft delete filtering~~ — All 7 edge function queries on soft-deletable tables now filter `is_deleted`. `deleteEmployee()` converted to soft delete
- ~~BUG-039: ARIA accessibility~~ — Toast, Card, FeedbackButton, CoverageBar, OutlookLayout tabs all have proper ARIA attributes

### Done Previous Session (2026-03-30)
- ~~Supabase blocker resolved~~ — Project no longer stuck in "pausing" state
- ~~Voice AI end-to-end working~~ — 8 critical fixes (tool response format, Zod relaxation, caller ID, timezone, natural errors)
- ~~LLM switched~~ — Groq/Llama 3.3 → OpenAI GPT-4o-mini (better instruction following)
- ~~Voice switched~~ — Vapi "Elliot" (male) → Vapi "Clara" (young American female)
- ~~Vapi assistant configured~~ — Smart endpointing, background denoising, Deepgram keywords, speaking plans
- ~~Booking validation~~ — Past-time rejection, business hours check, fuzzy service matching, timezone conversion (America/Chicago)
- ~~Knowledge base questionnaire~~ — 40 policy Q&A pairs across 9 categories, auto-save, document upload, embedding generation
- ~~DynaTire data cleanup~~ — 1 employee (Mike Rivera), 1 truck, all 5 services assigned, Mon-Fri 8-6
- ~~System prompt engineering~~ — Name spelling, no phone collection (use caller ID), no filler, natural datetime speech
- ~~QA test suite~~ — `scripts/qa-live-test.py` — 29 tool calls, 88 assertions, all passing
- ~~tools.json updated~~ — Added `get_company_policy_answer` and `get_service_catalog` tools

### Done Previous Session (2026-03-26)
- ~~Outlook calendar sync~~ — Microsoft Graph API, OAuth, full CRUD
- ~~Jobber CRM integration~~ — Bidirectional GraphQL sync with timestamp merge
- ~~HubSpot CRM integration~~ — Bidirectional REST sync with meetings + contacts
- ~~Square CRM integration~~ — Bidirectional REST v2 sync with customers + bookings
- ~~ServiceTitan CRM integration~~ — Bidirectional REST v2 sync with customers + jobs
- ~~CRM push triggers wired~~ — appointments.ts + customers.ts fire to all connected integrations (4 CRMs + 2 calendars)
- ~~Comprehensive sad path coverage~~ — 1,319 total tests with 5W diagnostics
- ~~30 unused variable warnings cleaned~~ — zero TS errors with strict checks
- ~~Scheduling diagnostics~~ — `selectAssignments()` returns reason strings ("all 3 bays busy", etc.)
- ~~All refactoring items complete~~ — 24/24 done in March 2026 sweep; that tracking file has since been removed from the repo

---

## Provisioned Resources

| Resource | Value |
|----------|-------|
| Railway backend URL | `https://ai-sec-production.up.railway.app/` |
| Supabase project | `sgibijfchvfuizudrmir` (us-west-2) |
| Active phone number | `+1-630-937-9478` (Telnyx) — see `TICKET_SUPPORT.md` for status |
| Telnyx SIP connection | `livekit-outbound`, ID `2945038451784812111`, FQDN `daleaisec24.sip.telnyx.com` |
| LiveKit SIP target | `ai-secretary-nmlkkmgf.sip.livekit.cloud:5060` |
| LiveKit dispatch rule | `SDR_if97ky4Zf7e6` (one rule routes all tenants to agent name `ai-secretary-agent`) |
| Stripe webhook URL | `https://ai-sec-production.up.railway.app/billing/webhook` |

---

## Test Coverage Summary

| Area | Test files | Test count | Coverage |
|------|-----------|------------|----------|
| Calendar sync (Google + Outlook) | 3 files | 102 | OAuth, sync orchestration, happy + sad |
| Jobber CRM | 3 files | 82 | Client, sync, routes — happy + sad |
| HubSpot CRM | 3 files | 74 | Client, sync, routes — happy + sad |
| Square CRM | 3 files | ~70 | Client, sync, routes — happy + sad |
| ServiceTitan CRM | 3 files | ~70 | Client, sync, routes — happy + sad |
| Provisioning | 1 file | 8 | Telnyx Numbers API (search/order/assign/release), DB schema, rollback |
| Scheduling + timezone | 2 files | 34 | Diagnostics, edge cases, UTC drift, DST transitions, midnight boundary, 5W sad paths |
| Voice AI fixes | 1 file | 22 | Phone normalization (E.164, partial, garbage), date calc (month/year boundary), skill mapping, error codes — all with 5W |
| OAuth/token management | 2 files | 20+ | Generic callback factory, token refresh |
| Normalizer | 1 file | 17 | Timeouts, API errors, unicode |
| Bug fix regression | 6 files | 80+ | April 1 rounds 1-5, comprehensive, regression |
| Dashboard (all) | 16 files | 313 | Components, wizards, scheduler, CRM, settings |
| Other backend | 11+ files | 281 | Auth, CRUD, billing, bugs, middleware, etc. |
| QA live tests | 1 file | 29 calls / 88 assertions | Live `/agent-tools/*` Fastify route calls with DB verification |
| **Total** | **75 backend + 23 dashboard + 1 QA** | **1,991 + 88 QA** | Happy + sad paths, 5W diagnostics, live integration (verified 2026-04-30) |
