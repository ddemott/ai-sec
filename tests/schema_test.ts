import postgres from "postgres";
import { assertEquals, assertNotEquals } from "@std/assert";

const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/postgres";
const sql = postgres(DB_URL);

// Helper to clear the DB before tests
async function clearDB() {
    await sql`TRUNCATE tenants, resources, customers, appointments, call_summaries CASCADE;`;
}

Deno.test("TDD: Schema and Atomic Booking", async (t) => {
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
                NULL
            );
        `;

        assertEquals(result[0].success, false);
        assertEquals(result[0].appointment_id, null);
        assertEquals(result[0].error_message, "Slot already booked");
    });

    await t.step("Should enforce buffers and reject tight back-to-back slots", async () => {
        const startTime = new Date("2026-03-01T11:00:00Z"); // Immediately after prior 10:00-11:00 service window
        const endTime = new Date("2026-03-01T12:00:00Z");

        const result = await sql`
            SELECT * FROM book_appointment_atomic(
                ${tenant.id}, 
                ${resource.id}, 
                ${customer.id}, 
                ${startTime}, 
                ${endTime}, 
                'Back-to-back appointment (should fail due to buffers)', 
                'call_003',
                NULL
            );
        `;

        assertEquals(result[0].success, false);
        assertEquals(result[0].appointment_id, null);
        assertEquals(result[0].error_message, "Slot already booked");
    });

    await t.step("Should allow booking when respecting buffer gap", async () => {
        // Leave enough room after the 10:00-11:00 appointment plus its buffers
        const startTime = new Date("2026-03-01T12:00:00Z");
        const endTime = new Date("2026-03-01T13:00:00Z");

        const result = await sql`
            SELECT * FROM book_appointment_atomic(
                ${tenant.id}, 
                ${resource.id}, 
                ${customer.id}, 
                ${startTime}, 
                ${endTime}, 
                'Properly spaced appointment', 
                'call_004',
                NULL
            );
        `;

        assertEquals(result[0].success, true);
        assertNotEquals(result[0].appointment_id, null);
    });

    await sql.end();
});
