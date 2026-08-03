/**
 * Onboard a new client in one command: tenant + secured owner login (+ voice
 * script preset), then a printed checklist of everything that still needs a
 * human decision.
 *
 *   npx tsx scripts/onboard-tenant.ts \
 *     --name "Bella's Hair Studio" --type salon \
 *     --owner-email bella@bellashair.com --owner-name "Bella Ramos" \
 *     [--owner-phone "+16305551234"] [--voice-preset salon] [--assistant-name Bella]
 *
 * WHAT IT DOES
 *   1. Creates the tenant + owner user through the SAME transactional helper
 *      the product's /register endpoint uses (createTenantWithOwner) — one
 *      code path for "a business comes into existence", no drift.
 *   2. SECURITY: generates a strong random temporary password (never reused,
 *      never stored anywhere but bcrypt-hashed in the DB), prints it ONCE, and
 *      tells you to have the owner change it on first login. Role is 'owner';
 *      staff get their own logins via Setup → Team Access (invites), never a
 *      shared password. Tenant isolation is enforced by tenantMiddleware
 *      automatically — nothing to configure per client.
 *   3. Optionally installs the vertical's voice-script preset (shells out to
 *      setup-voice-script.ts so there is exactly one preset source).
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - Seed services/staff/shifts: the dashboard Setup Wizard is the onboarding
 *     UX for business shape — it asks the vertical's questions, auto-seeds
 *     from the business template, and expands the weekly schedule. A script
 *     duplicating it would drift. Get the owner to a login, then run the
 *     wizard with them.
 *   - Provision a phone number: that costs money and belongs to go-live
 *     (POST /provisioning/activate), after a test call.
 *
 * USAGE NOTES
 *   --type is the tenant's business_type (drives the wizard's template pick).
 *   Run with --db for a non-default database; refuses non-local without --force.
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { createTenantWithOwner } from '../src/services/tenants/bootstrap';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const NAME = valueOf('--name');
const TYPE = valueOf('--type');
const OWNER_EMAIL = valueOf('--owner-email');
const OWNER_NAME = valueOf('--owner-name');
const OWNER_PHONE = valueOf('--owner-phone');
const VOICE_PRESET = valueOf('--voice-preset');
const ASSISTANT_NAME = valueOf('--assistant-name');
const FORCE = has('--force');
const DB_URL =
  valueOf('--db') ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5433/postgres';

if (!NAME || !TYPE || !OWNER_EMAIL || !OWNER_NAME) {
  console.error(
    'usage: onboard-tenant.ts --name "<business>" --type <business_type> --owner-email <email> --owner-name "<full name>"\n' +
      '       [--owner-phone <e164>] [--voice-preset <staffing|automotive|auto_bays|mobile_tire|salon|generic>]\n' +
      '       [--assistant-name <name>] [--db "postgres://…"] [--force]'
  );
  process.exit(2);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
const LOCAL_HOSTS = ['localhost', '127.0.0.1', 'db', 'postgres', 'secretary-hq-db', ''];

/**
 * ~96 bits of randomness, base64url so it types cleanly over the phone-ish
 * alphabet. This is a TEMPORARY credential: strong enough that it never
 * matters if the owner delays changing it, disposable enough that printing it
 * once to the operator's terminal is its entire lifecycle.
 */
function generateTempPassword(): string {
  return randomBytes(12).toString('base64url');
}

async function main(): Promise<void> {
  const host = hostOf(DB_URL);
  if ((host === null || !LOCAL_HOSTS.includes(host)) && !FORCE) {
    console.error(
      `\nRefusing to onboard against non-local host "${host ?? '(unparseable)'}" without --force.\n` +
        `(Onboarding against production is legitimate — the guard just makes it deliberate.)\n`
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DB_URL });
  try {
    const tempPassword = generateTempPassword();
    const [first, ...rest] = OWNER_NAME!.trim().split(/\s+/);

    const result = await createTenantWithOwner(pool, {
      tenantName: NAME!,
      businessType: TYPE!,
      ownerEmail: OWNER_EMAIL!.toLowerCase(),
      ownerPassword: tempPassword,
      ownerFullName: OWNER_NAME!,
      ownerFirstName: first || null,
      ownerLastName: rest.join(' ') || null,
      duplicateCheck: 'tenant_name',
    });

    if (!result.ok) {
      console.error(`\nonboard-tenant: ${result.conflictMessage}\n`);
      process.exit(1);
    }

    if (OWNER_PHONE) {
      await pool.query(`UPDATE tenants SET owner_phone = $2 WHERE tenant_id = $1`, [
        result.tenantId,
        OWNER_PHONE,
      ]);
    }

    console.log('\n══ TENANT CREATED ══');
    console.log(`  business : ${NAME} (${TYPE})`);
    console.log(`  tenant_id: ${result.tenantId}`);
    console.log(`  owner    : ${OWNER_NAME} <${OWNER_EMAIL!.toLowerCase()}> (role: owner)`);

    console.log('\n══ SECURITY — read this part ══');
    console.log(`  TEMPORARY PASSWORD (shown once, exists nowhere else):`);
    console.log(`\n      ${tempPassword}\n`);
    console.log('  1. Give it to the owner over a channel you trust — not email.');
    console.log('  2. Have them log in and change it immediately (My Profile → password,');
    console.log('     or the Forgot-password flow). Sessions expire after 8h; a password');
    console.log('     change invalidates older tokens.');
    console.log('  3. Front-desk staff get THEIR OWN logins: Setup → Team Access → Invite');
    console.log('     (role front_desk sees only Home/Schedule/Customers/Calls).');
    console.log('     Never share the owner login with staff.');
    console.log('  4. Tenant isolation is automatic (middleware) — no per-client setup.');

    if (VOICE_PRESET) {
      console.log(`\n══ VOICE SCRIPT (preset: ${VOICE_PRESET}) ══`);
      const presetArgs = [
        'tsx',
        'scripts/setup-voice-script.ts',
        '--tenant',
        result.tenantId,
        '--type',
        VOICE_PRESET,
        '--db',
        DB_URL,
      ];
      if (ASSISTANT_NAME) presetArgs.push('--assistant-name', ASSISTANT_NAME);
      execFileSync('npx', presetArgs, { stdio: 'inherit' });
    }

    console.log('\n══ NEXT STEPS (human decisions, in order) ══');
    console.log('  1. Log in as the owner and run the Setup Wizard — services, staff,');
    console.log('     working days, who-can-do-what. (The wizard seeds from the');
    console.log(`     "${TYPE}" template and expands the weekly schedule.)`);
    if (!VOICE_PRESET) {
      console.log('  2. Install the voice script:');
      console.log(
        `       npx tsx scripts/setup-voice-script.ts --tenant ${result.tenantId} --type <preset>`
      );
    }
    console.log('  •  Teach the AI: Phone Assistant → Knowledge Base (scan site / upload FAQ).');
    console.log('  •  Pick the voice + persona on Phone Assistant → AI Persona; then');
    console.log('     `cd agent && npm run verify:tts` before any TTS change ships.');
    console.log('  •  Test the brain without a phone: ./scripts/simulate.sh tools / call.');
    console.log('  •  Go-live: provision their number (POST /provisioning/activate) and');
    console.log('     make a real PSTN test call before handing over.');
    console.log('  •  Billing: attach Stripe from the Billing sub-tab when they subscribe.\n');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`onboard-tenant: ${(err as Error).message}`);
  process.exit(1);
});
