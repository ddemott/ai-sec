import type { ConversationBlockDef } from './blockTypes.js';

export const BLOCK_LIBRARY: Record<string, ConversationBlockDef> = {
  identity: {
    block_id: 'identity',
    kind: 'conversation',
    description: 'Caller identity and callback capture.',
    tree_refs: ['identity'],
  },
  booking: {
    block_id: 'booking',
    kind: 'conversation',
    description: 'Meeting and booking flow.',
    tree_refs: ['booking'],
  },
  message: {
    block_id: 'message',
    kind: 'conversation',
    description: 'Owner message capture flow.',
    tree_refs: ['message'],
  },
  job: {
    block_id: 'job',
    kind: 'conversation',
    description: 'Structured job inquiry intake.',
    tree_refs: ['job'],
    pairs_with: ['identity', 'booking', 'message'],
  },
  broken_tree_ref: {
    block_id: 'broken_tree_ref',
    kind: 'conversation',
    description: 'Intentional bad fixture for compiler failure tests.',
    tree_refs: ['missing_live_tree'],
  },
};
