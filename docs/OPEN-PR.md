# Branch / PR Merge Inventory

**Snapshot: 2026-08-13.** After #339 merged and prod deployed `4610d10`.

Regenerate the raw data with:

```bash
git fetch --prune
git branch -a --format='%(refname:short)' | sort
gh pr list --state open --json number,title,headRefName,baseRefName,url
gh pr view 339 --json number,title,state,mergedAt,headRefName,baseRefName,url,mergeCommit
```

## Current state

- Open PRs: none
- Branch refs expected: `main` / `origin/main` (feature branches for #337–#339 purged)
- Latest merged PRs on the preset/override rollout:
  - #337 `fix(agent): type OpenAI and cost-usage seams` — `4c69219`
  - #338 `feat(runtime): ship live checklist presets and safe overrides` — `2a0894a`
  - #339 `feat(runtime): enforce required checklist fields` — `4610d10` (merged 2026-08-13T13:52:31Z)

## Prod

All 3 Railway services on `4610d10`. Backend `/health` `started_at` = `2026-08-13T14:00:35.968Z`.

## Why this file is short

This file only answers: what is open, and what just merged. Longer archaeology lives in `docs/RESOLVED.md` and git history.
