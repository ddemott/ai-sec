import { describe, expect, it } from 'vitest';

import { MAX_TRANSCRIPT_CHARS, TranscriptRecorder } from './transcript.js';

// WHO: the agent's conversation_item_added listener (index.ts) feeding spoken
//      turns to the recorder, drained by the shutdown callback.
// WHAT: TranscriptRecorder accumulates user/assistant turns and renders a
//      plain-text Caller:/Assistant: transcript for end_voice_session.
// WHERE: agent/src/transcript.ts.
// WHY: the Calls tab transcript section reads exactly this text; bad rendering
//      (blank lines, leaked system prompt, empty-string instead of NULL) would
//      surface to owners.
describe('TranscriptRecorder', () => {
  it('HAPPY: renders caller + assistant turns as labeled lines in order', () => {
    // WHEN: a normal two-way conversation.
    const rec = new TranscriptRecorder();
    rec.add('assistant', 'Thanks for calling Bella’s. How can I help?');
    rec.add('user', 'I want to book a haircut.');
    rec.add('assistant', 'Sure — what day works?');
    expect(rec.size).toBe(3);
    expect(rec.render()).toBe(
      'Assistant: Thanks for calling Bella’s. How can I help?\n' +
        'Caller: I want to book a haircut.\n' +
        'Assistant: Sure — what day works?'
    );
  });

  it('HAPPY: empty recorder renders null (SQL NULL, not "")', () => {
    // WHEN: a silent hang-up — nothing was ever spoken.
    // WHY: the RPC must store NULL so the Calls tab hides the transcript
    //      section instead of showing a blank panel.
    const rec = new TranscriptRecorder();
    expect(rec.size).toBe(0);
    expect(rec.render()).toBeNull();
  });

  it('SAD: drops non-user/assistant roles (system / tool never leak in)', () => {
    // WHY: conversation_item_added is typed to ChatMessage, but a future SDK
    //      change or a system message must never put prompt text in a
    //      human-readable transcript.
    const rec = new TranscriptRecorder();
    rec.add('system', 'You are Clara, a receptionist…');
    rec.add('tool', '{"slots":[]}');
    rec.add('function', 'noise');
    rec.add('user', 'Hello?');
    expect(rec.size).toBe(1);
    expect(rec.render()).toBe('Caller: Hello?');
  });

  it('SAD: skips empty / whitespace-only text (no blank transcript lines)', () => {
    // WHEN: STT emits an empty final, or a turn is whitespace only.
    const rec = new TranscriptRecorder();
    rec.add('user', '');
    rec.add('assistant', '   \n\t ');
    rec.add('user', null);
    rec.add('assistant', undefined);
    rec.add('user', '  trimmed me  ');
    expect(rec.size).toBe(1);
    // leading/trailing whitespace is trimmed on store.
    expect(rec.render()).toBe('Caller: trimmed me');
  });

  it('SAD: truncates an over-cap transcript and marks it, keeping the start', () => {
    // WHEN: a pathological multi-hour call.
    // WHY: voice_sessions.transcript is unbounded TEXT; the recorder caps the
    //      rendered output so the agent never sends (and the schema never
    //      rejects) a multi-MB payload.
    const rec = new TranscriptRecorder();
    // 50k chars of 'a' across one assistant turn, repeated until well over cap.
    for (let i = 0; i < 6; i++) rec.add('assistant', 'a'.repeat(20_000));
    const out = rec.render();
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
    expect(out!.startsWith('Assistant: aaaa')).toBe(true);
    expect(out!.endsWith('[transcript truncated]')).toBe(true);
  });
});
