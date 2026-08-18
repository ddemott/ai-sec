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
  /**
   * WHAT THE TOOL SAID BACK, summarized (summarizeToolResult). Absent when no
   * output arrived or nothing safe could be extracted.
   *
   * `ok` above means only "the tool did not throw" — a host refusal and a
   * successful write are both `ok:true`, because a refusal is returned as an
   * ordinary string result. On 2026-08-13 that cost two postmortems:
   * SCL_3a8SkDKzxN4B's `set_purpose` adding the `job` tree came back ok:true
   * while the host was actually answering `No tree called "job"`, and
   * SCL_KLvqZ2JkaQFU's `book_with_scheduling` at t=43.5s came back ok:true
   * having booked nothing — its reason is permanently unrecoverable, leaving
   * two candidate causes and no way to choose. Args told us what we ASKED.
   * Nothing recorded what we were TOLD.
   */
  result?: string;
}

export const MAX_TOOL_LOG_ENTRIES = 200;

/** Per-entry result cap. Keeps a runaway tool from writing a multi-MB jsonb. */
export const MAX_RESULT_CHARS = 200;

/** Row ids worth keeping verbatim — they join a postmortem to the record the
 *  call produced. Internal identifiers, not caller data. */
const RESULT_ID_FIELDS = ['appointment_id', 'message_id', 'job_inquiry_id', 'customer_id'] as const;

/**
 * Reduce a tool's reply to the part that explains a decision, dropping the part
 * that carries people.
 *
 * Tool replies are JSON (`{success, error, error_code, …}`) or, for the
 * checklist's own host-side tools, prose. Both can carry caller data in the
 * same payload — a customer-context reply holds a name, address and history,
 * and a checklist refusal appends the CHECKLIST STATE block, which is made of
 * the caller's own answers. So this copies decision FIELDS by name rather than
 * truncating whatever happened to come back, and cuts prose at the first line
 * break (the refusal sentence) before the state block begins.
 */
export function summarizeToolResult(output: unknown): string | undefined {
  if (typeof output !== 'string') return undefined;
  const text = output.trim();
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const parts: string[] = [];
      if (typeof obj.success === 'boolean') parts.push(`success=${String(obj.success)}`);
      if (typeof obj.error_code === 'string') parts.push(`error_code=${obj.error_code}`);
      if (typeof obj.error === 'string') parts.push(`error=${obj.error}`);
      for (const key of RESULT_ID_FIELDS) {
        const value = obj[key];
        if (typeof value === 'string' && value) parts.push(`${key}=${value}`);
      }
      // Nothing recognized: the KEYS still say what shape came back, and a key
      // name is never caller data the way a value is.
      if (parts.length === 0) parts.push(`keys=${Object.keys(obj).slice(0, 8).join(',')}`);
      return parts.join(' ').slice(0, MAX_RESULT_CHARS);
    }
  } catch {
    // Not JSON — a host-side string. Fall through.
  }
  const firstLine = text.split('\n', 1)[0] ?? text;
  return firstLine.slice(0, MAX_RESULT_CHARS);
}

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
    calls: Array<
      { callId?: string; name?: string; args?: string; createdAt?: number } | null | undefined
    >,
    outputs: Array<
      | { callId?: string; isError?: boolean; createdAt?: number; output?: unknown }
      | null
      | undefined
    >
  ): void {
    const outByCallId = new Map<
      string,
      { isError?: boolean; createdAt?: number; output?: unknown }
    >();
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
      const result = summarizeToolResult(out?.output);
      this.entries.push({
        t: Math.max(0, Math.round(callAt - this.startedAtMs)),
        tool: c?.name ?? '(unknown)',
        args: redactToolArgs(c?.args ?? '{}'),
        ok: typeof out?.isError === 'boolean' ? !out.isError : null,
        ms:
          typeof out?.createdAt === 'number' && typeof c?.createdAt === 'number'
            ? Math.max(0, Math.round(out.createdAt - c.createdAt))
            : null,
        ...(result === undefined ? {} : { result }),
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
