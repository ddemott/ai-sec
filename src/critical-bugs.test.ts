import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, getApiClient, clearDB, createTenant, createResource, createEmployee, createScheduleEntry, createCustomerFull } from "./test-utils";
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

    beforeEach(async () => {
        if (!dbAvailable) return;
        await clearDB(root);
    });

    // =========================================================
    // BUG-001: Shift timezone - uses tenant TZ, not hardcoded UTC
    // =========================================================
    describe("BUG-001: Shift timezone validation", () => {
        it("should validate shifts using tenant timezone, not UTC", async () => {
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "Eastern Shop", "auto-shop", "America/New_York");
            const resourceId = await createResource(root, tenantId, "Bay 1");
            const customerId = await createCustomerFull(root, tenantId, "+15550001111", "Alice");
            const employeeId = await createEmployee(root, tenantId, "Mike", ["oil-change"]);
            // 2026-03-02 is a Monday. Booking RPCs read only employee_schedule.
            await createScheduleEntry(root, tenantId, employeeId, '2026-03-02', '09:00', '17:00');

            // Book for Monday 10 AM - 11 AM Eastern (= 15:00 - 16:00 UTC)
            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9);",
                [
                    tenantId, resourceId, customerId,
                    new Date("2026-03-02T15:00:00Z"),
                    new Date("2026-03-02T16:00:00Z"),
                    'Oil change', 'call_tz_001', null,
                    employeeId.toString()
                ]
            );

            expect(result.rows[0].success).toBe(true);
            expect(result.rows[0].appointment_id).not.toBeNull();
        });

        it("should reject booking outside shift hours in tenant timezone", async () => {
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "Eastern Shop", "auto-shop", "America/New_York");
            const resourceId = await createResource(root, tenantId, "Bay 1");
            const customerId = await createCustomerFull(root, tenantId, "+15550001111", "Alice");
            const employeeId = await createEmployee(root, tenantId, "Mike", ["oil-change"]);
            // 2026-03-02 is a Monday. Booking RPCs read only employee_schedule.
            await createScheduleEntry(root, tenantId, employeeId, '2026-03-02', '09:00', '17:00');

            // Book for Monday 6 PM Eastern (= 23:00 UTC) — OUTSIDE shift
            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9);",
                [
                    tenantId, resourceId, customerId,
                    new Date("2026-03-02T23:00:00Z"),
                    new Date("2026-03-03T00:00:00Z"),
                    'Late oil change', 'call_tz_002', null,
                    employeeId.toString()
                ]
            );

            expect(result.rows[0].success).toBe(false);
            expect(result.rows[0].error_message).toBe('Employee is not on shift during this time');
        });

        it("should handle UTC-crossing correctly (evening in local TZ is next day in UTC)", async () => {
            if (!dbAvailable) return;

            const tenantId = await createTenant(root, "West Coast Shop", "auto-shop", "America/Los_Angeles");
            const resourceId = await createResource(root, tenantId, "Bay 1");
            const customerId = await createCustomerFull(root, tenantId, "+15550001111", "Alice");
            const employeeId = await createEmployee(root, tenantId, "Steve", ["tire-install"]);
            // Booking is local 2026-03-02 (Monday 8 PM Pacific). Seed
            // employee_schedule for that local date.
            await createScheduleEntry(root, tenantId, employeeId, '2026-03-02', '09:00', '21:00');

            // Book for Monday 8 PM Pacific = Tuesday 4 AM UTC
            const result = await root.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9);",
                [
                    tenantId, resourceId, customerId,
                    new Date("2026-03-03T04:00:00Z"),
                    new Date("2026-03-03T05:00:00Z"),
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

            const tenantA = await createTenant(root, "Shop A", "auto-shop");
            const tenantB = await createTenant(root, "Shop B", "salon");

            await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'admin@example.com', '$2b$10$fakehash', 'Admin A');",
                [tenantA]
            );

            const result = await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'admin@example.com', '$2b$10$fakehash', 'Admin B') RETURNING id;",
                [tenantB]
            );

            expect(result.rows[0].id).toBeDefined();
        });

        it("should still reject duplicate email within the same tenant", async () => {
            if (!dbAvailable) return;

            const tenantA = await createTenant(root, "Shop A", "auto-shop");

            await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'admin@example.com', '$2b$10$fakehash', 'Admin A');",
                [tenantA]
            );

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

            const tenantA = await createTenant(root, "A", "t");
            const tenantB = await createTenant(root, "B", "t");

            await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'user@a.com', '$2b$10$fakehash', 'User A');",
                [tenantA]
            );
            await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'user@b.com', '$2b$10$fakehash', 'User B');",
                [tenantB]
            );

            await api.query("SELECT set_tenant_context($1::UUID)", [tenantA]);
            const resA = await api.query("SELECT * FROM users");
            expect(resA.rowCount).toBe(1);
            expect(resA.rows[0].full_name).toBe('User A');

            await api.query("SELECT set_tenant_context($1::UUID)", [tenantB]);
            const resB = await api.query("SELECT * FROM users");
            expect(resB.rowCount).toBe(1);
            expect(resB.rows[0].full_name).toBe('User B');
        });

        it("should prevent cross-tenant user access", async () => {
            if (!dbAvailable) return;

            const tenantA = await createTenant(root, "A", "t");
            const tenantB = await createTenant(root, "B", "t");

            const userB = (await root.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'secret@b.com', '$2b$10$fakehash', 'Secret User') RETURNING id;",
                [tenantB]
            )).rows[0].id;

            await api.query("SELECT set_tenant_context($1::UUID)", [tenantA]);
            const updateRes = await api.query("UPDATE users SET full_name = 'Hacked' WHERE id = $1", [userB]);
            expect(updateRes.rowCount).toBe(0);

            await api.query("SELECT set_tenant_context($1::UUID)", [tenantB]);
            const checkRes = await api.query("SELECT full_name FROM users WHERE id = $1", [userB]);
            expect(checkRes.rows[0].full_name).toBe('Secret User');
        });
    });
});
