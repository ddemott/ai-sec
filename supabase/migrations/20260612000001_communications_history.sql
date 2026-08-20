-- Migration: communications_history
--
-- Records every outbound communication (SMS / email) that the platform
-- actually sends, so the dashboard and audits can show a per-tenant
-- delivery log. Previously GET /communications/history returned a hardcoded
-- empty stub ("not yet implemented"); this table backs the real query and is
-- written on the success path of EmailService.sendEmail / SMSService.sendSMS.
--
-- Shape mirrors consent_records / opt_out_records (append-only event tables):
--   * SERIAL PK named communications_history_id — the row's id is never
--     referenced from outside this table, so per the CLAUDE.md mental rule it
--     is SERIAL, not a surrogate UUID. FK columns that point at domain
--     entities (tenant_id, customer_id) remain UUID.
--   * RLS + FORCE ROW LEVEL SECURITY with the standard tenant_isolation +
--     admin_bypass policy pair, copied verbatim from consent_records.
--
-- Forward-only safe: pure additive CREATE TABLE IF NOT EXISTS, no backfill,
-- existing tenants unaffected.

CREATE TABLE IF NOT EXISTS communications_history (
  communications_history_id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(customer_id) ON DELETE SET NULL,
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'sms')),
  direction VARCHAR(10) NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(255),
  body TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'queued')),
  provider_message_id VARCHAR(255),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for the paginated per-tenant history query (newest first), and for
-- channel-filtered reads (?type=email / ?type=sms).
CREATE INDEX IF NOT EXISTS idx_communications_history_tenant_created
  ON communications_history(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_communications_history_tenant_channel
  ON communications_history(tenant_id, channel);

-- RLS for communications_history
ALTER TABLE communications_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications_history FORCE ROW LEVEL SECURITY;

CREATE POLICY communications_history_tenant_isolation ON communications_history
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY communications_history_admin_bypass ON communications_history
  USING (current_setting('app.current_tenant_id', true) = '');

-- Grant the restricted RLS-subject role (test/local only; prod uses a single
-- DATABASE_URL pool with no separate api_user) access to the new table and its
-- sequence. Guarded so it is a no-op where api_user does not exist (prod /
-- Supabase). Without this, the role-scoped RLS isolation tests would hit a bare
-- "permission denied" instead of exercising the tenant policy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_user') THEN
    GRANT ALL PRIVILEGES ON communications_history TO api_user;
    GRANT ALL PRIVILEGES ON SEQUENCE communications_history_communications_history_id_seq TO api_user;
  END IF;
END
$$;

-- ── Comments ─────────────────────────────────────────────────────────

COMMENT ON TABLE communications_history IS 'Append-only log of outbound (and optionally inbound) SMS/email communications, written on the send success path; backs GET /communications/history.';
COMMENT ON COLUMN communications_history.channel IS 'Communication channel: email or sms';
COMMENT ON COLUMN communications_history.direction IS 'Message direction: outbound (default) or inbound';
COMMENT ON COLUMN communications_history.recipient IS 'Destination address (email address or E.164 phone number)';
COMMENT ON COLUMN communications_history.status IS 'Delivery disposition recorded at send time: sent, failed, or queued';
COMMENT ON COLUMN communications_history.provider_message_id IS 'Upstream provider message id (nodemailer messageId / Telnyx ID; legacy provider SID references in old rows) for cross-referencing';

