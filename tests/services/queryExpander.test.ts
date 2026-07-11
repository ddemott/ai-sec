/**
 * Tests for `createQueryExpander` — the RAG query-expansion helper that runs
 * gpt-4o-mini over a SHORT caller question before it's embedded for KB
 * retrieval. It is the inverse of `createNormalizer`: normalization REDUCES a
 * document to its semantic core (correct for storing docs), but reducing a
 * terse query collapses its signal — "what's your address" became "Address
 * inquiry" and scored BELOW out-of-scope questions. Expansion instead ADDS
 * synonyms / related terms ("address location where located directions") so a
 * vocabulary-gap query can still reach the doc that answers it.
 *
 * Contract difference vs the normalizer: the expander is fully fail-soft —
 * on ANY error (auth, 5xx, rate-limit, timeout, network, malformed JSON) it
 * falls back to the raw query rather than throwing. This runs on the live
 * voice path (policy-answer); an expansion outage must degrade retrieval
 * quality, never fail the call. The raw query still retrieves most topics.
 *
 * Per project convention, every test carries a 5W (WHO/WHAT/WHEN/WHERE/WHY)
 * header so a sad-path failure explains the expected behavior and why.
 */
import { describe, it, expect, vi } from 'vitest';
import { createQueryExpander } from '../../shared/expandQueryForEmbedding';

