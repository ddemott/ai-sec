/**
 * CAPTURE COMPLETENESS — every node the job tree collects must REACH THE WRITE.
 *
 * WHO: the job tree's collected nodes vs capture_job_inquiry's backfill map.
 * WHAT: each non-action node in the job tree must either appear as a backfill
 *       source for the capture tool, or be declared below as a CONTROL node
 *       (state that steers the call rather than data that belongs in the row).
 * WHEN: fails at CI time the moment someone adds a tree node without wiring its
 *       destination.
 * WHERE: ACTION_ARG_BACKFILL (checklistTools.ts) is the seam where host truth
 *        reaches the tool args.
 * WHY: "state theater" — host-owned state the write ignores. Found live
 *      2026-07-30 on prod call SCL_nRKo3KEVw8Yh: the role_description node had
 *      existed since the tree was written, the agent ASKED for it, the caller
 *      dictated a paragraph, the checklist showed ✓ — and the write had no
 *      param, no Zod field, no column. The single most useful field on the
 *      lead (WHAT job is this?) survived only in the raw transcript. The same
 *      class ate location_type before it (2026-07-21). This test makes the
 *      third occurrence impossible to ship quietly.
 */
import { describe, expect, it } from 'vitest';
import { ACTION_ARG_BACKFILL } from './checklistTools.js';
import { PLATFORM_TREE_LIBRARY } from './trees.js';
import type { QuestionNodeDef } from './types.js';

/** Nodes that deliberately do NOT land in the job_inquiries row: they steer the
 *  CALL, not the record. Adding a node here is an explicit, reviewed decision —
 *  the whole point is that omission is loud, never silent. */
const JOB_CONTROL_NODES = new Set([
  // Routes a yes into set_purpose → booking → book_with_scheduling; the
  // resulting appointment (not this answer) is what the row links to.
  'meeting_offer',
]);

function collectNonActionNodes(nodes: QuestionNodeDef[], out: Set<string>): void {
  for (const def of nodes) {
    if (def.type === 'action') continue;
    out.add(def.node_id);
    if (def.type === 'choice') {
      for (const children of Object.values(def.options)) collectNonActionNodes(children, out);
    }
  }
}

describe('job tree → capture_job_inquiry completeness', () => {
  const jobTree = PLATFORM_TREE_LIBRARY.find((t) => t.tree_id === 'job');
  const identityTree = PLATFORM_TREE_LIBRARY.find((t) => t.tree_id === 'identity');
  if (!jobTree || !identityTree) throw new Error('platform library is missing job/identity');

  const backfillSources = new Set(
    (ACTION_ARG_BACKFILL['capture_job_inquiry'] ?? []).flatMap((f) => [...f.from])
  );

  it('every collected node maps to a capture param or is a declared control node', () => {
    // Identity rides along on every job call (the prompt's selection rule), so
    // its nodes are part of what the call collects for the capture.
    const collected = new Set<string>();
    collectNonActionNodes(jobTree.nodes, collected);
    collectNonActionNodes(identityTree.nodes, collected);

    const orphans = [...collected].filter(
      (n) => !backfillSources.has(n) && !JOB_CONTROL_NODES.has(n)
    );
    expect(
      orphans,
      `These job-call nodes are COLLECTED but reach no capture_job_inquiry param — ` +
        `the caller answers, the checklist ticks, and the row never hears it ` +
        `(the role_description bug, class of). Wire each into ACTION_ARG_BACKFILL ` +
        `or declare it in JOB_CONTROL_NODES with a reason: ${orphans.join(', ')}`
    ).toEqual([]);
  });

  it('the backfill map names no node the library does not define', () => {
    // The reverse direction: a typo'd source silently backfills nothing.
    const allNodes = new Set<string>();
    for (const tree of PLATFORM_TREE_LIBRARY) collectNonActionNodes(tree.nodes, allNodes);
    const ghosts = [...backfillSources].filter((n) => !allNodes.has(n));
    expect(
      ghosts,
      `ACTION_ARG_BACKFILL sources that match no tree node (typo?): ${ghosts.join(', ')}`
    ).toEqual([]);
  });

  it('role_description specifically reaches the write (the 2026-07-30 prod loss)', () => {
    expect(backfillSources.has('role_description')).toBe(true);
  });
});
