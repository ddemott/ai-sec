-- Phone verification via SMS OTP. Used when the LiveKit agent can't trust
-- the caller-ID (blocked, garbled, or absent) and needs to confirm a phone
-- number the caller provides verbally before taking a booking.
--
-- code_hash stores bcrypt($raw_code); raw code is never persisted. Codes
-- expire after 10 minutes and tolerate up to 5 verification attempts.

CREATE TABLE IF NOT EXISTS phone_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE phone_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_verifications FORCE ROW LEVEL SECURITY;

CREATE POLICY phone_verifications_tenant_isolation ON phone_verifications
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY phone_verifications_admin_bypass ON phone_verifications
  USING (current_setting('app.current_tenant_id', true) = '' OR current_setting('app.current_tenant_id', true) IS NULL);

-- Lookup index: agent verifies by (tenant, phone) and wants the most recent
-- unverified, unexpired row. Partial indexes keep the hot path narrow.
CREATE INDEX idx_phone_verifications_active
  ON phone_verifications(tenant_id, phone, created_at DESC)
  WHERE verified_at IS NULL;

-- Rate-limit support: count recent sends per phone + per tenant.
CREATE INDEX idx_phone_verifications_rate_limit
  ON phone_verifications(tenant_id, phone, created_at DESC);
