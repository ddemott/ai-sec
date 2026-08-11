import type { TenantRuntimeConfig, VerticalPresetDef } from './blockTypes.js';

export function materializeRuntimeConfig(
  preset: VerticalPresetDef,
  overrides: Record<string, unknown> = {},
  version = 1
): TenantRuntimeConfig {
  return {
    preset_id: preset.preset_id,
    enabled_conversation_blocks: [...preset.conversation_blocks],
    enabled_policy_blocks: [...preset.policy_blocks],
    enabled_knowledge_blocks: [...preset.knowledge_blocks],
    enabled_outcome_blocks: [...preset.outcome_blocks],
    overrides,
    version,
  };
}
