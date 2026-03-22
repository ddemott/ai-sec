#!/usr/bin/env bash
set -euo pipefail

# reset-and-seed.sh: Wipes the dev database and seeds with realistic demo data.
# Usage: ./scripts/reset-and-seed.sh
#
# Creates:
#   - Super admin (dale@ai-sec.com)
#   - DynaTire Mobile Tire Shop (3 techs, 2 trucks, 3 services, shifts, 8 customers, 12 appointments)
#   - Bella's Hair Studio salon (4 stylists, 3 chairs, 5 services, shifts, 10 customers, 15 appointments)
#   - QuickFix Auto Repair shop (3 mechanics, 4 bays, 6 services, shifts, 6 customers, 8 appointments)
#
# All passwords: "password"

DB_URL="${1:-postgres://postgres:postgres@localhost:5433/postgres}"

echo "[ai-sec] 🗑️  Clearing database..."
psql "$DB_URL" -c "
TRUNCATE tenants, resources, customers, appointments, call_summaries, call_transcripts,
  soft_reservations, users, services, employees, employee_shifts, service_employee,
  service_resource, tenant_docs, tenant_skills CASCADE;
" > /dev/null

echo "[ai-sec] 🌱 Seeding realistic demo data..."

psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SEED'

-- bcrypt hash of "password"
-- $2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK

-- ===================================================================
-- 1. SUPER ADMIN
-- ===================================================================
INSERT INTO tenants (id, name, business_type, timezone)
VALUES ('00000000-0000-0000-0000-000000000000', 'AI Sec Platform', 'platform-admin', 'America/New_York');

