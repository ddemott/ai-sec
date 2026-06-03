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
