import { describe, expect, it } from 'vitest';
import { applyChecklistOverrides } from './checklistOverrides';
import { deriveChecklistRuntimeConfig } from './checklistPresetDerivation';

const salon = deriveChecklistRuntimeConfig('salon');

describe('applyChecklistOverrides', () => {
  it('disables an optional block and records the override', () => {
    const result = applyChecklistOverrides(salon, {
      disabled_conversation_blocks: ['qa'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.enabled_conversation_blocks).not.toContain('qa');
    expect(result.config.enabled_conversation_blocks).toContain('booking');
    expect(result.config.overrides).toEqual({ disabled_conversation_blocks: ['qa'] });
  });

  it('refuses to disable identity', () => {
    const result = applyChecklistOverrides(salon, {
      disabled_conversation_blocks: ['identity'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/identity/);
  });

  it('refuses to disable a block the preset does not have', () => {
    const result = applyChecklistOverrides(salon, {
      disabled_conversation_blocks: ['buy_service'],
    });
    expect(result.ok).toBe(false);
  });

  it('accepts booking_mode never and drops the booking block', () => {
    const result = applyChecklistOverrides(salon, { booking_mode: 'never' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.enabled_conversation_blocks).not.toContain('booking');
    expect(result.config.overrides).toEqual({
      disabled_conversation_blocks: ['booking'],
      booking_mode: 'never',
    });
  });

  it('rejects an unknown optional node', () => {
    const result = applyChecklistOverrides(salon, {
      optional_node_ids: ['caller_name'],
    });
    expect(result.ok).toBe(false);
  });

  it('keeps a supported optional node on the override payload', () => {
    const result = applyChecklistOverrides(salon, {
      optional_node_ids: ['qa_summary'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.overrides).toEqual({ optional_node_ids: ['qa_summary'] });
  });

  it('keeps a supported required node on the override payload', () => {
    const result = applyChecklistOverrides(salon, {
      required_node_ids: ['caller_phone'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.overrides).toEqual({ required_node_ids: ['caller_phone'] });
  });

  it('rejects an unknown required node', () => {
    const result = applyChecklistOverrides(salon, {
      required_node_ids: ['book'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/required/);
  });

  it('rejects the same node as required and optional', () => {
    const result = applyChecklistOverrides(salon, {
      optional_node_ids: ['qa_summary'],
      required_node_ids: ['qa_summary'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/qa_summary/);
  });
});

describe('deriveChecklistRuntimeConfig with overrides', () => {
  it('applies a valid disable list', () => {
    const runtime = deriveChecklistRuntimeConfig('salon', null, {
      disabled_conversation_blocks: ['schedule_change'],
    });
    expect(runtime.enabled_conversation_blocks).not.toContain('schedule_change');
  });

  it('ignores an invalid disable list instead of returning a broken config', () => {
    const runtime = deriveChecklistRuntimeConfig('salon', null, {
      disabled_conversation_blocks: ['identity'],
    });
    expect(runtime.enabled_conversation_blocks).toContain('identity');
    expect(runtime.enabled_conversation_blocks).toContain('booking');
  });
});
