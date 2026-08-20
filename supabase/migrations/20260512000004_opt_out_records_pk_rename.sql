-- Pilot #5 for the PK naming convention (per CLAUDE.md).
-- Renames opt_out_records.id → opt_out_record_id.
--
-- Last of the three audit-table SERIAL-PK pilots. Zero inbound FKs.
-- Zero RPCs or views. The TS `OptOutRecord` interface uses camelCase
-- (`tenantId`, `customerEmail`, `optOutType`, etc.) — divergent from the
-- snake_case convention every other row-shape type uses in this repo,
-- but established by the original author. To stay internally consistent
-- within the OptOutRecord type, the new TS field is `optOutRecordId`
-- (camelCase), aliased in the DB layer via `RETURNING opt_out_record_id
-- as "optOutRecordId"`. Converting OptOutRecord to snake_case would
-- touch the consent service + tests broadly and is unrelated to the
-- PK-name standardization — not in scope.

ALTER TABLE opt_out_records RENAME COLUMN id TO opt_out_record_id;

