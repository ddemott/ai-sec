// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { PostgresRepository } from "./db/repository.ts";
import { AISecretaryService } from "./core/service.ts";
import { Dispatcher } from "./core/dispatcher.ts";
import { baseLogger } from "./core/logger.ts";

const DB_URL = Deno.env.get("DATABASE_URL") || "postgres://postgres:postgres@localhost:5433/test_db?sslmode=disable";

async function clearDB() {
  const client = new Client(DB_URL);
  await client.connect();
  await client.queryArray("TRUNCATE tenants, resources, customers, appointments, call_summaries, tenant_docs CASCADE;");
  await client.end();
}

async function isDbAvailable(): Promise<boolean> {
  try {
    const client = new Client(DB_URL);
    await client.connect();
    await client.end();
    return true;
  } catch (_e) {
    console.warn("[knowledge_base_test] Skipping tests: Postgres not available at", DB_URL);
    return false;
  }
}

// Mock embedding generator
const mockGetEmbedding = async (text: string) => {
  // Return a dummy vector of 1536 dimensions
  const vector = new Array(1536).fill(0);
  if (text.includes("policy")) vector[0] = 1.0;
  if (text.includes("hours")) vector[10] = 1.0;
  if (text.includes("unrelated")) vector[500] = 1.0;
  return vector;
};

Deno.test({
  name: "Knowledge Base RAG Suite",
  sanitizeOps: false,
  async fn(t) {
    if (!(await isDbAvailable())) return;
    await clearDB();

    const repo = new PostgresRepository();
    const service = new AISecretaryService(repo);
    const dispatcher = new Dispatcher(service, mockGetEmbedding);

    const client = new Client(DB_URL);
    await client.connect();
    const tRes = await client.queryObject<{ id: string }>(
      "INSERT INTO tenants (name, business_type) VALUES ('RAG Test', 'test') RETURNING id",
    );
    const tenantId = tRes.rows[0].id;

    // Seed some knowledge docs
    const policyVector = await mockGetEmbedding("policy");
    const hoursVector = await mockGetEmbedding("hours");

    await client.queryArray(
      "INSERT INTO tenant_docs (tenant_id, content, embedding) VALUES ($1, $2, $3::vector)",
      [tenantId, "Our policy is: No refunds after 30 days.", JSON.stringify(policyVector)]
    );
    await client.queryArray(
      "INSERT INTO tenant_docs (tenant_id, content, embedding) VALUES ($1, $2, $3::vector)",
      [tenantId, "We are open 9am to 5pm.", JSON.stringify(hoursVector)]
    );
    await client.end();

    await t.step("Repository: searchKnowledgeBase finds relevant content", async () => {
      const results = await repo.searchKnowledgeBase(tenantId, policyVector, baseLogger);
      assertEquals(results.length > 0, true);
      assertEquals(results[0].content.includes("No refunds"), true);
      assertEquals(results[0].similarity > 0.9, true);
    });

    await t.step("Service: getCompanyPolicyAnswer returns combined context", async () => {
      const res = await service.getCompanyPolicyAnswer(tenantId, "What is the policy?", baseLogger, mockGetEmbedding);
      assertEquals(res.result.includes("No refunds after 30 days"), true);
    });

    await t.step("Service: getCompanyPolicyAnswer returns fallback for no matches", async () => {
      // Use a vector that is far away from the seeded ones
      const unrelatedVector = new Array(1536).fill(0);
      unrelatedVector[1000] = 1.0;
      
      const res = await service.getCompanyPolicyAnswer(tenantId, "unrelated query", baseLogger, async () => unrelatedVector);
      assertEquals(res.result.includes("I'm sorry, I don't have information on that specific topic"), true);
    });

    await t.step("Dispatcher: handles get_company_policy_answer tool call", async () => {
      const message = {
        type: "tool-calls",
        toolCalls: [{
          function: {
            name: "get_company_policy_answer",
            arguments: JSON.stringify({
              tenant_id: tenantId,
              question: "What are your hours?"
            })
          }
        }]
      };

      const response = await dispatcher.dispatch(message, baseLogger);
      const data = await response.json();
      
      assertEquals(response.status, 200);
      assertEquals(data.result.includes("9am to 5pm"), true);
    });

    await repo.close();
  },
});
