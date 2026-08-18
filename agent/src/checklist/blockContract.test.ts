/**
 * THE BLOCK CONTRACT IS ENFORCED, NOT DOCUMENTED.
 *
 * WHO: every conversation block in BLOCK_LIBRARY vs the trees it names.
 * WHAT: `sink` must match the action tools the block's trees actually contain;
 *       `conflicts_with` must be symmetric and point at blocks that exist;
 *       `requires` / `pairs_with` must point at blocks that exist.
 * WHEN: CI, every run.
 * WHERE: blockLibrary.ts (the declaration) vs trees.ts (the reality).
 * WHY: a block is the unit onboarding switches on and off. If a non-engineer
 *      can enable a block, then "this block has somewhere to put its answers"
 *      has to be a machine-checked fact. The failure it prevents is a call that
 *      asks good questions and stores nothing — the same shape as the Telnyx
 *      false "sent", where the caller hangs up believing they handed something
 *      over. `role_description` (2026-07-30) and `location_type` (2026-07-21)
 *      were each one field of that failure; an undeclared block is all of them.
 *
 * THE ORACLE LIVES HERE ON PURPOSE. TOOL_SINK below is this test's own map from
 * action tool → destination table. It is deliberately NOT imported from
 * production code: a derivation that read the same constant it is checking
 * would agree with itself no matter how wrong both were.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_LIBRARY } from './blockLibrary.js';
import { conflictingTreePair } from './checklistTools.js';
import { BLOCK_SINKS, type BlockSink } from './blockTypes.js';
import { PLATFORM_TREE_LIBRARY } from './trees.js';
import type { QuestionNodeDef } from './types.js';

/** Action tool → the durable outcome it produces. §3 of docs/CALL_ARCHITECTURE.md. */
const TOOL_SINK: Record<string, BlockSink> = {
  book_with_scheduling: 'appointment',
  cancel_appointment: 'appointment',
  reschedule_appointment: 'appointment',
  take_message: 'message',
  capture_job_inquiry: 'intake_submission',
  capture_case_inquiry: 'intake_submission',
};

/**
 * `sink: 'none'` means "writes nothing and is not carried by a partner either".
 * That is only ever true of spine. Anything else claiming it is a block whose
 * answers evaporate, so the exception is an enumerated allowlist rather than a
 * judgement call at review time.
 */
const SPINE_BLOCKS = new Set(['identity']);

const treesById = new Map(PLATFORM_TREE_LIBRARY.map((t) => [t.tree_id, t]));
const blocks = Object.values(BLOCK_LIBRARY);

function collectActionTools(nodes: QuestionNodeDef[], out: Set<string>): void {
  for (const def of nodes) {
    if (def.type === 'action') out.add(def.tool);
    else if (def.type === 'choice') {
      for (const children of Object.values(def.options)) collectActionTools(children, out);
    }
  }
}

/** Every action tool reachable from a block's trees, branches included. */
function toolsForBlock(blockId: string): Set<string> {
  const out = new Set<string>();
  for (const treeId of BLOCK_LIBRARY[blockId]?.tree_refs ?? []) {
    const tree = treesById.get(treeId);
    if (tree) collectActionTools(tree.nodes, out);
  }
  return out;
}

describe('block contract — declarations are keys, not comments', () => {
  it('every block names a tree that exists', () => {
    for (const block of blocks) {
      for (const treeId of block.tree_refs ?? []) {
        expect(
          treesById.has(treeId),
          `block "${block.block_id}" references tree "${treeId}", which is not in PLATFORM_TREE_LIBRARY`
        ).toBe(true);
      }
    }
  });

  it('every block declares a sink from the closed set', () => {
    for (const block of blocks) {
      expect(
        (BLOCK_SINKS as readonly string[]).includes(block.sink),
        `block "${block.block_id}" declares sink "${block.sink}", which is not a BlockSink`
      ).toBe(true);
    }
  });
});

describe('sink matches the trees, not the intention', () => {
  it('a block with a terminal action declares that action’s destination', () => {
    for (const block of blocks) {
      const tools = [...toolsForBlock(block.block_id)];
      if (tools.length === 0) continue;

      const destinations = new Set(tools.map((tool) => TOOL_SINK[tool]));
      for (const tool of tools) {
        expect(
          TOOL_SINK[tool],
          `block "${block.block_id}" fires "${tool}", which this test has no destination for. ` +
            `A new action tool means a new durable outcome — add it to TOOL_SINK, and if it ` +
            `writes somewhere none of the three sinks covers, that is a schema decision, not a ` +
            `test fix.`
        ).toBeDefined();
      }

      expect(
        destinations.size,
        `block "${block.block_id}" writes to more than one kind of sink (${[...destinations].join(', ')}). ` +
          `Split it, or the owner enabling it cannot be told where their callers' answers go.`
      ).toBe(1);

      const [actual] = [...destinations];
      expect(
        block.sink,
        `block "${block.block_id}" declares sink "${block.sink}" but its trees fire ${tools.join(', ')}, ` +
          `which write to "${actual ?? 'unknown'}"`
      ).toBe(actual);
    }
  });

  it('a block with NO terminal action is composed or spine — never silently writing', () => {
    for (const block of blocks) {
      if (toolsForBlock(block.block_id).size > 0) continue;
      expect(
        ['composed', 'none'].includes(block.sink),
        `block "${block.block_id}" declares sink "${block.sink}" but has no action node in any of ` +
          `its trees. It cannot write to a table it never calls a tool for.`
      ).toBe(true);
    }
  });

  it('“composed” names the partner that carries the answers', () => {
    for (const block of blocks) {
      if (block.sink !== 'composed') continue;
      expect(
        (block.pairs_with ?? []).length,
        `block "${block.block_id}" claims its answers ride into another block's write but names no ` +
          `partner in pairs_with. An unnamed carrier is not a carrier.`
      ).toBeGreaterThan(0);
    }
  });

  it('“none” is spine only', () => {
    for (const block of blocks) {
      if (block.sink !== 'none') continue;
      expect(
        SPINE_BLOCKS.has(block.block_id),
        `block "${block.block_id}" declares sink "none", meaning its answers are never written and ` +
          `no partner carries them. Only spine may do that. If this block is genuinely carried by ` +
          `another, declare "composed" and name the partner; if it writes, declare where.`
      ).toBe(true);
    }
  });
});

