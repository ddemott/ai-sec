-- customer_messages: messages left by callers during voice calls.
-- The agent records name + callback phone + message text; the owner is
-- notified via SMS at their forward_phone. Status tracks owner follow-up.
--
-- Isolation: RLS-scoped to tenant like all transactional tables.
-- PK convention: message_id UUID (domain entity, externally referenced).

CREATE TABLE customer_messages (
  message_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id    UUID        REFERENCES customers(customer_id),
  caller_phone   TEXT,
  caller_name    TEXT        NOT NULL,
  callback_phone TEXT,
  message        TEXT        NOT NULL,
  call_id        TEXT,
  status         TEXT        NOT NULL DEFAULT 'new',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_messages_tenant
  ON customer_messages(tenant_id, created_at DESC);

ALTER TABLE customer_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY customer_messages_tenant_isolation ON customer_messages
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
