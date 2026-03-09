// @ts-nocheck
import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { PostgresRepository } from "./repository.ts";
import { baseLogger } from "../core/logger.ts";

const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/postgres";

async function clearEmployees() {
  const client = new Client(DB_URL);
  await client.connect();
  await client.queryArray("TRUNCATE employees CASCADE;");
  await client.queryArray("TRUNCATE tenants CASCADE;");
  await client.end();
}

async function isDbAvailable(): Promise<boolean> {
  try {
    const client = new Client(DB_URL);
    await client.connect();
    await client.end();
    return true;
  } catch (_e) {
    console.warn("[repository_employees_test] Skipping tests: Postgres not available at", DB_URL);
    return false;
  }
}

Deno.test({
  name: "PostgresRepository.createEmployee and getEmployees CRUD",
  sanitizeOps: false,
  async fn() {
    if (!(await isDbAvailable())) return;
    await clearEmployees();
    const client = new Client(DB_URL);
    await client.connect();
    const tRes = await client.queryObject<{ id: string }>(
      "INSERT INTO tenants (name, business_type) VALUES ('Employee Test', 'test') RETURNING id",
    );
    const tenantId = tRes.rows[0].id;
    await client.end();

    const repo = new PostgresRepository();
    const employeeId = await repo.createEmployee(tenantId, {
      name: "Bob",
      skills: ["tire_alignment", "oil_change"],
      is_active: true
    }, baseLogger);
    assert(employeeId);

    const employees = await repo.getEmployees(tenantId, baseLogger);
    assertEquals(employees.length, 1);
    assertEquals(employees[0].name, "Bob");
    assertEquals(employees[0].skills, ["tire_alignment", "oil_change"]);
    assertEquals(employees[0].is_active, true);
  },
});

Deno.test({
  name: "PostgresRepository.updateEmployee and deleteEmployee CRUD",
  sanitizeOps: false,
  async fn() {
    if (!(await isDbAvailable())) return;
    await clearEmployees();
    const client = new Client(DB_URL);
    await client.connect();
    const tRes = await client.queryObject<{ id: string }>(
      "INSERT INTO tenants (name, business_type) VALUES ('Employee Test', 'test') RETURNING id",
    );
    const tenantId = tRes.rows[0].id;
    await client.end();

    const repo = new PostgresRepository();
    const employeeId = await repo.createEmployee(tenantId, {
      name: "Alice",
      skills: ["color", "cut"],
      is_active: true
    }, baseLogger);
    assert(employeeId);

    await repo.updateEmployee(tenantId, employeeId, {
      name: "Alice Smith",
      skills: ["cut"],
      is_active: false
    }, baseLogger);

    const employees = await repo.getEmployees(tenantId, baseLogger);
    assertEquals(employees.length, 1);
    assertEquals(employees[0].name, "Alice Smith");
    assertEquals(employees[0].skills, ["cut"]);
    assertEquals(employees[0].is_active, false);

    await repo.deleteEmployee(tenantId, employeeId, baseLogger);
    const afterDelete = await repo.getEmployees(tenantId, baseLogger);
    assertEquals(afterDelete.length, 0);
  },
});

Deno.test({
  name: "PostgresRepository assignEmployeeToService and assignResourceToService",
  sanitizeOps: false,
  async fn() {
    if (!(await isDbAvailable())) return;
    await clearEmployees();
    const client = new Client(DB_URL);
    await client.connect();
    const tRes = await client.queryObject<{ id: string }>(
      "INSERT INTO tenants (name, business_type) VALUES ('Mapping Test', 'test') RETURNING id",
    );
    const tenantId = tRes.rows[0].id;
    const sRes = await client.queryObject<{ id: string }>(
      "INSERT INTO services (tenant_id, name, duration_minutes) VALUES ($1, 'Oil Change', 30) RETURNING id", [tenantId]);
    const serviceId = sRes.rows[0].id;
    const eRes = await client.queryObject<{ id: string }>(
      "INSERT INTO employees (tenant_id, name, skills) VALUES ($1, 'Bob', '{oil_change}') RETURNING id", [tenantId]);
    const employeeId = eRes.rows[0].id;
    const rRes = await client.queryObject<{ id: string }>(
      "INSERT INTO resources (tenant_id, name) VALUES ($1, 'Bay 1') RETURNING id", [tenantId]);
    const resourceId = rRes.rows[0].id;
    await client.end();

    const repo = new PostgresRepository();
    await repo.assignEmployeeToService(serviceId, employeeId, baseLogger);
    await repo.assignResourceToService(serviceId, resourceId, baseLogger);

    const serviceEmployees = await repo.getServiceEmployees(serviceId, baseLogger);
    assertEquals(serviceEmployees, [employeeId]);
    const serviceResources = await repo.getServiceResources(serviceId, baseLogger);
    assertEquals(serviceResources, [resourceId]);

    await repo.removeEmployeeFromService(serviceId, employeeId, baseLogger);
    await repo.removeResourceFromService(serviceId, resourceId, baseLogger);
    const afterEmp = await repo.getServiceEmployees(serviceId, baseLogger);
    assertEquals(afterEmp, []);
    const afterRes = await repo.getServiceResources(serviceId, baseLogger);
    assertEquals(afterRes, []);
  },
});
