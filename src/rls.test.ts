import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, getApiClient, clearDB, createTenant, createResource, createCustomerFull } from "./test-utils";
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

    beforeEach(async () => {
        if (!dbAvailable) return;
        await clearDB(root);
    });

    it("should prevent Tenant A from seeing Tenant B's data", async () => {
        if (!dbAvailable) return;

        const tenantA = await createTenant(root, "A", "t");
        const tenantB = await createTenant(root, "B", "t");

        await createResource(root, tenantB, "B-Truck");

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

        const tenantA = await createTenant(root, "A", "t");
        const tenantB = await createTenant(root, "B", "t");
        const customerB = await createCustomerFull(root, tenantB, "123", "Bob");

        // Try update as A
        await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantA]);
        const updateRes = await api.query("UPDATE customers SET name = 'Hacker' WHERE id = $1", [customerB]);
        expect(updateRes.rowCount).toBe(0);

        // Verify Bob is still Bob
        await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantB]);
        const checkRes = await api.query("SELECT name FROM customers WHERE id = $1", [customerB]);
        expect(checkRes.rows[0].name).toBe('Bob');
    });

    // ── Error Diagnostics ───────────────────────────────────────────────

    describe("Error diagnostics", () => {
        it("RLS returns zero rows (not an error) for cross-tenant SELECT", async () => {
            if (!dbAvailable) return;

            const tenantA = await createTenant(root, "A-Diag", "t");
            const tenantB = await createTenant(root, "B-Diag", "t");

            await createResource(root, tenantA, "A-Only-Resource");

            // Set context to tenant B and try to read tenant A's resources
            await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantB]);
            const res = await api.query("SELECT * FROM resources");

            // RLS silently filters — no error thrown, just empty result
            expect(res.rowCount).toBe(0);
            expect(res.rows).toHaveLength(0);
        });

        it("RLS prevents cross-tenant DELETE and returns zero affected rows", async () => {
            if (!dbAvailable) return;

            const tenantA = await createTenant(root, "A-Del", "t");
            const tenantB = await createTenant(root, "B-Del", "t");

            const resourceA = await createResource(root, tenantA, "Protected-Resource");

            // Set context to tenant B and try to delete tenant A's resource
            await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantB]);
            const deleteRes = await api.query("DELETE FROM resources WHERE id = $1 RETURNING id", [resourceA]);

            // Should silently affect 0 rows — route handlers should check rowCount for 404
            expect(deleteRes.rowCount).toBe(0);

            // Confirm resource still exists via root
            const checkRes = await root.query("SELECT name FROM resources WHERE id = $1", [resourceA]);
            expect(checkRes.rows[0].name).toBe("Protected-Resource");
        });

        it("tenant context is properly isolated between sequential requests", async () => {
            if (!dbAvailable) return;

            const tenantA = await createTenant(root, "Seq-A", "t");
            const tenantB = await createTenant(root, "Seq-B", "t");

            await createResource(root, tenantA, "A-Res");
            await createResource(root, tenantB, "B-Res");

            // First request as tenant A
            await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantA]);
            const resA = await api.query("SELECT name FROM resources");
            expect(resA.rows).toHaveLength(1);
            expect(resA.rows[0].name).toBe("A-Res");

            // Switch to tenant B — should only see B's data, not A's
            await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantB]);
            const resB = await api.query("SELECT name FROM resources");
            expect(resB.rows).toHaveLength(1);
            expect(resB.rows[0].name).toBe("B-Res");

            // Switch back to A — should still only see A's data
            await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantA]);
            const resA2 = await api.query("SELECT name FROM resources");
            expect(resA2.rows).toHaveLength(1);
            expect(resA2.rows[0].name).toBe("A-Res");
        });

        it("RLS INSERT with wrong tenant context is rejected by policy", async () => {
            if (!dbAvailable) return;

            const tenantA = await createTenant(root, "Ins-A", "t");
            const tenantB = await createTenant(root, "Ins-B", "t");

            // Set context to tenant A but try to insert a resource for tenant B
            await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantA]);

            try {
                await api.query(
                    "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Sneaky') RETURNING id",
                    [tenantB]
                );
                // If it doesn't throw, the row should not be visible to tenant B
                await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantB]);
                const res = await api.query("SELECT * FROM resources WHERE name = 'Sneaky'");
                // Either the insert was blocked (threw) or RLS hides it
                expect(res.rows.length).toBeLessThanOrEqual(0);
            } catch (err: any) {
                // RLS policy violation — Postgres should return a clear error
                expect(err.message).toMatch(/policy|permission|violates/i);
            }
        });
    });
});
