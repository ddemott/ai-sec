/**
 * Post-call WHY classification — for calls that did NOT book and were NOT
 * transferred, classify the *reason* the caller reached out, so the analytics
 * "Why Callers Reached Out" breakdown is meaningful (not just booked/abandoned).
 * Used in the agent shutdown hook alongside summarizeCall.
 *
 * SAFETY CONTRACT (same as callSummary): NEVER throws, ALWAYS resolves within
 * timeoutMs, returns null on any failure. CRITICAL: returns null when the reason
 * is UNCLEAR — a null outcome stays `no_outcome` server-side, which is exactly
 * what /analytics/calls counts as "abandoned". So we classify only when there's
 * a clear reason; we never paper over a genuinely-abandoned call with a guess.
 *
 * Only one of these exact category strings is ever returned (or null):
 */
const CATEGORIES = ['no_availability', 'wrong_service', 'price', 'message', 'info'] as const;
const ALLOWED = new Set<string>(CATEGORIES);

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 3000;

export async function classifyCallOutcome(
  transcript: string,
  apiKey: string,
  opts: { timeoutMs?: number } = {}
): Promise<{ outcome: string | null; usage?: { inputTokens: number; outputTokens: number } }> {
  if (!transcript || transcript.trim().length === 0) return { outcome: null };
  if (!apiKey) return { outcome: null };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

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
              'A caller phoned a service business and did NOT book and was NOT transferred. ' +
              'Classify why they called. Reply with EXACTLY ONE lowercase word, nothing else:\n' +
              '- no_availability: wanted a time/day the business could not offer\n' +
              '- wrong_service: wanted a service the business does not provide\n' +
              '- price: balked at or objected to the price\n' +
              '- message: left a message or asked for a callback\n' +
              '- info: only asked a question (hours, location, directions, general info)\n' +
              '- unclear: none of the above, or the caller hung up / no clear reason',
          },
          { role: 'user', content: transcript.slice(0, 8000) },
        ],
        max_tokens: 4,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { outcome: null };
    const data: any = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') return { outcome: null };
    // Sanitize: lowercase, strip non-letters/underscores, keep only an allowed category.
    const word = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z_]/g, '');
    const outcome = ALLOWED.has(word) ? word : null;
    const usage = data.usage
      ? {
          inputTokens: data.usage.prompt_tokens || 0,
          outputTokens: data.usage.completion_tokens || 0,
        }
      : undefined;
    return { outcome, usage };
  } catch {
    return { outcome: null };
  } finally {
    clearTimeout(timer);
  }
}
