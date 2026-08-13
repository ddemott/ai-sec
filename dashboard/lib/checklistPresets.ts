import {
  deriveChecklistRuntimeConfig,
  type ChecklistPresetId,
} from '../../shared/checklistPresetDerivation';
import { OPTIONAL_NODE_ALLOWLIST, REQUIRED_NODE_ALLOWLIST } from '../../shared/checklistOverrides';

export const CHECKLIST_PRESET_IDS = [
  'auto_shop_front_desk',
  'salon_front_desk',
  'local_service_front_desk',
] as const satisfies readonly ChecklistPresetId[];

export const CHECKLIST_PRESET_LABELS: Record<ChecklistPresetId, string> = {
  auto_shop_front_desk: 'Auto shop front desk',
  salon_front_desk: 'Salon front desk',
  local_service_front_desk: 'Local service front desk',
};

export const CONVERSATION_BLOCK_LABELS: Record<string, string> = {
  identity: 'Who is calling',
  booking: 'Book a time',
  message: 'Take a message',
  qa: 'Answer questions',
  schedule_change: 'Cancel or move an appointment',
  generic_subject: 'Uncategorized subject',
  buy_service: 'Qualify a buyer / demo',
  job: 'Job inquiry',
  fix_computer: 'Computer repair intake',
};

export function checklistPresetLabel(presetId: string | null | undefined): string {
  if (!presetId) return 'Unknown checklist';
  return CHECKLIST_PRESET_LABELS[presetId as ChecklistPresetId] ?? presetId;
}

export const OPTIONAL_NODE_LABELS: Record<string, string> = {
  qa_summary: 'Question summary (after they are answered)',
  current_cost: 'What they pay an answering service',
  best_email: 'Best email for details',
  call_volume: 'How many calls a day',
  current_setup: 'What happens to calls today',
  wants_handled: 'What they want handled',
  business_type: 'What kind of business they run',
  demo_offer: 'Whether they want a demo',
};

export const OPTIONAL_NODE_IDS = OPTIONAL_NODE_ALLOWLIST;
export const REQUIRED_NODE_IDS = REQUIRED_NODE_ALLOWLIST;

export const REQUIRED_NODE_LABELS: Record<string, string> = {
  caller_name: 'Caller name',
  caller_phone: 'Callback number',
  ...OPTIONAL_NODE_LABELS,
};

export function conversationBlockLabel(blockId: string): string {
  return CONVERSATION_BLOCK_LABELS[blockId] ?? blockId.replace(/_/g, ' ');
}

export function runtimeForTenant(opts: {
  business_type?: string | null;
  checklist_preset_id?: string | null;
  checklist_runtime_config?: { preset_id: string; enabled_conversation_blocks: string[] } | null;
}): { preset_id: string; enabled_conversation_blocks: string[] } {
  if (opts.checklist_runtime_config?.preset_id) {
    return opts.checklist_runtime_config;
  }
  return deriveChecklistRuntimeConfig(opts.business_type, opts.checklist_preset_id);
}
