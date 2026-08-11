export type BlockId = string;

interface BaseBlockDef {
  block_id: BlockId;
  description: string;
}

export interface ConversationBlockDef extends BaseBlockDef {
  kind: 'conversation';
  selection_hints?: string[];
  tree_refs?: string[];
  pairs_with?: string[];
  requires?: string[];
  conflicts_with?: string[];
}

export interface PolicyBlockDef extends BaseBlockDef {
  kind: 'policy';
  policy_type: string;
  settings: Record<string, unknown>;
}

export interface KnowledgeBlockDef extends BaseBlockDef {
  kind: 'knowledge';
  knowledge_keys: string[];
}

export interface OutcomeBlockDef extends BaseBlockDef {
  kind: 'outcome';
  outcome_type: string;
  projector?: string;
  settings: Record<string, unknown>;
}

export type BlockDef =
  | ConversationBlockDef
  | PolicyBlockDef
  | KnowledgeBlockDef
  | OutcomeBlockDef;

export interface VerticalPresetDef {
  preset_id: string;
  vertical: string;
  description: string;
  conversation_blocks: string[];
  policy_blocks: string[];
  knowledge_blocks: string[];
  outcome_blocks: string[];
  defaults: Record<string, unknown>;
}

export interface TenantRuntimeConfig {
  tenant_id?: string;
  preset_id: string;
  enabled_conversation_blocks: string[];
  enabled_policy_blocks: string[];
  enabled_knowledge_blocks: string[];
  enabled_outcome_blocks: string[];
  overrides: Record<string, unknown>;
  version: number;
}

export interface IntakeSubmission {
  submission_id: string;
  tenant_id: string;
  call_id?: string;
  preset_id: string;
  block_ids: string[];
  submission_type: string;
  caller_name?: string;
  caller_phone?: string;
  appointment_id?: string;
  payload_json: Record<string, unknown>;
  rendered_summary?: string;
  created_at: string;
}

export interface ProjectorResult {
  success: boolean;
  projected_record_id?: string;
  projected_record_type?: string;
  notifications_sent?: string[];
  warnings?: string[];
}

export interface Projector {
  project: (
    submission: IntakeSubmission,
    context?: Record<string, unknown>
  ) => Promise<ProjectorResult>;
}
