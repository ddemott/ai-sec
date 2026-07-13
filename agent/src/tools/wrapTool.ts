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
  onError?: (info: {
    tool: string;
    reason: 'timeout' | 'threw' | 'empty';
    error?: unknown;
  }) => void;
  /**
   * EVERY tool invocation — happy path included.
   *
   * WHY THIS EXISTS (2026-07-13, a real call): the agent told the caller "I just
   * sent you a text with a verification code" and "I see that 3 PM is taken".
   * Neither was true. No verification row was ever written, and there were zero
   * appointments that day. The model had NARRATED TOOL CALLS IT NEVER MADE.
   *
   * And we could not tell. This wrapper logged only FAILURES, so a tool the model
   * never invoked and a tool that ran perfectly looked identical in the logs:
   * silent. Diagnosing it meant counting rows in six tables and inferring
   * backwards — "customers is empty, therefore identify_caller was never called".
   *
   * A hallucinated tool call is invisible by construction unless you log the
   * calls that DID happen. So: log every one. The absence in the log is the
   * evidence.
   */
  onCall?: (info: {
    tool: string;
    ok: boolean;
    durationMs: number;
    /** Result preview, truncated — enough to see what the model was told. */
    resultPreview?: string;
  }) => void;
}

/**
 * Wrap a tool's execute fn with the contract. Preserves the (args, opts)
 * signature so it can be dropped onto a FunctionTool.execute in place.
 */
/**
 * Truncated result preview for the call log. Bounded so a fat payload (a service
 * catalogue, ten slots) can't bloat every log line — we only need enough to see
 * WHAT the model was told, since the whole point is catching the gap between what
 * a tool returned and what the agent then said out loud.
 */
function preview(s: string): string {
  const MAX = 200;
  return s.length <= MAX ? s : `${s.slice(0, MAX)}…(+${s.length - MAX} chars)`;
}

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

  // Same best-effort contract as `report` — a logger that throws must never turn
  // a graceful fallback back into a rejected promise / silent turn.
  const reportCall = (info: Parameters<NonNullable<WrapToolOptions['onCall']>>[0]): void => {
    try {
      options?.onCall?.(info);
    } catch {
      /* diagnostics are best-effort */
    }
  };

  return async (args: A, opts: O): Promise<string> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`tool_timeout:${toolName}`)), timeoutMs);
    });
    try {
      const result = await Promise.race([fn(args, opts), timeout]);
      if (typeof result === 'string') {
        if (result.length > 0) {
          reportCall({
            tool: toolName,
            ok: true,
            durationMs: Date.now() - startedAt,
            resultPreview: preview(result),
          });
          return result;
        }
        report({ tool: toolName, reason: 'empty' });
        reportCall({ tool: toolName, ok: false, durationMs: Date.now() - startedAt });
        return fallback;
      }
      // Non-string (object/undefined) — stringify, but never hand back nothing.
      const encoded = result === undefined || result === null ? '' : JSON.stringify(result);
      if (encoded.length > 0) {
        reportCall({
          tool: toolName,
          ok: true,
          durationMs: Date.now() - startedAt,
          resultPreview: preview(encoded),
        });
        return encoded;
      }
      report({ tool: toolName, reason: 'empty' });
      reportCall({ tool: toolName, ok: false, durationMs: Date.now() - startedAt });
      return fallback;
    } catch (err) {
      const timedOut = err instanceof Error && err.message.startsWith('tool_timeout:');
      report({ tool: toolName, reason: timedOut ? 'timeout' : 'threw', error: err });
      reportCall({ tool: toolName, ok: false, durationMs: Date.now() - startedAt });
      return fallback;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
