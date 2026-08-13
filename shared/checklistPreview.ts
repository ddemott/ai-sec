import {
  BOOKING_MODES,
  MESSAGE_MODES,
  REQUIRED_NODE_ALLOWLIST,
  WORDING_NODE_ALLOWLIST,
  type BookingMode,
  type ChecklistOverrides,
  type MessageMode,
} from './checklistOverrides';
import { deriveChecklistRuntimeConfig } from './checklistPresetDerivation';

/** Which conversation block owns a previewable field. */
export const PREVIEW_FIELD_BLOCK: Record<(typeof REQUIRED_NODE_ALLOWLIST)[number], string> = {
  caller_name: 'identity',
  caller_phone: 'identity',
  qa_summary: 'qa',
  current_cost: 'buy_service',
  best_email: 'buy_service',
  call_volume: 'buy_service',
  current_setup: 'buy_service',
  wants_handled: 'buy_service',
  business_type: 'buy_service',
  demo_offer: 'buy_service',
};

export const PREVIEW_FIELD_DEFAULT_ASK: Record<(typeof REQUIRED_NODE_ALLOWLIST)[number], string> = {
  caller_name: 'the name the caller used for themselves',
  caller_phone: "What's the best number to reach you?",
  qa_summary: 'a one-line summary of what they asked about, after they are answered',
  current_cost: 'roughly what they pay an answering service each month',
  best_email: 'the best email to send the details to',
  call_volume: 'roughly how many calls a day they take',
  current_setup: 'what happens to their calls today',
  wants_handled: 'what they most want the receptionist to handle',
  business_type: 'what kind of business they run, in their own words',
  demo_offer: 'whether they want to see it working',
};

export type PreviewFieldRole = 'ask' | 'listen' | 'required';

export interface ChecklistPreviewField {
  node_id: string;
  block_id: string;
  role: PreviewFieldRole;
  ask: string;
  wording_editable: boolean;
}

export interface ChecklistCallPreview {
  preset_id: string;
  enabled_blocks: string[];
  disabled_blocks: string[];
  booking_mode: BookingMode;
  message_mode: MessageMode;
  fields: ChecklistPreviewField[];
}

export function previewChecklistCall(opts: {
  businessType?: string | null;
  presetId?: string | null;
  overrides?: ChecklistOverrides | null;
}): ChecklistCallPreview {
  const base = deriveChecklistRuntimeConfig(opts.businessType, opts.presetId);
  const config = deriveChecklistRuntimeConfig(opts.businessType, opts.presetId, opts.overrides);
  const overrides = (config.overrides ?? {}) as ChecklistOverrides;
  const enabled = config.enabled_conversation_blocks;
  const enabledSet = new Set(enabled);
  const disabled = (base.enabled_conversation_blocks ?? []).filter((id) => !enabledSet.has(id));
  const optional = new Set(overrides.optional_node_ids ?? []);
  const required = new Set(overrides.required_node_ids ?? []);
  const wording = overrides.wording ?? {};

  const fields: ChecklistPreviewField[] = [];
  for (const nodeId of REQUIRED_NODE_ALLOWLIST) {
    const blockId = PREVIEW_FIELD_BLOCK[nodeId];
    if (!enabledSet.has(blockId)) continue;
    let role: PreviewFieldRole = 'ask';
    if (optional.has(nodeId)) role = 'listen';
    else if (required.has(nodeId)) role = 'required';
    const editable = (WORDING_NODE_ALLOWLIST as readonly string[]).includes(nodeId);
    fields.push({
      node_id: nodeId,
      block_id: blockId,
      role,
      ask: (editable && wording[nodeId]) || PREVIEW_FIELD_DEFAULT_ASK[nodeId],
      wording_editable: editable,
    });
  }

  return {
    preset_id: config.preset_id,
    enabled_blocks: enabled,
    disabled_blocks: disabled,
    booking_mode: overrides.booking_mode ?? BOOKING_MODES[0],
    message_mode: overrides.message_mode ?? MESSAGE_MODES[0],
    fields,
  };
}
