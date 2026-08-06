# Branch / PR Merge Inventory

**Snapshot: 2026-08-06.** Every branch that exists locally or on `origin`, ordered oldest → youngest by tip-commit timestamp.

Regenerate the raw data with:

```bash
git fetch --prune
git branch -a --no-merged main
gh pr list --head <branch> --state all --json number,state,mergedAt,title
git log -1 --format='%ad' --date=format:'%Y-%m-%d %H:%M' <ref>
```

Column meanings:

- **Tip commit** — `git log -1` on the branch (prefers `origin/<branch>` when it exists).
- **First commit** — first commit after `git merge-base main <ref>`, i.e. when the branch's own work started. `—` means zero commits ahead.
- **Cmts** — commits ahead of the merge-base.
- **In `main`?** — whether the branch's content has shipped. Squash-merged PRs leave the branch tip unreachable from `main` even though the code landed, so `git branch --merged` under-reports; the PR state is the authority.
- **Hash** — the branch tip. Kept **after** the branch is deleted: the hash is what restores the exact tree (`git branch <name> <hash>`). Recorded here and in the `branch-hash-anchors` memory. A hash whose PR was merged is immortal — it is an ancestor of `main` via the squash commit. A hash on an unmerged branch is not, and needs the PR ref or a re-push to survive git GC.
- **PURGED** in the State column means the branch was deleted deliberately after its content was verified present in `main`.

## The table

| # | Tip commit | First commit | Cmts | Branch | PR | State | In `main`? | Hash |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-07-12 01:02 | 07-11 22:22 | 2 | `feat/setup-removal-impact-warning` | #240 | MERGED → **PURGED** 2026-08-06 | yes | `062cd67b8a7ed909551c18603336e19f0191db71` |
| 2 | 2026-07-12 18:37 | 07-12 18:37 | 2 | `chore/blueprints-plan-and-deno-cleanup` | — | no PR → **SUPERSEDED**, ready to purge | **no** | `75553c253a95a34028ababd57ca1baf19ce2f6d8` |
| 3 | 2026-07-14 05:14 | 07-14 03:03 | 2 | `feat/phone-verification-kill-switch` | #260 | CLOSED (dup of #262) | **no** | `ddd902414b17d74aa01ddd965bb1edd854d299d5` |
| 4 | 2026-07-14 09:29 | 07-14 05:18 | 11 | `fix/tool-calling-reliability` | #261 | MERGED | yes | `dd1c9e1ea89dd75d274b3f8dd64014611d2f56a4` |
| 5 | 2026-07-14 09:43 | 07-14 09:43 | 1 | `feat/otp-kill-switch` | #262 | MERGED | yes | `3cafc58e8eeda27edd8939815cfb9f3a1ac18d88` |
| 6 | 2026-07-15 06:42 | — | 0 | `spike/task-group-ladder` | #264 | MERGED | yes | `59651f3ec06695d483c436f2c15b5a4f9ef5a8e5` |
| 7 | 2026-07-20 15:25 | — | 0 | `rung-architecture` | — | no PR (deliberate anchor) | yes | `909c8f2e8fffce3ee904827cfe38472824b8d94f` |
| 8 | 2026-07-21 01:37 | 07-21 01:37 | 1 | `feat/usage-billing-statement` | — | no PR | **no** (wip) | `556fd45132bdd7ecca9ca4d5111fae6b5515c1a8` |
| 9 | 2026-07-21 15:08 | 07-21 01:40 | 11 | `feat/question-tree-architecture` | #292 | MERGED | yes | `b64c84925a4c4cb602c0d450f3a2062e052eb916` |
| 10 | 2026-07-22 03:45 | 07-22 03:11 | 6 | `feat/templates-list-services` | #294 | MERGED | yes | `5629355b8e2dcce729a2365ddb6b7d574bc146a9` |
| 11 | 2026-07-27 04:18 | 07-23 13:35 | 6 | `feat/message-default-transfer-guard-name-backfill` | #296 MERGED / #297 CLOSED | mixed | partial | `057867ab5504a04f0959eae641ef659317a82393` |
| 12 | 2026-07-27 05:44 | 07-27 05:44 | 1 | `docs/deploy-gate-lesson` | #299 | MERGED | yes | `43c389b0420c6f06288466a9e9aaecc7327ffb83` |
| 13 | 2026-07-28 04:24 | — | 0 | `fix/forgot-password-email-delivery` | #305 | MERGED | yes | `63f0c75b1831ec60acd80198319fd9a0a2bdc9c5` |
| 14 | 2026-08-03 12:32 | 08-03 12:32 | 1 | `feat/wire-otp-identity-tools` | #318 | **OPEN** | **no** | `40931c2f4e8669f4f549178b6d5a0c71f9c5a3bf` |
| 15 | 2026-08-03 14:41 | 08-03 14:41 | 1 | `chore/rename-ai-sec-to-secretary-hq` | #319 | MERGED | yes | `1442acf85c1c236a5b5ad0f4027361bfd3a6da8d` |
| 16 | 2026-08-03 15:57 | 08-03 15:57 | 1 | `fix/sim-tools-rls-tenant-context` | #320 | MERGED | yes | `356ccd3c0c83b94ba38520413bf0d35328a18ef6` |
| 17 | 2026-08-04 16:15 | 08-04 16:15 | 1 | `docs/stripe-setup-split` | #321 | **OPEN** | **no** | `8130307d1b5ec4b5f9dd277e792b9b479b407d76` |
| 18 | 2026-08-05 15:19 | 08-04 16:41 | 3 | `feat/branded-html-emails` | #322 | **OPEN** | **no** | `9fe56e17dadd249b2d9eceec769fd9e9614ab628` |
| 19 | 2026-08-06 11:58 | 08-06 11:58 | 1 | `chore/deno-toolchain-removal` | **#323** | **OPEN**, blocked by GitHub outage — replaces row 2 | **no** | `71e413c023dab4535de0fba2936c36ff0d964d8c` |
| 20 | 2026-08-06 12:14 | 08-06 12:14 | 1 | `docs/business-blueprints-spec` | *no PR yet* | **NEW**, pushed — salvage off row 2 | **no** | `1e96bc5c489c6ada949881807397111ac3b9a084` |

