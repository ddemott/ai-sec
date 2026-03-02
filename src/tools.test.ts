import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { z } from "zod";

const DB_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5433/postgres";
const client = new Client({ connectionString: DB_URL });

beforeAll(async () => {
    await client.connect();
});

afterAll(async () => {
    await client.end();
});

async function clearDB() {
    await client.query("TRUNCATE tenants, resources, customers, appointments, call_summaries, call_transcripts, soft_reservations CASCADE;");
}

async function setupTestData() {
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
        const { tenantId, resourceId, customerId } = await setupTestData();
        const start = "2026-06-01T10:00:00Z";
        const end = "2026-06-01T11:00:00Z";
        
        const bookRes = await client.query(
            "SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8)",
            [tenantId, resourceId, customerId, start, end, "Tire Swap", "call_abc", null]
        );
        expect(bookRes.rows[0].success).toBe(true);
    });

    it("Sad Path: should fail when booking an overlapping slot", async () => {
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
        expect(bookRes.rows[0].error_message).toBe("Slot already booked");
    });
});
