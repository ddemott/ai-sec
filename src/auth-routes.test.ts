import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, clearDB } from "./test-utils";
import { Client } from "pg";

describe("Auth Routes - Database Level", () => {
    let client: Client;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            client = await getRootClient();
        } catch (err) {
            dbAvailable = false;
            console.warn("[auth-routes.test] Skipping DB tests - connection failed", err);
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
    });

    // ── Login ────────────────────────────────────────────────────────────

    describe("Login", () => {
        it("should verify correct password with bcrypt.compare", async () => {
            if (!dbAvailable) return;

            const bcrypt = await import("bcrypt");
            const password = "securePass123";
            const hash = await bcrypt.hash(password, 10);

            const tenantRes = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ('LoginTest', 'salon') RETURNING id"
            );
            const tenantId = tenantRes.rows[0].id;

            await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)",
                [tenantId, "login@test.com", hash, "Test User"]
            );

            // Simulate the login query
            const res = await client.query("SELECT * FROM users WHERE email = $1", ["login@test.com"]);
            expect(res.rows).toHaveLength(1);

            const user = res.rows[0];
            const match = await bcrypt.compare(password, user.password_hash);
            expect(match).toBe(true);
            expect(user.tenant_id).toBe(tenantId);
            expect(user.full_name).toBe("Test User");
        });

        it("should reject wrong password with bcrypt.compare", async () => {
            if (!dbAvailable) return;

            const bcrypt = await import("bcrypt");
            const hash = await bcrypt.hash("correctPassword", 10);

            const tenantRes = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ('LoginTest2', 'salon') RETURNING id"
            );
            const tenantId = tenantRes.rows[0].id;

            await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)",
                [tenantId, "wrong@test.com", hash, "Wrong Pass User"]
            );

            const res = await client.query("SELECT * FROM users WHERE email = $1", ["wrong@test.com"]);
            const user = res.rows[0];

            const match = await bcrypt.compare("wrongPassword", user.password_hash);
            expect(match).toBe(false);
        });

        it("should return no user for non-existent email", async () => {
            if (!dbAvailable) return;

            const res = await client.query("SELECT * FROM users WHERE email = $1", ["noone@test.com"]);
            expect(res.rows).toHaveLength(0);
        });
    });

    // ── Registration ─────────────────────────────────────────────────────

    describe("Registration", () => {
        it("should create tenant and user in a transaction", async () => {
            if (!dbAvailable) return;

            const bcrypt = await import("bcrypt");
            const password = "newUser123";
            const hash = await bcrypt.hash(password, 10);

            await client.query("BEGIN");

            const tenantRes = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING id",
                ["New Business", "mobile-tire"]
            );
            const tenantId = tenantRes.rows[0].id;

            const userRes = await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4) RETURNING id, full_name",
                [tenantId, "new@biz.com", hash, "Owner Name"]
            );

            await client.query("COMMIT");

            expect(tenantId).toBeDefined();
            expect(userRes.rows[0].id).toBeDefined();
            expect(userRes.rows[0].full_name).toBe("Owner Name");

            // Verify both exist after commit
            const tenantCheck = await client.query("SELECT * FROM tenants WHERE id = $1", [tenantId]);
            const userCheck = await client.query("SELECT * FROM users WHERE tenant_id = $1", [tenantId]);
            expect(tenantCheck.rows).toHaveLength(1);
            expect(userCheck.rows).toHaveLength(1);
        });

        it("should apply template defaults (system_prompt populated) for known business_type", async () => {
            if (!dbAvailable) return;

            const tenantRes = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING *",
                ["Template Test", "mobile-tire"]
            );

            const tenant = tenantRes.rows[0];
            expect(tenant.system_prompt).toBeTruthy();
            expect(tenant.system_prompt).toContain("tire");
            expect(tenant.voice_id).toBeTruthy();
            expect(tenant.first_message).toBeTruthy();
        });

        it("should create default resource for known business_type", async () => {
            if (!dbAvailable) return;

            const tenantRes = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING id",
                ["Resource Test", "salon"]
            );
            const tenantId = tenantRes.rows[0].id;

            const resources = await client.query(
                "SELECT * FROM resources WHERE tenant_id = $1",
                [tenantId]
            );

            expect(resources.rows).toHaveLength(1);
            expect(resources.rows[0].name).toBe("Styling Station 1");
        });

        it("should reject duplicate email within same tenant (per-tenant unique constraint)", async () => {
            if (!dbAvailable) return;

            const bcrypt = await import("bcrypt");
            const hash = await bcrypt.hash("pass123", 10);

            const t1Res = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Biz1', 'salon') RETURNING id"
            );
            const tenantId = t1Res.rows[0].id;

            await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)",
                [tenantId, "dupe@test.com", hash, "First User"]
            );

            // Same email within same tenant should fail (unique on tenant_id, email)
            await expect(
                client.query(
                    "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)",
                    [tenantId, "dupe@test.com", hash, "Second User"]
                )
            ).rejects.toThrow();
        });

        it("should detect duplicate email across tenants via application-level check", async () => {
            if (!dbAvailable) return;

            // The registration route checks globally: SELECT id FROM users WHERE email = $1
            // even though DB constraint is per-tenant. This is the app-level guard.
            const bcrypt = await import("bcrypt");
            const hash = await bcrypt.hash("pass123", 10);

            const t1Res = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ('Biz1', 'salon') RETURNING id"
            );
            await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)",
                [t1Res.rows[0].id, "crosscheck@test.com", hash, "First User"]
            );

            // Application-level check used by /register
            const existing = await client.query("SELECT id FROM users WHERE email = $1", ["crosscheck@test.com"]);
            expect(existing.rows.length).toBeGreaterThan(0);
        });

        it("should detect existing email before registration (application-level check)", async () => {
            if (!dbAvailable) return;

            const bcrypt = await import("bcrypt");
            const hash = await bcrypt.hash("pass123", 10);

            const t1Res = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ('ExistingBiz', 'salon') RETURNING id"
            );
            await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)",
                [t1Res.rows[0].id, "exists@test.com", hash, "Existing User"]
            );

            // Simulate the registration check query
            const existingUser = await client.query(
                "SELECT id FROM users WHERE email = $1",
                ["exists@test.com"]
            );
            expect(existingUser.rows.length).toBeGreaterThan(0);

            // For a new email, should return empty
            const newUser = await client.query(
                "SELECT id FROM users WHERE email = $1",
                ["fresh@test.com"]
            );
            expect(newUser.rows).toHaveLength(0);
        });

        it("should default onboarding_completed to false", async () => {
            if (!dbAvailable) return;

            const tenantRes = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING *",
                ["Onboarding Test", "auto-shop"]
            );

            expect(tenantRes.rows[0].onboarding_completed).toBe(false);
        });

        it("should rollback both tenant and user if user creation fails", async () => {
            if (!dbAvailable) return;

            const countBefore = await client.query("SELECT count(*) FROM tenants");
            const tenantCountBefore = parseInt(countBefore.rows[0].count);

            try {
                await client.query("BEGIN");

                await client.query(
                    "INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING id",
                    ["Rollback Test", "salon"]
                );

                // Force an error by inserting a user with missing required field (password_hash NOT NULL)
                await client.query(
                    "INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, NULL)",
                    ["00000000-0000-0000-0000-000000000000", "fail@test.com"]
                );

                await client.query("COMMIT");
            } catch {
                await client.query("ROLLBACK");
            }

            const countAfter = await client.query("SELECT count(*) FROM tenants");
            const tenantCountAfter = parseInt(countAfter.rows[0].count);

            expect(tenantCountAfter).toBe(tenantCountBefore);
        });
    });
});
