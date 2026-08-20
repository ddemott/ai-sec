-- Pilot #7 of the PK naming convention conversion (per CLAUDE.md).
-- Batch rename of two tenant_* config tables in a single migration:
--   tenant_docs.id              → tenant_doc_id
--   tenant_integration_settings.id → tenant_integration_setting_id
--
-- (tenant_calendar_settings was investigated and excluded — it has no
-- `id` column. Its PK is on `tenant_id` alone, an unusual design
-- worth revisiting later but not part of this pilot.)
--
-- Why batch: both tables are zero-inbound-FK internal config, both
-- follow the same recipe, and tenant_integration_settings has zero
-- code consumers reading `.id` (all CRUD is by (tenant_id, provider))
-- so the only real work is on tenant_docs. Single coordinated
-- migration is easier to roll back than two staggered ones.
--
-- Why DROP+CREATE the search_tenant_docs RPCs: their RETURNS TABLE
-- shape declares `id uuid` as the first column. Renaming the source
-- column means the RPC's contract must also rename to keep the
-- internal symmetry (RPC output column name matches the underlying
-- column). CREATE OR REPLACE FUNCTION cannot change RETURNS TABLE
-- shape — DROP first.

ALTER TABLE tenant_docs RENAME COLUMN id TO tenant_doc_id;
ALTER TABLE tenant_integration_settings RENAME COLUMN id TO tenant_integration_setting_id;

DROP FUNCTION IF EXISTS search_tenant_docs(uuid, vector, double precision, integer);

CREATE OR REPLACE FUNCTION search_tenant_docs(
    p_tenant_id UUID,
    p_query_embedding vector,
    p_match_threshold DOUBLE PRECISION,
    p_match_count INTEGER
) RETURNS TABLE(tenant_doc_id UUID, content TEXT, similarity DOUBLE PRECISION)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        td.tenant_doc_id,
        td.content,
        1 - (td.embedding <=> p_query_embedding) AS similarity
    FROM tenant_docs td
    WHERE td.tenant_id = p_tenant_id
      AND 1 - (td.embedding <=> p_query_embedding) > p_match_threshold
    ORDER BY td.embedding <=> p_query_embedding
    LIMIT p_match_count;
END;
$$;

DROP FUNCTION IF EXISTS search_tenant_docs_normalized(uuid, vector, double precision, integer);

CREATE OR REPLACE FUNCTION search_tenant_docs_normalized(
    p_tenant_id UUID,
    p_query_embedding vector,
    p_match_threshold DOUBLE PRECISION,
    p_match_count INTEGER
) RETURNS TABLE(tenant_doc_id UUID, content TEXT, normalized_text TEXT, similarity DOUBLE PRECISION)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        td.tenant_doc_id,
        td.content,
        td.normalized_text,
        1 - (td.embedding <=> p_query_embedding) AS similarity
    FROM tenant_docs td
    WHERE td.tenant_id = p_tenant_id
      AND 1 - (td.embedding <=> p_query_embedding) > p_match_threshold
    ORDER BY td.embedding <=> p_query_embedding
    LIMIT p_match_count;
END;
$$;

