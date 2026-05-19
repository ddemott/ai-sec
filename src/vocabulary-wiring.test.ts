import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, createTenant, createEmployee, createResource, createService, beginTestTransaction, rollbackTestTransaction, skipIfDbDown } from "./test-utils";
import { type Client } from "pg";

describe("Vocabulary Wiring: End-to-End", () => {
    let client: Client;
    let tenantId: string;
    let dbAvailable = true;
    beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

    beforeAll(async () => {
        try {
            client = await getRootClient();
            await clearDB(client);
            const setup = await setupBasicTenant(client);
            tenantId = setup.tenantId;
        } catch (err) {
            dbAvailable = false;
            console.warn("[vocabulary-wiring.test] Skipping - DB connection failed", err);
        }
    });

    afterAll(async () => {
        if (dbAvailable && client) await client.end();
    });

    beforeEach(async () => {
        if (!dbAvailable) return;
        await beginTestTransaction(client);
    });

    afterEach(async () => {
        if (!dbAvailable) return;
        await rollbackTestTransaction(client);
    });

    describe("Vocabulary resolves per business type", () => {
        it("should return tire shop vocabulary for mobile-tire tenant", async () => {
            if (!dbAvailable) return;
            // setupBasicTenant creates a 'mobile-tire' tenant
            const res = await client.query(`
                SELECT
                    COALESCE(t.resource_label, bt.resource_label, 'Resource') AS resource_label,
                    COALESCE(t.resource_plural, bt.resource_plural, 'Resources') AS resource_plural,
                    COALESCE(t.employee_label, bt.employee_label, 'Employee') AS employee_label,
                    COALESCE(t.employee_plural, bt.employee_plural, 'Employees') AS employee_plural,
                    COALESCE(t.booking_label, bt.booking_label, 'Appointment') AS booking_label
                FROM tenants t
                LEFT JOIN business_templates bt ON bt.business_type = t.business_type
                WHERE t.tenant_id = $1
            `, [tenantId]);

            expect(res.rows[0].resource_label).toBe('Truck');
            expect(res.rows[0].resource_plural).toBe('Trucks');
            expect(res.rows[0].employee_label).toBe('Technician');
            expect(res.rows[0].employee_plural).toBe('Technicians');
            expect(res.rows[0].booking_label).toBe('Appointment');
        });

        it("should return salon vocabulary for salon tenant", async () => {
            if (!dbAvailable) return;
            const salonId = await createTenant(client, "Test Salon", "salon");

            const res = await client.query(`
                SELECT
                    COALESCE(t.resource_label, bt.resource_label, 'Resource') AS resource_label,
                    COALESCE(t.resource_plural, bt.resource_plural, 'Resources') AS resource_plural,
                    COALESCE(t.employee_label, bt.employee_label, 'Employee') AS employee_label,
                    COALESCE(t.employee_plural, bt.employee_plural, 'Employees') AS employee_plural
                FROM tenants t
                LEFT JOIN business_templates bt ON bt.business_type = t.business_type
                WHERE t.tenant_id = $1
            `, [salonId]);

            expect(res.rows[0].resource_label).toBe('Chair');
            expect(res.rows[0].resource_plural).toBe('Chairs');
            expect(res.rows[0].employee_label).toBe('Stylist');
            expect(res.rows[0].employee_plural).toBe('Stylists');
        });

        it("should return auto shop vocabulary for auto-shop tenant", async () => {
            if (!dbAvailable) return;
            const shopId = await createTenant(client, "Test Auto", "auto-shop");

            const res = await client.query(`
                SELECT
                    COALESCE(t.resource_label, bt.resource_label, 'Resource') AS resource_label,
                    COALESCE(t.employee_label, bt.employee_label, 'Employee') AS employee_label
                FROM tenants t
                LEFT JOIN business_templates bt ON bt.business_type = t.business_type
                WHERE t.tenant_id = $1
            `, [shopId]);

            expect(res.rows[0].resource_label).toBe('Bay');
            expect(res.rows[0].employee_label).toBe('Mechanic');
        });
    });

    describe("Tenant overrides take priority", () => {
        it("should use tenant override when set", async () => {
            if (!dbAvailable) return;
            const shopId = await createTenant(client, "Custom Shop", "auto-shop");

            // Set a tenant-level override
            await client.query(
                "UPDATE tenants SET resource_label = 'Stall', resource_plural = 'Stalls' WHERE tenant_id = $1",
                [shopId]
            );

            const res = await client.query(`
                SELECT
                    COALESCE(t.resource_label, bt.resource_label, 'Resource') AS resource_label,
                    COALESCE(t.resource_plural, bt.resource_plural, 'Resources') AS resource_plural,
                    COALESCE(t.employee_label, bt.employee_label, 'Employee') AS employee_label
                FROM tenants t
                LEFT JOIN business_templates bt ON bt.business_type = t.business_type
                WHERE t.tenant_id = $1
            `, [shopId]);

            // Overridden fields use tenant value
            expect(res.rows[0].resource_label).toBe('Stall');
            expect(res.rows[0].resource_plural).toBe('Stalls');
            // Non-overridden fields fall back to template
            expect(res.rows[0].employee_label).toBe('Mechanic');
        });

        it("should fall back to hardcoded defaults for unknown business type", async () => {
            if (!dbAvailable) return;
            const unknownId = await createTenant(client, "Mystery Biz", "unknown-type-xyz");

            const res = await client.query(`
                SELECT
                    COALESCE(t.resource_label, bt.resource_label, 'Resource') AS resource_label,
                    COALESCE(t.resource_plural, bt.resource_plural, 'Resources') AS resource_plural,
                    COALESCE(t.employee_label, bt.employee_label, 'Employee') AS employee_label,
                    COALESCE(t.employee_plural, bt.employee_plural, 'Employees') AS employee_plural,
                    COALESCE(t.booking_label, bt.booking_label, 'Appointment') AS booking_label
                FROM tenants t
                LEFT JOIN business_templates bt ON bt.business_type = t.business_type
                WHERE t.tenant_id = $1
            `, [unknownId]);

            expect(res.rows[0].resource_label).toBe('Resource');
            expect(res.rows[0].resource_plural).toBe('Resources');
            expect(res.rows[0].employee_label).toBe('Employee');
            expect(res.rows[0].employee_plural).toBe('Employees');
            expect(res.rows[0].booking_label).toBe('Appointment');
        });
    });

    describe("Vocabulary applies to all business types", () => {
        const BUSINESS_TYPES = [
            { type: 'plumber', resource: 'Van', employee: 'Plumber' },
            { type: 'electrician', resource: 'Van', employee: 'Electrician' },
            { type: 'barbershop', resource: 'Chair', employee: 'Barber' },
            { type: 'spa', resource: 'Treatment Room', employee: 'Therapist' },
            { type: 'car-detailing', resource: 'Detail Bay', employee: 'Detailer' },
            { type: 'photography', resource: 'Studio', employee: 'Photographer' },
        ];

        for (const bt of BUSINESS_TYPES) {
            it(`should resolve vocabulary for ${bt.type}`, async () => {
                if (!dbAvailable) return;
                const tid = await createTenant(client, `Test ${bt.type}`, bt.type);

                const res = await client.query(`
                    SELECT
                        COALESCE(t.resource_label, bt.resource_label, 'Resource') AS resource_label,
                        COALESCE(t.employee_label, bt.employee_label, 'Employee') AS employee_label
                    FROM tenants t
                    LEFT JOIN business_templates bt ON bt.business_type = t.business_type
                    WHERE t.tenant_id = $1
                `, [tid]);

                expect(res.rows[0].resource_label).toBe(bt.resource);
                expect(res.rows[0].employee_label).toBe(bt.employee);
            });
        }
    });

    describe("GET /vocabulary endpoint query", () => {
        it("should return complete vocabulary object shape", async () => {
            if (!dbAvailable) return;

            const res = await client.query(`
                SELECT
                    COALESCE(t.resource_label, bt.resource_label, 'Resource') AS resource_label,
                    COALESCE(t.resource_plural, bt.resource_plural, 'Resources') AS resource_plural,
                    COALESCE(t.employee_label, bt.employee_label, 'Employee') AS employee_label,
                    COALESCE(t.employee_plural, bt.employee_plural, 'Employees') AS employee_plural,
                    COALESCE(t.booking_label, bt.booking_label, 'Appointment') AS booking_label
                FROM tenants t
                LEFT JOIN business_templates bt ON bt.business_type = t.business_type
                WHERE t.tenant_id = $1
            `, [tenantId]);

            const vocab = res.rows[0];
            // All 5 fields present and non-empty
            expect(vocab.resource_label).toBeTruthy();
            expect(vocab.resource_plural).toBeTruthy();
            expect(vocab.employee_label).toBeTruthy();
            expect(vocab.employee_plural).toBeTruthy();
            expect(vocab.booking_label).toBeTruthy();

            // Types are strings
            expect(typeof vocab.resource_label).toBe('string');
            expect(typeof vocab.resource_plural).toBe('string');
            expect(typeof vocab.employee_label).toBe('string');
            expect(typeof vocab.employee_plural).toBe('string');
            expect(typeof vocab.booking_label).toBe('string');
        });
    });
});
