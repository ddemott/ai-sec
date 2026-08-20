# Branch / PR Merge Inventory

**Snapshot: 2026-08-20.** After #353, #356 and #354 merged and prod deployed `a8250f9`.

Regenerate the raw data with:

```bash
git fetch --prune
git branch -a --format='%(refname:short)' | sort
gh pr list --state open --json number,title,headRefName,baseRefName,url
```

## Current state

- **Open PRs: #355** — `fix(scheduling): store the weekly rule instead of guessing it back out of the rows`.
  Green on all 4 checks and mergeable, **deliberately not merged**: it ships migration
  `20260820000000_employee_schedule_pattern`, and merging before that migration is applied
  to prod makes every schedule-extender tick and every wizard finalize throw
  `relation "employee_schedule_pattern" does not exist`. Apply the migration first, then merge.
- Branch refs expected: `main` / `origin/main`, plus
  `fix/schedule-extender-stores-the-rule` (#355, open) and
  `backup/local-main-drift-e9e5439` (unmerged Grok-era voice-pacing work, **no PR, no upstream —
  its hash is not immortal**; see the `branch-hash-anchors` memory).
- Merged this session:
  - #353 `chore: delete ~810 lines of dead code — and the metrics illusion it was propping up` — `69d6bdf`
  - #356 `fix(templates): GET /templates/full publishes a stated column list, not SELECT *` — `ff9b4cc`
  - #354 `fix(security): close the name-search enumeration oracle in find-customer-by-name` — `a8250f9`

## Purged 2026-08-20

Ten branches whose PRs merged (#346, #347, #348, #349, #350, #351, #352, #353, #354, #356),
deleted local + remote. Each was verified MERGED **and** its squash commit confirmed present in
`origin/main` before deletion. Tips are recorded in the `branch-hash-anchors` memory — including
the two cases where the remote tip differs from the local one because `gh pr update-branch`
added a merge commit that never existed locally.

## Prod

All 3 Railway services on `a8250f9`. Backend `/health` `started_at` = `2026-08-20T14:27:27.376Z`;
`/ready` reports `db=ok`, `rls_enforced=true`, `db_role=app_user`, `waiting=0`.

**Caveat worth carrying forward:** #352's `main` CI run went RED (dashboard `deliveryStats` tests),
which by the SKIPPED-is-terminal rule in `CLAUDE.md` means its Railway deploys were almost certainly
skipped — so the reminder fix likely did not reach prod until this session's deploys. That is
inference from a red run plus the documented rule, not an observation of Railway's records.

## Why this file is short

This file only answers: what is open, and what just merged. Longer archaeology lives in
`docs/RESOLVED.md` and git history.
