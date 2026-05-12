-- Pilot #21 of the PK naming convention conversion (per CLAUDE.md).
-- Renames phone_verifications.id → phone_verification_id.
--
-- Terminal in the schema (zero inbound FKs). Not versioned, not audited.
-- No RPCs reference the column. Consumers:
--   - src/routes/agentTools.ts /send-verification-code (INSERT, no PK ref)
--     and /verify-phone-code (SELECT PK + 2× UPDATE WHERE PK)
--   - dashboard/e2e/agent-conversation.spec.ts pre-insert helper
--   - dashboard/e2e/auth-flows.spec.ts pre-insert helper
--
-- The /verify-phone-code SELECT keeps `SELECT phone_verification_id AS id`
-- so its TS row-type {id: string} stays valid; the two UPDATE WHERE
-- clauses switch directly to the new column.

BEGIN;

ALTER TABLE phone_verifications RENAME COLUMN id TO phone_verification_id;

COMMIT;
