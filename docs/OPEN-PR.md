# Branch / PR Merge Inventory

**Snapshot: 2026-08-20 (end of day).** After #353, #356, #354, #357, #358 and #355 merged and prod deployed `214e23f`.

Regenerate the raw data with:

```bash
git fetch --prune
git branch -a --format='%(refname:short)' | sort
gh pr list --state open --json number,title,headRefName,baseRefName,url
```

## Current state

- **Open PRs: none.**
- **Branch refs: `main` only**, local and remote. No stashes, clean worktree.
- Merged 2026-08-20:
  - #353 `chore: delete ~810 lines of dead code` — `69d6bdf`
  - #356 `fix(templates): GET /templates/full publishes a stated column list, not SELECT *` — `ff9b4cc`
  - #354 `fix(security): close the name-search enumeration oracle` — `a8250f9`
  - #357 `chore(docs): record the branch purge and current prod state` — `d689b34`
  - #358 `chore: remove two stray session snapshots from the repo root` — `04510a5`
  - #355 `fix(scheduling): store the weekly rule instead of guessing it back out of the rows` — `214e23f`

## Purged 2026-08-20

Ten branches whose PRs merged (#346, #347, #348, #349, #350, #351, #352, #353, #354, #356),
deleted local + remote. Each was verified MERGED **and** its squash commit confirmed present in
`origin/main` before deletion. Tips are recorded in the `branch-hash-anchors` memory — including
the two cases where the remote tip differs from the local one because `gh pr update-branch`
added a merge commit that never existed locally.

## Prod

All 3 Railway services on `214e23f`. Backend `/health` `started_at` = `2026-08-20T17:35:09.861Z`;
`/ready` reports `db=ok`, `rls_enforced=true`, `db_role=app_user`, `waiting=0`.

Migration `20260820000000_employee_schedule_pattern` is applied to prod and verified by querying it:
table present, composite PK `(tenant_id, employee_id, day_of_week)`, RLS enabled AND forced, both
policies, the `updated_at` trigger, `rows=0` (no backfill, by design). `employee_schedule`'s
`max(shift_date)` is `2027-02-15` — the full 180-day horizon — so the extender ran clean on the new code.

**Caveat worth carrying forward:** #352's `main` CI run went RED (dashboard `deliveryStats` tests),
which by the SKIPPED-is-terminal rule in `CLAUDE.md` means its Railway deploys were almost certainly
skipped — so the reminder fix likely did not reach prod until this session's deploys. That is
inference from a red run plus the documented rule, not an observation of Railway's records.

## Why this file is short

This file only answers: what is open, and what just merged. Longer archaeology lives in
`docs/RESOLVED.md` and git history.
