-- Migration: reminder_and_consent_tables
-- Creates tables for communications and reminders services.
-- Tables:
--   - reminder_schedules: Scheduled appointment reminders
--   - consent_records: Customer communication consent tracking (GDPR/TCPA)
--   - opt_out_records: STOP/UNSUBSCRIBE tracking

-- ── Helper function ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── reminder_schedules ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reminder_schedules (
  id SERIAL PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_email VARCHAR(255),
  customer_phone VARCHAR(30),
  reminder_type VARCHAR(20) NOT NULL CHECK (reminder_type IN ('confirmation', '72h', '24h', '2h')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'failed', 'cancelled')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_reminder_schedules_tenant_id ON reminder_schedules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reminder_schedules_appointment_id ON reminder_schedules(appointment_id);
CREATE INDEX IF NOT EXISTS idx_reminder_schedules_status_scheduled_for ON reminder_schedules(status, scheduled_for)
  WHERE status = 'scheduled';

-- RLS for reminder_schedules
ALTER TABLE reminder_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY reminder_schedules_tenant_isolation ON reminder_schedules
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY reminder_schedules_admin_bypass ON reminder_schedules
  USING (current_setting('app.current_tenant_id', true) = '');

-- ── consent_records ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS consent_records (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email VARCHAR(255),
  customer_phone VARCHAR(30),
  consent_type VARCHAR(10) NOT NULL CHECK (consent_type IN ('email', 'sms', 'both')),
  consent_given BOOLEAN NOT NULL DEFAULT true,
  consent_date TIMESTAMPTZ NOT NULL,
  consent_method VARCHAR(20) NOT NULL CHECK (consent_method IN ('web_form', 'sms_reply', 'verbal', 'import', 'booking')),
  consent_source TEXT,
  ip_address INET,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- At least one contact method required
  CONSTRAINT consent_contact_required CHECK (customer_email IS NOT NULL OR customer_phone IS NOT NULL)
);

-- Indexes for consent lookups
CREATE INDEX IF NOT EXISTS idx_consent_records_tenant_id ON consent_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_customer_email ON consent_records(customer_email) WHERE customer_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consent_records_customer_phone ON consent_records(customer_phone) WHERE customer_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consent_records_customer_id ON consent_records(customer_id) WHERE customer_id IS NOT NULL;

-- RLS for consent_records
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;

CREATE POLICY consent_records_tenant_isolation ON consent_records
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY consent_records_admin_bypass ON consent_records
  USING (current_setting('app.current_tenant_id', true) = '');

-- ── opt_out_records ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS opt_out_records (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_email VARCHAR(255),
  customer_phone VARCHAR(30),
  opt_out_type VARCHAR(10) NOT NULL CHECK (opt_out_type IN ('email', 'sms', 'both')),
  opt_out_date TIMESTAMPTZ NOT NULL,
  opt_out_method VARCHAR(20) NOT NULL CHECK (opt_out_method IN ('stop', 'unsubscribe', 'web_form', 'verbal', 'complaint')),
  original_consent_id INTEGER REFERENCES consent_records(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- At least one contact method required
  CONSTRAINT opt_out_contact_required CHECK (customer_email IS NOT NULL OR customer_phone IS NOT NULL)
);

-- Indexes for opt-out lookups
CREATE INDEX IF NOT EXISTS idx_opt_out_records_tenant_id ON opt_out_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_opt_out_records_customer_email ON opt_out_records(customer_email) WHERE customer_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opt_out_records_customer_phone ON opt_out_records(customer_phone) WHERE customer_phone IS NOT NULL;

-- RLS for opt_out_records
ALTER TABLE opt_out_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE opt_out_records FORCE ROW LEVEL SECURITY;

CREATE POLICY opt_out_records_tenant_isolation ON opt_out_records
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY opt_out_records_admin_bypass ON opt_out_records
  USING (current_setting('app.current_tenant_id', true) = '');

-- ── Audit triggers ───────────────────────────────────────────────────

-- Update timestamp trigger for reminder_schedules
CREATE TRIGGER reminder_schedules_updated_at
  BEFORE UPDATE ON reminder_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Update timestamp trigger for consent_records
CREATE TRIGGER consent_records_updated_at
  BEFORE UPDATE ON consent_records
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ── Comments ─────────────────────────────────────────────────────────

COMMENT ON TABLE reminder_schedules IS 'Scheduled appointment reminders (confirmation, 72h, 24h, 2h before)';
COMMENT ON TABLE consent_records IS 'Customer communication consent tracking for GDPR/TCPA compliance';
COMMENT ON TABLE opt_out_records IS 'Customer opt-out (STOP/UNSUBSCRIBE) records for compliance';

COMMENT ON COLUMN reminder_schedules.reminder_type IS 'Type: confirmation (immediate), 72h, 24h, or 2h before appointment';
COMMENT ON COLUMN reminder_schedules.status IS 'Status: scheduled (pending), sent, failed, or cancelled';
COMMENT ON COLUMN consent_records.consent_method IS 'How consent was obtained: web_form, sms_reply, verbal, import, booking';
COMMENT ON COLUMN opt_out_records.opt_out_method IS 'How opt-out was requested: stop (SMS), unsubscribe (email), web_form, verbal, complaint';
