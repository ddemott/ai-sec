-- Twilio SMS delivery-receipt tracking.
--
-- Background: TwilioAdapter.sendSMS() previously called messages.create()
-- with NO statusCallback, so the system never learned whether an SMS that
-- was *accepted* by Twilio actually got *delivered* to the handset. A
-- transient-flake audit (2026-06-12) flagged this blind spot: a reminder
-- could be "sent" (Twilio accepted it) yet silently undelivered (carrier
-- rejected, number unreachable) with no signal anywhere in the product.
--
-- Fix: the adapter now passes a statusCallback URL pointing at
-- POST /communications/twilio/status. Twilio POSTs the message lifecycle
-- (queued -> sent -> delivered, or -> undelivered/failed) as form-encoded
-- callbacks. This table is where the webhook records the latest status per
-- message SID so it can be read back.
--
-- Why NOT an RLS-scoped table: the webhook is a public, tenant-exempt route
-- (Twilio sends no JWT and no app.current_tenant_id GUC). It writes via the
-- shared pool with no tenant context, so an RLS USING(tenant_id = ...current
-- setting) policy would reject every insert. This is an append/upsert event
-- table -- same shape rationale as reminder_schedules / consent_records:
-- tenant_id is carried as a plain UUID column (sourced from the
-- statusCallback URL's ?tenant_id= param) for read-side filtering, not as an
-- RLS gate. SERIAL surrogate PK (internal sequence number, never referenced
-- from outside this table); message_sid is the natural lookup key (UNIQUE).
--
-- Forward-only safe: CREATE TABLE IF NOT EXISTS, no backfill.

BEGIN;

CREATE TABLE IF NOT EXISTS message_delivery_status (
  message_delivery_status_id SERIAL PRIMARY KEY,
  -- Twilio Message SID (SMxx...). Natural key -- one row per message, updated
  -- in place as the status advances (queued -> sent -> delivered).
  message_sid TEXT NOT NULL UNIQUE,
  -- Latest Twilio MessageStatus: queued|sending|sent|delivered|undelivered|failed|received.
  message_status TEXT NOT NULL,
  -- Twilio ErrorCode (e.g. 30008) when status is undelivered/failed; NULL otherwise.
  error_code TEXT,
  -- Owning tenant, read back from the statusCallback URL's ?tenant_id= param.
  -- Plain column (not RLS-enforced) so the tenant-exempt webhook can insert.
  tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  -- First time we saw any callback for this SID.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Updated on every subsequent status callback (latest-wins upsert).
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read-back path: "show delivery status for this tenant's recent messages".
CREATE INDEX IF NOT EXISTS idx_message_delivery_status_tenant
  ON message_delivery_status(tenant_id, updated_at DESC);

COMMENT ON TABLE message_delivery_status IS 'Latest Twilio SMS delivery status per message SID, recorded by POST /communications/twilio/status. Non-RLS event table (webhook is tenant-exempt, writes via shared pool).';
COMMENT ON COLUMN message_delivery_status.message_sid IS 'Twilio Message SID (SMxxx). UNIQUE -- one row per message, upserted as status advances.';
COMMENT ON COLUMN message_delivery_status.message_status IS 'Latest Twilio MessageStatus (queued|sending|sent|delivered|undelivered|failed|received).';

COMMIT;
