-- supabase/migrations/20260629000000_tenant_forwarded_from_phone.sql
-- The line a tenant forwards INTO the assistant (caller-ID match → collect the
-- caller's real number by voice). Distinct from forward_phone (the live-transfer
-- target) so the two can't be the same number and loop the call back to the AI.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS forwarded_from_phone TEXT;

COMMENT ON COLUMN tenants.forwarded_from_phone IS
  'E.164 line that forwards calls into the assistant. When the SIP caller-ID matches this, the agent nulls callerPhone and collects the caller''s real number verbally. Distinct from forward_phone (transfer target).';
