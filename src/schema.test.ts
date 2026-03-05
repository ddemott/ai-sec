import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getRootClient, clearDB, setupBasicTenant } from "./test-utils";
import { Client } from "pg";

describe("TDD: Schema and Atomic Booking (Refactored)", () => {
    let client: Client;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            client = await getRootClient();
        } catch (err) {
            dbAvailable = false;
            // eslint-disable-next-line no-console
            console.warn("[schema.test] Skipping DB tests - connection failed", err);
        }
    });

    afterAll(async () => {
        if (dbAvailable && client) {
            await client.end();
        }
    });

    it("should successfully book a valid slot", async () => {
        if (!dbAvailable) return;
        await clearDB(client);
        const { tenantId, resourceId, customerId } = await setupBasicTenant(client);

        const startTime = new Date("2026-03-01T10:00:00Z");
        const endTime = new Date("2026-03-01T11:00:00Z");

            const result = await client.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8);",
                [tenantId, resourceId, customerId, startTime, endTime, 'Flat tire repair', 'call_001', null]
            );

        expect(result.rows[0].success).toBe(true);
        expect(result.rows[0].appointment_id).not.toBeNull();
    });

    it("should fail to book an overlapping slot", async () => {
        if (!dbAvailable) return;
        await clearDB(client);
        const { tenantId, resourceId, customerId } = await setupBasicTenant(client);

        // Book initial
            await client.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8);",
                [tenantId, resourceId, customerId, new Date("2026-03-01T10:00:00Z"), new Date("2026-03-01T11:00:00Z"), 'First', 'call_1', null]
            );

        const result = await client.query(
            "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8);",
            [tenantId, resourceId, customerId, new Date("2026-03-01T10:30:00Z"), new Date("2026-03-01T11:30:00Z"), 'Overlap', 'call_002', null]
        );

        expect(result.rows[0].success).toBe(false);
        expect(result.rows[0].error_message).toBe("Slot already booked");
    });
});
