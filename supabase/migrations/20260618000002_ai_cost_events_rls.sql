-- Enable RLS on ai_cost_events, missed in the initial migration.
-- Uses the same pattern as all other tenant-scoped tables.
ALTER TABLE ai_cost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_cost_events FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_cost_events_tenant_isolation ON ai_cost_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
