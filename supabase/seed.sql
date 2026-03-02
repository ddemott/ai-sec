-- Seed Data for AI Secretary SaaS (Platform + Demo Tenants)

-- 0. Create a Platform Tenant for the Site Owner (Super Admin)
INSERT INTO tenants (id, name, business_type, timezone)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'AI Sec Platform',
    'platform-admin',
    'America/New_York'
) ON CONFLICT (id) DO NOTHING;

-- 0b. Create a Site Owner User (Platform Admin)
INSERT INTO users (tenant_id, email, password_hash, full_name)
VALUES ('00000000-0000-0000-0000-000000000000', 'dale@ai-sec.com', 'password', 'Site Owner')
ON CONFLICT (email) DO NOTHING;

-- 1. Create a default tenant
INSERT INTO tenants (id, name, business_type, timezone, system_prompt, voice_id)
VALUES (
    'f234e471-0e60-4163-86c9-93cfd9338e3a', 
    'DynaTire PoC', 
    'mobile-tire', 
    'America/New_York',
    'You are a professional, helpful secretary for DynaTire...',
    'ba124806-6962-4354-94a0-7607775952f4'
) ON CONFLICT (id) DO NOTHING;

-- 1b. Create a User Account for the default tenant
INSERT INTO users (tenant_id, email, password_hash, full_name)
VALUES ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'admin@dynatire.com', 'password', 'DynaTire Admin')
ON CONFLICT (email) DO NOTHING;

-- 2. Create a bookable resource (Truck 1)
INSERT INTO resources (id, tenant_id, name, description)
VALUES (
    '18288e57-a958-41e4-be5f-e95a8539a06b',
    'f234e471-0e60-4163-86c9-93cfd9338e3a',
    'Service Truck 1',
    'Main mobile unit for tire repairs'
) ON CONFLICT (id) DO NOTHING;

-- 3. Create some sample customers
INSERT INTO customers (id, tenant_id, phone, name, email, address, metadata)
VALUES 
    ('207b25bb-ef55-4df8-ac89-252f9dcd80b9', 'f234e471-0e60-4163-86c9-93cfd9338e3a', '+15551112222', 'Bob Smith', 'bob@example.com', '123 Main St, New York, NY', '{"vehicle": "2022 Honda Civic", "notes": "Prefers morning appointments"}'),
    ('97704486-04d4-40ba-85f8-7a82e47e1611', 'f234e471-0e60-4163-86c9-93cfd9338e3a', '+15550001111', 'Alice Johnson', 'alice@example.com', '456 Elm St, Brooklyn, NY', '{"vehicle": "2021 Tesla Model 3", "notes": "Has a slow leak in front left tire"}')
ON CONFLICT (id) DO NOTHING;

-- 4. Create some upcoming appointments with FIXED TIMES (9:00 AM and 1:30 PM)
INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description, status)
VALUES 
    (
        'f234e471-0e60-4163-86c9-93cfd9338e3a', 
        '18288e57-a958-41e4-be5f-e95a8539a06b', 
        '207b25bb-ef55-4df8-ac89-252f9dcd80b9', 
        (CURRENT_DATE + INTERVAL '1 day' + TIME '09:00:00'), 
        (CURRENT_DATE + INTERVAL '1 day' + TIME '10:00:00'), 
        'Standard Maintenance', 
        'scheduled'
    ),
    (
        'f234e471-0e60-4163-86c9-93cfd9338e3a', 
        '18288e57-a958-41e4-be5f-e95a8539a06b', 
        '97704486-04d4-40ba-85f8-7a82e47e1611', 
        (CURRENT_DATE + INTERVAL '2 days' + TIME '13:30:00'), 
        (CURRENT_DATE + INTERVAL '2 days' + TIME '14:30:00'), 
        'Flat Tire Repair', 
        'scheduled'
    )
ON CONFLICT DO NOTHING;

-- 5. Create a Second Tenant and User for Multi-Tenancy Testing
DO $$
DECLARE
    v_new_tenant_id UUID;
BEGIN
    INSERT INTO tenants (name, business_type)
    VALUES ('Suds & Scissors', 'salon')
    RETURNING id INTO v_new_tenant_id;

    INSERT INTO users (tenant_id, email, password_hash, full_name)
    VALUES (v_new_tenant_id, 'owner@sportclips.com', 'password', 'Salon Owner');
END $$;
