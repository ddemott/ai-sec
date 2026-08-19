# Documentation Index

This folder contains the project's technical and operational documentation.

## Documentation Principles (How We Stay Sane)

- **One backlog**: ALL open work — active tasks, gaps, ideas, go-live blockers — lives in `docs/TODO.md`. The former `GAPS.md`, `IMPROVEMENT_IDEAS.md`, `IMPROVEMENTS_TODO.md`, and `AIASSISTANT_GO_LIVE_TODO.md` were folded in and deleted 2026-07-05 (done items + analysis archived verbatim in `RESOLVED.md`). Go-live / Telnyx ops detail → `RUNBOOK.md` §7.
  - Historical UX audit findings were also consolidated into `docs/TODO.md` (the raw `ux-review-notes.md` + dated `scripts/ux-audit/reports/*/TODO-*.md` snapshots were removed 2026-06-30 once their actionable items had been absorbed).

  (The mechanical/type/convention refactor backlog `REFACTORING_TODO.md` was completed and removed 2026-06-19; its history lives in `RESOLVED.md`.)

- **Historical vs living**: Big completed work and session journals go to `RESOLVED.md`. `CLAUDE.md` is deliberately kept lean and points at the docs/ folder for details.
- **Succinctness over completeness**: When in doubt, link instead of duplicate. Long idea entries are acceptable only while they are active proposals.

## Core Documentation

| File                                                           | Purpose                                                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [README.md](../README.md)                                      | Main project overview (start here)                                                                                   |
| [CLAUDE.md](../CLAUDE.md)                                      | Current-state reference for agents & humans (points to docs/ for depth)                                              |
| [ARCHITECTURE.md](ARCHITECTURE.md)                             | Technical architecture and stack                                                                                     |
| [QUESTION_TREE_ARCHITECTURE.md](QUESTION_TREE_ARCHITECTURE.md) | **How a call actually works — the LIVE call flow** (`agent/src/checklist/`). Read before changing any call behaviour |
| [DIAGRAMS.md](DIAGRAMS.md)                                     | Mermaid diagrams (deployment, voice flow, call sequencing, booking, OAuth, etc.)                                     |
| [VOICE_AGENT_PLAYBOOK.md](VOICE_AGENT_PLAYBOOK.md)             | Voice pipeline rules — STT/LLM/TTS, latency, turn-taking                                                             |
| [DEPLOYMENT.md](DEPLOYMENT.md)                                 | How to run, deploy, and configure the system                                                                         |
| [SECURITY.md](SECURITY.md)                                     | Security model, RLS, auth, and hardening                                                                             |
| [RUNBOOK.md](RUNBOOK.md)                                       | Production incident + telephony recovery playbook                                                                    |
| [ALERTS.md](ALERTS.md)                                         | Alerting rules (optional; paid observability decided against 2026-07-02)                                             |

## Planning, Tasks & Status

| File                                 | Purpose                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [TODO.md](TODO.md)                   | **The one backlog** — all open work, prioritized (GAPS + ideas + go-live folded in 2026-07-05) |
| [RESOLVED.md](RESOLVED.md)           | Completed phases + historical bug tracker + session archive (incl. the folded-doc snapshots)   |
| [ROADMAP.md](ROADMAP.md)             | Vertical-preset execution roadmap (steps 1–10 closed in CI)                                    |
| [TEST_COVERAGE.md](TEST_COVERAGE.md) | Test coverage status and gaps                                                                  |
| [TEST_DB_AUDIT.md](TEST_DB_AUDIT.md) | Mocked-DB vs real-SQL coverage map                                                             |

## Voice AI

| File                                                           | Purpose                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [VOICE_AGENT_PLAYBOOK.md](VOICE_AGENT_PLAYBOOK.md)             | Authoritative rulebook for building customer voice scripts                      |
| [VOICE_DEADAIR_RESEARCH.md](VOICE_DEADAIR_RESEARCH.md)         | Dead-air / latency research findings (mostly shipped)                           |
| [AIASSISTANT_PERSONA_DRAFT.md](AIASSISTANT_PERSONA_DRAFT.md)   | Thinking Hammer persona + call-flow draft                                       |
| [aiassistant-knowledge-base.md](aiassistant-knowledge-base.md) | Source content for the Thinking Hammer AI assistant KB                          |
| [FRAMEWORK_MIGRATIONS.md](FRAMEWORK_MIGRATIONS.md)             | Voice-stack migration history (Vapi → LiveKit, Grok/OpenAI TTS → Deepgram Aura) |

## Onboarding & Operations

| File                                     | Purpose                                               |
| ---------------------------------------- | ----------------------------------------------------- |
| [BETA_ONBOARDING.md](BETA_ONBOARDING.md) | First-day / first-week guide for new beta customers   |
| [OWNER_GUIDE.md](OWNER_GUIDE.md)         | Plain-language guide to each dashboard tab for owners |
| [TICKET_SUPPORT.md](TICKET_SUPPORT.md)   | Telnyx support ticket status and escalation           |

## Product & Strategy

