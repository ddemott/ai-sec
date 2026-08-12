import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const stringList = z.array(nonEmptyString);
const looseRecord = z.record(nonEmptyString, z.unknown());

export const conversationBlockSchema = z.object({
  block_id: nonEmptyString,
  kind: z.literal('conversation'),
  description: nonEmptyString,
  selection_hints: stringList.optional(),
  tree_refs: stringList.optional(),
  pairs_with: stringList.optional(),
  requires: stringList.optional(),
  conflicts_with: stringList.optional(),
});

export const policyBlockSchema = z.object({
  block_id: nonEmptyString,
  kind: z.literal('policy'),
  description: nonEmptyString,
  policy_type: nonEmptyString,
  settings: looseRecord,
});

export const knowledgeBlockSchema = z.object({
  block_id: nonEmptyString,
  kind: z.literal('knowledge'),
  description: nonEmptyString,
  knowledge_keys: stringList,
});

export const outcomeBlockSchema = z.object({
  block_id: nonEmptyString,
  kind: z.literal('outcome'),
  description: nonEmptyString,
  outcome_type: nonEmptyString,
  projector: nonEmptyString.optional(),
  settings: looseRecord,
});

export const blockSchema = z.discriminatedUnion('kind', [
  conversationBlockSchema,
  policyBlockSchema,
  knowledgeBlockSchema,
  outcomeBlockSchema,
]);

export const verticalPresetSchema = z.object({
  preset_id: nonEmptyString,
  vertical: nonEmptyString,
  description: nonEmptyString,
  conversation_blocks: stringList.min(1),
  policy_blocks: stringList,
  knowledge_blocks: stringList,
  outcome_blocks: stringList,
  defaults: looseRecord,
});

export const tenantRuntimeConfigSchema = z.object({
  tenant_id: nonEmptyString.optional(),
  preset_id: nonEmptyString,
  enabled_conversation_blocks: stringList.min(1),
  enabled_policy_blocks: stringList,
  enabled_knowledge_blocks: stringList,
  enabled_outcome_blocks: stringList,
  overrides: looseRecord,
  version: z.number().int().positive(),
});

export const intakeSubmissionSchema = z.object({
  submission_id: nonEmptyString,
  tenant_id: nonEmptyString,
  call_id: nonEmptyString.optional(),
  preset_id: nonEmptyString,
  block_ids: stringList.min(1),
  submission_type: nonEmptyString,
  caller_name: nonEmptyString.optional(),
  caller_phone: nonEmptyString.optional(),
  appointment_id: nonEmptyString.optional(),
  payload_json: looseRecord,
  rendered_summary: nonEmptyString.optional(),
  created_at: nonEmptyString,
});

export const projectorResultSchema = z.object({
  success: z.boolean(),
  projected_record_id: nonEmptyString.optional(),
  projected_record_type: nonEmptyString.optional(),
  notifications_sent: stringList.optional(),
  warnings: stringList.optional(),
});

export type ConversationBlockInput = z.infer<typeof conversationBlockSchema>;
export type PolicyBlockInput = z.infer<typeof policyBlockSchema>;
export type KnowledgeBlockInput = z.infer<typeof knowledgeBlockSchema>;
export type OutcomeBlockInput = z.infer<typeof outcomeBlockSchema>;
export type VerticalPresetInput = z.infer<typeof verticalPresetSchema>;
export type TenantRuntimeConfigInput = z.infer<typeof tenantRuntimeConfigSchema>;
export type IntakeSubmissionInput = z.infer<typeof intakeSubmissionSchema>;
export type ProjectorResultInput = z.infer<typeof projectorResultSchema>;
