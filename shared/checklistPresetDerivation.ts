import { applyChecklistOverrides, type ChecklistOverrides } from './checklistOverrides';

/**
 * Tenant-facing runtime snapshot derived from business_type / checklist_preset_id.
 * Block lists must stay aligned with `agent/src/checklist/presets.ts` — that file
 * is the product catalog (descriptions, forbidden_trees, defaults). This module
 * only materializes the wire shape the backend already ships.
 */
export interface DerivedChecklistRuntimeConfig {
  preset_id: string;
  enabled_conversation_blocks: string[];
  enabled_policy_blocks: string[];
  enabled_knowledge_blocks: string[];
  enabled_outcome_blocks: string[];
  overrides: Record<string, unknown>;
  version: 1;
}

/**
 * Every shipped preset id, as a RUNTIME value and not only a type.
 *
 * The type alone could not be checked against anything outside TypeScript, and
 * the thing it most needed checking against is SQL: `tenants.checklist_preset_id`
 * carries a CHECK constraint enumerating these ids, and it silently fell a
 * preset behind — `owner_for_hire_front_desk` shipped in code on 2026-08-13 and
 * the constraint still listed only the original three, so the ops script that
 * pins it aborts with a constraint violation against prod. A list that exists
 * only as a union type is a list no test can read.
 */
export const CHECKLIST_PRESET_IDS = [
  'auto_shop_front_desk',
  'salon_front_desk',
  'local_service_front_desk',
  'owner_for_hire_front_desk',
  'law_firm_front_desk',
] as const;

export type ChecklistPresetId = (typeof CHECKLIST_PRESET_IDS)[number];

const AUTO_SHOP_RUNTIME: DerivedChecklistRuntimeConfig = {
  preset_id: 'auto_shop_front_desk',
  enabled_conversation_blocks: ['identity', 'booking', 'message', 'qa', 'schedule_change'],
  enabled_policy_blocks: [],
  enabled_knowledge_blocks: [],
  enabled_outcome_blocks: [],
  overrides: {},
  version: 1,
};

const SALON_RUNTIME: DerivedChecklistRuntimeConfig = {
  preset_id: 'salon_front_desk',
  enabled_conversation_blocks: ['identity', 'booking', 'message', 'qa', 'schedule_change'],
  enabled_policy_blocks: [],
  enabled_knowledge_blocks: [],
  enabled_outcome_blocks: [],
  overrides: {},
  version: 1,
};

const LOCAL_SERVICE_RUNTIME: DerivedChecklistRuntimeConfig = {
  preset_id: 'local_service_front_desk',
  enabled_conversation_blocks: [
    'identity',
    'booking',
    'message',
    'generic_subject',
    'qa',
    'buy_service',
    'schedule_change',
  ],
  enabled_policy_blocks: [],
  enabled_knowledge_blocks: [],
  enabled_outcome_blocks: [],
  overrides: {},
  version: 1,
};

// Mirrors OWNER_FOR_HIRE_PRESET in agent/src/checklist/presets.ts — see that
// file for why `job` is enabled here and forbidden on the shop/salon presets.
const OWNER_FOR_HIRE_RUNTIME: DerivedChecklistRuntimeConfig = {
  preset_id: 'owner_for_hire_front_desk',
  enabled_conversation_blocks: [
    'identity',
    'booking',
    'message',
    'generic_subject',
    'qa',
    'job',
    'buy_service',
    'schedule_change',
  ],
  enabled_policy_blocks: [],
  enabled_knowledge_blocks: [],
  enabled_outcome_blocks: [],
  overrides: {},
  version: 1,
};

// Mirrors LAW_FIRM_PRESET in agent/src/checklist/presets.ts. `case_intake` is
// the reason this preset exists: it is the only one whose primary intake ends
// in a human take-or-decline decision rather than a booking, so the tree must
// be enabled here or a law-firm tenant cannot capture a matter at all.
const LAW_FIRM_RUNTIME: DerivedChecklistRuntimeConfig = {
  preset_id: 'law_firm_front_desk',
  enabled_conversation_blocks: [
    'identity',
    'booking',
    'message',
    'generic_subject',
    'qa',
    'case_intake',
    'schedule_change',
  ],
  enabled_policy_blocks: [],
  enabled_knowledge_blocks: [],
  enabled_outcome_blocks: [],
  overrides: {},
  version: 1,
};

