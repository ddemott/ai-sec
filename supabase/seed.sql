-- Seed Data for SecretaryHQ SaaS (Platform + Demo Tenants)
-- All test data is Chicago / Chicagoland / Chicago suburbs

-- 0. Create a Platform Tenant for the SecretaryHQ Admin (Super Admin)
INSERT INTO tenants (tenant_id, name, business_type, timezone)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'SecretaryHQ Platform',
    'platform-admin',
    'America/Chicago'
) ON CONFLICT (tenant_id) DO NOTHING;

-- 0b. Create a SecretaryHQ Admin User (Platform Admin)
INSERT INTO users (tenant_id, email, password_hash, full_name)
VALUES ('00000000-0000-0000-0000-000000000000', 'admin@secretaryhq.com', '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'SecretaryHQ Admin')
ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- 1. Create DynaTire tenant (mobile tire service in Naperville/Aurora area)
INSERT INTO tenants (tenant_id, name, business_type, timezone, system_prompt, voice_id)
VALUES (
    'f234e471-0e60-4163-86c9-93cfd9338e3a',
    'DynaTire Mobile Service',
    'mobile-tire',
    'America/Chicago',
    'You are a professional, helpful secretary for DynaTire Mobile Service, a mobile tire shop serving the western Chicago suburbs including Naperville, Aurora, Wheaton, and Downers Grove. You help customers book tire services, answer questions about pricing and availability, and provide friendly, knowledgeable service.',
    'ba124806-6962-4354-94a0-7607775952f4'
) ON CONFLICT (tenant_id) DO UPDATE SET
    name = EXCLUDED.name,
    timezone = EXCLUDED.timezone,
    system_prompt = EXCLUDED.system_prompt;

-- 1b. Create a User Account for DynaTire
INSERT INTO users (tenant_id, email, password_hash, full_name)
VALUES ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'admin@dynatire.com', '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'Dale Demott')
ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- 1c. DeMott LLC tenant + Dale's personal owner account.
--     Separates Dale's super-admin platform rights (admin@secretaryhq.com)
--     from his real-business owner identity (daledemott@gmail.com on
--     DeMott LLC). Added 2026-05-18 after the UX walkthrough surfaced
--     that mixing both roles on one identity confused the user listing.
INSERT INTO tenants (tenant_id, name, business_type, timezone)
VALUES (
    'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0',
    'DeMott LLC',
    'answering-service',
    'America/Chicago'
) ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO users (tenant_id, email, password_hash, full_name, role)
VALUES (
    'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0',
    'daledemott@gmail.com',
    '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK',
    'Dale DeMott',
    'owner'
) ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name;

-- 2. Create bookable resources (service trucks)
INSERT INTO resources (resource_id, tenant_id, name, description)
VALUES
    ('18288e57-a958-41e4-be5f-e95a8539a06b', 'f234e471-0e60-4163-86c9-93cfd9338e3a', 'Truck 1', 'Ram ProMaster — main mobile unit, full tire inventory'),
    ('a7c3e912-4b1f-4d8e-9f2a-1c3d5e7f9a0b', 'f234e471-0e60-4163-86c9-93cfd9338e3a', 'Truck 2', 'Ford Transit — backup unit, rotation and flat repair only')
ON CONFLICT (resource_id) DO NOTHING;

-- 3. (intentionally empty) Customers are NOT seeded.
-- 4. (intentionally empty) Appointments are NOT seeded.
--
-- Principle (locked 2026-05-18): seed data starts bare-bones. Transactional
-- data (customers, appointments) must be created by each test that needs
-- it and removed by the same test on completion. Demo data baked into the
-- seed accumulated 17 stray appointments + 12 customers across recent
-- rebuilds because the seed re-inserts on every run (no real PK conflict
-- for date-derived rows), so tests ran against a polluted DB that grew
-- silently. Bare-bones seed = predictable starting state for every test.
--
-- Business *configuration* (resources, services, employees, shifts) still
-- lives in the seed for DynaTire so the existing E2E booking specs have
-- working business shape. That layer is scheduled for the same treatment
-- in a follow-up — see `seed-strip-stage-b` in the UX audit TODO file.

-- 5. Bella's Hair Studio — salon-vertical demo tenant. Uses a FIXED
--    tenant_id so repeated `db:rebuild` runs are idempotent. The
--    earlier pattern used gen_random_uuid() with ON CONFLICT DO
--    NOTHING, which never conflicted (new UUID every run) and so
--    spawned a fresh duplicate Bella's on every rebuild — by
--    2026-05-18 the local DB had 2 of them.
INSERT INTO tenants (tenant_id, name, business_type, timezone)
VALUES (
    'b3e1aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    'Bella''s Hair Studio',
    'salon',
    'America/Chicago'
) ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO users (tenant_id, email, password_hash, full_name, role)
VALUES (
    'b3e1aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    'bella@bellashair.com',
    '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK',
    'Bella Rossi',
    'owner'
) ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name;

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