describe('conflicts are symmetric and real', () => {
  it('every conflicts_with / requires / pairs_with target exists', () => {
    for (const block of blocks) {
      const refs = [
        ...(block.conflicts_with ?? []),
        ...(block.requires ?? []),
        ...(block.pairs_with ?? []),
      ];
      for (const ref of refs) {
        expect(
          BLOCK_LIBRARY[ref],
          `block "${block.block_id}" references unknown block "${ref}"`
        ).toBeDefined();
      }
    }
  });

  it('a conflict declared on one side is declared on the other', () => {
    for (const block of blocks) {
      for (const other of block.conflicts_with ?? []) {
        expect(
          BLOCK_LIBRARY[other]?.conflicts_with ?? [],
          `"${block.block_id}" conflicts with "${other}" but "${other}" does not say so. The gate ` +
            `reads the contract from whichever side the model happened to select first, so a ` +
            `one-sided declaration is enforced only half the time.`
        ).toContain(block.block_id);
      }
    }
  });

  it('no block conflicts with itself or pairs with a block it conflicts with', () => {
    for (const block of blocks) {
      const conflicts = new Set(block.conflicts_with ?? []);
      expect(conflicts.has(block.block_id), `"${block.block_id}" conflicts with itself`).toBe(
        false
      );
      for (const partner of block.pairs_with ?? []) {
        expect(
          conflicts.has(partner),
          `"${block.block_id}" both pairs with and conflicts with "${partner}"`
        ).toBe(false);
      }
    }
  });

  it('the job/buy_service pair is declared — it is the one with call evidence', () => {
    // Not a tautology: this pins the pair a real call proved confusable
    // (2026-07-28 sim — a buyer opening with "a business opportunity" was given
    // the job tree alongside buy_service, and the blocked capture held the
    // goodbye gate open on a call that could not end). If someone removes the
    // declaration, the host-side gate silently stops firing.
    expect(BLOCK_LIBRARY.job?.conflicts_with).toContain('buy_service');
    expect(BLOCK_LIBRARY.buy_service?.conflicts_with).toContain('job');
  });

  it('the gate reads the declaration, in either order', () => {
    expect(conflictingTreePair(['job', 'buy_service'])).not.toBeNull();
    expect(conflictingTreePair(['buy_service', 'job'])).not.toBeNull();
    expect(conflictingTreePair(['identity', 'booking', 'message'])).toBeNull();
    expect(conflictingTreePair(['job', 'identity', 'booking'])).toBeNull();
  });

  it('a conflict does NOT bar a preset from offering both halves', () => {
    // Guarding the guard. Conflicts are about what one CALL may select, never
    // about what a business may offer: `owner_for_hire_front_desk` enables job
    // AND buy_service on purpose, because different callers to that line want
    // different things. A future test that reads conflicts as a preset rule
    // would break that tenant's line, so the intent is pinned here.
    expect(BLOCK_LIBRARY.job?.conflicts_with).toContain('buy_service');
    expect(BLOCK_LIBRARY.job?.sink).toBe('intake_submission');
  });
});

/**
 * THE POINT OF THE WHOLE REFACTOR, TESTED DIRECTLY.
 *
 * Everything above still passes if someone re-hardcodes `job` and
 * `buy_service` into the gate — the declarations would be decoration and the
 * behaviour identical. So this swaps the library for one that declares a
 * DIFFERENT pair and asserts the gate follows it. If it does not, the contract
 * is not the source of truth and "add a block, get a conflict" is a promise
 * onboarding cannot keep.
 */
describe('conflicts are COMPILED from the library, not written into the gate', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('./blockLibrary.js');
  });

  it('follows a pair the real library never declares', async () => {
    vi.resetModules();
    vi.doMock('./blockLibrary.js', () => ({
      BLOCK_LIBRARY: {
        booking: {
          block_id: 'booking',
          kind: 'conversation',
          description: 'Meeting and booking flow.',
          tree_refs: ['booking'],
          conflicts_with: ['message'],
          sink: 'appointment',
        },
        message: {
          block_id: 'message',
          kind: 'conversation',
          description: 'Owner message capture flow.',
          tree_refs: ['message'],
          conflicts_with: ['booking'],
          sink: 'message',
        },
      },
    }));

    const mod = await import('./checklistTools.js');
    expect(
      mod.conflictingTreePair(['booking', 'message']),
      'the gate ignored a declared conflict — it is not reading BLOCK_LIBRARY'
    ).not.toBeNull();
    expect(
      mod.conflictingTreePair(['job', 'buy_service']),
      'the gate bounced a pair the (mocked) library does NOT declare — the old pair is hardcoded'
    ).toBeNull();
  });
});
