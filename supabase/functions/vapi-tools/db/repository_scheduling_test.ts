// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { PostgresRepository } from "./repository.ts";
import type { TimeWindow } from "../core/scheduling.ts";
import { baseLogger } from "../core/logger.ts";

const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/test_db?sslmode=disable";

async function clearDB() {
  const client = new Client(DB_URL);
  await client.connect();
  await client.queryArray("TRUNCATE tenants, resources, customers, appointments, call_summaries, service_resource, service_employee, tenant_docs CASCADE;");
  await client.end();
}

async function isDbAvailable(): Promise<boolean> {
  try {
    const client = new Client(DB_URL);
    await client.connect();
    await client.end();
    return true;
  } catch (_e) {
    console.warn("[repository_scheduling_test] Skipping tests: Postgres not available at", DB_URL);
    return false;
  }
}

function window(from: string, to: string): TimeWindow {
  return { from: new Date(from), to: new Date(to) };
}

Deno.test({
  name: "PostgresRepository.getSchedulingResources returns active resources for tenant",
  sanitizeOps: false,
  async fn() {
    if (!(await isDbAvailable())) return;
    await clearDB();
    const client = new Client(DB_URL);
    await client.connect();

    const tRes = await client.queryObject<{ id: string }>(
      "INSERT INTO tenants (name, business_type) VALUES ('Sched Test', 'test') RETURNING id",
    );
    const tenantId = tRes.rows[0].id;

    // Create another tenant for isolation testing
    const otherTRes = await client.queryObject<{ id: string }>(
      "INSERT INTO tenants (name, business_type) VALUES ('Other Test', 'test') RETURNING id",
    );
    const otherTenantId = otherTRes.rows[0].id;

    await client.queryArray("INSERT INTO resources (tenant_id, name, description, is_active) VALUES ($1, 'Truck A', 'Active', true)", [tenantId]);
    await client.queryArray("INSERT INTO resources (tenant_id, name, description, is_active) VALUES ($1, 'Truck B', 'Inactive', false)", [tenantId]);
    await client.queryArray("INSERT INTO resources (tenant_id, name, description, is_active) VALUES ($1, 'Other Tenant Truck', 'Other', true)", [otherTenantId]);

    await client.end();

    const repo = new PostgresRepository();
    const resources = await repo.getSchedulingResources(tenantId, baseLogger);

    assertEquals(resources.length, 1);
    assertEquals(resources[0].id.length > 0, true);
    assertEquals(resources[0].capabilities, []);
    await repo.close();
  },
});

Deno.test({
  name: "PostgresRepository.getExistingAppointments returns overlapping appointments for window",
  sanitizeOps: false,
  async fn() {
    if (!(await isDbAvailable())) return;
    await clearDB();
    const client = new Client(DB_URL);
    await client.connect();

    const tRes = await client.queryObject<{ id: string }>(
      "INSERT INTO tenants (name, business_type) VALUES ('Sched Appt Test', 'test') RETURNING id",
    );
    const tenantId = tRes.rows[0].id;

    // Create another tenant for isolation testing
    const otherTRes = await client.queryObject<{ id: string }>(
      "INSERT INTO tenants (name, business_type) VALUES ('Other Test', 'test') RETURNING id",
    );
    const otherTenantId = otherTRes.rows[0].id;

    const rRes = await client.queryObject<{ id: string }>(
      "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Truck A') RETURNING id",
      [tenantId],
    );
    const resourceId = rRes.rows[0].id;

    const cRes = await client.queryObject<{ id: string }>(
      "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, '+15550000000', 'Alice') RETURNING id",
      [tenantId],
    );
    const customerId = cRes.rows[0].id;

    // Overlapping appointment
    await client.queryArray(
      "INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, status) VALUES ($1, $2, $3, $4, $5, 'scheduled')",
      [tenantId, resourceId, customerId, "2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"],
    );

    // Non-overlapping appointment
    await client.queryArray(
      "INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, status) VALUES ($1, $2, $3, $4, $5, 'scheduled')",
      [tenantId, resourceId, customerId, "2026-10-01T12:00:00Z", "2026-10-01T13:00:00Z"],
    );

    // Other tenant appointment
    await client.queryArray(
      "INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, status) VALUES ($1, $2, $3, $4, $5, 'scheduled')",
      [otherTenantId, resourceId, customerId, "2026-10-01T10:15:00Z", "2026-10-01T10:45:00Z"],
    );

    await client.end();

    const repo = new PostgresRepository();
    const results = await repo.getExistingAppointments(
      tenantId,
      window("2026-10-01T10:30:00Z", "2026-10-01T11:30:00Z"),
      baseLogger,
    );

    assertEquals(results.length, 1);
    assertEquals(results[0].resourceId, resourceId);
    assertEquals(results[0].start.toISOString(), "2026-10-01T10:00:00.000Z");
    assertEquals(results[0].end.toISOString(), "2026-10-01T11:00:00.000Z");
    await repo.close();
  },
});
