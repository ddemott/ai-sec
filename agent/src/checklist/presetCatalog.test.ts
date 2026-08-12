import { describe, expect, it } from 'vitest';
import type { VerticalPresetDef } from './blockTypes.js';
import { compileRuntimeConfig } from './blockCompiler.js';
import { verticalPresetSchema } from './blockSchemas.js';
import {
  AUTO_SHOP_PRESET,
  LOCAL_SERVICE_PRESET,
  PRESET_LIBRARY,
  SALON_PRESET,
  getPresetById,
} from './presets.js';
import { materializeRuntimeConfig } from './runtimeConfig.js';

describe('preset catalog', () => {
  it('contains the first three real vertical presets', () => {
    expect(PRESET_LIBRARY.map((preset) => preset.preset_id)).toEqual([
      'auto_shop_front_desk',
      'salon_front_desk',
      'local_service_front_desk',
    ]);
  });

  it('validates each shipped preset against the canonical schema', () => {
    for (const preset of PRESET_LIBRARY) {
      const typedPreset: VerticalPresetDef = preset;
      expect(verticalPresetSchema.parse(typedPreset)).toEqual(typedPreset);
    }
  });

  it('looks up presets by id', () => {
    expect(getPresetById('auto_shop_front_desk')).toEqual(AUTO_SHOP_PRESET);
    expect(getPresetById('salon_front_desk')).toEqual(SALON_PRESET);
    expect(getPresetById('local_service_front_desk')).toEqual(LOCAL_SERVICE_PRESET);
    expect(getPresetById('missing_preset')).toBeUndefined();
  });

  it('materializes each preset into a runtime config with the same selected blocks', () => {
    const runtime = materializeRuntimeConfig(AUTO_SHOP_PRESET, { booking_mode: 'offer_once' }, 3);

    expect(runtime).toEqual({
      preset_id: 'auto_shop_front_desk',
      enabled_conversation_blocks: AUTO_SHOP_PRESET.conversation_blocks,
      enabled_policy_blocks: AUTO_SHOP_PRESET.policy_blocks,
      enabled_knowledge_blocks: AUTO_SHOP_PRESET.knowledge_blocks,
      enabled_outcome_blocks: AUTO_SHOP_PRESET.outcome_blocks,
      overrides: { booking_mode: 'offer_once' },
      version: 3,
    });
  });

  it('compiles auto shop preset into booking, message, qa, and schedule-change capabilities', () => {
    const runtime = materializeRuntimeConfig(AUTO_SHOP_PRESET);
    expect(compileRuntimeConfig(runtime).map((tree) => tree.tree_id)).toEqual([
      'identity',
      'booking',
      'message',
      'qa',
      'schedule_change',
    ]);
  });

  it('compiles salon preset into booking, message, qa, and schedule-change capabilities', () => {
    const runtime = materializeRuntimeConfig(SALON_PRESET);
    expect(compileRuntimeConfig(runtime).map((tree) => tree.tree_id)).toEqual([
      'identity',
      'booking',
      'message',
      'qa',
      'schedule_change',
    ]);
  });

  it('compiles local service preset into selling, booking, message, qa, generic-subject, and schedule-change capabilities', () => {
    const runtime = materializeRuntimeConfig(LOCAL_SERVICE_PRESET);
    expect(compileRuntimeConfig(runtime).map((tree) => tree.tree_id)).toEqual([
      'identity',
      'booking',
      'message',
      'generic_subject',
      'qa',
      'buy_service',
      'schedule_change',
    ]);
  });
});
