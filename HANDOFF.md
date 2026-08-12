# HANDOFF

Read this first after session reset.

## Current state

- Repo: `/home/dale/projects/secretary-hq`
- Branch: `main`
- Latest merged checkpoint: PR #331 — `feat: prove second reusable intake path`
- Merge commit: `b5403fbe2406cc186a73c1dbb3d037ebde65b2a7`

## What just landed

Code + schema

- checklist preset/runtime foundation under `agent/src/checklist/`
- generic intake envelope + RLS via `supabase/migrations/20260811160000_intake_submissions.sql`
- `src/services/jobInquiryCapture.ts` now owns generic capture plus `job_inquiry` projection persistence
- `src/services/meetingNotesCapture.ts` proves a second reusable intake path by writing `submission_type='meeting_notes'` into `intake_submissions` before projecting to the appointment description

Docs

- roadmap + architecture/spec docs for the vertical preset/block runtime now reflect Steps 1–6 through the second-path proof
- repo-wide factual count sync for migrations, test totals, and backend route-module count remains in place from the prior doc sweep

## Verified facts

- PR #331 merged successfully on 2026-08-12
- there are currently no open PRs
- current remotes/branches present now: `main`, `origin/main`, `origin/feat/second-intake-path-proof`
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
