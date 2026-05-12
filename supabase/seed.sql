-- Seed Data for SecretaryHQ SaaS (Platform + Demo Tenants)
-- All test data is Chicago / Chicagoland / Chicago suburbs

-- 0. Create a Platform Tenant for the SecretaryHQ Admin (Super Admin)
INSERT INTO tenants (id, name, business_type, timezone)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'SecretaryHQ Platform',
    'platform-admin',
    'America/Chicago'
) ON CONFLICT (id) DO NOTHING;

-- 0b. Create a SecretaryHQ Admin User (Platform Admin)
INSERT INTO users (tenant_id, email, password_hash, full_name)
VALUES ('00000000-0000-0000-0000-000000000000', 'admin@secretaryhq.com', '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'SecretaryHQ Admin')
ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- 1. Create DynaTire tenant (mobile tire service in Naperville/Aurora area)
INSERT INTO tenants (id, name, business_type, timezone, system_prompt, voice_id)
VALUES (
    'f234e471-0e60-4163-86c9-93cfd9338e3a',
    'DynaTire Mobile Service',
    'mobile-tire',
    'America/Chicago',
    'You are a professional, helpful secretary for DynaTire Mobile Service, a mobile tire shop serving the western Chicago suburbs including Naperville, Aurora, Wheaton, and Downers Grove. You help customers book tire services, answer questions about pricing and availability, and provide friendly, knowledgeable service.',
    'ba124806-6962-4354-94a0-7607775952f4'
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    timezone = EXCLUDED.timezone,
    system_prompt = EXCLUDED.system_prompt;

-- 1b. Create a User Account for DynaTire
INSERT INTO users (tenant_id, email, password_hash, full_name)
VALUES ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'admin@dynatire.com', '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'Dale Demott')
ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- 2. Create bookable resources (service trucks)
INSERT INTO resources (resource_id, tenant_id, name, description)
VALUES
    ('18288e57-a958-41e4-be5f-e95a8539a06b', 'f234e471-0e60-4163-86c9-93cfd9338e3a', 'Truck 1', 'Ram ProMaster — main mobile unit, full tire inventory'),
    ('a7c3e912-4b1f-4d8e-9f2a-1c3d5e7f9a0b', 'f234e471-0e60-4163-86c9-93cfd9338e3a', 'Truck 2', 'Ford Transit — backup unit, rotation and flat repair only')
ON CONFLICT (resource_id) DO NOTHING;

-- 3. Create sample customers (Chicago suburbs)
INSERT INTO customers (id, tenant_id, phone, name, first_name, last_name, email, address, metadata)
VALUES
    ('207b25bb-ef55-4df8-ac89-252f9dcd80b9', 'f234e471-0e60-4163-86c9-93cfd9338e3a', '+16305550101', 'James Kowalski', 'James', 'Kowalski', 'jkowalski@email.com', '1842 Washington St, Naperville, IL 60540', '{"vehicle": "2020 Chevy Silverado", "notes": "Asks about fleet pricing for his construction company"}'),
    ('97704486-04d4-40ba-85f8-7a82e47e1611', 'f234e471-0e60-4163-86c9-93cfd9338e3a', '+16305550102', 'Sarah Chen', 'Sarah', 'Chen', 'sarah.chen@email.com', '305 Fox Run Dr, Wheaton, IL 60187', '{"vehicle": "2019 Honda CRV", "notes": "Prefers Mike Rivera, wants Michelin tires"}'),
    ('c3d4e5f6-7890-1234-5678-9abcdef01234', 'f234e471-0e60-4163-86c9-93cfd9338e3a', '+16305550103', 'Tom Bradley', 'Tom', 'Bradley', 'tombradley@email.com', '4710 Bauer Rd, Downers Grove, IL 60515', '{"vehicle": "2022 Ford F-150", "notes": "Call only, no texts. Prefers Michelin Defenders."}'),
    ('d4e5f6a7-8901-2345-6789-0abcdef12345', 'f234e471-0e60-4163-86c9-93cfd9338e3a', '+16305550104', 'Linda Park', 'Linda', 'Park', 'lpark@email.com', '892 Ogden Ave, Aurora, IL 60504', '{"vehicle": "2021 Toyota Camry", "notes": "Regular rotation every 6 months. Prefers Carlos Vega."}'),
    ('e5f6a7b8-9012-3456-7890-1abcdef23456', 'f234e471-0e60-4163-86c9-93cfd9338e3a', '+16305550105', 'Robert Diaz', 'Robert', 'Diaz', 'rdiaz@email.com', '2200 75th St, Woodridge, IL 60517', '{"vehicle": "2023 Toyota Tacoma", "notes": "New customer, referred by James Kowalski"}')
ON CONFLICT (id) DO NOTHING;

-- 4. Create appointments (today and tomorrow, Chicago time)
INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description, status)
VALUES
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', '18288e57-a958-41e4-be5f-e95a8539a06b', '207b25bb-ef55-4df8-ac89-252f9dcd80b9',
        (CURRENT_DATE + TIME '09:00:00'), (CURRENT_DATE + TIME '10:00:00'), 'Flat Repair', 'scheduled'),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', '18288e57-a958-41e4-be5f-e95a8539a06b', '97704486-04d4-40ba-85f8-7a82e47e1611',
        (CURRENT_DATE + TIME '10:30:00'), (CURRENT_DATE + TIME '12:00:00'), 'Seasonal Tire Swap', 'scheduled'),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', '18288e57-a958-41e4-be5f-e95a8539a06b', 'c3d4e5f6-7890-1234-5678-9abcdef01234',
        (CURRENT_DATE + TIME '13:00:00'), (CURRENT_DATE + TIME '15:00:00'), 'New Tire Install (x4)', 'scheduled'),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'a7c3e912-4b1f-4d8e-9f2a-1c3d5e7f9a0b', 'd4e5f6a7-8901-2345-6789-0abcdef12345',
        (CURRENT_DATE + TIME '09:00:00'), (CURRENT_DATE + TIME '09:30:00'), 'Tire Rotation', 'scheduled'),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'a7c3e912-4b1f-4d8e-9f2a-1c3d5e7f9a0b', 'e5f6a7b8-9012-3456-7890-1abcdef23456',
        (CURRENT_DATE + TIME '10:00:00'), (CURRENT_DATE + TIME '11:30:00'), 'Seasonal Tire Swap', 'scheduled'),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', '18288e57-a958-41e4-be5f-e95a8539a06b', 'd4e5f6a7-8901-2345-6789-0abcdef12345',
        (CURRENT_DATE + INTERVAL '1 day' + TIME '09:00:00'), (CURRENT_DATE + INTERVAL '1 day' + TIME '09:30:00'), 'Tire Rotation', 'scheduled'),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', '18288e57-a958-41e4-be5f-e95a8539a06b', '207b25bb-ef55-4df8-ac89-252f9dcd80b9',
        (CURRENT_DATE + INTERVAL '1 day' + TIME '11:00:00'), (CURRENT_DATE + INTERVAL '1 day' + TIME '12:30:00'), 'Seasonal Tire Swap', 'scheduled')
