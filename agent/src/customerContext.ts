/**
 * Prefetches the caller's CRM context (name, saved preferences, recent call
 * summaries) once at session start, so buildSystemPrompt can bake it into the
 * instructions the LLM sees on turn one.
 *
 * Why this exists: the prompt has always told the model "at the start of a call
 * you already receive this customer's saved preferences" — but nothing actually
 * put them there. Preferences reached the LLM only if it independently chose to
 * call get_customer_context, which the very same sentence discouraged (why fetch
 * what you've been told you already have?). Net effect: preferences were written
 * by save_customer_preference and then rarely read back. This closes that loop.
 *
 * Hard constraint — this sits on the critical path to the greeting. A slow or
 * down backend must never turn into dead air, so:
 *   - the lookup is bounded by its own deadline (default 1.5s), well under the
 *     ToolsClient's 8s tool timeout;
 *   - every failure mode (timeout, 5xx, 401, malformed body, unknown caller)
 *     resolves to null, never throws;
 *   - null simply means "no known-customer section in the prompt" — the model
 *     still has get_customer_context and is told to use it.
 *
 * Anonymous/blocked callers (callerPhone === null) skip the round-trip entirely.
 */
import type { ToolsClient } from './toolsClient.js';

/**
 * The subset of /agent-tools/customer-context we bake into the prompt.
 * `preferences` is the flat `{key: value}` map the route aggregates out of the
 * customer_preferences table (one row per customer+key). It lived in a
 * customers.metadata jsonb blob until 2026-07-12; the WIRE shape is unchanged,
 * which is why nothing on this side had to move.
 */
export interface KnownCustomer {
  name: string;
  /** Recent call summaries joined by '; '. Empty string when none. */
  history: string;
  preferences: Record<string, unknown>;
}

/** Deadline for the prefetch. Past this we greet without context. */
const PREFETCH_TIMEOUT_MS = 1500;

/**
 * The route answers an unknown caller with the STRING 'New caller - no history
 * found.' and a known one with an object — so shape-check before trusting it.
 */
function isKnownCustomerResult(result: unknown): result is {
  name?: string;
  history?: string;
  preferences?: Record<string, unknown> | null;
} {
  return typeof result === 'object' && result !== null;
}

export async function fetchCustomerContext(
  client: ToolsClient,
  tenantId: string,
  callerPhone: string | null,
  opts: { timeoutMs?: number } = {}
): Promise<KnownCustomer | null> {
  // No caller ID (blocked, or a forwarded line we nulled) → nothing to key on.
  // The prompt's blocked-caller path collects a number verbally instead.
  if (!callerPhone) return null;

  const timeoutMs = opts.timeoutMs ?? PREFETCH_TIMEOUT_MS;

  // Race the lookup against our own deadline. The losing fetch is left to
  // settle on its own (harmless — nothing reads it); we just stop waiting.
  const lookup = client
    .call<unknown>(
      '/agent-tools/customer-context',
      { tenant_id: tenantId, phone: callerPhone },
      { isReadOnly: true }
    )
    .then((res): KnownCustomer | null => {
      if (!res.ok) return null;
      if (!isKnownCustomerResult(res.result)) return null; // unknown-caller string
      const { name, history, preferences } = res.result;
      // A row with neither a name nor anything saved is not worth a prompt
      // section — treat it as an unknown caller.
      const prefs = preferences ?? {};
      const hasAnything =
        (typeof name === 'string' && name.trim() && name !== 'Unknown') ||
        Object.keys(prefs).length > 0;
      if (!hasAnything) return null;
      return {
        name: typeof name === 'string' ? name : 'Unknown',
        history: typeof history === 'string' && history !== 'No history' ? history : '',
        preferences: prefs,
      };
    })
    .catch(() => null);

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return await Promise.race([lookup, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
