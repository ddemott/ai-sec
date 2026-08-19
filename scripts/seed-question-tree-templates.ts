/**
 * Seed the platform question-tree TEMPLATES from the TypeScript tree library.
 *
 *   npx tsx scripts/seed-question-tree-templates.ts [--db "postgres://..."] [--force]
 *
 * WHY THIS EXISTS RATHER THAN A HAND-WRITTEN SQL SEED. The questions a call can
 * ask are now DATA IN THE DATABASE (migration 20260814130000) so each client's
 * intake can be configured without a deploy. But the generic starting point for
 * each vertical still has to be AUTHORED somewhere reviewable, and a thousand
 * lines of INSERT statements is not that place: the ask text carries hard-won
 * live-call rules, it gets edited in code review, and it must stay diffable.
 *
 * So the content is authored exactly where it always was —
 * agent/src/checklist/trees.ts — and this script projects it into the template
 * tables. One author, two homes: TypeScript for review and for the runtime
 * fallback, Postgres for what an individual client's calls actually run.
 *
 * WHAT A "VERTICAL" GETS. Each shipped preset (auto_shop, salon, local_service,
 * owner_for_hire, law_firm) is expanded through the block library into the trees
 * it enables, and the FULL set is written under that vertical. Verticals
 * therefore duplicate the shared trees (identity, booking, message, …) on
 * purpose: a vertical template is meant to be self-contained and to DIVERGE.
 * The moment a law firm rewords its booking questions, no other vertical should
 * feel it.
 *
 * IDEMPOTENT AND NON-DESTRUCTIVE TO CLIENTS. It rewrites TEMPLATE rows only.
 * Tenant copies (tenant_question_trees / tenant_question_nodes) are never
 * touched — re-running this after a client has customized their intake cannot
 * revert their questions, because it does not address their rows at all.
 */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { PRESET_LIBRARY } from '../agent/src/checklist/presets';
import { PLATFORM_TREE_LIBRARY } from '../agent/src/checklist/trees';
import type { QuestionNodeDef, QuestionTreeDef } from '../agent/src/checklist/types';

type NodeRow = {
  template_node_id: string;
  vertical: string;
  tree_id: string;
  node_id: string;
  parent_template_node_id: string | null;
  option_key: string | null;
  sort_order: number;
  node_type: 'text' | 'choice' | 'action';
  ask: string | null;
  listen: boolean;
  choice_options: string[] | null;
  tool: string | null;
  action_description: string | null;
  requires: string[] | null;
  await_tree: boolean;
};

/**
 * Flatten one tree into rows, assigning ids in JS so a child can name its
 * parent in the same pass — no second UPDATE, no ordering dance.
 */
function flattenTree(vertical: string, tree: QuestionTreeDef): NodeRow[] {
  const rows: NodeRow[] = [];

  const walk = (
    nodes: QuestionNodeDef[],
    parentId: string | null,
    optionKey: string | null
  ): void => {
    nodes.forEach((node, index) => {
      const templateNodeId = randomUUID();
      const base = {
        template_node_id: templateNodeId,
        vertical,
        tree_id: tree.tree_id,
        node_id: node.node_id,
        parent_template_node_id: parentId,
        option_key: optionKey,
        // The declaration order IS the ask order the tracker walks.
        sort_order: index,
      };

      if (node.type === 'action') {
        rows.push({
          ...base,
          node_type: 'action',
          ask: null,
          listen: false,
          choice_options: null,
          tool: node.tool,
          action_description: node.description,
          requires: node.requires ? [...node.requires] : null,
          await_tree: Boolean(node.await_tree),
        });
        return;
      }

      if (node.type === 'choice') {
        rows.push({
          ...base,
          node_type: 'choice',
          ask: node.ask,
          listen: false,
          // Every option key, INCLUDING ones with no children. A branch that
          // asks nothing further is still a branch the caller can pick, and
          // dropping it here would make it unselectable.
          choice_options: Object.keys(node.options),
          tool: null,
          action_description: null,
          requires: null,
          await_tree: false,
        });
        for (const [key, children] of Object.entries(node.options)) {
          walk(children, templateNodeId, key);
        }
        return;
      }

      rows.push({
        ...base,
        node_type: 'text',
        ask: node.ask,
        listen: Boolean(node.listen),
        choice_options: null,
        tool: null,
        action_description: null,
        requires: null,
        await_tree: false,
      });
    });
  };

  walk(tree.nodes, null, null);
  return rows;
}

