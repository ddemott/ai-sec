# Session state — 2026-05-01 (Friday), America/Chicago

Last updated by `/remember` skill. Pairs with `/recall-memory` for resume.

## Where we stopped

Mid-session doc sweep. User asked "Update all *.md files. Make sure they
are all relevant... statuses/dates etc... up to date." The sweep is
complete in the working tree but **not committed**. After the sweep, user
asked for a customer-hat critique of what's missing/broken in the
product — that report was delivered verbally in chat and is mirrored at
the end of this snapshot under "Customer-hat punchlist."

No external blockers tied to today's work. The standing blocker
(Telnyx number `+1-630-937-9478` PSTN-unreachable) is unchanged from
yesterday — see external state below.

## What shipped today

**Nothing committed.** Everything below is uncommitted in the working
tree. The session was pure doc reconciliation.

## Decisions made

- Kept session memory files frozen — only updated current-truth files
  (CLAUDE.md, README.md, etc.) since session-* files are intentionally
  point-in-time records.
- Marked NEEDS-REFACTORING #6 (`src/core/`) as done after verifying
  directory was already deleted and tests live at `src/scheduling.test.ts`.
  Option A from the original options block was effectively chosen.
- Kept historical FIXED entries in `docs/BUGS.md` untouched — those are
  audit trail, not current state.

## Mistakes and corrections

- **Initially missed CLAUDE.md line 207 "Project Status" block** during
  the count refresh. Found it via grep and updated to 1,991 tests
  (1,493 backend + 498 dashboard, verified 2026-04-30).
- **Tried to edit `docs/DEPLOYMENT.md` without reading it first** —
  Edit tool errored. Read first, then edited.
