import { describe, expect, it } from 'vitest';
import {
  conversationBlockSchema,
  knowledgeBlockSchema,
  outcomeBlockSchema,
  policyBlockSchema,
  tenantRuntimeConfigSchema,
  verticalPresetSchema,
} from './blockSchemas.js';

describe('vertical preset block schemas', () => {
  it('accepts a minimal conversation block', () => {
    const parsed = conversationBlockSchema.parse({
      block_id: 'job',
      kind: 'conversation',
      description: 'Collects structured job information.',
      tree_refs: ['job'],
    });
    expect(parsed.block_id).toBe('job');
    expect(parsed.tree_refs).toEqual(['job']);
  });

  it('rejects a conversation block with the wrong kind', () => {
    const result = conversationBlockSchema.safeParse({
      block_id: 'job',
      kind: 'policy',
      description: 'nope',
      tree_refs: ['job'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a policy block with typed settings', () => {
    const parsed = policyBlockSchema.parse({
      block_id: 'booking_mode',
      kind: 'policy',
      description: 'Controls whether booking is offered or required.',
      policy_type: 'booking_mode',
      settings: { mode: 'offer_once' },
    });
    expect(parsed.policy_type).toBe('booking_mode');
  });

  it('accepts a knowledge block', () => {
    const parsed = knowledgeBlockSchema.parse({
      block_id: 'hours',
      kind: 'knowledge',
      description: 'Business hours facts.',
      knowledge_keys: ['hours'],
    });
    expect(parsed.knowledge_keys).toEqual(['hours']);
  });

  it('accepts an outcome block', () => {
    const parsed = outcomeBlockSchema.parse({
      block_id: 'job_inquiry_projection',
      kind: 'outcome',
      description: 'Projects a generic intake submission into job_inquiries.',
      outcome_type: 'project_submission',
      projector: 'jobInquiryProjector',
      settings: { target: 'job_inquiries' },
    });
    expect(parsed.projector).toBe('jobInquiryProjector');
  });

  it('accepts a minimal vertical preset', () => {
    const parsed = verticalPresetSchema.parse({
      preset_id: 'autoshop_default',
      vertical: 'autoshop',
      description: 'Starter preset for auto shops.',
      conversation_blocks: ['identity', 'booking'],
      policy_blocks: ['booking_mode'],
      knowledge_blocks: ['hours'],
      outcome_blocks: ['create_booking'],
      forbidden_trees: ['job'],
      defaults: { booking_mode: 'offer_once' },
    });
    expect(parsed.preset_id).toBe('autoshop_default');
  });

  it('rejects a preset missing conversation_blocks', () => {
    const result = verticalPresetSchema.safeParse({
      preset_id: 'broken',
      vertical: 'autoshop',
      description: 'Broken preset',
      policy_blocks: [],
      knowledge_blocks: [],
      outcome_blocks: [],
      forbidden_trees: [],
      defaults: {},
    });
    expect(result.success).toBe(false);
  });

  it('accepts a tenant runtime config', () => {
    const parsed = tenantRuntimeConfigSchema.parse({
      preset_id: 'autoshop_default',
      enabled_conversation_blocks: ['identity', 'booking'],
      enabled_policy_blocks: ['booking_mode'],
      enabled_knowledge_blocks: ['hours'],
      enabled_outcome_blocks: ['create_booking'],
      overrides: { booking_mode: 'offer_once' },
      version: 1,
    });
    expect(parsed.version).toBe(1);
  });

  it('rejects a runtime config with a non-positive version', () => {
    const result = tenantRuntimeConfigSchema.safeParse({
      preset_id: 'autoshop_default',
      enabled_conversation_blocks: ['identity'],
      enabled_policy_blocks: [],
      enabled_knowledge_blocks: [],
      enabled_outcome_blocks: [],
      overrides: {},
      version: 0,
    });
    expect(result.success).toBe(false);
  });
});
