-- Pilot #18 of the PK naming convention conversion (per CLAUDE.md).
-- Renames soft_reservations.id → soft_reservation_id.
--
-- Terminal in the schema (zero inbound FKs). Not versioned, not audited.
-- The purge_expired_soft_reservations() RPC operates on expires_at, not
-- on the PK column, so it needs no recreation. No code touches the PK
-- column directly — src/index.ts and src/medium-bugs.test.ts only call
-- the RPC, src/test-utils.ts only names the table in a teardown list.

BEGIN;

ALTER TABLE soft_reservations RENAME COLUMN id TO soft_reservation_id;

COMMIT;
