/**
 * The non-freeze-by-construction contract for capability tools.
 *
 * Every tool the agent exposes is run through `wrapToolExecute`, so no tool —
 * including one a future customer adds — can stall the turn or hand the LLM
 * nothing to say. The contract:
 *   - TIMEOUT: race the execute against a hard ceiling (above ToolsClient's own
 *     8s/16s HTTP bound) so a tool that bypasses ToolsClient (e.g. a live SIP
 *     transfer) or hangs anyway cannot freeze the turn forever.
 *   - CATCH → STRING: any throw becomes a graceful, speakable fallback — never
 *     a rejected promise that orphans the generation.
 *   - NEVER EMPTY: an empty/undefined result becomes the fallback, so the model
 *     always has something to relay (no silent turn).
 *
 * It deliberately does NOT call session.say() — that inside-execute() pattern is
 * what froze #97. The watchdog (session layer) handles the spoken hold; this
 * layer just guarantees the tool RESULT is always a prompt, timely string.
 */

/** Hard ceiling per tool. Above ToolsClient's max (2×8s read) so it only ever
 *  catches a true hang, never a legitimately slow call. */
export const WRAP_TOOL_TIMEOUT_MS = 25_000;

const DEFAULT_FALLBACK =
  "Sorry, I'm having a little trouble with that right now. Would you like me to take a message and have someone get back to you?";

export interface WrapToolOptions {
  /** Override the per-tool timeout (e.g. a long-running booking). */
  timeoutMs?: number;
  /** Spoken fallback when the tool times out, throws, or returns nothing. */
  fallback?: string;
  /** Diagnostics sink (metric + 5W log) for the sad path. */
  onError?: (info: { tool: string; reason: 'timeout' | 'threw' | 'empty'; error?: unknown }) => void;
}

/**
 * Wrap a tool's execute fn with the contract. Preserves the (args, opts)
 * signature so it can be dropped onto a FunctionTool.execute in place.
 */
export function wrapToolExecute<A, O>(
  toolName: string,
  fn: (args: A, opts: O) => Promise<unknown>,
  options?: WrapToolOptions
): (args: A, opts: O) => Promise<string> {
  const timeoutMs = options?.timeoutMs ?? WRAP_TOOL_TIMEOUT_MS;
  const fallback = options?.fallback ?? DEFAULT_FALLBACK;

  // onError is diagnostic-only and MUST NOT be able to break the contract — if
  // a caller's logger throws, swallow it (a failed log can't be allowed to turn
  // a graceful fallback back into a rejected promise / silent turn).
  const report = (info: Parameters<NonNullable<WrapToolOptions['onError']>>[0]): void => {
    try {
      options?.onError?.(info);
    } catch {
      /* diagnostics are best-effort */
    }
  };

  return async (args: A, opts: O): Promise<string> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`tool_timeout:${toolName}`)), timeoutMs);
    });
    try {
      const result = await Promise.race([fn(args, opts), timeout]);
      if (typeof result === 'string') {
        if (result.length > 0) return result;
        report({ tool: toolName, reason: 'empty' });
        return fallback;
      }
      // Non-string (object/undefined) — stringify, but never hand back nothing.
      const encoded = result === undefined || result === null ? '' : JSON.stringify(result);
      if (encoded.length > 0) return encoded;
      report({ tool: toolName, reason: 'empty' });
      return fallback;
    } catch (err) {
      const timedOut = err instanceof Error && err.message.startsWith('tool_timeout:');
      report({ tool: toolName, reason: timedOut ? 'timeout' : 'threw', error: err });
      return fallback;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
