-- Track questions the AI couldn't answer from the knowledge base.
-- Helps business owners see gaps in their KB and improve coverage over time.

CREATE TABLE IF NOT EXISTS unanswered_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  caller_phone TEXT,
  call_id TEXT,
  caller_message TEXT,          -- optional message the caller left for the owner
  owner_notified BOOLEAN NOT NULL DEFAULT false,
  resolved BOOLEAN NOT NULL DEFAULT false,  -- owner can mark resolved after updating KB
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE unanswered_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE unanswered_questions FORCE ROW LEVEL SECURITY;

CREATE POLICY unanswered_questions_tenant_isolation ON unanswered_questions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY unanswered_questions_admin_bypass ON unanswered_questions
  USING (current_setting('app.current_tenant_id', true) = '' OR current_setting('app.current_tenant_id', true) IS NULL);

CREATE INDEX idx_unanswered_questions_tenant ON unanswered_questions(tenant_id, created_at DESC);
CREATE INDEX idx_unanswered_questions_unresolved ON unanswered_questions(tenant_id) WHERE resolved = false;
