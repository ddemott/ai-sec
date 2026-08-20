-- Pilot 4 follow-up: rename role-based FK column to match the new
-- consent_records PK column name.
--
-- Per CLAUDE.md sub-rule (b), role-prefixed FKs keep the `_<table>_id`
-- suffix so the column name self-describes the referenced table. Pilot 4
-- (`20260512000003_consent_records_pk_rename.sql`) renamed
-- `consent_records.id → consent_record_id` but explicitly deferred the
-- inbound FK rename to "a follow-up rename so the suffix stays consistent."
-- That follow-up was never tracked. This is it.
--
-- Postgres updates the FK CONSTRAINT's target automatically on `RENAME
-- COLUMN`, but the FK COLUMN's own name on the source table doesn't
-- change without an explicit ALTER — hence this migration.

ALTER TABLE opt_out_records
  RENAME COLUMN original_consent_id TO original_consent_record_id;

