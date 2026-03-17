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
});
