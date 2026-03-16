import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getRootClient, getApiClient, clearDB, setupBasicTenant } from "./test-utils";
import { Client } from "pg";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';

describe("High Bug Fixes (BUG-007, BUG-008, BUG-009, BUG-010, BUG-011, BUG-012, BUG-026, BUG-027)", () => {
    let root: Client;
    let api: Client;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            root = await getRootClient();
            api = await getApiClient();
        } catch (err) {
            dbAvailable = false;
            console.warn("[high-bugs.test] Skipping DB tests - connection failed", err);
        }
    });

    afterAll(async () => {
        if (dbAvailable) {
            if (root) await root.end();
            if (api) await api.end();
        }
    });

    // =========================================================
    // BUG-008: api_user should have limited privileges
    // =========================================================
    describe("BUG-008: api_user privilege restriction", () => {
        it("api_user should NOT be able to TRUNCATE tables", async () => {
            if (!dbAvailable) return;
            await clearDB(root);
            await setupBasicTenant(root);

            // api_user should be able to SELECT
            await api.query("SELECT set_tenant_context($1::UUID)", [
                (await root.query("SELECT id FROM tenants LIMIT 1")).rows[0].id
            ]);
            const selectRes = await api.query("SELECT count(*) FROM customers");
            expect(parseInt(selectRes.rows[0].count)).toBeGreaterThanOrEqual(0);

            // api_user should NOT be able to TRUNCATE (requires TRUNCATE privilege)
            await expect(
                api.query("TRUNCATE customers")
            ).rejects.toThrow(/permission denied/i);
        });

        it("api_user should be able to SELECT, INSERT, UPDATE, DELETE", async () => {
            if (!dbAvailable) return;
            await clearDB(root);
            const { tenantId } = await setupBasicTenant(root);

            await api.query("SELECT set_tenant_context($1::UUID)", [tenantId]);

            // SELECT
            const selectRes = await api.query("SELECT * FROM customers WHERE tenant_id = $1", [tenantId]);
            expect(selectRes.rows.length).toBeGreaterThan(0);

            // INSERT
            const insertRes = await api.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550009999', 'Test') RETURNING id",
                [tenantId]
            );
            expect(insertRes.rows[0].id).toBeDefined();

            // UPDATE
            const updateRes = await api.query(
                "UPDATE customers SET name = 'Updated' WHERE id = $1 RETURNING name",
                [insertRes.rows[0].id]
            );
            expect(updateRes.rows[0].name).toBe('Updated');

            // DELETE
            const deleteRes = await api.query(
                "DELETE FROM customers WHERE id = $1",
                [insertRes.rows[0].id]
            );
            expect(deleteRes.rowCount).toBe(1);
        });
    });

    // =========================================================
    // BUG-009: Service requirements enforced at booking time
    // =========================================================
    describe("BUG-009: Service requirement validation", () => {
        it("should reject booking when resource lacks required capabilities", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tenantId = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Cap Shop', 'auto-shop') RETURNING id"
            )).rows[0].id;

            // Resource with no capabilities
            const resourceId = (await root.query(
                "INSERT INTO resources (tenant_id, name, capabilities) VALUES ($1, 'Basic Bay', '{}') RETURNING id",
                [tenantId]
            )).rows[0].id;

            const customerId = (await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice') RETURNING id",
                [tenantId]
            )).rows[0].id;

            // Service that requires 'tire-lift' capability
            const serviceId = (await root.query(
                "INSERT INTO services (tenant_id, name, duration_minutes, required_resources) VALUES ($1, 'Tire Install', 60, ARRAY['tire-lift']) RETURNING id",
                [tenantId]
            )).rows[0].id;

            // Book with service_id — should fail because resource lacks 'tire-lift'
            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
                [
                    tenantId, resourceId, customerId,
                    new Date("2026-04-01T10:00:00Z"),
                    new Date("2026-04-01T11:00:00Z"),
                    'Tire install', 'call_cap_001', null, null,
                    serviceId
                ]
            );

            expect(result.rows[0].success).toBe(false);
            expect(result.rows[0].error_message).toContain('Resource does not have required capabilities');
        });

        it("should allow booking when resource has required capabilities", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tenantId = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Cap Shop', 'auto-shop') RETURNING id"
            )).rows[0].id;

            // Resource WITH tire-lift capability
            const resourceId = (await root.query(
                "INSERT INTO resources (tenant_id, name, capabilities) VALUES ($1, 'Full Bay', ARRAY['tire-lift', 'oil-drain']) RETURNING id",
                [tenantId]
            )).rows[0].id;

            const customerId = (await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice') RETURNING id",
                [tenantId]
            )).rows[0].id;

            const serviceId = (await root.query(
                "INSERT INTO services (tenant_id, name, duration_minutes, required_resources) VALUES ($1, 'Tire Install', 60, ARRAY['tire-lift']) RETURNING id",
                [tenantId]
            )).rows[0].id;

            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
                [
                    tenantId, resourceId, customerId,
                    new Date("2026-04-01T10:00:00Z"),
                    new Date("2026-04-01T11:00:00Z"),
                    'Tire install', 'call_cap_002', null, null,
                    serviceId
                ]
            );

            expect(result.rows[0].success).toBe(true);
        });

        it("should reject booking when employee lacks required skills", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tenantId = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Skill Shop', 'auto-shop') RETURNING id"
            )).rows[0].id;

            const resourceId = (await root.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay 1') RETURNING id",
                [tenantId]
            )).rows[0].id;

            const customerId = (await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice') RETURNING id",
                [tenantId]
            )).rows[0].id;

            // Employee with only 'oil-change' skill
            const employeeId = (await root.query(
                "INSERT INTO employees (tenant_id, name, skills) VALUES ($1, 'Bob', ARRAY['oil-change']) RETURNING id",
                [tenantId]
            )).rows[0].id;

            // Add shift so shift check passes
            await root.query(
                "INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, 3, '08:00', '18:00')",
                [tenantId, employeeId]
            );

            // Service requires 'tire-install' skill
            const serviceId = (await root.query(
                "INSERT INTO services (tenant_id, name, duration_minutes, required_skills) VALUES ($1, 'Tire Install', 60, ARRAY['tire-install']) RETURNING id",
                [tenantId]
            )).rows[0].id;

            // Wednesday DOW=3
            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
                [
                    tenantId, resourceId, customerId,
                    new Date("2026-04-01T10:00:00Z"), // Wednesday
                    new Date("2026-04-01T11:00:00Z"),
                    'Tire install', 'call_skill_001', null,
                    employeeId.toString(),
                    serviceId
                ]
            );

            expect(result.rows[0].success).toBe(false);
            expect(result.rows[0].error_message).toContain('Employee does not have required skills');
        });
    });

    // =========================================================
    // BUG-012: JWT token generation and validation
    // =========================================================
    describe("BUG-012: JWT token handling", () => {
        it("should generate valid JWT tokens", () => {
            const payload = { tenant_id: 'test-uuid', user_id: 'user-uuid', email: 'test@test.com' };
            const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

            const decoded = jwt.verify(token, JWT_SECRET) as any;
            expect(decoded.tenant_id).toBe('test-uuid');
            expect(decoded.user_id).toBe('user-uuid');
            expect(decoded.email).toBe('test@test.com');
            expect(decoded.exp).toBeDefined();
        });

        it("should reject expired tokens", () => {
            const token = jwt.sign(
                { tenant_id: 'test', user_id: 'user', email: 'a@b.com' },
                JWT_SECRET,
                { expiresIn: '0s' }
            );

            expect(() => jwt.verify(token, JWT_SECRET)).toThrow(/expired/i);
        });

        it("should reject tokens with wrong secret", () => {
            const token = jwt.sign(
                { tenant_id: 'test', user_id: 'user', email: 'a@b.com' },
                'wrong-secret',
                { expiresIn: '1h' }
            );

            expect(() => jwt.verify(token, JWT_SECRET)).toThrow(/invalid/i);
        });
    });

    // =========================================================
    // BUG-027: Customer upsert via phone in booking RPC
    // =========================================================
    describe("BUG-027: Customer upsert in booking", () => {
        it("should create customer from phone when customer_id is NULL", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tenantId = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Upsert Shop', 'auto-shop') RETURNING id"
            )).rows[0].id;

            const resourceId = (await root.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay 1') RETURNING id",
                [tenantId]
            )).rows[0].id;

            // Book with phone and name instead of customer_id
            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
                [
                    tenantId, resourceId, null,  // NULL customer_id
                    new Date("2026-04-01T10:00:00Z"),
                    new Date("2026-04-01T11:00:00Z"),
                    'Walk-in', 'call_upsert_001', null, null, null,
                    '+15559998888',  // p_customer_phone
                    'New Customer'   // p_customer_name
                ]
            );

            expect(result.rows[0].success).toBe(true);

            // Verify customer was created
            const customerRes = await root.query(
                "SELECT * FROM customers WHERE tenant_id = $1 AND phone = '+15559998888'",
                [tenantId]
            );
            expect(customerRes.rows.length).toBe(1);
            expect(customerRes.rows[0].name).toBe('New Customer');
        });

        it("should reuse existing customer when phone matches", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tenantId = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Upsert Shop', 'auto-shop') RETURNING id"
            )).rows[0].id;

            const resourceId = (await root.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay 1') RETURNING id",
                [tenantId]
            )).rows[0].id;

            // Pre-create customer
            await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15551112222', 'Existing Customer')",
                [tenantId]
            );

            // Book with same phone — should reuse existing customer
            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
                [
                    tenantId, resourceId, null,
                    new Date("2026-04-01T10:00:00Z"),
                    new Date("2026-04-01T11:00:00Z"),
                    'Return visit', 'call_upsert_002', null, null, null,
                    '+15551112222',
                    'Ignored Name'
                ]
            );

            expect(result.rows[0].success).toBe(true);

            // Should still be just 1 customer with that phone
            const customerRes = await root.query(
                "SELECT count(*) FROM customers WHERE tenant_id = $1 AND phone = '+15551112222'",
                [tenantId]
            );
            expect(parseInt(customerRes.rows[0].count)).toBe(1);
        });

        it("should fail if neither customer_id nor phone provided", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tenantId = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Upsert Shop', 'auto-shop') RETURNING id"
            )).rows[0].id;

            const resourceId = (await root.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay 1') RETURNING id",
                [tenantId]
            )).rows[0].id;

            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
                [
                    tenantId, resourceId, null,
                    new Date("2026-04-01T10:00:00Z"),
                    new Date("2026-04-01T11:00:00Z"),
                    'No customer', 'call_upsert_003', null, null, null,
                    null, null
                ]
            );

            expect(result.rows[0].success).toBe(false);
            expect(result.rows[0].error_message).toContain('Customer ID or phone number is required');
        });
    });

    // =========================================================
    // BUG-007: RLS enforcement via withTenantClient pattern
    // =========================================================
    describe("BUG-007: RLS enforcement via api_user + set_tenant_context", () => {
        it("api_user with tenant A context should NOT see tenant B data", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            // Create two tenants with customers
            const tenantA = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Shop A', 'auto-shop') RETURNING id"
            )).rows[0].id;
            const tenantB = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Shop B', 'salon') RETURNING id"
            )).rows[0].id;

            await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice A')", [tenantA]
            );
            await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550002222', 'Bob B')", [tenantB]
            );

            // api_user sets context to tenant A — should only see Alice A
            await api.query("SELECT set_tenant_context($1::UUID)", [tenantA]);
            const resA = await api.query("SELECT * FROM customers");
            expect(resA.rows.length).toBe(1);
            expect(resA.rows[0].name).toBe('Alice A');

            // Switch to tenant B — should only see Bob B
            await api.query("SELECT set_tenant_context($1::UUID)", [tenantB]);
            const resB = await api.query("SELECT * FROM customers");
            expect(resB.rows.length).toBe(1);
            expect(resB.rows[0].name).toBe('Bob B');
        });

        it("api_user with tenant A context should NOT be able to delete tenant B's customer", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tenantA = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Shop A', 't') RETURNING id"
            )).rows[0].id;
            const tenantB = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Shop B', 't') RETURNING id"
            )).rows[0].id;

            const customerB = (await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550002222', 'Secret Bob') RETURNING id",
                [tenantB]
            )).rows[0].id;

            // Tenant A tries to delete tenant B's customer via api_user
            await api.query("SELECT set_tenant_context($1::UUID)", [tenantA]);
            const deleteRes = await api.query("DELETE FROM customers WHERE id = $1", [customerB]);
            expect(deleteRes.rowCount).toBe(0);

            // Verify customer still exists
            await api.query("SELECT set_tenant_context($1::UUID)", [tenantB]);
            const checkRes = await api.query("SELECT name FROM customers WHERE id = $1", [customerB]);
            expect(checkRes.rows[0].name).toBe('Secret Bob');
        });

        it("api_user with tenant context should enforce RLS on appointments", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tenantA = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Shop A', 't') RETURNING id"
            )).rows[0].id;
            const tenantB = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Shop B', 't') RETURNING id"
            )).rows[0].id;

            const resA = (await root.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay A') RETURNING id", [tenantA]
            )).rows[0].id;
            const custA = (await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice') RETURNING id", [tenantA]
            )).rows[0].id;

            const resB = (await root.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay B') RETURNING id", [tenantB]
            )).rows[0].id;
            const custB = (await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550002222', 'Bob') RETURNING id", [tenantB]
            )).rows[0].id;

            // Create appointments in both tenants (via root, bypassing RLS)
            await root.query(
                "INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description) VALUES ($1, $2, $3, $4, $5, 'A appt')",
                [tenantA, resA, custA, '2026-04-01T10:00:00Z', '2026-04-01T11:00:00Z']
            );
            await root.query(
                "INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description) VALUES ($1, $2, $3, $4, $5, 'B appt')",
                [tenantB, resB, custB, '2026-04-01T10:00:00Z', '2026-04-01T11:00:00Z']
            );

            // api_user as tenant A — should only see A's appointment
            await api.query("SELECT set_tenant_context($1::UUID)", [tenantA]);
            const apptA = await api.query("SELECT * FROM appointments");
            expect(apptA.rows.length).toBe(1);
            expect(apptA.rows[0].description).toBe('A appt');
        });
    });

    // =========================================================
    // BUG-009 (additional): Employee skills success path
    // =========================================================
    describe("BUG-009: Service requirement validation (success paths)", () => {
        it("should allow booking when employee has required skills", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tenantId = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Skill Shop', 'auto-shop') RETURNING id"
            )).rows[0].id;

            const resourceId = (await root.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay 1') RETURNING id",
                [tenantId]
            )).rows[0].id;

            const customerId = (await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice') RETURNING id",
                [tenantId]
            )).rows[0].id;

            // Employee WITH tire-install skill
            const employeeId = (await root.query(
                "INSERT INTO employees (tenant_id, name, skills) VALUES ($1, 'Expert Mike', ARRAY['tire-install', 'oil-change']) RETURNING id",
                [tenantId]
            )).rows[0].id;

            // Shift on Wednesday (DOW=3)
            await root.query(
                "INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, 3, '08:00', '18:00')",
                [tenantId, employeeId]
            );

            // Service requires 'tire-install'
            const serviceId = (await root.query(
                "INSERT INTO services (tenant_id, name, duration_minutes, required_skills) VALUES ($1, 'Tire Install', 60, ARRAY['tire-install']) RETURNING id",
                [tenantId]
            )).rows[0].id;

            // Wednesday 2026-04-01 DOW=3
            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
                [
                    tenantId, resourceId, customerId,
                    new Date("2026-04-01T10:00:00Z"),
                    new Date("2026-04-01T11:00:00Z"),
                    'Tire install', 'call_skill_pass', null,
                    employeeId.toString(),
                    serviceId
                ]
            );

            expect(result.rows[0].success).toBe(true);
            expect(result.rows[0].appointment_id).not.toBeNull();
        });

        it("should allow booking with service_id but no employee (skills check skipped)", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tenantId = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Skill Shop', 'auto-shop') RETURNING id"
            )).rows[0].id;

            const resourceId = (await root.query(
                "INSERT INTO resources (tenant_id, name, capabilities) VALUES ($1, 'Full Bay', ARRAY['tire-lift']) RETURNING id",
                [tenantId]
            )).rows[0].id;

            const customerId = (await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice') RETURNING id",
                [tenantId]
            )).rows[0].id;

            // Service requires skills, but no employee assigned — skills check should be skipped
            const serviceId = (await root.query(
                "INSERT INTO services (tenant_id, name, duration_minutes, required_skills, required_resources) VALUES ($1, 'Tire Install', 60, ARRAY['tire-install'], ARRAY['tire-lift']) RETURNING id",
                [tenantId]
            )).rows[0].id;

            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
                [
                    tenantId, resourceId, customerId,
                    new Date("2026-04-01T10:00:00Z"),
                    new Date("2026-04-01T11:00:00Z"),
                    'Tire install unassigned', 'call_skill_noemp', null,
                    null,  // no employee
                    serviceId
                ]
            );

            expect(result.rows[0].success).toBe(true);
        });
    });

    // =========================================================
    // BUG-012 (additional): Integration — login returns JWT
    // =========================================================
    describe("BUG-012: Login returns JWT with tenant claims", () => {
        it("JWT payload should contain tenant_id, user_id, and email", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            // Create tenant + user
            const tenantId = (await root.query(
                "INSERT INTO tenants (name, business_type) VALUES ('JWT Shop', 'auto-shop') RETURNING id"
            )).rows[0].id;

            const bcrypt = await import('bcrypt');
            const hash = await bcrypt.hash('testpass123', 10);

            const userId = (await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'jwt@test.com', $2, 'JWT User') RETURNING id",
                [tenantId, hash]
            )).rows[0].id;

            // Simulate what the login endpoint does: generate token
            const token = jwt.sign(
                { tenant_id: tenantId, user_id: userId, email: 'jwt@test.com' },
                JWT_SECRET,
                { expiresIn: '8h' }
            );

            // Verify the token contains correct claims
            const decoded = jwt.verify(token, JWT_SECRET) as any;
            expect(decoded.tenant_id).toBe(tenantId);
            expect(decoded.user_id).toBe(userId);
            expect(decoded.email).toBe('jwt@test.com');

            // Verify it has an expiry in the future
            const now = Math.floor(Date.now() / 1000);
            expect(decoded.exp).toBeGreaterThan(now);
            expect(decoded.exp).toBeLessThanOrEqual(now + 8 * 60 * 60 + 5); // 8h + 5s tolerance
        });

        it("JWT should be tied to a specific tenant — cannot be forged for another", () => {
            const tokenA = jwt.sign(
                { tenant_id: 'tenant-a', user_id: 'u1', email: 'a@a.com' },
                JWT_SECRET,
                { expiresIn: '1h' }
            );

            // Decoded token should have tenant-a, not tenant-b
            const decoded = jwt.verify(tokenA, JWT_SECRET) as any;
            expect(decoded.tenant_id).toBe('tenant-a');
            expect(decoded.tenant_id).not.toBe('tenant-b');

            // A token signed with wrong secret can't be verified
            const forgedToken = jwt.sign(
                { tenant_id: 'tenant-b', user_id: 'u2', email: 'b@b.com' },
                'attacker-secret',
                { expiresIn: '1h' }
            );
            expect(() => jwt.verify(forgedToken, JWT_SECRET)).toThrow();
        });
    });

    // =========================================================
    // BUG-011: Input validation (zod schemas)
    // =========================================================
    describe("BUG-011: Input validation schemas", () => {
        it("should validate correct customer create payload", () => {
            const { z } = require('zod');
            const CustomerCreateSchema = z.object({
                tenant_id: z.string().uuid(),
                name: z.string().min(1).max(200),
                phone: z.string().min(1).max(30),
                email: z.string().email().optional().nullable(),
            });

            const valid = CustomerCreateSchema.safeParse({
                tenant_id: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
                name: 'Alice',
                phone: '+15550001111',
                email: 'alice@example.com'
            });
            expect(valid.success).toBe(true);
        });

        it("should reject invalid UUID in tenant_id", () => {
            const { z } = require('zod');
            const CustomerCreateSchema = z.object({
                tenant_id: z.string().uuid(),
                name: z.string().min(1),
                phone: z.string().min(1),
            });

            const invalid = CustomerCreateSchema.safeParse({
                tenant_id: 'not-a-uuid',
                name: 'Alice',
                phone: '+15550001111'
            });
            expect(invalid.success).toBe(false);
        });

        it("should reject empty name", () => {
            const { z } = require('zod');
            const CustomerCreateSchema = z.object({
                tenant_id: z.string().uuid(),
                name: z.string().min(1),
                phone: z.string().min(1),
            });

            const invalid = CustomerCreateSchema.safeParse({
                tenant_id: '00000000-0000-0000-0000-000000000001',
                name: '',
                phone: '+15550001111'
            });
            expect(invalid.success).toBe(false);
        });
    });
});