describe('expandQueryForEmbedding', () => {
  it('returns original text when no API key is provided', async () => {
    // WHO: A backend running without OPENAI_API_KEY (local dev / test)
    // WHAT: Pass-through — input returned verbatim, no fetch ever issued
    // WHEN: createQueryExpander("") — empty-string key signals "skip LLM"
    // WHERE: Entry guard, before the fetch path
    // WHY: A missing key must never break the policy-answer retrieval path;
    //       pass-through keeps similarity search working on the raw query.
    const expand = createQueryExpander('');
    const result = await expand("what's your address");
    expect(result).toBe("what's your address");
  });

  it('expands SHORT queries (no length floor unlike the normalizer)', async () => {
    // WHO: A caller asking a terse vocabulary-gap question ("address")
    // WHAT: Even a sub-20-char query is sent to the LLM and expanded
    // WHEN: A short query + a real API key
    // WHERE: There is deliberately NO length guard (the normalizer skips
    //         <20 chars; the expander must NOT — short queries need it most)
    // WHY: The whole point of expansion is to rescue terse queries that
    //       carry too little signal to retrieve on their own. A length
    //       floor would skip exactly the queries this fix exists for.
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'address location where located directions situated' } }],
      }),
    };
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockResponse as unknown as Response);

    const expand = createQueryExpander('test-api-key');
    const result = await expand("what's your address");

    expect(result).toBe('address location where located directions situated');
    expect(fetchSpy).toHaveBeenCalledOnce();

    fetchSpy.mockRestore();
  });

  it('returns empty string for empty input without calling the LLM', async () => {
    // WHO: An upstream caller handing us an empty question
    // WHAT: Empty in → empty out, no fetch
    // WHEN: Called with `""`
    // WHERE: Empty-input guard at the top of the function
    // WHY: No point burning an OpenAI request to expand nothing.
    const fetchSpy = vi.spyOn(global, 'fetch');
    const expand = createQueryExpander('test-api-key');
    const result = await expand('');
    expect(result).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('trims whitespace from input on the pass-through path', async () => {
    // WHO: A caller passing a query with stray STT whitespace
    // WHAT: Trimmed text returned (no key → pass-through wins)
    // WHEN: Input has leading/trailing whitespace + empty key
    // WHERE: Trim step before the fetch path
    // WHY: Stable embedding input — same query with/without padding must
    //       produce the same vector.
    const expand = createQueryExpander('');
    const result = await expand('   where are you   ');
    expect(result).toBe('where are you');
  });

  it('calls OpenAI with model=gpt-4o-mini, temperature=0, and the context label', async () => {
    // WHO: A configured backend expanding a real caller question
    // WHAT: One POST to chat/completions with the deterministic config and
    //        the context hint baked into the user message + Bearer auth
    // WHEN: A non-empty query + non-empty API key
    // WHERE: The fetch call construction
    // WHY: temperature=0 keeps expansion deterministic so the same query
    //       always embeds the same way (no vector drift between identical
    //       calls). The context label frames the prompt and must reach the
    //       model.
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hours open close schedule when' } }],
      }),
    };
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockResponse as unknown as Response);

    const expand = createQueryExpander('test-api-key');
    const result = await expand('when are you open?', { context: 'customer phone inquiry' });

    expect(result).toBe('hours open close schedule when');
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const init = options as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.temperature).toBe(0);
    expect(body.messages[1].content).toContain('customer phone inquiry');
    expect(body.messages[1].content).toContain('when are you open?');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-api-key');

    fetchSpy.mockRestore();
  });

  it('returns the expansion VERBATIM (does not re-prepend the raw query)', async () => {
    // WHO: Any caller whose query gets expanded
    // WHAT: The function returns exactly the LLM's expansion line, NOT
    //        `${raw} ${expansion}`
    // WHEN: A successful expansion
    // WHERE: The return statement after a non-empty completion
    // WHY: Re-prepending the raw conversational query was measured to HURT
    //       — filler words ("could you tell me") dilute the topical signal
    //       ("what's your address" fell 0.410 → 0.328). The prompt already
    //       preserves key words, so expansion-alone is the validated shape.
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'address location located directions' } }],
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const expand = createQueryExpander('test-api-key');
    const result = await expand('could you tell me your address?');
    expect(result).toBe('address location located directions');
    expect(result).not.toContain('could you tell me'); // raw NOT re-prepended

    vi.restoreAllMocks();
  });

  it('falls back to the raw query when the LLM returns an empty completion', async () => {
    // WHO: A backend whose OpenAI call returned 200 OK but empty content
    // WHAT: Fall back to the original (trimmed) query
    // WHEN: choices[0].message.content === ""
    // WHERE: Empty-completion guard after the fetch
    // WHY: An empty expansion is useless; the raw query still retrieves
    //       most topics, so degrade to it rather than embed nothing.
    const mockResponse = {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const expand = createQueryExpander('test-api-key');
    const result = await expand('can you rotate my tires');
    expect(result).toBe('can you rotate my tires');

    vi.restoreAllMocks();
  });

  it('falls back to the raw query on API error (does NOT throw)', async () => {
    // WHO: A backend with a bad/expired OpenAI key
    // WHAT: Return the raw query — NOT throw (this is the key contract
    //        difference from the normalizer, which throws on API error)
    // WHEN: OpenAI responds with ok:false (4xx/5xx)
    // WHERE: The !response.ok branch
    // WHY: policy-answer runs on the LIVE voice call. A bad key must not
    //       abort the call mid-sentence; degraded retrieval (raw query) is
    //       strictly better than a thrown error the agent can't recover from.
    const mockResponse = {
      ok: false,
      json: async () => ({ error: { message: 'Invalid API key' } }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const expand = createQueryExpander('bad-key');
    const result = await expand("what's your address");
    expect(result).toBe("what's your address"); // raw fallback, no throw

    vi.restoreAllMocks();
  });

  it('falls back to the raw query on a 429 rate-limit response', async () => {
    // WHO: A backend past the OpenAI per-minute rate limit during a call spike
    // WHAT: Raw-query fallback, no throw
    // WHEN: OpenAI returns 429
    // WHERE: Same !response.ok branch as other HTTP errors
    // WHY: Rate-limit pressure must not drop live calls; the call proceeds
    //       on the raw query and the operator sees 429s in upstream metrics.
    const mockResponse = {
      ok: false,
      json: async () => ({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const expand = createQueryExpander('test-api-key');
    const result = await expand('how much is an oil change');
    expect(result).toBe('how much is an oil change');

    vi.restoreAllMocks();
  });

  it('falls back to the raw query on an abort/timeout (does NOT throw)', async () => {
    // WHO: The 15s AbortController timeout firing on a slow OpenAI call
    // WHAT: Raw-query fallback — NOT a thrown timeout error
    // WHEN: fetch() rejects with an AbortError
    // WHERE: The AbortError branch of the catch
    // WHY: A hung expansion call must not stall/kill the live call; we cut
    //       it at 15s and proceed on the raw query.
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      throw abortError;
    });

    const expand = createQueryExpander('test-api-key');
    const result = await expand("what's your address");
    expect(result).toBe("what's your address");

    vi.restoreAllMocks();
  });

  it('falls back to the raw query on a network error (TypeError: Failed to fetch)', async () => {
    // WHO: A backend with no reachability to api.openai.com (egress blocked)
    // WHAT: Raw-query fallback, no throw
    // WHEN: fetch() rejects with a TypeError before any HTTP status
    // WHERE: The non-Abort branch of the catch
    // WHY: Network loss must not fail the call; raw query keeps retrieval
    //       working while the operator investigates egress.
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const expand = createQueryExpander('test-api-key');
    const result = await expand('where are you located');
    expect(result).toBe('where are you located');

    vi.restoreAllMocks();
  });
});
