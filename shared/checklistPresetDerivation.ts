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

export type ChecklistPresetId =
  | 'auto_shop_front_desk'
  | 'salon_front_desk'
  | 'local_service_front_desk'
  | 'owner_for_hire_front_desk';

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

function normalizeBusinessType(businessType: string | null | undefined): string {
  return (businessType ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function normalizeChecklistPresetId(presetId: string | null | undefined): ChecklistPresetId | null {
  const normalized = (presetId ?? '').trim().toLowerCase();
  if (normalized === 'auto_shop_front_desk') return 'auto_shop_front_desk';
  if (normalized === 'salon_front_desk') return 'salon_front_desk';
  if (normalized === 'local_service_front_desk') return 'local_service_front_desk';
  if (normalized === 'owner_for_hire_front_desk') return 'owner_for_hire_front_desk';
  return null;
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
  if (normalized === 'owner-for-hire' || normalized === 'answering-service') {
    return 'owner_for_hire_front_desk';
  }
  return 'local_service_front_desk';
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
          : LOCAL_SERVICE_RUNTIME;
  const applied = applyChecklistOverrides(base, overrides);
  return applied.ok ? applied.config : { ...base };
}
