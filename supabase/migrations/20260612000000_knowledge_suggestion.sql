-- Staging table for website-scraped policy suggestions.
-- Suggestions are reviewed/approved by owner before being ingested into tenant_docs (the live RAG KB).
-- Only 'confirmed' rows get embedded.

BEGIN;

CREATE TABLE IF NOT EXISTS knowledge_suggestion (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    question_id   TEXT,                    -- from question_bank.id, or NULL for discovered
    question      TEXT NOT NULL,           -- denormalized for discovered
    answer        TEXT,
    source_url    TEXT,
    confidence    REAL,
    status        TEXT NOT NULL DEFAULT 'suggested',  -- 'suggested' | 'confirmed' | 'rejected'
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_suggestion_tenant_idx ON knowledge_suggestion (tenant_id);
CREATE INDEX IF NOT EXISTS knowledge_suggestion_status_idx ON knowledge_suggestion (tenant_id, status);

ALTER TABLE knowledge_suggestion ENABLE ROW LEVEL SECURITY;

-- Tenant isolation (same pattern as tenant_docs, tenant_custom_question).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'knowledge_suggestion'
          AND policyname = 'knowledge_suggestion_tenant_isolation'
    ) THEN
        CREATE POLICY "knowledge_suggestion_tenant_isolation" ON knowledge_suggestion
            FOR ALL
            USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::UUID);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'knowledge_suggestion'
          AND policyname = 'knowledge_suggestion_admin_bypass'
    ) THEN
        CREATE POLICY "knowledge_suggestion_admin_bypass" ON knowledge_suggestion
            FOR ALL
            USING (current_setting('app.current_tenant_id', true) = '');
    END IF;
END
$$;

COMMENT ON TABLE knowledge_suggestion IS 'Staged website-extracted policy answers. Only status=confirmed rows are ingested to tenant_docs for live RAG.';

COMMIT;
