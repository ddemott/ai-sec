import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { z } from "zod";

const DB_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5433/postgres";
const client = new Client({ connectionString: DB_URL });

let dbAvailable = true;

beforeAll(async () => {
    try {
        await client.connect();
    } catch (err) {
        dbAvailable = false;
        // eslint-disable-next-line no-console
        console.warn("[tools.test] Skipping DB-backed tests - connection failed", err);
    }
});

afterAll(async () => {
    if (dbAvailable) {
        await client.end();
    }
});

async function clearDB() {
    if (!dbAvailable) return;
    await client.query("TRUNCATE tenants, resources, customers, appointments, call_summaries, call_transcripts, soft_reservations CASCADE;");
}

async function setupTestData() {
    if (!dbAvailable) return { tenantId: null, resourceId: null, customerId: null } as any;
    await clearDB();
    const t = await client.query("INSERT INTO tenants (name, business_type) VALUES ('DynaTire', 'mobile-tire') RETURNING id;");
    const tenantId = t.rows[0].id;
    const r = await client.query("INSERT INTO resources (tenant_id, name) VALUES ($1, 'Truck 1') RETURNING id;", [tenantId]);
    const resourceId = r.rows[0].id;
    const c = await client.query("INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice') RETURNING id;", [tenantId]);
    const customerId = c.rows[0].id;
    return { tenantId, resourceId, customerId };
}

describe("AI Tools: Modular Integration", () => {
    it("Validation: should fail with malformed UUID in tenant_id", () => {
        const schema = z.string().uuid();
        const result = schema.safeParse("not-a-uuid");
        expect(result.success).toBe(false);
    });

    it("Happy Path: should book a valid slot", async () => {
        if (!dbAvailable) return;
        const { tenantId, resourceId, customerId } = await setupTestData();
        const start = "2026-06-01T10:00:00Z";
        const end = "2026-06-01T11:00:00Z";
        
        const bookRes = await client.query(
            "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8)",
            [tenantId, resourceId, customerId, start, end, "Tire Swap", "call_abc", null]
        );
        expect(bookRes.rows[0].success).toBe(true);

        // Verify that the stored appointment window fully covers the requested window.
        // Newer deployments should store exactly [start, end]; older buffered
        // deployments may expand it but must not shrink it.
        const stored = await client.query(
            "SELECT start_time, end_time FROM appointments WHERE id = $1",
            [bookRes.rows[0].appointment_id]
        );

        expect(stored.rows[0].start_time <= new Date(start)).toBe(true);
        expect(stored.rows[0].end_time >= new Date(end)).toBe(true);
    });

    it("Sad Path: should fail when booking an overlapping slot", async () => {
        if (!dbAvailable) return;
        const { tenantId, resourceId, customerId } = await setupTestData();
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
        const { tenantId, resourceId, customerId } = await setupTestData();

        const secondResource = await client.query(
            "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Truck 2') RETURNING id;",
            [tenantId]
        );
        const otherResourceId = secondResource.rows[0].id;

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
