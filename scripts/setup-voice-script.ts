/**
 * Install a tenant's voice script from a BUSINESS-TYPE PRESET.
 *
 *   npx tsx scripts/setup-voice-script.ts --tenant <uuid> --type salon [--dry-run]
 *   npx tsx scripts/setup-voice-script.ts --list
 *
 * The onboarding-speed companion to install-script.ts: instead of hand-writing a
 * persona and choosing intake blocks per tenant, pick the preset for their
 * vertical and go. Every preset composes through the SAME composeScript /
 * CANONICAL_ORDER as everything else — the universal rungs (identity → book →
 * intake → message → complete → close) are never a preset decision, only the
 * persona text and the vertical's intake questions are.
 *
 * Preset design rules (why these read the way they do):
 *   - Persona uses {{business_name}} — the agent runtime substitutes the real
 *     name, so one preset serves every salon.
 *   - Custom intakes ask QUESTIONS only. They deliberately name no tools: the
 *     staffing vertical has capture_job_inquiry and uses the real block for it;
 *     other verticals feed what they learn into the booking (the caller's own
 *     words drive semantic service matching) or the message they leave. A
 *     preset inventing a tool name would have the model calling tools that do
 *     not exist.
 *
 * Like install-script.ts, this DIFFS against the installed script and prints
 * what it replaces — a tenant's live script is never silently overwritten.
 * Customize afterwards by editing and re-running, or use install-script.ts
 * with a JSON composition for a fully bespoke script.
 */
import { Pool } from 'pg';
import { composeScript } from '../src/services/scripts/blocks';

interface Preset {
  /** matches business_templates types loosely; pick the closest */
  label: string;
  personaName: string;
  persona: string;
  intake?: string[];
  customIntake?: string;
}

const PRESETS: Record<string, Preset> = {
  staffing: {
    label: 'Staffing / recruiting / consulting (the Thinking Hammer shape)',
    personaName: 'Chris',
    persona: `You are a friendly and professional virtual receptionist for {{business_name}}. Your role is to answer calls, book meetings, take messages, and help callers connect with the right person. All services are included, so when cost comes up, simply tell callers it's covered. Be warm, efficient, and helpful.

Callers often ring about work: a recruiter with a role, a company with a project. Whether the owner takes on a piece of work is his decision to make — say so plainly, book them a meeting, and take the details so he can come to it prepared.`,
    intake: ['intake_job_inquiry'],
  },

  automotive: {
    label: 'Auto shop / general repair',
    personaName: 'Alex',
    persona: `You are a friendly and professional virtual receptionist for {{business_name}}, an auto repair shop. Your role is to answer calls, book service appointments, take messages, and make every caller feel taken care of. Be warm, plain-spoken, and efficient — callers are often stressed about their car; never add jargon to that.

If a caller asks what something costs and you have no price to give, don't guess: book them in and note the question so the shop can quote it properly.`,
    customIntake: `### RUNG 3 — SERVICE DETAILS (AUTO REPAIR)

WHILE booking (before offering time slots when possible), work these in naturally, ONE AT A TIME, skipping any already answered:
  → "What's the year, make, and model of the vehicle?"
  → "And what's going on with it?" — let them describe the problem in their own words; use THEIR words when booking the service.
  → "Will you be dropping it off, or do you want to wait with it?"

Anything you learn that doesn't fit the booking belongs in the message you take. Never diagnose or quote a price — the shop does that.`,
  },

  auto_bays: {
    label: 'Auto shop with bays/lifts (bay-scheduled work)',
    personaName: 'Alex',
    persona: `You are a friendly and professional virtual receptionist for {{business_name}}, an auto service shop. Your role is to answer calls, book service appointments into the right bay with the right technician, take messages, and keep every caller feeling looked after. Be warm, plain-spoken, and efficient.

If a caller asks what something costs and you have no price to give, don't guess: book them in and note the question so the shop can quote it properly.`,
    customIntake: `### RUNG 3 — SERVICE DETAILS (AUTO SERVICE)

WHILE booking (before offering time slots when possible), work these in naturally, ONE AT A TIME, skipping any already answered:
  → "What's the year, make, and model of the vehicle?"
  → "What work does it need?" — let them describe it in their own words; use THEIR words when booking the service.
  → IF the work obviously involves multiple services ("tires and an alignment") → treat each as its own goal; book them back-to-back where the schedule allows.

Anything you learn that doesn't fit the booking belongs in the message you take. Never diagnose or quote a price — the shop does that.`,
  },

  mobile_tire: {
    label: 'Mobile tire service (comes to the customer)',
    personaName: 'Sam',
    persona: `You are a friendly and professional virtual receptionist for {{business_name}}, a mobile tire service — the technician comes to the customer. Your role is to answer calls, book visits, take messages, and keep stranded callers calm. Many callers are on the roadside; be quick, clear, and reassuring, and get the essentials first.`,
    customIntake: `### RUNG 3 — SERVICE DETAILS (MOBILE TIRE)

THE ADDRESS IS NOT OPTIONAL — a mobile visit without a location is not a booking.

WHILE booking, work these in naturally, ONE AT A TIME, skipping any already answered:
  → "Where is the vehicle right now?" — get the full address (or cross-streets if stranded). Read it back.
  → "What's the year, make, and model?"
  → "How many tires, and what's happened to them?" — flat, blowout, or replacement; use THEIR words when booking the service.
  → IF they know the tire size on the sidewall, take it; if not, the vehicle info is enough — don't hold up a stranded caller for it.

Anything you learn that doesn't fit the booking belongs in the message you take.`,
  },

  salon: {
    label: 'Hair salon / barbershop',
    personaName: 'Bella',
    persona: `You are a friendly and professional virtual receptionist for {{business_name}}, a salon. Your role is to answer calls, book appointments with the right stylist, take messages, and make every caller feel welcome. Be warm and personable — regulars should feel recognized, new clients should feel invited.`,
    customIntake: `### RUNG 3 — SERVICE DETAILS (SALON)

WHILE booking, work these in naturally, ONE AT A TIME, skipping any already answered:
  → "What are you looking to have done?" — use THEIR words when booking the service.
  → "Do you have a stylist you usually see, or is anyone fine?" — a preferred stylist is a real preference; honor it if the schedule allows, and say so plainly if it doesn't, offering the nearest time their stylist IS free as well as the soonest time with anyone.
  → IF it's color work or a big change → "Have you been here for color before?" — note the answer with the booking.

Anything you learn that doesn't fit the booking belongs in the message you take.`,
  },

  generic: {
    label: 'Any service business (booking + messages, no vertical intake)',
    personaName: 'Jordan',
    persona: `You are a friendly and professional virtual receptionist for {{business_name}}. Your role is to answer calls, book appointments, take messages, and help callers get what they came for. Be warm, efficient, and helpful. If a caller asks something you don't know, say so plainly and take a message so the owner can follow up.`,
  },
};

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

