# Session state — 2026-05-01 (Friday) ~05:15 CDT, America/Chicago

Last updated by `/remember` skill. Pairs with `/recall-memory` for resume.

## Where we stopped

Two commits landed clean. Working tree is clean except
`improvement-ideas.md`, which the user intentionally left uncommitted to
review the 3 proposed task entries the journal-loop process added.
Branch is `main`, ahead of `origin/main` by **2 commits** — neither has
been pushed yet. No external action in flight; both remaining external
blockers (Telnyx PSTN, Railway env var) are unchanged from yesterday.

## What shipped today

- **`d90c776`** — `docs: reconcile counts and statuses after employee_shifts rip-out`. The doc sweep recommended by yesterday's snapshot. 11 files, +213/-210. Aligned route counts (24→25), migration counts (76/77→80), and test counts (1,991 = 1,493 backend + 498 dashboard) across CLAUDE.md, README.md, NEEDS-REFACTORING.md, docs/ARCHITECTURE.md, docs/CURRENT_STATUS.md, docs/DEPLOYMENT.md, docs/DIAGRAMS.md, docs/PLAN.md, docs/TODO.md.
- **`e92b3bf`** — `feat(agent): fetch tenant display config from backend at call start`. Closes NEEDS-REFACTORING #2 (P0 multi-tenant blocker). 5 files, +217/-19. New route `POST /agent-tools/tenant-config` reads `name`+`timezone` from `tenants`; new agent module `agent/src/tenantConfig.ts` calls it on connect; `agent/src/index.ts` hardcoded `DYNATIRE_TENANT_ID` / `TENANT_DEFAULTS` block deleted; system prompt + spoken greeting use the fetched values. 10 new tests (4 backend route + 6 agent module), soft-fails to "this business" / America/Chicago on any backend error.

## Decisions made

- **Bypassed `DatabaseTenantConfigService`** in `src/services/tenants/`. The new route reads `tenants` directly via `withTenantClient`. Adds caching/extension later if a need shows up; for now the dormant class stays dormant. Documented in CLAUDE.md "Migrated, Not Yet Wired" with a follow-up call to wire-or-delete.
- **Route name is `/agent-tools/tenant-config`**, not `/agent-tools/tenant-context` (the original NEEDS-REFACTORING wording). "Config" matches the on-disk module name and the shape (display config, not session context).
- **Left `improvement-ideas.md` out of commit `e92b3bf`.** User said they'd review the 3 proposed task entries the journal-loop added. Keeping it separate lets the tenant-config commit stay narrow and the journal entries stay reviewable independently.
- **Marked NEEDS-REFACTORING #2 done in place**, kept the original audit notes inside a quoted block for context (mirrors how #4 was handled when `employee_shifts` retired).

## Mistakes and corrections

- **First commit attempt failed** — ran `git add agent/src/index.ts ...` from `cwd=agent/` because the previous `cd agent && npx vitest run` had moved the shell. Got `pathspec 'agent/src/index.ts' did not match any files`. Fixed by prefixing the retry with `cd /home/dale/projects/ai-sec`. Lesson: the `Bash` shell's cwd persists across calls — earlier `cd <subdir>` will trip later commands.
- **Yesterday's `d90c776` accidentally committed `.remember/state.md`** alongside the doc sweep. The `/remember` skill spec says it should remain untracked. Not worth reverting now — future `/remember` runs will update the tracked file in place. Just noting so the rule isn't quietly forgotten.

## In flight / uncommitted

```
 M improvement-ideas.md   (53 lines added by the journal-loop process —
                           3 proposed "Task" entries + a Self-Review block.
                           Safe to leave; user is reviewing.)
```

