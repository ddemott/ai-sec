import { describe, expect, it } from 'vitest';
import { runtimeForTenant, conversationBlockLabel } from './checklistPresets';

describe('runtimeForTenant', () => {
  it('uses the server snapshot when present', () => {
    expect(
      runtimeForTenant({
        business_type: 'salon',
        checklist_runtime_config: {
          preset_id: 'salon_front_desk',
          enabled_conversation_blocks: ['identity', 'booking'],
        },
      }).preset_id
    ).toBe('salon_front_desk');
  });

  it('derives from business type when the snapshot is missing', () => {
    expect(runtimeForTenant({ business_type: 'auto-shop' }).preset_id).toBe('auto_shop_front_desk');
  });
});

describe('conversationBlockLabel', () => {
  it('falls back to a readable id when the block is unknown', () => {
    expect(conversationBlockLabel('brand_new_block')).toBe('brand new block');
  });
});
