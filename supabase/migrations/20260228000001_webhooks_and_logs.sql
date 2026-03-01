-- Call Transcripts: Raw text from Vapi for post-call processing
CREATE TABLE IF NOT EXISTS call_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id TEXT NOT NULL UNIQUE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    raw_text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Soft Reservations: Prevent double-booking during AI verbal confirmation
CREATE TABLE IF NOT EXISTS soft_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    call_id TEXT NOT NULL
);

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_soft_reservations_expires_at ON soft_reservations(expires_at);

-- Add n8n Webhook URL to Tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS n8n_webhook_url TEXT;

-- Trigger Function: Notify n8n on new appointment
-- Note: In a real Supabase environment, you'd use "Database Webhooks". 
-- Here we provide the SQL logic that could be adapted.
CREATE OR REPLACE FUNCTION notify_n8n_on_appointment()
RETURNS TRIGGER AS $$
BEGIN
  -- This is a placeholder for the actual HTTP call 
  -- In Supabase, this would be handled via the 'net' extension or Dashboard Webhooks.
  -- For now, we log it so we can see it in tests.
  RAISE NOTICE 'NOTIFICATION: New appointment % created for tenant %. Triggering n8n...', NEW.id, NEW.tenant_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notify_n8n_appointment ON appointments;
CREATE TRIGGER trigger_notify_n8n_appointment
AFTER INSERT ON appointments
FOR EACH ROW
EXECUTE FUNCTION notify_n8n_on_appointment();
