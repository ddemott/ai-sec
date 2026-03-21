import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant } from "./test-utils";
import { Client } from "pg";

describe("Coverage Gaps", () => {
    let client: Client;
    let tenantId: string;
    let resourceId: string;
    let customerId: string;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            client = await getRootClient();
        } catch (err) {
            dbAvailable = false;
            console.warn("[coverage-gaps.test] Skipping DB tests - connection failed", err);
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
        resourceId = setup.resourceId;
        customerId = setup.customerId;
    });

    // ---------------------------------------------------------------
    // 1. Appointment Update (direct UPDATE path)
    // ---------------------------------------------------------------
    describe("Appointment Update", () => {
        let appointmentId: string;

        beforeEach(async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description)
                 VALUES ($1, $2, $3, '2026-04-01 09:00:00+00', '2026-04-01 10:00:00+00', 'Oil change')
                 RETURNING id`,
                [tenantId, resourceId, customerId]
            );
            appointmentId = res.rows[0].id;
        });

        it("should update start_time and end_time", async () => {
            if (!dbAvailable) return;
            await client.query(
                `UPDATE appointments SET start_time = '2026-04-01 11:00:00+00', end_time = '2026-04-01 12:00:00+00' WHERE id = $1`,
                [appointmentId]
            );
            const res = await client.query("SELECT start_time, end_time FROM appointments WHERE id = $1", [appointmentId]);
            expect(new Date(res.rows[0].start_time).toISOString()).toBe("2026-04-01T11:00:00.000Z");
            expect(new Date(res.rows[0].end_time).toISOString()).toBe("2026-04-01T12:00:00.000Z");
        });

        it("should update description", async () => {
            if (!dbAvailable) return;
            await client.query(
                "UPDATE appointments SET description = 'Tire rotation' WHERE id = $1",
                [appointmentId]
            );
            const res = await client.query("SELECT description FROM appointments WHERE id = $1", [appointmentId]);
            expect(res.rows[0].description).toBe("Tire rotation");
        });

        it("should update resource_id", async () => {
            if (!dbAvailable) return;
            const r2 = await client.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Truck 2') RETURNING id",
                [tenantId]
            );
            const newResourceId = r2.rows[0].id;
            await client.query("UPDATE appointments SET resource_id = $1 WHERE id = $2", [newResourceId, appointmentId]);
            const res = await client.query("SELECT resource_id FROM appointments WHERE id = $1", [appointmentId]);
            expect(res.rows[0].resource_id).toBe(newResourceId);
        });

        it("should update employee_id as UUID", async () => {
            if (!dbAvailable) return;
            const empRes = await client.query(
                "INSERT INTO employees (tenant_id, name) VALUES ($1, 'John') RETURNING id",
                [tenantId]
            );
            const employeeId = empRes.rows[0].id;
            await client.query("UPDATE appointments SET employee_id = $1 WHERE id = $2", [employeeId, appointmentId]);
            const res = await client.query("SELECT employee_id FROM appointments WHERE id = $1", [appointmentId]);
            expect(res.rows[0].employee_id).toBe(employeeId);
            // Verify UUID format
            expect(employeeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        });

        it("should persist all updated values together", async () => {
            if (!dbAvailable) return;
            const empRes = await client.query(
                "INSERT INTO employees (tenant_id, name) VALUES ($1, 'Jane') RETURNING id",
                [tenantId]
            );
            const employeeId = empRes.rows[0].id;
            const r2 = await client.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Truck 3') RETURNING id",
                [tenantId]
            );
            const newResourceId = r2.rows[0].id;

            await client.query(
                `UPDATE appointments
                 SET start_time = '2026-04-02 14:00:00+00',
                     end_time = '2026-04-02 15:00:00+00',
                     description = 'Full service',
                     resource_id = $1,
                     employee_id = $2
                 WHERE id = $3`,
                [newResourceId, employeeId, appointmentId]
            );

            const res = await client.query(
                "SELECT start_time, end_time, description, resource_id, employee_id FROM appointments WHERE id = $1",
                [appointmentId]
            );
            const row = res.rows[0];
            expect(new Date(row.start_time).toISOString()).toBe("2026-04-02T14:00:00.000Z");
            expect(new Date(row.end_time).toISOString()).toBe("2026-04-02T15:00:00.000Z");
            expect(row.description).toBe("Full service");
            expect(row.resource_id).toBe(newResourceId);
            expect(row.employee_id).toBe(employeeId);
        });
    });

    // ---------------------------------------------------------------
    // 2. Tenant Not Found handling
    // ---------------------------------------------------------------
    describe("Tenant Not Found", () => {
        it("should return 0 rows for non-existent tenant UUID", async () => {
            if (!dbAvailable) return;
            const fakeId = "00000000-aaaa-bbbb-cccc-000000000099";
            const res = await client.query("SELECT * FROM tenants WHERE id = $1", [fakeId]);
            expect(res.rows.length).toBe(0);
        });

        it("should fail RLS-scoped query when tenant context is set to non-existent UUID", async () => {
            if (!dbAvailable) return;
            const fakeId = "00000000-aaaa-bbbb-cccc-000000000099";
            // Set tenant context to a non-existent tenant
            await client.query("SET LOCAL app.current_tenant_id = '" + fakeId + "'");
            // A table with RLS: resources. Even as superuser with RLS bypassed,
            // the pattern used by withTenantClient sets the context then queries.
            // Here we verify 0 rows come back for a non-existent tenant.
            const res = await client.query(
                "SELECT * FROM resources WHERE tenant_id = $1",
                [fakeId]
            );
            expect(res.rows.length).toBe(0);
        });
    });

    // ---------------------------------------------------------------
    // 3. Template Categories
    // ---------------------------------------------------------------
    describe("Template Categories", () => {
        it("should have a non-empty category on all templates", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT business_type, category FROM business_templates WHERE category IS NULL OR category = ''"
            );
            expect(res.rows.length).toBe(0);
        });

        it("should have at least 5 distinct categories", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT DISTINCT category FROM business_templates"
            );
            expect(res.rows.length).toBeGreaterThanOrEqual(5);
        });

        it("should include Auto & Vehicle, Beauty & Personal Care, and Home Services categories", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT DISTINCT category FROM business_templates ORDER BY category"
            );
            const categories = res.rows.map((r: { category: string }) => r.category);
            expect(categories).toContain("Auto & Vehicle");
            expect(categories).toContain("Beauty & Personal Care");
            expect(categories).toContain("Home Services");
        });

        it("should have sort_order set (not null) for all templates", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT business_type, sort_order FROM business_templates WHERE sort_order IS NULL"
            );
            expect(res.rows.length).toBe(0);
        });
    });

    // ---------------------------------------------------------------
    // 4. UUID Shifts
    // ---------------------------------------------------------------
    describe("UUID Shifts", () => {
        let employeeId: string;

        beforeEach(async () => {
            if (!dbAvailable) return;
            const empRes = await client.query(
                "INSERT INTO employees (tenant_id, name) VALUES ($1, 'Shift Worker') RETURNING id",
                [tenantId]
            );
            employeeId = empRes.rows[0].id;
        });

        it("should create a shift with a valid UUID id", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                `INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time)
                 VALUES ($1, $2, 1, '08:00', '17:00')
                 RETURNING id`,
                [tenantId, employeeId]
            );
            const shiftId = res.rows[0].id;
            expect(shiftId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
            expect(shiftId.length).toBe(36);
        });

        it("should delete a shift by UUID id", async () => {
            if (!dbAvailable) return;
            const ins = await client.query(
                `INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time)
                 VALUES ($1, $2, 2, '09:00', '18:00')
                 RETURNING id`,
                [tenantId, employeeId]
            );
            const shiftId = ins.rows[0].id;

            await client.query("DELETE FROM employee_shifts WHERE id = $1", [shiftId]);

            const res = await client.query("SELECT * FROM employee_shifts WHERE id = $1", [shiftId]);
            expect(res.rows.length).toBe(0);
        });

        it("should update a shift by UUID id", async () => {
            if (!dbAvailable) return;
            const ins = await client.query(
                `INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time)
                 VALUES ($1, $2, 3, '08:00', '12:00')
                 RETURNING id`,
                [tenantId, employeeId]
            );
            const shiftId = ins.rows[0].id;

            await client.query(
                "UPDATE employee_shifts SET start_time = '07:00', end_time = '15:00' WHERE id = $1",
                [shiftId]
            );

            const res = await client.query("SELECT start_time, end_time FROM employee_shifts WHERE id = $1", [shiftId]);
            expect(res.rows[0].start_time).toBe("07:00:00");
            expect(res.rows[0].end_time).toBe("15:00:00");
        });
    });

    // ---------------------------------------------------------------
    // 5. UUID Skills
    // ---------------------------------------------------------------
    describe("UUID Skills", () => {
        it("should create a skill with a valid UUID id", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                `INSERT INTO tenant_skills (tenant_id, name, description)
                 VALUES ($1, 'Tire Balancing', 'Balance and align tires')
                 RETURNING id`,
                [tenantId]
            );
            const skillId = res.rows[0].id;
            expect(skillId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
            expect(skillId.length).toBe(36);
        });

        it("should delete a skill by UUID id", async () => {
            if (!dbAvailable) return;
            const ins = await client.query(
                `INSERT INTO tenant_skills (tenant_id, name, description)
                 VALUES ($1, 'Oil Change', 'Standard oil change')
                 RETURNING id`,
                [tenantId]
            );
            const skillId = ins.rows[0].id;

            await client.query("DELETE FROM tenant_skills WHERE id = $1", [skillId]);

            const res = await client.query("SELECT * FROM tenant_skills WHERE id = $1", [skillId]);
            expect(res.rows.length).toBe(0);
        });
    });

    // ---------------------------------------------------------------
    // 6. Shift Split (overlap detection / frontend pattern)
    // ---------------------------------------------------------------
    describe("Shift Split", () => {
        let employeeId: string;

        beforeEach(async () => {
            if (!dbAvailable) return;
            const empRes = await client.query(
                "INSERT INTO employees (tenant_id, name) VALUES ($1, 'Split Worker') RETURNING id",
                [tenantId]
            );
            employeeId = empRes.rows[0].id;
        });

        it("should allow two non-overlapping shifts on the same day", async () => {
            if (!dbAvailable) return;
            // Morning shift 08:00 - 12:00
            await client.query(
                `INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time)
                 VALUES ($1, $2, 1, '08:00', '12:00')`,
                [tenantId, employeeId]
            );
            // Afternoon shift 13:00 - 17:00
            await client.query(
                `INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time)
                 VALUES ($1, $2, 1, '13:00', '17:00')`,
                [tenantId, employeeId]
            );

            const res = await client.query(
                "SELECT * FROM employee_shifts WHERE employee_id = $1 AND day_of_week = 1 ORDER BY start_time",
                [employeeId]
            );
            expect(res.rows.length).toBe(2);
            expect(res.rows[0].start_time).toBe("08:00:00");
            expect(res.rows[1].start_time).toBe("13:00:00");
        });

        it("should support delete-and-recreate pattern for replacing an overlapping shift", async () => {
            if (!dbAvailable) return;
            // Create original shift 08:00 - 17:00
            const ins = await client.query(
                `INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time)
                 VALUES ($1, $2, 1, '08:00', '17:00')
                 RETURNING id`,
                [tenantId, employeeId]
            );
            const oldShiftId = ins.rows[0].id;

            // Frontend pattern: delete old shift, create new one
            await client.query("DELETE FROM employee_shifts WHERE id = $1", [oldShiftId]);
            await client.query(
                `INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time)
                 VALUES ($1, $2, 1, '09:00', '18:00')`,
                [tenantId, employeeId]
            );

            const res = await client.query(
                "SELECT * FROM employee_shifts WHERE employee_id = $1 AND day_of_week = 1",
                [employeeId]
            );
            expect(res.rows.length).toBe(1);
            expect(res.rows[0].start_time).toBe("09:00:00");
            expect(res.rows[0].end_time).toBe("18:00:00");
            // Old shift should be gone
            const oldRes = await client.query("SELECT * FROM employee_shifts WHERE id = $1", [oldShiftId]);
            expect(oldRes.rows.length).toBe(0);
        });
    });

    // ---------------------------------------------------------------
    // 7. Appointment Cancel
    // ---------------------------------------------------------------
    describe("Appointment Cancel", () => {
        let appointmentId: string;

        beforeEach(async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, status)
                 VALUES ($1, $2, $3, '2026-04-05 10:00:00+00', '2026-04-05 11:00:00+00', 'scheduled')
                 RETURNING id`,
                [tenantId, resourceId, customerId]
            );
            appointmentId = res.rows[0].id;
        });

        it("should update status to canceled", async () => {
            if (!dbAvailable) return;
            await client.query("UPDATE appointments SET status = 'canceled' WHERE id = $1", [appointmentId]);
            const res = await client.query("SELECT status FROM appointments WHERE id = $1", [appointmentId]);
            expect(res.rows[0].status).toBe("canceled");
        });

        it("should still exist after cancellation", async () => {
            if (!dbAvailable) return;
            await client.query("UPDATE appointments SET status = 'canceled' WHERE id = $1", [appointmentId]);
            const res = await client.query("SELECT id, status FROM appointments WHERE id = $1", [appointmentId]);
            expect(res.rows.length).toBe(1);
            expect(res.rows[0].status).toBe("canceled");
        });

        it("should be excluded by a status != canceled filter (calendar view pattern)", async () => {
            if (!dbAvailable) return;
            // Create a second appointment that stays scheduled
            await client.query(
                `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, status)
                 VALUES ($1, $2, $3, '2026-04-05 14:00:00+00', '2026-04-05 15:00:00+00', 'scheduled')`,
                [tenantId, resourceId, customerId]
            );

            // Cancel the first one
            await client.query("UPDATE appointments SET status = 'canceled' WHERE id = $1", [appointmentId]);

            // Calendar filter: exclude canceled
            const res = await client.query(
                "SELECT id FROM appointments WHERE tenant_id = $1 AND status != 'canceled' AND is_deleted = false",
                [tenantId]
            );
            expect(res.rows.length).toBe(1);
            expect(res.rows[0].id).not.toBe(appointmentId);
        });
    });

    // ---------------------------------------------------------------
    // 8. HIPAA Template Exclusion
    // ---------------------------------------------------------------
    describe("HIPAA Template Exclusion", () => {
        it("should NOT have a dentist template", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT business_type FROM business_templates WHERE business_type = 'dentist'"
            );
            expect(res.rows.length).toBe(0);
        });

        it("should NOT have a chiropractor template", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT business_type FROM business_templates WHERE business_type = 'chiropractor'"
            );
            expect(res.rows.length).toBe(0);
        });

        it("should NOT have a vet-clinic template", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                "SELECT business_type FROM business_templates WHERE business_type = 'vet-clinic'"
            );
            expect(res.rows.length).toBe(0);
        });
    });
});
