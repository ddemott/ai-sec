/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
/*
 * The disable above is carried over verbatim from src/routes/knowledge.ts,
 * where this code lived. It is NOT an endorsement: the OpenAI response is
 * handled as `any`, which is exactly the shape that lets a provider change slip
 * through typecheck. Tightening it is real work with real risk, and doing it
 * inside an extraction would mean changing types and moving code in one diff —
 * the same mistake as changing behaviour under cover of a refactor. Left as-is
 * so this commit proves only that the code MOVED.
 */
/**
 * Website-scrape and LLM-extraction helpers for knowledge onboarding.
 *
 * Extracted from src/routes/knowledge.ts (2026-08-21). These are the parts of
 * that file that are not routing at all: fetch a page, pull readable prose from
 * it, and ask a model to turn that prose into question/answer pairs.
 *
 * WHY THE TIMEOUT IS NOT OPTIONAL. Every outbound call here is bounded by an
 * AbortController, matching the discipline the rest of the codebase applies to
 * OpenAI calls. A scan reaches a URL the OWNER supplied — an arbitrary
 * third-party host this system does not control. Unbounded, one slow or hung
 * page holds the request open, and with it a Postgres pool slot, for as long as
 * that remote server feels like being quiet. The pool is `max: 10`, so ten such
 * pages is the entire backend.
 */
// ── Website scrape helpers for onboarding (item 10) ─────────────────────

// Bound every outbound call in the scan path so a slow/hung site page or a slow
// OpenAI response can't hold a request (and a pool slot) open indefinitely —
// same AbortController discipline the rest of the codebase uses on OpenAI calls.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAndExtractSiteText(
  startUrl: string
): Promise<{ success: true; text: string } | { success: false; error: string }> {
  try {
    const origin = new URL(startUrl).origin;
    const visited = new Set<string>();
    const pages: string[] = [];
    const queue = [startUrl];
    const maxPages = 6;
    const maxLenPerPage = 8000;

    while (queue.length && pages.length < maxPages) {
      const u = queue.shift()!;
      if (visited.has(u)) continue;
      visited.add(u);
      try {
        const resp = await fetchWithTimeout(
          u,
          {
            headers: { 'User-Agent': 'SecretaryHQ-Bot/1.0' },
            redirect: 'follow',
          },
          8000
        );
        if (!resp.ok) continue;
        const html = await resp.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, maxLenPerPage);
        if (text.length > 200) pages.push(text);
        const links = Array.from(html.matchAll(/href=["']([^"']+)["']/gi)).map((m) => m[1]);
        for (const l of links) {
          try {
            const abs = new URL(l, origin).toString();
            if (
              abs.startsWith(origin) &&
              !visited.has(abs) &&
              /about|faq|service|contact|polic|price|home|index/i.test(abs)
            ) {
              queue.push(abs);
            }
          } catch {
            // skip malformed href
          }
        }
      } catch {
        // skip unreachable page
      }
    }
    if (pages.length === 0)
      return {
        success: false,
        error: 'Could not extract readable text from the site (may be JS-heavy or protected).',
      };
    return { success: true, text: pages.join('\n\n---PAGE---\n\n') };
  } catch (e: any) {
    return { success: false, error: 'Invalid or unreachable URL: ' + (e.message || e) };
  }
}

export async function extractAnswersWithLLM(
  siteText: string,
  questions: Array<{ id: string | null; question: string }>,
  baseUrl: string,
  apiKey: string
): Promise<
  | {
      success: true;
      answers: Array<{
        questionId: string | null;
        question: string;
        answer: string | null;
        sourceUrl: string;
        confidence: number;
      }>;
      discovered: Array<any>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }
  | { success: false; error: string }
> {
  if (!apiKey) return { success: false, error: 'OPENAI_API_KEY not configured' };

  const qList = questions
    .map((q, i) => `${i + 1}. ${q.id ? `[${q.id}] ` : ''}${q.question}`)
    .join('\n');

  const prompt = `You are a precise business policy extractor. 
Given the cleaned text from a small business website below, answer ONLY the listed questions with direct or closely paraphrased info from the text. 
If a question is not addressed on the site, return null for answer.
Also extract any other policy-like topics not in the list as "discovered".
Output STRICT JSON only:
{
  "answers": [ { "questionId": "id or null for discovered", "question": "the question text", "answer": "string or null", "sourceUrl": "best matching page url or the input url", "confidence": 0.0-1.0 } ],
  "discovered": [ { "question": "new topic question", "answer": "...", "sourceUrl": "...", "confidence": 0.0-1.0 } ]
}
Site text (truncated if long):
${siteText.slice(0, 12000)}

Questions:
${qList}

Return only the JSON.`;

  try {
    const resp = await fetchWithTimeout(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 3000,
          response_format: { type: 'json_object' },
        }),
      },
      30000
    );
    // Surface OpenAI failures (401 bad key, 429 rate limit, 5xx) as an error
    // instead of silently parsing the error body to {} and returning an empty
    // "successful" extraction — which would look like "scanned, found nothing".
    if (!resp.ok) {
      return { success: false, error: `OpenAI extract failed: HTTP ${resp.status}` };
    }
    const data: any = await resp.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const answers = (parsed.answers || []).map((a: any) => ({
      questionId: a.questionId || null,
      question: a.question,
      answer: a.answer || null,
      sourceUrl: a.sourceUrl || baseUrl,
      confidence: typeof a.confidence === 'number' ? a.confidence : 0.5,
    }));
    const discovered = (parsed.discovered || []).map((d: any) => ({
      question: d.question,
      answer: d.answer,
      sourceUrl: d.sourceUrl || '',
      confidence: d.confidence || 0.5,
    }));
    return { success: true, answers, discovered, usage: data.usage };
  } catch (e: any) {
    return { success: false, error: 'LLM extract failed: ' + (e.message || e) };
  }
}
