-- Pilot #17 of the PK naming convention conversion (per CLAUDE.md).
-- Renames user_feedback.id → user_feedback_id.
--
-- Terminal in the schema (zero inbound FKs). Not versioned, not audited
-- (no entries in auto_version_trigger or fn_audit_trigger CASE). No RPCs
-- reference the column. Only one consumer: src/routes/analytics.ts uses
-- INSERT and SELECT * — never references the PK column directly.

BEGIN;

ALTER TABLE user_feedback RENAME COLUMN id TO user_feedback_id;

COMMIT;
