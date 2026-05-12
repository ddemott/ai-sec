-- Pilot #19 of the PK naming convention conversion (per CLAUDE.md).
-- Renames audit_log.id → audit_log_id.
--
-- Terminal in the schema (zero inbound FKs). Not versioned, not in the
-- fn_audit_trigger CASE (audit_log is the *destination* table of the
-- audit trigger, not a source — the trigger only fires on appointments,
-- customers, resources, and INSERTs into audit_log with explicit column
-- lists that never name the PK column).
--
-- The only code reference is dashboard/e2e/tenant-delete-cascade.spec.ts
-- which counts rows by tenant_id, never naming the PK column.

BEGIN;

ALTER TABLE audit_log RENAME COLUMN id TO audit_log_id;

COMMIT;
