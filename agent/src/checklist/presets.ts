import type { VerticalPresetDef } from './blockTypes.js';

export const AUTO_SHOP_PRESET: VerticalPresetDef = {
  preset_id: 'auto_shop_front_desk',
  vertical: 'auto_shop',
  description:
    'Starter preset for auto shops: answer questions, book work, take messages, and handle schedule changes.',
  conversation_blocks: ['identity', 'booking', 'message', 'qa', 'schedule_change'],
  policy_blocks: [],
  knowledge_blocks: [],
  outcome_blocks: [],
  // job = recruiter intake (wrong vertical). buy_service = selling THIS product
  // (not a shop service). Unique shop trees wait for a real tenant that needs them.
  forbidden_trees: ['job', 'buy_service'],
  defaults: {
    booking_mode: 'offer_once',
    primary_intake: 'booking',
  },
};

export const SALON_PRESET: VerticalPresetDef = {
  preset_id: 'salon_front_desk',
  vertical: 'salon',
  description:
    'Starter preset for salons: answer questions, book appointments, take messages, and handle schedule changes.',
  conversation_blocks: ['identity', 'booking', 'message', 'qa', 'schedule_change'],
  policy_blocks: [],
  knowledge_blocks: [],
  outcome_blocks: [],
  // Same front-desk set as auto shop on purpose: both book / message / answer /
  // move appointments. Salon-only intake is not invented until a salon asks.
  forbidden_trees: ['job', 'buy_service'],
  defaults: {
    booking_mode: 'offer_once',
    primary_intake: 'booking',
  },
};

export const LOCAL_SERVICE_PRESET: VerticalPresetDef = {
  preset_id: 'local_service_front_desk',
  vertical: 'local_service',
  description:
    'Starter preset for general local services: book time, take messages, answer questions, qualify inbound buyers, and catch uncategorized subjects.',
  conversation_blocks: [
    'identity',
    'booking',
    'message',
    'generic_subject',
    'qa',
    'buy_service',
    'schedule_change',
  ],
  policy_blocks: [],
  knowledge_blocks: [],
  outcome_blocks: [],
  forbidden_trees: ['job'],
  defaults: {
    booking_mode: 'offer_once',
    primary_intake: 'mixed',
  },
};

export const PRESET_LIBRARY: VerticalPresetDef[] = [
  AUTO_SHOP_PRESET,
  SALON_PRESET,
  LOCAL_SERVICE_PRESET,
];

const PRESET_BY_ID = new Map(PRESET_LIBRARY.map((preset) => [preset.preset_id, preset]));

export function getPresetById(presetId: string): VerticalPresetDef | undefined {
  return PRESET_BY_ID.get(presetId);
}
