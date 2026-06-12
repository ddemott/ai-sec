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

/** Accumulates spoken turns and renders a human-readable transcript. */
export class TranscriptRecorder {
  private readonly turns: TranscriptTurn[] = [];

  /**
   * Record one conversation item. No-ops for any role other than
   * user/assistant and for empty/whitespace-only text, so the rendered
   * transcript holds only real spoken content (never blank lines).
   */
  add(role: string, text: string | null | undefined): void {
    if (role !== 'user' && role !== 'assistant') return;
    const trimmed = (text ?? '').trim();
    if (!trimmed) return;
    this.turns.push({ role, text: trimmed });
  }

  /** Number of spoken turns recorded so far. */
  get size(): number {
    return this.turns.length;
  }

  /**
   * Render the transcript as `Caller:` / `Assistant:`-prefixed lines, or `null`
   * when nothing was spoken — so the RPC stores SQL NULL, not an empty string.
   * Truncates (keeping the start of the call) to stay within the char cap.
   */
  render(): string | null {
    if (this.turns.length === 0) return null;
    const full = this.turns.map((t) => `${SPEAKER_LABEL[t.role]}: ${t.text}`).join('\n');
    if (full.length <= MAX_TRANSCRIPT_CHARS) return full;
    return full.slice(0, MAX_TRANSCRIPT_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
  }
}