INSERT INTO users (tenant_id, email, password_hash, full_name)
VALUES ('00000000-0000-0000-0000-000000000000', 'dale@ai-sec.com',
  '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'Dale DeMott');

-- ===================================================================
-- 2. DYNATIRE — Mobile Tire Shop
-- ===================================================================
INSERT INTO tenants (id, name, business_type, timezone, system_prompt, voice_id, first_message)
VALUES (
  'f234e471-0e60-4163-86c9-93cfd9338e3a',
  'DynaTire',
  'mobile-tire',
  'America/New_York',
  'You are a professional, friendly secretary for DynaTire, a mobile tire repair shop. Help customers book tire services. Collect their name, phone, vehicle info, and the tire issue. Check availability before confirming.',
  'ba124806-6962-4354-94a0-7607775952f4',
  'Thanks for calling DynaTire! How can I help you today?'
);

INSERT INTO users (tenant_id, email, password_hash, full_name)
VALUES ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'admin@dynatire.com',
  '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'Tom Rivera');

-- Resources (Trucks)
INSERT INTO resources (tenant_id, name, description) VALUES
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Truck Alpha', 'Ford F-250 — full tire service rig'),
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Truck Bravo', 'Ram 2500 — tire rotation and flat repair');

-- Employees (Technicians)
INSERT INTO employees (tenant_id, name, first_name, last_name, email, phone, skills) VALUES
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Mike Rivera',    'Mike',   'Rivera',    'mike@dynatire.com',  '+15551001001', ARRAY['tire-rotation','flat-repair','tire-install']),
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Steve Chen',     'Steve',  'Chen',      'steve@dynatire.com', '+15551001002', ARRAY['tire-rotation','flat-repair']),
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Carlos Mendez',  'Carlos', 'Mendez',    'carlos@dynatire.com','+15551001003', ARRAY['tire-rotation','flat-repair','tire-install']);

-- Services
INSERT INTO services (tenant_id, name, description, duration_minutes, price, required_skills, required_resources) VALUES
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Tire Rotation',    'Rotate all 4 tires for even wear',       30, 35,  ARRAY['tire-rotation'], ARRAY['mobile-truck']),
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Flat Repair',      'Plug or patch a single tire puncture',   45, 55,  ARRAY['flat-repair'],   ARRAY['mobile-truck']),
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', 'Full Tire Install', 'Mount and balance 4 new tires on-site', 90, 120, ARRAY['tire-install'],  ARRAY['mobile-truck']);

-- Shifts (Mon-Fri 8-5 for Mike & Carlos, Mon-Fri 9-3 for Steve)
DO $$
DECLARE emp_id UUID;
BEGIN
  SELECT id INTO emp_id FROM employees WHERE email='mike@dynatire.com';
  FOR d IN 1..5 LOOP INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ('f234e471-0e60-4163-86c9-93cfd9338e3a', emp_id, d, '08:00', '17:00'); END LOOP;
  SELECT id INTO emp_id FROM employees WHERE email='steve@dynatire.com';
  FOR d IN 1..5 LOOP INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ('f234e471-0e60-4163-86c9-93cfd9338e3a', emp_id, d, '09:00', '15:00'); END LOOP;
  SELECT id INTO emp_id FROM employees WHERE email='carlos@dynatire.com';
  FOR d IN 1..5 LOOP INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ('f234e471-0e60-4163-86c9-93cfd9338e3a', emp_id, d, '08:00', '17:00'); END LOOP;
  -- Carlos also works Saturday
  INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ('f234e471-0e60-4163-86c9-93cfd9338e3a', emp_id, 6, '09:00', '14:00');
END $$;

-- Service-Employee and Service-Resource Mappings for DynaTire
DO $$
DECLARE
  v_tid UUID := 'f234e471-0e60-4163-86c9-93cfd9338e3a';
  v_mike UUID; v_steve UUID; v_carlos UUID;
  v_svc_rotation UUID; v_svc_repair UUID; v_svc_install UUID;
  v_res1 UUID; v_res2 UUID;
BEGIN
  SELECT id INTO v_mike FROM employees WHERE email='mike@dynatire.com';
  SELECT id INTO v_steve FROM employees WHERE email='steve@dynatire.com';
  SELECT id INTO v_carlos FROM employees WHERE email='carlos@dynatire.com';
  SELECT id INTO v_svc_rotation FROM services WHERE name='Tire Rotation' AND tenant_id=v_tid;
  SELECT id INTO v_svc_repair FROM services WHERE name='Flat Repair' AND tenant_id=v_tid;
  SELECT id INTO v_svc_install FROM services WHERE name='Full Tire Install' AND tenant_id=v_tid;
  SELECT id INTO v_res1 FROM resources WHERE name='Truck Alpha' AND tenant_id=v_tid;
  SELECT id INTO v_res2 FROM resources WHERE name='Truck Bravo' AND tenant_id=v_tid;

  -- All 3 techs can do rotation
  INSERT INTO service_employee (tenant_id, service_id, employee_id) VALUES (v_tid, v_svc_rotation, v_mike), (v_tid, v_svc_rotation, v_steve), (v_tid, v_svc_rotation, v_carlos) ON CONFLICT DO NOTHING;
  -- Mike and Steve can do flat repair
  INSERT INTO service_employee (tenant_id, service_id, employee_id) VALUES (v_tid, v_svc_repair, v_mike), (v_tid, v_svc_repair, v_steve) ON CONFLICT DO NOTHING;
  -- Only Mike and Carlos can do full install
  INSERT INTO service_employee (tenant_id, service_id, employee_id) VALUES (v_tid, v_svc_install, v_mike), (v_tid, v_svc_install, v_carlos) ON CONFLICT DO NOTHING;
  -- Both trucks for all services
  INSERT INTO service_resource (tenant_id, service_id, resource_id) VALUES (v_tid, v_svc_rotation, v_res1), (v_tid, v_svc_rotation, v_res2) ON CONFLICT DO NOTHING;
  INSERT INTO service_resource (tenant_id, service_id, resource_id) VALUES (v_tid, v_svc_repair, v_res1), (v_tid, v_svc_repair, v_res2) ON CONFLICT DO NOTHING;
  INSERT INTO service_resource (tenant_id, service_id, resource_id) VALUES (v_tid, v_svc_install, v_res1), (v_tid, v_svc_install, v_res2) ON CONFLICT DO NOTHING;
END $$;

-- Customers
INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', '+15552001001', 'Bob Smith',       'Bob',    'Smith',     'bob@example.com',     'New York',  'NY', 'America/New_York',    '{"vehicle":"2022 Honda Civic","notes":"Prefers morning appointments"}'),
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', '+15552001002', 'Alice Johnson',   'Alice',  'Johnson',   'alice@example.com',   'Brooklyn',  'NY', 'America/New_York',    '{"vehicle":"2021 Tesla Model 3","notes":"Slow leak front left"}'),
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', '+15552001003', 'David Park',      'David',  'Park',      'david.p@example.com', 'Queens',    'NY', 'America/New_York',    '{"vehicle":"2020 Toyota Camry","notes":"Regular customer, every 6 months"}'),
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', '+15552001004', 'Maria Garcia',    'Maria',  'Garcia',    'maria.g@example.com', 'Bronx',     'NY', 'America/New_York',    '{"vehicle":"2023 Ford Explorer","notes":"Fleet vehicle — company account"}'),
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', '+15552001005', 'James Wilson',    'James',  'Wilson',    'jwilson@example.com', 'Manhattan', 'NY', 'America/New_York',    '{"vehicle":"2019 BMW 3 Series","notes":"Wants premium tires only"}'),
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', '+15552001006', 'Sarah Lee',       'Sarah',  'Lee',       'sarah.l@example.com', 'Hoboken',   'NJ', 'America/New_York',    '{"vehicle":"2022 Subaru Outback","notes":""}'),
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', '+15552001007', 'Kevin Brown',     'Kevin',  'Brown',     'kbrown@example.com',  'Newark',    'NJ', 'America/New_York',    '{"vehicle":"2018 Chevrolet Silverado","notes":"Large truck — needs heavy duty"}'),
  ('f234e471-0e60-4163-86c9-93cfd9338e3a', '+15552001008', 'Lisa Chang',      'Lisa',   'Chang',     'lisa.c@example.com',  'Jersey City','NJ','America/New_York',    '{"vehicle":"2024 Hyundai Tucson","notes":"New customer from Google ad"}');

-- Appointments (mix of scheduled, completed, canceled across next 7 days and past 7 days)
DO $$
DECLARE
  v_tid UUID := 'f234e471-0e60-4163-86c9-93cfd9338e3a';
  v_res1 UUID; v_res2 UUID;
  v_c1 UUID; v_c2 UUID; v_c3 UUID; v_c4 UUID; v_c5 UUID; v_c6 UUID; v_c7 UUID; v_c8 UUID;
  v_e1 UUID; v_e2 UUID; v_e3 UUID;
BEGIN
  SELECT id INTO v_res1 FROM resources WHERE name='Truck Alpha' AND tenant_id=v_tid;
  SELECT id INTO v_res2 FROM resources WHERE name='Truck Bravo' AND tenant_id=v_tid;
  SELECT id INTO v_c1 FROM customers WHERE phone='+15552001001';
  SELECT id INTO v_c2 FROM customers WHERE phone='+15552001002';
  SELECT id INTO v_c3 FROM customers WHERE phone='+15552001003';
  SELECT id INTO v_c4 FROM customers WHERE phone='+15552001004';
  SELECT id INTO v_c5 FROM customers WHERE phone='+15552001005';
  SELECT id INTO v_c6 FROM customers WHERE phone='+15552001006';
  SELECT id INTO v_c7 FROM customers WHERE phone='+15552001007';
  SELECT id INTO v_c8 FROM customers WHERE phone='+15552001008';
  SELECT id INTO v_e1 FROM employees WHERE email='mike@dynatire.com';
  SELECT id INTO v_e2 FROM employees WHERE email='steve@dynatire.com';
  SELECT id INTO v_e3 FROM employees WHERE email='carlos@dynatire.com';

  -- Future appointments
  INSERT INTO appointments (tenant_id, resource_id, customer_id, employee_id, start_time, end_time, description, status) VALUES
    (v_tid, v_res1, v_c1, v_e1, CURRENT_DATE + INTERVAL '1 day' + TIME '09:00', CURRENT_DATE + INTERVAL '1 day' + TIME '09:30', 'Tire Rotation',     'scheduled'),
    (v_tid, v_res2, v_c2, v_e2, CURRENT_DATE + INTERVAL '1 day' + TIME '10:00', CURRENT_DATE + INTERVAL '1 day' + TIME '10:45', 'Flat Repair',        'scheduled'),
    (v_tid, v_res1, v_c3, v_e1, CURRENT_DATE + INTERVAL '1 day' + TIME '13:00', CURRENT_DATE + INTERVAL '1 day' + TIME '14:30', 'Full Tire Install',  'scheduled'),
    (v_tid, v_res2, v_c4, v_e3, CURRENT_DATE + INTERVAL '2 days' + TIME '08:00', CURRENT_DATE + INTERVAL '2 days' + TIME '08:30', 'Tire Rotation',   'scheduled'),
    (v_tid, v_res1, v_c5, v_e1, CURRENT_DATE + INTERVAL '2 days' + TIME '11:00', CURRENT_DATE + INTERVAL '2 days' + TIME '12:30', 'Full Tire Install','scheduled'),
    (v_tid, v_res2, v_c6, v_e2, CURRENT_DATE + INTERVAL '3 days' + TIME '09:00', CURRENT_DATE + INTERVAL '3 days' + TIME '09:45', 'Flat Repair',     'scheduled'),
    (v_tid, v_res1, v_c7, v_e3, CURRENT_DATE + INTERVAL '3 days' + TIME '14:00', CURRENT_DATE + INTERVAL '3 days' + TIME '14:30', 'Tire Rotation',   'scheduled');

  -- Past appointments (completed and canceled)
  INSERT INTO appointments (tenant_id, resource_id, customer_id, employee_id, start_time, end_time, description, status) VALUES
    (v_tid, v_res1, v_c1, v_e1, CURRENT_DATE - INTERVAL '2 days' + TIME '09:00', CURRENT_DATE - INTERVAL '2 days' + TIME '10:30', 'Full Tire Install', 'completed'),
    (v_tid, v_res2, v_c3, v_e2, CURRENT_DATE - INTERVAL '2 days' + TIME '11:00', CURRENT_DATE - INTERVAL '2 days' + TIME '11:45', 'Flat Repair',       'completed'),
    (v_tid, v_res1, v_c5, v_e3, CURRENT_DATE - INTERVAL '3 days' + TIME '08:00', CURRENT_DATE - INTERVAL '3 days' + TIME '08:30', 'Tire Rotation',     'completed'),
    (v_tid, v_res2, v_c8, v_e2, CURRENT_DATE - INTERVAL '5 days' + TIME '10:00', CURRENT_DATE - INTERVAL '5 days' + TIME '10:45', 'Flat Repair',       'canceled'),
    (v_tid, v_res1, v_c4, v_e1, CURRENT_DATE - INTERVAL '6 days' + TIME '13:00', CURRENT_DATE - INTERVAL '6 days' + TIME '14:30', 'Full Tire Install', 'completed');
END $$;

-- Call summaries for past appointments
DO $$
DECLARE v_c1 UUID; v_c3 UUID; v_c5 UUID;
BEGIN
  SELECT id INTO v_c1 FROM customers WHERE phone='+15552001001';
  SELECT id INTO v_c3 FROM customers WHERE phone='+15552001003';
  SELECT id INTO v_c5 FROM customers WHERE phone='+15552001005';

  INSERT INTO call_summaries (tenant_id, customer_id, call_id, summary) VALUES
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', v_c1, 'call-dt-001', 'Bob called to schedule a tire install for his Honda Civic. Prefers morning slot. Booked for Tuesday 9AM with Mike on Truck Alpha.'),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', v_c3, 'call-dt-002', 'David called for his regular 6-month rotation. Very pleasant, confirmed he wants the same time as last visit.'),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a', v_c5, 'call-dt-003', 'James inquired about premium tire brands. Wants Michelin Pilot Sport 4S. Quoted $1,200 for full set including install.');
END $$;


