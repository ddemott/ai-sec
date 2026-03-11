import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handler, repo } from "./index.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/test_db?sslmode=disable";

async function isDbAvailable(): Promise<boolean> {
  try {
    const client = new Client(DB_URL);
    await client.connect();
    await client.end();
    return true;
  } catch (_e) {
    console.warn("[integration_test] Skipping DB-dependent steps: Postgres not available at", DB_URL);
    return false;
  }
}

async function setup() {
    const client = new Client(DB_URL);
    await client.connect();
    const tRes = await client.queryObject<{id: string}>("INSERT INTO tenants (name, business_type) VALUES ('Int Test', 'test') RETURNING id");
    const tenantId = tRes.rows[0].id;
    const rRes = await client.queryObject<{id: string}>("INSERT INTO resources (tenant_id, name) VALUES ($1, 'Truck I') RETURNING id", [tenantId]);
    const resourceId = rRes.rows[0].id;
    await client.end();
    return { tenantId, resourceId };
}

Deno.test("Edge Adapter: Final Coverage Run", async (t) => {
  // This test currently exercises only non-DB sad paths, so it
  // does not require Postgres. DB-backed happy-path tests will
  // guard on isDbAvailable() when added.
  const { tenantId, resourceId } = { tenantId: "00000000-0000-0000-0000-000000000000", resourceId: "resource-unused" };

  await t.step("Sad Path: Malformed JSON arguments", async () => {
    const payload = {
      message: {
        type: "tool-calls",
        toolCalls: [{
          function: {
            name: "get_customer_context",
            arguments: "--- NOT JSON ---"
          }
        }]
      }
    };
    const req = new Request("https://localhost", { method: "POST", body: JSON.stringify(payload) });
    const res = await handler(req);
    const data = await res.json();
    assertEquals(res.status, 400);
    assertEquals(data.error, "Invalid JSON in arguments");
  });

  await t.step("Sad Path: Unknown Tool branch", async () => {
    const payload = {
      message: {
        type: "tool-calls",
        toolCalls: [{
          function: {
            name: "non_existent_tool",
            arguments: JSON.stringify({ tenant_id: tenantId })
          }
        }]
      }
    };
    const req = new Request("https://localhost", { method: "POST", body: JSON.stringify(payload) });
    const res = await handler(req);
    assertEquals(res.status, 400);
  });

  await t.step("Sad Path: Empty Tool Calls array", async () => {
    const payload = {
      message: {
        type: "tool-calls",
        toolCalls: []
      }
    };
    const req = new Request("https://localhost", { method: "POST", body: JSON.stringify(payload) });
    const res = await handler(req);
    assertEquals(res.status, 400);
  });

  await t.step("Happy Path: book_with_scheduling end-to-end (skips if DB down)", async () => {
    if (!(await isDbAvailable())) return;

    const { tenantId, resourceId } = await setup();

    const payload = {
      message: {
        type: "tool-calls",
        toolCalls: [{
          function: {
            name: "book_with_scheduling",
            arguments: JSON.stringify({
              tenant_id: tenantId,
              call_id: "call-int-1",
              phone: "+15551112222",
              name: "Integration Caller",
              description: "Integration haircut",
              location: "Main St",
              requirements: {
                serviceType: "haircut",
                // No capabilities/skills yet; current DB-backed selector
                // uses active resources with empty capabilities.
                requiredResourceCapabilities: [],
              },
              window: {
                from: "2026-10-01T10:00:00Z",
                to: "2026-10-01T11:00:00Z",
              },
            }),
          },
        }],
      },
    };

    const req = new Request("https://localhost", { method: "POST", body: JSON.stringify(payload) });
    const res = await handler(req);
    const data = await res.json();

    assertEquals(res.status, 200);
    assertEquals(data.result.success, true);
    assertEquals(typeof data.result.appointment_id, "string");
  });

  await repo.close();
});
