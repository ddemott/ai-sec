# Portable Development Workflow Kit

This is the minimal set of files needed to adopt the reusable development workflow.

## Quick Start

1. Copy this entire folder into your project.
2. Follow the instructions in `ADOPTING_THE_WORKFLOW.md` (located at the root of the original project).
3. Customize `workflow.config.json` for your tooling and standards.
4. Run `npm install` (after adding Husky) to enable automatic hook installation.

## Contents

- `workflow.config.json` — The single file you edit to adapt the system
- `BRANCH_CHECKLIST.md` — Checklist copied into every feature branch
- `scripts/` — The automation scripts
- `.github/` — PR template, issue templates, and branch protection guidance

## Reference

The best instructions live in the parent project's `ADOPTING_THE_WORKFLOW.md` document.

You can point any team at that document + this kit and say:

> “Read the adoption guide and copy this kit. Customize the config. You now have the same process.”