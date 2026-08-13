import { describe, expect, it } from 'vitest';
import type { ConversationBlockDef } from './blockTypes.js';
import { applyOptionalNodes, compileRuntimeConfig } from './blockCompiler.js';
import { BLOCK_LIBRARY } from './blockLibrary.js';
import { BOOKING_TREE, IDENTITY_TREE, JOB_TREE, MESSAGE_TREE } from './trees.js';

describe('block library', () => {
  it('contains thin conversation-block wrappers for the first parity set', () => {
    expect(BLOCK_LIBRARY.identity.kind).toBe('conversation');
    expect(BLOCK_LIBRARY.booking.kind).toBe('conversation');
    expect(BLOCK_LIBRARY.message.kind).toBe('conversation');
    expect(BLOCK_LIBRARY.job.kind).toBe('conversation');

    expect(BLOCK_LIBRARY.identity.tree_refs).toEqual(['identity']);
    expect(BLOCK_LIBRARY.booking.tree_refs).toEqual(['booking']);
    expect(BLOCK_LIBRARY.message.tree_refs).toEqual(['message']);
    expect(BLOCK_LIBRARY.job.tree_refs).toEqual(['job']);
  });
});

describe('compileRuntimeConfig', () => {
  it('compiles the first parity-set block ids into the live tree definitions', () => {
    const compiled = compileRuntimeConfig({
      preset_id: 'job_default',
      enabled_conversation_blocks: ['identity', 'job', 'booking', 'message'],
      enabled_policy_blocks: [],
      enabled_knowledge_blocks: [],
      enabled_outcome_blocks: [],
      overrides: {},
      version: 1,
    });

    expect(compiled).toEqual([IDENTITY_TREE, JOB_TREE, BOOKING_TREE, MESSAGE_TREE]);
  });

  it('dedupes duplicate block selections while preserving first-seen order', () => {
    const compiled = compileRuntimeConfig({
      preset_id: 'job_default',
      enabled_conversation_blocks: ['identity', 'job', 'identity', 'booking'],
      enabled_policy_blocks: [],
      enabled_knowledge_blocks: [],
      enabled_outcome_blocks: [],
      overrides: {},
      version: 1,
    });

    expect(compiled).toEqual([IDENTITY_TREE, JOB_TREE, BOOKING_TREE]);
  });

  it('throws when a referenced conversation block does not exist', () => {
    expect(() =>
      compileRuntimeConfig({
        preset_id: 'broken',
        enabled_conversation_blocks: ['identity', 'missing_block'],
        enabled_policy_blocks: [],
        enabled_knowledge_blocks: [],
        enabled_outcome_blocks: [],
        overrides: {},
        version: 1,
      })
    ).toThrow(/missing_block/);
  });

  it('throws when a block resolves to a tree id that does not exist in the live library', () => {
    const brokenBlockLibrary: Record<string, ConversationBlockDef> = {
      ...BLOCK_LIBRARY,
      broken_tree_ref: {
        block_id: 'broken_tree_ref',
        kind: 'conversation',
        description: 'Intentional bad fixture for compiler failure tests.',
        tree_refs: ['missing_live_tree'],
      },
    };

    expect(() =>
      compileRuntimeConfig(
        {
          preset_id: 'broken-tree-ref',
          enabled_conversation_blocks: ['broken_tree_ref'],
          enabled_policy_blocks: [],
          enabled_knowledge_blocks: [],
          enabled_outcome_blocks: [],
          overrides: {},
          version: 1,
        },
        brokenBlockLibrary
      )
    ).toThrow(/not found in platform tree library/i);
  });
});

describe('applyOptionalNodes', () => {
  it('marks an allow-listed text node listen-only without rewriting the rest', () => {
    const [qa] = applyOptionalNodes(
      [
        {
          tree_id: 'qa',
          description: 'questions',
          nodes: [{ node_id: 'qa_summary', type: 'text', ask: 'what they asked' }],
        },
      ],
      ['qa_summary']
    );
    const node = qa.nodes[0];
    expect(node.type).toBe('text');
    if (node.type === 'text') expect(node.listen).toBe(true);
  });
});
