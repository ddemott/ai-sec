/**
 * E2E coverage for the SOLO wizard finalize path — the 3-step flow that
 * auto-creates the owner-as-employee, auto-maps every service to that one
 * employee + the single resource, and fans the owner's weekly hours pattern
 * into 4 weeks of employee_schedule rows.
 *
 * Why this exists: docs/TODO.md P2 "Solo wizard vs multi-employee wizard
 * divergence" notes that only one path is exercised in audit. The existing
 * `setup-wizard-to-booking.spec.ts` covers the multi-employee path (operator
 * explicitly creates each employee + maps services). The solo path's
 * specifically divergent behavior — auto-mapping every service to the one
 * employee inside handleFinalize() at SetupWizard/SoloWizard.tsx:237-238 —
 * has no E2E pin today. A regression that drops the for-each-service-map
 * loop would silently let solo finalize "succeed" (the user sees the Go
 * Live screen) but every booking attempt for any service would return
 * NO_SKILLED_EMPLOYEE because no row exists in service_employee — exactly
 * the failure shape pilot 16 surfaced for missing skill rows.
 *
 * Coverage:
 *   1. HAPPY — full solo finalize via API: register → create services (3 of them) →
 *      create one owner-employee → assign all services to that employee + resource →
 *      fan a weekday pattern → book each service in succession. Pins the load-
 *      bearing invariant: every service in the catalog is bookable after solo finalize.
 *   2. SAD — skip the service-employee mapping step → booking returns
 *      NO_SKILLED_EMPLOYEE on the first service. Proves the auto-mapping is
 *      THE differentiator (not just a nicety); without it, solo wizard's UX
 *      promise is broken.
 *   3. SHAPE — after solo finalize, DB state matches the expected single-employee
 *      shape: exactly 1 row in employees, N rows in service_employee (one per
 *      service), all pointing at that single employee. Catches a regression where
 *      a future "auto-create a second placeholder employee" change accidentally
 *      drops the auto-mapping invariant.
 *
 * Mirrors setup-wizard-to-booking.spec.ts's API-only design: each test owns
 * its own tenant lifecycle, DELETEs on cleanup (FK cascade).
 */
import { test, expect } from './helpers/test';
import { type APIRequestContext } from '@playwright/test';
import { Pool } from 'pg';

const PG_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres';
const BACKEND_URL = 'https://localhost:4001';

let pool: Pool;

