/**
 * Verify ONE REAL TENANT's database-driven question trees against the
 * TypeScript library, through the same loader the live agent's tenant-config
 * path uses.
 *
 *   npx tsx scripts/verify-tenant-question-trees.ts <tenant_id> <vertical> [--db "postgres://..."]
 *
 * WHY THIS EXISTS SEPARATELY FROM THE CI TEST. `tests/questionTreeRoundTrip.test.ts`
 * proves the MECHANISM works, using throwaway tenants it creates and deletes.
 * This proves THIS BUSINESS's conversion worked, against the actual row, on the
 * actual database — which is the question you have when you flip a paying
 * client over and their phone line is about to run whatever is in those rows.
 *
 * THE BAR IS EQUALITY, NOT "LOOKS RIGHT". If the trees loaded out of the tenant's
 * rows are byte-identical to the trees the ~300 checklist tests already exercise,
 * then those tests cover this tenant's live call path too, and the conversion is
 * provably lossless. Anything less means a rule encoded in a tree — a listen-only
 * flag, an empty choice branch, an action's await_tree — was dropped in transit,
 * and the loss would not surface until a real caller hit it.
 *
 * A DIFFERENCE IS NOT ALWAYS A BUG. Once an owner customizes their intake, their
 * trees are SUPPOSED to diverge from the platform library — that is the entire
 * point of per-tenant questions. Run this immediately after conversion, when
 * is_customized is still false everywhere; after that, a reported difference
 * should be read against what the owner actually changed.
 */
import { Pool } from 'pg';
import { loadTenantQuestionTrees, type QuestionTree } from '../src/services/questionTrees';
import { PRESET_LIBRARY } from '../agent/src/checklist/presets';
import { BLOCK_LIBRARY } from '../agent/src/checklist/blockLibrary';
import { PLATFORM_TREE_LIBRARY } from '../agent/src/checklist/trees';

/**
 * A tenant's LIBRARY is the whole platform tree set; the PRESET decides only
 * which of those trees the model may SELECT.
 *
 * Getting this backwards is the bug this script exists to catch, and it caught
 * it: copying only the preset's trees crashed the tracker at construction with
 * `Action "book" requires unknown node "drop_off_ok"` — `booking.book` carries
 * a cross-tree requirement on a `fix_computer` node, and the constructor
 * validates every `requires` id against the library it is handed. Production
 * has always built the tracker from the full library and gated SELECTION with
 * the preset.
 */
function expectedTrees(): QuestionTree[] {
  return PLATFORM_TREE_LIBRARY.map((t) => JSON.parse(JSON.stringify(t)) as QuestionTree);
}

/** The trees this vertical's preset actually lets a call select. */
function selectableTreeIds(blocks: string[]): Set<string> {
  const out = new Set<string>();
  for (const blockId of blocks) {
    for (const treeId of BLOCK_LIBRARY[blockId]?.tree_refs ?? []) out.add(treeId);
  }
  return out;
}

function countNodes(tree: QuestionTree | undefined): number {
  if (!tree) return 0;
  return (JSON.stringify(tree).match(/"node_id"/g) ?? []).length;
}

/**
 * Canonical JSON — object keys sorted recursively — so comparison is by VALUE,
 * not by declaration order.
 *
 * The first version of this script compared raw JSON.stringify output and
 * promptly reported the booking tree as "lossy". It was not: `caller_timezone`
 * carries `listen: true` in both, but trees.ts declares it before `ask` while
 * the assembler appends it after. Two identical trees, two different strings.
 * A checker that cries wolf about key order is worse than no checker — it would
 * have had someone hunting a data-loss bug that does not exist, and it would
 * have taught them to ignore this script's output.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [tenantId, vertical] = argv;
  if (!tenantId || !vertical) {
    console.error(
      'usage: npx tsx scripts/verify-tenant-question-trees.ts <tenant_id> <vertical> [--db "postgres://..."]'
    );
    process.exit(2);
  }
  const dbFlag = argv.indexOf('--db');
  const connectionString =
    dbFlag >= 0
      ? argv[dbFlag + 1]
      : (process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres');

  const preset = PRESET_LIBRARY.find((p) => p.vertical === vertical);
  if (!preset) {
    console.error(
      `Unknown vertical '${vertical}'. Known: ${PRESET_LIBRARY.map((p) => p.vertical).join(', ')}`
    );
    process.exit(2);
  }

  const pool = new Pool({ connectionString });
  try {
    const fromDb = await loadTenantQuestionTrees(pool, tenantId);
    const expected = expectedTrees();
    const selectable = selectableTreeIds(preset.conversation_blocks);

    console.log(`tenant   : ${tenantId}`);
    console.log(`vertical : ${vertical}`);
    console.log(`trees    : ${fromDb.length} in database, ${expected.length} in the TS library`);
    console.log(
      `selectable: ${selectable.size} of them (the preset gates SELECTION; the library must be complete\n` +
        `            because actions carry cross-tree requires — see the header)\n`
    );

    if (fromDb.length === 0) {
      console.log(
        'NOT CONVERTED — this tenant has no question-tree rows, so its calls run the\n' +
          'platform TypeScript library (the pre-conversion behaviour). Copy the templates\n' +
          "with: SELECT copy_question_tree_templates_to_tenant('<tenant>', ARRAY['<vertical>']);"
      );
      process.exit(1);
    }

    let failures = 0;
    for (const want of expected) {
      const got = fromDb.find((t) => t.tree_id === want.tree_id);
      const same = canonical(got) === canonical(want);
      if (!same) failures += 1;
      console.log(
        `  ${same ? 'MATCH  ' : 'DIFFERS'}  ${want.tree_id.padEnd(16)} ${String(countNodes(got)).padStart(2)} nodes  ` +
          `${selectable.has(want.tree_id) ? 'selectable' : 'library-only'}`
      );
      if (!same) {
        const a = canonical(got ?? null);
        const b = canonical(want);
        let i = 0;
        while (i < Math.min(a.length, b.length) && a[i] === b[i]) i += 1;
        console.log(`      first difference at character ${i}:`);
        console.log(`      db: …${a.slice(Math.max(0, i - 50), i + 50)}…`);
        console.log(`      ts: …${b.slice(Math.max(0, i - 50), i + 50)}…`);
      }
    }

    const extra = fromDb.filter((t) => !expected.some((e) => e.tree_id === t.tree_id));
    if (extra.length > 0) {
      failures += extra.length;
      console.log(
        `\n  EXTRA trees present in the database: ${extra.map((t) => t.tree_id).join(', ')}`
      );
    }

    console.log(
      failures === 0
        ? '\nPASS — every tree is identical to the TypeScript library. The checklist test\n' +
            'suite that runs against that library therefore covers this tenant live path.'
        : `\nFAIL — ${failures} tree(s) differ. If this tenant has not been customized yet,\n` +
            'the conversion is lossy and must not be trusted on a live call.'
    );
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
