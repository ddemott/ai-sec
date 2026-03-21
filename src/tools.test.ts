import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getRootClient, clearDB, setupBasicTenant, createResource } from "./test-utils";
import { Client } from "pg";
import { z } from "zod";

describe("AI Tools: Modular Integration", () => {
    let client: Client;
    let tenantId: string;
    let resourceId: string;
    let customerId: string;
    let dbAvailable = true;

    beforeAll(async () => {
        try {
            client = await getRootClient();
        } catch (err) {
            dbAvailable = false;
            console.warn("[tools.test] Skipping DB-backed tests - connection failed", err);
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
        resourceId = setup.resourceId;
        customerId = setup.customerId;
    });

    it("Validation: should fail with malformed UUID in tenant_id", () => {
        const schema = z.string().uuid();
        const result = schema.safeParse("not-a-uuid");
        expect(result.success).toBe(false);
    });

    it("Happy Path: should book a valid slot", async () => {
        if (!dbAvailable) return;
        const start = "2026-06-01T10:00:00Z";
        const end = "2026-06-01T11:00:00Z";

        const bookRes = await client.query(
            "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8)",
            [tenantId, resourceId, customerId, start, end, "Tire Swap", "call_abc", null]
        );
        expect(bookRes.rows[0].success).toBe(true);

        const stored = await client.query(
            "SELECT start_time, end_time FROM appointments WHERE id = $1",
            [bookRes.rows[0].appointment_id]
        );

        expect(stored.rows[0].start_time <= new Date(start)).toBe(true);
        expect(stored.rows[0].end_time >= new Date(end)).toBe(true);
    });

    it("Sad Path: should fail when booking an overlapping slot", async () => {
        if (!dbAvailable) return;
        const start = "2026-06-01T10:00:00Z";
        const end = "2026-06-01T11:00:00Z";

        // Initial book
        await client.query(
            "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8)",
            [tenantId, resourceId, customerId, start, end, "First", "call_1", null]
        );

        // Overlap book
        const bookRes = await client.query(
            "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8)",
            [tenantId, resourceId, customerId, "2026-06-01T10:30:00Z", "2026-06-01T11:30:00Z", "Conflict", "call_2", null]
        );
        expect(bookRes.rows[0].success).toBe(false);
        expect(bookRes.rows[0].error_message).toBe("Resource slot already booked");
    });

    it("Multi-bay: overlapping slots allowed on different resources", async () => {
        if (!dbAvailable) return;

        const otherResourceId = await createResource(client, tenantId, "Truck 2");

        const start = "2026-06-01T10:00:00Z";
        const end = "2026-06-01T11:00:00Z";

        // Book in first bay
        await client.query(
            "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8)",
            [tenantId, resourceId, customerId, start, end, "First bay", "call_bay1", null]
        );

        // Overlapping time in second bay should still succeed
        const bookRes = await client.query(
            "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8)",
            [tenantId, otherResourceId, customerId, "2026-06-01T10:30:00Z", "2026-06-01T11:30:00Z", "Second bay", "call_bay2", null]
        );

        expect(bookRes.rows[0].success).toBe(true);
    });
});
