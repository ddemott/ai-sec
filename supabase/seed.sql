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
VALUES ('00000000-0000-0000-0000-000000000000', 'dale@ai-sec.com', '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'Site Owner')
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

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
VALUES ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'admin@dynatire.com', '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'DynaTire Admin')
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

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
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_new_tenant_id;

    IF v_new_tenant_id IS NOT NULL THEN
        INSERT INTO users (tenant_id, email, password_hash, full_name)
        VALUES (v_new_tenant_id, 'owner@sportclips.com', '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'Salon Owner')
        ON CONFLICT (email) DO NOTHING;
    END IF;
END $$;

-- 6. Seed Services for DynaTire PoC
INSERT INTO services (tenant_id, name, description, duration_minutes, required_skills, required_resources)
VALUES 
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Standard Tire Rotation', 'Rotate all 4 tires for even wear', 30, ARRAY['tire-rotation'], ARRAY['mobile-truck']),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Flat Tire Repair', 'Plug or patch a single tire puncture', 45, ARRAY['flat-repair'], ARRAY['mobile-truck']),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Mobile Tire Install', 'Mount and balance a full set of new tires', 90, ARRAY['tire-install'], ARRAY['mobile-truck'])
ON CONFLICT DO NOTHING;

-- 7. Seed Employees for DynaTire PoC
INSERT INTO employees (tenant_id, name, skills)
VALUES 
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Mike the Mechanic', ARRAY['tire-rotation', 'flat-repair', 'tire-install']),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Steve the Specialist', ARRAY['tire-rotation', 'flat-repair'])
ON CONFLICT DO NOTHING;

-- 8. Map Services to Employees and Resources (Capacities)
DO $$
DECLARE
    v_service_rotation_id INTEGER;
    v_service_repair_id INTEGER;
    v_service_install_id INTEGER;
    v_employee_mike_id INTEGER;
    v_employee_steve_id INTEGER;
    v_resource_truck_id UUID := '18288e57-a958-41e4-be5f-e95a8539a06b';
BEGIN
    -- Get IDs
    SELECT id INTO v_service_rotation_id FROM services WHERE name = 'Standard Tire Rotation' AND tenant_id = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
    SELECT id INTO v_service_repair_id FROM services WHERE name = 'Flat Tire Repair' AND tenant_id = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
    SELECT id INTO v_service_install_id FROM services WHERE name = 'Mobile Tire Install' AND tenant_id = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
    
    SELECT id INTO v_employee_mike_id FROM employees WHERE name = 'Mike the Mechanic' AND tenant_id = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
    SELECT id INTO v_employee_steve_id FROM employees WHERE name = 'Steve the Specialist' AND tenant_id = 'f234e471-0e60-4163-86c9-93cfd9338e3a';

    -- Map Rotation to both mechanics and the truck
    INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES 
        (v_service_rotation_id, v_employee_mike_id, 'f234e471-0e60-4163-86c9-93cfd9338e3a'), 
        (v_service_rotation_id, v_employee_steve_id, 'f234e471-0e60-4163-86c9-93cfd9338e3a') 
    ON CONFLICT DO NOTHING;
    INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES 
        (v_service_rotation_id, v_resource_truck_id, 'f234e471-0e60-4163-86c9-93cfd9338e3a') 
    ON CONFLICT DO NOTHING;

    -- Map Repair to both mechanics and the truck
    INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES 
        (v_service_repair_id, v_employee_mike_id, 'f234e471-0e60-4163-86c9-93cfd9338e3a'), 
        (v_service_repair_id, v_employee_steve_id, 'f234e471-0e60-4163-86c9-93cfd9338e3a') 
    ON CONFLICT DO NOTHING;
    INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES 
        (v_service_repair_id, v_resource_truck_id, 'f234e471-0e60-4163-86c9-93cfd9338e3a') 
    ON CONFLICT DO NOTHING;

    -- Map Install only to Mike and the truck
    INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES 
        (v_service_install_id, v_employee_mike_id, 'f234e471-0e60-4163-86c9-93cfd9338e3a') 
    ON CONFLICT DO NOTHING;
    INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES 
        (v_service_install_id, v_resource_truck_id, 'f234e471-0e60-4163-86c9-93cfd9338e3a') 
    ON CONFLICT DO NOTHING;
END $$;
