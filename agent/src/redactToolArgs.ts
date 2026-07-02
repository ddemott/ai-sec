/**
 * PII scrubber for logging LLM tool-call ARGUMENTS.
 *
 * The FunctionToolsExecuted log used to carry tool NAMES only — a live
 * wrong-time-booking incident (2026-07-01) couldn't be diagnosed because
 * nothing showed what time string the LLM actually sent. Args are the
 * debugging payload, but they also carry caller PII (phone numbers, OTP
 * codes), and these logs ship to centralized aggregation.
 *
 * Redaction policy (mirrors the transcript-preview precedent in index.ts —
 * keep the words, mask the digits — applied per-key so structured time
 * strings survive):
 *  - keys matching /phone/ or exactly code/otp → every digit masked
 *  - all other strings → mask US phone shapes (3-3-4 with separators) and
 *    7+ consecutive-digit runs; dates/times (4-2-2 / 2-2 groups) untouched
 *  - names are kept (needed to debug identify_caller / find_caller_by_name)
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

const FULL_MASK_KEY = /phone|^(code|otp)$/i;
// Classic US dictation shape: optional +1, then 3-3-4 with ()/space/dot/dash
// separators. Dates (4-2-2) and clock times (2-2) don't fit 3-3-4.
const PHONE_IN_TEXT = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const LONG_DIGIT_RUN = /\d{7,}/g;
const MAX_STRING_LEN = 300;

function maskDigits(s: string): string {
  return s.replace(/\d/g, '•');
}

function redactFreeText(s: string): string {
  return s
    .slice(0, MAX_STRING_LEN)
    .replace(LONG_DIGIT_RUN, (m) => maskDigits(m))
    .replace(PHONE_IN_TEXT, (m) => maskDigits(m));
}

function redactValue(key: string | null, value: JsonValue): JsonValue {
  if (typeof value === 'string') {
    if (key !== null && FULL_MASK_KEY.test(key)) return maskDigits(value.slice(0, MAX_STRING_LEN));
    return redactFreeText(value);
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(null, v));
  if (value !== null && typeof value === 'object') {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(k, v);
    return out;
  }
  return value; // number | boolean | null pass through
}

/**
 * Parse a tool-call args JSON string and return a PII-redacted structure
 * safe for centralized logs. Never throws: malformed JSON comes back as
 * `{ _unparsed: <digit-masked preview> }`.
 */
export function redactToolArgs(argsJson: string): JsonValue {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(argsJson) as JsonValue;
  } catch {
    return { _unparsed: maskDigits(argsJson.slice(0, MAX_STRING_LEN)) };
  }
  return redactValue(null, parsed);
}

export interface ToolCallSummary {
  name: string;
  args: JsonValue;
  is_error: boolean | null;
}

/**
 * Shape the FunctionToolsExecuted event payload for structured logging:
 * one entry per call with redacted args and the paired output's isError
 * (null when no output arrived for that callId). Tolerates missing fields —
 * this runs inside a live-call event handler and must never throw.
 */
export function summarizeToolCalls(
  calls: Array<{ callId?: string; name?: string; args?: string } | null | undefined>,
  outputs: Array<{ callId?: string; isError?: boolean } | null | undefined>
): ToolCallSummary[] {
  const errByCallId = new Map<string, boolean>();
  for (const o of outputs) {
    if (o?.callId != null && typeof o.isError === 'boolean') errByCallId.set(o.callId, o.isError);
  }
  return calls.map((c) => ({
    name: c?.name ?? '(unknown)',
    args: redactToolArgs(c?.args ?? '{}'),
    is_error: c?.callId != null ? (errByCallId.get(c.callId) ?? null) : null,
  }));
}
