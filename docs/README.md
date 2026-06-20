# Documentation Index

This folder contains the project's technical and operational documentation.

## Documentation Principles (How We Stay Sane)

- **Single sources of truth**:
  - Active work, bugs, UX tasks, and near-term priorities → `docs/TODO.md` (the main living list).
  - Raw UX audit findings → `ux-review-notes.md` (archived / reduced; actionable findings live in `docs/TODO.md`).

  (The mechanical/type/convention refactor backlog `REFACTORING_TODO.md` was completed and removed 2026-06-19; its history lives in `RESOLVED.md` / `NEEDS-REFACTORING.md`.)
- **Curated vs generator noise**: The root `improvement-ideas.md` is retired generator output (see its own header). Curated ideas live in `docs/IMPROVEMENT_IDEAS.md`.
- **Historical vs living**: Big completed work and session journals go to `RESOLVED.md` or `docs/sessions/`. `CLAUDE.md` is deliberately kept lean and points at the docs/ folder for details.
- **Succinctness over completeness**: When in doubt, link instead of duplicate. Long idea entries are acceptable only while they are active proposals.

## Core Documentation

| File | Purpose |
|------|---------|
| [README.md](../README.md) | Main project overview (start here) |
| [CLAUDE.md](../CLAUDE.md) | Current-state reference for agents & humans (points to docs/ for depth) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical architecture and stack |
| [DEPLOYMENT.md](DEPLOYMENT.md) | How to run, deploy, and configure the system |
| [SECURITY.md](SECURITY.md) | Security model, RLS, auth, and hardening |
| [TODO.md](TODO.md) | Current work items and status (**single source of truth for active tasks**) |

## Onboarding & Operations

| File | Purpose |
|------|---------|
| [BETA_ONBOARDING.md](BETA_ONBOARDING.md) | First-day / first-week guide for new beta customers |
| [TICKET_SUPPORT.md](TICKET_SUPPORT.md) | Telnyx support ticket status and escalation |

## Planning & Design

| File | Purpose |
|------|---------|
| [DESIGN_HANDOFF.md](DESIGN_HANDOFF.md) | Design specifications and handoff notes |
| [UI_UX_DESIGN.md](UI_UX_DESIGN.md) | UI/UX patterns and component guidelines |
| [DIAGRAMS.md](DIAGRAMS.md) | System diagrams and architecture visuals |
| [MISSION_STATEMENT.md](MISSION_STATEMENT.md) | Product mission and goals |
| [PLAN.md](PLAN.md) | High-level product and development plan |

## Technical References

| File | Purpose |
|------|---------|
| [FRAMEWORK_MIGRATIONS.md](FRAMEWORK_MIGRATIONS.md) | Voice AI migration history (Vapi → LiveKit, etc.) |
| [TEST_COVERAGE.md](TEST_COVERAGE.md) | Test coverage status and gaps |
| [IMPROVEMENT_IDEAS.md](IMPROVEMENT_IDEAS.md) | Curated list of improvement ideas (see principles above) |
| [BUGS.md](BUGS.md) | Known bugs and workarounds |

## Archived / Historical

| File | Purpose |
|------|---------|
| [CURRENT_STATUS_ARCHIVED_2026-05-15.md](CURRENT_STATUS_ARCHIVED_2026-05-15.md) | Detailed historical session notes (archived) |
| [sessions/](sessions/) | Per-session notes (historical) |

## Other

- `diagrams/` — Visual diagram assets
- `mockups/` — UI mockups
- `secretaryhq-demo.html` — Standalone demo page

---

**Last updated:** 2026-05-27 (major documentation reduction pass: root `improvement-ideas.md`, `ux-review-notes.md`, `docs/BUGS.md`, and `NEEDS-REFACTORING.md` heavily reduced or archived as content is captured in `docs/TODO.md` / `RESOLVED.md`)