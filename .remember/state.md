# Session state — 2026-05-03 03:04 CDT (Sunday early-morning)

Last updated by `/remember` skill. Pairs with `/recall-memory` for resume.

## Where we stopped

Three commits pushed today, working tree clean except for the
intentional `.remember/state.md` dirt. The session was a pair of
"claimed shipped, actually wasn't" closures — both surfaced by the
voice-fallback validation and both fixed in the same session — plus
a doc sweep that added explicit IN FLIGHT markers across the backlog
so future sessions can scan state at a glance. **Nothing is partially
done in code; the only in-flight items are blocked-on-someone-else
(Telnyx, the user setting `DASHBOARD_URL`, prod migration apply).**

## What shipped today

3 commits, all on main, all pushed to `origin/main`:

- **`6488dc4`** — `feat(agent): validate runFallback dead-air guard, fix the gap`. The validation surfaced a real production-safety gap. Docs across CLAUDE.md / ARCHITECTURE.md / NEEDS-REFACTORING.md #9 / FRAMEWORK_MIGRATIONS.md had all claimed `runFallback()` used OpenAI TTS as a guard against Grok outage; the actual code on main wired GrokTTS in **both** the primary path AND the fallback. A Grok outage during a fallback call would have produced dead air — exactly the failure mode the path was supposed to protect against. Three closures: extracted `runFallback()` to `agent/src/fallback.ts` with injectable provider deps + a `FallbackConfig` arg (so the function is testable without going through the env-validation `process.exit(1)` in `./config.js`); switched the fallback's TTS to OpenAI (matching what docs already claimed); `await`ed `session.say()` so synthesis-time failures are caught inside the try block. Pinned by 13 new 5W-annotated tests in `agent/src/fallback.test.ts`. Agent suite: 53 → 66.

- **`2119451`** — `feat(agent): wire tenant display config from backend (NEEDS-REFACTORING #2 — path B)`. The voice-fallback validation also surfaced that commit `e92b3bf` ("tenant config wiring"), claimed on 2026-05-01 to close NEEDS-REFACTORING #2, actually lived on a `hold-tenant-config` branch and was never merged to main. The agent worker on main still hardcoded DynaTire. Path B taken: redone directly on main, reusing the branch's design as a reference. New `POST /agent-tools/tenant-config` route in `src/routes/agentTools.ts` (4 backend tests). New `agent/src/tenantConfig.ts` module (6 agent-side tests). Hardcoded `DYNATIRE_TENANT_ID` / `TENANT_DEFAULTS` block deleted from `agent/src/index.ts`; the agent now greets with the real business name and reasons about "today" in the tenant's IANA zone. Soft-fails to "this business" / `America/Chicago` on any backend error so a config blip never hangs up a live caller. Backend: 1,475 → 1,479. Agent: 66 → 72. Multi-tenant production no longer blocked by the agent worker's display path.

- **`75c3ca4`** — `docs: add explicit in-flight markers across TODO + NEEDS-REFACTORING + CURRENT_STATUS`. User asked for every in-flight item to carry an explicit marker. Added a shared marker convention: `IN FLIGHT (external)` / `IN FLIGHT (user)` / `IN FLIGHT (prod-apply)` / `IN FLIGHT (decision pending)` / `IN FLIGHT (validation pending)`. Items without a marker are either complete or pickable today. New "What's in flight (between repo and prod)" table at the top of `CURRENT_STATUS.md` is the single place to see everything that's shipped to repo but not exercised in production. Top-of-file pointers in CLAUDE.md so the convention is discoverable. Test counts updated everywhere (1,479 backend + 498 dashboard = 1,977 + 2 skips; 72 agent). Stale `#2850682` references updated to reflect the 2026-05-01 supersede.

## Decisions made

