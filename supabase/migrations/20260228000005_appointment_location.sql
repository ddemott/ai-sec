-- Add location to appointments for mobile services
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location TEXT;

-- Update the book_appointment_atomic function to handle location
CREATE OR REPLACE FUNCTION book_appointment_atomic(
    p_tenant_id UUID,
    p_resource_id UUID,
    p_customer_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_description TEXT,
    p_call_id TEXT,
    p_location TEXT DEFAULT NULL -- New parameter
) RETURNS TABLE (
    success BOOLEAN,
    appointment_id UUID,
    error_message TEXT
) AS $$
DECLARE
    v_overlap_exists BOOLEAN;
    v_new_appointment_id UUID;
    v_business_type TEXT;
    v_prep_minutes INT := 0;
    v_cleanup_minutes INT := 0;
    v_travel_minutes INT := 0;
    v_block_start TIMESTAMPTZ;
    v_block_end TIMESTAMPTZ;
    v_metadata JSONB;
BEGIN
    -- Derive a simple timing profile based on tenant business type.
    -- In the future this will be driven by per-service templates and metadata.
    SELECT business_type INTO v_business_type FROM tenants WHERE id = p_tenant_id;

    IF v_business_type = 'mobile-tire' THEN
        -- Mobile services need travel + some prep/cleanup buffer
        v_prep_minutes := 10;
        v_cleanup_minutes := 10;
        v_travel_minutes := 20;
    ELSIF v_business_type = 'salon' THEN
        -- In-shop services focus more on cleanup/admin between clients
        v_prep_minutes := 5;
        v_cleanup_minutes := 15;
        v_travel_minutes := 0;
    ELSE
        -- Default: no additional buffering beyond the requested window
        v_prep_minutes := 0;
        v_cleanup_minutes := 0;
        v_travel_minutes := 0;
    END IF;

    -- Compute the full blocked interval the scheduler should respect
    -- (prep + travel before, service window, cleanup/admin after).
    v_block_start := p_start_time - make_interval(mins => v_prep_minutes + v_travel_minutes);
    v_block_end := p_end_time + make_interval(mins => v_cleanup_minutes);

    -- Check for overlaps against the full blocked interval, not just customer-facing times
    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id
        AND status = 'scheduled'
        AND start_time < v_block_end
        AND end_time > v_block_start
    ) INTO v_overlap_exists;

    IF v_overlap_exists THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, 'Slot already booked'::TEXT;
    ELSE
        -- Persist both the effective blocked interval and the underlying service timing
        v_metadata := jsonb_build_object(
            'service_timing', jsonb_build_object(
                'base_start_time', to_char(p_start_time, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
                'base_end_time', to_char(p_end_time, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
                'prep_minutes', v_prep_minutes,
                'cleanup_minutes', v_cleanup_minutes,
                'travel_minutes', v_travel_minutes
            )
        );

        INSERT INTO appointments (
            tenant_id,
            resource_id,
            customer_id,
            start_time,
            end_time,
            description,
            metadata,
            call_id,
            location
        ) VALUES (
            p_tenant_id,
            p_resource_id,
            p_customer_id,
            v_block_start,
            v_block_end,
            p_description,
            v_metadata,
            p_call_id,
            p_location
        ) RETURNING id INTO v_new_appointment_id;

        RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;