Rows 6, 7 and 13 show 0 commits ahead — their tips are already reachable from `main`, so there is nothing to merge.

### PR #323 and the 2026-08-06 GitHub Actions outage — read this before diagnosing CI

PR #323 (`chore/deno-toolchain-removal`) sat `OPEN BLOCKED` with **zero checks reported** for reasons that had nothing to do with the change. GitHub Actions was in a **major outage** that day — incident "Incident with Actions" opened 15:22:49Z, still unresolved at 19:00Z, with GitHub's own status page citing delayed workflow runs, queued jobs timing out, GitHub-hosted runner capacity constraints, and delayed webhook delivery.

What that looked like locally, in case the shape recurs:

- The `CI` workflow **never queued** on `pull_request` despite `on: pull_request: branches: [main]` being correct, Actions being `enabled`, and the workflow being `active`. The Copilot review fired normally, which made it look workflow-specific rather than platform-wide.
- A manual `gh workflow run ci.yml --ref <branch>` **did** run: Backend, Agent and E2E all went green. `Dashboard (typecheck + tests)` was `cancelled` after sitting exactly 15m05s against its `timeout-minutes: 15` — it never got a runner, so no test ever executed. A cancelled-on-timeout job is not a failing job.
- Those `workflow_dispatch` check runs **did not satisfy branch protection**. The PR still reported 0 checks with 3 jobs green, because the required contexts are the ones delivered via the `pull_request` event.
- Closing and reopening the PR (to re-fire `pull_request` without an empty commit) produced no run either.

**Lesson: check <https://www.githubstatus.com> before pushing empty commits at a stuck PR.** Retriggering during an outage just adds to a queue that isn't draining.

**Related deploy hazard, from `CLAUDE.md`:** a red or missing CI run on `main` makes Railway mark that commit's deployments `SKIPPED`, and SKIPPED is **terminal** — turning CI green later does not make Railway retry, and prod sits on the previous build while every service reports healthy. During an Actions outage this is a live risk. After any merge, verify the deploy actually fired (`/health`'s `started_at` must move; `npm run status -- --env prod`) instead of assuming the merge shipped it.

### Rows 19–20: what replaced the blueprints branch (2026-08-06)

Row 2 (`chore/blueprints-plan-and-deno-cleanup`) was 172 commits behind `main` and had **no PR**, so no `refs/pull/N/head` existed to preserve it after deletion. Rather than merge it, its content was split:

- **Row 19 `chore/deno-toolchain-removal`** — the same Deno/Vapi cleanup, redone fresh off `main`. Deletes `deno.json`, `deno.lock`, `screenshot.png`, `scripts/ingest-knowledge.ts` **and `tests/template_test.ts`**, the fifth dead file the original branch missed. That last one imports from `https://deno.land/std` and calls `Deno.env.get()`; vitest never collected it (filename is `template_test.ts`, not `*.test.ts`), confirmed via `npx vitest list --run`. 706 deletions, ~305 KB. `npm run checks` clean; backend 210 files / 2637 tests passing.
- **Row 20 `docs/business-blueprints-spec`** — salvages the 327-line design spec `docs/superpowers/specs/2026-07-12-business-blueprints-design.md`, which existed **only** on row 2. Byte-identical to the original (blob `e89b176`). Status inside the doc is "design, not started". Built with `git commit-tree` against a temporary index so the working tree was never touched.

