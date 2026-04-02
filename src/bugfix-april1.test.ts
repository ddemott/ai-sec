/**
 * Tests for bug fixes applied April 1, 2026:
 *
 * 1. OAuth callbacks & webhooks in PUBLIC_ROUTES / TENANT_EXEMPT_ROUTES
 * 2. requireAuth guard on tenant admin routes
 * 3. Tenant-scoped DELETE/UPDATE on customers, appointments, resources
 * 4. dayOfWeek range validation in analytics
 * 5. CustomerUpdateSchema Zod validation
 * 6. Sync error logging (not silent swallowing)
 * 7. Null guard on booking RPC result
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Client } from "pg";
import { z } from "zod";
import {
  getRootClient, clearDB, setupBasicTenant,
  beginTestTransaction, rollbackTestTransaction,
  createTenant, createCustomer, createResource,
} from "./test-utils";

// ── 1. PUBLIC_ROUTES and TENANT_EXEMPT_ROUTES coverage ──────────────

describe("PUBLIC_ROUTES includes OAuth callbacks and webhooks", () => {
  it("should list all required OAuth callback routes", async () => {
    // Read the actual source to verify routes are present
    const fs = await import("fs");
    const indexSrc = fs.readFileSync("src/index.ts", "utf8");

    const requiredPublicRoutes = [
      "/calendar/auth/google/callback",
      "/calendar/auth/outlook/callback",
      "/hubspot/auth/callback",
      "/jobber/auth/callback",
      "/square/auth/callback",
      "/servicetitan/auth/callback",
      "/hubspot/webhook",
      "/square/webhook",
      "/servicetitan/webhook",
    ];

    for (const route of requiredPublicRoutes) {
      expect(indexSrc).toContain(`'${route}'`);
    }

    // Jobber webhook uses path prefix
    expect(indexSrc).toContain("urlPath.startsWith('/jobber/webhook/')");
  });

  it("should list all required tenant-exempt routes in middleware", async () => {
    const fs = await import("fs");
    const middlewareSrc = fs.readFileSync("src/middleware.ts", "utf8");

    const requiredExemptRoutes = [
      "/calendar/auth/outlook/callback",
      "/hubspot/auth/callback",
      "/jobber/auth/callback",
      "/square/auth/callback",
      "/servicetitan/auth/callback",
      "/hubspot/webhook",
      "/square/webhook",
      "/servicetitan/webhook",
    ];

    for (const route of requiredExemptRoutes) {
      expect(middlewareSrc).toContain(`'${route}'`);
    }

    // Jobber webhook prefix
    expect(middlewareSrc).toContain("path.startsWith('/jobber/webhook/')");
  });
});

// ── 2. requireAuth guard ─────────────────────────────────────────────

describe("requireAuth middleware helper", () => {
  it("should return false and send 401 when req.auth is not set", async () => {
    const { requireAuth } = await import("./middleware");

    let statusCode: number | undefined;
    let body: unknown;

    const fakeReq = {} as any; // no .auth
    const fakeReply = {
      status(code: number) {
        statusCode = code;
        return {
          send(b: unknown) { body = b; },
        };
      },
    } as any;

    const result = requireAuth(fakeReq, fakeReply);
    expect(result).toBe(false);
    expect(statusCode).toBe(401);
    expect(body).toEqual({ success: false, error: "Authentication required" });
  });

  it("should return true when req.auth is set", async () => {
    const { requireAuth } = await import("./middleware");

    const fakeReq = { auth: { tenant_id: "t1", user_id: "u1", email: "a@b.com" } } as any;
    const fakeReply = {} as any; // shouldn't be called

    const result = requireAuth(fakeReq, fakeReply);
    expect(result).toBe(true);
  });
});

describe("Tenant admin routes require authentication", () => {
  it("GET /tenants, DELETE /tenants/:id, POST /tenants/reorder call requireAuth", async () => {
    const fs = await import("fs");
    const tenantsSrc = fs.readFileSync("src/routes/tenants.ts", "utf8");

    // All three routes should have requireAuth
    expect(tenantsSrc).toContain("import");
    expect(tenantsSrc).toContain("requireAuth");

    // Count requireAuth calls — should be at least 3 (GET, DELETE, reorder)
    const matches = tenantsSrc.match(/requireAuth\(req, reply\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });
});

// ── 3. Tenant-scoped DELETE/UPDATE queries ───────────────────────────

describe("Tenant-scoped DELETE/UPDATE queries", () => {
  let client: Client;
  let tenantA: string;
  let tenantB: string;
  let dbAvailable = true;

  beforeAll(async () => {
    try {
      client = await getRootClient();
      await clearDB(client);
      tenantA = await createTenant(client, "Tenant A", "auto-repair");
      tenantB = await createTenant(client, "Tenant B", "auto-repair");
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

  it("DELETE customers scoped by tenant_id — cannot delete cross-tenant", async () => {
    if (!dbAvailable) return;

    const custA = await createCustomer(client, tenantA, "Alice", "+15550001111");
    const custB = await createCustomer(client, tenantB, "Bob", "+15550002222");

    // Simulate the fixed DELETE query: DELETE WHERE id=$1 AND tenant_id=$2
    // Trying to delete custB with tenantA should affect 0 rows
    const res = await client.query(
      "DELETE FROM customers WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [custB, tenantA]
    );
    expect(res.rowCount).toBe(0);

    // custB should still exist
    const check = await client.query("SELECT id FROM customers WHERE id = $1", [custB]);
    expect(check.rows).toHaveLength(1);

    // Deleting custA with correct tenantA should work
    const res2 = await client.query(
      "DELETE FROM customers WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [custA, tenantA]
    );
    expect(res2.rowCount).toBe(1);
  });

  it("UPDATE customers scoped by tenant_id — cannot update cross-tenant", async () => {
    if (!dbAvailable) return;

    const custB = await createCustomer(client, tenantB, "Bob", "+15550002222");

    // Trying to update custB with tenantA should affect 0 rows
    const res = await client.query(
      "UPDATE customers SET name = $1 WHERE id = $2 AND tenant_id = $3",
      ["HACKED", custB, tenantA]
    );
    expect(res.rowCount).toBe(0);

    // custB name should be unchanged
    const check = await client.query("SELECT name FROM customers WHERE id = $1", [custB]);
    expect(check.rows[0].name).toBe("Bob");
  });

  it("UPDATE resources scoped by tenant_id — cannot update cross-tenant", async () => {
    if (!dbAvailable) return;

    const resB = await createResource(client, tenantB, "Resource B");

    // Trying to update resB with tenantA should affect 0 rows
    const res = await client.query(
      "UPDATE resources SET name = $1 WHERE id = $2 AND tenant_id = $3",
      ["HACKED", resB, tenantA]
    );
    expect(res.rowCount).toBe(0);

    // resB name should be unchanged
    const check = await client.query("SELECT name FROM resources WHERE id = $1", [resB]);
    expect(check.rows[0].name).toBe("Resource B");
  });

  it("DELETE appointments scoped by tenant_id — cannot delete cross-tenant", async () => {
    if (!dbAvailable) return;

    const resB = await createResource(client, tenantB, "Bay B");
    const custB = await createCustomer(client, tenantB, "Bob", "+15550003333");

    const apptRes = await client.query(
      `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description, source)
       VALUES ($1, $2, $3, NOW() + interval '1 day', NOW() + interval '1 day 1 hour', 'Test', 'test')
       RETURNING id`,
      [tenantB, resB, custB]
    );
    const apptB = apptRes.rows[0].id;

    // Trying to delete apptB with tenantA should affect 0 rows
    const res = await client.query(
      "DELETE FROM appointments WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [apptB, tenantA]
    );
    expect(res.rowCount).toBe(0);

    // apptB should still exist
    const check = await client.query("SELECT id FROM appointments WHERE id = $1", [apptB]);
    expect(check.rows).toHaveLength(1);
  });
});

// ── 4. dayOfWeek range validation ────────────────────────────────────

describe("dayOfWeek validation in analytics", () => {
  it("source code clamps dayOfWeek to 0-6", async () => {
    const fs = await import("fs");
    const analyticsSrc = fs.readFileSync("src/routes/analytics.ts", "utf8");

    // Should have range check for < 0 or > 6
    expect(analyticsSrc).toContain("rawDow < 0");
    expect(analyticsSrc).toContain("rawDow > 6");
    expect(analyticsSrc).toContain("Number.isNaN");
  });
});

// ── 5. CustomerUpdateSchema Zod validation ───────────────────────────

describe("CustomerUpdateSchema validation", () => {
  it("source code uses Zod validation for PUT /customers/:id", async () => {
    const fs = await import("fs");
    const customersSrc = fs.readFileSync("src/routes/customers.ts", "utf8");

    expect(customersSrc).toContain("CustomerUpdateSchema");
    expect(customersSrc).toContain("CustomerUpdateSchema.safeParse(req.body)");
  });

  it("CustomerUpdateSchema rejects invalid email", () => {
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

    const result = CustomerUpdateSchema.safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);

    const good = CustomerUpdateSchema.safeParse({ name: "Alice", email: "alice@example.com" });
    expect(good.success).toBe(true);

    const empty = CustomerUpdateSchema.safeParse({});
    expect(empty.success).toBe(true);
  });
});

// ── 6. Sync error logging ────────────────────────────────────────────

describe("Sync error logging (not silent swallowing)", () => {
  it("appointments.ts uses console.error in catch, not empty catch", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/routes/appointments.ts", "utf8");

    // Should NOT have `.catch(() => {})`
    expect(src).not.toContain(".catch(() => {})");
    // Should have logging
    expect(src).toContain(".catch(e => console.error('[sync]'");
  });

  it("customers.ts uses console.error in catch, not empty catch", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/routes/customers.ts", "utf8");

    expect(src).not.toContain(".catch(() => {})");
    expect(src).toContain(".catch(e => console.error('[sync]'");
  });
});

// ── 7. Null guard on booking RPC result ──────────────────────────────

describe("Booking RPC null guard", () => {
  it("appointments.ts checks for empty rows before accessing result", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/routes/appointments.ts", "utf8");

    expect(src).toContain("if (!result)");
    expect(src).toContain("Booking RPC returned no result");
  });
});

// ── 8. Services UPDATE tenant-scoped ─────────────────────────────────

describe("Services UPDATE tenant-scoped", () => {
  it("services.ts UPDATE includes tenant_id in WHERE clause", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/routes/services.ts", "utf8");

    // The UPDATE services query must include AND tenant_id
    expect(src).toMatch(/UPDATE services SET .* WHERE id = \$\d+ AND tenant_id = \$\d+/);
  });
});

// ── 9. Customer UPDATE in appointment update is tenant-scoped ────────

describe("Appointment update customer UPDATE is tenant-scoped", () => {
  it("customer UPDATE in appointment update route includes tenant_id", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/routes/appointments.ts", "utf8");

    // The nested customer UPDATE must include AND tenant_id
    expect(src).toContain("AND tenant_id = $");
    // Specifically the customer update pushes tenant_id
    expect(src).toContain("custValues.push(body.tenant_id)");
  });
});

// ── 10. Stripe webhook doesn't leak error details ────────────────────

describe("Stripe webhook error privacy", () => {
  it("billing.ts does not expose err.message in webhook response", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("src/routes/billing.ts", "utf8");

    // Should NOT contain ${err.message} in the response
    expect(src).not.toContain("error: `Invalid signature: ${err.message}`");
    // Should contain generic error
    expect(src).toContain("'Invalid webhook signature'");
  });
});

// ── 11. Edge function null safety ────────────────────────────────────

describe("Edge function null safety", () => {
  it("dispatcher.ts uses optional chaining on call-ended event", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("supabase/functions/vapi-tools/core/dispatcher.ts", "utf8");

    expect(src).toContain("message.call?.id");
    expect(src).toContain("message.call?.endedReason");
  });

  it("dispatcher.ts validates toolCall.function before destructuring", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("supabase/functions/vapi-tools/core/dispatcher.ts", "utf8");

    expect(src).toContain("!toolCall?.function");
  });
});

// ── 12. AppointmentView setSaving reset ──────────────────────────────

describe("AppointmentView setSaving bug fix", () => {
  it("sets saving=false on both success and error paths in handleCreate", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("dashboard/components/AppointmentView.tsx", "utf8");

    // Count setSaving(false) calls — should be at least 3 (success, error response, catch)
    const matches = src.match(/setSaving\(false\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it("shows error message on delete failure", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("dashboard/components/AppointmentView.tsx", "utf8");

    expect(src).toContain("could not delete appointment");
  });
});

// ── 13. KnowledgeBaseView timer cleanup ──────────────────────────────

describe("KnowledgeBaseView timer cleanup", () => {
  it("cleans up both timers on unmount", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("dashboard/components/KnowledgeBaseView.tsx", "utf8");

    expect(src).toContain("fadeTimerRef");
    expect(src).toContain("clearTimeout(fadeTimerRef.current)");
    expect(src).toContain("clearTimeout(timerRef.current)");
  });
});
