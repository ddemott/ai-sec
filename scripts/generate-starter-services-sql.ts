/**
 * Project shared/starterServices.ts into SQL.
 *
 * WHY GENERATE RATHER THAN HAND-WRITE
 * The starter list has to exist in three places at once — the migration (for
 * databases that already exist), supabase/seed.sql (for a fresh rebuild), and
 * the TypeScript the tests read. Hand-keeping three copies of the same list in
 * sync is precisely the drift that emptied `example_services` in the first
 * place, and this repo has now been bitten by parallel lists three times
 * (business_templates vs the preset catalog; the tree library vs the preset;
 * this). So the TS file is the author's copy and the SQL is derived.
 *
 * seed.sql is rewritten BETWEEN MARKERS, never wholesale — everything outside
 * them is hand-maintained and must survive.
 *
 * Run:  npx tsx scripts/generate-starter-services-sql.ts [--check]
 *   --check  exit 1 if the files on disk differ from what would be generated
 *            (this is what CI runs, so a hand-edit to the SQL fails loudly
 *            instead of silently becoming a fourth source of truth)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { STARTER_SERVICES, starterResourcesFor } from '../shared/starterServices';

const ROOT = path.resolve(__dirname, '..');
const SEED = path.join(ROOT, 'supabase/seed.sql');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20260901100000_starter_services.sql');

const BEGIN = '-- BEGIN GENERATED: starter services (scripts/generate-starter-services-sql.ts)';
const END = '-- END GENERATED: starter services';

/** Postgres single-quote escaping. */
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * `resource_label` lives in seed.sql, not in the TS catalog — resources are
 * shape only and the label is already the template's own vocabulary. Reading it
 * back out of the seed keeps ONE definition of the label rather than a copy here.
 */
function resourceLabels(seedSql: string): Map<string, string> {
  const labels = new Map<string, string>();
  // Matches the VALUES rows of the business_templates INSERT:
  //   ('auto-shop', 'Auto Repair Shop', 'Auto & Vehicle', 1, 'Bay', 'Bays', ...
  const row = /\(\s*'([a-z-]+)',\s*'(?:[^']|'')*',\s*'(?:[^']|'')*',\s*\d+,\s*'((?:[^']|'')*)'/g;
  let m: RegExpExecArray | null;
  while ((m = row.exec(seedSql)) !== null) {
    labels.set(m[1], m[2].replace(/''/g, "'"));
  }
  return labels;
}

function statementsFor(labels: Map<string, string>): string[] {
  const out: string[] = [];
  for (const businessType of Object.keys(STARTER_SERVICES).sort()) {
    const services = STARTER_SERVICES[businessType];
    const label = labels.get(businessType);
    if (!label) {
      throw new Error(
        `starterServices has '${businessType}' but seed.sql has no business_templates row for it — ` +
          `a starter list for a template that does not exist can never reach a wizard.`
      );
    }
    const json = JSON.stringify(
      services.map((s) => ({
        name: s.name,
        ...(s.description ? { description: s.description } : {}),
        ...(s.look_first ? { look_first: true } : {}),
        ...(s.is_default ? { is_default: true } : {}),
      }))
    );
    const resources = starterResourcesFor(label)
      .map((r) => q(r))
      .join(', ');
    out.push(
      `UPDATE business_templates SET\n` +
        `  example_services  = ${q(json)}::jsonb,\n` +
        `  example_resources = ARRAY[${resources}]::text[]\n` +
        ` WHERE business_type = ${q(businessType)};`
    );
  }
  return out;
}

