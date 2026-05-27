# Adopting This Development Workflow

**Point other projects here.**

If you want another team or project to adopt the same development, branching, testing, documentation, and commit processes, send them this document + the `portable-workflow-kit/` folder.

Everything they need is contained in this file and the kit.

The goal is to give you a battle-tested, lightweight-but-rigorous system for:

- Consistent branching
- Automated quality gates
- Documentation hygiene
- Reliable commit and PR processes

## Quick Start (5–10 minutes)

### Easiest Way (Recommended)

In the source project, run:

```bash
npm run generate-kit -- --zip
```

This will create a clean, ready-to-distribute copy in `dist/portable-workflow-kit/` plus a zip file.

**Advanced options for releases:**

```bash
# Bump version + create git tag + zip
npm run generate-kit -- --zip --tag --bump patch

# Use a custom tag prefix
npm run generate-kit -- --zip --tag --bump minor --tag-prefix "my-workflow/v"
```

Supported bump types: `patch`, `minor`, `major`.

Then give the recipient the zip (or the folder) + point them to this document.

### Manual Way

1. Copy the entire `portable-workflow-kit/` folder into your repository.
2. Read and customize `workflow.config.json` (inside the kit).
3. Follow the step-by-step instructions in this document.

## What You Get

- Automated branch creation with quality gates
- Local Git hooks (pre-commit + pre-push) managed via Husky
- Powerful `prepare-commit` automation
- Clear checklists and PR templates
- Strong emphasis on testing + documentation
- A repeatable process that works for solo developers and small teams

## Step-by-Step Adoption Guide

### 1. Copy the Adoption Kit

Copy the entire `portable-workflow-kit/` directory into your project.

Recommended location: project root.

### 2. Customize `workflow.config.json`

This is the most important file.

Open it and update the values under these sections:

- `branching` – main branch name and allowed prefixes
- `commands` – replace with your actual commands for:
  - `checks`
  - `unitTests`
  - `build`
  - `docDriftCheck`
  - etc.
- `documentation.filesThatMustBeUpdated` – list the docs your project cares about
- `testing` – your test frameworks and rules
- `commitProcess` – whether you want Conventional Commits, etc.

### 3. Install Supporting Scripts

Copy the scripts from the kit into your `scripts/` folder (create it if needed):

- `create-feature-branch.sh`
- `prepare-commit.sh`
- `setup-hooks.sh`
- `remove-hooks.sh`
- The example hook scripts

Make them executable:

```bash
chmod +x scripts/*.sh
```

### 4. Add npm Scripts

Add these entries to your `package.json`:

```json
"scripts": {
  "create-branch": "bash scripts/create-feature-branch.sh",
  "prepare-commit": "bash scripts/prepare-commit.sh",
  "setup-hooks": "bash scripts/setup-hooks.sh",
  "remove-hooks": "bash scripts/remove-hooks.sh",
  "checks": "npm run format:check && npm run lint && npx tsc --noEmit",
  "pre-pr": "npm run checks && npm test"
}
```

Adjust the `checks` and `pre-pr` commands to match your project.

### 5. Set Up Git Hooks (Automatic)

The kit uses **Husky** for automatic hook management.

1. Install Husky:

   ```bash
   npm install --save-dev husky
   ```

2. Add this to your `package.json` scripts:

   ```json
   "prepare": "husky"
   ```

3. Copy the `.husky/` folder from the kit into your project (or create the hooks manually using the examples).

After running `npm install`, the hooks will be installed automatically.

### 6. Copy Supporting Files

Copy these into your project (recommended locations):

- `docs/BRANCH_CHECKLIST.md` → `docs/BRANCH_CHECKLIST.md`
- `.github/pull_request_template.md`
- `.github/BRANCH_PROTECTION.md`
- `.github/ISSUE_TEMPLATE/` (feature.md and bug.md)

### 7. Set Up Branch Protection (Recommended)

Follow the recommendations in `.github/BRANCH_PROTECTION.md`.

This is one of the highest-leverage things you can do to enforce the workflow.

### 8. Update Your Main Documentation

Add a section to your `README.md` or `CONTRIBUTING.md`:

```markdown
## Development Workflow

We use a structured development workflow. See `ADOPTING_THE_WORKFLOW.md` (or the portable guide in this repo) for details.
```

Point people to `PORTABLE_DEVELOPMENT_WORKFLOW.md` + `workflow.config.json` if you want them to understand the full system.

## Customizing Further

The `workflow.config.json` file is designed to be the single place you change when adapting the system.

Common customizations:

- Change test commands
- Add or remove required documentation files
- Adjust hook behavior (e.g., make pre-commit stricter or more lenient)
- Change branch naming rules

## Philosophy

This system is deliberately:

- **Lightweight enough for solo developers**
- **Strong enough to protect future-you**
- **Opinionated but adaptable**

It automates what can reasonably be automated and leaves human judgment where it belongs (commit messages, scope decisions, final review).

## Questions?

The best reference implementations are in the original project that developed this system.

Look at:

- `PORTABLE_DEVELOPMENT_WORKFLOW.md`
- `workflow.config.json`
- The scripts in the kit

You can point any project at this document and say:

> “Read `ADOPTING_THE_WORKFLOW.md`. Copy the `portable-workflow-kit/` folder. Customize `workflow.config.json`. You now have the same process we use.”

---

**Welcome to a more disciplined way of building software.**
