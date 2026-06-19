# Branch Protection Recommendations

This document describes the recommended branch protection rules for the `main` branch. Even as a solo developer, these rules provide safety and enforce the development workflow.

## Recommended Settings for `main`

Go to **Settings → Branches → Branch protection rules → Add rule** for the `main` branch.

### Required settings (strongly recommended)

- [x] **Require a pull request before merging**
  - Required approvals: 0 (or 1 if you ever want a second set of eyes)
  - Dismiss stale pull request approvals when new commits are pushed
  - Require review from Code Owners (optional, useful later)

- [x] **Require status checks to pass before merging**
  - **Required status checks** (at minimum):
    - `Backend (typecheck + tests + integration)` (from `.github/workflows/ci.yml`)
    - `Dashboard (typecheck + tests)` (add this job to CI if not already present)
  - Require branches to be up to date before merging (recommended)

- [x] **Require branches to be up to date before merging**
  - This forces you to rebase/merge latest `main` before the PR can be merged.

- [x] **Require conversation resolution before merging**
  - Forces all review comments to be resolved.

- [x] **Restrict who can push to matching branches**
  - Only allow pushes via pull requests (even for the repo owner).

### Additional recommended settings

- [x] **Include administrators** (check this)
  - Applies the rules to you as well — prevents accidental direct pushes to `main`.

- [x] **Allow force pushes** → **Do not allow**
  - Keep this off for `main`.

- [x] **Allow deletions** → **Do not allow**
  - Keep this off.

- [x] **Require signed commits** (optional but good practice)

### Nice-to-have (when the team or project grows)

- Require approval from at least one Code Owner for sensitive paths (`src/`, `dashboard/`, `scripts/`, etc.).
- Require linear history (no merge commits) — personal preference.
- Require successful deployment to a staging environment before merging.

## How to Set This Up

1. Go to the repository on GitHub.
2. **Settings** → **Branches**.
3. Under "Branch protection rules", click **Add branch protection rule**.
4. Branch name pattern: `main`
5. Check the boxes listed above.
6. Save changes.

## Enforcement Alignment with Our Workflow

These protection rules directly support the process defined in `docs/DEVELOPMENT_WORKFLOW.md`:

- You **cannot** push directly to `main` (enforces feature branches).
- You **must** open a PR (enforces the PR template and checklist).
- CI must pass (enforces `checks`, `pre-pr`, and relevant tests).
- The PR template checklist must be mentally satisfied before you can merge.

This combination (branch protection + PR template + `commit-code` skill + local checklist) creates multiple layers of safety.

---

**Note for solo developers**: It is tempting to turn these rules off "because it's just me." Experience shows that the friction these rules add is exactly what prevents the painful "I broke main at 2am" situations. Keep them on.
