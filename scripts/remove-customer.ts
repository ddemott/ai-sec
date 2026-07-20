/**
 * Remove ONE customer and every row that belongs to them.
 *
 * The single-customer counterpart of clear-call-data.ts: instead of wiping the
 * whole transactional layer, this removes exactly one person — their customer
 * row, appointments, reminders, call sessions/transcripts/summaries, messages,
 * job inquiries, preferences, consent + opt-out records, phone verifications,
 * communications history, and sync-map entries. The business itself and every
 * other customer are untouched.
 *
 * RELATION TO THE LEGAL-HOLD PURGE (PR #68): that PR is a PRODUCT feature —
 * `POST /customers/:id/purge`, a GDPR/CCPA erasure endpoint exposed through the
 * app — and it stays unmerged pending owner + legal sign-off. THIS is a manual
 * operator tool in the spirit of purge-soft-deleted.ts: destruction as a
 * deliberate, human, maintenance act, dry-run by default, refusing non-local
 * databases without --force. Running it against production for a real GDPR
 * request is a decision a human makes with the legal context in hand — the
 * tool just makes the blast radius visible first.
 *
 * USAGE
 *   npx tsx scripts/remove-customer.ts --tenant <uuid> --phone "+16305551234"   # dry run
 *   npx tsx scripts/remove-customer.ts --tenant <uuid> --email a@b.com          # dry run
 *   npx tsx scripts/remove-customer.ts --customer <uuid>                        # dry run
 *   ... --execute --yes                                                         # actually delete
 *   ... --db "postgres://…"                                                     # target a DB
 *
 * Lookup is by --customer (uuid, unambiguous), or by --tenant plus --phone or
 * --email. Phone matching normalizes to digits-only right-10 so "+1 (630)
 * 555-1234", "6305551234", and "16305551234" all find the same row.
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
const CUSTOMER = valueOf('--customer');
const TENANT = valueOf('--tenant');
const PHONE = valueOf('--phone');
const EMAIL = valueOf('--email');
const DB_URL =
  valueOf('--db') ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5433/postgres';

if (!CUSTOMER && !(TENANT && (PHONE || EMAIL))) {
  console.error(
    'usage: remove-customer.ts --customer <uuid> [flags]\n' +
      '       remove-customer.ts --tenant <uuid> --phone <number> [flags]\n' +
      '       remove-customer.ts --tenant <uuid> --email <email> [flags]\n' +
      'flags: --execute --yes --force --db "postgres://…"\n\n' +
      'Default is a DRY RUN that prints the blast radius and exits.'
  );
  process.exit(2);
}

/** Same local-host guard as clear-call-data.ts — unknown is not local. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
const LOCAL_HOSTS = ['localhost', '127.0.0.1', 'db', 'postgres', 'ai-sec-db', ''];

/**
 * Child tables keyed directly by customer_id (FK graph verified 2026-07-20),
 * plus the appointment-child tables reached through this customer's
 * appointments. Deletes run child-first inside one transaction with FK
 * triggers off, same as clear-call-data.ts.
 */
const BY_CUSTOMER = [
  'call_transcripts',
  'call_summaries',
  'communications_history',
  'consent_records',
  'customer_messages',
  'customer_preferences',
  'job_inquiries',
  'voice_sessions',
] as const;

const BY_APPOINTMENT = ['reminder_schedules', 'appointment_sync_map'] as const;