- **Briefly looked for `SUMMARY-2026-04-24-0030.md` in repo root** based
  on the stale git status snapshot from session start. It was archived
  to `docs/sessions/2026-04-24-summary.md` in commit `bea6129` (one of
  yesterday's). No action needed — the archive is the right state.

## In flight / uncommitted

```
 M CLAUDE.md              (route count 24→25, migration count 77→80,
                           test count line 207 → 1,991)
 M NEEDS-REFACTORING.md   (#6 src/core/ marked done)
 M README.md              (status table tests 2,022→1,991, route count
                           24→25, migration count 76→80, test invocation
                           counts updated)
 M docs/ARCHITECTURE.md   (last-verified line, line 43 migration count,
                           §18.1 pyramid, §18.2/3 test counts)
 M docs/CURRENT_STATUS.md (5W diag count, migration apply note, test
                           summary table)
 M docs/DEPLOYMENT.md     (migration count + recent migration list)
 M docs/DIAGRAMS.md       (Postgres node migration count)
 M docs/PLAN.md           (already touched yesterday: /coverage/staffing
                           note about employee_shifts rip-out)
 M docs/TODO.md           (last-updated date 2026-04-27→2026-04-30,
                           CI test counts)
```

Plus untracked:
```
?? .remember/        (this file — intentionally untracked per skill)
```

Safe to leave overnight. Pure doc edits, no half-finished refactors.
Commit recommendation: single commit, message like
`docs: reconcile counts and statuses after employee_shifts rip-out`.

## Next steps — in order

1. **(Claude or user, ~1 min)** Commit the doc sweep. Single commit,
   no overhead. **Done signal:** `git status` clean except `.remember/`.

2. **(User, ~2 min)** Set `DASHBOARD_URL` env var on Railway backend
   service to `https://dashboard-production-cee3.up.railway.app`. This
   is a 5+ day outstanding 2-min fix that breaks Stripe checkout and
   every OAuth redirect for real customers. **Done signal:** Railway
   variable visible, backend redeployed.

3. **(User, blocking external)** Follow up on Telnyx ticket #2850682.
   Number `+1-630-937-9478` still unreachable from PSTN; Telnyx Reports
   shows zero inbound attempts ever. Without this, no live call can ever
   complete — beta testing with DynaTire blocked. **Done signal:** test
   call from any cell phone reaches the LiveKit agent.

4. **(Claude, ~30 min once #3 unblocks)** Wire
   `DatabaseTenantConfigService` into the agent worker. Today, the
   agent hardcodes DynaTire's name and timezone in `agent/src/index.ts`.
   Multi-tenant prod is theatrical until this lands. **Done signal:**
   second tenant call greets with their business name, not "DynaTire."

5. **(Claude, ~1-2 hours)** Update voice AI system prompt to teach the
   LLM the OTP dance (Phase 3 TODO from CLAUDE.md / session-20260423-otp).
   Without this, first call with partial caller-ID will hang on the
   booking gate. **Done signal:** simulated call where caller-ID is `+1`
   triggers send-verification-code → verify-phone-code → retry booking.

6. **(Claude, longer)** NEEDS-REFACTORING P2 items: Grok TTS swap (#9),
   adapter wiring decisions, etc. Lower priority until 2-5 done.

## Open questions / unresolved

- Whether the within-file dedup of `docs/IMPROVEMENT_IDEAS.md` /
  `improvement-ideas.md` needs a generator-side fix to stop the
  recurrence. Both files were dedup'd yesterday but the journal-loop
  process that writes them will reintroduce duplicates on next run.
  No owner identified for the generator fix yet.
- CRM service-layer SELECT queries (hubspotSync/squareSync/jobberSync/
  servicetitanSync/calendarSync) still include soft-deleted records.
  Per yesterday's TODO: needs product call on whether sync should push
  deletions or just exclude.
- Whether to ever wire the 20+ CRM adapters in `src/services/crm/` —
  they exist in code, marketing implies they work, but no routes
  register them. Decision: wire them, drop them, or document as "Pro
  tier roadmap"?

## External state to be aware of

- **Telnyx ticket #2850682** — open, awaiting LERG investigation.
  Last touch over a week ago in conversation. May need re-poke.
  See `docs/TICKET_SUPPORT.md` (archived from repo root in commit
  `62eef5b`).
- **Railway** — backend (`ai-sec-production`) and agent
  (`ai-sec-agent`) services running. Worker `AW_vPmGExrgTeGn`
  registered with LiveKit. Awaiting first live call to confirm
  carrier propagation.
- **LiveKit Cloud** — project "AI-Secretary", US Central. Dispatch
  rule `SDR_if97ky4Zf7e6` routes to agent name `ai-secretary-agent`.
- **Supabase** — production DB at 80 migrations, most recent applied
  is `20260430000002_drop_employee_shifts.sql`.
- **Stripe** — webhook registered at backend `/billing/webhook`.
  Will silently fail OAuth/checkout redirects until `DASHBOARD_URL`
  is set on backend Railway env.

## Customer-hat punchlist (delivered to user verbally; mirrored here)

These are the gaps a paying customer would hit. Ordered by severity.

**🔴 Showstoppers**

1. Phone doesn't answer. Telnyx number unreachable from PSTN, 5+ days.
2. `DASHBOARD_URL` env var missing → Stripe checkout + OAuth break.
3. Multi-tenancy theatrical. Agent hardcodes DynaTire's name + tz.

**🟠 First-call failure modes**

4. Voice path never validated end-to-end in production.
5. OTP gate boxes callers in — system prompt missing the dance.
6. Reminders worker logic correct but never validated against
   real Telnyx delivery.

**🟡 Half-systems**

7. UsageTrackingService is in-memory only — no metered billing.
8. No subscription management UI; users must email to cancel.
9. Consent / TCPA / GDPR types and tables exist; **no UI** for opt-outs.
10. Marketing claims 6 verticals; only 5 templates, 3 generic-mapped.
11. 20+ CRM adapters in code, none wired.
12. Analytics 3/6 metrics live; the other 3 still placeholders.

**🟢 Polish**

13. No password reset, no "Remember me" with refresh tokens.
14. No skeleton screens, no first-run nav callout.
15. No production error tracking (Sentry/etc).
16. No `/health` alerting.
17. No DB backup runbook.
18. `setup-db.sh` heredoc bug documented, not fixed.

## Cross-references

- Yesterday's massive day: 30+ commits ending in `127f48e` (drop
  employee_shifts). Full commit log this week is in conversation context.
- Authoritative numbers (verified 2026-04-30): **80 migrations,
  25 route modules, 1,991 tests (1,493 backend + 498 dashboard,
  2 documented skips)**, zero TypeScript errors.
- Memory entry for today: not creating one — session was a doc-only
  reconciliation, doesn't add knowledge that future-me needs in
  permanent memory beyond what CLAUDE.md/MEMORY.md already track.