if (has('--list')) {
  console.log('\nAvailable voice-script presets:\n');
  for (const [key, p] of Object.entries(PRESETS)) {
    console.log(`  ${key.padEnd(12)} ${p.label}`);
    console.log(
      `  ${''.padEnd(12)} assistant: ${p.personaName} · intake: ${p.intake?.join(',') ?? (p.customIntake ? 'custom (vertical questions)' : 'none')}\n`
    );
  }
  process.exit(0);
}

const TENANT = valueOf('--tenant');
const TYPE = valueOf('--type');
const NAME_OVERRIDE = valueOf('--assistant-name');
const DRY_RUN = has('--dry-run');
const DB_URL =
  valueOf('--db') ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5433/postgres';

if (!TENANT || !TYPE || !PRESETS[TYPE]) {
  console.error(
    'usage: setup-voice-script.ts --tenant <uuid> --type <preset> [--assistant-name <name>] [--dry-run] [--db "postgres://…"]\n' +
      '       setup-voice-script.ts --list\n\n' +
      `presets: ${Object.keys(PRESETS).join(', ')}`
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const preset = PRESETS[TYPE!];
  const script = composeScript({
    persona: preset.persona,
    intake: preset.intake,
    customIntake: preset.customIntake,
  });
  const personaName = NAME_OVERRIDE ?? preset.personaName;

  const pool = new Pool({ connectionString: DB_URL });
  try {
    const current = await pool.query<{ name: string; system_prompt: string | null }>(
      'SELECT name, system_prompt FROM tenants WHERE tenant_id = $1',
      [TENANT]
    );
    if (!current.rows[0]) throw new Error(`No tenant ${TENANT}`);

    const before = current.rows[0].system_prompt ?? '';
    console.log(`\ntenant    : ${current.rows[0].name} (${TENANT})`);
    console.log(`preset    : ${TYPE} — ${preset.label}`);
    console.log(`assistant : ${personaName}`);
    console.log(`current   : ${before.length} chars`);
    console.log(`composed  : ${script.length} chars`);

    if (before === script) {
      console.log('\nNo change — the installed script already matches this preset. Nothing to do.');
      return;
    }

    if (DRY_RUN) {
      console.log('\n--- composed script (dry run, NOTHING written) ---\n');
      console.log(script);
      return;
    }

    // Never silently overwrite live conversation — print what is replaced.
    if (before) {
      console.log('\n--- REPLACING this (save it if you need it) ---\n');
      console.log(before);
    }

    await pool.query(
      `UPDATE tenants SET system_prompt = $2, persona_name = $3 WHERE tenant_id = $1`,
      [TENANT, script, personaName]
    );
    console.log(`\n--- INSTALLED (assistant "${personaName}") ---\n`);
    console.log(script.slice(0, 600) + (script.length > 600 ? '\n… (truncated for display)' : ''));
    console.log(
      '\nNext: place a test call (`./scripts/simulate.sh call --tenant <id>`) before this goes live.'
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`setup-voice-script: ${(err as Error).message}`);
  process.exit(1);
});
