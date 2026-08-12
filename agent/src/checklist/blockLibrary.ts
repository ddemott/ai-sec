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
  generic_subject: {
    block_id: 'generic_subject',
    kind: 'conversation',
    description: 'Fallback subject details for topics without a specific tree.',
    tree_refs: ['generic_subject'],
    pairs_with: ['booking', 'message'],
  },
  qa: {
    block_id: 'qa',
    kind: 'conversation',
    description: 'Knowledge-base question answering flow.',
    tree_refs: ['qa'],
  },
  job: {
    block_id: 'job',
    kind: 'conversation',
    description: 'Structured job inquiry intake.',
    tree_refs: ['job'],
    pairs_with: ['identity', 'booking', 'message'],
  },
  buy_service: {
    block_id: 'buy_service',
    kind: 'conversation',
    description: 'Inbound sales/demo qualification for buying the AI receptionist.',
    tree_refs: ['buy_service'],
    pairs_with: ['identity', 'booking', 'message'],
  },
  schedule_change: {
    block_id: 'schedule_change',
    kind: 'conversation',
    description: 'Cancel or reschedule an existing appointment.',
    tree_refs: ['schedule_change'],
    requires: ['identity'],
  },
  fix_computer: {
    block_id: 'fix_computer',
    kind: 'conversation',
    description: 'Computer-repair service intake that composes with booking.',
    tree_refs: ['fix_computer'],
    pairs_with: ['identity', 'booking'],
  },
};
