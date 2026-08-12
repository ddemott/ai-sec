import { describe, expect, it } from 'vitest';

import {
  defaultChecklistPresetIdForBusinessType,
  deriveChecklistRuntimeConfig,
  resolveChecklistPresetId,
} from './checklistPresetDerivation';

describe('deriveChecklistRuntimeConfig', () => {
  it('maps salon business type to the salon front-desk preset', () => {
    const runtime = deriveChecklistRuntimeConfig('salon');

    expect(runtime).toEqual({
      preset_id: 'salon_front_desk',
      enabled_conversation_blocks: ['identity', 'booking', 'message', 'qa', 'schedule_change'],
      enabled_policy_blocks: [],
      enabled_knowledge_blocks: [],
      enabled_outcome_blocks: [],
      overrides: {},
      version: 1,
    });
  });

  it('maps auto-shop business type to the auto-shop front-desk preset', () => {
    const runtime = deriveChecklistRuntimeConfig('auto-shop');

    expect(runtime.preset_id).toBe('auto_shop_front_desk');
    expect(runtime.enabled_conversation_blocks).toEqual([
      'identity',
      'booking',
      'message',
      'qa',
      'schedule_change',
    ]);
  });

  it('normalizes case, spaces, and underscores before mapping auto-shop variants', () => {
    expect(deriveChecklistRuntimeConfig('AUTO SHOP').preset_id).toBe('auto_shop_front_desk');
    expect(deriveChecklistRuntimeConfig('auto_shop').preset_id).toBe('auto_shop_front_desk');
    expect(deriveChecklistRuntimeConfig('  Auto   Shop  ').preset_id).toBe('auto_shop_front_desk');
  });

  it('maps unmatched business types to the local-service fallback preset', () => {
    const runtime = deriveChecklistRuntimeConfig('plumber');

    expect(runtime.preset_id).toBe('local_service_front_desk');
    expect(runtime.enabled_conversation_blocks).toEqual([
      'identity',
      'booking',
      'message',
      'generic_subject',
      'qa',
      'buy_service',
      'schedule_change',
    ]);
  });

  it('treats nullish and blank business types as the local-service fallback preset', () => {
    expect(deriveChecklistRuntimeConfig(null).preset_id).toBe('local_service_front_desk');
    expect(deriveChecklistRuntimeConfig('   ').preset_id).toBe('local_service_front_desk');
  });

  it('prefers an explicit preset override over the derived business-type preset', () => {
    expect(deriveChecklistRuntimeConfig('salon', 'local_service_front_desk').preset_id).toBe(
      'local_service_front_desk'
    );
  });

  it('falls back to derived preset when explicit preset is invalid', () => {
    expect(deriveChecklistRuntimeConfig('salon', 'bogus').preset_id).toBe('salon_front_desk');
  });
});

describe('defaultChecklistPresetIdForBusinessType', () => {
  it('normalizes business-type variants before mapping', () => {
    expect(defaultChecklistPresetIdForBusinessType('AUTO SHOP')).toBe('auto_shop_front_desk');
  });
});

describe('resolveChecklistPresetId', () => {
  it('returns explicit preset when valid', () => {
    expect(resolveChecklistPresetId('salon', 'local_service_front_desk')).toBe(
      'local_service_front_desk'
    );
  });

  it('falls back to derived preset when explicit preset missing', () => {
    expect(resolveChecklistPresetId('salon', null)).toBe('salon_front_desk');
  });
});
