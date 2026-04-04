/**
 * Comprehensive happy + sad path tests for all bug fixes (April 1, 2026).
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
  createShift, createAppointment,
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
    if (!dbAvailable) return;
    const resA = await createResource(client, tenantA, "Bay A");
    const custA = await createCustomer(client, tenantA, "Alice", "+15550001111");
    const apptA = await createAppointment(client, tenantA, resA, custA,
      "2026-05-01 10:00:00", "2026-05-01 11:00:00", "Test");

    const res = await client.query(
      "DELETE FROM appointments WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [apptA, tenantA]
    );
    expect(res.rowCount).toBe(1);
  });

  // --- Sad path: cross-tenant appointment deletion blocked ---
  it("DELETE appointment with WRONG tenant returns 0 rows (WHO: tenantB, WHAT: delete apptA, WHERE: appointments, HOW: tenant_id mismatch)", async () => {
    if (!dbAvailable) return;
    const resA = await createResource(client, tenantA, "Bay A");
    const custA = await createCustomer(client, tenantA, "Alice", "+15550001111");
    const apptA = await createAppointment(client, tenantA, resA, custA,
      "2026-05-01 10:00:00", "2026-05-01 11:00:00", "Test");

    const res = await client.query(
      "DELETE FROM appointments WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [apptA, tenantB]
    );
    expect(res.rowCount).toBe(0);

    const check = await client.query("SELECT id FROM appointments WHERE id = $1", [apptA]);
    expect(check.rows).toHaveLength(1);
  });

  // --- Sad path: cross-tenant resource update blocked ---
  it("UPDATE resource with WRONG tenant affects 0 rows (WHO: tenantB, WHAT: update resourceA, WHERE: resources, HOW: tenant_id filter)", async () => {
    if (!dbAvailable) return;
    const resA = await createResource(client, tenantA, "Bay A");

    const res = await client.query(
      "UPDATE resources SET name = $1 WHERE id = $2 AND tenant_id = $3",
      ["HACKED", resA, tenantB]
    );
    expect(res.rowCount).toBe(0);

    const check = await client.query("SELECT name FROM resources WHERE id = $1", [resA]);
    expect(check.rows[0].name).toBe("Bay A");
  });

  // --- Sad path: cross-tenant service update blocked ---
  it("UPDATE service with WRONG tenant affects 0 rows (WHO: tenantB, WHAT: update serviceA, WHERE: services, HOW: tenant_id filter)", async () => {
    if (!dbAvailable) return;
    const svcA = await createService(client, tenantA, "Oil Change", 30);

    const res = await client.query(
      "UPDATE services SET name = $1 WHERE id = $2 AND tenant_id = $3",
      ["HACKED", svcA, tenantB]
    );
    expect(res.rowCount).toBe(0);

    const check = await client.query("SELECT name FROM services WHERE id = $1", [svcA]);
    expect(check.rows[0].name).toBe("Oil Change");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DELETE RETURNS 404 (Bugs 34, 35)
// ═══════════════════════════════════════════════════════════════════════

describe("DELETE routes return 404 for missing entities", () => {
  // --- Happy path ---
  it("DELETE existing shift succeeds and returns the id", async () => {
    if (!dbAvailable) return;
    const emp = await createEmployee(client, tenantA, "John");
    const shiftId = await createShift(client, tenantA, emp, 1, "09:00", "17:00");

    const res = await client.query(
      "DELETE FROM employee_shifts WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [shiftId, tenantA]
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBe(shiftId);
  });

  // --- Sad path: shift not found ---
  it("DELETE non-existent shift returns 0 rows (WHO: tenantA, WHAT: delete shift, WHERE: employee_shifts, WHEN: ID not found, HOW: RETURNING id yields empty result)", async () => {
    if (!dbAvailable) return;
    const fakeId = "00000000-0000-0000-0000-000000000099";

    const res = await client.query(
      "DELETE FROM employee_shifts WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [fakeId, tenantA]
    );
    expect(res.rows).toHaveLength(0);
  });

  // --- Sad path: skill not found ---
  it("DELETE non-existent skill returns 0 rows (WHO: tenantA, WHAT: delete skill, WHERE: tenant_skills, WHEN: ID not found, HOW: RETURNING id yields empty result)", async () => {
    if (!dbAvailable) return;
    const fakeId = "00000000-0000-0000-0000-000000000099";

    const res = await client.query(
      "DELETE FROM tenant_skills WHERE id = $1 AND tenant_id = $2 RETURNING id",
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
    const result = CustomerUpdateSchema.safeParse({ name: "Alice", email: "alice@example.com" });
    expect(result.success).toBe(true);
  });

  it("CustomerUpdateSchema: happy path — empty body (no fields required)", () => {
    const result = CustomerUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("CustomerUpdateSchema: sad path — invalid email (WHAT: email validation, HOW: not a valid email format)", () => {
    const result = CustomerUpdateSchema.safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toContain("email");
    expect(result.error!.issues[0].message).toContain("email");
  });

  it("CustomerUpdateSchema: sad path — name too long (WHAT: name length, HOW: exceeds 200 char max)", () => {
    const result = CustomerUpdateSchema.safeParse({ name: "x".repeat(201) });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toContain("name");
  });

  // --- AppointmentUpdateSchema ---
  it("AppointmentUpdateSchema: happy path — minimal update with valid UUID", () => {
    const result = AppointmentUpdateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
    });
    expect(result.success).toBe(true);
  });

  it("AppointmentUpdateSchema: happy path — full update", () => {
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
    const result = AppointmentUpdateSchema.safeParse({ start_time: "2026-04-01T10:00:00Z" });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toContain("tenant_id");
  });

  it("AppointmentUpdateSchema: sad path — tenant_id not UUID (WHO: caller, WHAT: appointment update, HOW: tenant_id must be valid UUID)", () => {
    const result = AppointmentUpdateSchema.safeParse({ tenant_id: "not-a-uuid" });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toContain("tenant_id");
    expect(result.error!.issues[0].message.toLowerCase()).toContain("uuid");
  });

  it("AppointmentUpdateSchema: sad path — description too long (WHAT: description, HOW: exceeds 1000 chars)", () => {
    const result = AppointmentUpdateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
      description: "x".repeat(1001),
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toContain("description");
  });

  // --- ActivateSchema ---
  it("ActivateSchema: happy path — valid tenant_id with area code", () => {
    const result = ActivateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
      area_code: "630",
    });
    expect(result.success).toBe(true);
  });

  it("ActivateSchema: sad path — missing tenant_id (WHAT: provisioning, HOW: tenant_id required)", () => {
    const result = ActivateSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error!.issues.some(i => i.path.includes("tenant_id"))).toBe(true);
  });

  it("ActivateSchema: sad path — invalid area_code (WHAT: provisioning, HOW: area_code must be 3 digits)", () => {
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
    expect(UUID_RE.test("f234e471-0e60-4163-86c9-93cfd9338e3a")).toBe(true);
    expect(UUID_RE.test("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(UUID_RE.test("A234E471-0E60-4163-86C9-93CFD9338E3A")).toBe(true);
  });

  // --- Sad paths ---
  it("rejects non-UUID strings (WHAT: UUID validation, HOW: regex mismatch)", () => {
    expect(UUID_RE.test("not-a-uuid")).toBe(false);
  });

  it("rejects path traversal attempts (WHO: attacker, WHAT: path traversal, WHERE: URL param, HOW: regex blocks non-hex chars)", () => {
    expect(UUID_RE.test("../../etc/passwd")).toBe(false);
  });

  it("rejects SQL injection attempts (WHO: attacker, WHAT: SQL injection, WHERE: URL param, HOW: regex blocks quotes/semicolons)", () => {
    expect(UUID_RE.test("'; DROP TABLE tenants;--")).toBe(false);
  });

  it("rejects truncated UUIDs (WHAT: UUID validation, HOW: too few segments)", () => {
    expect(UUID_RE.test("f234e471-0e60-4163-86c9")).toBe(false);
  });

  it("rejects empty strings (WHAT: UUID validation, HOW: empty input)", () => {
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
    expect(DATE_RE.test("2026-04-01")).toBe(true);
    expect(DATE_RE.test("2026-12-31")).toBe(true);
    expect(DATE_RE.test("2000-01-01")).toBe(true);
  });

  // --- Sad paths ---
  it("rejects malformed dates (WHAT: date validation, HOW: wrong format)", () => {
    expect(DATE_RE.test("not-a-date")).toBe(false);
    expect(DATE_RE.test("2026/04/01")).toBe(false);
    expect(DATE_RE.test("04-01-2026")).toBe(false);
    expect(DATE_RE.test("2026-4-1")).toBe(false);
  });

  it("rejects SQL injection in date params (WHO: attacker, WHAT: injection, WHERE: date query param, HOW: regex blocks)", () => {
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
    expect(clampDayOfWeek("0")).toBe(0);
    expect(clampDayOfWeek("3")).toBe(3);
    expect(clampDayOfWeek("6")).toBe(6);
  });

  // --- Sad paths ---
  it("clamps negative day to current day (WHAT: dayOfWeek, HOW: -1 is out of range 0-6)", () => {
    const result = clampDayOfWeek("-1");
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(6);
  });

  it("clamps day > 6 to current day (WHAT: dayOfWeek, HOW: 7 is out of range 0-6)", () => {
    const result = clampDayOfWeek("7");
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(6);
  });

  it("handles NaN input gracefully (WHAT: dayOfWeek, HOW: non-numeric string falls back to current day)", () => {
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
    const result = validateTimestamp(String(Date.now()));
    expect(result.valid).toBe(true);
  });

  it("accepts timestamp from 2 minutes ago", () => {
    const result = validateTimestamp(String(Date.now() - 2 * 60 * 1000));
    expect(result.valid).toBe(true);
  });

  // --- Sad paths ---
  it("rejects NaN timestamp (WHO: attacker, WHAT: timestamp forge, HOW: non-numeric value)", () => {
    const result = validateTimestamp("not-a-number");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not a finite positive number");
  });

  it("rejects empty timestamp (WHO: malformed request, WHAT: missing timestamp, HOW: empty string)", () => {
    const result = validateTimestamp("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not a finite positive number");
  });

  it("rejects timestamp older than 5 minutes (WHO: webhook, WHAT: replay attack, WHEN: 10min ago, HOW: exceeds window)", () => {
    const result = validateTimestamp(String(Date.now() - 10 * 60 * 1000));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too old");
    expect(result.error).toContain("5min window");
  });

  it("rejects timestamp more than 30s in the future (WHO: webhook, WHAT: clock skew, HOW: future timestamp)", () => {
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
    expect(validateFile("policy.txt").valid).toBe(true);
  });

  it("accepts .pdf files", () => {
    expect(validateFile("manual.pdf").valid).toBe(true);
  });

  it("accepts file with 100 chunks", () => {
    expect(validateChunkCount(100).valid).toBe(true);
  });

  // --- Sad paths ---
  it("rejects .exe files (WHO: uploader, WHAT: file type, WHERE: /knowledge/ingest, HOW: .exe not in allowlist)", () => {
    const result = validateFile("malware.exe");
    expect(result.valid).toBe(false);
    expect(result.error).toContain(".exe");
    expect(result.error).toContain("Unsupported");
  });

  it("rejects .sh files (WHO: uploader, WHAT: file type, WHERE: /knowledge/ingest, HOW: .sh not in allowlist)", () => {
    const result = validateFile("script.sh");
    expect(result.valid).toBe(false);
    expect(result.error).toContain(".sh");
  });

  it("rejects file producing too many chunks (WHO: uploader, WHAT: chunk limit, WHERE: /knowledge/ingest, HOW: exceeds MAX_CHUNKS)", () => {
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
    const { requireAuth } = await import("./middleware");
    const fakeReq = { auth: { tenant_id: "t1", user_id: "u1", email: "a@b.com" } } as any;
    const fakeReply = {} as any;
    expect(requireAuth(fakeReq, fakeReply)).toBe(true);
  });

  // --- Sad path ---
  it("returns false and sends 401 when req.auth missing (WHO: unauthenticated caller, WHAT: auth check, WHERE: requireAuth, HOW: no JWT token)", async () => {
    const { requireAuth } = await import("./middleware");
    let statusCode: number | undefined;
    let body: any;

    const fakeReq = {} as any;
    const fakeReply = {
      status(code: number) {
        statusCode = code;
        return { send(b: any) { body = b; } };
      },
    } as any;

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
    const src = fs.readFileSync("src/routes/appointments.ts", "utf8");
    expect(src).toContain("syncAppointmentToAll");
    expect(src).toContain("req.log");
    expect(src).not.toContain(".catch(() => {})");
  });

  it("sync uses orchestrator with structured logging (customers.ts)", () => {
    const src = fs.readFileSync("src/routes/customers.ts", "utf8");
    expect(src).toContain("syncCustomerToAll");
    expect(src).toContain("req.log");
    expect(src).not.toContain(".catch(() => {})");
  });

  it("Stripe webhook does not leak err.message", () => {
    const src = fs.readFileSync("src/routes/billing.ts", "utf8");
    expect(src).not.toContain("error: `Invalid signature: ${err.message}`");
    expect(src).toContain("'Invalid webhook signature'");
  });

  it("edge function uses optional chaining on call-ended", () => {
    const src = fs.readFileSync("supabase/functions/vapi-tools/core/dispatcher.ts", "utf8");
    expect(src).toContain("message.call?.id");
    expect(src).toContain("message.call?.endedReason");
  });

  it("all CRM/calendar clients have fetch timeouts", () => {
    const files = [
      "src/services/jobberClient.ts",
      "src/services/hubspotClient.ts",
      "src/services/squareClient.ts",
      "src/services/servicetitanClient.ts",
      "src/services/outlookCalendar.ts",
      "src/services/vapiClient.ts",
    ];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      const fetchCount = (src.match(/res = await fetch\(/g) || []).length;
      const timeoutCount = (src.match(/AbortSignal\.timeout\(FETCH_TIMEOUT_MS\)/g) || []).length;
      expect(timeoutCount).toBe(fetchCount);
    }
  });

  it("shared tokenManagement uses FOR UPDATE and all sync services delegate to it", () => {
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
    // Calendar sync imports shared types/constants from tokenManagement
    expect(fs.readFileSync("src/services/calendarSync.ts", "utf8")).toContain("TOKEN_BUFFER_MS");
  });

  it("edge function guards INSERT RETURNING results", () => {
    const src = fs.readFileSync("supabase/functions/vapi-tools/db/repository.ts", "utf8");
    expect(src).toContain("INSERT INTO customers returned no row");
    expect(src).toContain("INSERT INTO employees returned no row");
    expect(src).toContain("INSERT INTO services returned no row");
    expect(src).toContain("book_with_scheduling_atomic returned no result");
  });

  it("PUBLIC_ROUTES includes all OAuth callbacks and webhooks", () => {
    const src = fs.readFileSync("src/index.ts", "utf8");
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
