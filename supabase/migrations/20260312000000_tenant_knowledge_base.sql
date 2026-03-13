-- Tenant Knowledge Base for RAG
CREATE TABLE IF NOT EXISTS tenant_docs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title TEXT,
    section TEXT,
    content TEXT NOT NULL,
    source TEXT, -- e.g., 'manual.pdf', 'website_faq'
    embedding vector(1536), -- Match OpenAI text-embedding-3-small dimensions
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on the new table
ALTER TABLE tenant_docs ENABLE ROW LEVEL SECURITY;

-- Policy: Only allow tenant owners to see their own docs
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'tenant_docs' 
        AND policyname = 'Tenant docs are isolated by tenant_id'
    ) THEN
        CREATE POLICY "Tenant docs are isolated by tenant_id" ON tenant_docs
            FOR ALL
            USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::UUID);
    END IF;
END
$$;

-- Index for faster vector similarity search (using IVFFlat or HNSW)
-- We'll start with HNSW for high performance on medium-sized datasets
CREATE INDEX IF NOT EXISTS tenant_docs_embedding_idx ON tenant_docs
USING hnsw (embedding vector_cosine_ops);

-- Semantic Search Function (The "Open Book" Search)
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
