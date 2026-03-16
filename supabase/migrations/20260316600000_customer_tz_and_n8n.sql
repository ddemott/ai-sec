-- BUG-031: check_availability_with_tz — timezone-aware availability check
-- Converts the customer's requested times to the tenant's timezone before
-- checking for overlaps, ensuring correct results regardless of the caller's timezone.
CREATE OR REPLACE FUNCTION check_availability_with_tz(
    p_tenant_id UUID,
    p_resource_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_customer_tz TEXT DEFAULT NULL
) RETURNS TABLE (
    available BOOLEAN,
    tenant_timezone TEXT,
    local_start TEXT,
    local_end TEXT
) AS $$
DECLARE
    v_tenant_tz TEXT;
    v_display_tz TEXT;
BEGIN
    -- Get tenant timezone
    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.id = p_tenant_id;
    IF v_tenant_tz IS NULL THEN v_tenant_tz := 'UTC'; END IF;

    -- Use customer timezone for display if provided, otherwise use tenant's
    v_display_tz := COALESCE(p_customer_tz, v_tenant_tz);

    -- Check for overlaps (always done in UTC via TIMESTAMPTZ comparison)
    IF EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id
        AND tenant_id = p_tenant_id
        AND status = 'scheduled'
        AND start_time < p_end_time
        AND end_time > p_start_time
    ) THEN
        RETURN QUERY SELECT FALSE,
            v_display_tz,
            to_char(p_start_time AT TIME ZONE v_display_tz, 'YYYY-MM-DD HH24:MI'),
            to_char(p_end_time AT TIME ZONE v_display_tz, 'YYYY-MM-DD HH24:MI');
    ELSE
        RETURN QUERY SELECT TRUE,
            v_display_tz,
            to_char(p_start_time AT TIME ZONE v_display_tz, 'YYYY-MM-DD HH24:MI'),
            to_char(p_end_time AT TIME ZONE v_display_tz, 'YYYY-MM-DD HH24:MI');
    END IF;
END;
$$ LANGUAGE plpgsql;

-- BUG-034: Replace placeholder n8n trigger with pg_net HTTP call
-- This function uses the pg_net extension (available on Supabase) to make
-- real HTTP calls to the n8n webhook URL stored on the tenant.
-- On local dev (without pg_net), it falls back to RAISE NOTICE.
CREATE OR REPLACE FUNCTION notify_n8n_on_appointment()
RETURNS TRIGGER AS $$
DECLARE
    v_webhook_url TEXT;
    v_payload JSONB;
BEGIN
    -- Look up the tenant's n8n webhook URL
    SELECT n8n_webhook_url INTO v_webhook_url
    FROM tenants WHERE id = NEW.tenant_id;

    IF v_webhook_url IS NULL OR v_webhook_url = '' THEN
        RAISE NOTICE 'No n8n webhook configured for tenant %', NEW.tenant_id;
        RETURN NEW;
    END IF;

    v_payload := jsonb_build_object(
        'event', 'appointment.created',
        'tenant_id', NEW.tenant_id,
        'appointment_id', NEW.id,
        'resource_id', NEW.resource_id,
        'customer_id', NEW.customer_id,
        'start_time', NEW.start_time,
        'end_time', NEW.end_time,
        'description', NEW.description,
        'created_at', NOW()
    );

    -- Try pg_net if available (Supabase), otherwise fall back to NOTICE
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        EXECUTE format(
            'SELECT net.http_post(url := %L, headers := %L::JSONB, body := %L)',
            v_webhook_url,
            '{"Content-Type": "application/json"}',
            v_payload::TEXT
        );
    ELSE
        RAISE NOTICE 'n8n webhook payload for tenant %: %', NEW.tenant_id, v_payload;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
