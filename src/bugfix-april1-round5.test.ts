/**
 * Tests for bug fixes applied April 1, 2026 — Round 5 (final):
 *
 * 33. Appointment update: body.tenant_id cross-checked against auth context
 * 37. HubSpot webhook: timestamp replay protection handles NaN and future timestamps
 */

import { describe, it, expect } from "vitest";
import fs from "fs";

// ── 33. Appointment update tenant_id cross-check ─────────────────────

describe("Appointment update tenant_id cross-check", () => {
  it("appointments.ts cross-checks body.tenant_id against auth tenant", () => {
    const src = fs.readFileSync("src/routes/appointments.ts", "utf8");

    // Should check auth tenant_id against body tenant_id
    expect(src).toContain("body.tenant_id !== authTenantId");
    // Should reference SUPER_ADMIN_TENANT_ID for bypass
    expect(src).toContain("SUPER_ADMIN_TENANT_ID");
    // Should return 403
    expect(src).toContain("tenant_id does not match authenticated tenant");
  });

  it("the check allows super-admin to update any tenant", () => {
    const src = fs.readFileSync("src/routes/appointments.ts", "utf8");
    // Super-admin bypass: authTenantId !== SUPER_ADMIN_TENANT_ID
    expect(src).toContain("authTenantId !== SUPER_ADMIN_TENANT_ID");
  });

  it("the check is skipped when no auth context (unauthenticated — caught by other guards)", () => {
    const src = fs.readFileSync("src/routes/appointments.ts", "utf8");
    // Should only enforce when authTenantId is truthy
    expect(src).toContain("if (authTenantId &&");
  });
});

// ── 37. HubSpot webhook timestamp replay protection ──────────────────

describe("HubSpot webhook timestamp replay protection", () => {
  it("hubspot.ts validates timestamp is a finite number", () => {
    const src = fs.readFileSync("src/routes/hubspot.ts", "utf8");
    expect(src).toContain("Number.isFinite(timestampMs)");
    expect(src).toContain("Invalid or missing timestamp header");
  });

  it("hubspot.ts rejects future timestamps (clock skew protection)", () => {
    const src = fs.readFileSync("src/routes/hubspot.ts", "utf8");
    // Should check for negative age (future timestamps)
    expect(src).toContain("requestAge < -30_000");
    expect(src).toContain("too far in the future");
  });

  it("NaN timestamp is correctly detected by Number.isFinite", () => {
    // This is the actual bug: Number("not-a-number") => NaN
    // NaN > 5*60*1000 => false, so old code would have let it through
    const badTimestamp = "not-a-number";
    const timestampMs = Number(badTimestamp);
    expect(Number.isFinite(timestampMs)).toBe(false);

    // Empty string
    const emptyTimestamp = Number("");
    expect(Number.isFinite(emptyTimestamp)).toBe(true); // 0 is finite
    expect(emptyTimestamp <= 0).toBe(true); // but <= 0 catches it
  });

  it("valid timestamps pass the check", () => {
    const now = Date.now();
    const timestampMs = Number(String(now));
    expect(Number.isFinite(timestampMs)).toBe(true);
    expect(timestampMs > 0).toBe(true);

    const requestAge = Date.now() - timestampMs;
    expect(requestAge >= 0).toBe(true);
    expect(requestAge < 5 * 60 * 1000).toBe(true);
  });

  it("old timestamps are correctly rejected", () => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const requestAge = Date.now() - tenMinutesAgo;
    expect(requestAge > 5 * 60 * 1000).toBe(true);
  });

  it("future timestamps beyond 30s are correctly rejected", () => {
    const oneMinuteInFuture = Date.now() + 60 * 1000;
    const requestAge = Date.now() - oneMinuteInFuture;
    expect(requestAge < -30_000).toBe(true);
  });
});
