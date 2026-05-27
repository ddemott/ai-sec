# 2026-05-15: Markdown Simplification Effort (Superseded)

**Original PR**: `claude/read-markdown-files-3VDYh` — "docs: simplify worst-offender markdown files" (Draft, created 2026-05-15)

## Goal
Reduce the size and improve readability of several verbose documentation files that had become "worst offenders":

- **TEST_COVERAGE.md**: The "Last refreshed" section had grown into a ~700-word run-on paragraph. Goal: break it into 2 concise paragraphs and point older history to `RESOLVED.md`.

- **BUGS.md**: Reduced from 538 → 241 lines while preserving all 72 bug entries. Collapsed the verbose 5-bullet format (File/Problem/Impact/Fix/Status) into 2-3 lines. Compressed the April 2026 UI/UX 35-item audit into category summaries and turned the architecture review fixes into a compact table.

- **RESOLVED.md**: Reduced from 676 → 422 lines. The long 28-entry PK-rename pilot narrative was consolidated into a single entry + 28-row table. The May 7 front-desk audit list was turned into a 6-row table + paragraph.

- **ux-review-notes.md**: Moved to `docs/sessions/2026-04-30-ux-review.md` to follow the existing session notes convention. Updated related notes that referenced the old location.

**Key principle stated in the original work**: "No facts dropped — every commit hash, migration name, file path, count, and date is preserved."

## Why this PR was superseded (2026-05-27)
- Main advanced significantly with new refactoring work (REFACTORING_TODO items, shared/ extractions, new schema alignment verifier, etc.).
- Attempting to rebase the old branch produced large conflicts in the very files it was trying to simplify.
- The documentation philosophy on main continued to evolve toward heavier use of tables, archiving, and `RESOLVED.md`.

This note preserves the original intent and scope of the May 15 simplification effort for future reference.

**Original Claude session**: https://claude.ai/code/session_014qFcwxhAkUDmKv7kwLQone

**Decision (2026-05-27)**: Old Draft PR closed. Work will be redone on a fresh branch from current `main`.
