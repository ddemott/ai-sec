-- SMS delivery-receipt tracking (initially implemented for legacy provider).
--
-- Background: The (legacy) legacy adapter.sendSMS() previously called messages.create()
-- with NO statusCallback, so the system never learned whether an SMS that
-- was *accepted* actually got *delivered* to the handset. A transient-flake
-- audit (2026-06-12) flagged this blind spot. (legacy provider support fully removed
-- 2026-06; Telnyx is the only provider and uses an equivalent webhook.)
--
-- Fix: adapters pass a statusCallback/webhook_url pointing at
-- POST /communications/{provider}/status. Providers POST the message lifecycle.
-- This table is where the webhook records the latest status per message SID.
--
-- Why NOT an RLS-scoped table: the webhook is a public, tenant-exempt route
-- (provider sends no JWT and no app.current_tenant_id GUC). It writes via the
-- shared pool with no tenant context, so an RLS policy would reject inserts.
-- This is an append/upsert event table -- same shape as reminder_schedules /
-- consent_records: tenant_id is a plain UUID column (from the ?tenant_id=
-- query param on the callback URL) for read-side filtering, not RLS.
-- SERIAL surrogate PK; message_sid is the natural key (UNIQUE).
--
-- Forward-only safe: CREATE TABLE IF NOT EXISTS, no backfill. (legacy-specific
-- comments updated on removal of legacy provider support.)

BEGIN;

CREATE TABLE IF NOT EXISTS message_delivery_status (
  message_delivery_status_id SERIAL PRIMARY KEY,
  -- Message SID from provider (e.g. Telnyx ID; historical legacy provider SIDs like SMxx... in old rows). Natural key.
  -- One row per message, updated in place as status advances.
  message_sid TEXT NOT NULL UNIQUE,
  -- Latest MessageStatus (queued|sending|sent|delivered|undelivered|failed|received).
  message_status TEXT NOT NULL,
  -- Provider ErrorCode when undelivered/failed; NULL otherwise.
  error_code TEXT,
  -- Owning tenant, read back from the webhook's ?tenant_id= query param.
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

COMMENT ON TABLE message_delivery_status IS 'Latest SMS delivery status per message SID (from Telnyx or legacy provider webhooks). Non-RLS event table (webhook is tenant-exempt, writes via shared pool). Legacy provider support removed 2026-06.';
COMMENT ON COLUMN message_delivery_status.message_sid IS 'Provider Message SID/ID. UNIQUE -- one row per message, upserted as status advances.';
COMMENT ON COLUMN message_delivery_status.message_status IS 'Latest MessageStatus (queued|sending|sent|delivered|undelivered|failed|received).';

COMMIT;
