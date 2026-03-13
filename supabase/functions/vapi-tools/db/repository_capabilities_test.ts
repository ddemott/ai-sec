// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { PostgresRepository } from "./repository.ts";
import { baseLogger } from "../core/logger.ts";

const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/test_db?sslmode=disable";

async function clearDB() {
  const client = new Client(DB_URL);
  await client.connect();
  await client.queryArray("TRUNCATE tenants, resources, services, service_resource CASCADE;");
  await client.end();
}

async function isDbAvailable(): Promise<boolean> {
  try {
    const client = new Client(DB_URL);
    await client.connect();
    await client.end();
    return true;
  } catch (_e) {
    console.warn("[repository_capabilities_test] Skipping tests: Postgres not available at", DB_URL);
    return false;
  }
}

Deno.test({
  name: "PostgresRepository.getSchedulingResources includes explicit and mapped capabilities",
  sanitizeOps: false,
  async fn() {
    if (!(await isDbAvailable())) return;
    await clearDB();
    const client = new Client(DB_URL);
    await client.connect();

    const tRes = await client.queryObject<{ id: string }>(
      "INSERT INTO tenants (name, business_type) VALUES ('Cap Test', 'test') RETURNING id",
    );
    const tenantId = tRes.rows[0].id;

    // 1. Resource with explicit capabilities
    const rRes1 = await client.queryObject<{ id: string }>(
      "INSERT INTO resources (tenant_id, name, capabilities) VALUES ($1, 'Chair 1', ARRAY['cut-hair']) RETURNING id", 
      [tenantId]
    );
    const resourceId1 = rRes1.rows[0].id;

    // 2. Resource with mapped service capabilities
    const rRes2 = await client.queryObject<{ id: string }>(
      "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay 1') RETURNING id", 
      [tenantId]
    );
    const resourceId2 = rRes2.rows[0].id;

    const sRes = await client.queryObject<{ id: string }>(
      "INSERT INTO services (tenant_id, name, duration_minutes, required_resources) VALUES ($1, 'Oil Change', 30, ARRAY['oil-change']) RETURNING id",
      [tenantId]
    );
    const serviceId = sRes.rows[0].id;

    await client.queryArray(
      "INSERT INTO service_resource (service_id, resource_id, tenant_id) VALUES ($1, $2, $3)",
      [serviceId, resourceId2, tenantId]
    );

    await client.end();

    const repo = new PostgresRepository();
    const resources = await repo.getSchedulingResources(tenantId, baseLogger);

    assertEquals(resources.length, 2);
    
    const chair = resources.find(r => r.id === resourceId1);
    const bay = resources.find(r => r.id === resourceId2);

    assertEquals(chair.capabilities, ['cut-hair']);
    assertEquals(bay.capabilities, ['oil-change']);

    await repo.close();
  },
});
