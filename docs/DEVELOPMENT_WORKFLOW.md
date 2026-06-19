# Development Workflow (Project-Specific)

This document defines the repeatable process for this specific project (SecretaryHQ).

For a **project-agnostic, reusable version** (including support for Python, Go, and other stacks via the `projectType` field), see:

**`ADOPTING_THE_WORKFLOW.md`** + the `portable-workflow-kit/` folder (or a generated copy from `npm run generate-kit -- --project-type python`).

The authoritative machine-readable contract for this repo lives in the root `workflow.config.json` (projectType + the active `commands` block). The portable kit + adoption guide is what you hand to other teams so they get identical governance adapted to their tooling.

---

## Project-Specific Details

This document is now a thin wrapper that points to the portable system while capturing any SecretaryHQ-specific nuances.

The goal is simple:

- Always work on a feature branch.
- Lint, typecheck, and test as you go.
- Update documentation as part of the work.
- Never merge broken or undocumented changes.

## 1. Branching Strategy

- **Default branch**: `main`
- All work happens on short-lived feature branches.
- Branch naming convention (use these prefixes):

  | Prefix      | Use Case                                 | Example                            |
  | ----------- | ---------------------------------------- | ---------------------------------- |
  | `feat/`     | New feature or significant enhancement   | `feat/e2e-coverage-gaps`           |
  | `fix/`      | Bug fix                                  | `fix/consent-optout-normalization` |
  | `test/`     | Adding or improving tests                | `test/owner-config-booking-flow`   |
  | `refactor/` | Code improvement without behavior change | `refactor/reminder-types-cleanup`  |
  | `docs/`     | Documentation only                       | `docs/development-workflow`        |
  | `chore/`    | Tooling, dependencies, minor cleanup     | `chore/update-eslint-rules`        |

- Keep branches focused. One logical change per branch.
- Delete branches after they are merged and the PR is closed.

## 2. Creating a Feature Branch

Always create branches from the latest `main`.

**Recommended command**:

```bash
npm run create-branch feat/your-descriptive-name
```

(or directly: `bash scripts/create-feature-branch.sh feat/your-descriptive-name`)

**When creating a branch, do these things:**

1. Create the branch with a clear name following the convention.
2. If the work is non-trivial, create a GitHub Issue (or link an existing one) and reference it.
3. Run initial quality gates early:
   ```bash
   npm run verify:claude-md
   npm run build
   npm test
   ```
4. Copy the branch checklist for local tracking:
   ```bash
   cp docs/BRANCH_CHECKLIST.md .
   ```
   Edit `.BRANCH_CHECKLIST.md` (or the copied file) in your branch root and keep it updated.
5. Start tracking what needs to be done (tests, docs, etc.). Consider adding an entry in `docs/TODO.md`.

## 3. Development Standards (While Coding)

### Code Quality

- Follow existing patterns in the file/module you are changing.
- All new or changed code must pass:
  - TypeScript (`npx tsc --noEmit` root + dashboard)
  - ESLint (`npm run lint`)
  - Prettier (`npm run format:check`)
- Backend code changes **require both** `npm run build` **and** a restart to take effect (see CLAUDE.md "Build Principles").

### Testing

- **Unit / integration tests** (Vitest): Required for almost all logic.
- **E2E (Playwright)**: Required for user-facing flows, especially anything involving the dashboard UI, booking, auth, or configuration that affects real users.
  - Do **not** run the entire E2E suite for every small change. Use `--grep` to run only relevant tests:
    ```bash
    cd dashboard && npx playwright test --grep "owner-config|booking"
    ```
- **Live QA** (`scripts/qa-live-test.py`): Use for voice/agent tool flows when E2E is not practical.
- Every new or meaningfully changed test file **must** contain 5W diagnostic comments (WHO / WHAT / WHEN / WHERE / WHY). See existing good examples in `appointment-cancel-restore.spec.ts`.

**Rule of thumb**: If a user or the voice agent could experience different behavior, there should be a test (unit, E2E, or live QA) that would catch the regression.

### Documentation

- Update the relevant `*.md` file(s) as part of the same work, not as an afterthought.
- Critical files that frequently need updates:
  - `CLAUDE.md` (especially Key Directories, Development, and Build Principles)
  - `docs/TODO.md`
  - `RESOLVED.md` (move completed items here)
  - Any feature-specific docs under `docs/`
- Run `npm run verify:claude-md` before considering the work done. It is a hard gate in CI.

## 4. Pre-Commit / Pre-PR Checklist

Before you consider the work "ready to commit/push", complete this checklist:

