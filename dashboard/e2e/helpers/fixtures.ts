/**
 * Shared E2E test fixtures — register a fresh tenant + seed the entities a
 * spec needs, all via the real backend HTTP routes (the ones the dashboard
 * calls in production). Single-DELETE cleanup via tenant cascade.
 *
 * Why this exists: pre-2026-05-09 the booking-enforcement spec depended on
 * the DynaTire seed (`Mike Rivera`, `Carlos Vega`, `Truck 1`) for its
 * employee/resource lookups. Any seed change — refresh, rename, soft-delete
 * — would silently break the spec without touching the test code. Worse,
 * tests sharing the seed inherited any residue from earlier specs that
 * also touched those rows. Per the test-isolation feedback memory, each
 * test should own its full data lifecycle: setup → assert → teardown,
 * runs independently of every other test.
 *
 * Pattern (mirrors setup-wizard-to-booking.spec.ts):
 *   1. Test calls registerFreshTenant(request) → unique tenant + admin token.
 *   2. Test calls seedBookingScenario(...) with the entities it needs.
 *   3. Test drives its scenario via request.post(`${BACKEND_URL}/...`).
 *   4. Test cleans up via cleanTenantData(pool, tenantId) in `finally`.
 *
 * Tenant cascade: `tenants.id` is FK'd from every dependent table with
 * ON DELETE CASCADE, so a single DELETE removes all the test's residue
 * (services, resources, employees, customers, schedules, appointments,
 * mappings, integrations). Verified against the schema 2026-05-09.
 */
import { expect, type APIRequestContext } from '@playwright/test';
import type { Pool } from 'pg';

export const BACKEND_URL = process.env.BACKEND_URL ?? 'https://localhost:4001';
export const PG_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres';

export interface RegisteredTenant {
  tenantId: string;
  userId: string;
  token: string;
  email: string;
}

export interface SeedBookingScenarioOptions {
  /** Employee names to create. Defaults to a single 'Test Tech'. */
  employees?: string[];
  /** Resource names to create. Defaults to a single 'Test Bay'. */
  resources?: string[];
  /** Customer name to create. Defaults to 'Walk-In Customer'. */
  customer?: string;
  /** YYYY-MM-DD dates to seed shifts on. Defaults to one date 7 days out. */
  shiftDates?: string[];
  /** Shift hours applied to every (employee, date) pair. Defaults 09:00-17:00. */
  shiftHours?: { start: string; end: string };
}

export interface SeededBookingScenario {
  employeeIds: string[];
  resourceIds: string[];
  customerId: string;
  shiftDates: string[];
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

/**
 * Returns a YYYY-MM-DD string `days` days from today (UTC).
 */
export function isoDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Hit POST /register to mint a brand-new tenant + admin user. Returns the
 * tenant_id, user_id, JWT token, and the unique email used (in case the
 * test wants to re-login or reference the user).
 *
 * Why automotive: matches a seeded business_templates entry. The wizard
 * normally auto-seeds example_services from the template, but every test
 * that needs services creates them explicitly via createServiceAs() so the
 * auto-seed timing doesn't matter.
 */
export async function registerFreshTenant(req: APIRequestContext): Promise<RegisteredTenant> {
  const suffix = uniqueSuffix();
  const email = `e2e-${suffix}@example.test`;
  const res = await req.post(`${BACKEND_URL}/register`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      business_name: `E2E Test ${suffix}`,
      business_type: 'automotive',
      owner_name: `Owner ${suffix}`,
      email,
      password: 'password123',
    },
  });
  expect(res.status(), 'register must succeed for a brand-new tenant').toBe(201);
  const body = await res.json();
  expect(body.success).toBe(true);
  return {
    tenantId: body.tenant_id as string,
    userId: body.user_id as string,
    token: body.token as string,
    email,
  };
}

/**
 * Create an employee via POST /employees/create. Splits a full name into
 * first + last; if no space, last_name defaults to 'Tech' so the API's
 * required-field validation passes.
 */
export async function createEmployeeAs(
  req: APIRequestContext,
  token: string,
  tenantId: string,
  fullName: string
): Promise<string> {
  const [first, ...rest] = fullName.split(' ');
  const res = await req.post(`${BACKEND_URL}/employees/create`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    data: {
      tenant_id: tenantId,
      first_name: first,
      last_name: rest.join(' ') || 'Tech',
    },
  });
  expect(res.status(), `employee ${fullName} create must succeed`).toBe(200);
  const body = await res.json();
  return body.employee.employee_id as string;
}

