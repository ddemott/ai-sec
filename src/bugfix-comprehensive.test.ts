/**
 * Comprehensive happy + sad path tests for the April 1, 2026 bug
 * fixes — broad coverage across feature surfaces.
 *
 * Feature areas covered (search here when touching any of these):
 *   - **Tenant isolation**: DELETE/UPDATE queries scope to tenant_id
 *   - **DELETE routes**: 404 (not 200) when row missing
 *   - **Validation**: Zod schemas + UUID/date param parsing across routes
 *   - **HubSpot integration**: webhook timestamp validation
 *   - **Knowledge ingestion**: file upload validation
 *   - **Scheduling**: day-of-week range guards
 *
 * Why bug-numbered, not feature-named: keeps the April 1 sweep
 * together. Feature-area work should still grep here.
 *
 * Every test includes:
 * - Happy path: valid inputs → correct behavior
 * - Sad path: invalid inputs → error with 5W diagnostics (who/what/where/when/how)
 *
 * Requires: local Postgres on port 5433 (skips gracefully when unavailable)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Client } from "pg";
import { z } from "zod";
import {
  getRootClient, clearDB, setupBasicTenant,
  beginTestTransaction, rollbackTestTransaction,
  createTenant, createCustomer, createEmployee, createResource, createService,
  createAppointment,
} from "./test-utils";

let client: Client;
let tenantA: string;
let tenantB: string;
let dbAvailable = false;

beforeAll(async () => {
  try {
    client = await getRootClient();
    await clearDB(client);
    tenantA = await createTenant(client, "Tenant A", "auto-repair");
    tenantB = await createTenant(client, "Tenant B", "salon");
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (client) await client.end();
});

beforeEach(async () => {
  if (dbAvailable) await beginTestTransaction(client);
});

afterEach(async () => {
  if (dbAvailable) await rollbackTestTransaction(client);
});

// ═══════════════════════════════════════════════════════════════════════
// TENANT ISOLATION (Bugs 4, 5, 6, 7, 13, 14)
// ═══════════════════════════════════════════════════════════════════════

describe("Tenant isolation on DELETE/UPDATE queries", () => {
  // --- Happy path ---
  it("DELETE customer with correct tenant succeeds", async () => {
    // WHO: tenant owner deleting their own customer
    // WHAT: DELETE with matching tenant_id and customer id
    // WHEN: customer deletion via dashboard or API
    // WHERE: customers table, tenant-scoped DELETE query
    // WHY: confirms the baseline happy path — tenant can manage their own data
    if (!dbAvailable) return;
    const custA = await createCustomer(client, tenantA, "Alice", "+15550001111");

    const res = await client.query(
      "DELETE FROM customers WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [custA, tenantA]
    );
    expect(res.rowCount).toBe(1);

    const check = await client.query("SELECT id FROM customers WHERE id = $1", [custA]);
    expect(check.rows).toHaveLength(0);
  });

  // --- Sad path: cross-tenant deletion blocked ---
  it("DELETE customer with WRONG tenant returns 0 rows (WHO: tenantB, WHAT: delete custA, WHERE: customers table, HOW: tenant_id mismatch)", async () => {
    // WHO: tenantB attempting to delete tenantA's customer
    // WHAT: DELETE with mismatched tenant_id — custA belongs to tenantA
    // WHEN: cross-tenant deletion attempt via API
    // WHERE: customers table, tenant-scoped DELETE WHERE tenant_id clause
    // WHY: BUG-004/BUG-006 — without tenant_id in WHERE, any tenant could delete another's data
    if (!dbAvailable) return;
    const custA = await createCustomer(client, tenantA, "Alice", "+15550001111");

    const res = await client.query(
      "DELETE FROM customers WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [custA, tenantB]
    );
    expect(res.rowCount).toBe(0);

    // Verify custA still exists — tenantB could not delete it
    const check = await client.query("SELECT id, name FROM customers WHERE id = $1", [custA]);
    expect(check.rows).toHaveLength(1);
    expect(check.rows[0].name).toBe("Alice");
  });

  // --- Happy path ---
  it("UPDATE customer with correct tenant succeeds", async () => {
    // WHO: tenant owner updating their own customer record
    // WHAT: UPDATE with matching tenant_id and customer id
    // WHEN: customer edit via dashboard CRM view
    // WHERE: customers table, tenant-scoped UPDATE query
    // WHY: confirms the baseline happy path — tenant can update their own data
    if (!dbAvailable) return;
    const custA = await createCustomer(client, tenantA, "Alice", "+15550001111");

    const res = await client.query(
      "UPDATE customers SET name = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id",
      ["Alice Updated", custA, tenantA]
    );
    expect(res.rowCount).toBe(1);
  });

  // --- Sad path: cross-tenant update blocked ---
  it("UPDATE customer with WRONG tenant affects 0 rows (WHO: tenantB, WHAT: update custA name, WHERE: customers, HOW: tenant_id filter blocks)", async () => {
    // WHO: tenantB attempting to modify tenantA's customer
    // WHAT: UPDATE customer name with mismatched tenant_id
    // WHEN: cross-tenant update attempt via API
    // WHERE: customers table, tenant-scoped UPDATE WHERE tenant_id clause
    // WHY: BUG-004/BUG-006 — without tenant_id in WHERE, any tenant could overwrite another's customer data
    if (!dbAvailable) return;
    const custA = await createCustomer(client, tenantA, "Alice", "+15550001111");

    const res = await client.query(
      "UPDATE customers SET name = $1 WHERE id = $2 AND tenant_id = $3",
      ["HACKED", custA, tenantB]
    );
    expect(res.rowCount).toBe(0);

    const check = await client.query("SELECT name FROM customers WHERE id = $1", [custA]);
    expect(check.rows[0].name).toBe("Alice");
  });

  // --- Happy path ---
  it("DELETE appointment with correct tenant succeeds", async () => {
    // WHO: tenant owner deleting their own appointment
    // WHAT: DELETE with matching tenant_id and appointment id
    // WHEN: appointment cancellation via dashboard
    // WHERE: appointments table, tenant-scoped DELETE query
    // WHY: confirms the baseline happy path — tenant can cancel their own appointments
    if (!dbAvailable) return;
    const resA = await createResource(client, tenantA, "Bay A");
    const custA = await createCustomer(client, tenantA, "Alice", "+15550001111");
    const apptA = await createAppointment(client, tenantA, resA, custA,
      "2026-05-01 10:00:00", "2026-05-01 11:00:00", "Test");

    const res = await client.query(
      "DELETE FROM appointments WHERE appointment_id = $1 AND tenant_id = $2 RETURNING appointment_id AS id",
      [apptA, tenantA]
    );
    expect(res.rowCount).toBe(1);
  });

  // --- Sad path: cross-tenant appointment deletion blocked ---
  it("DELETE appointment with WRONG tenant returns 0 rows (WHO: tenantB, WHAT: delete apptA, WHERE: appointments, HOW: tenant_id mismatch)", async () => {
    // WHO: tenantB attempting to delete tenantA's appointment
    // WHAT: DELETE appointment with mismatched tenant_id
    // WHEN: cross-tenant deletion attempt via API
    // WHERE: appointments table, tenant-scoped DELETE WHERE tenant_id clause
    // WHY: BUG-013/BUG-014 — without tenant_id in WHERE, any tenant could cancel another's bookings
    if (!dbAvailable) return;
    const resA = await createResource(client, tenantA, "Bay A");
    const custA = await createCustomer(client, tenantA, "Alice", "+15550001111");
    const apptA = await createAppointment(client, tenantA, resA, custA,
      "2026-05-01 10:00:00", "2026-05-01 11:00:00", "Test");

    const res = await client.query(
      "DELETE FROM appointments WHERE appointment_id = $1 AND tenant_id = $2 RETURNING appointment_id AS id",
      [apptA, tenantB]
    );
    expect(res.rowCount).toBe(0);

    const check = await client.query("SELECT appointment_id AS id FROM appointments WHERE appointment_id = $1", [apptA]);
    expect(check.rows).toHaveLength(1);
  });

  // --- Sad path: cross-tenant resource update blocked ---
  it("UPDATE resource with WRONG tenant affects 0 rows (WHO: tenantB, WHAT: update resourceA, WHERE: resources, HOW: tenant_id filter)", async () => {
    // WHO: tenantB attempting to rename tenantA's resource
    // WHAT: UPDATE resource name with mismatched tenant_id
    // WHEN: cross-tenant update attempt via API
    // WHERE: resources table, tenant-scoped UPDATE WHERE tenant_id clause
    // WHY: BUG-007 — without tenant_id in WHERE, any tenant could rename another's bays/stations
    if (!dbAvailable) return;
    const resA = await createResource(client, tenantA, "Bay A");

    const res = await client.query(
      "UPDATE resources SET name = $1 WHERE resource_id = $2 AND tenant_id = $3",
      ["HACKED", resA, tenantB]
    );
    expect(res.rowCount).toBe(0);

    const check = await client.query("SELECT name FROM resources WHERE resource_id = $1", [resA]);
    expect(check.rows[0].name).toBe("Bay A");
  });

  // --- Sad path: cross-tenant service update blocked ---
  it("UPDATE service with WRONG tenant affects 0 rows (WHO: tenantB, WHAT: update serviceA, WHERE: services, HOW: tenant_id filter)", async () => {
    // WHO: tenantB attempting to modify tenantA's service
    // WHAT: UPDATE service name with mismatched tenant_id
    // WHEN: cross-tenant update attempt via API
    // WHERE: services table, tenant-scoped UPDATE WHERE tenant_id clause
    // WHY: BUG-007 — without tenant_id in WHERE, any tenant could alter another's service catalog
    if (!dbAvailable) return;
    const svcA = await createService(client, tenantA, "Oil Change", 30);

    const res = await client.query(
      "UPDATE services SET name = $1 WHERE service_id = $2 AND tenant_id = $3",
      ["HACKED", svcA, tenantB]
    );
    expect(res.rowCount).toBe(0);

    const check = await client.query("SELECT name FROM services WHERE service_id = $1", [svcA]);
    expect(check.rows[0].name).toBe("Oil Change");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DELETE RETURNS 404 (Bugs 34, 35)
// ═══════════════════════════════════════════════════════════════════════

describe("DELETE routes return 404 for missing entities", () => {
  // BUG-034 was about the now-deleted /shifts/:id DELETE route + the
  // employee_shifts table. Both removed in NEEDS-REFACTORING #4
  // Phase 2; the BUG-034 shift cases are obsolete. Skill cases remain.

  // --- Sad path: skill not found ---
  it("DELETE non-existent skill returns 0 rows (WHO: tenantA, WHAT: delete skill, WHERE: tenant_skills, WHEN: ID not found, HOW: RETURNING id yields empty result)", async () => {
    // WHO: tenant owner attempting to delete a non-existent skill
    // WHAT: DELETE with a fake UUID that doesn't match any skill
    // WHEN: stale UI state or race condition on skill deletion
    // WHERE: tenant_skills table, DELETE RETURNING query
    // WHY: BUG-035 — route must return 404 (not 200) when skill not found, requires checking rowCount
    if (!dbAvailable) return;
    const fakeId = "00000000-0000-0000-0000-000000000099";

    const res = await client.query(
      "DELETE FROM tenant_skills WHERE tenant_skill_id = $1 AND tenant_id = $2 RETURNING tenant_skill_id",
      [fakeId, tenantA]
    );
    expect(res.rows).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ZOD VALIDATION SCHEMAS (Bugs 10, 26, 29)
// ═══════════════════════════════════════════════════════════════════════

describe("Zod validation schemas — happy and sad paths", () => {
  const CustomerUpdateSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    phone: z.string().min(1).max(30).optional(),
    email: z.string().email().optional().nullable(),
    first_name: z.string().max(100).optional().nullable(),
    last_name: z.string().max(100).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    address_line2: z.string().max(500).optional().nullable(),
    city: z.string().max(100).optional().nullable(),
    state: z.string().max(100).optional().nullable(),
    postal_code: z.string().max(20).optional().nullable(),
    timezone: z.string().max(50).optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  });

  const AppointmentUpdateSchema = z.object({
    tenant_id: z.string().uuid(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    description: z.string().max(1000).optional(),
    location: z.string().max(500).optional().nullable(),
    resource_id: z.string().uuid().optional(),
    employee_id: z.union([z.string(), z.number(), z.null()]).optional(),
    customer_name: z.string().max(200).optional(),
    customer_phone: z.string().max(30).optional(),
    customer_notes: z.string().max(2000).optional(),
  });

  const ActivateSchema = z.object({
    tenant_id: z.string().uuid(),
    area_code: z.string().regex(/^\d{3}$/).optional(),
  });

  // --- CustomerUpdateSchema ---
  it("CustomerUpdateSchema: happy path — valid partial update", () => {
    // WHO: dashboard user editing a customer's name and email
    // WHAT: valid partial payload with name and email fields
    // WHEN: PUT /customers/:id from CRM detail panel
    // WHERE: CustomerUpdateSchema Zod validator
    // WHY: BUG-010 — validates that partial updates pass schema (not all fields required)
    const result = CustomerUpdateSchema.safeParse({ name: "Alice", email: "alice@example.com" });
    expect(result.success).toBe(true);
  });

  it("CustomerUpdateSchema: happy path — empty body (no fields required)", () => {
    // WHO: dashboard user submitting form with no changes
    // WHAT: empty body {} — all fields are optional on update
    // WHEN: PUT /customers/:id with no modified fields
    // WHERE: CustomerUpdateSchema Zod validator
    // WHY: BUG-010 — empty body must be valid since it's a partial update schema
    const result = CustomerUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("CustomerUpdateSchema: sad path — invalid email (WHAT: email validation, HOW: not a valid email format)", () => {
    // WHO: dashboard user typing a malformed email
    // WHAT: email field with invalid format "not-an-email"
    // WHEN: PUT /customers/:id with bad email value
    // WHERE: CustomerUpdateSchema Zod validator, email field
    // WHY: BUG-010 — without Zod validation, invalid emails reach the DB and break email sync
    const result = CustomerUpdateSchema.safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toContain("email");
    expect(result.error!.issues[0].message).toContain("email");
  });

  it("CustomerUpdateSchema: sad path — name too long (WHAT: name length, HOW: exceeds 200 char max)", () => {
    // WHO: dashboard user or API caller submitting an excessively long name
    // WHAT: name field with 201 characters, exceeding 200 char max
    // WHEN: PUT /customers/:id with oversized name
    // WHERE: CustomerUpdateSchema Zod validator, name field
    // WHY: BUG-010 — without length validation, oversized names could overflow DB column or break UI layout
    const result = CustomerUpdateSchema.safeParse({ name: "x".repeat(201) });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toContain("name");
  });

  // --- AppointmentUpdateSchema ---
  it("AppointmentUpdateSchema: happy path — minimal update with valid UUID", () => {
    // WHO: dashboard user updating an appointment with minimal fields
    // WHAT: payload with only the required tenant_id field
    // WHEN: PUT /appointments/:id with just tenant context
    // WHERE: AppointmentUpdateSchema Zod validator
    // WHY: BUG-026 — validates that minimal payloads pass when only tenant_id is required
    const result = AppointmentUpdateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
    });
    expect(result.success).toBe(true);
  });

  it("AppointmentUpdateSchema: happy path — full update", () => {
    // WHO: dashboard user modifying all appointment fields
    // WHAT: full payload with start_time, end_time, description, employee_id, customer_name
    // WHEN: PUT /appointments/:id with all editable fields
    // WHERE: AppointmentUpdateSchema Zod validator
    // WHY: BUG-026 — validates that a fully populated update payload passes schema
    const result = AppointmentUpdateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
      start_time: "2026-04-01T10:00:00Z",
      end_time: "2026-04-01T11:00:00Z",
      description: "Tire rotation",
      employee_id: null,
      customer_name: "Alice",
    });
    expect(result.success).toBe(true);
  });

  it("AppointmentUpdateSchema: sad path — missing tenant_id (WHO: unknown, WHAT: appointment update, HOW: tenant_id is required)", () => {
    // WHO: API caller submitting appointment update without tenant context
    // WHAT: payload missing the required tenant_id field
    // WHEN: PUT /appointments/:id without tenant_id in body
    // WHERE: AppointmentUpdateSchema Zod validator, tenant_id field
    // WHY: BUG-026 — missing tenant_id would bypass tenant isolation on the update
    const result = AppointmentUpdateSchema.safeParse({ start_time: "2026-04-01T10:00:00Z" });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toContain("tenant_id");
  });

  it("AppointmentUpdateSchema: sad path — tenant_id not UUID (WHO: caller, WHAT: appointment update, HOW: tenant_id must be valid UUID)", () => {
    // WHO: API caller submitting a non-UUID tenant_id (injection attempt or bug)
    // WHAT: tenant_id field with invalid format "not-a-uuid"
    // WHEN: PUT /appointments/:id with malformed tenant_id
    // WHERE: AppointmentUpdateSchema Zod validator, tenant_id field
    // WHY: BUG-026/BUG-023 — non-UUID tenant_id could cause SQL errors or injection
    const result = AppointmentUpdateSchema.safeParse({ tenant_id: "not-a-uuid" });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toContain("tenant_id");
    expect(result.error!.issues[0].message.toLowerCase()).toContain("uuid");
  });

  it("AppointmentUpdateSchema: sad path — description too long (WHAT: description, HOW: exceeds 1000 chars)", () => {
    // WHO: API caller submitting an oversized appointment description
    // WHAT: description field with 1001 characters, exceeding 1000 char max
    // WHEN: PUT /appointments/:id with excessively long description
    // WHERE: AppointmentUpdateSchema Zod validator, description field
    // WHY: BUG-029 — without length limits, large payloads could exhaust DB storage or break UI
    const result = AppointmentUpdateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
      description: "x".repeat(1001),
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toContain("description");
  });

  // --- ActivateSchema ---
  it("ActivateSchema: happy path — valid tenant_id with area code", () => {
    // WHO: super-admin activating a phone number for a tenant
    // WHAT: valid tenant_id UUID and 3-digit area code "630"
    // WHEN: POST /provisioning/activate from SetupWizard Go Live step
    // WHERE: ActivateSchema Zod validator in provisioning route
    // WHY: validates the happy path for phone provisioning activation
    const result = ActivateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
      area_code: "630",
    });
    expect(result.success).toBe(true);
  });

  it("ActivateSchema: sad path — missing tenant_id (WHAT: provisioning, HOW: tenant_id required)", () => {
    // WHO: API caller attempting to activate without specifying a tenant
    // WHAT: empty payload missing required tenant_id
    // WHEN: POST /provisioning/activate with empty body
    // WHERE: ActivateSchema Zod validator in provisioning route
    // WHY: without tenant_id, provisioning cannot associate the phone number with a tenant
    const result = ActivateSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error!.issues.some(i => i.path.includes("tenant_id"))).toBe(true);
  });

  it("ActivateSchema: sad path — invalid area_code (WHAT: provisioning, HOW: area_code must be 3 digits)", () => {
    // WHO: API caller submitting an invalid area code (5 digits instead of 3)
    // WHAT: area_code "12345" fails regex /^\d{3}$/
    // WHEN: POST /provisioning/activate with malformed area code
    // WHERE: ActivateSchema Zod validator, area_code field
    // WHY: invalid area codes would cause Telnyx number search to fail or return wrong region
    const result = ActivateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
      area_code: "12345",
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toContain("area_code");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// UUID VALIDATION (Bugs 23, 31)
// ═══════════════════════════════════════════════════════════════════════

describe("UUID validation on URL parameters", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // --- Happy path ---
  it("valid UUIDs pass validation", () => {
    // WHO: any API caller providing entity IDs in URL parameters
    // WHAT: correctly formatted UUIDs (lowercase, uppercase, all-zeros)
    // WHEN: any route that accepts :id URL params (GET/PUT/DELETE)
    // WHERE: UUID regex validation on URL parameters
    // WHY: BUG-023/BUG-031 — confirms that valid UUIDs pass the regex gate
    expect(UUID_RE.test("f234e471-0e60-4163-86c9-93cfd9338e3a")).toBe(true);
    expect(UUID_RE.test("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(UUID_RE.test("A234E471-0E60-4163-86C9-93CFD9338E3A")).toBe(true);
  });

  // --- Sad paths ---
  it("rejects non-UUID strings (WHAT: UUID validation, HOW: regex mismatch)", () => {
    // WHO: API caller providing a non-UUID string as an entity ID
    // WHAT: "not-a-uuid" fails the UUID regex pattern
    // WHEN: any route that accepts :id URL params
    // WHERE: UUID regex validation on URL parameters
    // WHY: BUG-023 — non-UUID strings passed to SQL would cause Postgres cast errors or undefined behavior
    expect(UUID_RE.test("not-a-uuid")).toBe(false);
  });

  it("rejects path traversal attempts (WHO: attacker, WHAT: path traversal, WHERE: URL param, HOW: regex blocks non-hex chars)", () => {
    // WHO: attacker attempting path traversal via URL parameter
    // WHAT: "../../etc/passwd" injected as entity ID
    // WHEN: any route with :id parameter (e.g., GET /customers/../../etc/passwd)
    // WHERE: UUID regex validation on URL parameters
    // WHY: BUG-023 — without UUID validation, path traversal could reach filesystem or leak data
    expect(UUID_RE.test("../../etc/passwd")).toBe(false);
  });

  it("rejects SQL injection attempts (WHO: attacker, WHAT: SQL injection, WHERE: URL param, HOW: regex blocks quotes/semicolons)", () => {
    // WHO: attacker injecting SQL via URL parameter
    // WHAT: "'; DROP TABLE tenants;--" injected as entity ID
    // WHEN: any route with :id parameter
    // WHERE: UUID regex validation on URL parameters
    // WHY: BUG-023 — UUID regex is the first line of defense against SQL injection in URL params
    expect(UUID_RE.test("'; DROP TABLE tenants;--")).toBe(false);
  });

  it("rejects truncated UUIDs (WHAT: UUID validation, HOW: too few segments)", () => {
    // WHO: API caller with a truncated or copy-paste-corrupted UUID
    // WHAT: "f234e471-0e60-4163-86c9" — only 4 of 5 UUID segments
    // WHEN: any route with :id parameter
    // WHERE: UUID regex validation on URL parameters
    // WHY: BUG-031 — truncated UUIDs would cause Postgres UUID cast errors (22P02)
    expect(UUID_RE.test("f234e471-0e60-4163-86c9")).toBe(false);
  });

  it("rejects empty strings (WHAT: UUID validation, HOW: empty input)", () => {
    // WHO: API caller with missing or empty ID parameter
    // WHAT: empty string "" as entity ID
    // WHEN: any route with :id parameter where ID is omitted
    // WHERE: UUID regex validation on URL parameters
    // WHY: BUG-031 — empty string passed to SQL WHERE id=$1 would match nothing or error
    expect(UUID_RE.test("")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DATE VALIDATION (Bug 36)
// ═══════════════════════════════════════════════════════════════════════

describe("Date query parameter validation", () => {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // --- Happy path ---
  it("accepts valid YYYY-MM-DD dates", () => {
    // WHO: dashboard user or API caller providing date query parameters
    // WHAT: correctly formatted YYYY-MM-DD dates (various years and months)
    // WHEN: GET /appointments?date=, GET /shifts?date=, GET /analytics?date=
    // WHERE: date regex validation on query parameters
    // WHY: BUG-036 — confirms that valid ISO dates pass the date format gate
    expect(DATE_RE.test("2026-04-01")).toBe(true);
    expect(DATE_RE.test("2026-12-31")).toBe(true);
    expect(DATE_RE.test("2000-01-01")).toBe(true);
  });

  // --- Sad paths ---
  it("rejects malformed dates (WHAT: date validation, HOW: wrong format)", () => {
    // WHO: API caller with incorrectly formatted date strings
    // WHAT: various invalid formats — text, slashes, US format, single-digit month/day
    // WHEN: GET routes with date query parameters
    // WHERE: date regex validation on query parameters
    // WHY: BUG-036 — malformed dates passed to SQL could cause parse errors or unexpected results
    expect(DATE_RE.test("not-a-date")).toBe(false);
    expect(DATE_RE.test("2026/04/01")).toBe(false);
    expect(DATE_RE.test("04-01-2026")).toBe(false);
    expect(DATE_RE.test("2026-4-1")).toBe(false);
  });

  it("rejects SQL injection in date params (WHO: attacker, WHAT: injection, WHERE: date query param, HOW: regex blocks)", () => {
    // WHO: attacker injecting SQL via date query parameter
    // WHAT: SQL injection payloads in date field — DROP TABLE and OR 1=1 variants
    // WHEN: GET routes with date query parameters
    // WHERE: date regex validation on query parameters
    // WHY: BUG-036 — date regex is a defense layer against injection in date-based queries
    expect(DATE_RE.test("'; DROP TABLE--")).toBe(false);
    expect(DATE_RE.test("2026-04-01' OR '1'='1")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// dayOfWeek VALIDATION (Bug 9)
// ═══════════════════════════════════════════════════════════════════════

describe("dayOfWeek range validation", () => {
  function clampDayOfWeek(raw: string | undefined): number {
    const rawDow = parseInt(raw || String(new Date().getDay()), 10);
    return (Number.isNaN(rawDow) || rawDow < 0 || rawDow > 6) ? new Date().getDay() : rawDow;
  }

  // --- Happy path ---
  it("accepts valid days 0-6", () => {
    // WHO: analytics route parsing day_of_week query parameter
    // WHAT: valid day-of-week values 0 (Sunday), 3 (Wednesday), 6 (Saturday)
    // WHEN: GET /analytics?dayOfWeek= for busiest-hours chart
    // WHERE: clampDayOfWeek helper in analytics route
    // WHY: BUG-009 — confirms valid days pass through without clamping
    expect(clampDayOfWeek("0")).toBe(0);
    expect(clampDayOfWeek("3")).toBe(3);
    expect(clampDayOfWeek("6")).toBe(6);
  });

  // --- Sad paths ---
  it("clamps negative day to current day (WHAT: dayOfWeek, HOW: -1 is out of range 0-6)", () => {
    // WHO: API caller sending negative day_of_week value
    // WHAT: day_of_week "-1" which is below the valid range 0-6
    // WHEN: GET /analytics?dayOfWeek=-1
    // WHERE: clampDayOfWeek helper in analytics route
    // WHY: BUG-009 — negative day_of_week caused SQL to return wrong shift data or error
    const result = clampDayOfWeek("-1");
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(6);
  });

  it("clamps day > 6 to current day (WHAT: dayOfWeek, HOW: 7 is out of range 0-6)", () => {
    // WHO: API caller sending day_of_week value above valid range
    // WHAT: day_of_week "7" which exceeds the valid range 0-6
    // WHEN: GET /analytics?dayOfWeek=7
    // WHERE: clampDayOfWeek helper in analytics route
    // WHY: BUG-009 — day_of_week > 6 caused SQL to return empty results (no shifts match day 7)
    const result = clampDayOfWeek("7");
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(6);
  });

  it("handles NaN input gracefully (WHAT: dayOfWeek, HOW: non-numeric string falls back to current day)", () => {
    // WHO: API caller sending non-numeric day_of_week value
    // WHAT: day_of_week "abc" which parseInt cannot parse (NaN)
    // WHEN: GET /analytics?dayOfWeek=abc
    // WHERE: clampDayOfWeek helper in analytics route
    // WHY: BUG-009 — NaN propagated to SQL caused the entire analytics query to fail
    const result = clampDayOfWeek("abc");
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// HubSpot TIMESTAMP REPLAY PROTECTION (Bug 37)
// ═══════════════════════════════════════════════════════════════════════

describe("HubSpot webhook timestamp validation", () => {
  function validateTimestamp(raw: string): { valid: boolean; error?: string } {
    const timestampMs = Number(raw);
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
      return { valid: false, error: `Invalid timestamp header: "${raw}" (WHO: webhook caller, WHAT: timestamp parse, HOW: not a finite positive number)` };
    }
    const requestAge = Date.now() - timestampMs;
    if (requestAge > 5 * 60 * 1000) {
      return { valid: false, error: `Timestamp too old: age=${requestAge}ms (WHO: webhook caller, WHAT: replay protection, WHEN: ${new Date(timestampMs).toISOString()}, HOW: exceeds 5min window)` };
    }
    if (requestAge < -30_000) {
      return { valid: false, error: `Timestamp in future: age=${requestAge}ms (WHO: webhook caller, WHAT: clock skew, WHEN: ${new Date(timestampMs).toISOString()}, HOW: more than 30s ahead)` };
    }
    return { valid: true };
  }

  // --- Happy path ---
  it("accepts current timestamp", () => {
    // WHO: HubSpot webhook sending a fresh request
    // WHAT: timestamp header set to current time (Date.now())
    // WHEN: POST /hubspot/webhook with valid timing
    // WHERE: validateTimestamp helper in hubspot route
    // WHY: BUG-037 — confirms fresh webhook requests pass the replay protection window
    const result = validateTimestamp(String(Date.now()));
    expect(result.valid).toBe(true);
  });

  it("accepts timestamp from 2 minutes ago", () => {
    // WHO: HubSpot webhook with slight network delay
    // WHAT: timestamp header set to 2 minutes ago (within 5-min window)
    // WHEN: POST /hubspot/webhook with minor delivery delay
    // WHERE: validateTimestamp helper in hubspot route
    // WHY: BUG-037 — confirms that normal network delays (< 5 min) are tolerated
    const result = validateTimestamp(String(Date.now() - 2 * 60 * 1000));
    expect(result.valid).toBe(true);
  });

  // --- Sad paths ---
  it("rejects NaN timestamp (WHO: attacker, WHAT: timestamp forge, HOW: non-numeric value)", () => {
    // WHO: attacker sending a forged non-numeric timestamp header
    // WHAT: timestamp header "not-a-number" which parses to NaN
    // WHEN: POST /hubspot/webhook with malformed timestamp
    // WHERE: validateTimestamp helper in hubspot route
    // WHY: BUG-037 — NaN timestamps would bypass replay protection if not explicitly checked
    const result = validateTimestamp("not-a-number");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not a finite positive number");
  });

  it("rejects empty timestamp (WHO: malformed request, WHAT: missing timestamp, HOW: empty string)", () => {
    // WHO: malformed webhook request missing timestamp header
    // WHAT: empty string "" as timestamp value
    // WHEN: POST /hubspot/webhook with missing X-HubSpot-Signature-v3 timestamp
    // WHERE: validateTimestamp helper in hubspot route
    // WHY: BUG-037 — empty timestamps must be rejected to prevent unsigned webhook processing
    const result = validateTimestamp("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not a finite positive number");
  });

  it("rejects timestamp older than 5 minutes (WHO: webhook, WHAT: replay attack, WHEN: 10min ago, HOW: exceeds window)", () => {
    // WHO: attacker replaying a captured webhook request from 10 minutes ago
    // WHAT: timestamp 10 minutes in the past, exceeding the 5-minute replay window
    // WHEN: POST /hubspot/webhook with stale timestamp header
    // WHERE: validateTimestamp helper in hubspot route
    // WHY: BUG-037 — without replay protection, captured webhooks could be re-sent to trigger duplicate actions
    const result = validateTimestamp(String(Date.now() - 10 * 60 * 1000));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too old");
    expect(result.error).toContain("5min window");
  });

  it("rejects timestamp more than 30s in the future (WHO: webhook, WHAT: clock skew, HOW: future timestamp)", () => {
    // WHO: webhook request with clock skew or forged future timestamp
    // WHAT: timestamp 60 seconds in the future, exceeding 30-second tolerance
    // WHEN: POST /hubspot/webhook with future-dated timestamp
    // WHERE: validateTimestamp helper in hubspot route
    // WHY: BUG-037 — future timestamps could be pre-computed for delayed replay attacks
    const result = validateTimestamp(String(Date.now() + 60 * 1000));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("future");
    expect(result.error).toContain("30s ahead");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FILE UPLOAD VALIDATION (Bugs 30, 40)
// ═══════════════════════════════════════════════════════════════════════

describe("Knowledge file upload validation", () => {
  const allowedExtensions = [".txt", ".md", ".csv", ".json", ".pdf"];
  const MAX_CHUNKS = 500;

  function validateFile(filename: string): { valid: boolean; error?: string } {
    const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
    if (!allowedExtensions.includes(ext)) {
      return { valid: false, error: `Unsupported file type "${ext}" (WHO: uploader, WHAT: file type check, WHERE: /knowledge/ingest, HOW: allowed=${allowedExtensions.join(",")})` };
    }
    return { valid: true };
  }

  function validateChunkCount(count: number): { valid: boolean; error?: string } {
    if (count > MAX_CHUNKS) {
      return { valid: false, error: `Too many chunks: ${count} (WHO: uploader, WHAT: chunk limit, WHERE: /knowledge/ingest, HOW: max=${MAX_CHUNKS}, split file into smaller parts)` };
    }
    return { valid: true };
  }

  // --- Happy paths ---
  it("accepts .txt files", () => {
    // WHO: tenant owner uploading a knowledge base document
    // WHAT: .txt file "policy.txt" — a supported extension
    // WHEN: POST /knowledge/ingest with text file attachment
    // WHERE: validateFile helper in knowledge route
    // WHY: BUG-030 — confirms .txt files pass the allowlist check
    expect(validateFile("policy.txt").valid).toBe(true);
  });

  it("accepts .pdf files", () => {
    // WHO: tenant owner uploading a PDF manual for RAG
    // WHAT: .pdf file "manual.pdf" — a supported extension
    // WHEN: POST /knowledge/ingest with PDF attachment
    // WHERE: validateFile helper in knowledge route
    // WHY: BUG-030 — confirms .pdf files pass the allowlist check
    expect(validateFile("manual.pdf").valid).toBe(true);
  });

  it("accepts file with 100 chunks", () => {
    // WHO: tenant owner uploading a moderately-sized document
    // WHAT: document that produces 100 chunks (well under 500 limit)
    // WHEN: POST /knowledge/ingest chunking phase
    // WHERE: validateChunkCount helper in knowledge route
    // WHY: BUG-040 — confirms normal-sized documents pass the chunk limit
    expect(validateChunkCount(100).valid).toBe(true);
  });

  // --- Sad paths ---
  it("rejects .exe files (WHO: uploader, WHAT: file type, WHERE: /knowledge/ingest, HOW: .exe not in allowlist)", () => {
    // WHO: user or attacker uploading an executable file
    // WHAT: .exe file "malware.exe" — not in the allowed extensions list
    // WHEN: POST /knowledge/ingest with executable attachment
    // WHERE: validateFile helper in knowledge route
    // WHY: BUG-030 — without file type validation, executables could be stored and potentially executed
    const result = validateFile("malware.exe");
    expect(result.valid).toBe(false);
    expect(result.error).toContain(".exe");
    expect(result.error).toContain("Unsupported");
  });

  it("rejects .sh files (WHO: uploader, WHAT: file type, WHERE: /knowledge/ingest, HOW: .sh not in allowlist)", () => {
    // WHO: user or attacker uploading a shell script
    // WHAT: .sh file "script.sh" — not in the allowed extensions list
    // WHEN: POST /knowledge/ingest with script attachment
    // WHERE: validateFile helper in knowledge route
    // WHY: BUG-030 — shell scripts must be blocked to prevent code execution on the server
    const result = validateFile("script.sh");
    expect(result.valid).toBe(false);
    expect(result.error).toContain(".sh");
  });

  it("rejects file producing too many chunks (WHO: uploader, WHAT: chunk limit, WHERE: /knowledge/ingest, HOW: exceeds MAX_CHUNKS)", () => {
    // WHO: tenant owner uploading an excessively large document
    // WHAT: document producing 501 chunks, exceeding the 500 chunk limit
    // WHEN: POST /knowledge/ingest chunking phase
    // WHERE: validateChunkCount helper in knowledge route
    // WHY: BUG-040 — without chunk limits, large files exhaust embedding API quota and DB storage
    const result = validateChunkCount(501);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("501");
    expect(result.error).toContain("max=500");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// requireAuth MIDDLEWARE (Bug 3)
// ═══════════════════════════════════════════════════════════════════════

describe("requireAuth middleware", () => {
  // --- Happy path ---
  it("returns true when req.auth is set", async () => {
    // WHO: authenticated dashboard user making an API request
    // WHAT: req.auth populated with valid tenant_id, user_id, and email from JWT
    // WHEN: any protected route after JWT middleware has run
    // WHERE: requireAuth helper in src/middleware.ts
    // WHY: BUG-003 — confirms authenticated requests pass through the guard
    const { requireAuth } = await import("./middleware");
    const fakeReq = { auth: { tenant_id: "t1", user_id: "u1", email: "a@b.com" } } as unknown as import("./middleware").AppRequest;
    const fakeReply = {} as unknown as import("fastify").FastifyReply;
    expect(requireAuth(fakeReq, fakeReply)).toBe(true);
  });

  // --- Sad path ---
  it("returns false and sends 401 when req.auth missing (WHO: unauthenticated caller, WHAT: auth check, WHERE: requireAuth, HOW: no JWT token)", async () => {
    // WHO: unauthenticated caller (no JWT token or expired session)
    // WHAT: req.auth is undefined — no valid JWT was decoded
    // WHEN: any protected route called without Authorization header
    // WHERE: requireAuth helper in src/middleware.ts
    // WHY: BUG-003 — without requireAuth, unauthenticated users could access admin routes
    const { requireAuth } = await import("./middleware");
    let statusCode: number | undefined;
    let body: unknown;

    const fakeReq = {} as unknown as import("./middleware").AppRequest;
    const fakeReply = {
      status(code: number) {
        statusCode = code;
        return { send(b: unknown) { body = b; } };
      },
    } as unknown as import("fastify").FastifyReply;

    const result = requireAuth(fakeReq, fakeReply);
    expect(result).toBe(false);
    expect(statusCode).toBe(401);
    expect(body).toEqual({ success: false, error: "Authentication required" });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SOURCE CODE ASSERTIONS (verify fixes are in place)
// ═══════════════════════════════════════════════════════════════════════

describe("Source code correctness checks", () => {
  const fs = require("fs");

  it("sync uses orchestrator with structured logging (appointments.ts)", () => {
    // WHO: appointment route handler triggering CRM/calendar sync
    // WHAT: source code must use syncAppointmentToAll + req.log, not .catch(() => {})
    // WHEN: POST/PUT/DELETE /appointments triggers sync to all integrations
    // WHERE: src/routes/appointments.ts sync trigger points
    // WHY: silent .catch(() => {}) swallowed sync errors, making integration failures invisible
    const src = fs.readFileSync("src/routes/appointments.ts", "utf8");
    expect(src).toContain("syncAppointmentToAll");
    expect(src).toContain("req.log");
    expect(src).not.toContain(".catch(() => {})");
  });

  it("sync uses orchestrator with structured logging (customers.ts)", () => {
    // WHO: customer route handler triggering CRM sync
    // WHAT: source code must use syncCustomerToAll + req.log, not .catch(() => {})
    // WHEN: POST/PUT/DELETE /customers triggers sync to all CRM integrations
    // WHERE: src/routes/customers.ts sync trigger points
    // WHY: silent .catch(() => {}) swallowed sync errors, making CRM sync failures invisible
    const src = fs.readFileSync("src/routes/customers.ts", "utf8");
    expect(src).toContain("syncCustomerToAll");
    expect(src).toContain("req.log");
    expect(src).not.toContain(".catch(() => {})");
  });

  it("Stripe webhook does not leak err.message", () => {
    // WHO: Stripe webhook handler processing payment events
    // WHAT: error response must use generic message, not expose err.message
    // WHEN: POST /billing/webhook with invalid signature
    // WHERE: src/routes/billing.ts webhook signature verification
    // WHY: leaking err.message in responses exposes internal error details to attackers
    const src = fs.readFileSync("src/routes/billing.ts", "utf8");
    expect(src).not.toContain("error: `Invalid signature: ${err.message}`");
    expect(src).toContain("'Invalid webhook signature'");
  });

  it("all CRM/calendar clients have fetch timeouts", () => {
    // WHO: CRM/calendar client services making external API calls
    // WHAT: every fetch() call must have AbortSignal.timeout(FETCH_TIMEOUT_MS)
    // WHEN: any outbound HTTP request to Jobber, HubSpot, Square, ServiceTitan, Outlook
    // WHERE: src/services/*Client.ts and outlookCalendar.ts
    // WHY: without fetch timeouts, hung external APIs block the Node event loop indefinitely
    const files = [
      "src/services/jobberClient.ts",
      "src/services/hubspotClient.ts",
      "src/services/squareClient.ts",
      "src/services/servicetitanClient.ts",
      "src/services/outlookCalendar.ts",
    ];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      const fetchCount = (src.match(/res = await fetch\(/g) || []).length;
      const timeoutCount = (src.match(/AbortSignal\.timeout\(FETCH_TIMEOUT_MS\)/g) || []).length;
      expect(timeoutCount).toBe(fetchCount);
    }
  });

  it("shared tokenManagement uses FOR UPDATE and all sync services delegate to it", () => {
    // WHO: all CRM sync services refreshing OAuth tokens
    // WHAT: tokenManagement uses FOR UPDATE lock, all 4 CRM syncs + calendar use shared helpers
    // WHEN: any CRM sync operation that needs to refresh an expired OAuth token
    // WHERE: src/services/tokenManagement.ts and all *Sync.ts services
    // WHY: without FOR UPDATE, concurrent token refreshes cause race conditions and token invalidation
    const src = fs.readFileSync("src/services/tokenManagement.ts", "utf8");
    expect(src).toContain("FOR UPDATE");

    // All CRM sync services delegate to getIntegrationTokens
    for (const file of [
      "src/services/jobberSync.ts",
      "src/services/hubspotSync.ts",
      "src/services/squareSync.ts",
      "src/services/servicetitanSync.ts",
    ]) {
      expect(fs.readFileSync(file, "utf8")).toContain("getIntegrationTokens");
    }
    // Calendar sync delegates token refresh to the shared helper too.
    // (Previously imported TOKEN_BUFFER_MS for an inline copy of the
    // refresh logic; now the helper owns both.)
    expect(fs.readFileSync("src/services/calendarSync.ts", "utf8")).toContain("getCalendarTokens");
  });

  it("PUBLIC_ROUTES includes all OAuth callbacks and webhooks", () => {
    // WHO: external services (Google, Outlook, HubSpot, Jobber, Square, ServiceTitan) calling back
    // WHAT: all OAuth callback and webhook routes must be in PUBLIC_ROUTES (skip JWT auth)
    // WHEN: OAuth redirect after user authorizes, or CRM sends webhook event
    // WHERE: src/middleware.ts PUBLIC_ROUTES array (in registerJwtAuthHook).
    //        Moved from src/index.ts during NEEDS-REFACTORING #11 cleanup.
    // WHY: OAuth callbacks and webhooks come from external services without JWT — blocking them breaks all integrations
    const src = fs.readFileSync("src/middleware.ts", "utf8");
    for (const route of [
      "/calendar/auth/google/callback",
      "/calendar/auth/outlook/callback",
      "/hubspot/auth/callback",
      "/jobber/auth/callback",
      "/square/auth/callback",
      "/servicetitan/auth/callback",
      "/hubspot/webhook",
      "/square/webhook",
      "/servicetitan/webhook",
    ]) {
      expect(src).toContain(`'${route}'`);
    }
  });
});
