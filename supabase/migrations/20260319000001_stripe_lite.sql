-- Stripe Lite (Phase 12F)
-- Adds subscription fields to tenants for billing gate.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT; -- 'solo' or 'growth'

-- Index for webhook lookups by stripe_customer_id
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer
  ON tenants (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
