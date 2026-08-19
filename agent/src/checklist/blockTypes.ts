export type BlockId = string;

interface BaseBlockDef {
  block_id: BlockId;
  description: string;
}

/**
 * WHERE A BLOCK'S ANSWERS COME TO REST.
 *
 * A call has exactly three durable outcomes — a booked appointment, a message,
 * or a structured capture — and every question a block asks must end in one of
 * them or be explicitly declared as ending in none. Declaring it makes the
 * question checkable by CI instead of by a reviewer's memory, and lets any
 * future composition UI refuse to offer a block whose write path does not
 * exist.
 *
 * The failure this prevents has a name in this codebase: a call that asks good
 * questions and stores nothing. It is the same shape as the Telnyx false
 * "sent" — the caller hangs up believing they have handed something over, and
 * there is no row anywhere. `role_description` (2026-07-30) and `location_type`
 * (2026-07-21) were both one field of it; a whole block of it is worse.
 *
 *   'appointment'        — this block's terminal action writes to `appointments`
 *   'message'            — ... to `customer_messages`
 *   'intake_submission'  — ... to `intake_submissions` (+ optional projection)
 *   'composed'           — NO terminal action of its own: its answers ride into
 *                          a partner block's write, so `pairs_with` must name
 *                          who carries them. This is a promise that someone
 *                          else does the writing, and it is only honest if the
 *                          partner's capture actually carries these fields.
 *   'none'               — no durable write by design. `identity` is the only
 *                          legitimate case: it is spine, and its answers are
 *                          backfilled into every other block's write.
 */
export const BLOCK_SINKS = [
  'appointment',
  'message',
  'intake_submission',
  'composed',
  'none',
] as const;
export type BlockSink = (typeof BLOCK_SINKS)[number];

export interface ConversationBlockDef extends BaseBlockDef {
  kind: 'conversation';
  selection_hints?: string[];
  tree_refs?: string[];
  pairs_with?: string[];
  requires?: string[];
  /**
   * Blocks that cannot be selected on the SAME CALL as this one, because the
   * caller cannot be both things at once. Symmetric — declared on both sides
   * and enforced as such.
   *
   * NB this is about simultaneous SELECTION, never about preset membership: a
   * preset may legitimately offer both halves of a conflicting pair, because
   * different callers to the same line want different things.
   * `owner_for_hire_front_desk` enables `job` AND `buy_service` on purpose.
   */
  conflicts_with?: string[];
  /** Where this block's answers land. See BlockSink. */
  sink: BlockSink;
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

export type BlockDef = ConversationBlockDef | PolicyBlockDef | KnowledgeBlockDef | OutcomeBlockDef;

export interface VerticalPresetDef {
  preset_id: string;
  vertical: string;
  description: string;
  conversation_blocks: string[];
  policy_blocks: string[];
  knowledge_blocks: string[];
  outcome_blocks: string[];
  /** Trees this preset must never select, even if a caller asks. */
  forbidden_trees: string[];
  /** Required starting overrides (booking mode, primary intake, …). */
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
