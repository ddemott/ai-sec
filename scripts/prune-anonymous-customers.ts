/**
 * Prune phonebook entries that no call ever filled in.
 *
 * Every caller-ID call creates a customer up front (a deliberate 2026-07-27
 * fix: prod had 10 calls, 10 with caller ID, and ZERO linked customers). The
 * accepted cost was a row for every robocall and wrong number — and prod duly
 * grew a customer named literally "Caller", created by a recording that said
 * "Repeat this message." (CALL_IMPROVEMENTS.md #3).
 *
 * Live calls now prune themselves at hang-up (voice-session-end), but rows that
 * predate that fix are still sitting in the phonebook and the CSV export. This
 * cleans them up.
 *
 * A row is a candidate ONLY when every one of these holds:
 *   - the name is still a placeholder — nobody ever learned who they are
 *   - it has NO appointment, NO message, NO job inquiry
 *   - none of its calls produced any caller speech (or it has no calls at all)
 *
 * That last clause is what keeps a real person safe: someone who called, spoke,
 * and simply never gave a name is a lead, not litter.
 *
 * It also spares ROBOCALLS, which do speak — including the one that created the
 * "Caller" row in prod (CALL_IMPROVEMENTS.md #3, a recording that said "Repeat
 * this message."). That is the rule working as intended: deciding which speech
 * was worth having is a judgement, and a script that guesses will eventually
 * delete a real customer. --include-spoken lifts the clause for an operator who
 * has LOOKED at the list and knows what is in it.
 *
 * SOFT delete (the house pattern for customers/tenants): the row leaves the
 * phonebook, the audit trail stays. DRY RUN BY DEFAULT — it prints the blast
 * radius and changes nothing until you pass --yes.
 *
 *   npx tsx scripts/prune-anonymous-customers.ts                    # dry run
 *   npx tsx scripts/prune-anonymous-customers.ts --yes              # apply
 *   npx tsx scripts/prune-anonymous-customers.ts --tenant <uuid>    # scoped
 *   npx tsx scripts/prune-anonymous-customers.ts --include-spoken   # robocalls too
 */
import { Pool } from 'pg';

const APPLY = process.argv.includes('--yes');
/** Also consider rows whose calls DID contain caller speech (robocalls). */
const INCLUDE_SPOKEN = process.argv.includes('--include-spoken');
const tenantArgIndex = process.argv.indexOf('--tenant');
const TENANT = tenantArgIndex > -1 ? process.argv[tenantArgIndex + 1] : null;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

// Mirrors customerLookup.PLACEHOLDER_NAMES. Duplicated deliberately: a cleanup
// script that imports application code drags a config/env graph behind it.
const PLACEHOLDER_NAMES = ['Valued Customer', 'Caller', 'Unknown'];

/**
 * Candidate rows. The caller-speech test mirrors the backend's no_caller_audio
 * predicate and accepts BOTH transcript formats — bare "Caller: " and the
 * timestamped "Caller [1:23]: " (2026-07-30 onward). Getting that wrong here
 * would read every real call as silent and propose deleting live customers.
 */
const CANDIDATES = `
  SELECT c.customer_id, c.tenant_id, c.name, c.phone, c.created_at,
         (SELECT COUNT(*) FROM voice_sessions vs WHERE vs.customer_id = c.customer_id) AS calls
    FROM customers c
   WHERE (c.is_deleted IS NULL OR c.is_deleted = false)
     AND (c.name IS NULL OR c.name = '' OR c.name = ANY($1::text[]))
     AND ($2::uuid IS NULL OR c.tenant_id = $2::uuid)
     AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = c.customer_id)
     AND NOT EXISTS (SELECT 1 FROM customer_messages m WHERE m.customer_id = c.customer_id)
     AND NOT EXISTS (SELECT 1 FROM job_inquiries j WHERE j.customer_id = c.customer_id)
     AND ($3::boolean IS TRUE OR NOT EXISTS (
           SELECT 1 FROM voice_sessions vs
            WHERE vs.customer_id = c.customer_id
              AND vs.transcript ~ '(^|\\n)Caller( \\[[0-9]+:[0-9]{2}\\])?: '
         ))
   ORDER BY c.created_at ASC
`;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const { rows } = await pool.query<{
      customer_id: string;
      tenant_id: string;
      name: string | null;
      phone: string | null;
      created_at: Date;
      calls: string;
    }>(CANDIDATES, [PLACEHOLDER_NAMES, TENANT, INCLUDE_SPOKEN]);

    console.log(`\nAnonymous customers with nothing on them: ${rows.length}`);
    if (TENANT) console.log(`(scoped to tenant ${TENANT})`);
    console.log(
      INCLUDE_SPOKEN
        ? '(--include-spoken: rows whose calls DID contain speech are included — read the list before applying)'
        : '(rows whose calls contained caller speech are SPARED — pass --include-spoken to consider them too)'
    );
    for (const r of rows) {
      const last4 = r.phone ? r.phone.slice(-4) : '????';
      console.log(
        `  ${r.customer_id}  name=${JSON.stringify(r.name)}  phone=***${last4}  ` +
          `calls=${r.calls}  created=${r.created_at.toISOString().slice(0, 10)}`
      );
    }

    if (rows.length === 0) {
      console.log('\nNothing to prune.\n');
      return;
    }
    if (!APPLY) {
      console.log(`\nDRY RUN — nothing was changed. Re-run with --yes to soft-delete these.\n`);
      return;
    }

    const ids = rows.map((r) => r.customer_id);
    const res = await pool.query(
      `UPDATE customers
          SET is_deleted = true, deleted_at = now(), deleted_by = 'prune_anonymous_customers'
        WHERE customer_id = ANY($1::uuid[])
          AND (is_deleted IS NULL OR is_deleted = false)`,
      [ids]
    );
    console.log(`\nSoft-deleted ${res.rowCount ?? 0} customer(s). Rows remain for audit.\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('prune-anonymous-customers failed:', err);
  process.exit(1);
});