- [ ] All code is linted and formatted (`npm run lint && npm run format:check`)
- [ ] TypeScript is clean (root + dashboard)
- [ ] Build succeeds (`npm run build` + dashboard build)
- [ ] Relevant unit tests pass (`npm test` or targeted vitest globs)
- [ ] Relevant E2E tests pass (use `--grep` for speed)
- [ ] All new/modified tests have proper 5W comments
- [ ] Documentation has been updated (CLAUDE.md, TODO.md, etc. as appropriate)
- [ ] `npm run verify:claude-md` passes
- [ ] No `.only` or `.skip` left in test files
- [ ] Secrets, large binaries, and generated files are not accidentally staged
- [ ] Commit message follows Conventional Commits style (see below)

## 5. Commit Guidelines

Use **Conventional Commits** (this repo already follows the pattern):

```
<type>(<scope>): <short summary>

<body if needed>

Refs: #123 or related work
```

Common types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `build`, `ci`.

Good examples from history:

- `feat(auth): self-serve signup UI wired to existing /register`
- `fix(wizard): surface + retry failed starter-data seeding`
- `docs: Cluster-B defect 3 done + dashboard count 705`

**Never** commit directly to `main`. Always use the feature branch + PR flow.

## 6. The Commit Process (Recommended Tool)

Use the existing `commit-code` skill (tell your agent "commit" or "commit code").

For maximum automation before invoking the skill, first run:

```bash
npm run prepare-commit
```

This command automatically runs:

- Quality checks (format, lint, typecheck)
- Full unit test suite
- CLAUDE.md drift detector
- Detection of focused tests (.only / .skip)
- Basic checks for common issues in staged changes

After it finishes, review the output, fix anything it found, then proceed with the `commit-code` process.

See the skill at `.claude/skills/commit-code/SKILL.md` for the exact expectations.

## Branch & PR Hygiene (Critical Rule)

**Work on one active PR at a time.**

Before you create a new feature branch or open a new PR, the previous feature branch **must** have been:

- Pushed to its remote
- Merged into `main`
- Deleted (both locally and on the remote)

This rule prevents painful rebase conflicts and context loss when multiple long-lived branches exist in parallel.

The rule is enforced in:

- Output of `npm run prepare-commit`
- The `BRANCH_CHECKLIST.md` (required checkbox when starting a new branch)

When the rule set is updated in this repository, the equivalent changes are mirrored in the pixel-agents project (and vice versa) to keep the two codebases in sync on process.

## 7. Pull Request Process

See the dedicated **Branch & PR Hygiene (Critical Rule)** section above for the mandatory one-active-PR rule (previous branch must be pushed → merged → deleted before starting another).

This rule prevents painful rebase conflicts and context switching that happens when multiple long-lived branches exist.

1. Push your feature branch.
2. Open a PR against `main`.
3. Use the PR template (`.github/pull_request_template.md`). It includes the full pre-PR checklist from this document.
4. Ensure CI is green.
5. Self-review your own PR before asking for review (even as a solo developer).
6. Merge only after the checklist in section 4 is complete and CI passes.

GitHub Issue templates are also available in `.github/ISSUE_TEMPLATE/` (feature and bug) to help standardize how work is described when creating issues.

**Branch protection** on `main` is strongly recommended. See `.github/BRANCH_PROTECTION.md` for the exact settings that enforce this workflow.

## Local Git Hooks (Optional but Recommended)

Local Git hooks provide **early, fast feedback** before you even finish typing a commit message.

We provide two example hooks:

- `pre-commit`: Runs on staged files only (Prettier, ESLint, TypeScript). Fast and relevant.
- `pre-push`: Runs before pushing (full quality checks + unit tests). Stronger gate.

### How Hooks Are Installed (Automatic)

The hook system is now **automatic**.

When you run `npm install`, Husky (via the `"prepare": "husky"` script) will automatically install the Git hooks defined in the `.husky/` directory.

You no longer need to manually run `npm run setup-hooks` after cloning or switching machines.

The manual scripts (`setup-hooks` / `remove-hooks`) are kept for legacy / debugging purposes, but in normal use you should never need to run them — hooks install automatically.

To manually force hook installation (rarely needed):

```bash
npm run prepare
```

### Philosophy

- **Pre-commit hooks** = speed and relevance. They should never be so slow or noisy that you want to disable them.
- **Pre-push hooks** = stronger safety net before sharing code.
- These hooks are **local only** and **bypassable** (`--no-verify`). They are aids, not police.
- The real enforcement lives in the `commit-code` skill, the PR template, CI, and branch protection.

Use them for developer happiness. Rely on the later layers for quality.

## 8. Solo Developer Reality Check

This process is designed to be **lightweight but non-negotiable** for a solo developer. The enforcement comes from:

- The `commit-code` skill
- CI gates
- The `verify:claude-md` drift detector
- Your own discipline (aided by the optional local Git hooks via `npm run setup-hooks`)

Skipping steps (especially docs or relevant E2E) is the fastest way to accumulate technical debt and painful future debugging sessions.

---

**This workflow exists to protect future-you.**

When in doubt, follow the checklist. When the checklist feels painful, improve the tooling or the checklist — don't just skip it.
