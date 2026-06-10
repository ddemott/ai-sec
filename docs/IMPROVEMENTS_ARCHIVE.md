# Improvements Archive

Resolved proposals (`done` / `rejected`) moved out of [docs/IMPROVEMENTS_TODO.md](IMPROVEMENTS_TODO.md) to keep the active backlog lean. Most-recent first.

Cross-references: [docs/IMPROVEMENTS_TODO.md](IMPROVEMENTS_TODO.md) | [docs/TODO.md](TODO.md) | [docs/IMPROVEMENT_IDEAS.md](IMPROVEMENT_IDEAS.md)

---

### [2026-06-10] skill — improve should require a resolution note for global-skill edits

**Target:** `skill: improve`
**Category:** skill
**Priority:** medium
**Effort:** S (<30min)
**Status:** done 2026-06-10

**Proposal:**
Route 2 implements `skill`-category proposals by editing files in `~/.claude/skills/` (outside the repo) then marking `Status: done` in the repo-committed `IMPROVEMENTS_TODO.md` — so the change `done` refers to never appears in this repo's git history. The repo already handles this ad-hoc (existing entries append "Fixed in the global skill … `~/.claude/skills/` … only this status update is committed"), but the skill doesn't mandate it. Add to Route 2 step 3: when a `skill`-category item is implemented, append a resolution note recording date + which `~/.claude/skills/<name>` file changed + a one-line summary, before setting `done`. Done = skill instructs writing the resolution note for out-of-repo edits.

**Resolution (2026-06-10):** Made the resolution note mandatory in Route 2 step 3 of `~/.claude/skills/improve/SKILL.md` — `skill`-category items (and any fix touching a file outside the repo) must append a dated note naming the `~/.claude/skills/<name>/<file>` changed + one-line summary BEFORE setting `done`, with a fixed template and a "do NOT mark done without it" rule. Convention is now instruction, not habit. (Out-of-repo file — only this status update is committed.)

---

### [2026-06-10] skill — implement-task ignores docs/ task sources

**Target:** `skill: implement-task`
**Category:** skill
**Priority:** medium
**Effort:** S (<30min)
**Status:** done 2026-06-10

