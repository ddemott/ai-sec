/**
 * Read question trees back OUT of the database and reassemble them into the
 * exact shape the agent's checklist runtime consumes.
 *
 * THE CONTRACT THIS FILE HAS TO MEET IS EQUALITY, NOT MERELY VALIDITY. The
 * questions used to live only in agent/src/checklist/trees.ts, and every
 * checklist test in the suite exercises that library. Moving the questions into
 * Postgres is only safe if what comes back out is the SAME DATA — not "close
 * enough", not "semantically similar". If the reassembled tree is deep-equal to
 * the TypeScript tree, then every existing test that passes against the library
 * is equally a test of the database path, and the conversion is provably
 * lossless. `tests/questionTreeRoundTrip.test.ts` asserts exactly that, per
 * vertical, and is the touchstone for converting a real business over.
 *
 * WHICH IS WHY THE OPTIONAL FIELDS ARE OMITTED RATHER THAN DEFAULTED. A text
 * node in the library is `{node_id, type, ask}` — it does not carry
 * `listen: false`. Emitting `listen: false` here would be harmless at runtime
 * and would break the equality that makes the conversion provable, so absent
 * stays absent. Same for `requires` and `await_tree` on action nodes.
 *
 * NESTING IS REBUILT FROM (parent, option_key), NEVER FROM node_id. A node id
 * legitimately repeats across branches of one tree — job.rate_range sits under
 * both `contract` and `contract_to_hire` so an early "it pays 65 to 80"
 * survives whichever branch the caller lands on. Matching on node_id would be
 * ambiguous precisely where the structure matters.
 */
import type { PoolClient } from 'pg';

/** Structural mirror of agent/src/checklist/types.ts. Kept local on purpose:
 *  the agent receives these as JSON over /agent-tools/tenant-config, so the two
 *  packages share a SHAPE, not a TypeScript import. */
export interface TextNode {
  node_id: string;
  type: 'text';
  ask: string;
  listen?: boolean;
}
export interface ChoiceNode {
  node_id: string;
  type: 'choice';
  ask: string;
  options: Record<string, QuestionNode[]>;
}
export interface ActionNode {
  node_id: string;
  type: 'action';
  tool: string;
  description: string;
  requires?: string[];
  await_tree?: boolean;
}
export type QuestionNode = TextNode | ChoiceNode | ActionNode;

export interface QuestionTree {
  tree_id: string;
  description: string;
  nodes: QuestionNode[];
}

interface NodeRow {
  node_row_id: string;
  parent_row_id: string | null;
  tree_id: string;
  node_id: string;
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
}

interface TreeRow {
  tree_id: string;
  description: string;
  sort_order: number;
}

/** Assemble flat rows into nested trees. Pure — no DB, so it is unit-testable. */
export function assembleTrees(treeRows: TreeRow[], nodeRows: NodeRow[]): QuestionTree[] {
  const childrenByParent = new Map<string, NodeRow[]>();
  const roots = new Map<string, NodeRow[]>();

  for (const row of nodeRows) {
    if (row.parent_row_id === null) {
      const list = roots.get(row.tree_id) ?? [];
      list.push(row);
      roots.set(row.tree_id, list);
    } else {
      const list = childrenByParent.get(row.parent_row_id) ?? [];
      list.push(row);
      childrenByParent.set(row.parent_row_id, list);
    }
  }

  const byOrder = (a: NodeRow, b: NodeRow): number => a.sort_order - b.sort_order;

  const build = (row: NodeRow): QuestionNode => {
    if (row.node_type === 'action') {
      const node: ActionNode = {
        node_id: row.node_id,
        type: 'action',
        tool: row.tool ?? '',
        description: row.action_description ?? '',
      };
      // Omitted-when-absent: see the header. `requires: []` is not the same
      // value as no `requires` key, and equality is the contract.
      if (row.requires && row.requires.length > 0) node.requires = [...row.requires];
      if (row.await_tree) node.await_tree = true;
      return node;
    }

    if (row.node_type === 'choice') {
      const kids = (childrenByParent.get(row.node_row_id) ?? []).slice().sort(byOrder);
      const options: Record<string, QuestionNode[]> = {};
      // Seed EVERY declared option first, so a branch with no follow-up
      // questions still exists and stays selectable. Dropping empty branches
      // would silently delete a choice the caller can make.
      for (const key of row.choice_options ?? []) options[key] = [];
      for (const kid of kids) {
        const key = kid.option_key ?? '';
        if (!options[key]) options[key] = [];
        options[key].push(build(kid));
      }
      return {
        node_id: row.node_id,
        type: 'choice',
        ask: row.ask ?? '',
        options,
      };
    }

    const node: TextNode = {
      node_id: row.node_id,
      type: 'text',
      ask: row.ask ?? '',
    };
    if (row.listen) node.listen = true;
    return node;
  };

  return treeRows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((tree) => ({
      tree_id: tree.tree_id,
      description: tree.description,
      nodes: (roots.get(tree.tree_id) ?? []).slice().sort(byOrder).map(build),
    }));
}

type Queryable = Pick<PoolClient, 'query'>;

/** The trees THIS tenant's calls run. Empty array = tenant has no rows yet, and
 *  the caller should fall back to the platform library (see agent/src/index.ts). */
export async function loadTenantQuestionTrees(
  client: Queryable,
  tenantId: string
): Promise<QuestionTree[]> {
  const trees = await client.query(
    `SELECT tree_id, description, sort_order
       FROM tenant_question_trees
      WHERE tenant_id = $1 AND is_enabled = true
      ORDER BY sort_order, tree_id`,
    [tenantId]
  );
  if (trees.rows.length === 0) return [];

  const nodes = await client.query(
    `SELECT tenant_question_node_id AS node_row_id,
            parent_tenant_question_node_id AS parent_row_id,
            tree_id, node_id, option_key, sort_order, node_type,
            ask, listen, choice_options, tool, action_description, requires, await_tree
       FROM tenant_question_nodes
      WHERE tenant_id = $1
      ORDER BY tree_id, sort_order`,
    [tenantId]
  );

  return assembleTrees(trees.rows as TreeRow[], nodes.rows as NodeRow[]);
}

/** The generic starting point for a vertical, before any client edits it. */
export async function loadTemplateQuestionTrees(
  client: Queryable,
  vertical: string
): Promise<QuestionTree[]> {
  const trees = await client.query(
    `SELECT tree_id, description, sort_order
       FROM question_tree_templates
      WHERE vertical = $1
      ORDER BY sort_order, tree_id`,
    [vertical]
  );
  if (trees.rows.length === 0) return [];

  const nodes = await client.query(
    `SELECT template_node_id AS node_row_id,
            parent_template_node_id AS parent_row_id,
            tree_id, node_id, option_key, sort_order, node_type,
            ask, listen, choice_options, tool, action_description, requires, await_tree
       FROM question_tree_template_nodes
      WHERE vertical = $1
      ORDER BY tree_id, sort_order`,
    [vertical]
  );

  return assembleTrees(trees.rows as TreeRow[], nodes.rows as NodeRow[]);
}
