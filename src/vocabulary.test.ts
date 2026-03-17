import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant } from "./test-utils";
import { Client } from "pg";

describe("Business Vocabulary System", () => {
    let client: Client;
    let tenantId: string;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            client = await getRootClient();
        } catch (err) {
            dbAvailable = false;
            console.warn("[vocabulary.test] Skipping DB tests - connection failed", err);
        }
    });

    afterAll(async () => {
        if (dbAvailable && client) {
            await client.end();
        }
    });

    beforeEach(async () => {
        if (!dbAvailable) return;
        await clearDB(client);
        const setup = await setupBasicTenant(client);
        tenantId = setup.tenantId;
    });

    describe("business_templates vocabulary columns", () => {
        it("should have vocabulary columns on business_templates", async () => {
            if (!dbAvailable) return;
            const res = await client.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'business_templates'
                AND column_name IN ('resource_label', 'resource_plural', 'employee_label', 'employee_plural', 'booking_label', 'example_services')
                ORDER BY column_name
            `);
            expect(res.rows.map(r => r.column_name)).toEqual([
                'booking_label',
                'employee_label',
                'employee_plural',
                'example_services',
                'resource_label',
                'resource_plural',
            ]);
        });

        it("should have vocabulary populated for mobile-tire template", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT resource_label, resource_plural, employee_label, employee_plural, booking_label FROM business_templates WHERE business_type = 'mobile-tire'"
            );
            expect(res.rows[0]).toEqual({
                resource_label: 'Truck',
                resource_plural: 'Trucks',
                employee_label: 'Technician',
                employee_plural: 'Technicians',
                booking_label: 'Appointment',
            });
        });

        it("should have vocabulary populated for salon template", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT resource_label, resource_plural, employee_label, employee_plural, booking_label FROM business_templates WHERE business_type = 'salon'"
            );
            expect(res.rows[0]).toEqual({
                resource_label: 'Chair',
                resource_plural: 'Chairs',
                employee_label: 'Stylist',
                employee_plural: 'Stylists',
                booking_label: 'Appointment',
            });
        });

        it("should have vocabulary populated for auto-shop template", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT resource_label, resource_plural, employee_label, employee_plural, booking_label FROM business_templates WHERE business_type = 'auto-shop'"
            );
            expect(res.rows[0]).toEqual({
                resource_label: 'Bay',
                resource_plural: 'Bays',
                employee_label: 'Mechanic',
                employee_plural: 'Mechanics',
                booking_label: 'Appointment',
            });
        });

        it("should have vocabulary populated for dentist template", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT resource_label, resource_plural, employee_label, employee_plural, booking_label FROM business_templates WHERE business_type = 'dentist'"
            );
            expect(res.rows[0]).toEqual({
                resource_label: 'Operatory',
                resource_plural: 'Operatories',
                employee_label: 'Hygienist',
                employee_plural: 'Hygienists',
                booking_label: 'Visit',
            });
        });

        it("should have default fallback values for columns", async () => {
            if (!dbAvailable) return;
            // Insert a template with no vocabulary specified
            await client.query(`
                INSERT INTO business_templates (business_type, display_name, system_prompt_template, first_message, default_resource_name)
                VALUES ('test-type', 'Test', 'prompt', 'hello', 'Room 1')
                ON CONFLICT (business_type) DO UPDATE SET display_name = 'Test',
                    resource_label = DEFAULT, resource_plural = DEFAULT,
                    employee_label = DEFAULT, employee_plural = DEFAULT,
                    booking_label = DEFAULT
            `);
            const res = await client.query(
                "SELECT resource_label, resource_plural, employee_label, employee_plural, booking_label FROM business_templates WHERE business_type = 'test-type'"
            );
            expect(res.rows[0]).toEqual({
                resource_label: 'Resource',
                resource_plural: 'Resources',
                employee_label: 'Employee',
                employee_plural: 'Employees',
                booking_label: 'Appointment',
            });
        });
    });

    describe("all 20 business type templates", () => {
        const EXPECTED_TYPES = [
            'mobile-tire', 'salon', 'auto-shop', 'dentist',
            'vet-clinic', 'chiropractor', 'barbershop', 'nail-salon',
            'spa', 'plumber', 'electrician', 'hvac',
            'pest-control', 'cleaning', 'landscaping', 'personal-trainer',
            'yoga-studio', 'tax-prep', 'tutoring', 'photography',
        ];

        it("should have all 20 business type templates", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT business_type FROM business_templates ORDER BY business_type"
            );
            const types = res.rows.map(r => r.business_type);
            for (const t of EXPECTED_TYPES) {
                expect(types).toContain(t);
            }
            expect(types.length).toBeGreaterThanOrEqual(20);
        });

        it("should have non-empty vocabulary on all 20 templates", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT business_type, resource_label, employee_label, booking_label FROM business_templates WHERE business_type = ANY($1)",
                [EXPECTED_TYPES]
            );
            expect(res.rows.length).toBe(20);
            for (const row of res.rows) {
                expect(row.resource_label).toBeTruthy();
                expect(row.employee_label).toBeTruthy();
                expect(row.booking_label).toBeTruthy();
            }
        });

        it("should have example_services populated on all 20 templates", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT business_type, example_services FROM business_templates WHERE business_type = ANY($1)",
                [EXPECTED_TYPES]
            );
            for (const row of res.rows) {
                expect(row.example_services.length).toBeGreaterThanOrEqual(3);
            }
        });

        it("should have system_prompt_template with business_name placeholder on all templates", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT business_type, system_prompt_template FROM business_templates WHERE business_type = ANY($1)",
                [EXPECTED_TYPES]
            );
            for (const row of res.rows) {
                expect(row.system_prompt_template).toContain('{{business_name}}');
            }
        });
    });

    describe("vocabulary resolution query", () => {
        it("should resolve vocabulary for a tenant with template but no overrides", async () => {
            if (!dbAvailable) return;
            // Create a salon tenant
            const tRes = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Test Salon', 'salon') RETURNING id"
            );
            const salonId = tRes.rows[0].id;

            const res = await client.query(`
                SELECT
                    COALESCE(t.resource_label, bt.resource_label, 'Resource') AS resource_label,
                    COALESCE(t.resource_plural, bt.resource_plural, 'Resources') AS resource_plural,
                    COALESCE(t.employee_label, bt.employee_label, 'Employee') AS employee_label,
                    COALESCE(t.employee_plural, bt.employee_plural, 'Employees') AS employee_plural,
                    COALESCE(t.booking_label, bt.booking_label, 'Appointment') AS booking_label
                FROM tenants t
                LEFT JOIN business_templates bt ON bt.business_type = t.business_type
                WHERE t.id = $1
            `, [salonId]);

            expect(res.rows[0]).toEqual({
                resource_label: 'Chair',
                resource_plural: 'Chairs',
                employee_label: 'Stylist',
                employee_plural: 'Stylists',
                booking_label: 'Appointment',
            });
        });
    });

    describe("tenants vocabulary override columns", () => {
        it("should have vocabulary override columns on tenants", async () => {
            if (!dbAvailable) return;
            const res = await client.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'tenants'
                AND column_name IN ('resource_label', 'resource_plural', 'employee_label', 'employee_plural', 'booking_label')
                ORDER BY column_name
            `);
            expect(res.rows.map(r => r.column_name)).toEqual([
                'booking_label',
                'employee_label',
                'employee_plural',
                'resource_label',
                'resource_plural',
            ]);
        });

        it("should default tenant vocabulary overrides to NULL", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT resource_label, resource_plural, employee_label, employee_plural, booking_label FROM tenants WHERE id = $1",
                [tenantId]
            );
            expect(res.rows[0].resource_label).toBeNull();
            expect(res.rows[0].resource_plural).toBeNull();
            expect(res.rows[0].employee_label).toBeNull();
            expect(res.rows[0].employee_plural).toBeNull();
            expect(res.rows[0].booking_label).toBeNull();
        });

        it("should allow tenant to override vocabulary", async () => {
            if (!dbAvailable) return;
            await client.query(
                "UPDATE tenants SET resource_label = 'Stall', resource_plural = 'Stalls' WHERE id = $1",
                [tenantId]
            );
            const res = await client.query(
                "SELECT resource_label, resource_plural FROM tenants WHERE id = $1",
                [tenantId]
            );
            expect(res.rows[0].resource_label).toBe('Stall');
            expect(res.rows[0].resource_plural).toBe('Stalls');
        });

        it("should resolve vocabulary with 3-tier fallback (tenant > template > hardcoded)", async () => {
            if (!dbAvailable) return;

            // Create a tenant with business_type = 'auto-shop' and partial override
            const tRes = await client.query(
                "INSERT INTO tenants (name, business_type, resource_label, resource_plural) VALUES ('Test Shop', 'auto-shop', 'Stall', 'Stalls') RETURNING id"
            );
            const shopId = tRes.rows[0].id;

            // 3-tier COALESCE query
            const res = await client.query(`
                SELECT
                    COALESCE(t.resource_label, bt.resource_label, 'Resource') AS resource_label,
                    COALESCE(t.resource_plural, bt.resource_plural, 'Resources') AS resource_plural,
                    COALESCE(t.employee_label, bt.employee_label, 'Employee') AS employee_label,
                    COALESCE(t.employee_plural, bt.employee_plural, 'Employees') AS employee_plural,
                    COALESCE(t.booking_label, bt.booking_label, 'Appointment') AS booking_label
                FROM tenants t
                LEFT JOIN business_templates bt ON bt.business_type = t.business_type
                WHERE t.id = $1
            `, [shopId]);

            // resource_label/plural come from tenant override (Stall/Stalls)
            expect(res.rows[0].resource_label).toBe('Stall');
            expect(res.rows[0].resource_plural).toBe('Stalls');
            // employee_label/plural fall through to template default (Mechanic/Mechanics)
            expect(res.rows[0].employee_label).toBe('Mechanic');
            expect(res.rows[0].employee_plural).toBe('Mechanics');
            // booking_label falls through to template default (Appointment)
            expect(res.rows[0].booking_label).toBe('Appointment');
        });

        it("should fall back to hardcoded when no template exists", async () => {
            if (!dbAvailable) return;

            // Tenant with unknown business_type (no matching template)
            const tRes = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Mystery Biz', 'unknown-type') RETURNING id"
            );
            const bizId = tRes.rows[0].id;

            const res = await client.query(`
                SELECT
                    COALESCE(t.resource_label, bt.resource_label, 'Resource') AS resource_label,
                    COALESCE(t.resource_plural, bt.resource_plural, 'Resources') AS resource_plural,
                    COALESCE(t.employee_label, bt.employee_label, 'Employee') AS employee_label,
                    COALESCE(t.employee_plural, bt.employee_plural, 'Employees') AS employee_plural,
                    COALESCE(t.booking_label, bt.booking_label, 'Appointment') AS booking_label
                FROM tenants t
                LEFT JOIN business_templates bt ON bt.business_type = t.business_type
                WHERE t.id = $1
            `, [bizId]);

            expect(res.rows[0].resource_label).toBe('Resource');
            expect(res.rows[0].resource_plural).toBe('Resources');
            expect(res.rows[0].employee_label).toBe('Employee');
            expect(res.rows[0].employee_plural).toBe('Employees');
            expect(res.rows[0].booking_label).toBe('Appointment');
        });
    });
});
