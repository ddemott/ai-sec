# Product UX Auditor

A Claude Code slash command that audits this dashboard for UX/UI issues, mobile responsiveness, and accessibility, then writes a self-contained HTML report with embedded SVG diagrams (visual sitemap, severity heatmap, before/after wireframes for each top-10 finding).

The audit does **static code analysis** — Claude reads source code and infers UX from JSX/Tailwind/CSS. It cannot render the app or take screenshots.

## Usage

From within a Claude Code session in this repo:

```
/ux-audit
```

Optional focus argument:

```
/ux-audit mobile only
/ux-audit Schedule and Customers tabs
/ux-audit accessibility — WCAG 2.1 AA only
```

The report lands at `scripts/ux-audit/reports/<timestamp>/ux-audit.html`. Claude prints the `file://` URL at the end — click it to open.

## How it works

The command is defined in `.claude/commands/ux-audit.md`. It runs inside your current Claude Code session, using your existing Claude.ai auth — no API key, no GitHub PAT, no separate billing. The agent reads your local working tree (not just `main`), so audits reflect in-progress changes.

## Updating the methodology

Edit `.claude/commands/ux-audit.md`. Changes take effect the next time you run `/ux-audit` — no setup step.

## Caveats

- **Static analysis only.** Visual issues that need real rendering (cramped spacing, alignment off by a pixel, real responsive behavior on iPhone) are inferred from code, not observed.
- **No analytics.** The audit can't tell you what's slow or confusing in practice, only what *looks* problematic in the code.
- **Reports are gitignored** by the local `.gitignore`. Move a report up a level if you want to commit it.

## Why not a Managed Agent?

Earlier this directory held a Managed Agents setup (separate cloud product, requires an Anthropic API key and a GitHub PAT, audits a cloned-from-GitHub copy of the repo in a sandbox container). That shape makes sense if you want to call this audit from server code, schedule it, or run it against external repos. For "I want to run an audit when I want one, from my terminal," the slash command is simpler — same Claude, same auth you already have, reads your real working tree.
