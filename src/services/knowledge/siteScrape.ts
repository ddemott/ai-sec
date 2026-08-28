/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
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

export type AddressLookup = (hostname: string) => Promise<string[]>;

const BLOCKED_NETS = new BlockList();
BLOCKED_NETS.addSubnet('0.0.0.0', 8, 'ipv4');
BLOCKED_NETS.addSubnet('10.0.0.0', 8, 'ipv4');
BLOCKED_NETS.addSubnet('100.64.0.0', 10, 'ipv4');
BLOCKED_NETS.addSubnet('127.0.0.0', 8, 'ipv4');
BLOCKED_NETS.addSubnet('169.254.0.0', 16, 'ipv4');
BLOCKED_NETS.addSubnet('172.16.0.0', 12, 'ipv4');
BLOCKED_NETS.addSubnet('192.168.0.0', 16, 'ipv4');
BLOCKED_NETS.addSubnet('::', 128, 'ipv6');
BLOCKED_NETS.addSubnet('::1', 128, 'ipv6');
BLOCKED_NETS.addSubnet('fc00::', 7, 'ipv6');
BLOCKED_NETS.addSubnet('fe80::', 10, 'ipv6');
// Do not add ::ffff:0:0/96. Node's BlockList then treats every IPv4 as
// blocked (8.8.8.8 included). IPv4-mapped v6 still matches the IPv4
// rules above when checked as ipv6 — pinned in siteScrapeUrlGuard.test.ts.

async function defaultAddressLookup(hostname: string): Promise<string[]> {
  const results = await dnsLookup(hostname, { all: true });
  return results.map((r) => r.address);
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function ipv4Mapped(host: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

function isBlockedAddress(address: string): boolean {
  const host = stripBrackets(address);
  const mapped = ipv4Mapped(host);
  if (mapped) return isBlockedAddress(mapped);
  const version = isIP(host);
  if (version === 4) return BLOCKED_NETS.check(host, 'ipv4');
  if (version === 6) return BLOCKED_NETS.check(host, 'ipv6');
  return false;
}

function isBlockedHostname(host: string): boolean {
  const h = stripBrackets(host).toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  return isBlockedAddress(h);
}

/**
 * Refuse anything the website scan must not fetch: non-http(s) schemes,
 * loopback / private / link-local literals, and hostnames that resolve there.
 * Lookup is injected so tests can pin DNS without touching the network.
 */
export async function assertSafeSiteFetchUrl(
  raw: string,
  lookup: AddressLookup = defaultAddressLookup
): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'Invalid or unreachable URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'URL must be http or https' };
  }
  if (!url.hostname || isBlockedHostname(url.hostname)) {
    return { ok: false, error: 'URL host is not allowed' };
  }
  const host = stripBrackets(url.hostname);
  if (!isIP(host)) {
    let addresses: string[];
    try {
      addresses = await lookup(host);
    } catch {
      return { ok: false, error: 'Invalid or unreachable URL' };
    }
    if (!addresses.length || addresses.some((addr) => isBlockedAddress(addr))) {
      return { ok: false, error: 'URL host is not allowed' };
    }
  }
  return { ok: true, url };
}

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
  startUrl: string,
  lookup: AddressLookup = defaultAddressLookup
): Promise<{ success: true; text: string } | { success: false; error: string }> {
  try {
    const startGate = await assertSafeSiteFetchUrl(startUrl, lookup);
    if (!startGate.ok) return { success: false, error: startGate.error };

    const origin = startGate.url.origin;
    const visited = new Set<string>();
    const pages: string[] = [];
    const queue = [startUrl];
    const maxPages = 6;
    const maxLenPerPage = 8000;

    while (queue.length && pages.length < maxPages) {
      const u = queue.shift()!;
      if (visited.has(u)) continue;
      const pageGate = await assertSafeSiteFetchUrl(u, lookup);
      if (!pageGate.ok) continue;
      visited.add(u);
      try {
        const resp = await fetchWithTimeout(
          u,
          {
            headers: { 'User-Agent': 'SecretaryHQ-Bot/1.0' },
            redirect: 'manual',
          },
          8000
        );
        const location =
          resp.status >= 300 && resp.status < 400 && typeof resp.headers?.get === 'function'
            ? resp.headers.get('location')
            : null;
        if (location) {
          try {
            const abs = new URL(location, u).toString();
            if (!visited.has(abs)) queue.unshift(abs);
          } catch {
            // skip malformed Location
          }
          continue;
        }
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

/**
 * A Q&A the model found on the site that no bank or custom question asked for.
 * Shaped like a matched answer minus the question id — there is no question to
 * point at, which is precisely what makes it "discovered".
 */
export interface DiscoveredAnswer {
  question: string;
  answer: string;
  sourceUrl: string;
  confidence: number;
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
      discovered: DiscoveredAnswer[];
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
