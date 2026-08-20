-- Pilot #24 of the PK naming convention conversion (per CLAUDE.md).
-- Renames call_summaries.id → call_summary_id.
--
-- Terminal in the schema (zero inbound FKs). Not versioned, not audited.
-- No RPCs reference the column. No views. The pkey index references the
-- column implicitly and Postgres updates it automatically.
--
-- Code consumers never name the PK:
--   - src/routes/analytics.ts and agentTools.ts read SELECT specific
--     non-PK columns (summary, normalized_text)
--   - src/test-utils.ts only names the table in a teardown list
--   - rag-normalization.test.ts and crm-appointments.test.ts INSERT
--     with explicit column lists that omit the PK

ALTER TABLE call_summaries RENAME COLUMN id TO call_summary_id;