- **Path B over Path A for NEEDS-REFACTORING #2.** Could have merged `hold-tenant-config` (~5 min if no conflicts) instead of redoing the work. Picked B because it's cleaner against current main (which had three `agent/src/index.ts` refactors since the branch was made — JWT extraction, pool dedup, withTenantClient extraction, fallback extraction). Branch is now superseded; nothing on it is uniquely valuable.
- **OpenAI TTS in `runFallback`, not Grok.** The whole point of the fallback path is independence from the primary path's Grok dependency. If we're in fallback specifically *because* Grok is down, using GrokTTS there reproduces the exact failure mode we wanted to escape. OpenAI uses `OPENAI_API_KEY` which is already validated at boot for the LLM, so it's strictly more available than Grok.
- **Explicit IN FLIGHT taxonomy.** Five markers (external / user / prod-apply / decision pending / validation pending) instead of "open" or "TBD". Each marker tells the reader who has the next move and why the item isn't moving. Strikethrough title + `Status: done <date> <commit>` for shipped items.
- **`session.say()` is now `await`ed inside `runFallback`.** Pre-fix, it was fire-and-forget — a synthesis-time failure became an unhandled promise rejection on the worker. Awaiting + catching makes the caller's experience identical (dead air either way) but keeps the worker process clean.
- **`FallbackConfig` is injected, not imported.** Importing `./config.js` at the top of `fallback.ts` would force the test file through the env-validation `process.exit(1)` path. Keeping config as an injected arg makes the function pure-ish.

## Mistakes and corrections

- **Mocked LiveKit constructors with arrow-function `vi.fn()` initially.** Vitest emitted "the vi.fn() mock did not use 'function' or 'class'" warnings and 8 of the new fallback tests failed because the mocks weren't `new`-able. Caught immediately on first run; rewrote with `class FakeSession`, `class FakeAgent`, etc. — second run all 13 passed.
- **First commit message claimed `runFallback()` was tested under "real conditions."** Walked back to "unit-level closed; live-PSTN exercise still requires Telnyx unblock" in the actual TODO entry. The unit tests prove the contract; only a real call proves the audio actually reaches a caller.
- **Documentation claimed two features had shipped that hadn't.** This is the meta-mistake of the session — and the same shape of bug both times. Fix going forward is in NEEDS-REFACTORING #13 (drift detector), now flagged as extra-relevant and recommending verification at the *commit-on-main* level (assert each `commit \`<hash>\`` reference in docs is reachable from `main`).

## In flight / uncommitted

Just `.remember/state.md`, modified by this very `/remember` skill invocation. Will be overwritten by the next `/remember`. Per the skill spec, do **not** commit.

Everything else clean: `git status` shows nothing else dirty, `git log @{upstream}..HEAD` shows nothing unpushed.

## Next steps — in order

The IN FLIGHT items in `docs/TODO.md` and `docs/CURRENT_STATUS.md` "What's in flight" table are the authoritative list. Top picks for a fresh session:

1. **(User, ~2 min)** Set `DASHBOARD_URL=https://dashboard-production-cee3.up.railway.app` on Railway → ai-sec service → Variables. Outstanding 6+ days. Done signal: Stripe checkout + OAuth redirects work in browser test.

2. **(External — Telnyx)** Wait for / chase the re-submitted PSTN ticket. If no human response within 24h of submission (was 2026-05-01, so escalation window already past): portal chat. 48h: call +1.888.980.9750. Done signal: an inbound CDR finally appears for `+1-630-937-9478` in Mission Control Portal. Diagnostic fallback if it stalls again: provision a second DID and observe whether it shares the symptom — if yes, wider Telnyx issue; if no, the original DID is uniquely stuck and we push for release+reissue.

3. **(User pre-flight + apply, ~30 min)** Apply migrations `20260501000000` + `20260501000001` to prod Supabase. Pre-flight: query for existing overlapping `appointments` rows on `(resource_id, time-range)` or `(employee_id, time-range)` where `status='scheduled'` AND `is_deleted=false`. Any overlap blocks the `ALTER TABLE ... ADD CONSTRAINT EXCLUDE`. Apply via `npm run db:migrate -- "$SUPABASE_URL"`. Done signal: prod has both constraints visible in `\d appointments`.