-- ===================================================================
-- 3. BELLA'S HAIR STUDIO — Salon
-- ===================================================================
DO $$
DECLARE
  v_tid UUID;
  v_c1 UUID; v_c2 UUID; v_c3 UUID; v_c4 UUID; v_c5 UUID;
  v_c6 UUID; v_c7 UUID; v_c8 UUID; v_c9 UUID; v_c10 UUID;
  v_e1 UUID; v_e2 UUID; v_e3 UUID; v_e4 UUID;
  v_r1 UUID; v_r2 UUID; v_r3 UUID;
BEGIN
  INSERT INTO tenants (name, business_type, timezone, system_prompt, first_message)
  VALUES ('Bella''s Hair Studio', 'salon', 'America/Chicago',
    'You are a friendly receptionist for Bella''s Hair Studio called {{business_name}}. Help clients book haircuts, coloring, and styling. Collect their name and preferred stylist if they have one.',
    'Hi! Thanks for calling Bella''s Hair Studio. How can I help you today?')
  RETURNING id INTO v_tid;

  INSERT INTO users (tenant_id, email, password_hash, full_name)
  VALUES (v_tid, 'bella@bellashair.com', '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'Bella Martinez');

  -- Resources (Chairs)
  INSERT INTO resources (tenant_id, name, description) VALUES (v_tid, 'Chair 1', 'Front station with mirror and wash basin') RETURNING id INTO v_r1;
  INSERT INTO resources (tenant_id, name, description) VALUES (v_tid, 'Chair 2', 'Middle station — color specialist') RETURNING id INTO v_r2;
  INSERT INTO resources (tenant_id, name, description) VALUES (v_tid, 'Chair 3', 'Back station — blowout bar') RETURNING id INTO v_r3;

  -- Employees (Stylists)
  INSERT INTO employees (tenant_id, name, first_name, last_name, email, phone, skills) VALUES
    (v_tid, 'Bella Martinez',  'Bella',  'Martinez', 'bella@bellashair.com',   '+15553001001', ARRAY['haircut','coloring','highlights','blowout']) RETURNING id INTO v_e1;
  INSERT INTO employees (tenant_id, name, first_name, last_name, email, phone, skills) VALUES
    (v_tid, 'Jasmine Torres', 'Jasmine','Torres',   'jasmine@bellashair.com', '+15553001002', ARRAY['haircut','coloring','highlights','blowout','extensions']) RETURNING id INTO v_e2;
  INSERT INTO employees (tenant_id, name, first_name, last_name, email, phone, skills) VALUES
    (v_tid, 'Amy Nguyen',     'Amy',    'Nguyen',   'amy@bellashair.com',     '+15553001003', ARRAY['haircut','blowout']) RETURNING id INTO v_e3;
  INSERT INTO employees (tenant_id, name, first_name, last_name, email, phone, skills) VALUES
    (v_tid, 'Rachel Kim',     'Rachel', 'Kim',      'rachel@bellashair.com',  '+15553001004', ARRAY['haircut','coloring','highlights']) RETURNING id INTO v_e4;

  -- Services
  INSERT INTO services (tenant_id, name, description, duration_minutes, price, required_skills) VALUES
    (v_tid, 'Women''s Haircut',   'Cut and style',                       45, 55, ARRAY['haircut']),
    (v_tid, 'Men''s Haircut',     'Cut and style',                       30, 35, ARRAY['haircut']),
    (v_tid, 'Full Color',         'Single-process all-over color',       90, 120, ARRAY['coloring']),
    (v_tid, 'Highlights',         'Foil highlights — partial or full',   120, 165, ARRAY['highlights']),
    (v_tid, 'Blowout',            'Wash and blowdry styling',            30, 40,  ARRAY['blowout']);

  -- Shifts (Tue-Sat for all, staggered hours)
  FOR d IN 2..6 LOOP
    INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES (v_tid, v_e1, d, '09:00', '17:00');
    INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES (v_tid, v_e2, d, '10:00', '18:00');
    INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES (v_tid, v_e3, d, '09:00', '14:00');
    INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES (v_tid, v_e4, d, '12:00', '19:00');
  END LOOP;

  -- Customers
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15554001001', 'Emma Roberts',   'Emma',     'Roberts',   'emma.r@example.com',     'Chicago', 'IL', 'America/Chicago', '{"notes":"Prefers Jasmine for color"}') RETURNING id INTO v_c1;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15554001002', 'Olivia Davis',   'Olivia',   'Davis',     'olivia.d@example.com',   'Chicago', 'IL', 'America/Chicago', '{"notes":"Allergic to certain dyes — check chart"}') RETURNING id INTO v_c2;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15554001003', 'Sophia Miller',  'Sophia',   'Miller',    'sophia.m@example.com',   'Evanston','IL', 'America/Chicago', '{"notes":"Comes in every 6 weeks for highlights"}') RETURNING id INTO v_c3;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15554001004', 'Ava Thompson',   'Ava',      'Thompson',  'ava.t@example.com',      'Chicago', 'IL', 'America/Chicago', '{"notes":"Wedding party — 4 blowouts needed"}') RETURNING id INTO v_c4;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15554001005', 'Isabella Moore',  'Isabella','Moore',     'isabella@example.com',   'Oak Park','IL', 'America/Chicago', '{"notes":""}') RETURNING id INTO v_c5;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15554001006', 'Mia Anderson',    'Mia',    'Anderson',  'mia.a@example.com',      'Chicago', 'IL', 'America/Chicago', '{"notes":"First-time client, found us on Yelp"}') RETURNING id INTO v_c6;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15554001007', 'Charlotte White', 'Charlotte','White',    'charlotte.w@example.com','Chicago', 'IL', 'America/Chicago', '{"notes":"Regular for men''s cuts — brings her son too"}') RETURNING id INTO v_c7;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15554001008', 'Harper Brown',    'Harper',  'Brown',     'harper.b@example.com',   'Chicago', 'IL', 'America/Chicago', '{"notes":""}') RETURNING id INTO v_c8;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15554001009', 'Ella Wilson',     'Ella',    'Wilson',    'ella.w@example.com',     'Naperville','IL','America/Chicago', '{"notes":"Wants to try extensions next visit"}') RETURNING id INTO v_c9;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15554001010', 'Grace Taylor',    'Grace',   'Taylor',    'grace.t@example.com',    'Chicago', 'IL', 'America/Chicago', '{"notes":"Loyal customer since 2024"}') RETURNING id INTO v_c10;

  -- Appointments
  INSERT INTO appointments (tenant_id, resource_id, customer_id, employee_id, start_time, end_time, description, status) VALUES
    (v_tid, v_r1, v_c1, v_e1, CURRENT_DATE + INTERVAL '1 day' + TIME '09:00',  CURRENT_DATE + INTERVAL '1 day' + TIME '09:45',  'Women''s Haircut',  'scheduled'),
    (v_tid, v_r2, v_c2, v_e2, CURRENT_DATE + INTERVAL '1 day' + TIME '10:00',  CURRENT_DATE + INTERVAL '1 day' + TIME '11:30',  'Full Color',        'scheduled'),
    (v_tid, v_r3, v_c3, v_e4, CURRENT_DATE + INTERVAL '1 day' + TIME '12:00',  CURRENT_DATE + INTERVAL '1 day' + TIME '14:00',  'Highlights',        'scheduled'),
    (v_tid, v_r1, v_c4, v_e3, CURRENT_DATE + INTERVAL '1 day' + TIME '10:00',  CURRENT_DATE + INTERVAL '1 day' + TIME '10:30',  'Blowout',           'scheduled'),
    (v_tid, v_r1, v_c5, v_e1, CURRENT_DATE + INTERVAL '2 days' + TIME '11:00', CURRENT_DATE + INTERVAL '2 days' + TIME '11:45', 'Women''s Haircut',  'scheduled'),
    (v_tid, v_r2, v_c6, v_e2, CURRENT_DATE + INTERVAL '2 days' + TIME '14:00', CURRENT_DATE + INTERVAL '2 days' + TIME '15:30', 'Full Color',        'scheduled'),
    (v_tid, v_r3, v_c7, v_e3, CURRENT_DATE + INTERVAL '2 days' + TIME '09:00', CURRENT_DATE + INTERVAL '2 days' + TIME '09:30', 'Men''s Haircut',    'scheduled'),
    (v_tid, v_r1, v_c8, v_e4, CURRENT_DATE + INTERVAL '3 days' + TIME '13:00', CURRENT_DATE + INTERVAL '3 days' + TIME '15:00', 'Highlights',        'scheduled'),
    (v_tid, v_r2, v_c9, v_e2, CURRENT_DATE + INTERVAL '3 days' + TIME '10:00', CURRENT_DATE + INTERVAL '3 days' + TIME '11:30', 'Full Color',        'scheduled'),
    -- Past
    (v_tid, v_r1, v_c10, v_e1, CURRENT_DATE - INTERVAL '1 day' + TIME '09:00', CURRENT_DATE - INTERVAL '1 day' + TIME '09:45', 'Women''s Haircut',  'completed'),
    (v_tid, v_r2, v_c1,  v_e2, CURRENT_DATE - INTERVAL '1 day' + TIME '10:00', CURRENT_DATE - INTERVAL '1 day' + TIME '12:00', 'Highlights',        'completed'),
    (v_tid, v_r3, v_c3,  v_e3, CURRENT_DATE - INTERVAL '3 days' + TIME '09:00',CURRENT_DATE - INTERVAL '3 days' + TIME '09:30','Blowout',           'completed'),
    (v_tid, v_r1, v_c5,  v_e1, CURRENT_DATE - INTERVAL '4 days' + TIME '14:00',CURRENT_DATE - INTERVAL '4 days' + TIME '15:30','Full Color',        'completed'),
    (v_tid, v_r2, v_c8,  v_e4, CURRENT_DATE - INTERVAL '5 days' + TIME '13:00',CURRENT_DATE - INTERVAL '5 days' + TIME '14:30','Full Color',        'canceled'),
    (v_tid, v_r1, v_c9,  v_e1, CURRENT_DATE - INTERVAL '6 days' + TIME '11:00',CURRENT_DATE - INTERVAL '6 days' + TIME '11:30','Blowout',           'completed');

  INSERT INTO call_summaries (tenant_id, customer_id, call_id, summary) VALUES
    (v_tid, v_c1, 'call-bh-001', 'Emma called to rebook with Jasmine. Wants highlights next time instead of cut. Mentioned a friend who wants to try the salon.'),
    (v_tid, v_c4, 'call-bh-002', 'Ava called about wedding party blowouts. Needs 4 spots on the same Saturday morning. We confirmed availability for all 4 chairs.'),
    (v_tid, v_c6, 'call-bh-003', 'Mia is a new client — found us on Yelp. Wants a full color consultation before committing. Booked a 15-min consult first.');
