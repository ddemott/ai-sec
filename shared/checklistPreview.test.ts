import { describe, expect, it } from 'vitest';
import { previewChecklistCall } from './checklistPreview';

describe('previewChecklistCall', () => {
  it('marks optional as listen and required as required on the same draft', () => {
    const preview = previewChecklistCall({
      businessType: 'local_service',
      overrides: {
        optional_node_ids: ['qa_summary'],
        required_node_ids: ['caller_phone'],
        wording: { demo_offer: 'Want a walkthrough this week?' },
      },
    });
    const phone = preview.fields.find((f) => f.node_id === 'caller_phone');
    const summary = preview.fields.find((f) => f.node_id === 'qa_summary');
    const demo = preview.fields.find((f) => f.node_id === 'demo_offer');
    expect(phone?.role).toBe('required');
    expect(summary?.role).toBe('listen');
    expect(demo?.ask).toBe('Want a walkthrough this week?');
    expect(preview.enabled_blocks).toContain('buy_service');
  });

  it('drops booking from the preview when booking_mode is never', () => {
    const preview = previewChecklistCall({
      businessType: 'salon',
      overrides: { booking_mode: 'never' },
    });
    expect(preview.enabled_blocks).not.toContain('booking');
    expect(preview.disabled_blocks).toContain('booking');
    expect(preview.booking_mode).toBe('never');
  });
});