4. **(Claude, ~30 min)** Close NEEDS-REFACTORING #3 (UsageTrackingService) under the test-or-delete lens. Default disposition is delete; just needs user green-light. Same pattern as the 2026-05-02 CRM-adapter deletion. Done signal: `src/services/usage/` gone, callers in `CommunicationService` cleaned up, tests still green.

5. **(User judgment)** Resolve `pw.txt` (NEEDS-REFACTORING #14). Single-line, 17 bytes, gitignored. Real password or scratch note? User-only call.

6. **(Claude, longer)** NEEDS-REFACTORING #13 — write a `scripts/verify-claude-md.ts` drift-detector at the *commit-on-main* level. Today's two doc-vs-reality findings would have been caught by a script that asserts every `` `<hash>` `` reference in the docs is reachable from `main`. Higher priority now than it was yesterday given the demonstrated cost of the drift.

7. **(User, no rush)** Delete the superseded `hold-tenant-config` branch — `git branch -D hold-tenant-config && git push origin --delete hold-tenant-config`. Cosmetic cleanup; nothing on the branch is uniquely valuable now.

## Open questions / unresolved

- **No customer pipeline visibility into "which CRM does the next beta candidate use?"** Carries forward from yesterday. The test-or-delete policy is correct but pushes the burden onto the next sales conversation to surface a CRM request.
- **Journal-loop generator on `improvement-ideas.md` keeps producing entries that sometimes duplicate already-shipped work.** Yesterday's session and today's session both saw this. The generator needs a "check git log before proposing" pass; nobody owns that fix yet. Not blocking.
- **Pricing tiers (Pro/Enterprise) — IDs in env, no positioning.** Was open going into today, still open. Decide before pricing is shown to a public-facing customer.

## External state to be aware of

- **Telnyx ticket** — re-submitted 2026-05-01 to LERG/porting team (original `#2850682` superseded). New ticket number not yet returned by Telnyx. Test phone `+1-630-937-9478` still unreachable from PSTN; zero inbound CDRs across the entire 2026-04-25 → 2026-05-03 window. See `docs/TICKET_SUPPORT.md`.
- **Railway** — backend (`ai-sec-production`) and agent (`ai-sec-agent`) services running. Worker `AW_vPmGExrgTeGn` registered with LiveKit. Today's commits auto-deployed on push (last push `75c3ca4`). The fallback path's OpenAI TTS dependency means `OPENAI_API_KEY` must remain set on the agent's Railway env (already true).
- **LiveKit Cloud** — project "AI-Secretary", US Central. Dispatch rule `SDR_if97ky4Zf7e6` routes to agent name `ai-secretary-agent`.
- **Supabase production** — through migration `20260430000002_drop_employee_shifts.sql` (80 migrations applied). **Two newer migrations** (`20260501000000` + `20260501000001`) shipped to repo but NOT yet applied. See next-step #3.
- **Stripe** — webhook registered at backend `/billing/webhook`. Will silently fail OAuth/checkout redirects until `DASHBOARD_URL` is set on Railway (next-step #1).
- **Local Postgres** — `ai-secretary-postgres` container running on port 5438 (different project's DB; not used by ai-sec). The expected `:5433` port isn't bound by any container right now — `dbf53d93533e_ai-sec-db` container is exited. If next session needs to run real-DB tests locally, start that container first.
- **Local git** — `hold-tenant-config` branch exists, superseded by `2119451`. Safe to delete whenever convenient (next-step #7).
- **Test state at session close** — backend 1,479 + 2 skips, dashboard 498, agent 72. Typecheck clean both surfaces. Last full run was around 02:10 CDT; nothing has changed since.
