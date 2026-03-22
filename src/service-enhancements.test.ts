import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, beginTestTransaction, rollbackTestTransaction } from "./test-utils";
import { Client } from "pg";

describe("Service Enhancements: subtitle and description columns", () => {
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
            console.warn("[service-enhancements.test] Skipping DB tests - connection failed", err);
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

    it("should have subtitle column on services table", async () => {
        if (!dbAvailable) return;
        const res = await client.query(
            `SELECT column_name, data_type, column_default
             FROM information_schema.columns
             WHERE table_name = 'services' AND column_name = 'subtitle'`
        );
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].data_type).toBe("text");
    });

    it("should have description column on services table", async () => {
        if (!dbAvailable) return;
        const res = await client.query(
            `SELECT column_name, data_type, column_default
             FROM information_schema.columns
             WHERE table_name = 'services' AND column_name = 'description'`
        );
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].data_type).toBe("text");
    });

    it("should default subtitle to empty string", async () => {
        if (!dbAvailable) return;
        const res = await client.query(
            `INSERT INTO services (tenant_id, name, duration_minutes)
             VALUES ($1, 'Oil Change', 30) RETURNING subtitle`,
            [tenantId]
        );
        expect(res.rows[0].subtitle).toBe("");
    });

    it("should default description to empty string for new rows", async () => {
        if (!dbAvailable) return;
        const res = await client.query(
            `INSERT INTO services (tenant_id, name, duration_minutes)
             VALUES ($1, 'Tire Rotation', 45) RETURNING description`,
            [tenantId]
        );
        expect(res.rows[0].description).toBe("");
    });

    it("should create a service with subtitle and description", async () => {
        if (!dbAvailable) return;
        const res = await client.query(
            `INSERT INTO services (tenant_id, name, subtitle, description, duration_minutes, price)
             VALUES ($1, 'Tire Rotation', 'Full rotation + balance', 'We rotate all four tires and balance each one for even wear.', 45, 49.99)
             RETURNING *`,
            [tenantId]
        );
        const svc = res.rows[0];
        expect(svc.name).toBe("Tire Rotation");
        expect(svc.subtitle).toBe("Full rotation + balance");
        expect(svc.description).toBe("We rotate all four tires and balance each one for even wear.");
        expect(Number(svc.price)).toBe(49.99);
        expect(svc.duration_minutes).toBe(45);
    });

    it("should update subtitle and description on an existing service", async () => {
        if (!dbAvailable) return;
        const ins = await client.query(
            `INSERT INTO services (tenant_id, name, duration_minutes)
             VALUES ($1, 'Flat Repair', 20) RETURNING id`,
            [tenantId]
        );
        const id = ins.rows[0].id;

        await client.query(
            `UPDATE services SET subtitle = $1, description = $2 WHERE id = $3`,
            ["Emergency flat fix", "We patch or plug your flat tire on-site.", id]
        );

        const res = await client.query(
            `SELECT subtitle, description FROM services WHERE id = $1`,
            [id]
        );
        expect(res.rows[0].subtitle).toBe("Emergency flat fix");
        expect(res.rows[0].description).toBe("We patch or plug your flat tire on-site.");
    });
});