/**
 * A vertical's template is the WHOLE platform tree library — not just the trees
 * its preset enables. This is not laziness; it is what production does, and
 * getting it wrong crashes calls.
 *
 * THE BUG THIS ENCODES (2026-08-14, caught by tenantLiveCallJourneys.test.ts
 * running against a real converted tenant). The first version seeded only the
 * preset's trees, which reads as the tidier choice: give a business exactly the
 * questions it can use. Converting a tenant that way and starting a call threw
 * at tracker construction:
 *
 *   Action "book" requires unknown node "drop_off_ok" — not defined in any library tree.
 *
 * `booking.book` carries a CROSS-TREE requirement on `drop_off_ok`, a node that
 * lives in `fix_computer`. The tracker's constructor validates that every
 * `requires` id exists SOMEWHERE in the library it was handed; at runtime, ids
 * outside the call's selected trees are simply treated as satisfied. So
 * production has always built the tracker from the FULL library and used the
 * preset to restrict what is SELECTABLE — two different jobs that a
 * preset-only seed quietly collapsed into one.
 *
 * The distinction to hold on to: the LIBRARY is what exists, the PRESET is what
 * this business may select. `resolveSelectableTreeIds` still intersects the two,
 * so a law firm cannot select `job` just because the row is present.
 */
function treesForVertical(): QuestionTreeDef[] {
  return [...PLATFORM_TREE_LIBRARY];
}

/**
 * Project the TypeScript library into the template tables, on a client the
 * caller owns (no BEGIN/COMMIT here — the caller decides the transaction).
 *
 * EXPORTED BECAUSE THE TOUCHSTONE TEST MUST SEED ITSELF. `tests/questionTree
 * RoundTrip.test.ts` compares these rows to the TS trees; when it read whatever
 * a developer had seeded by hand at some earlier commit, an edit to `trees.ts`
 * turned into SEVEN failing assertions that named the tree and blamed the
 * conversion — the rows were simply older than the library (2026-08-15: a
 * one-clause reword of `case_intake/matter_description`). Worse, nothing seeds
 * templates in CI at all, so the file's own guard would have thrown there the
 * first time it ran. A test that regenerates its fixture from the source of
 * truth cannot go stale, and it works on a fresh CI database with no extra step.
 */
export async function seedQuestionTreeTemplates(
  client: PoolClient
): Promise<{ treeCount: number; nodeCount: number }> {
  let treeCount = 0;
  let nodeCount = 0;

  for (const preset of PRESET_LIBRARY) {
    const vertical = preset.vertical;
    const trees = treesForVertical();

    for (const [index, tree] of trees.entries()) {
      await client.query(
        `INSERT INTO question_tree_templates (vertical, tree_id, description, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (vertical, tree_id)
             DO UPDATE SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order`,
        [vertical, tree.tree_id, tree.description, index]
      );
      treeCount += 1;

      // Replace this template tree's nodes wholesale. Templates are generated
      // artifacts — a node deleted from the TS library must disappear here too,
      // and an upsert-only pass would leave it behind forever. Tenant rows are
      // untouched by this; only the template is regenerated.
      await client.query(
        `DELETE FROM question_tree_template_nodes WHERE vertical = $1 AND tree_id = $2`,
        [vertical, tree.tree_id]
      );

      const rows = flattenTree(vertical, tree);
      // Parents before children: the self-FK is checked per statement.
      for (const row of rows) {
        await client.query(
          `INSERT INTO question_tree_template_nodes (
               template_node_id, vertical, tree_id, node_id, parent_template_node_id,
               option_key, sort_order, node_type, ask, listen, choice_options,
               tool, action_description, requires, await_tree
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            row.template_node_id,
            row.vertical,
            row.tree_id,
            row.node_id,
            row.parent_template_node_id,
            row.option_key,
            row.sort_order,
            row.node_type,
            row.ask,
            row.listen,
            row.choice_options,
            row.tool,
            row.action_description,
            row.requires,
            row.await_tree,
          ]
        );
        nodeCount += 1;
      }
    }
  }

  return { treeCount, nodeCount };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dbFlag = argv.indexOf('--db');
  const connectionString =
    dbFlag >= 0
      ? argv[dbFlag + 1]
      : (process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres');
  const force = argv.includes('--force');

  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  if (!isLocal && !force) {
    console.error('Refusing to seed a non-local database without --force.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const { treeCount, nodeCount } = await seedQuestionTreeTemplates(client);
    await client.query('COMMIT');
    console.log(
      `Seeded ${treeCount} template trees / ${nodeCount} nodes across ${PRESET_LIBRARY.length} verticals.`
    );
    console.log('Tenant copies were NOT touched — customized client intakes are safe.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run only when invoked as a script. Importing this file (the round-trip test
// does, to seed its own fixture) must not connect to a database or exit the
// process.
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
