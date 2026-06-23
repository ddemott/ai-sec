/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * Heavy dynamic schema introspection and row manipulation in tests.
 * Disables intentional for dynamic DB testing.
 * See historical REFACTORING_TODO.md item 10 (see RESOLVED.md for details).
 */
import postgres from "postgres";
import { assertEquals, assertNotEquals } from "@std/assert";

const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/postgres";
const sql = postgres(DB_URL);

// Helper to clear the DB before tests
async function clearDB() {
    await sql`TRUNCATE tenants, resources, customers, appointments, call_summaries, service_resource, service_employee, tenant_docs CASCADE;`;
}

// Drop old signatures to avoid "not unique" errors
async function dropOldFunctions() {
    await sql`DROP FUNCTION IF EXISTS book_appointment_atomic(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT);`;
    await sql`DROP FUNCTION IF EXISTS book_appointment_atomic(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT);`;
    await sql`DROP FUNCTION IF EXISTS book_appointment_atomic(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER);`;
}

Deno.test("TDD: Schema and Atomic Booking", async (t) => {
    await dropOldFunctions();
    await clearDB();

    // 1. Setup Test Data
    const [tenant] = await sql`
        INSERT INTO tenants (name, business_type) 
        VALUES ('DynaTire', 'mobile-tire') 
        RETURNING id;
    `;

    const [resource] = await sql`
        INSERT INTO resources (tenant_id, name) 
        VALUES (${tenant.id}, 'Truck 1') 
        RETURNING id;
    `;

    const [customer] = await sql`
        INSERT INTO customers (tenant_id, phone, name) 
        VALUES (${tenant.id}, '+15551112222', 'Bob') 
        RETURNING id;
    `;

    await t.step("Should successfully book a valid slot", async () => {
        const startTime = new Date("2026-03-01T10:00:00Z");
        const endTime = new Date("2026-03-01T11:00:00Z");

        const result = await sql`
            SELECT * FROM book_appointment_atomic(
                ${tenant.id}, 
                ${resource.id}, 
                ${customer.id}, 
                ${startTime}, 
                ${endTime}, 
                'Flat tire repair', 
                'call_001',
                NULL,
                NULL
            );
        `;

        assertEquals(result[0].success, true);
        assertNotEquals(result[0].appointment_id, null);
        assertEquals(result[0].error_message, null);
    });

    await t.step("Should fail to book an overlapping slot", async () => {
        const startTime = new Date("2026-03-01T10:30:00Z"); // Overlaps with 10:00-11:00
        const endTime = new Date("2026-03-01T11:30:00Z");

        const result = await sql`
            SELECT * FROM book_appointment_atomic(
                ${tenant.id}, 
                ${resource.id}, 
                ${customer.id}, 
                ${startTime}, 
                ${endTime}, 
                'Overlapping appointment', 
                'call_002',
                NULL,
                NULL
            );
        `;

        assertEquals(result[0].success, false);
        assertEquals(result[0].appointment_id, null);
        assertEquals(result[0].error_message, "Resource slot already booked");
    });

    await t.step("Should reject overlapping slots on the same resource", async () => {
        // Our RPC now uses < and > for overlap, so 11:00-12:00 DOES NOT overlap with 10:00-11:00.
        // To test overlap, we use 10:59.
        const startTime = new Date("2026-03-01T10:59:00Z");
        const endTime = new Date("2026-03-01T12:00:00Z");

        const result = await sql`
            SELECT * FROM book_appointment_atomic(
                ${tenant.id}, 
                ${resource.id}, 
                ${customer.id}, 
                ${startTime}, 
                ${endTime}, 
                'Overlapping appointment (should fail)', 
                'call_003',
                NULL,
                NULL
            );
        `;

        assertEquals(result[0].success, false);
        assertEquals(result[0].appointment_id, null);
        assertEquals(result[0].error_message, "Resource slot already booked");
    });

    await t.step("Should allow non-overlapping booking on the same resource", async () => {
        const startTime = new Date("2026-03-01T12:00:00Z");
        const endTime = new Date("2026-03-01T13:00:00Z");

        const result = await sql`
            SELECT * FROM book_appointment_atomic(
                ${tenant.id}, 
                ${resource.id}, 
                ${customer.id}, 
                ${startTime}, 
                ${endTime}, 
                'Properly spaced appointment (no overlap)', 
                'call_004',
                NULL,
                NULL
            );
        `;

        assertEquals(result[0].success, true);
        assertNotEquals(result[0].appointment_id, null);
    });

    await sql.end();
});
