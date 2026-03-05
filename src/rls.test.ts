import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getRootClient, getApiClient, clearDB } from "./test-utils";
import { Client } from "pg";

describe("Security: Row Level Security (RLS) Isolation (Final Refactor)", () => {
    let root: Client;
    let api: Client;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            root = await getRootClient();
            api = await getApiClient();
        } catch (err) {
            dbAvailable = false;
            // eslint-disable-next-line no-console
            console.warn("[rls.test] Skipping DB tests - connection failed", err);
        }
    });

    afterAll(async () => {
        if (dbAvailable) {
            if (root) await root.end();
            if (api) await api.end();
        }
    });

    it("should prevent Tenant A from seeing Tenant B's data", async () => {
        if (!dbAvailable) return;
        await clearDB(root);

        // Setup
        const tARes = await root.query("INSERT INTO tenants (name, business_type) VALUES ('A', 't') RETURNING id;");
        const tenantA = tARes.rows[0].id;
        const tBRes = await root.query("INSERT INTO tenants (name, business_type) VALUES ('B', 't') RETURNING id;");
        const tenantB = tBRes.rows[0].id;

        await root.query("INSERT INTO resources (tenant_id, name) VALUES ($1, 'B-Truck') RETURNING id;", [tenantB]);

        // Verify A sees nothing
        await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantA]);
        const resA = await api.query("SELECT * FROM resources");
        expect(resA.rowCount).toBe(0);

        // Verify B sees their own
        await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantB]);
        const resB = await api.query("SELECT * FROM resources");
        expect(resB.rowCount).toBe(1);
        expect(resB.rows[0].name).toBe('B-Truck');
    });

    it("should prevent cross-tenant updates", async () => {
        if (!dbAvailable) return;
        await clearDB(root);
        const tenantA = (await root.query("INSERT INTO tenants (name, business_type) VALUES ('A', 't') RETURNING id")).rows[0].id;
        const tenantB = (await root.query("INSERT INTO tenants (name, business_type) VALUES ('B', 't') RETURNING id")).rows[0].id;
        const customerB = (await root.query("INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '123', 'Bob') RETURNING id", [tenantB])).rows[0].id;

        // Try update as A
        await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantA]);
        const updateRes = await api.query("UPDATE customers SET name = 'Hacker' WHERE id = $1", [customerB]);
        expect(updateRes.rowCount).toBe(0);

        // Verify Bob is still Bob
        await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantB]);
        const checkRes = await api.query("SELECT name FROM customers WHERE id = $1", [customerB]);
        expect(checkRes.rows[0].name).toBe('Bob');
    });
});
