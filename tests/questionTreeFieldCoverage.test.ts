/**
 * NO FIELD OF A QUESTION TREE MAY BE SILENTLY DROPPED BY THE DATABASE.
 *
 * WHY THIS EXISTS ALONGSIDE THE ROUND-TRIP TEST. `questionTreeRoundTrip.test.ts`
 * proves that what goes into Postgres comes back out identical — but only for
 * the trees a shipped preset actually includes. `fix_computer` is in NO preset
 * (deliberately parked), so it is never seeded and never compared. Add a field
 * to a node type, use it only in an unreachable tree, and the round-trip test
 * stays green while the column to hold it does not exist.
 *
 * The failure mode is the one this whole conversion is meant to avoid: a rule
 * encoded in a tree — a listen-only flag, an ordering gate, an await_tree —
 * that survives in TypeScript and quietly vanishes on the way to a live call.
 * Nothing errors. The checklist still renders. The call simply stops honouring
 * a rule someone wrote down.
 *
 * So this walks EVERY tree in the platform library, reachable or not, and
 * asserts that every key present on every node is one the database schema and
 * the assembler carry. A new field fails here the moment it is used, whether or
 * not any preset offers its tree.
 *
 * WHO: anyone adding a field to types.ts | WHAT: node keys vs carried columns |
 * WHEN: CI, every run | WHERE: agent/src/checklist/types.ts →
 * question_tree_*_nodes → src/services/questionTrees.ts assembleTrees |
 * WHY: a dropped field is invisible until a caller is affected by its absence.
 */
import { describe, it, expect } from 'vitest';
import { PLATFORM_TREE_LIBRARY } from '../agent/src/checklist/trees';
import type { QuestionNodeDef } from '../agent/src/checklist/types';

/**
 * Every node key the conversion carries end to end.
 *
 * Adding a key here is a DELIBERATE act with three other edits attached: a
 * column on both question_tree_template_nodes and tenant_question_nodes, the
 * flatten step in scripts/seed-question-tree-templates.ts, the copy function's
 * column list, and the rebuild in assembleTrees(). If you add it here and skip
 * those, the round-trip test fails — which is the intended order of discovery.
 */
const CARRIED_NODE_KEYS = new Set([
  // shared
  'node_id',
  'type',
  // text / choice
  'ask',
  'listen',
  // choice
  'options',
  // action
  'tool',
  'description',
  'requires',
  'await_tree',
]);

/** Every tree-level key the conversion carries. */
const CARRIED_TREE_KEYS = new Set(['tree_id', 'description', 'nodes']);

function walkNodes(nodes: QuestionNodeDef[], visit: (node: QuestionNodeDef) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.type === 'choice') {
      for (const children of Object.values(node.options)) walkNodes(children, visit);
    }
  }
}

describe('question tree → database field coverage', () => {
  it('HAPPY: every node key in the platform library is carried by the schema', () => {
    const offenders: string[] = [];

    for (const tree of PLATFORM_TREE_LIBRARY) {
      walkNodes(tree.nodes, (node) => {
        for (const key of Object.keys(node)) {
          if (!CARRIED_NODE_KEYS.has(key)) {
            offenders.push(`${tree.tree_id}.${node.node_id} → "${key}"`);
          }
        }
      });
    }

    expect(
      offenders,
      `These node fields exist in the TypeScript tree library but the database ` +
        `conversion does not carry them, so they would be SILENTLY LOST for any ` +
        `tenant running database-driven questions:\n\n${offenders.join('\n')}\n\n` +
        `Add a column to question_tree_template_nodes AND tenant_question_nodes, ` +
        `carry it in scripts/seed-question-tree-templates.ts, in ` +
        `copy_question_tree_templates_to_tenant(), and in assembleTrees() — then ` +
        `add the key to CARRIED_NODE_KEYS.`
    ).toEqual([]);
  });

  it('HAPPY: every tree-level key is carried by the schema', () => {
    const offenders: string[] = [];
    for (const tree of PLATFORM_TREE_LIBRARY) {
      for (const key of Object.keys(tree)) {
        if (!CARRIED_TREE_KEYS.has(key)) offenders.push(`${tree.tree_id} → "${key}"`);
      }
    }
    expect(
      offenders,
      `Tree-level fields not carried into question_tree_templates / ` +
        `tenant_question_trees: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  /**
   * The unreachable-tree gap, named explicitly so nobody "tidies" this file by
   * scoping it to preset-reachable trees and reopens the hole.
   */
  it('PIN: coverage includes trees no preset can reach', () => {
    const ids = PLATFORM_TREE_LIBRARY.map((t) => t.tree_id);
    // fix_computer is parked (no preset offers it) and case_intake is offered
    // only by the law-firm preset — both must still be field-checked.
    expect(ids).toContain('fix_computer');
    expect(ids).toContain('case_intake');
  });
});
