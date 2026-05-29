-- Demo tenant support.
--
-- Adds is_demo and demo_expires_at to tenants so the /demo/start endpoint
-- can spin up isolated, ephemeral demo tenants that the cleanup worker
-- sweeps after they expire.
--
-- CASCADE on tenants covers every child table, so a single
-- DELETE FROM tenants WHERE is_demo AND demo_expires_at < NOW()
-- is the full teardown — no per-table cleanup needed.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMPTZ;

-- Partial index: only demo rows need fast expiry lookup.
CREATE INDEX IF NOT EXISTS idx_tenants_demo_expires
  ON tenants (demo_expires_at)
  WHERE is_demo = true;
