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
