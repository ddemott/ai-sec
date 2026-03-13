// @ts-nocheck
import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { PostgresRepository } from "./repository.ts";
import { baseLogger } from "../core/logger.ts";

const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/postgres";

async function clearServices() {
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
    console.warn("[repository_services_test] Skipping tests: Postgres not available at", DB_URL);
    return false;
  }
}

Deno.test({
  name: "PostgresRepository.createService and getServices CRUD",
  sanitizeOps: false,
  async fn() {
    if (!(await isDbAvailable())) return;
    await clearServices();
    const client = new Client(DB_URL);
    await client.connect();
    const tRes = await client.queryObject<{ id: string }>(
      "INSERT INTO tenants (name, business_type) VALUES ('Service Test', 'test') RETURNING id",
    );
    const tenantId = tRes.rows[0].id;
    await client.end();

    const repo = new PostgresRepository();
    const serviceId = await repo.createService(tenantId, {
      name: "Oil Change",
      description: "Basic oil change",
      duration_minutes: 30,
      required_skills: ["mechanic"],
      required_resources: ["lift"]
    }, baseLogger);
    assert(serviceId);

    const services = await repo.getServices(tenantId, baseLogger);
    assertEquals(services.length, 1);
    assertEquals(services[0].name, "Oil Change");
    assertEquals(services[0].duration_minutes, 30);
    assertEquals(services[0].required_skills, ["mechanic"]);
    assertEquals(services[0].required_resources, ["lift"]);
    await repo.close();
  },
});

Deno.test({
  name: "PostgresRepository.updateService and deleteService CRUD",
  sanitizeOps: false,
  async fn() {
    if (!(await isDbAvailable())) return;
    await clearServices();
    const client = new Client(DB_URL);
    await client.connect();
    const tRes = await client.queryObject<{ id: string }>(
      "INSERT INTO tenants (name, business_type) VALUES ('Service Test', 'test') RETURNING id",
    );
    const tenantId = tRes.rows[0].id;
    await client.end();

    const repo = new PostgresRepository();
    const serviceId = await repo.createService(tenantId, {
      name: "Brake Repair",
      description: "Brake pad replacement",
      duration_minutes: 60,
      required_skills: ["mechanic"],
      required_resources: ["lift"]
    }, baseLogger);
    assert(serviceId);

    await repo.updateService(tenantId, serviceId, {
      name: "Brake Repair Deluxe",
      duration_minutes: 90,
      required_skills: ["mechanic", "specialist"]
    }, baseLogger);

    const services = await repo.getServices(tenantId, baseLogger);
    assertEquals(services.length, 1);
    assertEquals(services[0].name, "Brake Repair Deluxe");
    assertEquals(services[0].duration_minutes, 90);
    assertEquals(services[0].required_skills, ["mechanic", "specialist"]);

    await repo.deleteService(tenantId, serviceId, baseLogger);
    const afterDelete = await repo.getServices(tenantId, baseLogger);
    assertEquals(afterDelete.length, 0);
    await repo.close();
  },
});
