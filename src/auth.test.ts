import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, clearDB, createTenant, createUser, hashPassword } from "./test-utils";
import { Client } from "pg";
import bcrypt from "bcrypt";

describe("Auth - Database Level", () => {
    let client: Client;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            client = await getRootClient();
        } catch (err) {
            dbAvailable = false;
            console.warn("[auth.test] Skipping DB tests - connection failed", err);
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

    // ── Section 1: Login ──────────────────────────────────────────────────

    describe("Login", () => {
        it("should verify correct password with bcrypt.compare", async () => {
            if (!dbAvailable) return;

            const password = "securePass123";
            const hash = await hashPassword(password);

            const tenantId = await createTenant(client, "LoginTest", "salon");

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

            const hash = await hashPassword("correctPassword");

            const tenantId = await createTenant(client, "LoginTest2", "salon");

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

    // ── Section 2: Registration ───────────────────────────────────────────

    describe("Registration", () => {
        it("should create tenant and user in a transaction", async () => {
            if (!dbAvailable) return;

            const hash = await hashPassword("newUser123");

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

        it("should create a tenant and user in a single transaction (with template verification)", async () => {
            if (!dbAvailable) return;

            // Simulate what POST /tenants/register does
            await client.query('BEGIN');

            const tenantRes = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING id",
                ['Test Salon', 'salon']
            );
            const tenantId = tenantRes.rows[0].id;

            const hash = await hashPassword('testpass123');

            const userRes = await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4) RETURNING id, tenant_id, email, full_name",
                [tenantId, 'owner@testsalon.com', hash, 'Salon Owner']
            );

            await client.query('COMMIT');

            expect(userRes.rows[0].tenant_id).toBe(tenantId);
            expect(userRes.rows[0].email).toBe('owner@testsalon.com');
            expect(userRes.rows[0].full_name).toBe('Salon Owner');

            // Verify template defaults were applied via trigger
            const tenantCheck = await client.query(
                "SELECT system_prompt, voice_id, first_message FROM tenants WHERE id = $1",
                [tenantId]
            );
            expect(tenantCheck.rows[0].system_prompt).toContain('receptionist');
            expect(tenantCheck.rows[0].voice_id).toBeTruthy();
            expect(tenantCheck.rows[0].first_message).toBeTruthy();

            // Verify default resource was created via trigger
            const resourceCheck = await client.query(
                "SELECT name FROM resources WHERE tenant_id = $1",
                [tenantId]
            );
            expect(resourceCheck.rows[0].name).toBe('Styling Station 1');
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

            const tenantId = await createTenant(client, "Resource Test", "salon");

            const resources = await client.query(
                "SELECT * FROM resources WHERE tenant_id = $1",
                [tenantId]
            );

            expect(resources.rows).toHaveLength(1);
            expect(resources.rows[0].name).toBe("Styling Station 1");
        });
    });

    // ── Section 3: Email Uniqueness ───────────────────────────────────────

    describe("Email Uniqueness", () => {
        it("should reject duplicate email within same tenant (per-tenant unique constraint)", async () => {
            if (!dbAvailable) return;

            const hash = await hashPassword("pass123");
            const tenantId = await createTenant(client, "Biz1", "salon");

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

        it("should reject duplicate email within same tenant (unique constraint message)", async () => {
            if (!dbAvailable) return;

            const tenantId = await createTenant(client, "Dup Test", "salon");
            const hash = await hashPassword("pass");

            await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'dupe@test.com', $2, 'User 1')",
                [tenantId, hash]
            );

            await expect(
                client.query(
                    "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'dupe@test.com', $2, 'User 2')",
                    [tenantId, hash]
                )
            ).rejects.toThrow(/unique/i);
        });

        it("should allow same email across different tenants", async () => {
            if (!dbAvailable) return;

            const t1Id = await createTenant(client, "T1", "salon");
            const t2Id = await createTenant(client, "T2", "auto-shop");

            const hash = await hashPassword("pass");

            await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'same@email.com', $2, 'User 1')",
                [t1Id, hash]
            );

            const res = await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'same@email.com', $2, 'User 2') RETURNING id",
                [t2Id, hash]
            );

            expect(res.rows[0].id).toBeTruthy();
        });

        it("should detect duplicate email across tenants via application-level check", async () => {
            if (!dbAvailable) return;

            const hash = await hashPassword("pass123");
            const t1Id = await createTenant(client, "Biz1", "salon");

            await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)",
                [t1Id, "crosscheck@test.com", hash, "First User"]
            );

            // Application-level check used by /register
            const existing = await client.query("SELECT id FROM users WHERE email = $1", ["crosscheck@test.com"]);
            expect(existing.rows.length).toBeGreaterThan(0);
        });

        it("should detect existing email before registration (application-level check)", async () => {
            if (!dbAvailable) return;

            const hash = await hashPassword("pass123");
            const t1Id = await createTenant(client, "ExistingBiz", "salon");

            await client.query(
                "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)",
                [t1Id, "exists@test.com", hash, "Existing User"]
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
    });

    // ── Section 4: Onboarding ─────────────────────────────────────────────

    describe("Onboarding", () => {
        it("should default onboarding_completed to false", async () => {
            if (!dbAvailable) return;

            const tenantRes = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING *",
                ["Onboarding Test", "auto-shop"]
            );

            expect(tenantRes.rows[0].onboarding_completed).toBe(false);
        });

        it("should set onboarding_completed to false by default (plumber)", async () => {
            if (!dbAvailable) return;

            const res = await client.query(
                "INSERT INTO tenants (name, business_type) VALUES ('New Biz', 'plumber') RETURNING onboarding_completed"
            );
            expect(res.rows[0].onboarding_completed).toBe(false);
        });
    });

    // ── Section 5: Transaction Rollback ───────────────────────────────────

    describe("Transaction Rollback", () => {
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
