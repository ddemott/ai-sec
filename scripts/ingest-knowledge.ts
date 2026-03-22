import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import "https://deno.land/std@0.224.0/dotenv/load.ts";

/**
 * SecretaryHQ: Knowledge Ingestion CLI
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

/**
 * BUG-050: Sentence-aware chunking with overlap.
 * Splits on paragraph boundaries but merges small chunks and adds overlap.
 */
function chunkDocument(content: string, maxChunkSize = 1500, overlapSize = 200): string[] {
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (current.length + trimmed.length + 2 > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      // Overlap: keep the tail of the previous chunk as context
      const words = current.split(/\s+/);
      const overlapWords: string[] = [];
      let overlapLen = 0;
      for (let i = words.length - 1; i >= 0 && overlapLen < overlapSize; i--) {
        overlapWords.unshift(words[i]);
        overlapLen += words[i].length + 1;
      }
      current = overlapWords.join(' ') + '\n\n' + trimmed;
    } else {
      current = current ? current + '\n\n' + trimmed : trimmed;
    }
  }

  if (current.trim().length > 10) {
    chunks.push(current.trim());
  }

  return chunks;
}

async function main() {
  console.log(`--- Starting Knowledge Ingestion ---`);
  console.log(`Tenant ID: ${tenantId}`);
  console.log(`File Path: ${filePath}`);

  try {
    const content = await Deno.readTextFile(filePath);
    const source = filePath.split('/').pop() || filePath;

    // BUG-050: Use sentence-aware chunking with overlap
    const chunks = chunkDocument(content);

    console.log(`Parsed ${chunks.length} chunks from document.`);

    await client.connect();

    // BUG-051: Delete existing chunks for same source to prevent duplicates
    const existing = await client.queryArray(
      `SELECT count(*) FROM tenant_docs WHERE tenant_id = $1 AND source = $2`,
      [tenantId, source]
    );
    const existingCount = parseInt(String(existing.rows[0]?.[0] || '0'));
    if (existingCount > 0) {
      console.log(`Found ${existingCount} existing chunks for source "${source}" — replacing...`);
      await client.queryArray(
        `DELETE FROM tenant_docs WHERE tenant_id = $1 AND source = $2`,
        [tenantId, source]
      );
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const encoder = new TextEncoder();
      await Deno.stdout.write(encoder.encode(`Processing chunk ${i + 1}/${chunks.length}... `));

      const embedding = await getEmbedding(chunk);

      await client.queryArray(
        `INSERT INTO tenant_docs (tenant_id, content, source, embedding)
         VALUES ($1, $2, $3, $4::vector)`,
        [tenantId, chunk, source, JSON.stringify(embedding)]
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