async function main() {
  const host = hostOf(DB_URL);
  if ((host === null || !LOCAL_HOSTS.includes(host)) && !FORCE) {
    console.error(
      host === null
        ? `\nRefusing: could not parse a hostname from the connection string, so it cannot be verified as local. Use a postgres:// URL, or pass --force if you are certain.\n`
        : `\nRefusing to remove a customer on non-local host "${host}".\n` +
            `Allowed: ${LOCAL_HOSTS.filter(Boolean).join(', ')} (or a socket URL with no host). Pass --force to override.\n`
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    // ── Resolve the customer ──
    let row:
      | {
          customer_id: string;
          tenant_id: string;
          name: string | null;
          phone: string | null;
          email: string | null;
        }
      | undefined;
    type CustomerRow = NonNullable<typeof row>;
    if (CUSTOMER) {
      const { rows } = await client.query<CustomerRow>(
        `SELECT customer_id, tenant_id, name, phone, email FROM customers WHERE customer_id = $1`,
        [CUSTOMER]
      );
      row = rows[0];
    } else if (PHONE) {
      // right-10-digits match — tolerant of +1 / formatting differences
      const digits = PHONE.replace(/\D/g, '').slice(-10);
      const { rows } = await client.query<CustomerRow>(
        `SELECT customer_id, tenant_id, name, phone, email FROM customers
          WHERE tenant_id = $1 AND RIGHT(REGEXP_REPLACE(COALESCE(phone,''), '\\D', '', 'g'), 10) = $2`,
        [TENANT, digits]
      );
      if (rows.length > 1) {
        console.error(`\nAmbiguous: ${rows.length} customers match phone …${digits}:`);
        for (const r of rows)
          console.error(`  ${r.customer_id}  ${r.name ?? '(no name)'}  ${r.phone}`);
        console.error('Re-run with --customer <uuid>.\n');
        process.exit(1);
      }
      row = rows[0];
    } else {
      const { rows } = await client.query<CustomerRow>(
        `SELECT customer_id, tenant_id, name, phone, email FROM customers
          WHERE tenant_id = $1 AND LOWER(email) = LOWER($2)`,
        [TENANT, EMAIL]
      );
      if (rows.length > 1) {
        console.error(
          `\nAmbiguous: ${rows.length} customers share email ${EMAIL}. Re-run with --customer <uuid>.\n`
        );
        process.exit(1);
      }
      row = rows[0];
    }

    if (!row) {
      console.error('\nNo matching customer found. Nothing to do.\n');
      process.exit(1);
    }

    const { rows: tenantRows } = await client.query<{ name: string }>(
      `SELECT name FROM tenants WHERE tenant_id = $1`,
      [row.tenant_id]
    );

    console.log(`\n══ CUSTOMER on ${host || '(local socket)'} ══`);
    console.log(
      `  customer : ${row.name ?? '(no name)'}  <${row.email ?? 'no email'}>  ${row.phone ?? 'no phone'}`
    );
    console.log(`  id       : ${row.customer_id}`);
    console.log(`  tenant   : ${tenantRows[0]?.name ?? '?'} (${row.tenant_id})`);

    // ── Blast radius ──
    const counts: { table: string; n: number }[] = [];
    for (const t of BY_CUSTOMER) {
      const { rows } = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM ${t} WHERE customer_id = $1`,
        [row.customer_id]
      );
      counts.push({ table: t, n: rows[0]?.n ?? 0 });
    }
    for (const t of BY_APPOINTMENT) {
      const { rows } = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM ${t}
          WHERE appointment_id IN (SELECT appointment_id FROM appointments WHERE customer_id = $1)`,
        [row.customer_id]
      );
      counts.push({ table: t, n: rows[0]?.n ?? 0 });
    }
    const { rows: apptCount } = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM appointments WHERE customer_id = $1`,
      [row.customer_id]
    );
    counts.push({ table: 'appointments', n: apptCount[0]?.n ?? 0 });
    counts.push({ table: 'customers', n: 1 });

    console.log('\n  rows to delete:');
    for (const c of counts) console.log(`  ${String(c.n).padStart(6)}  ${c.table}`);

    if (!EXECUTE) {
      console.log('\nDRY RUN — nothing was changed. Re-run with --execute --yes to delete.\n');
      return;
    }
    if (!SKIP_CONFIRM) {
      console.error(
        '\nRefusing to delete without --yes. This permanently removes the rows above.\n'
      );
      process.exit(1);
    }

    console.log('\n══ DELETING ══');
    await client.query('BEGIN');
    try {
      await client.query("SET session_replication_role = 'replica'");
      for (const t of BY_APPOINTMENT) {
        const res = await client.query(
          `DELETE FROM ${t}
            WHERE appointment_id IN (SELECT appointment_id FROM appointments WHERE customer_id = $1)`,
          [row.customer_id]
        );
        console.log(`  ✔ ${String(res.rowCount ?? 0).padStart(6)}  ${t}`);
      }
      for (const t of BY_CUSTOMER) {
        const res = await client.query(`DELETE FROM ${t} WHERE customer_id = $1`, [
          row.customer_id,
        ]);
        console.log(`  ✔ ${String(res.rowCount ?? 0).padStart(6)}  ${t}`);
      }
      const appts = await client.query(`DELETE FROM appointments WHERE customer_id = $1`, [
        row.customer_id,
      ]);
      console.log(`  ✔ ${String(appts.rowCount ?? 0).padStart(6)}  appointments`);
      const cust = await client.query(`DELETE FROM customers WHERE customer_id = $1`, [
        row.customer_id,
      ]);
      console.log(`  ✔ ${String(cust.rowCount ?? 0).padStart(6)}  customers`);
      await client.query("SET session_replication_role = 'origin'");
      await client.query('COMMIT');
      console.log('\nDone. Customer and all their data removed.\n');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`remove-customer: ${(err as Error).message}`);
  process.exit(1);
});
