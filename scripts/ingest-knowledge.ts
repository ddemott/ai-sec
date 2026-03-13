import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import "https://deno.land/std@0.224.0/dotenv/load.ts";

/**
 * AI Secretary: Knowledge Ingestion CLI
 * 
 * Usage:
 * export OPENAI_API_KEY=your_key
 * export DATABASE_URL=your_db_url
 * deno run --allow-net --allow-read --allow-env scripts/ingest-knowledge.ts <tenant_id> <file_path>
 */

const tenantId = Deno.args[0];
const filePath = Deno.args[1];

if (!tenantId || !filePath) {
  console.error("Usage: deno run ... scripts/ingest-knowledge.ts <tenant_id> <file_path>");
  Deno.exit(1);
}

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const DATABASE_URL = Deno.env.get("DATABASE_URL");

if (!OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is not set.");
  Deno.exit(1);
}

const client = new Client(DATABASE_URL);

async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      input: text.replace(/\n/g, " "),
      model: "text-embedding-3-small",
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI Embedding Error: ${JSON.stringify(error)}`);
  }

  const result = await response.json();
  return result.data[0].embedding;
}

async function main() {
  console.log(`--- Starting Knowledge Ingestion ---`);
  console.log(`Tenant ID: ${tenantId}`);
  console.log(`File Path: ${filePath}`);

  try {
    const content = await Deno.readTextFile(filePath);
    
    // Simple chunking strategy: Split by double newlines (sections)
    const chunks = content.split("\n\n").filter(c => c.trim().length > 10);
    
    console.log(`Parsed ${chunks.length} chunks from document.`);
    
    await client.connect();
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i].trim();
      process.stdout.write(`Processing chunk ${i + 1}/${chunks.length}... `);
      
      const embedding = await getEmbedding(chunk);
      
      await client.queryArray(
        `INSERT INTO tenant_docs (tenant_id, content, source, embedding) 
         VALUES ($1, $2, $3, $4::vector)`,
        [tenantId, chunk, filePath.split('/').pop(), JSON.stringify(embedding)]
      );
      
      console.log("Success!");
    }

    console.log(`\n--- Ingestion Complete ---`);
    console.log(`Successfully ingested ${chunks.length} chunks for tenant ${tenantId}.`);
    
  } catch (err) {
    console.error("\nIngestion Failed:", err.message);
  } finally {
    await client.end();
  }
}

main();
