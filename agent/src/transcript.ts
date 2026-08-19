/**
 * Call-transcript accumulation for voice_sessions logging.
 *
 * The LiveKit AgentSession emits `conversation_item_added` for every finalized
 * ChatMessage — both the caller's transcribed speech (role `user`) and the
 * agent's spoken replies, greeting included (role `assistant`). We accumulate
 * those spoken turns here and render a plain-text transcript at call end, sent
 * to /agent-tools/voice-session-end (end_voice_session RPC, p_transcript) so
 * the dashboard Calls tab + customer call history show what was actually said.
 *
 * Only `user`/`assistant` message turns are kept. The event is typed
 * `item: ChatMessage`, so function-call / tool-output items never arrive here,
 * but we still guard on role so a future SDK change (or a `system` message)
 * can't leak prompt text into a human-readable transcript.
 */

export type TranscriptRole = 'user' | 'assistant';

export interface TranscriptTurn {
  role: TranscriptRole;
  text: string;
  /** ms offset from call start — when this turn was COMMITTED (finalized by
   *  STT / finished being spoken), not when it began. */
  tMs: number;
  /**
   * The assistant produced this text and the caller never heard a word of it.
   *
   * The framework records an assistant turn from the LLM TOKEN STREAM, not from
   * playout: a TTS stream that accepts the turn and then emits zero audio frames
   * still yields a ConversationItemAdded, and the call record ends up holding a
   * tidy conversation that did not happen. Measured 2026-08-15 — the transcript
   * says "Assistant [1:32]: Thanks, Bob. That's 6 0 8, 1 1 1, 8 6 5 2,
   * correct?" and the caller's very next words were "You didn't repeat it back
   * or anything. You just didn't say anything."
   */
  unheard?: boolean;
}

const SPEAKER_LABEL: Record<TranscriptRole, string> = {
  user: 'Caller',
  assistant: 'Assistant',
};

// Hard cap on the rendered transcript. `voice_sessions.transcript` is unbounded
// TEXT and the content is STT of an arbitrary-length call, so a pathological
// multi-hour call could write a multi-MB row. 100k chars (~25k words) covers any
// real reception call with room to spare; beyond it we truncate and mark it. The
// agent-tools schema enforces the same bound server-side.
export const MAX_TRANSCRIPT_CHARS = 100_000;
const TRUNCATION_MARKER = '\n…[transcript truncated]';

/**
 * Does a RENDERED transcript string contain at least one caller line? The
 * string-level twin of TranscriptRecorder.hasCallerTurn(), for the post-call
 * enrichment functions (summarizeCall / classifyCallOutcome) that receive the
 * rendered text, not the recorder. Both guard on this so a greeting-only
 * transcript never reaches the LLM to be fabricated into an outcome (see
 * hasCallerTurn's note). Anchored to the start of a line so "Caller:" appearing
 * inside the assistant's own words can't trip it.
 */
// Both shapes: timestamped "Caller [1:23]: …" (2026-07-30 onward) and the bare
// "Caller: …" of rows stored before then — these functions also run over
// historical transcripts pulled from the DB.
const CALLER_LINE = new RegExp(`^${SPEAKER_LABEL.user}(?: \\[\\d+:\\d{2}\\])?: `, 'm');
export function renderedHasCallerTurn(rendered: string | null | undefined): boolean {
  return !!rendered && CALLER_LINE.test(rendered);
}

/** Render an ms offset as the transcript's `m:ss` stamp. */
function formatOffset(tMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(tMs / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Accumulates spoken turns and renders a human-readable transcript. */
export class TranscriptRecorder {
  private readonly turns: TranscriptTurn[] = [];
  private readonly startedAtMs: number;

  // Timestamps were added 2026-07-30 (CALL_IMPROVEMENTS.md): the silent calls
  // (#4/#5/#6 — 13-42s, greeting only) and the bot-mirror loop (#1, 5 minutes)
  // were undiagnosable from an unstamped transcript — "how long did the caller
  // wait", "where did the dead air sit" had no answer. Each line now carries
  // its m:ss offset from call start, so pauses read straight off the text.
  constructor(startedAtMs: number = Date.now()) {
    this.startedAtMs = startedAtMs;
  }

  /**
   * Record one conversation item. No-ops for any role other than
   * user/assistant and for empty/whitespace-only text, so the rendered
   * transcript holds only real spoken content (never blank lines).
   */
  add(role: string, text: string | null | undefined): void {
    if (role !== 'user' && role !== 'assistant') return;
    const trimmed = (text ?? '').trim();
    if (!trimmed) return;
    this.turns.push({ role, text: trimmed, tMs: Math.max(0, Date.now() - this.startedAtMs) });
  }

  /** Number of spoken turns recorded so far. */
  get size(): number {
    return this.turns.length;
  }

  /**
   * Mark the most recent assistant turn as never heard by the caller.
   *
   * Called by the silent-turn recovery, which is the one place that knows a
   * turn ended with no audio. It walks back to the last ASSISTANT line rather
   * than the last line outright: the caller frequently speaks into the silence
   * ("Hello? Are you there?") before the recovery fires, and their turn is
   * real — it is the agent's that was imaginary.
   *
   * Returns whether a line was marked, so a caller can tell "marked it" from
   * "there was nothing to mark" instead of assuming.
   */
  markLastAssistantUnheard(): boolean {
    for (let i = this.turns.length - 1; i >= 0; i--) {
      const turn = this.turns[i];
      if (turn && turn.role === 'assistant') {
        if (turn.unheard) return false;
        turn.unheard = true;
        return true;
      }
    }
    return false;
  }

  /**
   * Did the CALLER actually say anything? A transcript that holds only the
   * assistant's greeting is not a conversation — the caller hung up, sat
   * silent, or their audio never reached us.
   *
   * THE BUG THIS GUARDS (a real call, 2026-07-23, +1 650-770-0302): a
   * greeting-only call was handed to the post-call summary model, whose prompt
   * asks it to pick an outcome ("booked / left a message / asked a question").
   * The greeting itself lists "hiring Dale … or leaving a message", so the
   * model echoed that menu back as fact — "The caller inquired about hiring
   * Dale and left a message." No message existed; customer_messages was empty.
   * The owner read "left a message" and went looking for one that was never
   * left. Summarizing a call with no caller turn can only fabricate — so don't.
   */
  hasCallerTurn(): boolean {
    return this.turns.some((t) => t.role === 'user');
  }

  /**
   * Render the transcript as `Caller:` / `Assistant:`-prefixed lines, or `null`
   * when nothing was spoken — so the RPC stores SQL NULL, not an empty string.
   * Truncates (keeping the start of the call) to stay within the char cap.
   */
  render(): string | null {
    if (this.turns.length === 0) return null;
    const full = this.turns
      .map(
        (t) =>
          // The marker goes in the LABEL, where a human reading the Calls tab
          // cannot miss it. A record that shows the agent saying something it
          // never said is worse than no record: the owner reads it, believes
          // the caller heard it, and cannot explain why they hung up.
          `${SPEAKER_LABEL[t.role]}${t.unheard ? ' (NOT HEARD — no audio reached the caller)' : ''} [${formatOffset(t.tMs)}]: ${t.text}`
      )
      .join('\n');
    if (full.length <= MAX_TRANSCRIPT_CHARS) return full;
    return full.slice(0, MAX_TRANSCRIPT_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
  }
}