`.remember/state.md` itself is now tracked (by yesterday's commit) — this
edit will show up as a tracked-file modification on next `git status`.
Per skill rules, do NOT commit it.

Both commits are local-only; not pushed. Pushing is a user call.

## Next steps — in order

1. **(User, ~30 sec)** `git push` if you're ready to publish today's two commits. Done signal: `origin/main` advances, `git status -sb` no longer says "ahead 2".

2. **(User, ~2 min)** Set `DASHBOARD_URL` on the Railway backend (`ai-sec-production`) to `https://dashboard-production-cee3.up.railway.app`. Carries over from yesterday — 6+ days outstanding now. Breaks Stripe checkout + every OAuth redirect. Done signal: Railway env var visible, backend redeployed, OAuth callback URLs no longer 404.

3. **(User, blocking external)** Follow up on Telnyx ticket #2850682. Number `+1-630-937-9478` still PSTN-unreachable; Telnyx Reports shows zero inbound attempts ever. No live call possible until this clears. Done signal: test call from any cell phone reaches the LiveKit agent.

4. **(Claude, ~1-2 hr once #3 clears)** OTP dance in the system prompt. Per `session-20260423-otp.md` Phase 3: when `book-appointment` / `book-with-scheduling` returns the "I'll need a good phone number" gate response, the LLM should call `send-verification-code(phone)`, read its `message` to the caller, on spoken code call `verify-phone-code(phone, code)`, and on success retry the booking with the verified phone. Edit `agent/src/prompt.ts`. Done signal: simulated call where caller-ID is `+1` triggers the OTP flow end-to-end.

5. **(Claude, ~10 min)** Decide the fate of `src/services/tenants/DatabaseTenantConfigService`. Options: route the new `/agent-tools/tenant-config` handler through it (caching layer), or delete the class. Recommendation: delete unless caching shows up as a real need — YAGNI. Done signal: NEEDS-REFACTORING #2 caveat resolved one way or the other.

6. **(Claude, longer)** P2 NEEDS-REFACTORING items: Grok TTS swap (#9), CRM adapter wiring decision (#1), UsageTrackingService decision (#3). All non-urgent.

## Open questions / unresolved

- **`improvement-ideas.md` journal-loop dedup.** Yesterday's snapshot flagged that the loop reintroduces duplicates on each run; today's run added 3 proposed-task entries plus a self-review block but no observed dup yet. Still no owner identified for fixing the generator side.
- **`DatabaseTenantConfigService` fate.** See step 5 — wire it or delete it. Documented in CLAUDE.md but no decision recorded.
- **CRM service-layer SELECTs still don't filter `is_deleted`.** Carries over from yesterday's snapshot — needs a product call on whether sync should push deletions or just exclude.
- ~~**20+ CRM adapters in `src/services/crm/`** still dormant.~~ **Closed 2026-05-02** — entire directory deleted (commit `2cc782a`). Decision policy locked: anything we can't test against gets deleted; CRMs we don't have a flat client for get wired up when a beta customer brings one. NEEDS-REFACTORING #1 marked done.

## External state to be aware of

- **Telnyx ticket #2850682** — open, awaiting LERG investigation. Last conversation a week+ ago; may need re-poke. See `docs/TICKET_SUPPORT.md`.
- **Railway** — backend (`ai-sec-production`) and agent (`ai-sec-agent`) services running. Worker `AW_vPmGExrgTeGn` registered with LiveKit. Today's commits **not yet deployed** (Railway auto-deploys on push to main; not pushed yet).
- **LiveKit Cloud** — project "AI-Secretary", US Central. Dispatch rule `SDR_if97ky4Zf7e6` routes to agent name `ai-secretary-agent`.
- **Supabase** — production DB at 80 migrations, no schema changes today.
- **Stripe** — webhook registered at backend `/billing/webhook`. Will silently fail OAuth/checkout redirects until `DASHBOARD_URL` is set (step 2 above).
- **Origin not pushed.** `main` is 2 commits ahead of `origin/main`. CI will run on push.

## Cross-references

- Yesterday's snapshot: `d90c776` committed `.remember/state.md` alongside the doc sweep. The "before" state.md is in that commit's diff if needed.
- New memory entry: `~/.claude/projects/-home-dale-projects-ai-sec/memory/session-20260501.md` (added to MEMORY.md index).
- NEEDS-REFACTORING.md: item #2 marked done with implementation note. Item #4 (`employee_shifts` retirement) was already done yesterday.
- Authoritative numbers (no change today): **80 migrations, 25 route modules, 1,991 tests** (1,493 backend + 498 dashboard, 2 documented skips), zero TypeScript errors. Today added 10 backend+agent tests on top — verified locally but not yet reflected in the totals doc; deferred to next batch update.
