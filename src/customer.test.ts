import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, createCustomerFull } from "./test-utils";
import { Client } from "pg";

describe("Customer Management", () => {
    let client: Client;
    let tenantId: string;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            client = await getRootClient();
        } catch (err) {
            dbAvailable = false;
            // eslint-disable-next-line no-console
            console.warn("[customer.test] Skipping DB tests - connection failed", err);
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
        const setup = await setupBasicTenant(client);
        tenantId = setup.tenantId;
    });

    it("should create a customer with all fields including timezone", async () => {
        if (!dbAvailable) return;
        const res = await client.query(
            `INSERT INTO customers (
                tenant_id, name, phone, email, address, city, state, postal_code, timezone
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [
                tenantId,
                "John Doe",
                "+15559998888",
                "john@example.com",
                "123 Main St",
                "Chicago",
                "IL",
                "60601",
                "America/Chicago"
            ]
        );

        expect(res.rows[0].name).toBe("John Doe");
        expect(res.rows[0].timezone).toBe("America/Chicago");
        expect(res.rows[0].city).toBe("Chicago");
    });

    it("should update a customer's timezone and address", async () => {
        if (!dbAvailable) return;
        const customerId = await createCustomerFull(client, tenantId, "+15551112222", "Old Name");

        await client.query(
            "UPDATE customers SET timezone = $1, city = $2 WHERE id = $3",
            ["America/Los_Angeles", "Los Angeles", customerId]
        );

        const checkRes = await client.query("SELECT * FROM customers WHERE id = $1", [customerId]);
        expect(checkRes.rows[0].timezone).toBe("America/Los_Angeles");
        expect(checkRes.rows[0].city).toBe("Los Angeles");
    });

    it("should default timezone to America/New_York if not specified", async () => {
        if (!dbAvailable) return;
        const res = await client.query(
            "INSERT INTO customers (tenant_id, name, phone) VALUES ($1, 'Default Tz', '+15553334444') RETURNING timezone",
            [tenantId]
        );
        expect(res.rows[0].timezone).toBe("America/New_York");
    });
});
