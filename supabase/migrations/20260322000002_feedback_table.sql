-- User feedback collected from in-app feedback button
-- Captures page context automatically so we know where they were

CREATE TABLE IF NOT EXISTS user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  page TEXT NOT NULL,           -- e.g., 'Back Office > Services & Resources > Staffing Map'
  context TEXT,                 -- auto-generated: what they were looking at
  comment TEXT NOT NULL,        -- the user's feedback
  rating INTEGER,               -- optional 1-5 star rating
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'feedback_tenant_isolation') THEN
    CREATE POLICY feedback_tenant_isolation ON user_feedback
      FOR ALL USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::UUID);
  END IF;
END $$;

-- Grant to api_user
GRANT SELECT, INSERT ON user_feedback TO api_user;
