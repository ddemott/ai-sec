import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, createTenant, createEmployee, createResource, createService, assignEmployeeToService, assignResourceToService, beginTestTransaction, rollbackTestTransaction, skipIfDbDown } from "./test-utils";
import { Client } from "pg";

describe("CRUD Routes - Database Level", () => {
    let client: Client;
    let tenantId: string;
    let resourceId: string;
    let customerId: string;
    let dbAvailable = true;
    beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

    beforeAll(async () => {
        try {
            client = await getRootClient();
            await clearDB(client);
            const setup = await setupBasicTenant(client);
            tenantId = setup.tenantId;
            resourceId = setup.resourceId;
            customerId = setup.customerId;
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
        await beginTestTransaction(client);
    });

    afterEach(async () => {
        if (!dbAvailable) return;
        await rollbackTestTransaction(client);
    });

    // ── Employees ────────────────────────────────────────────────────────

    describe("Employees", () => {
        it("should list employees for a tenant", async () => {
            // WHO: dashboard user viewing the employee list sidebar
            // WHAT: two employees inserted, query returns them ordered by name ASC
            // WHEN: GET /employees on the Staff management view
            // WHERE: employees table, tenant-scoped SELECT query
            // WHY: without this, the Staff sidebar in the dashboard would be empty or show wrong order
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
                `SELECT employee_id::text AS employee_id, name, first_name, last_name, email, phone, skills, is_active, 'employee' as type
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
            // WHO: dashboard user adding a new employee via Staff form
            // WHAT: employee with all fields — first_name, last_name, email, phone, skills array
            // WHEN: POST /employees from the Staff detail panel
            // WHERE: employees table INSERT
            // WHY: without this, the Add Employee form would silently fail or lose field data
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
            // WHO: dashboard user editing an employee's name and skills
            // WHAT: UPDATE with COALESCE to preserve unchanged fields
            // WHEN: PUT /employees/:id from the Staff detail panel
            // WHERE: employees table UPDATE with COALESCE pattern
            // WHY: without COALESCE, partial updates would null out unset fields
            if (!dbAvailable) return;

            const insertRes = await client.query(
                "INSERT INTO employees (tenant_id, name, first_name, last_name, skills) VALUES ($1, 'Old Name', 'Old', 'Name', $2) RETURNING employee_id",
                [tenantId, ["flat-repair"]]
            );
            const empId = insertRes.rows[0].employee_id;

            const res = await client.query(
                `UPDATE employees SET
                    name = COALESCE($1, name),
                    first_name = COALESCE($2, first_name),
                    last_name = COALESCE($3, last_name),
                    skills = COALESCE($4, skills),
                    updated_at = NOW()
                 WHERE employee_id = $5 RETURNING *`,
                ["New Name", "New", "Name", ["flat-repair", "tire-install"], empId]
            );

            expect(res.rows[0].name).toBe("New Name");
            expect(res.rows[0].first_name).toBe("New");
            expect(res.rows[0].last_name).toBe("Name");
            expect(res.rows[0].skills).toEqual(["flat-repair", "tire-install"]);
        });

        it("should isolate employees by tenant", async () => {
            // WHO: two separate tenant owners viewing their respective employee lists
            // WHAT: each tenant sees only their own employees, not the other tenant's
            // WHEN: GET /employees filtered by tenant_id
            // WHERE: employees table, tenant-scoped SELECT query
            // WHY: without tenant isolation, Salon B would see Auto Shop A's mechanics in their staff list
            if (!dbAvailable) return;

            // Create a second tenant
            const tenant2Id = await createTenant(client, "OtherBiz", "salon");

            await createEmployee(client, tenantId, "Tenant1 Emp");
            await createEmployee(client, tenant2Id, "Tenant2 Emp");

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
            // WHO: dashboard showing combined staff list (employees + user accounts)
            // WHAT: UNION ALL query combines employees table and users table into one list
            // WHEN: GET /employees with include_users flag on the Staff view
            // WHERE: employees + users tables via UNION ALL query
            // WHY: without the union, dashboard users (owners) wouldn't appear in the schedulable staff list
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
                `SELECT employee_id::text AS employee_id, name, first_name, last_name, email, phone, skills, is_active, 'employee' as type
                 FROM employees WHERE tenant_id = $1
                 UNION ALL
                 SELECT user_id::text as employee_id, COALESCE(full_name, email) as name, NULL as first_name, NULL as last_name, email, NULL as phone, '{}'::text[] as skills, true as is_active, 'user' as type
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
            // WHO: dashboard user viewing the resource list in Back Office
            // WHAT: query returns resources for the tenant including the default "Truck 1"
            // WHEN: GET /resources on the Resources management view
            // WHERE: resources table, tenant-scoped SELECT query
            // WHY: without this, the Resources sidebar would be empty and scheduling would have no bays/stations
            if (!dbAvailable) return;

            // setupBasicTenant already creates 'Truck 1'
            // The tenant trigger also creates a default resource for 'mobile-tire'
            const res = await client.query(
                "SELECT * FROM resources WHERE tenant_id = $1 ORDER BY name",
                [tenantId]
            );

            expect(res.rows.length).toBeGreaterThanOrEqual(1);
            const names = res.rows.map((r: { name: string }) => r.name);
            expect(names).toContain("Truck 1");
        });

        it("should create resource with name and description", async () => {
            // WHO: dashboard user adding a new bay/station via Resources form
            // WHAT: resource with name "Bay 2" and description, defaults is_active=true
            // WHEN: POST /resources from the Resources detail panel
            // WHERE: resources table INSERT
            // WHY: without this, adding new bays in the dashboard would fail silently
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
            // WHO: dashboard user renaming a resource in the detail panel
            // WHAT: UPDATE resource name and description by ID
            // WHEN: PUT /resources/:id from the Resources detail panel
            // WHERE: resources table UPDATE
            // WHY: without this, editing resource names in the dashboard would have no effect
            if (!dbAvailable) return;

            // Use the resource created by setupBasicTenant
            await client.query(
                "UPDATE resources SET name = $1, description = $2 WHERE resource_id = $3",
                ["Updated Truck", "Newly painted", resourceId]
            );

            const res = await client.query(
                "SELECT * FROM resources WHERE resource_id = $1",
                [resourceId]
            );
            expect(res.rows[0].name).toBe("Updated Truck");
            expect(res.rows[0].description).toBe("Newly painted");
        });

        it("should soft-deactivate resource via is_active flag", async () => {
            // WHO: dashboard user deactivating a bay that's temporarily out of service
            // WHAT: UPDATE is_active to false (soft deactivate, not hard delete)
            // WHEN: toggle active/inactive on the Resources detail panel
            // WHERE: resources table UPDATE is_active
            // WHY: without soft-deactivate, removing a bay would require hard delete and lose history
            if (!dbAvailable) return;

            await client.query(
                "UPDATE resources SET is_active = false WHERE resource_id = $1",
                [resourceId]
            );

            const res = await client.query(
                "SELECT is_active FROM resources WHERE resource_id = $1",
                [resourceId]
            );
            expect(res.rows[0].is_active).toBe(false);
        });
    });

    // ── Services ─────────────────────────────────────────────────────────

    describe("Services", () => {
        it("should list services for a tenant ordered by name", async () => {
            // WHO: dashboard user viewing the service catalog in Back Office
            // WHAT: two services inserted, returned ordered alphabetically by name
            // WHEN: GET /services on the Services management view
            // WHERE: services table, tenant-scoped SELECT ORDER BY name ASC
            // WHY: without this, the Services sidebar would be empty or show services in random order
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
            // WHO: dashboard user adding a new service via Services form
            // WHAT: service with all fields — name, description, duration, skills, resources, price
            // WHEN: POST /services from the Services detail panel
            // WHERE: services table INSERT
            // WHY: without this, the voice AI would have no services to offer callers for booking
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
            // WHO: dashboard user editing a service's name, description, duration, and price
            // WHAT: UPDATE with COALESCE pattern to preserve unchanged fields
            // WHEN: PUT /services/:id from the Services detail panel
            // WHERE: services table UPDATE with COALESCE
            // WHY: without this, editing services in the dashboard would null out unset fields
            if (!dbAvailable) return;

            const insertRes = await client.query(
                "INSERT INTO services (tenant_id, name, duration_minutes, price) VALUES ($1, 'Old Svc', 30, 50.00) RETURNING service_id",
                [tenantId]
            );
            const svcId = insertRes.rows[0].service_id;

            const res = await client.query(
                "UPDATE services SET name = COALESCE($1, name), description = COALESCE($2, description), duration_minutes = COALESCE($3, duration_minutes), price = COALESCE($4, price), updated_at = NOW() WHERE service_id = $5 RETURNING *",
                ["New Svc", "Updated desc", 45, 75.00, svcId]
            );

            expect(res.rows[0].name).toBe("New Svc");
            expect(res.rows[0].description).toBe("Updated desc");
            expect(res.rows[0].duration_minutes).toBe(45);
            expect(parseFloat(res.rows[0].price)).toBeCloseTo(75.00);
        });

        it("should delete service with no mappings", async () => {
            // WHO: dashboard user deleting an unmapped service from the catalog
            // WHAT: DELETE service that has zero employee/resource mappings
            // WHEN: DELETE /services/:id after confirming no dependencies
            // WHERE: services table DELETE, service_resource + service_employee checked first
            // WHY: without the mapping check, deleting mapped services would orphan assignments
            if (!dbAvailable) return;

            const insertRes = await client.query(
                "INSERT INTO services (tenant_id, name, duration_minutes) VALUES ($1, 'Deletable', 30) RETURNING service_id",
                [tenantId]
            );
            const svcId = insertRes.rows[0].service_id;

            // Verify no mappings
            const mappings = await client.query(
                "SELECT (SELECT count(*) FROM service_resource WHERE service_id = $1) + (SELECT count(*) FROM service_employee WHERE service_id = $1) as count",
                [svcId]
            );
            expect(parseInt(mappings.rows[0].count)).toBe(0);

            await client.query("DELETE FROM services WHERE service_id = $1", [svcId]);

            const check = await client.query("SELECT * FROM services WHERE service_id = $1", [svcId]);
            expect(check.rows).toHaveLength(0);
        });

        it("should prevent delete when service has mappings (application-level check)", async () => {
            // WHO: dashboard user attempting to delete a service that has employee assignments
            // WHAT: service with an active employee mapping — count > 0 blocks deletion
            // WHEN: DELETE /services/:id when mappings exist (route returns 409)
            // WHERE: service_employee + service_resource mapping count check
            // WHY: without this guard, deleting a mapped service would break the Skill Relationship Map and booking
            if (!dbAvailable) return;

            const svcId = await createService(client, tenantId, "Mapped Svc", 30);
            const empId = await createEmployee(client, tenantId, "Worker");
            await assignEmployeeToService(client, tenantId, svcId, empId);

            // Application-level check mimicking the route logic
            const mappings = await client.query(
                "SELECT (SELECT count(*) FROM service_resource WHERE service_id = $1) + (SELECT count(*) FROM service_employee WHERE service_id = $1) as count",
                [svcId]
            );
            expect(parseInt(mappings.rows[0].count)).toBeGreaterThan(0);
        });
    });

    // ── Shifts: REMOVED 2026-04-30 ──────────────────────────────────────
    // The CRUD tests for the old /shifts routes + employee_shifts table
    // were deleted with the table itself (NEEDS-REFACTORING #4 Phase 2).
    // Date-specific schedule CRUD tests live alongside the
    // /shifts/overrides routes; coverage of the booking-time invariants
    // moved into scheduling-atomic.test.ts and shift-overrides-edge.test.ts.

    // ── Service Mappings ─────────────────────────────────────────────────

    describe("Service Mappings", () => {
        let employeeId: string;
        let serviceId: string;

        beforeEach(async () => {
            if (!dbAvailable) return;
            employeeId = await createEmployee(client, tenantId, "Mapper");
            serviceId = await createService(client, tenantId, "Mapped Service", 30);
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

            const emp2Id = await createEmployee(client, tenantId, "Second");

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

            const resource2Id = await createResource(client, tenantId, "Bay 2");

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
            // Pilot #2 (2026-05-18) dropped the surrogate UUID; identity is
            // now (tenant_id, name). The DELETE keys on the composite.
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO tenant_skills (tenant_id, name) VALUES ($1, 'to-delete')",
                [tenantId]
            );

            await client.query(
                "DELETE FROM tenant_skills WHERE tenant_id = $1 AND name = $2",
                [tenantId, 'to-delete']
            );

            const check = await client.query(
                "SELECT * FROM tenant_skills WHERE tenant_id = $1 AND name = $2",
                [tenantId, 'to-delete']
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

            const tenant2Id = await createTenant(client, "OtherShop", "salon");

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

    // ── UUID Shifts (moved from coverage-gaps.test.ts) ────────────────

    // ── UUID Shifts: REMOVED 2026-04-30 ──────────────────────────────
    // Same reason as the "Shifts" describe block above — table dropped.

    // ── Composite-PK Skills (pilot #2, 2026-05-18) ────────────────────
    //
    // The describe-block was previously "UUID Skills" pinning the
    // surrogate UUID shape. Pilot #2 dropped the surrogate; identity is
    // (tenant_id, name) now. Same two scenarios, rewritten against the
    // composite-PK shape so any future regression that re-adds a
    // surrogate (or renames the columns) fails fast here.
    describe("Composite-PK Skills", () => {
        it("should create a skill keyed by (tenant_id, name)", async () => {
            if (!dbAvailable) return;
            const res = await client.query(
                `INSERT INTO tenant_skills (tenant_id, name, description)
                 VALUES ($1, 'tire-balancing', 'Balance and align tires')
                 RETURNING tenant_id, name`,
                [tenantId]
            );
            expect(res.rows[0].tenant_id).toBe(tenantId);
            expect(res.rows[0].name).toBe('tire-balancing');
        });

        it("should delete a skill by (tenant_id, name)", async () => {
            if (!dbAvailable) return;
            await client.query(
                `INSERT INTO tenant_skills (tenant_id, name, description)
                 VALUES ($1, 'oil-change-composite', 'Standard oil change')`,
                [tenantId]
            );

            await client.query(
                "DELETE FROM tenant_skills WHERE tenant_id = $1 AND name = $2",
                [tenantId, 'oil-change-composite']
            );

            const res = await client.query(
                "SELECT * FROM tenant_skills WHERE tenant_id = $1 AND name = $2",
                [tenantId, 'oil-change-composite']
            );
            expect(res.rows.length).toBe(0);
        });
    });

    // ── Error Diagnostics ───────────────────────────────────────────────

    describe("Error diagnostics", () => {
        it("should reject employee insert with NULL tenant_id via NOT NULL constraint", async () => {
            if (!dbAvailable) return;

            try {
                await client.query(
                    "INSERT INTO employees (tenant_id, name, first_name, last_name) VALUES ($1, 'Ghost', 'Ghost', 'Worker')",
                    [null]
                );
                expect.fail("Should have thrown a NOT NULL violation");
            } catch (err) {
                // Postgres error should identify the column that failed
                expect(err.message).toMatch(/null value|not-null|violates not-null/i);
                expect(err.column || err.message).toBeDefined();
                // Postgres provides a specific error code for not-null violations (23502)
                expect(err.code).toBe("23502");
            }
        });

        it("should reject resource insert with NULL name via NOT NULL constraint", async () => {
            if (!dbAvailable) return;

            try {
                await client.query(
                    "INSERT INTO resources (tenant_id, name) VALUES ($1, $2)",
                    [tenantId, null]
                );
                expect.fail("Should have thrown a NOT NULL violation");
            } catch (err) {
                expect(err.code).toBe("23502");
                expect(err.message).toMatch(/null value|not-null/i);
            }
        });

        it("should return empty result (not error) when deleting non-existent resource", async () => {
            if (!dbAvailable) return;

            const fakeId = "00000000-0000-0000-0000-000000000099";
            const res = await client.query(
                "DELETE FROM resources WHERE resource_id = $1 AND tenant_id = $2 RETURNING resource_id",
                [fakeId, tenantId]
            );

            // Deleting a non-existent row returns 0 rows — callers should check rowCount
            expect(res.rowCount).toBe(0);
            expect(res.rows).toHaveLength(0);
        });

        it("should reject resource insert with invalid FK tenant_id", async () => {
            if (!dbAvailable) return;

            const fakeTenantId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
            try {
                await client.query(
                    "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Orphan Resource')",
                    [fakeTenantId]
                );
                expect.fail("Should have thrown a FK violation");
            } catch (err) {
                // Postgres FK violation code is 23503 — error should mention the constraint
                expect(err.code).toBe("23503");
                expect(err.message).toMatch(/foreign key|violates foreign key/i);
                // The detail should reference the specific key that failed
                expect(err.detail).toBeDefined();
                expect(err.detail).toMatch(/tenant/i);
            }
        });

        it("should include constraint name in duplicate skill error", async () => {
            if (!dbAvailable) return;

            await client.query(
                "INSERT INTO tenant_skills (tenant_id, name) VALUES ($1, 'dup-test')",
                [tenantId]
            );

            try {
                await client.query(
                    "INSERT INTO tenant_skills (tenant_id, name) VALUES ($1, 'dup-test')",
                    [tenantId]
                );
                expect.fail("Should have thrown a unique violation");
            } catch (err) {
                // Postgres unique violation code is 23505
                expect(err.code).toBe("23505");
                expect(err.message).toMatch(/duplicate key|unique/i);
                // detail should mention the specific values that conflicted
                expect(err.detail).toBeDefined();
                expect(err.detail).toMatch(/dup-test/);
            }
        });
    });
});