**Deliberately NOT carried over:** row 2's `docs/TODO.md` delta, which is 172 commits stale. It contained three items worth re-checking against current reality before that branch is deleted:

1. **`+1 630-866-1960` may not be dead.** The branch claimed Telnyx reported it `active`, purchased 2026-06-03, still routed to the `livekit-outbound` SIP connection — a second live front door at ~$1/mo. `CLAUDE.md` currently calls it "dead". **Unverified as of 2026-08-06** — check Telnyx before trusting either claim.
2. Supabase DB password rotation (also recorded in the `db_url.enc` memory).
3. A post-mortem on the failed inbound-STOP test: `+16308229086` had no messaging profile attached, and `tenants.inbound_phone` in prod was the transposed `+16308669086`.

Two branch/PR mismatches worth knowing:

- `fix/forgot-password-email-delivery` — the branch name says forgot-password, but PR #305 is titled *"Tree-selection accuracy: work-direction gate, buy_service tree"*. The branch was reused for unrelated work.
- `feat/otp-kill-switch` (#262) and `feat/phone-verification-kill-switch` (#260) carry the same PR title. #262 landed; #260 was closed as the duplicate.

## Merge order — why oldest-first is the wrong strategy

Oldest-first is the **highest**-resistance order here. Rows 2, 3 and 8 sit 172 / 156 / 33 commits behind `main`; merging them replays July code onto an August `main` that has since taken the RLS rollout (`app_user`), the `agentTools/` module split, and the `ai-sec → secretary-hq` rename. They would all conflict hard, and the rows already squash-merged would try to re-apply code that shipped weeks ago.

Only **3** branches genuinely need merging, and PR-number order is also the least-resistance order:

1. **#321 `docs/stripe-setup-split`** — 4/4 checks green, 0 commits behind, docs-only. Blocker: 1 unresolved review thread on `docs/TODO.md`. Cheapest, do it first.
2. **#318 `feat/wire-otp-identity-tools`** — 4/4 checks green, only 2 behind. Blocker: `mergeStateStatus: BEHIND` (branch protection sets `strict: true`). Merge `main` in, wait for the CI re-run, merge.
3. **#322 `feat/branded-html-emails`** — Blocker: Backend (typecheck + tests + integration) **FAILING**, plus 1 unresolved thread on `src/services/communications/systemEmail.ts`. Real work; do it last since it already sits on top of current `main`.

### `main` branch protection (as configured)

- Required checks (all 4): `Backend (typecheck + tests + integration)`, `Dashboard (typecheck + tests)`, `Agent (typecheck + tests)`, `E2E (Playwright)`
- `strict: true` — branch must be up to date with `main` before merging
- `required_conversation_resolution: true`
- `required_approving_review_count: 0` — no reviewer needed; every current blocker is mechanical

## The three unlanded branches that are not merges

These are decisions, not merge candidates:

- **`chore/blueprints-plan-and-deno-cleanup`** (no PR, 172 behind) — removes the dead Deno/Vapi toolchain. Most of that code is likely already gone; re-do the cleanup fresh off `main` rather than merging a July branch.
- **`feat/phone-verification-kill-switch`** (#260 CLOSED, 156 behind) — closed as the duplicate of #262, which landed. Delete.
- **`feat/usage-billing-statement`** (no PR, 33 behind) — tip commit is `wip(billing+agent)`. Cherry-pick if the work is still wanted; otherwise delete.

Also unresolved: **`feat/message-default-transfer-guard-name-backfill`** — #296 merged 2026-07-23, but commit `057867a` (2026-07-27, *"Message callers become customers; the tool that acted records the outcome"*) came after that merge and belonged to the closed #297. Verify whether that content landed by another route before deleting the branch.

## Safe to delete (content shipped)

Tips reachable from `main`: `fix/forgot-password-email-delivery`, `rung-architecture`, `origin/spike/task-group-ladder`.

Squash-merged (tip unreachable, content shipped): `feat/setup-removal-impact-warning` (#240), `fix/tool-calling-reliability` (#261), `feat/otp-kill-switch` (#262), `feat/question-tree-architecture` (#292), `feat/templates-list-services` (#294), `docs/deploy-gate-lesson` (#299), `chore/rename-ai-sec-to-secretary-hq` (#319), `fix/sim-tools-rls-tenant-context` (#320).

Two branches were never pushed and exist only locally: `chore/rename-ai-sec-to-secretary-hq` and `fix/sim-tools-rls-tenant-context`. Both correspond to merged PRs (#319, #320), so the pushed copies were deleted after merge.

> Merging any of these to `main` deploys to all 3 Railway services. Per `CLAUDE.md`, verify the deploy actually happened afterwards (`npm run status -- --env prod`; `/health`'s `started_at` must move) — a green merge is not a deploy.
