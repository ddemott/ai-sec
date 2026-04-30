# Session state — 2026-04-29 (Wednesday)

Last updated by `/remember` skill. Pairs with `/recall-memory` for resume.

## Where we stopped

Doc-only working session. Mapped the codebase end-to-end, surfaced
~10 architectural surprises CLAUDE.md hadn't captured, updated CLAUDE.md
with surgical edits, and created `NEEDS-REFACTORING.md` (18 prioritized
items across P0–P3). Last action was inserting the Grok TTS migration
as item #9 (P2) per user request.

**No code commits today.** No live-call testing was attempted.
The Telnyx PSTN reachability blocker from Saturday's session
(`+1 (630) 937-9478` → "not in service" from PSTN) is still open
unless the user resolved it offline; this session didn't touch it.

## What shipped today

**No git commits.** Everything below is uncommitted working-tree changes.

- **CLAUDE.md updated** (28 line delta) — fixed route count (24 → 25),
  migration count (76 → 77), added 8 missing directories under
  Key Directories (`/src/services/crm/`, `/src/services/communications/`,
  `/src/services/reminders/`, `/src/services/tenants/`, `/src/services/usage/`,
  `/src/database/`, `/src/workers/`, `/src/templates/`, `/src/types/`),
  noted `/supabase/functions/` is empty post-Vapi-rip-out, expanded the
  `/agent` entry to mention `tools.ts`, updated Async Workers line in
  Architecture to acknowledge the reminder scheduler, added a new
  "Migrated, Not Yet Wired" section above Known Issues calling out
  CRM adapters, UsageTrackingService stub, TenantConfigService unwired,
  consent UI gap, and the dead `medical_v1.yaml` template.

- **NEEDS-REFACTORING.md created** (~230 lines, 18 items) — new file
  at repo root, structured P0–P3:
  - P0 (3 items): CRM adapter layer fate, wire TenantConfigService into
    agent, resolve UsageTrackingService stub.
  - P1 (5 items): drop `employee_shifts` legacy table, delete
    `medical_v1.yaml`, resolve `src/core/`, reconcile
    `MIGRATED_FROM_AI_SECRETARY.md`, consolidate bug-named test files.
  - P2 (5 items): switch agent TTS OpenAI → Grok (Phase 4) [#9, added
    last per user], extract shared CRM sync structure, audit `src/index.ts`
    (385 lines), prune/split `improvement-ideas.md` (142KB), CLAUDE.md
    drift detection.
  - P3 (5 items): `pw.txt` mystery, `.log` files at root, archive
    session-summary docs, `.Clairvoyance/`+`.gemini/` cleanup,
    `coverage/` from working tree.

## Decisions made

- **NEEDS-REFACTORING.md is for structural cleanup of existing code,
  not new features.** Feature/improvement items continue to live in
  `improvement-ideas.md`. Footer makes the split explicit so future
  contributors don't dump unrelated items here.
- **Grok TTS migration placed at P2, not P0/P1.** Current OpenAI TTS
  works (not a blocker); the code is in active use (not dead). Treated
  it as planned vendor migration with cost/risk implications. Noted in
  the file that the user can bump priority on request.
- **Did NOT recommend consolidating the two booking RPCs** —
  verified both `book_appointment_atomic()` and
  `book_with_scheduling_atomic()` are in active use in
  `src/routes/agentTools.ts` for distinct purposes. Initial assumption
  they were redundant was wrong.
- **Did NOT recommend deleting `src/types/voiceCrm.ts`** — verified
  `src/routes/voice.ts` imports from it. Not legacy.
- **CLAUDE.md route count is 25, not 27** as the Explore agent
  initially claimed. Verified by `ls src/routes/*.ts | grep -v test |
  grep -v routeHelpers | wc -l` = 25.
- **CLAUDE.md migration count is 77.** `ls supabase/migrations/*.sql |
  wc -l` = 77 today.
- **The dormant CRM adapter layer in `src/services/crm/` is real
  code, not stubs.** ~20 adapter classes (Mindbody, Vagaro, Acuity,
  Salesforce, etc.) with a `BaseCRMAdapter` interface and registry
  factory. Zero routes consume them. P0 item with three explicit options
  (migrate flat clients, delete adapters, or park explicitly).

## Mistakes and corrections

- **Initial Explore-agent claim of "27 route modules" was wrong.**
  Caught by running `ls src/routes/*.ts | grep -v test | grep -v
  routeHelpers | wc -l` myself before writing CLAUDE.md. Actual count
  is 25. Lesson: verify counts directly when the source is an agent
  summary, not a primary measurement.
- **Wrote "80 SQL migrations" in the first CLAUDE.md edit; corrected
  to 77.** Same root cause as above — the Explore agent gave a number
  without me verifying. Fixed in a follow-up edit before finishing.
- **Initially considered recommending `voiceCrm.ts` deletion as
  "legacy".** Pre-flight grep showed `src/routes/voice.ts` imports it.
  Removed from the refactor list before publishing. Lesson: grep before
  classifying anything as "legacy" — type files especially are easy to
  miss because they don't show up in service-flow tracing.
- **Initially considered recommending consolidation of the two
  booking RPCs.** Pre-flight grep showed both are wired into
  `agentTools.ts` for different purposes. Removed before publishing.

## In flight / uncommitted

All low-risk. None block walking away.