function normalizeBusinessType(businessType: string | null | undefined): string {
  return (businessType ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function normalizeChecklistPresetId(presetId: string | null | undefined): ChecklistPresetId | null {
  const normalized = (presetId ?? '').trim().toLowerCase();
  // Driven off CHECKLIST_PRESET_IDS rather than a hand-maintained if-ladder: the
  // ladder is where a new preset gets forgotten, and a forgotten id here does not
  // error — it returns null and falls back to the business_type default, which is
  // exactly the silent no-op that made the job-tree outage invisible.
  return (CHECKLIST_PRESET_IDS as readonly string[]).includes(normalized)
    ? (normalized as ChecklistPresetId)
    : null;
}

export function defaultChecklistPresetIdForBusinessType(
  businessType: string | null | undefined
): ChecklistPresetId {
  const normalized = normalizeBusinessType(businessType);
  if (normalized === 'salon') return 'salon_front_desk';
  if (normalized === 'auto-shop') return 'auto_shop_front_desk';
  // 'answering-service' is Thinking Hammer's own business_type and it fell
  // through to local_service — the preset with no `job` tree — which is how two
  // recruiter calls on a line advertising the owner for hire produced zero
  // job_inquiries rows (2026-08-13, CALL1.md/CALL2.md). A business whose
  // business_type says it answers the phone FOR the owner is the owner-for-hire
  // vertical; the default now says so instead of leaving it to a preset id
  // nobody had set.
  // A law firm routed to local_service would get no case_intake tree — the same
  // shape of outage as the job tree in 2026-08-13, and worse in consequence: a
  // prospective client's matter would be taken as a plain message with none of
  // the facts (statute date, jurisdiction, existing counsel, opposing names)
  // that decide whether the firm can act. Every spelling an owner might type.
  if (
    normalized === 'law-firm' ||
    normalized === 'law-office' ||
    normalized === 'lawyer' ||
    normalized === 'attorney' ||
    normalized === 'legal' ||
    normalized === 'legal-services'
  ) {
    return 'law_firm_front_desk';
  }
  if (normalized === 'owner-for-hire' || normalized === 'answering-service') {
    return 'owner_for_hire_front_desk';
  }
  return 'local_service_front_desk';
}

/**
 * The VERTICAL a business_type belongs to — the key question_tree_templates is
 * partitioned by, and therefore what provisioning copies from.
 *
 * Derived from the preset rather than kept as a second mapping: a business_type
 * that resolves to the law-firm preset must get the law-firm questions, and two
 * independent lookups would eventually disagree about which. One source, one
 * answer.
 */
export function verticalForBusinessType(businessType: string | null | undefined): string {
  const presetId = defaultChecklistPresetIdForBusinessType(businessType);
  if (presetId === 'auto_shop_front_desk') return 'auto_shop';
  if (presetId === 'salon_front_desk') return 'salon';
  if (presetId === 'owner_for_hire_front_desk') return 'owner_for_hire';
  if (presetId === 'law_firm_front_desk') return 'law_firm';
  return 'local_service';
}

export function resolveChecklistPresetId(
  businessType: string | null | undefined,
  presetId: string | null | undefined
): ChecklistPresetId {
  return (
    normalizeChecklistPresetId(presetId) ?? defaultChecklistPresetIdForBusinessType(businessType)
  );
}

export function deriveChecklistRuntimeConfig(
  businessType: string | null | undefined,
  presetId?: string | null,
  overrides?: ChecklistOverrides | null
): DerivedChecklistRuntimeConfig {
  const resolvedPresetId = resolveChecklistPresetId(businessType, presetId);
  const base =
    resolvedPresetId === 'salon_front_desk'
      ? SALON_RUNTIME
      : resolvedPresetId === 'auto_shop_front_desk'
        ? AUTO_SHOP_RUNTIME
        : resolvedPresetId === 'owner_for_hire_front_desk'
          ? OWNER_FOR_HIRE_RUNTIME
          : resolvedPresetId === 'law_firm_front_desk'
            ? LAW_FIRM_RUNTIME
            : LOCAL_SERVICE_RUNTIME;
  const applied = applyChecklistOverrides(base, overrides);
  return applied.ok ? applied.config : { ...base };
}
