import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, getApiClient, clearDB, createTenant, createResource, createCustomerFull, skipIfDbDown } from "./test-utils";
import { Client } from "pg";

describe("Security: Row Level Security (RLS) Isolation (Final Refactor)", () => {
    let root: Client;
    let api: Client;
    let dbAvailable = true;
    beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

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
        // WHO: api_user role with tenant context set to A, attempting to read
        //      a resource owned by tenant B
        // WHAT: SELECT FROM resources returns rowCount=0 because the RLS
        //       policy filters every row whose tenant_id != app.current_tenant_id
        // WHEN: every cross-tenant read attempt — common shape for a misconfigured
        //       JWT, a bug that drops the tenant scope, or a hostile request
        // WHERE: Postgres RLS policies on the resources table; api_user role
        //        is the one routes connect as
        // WHY: this is THE load-bearing tenant-isolation guarantee. Without
        //      this test passing, a regression to FORCE ROW LEVEL SECURITY
        //      or to set_tenant_context() would let any tenant read every
        //      other tenant's data — a hard data leak
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
        // WHO: api_user with tenant A context attempting to UPDATE tenant B's
        //      customer row by guessed UUID
        // WHAT: UPDATE returns rowCount=0; the actual data stays untouched
        // WHEN: hostile or buggy request that knows a UUID but not the tenant
        //       scope — e.g., an admin route that forgot to thread the tenant
        //       check, or a deliberate cross-tenant probe
        // WHERE: RLS UPDATE policy on the customers table
        // WHY: writes are the more dangerous half of the RLS contract. A
        //      passing SELECT test could coexist with a broken UPDATE policy
        //      that silently rewrites another tenant's records — this test
        //      pins the write-side guarantee separately
        if (!dbAvailable) return;

        const tenantA = await createTenant(root, "A", "t");
        const tenantB = await createTenant(root, "B", "t");
        const customerB = await createCustomerFull(root, tenantB, "123", "Bob");

        // Try update as A
        await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantA]);
        const updateRes = await api.query("UPDATE customers SET name = 'Hacker' WHERE customer_id = $1", [customerB]);
        expect(updateRes.rowCount).toBe(0);

        // Verify Bob is still Bob
        await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantB]);
        const checkRes = await api.query("SELECT name FROM customers WHERE customer_id = $1", [customerB]);
        expect(checkRes.rows[0].name).toBe('Bob');
    });

    // ── Error Diagnostics ───────────────────────────────────────────────

    describe("Error diagnostics", () => {
        it("RLS returns zero rows (not an error) for cross-tenant SELECT", async () => {
            // WHO: cross-tenant SELECT attempt — the same shape as the first
            //      test in this file but assertion-focused on the failure mode
            // WHAT: empty rows array, not a thrown Postgres error
            // WHEN: any cross-tenant read; the RLS policy is silent-filter
            //      rather than block-with-error
            // WHERE: Postgres RLS SELECT policy
            // WHY: a regression that flipped to "block with error" would crash
            //      route handlers that aren't expecting an exception (most
            //      handlers expect rowCount=0 on missing data); pinning the
            //      "silent filter" semantics keeps the route layer's
            //      assertRowAffected() guard the right escalation path
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
            // WHO: api_user with tenant B context attempting to DELETE tenant
            //      A's resource by guessed UUID
            // WHAT: DELETE returns rowCount=0; the resource still exists when
            //       checked via the root client
            // WHEN: hostile or buggy DELETE — e.g., a route that forgot to
            //      filter on tenant_id and only relied on row id
            // WHERE: RLS DELETE policy on resources
            // WHY: same pattern as the cross-tenant UPDATE pin — DELETEs are
            //      the most destructive write; the test verifies BOTH that
            //      RLS silently rejects them AND that the data is intact
            //      after the attempt. Route handlers must continue to use
            //      assertRowAffected() so a 0-row DELETE returns 404, not
            //      silent success
            if (!dbAvailable) return;

            const tenantA = await createTenant(root, "A-Del", "t");
            const tenantB = await createTenant(root, "B-Del", "t");

            const resourceA = await createResource(root, tenantA, "Protected-Resource");

            // Set context to tenant B and try to delete tenant A's resource
            await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantB]);
            const deleteRes = await api.query("DELETE FROM resources WHERE resource_id = $1 RETURNING resource_id", [resourceA]);

            // Should silently affect 0 rows — route handlers should check rowCount for 404
            expect(deleteRes.rowCount).toBe(0);

            // Confirm resource still exists via root
            const checkRes = await root.query("SELECT name FROM resources WHERE resource_id = $1", [resourceA]);
            expect(checkRes.rows[0].name).toBe("Protected-Resource");
        });

        it("tenant context is properly isolated between sequential requests", async () => {
            // WHO: a connection that handles back-to-back requests for
            //      different tenants — the production shape since the api_user
            //      pool is shared across all tenants
            // WHAT: each set_tenant_context() call FULLY swaps which rows are
            //      visible; no leakage from the prior tenant's context
            // WHEN: every multi-tenant request flow on the shared pool —
            //      i.e., the load-bearing case for production
            // WHERE: app.current_tenant_id session-variable contract,
            //       set_tenant_context() function
            // WHY: a regression that left stale tenant context (e.g., a
            //      reset-on-checkin/checkout helper that forgot to RESET)
            //      would cause cross-tenant data exposure on the very next
            //      request to use the same connection — a hard data leak
            //      that would not show up in any single-tenant test
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
            // WHO: api_user with tenant A context attempting to INSERT a row
            //      whose tenant_id is set to tenant B
            // WHAT: either the INSERT throws a policy-violation error OR the
            //      row is silently filtered from tenant B's view — both
            //      behaviors satisfy the security contract
            // WHEN: an attacker (or a buggy route that forgot to derive
            //      tenant_id from the JWT) tries to write a row under the
            //      wrong tenant
            // WHERE: RLS INSERT WITH CHECK policy on resources
            // WHY: WITH CHECK enforces tenancy at write time. Without it, an
            //      attacker could plant rows under a tenant they don't own
            //      (e.g., billable usage records, fake appointments). This
            //      test accepts either failure mode because Postgres' policy
            //      semantics can vary by configuration; what matters is that
            //      the row never becomes visible to the wrong tenant
            if (!dbAvailable) return;

            const tenantA = await createTenant(root, "Ins-A", "t");
            const tenantB = await createTenant(root, "Ins-B", "t");

            // Set context to tenant A but try to insert a resource for tenant B
            await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantA]);

            try {
                await api.query(
                    "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Sneaky') RETURNING resource_id",
                    [tenantB]
                );
                // If it doesn't throw, the row should not be visible to tenant B
                await api.query(`SELECT set_tenant_context($1::UUID)`, [tenantB]);
                const res = await api.query("SELECT * FROM resources WHERE name = 'Sneaky'");
                // Either the insert was blocked (threw) or RLS hides it
                expect(res.rows.length).toBeLessThanOrEqual(0);
            } catch (err) {
                // RLS policy violation — Postgres should return a clear error
                expect(err.message).toMatch(/policy|permission|violates/i);
            }
        });
    });
});
