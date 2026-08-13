# HANDOFF

Read this first after session reset.

## Current state

- Repo: `/home/dale/projects/secretary-hq`
- Branch: `main` (tracks `origin/main`)
- Latest merge: PR #339 — `feat(runtime): enforce required checklist fields`
- Merge commit: `4610d10446c3f6f8b2ba7ad1abb0654b296155dd`
- Prod: all 3 Railway services on `4610d10`. Backend `/health` `started_at` = `2026-08-13T14:00:35.968Z`

## What just landed

- **#337** agent lint/type cleanup (`4c69219`)
- **#338** live checklist presets + safe overrides (disable, booking/message policy, optional-as-listen)
- **#339** required-field enforcement (decline does not resolve)

Live path: `tenants.checklist_preset_id` + `checklist_overrides` → `deriveChecklistRuntimeConfig` → `/agent-tools/tenant-config` → `ChecklistAgent({ runtimeConfig })`.

Owners edit this on Business Settings → Call checklist.

## ROADMAP (`docs/ROADMAP.md`)

- Steps 1–8 closed
- Step 9 slices 1–3 shipped (disable / policy / optional / required)
- Still open: wording editor (deferred), preview/dry-run, **Step 10 E2E journeys**

## Verified facts

- no leftover `feat/required-field-enforcement` or `feat/finish-step-7-presets` branches
- backend route modules under `src/routes/`: 29 (plus `agentTools/`)
- SQL migrations on disk: 182
- Playwright spec files under `dashboard/e2e/`: 38
- defined agent tools in `agent/src/tools.ts`: 26
- suite totals last written in `CLAUDE.md` (2026-08-12): backend 2,689 / dashboard 1,031 / agent 1,536 — recount before bumping

## Working tree expectation

Clean after the #339 merge unless a later session edited docs.

## Good next checks

1. `git status --short --branch`
2. `curl -sS https://secretary-hq-production.up.railway.app/health` — `started_at` must be ≥ 2026-08-13T14:00:35Z
3. remaining product work: Step 9 wording/dry-run, or Step 10 E2E

## Style reminder

Stay terse. Verify with tools. Don’t trust stale markdown when the filesystem can answer it exactly.
