import type { ConversationBlockDef } from './blockTypes.js';
import { VERTICAL_INTAKE_BLOCKS } from './verticalIntakeTrees.js';

/**
 * THE BLOCK CONTRACT — what a section of a call must declare to be swappable.
 *
 * A block is the unit onboarding turns on and off. For that to be safe for
 * someone who cannot read the code, every block states not only what it ASKS
 * (`tree_refs`) but where its answers COME TO REST (`sink`) and who it cannot
 * share a call with (`conflicts_with`). Both are enforced by
 * `blockContract.test.ts`; `sink` in particular is checked against the action
 * tools the block's trees actually contain, so a declaration cannot drift away
 * from the tree it describes.
 *
 * `description` is PROMPT-VISIBLE — the purpose selector reads it — so it is
 * contract, not documentation. Intent boundaries belong in it.
 */
export const BLOCK_LIBRARY: Record<string, ConversationBlockDef> = {
  identity: {
    block_id: 'identity',
    kind: 'conversation',
    description: 'Caller identity and callback capture.',
    tree_refs: ['identity'],
    // The only legitimate 'none'. Identity is spine: it writes nothing of its
    // own and its answers are backfilled into every other block's capture.
    sink: 'none',
  },
  booking: {
    block_id: 'booking',
    kind: 'conversation',
    description: 'Meeting and booking flow.',
    tree_refs: ['booking'],
    sink: 'appointment',
  },
  message: {
    block_id: 'message',
    kind: 'conversation',
    description: 'Owner message capture flow.',
    tree_refs: ['message'],
    sink: 'message',
  },
  generic_subject: {
    block_id: 'generic_subject',
    kind: 'conversation',
    description: 'Fallback subject details for topics without a specific tree.',
    tree_refs: ['generic_subject'],
    pairs_with: ['booking', 'message'],
    sink: 'composed',
  },
  qa: {
    block_id: 'qa',
    kind: 'conversation',
    description: 'Knowledge-base question answering flow.',
    tree_refs: ['qa'],
    // Composed, and the partner is chosen at RUNTIME: when the knowledge base
    // cannot answer, `answer_question` selects message + identity in host code
    // so the goodbye gate holds the door until a message actually lands. Before
    // that fix a caller's question died with her name discarded and no number
    // taken — the block looked complete and stored nothing.
    pairs_with: ['message'],
    sink: 'composed',
  },
  job: {
    block_id: 'job',
    kind: 'conversation',
    description: 'Structured job inquiry intake.',
    tree_refs: ['job'],
    pairs_with: ['identity', 'booking', 'message'],
    conflicts_with: ['buy_service'],
    sink: 'intake_submission',
  },
  buy_service: {
    block_id: 'buy_service',
    kind: 'conversation',
    description: 'Inbound sales/demo qualification for buying the AI receptionist.',
    tree_refs: ['buy_service'],
    pairs_with: ['identity', 'booking', 'message'],
    conflicts_with: ['job'],
    // Composed: this block has no capture tool of its own — a qualified buyer
    // ends in a booked demo or a message to the owner. See the note in
    // blockContract.test.ts about what 'composed' does NOT yet prove.
    sink: 'composed',
  },
  schedule_change: {
    block_id: 'schedule_change',
    kind: 'conversation',
    description: 'Cancel or reschedule an existing appointment.',
    tree_refs: ['schedule_change'],
    requires: ['identity'],
    sink: 'appointment',
  },
  fix_computer: {
    block_id: 'fix_computer',
    kind: 'conversation',
    description: 'Computer-repair service intake that composes with booking.',
    tree_refs: ['fix_computer'],
    pairs_with: ['identity', 'booking'],
    sink: 'composed',
  },
  case_intake: {
    block_id: 'case_intake',
    kind: 'conversation',
    description:
      'Legal matter intake for a prospective client, captured for attorney take-or-decline review.',
    tree_refs: ['case_intake'],
    pairs_with: ['identity', 'booking', 'message'],
    sink: 'intake_submission',
  },
  // The 30 per-vertical intake blocks (composed sink; answers ride into the
  // booking or message named in pairs_with). Defined in verticalIntakeTrees.ts.
  ...VERTICAL_INTAKE_BLOCKS,
};