**Proposal:**
The skill's "Locating the task" order checks root `PLAN.md`, root `TODO.md`, then CLAUDE.md headings, then GitHub issues — but never `docs/`. This repo's canonical task list is `docs/TODO.md` (CLAUDE.md states "Current tasks in `docs/TODO.md`"; root `PLAN.md`/`TODO.md` don't exist), so the skill would fail to find any task and fall through to "stop and ask." Portable fix: add a first step to consult the project's CLAUDE.md/AGENTS.md for a pointer to the task source, and include `docs/TODO.md` / `docs/PLAN.md` / `docs/*.md` in the fallback search list. Done = skill locates `docs/TODO.md` items without hardcoding this repo's layout.

**Resolution (2026-06-10): approved by Dale + fixed.** Rewrote the "Locating the task" order in `~/.claude/skills/implement-task/SKILL.md`: (1) **pointer first** — read CLAUDE.md/AGENTS.md for an explicit pointer line (e.g. "Current tasks in docs/TODO.md") and let that file win; (2) named root files `PLAN.md`/`TODO.md`; (3) named `docs/TODO.md`/`docs/PLAN.md`; (4) CLAUDE.md task headings; (5) **last resort** narrowed `docs/*.md` to only filenames containing TODO/PLAN/BACKLOG (not a broad glob, per review); (6) GitHub issues. Portable — no hardcoded repo layout. Global skill lives in `~/.claude/skills/` (outside this repo); only this status update is committed.

---

### [2026-06-10] skill — Document the RDAP bootstrap cache in domain-check

**Target:** `skill: domain-check`
**Category:** skill
**Priority:** low
**Effort:** S (<30min)
**Status:** rejected 2026-06-10

**Proposal:**
`domain-check/` ships a 71KB static `.rdap-bootstrap.json` (TLD→RDAP-server map, dated 2026-05-20) that `check_domains.py` relies on, but SKILL.md never mentions it. A stale bootstrap silently degrades newer/less-common TLDs to `UNKNOWN` rows, indistinguishable from rate-limit/server errors. Add a short note to SKILL.md explaining the cache exists, that `UNKNOWN` may stem from a stale bootstrap (not just transient errors), and how to refresh it (re-pull IANA's RDAP bootstrap). Done = SKILL.md documents the file + refresh path.

**Resolution (2026-06-10): rejected — premise was wrong.** Reading `check_domains.py` showed the cache is NOT stale at runtime: `load_bootstrap()` enforces a 24h TTL (`BOOTSTRAP_TTL = 24*60*60`), refetching from `https://data.iana.org/rdap/dns.json` and rewriting the cache when the file's mtime age ≥ 24h (stale-cache fallback only on fetch failure). The on-disk date just reflects last run. Per-domain availability lookups are never cached — every run hits RDAP live. `UNKNOWN "no RDAP service for TLD"` only fires when IANA genuinely has no RDAP server for that TLD, not from staleness. No bug; the doc-only sliver isn't worth a change.

---

### [2026-06-03] skill — create-tests: Step 6 mislabels the Vitest shuffle flag

**Target:** `skill: create-tests` (SKILL.md Step 6 — Verify independence, line ~114)
**Category:** skill
**Priority:** low
**Effort:** S (<30min)
**Status:** done 2026-06-03

**Proposal:**
Step 6 says "Vitest/Jest: `--shuffle` (Vitest) or `--randomize` equivalent" — but `--shuffle` is Jest's flag (Jest 28+); Vitest has no bare `--shuffle` and randomizes via `--sequence.shuffle` (CLI) / `sequence.shuffle` (config). `npx vitest run --shuffle` errors out. Since Vitest is this repo's primary runner (backend + dashboard), the independence-verification step is broken on the main path — the reader falls back to the "run each file alone" alternative, but the documented command is simply wrong. Fix: relabel to `Vitest: --sequence.shuffle · Jest: --shuffle`. Done = each runner is paired with its real flag.

**Resolution (2026-06-03):** Fixed in the global skill — line now reads
`Vitest: --sequence.shuffle · Jest: --shuffle`. (Skill lives in `~/.claude/skills/`,
outside this repo; only this status update is committed.)

---

### [2026-06-03] skill — continuously-improve: `fully_analyzed` skip is unwired (no state field backs it)

**Target:** `skill: continuously-improve` (SKILL.md — skills-phase "Skip a skill if" + State file schema)
**Category:** skill
**Priority:** medium
**Effort:** S (<30min)
**Status:** done 2026-06-03 (option B)

**Resolution (2026-06-03):** Fixed via option B — removed the dead "Skip a skill if `fully_analyzed`…" paragraph from the skills phase. It referenced state fields the schema never defined and no step ever wrote, so the optimization could never fire; deleting it removes the contradiction with zero added state complexity (per "delete the dormant abstraction"). Skill lives in `~/.claude/skills/`; only this status update is committed.

**Proposal:**
The skills-phase says "Skip a skill if its path in state has `fully_analyzed: true` AND its file mtime hasn't changed since that flag was set" and "Mark `fully_analyzed` only after 2 passes with no findings" — but the documented `.improve/state.json` schema has no per-skill structure, no `fully_analyzed` field, and no mtime store, and no step ever writes them. So the optimization can never fire: a skill that's been analyzed twice with zero findings gets re-analyzed forever, wasting one of the 3 capped analyses per session. Fix by adding a defined state sub-object (e.g. `"skill_state": { "<name>": { "fully_analyzed": true, "mtime": "<iso>", "clean_passes": 1 } }`) to the schema + a Step-5 instruction to write it, OR drop the skip-optimization paragraph entirely if it's not worth the state complexity. Done = the skip rule references a field the schema actually defines and a step actually writes.

---

### [2026-06-03] skill — commit-code embeds Pixel Agents project specifics

**Target:** `skill: commit-code` (SKILL.md Step 4, lines ~84–86)
**Category:** skill
**Priority:** medium
**Effort:** S (<30min)
**Status:** done 2026-06-03

**Proposal:**
Step 4 of the global `commit-code` skill hardcodes test commands for a different project: "For the Pixel Agents project specifically: `npm run test:daemon` / `npm run test:webview` … `npm run e2e`". This repo has none of those scripts (its tests are `npm test` → vitest, `cd dashboard && npm test`, Playwright e2e). Baking one project's commands into a global skill misleads every other repo. Replace the Pixel-Agents block with project-agnostic guidance (detect the runner from package.json, run the fast suite, gate E2E on whether changes touch the relevant surface) — or move the project-specific note into that project's local memory/CLAUDE.md. Done = no project name appears in the global skill's Step 4.

**Resolution (2026-06-03):** Approved by Dale + fixed. Genericized the leak in BOTH global skills (the same audit found `start-feature` had it too):
- `commit-code` SKILL.md Step 4: dropped the "For the Pixel Agents project specifically" block; kept the already-generic "detect runner / gate E2E on touched surface" guidance.
- `start-feature` SKILL.md: 5 sites genericized — intro line, "Pixel Agents Feature Lifecycle" heading, baseline gates (`npm run check-types`/`daemon`/`webview` → generic typecheck/lint/build/test), dev-loop test commands, closing "proper way for Pixel Agents" line.
- Verified: `grep -niE "pixel agents|test:daemon|test:webview|check-types"` across both skills → 0 hits.
- Note: global skills live in `~/.claude/skills/` (outside this repo), so the edits are not in this commit — only this status update is.

---
