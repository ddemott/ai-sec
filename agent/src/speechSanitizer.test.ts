/**
 * The audio hot path. Every token of every spoken word goes through this, so the
 * tests care about two things in this order:
 *
 *   1. NEVER MANGLE SPEECH. A sanitizer that eats a word, or glues two together,
 *      turns a formatting nit into a comprehension bug — far worse than the thing
 *      it fixed. (I wrote exactly that bug: the first version trimmed each chunk,
 *      which would have turned "Hello" + " world" into "Helloworld". Caught before
 *      it shipped, and pinned here so it stays caught.)
 *   2. Then: no markdown reaches TTS.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeForSpeech, sanitizeChunk, sanitizeStream } from './speechSanitizer.js';

async function collect(chunks: string[]): Promise<string> {
  const input = new ReadableStream<string>({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  });
  const out: string[] = [];
  const reader = sanitizeStream(input).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out.join('');
}

describe('speech sanitizer — markdown must never reach the voice', () => {
  it('SAD: the exact 2026-07-13 utterance is cleaned', () => {
    // WHO: every caller. WHAT: the model emitted markdown stage directions.
    // WHY: the owner said "voice was broken up, did not sound natural" — the
    //      asterisks are literal characters handed to TTS, which distorts prosody
    //      and inserts pauses. This is that exact string.
    const said =
      'Just a moment.\n\n*One moment while I look that up...*\n\nI see that 3 PM is taken.';
    const spoken = sanitizeForSpeech(said);

    expect(spoken).not.toContain('*');
    expect(spoken).toContain('One moment while I look that up');
    expect(spoken).toContain('3 PM');
  });

  it('strips emphasis, code and strike markers but keeps every word', () => {
    expect(sanitizeForSpeech('We have *2* or `3:30` with ~Carlos~ and _Maria_')).toBe(
      'We have 2 or 3:30 with Carlos and Maria'
    );
  });

  it('turns a lapsed list into prose instead of announcing "dash"', () => {
    expect(sanitizeForSpeech('- 2:00 PM\n- 3:30 PM')).toBe('2:00 PM 3:30 PM');
    expect(sanitizeForSpeech('1. Haircut\n2. Color')).toBe('Haircut Color');
  });

  it('speaks a link label, never a URL', () => {
    expect(sanitizeForSpeech('Use [this link](https://x.example/abc?t=9) to reschedule.')).toBe(
      'Use this link to reschedule.'
    );
  });

  it('HAPPY: real speech is left completely alone', () => {
    // WHY: the failure mode that matters most. Apostrophes, hyphens, colons and
    //      parentheses are all PART OF SPEECH — "don't", "well-known", "3:30".
    //      A sanitizer that touches them is worse than the bug it fixes.
    const real = "You're all set for 3:30 with Carlos — it's a 30-minute cut (our most popular).";
    expect(sanitizeForSpeech(real)).toBe(real);
  });
});

describe('streaming — words must not be glued together', () => {
  it('SAD: chunk boundaries preserve the space between words (the bug I nearly shipped)', async () => {
    // WHO: every caller. WHAT: TTS receives text as a STREAM of fragments.
    // WHY: my first version called the trimming sanitizer per-chunk, which would
    //      have turned "Hello" + " world" into "Helloworld" — making the voice
    //      WORSE than the markdown it was removing. This test is why that is not
    //      what shipped.
    expect(await collect(['Hello', ' world', ' — 3:30', ' works.'])).toBe(
      'Hello world — 3:30 works.'
    );
  });

  it('strips markers across a streamed utterance', async () => {
    expect(await collect(['Just a moment. ', '*One moment', ' while I look', ' that up...*'])).toBe(
      'Just a moment. One moment while I look that up...'
    );
  });

  it('a chunk that was ONLY a marker disappears without emitting an empty chunk', async () => {
    // WHY: an empty push is meaningless to TTS and in some engines ends the
    //      utterance early — which would cut the caller off mid-sentence.
    expect(await collect(['Booked', '*', ' for 3:30.'])).toBe('Booked for 3:30.');
  });

  it('newlines become spaces — a line break is a word boundary, not silence', () => {
    expect(sanitizeChunk('3:30\nor 4:00')).toBe('3:30 or 4:00');
  });
});

/**
 * The STREAMING path is the one that runs in production. Raised in review on #253:
 * sanitizeChunk stripped only emphasis, while sanitizeForSpeech (used by nothing on
 * the hot path) stripped headings and bullets too.
 *
 * A sanitizer whose REAL path is weaker than its TESTED path is worse than no
 * sanitizer, because it looks covered. These tests exercise the path that ships.
 */
describe('streaming path strips EVERYTHING the one-shot path does', () => {
  it('SAD: a lapsed bullet list is not read out as "dash, dash, dash"', async () => {
    expect(await collect(['I have:\n', '- 2:00 PM\n', '- 3:30 PM'])).toBe(
      'I have: 2:00 PM 3:30 PM'
    );
  });

  it('SAD: a numbered list loses its numbering markers', async () => {
    expect(await collect(['Options:\n1. Haircut\n', '2. Color'])).toBe('Options: Haircut Color');
  });

  it('SAD: heading and blockquote markers never reach TTS', async () => {
    expect(await collect(['## Hours\n', '> We are open 1 to 5.'])).toBe(
      'Hours We are open 1 to 5.'
    );
  });

  it('HAPPY: a hyphen INSIDE speech survives — it is a word, not a bullet', async () => {
    // WHY: the failure mode that matters. "30-minute" and "well-known" must not be
    //      mangled by a rule aimed at list bullets.
    expect(await collect(['It is a 30-minute cut', ' — very popular.'])).toBe(
      'It is a 30-minute cut — very popular.'
    );
  });
});
