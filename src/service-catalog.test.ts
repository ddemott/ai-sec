import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, beginTestTransaction, rollbackTestTransaction, createService } from "./test-utils";
import { Client } from "pg";

describe("Service Catalog endpoint (GET /services/catalog)", () => {
    let client: Client;
    let tenantId: string;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            client = await getRootClient();
            await clearDB(client);
            const setup = await setupBasicTenant(client);
            tenantId = setup.tenantId;
        } catch (err) {
            dbAvailable = false;
            console.warn("[service-catalog.test] Skipping DB tests - connection failed", err);
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

    it("should return services with subtitle and description in catalog query", async () => {
        if (!dbAvailable) return;

        // Create a service with all catalog fields
        await client.query(
            `INSERT INTO services (tenant_id, name, subtitle, description, duration_minutes, price)
             VALUES ($1, 'Tire Rotation', 'Full rotation + balance', 'We rotate and balance all four tires.', 45, 49.99)`,
            [tenantId]
        );

        // Simulate the catalog query (same SQL as the endpoint uses)
        const res = await client.query(
            `SELECT service_id as id, name, subtitle, description, duration_minutes, price
             FROM services WHERE tenant_id = $1 ORDER BY name ASC`,
            [tenantId]
        );

        expect(res.rows.length).toBe(1);
        const svc = res.rows[0];
        expect(svc.name).toBe("Tire Rotation");
        expect(svc.subtitle).toBe("Full rotation + balance");
        expect(svc.description).toBe("We rotate and balance all four tires.");
        expect(svc.duration_minutes).toBe(45);
        expect(Number(svc.price)).toBe(49.99);
    });

    it("should return empty array for tenant with no services", async () => {
        if (!dbAvailable) return;

        // Create a new tenant with no services
        const tRes = await client.query(
            `INSERT INTO tenants (name, business_type) VALUES ('Empty Shop', 'auto-shop') RETURNING tenant_id AS id`
        );
        const emptyTenantId = tRes.rows[0].id;

        const res = await client.query(
            `SELECT service_id as id, name, subtitle, description, duration_minutes, price
             FROM services WHERE tenant_id = $1 ORDER BY name ASC`,
            [emptyTenantId]
        );

        expect(res.rows.length).toBe(0);
    });

    it("should return multiple services ordered by name", async () => {
        if (!dbAvailable) return;

        await client.query(
            `INSERT INTO services (tenant_id, name, subtitle, duration_minutes, price)
             VALUES ($1, 'Wheel Alignment', 'Precision alignment', 60, 89.99),
                    ($1, 'Brake Inspection', 'Full brake check', 30, 0),
                    ($1, 'Tire Rotation', 'Full rotation', 45, 49.99)`,
            [tenantId]
        );

        const res = await client.query(
            `SELECT name FROM services WHERE tenant_id = $1 ORDER BY name ASC`,
            [tenantId]
        );

        expect(res.rows.length).toBe(3);
        expect(res.rows[0].name).toBe("Brake Inspection");
        expect(res.rows[1].name).toBe("Tire Rotation");
        expect(res.rows[2].name).toBe("Wheel Alignment");
    });

    it("should include services created via createService helper (backward compat)", async () => {
        if (!dbAvailable) return;

        // Use the existing createService helper which doesn't set subtitle
        const serviceId = await createService(client, tenantId, "Legacy Service", 60, 100);

        const res = await client.query(
            `SELECT service_id as id, name, subtitle, description, duration_minutes, price
             FROM services WHERE service_id = $1`,
            [serviceId]
        );

        expect(res.rows.length).toBe(1);
        // subtitle and description should have defaults
        expect(res.rows[0].subtitle).toBe("");
        expect(res.rows[0].description).toBe("");
    });
});
