import type { DerivedChecklistRuntimeConfig } from './checklistPresetDerivation';

export const BOOKING_MODES = ['offer_once', 'prefer', 'never'] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export const MESSAGE_MODES = ['always', 'fallback_only'] as const;
export type MessageMode = (typeof MESSAGE_MODES)[number];

/** Text nodes a tenant may flip to listen-only. Actions and identity stay off this list. */
export const OPTIONAL_NODE_ALLOWLIST = [
  'qa_summary',
  'current_cost',
  'best_email',
  'call_volume',
  'current_setup',
  'wants_handled',
  'business_type',
  'demo_offer',
] as const;

/** Text nodes a tenant may mark required. Decline does not resolve these. */
export const REQUIRED_NODE_ALLOWLIST = [
  'caller_name',
  'caller_phone',
  ...OPTIONAL_NODE_ALLOWLIST,
] as const;

export type OptionalNodeId = (typeof OPTIONAL_NODE_ALLOWLIST)[number];
export type RequiredNodeId = (typeof REQUIRED_NODE_ALLOWLIST)[number];

export interface ChecklistOverrides {
  disabled_conversation_blocks?: string[];
  booking_mode?: BookingMode;
  message_mode?: MessageMode;
  optional_node_ids?: string[];
  required_node_ids?: string[];
}

const PROTECTED_BLOCKS = new Set(['identity']);
const OPTIONAL_NODE_SET = new Set<string>(OPTIONAL_NODE_ALLOWLIST);
const REQUIRED_NODE_SET = new Set<string>(REQUIRED_NODE_ALLOWLIST);
const BOOKING_MODE_SET = new Set<string>(BOOKING_MODES);
const MESSAGE_MODE_SET = new Set<string>(MESSAGE_MODES);

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
  ];
}

export function normalizeChecklistOverrides(raw?: ChecklistOverrides | null): ChecklistOverrides {
  return {
    disabled_conversation_blocks: asStringList(raw?.disabled_conversation_blocks),
    booking_mode: raw?.booking_mode,
    message_mode: raw?.message_mode,
    optional_node_ids: asStringList(raw?.optional_node_ids),
    required_node_ids: asStringList(raw?.required_node_ids),
  };
}

export function applyChecklistOverrides(
  runtime: DerivedChecklistRuntimeConfig,
  overrides?: ChecklistOverrides | null
): { ok: true; config: DerivedChecklistRuntimeConfig } | { ok: false; error: string } {
  const next = normalizeChecklistOverrides(overrides);
  const disabled = next.disabled_conversation_blocks ?? [];
  const optional = next.optional_node_ids ?? [];
  const required = next.required_node_ids ?? [];

  if (next.booking_mode !== undefined && !BOOKING_MODE_SET.has(next.booking_mode)) {
    return { ok: false, error: `Unknown booking_mode '${next.booking_mode}'.` };
  }
  if (next.message_mode !== undefined && !MESSAGE_MODE_SET.has(next.message_mode)) {
    return { ok: false, error: `Unknown message_mode '${next.message_mode}'.` };
  }

  const enabled = new Set(runtime.enabled_conversation_blocks);
  for (const id of disabled) {
    if (!enabled.has(id)) {
      return { ok: false, error: `Cannot disable '${id}' — it is not in this preset.` };
    }
    if (PROTECTED_BLOCKS.has(id)) {
      return { ok: false, error: `Cannot disable '${id}' — contact-bearing calls need it.` };
    }
  }

  for (const id of optional) {
    if (!OPTIONAL_NODE_SET.has(id)) {
      return {
        ok: false,
        error: `Cannot mark '${id}' optional — only supported intake fields can flip.`,
      };
    }
  }

  for (const id of required) {
    if (!REQUIRED_NODE_SET.has(id)) {
      return {
        ok: false,
        error: `Cannot mark '${id}' required — only supported intake fields can stick.`,
      };
    }
  }

  const both = optional.filter((id) => required.includes(id));
  if (both.length > 0) {
    return {
      ok: false,
      error: `Cannot mark '${both[0]}' required and optional — listen-only would never resolve.`,
    };
  }

  if (next.booking_mode === 'never') {
    disabled.push('booking');
  }

  const uniqueDisabled = [...new Set(disabled)].filter((id) => id !== 'identity');
  const nextBlocks = runtime.enabled_conversation_blocks.filter(
    (id) => !uniqueDisabled.includes(id)
  );
  if (nextBlocks.length === 0) {
    return { ok: false, error: 'At least one conversation block must stay enabled.' };
  }

  const stored: ChecklistOverrides = {};
  if (uniqueDisabled.length > 0) stored.disabled_conversation_blocks = uniqueDisabled;
  if (next.booking_mode) stored.booking_mode = next.booking_mode;
  if (next.message_mode) stored.message_mode = next.message_mode;
  if (optional.length > 0) stored.optional_node_ids = optional;
  if (required.length > 0) stored.required_node_ids = required;

  return {
    ok: true,
    config: {
      ...runtime,
      enabled_conversation_blocks: nextBlocks,
      overrides: { ...stored },
    },
  };
}