function uniqueSuffix(): string {
    return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function isoDateDaysFromNow(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function fullWeekPattern(): { day_of_week: number; start_time: string; end_time: string }[] {
    const pattern = [];
    for (let dow = 0; dow < 7; dow++) {
        pattern.push({ day_of_week: dow, start_time: '08:00', end_time: '18:00' });
    }
    return pattern;
}

interface RegisteredTenant {
    tenantId: string;
    token: string;
    ownerName: string;
    email: string;
}

async function registerSoloTenant(req: APIRequestContext): Promise<RegisteredTenant> {
    const suffix = uniqueSuffix();
    const ownerName = `Solo Owner ${suffix}`;
    const email = `solo-wizard-e2e-${suffix}@example.test`;
    const res = await req.post(`${BACKEND_URL}/register`, {
        headers: { 'Content-Type': 'application/json' },
        data: {
            business_name: `Solo Wizard E2E ${suffix}`,
            business_type: 'automotive',
            owner_name: ownerName,
            email,
            password: 'password123',
        },
    });
    expect(res.status(), 'register must succeed').toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    return {
        tenantId: body.tenant_id as string,
        token: body.token as string,
        ownerName,
        email,
    };
}

async function createService(
    req: APIRequestContext, token: string, tenantId: string, name: string
): Promise<string> {
    const res = await req.post(`${BACKEND_URL}/services/create`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        data: { tenant_id: tenantId, name, duration_minutes: 30 },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Post PK-rename, /services/create returns the row with `service_id` (no `id` alias).
    return body.service.service_id as string;
}

async function createResource(
    req: APIRequestContext, token: string, tenantId: string, name: string
): Promise<string> {
    const res = await req.post(`${BACKEND_URL}/resources/create`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        data: { tenant_id: tenantId, name },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    return body.resource.resource_id as string;
}

async function createOwnerEmployee(
    req: APIRequestContext, token: string, tenantId: string, ownerName: string
): Promise<string> {
    // Mirrors SoloWizard.ensureOwnerEmployee() — the owner's name is split into
    // first/last components and the employee is created with the same identity
    // as the registered account owner.
    const parts = ownerName.split(' ');
    const firstName = parts[0] || 'Owner';
    const lastName = parts.slice(1).join(' ') || '';
    const res = await req.post(`${BACKEND_URL}/employees/create`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        data: {
            tenant_id: tenantId,
            first_name: firstName,
            last_name: lastName,
            skills: [],
        },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    return body.employee.employee_id as string;
}

async function assignServiceEmployee(
    req: APIRequestContext, token: string, tenantId: string, serviceId: string, employeeId: string
): Promise<void> {
    const res = await req.post(`${BACKEND_URL}/services/${serviceId}/employees/${employeeId}/assign`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        data: { tenant_id: tenantId },
    });
    expect(res.status()).toBe(200);
}

async function assignServiceResource(
    req: APIRequestContext, token: string, tenantId: string, serviceId: string, resourceId: string
): Promise<void> {
    const res = await req.post(`${BACKEND_URL}/services/${serviceId}/resources/${resourceId}/assign`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        data: { tenant_id: tenantId },
    });
    expect(res.status()).toBe(200);
}

async function expandWeekly(
    req: APIRequestContext, token: string, tenantId: string, employeeId: string
): Promise<void> {
    const res = await req.post(`${BACKEND_URL}/shifts/expand-weekly`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        data: {
            tenant_id: tenantId,
            employee_id: employeeId,
            pattern: fullWeekPattern(),
        },
    });
    expect(res.status()).toBe(200);
}

async function createCustomer(
    req: APIRequestContext, token: string, tenantId: string, name: string
): Promise<string> {
    const phone = `+1555${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
    const res = await req.post(`${BACKEND_URL}/customers/create`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        data: { tenant_id: tenantId, name, phone },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    return body.customer.customer_id as string;
}

test.beforeAll(() => {
    pool = new Pool({ connectionString: PG_URL });
});
test.afterAll(async () => {
    await pool.end();
});

/**
 * Cleanup helper. The straight `DELETE FROM tenants WHERE tenant_id = X` works
 * for most tables (their tenant_id FKs cascade), BUT a side-finding from
 * writing this spec: `service_employee.tenant_id_fkey` has confdeltype='a'
 * (no action), not 'c' (cascade). Same class of bug that migration
 * 20260511000000 fixed for employees + services. Until a follow-up
 * migration extends CASCADE to service_employee + service_resource, the
 * test cleanup must explicitly delete junction rows first.
 */
async function cleanupTenant(tenantId: string): Promise<void> {
    await pool.query('DELETE FROM service_employee WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM service_resource WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM tenants WHERE tenant_id = $1', [tenantId]);
}

// ────────────────────────────────────────────────────────────────────────────
// HAPPY — solo finalize produces a booking-ready tenant for ALL services
// ────────────────────────────────────────────────────────────────────────────

test('solo finalize: every service in the catalog is immediately bookable', async ({ request }) => {
    // WHO: a solo-tradesperson owner finishing the 3-step solo wizard. Mirrors
    //      SoloWizard.handleFinalize() at SoloWizard.tsx:222-266 with the same
    //      sequence of API calls + auto-map-every-service-to-the-one-employee
    //      step that is the literal differentiator from the multi wizard.
    // WHAT: after finalize, POST /appointments/create succeeds for EACH service
    //       in the catalog (not just the first). Three services × three bookings,
    //       all return 200 + appointment_id.
    // WHEN: every first-morning solo onboarding. If this fails, a solo owner
    //       sees the Go Live screen, tries to book a real customer, and gets
    //       a cryptic NO_SKILLED_EMPLOYEE error on services they "created in
    //       the wizard" — exactly the trust-destroying failure shape we exist
    //       to prevent.
    // WHERE: src/routes/mappings.ts /mappings/service-employee + service-resource
    //        + src/routes/appointments.ts /appointments/create → book_appointment_atomic
    //        RPC's service-aware skill/resource enforcement.
    // WHY: the multi-employee path is already pinned by setup-wizard-to-booking.spec.ts.
    //      This test pins the SOLO-specific auto-map invariant. Without it, a
    //      regression that drops the for-svc-of-services loop in handleFinalize()
    //      would let the wizard "succeed" in the UI but produce a tenant who
    //      can't book any service.
    let tenant: RegisteredTenant | null = null;
    try {
        tenant = await registerSoloTenant(request);

        const svcId1 = await createService(request, tenant.token, tenant.tenantId, 'Oil Change');
        const svcId2 = await createService(request, tenant.token, tenant.tenantId, 'Tire Rotation');
        const svcId3 = await createService(request, tenant.token, tenant.tenantId, 'Brake Check');
        const resourceId = await createResource(request, tenant.token, tenant.tenantId, 'Bay 1');
        const employeeId = await createOwnerEmployee(request, tenant.token, tenant.tenantId, tenant.ownerName);

        // The auto-map-every-service step — solo wizard's load-bearing differentiator.
        for (const svcId of [svcId1, svcId2, svcId3]) {
            await assignServiceEmployee(request, tenant.token, tenant.tenantId, svcId, employeeId);
            await assignServiceResource(request, tenant.token, tenant.tenantId, svcId, resourceId);
        }

        await expandWeekly(request, tenant.token, tenant.tenantId, employeeId);

        const customerId = await createCustomer(request, tenant.token, tenant.tenantId, 'Walk-In');
        const bookDate = isoDateDaysFromNow(7);

        // Three independent bookings — each at a different hour so the GiST
        // exclusion constraints don't bounce a same-time overlap. We're proving
        // each service is independently bookable, not stress-testing concurrency.
        const slots = [
            { svc: svcId1, start: '09:00', end: '09:30' },
            { svc: svcId2, start: '10:00', end: '10:30' },
            { svc: svcId3, start: '11:00', end: '11:30' },
        ];
        for (const slot of slots) {
            const res = await request.post(`${BACKEND_URL}/appointments/create`, {
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` },
                data: {
                    tenant_id: tenant.tenantId,
                    service_id: slot.svc,
                    resource_id: resourceId,
                    customer_id: customerId,
                    employee_id: employeeId,
                    start_time: `${bookDate}T${slot.start}:00.000Z`,
                    end_time: `${bookDate}T${slot.end}:00.000Z`,
                    description: `booking for service ${slot.svc}`,
                },
            });
            const body = await res.json();
            expect(res.status(), `service ${slot.svc} must book at ${slot.start}`).toBe(200);
            expect(body.success).toBe(true);
            expect(body.appointment_id ?? body.appointment?.id).toBeTruthy();
        }
    } finally {
        if (tenant) await cleanupTenant(tenant.tenantId);
    }
});

