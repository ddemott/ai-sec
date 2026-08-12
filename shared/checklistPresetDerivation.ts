export interface DerivedChecklistRuntimeConfig {
  preset_id: string;
  enabled_conversation_blocks: string[];
  enabled_policy_blocks: string[];
  enabled_knowledge_blocks: string[];
  enabled_outcome_blocks: string[];
  overrides: Record<string, never>;
  version: 1;
}

export type ChecklistPresetId =
  | 'auto_shop_front_desk'
  | 'salon_front_desk'
  | 'local_service_front_desk';

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
  return null;
}

export function defaultChecklistPresetIdForBusinessType(
  businessType: string | null | undefined
): ChecklistPresetId {
  const normalized = normalizeBusinessType(businessType);
  if (normalized === 'salon') return 'salon_front_desk';
  if (normalized === 'auto-shop') return 'auto_shop_front_desk';
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
  presetId?: string | null
): DerivedChecklistRuntimeConfig {
  const resolvedPresetId = resolveChecklistPresetId(businessType, presetId);

  if (resolvedPresetId === 'salon_front_desk') return SALON_RUNTIME;
  if (resolvedPresetId === 'auto_shop_front_desk') return AUTO_SHOP_RUNTIME;
  return LOCAL_SERVICE_RUNTIME;
}
