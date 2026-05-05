# Session state — 2026-05-05 morning (Tuesday, CDT)

Last updated manually (Dale asked "update all of the *.md files"). Pairs
with `/recall-memory` for resume. This snapshot **overwrites** the
2026-05-03 evening Python-tutoring snapshot — every next-step in that
list has been picked up or explicitly deferred since.

## Where we stopped

Clean working tree on `main`, all session work pushed. Most recent
commit: `faf3056 refactor(dashboard): canonicalize Tenant typing to
TenantFull (3 ad-hoc → 1)`. The two pre-existing dirty files
(`.remember/state.md` and `improvement-ideas.md`) are managed by other
skills and remain dirty across the session — both are explicitly out
of scope for the work commits.

User asked "update all of the *.md files" at session close, which is
what this refresh + the CLAUDE.md / docs/CURRENT_STATUS.md / README.md
test-count + Resolved-Issues / May-5 entries are addressing.

## What shipped this session (May 4 + May 5 — 27 commits across two days)

### May 4 — refactor marathon (8 commits)

- **`9b0a572`** — UsageTrackingService deleted (NEEDS-REFACTORING #3).
- **`f4ac89a`** — `paginateSync()` helper extracted (NEEDS-REFACTORING #10, narrow).
- **`c12d075`** — CLAUDE.md drift detector (NEEDS-REFACTORING #13).
- **`24a2e47`** — `improvement-ideas.md` pruned (NEEDS-REFACTORING #12).
- **`cdfd0b4`** — Mock test helpers extracted (~350 lines deduped across 13 test files).
- **`647866a`** — OAuth state JWT helpers extracted (~72 lines deduped across 6 files).
- **`ed26cbc`** — Tenant bootstrap doc cleanup (work was already shipped 2026-04-30).
- **`f686672`** — `get_effective_shifts` skips re-enabled (2 → 0).

Plus `e68c22b` (sync session-summary entries with the full 2026-05-04
commit set) for doc consistency.

### May 5 — cleanup sweep (7 commits)

- **`9364773`** — High-value 5W backfill across `rls`, `schema`, `customer`, `tenant-reorder`, `critical-bugs` test suites. 23 tests gained WHO/WHAT/WHEN/WHERE/WHY annotations. Backend 5W coverage: 64 → 70/90 files.
- **`33f83cd`** + **`01b7009`** — Backend test `any`-type cleanup, top-5 offenders. 86 instances cleared (215 → 129 across all backend test files).
- **`5f12215`** + **`2cd381a`** — Destructive-flow tests: tenant DELETE + reorder, shift override CRUD, AppointmentView mock-mode handleUpdate + handleDelete guards. Mock-mode handleCreate explicitly deferred + tracked.
- **`88701c0`** — NEEDS-REFACTORING #11 deferred-part verify-first. Documented why the dashboard controller-hook extraction stays deferred.
- **`cbf22b0`** — Dashboard test `any`-type cleanup (~27 → 0). New `dashboard/lib/test-utils.ts` exports `mockJsonResponse`. Caught a real latent bug: `lastCall = .find(...)` deref of `T | undefined` previously hidden by `as any`.
- **`b293813`** — Vocabulary pass on UI strings (4 user-visible jargon strings replaced; vocabulary-guard.test.ts extended with 4 new banned-pattern regexes).
- **`3eba91b`** — `disconnectCrmIntegration` helper extracted to `src/services/crmDisconnect.ts`. ~30 lines deduped across the 4 CRM routes.
- **`faf3056`** — Canonical `TenantFull` typing for the dashboard. 3 ad-hoc local `type Tenant` declarations replaced; `Tenant` nullability relaxed to match DB; `TenantFull` gained `system_prompt_template` + `first_message_template` optional fields.

## Decisions made

- **Vocabulary pass replacements use the spirit of the TODO entry, not the literal parenthetical examples.** TODO suggested "skill match" + "uncovered shift"; I shipped "Service Assignments" + "aren't fully staffed yet". User confirmed (after asking "Are these tone???" — autocorrect for "done") that flipping was the right call only if completely done; for vocab, all 6 listed jargon terms had zero remaining user-visible occurrences, so flip was warranted.
- **Destructive-flow tests entry stays open ([ ]) despite 3 of 4 named flows being covered.** User's "COMPLETELY done" rule applies — handleCreate mock-mode guard is the third of three identical-shape guards; not testing it leaves the contract partially pinned. Entry reworded to document exactly what's done + what's remaining + why.
- **23 backend test files without 5W not backfilled.** Most are mechanical schema/utility tests where the test name already documents the behavior; full backfill would be ceremony. High-value subset (security, regression, contract-pinning) got 5W in commit `9364773`. Rest tracked in TODO.md as a per-file pickup item — verify ceremony-vs-value before each.
- **129 backend test `any` instances + 62 production `any` instances not fully cleared.** Top-5 offenders cleared this session (40% of the test debt). Rest tracked in TODO.md as separate pickup items so they don't get lost.

## Mistakes and corrections

- **`as any` substitution patterns sometimes hid real type bugs.** Cleaning up `superadmin.test.tsx` surfaced an unguarded `lastCall = .find(...)` deref that the prior cast had been hiding — fixed with a typed throw guard. Lesson: every `as any` removal is a chance to surface latent type assumptions; treat each as an audit, not a mechanical replace.
- **Initial mock-test-helper extraction (`cdfd0b4`) had a bug.** Used `null` as both the initial cursor AND the stop sentinel in `paginateSync`; the loop never entered when `initialCursor === null` (Jobber's actual case). Caught by the existing FULL-SYNC-WITH-DATA test in `jobber-sync.test.ts`. Fixed mid-refactor + pinned with a dedicated regression test for the null-initialCursor case.
- **Stash-and-pop dance to keep skill-managed dirty files out of one commit briefly resurrected the deleted `usage/` files in the working tree.** Cleaned up with `git rm -rf` immediately. Lesson: git stash-pop semantics around `--keep-index` interact unexpectedly with `git checkout HEAD -- .` from inside subdirectories; safer to use `git restore --staged` + manual file management for these dances.

## In flight / uncommitted

Just `.remember/state.md` (this file) and `improvement-ideas.md`
(2026-05-04 journal-loop batch waiting on its own loop's commit
cycle). Neither is mine to commit. `git status` is otherwise clean.

## Test state at session close

- Backend: **1,536** passing + 0 skips + 0 failures (was 1,456 at session open; +80 across 27 commits).
- Dashboard: **504** passing + 0 failures (was 498 at session open; +6 from 4 vocab-guard patterns + 2 mock-mode guard tests).
- Agent: **72** passing + 0 failures (1 pre-existing GrokTTS unhandled rejection from commit `f6cc1d4`, predates session, verified by reverting to HEAD~1 to reproduce).
- 5W coverage: **101/124 test files (81%)** — 23 files missing, all tracked in TODO.md.
- `any`-type debt: backend tests 129 (was 215), production code 62, dashboard 0, agent 0. Tracked in TODO.md.
- Typecheck clean across backend + agent + dashboard.
- Dashboard ESLint clean.
- Drift detector (`npm run verify:claude-md`) clean.

## Next steps — in order

Open NEEDS-REFACTORING items (3 total):

1. **#10 broader extraction** — Provider-quirk push/pull skeleton across the 4 CRM sync modules. Verified-and-deferred 2026-05-04 under "working flat code beats a dormant abstraction". Re-evaluate when a 5th provider arrives.
2. **#11 deferred part** — Drop `withTenantClient` from `register*Routes` signatures. Verify-first found low ROI vs ~3-4h test-rewrite cost; defer.
3. **#14 — `pw.txt`** — User judgment call: real password or scratch note? File is gitignored, never committed.

External / user blockers (carry forward from prior snapshot, none resolved):

4. **(External — Telnyx PSTN)** Wait for / chase the re-submitted ticket. Original `#2850682` (2026-04-27) abandoned 2026-05-01 after 4 days without a human response. Ticket was re-submitted to LERG/porting team 2026-05-01; no update. Done signal: an inbound CDR finally appears for `+1-630-937-9478` in Mission Control Portal.
5. **(User, ~2 min)** Set `DASHBOARD_URL=https://dashboard-production-cee3.up.railway.app` on Railway → ai-sec service → Variables. Outstanding 9+ days. Done signal: Stripe checkout + OAuth redirects work in browser test.
6. **(User pre-flight + apply, ~30 min)** Apply migrations `20260501000000` + `20260501000001` to prod Supabase. Pre-flight overlap-scan needed first; see `docs/TODO.md` Phase 13.

Pickable today (Claude can act, no external dependency):

7. **Continue backend `any`-type cleanup** — 129 instances remaining across ~30 files at smaller per-file counts.
8. **Audit `any` types in backend production code** — 62 instances; per-file disposition (replace vs justify).
9. **5W backfill remaining 23 test files** — ceremony-vs-value review per file.
10. **Mock-mode handleCreate guard test** — closes the partial entry from `2cd381a`.
11. **Pre-launch hardening items** in `docs/TODO.md`: timezone/DST audit, hide Back Office tabs, multi-tenant isolation probe, observability (logs/metrics/Sentry), etc.
12. **Communications & Reminders integration Phase 1+** — DatabaseService adapter, `reminder_schedules` migration, real-provider wiring.

## Open questions / unresolved

- **No customer pipeline visibility into "which CRM does the next beta candidate use?"** Carries forward from prior snapshot. Test-or-delete policy is correct but pushes the burden onto the next sales conversation to surface a CRM request.
- **Pricing tiers (Pro / Enterprise) — IDs in env, no positioning.** Decide before pricing is shown to a public-facing customer.

## External state to be aware of

- **Telnyx ticket** — re-submitted 2026-05-01 to LERG/porting team. Test phone `+1-630-937-9478` still unreachable from PSTN; zero inbound CDRs since 2026-04-25. See `docs/TICKET_SUPPORT.md`.
- **Railway** — backend (`ai-sec-production`) and agent (`ai-sec-agent`) services running. Last push `faf3056` auto-deployed.
- **LiveKit Cloud** — project "AI-Secretary", US Central. Dispatch rule `SDR_if97ky4Zf7e6` routes to agent name `ai-secretary-agent`.
- **Supabase production** — through migration `20260430000002_drop_employee_shifts.sql` (80 migrations applied). **Two newer migrations** (`20260501000000` + `20260501000001`) shipped to repo but NOT yet applied. See user-action #6 above.
- **Stripe** — webhook registered at backend `/billing/webhook`. Silently fails OAuth/checkout redirects until `DASHBOARD_URL` is set on Railway (user-action #5).
- **Local Postgres** — `dbf53d93533e_ai-sec-db` container started today for the get_effective_shifts test verification + the rest of the session's real-DB runs. Still running at session close.
- **Local git** — `hold-tenant-config` branch still exists, superseded by `2119451`. Safe to delete.
