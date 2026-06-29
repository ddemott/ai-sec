// reembed-qa-docs.mjs — re-embed existing Q/A knowledge-base docs after the
// 2026-06-29 address-vocab fix (prepareQADocument now prepends the raw question
// to the embedded text so the interrogative form survives normalization).
//
// WHY a backfill: the doc-side fix only changes NEW ingests. Docs already in
// tenant_docs carry the old, question-stripped vector and stay starved for
// vocabulary-gap queries (e.g. "what's your address" → a "located" doc). This
// re-runs the SAME prepareQADocument over existing Q/A rows and rewrites
// normalized_text + embedding. Pure data backfill — no schema change.
//
// Reuses the COMPILED modules (dist/) so the embedding logic can't drift from
// production. Run `npm run build` first.
//
// Usage:
//   node scripts/reembed-qa-docs.mjs --dry-run                  # count only, no writes
//   node scripts/reembed-qa-docs.mjs --tenant <uuid>            # one tenant
//   node scripts/reembed-qa-docs.mjs --yes                      # all tenants, write
//   DATABASE_URL=... OPENAI_API_KEY=... node scripts/reembed-qa-docs.mjs --yes
//
// Only rows whose content is a "Q: …\nA: …" pair are touched; free-text file
// chunks (no question form) are left alone.

import pg from 'pg';
import { prepareQADocument } from '../dist/src/services/knowledgeIngestion.js';
import { getEmbedding } from '../dist/shared/getEmbedding.js';
import { createNormalizer } from '../dist/shared/normalizeForEmbedding.js';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONFIRMED = args.includes('--yes') || DRY_RUN;
const tenantIdx = args.indexOf('--tenant');
const TENANT = tenantIdx >= 0 ? args[tenantIdx + 1] : null;

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

if (!DATABASE_URL) {
  console.error('reembed: DATABASE_URL not set');
  process.exit(2);
}
if (!DRY_RUN && !OPENAI_API_KEY) {
  console.error('reembed: OPENAI_API_KEY required for a real re-embed (or pass --dry-run)');
  process.exit(2);
}
if (!CONFIRMED) {
  console.error('reembed: refusing to write without --yes (or use --dry-run to preview)');
  process.exit(2);
}

const normalize = createNormalizer(OPENAI_API_KEY);

// Split a stored "Q: <question>\nA: <answer>" combined doc back into its parts.
// Falls back to the title for the question when the content shape is unexpected.
function parseQA(content, title) {
  const m = /^Q:\s*([\s\S]*?)\nA:\s*([\s\S]*)$/.exec(content ?? '');
  if (m) return { question: m[1].trim(), answer: m[2].trim() };
  return { question: (title ?? '').trim(), answer: (content ?? '').trim() };
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const where = ["content LIKE 'Q: %'"];
  const params = [];
  if (TENANT) {
    params.push(TENANT);
    where.push(`tenant_id = $${params.length}`);
  }
  const sql = `SELECT tenant_doc_id, tenant_id, title, content
               FROM tenant_docs WHERE ${where.join(' AND ')}
               ORDER BY tenant_id, created_at`;
  const { rows } = await pool.query(sql, params);

  console.log(
    `reembed: ${rows.length} Q/A doc(s)${TENANT ? ` for tenant ${TENANT.slice(0, 8)}…` : ''}` +
      (DRY_RUN ? ' (DRY RUN — no writes)' : '')
  );

  let done = 0;
  let failed = 0;
  for (const r of rows) {
    const { question, answer } = parseQA(r.content, r.title);
    if (!question || !answer) {
      console.warn(`  skip ${r.tenant_doc_id} — could not parse Q/A`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  would re-embed ${r.tenant_doc_id}: "${question.slice(0, 60)}"`);
      done++;
      continue;
    }
    try {
      const { normalizedText, embedding } = await prepareQADocument(
        question,
        answer,
        getEmbedding,
        normalize
      );
      await pool.query(
        `UPDATE tenant_docs SET normalized_text = $1, embedding = $2::vector
         WHERE tenant_doc_id = $3`,
        [normalizedText, JSON.stringify(embedding), r.tenant_doc_id]
      );
      done++;
      if (done % 10 === 0) console.log(`  …${done}/${rows.length}`);
    } catch (e) {
      failed++;
      console.error(`  FAIL ${r.tenant_doc_id}: ${e?.message ?? e}`);
    }
  }

  await pool.end();
  console.log(`reembed: ${done} processed, ${failed} failed${DRY_RUN ? ' (dry run)' : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('reembed error:', e?.message ?? e);
  process.exit(1);
});