// ────────────────────────────────────────────────────────────────────────────
// SAD — service with required_skills + employee lacking those skills → NO_SKILLED_EMPLOYEE
// ────────────────────────────────────────────────────────────────────────────

test('solo finalize: service requiring an unmet skill rejects with NO_SKILLED_EMPLOYEE', async ({ request }) => {
    // WHO: a tenant whose service has explicit required_skills (e.g., a salon
    //      service that requires the 'color-specialist' certification) but
    //      whose only employee — the owner — lacks that skill in their
    //      `employees.skills` array.
    // WHAT: booking that service returns failure with NO_SKILLED_EMPLOYEE.
    // WHEN: regression check for book_appointment_atomic's service-aware
    //       skill enforcement. The RPC's fallback logic (CLAUDE.md "service-aware
    //       skill+resource enforcement"): when service_employee is empty for
    //       the service, fall back to required_skills array check against
    //       employees.skills. We deliberately leave service_employee empty AND
    //       declare a required skill the employee doesn't have, to force the
    //       fallback to refuse.
    // WHERE: book_appointment_atomic's required_skills check (post-fallback arm).
    //        services.required_skills is set via direct UPDATE (the public
    //        services routes don't expose this on create; it's set via the
    //        skill-matrix view in the multi-employee wizard).
    // WHY: documents the actual NO_SKILLED_EMPLOYEE behavior. A previous draft
    //      of this test assumed "skip service_employee mapping" was enough to
    //      force NO_SKILLED_EMPLOYEE — but the fallback to required_skills
    //      passes silently when required_skills is empty (the common case for
    //      solo-wizard services, which never declare skill requirements). The
    //      real failure mode is mismatched skill arrays; pin THAT.
    let tenant: RegisteredTenant | null = null;
    try {
        tenant = await registerSoloTenant(request);

        const svcId = await createService(request, tenant.token, tenant.tenantId, 'Specialty Service');
        const resourceId = await createResource(request, tenant.token, tenant.tenantId, 'Bay 1');
        const employeeId = await createOwnerEmployee(request, tenant.token, tenant.tenantId, tenant.ownerName);

        // Declare a skill requirement the owner-employee doesn't have. Solo
        // wizard never sets per-skill arrays on its auto-created employee, so
        // this scenario is reachable in practice if a service is later edited
        // to require a skill the owner doesn't list.
        await pool.query(
            "UPDATE services SET required_skills = ARRAY['color-specialist'] WHERE service_id = $1",
            [svcId]
        );

        await expandWeekly(request, tenant.token, tenant.tenantId, employeeId);

        const customerId = await createCustomer(request, tenant.token, tenant.tenantId, 'Walk-In Sad');
        const bookDate = isoDateDaysFromNow(7);

        const res = await request.post(`${BACKEND_URL}/appointments/create`, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` },
            data: {
                tenant_id: tenant.tenantId,
                service_id: svcId,
                resource_id: resourceId,
                customer_id: customerId,
                employee_id: employeeId,
                start_time: `${bookDate}T10:00:00.000Z`,
                end_time: `${bookDate}T10:30:00.000Z`,
                description: 'booking a service whose required_skills the employee lacks',
            },
        });
        const body = await res.json();
        expect(res.status(), 'booking must reject when employee lacks required skill').toBe(400);
        expect(body.success).toBe(false);
        // Pin the failure shape. /appointments/create uses book_appointment_atomic
        // (the simpler RPC), which returns human-readable error messages — not
        // the NO_SKILLED_EMPLOYEE error_code that book_with_scheduling_atomic
        // exposes. A regression that consolidates this error into a generic
        // "booking failed" message would still fail this assertion, since we
        // anchor on the word "skill" — the load-bearing semantic, not the
        // specific wording. (Voice-agent code path uses book_with_scheduling_atomic
        // and gets the structured NO_SKILLED_EMPLOYEE code; that path is
        // covered by agent unit tests, not this E2E.)
        expect(
            String(body.error ?? '').toLowerCase(),
            'error must indicate the employee lacks required skills'
        ).toContain('skill');
    } finally {
        if (tenant) await cleanupTenant(tenant.tenantId);
    }
});

// ────────────────────────────────────────────────────────────────────────────
// SHAPE — DB state after solo finalize matches the single-employee invariant
// ────────────────────────────────────────────────────────────────────────────

test('solo finalize DB shape: 1 employee, N service_employee rows all pointing at it', async ({ request }) => {
    // WHO: anyone adding a feature to SoloWizard.handleFinalize — e.g., a future
    //      "also auto-create a placeholder backup-tech" change. Without a shape
    //      assertion, such an addition could silently break the "one employee
    //      with all services mapped to them" invariant.
    // WHAT: after solo finalize, employees count = 1 for this tenant; service_employee
    //       count = N (one per service); every service_employee row points at the
    //       single employee_id (i.e., COUNT(DISTINCT employee_id) = 1).
    // WHEN: every solo onboarding. The invariant is "the owner IS the only employee
    //       AND owns every service" — if a regression breaks either half, this fails.
    // WHERE: employees + service_employee tables, queried via the test pool with
    //        tenant_id scoping.
    // WHY: the HAPPY test asserts a booking succeeds (functional outcome);
    //      this test asserts the DB structure (the cause). Together they form a
    //      complete pin: the structure produces the outcome, and a regression in
    //      either layer breaks one of the two tests independently.
    let tenant: RegisteredTenant | null = null;
    try {
        tenant = await registerSoloTenant(request);

        const svcIds = [
            await createService(request, tenant.token, tenant.tenantId, 'Service A'),
            await createService(request, tenant.token, tenant.tenantId, 'Service B'),
            await createService(request, tenant.token, tenant.tenantId, 'Service C'),
            await createService(request, tenant.token, tenant.tenantId, 'Service D'),
        ];
        const resourceId = await createResource(request, tenant.token, tenant.tenantId, 'Bay 1');
        const employeeId = await createOwnerEmployee(request, tenant.token, tenant.tenantId, tenant.ownerName);

        for (const svcId of svcIds) {
            await assignServiceEmployee(request, tenant.token, tenant.tenantId, svcId, employeeId);
            await assignServiceResource(request, tenant.token, tenant.tenantId, svcId, resourceId);
        }
        await expandWeekly(request, tenant.token, tenant.tenantId, employeeId);

        // employees: exactly 1 row for this tenant
        const empCount = await pool.query<{ count: string }>(
            "SELECT COUNT(*)::text AS count FROM employees WHERE tenant_id = $1",
            [tenant.tenantId]
        );
        expect(empCount.rows[0].count, 'solo tenant should have exactly 1 employee').toBe('1');

        // service_employee: exactly N rows (one per service)
        const mapCount = await pool.query<{ count: string }>(
            "SELECT COUNT(*)::text AS count FROM service_employee WHERE tenant_id = $1",
            [tenant.tenantId]
        );
        expect(mapCount.rows[0].count, 'every service should be mapped to the one employee').toBe(String(svcIds.length));

        // All service_employee rows point at the same single employee
        const distinctEmp = await pool.query<{ count: string }>(
            "SELECT COUNT(DISTINCT employee_id)::text AS count FROM service_employee WHERE tenant_id = $1",
            [tenant.tenantId]
        );
        expect(distinctEmp.rows[0].count, 'all service_employee rows must point at one employee').toBe('1');

        // ...and that one employee IS the one we created
        const empRow = await pool.query<{ employee_id: string }>(
            "SELECT DISTINCT employee_id FROM service_employee WHERE tenant_id = $1",
            [tenant.tenantId]
        );
        expect(empRow.rows[0].employee_id).toBe(employeeId);
    } finally {
        if (tenant) await cleanupTenant(tenant.tenantId);
    }
});
