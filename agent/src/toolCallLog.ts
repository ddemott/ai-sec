/**
 * Per-call tool-invocation log, PERSISTED — the piece the Pino log stream
 * could not provide.
 *
 * The FunctionToolsExecuted listener has logged every tool call (name +
 * redacted args + is_error) since 2026-07-01 — to stdout. Railway rotates
 * that: when the 2026-07-27 calls were analyzed on 2026-07-30, the container
 * had restarted and every tool-level trace was gone. Call #8's postmortem
 * ("you don't have a booked time on file", said to a caller with a live
 * appointment) ended at THREE candidate causes — get_my_appointments never
 * called / called-but-empty / called-and-misread — because nothing durable
 * recorded which tools actually fired (CALL_IMPROVEMENTS.md #8).
 *
 * This class accumulates the same redacted entries in memory and ships them
 * once, at call end, inside voice-session-end; the backend merges them into
 * `voice_sessions.metadata.tool_calls`. A postmortem becomes one SQL query
 * against the row that already holds the transcript.
 *
 * Mirrors TranscriptRecorder: one instance per call, fed by a session event
 * listener, read once at teardown. Entries are capped — a runaway tool loop
 * must not grow an unbounded array in a live call's memory nor write a
 * multi-MB jsonb; past the cap we count drops instead of recording, and the
 * count itself is the evidence of the runaway.
 */
import { redactToolArgs } from './redactToolArgs.js';

export interface ToolCallEntry {
  /** ms offset from call start — small, and pauses read directly. */
  t: number;
  tool: string;
  /** PII-redacted args (redactToolArgs) — the debugging payload. */
  args: unknown;
  /** Paired output's isError, inverted; null when no output arrived. */
  ok: boolean | null;
  /** Output.createdAt - call.createdAt; null when unpaired. */
  ms: number | null;
}

export const MAX_TOOL_LOG_ENTRIES = 200;

export interface ToolCallLogPayload {
  entries: ToolCallEntry[];
  /** Calls past the cap — nonzero means a runaway loop, and says how big. */
  dropped: number;
}

export class ToolCallLog {
  private readonly entries: ToolCallEntry[] = [];
  private dropped = 0;
  private readonly startedAtMs: number;

  constructor(startedAtMs: number = Date.now()) {
    this.startedAtMs = startedAtMs;
  }

  /**
   * Record one executed batch from a FunctionToolsExecuted event. Pairs each
   * call with its output by callId. Tolerates missing fields — this runs
   * inside a live-call event handler and must never throw.
   */
  recordBatch(
    calls: Array<{ callId?: string; name?: string; args?: string; createdAt?: number
    } | null | undefined>,
    outputs: Array<{ callId?: string; isError?: boolean; createdAt?: number } | null | undefined>
  ): void {
    const outByCallId = new Map<string, { isError?: boolean; createdAt?: number }>();
    for (const o of outputs) {
      if (o?.callId != null) outByCallId.set(o.callId, o);
    }
    for (const c of calls) {
      if (this.entries.length >= MAX_TOOL_LOG_ENTRIES) {
        this.dropped += 1;
        continue;
      }
      const out = c?.callId != null ? outByCallId.get(c.callId) : undefined;
      const callAt = typeof c?.createdAt === 'number' ? c.createdAt : Date.now();
      this.entries.push({
        t: Math.max(0, Math.round(callAt - this.startedAtMs)),
        tool: c?.name ?? '(unknown)',
        args: redactToolArgs(c?.args ?? '{}'),
        ok: typeof out?.isError === 'boolean' ? !out.isError : null,
        ms:
          typeof out?.createdAt === 'number' && typeof c?.createdAt === 'number'
            ? Math.max(0, Math.round(out.createdAt - c.createdAt))
            : null,
      });
    }
  }

  get size(): number {
    return this.entries.length;
  }

  /** The wire payload for voice-session-end, or null when no tool ever fired
   *  (so the row's metadata stays untouched — absence means absence). */
  toPayload(): ToolCallLogPayload | null {
    if (this.entries.length === 0) return null;
    return { entries: [...this.entries], dropped: this.dropped };
  }
}
