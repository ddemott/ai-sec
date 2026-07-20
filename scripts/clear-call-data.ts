/**
 * Clear call data — wipe the transactional residue of test calls without
 * sifting through every related table by hand.
 *
 * A voice call fans out into a dozen tables: the session, the customer it
 * created, the appointment it booked, that appointment's reminders, any message
 * or job inquiry it captured, the consent it recorded, the AI-cost events it
 * billed. After a run of test calls those tables fill with obsolete rows that are
 * easy to mistake for a fresh call (two calls one minute apart look identical
 * until you decode the epoch in the room id). This script removes ALL of it in
 * one shot and leaves the business itself — tenant, users, services, employees,
 * resources, shifts, and the tenant's composed system_prompt — completely intact.
 *
 * It is the "tests own their data, DB ends bare-bones" principle as a command:
 * the transactional layer goes away, the business-shape layer stays.
 *
 * SAFETY
 *   - DEFAULT IS A DRY RUN. It reports what it WOULD delete and exits. Pass
 *     --execute to actually delete, and --yes to skip the confirmation.
 *   - Refuses any non-local host (localhost / 127.0.0.1 / db / postgres /
 *     ai-sec-db) unless you pass --force. This wipes test data — it must never
 *     be aimed at production by accident.
 *   - Runs inside a single transaction with FK triggers disabled
 *     (session_replication_role = replica), so it is all-or-nothing and needs no
 *     hand-ordered deletes. Requires a superuser connection (local dev is).
 *
 * USAGE
 *   npx tsx scripts/clear-call-data.ts                         # dry run (default)
 *   npx tsx scripts/clear-call-data.ts --execute --yes         # wipe all tenants
 *   npx tsx scripts/clear-call-data.ts --tenant <uuid> --execute --yes
 *   npx tsx scripts/clear-call-data.ts --db "postgres://…"     # target a DB
 *
 * PRESERVES (never touched): tenants, users, services, employees, resources,
 * skills, employee_schedule, service_employee, service_resource, templates,
 * calendar settings — everything that makes an empty business exist.
 *
 * SCOPE WIDENED 2026-07-20 (Dale: "clean the system as though just set up"):
 * now also clears audit_log, record_versions, password_resets, transcripts/
 * summaries, communications history + delivery statuses, entity_sync_map,
 * soft_reservations, and unanswered_questions — the paper trail of the data
 * being removed is itself residue. Knowledge (tenant_docs) is still kept.
 */
import { Client } from 'pg';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const EXECUTE = has('--execute');
const SKIP_CONFIRM = has('--yes');
const FORCE = has('--force');
const TENANT = valueOf('--tenant');
const DB_URL =
  valueOf('--db') ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5433/postgres';

/**
 * The call-data domain, child-to-parent. FK triggers are disabled during the
 * wipe so strict order is not required, but keeping it child-first means the
 * script still works if someone drops the replica-role line. Everything here is
 * created BY calls or by the flows a call drives; none of it is seed data.
 */
const TARGET_TABLES = [
  'reminder_schedules',
  'appointment_sync_map',
  'entity_sync_map',
  'message_delivery_status',
  'communications_history',
  'call_transcripts',
  'call_summaries',
  'voice_sessions',
  'customer_messages',
  'job_inquiries',
  'customer_preferences',
  'consent_records',
  'opt_out_records',
  'phone_verifications',
  'soft_reservations',
  'unanswered_questions',
  'ai_cost_events',
  // Audit trails + version history + stale auth tokens (added 2026-07-20):
  // "clean the system as though just set up" includes the paper trail of the
  // data being removed — an audit row describing a deleted appointment is
  // itself residue. These are FULL truncates even with --tenant, see below.
  'record_versions',
  'audit_log',
  'password_resets',
  'appointments',
  'customers',
];

/** Hostname of the DSN, or null when it cannot be parsed. Null must REFUSE, never pass:
 *  a key/value DSN like "host=prod-db dbname=..." fails URL parsing, and treating the
 *  parse failure as "local" would let it delete remote data without --force. Unknown is
 *  not local — unknown is unknown. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// '' is a SUCCESSFULLY PARSED URL with no host — a local-socket DSN like
// "postgres:///dbname" — and is safe to allow because an unparseable string is now
// null (refused), not ''. The two used to be conflated, which was the bypass.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', 'db', 'postgres', 'ai-sec-db', ''];

async function main() {
  const host = hostOf(DB_URL);
  if ((host === null || !LOCAL_HOSTS.includes(host)) && !FORCE) {
    console.error(
      host === null
        ? `\nRefusing: could not parse a hostname from the connection string, so it cannot be verified as local. Use a postgres:// URL, or pass --force if you are certain.\n`
        : `\nRefusing to clear call data on non-local host "${host}".\n` +
            `Allowed: ${LOCAL_HOSTS.filter(Boolean).join(', ')} (or a socket URL with no host). Pass --force to override.\n`
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    const scope = TENANT ? `for tenant ${TENANT}` : 'across ALL tenants';
    const where = TENANT ? 'WHERE tenant_id = $1' : '';
    const params = TENANT ? [TENANT] : [];

    console.log(`\n══ CALL DATA on ${host || '(local socket)'} — ${scope} ══`);

    // Blast radius: only count tables that actually exist in this schema.
    // A --tenant run additionally skips tables with no tenant_id column
    // (currently just password_resets, which is keyed by email) — a scoped
    // clear must not wipe other tenants' rows there.
    const present: { table: string; n: number }[] = [];
    for (const table of TARGET_TABLES) {
      const { rows: reg } = await client.query<{ exists: string | null }>(
        `SELECT to_regclass($1) AS exists`,
        [`public.${table}`]
      );
      if (!reg[0]?.exists) continue; // table not in this schema — skip silently
      if (TENANT) {
        const { rows: col } = await client.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'tenant_id'`,
          [table]
        );
        if (!col[0]?.n) {
          console.log(`  (skip)  ${table} — no tenant_id column, not clearable per-tenant`);
          continue;
        }
      }
      const { rows } = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM ${table} ${where}`,
        params
      );
      present.push({ table, n: rows[0]?.n ?? 0 });
    }

    const total = present.reduce((s, r) => s + r.n, 0);
    for (const r of present) {
      console.log(`  ${String(r.n).padStart(6)}  ${r.table}`);
    }
    console.log(`  ${'—'.repeat(6)}`);
    console.log(`  ${String(total).padStart(6)}  rows total`);

    if (total === 0) {
      console.log('\nNothing to clear — call-data tables are already empty.\n');
      return;
    }

    if (!EXECUTE) {
      console.log('\nDRY RUN — nothing was changed. Re-run with --execute --yes to clear.\n');
      return;
    }

    if (!SKIP_CONFIRM) {
      console.error(
        '\nRefusing to clear without --yes. This permanently deletes the rows above.\n' +
          'Business config (tenants, users, services, employees, shifts) is preserved.\n'
      );
      process.exit(1);
    }

    // One transaction, FK enforcement + audit triggers off, so the deletes need
    // no ordering and leave no audit noise. Reset the role even on failure.
    console.log('\n══ CLEARING ══');
    await client.query('BEGIN');
    try {
      await client.query("SET session_replication_role = 'replica'");
      for (const { table } of present) {
        const res = await client.query(`DELETE FROM ${table} ${where}`, params);
        console.log(`  ✔ ${String(res.rowCount ?? 0).padStart(6)}  ${table}`);
      }
      await client.query("SET session_replication_role = 'origin'");
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    console.log(`\nCleared ${total} row(s) ${scope}. Business config untouched.\n`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('clear-call-data failed:', err);
  process.exit(1);
});
