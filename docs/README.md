# Documentation Index

This folder contains the project's technical and operational documentation.

## Documentation Principles (How We Stay Sane)

- **Single sources of truth**:
  - Active work, bugs, UX tasks, and near-term priorities → `docs/TODO.md` (the main living list).
  - Go-live / Telnyx ops detail → `docs/AIASSISTANT_GO_LIVE_TODO.md` (`TODO.md` tracks blockers as one-liners, defers detail here).
  - Historical UX audit findings were consolidated into `docs/TODO.md` (the raw `ux-review-notes.md` + dated `scripts/ux-audit/reports/*/TODO-*.md` snapshots were removed 2026-06-30 once their actionable items had been absorbed).

  (The mechanical/type/convention refactor backlog `REFACTORING_TODO.md` was completed and removed 2026-06-19; its history lives in `RESOLVED.md`.)

- **Curated vs generator noise**: Curated ideas live in `docs/IMPROVEMENT_IDEAS.md`; background-loop proposals in `docs/IMPROVEMENTS_TODO.md`.
- **Historical vs living**: Big completed work and session journals go to `RESOLVED.md`. `CLAUDE.md` is deliberately kept lean and points at the docs/ folder for details.
- **Succinctness over completeness**: When in doubt, link instead of duplicate. Long idea entries are acceptable only while they are active proposals.

## Core Documentation

| File                               | Purpose                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| [README.md](../README.md)          | Main project overview (start here)                                          |
| [CLAUDE.md](../CLAUDE.md)          | Current-state reference for agents & humans (points to docs/ for depth)     |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical architecture and stack                                            |
| [DIAGRAMS.md](DIAGRAMS.md)         | Mermaid diagrams (deployment, voice flow, booking, OAuth, etc.)             |
| [DEPLOYMENT.md](DEPLOYMENT.md)     | How to run, deploy, and configure the system                                |
| [SECURITY.md](SECURITY.md)         | Security model, RLS, auth, and hardening                                    |
| [RUNBOOK.md](RUNBOOK.md)           | Production incident + telephony recovery playbook                           |
| [ALERTS.md](ALERTS.md)             | Alerting rules (optional; paid observability decided against 2026-07-02)    |

## Planning, Tasks & Status

| File                                       | Purpose                                                            |
| ------------------------------------------ | ----------------------------------------------------------------- |
| [TODO.md](TODO.md)                         | Current work items (**single source of truth for active tasks**)  |
| [GAPS.md](GAPS.md)                         | Cross-angle gap inventory (what's missing from every direction)   |
| [RESOLVED.md](RESOLVED.md)                 | Completed phases + historical bug tracker + session-notes archive |
| [HANDOFF.md](HANDOFF.md)                   | Latest session handoff notes                                      |
| [IMPROVEMENT_IDEAS.md](IMPROVEMENT_IDEAS.md) | Curated improvement backlog                                      |
| [IMPROVEMENTS_TODO.md](IMPROVEMENTS_TODO.md) | Proposals from the `/continuously-improve` background loop       |
| [TEST_COVERAGE.md](TEST_COVERAGE.md)       | Test coverage status and gaps                                     |
| [TEST_DB_AUDIT.md](TEST_DB_AUDIT.md)       | Mocked-DB vs real-SQL coverage map                                |

## Voice AI

| File                                                   | Purpose                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| [VOICE_AGENT_PLAYBOOK.md](VOICE_AGENT_PLAYBOOK.md)     | Authoritative rulebook for building customer voice scripts |
| [VOICE_DEADAIR_RESEARCH.md](VOICE_DEADAIR_RESEARCH.md) | Dead-air / latency research findings (mostly shipped)      |
| [AIASSISTANT_GO_LIVE_TODO.md](AIASSISTANT_GO_LIVE_TODO.md) | Go-live / Telnyx ops detail (single source for go-live) |
| [AIASSISTANT_PERSONA_DRAFT.md](AIASSISTANT_PERSONA_DRAFT.md) | Thinking Hammer persona + call-flow draft              |
| [aiassistant-knowledge-base.md](aiassistant-knowledge-base.md) | Source content for the Thinking Hammer AI assistant KB |
| [FRAMEWORK_MIGRATIONS.md](FRAMEWORK_MIGRATIONS.md)     | Voice-stack migration history (Vapi → LiveKit, Grok → OpenAI TTS) |

## Onboarding & Operations

| File                                     | Purpose                                             |
| ---------------------------------------- | --------------------------------------------------- |
| [BETA_ONBOARDING.md](BETA_ONBOARDING.md) | First-day / first-week guide for new beta customers |
| [OWNER_GUIDE.md](OWNER_GUIDE.md)         | Plain-language guide to each dashboard tab for owners |
| [TICKET_SUPPORT.md](TICKET_SUPPORT.md)   | Telnyx support ticket status and escalation         |

## Product & Strategy

| File                                           | Purpose                                         |
| ---------------------------------------------- | ----------------------------------------------- |
| [MISSION_STATEMENT.md](MISSION_STATEMENT.md)   | Product mission and goals                       |
| [STRATEGY.md](STRATEGY.md)                     | Product + competitive strategy (positioning)    |
| [COMPETITOR_WEAKPOINTS.md](COMPETITOR_WEAKPOINTS.md) | Competitor attack map                      |
| [SECRETARYHQ_FEATURES.md](SECRETARYHQ_FEATURES.md) | Organized capability outline with status legend |

## Design

| File                                   | Purpose                                          |
| -------------------------------------- | ------------------------------------------------ |
| [DESIGN_HANDOFF.md](DESIGN_HANDOFF.md) | Visual brand system + design decisions (frozen)  |
| [UI_UX_DESIGN.md](UI_UX_DESIGN.md)     | Living design brief — interaction + UX principles|

## Workflow & Standards

| File                                                       | Purpose                                              |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md)         | Repeatable dev process for this project              |
| [PORTABLE_DEVELOPMENT_WORKFLOW.md](PORTABLE_DEVELOPMENT_WORKFLOW.md) | Project-agnostic version of the workflow (copyable) |
| [ADOPTING_THE_WORKFLOW.md](ADOPTING_THE_WORKFLOW.md)       | How another project points at + adopts the workflow  |
| [CODING_STANDARDS.md](CODING_STANDARDS.md)                 | Naming conventions + code-style rules                |
| [BRANCH_CHECKLIST.md](BRANCH_CHECKLIST.md)                 | Checklist for starting + finishing feature-branch work |
| [LESSONS_LEARNED.md](LESSONS_LEARNED.md)                   | Running log of hard-won debugging lessons            |
| [AGENTS.md](AGENTS.md)                                     | Agent-oriented codebase brief                        |

## Subfolders

- `legaldocs/` — Consent/privacy language + Thinking Hammer LLC setup summary
- `superpowers/` — Feature specs + implementation plans (per-feature design docs)
- `diagrams/` — Visual diagram assets
- `mockups/` — UI mockups
- `secretaryhq-demo.html` — Standalone demo page

## Archived / Historical

Completed phases, the historical bug tracker (formerly `BUGS.md`), the product plan (formerly `PLAN.md`), per-session journals (formerly `sessions/`), and the long-form status archive (formerly `CURRENT_STATUS_ARCHIVED_2026-05-15.md`) have all been **consolidated into [RESOLVED.md](RESOLVED.md)**. Those standalone files no longer exist.

---

**Last updated:** 2026-07-04 (full doc-inventory sync — every `docs/*.md` file now listed and categorized; root `README.md` documentation table synced the same day).
