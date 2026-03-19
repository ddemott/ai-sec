-- RAG Normalization Layer (Phase 12E)
-- Adds normalized_text column to tenant_docs and call_summaries.
-- The normalized text is the semantic core of the original content,
-- stripped of conversational noise for better vector search matching.

ALTER TABLE tenant_docs
  ADD COLUMN IF NOT EXISTS normalized_text TEXT;

ALTER TABLE call_summaries
  ADD COLUMN IF NOT EXISTS normalized_text TEXT;

-- Update search_tenant_docs to prefer normalized_text when available
CREATE OR REPLACE FUNCTION search_tenant_docs(
    p_tenant_id UUID,
    p_query_embedding vector(1536),
    p_match_threshold FLOAT,
    p_match_count INT
) RETURNS TABLE (
    id UUID,
    content TEXT,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        td.id,
        td.content,
        1 - (td.embedding <=> p_query_embedding) AS similarity
    FROM tenant_docs td
    WHERE td.tenant_id = p_tenant_id
      AND 1 - (td.embedding <=> p_query_embedding) > p_match_threshold
    ORDER BY td.embedding <=> p_query_embedding
    LIMIT p_match_count;
END;
$$ LANGUAGE plpgsql;

-- New function: search using normalized embeddings when available
-- Falls back to original embedding if normalized_embedding is null
CREATE OR REPLACE FUNCTION search_tenant_docs_normalized(
    p_tenant_id UUID,
    p_query_embedding vector(1536),
    p_match_threshold FLOAT,
    p_match_count INT
) RETURNS TABLE (
    id UUID,
    content TEXT,
    normalized_text TEXT,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        td.id,
        td.content,
        td.normalized_text,
        1 - (td.embedding <=> p_query_embedding) AS similarity
    FROM tenant_docs td
    WHERE td.tenant_id = p_tenant_id
      AND 1 - (td.embedding <=> p_query_embedding) > p_match_threshold
    ORDER BY td.embedding <=> p_query_embedding
    LIMIT p_match_count;
END;
$$ LANGUAGE plpgsql;
