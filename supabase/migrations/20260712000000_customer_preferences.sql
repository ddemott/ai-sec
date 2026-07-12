-- Customer preferences become a first-class table.
--
-- Before: preferences were a jsonb blob at customers.metadata->'preferences',
-- deep-merged by /agent-tools/save-customer-preference. Durable and attached to
-- the customer, but opaque: you couldn't ask "which customers prefer Maria?",
-- couldn't tell when a preference was last confirmed, and the value was capped
-- at 500 chars by the API's Zod schema.
--
-- After: one row per (customer, key). Natural composite PK per the project's
-- key convention — the pair IS the identity, so no surrogate UUID. pref_value is
-- unbounded TEXT. updated_at tells you how stale a preference is (a "preferred
-- stylist" from 2 years ago is worth re-confirming, not asserting).
--
-- The metadata blob is backfilled into the table and then STRIPPED, so there is
-- exactly one source of truth. Anything still reading metadata->'preferences'
-- after this migration reads {} — the read paths move in the same commit
-- (agentTools/identity.ts + get_customer_context_for_call, redefined below).

BEGIN;

CREATE TABLE IF NOT EXISTS customer_preferences (
    tenant_id   UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    -- Slugified by the API (lowercase, non-alphanumerics → underscore), e.g.
    -- 'preferred_stylist'. Stable across calls: re-saving the same key UPDATES.
    pref_key    TEXT NOT NULL,
    -- Plain text, no length limit. The API caps it generously (4000) as a guard
    -- against a runaway LLM value, but the column itself does not constrain it.
    pref_value  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (customer_id, pref_key)
);

-- The PK covers per-customer lookup (the hot path: load one caller's prefs).
-- This index serves the cross-customer questions the jsonb blob couldn't answer
-- — "everyone whose preferred_stylist is Maria" — scoped by tenant.
CREATE INDEX IF NOT EXISTS customer_preferences_tenant_key_idx
    ON customer_preferences (tenant_id, pref_key);

ALTER TABLE customer_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_preferences FORCE ROW LEVEL SECURITY;

-- Tenant isolation (same pattern as knowledge_suggestion / tenant_docs).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'customer_preferences'
          AND policyname = 'customer_preferences_tenant_isolation'
    ) THEN
        CREATE POLICY "customer_preferences_tenant_isolation" ON customer_preferences
            FOR ALL
            USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::UUID);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'customer_preferences'
          AND policyname = 'customer_preferences_admin_bypass'
    ) THEN
        CREATE POLICY "customer_preferences_admin_bypass" ON customer_preferences
            FOR ALL
            USING (current_setting('app.current_tenant_id', true) = '');
    END IF;
END
$$;

COMMENT ON TABLE customer_preferences IS
    'Durable per-customer preferences captured by the voice agent (save_customer_preference) — preferred staff, last service, likes/dislikes, standing requests. One row per (customer, key); re-saving a key updates it. Replaced the customers.metadata->preferences jsonb blob 2026-07-12.';

-- Backfill: every existing key/value in the blob becomes a row. jsonb_each_text
-- flattens {"preferred_stylist":"Maria"} → ('preferred_stylist','Maria').
-- Soft-deleted customers are included: the row is FK'd to the customer and
-- cascades with it, and excluding them would silently drop preferences for a
-- customer who gets restored.
INSERT INTO customer_preferences (tenant_id, customer_id, pref_key, pref_value)
SELECT c.tenant_id, c.customer_id, p.key, p.value
FROM customers c
CROSS JOIN LATERAL jsonb_each_text(c.metadata->'preferences') AS p(key, value)
WHERE c.metadata ? 'preferences'
  AND jsonb_typeof(c.metadata->'preferences') = 'object'
  AND p.value IS NOT NULL
  AND p.value <> ''
ON CONFLICT (customer_id, pref_key) DO NOTHING;

