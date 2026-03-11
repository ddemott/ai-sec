import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { PostgresRepository } from "./db/repository.ts";
import { AISecretaryService } from "./core/service.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { baseLogger } from "./core/logger.ts";

const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/test_db?sslmode=disable";

async function clearDB() {
    const client = new Client(DB_URL);
    await client.connect();
    await client.queryArray("TRUNCATE tenants, resources, customers, appointments, call_summaries CASCADE;");
    await client.end();
}

Deno.test("Service Layer: Full Suite with Logging", async (t) => {
  await clearDB();
  const repo = new PostgresRepository();
  const service = new AISecretaryService(repo);
  
  const client = new Client(DB_URL);
  await client.connect();
  const tenantRes = await client.queryObject<{id: string}>("INSERT INTO tenants (name, business_type) VALUES ('Logging Test', 'test') RETURNING id");
  const tenantId = tenantRes.rows[0].id;
  const resourceRes = await client.queryObject<{id: string}>("INSERT INTO resources (tenant_id, name) VALUES ($1, 'Truck L') RETURNING id", [tenantId]);
  const resourceId = resourceRes.rows[0].id;
  await client.end();

  await t.step("Context Retrieval (New)", async () => {
    const res = await service.getCustomerContext("+10000000000", tenantId, baseLogger);
    assertEquals(res.result, "New caller - no history found.");
  });

  await t.step("Context Retrieval (Returning)", async () => {
    const db = new Client(DB_URL);
    await db.connect();
    const cRes = await db.queryObject<{id: string}>("INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550001111', 'Alice') RETURNING id", [tenantId]);
    const cid = cRes.rows[0].id;
    await db.queryArray("INSERT INTO call_summaries (tenant_id, customer_id, summary, call_id) VALUES ($1, $2, 'Past note', 'call_p')", [tenantId, cid]);
    await db.end();

    const res = await service.getCustomerContext("+15550001111", tenantId, baseLogger);
    const data = res.result as { name: string; history: string };
    assertEquals(data.name, "Alice");
    assertEquals(data.history, "Past note");
  });

  await t.step("Availability Check", async () => {
    const res = await service.checkAvailability(tenantId, resourceId, "2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z", baseLogger);
    assertEquals(res.result.available, true);
  });

  await t.step("Booking Success", async () => {
    const res = await service.bookAppointment({
        tenant_id: tenantId,
        resource_id: resourceId,
        phone: "+15558887777",
        name: "Logger User",
        start_time: "2026-10-01T10:00:00Z",
        end_time: "2026-10-01T11:00:00Z",
        description: "Testing Logs",
        call_id: "call_log_test"
    }, baseLogger);
    assertEquals(res.result.success, true);
  });

  await t.step("Booking Failure (Conflict)", async () => {
    try {
        await service.bookAppointment({
            tenant_id: tenantId,
            resource_id: resourceId,
            phone: "+15559990000",
            start_time: "2026-10-01T10:30:00Z",
            end_time: "2026-10-01T11:30:00Z",
            description: "Overlap",
            call_id: "call_fail"
        }, baseLogger);
        assertEquals(true, false, "Should throw");
    } catch (e) {
        const err = e as Error;
        assertEquals(err.name, "AvailabilityError");
    }
  });

  await t.step("Validation Error (Date)", async () => {
    try {
        await service.checkAvailability(tenantId, resourceId, "invalid", "2026-10-01", baseLogger);
        assertEquals(true, false, "Should throw");
    } catch (e) {
        const err = e as Error;
        assertEquals(err.name, "ValidationError");
    }
  });

  await repo.close();
});