ON CONFLICT DO NOTHING;

-- 5. Create a Second Tenant (salon in Lincoln Park)
DO $$
DECLARE
    v_new_tenant_id UUID;
BEGIN
    INSERT INTO tenants (name, business_type, timezone)
    VALUES ('Bella''s Hair Studio', 'salon', 'America/Chicago')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_new_tenant_id;

    IF v_new_tenant_id IS NOT NULL THEN
        INSERT INTO users (tenant_id, email, password_hash, full_name)
        VALUES (v_new_tenant_id, 'bella@bellashair.com', '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'Bella Rossi')
        ON CONFLICT (tenant_id, email) DO NOTHING;
    END IF;
END $$;

-- 6. Seed Services for DynaTire
INSERT INTO services (tenant_id, name, subtitle, description, duration_minutes, price, required_skills, required_resources)
VALUES
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Flat Repair (On-site)', 'Plug or patch', 'We come to you and repair your flat tire on-site. Includes inspection of the damaged tire and plug/patch repair.', 60, 85, ARRAY['flat-repair'], ARRAY['mobile-truck']),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Seasonal Tire Swap', 'Winter ↔ Summer', 'Swap between your winter and summer tire sets. We store nothing — bring both sets or we''ll pick up from your garage.', 90, 120, ARRAY['tire-swap'], ARRAY['mobile-truck']),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Tire Rotation', 'Even wear', 'Standard 4-tire rotation for even tread wear. Recommended every 5,000-7,500 miles.', 30, 60, ARRAY['tire-rotation'], ARRAY['mobile-truck']),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'New Tire Install (x4)', 'Full set', 'Mount and balance a full set of 4 new tires. Customer supplies tires or we source them (Michelin, Goodyear, Continental).', 120, 280, ARRAY['tire-install'], ARRAY['mobile-truck']),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Balancing', 'Wheel balance', 'Computer-aided wheel balancing for a smooth ride. Recommended with any new tire install.', 30, 45, ARRAY['balancing'], ARRAY['mobile-truck'])
ON CONFLICT DO NOTHING;

-- 7. Seed Employees for DynaTire (Chicago area techs)
INSERT INTO employees (tenant_id, name, first_name, last_name, phone, skills)
VALUES
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Mike Rivera', 'Mike', 'Rivera', '+16305550201', ARRAY['flat-repair', 'tire-swap', 'tire-rotation', 'tire-install', 'balancing']),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Carlos Vega', 'Carlos', 'Vega', '+16305550202', ARRAY['flat-repair', 'tire-swap', 'tire-rotation']),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Dana Okafor', 'Dana', 'Okafor', '+16305550203', ARRAY['flat-repair', 'tire-rotation', 'tire-install'])
ON CONFLICT DO NOTHING;