END $$;


-- ===================================================================
-- 4. QUICKFIX AUTO REPAIR — Auto Shop
-- ===================================================================
DO $$
DECLARE
  v_tid UUID;
  v_c1 UUID; v_c2 UUID; v_c3 UUID; v_c4 UUID; v_c5 UUID; v_c6 UUID;
  v_e1 UUID; v_e2 UUID; v_e3 UUID;
  v_r1 UUID; v_r2 UUID; v_r3 UUID; v_r4 UUID;
BEGIN
  INSERT INTO tenants (name, business_type, timezone, system_prompt, first_message)
  VALUES ('QuickFix Auto Repair', 'auto-shop', 'America/Denver',
    'You are a professional service advisor for QuickFix Auto Repair called {{business_name}}. Help customers schedule repairs. Collect their name, vehicle year/make/model, and the issue.',
    'Thanks for calling QuickFix Auto Repair! How can we help with your vehicle today?')
  RETURNING id INTO v_tid;

  INSERT INTO users (tenant_id, email, password_hash, full_name)
  VALUES (v_tid, 'owner@quickfixauto.com', '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'Marcus Johnson');

  -- Resources (Bays)
  INSERT INTO resources (tenant_id, name, description) VALUES (v_tid, 'Bay 1', 'Main lift — full service') RETURNING id INTO v_r1;
  INSERT INTO resources (tenant_id, name, description) VALUES (v_tid, 'Bay 2', 'Secondary lift — oil and brakes') RETURNING id INTO v_r2;
  INSERT INTO resources (tenant_id, name, description) VALUES (v_tid, 'Bay 3', 'Quick lane — oil changes and inspections') RETURNING id INTO v_r3;
  INSERT INTO resources (tenant_id, name, description) VALUES (v_tid, 'Bay 4', 'Diagnostic bay — electrical and engine') RETURNING id INTO v_r4;

  -- Employees (Mechanics)
  INSERT INTO employees (tenant_id, name, first_name, last_name, email, phone, skills) VALUES
    (v_tid, 'Tony Russo',     'Tony',   'Russo',    'tony@quickfixauto.com',   '+15555001001', ARRAY['oil-change','brakes','engine-diag','transmission']) RETURNING id INTO v_e1;
  INSERT INTO employees (tenant_id, name, first_name, last_name, email, phone, skills) VALUES
    (v_tid, 'Derek Williams', 'Derek',  'Williams', 'derek@quickfixauto.com',  '+15555001002', ARRAY['oil-change','brakes','tire-service','inspection']) RETURNING id INTO v_e2;
  INSERT INTO employees (tenant_id, name, first_name, last_name, email, phone, skills) VALUES
    (v_tid, 'Nina Patel',     'Nina',   'Patel',    'nina@quickfixauto.com',   '+15555001003', ARRAY['oil-change','brakes','engine-diag','ac-service']) RETURNING id INTO v_e3;

  -- Services
  INSERT INTO services (tenant_id, name, description, duration_minutes, price, required_skills) VALUES
    (v_tid, 'Oil Change',       'Conventional or synthetic oil change',    30,  45, ARRAY['oil-change']),
    (v_tid, 'Brake Service',    'Inspect and replace pads/rotors',         90,  250, ARRAY['brakes']),
    (v_tid, 'Engine Diagnostic','Computer scan + visual inspection',       60,  120, ARRAY['engine-diag']),
    (v_tid, 'State Inspection', 'Annual safety and emissions inspection',  30,  35,  ARRAY['inspection']),
    (v_tid, 'Tire Rotation',    'Rotate and balance all 4 tires',          30,  40,  ARRAY['tire-service']),
    (v_tid, 'AC Service',       'Recharge and leak test',                  60,  150, ARRAY['ac-service']);

  -- Shifts (Mon-Fri 7:30-4:30 for Tony & Nina, Mon-Sat 8-5 for Derek)
  FOR d IN 1..5 LOOP
    INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES (v_tid, v_e1, d, '07:30', '16:30');
    INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES (v_tid, v_e3, d, '07:30', '16:30');
    INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES (v_tid, v_e2, d, '08:00', '17:00');
  END LOOP;
  INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES (v_tid, v_e2, 6, '08:00', '13:00');

  -- Customers
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15556001001', 'Ryan Cooper',    'Ryan',    'Cooper',    'ryan.c@example.com',   'Denver',  'CO', 'America/Denver', '{"vehicle":"2020 Ford F-150","notes":"Regular oil changes every 5K miles"}') RETURNING id INTO v_c1;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15556001002', 'Jennifer Adams', 'Jennifer','Adams',     'jen.a@example.com',    'Aurora',  'CO', 'America/Denver', '{"vehicle":"2019 Honda CR-V","notes":"Brake squeal — needs inspection"}') RETURNING id INTO v_c2;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15556001003', 'Mike Hernandez', 'Mike',    'Hernandez', 'mike.h@example.com',   'Lakewood','CO', 'America/Denver', '{"vehicle":"2017 Chevrolet Malibu","notes":"Check engine light on"}') RETURNING id INTO v_c3;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15556001004', 'Samantha Reed',  'Samantha','Reed',      'sam.r@example.com',    'Denver',  'CO', 'America/Denver', '{"vehicle":"2023 Toyota RAV4","notes":"Due for first state inspection"}') RETURNING id INTO v_c4;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15556001005', 'Paul Nguyen',    'Paul',    'Nguyen',    'paul.n@example.com',   'Boulder', 'CO', 'America/Denver', '{"vehicle":"2021 Tesla Model Y","notes":"AC blowing warm"}') RETURNING id INTO v_c5;
  INSERT INTO customers (tenant_id, phone, name, first_name, last_name, email, city, state, timezone, metadata) VALUES
    (v_tid, '+15556001006', 'Amanda Foster',  'Amanda',  'Foster',    'amanda.f@example.com', 'Denver',  'CO', 'America/Denver', '{"vehicle":"2018 Jeep Wrangler","notes":"Fleet vehicle — needs monthly service"}') RETURNING id INTO v_c6;

  -- Appointments
  INSERT INTO appointments (tenant_id, resource_id, customer_id, employee_id, start_time, end_time, description, status) VALUES
    (v_tid, v_r3, v_c1, v_e2, CURRENT_DATE + INTERVAL '1 day' + TIME '08:00',  CURRENT_DATE + INTERVAL '1 day' + TIME '08:30',  'Oil Change',        'scheduled'),
    (v_tid, v_r1, v_c2, v_e1, CURRENT_DATE + INTERVAL '1 day' + TIME '09:00',  CURRENT_DATE + INTERVAL '1 day' + TIME '10:30',  'Brake Service',     'scheduled'),
    (v_tid, v_r4, v_c3, v_e3, CURRENT_DATE + INTERVAL '1 day' + TIME '10:00',  CURRENT_DATE + INTERVAL '1 day' + TIME '11:00',  'Engine Diagnostic', 'scheduled'),
    (v_tid, v_r3, v_c4, v_e2, CURRENT_DATE + INTERVAL '2 days' + TIME '08:00', CURRENT_DATE + INTERVAL '2 days' + TIME '08:30', 'State Inspection',  'scheduled'),
    (v_tid, v_r4, v_c5, v_e3, CURRENT_DATE + INTERVAL '2 days' + TIME '13:00', CURRENT_DATE + INTERVAL '2 days' + TIME '14:00', 'AC Service',        'scheduled'),
    -- Past
    (v_tid, v_r3, v_c1, v_e2, CURRENT_DATE - INTERVAL '3 days' + TIME '08:00', CURRENT_DATE - INTERVAL '3 days' + TIME '08:30', 'Oil Change',        'completed'),
    (v_tid, v_r1, v_c6, v_e1, CURRENT_DATE - INTERVAL '5 days' + TIME '09:00', CURRENT_DATE - INTERVAL '5 days' + TIME '10:30', 'Brake Service',     'completed'),
    (v_tid, v_r4, v_c3, v_e3, CURRENT_DATE - INTERVAL '7 days' + TIME '10:00', CURRENT_DATE - INTERVAL '7 days' + TIME '11:00', 'Engine Diagnostic', 'canceled');

  INSERT INTO call_summaries (tenant_id, customer_id, call_id, summary) VALUES
    (v_tid, v_c1, 'call-qf-001', 'Ryan called for his regular 5K oil change. Prefers early morning. Booked 8AM tomorrow with Derek.'),
    (v_tid, v_c2, 'call-qf-002', 'Jennifer reports brake squealing when stopping. Likely pads and possibly rotors. Booked 90-min brake service with Tony.'),
    (v_tid, v_c5, 'call-qf-003', 'Paul says AC blowing warm air in his Tesla. Noted this is a heat pump system — Nina has experience with EV AC. Booked Wednesday 1PM.');
END $$;

SEED

echo "[ai-sec] ✅ Database reset and seeded!"
echo ""
echo "   Logins (all passwords: 'password'):"
echo "   ─────────────────────────────────────────"
echo "   dale@ai-sec.com          Super Admin"
echo "   admin@dynatire.com       DynaTire (tire shop)"
echo "   bella@bellashair.com     Bella's Hair Studio (salon)"
echo "   owner@quickfixauto.com   QuickFix Auto Repair (auto shop)"
echo ""
