-- Fix two RLS gaps surfaced by the 2026-06-19 baseline regeneration.
--
-- 1. knowledge_suggestion had ENABLE ROW LEVEL SECURITY but NOT FORCE. The app
--    connects as the table-owning role, and Postgres exempts table owners from
--    RLS unless FORCE is set — so the tenant-isolation policy was effectively
--    bypassed, exposing one tenant's staged website-scan suggestions to another.
--    Every other tenant-scoped table FORCEs RLS (see CLAUDE.md).
--
-- 2. ai_cost_events_tenant_isolation cast current_setting('app.current_tenant_id')
--    straight to uuid — no NULLIF(...,'') and no missing_ok=true — so any query
--    while the tenant GUC is unset/empty (e.g. an admin/no-tenant context) raised
--    "invalid input syntax for type uuid" instead of simply matching no rows.
--    Every other policy uses the NULLIF + missing_ok pattern; this aligns it.

ALTER TABLE knowledge_suggestion FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_cost_events_tenant_isolation ON ai_cost_events;
CREATE POLICY ai_cost_events_tenant_isolation ON ai_cost_events
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
