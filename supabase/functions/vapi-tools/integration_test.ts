import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handler } from "./index.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/postgres";

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
  const { tenantId, resourceId } = await setup();

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
});
