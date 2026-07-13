/**
 * Strip markdown and stage directions from the LLM's text BEFORE it reaches TTS.
 *
 * WHY THIS EXISTS (the 2026-07-13 call — the owner's verdict was "voice was broken
 * up, did not sound natural"). This is what the model actually emitted:
 *
 *   "Let me check for available slots for a meeting at 3 PM today. Just a moment.
 *
 *    *One moment while I look that up...*
 *
 *    I see that 3 PM is taken."
 *
 * Two separate defects in one turn:
 *
 *   1. MARKDOWN REACHED THE VOICE. The asterisks are literal characters in the
 *      text handed to TTS. gpt-4o-mini-tts does not silently ignore them — they
 *      distort prosody, insert pauses, and can be vocalised. That is the "broken
 *      up, unnatural" sound.
 *
 *   2. IT SAID "one moment" TWICE. Once as speech ("Just a moment"), once as a
 *      markdown stage direction. The caller hears the assistant stalling, then
 *      stalling again, in a different voice-shape.
 *
 * The prompt ALREADY forbade both — "no markdown, no bullet points, no formatting"
 * has been in the Conversation style section the whole time. The model did it
 * anyway.
 *
 * That is the lesson worth keeping: a prompt is a REQUEST. If a class of output
 * must never reach a customer's ear, the pipeline has to make it impossible, not
 * ask nicely. This function is the guarantee.
 *
 * DESIGN CONSTRAINT — this sits on the audio hot path, on every token of every
 * spoken word. It must be cheap, and it must NEVER drop content: a sanitizer that
 * eats a word turns a formatting nit into a comprehension bug, which is far worse
 * than the thing it fixed. So: remove the formatting CHARACTERS, keep every word.
 */

/**
 * Characters that markdown uses for emphasis/structure and that TTS should never
 * see. Deliberately conservative — we strip decoration, never words.
 *
 * NOT stripped: apostrophes, hyphens, and periods (they're part of real speech —
 * "3:30", "don't", "well-known"), and parentheses (a real aside reads fine).
 */
export function sanitizeForSpeech(text: string): string {
  return (
    text
      // Emphasis / code markers: *bold*, _italic_, `code`, ~strike~
      .replace(/[*_`~]/g, '')
      // Heading and blockquote markers, only at the start of a line — a '#' or '>'
      // mid-sentence is real punctuation and stays.
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s+/gm, '')
      // List bullets at the start of a line ("- item", "1. item"). The words stay;
      // only the bullet goes, so a model that lapses into a list still reads as
      // prose instead of announcing "dash".
      .replace(/^\s{0,3}[-+•]\s+/gm, '')
      .replace(/^\s{0,3}\d+[.)]\s+/gm, '')
      // Markdown links: [text](url) → text. The URL is unspeakable; the label is
      // the only part a caller could use.
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Collapse the whitespace all of the above leaves behind. Newlines become
      // spaces: a line break is a visual device with no meaning in speech.
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Stream form, for LiveKit's `ttsNode` — the text arrives as a stream of chunks.
 *
 * IMPORTANT: sanitize per-chunk rather than buffering the whole utterance. TTS is
 * streaming; holding the full text back to clean it would add latency to every
 * reply, and dead air is a worse bug than a stray asterisk (it is the bug this
 * codebase already fought once — see fallback.ts and the watchdog).
 *
 * The cost of per-chunk work is that a marker split ACROSS chunks ("*" then "One
 * moment") can slip through. In practice the model emits punctuation attached to
 * the token that follows it, and a rare surviving asterisk is a far smaller harm
 * than a stall. Correctness here is measured in the caller's ear, not in a diff.
 */
export function sanitizeChunk(chunk: string): string {
  // MUST NOT trim or collapse leading/trailing whitespace: chunks are fragments of
  // one sentence, and the space between them IS the space between words. Trimming
  // per-chunk turns "Hello" + " world" into "Helloworld" — a sanitizer that makes
  // the speech WORSE than the markdown it removed. (I wrote that bug, then caught
  // it here. Hence this comment, and the test that pins it.)
  return (
    chunk
      .replace(/[*_`~]/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // A newline is a visual device with no meaning in speech — but it IS a word
      // boundary, so it becomes a space rather than nothing.
      .replace(/[\r\n]+/g, ' ')
  );
}

export function sanitizeStream(input: ReadableStream<string>): ReadableStream<string> {
  return input.pipeThrough(
    new TransformStream<string, string>({
      transform(chunk, controller) {
        const clean = sanitizeChunk(chunk);
        // Never emit an empty chunk — an empty push is meaningless to TTS and in
        // some engines terminates the utterance early. A chunk that was ONLY a
        // marker ("*") correctly disappears.
        if (clean.length > 0) controller.enqueue(clean);
      },
    })
  );
}
