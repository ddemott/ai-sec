-- Pilot #23 of the PK naming convention conversion (per CLAUDE.md).
-- Renames call_transcripts.id → call_transcript_id.
--
-- Terminal in the schema (zero inbound FKs). Not versioned, not audited.
-- One RPC needs recreation: link_orphaned_transcripts() has
-- `RETURNING ct.id` which is the renamed column. It just counts the
-- returning rowset, so a CREATE OR REPLACE swapping `id → call_transcript_id`
-- preserves behavior.
--
-- Code consumers never name the PK:
--   - src/routes/analytics.ts joins on call_id
--   - src/crm-appointments.test.ts inserts + joins on call_id
--   - src/test-utils.ts only names the table in a teardown list

BEGIN;

ALTER TABLE call_transcripts RENAME COLUMN id TO call_transcript_id;

CREATE OR REPLACE FUNCTION link_orphaned_transcripts(p_tenant_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_linked INTEGER := 0;
BEGIN
  -- Link transcripts that share a call_id with an appointment that has a customer
  WITH linked AS (
    UPDATE call_transcripts ct
    SET customer_id = a.customer_id
    FROM appointments a
    WHERE ct.tenant_id = p_tenant_id
      AND ct.customer_id IS NULL
      AND a.tenant_id = p_tenant_id
      AND a.call_id IS NOT NULL
      AND a.customer_id IS NOT NULL
      AND ct.call_id = a.call_id
    RETURNING ct.call_transcript_id
  )
  SELECT count(*) INTO v_linked FROM linked;

  RETURN v_linked;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