-- 8. Seed Shifts for DynaTire employees (current week + next week, date-based via employee_schedule)
DO $$
DECLARE
    v_mike_id UUID;
    v_carlos_id UUID;
    v_dana_id UUID;
    v_tenant_id UUID := 'f234e471-0e60-4163-86c9-93cfd9338e3a';
    v_day DATE;
    v_start DATE;
    v_end DATE;
BEGIN
    SELECT employee_id INTO v_mike_id FROM employees WHERE name = 'Mike Rivera' AND tenant_id = v_tenant_id;
    SELECT employee_id INTO v_carlos_id FROM employees WHERE name = 'Carlos Vega' AND tenant_id = v_tenant_id;
    SELECT employee_id INTO v_dana_id FROM employees WHERE name = 'Dana Okafor' AND tenant_id = v_tenant_id;

    -- Seed 2 weeks of shifts (current week Monday through next week Friday)
    v_start := CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::INT + 1; -- this Monday
    v_end := v_start + 11; -- next Friday (12 weekdays across 2 weeks)

    v_day := v_start;
    WHILE v_day <= v_end LOOP
        -- Skip weekends
        IF EXTRACT(DOW FROM v_day) NOT IN (0, 6) THEN
            -- Mike: Mon-Fri 7am-4pm
            INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
            VALUES (v_tenant_id, v_mike_id, v_day, '07:00', '16:00', false)
            ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING;

            -- Carlos: Mon-Fri 8am-5pm
            INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
            VALUES (v_tenant_id, v_carlos_id, v_day, '08:00', '17:00', false)
            ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING;

            -- Dana: Mon-Fri 9am-6pm
            INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
            VALUES (v_tenant_id, v_dana_id, v_day, '09:00', '18:00', false)
            ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING;
        END IF;
        v_day := v_day + 1;
    END LOOP;
END $$;

-- 9. Map Services to Employees and Resources
DO $$
DECLARE
    v_svc_flat UUID;
    v_svc_swap UUID;
    v_svc_rotation UUID;
    v_svc_install UUID;
    v_svc_balance UUID;
    v_mike UUID;
    v_carlos UUID;
    v_dana UUID;
    v_truck1 UUID := '18288e57-a958-41e4-be5f-e95a8539a06b';
    v_truck2 UUID := 'a7c3e912-4b1f-4d8e-9f2a-1c3d5e7f9a0b';
    v_tenant UUID := 'f234e471-0e60-4163-86c9-93cfd9338e3a';
BEGIN
    SELECT service_id INTO v_svc_flat FROM services WHERE name = 'Flat Repair (On-site)' AND tenant_id = v_tenant;
    SELECT service_id INTO v_svc_swap FROM services WHERE name = 'Seasonal Tire Swap' AND tenant_id = v_tenant;
    SELECT service_id INTO v_svc_rotation FROM services WHERE name = 'Tire Rotation' AND tenant_id = v_tenant;
    SELECT service_id INTO v_svc_install FROM services WHERE name = 'New Tire Install (x4)' AND tenant_id = v_tenant;
    SELECT service_id INTO v_svc_balance FROM services WHERE name = 'Balancing' AND tenant_id = v_tenant;

    SELECT employee_id INTO v_mike FROM employees WHERE name = 'Mike Rivera' AND tenant_id = v_tenant;
    SELECT employee_id INTO v_carlos FROM employees WHERE name = 'Carlos Vega' AND tenant_id = v_tenant;
    SELECT employee_id INTO v_dana FROM employees WHERE name = 'Dana Okafor' AND tenant_id = v_tenant;

    -- All techs can do flat repair
    INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES
        (v_svc_flat, v_mike, v_tenant), (v_svc_flat, v_carlos, v_tenant), (v_svc_flat, v_dana, v_tenant) ON CONFLICT DO NOTHING;

    -- Tire swap: Mike and Carlos
    INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES
        (v_svc_swap, v_mike, v_tenant), (v_svc_swap, v_carlos, v_tenant) ON CONFLICT DO NOTHING;

    -- Rotation: all techs
    INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES
        (v_svc_rotation, v_mike, v_tenant), (v_svc_rotation, v_carlos, v_tenant), (v_svc_rotation, v_dana, v_tenant) ON CONFLICT DO NOTHING;

    -- Install: Mike and Dana
    INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES
        (v_svc_install, v_mike, v_tenant), (v_svc_install, v_dana, v_tenant) ON CONFLICT DO NOTHING;

    -- Balancing: Mike only
    INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES
        (v_svc_balance, v_mike, v_tenant) ON CONFLICT DO NOTHING;

    -- Both trucks for all services
    INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES
        (v_svc_flat, v_truck1, v_tenant), (v_svc_flat, v_truck2, v_tenant),
        (v_svc_swap, v_truck1, v_tenant), (v_svc_swap, v_truck2, v_tenant),
        (v_svc_rotation, v_truck1, v_tenant), (v_svc_rotation, v_truck2, v_tenant),
        (v_svc_install, v_truck1, v_tenant),
        (v_svc_balance, v_truck1, v_tenant)
    ON CONFLICT DO NOTHING;
END $$;