function migrationBody(statements: string[]): string {
  return `-- Starter services + example resources for every live business template.
--
-- GENERATED FILE — do not hand-edit. Author the content in
-- shared/starterServices.ts and re-run:
--   npx tsx scripts/generate-starter-services-sql.ts
--
-- WHY THIS MIGRATION EXISTS
-- business_templates.example_services was EMPTY for all 31 live business types
-- (measured 2026-09-01), so the setup wizard asked a new owner "What service do
-- you offer?" against a blank list. This fixes databases that already exist;
-- supabase/seed.sql carries the same generated block for fresh rebuilds, and
-- supabase/baseline.sql is regenerated so the two agree.
--
-- The column becomes jsonb. It was text[] — names only, with nowhere to put a
-- description. resolveServiceForBooking's semantic step embeds
-- concat_ws('. ', name, subtitle, description), so a look-first row seeded
-- name-only ("Diagnostic visit") gives "my check engine light is on" almost
-- nothing to match against. The description is what does the retrieval work.
-- Adding a second column instead would have created yet another list that must
-- agree with the first one; this schema has been bitten by that three times.

ALTER TABLE business_templates
  ALTER COLUMN example_services DROP DEFAULT;

-- Existing text[] values become [{"name": ...}] so nothing is lost on the way
-- through. Every live row is overwritten below anyway; this matters only for a
-- database holding a value this generator does not know about.
--
-- Two steps, not one: Postgres refuses a subquery inside ALTER COLUMN ... USING
-- ("cannot use subquery in transform expression"), so the array becomes a jsonb
-- array of STRINGS first, and a plain UPDATE then lifts each string into an
-- object. NULL folds to '[]' rather than staying NULL, because every reader
-- treats this column as a list.
ALTER TABLE business_templates
  ALTER COLUMN example_services TYPE jsonb
  USING to_jsonb(COALESCE(example_services, '{}'::text[]));

UPDATE business_templates
   SET example_services = COALESCE(
         (SELECT jsonb_agg(jsonb_build_object('name', value))
            FROM jsonb_array_elements_text(example_services) AS value),
         '[]'::jsonb
       )
 WHERE jsonb_typeof(example_services) = 'array'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(example_services) AS e
      WHERE jsonb_typeof(e) = 'string'
   );

ALTER TABLE business_templates
  ALTER COLUMN example_services SET DEFAULT '[]'::jsonb,
  ALTER COLUMN example_services SET NOT NULL;

${statements.join('\n\n')}
`;
}

function main(): void {
  const check = process.argv.includes('--check');
  const seedSql = readFileSync(SEED, 'utf-8');
  const labels = resourceLabels(seedSql);
  const statements = statementsFor(labels);

  // ── migration ──
  const migration = migrationBody(statements);

  // ── seed.sql, between the markers only ──
  const block = [
    BEGIN,
    '-- Author the content in shared/starterServices.ts, then re-run the generator.',
    '-- Hand-edits here are overwritten and fail `npm run verify:starter-services`.',
    ...statements,
    END,
  ].join('\n');

  const begin = seedSql.indexOf(BEGIN);
  const end = seedSql.indexOf(END);
  if (begin === -1 || end === -1) {
    throw new Error(
      `supabase/seed.sql is missing the generated-block markers. Add:\n${BEGIN}\n${END}\n` +
        `after the business_templates INSERT.`
    );
  }
  const nextSeed = seedSql.slice(0, begin) + block + seedSql.slice(end + END.length);

  if (check) {
    const problems: string[] = [];
    if (nextSeed !== seedSql) problems.push('supabase/seed.sql');
    let onDisk = '';
    try {
      onDisk = readFileSync(MIGRATION, 'utf-8');
    } catch {
      problems.push(`${path.relative(ROOT, MIGRATION)} (missing)`);
    }
    if (onDisk && onDisk !== migration) problems.push(path.relative(ROOT, MIGRATION));
    if (problems.length) {
      console.error(
        `Starter-service SQL is out of date with shared/starterServices.ts:\n` +
          problems.map((p) => `  - ${p}`).join('\n') +
          `\n\nRun: npx tsx scripts/generate-starter-services-sql.ts`
      );
      process.exit(1);
    }
    console.log('✓ starter-service SQL matches shared/starterServices.ts');
    return;
  }

  writeFileSync(MIGRATION, migration);
  writeFileSync(SEED, nextSeed);
  const total = Object.values(STARTER_SERVICES).reduce((n, list) => n + list.length, 0);
  console.log(
    `Wrote ${statements.length} template updates (${total} starter services) to:\n` +
      `  ${path.relative(ROOT, MIGRATION)}\n  ${path.relative(ROOT, SEED)}`
  );
}

main();
