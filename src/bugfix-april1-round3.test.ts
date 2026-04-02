/**
 * Tests for bug fixes applied April 1, 2026 — Round 3:
 *
 * 26. POST /appointments/:id/update — Zod validation
 * 27. Edge function repository.ts — null guards on INSERT RETURNING
 * 28. Edge function repository.ts — consistent optional chaining on verify
 * 29. provisioning.ts — tenant_id UUID validation
 * 30. knowledge.ts — file upload content-type validation
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import { z } from "zod";

// ── 26. Appointment update Zod validation ────────────────────────────

describe("Appointment update Zod validation", () => {
  it("appointments.ts defines AppointmentUpdateSchema", () => {
    const src = fs.readFileSync("src/routes/appointments.ts", "utf8");
    expect(src).toContain("AppointmentUpdateSchema");
    expect(src).toContain("AppointmentUpdateSchema.safeParse(req.body)");
  });

  it("appointments.ts no longer uses `req.body as {` for the update route", () => {
    const src = fs.readFileSync("src/routes/appointments.ts", "utf8");
    // The old pattern was: const body = req.body as { tenant_id: string; start_time: ...
    // After the update route, there should be no `req.body as {` pattern
    // (the create route uses Zod too, so there should be zero instances)
    const matches = src.match(/req\.body as \{/g);
    expect(matches).toBeNull();
  });

  it("AppointmentUpdateSchema validates correctly", () => {
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

    // Valid: minimal update
    expect(AppointmentUpdateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
    }).success).toBe(true);

    // Valid: full update
    expect(AppointmentUpdateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
      start_time: "2026-04-01T10:00:00Z",
      end_time: "2026-04-01T11:00:00Z",
      description: "Tire rotation",
      customer_name: "Alice",
    }).success).toBe(true);

    // Invalid: missing tenant_id
    expect(AppointmentUpdateSchema.safeParse({
      start_time: "2026-04-01T10:00:00Z",
    }).success).toBe(false);

    // Invalid: tenant_id is not UUID
    expect(AppointmentUpdateSchema.safeParse({
      tenant_id: "not-a-uuid",
    }).success).toBe(false);

    // Invalid: description too long
    expect(AppointmentUpdateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
      description: "x".repeat(1001),
    }).success).toBe(false);
  });
});

// ── 27. Edge function null guards on INSERT RETURNING ────────────────

describe("Edge function INSERT RETURNING null guards", () => {
  it("repository.ts guards createCustomer INSERT result", () => {
    const src = fs.readFileSync("supabase/functions/vapi-tools/db/repository.ts", "utf8");
    expect(src).toContain('INSERT INTO customers returned no row');
  });

  it("repository.ts guards createEmployee INSERT result", () => {
    const src = fs.readFileSync("supabase/functions/vapi-tools/db/repository.ts", "utf8");
    expect(src).toContain('INSERT INTO employees returned no row');
  });

  it("repository.ts guards createService INSERT result", () => {
    const src = fs.readFileSync("supabase/functions/vapi-tools/db/repository.ts", "utf8");
    expect(src).toContain('INSERT INTO services returned no row');
  });

  it("repository.ts guards bookWithSchedulingAtomic result", () => {
    const src = fs.readFileSync("supabase/functions/vapi-tools/db/repository.ts", "utf8");
    expect(src).toContain('book_with_scheduling_atomic returned no result');
  });
});

// ── 28. Consistent optional chaining on verify check ─────────────────

describe("Edge function verify check uses consistent optional chaining", () => {
  it("repository.ts uses ?. on both sides of the verify condition", () => {
    const src = fs.readFileSync("supabase/functions/vapi-tools/db/repository.ts", "utf8");
    // Should use optional chaining on both sides
    expect(src).toContain("verify.rows[0]?.val || verify.rows[0]?.val !== tenantId");
  });
});

// ── 29. Provisioning tenant_id UUID validation ───────────────────────

describe("Provisioning tenant_id UUID validation", () => {
  it("provisioning.ts imports zod and defines ActivateSchema", () => {
    const src = fs.readFileSync("src/routes/provisioning.ts", "utf8");
    expect(src).toContain("import { z }");
    expect(src).toContain("ActivateSchema");
  });

  it("provisioning.ts validates activate route with Zod", () => {
    const src = fs.readFileSync("src/routes/provisioning.ts", "utf8");
    expect(src).toContain("ActivateSchema.safeParse(req.body)");
  });

  it("provisioning.ts validates deactivate route with Zod", () => {
    const src = fs.readFileSync("src/routes/provisioning.ts", "utf8");
    // Deactivate route should also have UUID validation
    expect(src).toContain("z.string().uuid()");
    // Should have two safeParse calls (activate + deactivate)
    const parseMatches = src.match(/\.safeParse\(req\.body\)/g);
    expect(parseMatches).not.toBeNull();
    expect(parseMatches!.length).toBeGreaterThanOrEqual(2);
  });

  it("ActivateSchema rejects non-UUID tenant_id", () => {
    const ActivateSchema = z.object({
      tenant_id: z.string().uuid(),
      area_code: z.string().regex(/^\d{3}$/).optional(),
    });

    // Valid
    expect(ActivateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
    }).success).toBe(true);

    // Valid with area code
    expect(ActivateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
      area_code: "630",
    }).success).toBe(true);

    // Invalid: not a UUID
    expect(ActivateSchema.safeParse({
      tenant_id: "not-a-uuid",
    }).success).toBe(false);

    // Invalid: missing tenant_id
    expect(ActivateSchema.safeParse({}).success).toBe(false);

    // Invalid: bad area code
    expect(ActivateSchema.safeParse({
      tenant_id: "f234e471-0e60-4163-86c9-93cfd9338e3a",
      area_code: "12345",
    }).success).toBe(false);
  });
});

// ── 30. Knowledge file upload content-type validation ────────────────

describe("Knowledge file upload content-type validation", () => {
  it("knowledge.ts checks file extension against allowlist", () => {
    const src = fs.readFileSync("src/routes/knowledge.ts", "utf8");
    expect(src).toContain("allowedExtensions");
    expect(src).toContain(".txt");
    expect(src).toContain(".pdf");
    expect(src).toContain(".md");
    expect(src).toContain("Unsupported file type");
  });

  it("extension check logic correctly filters files", () => {
    const allowedExtensions = ['.txt', '.md', '.csv', '.json', '.pdf'];

    const checkExtension = (filename: string) => {
      const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
      return allowedExtensions.includes(ext);
    };

    // Allowed
    expect(checkExtension("policy.txt")).toBe(true);
    expect(checkExtension("readme.md")).toBe(true);
    expect(checkExtension("data.csv")).toBe(true);
    expect(checkExtension("config.json")).toBe(true);
    expect(checkExtension("manual.pdf")).toBe(true);
    expect(checkExtension("POLICY.TXT")).toBe(true);

    // Rejected
    expect(checkExtension("script.exe")).toBe(false);
    expect(checkExtension("image.png")).toBe(false);
    expect(checkExtension("malware.sh")).toBe(false);
    expect(checkExtension("binary.bin")).toBe(false);
    expect(checkExtension("archive.zip")).toBe(false);
  });
});
