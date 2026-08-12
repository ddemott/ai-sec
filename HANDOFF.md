# HANDOFF

Read this first after session reset.

## Current state

- Repo: `/home/dale/projects/secretary-hq`
- Branch: `main`
- Latest merged checkpoint: PR #329 — `feat: add preset compiler and generic intake capture`
- Merge commit: `0236179c4a4ecc7ea58f806878932b9fc35f85eb`

## What just landed

Code + schema

- checklist preset/runtime foundation under `agent/src/checklist/`
- generic intake envelope + RLS via `supabase/migrations/20260811160000_intake_submissions.sql`
- `capture-job-inquiry` now writes `intake_submissions` before `job_inquiries`

Docs

- roadmap + architecture/spec docs for the vertical preset/block runtime
- repo-wide factual count sync for migrations, test totals, and backend route-module count

## Verified facts

- PR #329 merged successfully
- local branch `feat/vertical-preset-runtime-intake` deleted
- remote branch `feat/vertical-preset-runtime-intake` deleted
- current branch tracks `origin/main`
- backend route modules under `src/routes/`: 29 (plus the `agentTools/` module dir wired from `src/index.ts`)
- SQL migrations on disk: 180
- Playwright spec files under `dashboard/e2e/`: 38
- defined agent tools in `agent/src/tools.ts`: 26
- latest verified suite totals still documented from 2026-08-11:
  - backend: 2,675 passing
  - dashboard: 1,031 passing
  - agent: 1,498 passing

## Working tree expectation

Clean, unless a later session edited docs or code after this handoff.

## Good next checks

1. `git status --short --branch`
2. if docs are in question, verify route/migration/spec counts from filesystem before editing
3. if production state is in question, verify live deploy after merge instead of assuming Railway shipped it

## Style reminder

Stay terse. Verify with tools. Don’t trust stale markdown when the filesystem can answer it exactly.
