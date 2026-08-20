-- Pilot #4 for the PK naming convention (per CLAUDE.md).
-- Renames consent_records.id → consent_record_id.
--
-- Inbound FK: opt_out_records.original_consent_id references this column.
-- Postgres updates the FK target automatically on RENAME COLUMN, so no
-- separate ALTER on opt_out_records is needed. The FK COLUMN's name
-- (`original_consent_id`) is role-based ("the original consent the
-- opt-out revoked"); per the standard it should become
-- `original_consent_record_id` in a follow-up rename so the suffix
-- stays consistent. Tracked separately — not part of this pilot.

ALTER TABLE consent_records RENAME COLUMN id TO consent_record_id;

