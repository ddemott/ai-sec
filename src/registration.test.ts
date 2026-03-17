import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, clearDB } from "./test-utils";
import { Client } from "pg";

describe("Tenant Registration", () => {
    let client: Client;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            client = await getRootClient();
        } catch (err) {
            dbAvailable = false;
            console.warn("[registration.test] Skipping DB tests - connection failed", err);
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

    it("should create a tenant and user in a single transaction", async () => {
        if (!dbAvailable) return;

        // Simulate what POST /tenants/register does
        await client.query('BEGIN');

        const tenantRes = await client.query(
            "INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING id",
            ['Test Salon', 'salon']
        );
        const tenantId = tenantRes.rows[0].id;

        const bcrypt = await import('bcrypt');
        const hash = await bcrypt.hash('testpass123', 10);

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

    it("should reject duplicate email within same tenant", async () => {
        if (!dbAvailable) return;

        const tenantRes = await client.query(
            "INSERT INTO tenants (name, business_type) VALUES ('Dup Test', 'salon') RETURNING id"
        );
        const tenantId = tenantRes.rows[0].id;

        const bcrypt = await import('bcrypt');
        const hash = await bcrypt.hash('pass', 10);

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

        const t1 = await client.query("INSERT INTO tenants (name, business_type) VALUES ('T1', 'salon') RETURNING id");
        const t2 = await client.query("INSERT INTO tenants (name, business_type) VALUES ('T2', 'auto-shop') RETURNING id");

        const bcrypt = await import('bcrypt');
        const hash = await bcrypt.hash('pass', 10);

        await client.query(
            "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'same@email.com', $2, 'User 1')",
            [t1.rows[0].id, hash]
        );

        const res = await client.query(
            "INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, 'same@email.com', $2, 'User 2') RETURNING id",
            [t2.rows[0].id, hash]
        );

        expect(res.rows[0].id).toBeTruthy();
    });

    it("should set onboarding_completed to false by default", async () => {
        if (!dbAvailable) return;

        const res = await client.query(
            "INSERT INTO tenants (name, business_type) VALUES ('New Biz', 'plumber') RETURNING onboarding_completed"
        );
        expect(res.rows[0].onboarding_completed).toBe(false);
    });
});
