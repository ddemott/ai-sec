/**
 * Post-call summary via a single cheap OpenAI completion, used in the agent's
 * shutdown hook.
 *
 * SAFETY CONTRACT: this function NEVER throws and ALWAYS returns within
 * timeoutMs. Any failure (no key, empty transcript, network error, timeout,
 * non-200, malformed body) resolves to null. The shutdown hook must be able to
 * `await summarizeCall(...)` and still reliably send voice-session-end with the
 * duration + transcript it already has — a flaky summary can never drop the
 * working call-logging write.
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 8000;

export async function summarizeCall(
  transcript: string,
  apiKey: string,
  opts: { timeoutMs?: number } = {}
): Promise<string | null> {
  if (!transcript || transcript.trim().length === 0) return null;
  if (!apiKey) return null;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Summarize this phone call between a receptionist AI and a caller in 1-2 sentences. State the outcome plainly (booked an appointment / left a message / asked a question / no action). No preamble, no quotes.',
          },
          { role: 'user', content: transcript.slice(0, 8000) },
        ],
        max_tokens: 100,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const content = (data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]
      ?.message?.content;
    const summary = typeof content === 'string' ? content.trim() : '';
    return summary.length > 0 ? summary.slice(0, 2000) : null;
  } catch {
    // Aborted, network error, bad JSON — all degrade to "no summary".
    return null;
  } finally {
    clearTimeout(timer);
  }
}
