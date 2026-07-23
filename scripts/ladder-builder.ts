/**
 * LADDER BUILDER — the one tool for working with call-script rungs.
 *
 * The rungs themselves live in exactly one place: src/services/scripts/blocks.ts.
 * This tool never copies them — it reads that catalog, so every script it builds
 * inherits the current revision of every rung automatically.
 *
 *   npx tsx scripts/ladder-builder.ts --list                 # catalog: every rung + purpose
 *   npx tsx scripts/ladder-builder.ts --show identity        # one rung's full text
 *   npx tsx scripts/ladder-builder.ts --docs                 # regenerate docs/CALL_LADDER.md
 *
 *   npx tsx scripts/ladder-builder.ts --build --tenant <id> --recipe scripts/scripts/thinking-hammer.tenant.json [--dry-run]
 *   npx tsx scripts/ladder-builder.ts --build --tenant <id> --persona "You are …" [--intake intake_job_inquiry] [--assistant-name Chris] [--dry-run]
 *
 * BUILD behavior:
 *   - Composes through the SAME composeScript/CANONICAL_ORDER as everything
 *     else — the universal rung order is not a builder option, by design.
 *   - ALWAYS BACKS UP the currently installed script first, to
 *     scripts/script-backups/<tenant>_<timestamp>.txt, before writing anything.
 *     (A tenant's live script is hand-tended conversation; it is never lost.)
 *   - Prints old/new sizes and a rung-heading diff so you can see the shape
 *     change at a glance; --dry-run composes + prints and writes NOTHING.
 *
 * Relationship to the other tools: setup-voice-script.ts is the preset shortcut
 * (pick a vertical, go); install-script.ts is the original recipe installer.
 * This builder adds the catalog views, the docs generator, and the automatic
 * backup. All three compose from the same blocks — none of them owns any rung.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  BLOCKS,
  CANONICAL_ORDER,
  composeScript,
  type ScriptComposition,
} from '../src/services/scripts/blocks';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const universalIds = new Set<string>(CANONICAL_ORDER as readonly string[]);
const intakeBlocks = Object.values(BLOCKS).filter((b) => !universalIds.has(b.id));

/** First markdown heading of a rung's text, e.g. "### RUNG 2 — …" — the shape line. */
function headingOf(text: string): string {
  const m = text.match(/^#+ .*$/m);
  return m ? m[0].replace(/^#+ /, '') : '(no heading)';
}

// ── --list ──────────────────────────────────────────────────────────────────
if (has('--list')) {
  console.log('\nUNIVERSAL RUNGS (always present, always this order — not a choice):\n');
  for (const id of CANONICAL_ORDER) {
    const b = BLOCKS[id];
    console.log(`  ${b.id.padEnd(20)} ${headingOf(b.text)}`);
    console.log(`  ${''.padEnd(20)} ${b.purpose}\n`);
  }
  console.log(
    'INTAKE BLOCKS (the RUNG-3 seam — a business picks these, or supplies customIntake):\n'
  );
  for (const b of intakeBlocks) {
    console.log(`  ${b.id.padEnd(20)} ${headingOf(b.text)}`);
    console.log(`  ${''.padEnd(20)} ${b.purpose}\n`);
  }
  process.exit(0);
}

// ── --show <id> ─────────────────────────────────────────────────────────────
const showId = valueOf('--show');
if (showId) {
  const b = BLOCKS[showId];
  if (!b) {
    console.error(`No block "${showId}". Try --list.`);
    process.exit(2);
  }
  console.log(`\n[${b.id}] ${b.purpose}\n\n${b.text}\n`);
  process.exit(0);
}

// ── --docs ──────────────────────────────────────────────────────────────────
if (has('--docs')) {
  const lines: string[] = [
    '# The Call Ladder — rung catalog',
    '',
    '> **GENERATED FILE — do not edit.** Source of truth: `src/services/scripts/blocks.ts`.',
    '> Regenerate with `npx tsx scripts/ladder-builder.ts --docs`.',
    '> Editing a rung happens in blocks.ts, once — every script composed afterward inherits it.',
    '',
    'Every tenant script = **persona** (theirs) + these universal rungs in this exact order,',
    'with the intake seam filled by an intake block and/or inline custom questions.',
    '',
    '## Universal rungs (fixed order — not configurable)',
    '',
  ];
  for (const id of CANONICAL_ORDER) {
    const b = BLOCKS[id];
    lines.push(`### \`${b.id}\``, '', `*${b.purpose}*`, '', '```', b.text, '```', '');
  }
  lines.push('## Intake blocks (the seam — one per vertical)', '');
  for (const b of intakeBlocks) {
    lines.push(`### \`${b.id}\``, '', `*${b.purpose}*`, '', '```', b.text, '```', '');
  }
  lines.push(
    '## Building a script',
    '',
    '```bash',
    'npx tsx scripts/ladder-builder.ts --list',
    'npx tsx scripts/ladder-builder.ts --build --tenant <id> --recipe scripts/scripts/<biz>.json --dry-run',
    'npx tsx scripts/setup-voice-script.ts --tenant <id> --type <preset>   # vertical presets',
    '```',
    ''
  );
  const out = join('docs', 'CALL_LADDER.md');
  writeFileSync(out, lines.join('\n'));
  console.log(
    `Wrote ${out} (${lines.join('\n').length} chars) from blocks.ts — regenerate any time.`
  );
  process.exit(0);
}

// ── --build ─────────────────────────────────────────────────────────────────
if (!has('--build')) {
  console.error(
    'usage:\n' +
      '  ladder-builder.ts --list | --show <rung-id> | --docs\n' +
      '  ladder-builder.ts --build --tenant <uuid> --recipe <composition.json> [--dry-run] [--db url]\n' +
      '  ladder-builder.ts --build --tenant <uuid> --persona "<text>" [--intake id[,id]] [--custom-intake "<text>"] [--assistant-name <name>] [--dry-run] [--db url]'
  );
  process.exit(2);
}

const TENANT = valueOf('--tenant');
const RECIPE = valueOf('--recipe');
const DRY_RUN = has('--dry-run');
const DB_URL =
  valueOf('--db') ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5433/postgres';

interface Recipe extends ScriptComposition {
  tenant?: string;
  personaName?: string;
}

let recipe: Recipe;
if (RECIPE) {
  recipe = JSON.parse(readFileSync(RECIPE, 'utf8')) as Recipe;
} else {
  const persona = valueOf('--persona');
  if (!persona) {
    console.error('--build needs --recipe <file> or --persona "<text>".');
    process.exit(2);
  }
  recipe = {
    persona,
    intake: valueOf('--intake')?.split(',').filter(Boolean),
    customIntake: valueOf('--custom-intake'),
    personaName: valueOf('--assistant-name'),
  };
}

const tenantId = TENANT ?? recipe.tenant;
if (!tenantId) {
  console.error('--build needs a tenant: pass --tenant <uuid> (or put "tenant" in the recipe).');
  process.exit(2);
}

/** Same local-host guard as clear-call-data.ts (Copilot review, PR #291):
 *  --build overwrites a tenant's LIVE script in whatever DB it is pointed at,
 *  so a remote target must be deliberate. Unknown is not local. Dry runs are
 *  exempt — composing + diffing writes nothing. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
const LOCAL_HOSTS = ['localhost', '127.0.0.1', 'db', 'postgres', 'ai-sec-db', ''];

async function build(): Promise<void> {
  const host = hostOf(DB_URL);
  if (!DRY_RUN && (host === null || !LOCAL_HOSTS.includes(host)) && !has('--force')) {
    console.error(
      `\nRefusing to install a script on non-local host "${host ?? '(unparseable)'}" without --force.\n` +
        `(--dry-run is always allowed; installing to production is legitimate — the guard just makes it deliberate.)\n`
    );
    process.exit(1);
  }
  const script = composeScript(recipe);
  const pool = new Pool({ connectionString: DB_URL });
  try {
    const { rows } = await pool.query<{
      name: string;
      system_prompt: string | null;
      persona_name: string | null;
    }>('SELECT name, system_prompt, persona_name FROM tenants WHERE tenant_id = $1', [tenantId]);
    if (!rows[0]) throw new Error(`No tenant ${tenantId}`);
    const before = rows[0].system_prompt ?? '';

    console.log(`\ntenant    : ${rows[0].name} (${tenantId})`);
    console.log(
      `intake    : ${recipe.intake?.join(', ') || (recipe.customIntake ? 'custom' : 'none')}`
    );
    console.log(`assistant : ${recipe.personaName ?? rows[0].persona_name ?? '(unchanged)'}`);
    console.log(`installed : ${before.length} chars`);
    console.log(`composed  : ${script.length} chars`);

    // Rung-shape diff: the heading lines tell the story at a glance.
    const headings = (text: string): string[] =>
      ((text.match(/^#{2,3} .*$/gm) ?? []) as string[]).map((h: string) => h.replace(/^#+ /, ''));
    const oldH = headings(before);
    const newH = headings(script);
    console.log('\n  installed shape:            → composed shape:');
    const rowsN = Math.max(oldH.length, newH.length);
    for (let i = 0; i < rowsN; i++) {
      const a = (oldH[i] ?? '').slice(0, 28).padEnd(28);
      const b = (newH[i] ?? '').slice(0, 40);
      console.log(`  ${a}  ${b}`);
    }

    if (before === script) {
      console.log('\nNo change — installed script already matches the composition.');
      return;
    }
    if (DRY_RUN) {
      console.log('\nDRY RUN — nothing written. Full composed script below:\n');
      console.log(script);
      return;
    }

    // Backup FIRST, unconditionally, before any write.
    if (before) {
      mkdirSync('scripts/script-backups', { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = join('scripts/script-backups', `${tenantId}_${stamp}.txt`);
      writeFileSync(backupPath, before);
      console.log(`\n  ✔ backed up installed script → ${backupPath}`);
    }

    await pool.query(
      `UPDATE tenants SET system_prompt = $2, persona_name = COALESCE($3, persona_name) WHERE tenant_id = $1`,
      [tenantId, script, recipe.personaName ?? null]
    );
    console.log(`  ✔ installed (${script.length} chars)`);
    console.log(
      '\nTest it before it takes a real call: ./scripts/simulate.sh call --tenant ' + tenantId
    );
  } finally {
    await pool.end();
  }
}

build().catch((err) => {
  console.error(`ladder-builder: ${(err as Error).message}`);
  process.exit(1);
});
