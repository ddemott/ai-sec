# Branch / PR Merge Inventory

**Snapshot: 2026-08-12.** Current branch/PR inventory for a fresh session after PR #331 merged.

Regenerate the raw data with:

```bash
git fetch --prune
git branch -a --format='%(refname:short)' | sort
gh pr list --state open --json number,title,headRefName,baseRefName,url
gh pr view 331 --json number,title,state,mergedAt,headRefName,baseRefName,url,mergeCommit
```

## Current state

- Open PRs: none (`gh pr list --state open` returned `[]`)
- Branch refs currently present:
  - `main`
  - `origin/main`
  - `origin/feat/second-intake-path-proof`
- Latest merged PR relevant to the preset/intake rollout:
  - PR #331 — `feat: prove second reusable intake path`
  - merged into `main` at `2026-08-12T10:01:08Z`
  - merge commit: `b5403fbe2406cc186a73c1dbb3d037ebde65b2a7`
  - head branch: `feat/second-intake-path-proof`

## What changed since the old inventory

The previous 2026-08-06 snapshot is stale.

- it described an in-progress branch/PR landscape that no longer exists
- it referred to `docs/business-blueprints-spec` as "this PR", which is no longer a live inventory fact
- it did not include PR #331, which is now the latest merged checkpoint for the vertical preset/generic-intake rollout

## Why this file is short now

Today this file only answers the branch/PR question it is supposed to answer: what is currently open, and what just merged.

The older long-form merge archaeology was a point-in-time cleanup log, not a durable current-state inventory. If that history still matters, recover it from git history instead of treating it as the current branch/PR picture.
