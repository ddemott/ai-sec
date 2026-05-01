import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, beginTestTransaction, rollbackTestTransaction } from "./test-utils";
import { Client } from "pg";

describe("TDD: Schema and Atomic Booking (Refactored)", () => {
    let client: Client;
    let tenantId: string;
    let resourceId: string;
    let customerId: string;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            client = await getRootClient();
            await clearDB(client);
            const setup = await setupBasicTenant(client);
            tenantId = setup.tenantId;
            resourceId = setup.resourceId;
            customerId = setup.customerId;
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

    beforeEach(async () => {
        if (!dbAvailable) return;
        await beginTestTransaction(client);
    });

    afterEach(async () => {
        if (!dbAvailable) return;
        await rollbackTestTransaction(client);
    });

    it("should successfully book a valid slot", async () => {
        if (!dbAvailable) return;

        const startTime = new Date("2026-03-01T10:00:00Z");
        const endTime = new Date("2026-03-01T11:00:00Z");

            const result = await client.query(
                "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8);",
                [tenantId, resourceId, customerId, startTime, endTime, 'Flat tire repair', 'call_001', null]
            );

        expect(result.rows[0].success).toBe(true);
        expect(result.rows[0].appointment_id).not.toBeNull();

        const row = await client.query(
            "SELECT start_time, end_time FROM appointments WHERE id = $1",
            [result.rows[0].appointment_id]
        );

        expect(row.rows[0].start_time <= startTime).toBe(true);
        expect(row.rows[0].end_time >= endTime).toBe(true);
    });

    it("should fail to book an overlapping slot", async () => {
        if (!dbAvailable) return;

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
        // Updated 2026-04-30: see tools.test.ts comment — RPC error
        // message renamed from "slot already booked" to the current
        // "during this timeslot" form.
        expect(result.rows[0].error_message).toBe("Resource already booked during this timeslot");
    });
});
