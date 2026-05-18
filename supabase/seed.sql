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

-- 6-9. (intentionally empty) DynaTire's services / employees / shifts
-- / service-mapping rows now live in
-- `dashboard/e2e/helpers/fixtures.ts::seedDynaTireBusinessConfig` and
-- get bootstrapped per-spec for the 5 specs that need them. See the
-- block-comment above (sections 2-5) for the motivating principle.
