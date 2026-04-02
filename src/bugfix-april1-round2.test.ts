/**
 * Tests for bug fixes applied April 1, 2026 — Round 2:
 *
 * 21. Fetch timeouts on all CRM/calendar HTTP calls
 * 22. ServiceTitan webhook shared secret verification
 * 23. Jobber webhook tenantId UUID validation
 * 24. Edge function booking RPC null guard
 * 25. Token refresh race condition (SELECT ... FOR UPDATE)
 */

import { describe, it, expect } from "vitest";
import fs from "fs";

// ── 21. Fetch timeouts on all external HTTP calls ────────────────────

describe("Fetch timeouts on CRM/calendar HTTP calls", () => {
  const clientFiles = [
    { file: "src/services/jobberClient.ts", name: "Jobber" },
    { file: "src/services/hubspotClient.ts", name: "HubSpot" },
    { file: "src/services/squareClient.ts", name: "Square" },
    { file: "src/services/servicetitanClient.ts", name: "ServiceTitan" },
    { file: "src/services/outlookCalendar.ts", name: "Outlook" },
    { file: "src/services/vapiClient.ts", name: "Vapi" },
  ];

  for (const { file, name } of clientFiles) {
    it(`${name} client declares FETCH_TIMEOUT_MS constant`, () => {
      const src = fs.readFileSync(file, "utf8");
      expect(src).toContain("FETCH_TIMEOUT_MS");
    });

    it(`${name} client uses AbortSignal.timeout on all fetch calls`, () => {
      const src = fs.readFileSync(file, "utf8");
      // Count fetch calls and AbortSignal.timeout calls — they should match
      const fetchCount = (src.match(/res = await fetch\(/g) || []).length;
      const timeoutCount = (src.match(/signal: AbortSignal\.timeout\(FETCH_TIMEOUT_MS\)/g) || []).length;
      expect(fetchCount).toBeGreaterThan(0);
      expect(timeoutCount).toBe(fetchCount);
    });
  }
});

// ── 22. ServiceTitan webhook authentication ──────────────────────────

describe("ServiceTitan webhook authentication", () => {
  it("servicetitan.ts checks webhook secret from env var", () => {
    const src = fs.readFileSync("src/routes/servicetitan.ts", "utf8");

    // Should reference the env var
    expect(src).toContain("SERVICETITAN_WEBHOOK_SECRET");
    // Should check incoming header
    expect(src).toContain("x-servicetitan-webhook-secret");
    // Should return 401 on auth failure
    expect(src).toContain("401");
    // Should NOT say "no signature verification"
    expect(src).not.toContain("no signature verification");
  });

  it("servicetitan.ts logs warning when secret is not configured", () => {
    const src = fs.readFileSync("src/routes/servicetitan.ts", "utf8");
    expect(src).toContain("webhook authentication disabled");
  });
});

// ── 23. Jobber webhook tenantId UUID validation ──────────────────────

describe("Jobber webhook tenantId UUID validation", () => {
  it("jobber.ts validates tenantId format with UUID regex", () => {
    const src = fs.readFileSync("src/routes/jobber.ts", "utf8");
    // Should have UUID validation regex
    expect(src).toContain("UUID_RE");
    expect(src).toContain("UUID_RE.test(tenantId)");
  });

  it("UUID regex correctly validates UUIDs", () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Valid UUIDs
    expect(UUID_RE.test("f234e471-0e60-4163-86c9-93cfd9338e3a")).toBe(true);
    expect(UUID_RE.test("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(UUID_RE.test("A234E471-0E60-4163-86C9-93CFD9338E3A")).toBe(true);

    // Invalid inputs
    expect(UUID_RE.test("not-a-uuid")).toBe(false);
    expect(UUID_RE.test("../../etc/passwd")).toBe(false);
    expect(UUID_RE.test("'; DROP TABLE tenants;--")).toBe(false);
    expect(UUID_RE.test("")).toBe(false);
    expect(UUID_RE.test("f234e471-0e60-4163-86c9")).toBe(false); // truncated
  });
});

// ── 24. Edge function booking RPC null guard ─────────────────────────

describe("Edge function booking RPC null guard", () => {
  it("repository.ts checks for null result from book_with_scheduling_atomic", () => {
    const src = fs.readFileSync("supabase/functions/vapi-tools/db/repository.ts", "utf8");
    expect(src).toContain("if (!result)");
    expect(src).toContain("book_with_scheduling_atomic returned no result");
  });
});

// ── 25. Token refresh race condition (SELECT ... FOR UPDATE) ─────────

describe("Token refresh uses SELECT ... FOR UPDATE to prevent races", () => {
  it("shared tokenManagement.ts uses FOR UPDATE in both integration and calendar token queries", () => {
    const src = fs.readFileSync("src/services/tokenManagement.ts", "utf8");
    // Both getIntegrationTokens and getCalendarTokens should use FOR UPDATE
    const matches = src.match(/FOR UPDATE/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("all sync services delegate to shared tokenManagement", () => {
    const syncFiles = [
      "src/services/jobberSync.ts",
      "src/services/hubspotSync.ts",
      "src/services/squareSync.ts",
      "src/services/servicetitanSync.ts",
    ];
    for (const file of syncFiles) {
      const src = fs.readFileSync(file, "utf8");
      expect(src).toContain("getIntegrationTokens");
    }
    // calendarSync imports shared types/constants from tokenManagement
    const calSrc = fs.readFileSync("src/services/calendarSync.ts", "utf8");
    expect(calSrc).toContain("TOKEN_BUFFER_MS");
  });
});