-- Strip the blob so there is one source of truth. Notes/tags/other metadata keys
-- are untouched — this removes ONLY the 'preferences' key.
UPDATE customers
   SET metadata = metadata - 'preferences'
 WHERE metadata ? 'preferences';

COMMENT ON COLUMN customers.metadata IS
    'Customer metadata: notes array, tags, etc. NOTE: preferences moved OUT to the customer_preferences table 2026-07-12 — do not re-add a preferences key here.';

-- Redefine the voice-context RPC to read preferences from the new table. Body is
-- otherwise unchanged from the prior definition; only the 'preferences' key of
-- the returned jsonb now aggregates customer_preferences rows instead of reading
-- the (now stripped) metadata blob. Returns the same shape — {key: value} — so
-- every consumer (shared/voiceCrm.ts, /voice/context/:phone) is unaffected.
CREATE OR REPLACE FUNCTION public.get_customer_context_for_call(p_tenant_id uuid, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_customer RECORD;
    v_context JSONB;
    v_appointments JSONB;
    v_stats RECORD;
    v_preferences JSONB;
BEGIN
    SELECT * INTO v_customer
    FROM customers
    WHERE tenant_id = p_tenant_id
    AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g')
    AND is_deleted = false
    LIMIT 1;

    IF v_customer IS NULL THEN
        RETURN jsonb_build_object(
            'is_known_customer', false,
            'customer', null,
            'appointment_history', jsonb_build_object(
                'total', 0,
                'completed', 0,
                'cancelled', 0,
                'last_appointment', null,
                'upcoming_appointments', '[]'::jsonb
            ),
            'notes', '[]'::jsonb,
            'preferences', '{}'::jsonb,
            'tags', '[]'::jsonb
        );
    END IF;

    SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'canceled') as cancelled
    INTO v_stats
    FROM appointments
    WHERE customer_id = v_customer.customer_id
    AND tenant_id = p_tenant_id;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.appointment_id,
            'start_time', a.start_time,
            'end_time', a.end_time,
            'status', a.status,
            'description', a.description,
            'resource_name', r.name,
            'employee_name', e.name
        ) ORDER BY a.start_time
    ), '[]'::jsonb) INTO v_appointments
    FROM appointments a
    LEFT JOIN resources r ON r.resource_id = a.resource_id
    LEFT JOIN employees e ON e.employee_id = a.employee_id
    WHERE a.customer_id = v_customer.customer_id
    AND a.tenant_id = p_tenant_id
    AND a.start_time > now()
    AND a.status = 'scheduled'
    LIMIT 5;

    -- Preferences now live in their own table. Aggregated back into the same
    -- {key: value} jsonb the callers already expect. SECURITY DEFINER bypasses
    -- RLS here exactly as it does for the customer/appointment reads above; the
    -- p_tenant_id predicate is what scopes the row set.
    SELECT COALESCE(jsonb_object_agg(cp.pref_key, cp.pref_value), '{}'::jsonb)
    INTO v_preferences
    FROM customer_preferences cp
    WHERE cp.customer_id = v_customer.customer_id
    AND cp.tenant_id = p_tenant_id;

    v_context := jsonb_build_object(
        'is_known_customer', true,
        'customer', jsonb_build_object(
            'id', v_customer.customer_id,
            'name', v_customer.name,
            'phone', v_customer.phone,
            'email', v_customer.email,
            'address', v_customer.address,
            'created_at', v_customer.created_at
        ),
        'appointment_history', jsonb_build_object(
            'total', COALESCE(v_stats.total, 0),
            'completed', COALESCE(v_stats.completed, 0),
            'cancelled', COALESCE(v_stats.cancelled, 0),
            'upcoming_appointments', v_appointments
        ),
        'notes', COALESCE(v_customer.metadata->'notes', '[]'::jsonb),
        'preferences', v_preferences,
        'tags', COALESCE(v_customer.metadata->'tags', '[]'::jsonb),
        'member_since', v_customer.created_at
    );

    RETURN v_context;
END;
$$;

COMMIT;
