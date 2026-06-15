-- Seed Data for SecretaryHQ SaaS (Platform + Demo Tenants)
-- All test data is Chicago / Chicagoland / Chicago suburbs

-- 0. Create a Platform Tenant for the SecretaryHQ Admin (Super Admin)
--    onboarding_completed = true: super-admin has no business to configure,
--    so skip the setup wizard entirely.
INSERT INTO tenants (tenant_id, name, business_type, timezone, onboarding_completed)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'SecretaryHQ Platform',
    'platform-admin',
    'America/Chicago',
    true
) ON CONFLICT (tenant_id) DO UPDATE SET onboarding_completed = true;

-- 0b. Create a SecretaryHQ Admin User (Platform Admin)
INSERT INTO users (tenant_id, email, password_hash, full_name)
VALUES ('00000000-0000-0000-0000-000000000000', 'admin@secretaryhq.com', '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK', 'SecretaryHQ Admin')
ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- 1. Thinking Hammer LLC tenant + Dale's personal owner account.
--    Separates Dale's super-admin platform rights (admin@secretaryhq.com)
--    from his real-business owner identity (daledemott@gmail.com).
INSERT INTO tenants (tenant_id, name, business_type, timezone)
VALUES (
    'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0',
    'Thinking Hammer LLC',
    'answering-service',
    'America/Chicago'
) ON CONFLICT (tenant_id) DO UPDATE SET name = 'Thinking Hammer LLC';

INSERT INTO users (tenant_id, email, password_hash, full_name, role)
VALUES (
    'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0',
    'daledemott@gmail.com',
    '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK',
    'Dale DeMott',
    'owner'
) ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name;

-- 1b. Remove stale DynaTire tenant if it exists (deprecated 2026-06-02)
DELETE FROM users WHERE tenant_id = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
DELETE FROM tenants WHERE tenant_id = 'f234e471-0e60-4163-86c9-93cfd9338e3a';

-- 1c. SECURITY: ensure daledemott@gmail.com exists ONLY on Thinking Hammer,
-- never on the platform/super-admin tenant. A stray duplicate on
-- 00000000 was found in prod 2026-06-02 — it gave Dale's personal email
-- super-admin rights AND made /login resolve his account to the wrong
-- tenant. The design (CLAUDE.md) keeps his business identity strictly
-- separate from the super-admin identity (admin@secretaryhq.com).
DELETE FROM users
 WHERE email = 'daledemott@gmail.com'
   AND tenant_id = '00000000-0000-0000-0000-000000000000';

-- 2. (intentionally empty) Resources are NOT seeded.
-- 3. (intentionally empty) Customers are NOT seeded.
-- 4. (intentionally empty) Appointments are NOT seeded.
-- 5. (intentionally empty) Services, employees, shifts, and the
--    service↔employee/resource mapping tables are NOT seeded either.
--
-- Principle (locked 2026-05-18): seed data starts bare-bones. ONLY the
-- minimum a tenant needs to exist (the tenant row itself + an owner user
-- to log in as) ships in the seed. Every other entity — resources,
-- services, employees, shifts, customers, appointments — is the
-- responsibility of the test that needs it: create in `beforeAll`,
-- delete in `afterAll`.
--
-- Why: pre-strip seed accumulated 17 stray appointments + 12 customers
-- across `db:rebuild` runs (date-derived rows never hit a real ON
-- CONFLICT), so tests ran against a polluted DB that grew silently. A
-- bare-bones seed is a predictable starting state for every test, and a
-- test failure is provably the code or the test — never "the seed left
-- something behind."
--
-- The previous DynaTire business-config layer (resources, services, 3
-- employees, 2-week shift window, service-mapping tables) moved into
-- `dashboard/e2e/helpers/fixtures.ts::seedDynaTireBusinessConfig` on
-- 2026-05-18. The 5 booking specs that rely on those exact rows call
-- the fixture in their beforeAll and tear it down in afterAll.

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

-- 6-9. (intentionally empty) Services / employees / shifts / service-mapping
-- rows are set up per-test in fixtures. See block-comment above (sections 2-5).