| File                                                                           | Purpose                                                                             |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [MISSION_STATEMENT.md](MISSION_STATEMENT.md)                                   | Product mission and goals                                                           |
| [STRATEGY.md](STRATEGY.md)                                                     | Product + competitive strategy (positioning)                                        |
| [COMPETITOR_WEAKPOINTS.md](COMPETITOR_WEAKPOINTS.md)                           | Competitor attack map                                                               |
| [SECRETARYHQ_FEATURES.md](SECRETARYHQ_FEATURES.md)                             | Organized capability outline with status legend                                     |
| [VERTICAL-PRESET-BLOCK-ARCHITECTURE.md](VERTICAL-PRESET-BLOCK-ARCHITECTURE.md) | Design for reusable block classes, business-type presets, and tenant-safe overrides |

## Design

| File                                   | Purpose                                           |
| -------------------------------------- | ------------------------------------------------- |
| [DESIGN_HANDOFF.md](DESIGN_HANDOFF.md) | Visual brand system + design decisions (frozen)   |
| [UI_UX_DESIGN.md](UI_UX_DESIGN.md)     | Living design brief — interaction + UX principles |

## Workflow & Standards

| File                                                                 | Purpose                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md)                   | Repeatable dev process for this project                |
| [PORTABLE_DEVELOPMENT_WORKFLOW.md](PORTABLE_DEVELOPMENT_WORKFLOW.md) | Project-agnostic version of the workflow (copyable)    |
| [ADOPTING_THE_WORKFLOW.md](ADOPTING_THE_WORKFLOW.md)                 | How another project points at + adopts the workflow    |
| [CODING_STANDARDS.md](CODING_STANDARDS.md)                           | Naming conventions + code-style rules                  |
| [BRANCH_CHECKLIST.md](BRANCH_CHECKLIST.md)                           | Checklist for starting + finishing feature-branch work |
| [LESSONS_LEARNED.md](LESSONS_LEARNED.md)                             | Running log of hard-won debugging lessons              |
| [AGENTS.md](AGENTS.md)                                               | Agent-oriented codebase brief                          |

## Subfolders

- `legaldocs/` — Consent/privacy language + Thinking Hammer LLC setup summary
- `superpowers/` — Feature specs + implementation plans (per-feature design docs)
  - Includes `2026-08-11-vertical-preset-block-implementation-spec.md` for the code-facing execution spec behind the vertical preset roadmap.
- `diagrams/` — Visual diagram assets
- `mockups/` — UI mockups
- `secretaryhq-demo.html` — Standalone demo page

## Archived / Historical

Completed phases, the historical bug tracker (formerly `BUGS.md`), the product plan (formerly `PLAN.md`), per-session journals (formerly `sessions/`), and the long-form status archive (formerly `CURRENT_STATUS_ARCHIVED_2026-05-15.md`) have all been **consolidated into [RESOLVED.md](RESOLVED.md)**. Those standalone files no longer exist.

### Superseded call architectures — kept, but NOT how calls work today

The call flow has been rebuilt twice. These docs describe the earlier designs and each
carries a banner saying so. They are retained because the **bugs** they catalogue are real
and the current design's guards exist because of them — read them for evidence, not for
behaviour.

| File                                                         | Describes                                                           | Status                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [BUILDING_SCRIPT_NOTES.md](BUILDING_SCRIPT_NOTES.md)         | TaskGroup "rungs" (`agent/src/tasks/`)                              | Superseded 2026-07-21 · fallback behind `ENABLE_TASK_GROUP`                                     |
| [CALL_LADDER.md](CALL_LADDER.md)                             | The prompt ladder — generated from `src/services/scripts/blocks.ts` | Superseded · fallback when both flags are off. Editing a rung changes nothing about a live call |
| [VOICE_DEADAIR_RESEARCH.md](VOICE_DEADAIR_RESEARCH.md)       | Working around non-streaming OpenAI TTS                             | Core premise moot — TTS is Deepgram Aura (streaming) since 2026-07-14                           |
| [AIASSISTANT_PERSONA_DRAFT.md](AIASSISTANT_PERSONA_DRAFT.md) | 2026-06-10 persona + call-flow brief                                | Stale; persona is `Piper`, flow is question trees                                               |

**The live architecture is [QUESTION_TREE_ARCHITECTURE.md](QUESTION_TREE_ARCHITECTURE.md).**

---

**Last updated:** 2026-08-18 (repo-wide doc sync: package/runtime versions refreshed to Next.js 16 / React 19 / Fastify 5, migration totals bumped to 184, Playwright spec count bumped to 40, and primary architecture/deployment docs re-aligned to the live filesystem. Prior major pass 2026-08-11 refreshed test counts, billing/webhook reality, Node 22 deployment pin, and current voice-stack wording; 2026-07-05 folded `GAPS.md` / `IMPROVEMENT_IDEAS.md` / `IMPROVEMENTS_TODO.md` / `AIASSISTANT_GO_LIVE_TODO.md` into `docs/TODO.md` and archived snapshots in `RESOLVED.md`.)
