/**
 * Build a tenant's call script from BLOCKS and install it.
 *
 *   npx tsx scripts/install-script.ts --tenant <uuid> --intake intake_job_inquiry \
 *     --persona "You are Chris, the receptionist for Thinking Hammer..." [--dry-run]
 *
 * Or point it at a JSON file describing the whole composition. Naming convention:
 *   *.tenant.json    — pinned to ONE named business (carries its own `tenant`)
 *   *.template.json  — reusable across tenants (omits `tenant`; pass --tenant)
 *
 *   npx tsx scripts/install-script.ts --file scripts/scripts/thinking-hammer.tenant.json
 *
 * A *.template.json omits its tenant and is reused across businesses — pass the
 * target on the command line. This is how a new ordinary business is set up:
 *
 *   npx tsx scripts/install-script.ts --file scripts/scripts/regular-tenant.template.json \
 *     --tenant <uuid> [--persona-name "Robin"]
 *
 * WHY: the first script was hand-written straight into the database, and it worked. The
 * second one is where that approach starts to cost: "read the number back and WAIT for
 * them to confirm" is not one business's rule, it is every receptionist's, and its exact
 * wording took four bad calls to arrive at. Copy-paste it and the next business either
 * drifts (quietly reacquiring bugs we already fixed) or has to be kept in sync by hand,
 * which is the same thing with extra steps.
 *
 * So: the universal rungs come from src/services/scripts/blocks.ts, always, in the same
 * order. A business chooses its INTAKE — the questions in the middle — and nothing else.
 * Two estate agencies with slightly different questions are two intake blocks (or one
 * inline customIntake) and the same everything else.
 *
 * Prints the composed script and DIFFS it against what is currently installed, because
 * silently overwriting a tenant's live script is not something a tool should do quietly.
 */
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { composeScript, BLOCKS, type ScriptComposition } from '../src/services/scripts/blocks';

interface Args extends ScriptComposition {
  tenant: string;
  personaName?: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const file = get('--file');
  if (file) {
    const json = JSON.parse(readFileSync(file, 'utf8')) as Partial<Args>;
    // CLI --tenant / --persona-name OVERRIDE the file. This is what lets ONE
    // template file (e.g. regular-tenant.template.json, which omits `tenant`) be
    // installed onto any number of tenants: the reusable composition lives in the
    // file, the per-tenant target comes in on the command line. A file that DOES
    // pin a tenant (thinking-hammer.tenant.json) still works — the flag is absent.
    const tenant = get('--tenant') ?? json.tenant;
    const personaName = get('--persona-name') ?? json.personaName;
    if (!tenant || !json.persona) {
      throw new Error(
        `${file} must contain "persona", and a "tenant" — either in the file or via --tenant`
      );
    }
    return { ...json, tenant, personaName, dryRun: argv.includes('--dry-run') } as Args;
  }

  const tenant = get('--tenant');
  const persona = get('--persona');
  if (!tenant || !persona) {
    console.error(
      'usage: install-script.ts --tenant <uuid> --persona "<text>" [--intake <id>[,<id>]] [--persona-name <name>] [--dry-run]\n' +
        `       install-script.ts --file <composition.json> [--dry-run]\n\n` +
        `available intake blocks:\n` +
        Object.values(BLOCKS)
          .filter((b) => b.id.startsWith('intake_'))
          .map((b) => `  ${b.id.padEnd(24)} ${b.purpose}`)
          .join('\n')
    );
    process.exit(2);
  }

  return {
    tenant,
    persona,
    personaName: get('--persona-name'),
    intake: get('--intake')?.split(',').filter(Boolean),
    dryRun: argv.includes('--dry-run'),
  };
}

/** Local-host guard, same pattern as clear-call-data.ts (2026-07-20): this
 *  tool overwrites a tenant's LIVE script, so a remote DB must be deliberate.
 *  Unknown is not local — an unparseable DSN refuses too. Dry runs exempt. */
function hostOf(u: string): string | null {
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
}
const LOCAL_HOSTS = ['localhost', '127.0.0.1', 'db', 'postgres', 'ai-sec-db', ''];

async function main(): Promise<void> {
  const args = parseArgs();
  const script = composeScript(args);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const host = hostOf(url);
  if (
    !args.dryRun &&
    (host === null || !LOCAL_HOSTS.includes(host)) &&
    !process.argv.includes('--force')
  ) {
    throw new Error(
      `refusing to install on non-local host "${host ?? '(unparseable)'}" without --force (--dry-run is always allowed)`
    );
  }
  const pool = new Pool({ connectionString: url });

  try {
    const current = await pool.query<{ name: string; system_prompt: string | null }>(
      'SELECT name, system_prompt FROM tenants WHERE tenant_id = $1',
      [args.tenant]
    );
    if (!current.rows[0]) throw new Error(`No tenant ${args.tenant}`);

    const before = current.rows[0].system_prompt ?? '';
    console.log(`\ntenant   : ${current.rows[0].name} (${args.tenant})`);
    console.log(`intake   : ${args.intake?.join(', ') || (args.customIntake ? 'custom' : 'none')}`);
    console.log(`current  : ${before.length} chars`);
    console.log(`composed : ${script.length} chars`);

    if (before === script) {
      console.log('\nNo change — the installed script already matches. Nothing to do.');
      return;
    }

    if (args.dryRun) {
      console.log('\n--- composed script (dry run, NOTHING written) ---\n');
      console.log(script);
      return;
    }

    // The previous value is printed, not just discarded. A tenant's script is live
    // conversation — overwriting it without showing what was there is how you lose a
    // hand-tuned line nobody remembered was hand-tuned.
    if (before) {
      console.log('\n--- REPLACING this (save it if you need it) ---\n');
      console.log(before);
    }

    await pool.query(
      `UPDATE tenants
          SET system_prompt = $2,
              persona_name = COALESCE($3, persona_name)
        WHERE tenant_id = $1`,
      [args.tenant, script, args.personaName ?? null]
    );
    console.log('\n--- INSTALLED ---\n');
    console.log(script);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`install-script: ${(err as Error).message}`);
  process.exit(1);
});
