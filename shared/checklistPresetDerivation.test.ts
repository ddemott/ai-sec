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

/**
 * THE 2026-08-13 REGRESSION (calls SCL_3a8SkDKzxN4B + SCL_KLvqZ2JkaQFU).
 *
 * Thinking Hammer runs business_type 'answering-service' with checklist_preset_id
 * NULL. That fell through to local_service_front_desk, whose block list has no
 * `job` — and since ChecklistOverrides can only SUBTRACT blocks, no setting could
 * put it back. Two recruiter calls to a line whose greeting says "Dale is
 * available for hire" wrote zero job_inquiries rows. On the first, the model
 * asked for the tree by name and the host answered `No tree called "job"`.
 *
 * WHO: any owner-for-hire tenant. WHAT: the job tree must be in the derived
 * block list. WHEN: every call, from tenant-config. WHERE:
 * deriveChecklistRuntimeConfig, the single thing the agent compiles its tree set
 * from. WHY: a tree the model cannot select is a capability the product believes
 * it has and does not.
 */
describe('owner-for-hire vertical (2026-08-13 job-tree regression)', () => {
  it('routes answering-service tenants with no explicit preset to owner_for_hire', () => {
    expect(defaultChecklistPresetIdForBusinessType('answering-service')).toBe(
      'owner_for_hire_front_desk'
    );
    expect(deriveChecklistRuntimeConfig('answering-service', null).preset_id).toBe(
      'owner_for_hire_front_desk'
    );
  });

  it('gives that tenant a selectable job tree', () => {
    const config = deriveChecklistRuntimeConfig('answering-service', null);
    expect(config.enabled_conversation_blocks).toContain('job');
  });

  it('accepts owner_for_hire_front_desk as an explicit preset id', () => {
    expect(resolveChecklistPresetId('salon', 'owner_for_hire_front_desk')).toBe(
      'owner_for_hire_front_desk'
    );
  });

  it('keeps job out of the shop and salon front desks (wrong vertical, unchanged)', () => {
    expect(deriveChecklistRuntimeConfig('salon', null).enabled_conversation_blocks).not.toContain(
      'job'
    );
    expect(
      deriveChecklistRuntimeConfig('auto-shop', null).enabled_conversation_blocks
    ).not.toContain('job');
  });

  it('SAD: overrides still cannot ADD a tree the preset withholds', () => {
    // The shape of the original bug: disabling is expressible, enabling is not.
    // If this ever starts passing, the override contract changed and the preset
    // is no longer the authority on what a tenant can select.
    const config = deriveChecklistRuntimeConfig('salon', null, {
      enabled_conversation_blocks: ['job'],
    } as never);
    expect(config.enabled_conversation_blocks).not.toContain('job');
  });
});
