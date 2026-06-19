-- Accounting add-on (federation with MyAccountant). When a tenant enables the
-- add-on, SecHQ provisions a MyAccountant organization and stores its id here;
-- the Accounting tab embeds the MyAccountant dashboard for that org via SSO.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS accounting_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accounting_org_id UUID;
