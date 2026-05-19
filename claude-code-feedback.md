# Claude Code — Feedback / Bug Reports

> **Scope of this file:** working scratchpad for issues with the Claude Code tool itself (not the SecretaryHQ project). Lives at the repo root for convenience; not meant as canonical project documentation. Items should be migrated out (filed as GitHub issues, +1'd against existing ones, or deleted) over time. If this file goes stale or empty, it's safe to delete.

Log of issues and feature gaps to file with Anthropic. Submission channels: [Claude Code GitHub issues](https://github.com/anthropics/claude-code/issues) or `/help` feedback.

---

## Remote Control — Half-Built UI (high priority)

The `/remote-control` feature ships unfinished. Discovered while trying to clean up an accumulated list of sessions on `claude.ai/code` (2026-04-30).

### 1. No client-side delete for remote-control sessions

- Session list at `claude.ai/code` grows unbounded with every `claude remote-control` invocation
- No UI button (no delete icon, no right-click menu, no bulk action, no Settings → "revoke all")
- No CLI command (`/logout` only clears credentials, doesn't revoke server-side sessions)
- No local config file under `~/.claude/` to wipe
- Sessions persist after binary uninstall + reinstall (server-side, account-scoped)
- **Tracked**: [#50496](https://github.com/anthropics/claude-code/issues/50496), [#28917](https://github.com/anthropics/claude-code/issues/28917)
- **Wanted**: per-session delete icon on hover, OR bulk-clear under Settings, OR `claude sessions revoke <id>` CLI

### 2. Archive icon missing on some sessions

- Some sessions in the list have the archive icon on hover; others don't, with no visible reason why
- Browser refresh sometimes makes it appear, sometimes doesn't
- **Tracked**: [#24534](https://github.com/anthropics/claude-code/issues/24534) (archive filter missing on Windows)
- **Wanted**: archive control rendered consistently regardless of session state

### 3. Archived sessions reappearing as active

- After archiving, sessions sometimes resurface in the active list with a pulsing "running" indicator, requiring re-archive
- **Tracked**: [#13402](https://github.com/anthropics/claude-code/issues/13402)
- **Wanted**: archive should be sticky

### 4. Archived sessions disappearing entirely

- Some users report archive moves sessions to an unfindable state (no Archived filter, no recovery path)
- **Tracked**: [#22931](https://github.com/anthropics/claude-code/issues/22931)
- **Wanted**: archived sessions should always be retrievable via a clearly-labeled filter

### 5. No permanent-delete escape hatch

- Even when archive works, there's no way to permanently remove a session from the backing store
- Sessions persist in JSON files under `~/.claude/projects/` indefinitely
- **Wanted**: "Permanently delete" action on archived sessions, or auto-purge after configurable retention

### 6. No documented session retention TTL

- Network-disconnect timeout (~10 min) marks sessions offline but doesn't remove them
- Docs don't specify whether offline sessions auto-expire after 30/90/N days, or persist forever
- **Wanted**: documented retention policy + visible TTL on each session entry

---

## Other (add as encountered)

_Items below this line are non-remote-control feedback collected over time._

(none yet)