export async function createResourceAs(
  req: APIRequestContext,
  token: string,
  tenantId: string,
  name: string
): Promise<string> {
  const res = await req.post(`${BACKEND_URL}/resources/create`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    data: { tenant_id: tenantId, name },
  });
  expect(res.status(), `resource ${name} create must succeed`).toBe(200);
  const body = await res.json();
  return body.resource.resource_id as string;
}

export async function createCustomerAs(
  req: APIRequestContext,
  token: string,
  tenantId: string,
  name: string
): Promise<string> {
  const phone = `+1555${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
  const res = await req.post(`${BACKEND_URL}/customers/create`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    data: { tenant_id: tenantId, name, phone },
  });
  expect(res.status(), `customer ${name} create must succeed`).toBe(200);
  const body = await res.json();
  return body.customer.customer_id as string;
}

/**
 * Direct INSERT into employee_schedule. Booking RPCs read this table
 * exclusively for shift-coverage, so seeding here is the most precise
 * way to give a test the shift it needs on a specific date — short of
 * driving /shifts/expand-weekly which only covers the next 4 weeks
 * from today and isn't useful for tests that need far-future dates.
 *
 * Uses ON CONFLICT (tenant, employee, date) DO UPDATE so re-running
 * a partially-cleaned-up test in dev doesn't 23505 on a stale row.
 */
export async function seedShift(
  pool: Pool,
  tenantId: string,
  employeeId: string,
  date: string,
  hours: { start: string; end: string }
): Promise<void> {
  // 2026-05-18 pilot #3 dropped employee_schedule.employee_schedule_id;
  // the composite (tenant_id, employee_id, shift_date) IS the identity.
  // Callers that need to reference the row (delete in afterAll, etc.)
  // use those three columns directly — they passed them to us, so they
  // already have them.
  await pool.query(
    `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3, $4, $5, false)
       ON CONFLICT (tenant_id, employee_id, shift_date)
         DO UPDATE SET start_time = EXCLUDED.start_time,
                       end_time   = EXCLUDED.end_time,
                       is_off     = false`,
    [tenantId, employeeId, date, hours.start, hours.end]
  );
}

/**
 * Seed the entities a booking-scenario test typically needs:
 *   - N employees (default 1)
 *   - M resources (default 1)
 *   - 1 customer
 *   - shifts for every (employee, shiftDate) pair, default one date 7 days out
 *
 * Returns the IDs in stable order so tests can `const [mike, carlos] = ...`.
 * Pool is required for shift seeding (booking RPCs read employee_schedule
 * directly; there's no /shifts/create-on-date route by design — date-specific
 * shifts are managed via the dashboard's Schedule tab UI which posts to
 * /shifts/overrides; expand-weekly only covers the next 4 weeks).
 */
export async function seedBookingScenario(
  req: APIRequestContext,
  pool: Pool,
  token: string,
  tenantId: string,
  options: SeedBookingScenarioOptions = {}
): Promise<SeededBookingScenario> {
  const employeeNames = options.employees ?? ['Test Tech'];
  const resourceNames = options.resources ?? ['Test Bay'];
  const customerName = options.customer ?? 'Walk-In Customer';
  const shiftDates = options.shiftDates ?? [isoDateDaysFromNow(7)];
  const hours = options.shiftHours ?? { start: '09:00', end: '17:00' };

  const employeeIds: string[] = [];
  for (const name of employeeNames) {
    employeeIds.push(await createEmployeeAs(req, token, tenantId, name));
  }
  const resourceIds: string[] = [];
  for (const name of resourceNames) {
    resourceIds.push(await createResourceAs(req, token, tenantId, name));
  }
  const customerId = await createCustomerAs(req, token, tenantId, customerName);

  for (const empId of employeeIds) {
    for (const date of shiftDates) {
      await seedShift(pool, tenantId, empId, date, hours);
    }
  }

  return { employeeIds, resourceIds, customerId, shiftDates };
}

/**
 * Single-statement teardown. The tenants table cascades to every
 * dependent row (verified against the schema 2026-05-09): users,
 * services, resources, employees, customers, employee_schedule,
 * appointments, service_employee, service_resource, knowledge_base
 * docs, integrations, etc. So one DELETE removes all of the test's residue.
 */
export async function cleanTenantData(pool: Pool, tenantId: string): Promise<void> {
  await pool.query('DELETE FROM tenants WHERE tenant_id = $1', [tenantId]);
}

/**
 * Convenience: POST /appointments/create and return { status, body } so
 * tests can assert on the conflict block returned at 409 without
 * unwrapping the response themselves.
 */
export async function bookAppointmentAs(
  req: APIRequestContext,
  token: string,
  payload: {
    tenant_id: string;
    resource_id: string;
    customer_id: string;
    employee_id?: string | null;
    start_time: string;
    end_time: string;
    description: string;
    location?: string | null;
    service_id?: string | null;
  }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await req.post(`${BACKEND_URL}/appointments/create`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    data: payload,
  });
  return { status: res.status(), body: await res.json() };
}

/**
 * Convenience: POST /appointments/:id/update and return { status, body }.
 * Used by the edit-overlap scenario to verify symmetric conflict handling
 * on the update path.
 */
export async function updateAppointmentAs(
  req: APIRequestContext,
  token: string,
  appointmentId: string,
  payload: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await req.post(`${BACKEND_URL}/appointments/${appointmentId}/update`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    data: payload,
  });
  return { status: res.status(), body: await res.json() };
}

// ────────────────────────────────────────────────────────────────────
// DynaTire business-config fixture
//
// Tenant ID, resource IDs, and entity names below match what used to
// live in `supabase/seed.sql` (sections 2, 6-9) before the 2026-05-18
// seed-strip-stage-b refactor. Five existing E2E specs key off these
// exact rows — `workflows.spec.ts`, `agent-conversation.spec.ts`,
// `booking-alignment.spec.ts`, `booking-enforcement.spec.ts`, and
// `calendar-sync.spec.ts` — so the fixture re-creates them at the
// spec level. Tests stop depending on whatever the seed happens to
// contain; the seed stays bare-bones (tenant + owner only).
//
// Why this is its own helper rather than `seedBookingScenario`: those
// specs hard-code DynaTire's UUIDs, names ("Mike Rivera", "Truck 1"),
// and skill arrays in their assertions. A generic "create some tech"
// fixture wouldn't satisfy them without rewriting every assertion.
// Easier to give them back the exact rows they expect and let the
// next round of test rewrites (one at a time) move them onto the
// generic fixture as their assertions are softened.
// ────────────────────────────────────────────────────────────────────

export const DYNATIRE_TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
export const DYNATIRE_TRUCK_1_ID = '18288e57-a958-41e4-be5f-e95a8539a06b';
export const DYNATIRE_TRUCK_2_ID = 'a7c3e912-4b1f-4d8e-9f2a-1c3d5e7f9a0b';

/**
 * Seed DynaTire's business shape (resources, services, employees, the
 * 2-week employee_schedule window, and the service↔employee/resource
 * mapping tables) into the existing DynaTire tenant. The tenant + owner
 * user are still seeded by `supabase/seed.sql`; this helper adds the
 * *operational* layer that booking specs need.
 *
 * Idempotent: every INSERT uses ON CONFLICT DO NOTHING so running
 * twice in the same DB is a no-op. Tests using this fixture should
 * still call `clearDynaTireBusinessConfig` in their afterAll so the
 * DB returns to bare-bones, satisfying the "tests own their data
 * lifecycle" principle.
 */
export async function seedDynaTireBusinessConfig(pool: Pool): Promise<void> {
  // SQL inlines the DynaTire / truck UUIDs (constants exported above)
  // rather than parameterizing — pg.Pool.query rejects multi-statement
  // strings when any `$n` parameter is present (one-statement-per-
  // prepared-statement rule). Inlining keeps the script readable as
  // one block; the values are public constants in this file anyway.
  await pool.query(
    `
    -- Resources (2 service trucks).
    INSERT INTO resources (resource_id, tenant_id, name, description) VALUES
      ('${DYNATIRE_TRUCK_1_ID}', '${DYNATIRE_TENANT_ID}', 'Truck 1', 'Ram ProMaster — main mobile unit, full tire inventory'),
      ('${DYNATIRE_TRUCK_2_ID}', '${DYNATIRE_TENANT_ID}', 'Truck 2', 'Ford Transit — backup unit, rotation and flat repair only')
    ON CONFLICT (resource_id) DO NOTHING;

    -- Services (5 mobile-tire offerings).
    INSERT INTO services (tenant_id, name, subtitle, description, duration_minutes, price, required_skills, required_resources) VALUES
      ('${DYNATIRE_TENANT_ID}', 'Flat Repair (On-site)', 'Plug or patch', 'We come to you and repair your flat tire on-site. Includes inspection of the damaged tire and plug/patch repair.', 60, 85, ARRAY['flat-repair'], ARRAY['mobile-truck']),
      ('${DYNATIRE_TENANT_ID}', 'Seasonal Tire Swap', 'Winter ↔ Summer', 'Swap between your winter and summer tire sets. We store nothing — bring both sets or we''ll pick up from your garage.', 90, 120, ARRAY['tire-swap'], ARRAY['mobile-truck']),
      ('${DYNATIRE_TENANT_ID}', 'Tire Rotation', 'Even wear', 'Standard 4-tire rotation for even tread wear. Recommended every 5,000-7,500 miles.', 30, 60, ARRAY['tire-rotation'], ARRAY['mobile-truck']),
      ('${DYNATIRE_TENANT_ID}', 'New Tire Install (x4)', 'Full set', 'Mount and balance a full set of 4 new tires. Customer supplies tires or we source them (Michelin, Goodyear, Continental).', 120, 280, ARRAY['tire-install'], ARRAY['mobile-truck']),
      ('${DYNATIRE_TENANT_ID}', 'Balancing', 'Wheel balance', 'Computer-aided wheel balancing for a smooth ride. Recommended with any new tire install.', 30, 45, ARRAY['balancing'], ARRAY['mobile-truck'])
    ON CONFLICT DO NOTHING;

    -- Employees (3 techs, distinct skill sets).
    INSERT INTO employees (tenant_id, name, first_name, last_name, phone, skills) VALUES
      ('${DYNATIRE_TENANT_ID}', 'Mike Rivera',  'Mike',   'Rivera', '+16305550201', ARRAY['flat-repair', 'tire-swap', 'tire-rotation', 'tire-install', 'balancing']),
      ('${DYNATIRE_TENANT_ID}', 'Carlos Vega',  'Carlos', 'Vega',   '+16305550202', ARRAY['flat-repair', 'tire-swap', 'tire-rotation']),
      ('${DYNATIRE_TENANT_ID}', 'Dana Okafor',  'Dana',   'Okafor', '+16305550203', ARRAY['flat-repair', 'tire-rotation', 'tire-install'])
    ON CONFLICT DO NOTHING;
    `
  );

  // Shifts + service-mapping run inside a single DO block so the
  // SELECT … INTO local-variable lookups stay coherent (services and
  // employees were just inserted above; their IDs are looked up by
  // name to avoid threading them through this function's API).
  await pool.query(
    `
    DO $$
    DECLARE
      v_mike_id   UUID;
      v_carlos_id UUID;
      v_dana_id   UUID;
      v_tenant_id UUID := 'f234e471-0e60-4163-86c9-93cfd9338e3a';
      v_day       DATE;
      v_start     DATE;
      v_end       DATE;
    BEGIN
      SELECT employee_id INTO v_mike_id   FROM employees WHERE name = 'Mike Rivera' AND tenant_id = v_tenant_id;
      SELECT employee_id INTO v_carlos_id FROM employees WHERE name = 'Carlos Vega'  AND tenant_id = v_tenant_id;
      SELECT employee_id INTO v_dana_id   FROM employees WHERE name = 'Dana Okafor'  AND tenant_id = v_tenant_id;

      -- 2-week shift window: this Monday through next Friday (12 weekdays).
      v_start := CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::INT + 1;
      v_end   := v_start + 11;

      v_day := v_start;
      WHILE v_day <= v_end LOOP
        IF EXTRACT(DOW FROM v_day) NOT IN (0, 6) THEN
          INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
          VALUES (v_tenant_id, v_mike_id,   v_day, '07:00', '16:00', false)
          ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING;

          INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
          VALUES (v_tenant_id, v_carlos_id, v_day, '08:00', '17:00', false)
          ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING;

          INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
          VALUES (v_tenant_id, v_dana_id,   v_day, '09:00', '18:00', false)
          ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING;
        END IF;
        v_day := v_day + 1;
      END LOOP;
    END $$;

    DO $$
    DECLARE
      v_svc_flat     UUID;
      v_svc_swap     UUID;
      v_svc_rotation UUID;
      v_svc_install  UUID;
      v_svc_balance  UUID;
      v_mike   UUID;
      v_carlos UUID;
      v_dana   UUID;
      v_truck1 UUID := '18288e57-a958-41e4-be5f-e95a8539a06b';
      v_truck2 UUID := 'a7c3e912-4b1f-4d8e-9f2a-1c3d5e7f9a0b';
      v_tenant UUID := 'f234e471-0e60-4163-86c9-93cfd9338e3a';
    BEGIN
      SELECT service_id INTO v_svc_flat     FROM services WHERE name = 'Flat Repair (On-site)' AND tenant_id = v_tenant;
      SELECT service_id INTO v_svc_swap     FROM services WHERE name = 'Seasonal Tire Swap'    AND tenant_id = v_tenant;
      SELECT service_id INTO v_svc_rotation FROM services WHERE name = 'Tire Rotation'         AND tenant_id = v_tenant;
      SELECT service_id INTO v_svc_install  FROM services WHERE name = 'New Tire Install (x4)' AND tenant_id = v_tenant;
      SELECT service_id INTO v_svc_balance  FROM services WHERE name = 'Balancing'             AND tenant_id = v_tenant;

      SELECT employee_id INTO v_mike   FROM employees WHERE name = 'Mike Rivera'  AND tenant_id = v_tenant;
      SELECT employee_id INTO v_carlos FROM employees WHERE name = 'Carlos Vega'  AND tenant_id = v_tenant;
      SELECT employee_id INTO v_dana   FROM employees WHERE name = 'Dana Okafor'  AND tenant_id = v_tenant;

      INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES
        (v_svc_flat, v_mike, v_tenant), (v_svc_flat, v_carlos, v_tenant), (v_svc_flat, v_dana, v_tenant),
        (v_svc_swap, v_mike, v_tenant), (v_svc_swap, v_carlos, v_tenant),
        (v_svc_rotation, v_mike, v_tenant), (v_svc_rotation, v_carlos, v_tenant), (v_svc_rotation, v_dana, v_tenant),
        (v_svc_install, v_mike, v_tenant), (v_svc_install, v_dana, v_tenant),
        (v_svc_balance, v_mike, v_tenant)
      ON CONFLICT DO NOTHING;

      INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES
        (v_svc_flat,     v_truck1, v_tenant), (v_svc_flat,     v_truck2, v_tenant),
        (v_svc_swap,     v_truck1, v_tenant), (v_svc_swap,     v_truck2, v_tenant),
        (v_svc_rotation, v_truck1, v_tenant), (v_svc_rotation, v_truck2, v_tenant),
        (v_svc_install,  v_truck1, v_tenant),
        (v_svc_balance,  v_truck1, v_tenant)
      ON CONFLICT DO NOTHING;
    END $$;
    `
  );
}

/**
 * Reverse-order teardown of the rows seeded by `seedDynaTireBusinessConfig`.
 *
 * Order matters because of FK relationships:
 *   1. Junction tables (service_employee, service_resource).
 *   2. employee_schedule.
 *   3. appointments / customers — defensive: a misbehaving test in
 *      this spec may have created appointments tied to DynaTire's
 *      employees/resources. Clearing them keeps the next spec from
 *      tripping over residue.
 *   4. employees, services, resources (in any order — no FKs between).
 *
 * Does NOT delete the tenant or owner user — those are still in the
 * bare-bones seed and are needed for every spec's login + tenant
 * switching.
 */
export async function clearDynaTireBusinessConfig(pool: Pool): Promise<void> {
  // Tenant ID inlined (same multi-statement constraint as the seed
  // function — see comment there).
  await pool.query(
    `
    DELETE FROM service_employee  WHERE tenant_id = '${DYNATIRE_TENANT_ID}';
    DELETE FROM service_resource  WHERE tenant_id = '${DYNATIRE_TENANT_ID}';
    DELETE FROM employee_schedule WHERE tenant_id = '${DYNATIRE_TENANT_ID}';
    DELETE FROM appointments      WHERE tenant_id = '${DYNATIRE_TENANT_ID}';
    DELETE FROM customers         WHERE tenant_id = '${DYNATIRE_TENANT_ID}';
    DELETE FROM employees         WHERE tenant_id = '${DYNATIRE_TENANT_ID}';
    DELETE FROM services          WHERE tenant_id = '${DYNATIRE_TENANT_ID}';
    DELETE FROM resources         WHERE tenant_id = '${DYNATIRE_TENANT_ID}';
    `
  );
}

/**
 * Convenience: direct INSERT of a scheduled appointment for tests that
 * need a "blocker" row pre-existing before the test's actual booking
 * attempt. Tests own this row's cleanup via cleanTenantData() (cascades).
 */
export async function seedAppointment(
  pool: Pool,
  tenantId: string,
  params: {
    resourceId: string;
    customerId: string;
    employeeId: string | null;
    startTime: string;
    endTime: string;
    description: string;
  }
): Promise<string> {
  const res = await pool.query(
    `INSERT INTO appointments (tenant_id, resource_id, customer_id, employee_id, start_time, end_time, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
       RETURNING appointment_id`,
    [
      tenantId,
      params.resourceId,
      params.customerId,
      params.employeeId,
      params.startTime,
      params.endTime,
      params.description,
    ]
  );
  return res.rows[0].appointment_id as string;
}