-- 10. Business Templates — vocabulary + display metadata.
-- WHY THIS IS HERE: baseline.sql has only the schema (no data). The rebuild
-- script's --baseline mode marks historical migrations applied without running
-- them, so the template INSERT/UPDATE migrations never execute after a rebuild.
-- Seeding here is idempotent (ON CONFLICT DO UPDATE) and ensures every
-- rebuild ends with the correct vocabulary labels, category groups, and
-- default-resource names that /vocabulary, /templates, and the
-- apply_business_template_defaults trigger all depend on.
-- system_prompt_template and first_message are intentionally omitted —
-- they're long, and no E2E test asserts their values (tests that need a
-- non-NULL system_prompt create one explicitly via /tenants/:id/update-config).
INSERT INTO business_templates (
  business_type, display_name, category, sort_order,
  resource_label, resource_plural, employee_label, employee_plural, booking_label,
  voice_id, default_resource_name, default_resource_description,
  example_services, example_resources
) VALUES
  ('auto-shop',         'Auto Repair Shop',               'Auto & Vehicle',          1, 'Bay',            'Bays',            'Mechanic',       'Mechanics',       'Appointment',  'pNInz6ovDWjNkhCspfAY', 'Service Bay 1',     'Standard repair and maintenance bay',  '{}', '{}'),
  ('body-shop',         'Body & Paint Shop',              'Auto & Vehicle',          1, 'Booth',          'Booths',          'Body Tech',      'Body Techs',      'Appointment',  'pNInz6ovDWjNkhCspfAY', 'Paint Booth 1',     'Main paint and body bay',              '{}', '{}'),
  ('car-detailing',     'Car Detailing',                  'Auto & Vehicle',          1, 'Detail Bay',     'Detail Bays',     'Detailer',       'Detailers',       'Appointment',  'pNInz6ovDWjNkhCspfAY', 'Detail Bay 1',      'Main detailing bay',                   '{}', '{}'),
  ('car-wash',          'Car Wash',                       'Auto & Vehicle',          1, 'Wash Bay',       'Wash Bays',       'Washer',         'Washers',         'Appointment',  'pNInz6ovDWjNkhCspfAY', 'Wash Bay 1',        'Automated or hand wash bay',           '{}', '{}'),
  ('mobile-tire',       'Mobile Tire Shop',               'Auto & Vehicle',          1, 'Truck',          'Trucks',          'Technician',     'Technicians',     'Appointment',  'ba124806-6962-4354-94a0-7607775952f4', 'Service Truck 1', 'Main mobile unit for tire repairs',  '{}', '{}'),
  ('oil-change',        'Quick Lube / Oil Change',        'Auto & Vehicle',          1, 'Lane',           'Lanes',           'Lube Tech',      'Lube Techs',      'Appointment',  'pNInz6ovDWjNkhCspfAY', 'Lane 1',            'Quick service lane',                   '{}', '{}'),
  ('barbershop',        'Barbershop',                     'Beauty & Personal Care',  2, 'Chair',          'Chairs',          'Barber',         'Barbers',         'Appointment',  'pNInz6ovDWjNkhCspfAY', 'Chair 1',           'Main barber chair',                    '{}', '{}'),
  ('lash-studio',       'Lash & Brow Studio',             'Beauty & Personal Care',  2, 'Station',        'Stations',        'Lash Artist',    'Lash Artists',    'Appointment',  '21m00Tcm4llvDq8ikWAM', 'Station 1',         'Lash application station',             '{}', '{}'),
  ('med-spa',           'Med Spa / Aesthetics',           'Beauty & Personal Care',  2, 'Treatment Room', 'Treatment Rooms', 'Aesthetician',   'Aestheticians',   'Appointment',  '21m00Tcm4llvDq8ikWAM', 'Treatment Room 1',  'Main treatment room',                  '{}', '{}'),
  ('nail-salon',        'Nail Salon',                     'Beauty & Personal Care',  2, 'Station',        'Stations',        'Nail Tech',      'Nail Techs',      'Appointment',  '21m00Tcm4llvDq8ikWAM', 'Station 1',         'Nail technician station',              '{}', '{}'),
  ('salon',             'Hair Salon',                     'Beauty & Personal Care',  2, 'Chair',          'Chairs',          'Stylist',        'Stylists',        'Appointment',  '21m00Tcm4llvDq8ikWAM', 'Styling Station 1', 'Main chair for hair services',         '{}', '{}'),
  ('spa',               'Spa & Wellness',                 'Beauty & Personal Care',  2, 'Treatment Room', 'Treatment Rooms', 'Therapist',      'Therapists',      'Session',      '21m00Tcm4llvDq8ikWAM', 'Treatment Room 1',  'Main treatment room',                  '{}', '{}'),
  ('personal-trainer',  'Personal Training',              'Fitness & Wellness',      4, 'Studio',         'Studios',         'Trainer',        'Trainers',        'Session',      'pNInz6ovDWjNkhCspfAY', 'Studio 1',          'Training studio',                      '{}', '{}'),
  ('yoga-studio',       'Yoga Studio',                    'Fitness & Wellness',      4, 'Studio',         'Studios',         'Instructor',     'Instructors',     'Class',        '21m00Tcm4llvDq8ikWAM', 'Studio 1',          'Main yoga studio',                     '{}', '{}'),
  ('bakery',            'Bakery',                         'Food & Beverage',         6, 'Counter',        'Counters',        'Baker',          'Bakers',          'Order',        '21m00Tcm4llvDq8ikWAM', 'Counter 1',         'Main service counter',                 '{}', '{}'),
  ('catering',          'Catering Service',               'Food & Beverage',         6, 'Kitchen',        'Kitchens',        'Chef',           'Chefs',           'Event',        '21m00Tcm4llvDq8ikWAM', 'Kitchen 1',         'Main prep kitchen',                    '{}', '{}'),
  ('cleaning',          'Cleaning Service',               'Home Services',           3, 'Team',           'Teams',           'Cleaner',        'Cleaners',        'Booking',      '21m00Tcm4llvDq8ikWAM', 'Team A',            'Cleaning crew',                        '{}', '{}'),
  ('electrician',       'Electrical Service',             'Home Services',           3, 'Van',            'Vans',            'Electrician',    'Electricians',    'Service Call', 'pNInz6ovDWjNkhCspfAY', 'Van 1',             'Main service van',                     '{}', '{}'),
  ('garage-door',       'Garage Door Service',            'Home Services',           3, 'Van',            'Vans',            'Installer',      'Installers',      'Service Call', 'pNInz6ovDWjNkhCspfAY', 'Van 1',             'Main service van',                     '{}', '{}'),
  ('hvac',              'HVAC Service',                   'Home Services',           3, 'Van',            'Vans',            'Technician',     'Technicians',     'Service Call', 'pNInz6ovDWjNkhCspfAY', 'Van 1',             'Main service van',                     '{}', '{}'),
  ('landscaping',       'Landscaping Service',            'Home Services',           3, 'Crew',           'Crews',           'Crew Lead',      'Crew Leads',      'Job',          'pNInz6ovDWjNkhCspfAY', 'Crew A',            'Landscaping crew',                     '{}', '{}'),
  ('locksmith',         'Locksmith',                      'Home Services',           3, 'Van',            'Vans',            'Locksmith',      'Locksmiths',      'Service Call', 'pNInz6ovDWjNkhCspfAY', 'Van 1',             'Mobile locksmith van',                 '{}', '{}'),
  ('pest-control',      'Pest Control',                   'Home Services',           3, 'Van',            'Vans',            'Technician',     'Technicians',     'Service Call', 'pNInz6ovDWjNkhCspfAY', 'Van 1',             'Main service van',                     '{}', '{}'),
  ('plumber',           'Plumbing Service',               'Home Services',           3, 'Van',            'Vans',            'Plumber',        'Plumbers',        'Service Call', 'pNInz6ovDWjNkhCspfAY', 'Van 1',             'Main service van',                     '{}', '{}'),
  ('answering-service', 'Answering & Scheduling Service', 'Professional Services',   0, 'Line',           'Lines',           'Staff',          'Staff',           'Meeting',      'clara',                'Main Office',       'Primary scheduling line',              '{}', '{}'),
  ('insurance',         'Insurance Agency',               'Professional Services',   5, 'Office',         'Offices',         'Agent',          'Agents',          'Consultation', 'ErXwSzhRj4IW3zYCt9a2', 'Office 1',         'Consultation office',                  '{}', '{}'),
  ('photography',       'Photography Studio',             'Professional Services',   5, 'Studio',         'Studios',         'Photographer',   'Photographers',   'Session',      '21m00Tcm4llvDq8ikWAM', 'Studio 1',         'Main photography studio',              '{}', '{}'),
  ('real-estate',       'Real Estate Showings',           'Professional Services',   5, 'Office',         'Offices',         'Agent',          'Agents',          'Showing',      '21m00Tcm4llvDq8ikWAM', 'Office 1',         'Main showing office',                  '{}', '{}'),
  ('tax-prep',          'Tax Preparation',                'Professional Services',   5, 'Office',         'Offices',         'Preparer',       'Preparers',       'Appointment',  'ErXwSzhRj4IW3zYCt9a2', 'Office 1',         'Tax preparation office',               '{}', '{}'),
  ('tutoring',          'Tutoring Service',               'Professional Services',   5, 'Room',           'Rooms',           'Tutor',          'Tutors',          'Session',      '21m00Tcm4llvDq8ikWAM', 'Room 1',            'Tutoring room',                       '{}', '{}')
ON CONFLICT (business_type) DO UPDATE SET
  display_name             = EXCLUDED.display_name,
  category                 = EXCLUDED.category,
  sort_order               = EXCLUDED.sort_order,
  resource_label           = EXCLUDED.resource_label,
  resource_plural          = EXCLUDED.resource_plural,
  employee_label           = EXCLUDED.employee_label,
  employee_plural          = EXCLUDED.employee_plural,
  booking_label            = EXCLUDED.booking_label,
  voice_id                 = COALESCE(business_templates.voice_id, EXCLUDED.voice_id),
  default_resource_name    = EXCLUDED.default_resource_name,
  default_resource_description = EXCLUDED.default_resource_description;
