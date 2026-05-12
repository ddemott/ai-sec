-- Pilot #25 (final) of the PK naming convention conversion (per CLAUDE.md).
-- Renames entity_sync_map.id → entity_sync_map_id.
--
-- Terminal in the schema (zero inbound FKs). Not versioned, not audited.
-- No RPCs, no views, no triggers reference the column. The pkey index is
-- automatically updated by Postgres on RENAME COLUMN.
--
-- Backend surface is 20 files but none reference the PK column — all 5
-- CRM service modules (syncMapHelpers, jobberSync, hubspotSync, squareSync,
-- servicetitanSync, crmDisconnect, crmSyncStatus) operate on the
-- (tenant_id, provider, entity_type, local_id, external_id) unique key
-- and never the surrogate PK. Tests likewise never name the column.

BEGIN;

ALTER TABLE entity_sync_map RENAME COLUMN id TO entity_sync_map_id;

COMMIT;
