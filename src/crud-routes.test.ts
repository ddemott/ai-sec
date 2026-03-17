import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant } from "./test-utils";
import { Client } from "pg";

describe("CRUD Routes - Database Level", () => {
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
            console.warn("[crud-routes.test] Skipping DB tests - connection failed", err);
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

    // ── Employees ────────────────────────────────────────────────────────

    describe("Employees", () => {
        it("should list employees for a tenant", async () => {
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO employees (tenant_id, name, first_name, last_name) VALUES ($1, 'John Doe', 'John', 'Doe')",
                [tenantId]
            );
            await client.query(
                "INSERT INTO employees (tenant_id, name, first_name, last_name) VALUES ($1, 'Jane Smith', 'Jane', 'Smith')",
                [tenantId]
            );

            const res = await client.query(
                `SELECT id::text, name, first_name, last_name, email, phone, skills, is_active, 'employee' as type
                 FROM employees WHERE tenant_id = $1
                 ORDER BY name ASC`,
                [tenantId]
            );

            expect(res.rows).toHaveLength(2);
            expect(res.rows[0].name).toBe("Jane Smith");
            expect(res.rows[1].name).toBe("John Doe");
            expect(res.rows[0].type).toBe("employee");
        });

        it("should create employee with first_name, last_name, email, phone", async () => {
            if (!dbAvailable) return;

            const firstName = "Mike";
            const lastName = "Tech";
            const displayName = [firstName, lastName].filter(Boolean).join(" ");

            const res = await client.query(
                "INSERT INTO employees (tenant_id, name, first_name, last_name, email, phone, skills) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
                [tenantId, displayName, firstName, lastName, "mike@example.com", "+15551234567", ["tire-install", "flat-repair"]]
            );

            expect(res.rows[0].name).toBe("Mike Tech");
            expect(res.rows[0].first_name).toBe("Mike");
            expect(res.rows[0].last_name).toBe("Tech");
            expect(res.rows[0].email).toBe("mike@example.com");
            expect(res.rows[0].phone).toBe("+15551234567");
            expect(res.rows[0].skills).toEqual(["tire-install", "flat-repair"]);
            expect(res.rows[0].is_active).toBe(true);
        });

        it("should update employee name and skills", async () => {
            if (!dbAvailable) return;

            const insertRes = await client.query(
                "INSERT INTO employees (tenant_id, name, first_name, last_name, skills) VALUES ($1, 'Old Name', 'Old', 'Name', $2) RETURNING id",
                [tenantId, ["flat-repair"]]
            );
            const empId = insertRes.rows[0].id;

            const res = await client.query(
                `UPDATE employees SET
                    name = COALESCE($1, name),
                    first_name = COALESCE($2, first_name),
                    last_name = COALESCE($3, last_name),
                    skills = COALESCE($4, skills),
                    updated_at = NOW()
                 WHERE id = $5 RETURNING *`,
                ["New Name", "New", "Name", ["flat-repair", "tire-install"], empId]
            );

            expect(res.rows[0].name).toBe("New Name");
            expect(res.rows[0].first_name).toBe("New");
            expect(res.rows[0].last_name).toBe("Name");
            expect(res.rows[0].skills).toEqual(["flat-repair", "tire-install"]);
        });

        it("should isolate employees by tenant", async () => {
            if (!dbAvailable) return;

            // Create a second tenant
            const t2Res = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ('OtherBiz', 'salon') RETURNING id"
            );
            const tenant2Id = t2Res.rows[0].id;

            await client.query(
                "INSERT INTO employees (tenant_id, name) VALUES ($1, 'Tenant1 Emp')",
                [tenantId]
            );
            await client.query(
                "INSERT INTO employees (tenant_id, name) VALUES ($1, 'Tenant2 Emp')",
                [tenant2Id]
            );

            const res1 = await client.query(
                "SELECT * FROM employees WHERE tenant_id = $1",
                [tenantId]
            );
            const res2 = await client.query(
                "SELECT * FROM employees WHERE tenant_id = $1",
                [tenant2Id]
            );

            expect(res1.rows).toHaveLength(1);
            expect(res1.rows[0].name).toBe("Tenant1 Emp");
            expect(res2.rows).toHaveLength(1);
            expect(res2.rows[0].name).toBe("Tenant2 Emp");
        });

        it("should list employees unioned with users", async () => {
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO employees (tenant_id, name, first_name, last_name) VALUES ($1, 'Emp One', 'Emp', 'One')",
                [tenantId]
            );
            const bcrypt = await import("bcrypt");
            const hash = await bcrypt.hash("testpass", 10);
            await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'user1@test.com', $2, 'User One')",
                [tenantId, hash]
            );

            const res = await client.query(
                `SELECT id::text, name, first_name, last_name, email, phone, skills, is_active, 'employee' as type
                 FROM employees WHERE tenant_id = $1
                 UNION ALL
                 SELECT id::text, COALESCE(full_name, email) as name, NULL as first_name, NULL as last_name, email, NULL as phone, '{}'::text[] as skills, true as is_active, 'user' as type
                 FROM users WHERE tenant_id = $1
                 ORDER BY name ASC`,
                [tenantId]
            );

            expect(res.rows).toHaveLength(2);
            expect(res.rows[0].name).toBe("Emp One");
            expect(res.rows[0].type).toBe("employee");
            expect(res.rows[1].name).toBe("User One");
            expect(res.rows[1].type).toBe("user");
        });
    });

    // ── Resources ────────────────────────────────────────────────────────

    describe("Resources", () => {
        it("should list resources for a tenant", async () => {
            if (!dbAvailable) return;

            // setupBasicTenant already creates 'Truck 1'
            // The tenant trigger also creates a default resource for 'mobile-tire'
            const res = await client.query(
                "SELECT * FROM resources WHERE tenant_id = $1 ORDER BY name",
                [tenantId]
            );

            expect(res.rows.length).toBeGreaterThanOrEqual(1);
            const names = res.rows.map((r: any) => r.name);
            expect(names).toContain("Truck 1");
        });

        it("should create resource with name and description", async () => {
            if (!dbAvailable) return;

            const res = await client.query(
                "INSERT INTO resources (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *",
                [tenantId, "Bay 2", "Secondary service bay"]
            );

            expect(res.rows[0].name).toBe("Bay 2");
            expect(res.rows[0].description).toBe("Secondary service bay");
            expect(res.rows[0].tenant_id).toBe(tenantId);
            expect(res.rows[0].is_active).toBe(true);
        });

        it("should update resource name and description", async () => {
            if (!dbAvailable) return;

            // Use the resource created by setupBasicTenant
            await client.query(
                "UPDATE resources SET name = $1, description = $2 WHERE id = $3",
                ["Updated Truck", "Newly painted", resourceId]
            );

            const res = await client.query(
                "SELECT * FROM resources WHERE id = $1",
                [resourceId]
            );
            expect(res.rows[0].name).toBe("Updated Truck");
            expect(res.rows[0].description).toBe("Newly painted");
        });

        it("should soft-deactivate resource via is_active flag", async () => {
            if (!dbAvailable) return;

            await client.query(
                "UPDATE resources SET is_active = false WHERE id = $1",
                [resourceId]
            );

            const res = await client.query(
                "SELECT is_active FROM resources WHERE id = $1",
                [resourceId]
            );
            expect(res.rows[0].is_active).toBe(false);
        });
    });

    // ── Services ─────────────────────────────────────────────────────────

    describe("Services", () => {
        it("should list services for a tenant ordered by name", async () => {
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO services (tenant_id, name, duration_minutes) VALUES ($1, 'Tire Rotation', 30)",
                [tenantId]
            );
            await client.query(
                "INSERT INTO services (tenant_id, name, duration_minutes) VALUES ($1, 'Alignment', 60)",
                [tenantId]
            );

            const res = await client.query(
                "SELECT * FROM services WHERE tenant_id = $1 ORDER BY name ASC",
                [tenantId]
            );

            expect(res.rows).toHaveLength(2);
            expect(res.rows[0].name).toBe("Alignment");
            expect(res.rows[1].name).toBe("Tire Rotation");
        });

        it("should create service with name, duration_minutes, and price", async () => {
            if (!dbAvailable) return;

            const res = await client.query(
                "INSERT INTO services (tenant_id, name, description, duration_minutes, required_skills, required_resources, price) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
                [tenantId, "Oil Change", "Standard oil change", 30, ["oil-change"], ["lift"], 49.99]
            );

            expect(res.rows[0].name).toBe("Oil Change");
            expect(res.rows[0].duration_minutes).toBe(30);
            expect(parseFloat(res.rows[0].price)).toBeCloseTo(49.99);
            expect(res.rows[0].required_skills).toEqual(["oil-change"]);
            expect(res.rows[0].description).toBe("Standard oil change");
        });

        it("should update service", async () => {
            if (!dbAvailable) return;

            const insertRes = await client.query(
                "INSERT INTO services (tenant_id, name, duration_minutes, price) VALUES ($1, 'Old Svc', 30, 50.00) RETURNING id",
                [tenantId]
            );
            const svcId = insertRes.rows[0].id;

            const res = await client.query(
                "UPDATE services SET name = COALESCE($1, name), description = COALESCE($2, description), duration_minutes = COALESCE($3, duration_minutes), price = COALESCE($4, price), updated_at = NOW() WHERE id = $5 RETURNING *",
                ["New Svc", "Updated desc", 45, 75.00, svcId]
            );

            expect(res.rows[0].name).toBe("New Svc");
            expect(res.rows[0].description).toBe("Updated desc");
            expect(res.rows[0].duration_minutes).toBe(45);
            expect(parseFloat(res.rows[0].price)).toBeCloseTo(75.00);
        });

        it("should delete service with no mappings", async () => {
            if (!dbAvailable) return;

            const insertRes = await client.query(
                "INSERT INTO services (tenant_id, name, duration_minutes) VALUES ($1, 'Deletable', 30) RETURNING id",
                [tenantId]
            );
            const svcId = insertRes.rows[0].id;

            // Verify no mappings
            const mappings = await client.query(
                "SELECT (SELECT count(*) FROM service_resource WHERE service_id = $1) + (SELECT count(*) FROM service_employee WHERE service_id = $1) as count",
                [svcId]
            );
            expect(parseInt(mappings.rows[0].count)).toBe(0);

            await client.query("DELETE FROM services WHERE id = $1", [svcId]);

            const check = await client.query("SELECT * FROM services WHERE id = $1", [svcId]);
            expect(check.rows).toHaveLength(0);
        });

        it("should prevent delete when service has mappings (application-level check)", async () => {
            if (!dbAvailable) return;

            const svcRes = await client.query(
                "INSERT INTO services (tenant_id, name, duration_minutes) VALUES ($1, 'Mapped Svc', 30) RETURNING id",
                [tenantId]
            );
            const svcId = svcRes.rows[0].id;

            const empRes = await client.query(
                "INSERT INTO employees (tenant_id, name) VALUES ($1, 'Worker') RETURNING id",
                [tenantId]
            );
            const empId = empRes.rows[0].id;

            await client.query(
                "INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES ($1, $2, $3)",
                [svcId, empId, tenantId]
            );

            // Application-level check mimicking the route logic
            const mappings = await client.query(
                "SELECT (SELECT count(*) FROM service_resource WHERE service_id = $1) + (SELECT count(*) FROM service_employee WHERE service_id = $1) as count",
                [svcId]
            );
            expect(parseInt(mappings.rows[0].count)).toBeGreaterThan(0);
        });
    });

    // ── Shifts ───────────────────────────────────────────────────────────

    describe("Shifts", () => {
        let employeeId: number;

        beforeEach(async () => {
            if (!dbAvailable) return;
            const empRes = await client.query(
                "INSERT INTO employees (tenant_id, name) VALUES ($1, 'Shift Worker') RETURNING id",
                [tenantId]
            );
            employeeId = empRes.rows[0].id;
        });

        it("should create employee shift", async () => {
            if (!dbAvailable) return;

            const res = await client.query(
                "INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4, $5) RETURNING *",
                [tenantId, employeeId, 1, "09:00", "17:00"]
            );

            expect(res.rows[0].tenant_id).toBe(tenantId);
            expect(res.rows[0].employee_id).toBe(employeeId);
            expect(res.rows[0].day_of_week).toBe(1);
            expect(res.rows[0].is_active).toBe(true);
        });

        it("should list shifts for a tenant ordered by day and time", async () => {
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, 3, '09:00', '17:00')",
                [tenantId, employeeId]
            );
            await client.query(
                "INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, 1, '08:00', '16:00')",
                [tenantId, employeeId]
            );

            const res = await client.query(
                "SELECT * FROM employee_shifts WHERE tenant_id = $1 ORDER BY day_of_week, start_time",
                [tenantId]
            );

            expect(res.rows).toHaveLength(2);
            expect(res.rows[0].day_of_week).toBe(1);
            expect(res.rows[1].day_of_week).toBe(3);
        });

        it("should update shift times", async () => {
            if (!dbAvailable) return;

            const insertRes = await client.query(
                "INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, 1, '09:00', '17:00') RETURNING id",
                [tenantId, employeeId]
            );
            const shiftId = insertRes.rows[0].id;

            const res = await client.query(
                `UPDATE employee_shifts SET
                    start_time = COALESCE($1, start_time), end_time = COALESCE($2, end_time),
                    day_of_week = COALESCE($3, day_of_week), is_active = COALESCE($4, is_active)
                 WHERE id = $5 AND tenant_id = $6 RETURNING *`,
                ["10:00", "18:00", null, null, shiftId, tenantId]
            );

            expect(res.rows).toHaveLength(1);
            expect(res.rows[0].start_time).toBe("10:00:00");
            expect(res.rows[0].end_time).toBe("18:00:00");
            expect(res.rows[0].day_of_week).toBe(1); // unchanged
        });

        it("should delete shift", async () => {
            if (!dbAvailable) return;

            const insertRes = await client.query(
                "INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, 1, '09:00', '17:00') RETURNING id",
                [tenantId, employeeId]
            );
            const shiftId = insertRes.rows[0].id;

            await client.query(
                "DELETE FROM employee_shifts WHERE id = $1 AND tenant_id = $2",
                [shiftId, tenantId]
            );

            const check = await client.query(
                "SELECT * FROM employee_shifts WHERE id = $1",
                [shiftId]
            );
            expect(check.rows).toHaveLength(0);
        });

        it("should reject day_of_week outside 0-6 range", async () => {
            if (!dbAvailable) return;

            await expect(
                client.query(
                    "INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, 7, '09:00', '17:00')",
                    [tenantId, employeeId]
                )
            ).rejects.toThrow();
        });
    });

    // ── Service Mappings ─────────────────────────────────────────────────

    describe("Service Mappings", () => {
        let employeeId: number;
        let serviceId: number;

        beforeEach(async () => {
            if (!dbAvailable) return;
            const empRes = await client.query(
                "INSERT INTO employees (tenant_id, name) VALUES ($1, 'Mapper') RETURNING id",
                [tenantId]
            );
            employeeId = empRes.rows[0].id;

            const svcRes = await client.query(
                "INSERT INTO services (tenant_id, name, duration_minutes) VALUES ($1, 'Mapped Service', 30) RETURNING id",
                [tenantId]
            );
            serviceId = svcRes.rows[0].id;
        });

        it("should assign employee to service", async () => {
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                [serviceId, employeeId, tenantId]
            );

            const res = await client.query(
                "SELECT * FROM service_employee WHERE tenant_id = $1",
                [tenantId]
            );
            expect(res.rows).toHaveLength(1);
            expect(res.rows[0].service_id).toBe(serviceId);
            expect(res.rows[0].employee_id).toBe(employeeId);
        });

        it("should not duplicate employee-service assignment (ON CONFLICT DO NOTHING)", async () => {
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                [serviceId, employeeId, tenantId]
            );
            // Insert again - should be idempotent
            await client.query(
                "INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                [serviceId, employeeId, tenantId]
            );

            const res = await client.query(
                "SELECT * FROM service_employee WHERE service_id = $1 AND employee_id = $2",
                [serviceId, employeeId]
            );
            expect(res.rows).toHaveLength(1);
        });

        it("should unassign employee from service", async () => {
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES ($1, $2, $3)",
                [serviceId, employeeId, tenantId]
            );

            await client.query(
                "DELETE FROM service_employee WHERE service_id = $1 AND employee_id = $2 AND tenant_id = $3",
                [serviceId, employeeId, tenantId]
            );

            const res = await client.query(
                "SELECT * FROM service_employee WHERE service_id = $1 AND employee_id = $2",
                [serviceId, employeeId]
            );
            expect(res.rows).toHaveLength(0);
        });

        it("should assign resource to service", async () => {
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                [serviceId, resourceId, tenantId]
            );

            const res = await client.query(
                "SELECT * FROM service_resource WHERE tenant_id = $1",
                [tenantId]
            );
            expect(res.rows).toHaveLength(1);
            expect(res.rows[0].service_id).toBe(serviceId);
            expect(res.rows[0].resource_id).toBe(resourceId);
        });

        it("should unassign resource from service", async () => {
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES ($1, $2, $3)",
                [serviceId, resourceId, tenantId]
            );

            await client.query(
                "DELETE FROM service_resource WHERE service_id = $1 AND resource_id = $2 AND tenant_id = $3",
                [serviceId, resourceId, tenantId]
            );

            const res = await client.query(
                "SELECT * FROM service_resource WHERE service_id = $1 AND resource_id = $2",
                [serviceId, resourceId]
            );
            expect(res.rows).toHaveLength(0);
        });

        it("should list service-employee mappings for a tenant", async () => {
            if (!dbAvailable) return;

            const emp2Res = await client.query(
                "INSERT INTO employees (tenant_id, name) VALUES ($1, 'Second') RETURNING id",
                [tenantId]
            );
            const emp2Id = emp2Res.rows[0].id;

            await client.query(
                "INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES ($1, $2, $3)",
                [serviceId, employeeId, tenantId]
            );
            await client.query(
                "INSERT INTO service_employee (service_id, employee_id, tenant_id) VALUES ($1, $2, $3)",
                [serviceId, emp2Id, tenantId]
            );

            const res = await client.query(
                "SELECT * FROM service_employee WHERE tenant_id = $1",
                [tenantId]
            );
            expect(res.rows).toHaveLength(2);
        });

        it("should list service-resource mappings for a tenant", async () => {
            if (!dbAvailable) return;

            const res2 = await client.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay 2') RETURNING id",
                [tenantId]
            );
            const resource2Id = res2.rows[0].id;

            await client.query(
                "INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES ($1, $2, $3)",
                [serviceId, resourceId, tenantId]
            );
            await client.query(
                "INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES ($1, $2, $3)",
                [serviceId, resource2Id, tenantId]
            );

            const res = await client.query(
                "SELECT * FROM service_resource WHERE tenant_id = $1",
                [tenantId]
            );
            expect(res.rows).toHaveLength(2);
        });
    });

    // ── Skills ───────────────────────────────────────────────────────────

    describe("Skills", () => {
        it("should create tenant skill with normalized name", async () => {
            if (!dbAvailable) return;

            const rawName = " Tire Install ";
            const normalizedName = rawName.toLowerCase().trim().replace(/\s+/g, "-");

            const res = await client.query(
                "INSERT INTO tenant_skills (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *",
                [tenantId, normalizedName, "Full mount and balance"]
            );

            expect(res.rows[0].name).toBe("tire-install");
            expect(res.rows[0].description).toBe("Full mount and balance");
            expect(res.rows[0].tenant_id).toBe(tenantId);
        });

        it("should list skills for tenant ordered by name", async () => {
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO tenant_skills (tenant_id, name) VALUES ($1, 'flat-repair')",
                [tenantId]
            );
            await client.query(
                "INSERT INTO tenant_skills (tenant_id, name) VALUES ($1, 'alignment')",
                [tenantId]
            );

            const res = await client.query(
                "SELECT * FROM tenant_skills WHERE tenant_id = $1 ORDER BY name",
                [tenantId]
            );

            expect(res.rows).toHaveLength(2);
            expect(res.rows[0].name).toBe("alignment");
            expect(res.rows[1].name).toBe("flat-repair");
        });

        it("should delete skill", async () => {
            if (!dbAvailable) return;

            const insertRes = await client.query(
                "INSERT INTO tenant_skills (tenant_id, name) VALUES ($1, 'to-delete') RETURNING id",
                [tenantId]
            );
            const skillId = insertRes.rows[0].id;

            await client.query(
                "DELETE FROM tenant_skills WHERE id = $1 AND tenant_id = $2",
                [skillId, tenantId]
            );

            const check = await client.query(
                "SELECT * FROM tenant_skills WHERE id = $1",
                [skillId]
            );
            expect(check.rows).toHaveLength(0);
        });

        it("should reject duplicate skill name within same tenant", async () => {
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO tenant_skills (tenant_id, name) VALUES ($1, 'unique-skill')",
                [tenantId]
            );

            await expect(
                client.query(
                    "INSERT INTO tenant_skills (tenant_id, name) VALUES ($1, 'unique-skill')",
                    [tenantId]
                )
            ).rejects.toThrow();
        });

        it("should allow same skill name for different tenants", async () => {
            if (!dbAvailable) return;

            const t2Res = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ('OtherShop', 'salon') RETURNING id"
            );
            const tenant2Id = t2Res.rows[0].id;

            await client.query(
                "INSERT INTO tenant_skills (tenant_id, name) VALUES ($1, 'shared-name')",
                [tenantId]
            );
            await client.query(
                "INSERT INTO tenant_skills (tenant_id, name) VALUES ($1, 'shared-name')",
                [tenant2Id]
            );

            const res1 = await client.query(
                "SELECT * FROM tenant_skills WHERE tenant_id = $1 AND name = 'shared-name'",
                [tenantId]
            );
            const res2 = await client.query(
                "SELECT * FROM tenant_skills WHERE tenant_id = $1 AND name = 'shared-name'",
                [tenant2Id]
            );

            expect(res1.rows).toHaveLength(1);
            expect(res2.rows).toHaveLength(1);
        });
    });
});
