import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getRootClient, getApiClient, clearDB, setupBasicTenant } from "./test-utils";
import { Client } from "pg";

describe("Critical Bug Fixes (BUG-001, BUG-002, BUG-006)", () => {
    let root: Client;
    let api: Client;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            root = await getRootClient();
            api = await getApiClient();
        } catch (err) {
            dbAvailable = false;
            console.warn("[critical-bugs.test] Skipping DB tests - connection failed", err);
        }
    });

    afterAll(async () => {
        if (dbAvailable) {
            if (root) await root.end();
            if (api) await api.end();
        }
    });

    // =========================================================
    // BUG-001: Shift timezone - uses tenant TZ, not hardcoded UTC
    // =========================================================
    describe("BUG-001: Shift timezone validation", () => {
        it("should validate shifts using tenant timezone, not UTC", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            // Create tenant in America/New_York (UTC-5 in winter)
            const tRes = await root.query(
                "INSERT INTO tenants (name, business_type, timezone) VALUES ('Eastern Shop', 'auto-shop', 'America/New_York') RETURNING id;"
            );
            const tenantId = tRes.rows[0].id;

            const rRes = await root.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay 1') RETURNING id;",
                [tenantId]
            );
            const resourceId = rRes.rows[0].id;

            const cRes = await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice') RETURNING id;",
                [tenantId]
            );
            const customerId = cRes.rows[0].id;

            // Create employee with shift: Monday 9 AM - 5 PM (local time)
            const eRes = await root.query(
                "INSERT INTO employees (tenant_id, name, skills) VALUES ($1, 'Mike', ARRAY['oil-change']) RETURNING id;",
                [tenantId]
            );
            const employeeId = eRes.rows[0].id;

            // Monday = day_of_week 1
            await root.query(
                "INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, 1, '09:00', '17:00');",
                [tenantId, employeeId]
            );

            // Book for Monday 10 AM - 11 AM Eastern (= 15:00 - 16:00 UTC)
            // This should SUCCEED because 10 AM Eastern is within 9-5 Eastern shift
            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9);",
                [
                    tenantId, resourceId, customerId,
                    new Date("2026-03-02T15:00:00Z"), // Monday 10 AM ET
                    new Date("2026-03-02T16:00:00Z"), // Monday 11 AM ET
                    'Oil change', 'call_tz_001', null,
                    employeeId.toString()
                ]
            );

            expect(result.rows[0].success).toBe(true);
            expect(result.rows[0].appointment_id).not.toBeNull();
        });

        it("should reject booking outside shift hours in tenant timezone", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            // Create tenant in America/New_York
            const tRes = await root.query(
                "INSERT INTO tenants (name, business_type, timezone) VALUES ('Eastern Shop', 'auto-shop', 'America/New_York') RETURNING id;"
            );
            const tenantId = tRes.rows[0].id;

            const rRes = await root.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay 1') RETURNING id;",
                [tenantId]
            );
            const resourceId = rRes.rows[0].id;

            const cRes = await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice') RETURNING id;",
                [tenantId]
            );
            const customerId = cRes.rows[0].id;

            const eRes = await root.query(
                "INSERT INTO employees (tenant_id, name, skills) VALUES ($1, 'Mike', ARRAY['oil-change']) RETURNING id;",
                [tenantId]
            );
            const employeeId = eRes.rows[0].id;

            // Monday shift: 9 AM - 5 PM local
            await root.query(
                "INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, 1, '09:00', '17:00');",
                [tenantId, employeeId]
            );

            // Book for Monday 6 PM Eastern (= 23:00 UTC) — OUTSIDE shift
            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9);",
                [
                    tenantId, resourceId, customerId,
                    new Date("2026-03-02T23:00:00Z"), // Monday 6 PM ET
                    new Date("2026-03-03T00:00:00Z"), // Monday 7 PM ET
                    'Late oil change', 'call_tz_002', null,
                    employeeId.toString()
                ]
            );

            expect(result.rows[0].success).toBe(false);
            expect(result.rows[0].error_message).toBe('Employee is not on shift during this time');
        });

        it("should handle UTC-crossing correctly (evening in local TZ is next day in UTC)", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            // Create tenant in America/Los_Angeles (UTC-8 in winter)
            const tRes = await root.query(
                "INSERT INTO tenants (name, business_type, timezone) VALUES ('West Coast Shop', 'auto-shop', 'America/Los_Angeles') RETURNING id;"
            );
            const tenantId = tRes.rows[0].id;

            const rRes = await root.query(
                "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay 1') RETURNING id;",
                [tenantId]
            );
            const resourceId = rRes.rows[0].id;

            const cRes = await root.query(
                "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice') RETURNING id;",
                [tenantId]
            );
            const customerId = cRes.rows[0].id;

            const eRes = await root.query(
                "INSERT INTO employees (tenant_id, name, skills) VALUES ($1, 'Steve', ARRAY['tire-install']) RETURNING id;",
                [tenantId]
            );
            const employeeId = eRes.rows[0].id;

            // Monday shift: 9 AM - 9 PM local (Pacific)
            await root.query(
                "INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, 1, '09:00', '21:00');",
                [tenantId, employeeId]
            );

            // Book for Monday 8 PM Pacific = Tuesday 4 AM UTC
            // With old UTC bug, this would be Tuesday (DOW=2) at 4 AM — no Monday shift found
            // With fix, this is correctly Monday (DOW=1) at 8 PM Pacific — within shift
            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9);",
                [
                    tenantId, resourceId, customerId,
                    new Date("2026-03-03T04:00:00Z"), // Monday 8 PM PT = Tue 4 AM UTC
                    new Date("2026-03-03T05:00:00Z"), // Monday 9 PM PT = Tue 5 AM UTC
                    'Late tire install', 'call_tz_003', null,
                    employeeId.toString()
                ]
            );

            expect(result.rows[0].success).toBe(true);
            expect(result.rows[0].appointment_id).not.toBeNull();
        });
    });

    // =========================================================
    // BUG-002: users.email per-tenant uniqueness
    // =========================================================
    describe("BUG-002: Per-tenant email uniqueness", () => {
        it("should allow the same email in different tenants", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tARes = await root.query("INSERT INTO tenants (name, business_type) VALUES ('Shop A', 'auto-shop') RETURNING id;");
            const tenantA = tARes.rows[0].id;
            const tBRes = await root.query("INSERT INTO tenants (name, business_type) VALUES ('Shop B', 'salon') RETURNING id;");
            const tenantB = tBRes.rows[0].id;

            // Insert same email in both tenants — should succeed
            await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'admin@example.com', '$2b$10$fakehash', 'Admin A');",
                [tenantA]
            );

            // This should NOT throw — same email, different tenant
            const result = await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'admin@example.com', '$2b$10$fakehash', 'Admin B') RETURNING id;",
                [tenantB]
            );

            expect(result.rows[0].id).toBeDefined();
        });

        it("should still reject duplicate email within the same tenant", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tRes = await root.query("INSERT INTO tenants (name, business_type) VALUES ('Shop A', 'auto-shop') RETURNING id;");
            const tenantA = tRes.rows[0].id;

            await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'admin@example.com', '$2b$10$fakehash', 'Admin A');",
                [tenantA]
            );

            // Same tenant, same email — should fail
            await expect(
                root.query(
                    "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'admin@example.com', '$2b$10$fakehash', 'Duplicate');",
                    [tenantA]
                )
            ).rejects.toThrow(/unique/i);
        });
    });

    // =========================================================
    // BUG-006: Users table RLS uses app.current_tenant_id
    // =========================================================
    describe("BUG-006: Users RLS uses app.current_tenant_id", () => {
        it("should isolate users by tenant using app.current_tenant_id", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tenantA = (await root.query("INSERT INTO tenants (name, business_type) VALUES ('A', 't') RETURNING id;")).rows[0].id;
            const tenantB = (await root.query("INSERT INTO tenants (name, business_type) VALUES ('B', 't') RETURNING id;")).rows[0].id;

            await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'user@a.com', '$2b$10$fakehash', 'User A');",
                [tenantA]
            );
            await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'user@b.com', '$2b$10$fakehash', 'User B');",
                [tenantB]
            );

            // As tenant A, should only see User A
            await api.query("SELECT set_tenant_context($1::UUID)", [tenantA]);
            const resA = await api.query("SELECT * FROM users");
            expect(resA.rowCount).toBe(1);
            expect(resA.rows[0].full_name).toBe('User A');

            // As tenant B, should only see User B
            await api.query("SELECT set_tenant_context($1::UUID)", [tenantB]);
            const resB = await api.query("SELECT * FROM users");
            expect(resB.rowCount).toBe(1);
            expect(resB.rows[0].full_name).toBe('User B');
        });

        it("should prevent cross-tenant user access", async () => {
            if (!dbAvailable) return;
            await clearDB(root);

            const tenantA = (await root.query("INSERT INTO tenants (name, business_type) VALUES ('A', 't') RETURNING id;")).rows[0].id;
            const tenantB = (await root.query("INSERT INTO tenants (name, business_type) VALUES ('B', 't') RETURNING id;")).rows[0].id;

            const userB = (await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'secret@b.com', '$2b$10$fakehash', 'Secret User') RETURNING id;",
                [tenantB]
            )).rows[0].id;

            // Tenant A should not be able to update Tenant B's user
            await api.query("SELECT set_tenant_context($1::UUID)", [tenantA]);
            const updateRes = await api.query("UPDATE users SET full_name = 'Hacked' WHERE id = $1", [userB]);
            expect(updateRes.rowCount).toBe(0);

            // Verify user is unchanged
            await api.query("SELECT set_tenant_context($1::UUID)", [tenantB]);
            const checkRes = await api.query("SELECT full_name FROM users WHERE id = $1", [userB]);
            expect(checkRes.rows[0].full_name).toBe('Secret User');
        });
    });
});
