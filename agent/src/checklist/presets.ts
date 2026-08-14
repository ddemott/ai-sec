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

/**
 * The owner IS the product: an independent professional whose line fields
 * inbound work offers as its primary traffic.
 *
 * WHY THIS PRESET EXISTS (2026-08-13, calls SCL_3a8SkDKzxN4B + SCL_KLvqZ2JkaQFU):
 * `job` was listed in `forbidden_trees` on all three presets, and
 * `ChecklistOverrides` can only SUBTRACT blocks (`disabled_conversation_blocks`)
 * — never add. So no configuration of any tenant could select the job tree.
 * Two recruiter calls reached a line whose greeting says "Dale is available for
 * hire"; on the first the model correctly declared
 * `work_direction: caller_offers_owner_work` and re-issued `set_purpose` to add
 * `job` 16ms later, and the host bounced it with `No tree called "job"`.
 * `capture_job_inquiry` never entered the toolset, the goodbye gate never saw
 * the tree, and `job_inquiries` took zero rows on two calls that were entirely
 * about a job. The model was right and the catalog was wrong.
 *
 * `buy_service` stays enabled alongside `job` deliberately. This vertical gets
 * both — someone offering the owner a contract, and someone buying the AI
 * receptionist — and dropping it would REMOVE a lane these tenants have today
 * via local_service. That pair is the one confusable axis in the library, and
 * `runSetPurpose`'s work-direction gate is the mitigation built for exactly it:
 * the model must declare who pays whom, and host code checks the declaration
 * against the selection. A preset that ducks the pair would be avoiding the
 * case the gate was written for.
 *
 * `fix_computer` stays forbidden: it is the other tree no preset can reach, but
 * no call has yet asked for it. It ships when one pays for it.
 */
export const OWNER_FOR_HIRE_PRESET: VerticalPresetDef = {
  preset_id: 'owner_for_hire_front_desk',
  vertical: 'owner_for_hire',
  description:
    'Preset for solo professionals and consultancies whose line takes work offers: capture inbound roles and contracts, book time with the owner, take messages, answer questions, and qualify buyers.',
  conversation_blocks: [
    'identity',
    'booking',
    'message',
    'generic_subject',
    'qa',
    'job',
    'buy_service',
    'schedule_change',
  ],
  policy_blocks: [],
  knowledge_blocks: [],
  outcome_blocks: [],
  forbidden_trees: ['fix_computer'],
  defaults: {
    booking_mode: 'offer_once',
    primary_intake: 'mixed',
  },
};

export const PRESET_LIBRARY: VerticalPresetDef[] = [
  AUTO_SHOP_PRESET,
  SALON_PRESET,
  LOCAL_SERVICE_PRESET,
  OWNER_FOR_HIRE_PRESET,
];

const PRESET_BY_ID = new Map(PRESET_LIBRARY.map((preset) => [preset.preset_id, preset]));

export function getPresetById(presetId: string): VerticalPresetDef | undefined {
  return PRESET_BY_ID.get(presetId);
}