- **`CLAUDE.md`** — today's surgical edits (route/migration counts,
  Key Directories additions, "Migrated, Not Yet Wired" section). Clean,
  reviewed in this session, ready to commit whenever the user wants.
- **`NEEDS-REFACTORING.md`** — new file, ~230 lines, 18 prioritized
  items. Untracked (`??` in git status). Ready to commit.
- **`agent/src/index.ts`** — Saturday's `agentName` + `jobMetadata`
  changes, still uncommitted. Critical to LiveKit dispatch wiring.
  Per the prior `/remember` snapshot, plan is to commit after first
  successful PSTN call. Today's session did not touch this file.
- **`agent/src/sessionContext.ts`** — Saturday's `buildSessionContext`
  jobMetadata fallback. Same status as above.
- **`SUMMARY-2026-04-24-0030.md`** — touched but not reviewed by me
  this session. Likely Saturday's doc adjustments. Safe.
- **`improvement-ideas.md`** — 374 lines added by automated process,
  not this session. Same as prior snapshots. Safe to leave.
- **`supabase/.temp/cli-latest`** — transient. Ignore.
- **`.remember/`** — this snapshot. Untracked by design.

## Next steps — in order

1. **USER (~5 min, anytime):** Test the Telnyx number `+1 (630)
   937-9478` from a non-cell source (Google Voice / different carrier).
   Open from Saturday's session. Outcomes are the same as that snapshot
   described — connect = LNP cache lag (wait); fail = open Telnyx
   support ticket Monday-style with the same diagnostic ("Number Active,
   SIP Connection routed, zero inbound attempts on Reports for 4+ days").

2. **CLAUDE (~5 min, after first successful call):** Commit the
   uncommitted agent/src changes as planned in Saturday's snapshot.
   Files: `agent/src/index.ts`, `agent/src/sessionContext.ts`. Suggested
   message: *"feat(agent): wire agentName + job metadata fallback for
   LiveKit dispatch."*

3. **CLAUDE (~5 min, anytime — independent of the call):** Commit
   today's documentation work. Suggested groupings:
   - `docs(claude): expand Key Directories, add "Migrated, Not Yet
     Wired" section`
   - `docs: add NEEDS-REFACTORING.md backlog (18 items, P0–P3)`
   These are clean and reviewable; no reason to wait on the live call.

4. **CLAUDE (~5 min, after first successful call):** Update DynaTire's
   `tenants.inbound_phone` from `+16303970194` to `+16309379478` (carried
   over from Saturday's snapshot).

5. **USER decision (~5 min, blocking the next two refactor items):**
   Decide CRM adapter fate (NEEDS-REFACTORING #1) — A migrate, B delete,
   or C park. The decision sequences any extraction work on
   jobber/hubspot/square/servicetitan sync (#10), since option A
   subsumes #10.

6. **CLAUDE (~30 min, post-stable, easy P3 wins):** NEEDS-REFACTORING
   items #14 (`pw.txt`), #15 (`.log` files), #17 (`.Clairvoyance/`,
   `.gemini/`), #18 (`coverage/` cleanup). All are <10 min each, no
   external dependencies. Could batch into one chore commit.

7. **CLAUDE (variable):** Phase 4 — Grok TTS migration (NEEDS-REFACTORING
   #9). The full plan is in that file's #9 entry.

## Open questions / unresolved

- **Is the Telnyx number reachable from PSTN yet?** Saturday's blocker
  was 8+ hours into "Active but zero inbound attempts on Reports".
  Today is +4 days. Not checked this session — the user parked it.
- **Did the user open the email yet?** Mentioned at session start that
  it was outside business hours; we parked it. Unrelated to code work.
- **CRM adapter fate (NEEDS-REFACTORING #1).** Three live options;
  the user hasn't picked. Sequences task #10.
- **`pw.txt`** — single-line file at repo root from 2026-03-01. Did
  not read its contents (might be sensitive). Needs a 30-second
  user-driven check.
- **Should `medical_v1.yaml` actually be deleted, or kept as a "we
  considered medical and ruled it out" historical artifact?**
  CLAUDE.md says HIPAA verticals are permanently excluded. Deleting
  is safe, but a one-line rationale comment in a remaining template
  might preserve the policy intent.

## External state to be aware of

- **Telnyx account** — number `+1 (630) 937-9478` purchased and
  Active. SIP Connection `livekit-outbound` configured. Status as of
  Saturday: PSTN unreachable, zero inbound attempts in Telnyx Reports.
  Not re-checked today.
- **LiveKit Cloud "AI-Secretary" project (US Central)** — trunk
  `ST_Li58t3gXgo4N`, dispatch rule `SDR_if97ky4Zf7e6`, worker
  `AW_vPmGExrgTeGn` registered. Untouched today.
- **Railway** — `ai-sec` (backend) and `ai-sec-agent` (worker)
  services in `joyful-spontaneity` project. No deploys today.
- **Supabase** — production DB. `tenants.inbound_phone` for DynaTire
  still has the old `+16303970194`. Pending step #4 above.
- **Vapi account** — still deleted. No residual state.
- **Local DB** (Docker port 5433) — untouched today.
- **Dashboard** (Railway: dashboard-production-cee3.up.railway.app) —
  untouched today. Still needs `DASHBOARD_URL` env var on the backend
  Railway service for Stripe/OAuth redirects (carried-over open item).
