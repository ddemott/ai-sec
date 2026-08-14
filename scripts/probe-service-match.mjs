/**
 * Probe the LIVE semantic service match: what does the booking path actually
 * choose for a given phrase, and by how much?
 *
 * Usage:
 *   node scripts/probe-service-match.mjs "a position" "a meeting about a position"
 *
 * WHY THIS EXISTS (2026-08-13, CALL2.md): the postmortem's proposed fix was to
 * add an "Owner Consultation" service, on the assumption that no catalog row
 * covered a hiring conversation. Measuring first showed the assumption was
 * wrong twice over — "Programming Consultation" (30m) already existed with the
 * description "A meeting to discuss a programming position or software project
 * with Dale", it WAS the top match, and it lost on CONFIDENCE:
 *
 *     "a position"                                 0.2521  below 0.35 → default
 *     "a meeting about a position"                 0.5142  PASS
 *     "a programming position in downtown Seattle" 0.4334  PASS
 *     "a position in the Sahara Desert"            0.1438  below (and WRONG row)
 *
 * The obvious follow-up — have the host prefix "a meeting about …" — was also
 * measured, and must NOT be shipped. It lifts every score by roughly a constant,
 * so it defeats the threshold rather than improving discrimination:
 *
 *     "four-wheel alignment"                 0.1739 → "a meeting about …" 0.3571 PASS
 *     "just to talk"                         0.3061 → "a meeting about …" 0.3956 PASS
 *
 * Both of those now clear 0.35 onto Programming Consultation, which is the wrong
 * service. That trades a safe, documented fallback for a confident wrong
 * booking — exactly what migration 20260714150000 exists to prevent.
 *
 * Standing rule this serves: MEASURE before fixing (docs/LESSONS_LEARNED.md).
 * Reads prod read-only. Needs OPENAI_API_KEY in .env.
 */
import { readFileSync } from 'fs';
import pg from 'pg';

const INTENT_MATCH_THRESHOLD = 0.35; // must match src/services/serviceResolver.ts
const TENANT = process.env.PROBE_TENANT ?? 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0';

const pgUrl = process.env.DATABASE_URL;
if (!pgUrl) {
  console.error('Set DATABASE_URL to the database you want to probe.');
  process.exit(1);
}

function openaiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const match = readFileSync('.env', 'utf8').match(/^OPENAI_API_KEY=(.+)$/m);
  if (!match) throw new Error('No OPENAI_API_KEY in env or .env');
  return match[1].trim();
}

const queries = process.argv.slice(2);
if (queries.length === 0) {
  console.error('Usage: node scripts/probe-service-match.mjs "<phrase>" ["<phrase>" …]');
  process.exit(1);
}

const key = openaiKey();
const pool = new pg.Pool({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } });

for (const query of queries) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: query }),
  });
  const body = await res.json();
  if (!body.data) {
    console.log(`\nQUERY: "${query}"  — EMBEDDING FAILED: ${JSON.stringify(body).slice(0, 200)}`);
    continue;
  }
  const vec = JSON.stringify(body.data[0].embedding);
  const matches = await pool.query(
    'SELECT name, duration_minutes, similarity FROM match_service_by_intent($1, $2::vector)',
    [TENANT, vec]
  );
  console.log(`\nQUERY: "${query}"  (threshold ${INTENT_MATCH_THRESHOLD})`);
  if (matches.rows.length === 0) {
    console.log('   (no candidates — falls through to the tenant default service)');
  }
  for (const row of matches.rows) {
    const verdict = row.similarity >= INTENT_MATCH_THRESHOLD ? 'PASS ' : 'below';
    console.log(
      `   ${row.similarity.toFixed(4)} ${verdict} ${row.name} (${row.duration_minutes}m)`
    );
  }
}

await pool.end();
