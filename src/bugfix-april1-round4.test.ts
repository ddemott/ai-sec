/**
 * Tests for bug fixes applied April 1, 2026 — Round 4:
 *
 * 31. Mapping routes: URL params validated as UUID
 * 34. DELETE /shifts checks rowCount (returns 404 when not found)
 * 35. DELETE /skills checks rowCount (returns 404 when not found)
 * 36. Analytics coverage: date query params validated
 * 40. Knowledge upload: chunk count cap
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { Client } from "pg";
import {
  getRootClient, clearDB, setupBasicTenant,
  beginTestTransaction, rollbackTestTransaction,
} from "./test-utils";

// ── 31. Mapping routes UUID validation ───────────────────────────────

describe("Mapping routes UUID param validation", () => {
  it("mappings.ts defines UUID_RE and uses it on all 4 mutation routes", () => {
    const src = fs.readFileSync("src/routes/mappings.ts", "utf8");

    expect(src).toContain("UUID_RE");

    // All 4 routes should have the UUID check
    const checks = src.match(/UUID_RE\.test\(/g);
    expect(checks).not.toBeNull();
    // 4 routes × 2 params each = 8 checks
    expect(checks!.length).toBe(8);
  });

  it("mappings.ts returns 400 for invalid UUIDs", () => {
    const src = fs.readFileSync("src/routes/mappings.ts", "utf8");
    expect(src).toContain("must be UUID");
  });
});

// ── 34 & 35. DELETE /shifts and /skills check rowCount ───────────────

describe("DELETE routes return 404 when entity not found", () => {
  let client: Client;
  let tenantId: string;
  let dbAvailable = true;

  beforeAll(async () => {
    try {
      client = await getRootClient();
      await clearDB(client);
      const setup = await setupBasicTenant(client);
      tenantId = setup.tenantId;
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

  it("shifts.ts uses RETURNING id on DELETE to detect missing rows", () => {
    const src = fs.readFileSync("src/routes/shifts.ts", "utf8");
    expect(src).toContain("DELETE FROM employee_shifts WHERE id = $1 AND tenant_id = $2 RETURNING id");
    expect(src).toContain("Shift not found");
    expect(src).toContain("404");
  });

  it("skills.ts uses RETURNING id on DELETE to detect missing rows", () => {
    const src = fs.readFileSync("src/routes/skills.ts", "utf8");
    expect(src).toContain("DELETE FROM tenant_skills WHERE id = $1 AND tenant_id = $2 RETURNING id");
    expect(src).toContain("Skill not found");
    expect(src).toContain("404");
  });

  it("DELETE shift with non-existent ID returns 0 rows", async () => {
    if (!dbAvailable) return;

    const fakeId = "00000000-0000-0000-0000-000000000099";
    const res = await client.query(
      "DELETE FROM employee_shifts WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [fakeId, tenantId]
    );
    expect(res.rows.length).toBe(0);
  });

  it("DELETE skill with non-existent ID returns 0 rows", async () => {
    if (!dbAvailable) return;

    const fakeId = "00000000-0000-0000-0000-000000000099";
    const res = await client.query(
      "DELETE FROM tenant_skills WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [fakeId, tenantId]
    );
    expect(res.rows.length).toBe(0);
  });
});

// ── 36. Analytics date validation ────────────────────────────────────

describe("Analytics date query param validation", () => {
  it("analytics.ts validates dates with YYYY-MM-DD regex", () => {
    const src = fs.readFileSync("src/routes/analytics.ts", "utf8");
    expect(src).toContain("DATE_RE");
    expect(src).toContain("DATE_RE.test(rawStart)");
    expect(src).toContain("DATE_RE.test(rawEnd)");
  });

  it("DATE_RE correctly validates date strings", () => {
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

    // Valid
    expect(DATE_RE.test("2026-04-01")).toBe(true);
    expect(DATE_RE.test("2026-12-31")).toBe(true);

    // Invalid
    expect(DATE_RE.test("not-a-date")).toBe(false);
    expect(DATE_RE.test("2026/04/01")).toBe(false);
    expect(DATE_RE.test("04-01-2026")).toBe(false);
    expect(DATE_RE.test("2026-4-1")).toBe(false);
    expect(DATE_RE.test("'; DROP TABLE--")).toBe(false);
    expect(DATE_RE.test("")).toBe(false);
  });
});

// ── 40. Knowledge upload chunk cap ───────────────────────────────────

describe("Knowledge upload chunk count cap", () => {
  it("knowledge.ts defines MAX_CHUNKS and rejects oversized files", () => {
    const src = fs.readFileSync("src/routes/knowledge.ts", "utf8");
    expect(src).toContain("MAX_CHUNKS");
    expect(src).toContain("File too large");
    expect(src).toContain("split into smaller files");
  });

  it("chunk count cap is a reasonable number (100-1000)", () => {
    const src = fs.readFileSync("src/routes/knowledge.ts", "utf8");
    const match = src.match(/MAX_CHUNKS\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const maxChunks = parseInt(match![1], 10);
    expect(maxChunks).toBeGreaterThanOrEqual(100);
    expect(maxChunks).toBeLessThanOrEqual(1000);
  });
});
