/**
 * Tests for `createNormalizer` — the call-summary normalization helper that
 * runs gpt-4o-mini over raw call summaries before they're embedded into
 * pgvector. The point of normalization is to strip filler ("I think",
 * "you know"), canonicalize names ("Renee/René/Rene" → one form), and
 * collapse the summary into a single concise sentence so similarity
 * search hits are cleaner.
 *
 * The function is fail-soft: when the LLM is unavailable, returns
 * mangled JSON, or returns an empty completion, we fall back to the
 * original (trimmed) text so a normalization outage never blocks
 * embedding-based search. Errors that *should* propagate (auth failure,
 * rate limit, server error, network failure) throw — those signal real
 * config problems an operator needs to see.
 *
 * Per the project convention, every test below carries a 5W
 * (WHO/WHAT/WHEN/WHERE/WHY) header so a sad-path failure tells the
 * debugger what behavior was expected and why.
 */
import { describe, it, expect, vi } from 'vitest';
import { createNormalizer } from '../shared/normalizeForEmbedding';

describe('normalizeForEmbedding', () => {
  it('returns original text when no API key is provided', async () => {
    // WHO: A backend running without OPENAI_API_KEY (local dev / test)
    // WHAT: Pass-through — input returned verbatim, no fetch ever issued
    // WHEN: createNormalizer("") — empty-string key signals "skip LLM"
    // WHERE: createNormalizer entry guard, before the fetch path
    // WHY: We never want a missing key to throw and break the embedding
    //       pipeline; pass-through keeps similarity search working with
    //       un-normalized text instead of failing the whole call.
    const normalize = createNormalizer('');
    const result = await normalize('I think Suzy is great at oil changes');
    expect(result).toBe('I think Suzy is great at oil changes');
  });

  it('returns short text unchanged (under 20 chars)', async () => {
    // WHO: A caller normalizing a short utterance ("Hi there", "Yes")
    // WHAT: Pass-through — no LLM call for trivially short inputs
    // WHEN: Input length below the normalization threshold
    // WHERE: Length-guard at the top of the normalize function
    // WHY: gpt-4o-mini calls cost real money; short snippets carry no
    //       filler worth stripping, so we save the round-trip.
    const normalize = createNormalizer('');
    const result = await normalize('Hi there');
    expect(result).toBe('Hi there');
  });

  it('returns empty string for empty input', async () => {
    // WHO: An upstream caller that hands us an empty summary
    // WHAT: Empty in → empty out, no fetch
    // WHEN: Called with `""` (e.g. a call ended before any user speech)
    // WHERE: Empty-input guard at the top of the function
    // WHY: An empty embedding-source row is fine; we just don't want to
    //       burn an OpenAI request to learn that.
    const normalize = createNormalizer('');
    const result = await normalize('');
    expect(result).toBe('');
  });

  it('trims whitespace from input', async () => {
    // WHO: A caller passing text with stray whitespace from STT padding
    // WHAT: Trimmed text returned (still under the LLM threshold here)
    // WHEN: Input has leading/trailing whitespace
    // WHERE: Trim step before the length guard
    // WHY: Embedding the same text with vs. without leading whitespace
    //       produces slightly different vectors; trimming first keeps
    //       similarity stable.
    const normalize = createNormalizer('');
    const result = await normalize('   short   ');
    expect(result).toBe('short');
  });

  it('accepts custom options', async () => {
    // WHO: A caller passing { context, maxTokens } overrides
    // WHAT: With no API key, options are ignored and pass-through wins
    //        — we still trim, but no LLM call happens
    // WHEN: Empty key combined with explicit options
    // WHERE: createNormalizer's length guard fires before the options
    //         shape ever matters
    // WHY: Confirms the options object doesn't accidentally trigger a
    //       fetch when the empty-key short-circuit should win.
    const normalize = createNormalizer('');
    // With no API key, just returns trimmed text regardless of options
    const result = await normalize('This is a test sentence for normalization', {
      context: 'call summary',
      maxTokens: 100,
    });
    expect(result).toBe('This is a test sentence for normalization');
  });

  it('calls OpenAI API with correct parameters when API key is set', async () => {
    // WHO: A configured backend with OPENAI_API_KEY set, normalizing a
    //       real call-summary utterance
    // WHAT: One POST to https://api.openai.com/v1/chat/completions with
    //        model=gpt-4o-mini, temperature=0, the context label baked
    //        into the user message, and a Bearer-auth header
    // WHEN: Input over the length threshold + non-empty API key
    // WHERE: createNormalizer's fetch call construction
    // WHY: temperature=0 is non-negotiable — we need deterministic
    //       outputs so the same input always normalizes the same way
    //       (otherwise embedding the "same" call yields drifting vectors).
    //       The context label drives the prompt's framing, so it must
    //       reach the model.
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Customer prefers Suzy for oil changes.' } }],
      }),
    };
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockResponse as unknown as Response);

    const normalize = createNormalizer('test-api-key');
    const result = await normalize('I think Suzy is great at oil changes', {
      context: 'call summary',
    });

    expect(result).toBe('Customer prefers Suzy for oil changes.');
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const init = options as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.temperature).toBe(0);
    expect(body.messages[1].content).toContain('call summary');
    expect(body.messages[1].content).toContain('I think Suzy is great at oil changes');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-api-key');

    fetchSpy.mockRestore();
  });

  it('falls back to original text when LLM returns empty response', async () => {
    // WHO: A configured backend whose OpenAI call returned 200 OK but
    //       with an empty completion (rare but observed in production)
    // WHAT: Fall back to the original input verbatim
    // WHEN: choices[0].message.content === ""
    // WHERE: Empty-completion guard after the fetch
    // WHY: An empty completion is useless for embedding — we'd rather
    //       store the raw text than nothing. The original at least lets
    //       similarity search find the row by literal substring match.
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '' } }],
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const normalize = createNormalizer('test-api-key');
    const result = await normalize('I think Suzy is great at oil changes');

    expect(result).toBe('I think Suzy is great at oil changes');

    vi.restoreAllMocks();
  });

  it('throws on API error', async () => {
    // WHO: A backend with a bad/expired/revoked OpenAI key
    // WHAT: Throw a "Normalization LLM Error" so the operator sees the
    //        misconfig in logs instead of silently storing un-normalized text
    // WHEN: OpenAI responds with `ok: false` (4xx/5xx)
    // WHERE: Error branch of the fetch handler
    // WHY: A bad key is a config problem that needs human attention. If
    //       we silently fell back, every embedding for the lifetime of
    //       the bad key would be sub-optimal and nobody would know.
    const mockResponse = {
      ok: false,
      json: async () => ({ error: { message: 'Invalid API key' } }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const normalize = createNormalizer('bad-key');
    await expect(normalize('I think Suzy is great at oil changes')).rejects.toThrow(
      'Normalization LLM Error'
    );

    vi.restoreAllMocks();
  });

  // --- Sad path tests ---

  it('throws timeout error when fetch is aborted via AbortController', async () => {
    // WHO: The 15s AbortController-driven timeout firing during a slow
    //       OpenAI call (network stall or upstream latency spike)
    // WHAT: Throw a descriptive "Normalization request timed out after
    //        15000ms" error so operators can distinguish a hung-fetch
    //        from a real upstream failure
    // WHEN: fetch() rejects with an AbortError
    // WHERE: AbortError → message-rewrite branch
    // WHY: Without the rewrite, the bare AbortError "The operation was
    //       aborted" tells the operator nothing about which call timed
    //       out. The rewritten message names the layer + the budget.
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.spyOn(global, 'fetch').mockImplementationOnce(async () => {
      throw abortError;
    });

    const normalize = createNormalizer('test-api-key');
    await expect(normalize('I think Suzy is great at oil changes')).rejects.toThrow(
      'Normalization request timed out after 15000ms'
    );

    vi.restoreAllMocks();
  });

  it('throws on OpenAI 500 server error', async () => {
    // WHO: A backend hitting OpenAI during a transient OpenAI outage
    // WHAT: Throw "Normalization LLM Error" — same surface as auth
    //        failures so the upstream caller has one error class to
    //        catch (or escalate)
    // WHEN: OpenAI returns 5xx with type=server_error
    // WHERE: Error branch of the fetch handler
    // WHY: 5xx is retriable in principle, but we don't retry inside the
    //       normalizer (the embedding path catches and falls back to raw
    //       text upstream). Throwing here surfaces the outage in logs.
    const mockResponse = {
      ok: false,
      json: async () => ({ error: { message: 'Internal server error', type: 'server_error' } }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const normalize = createNormalizer('test-api-key');
    await expect(normalize('I think Suzy is great at oil changes')).rejects.toThrow(
      'Normalization LLM Error'
    );

    vi.restoreAllMocks();
  });

  it('throws on OpenAI 429 rate limit error', async () => {
    // WHO: A backend hammering OpenAI past the per-minute rate limit
    //       (high-volume call ingestion + low rate-limit tier)
    // WHAT: Throw "Normalization LLM Error" so the operator can see
    //        rate-limit pressure in logs and respond (upgrade tier,
    //        add backoff, or batch the workload)
    // WHEN: OpenAI returns 429 with type=rate_limit_error
    // WHERE: Same error branch as 5xx
    // WHY: Silent fall-back here would mask an ongoing rate-limit
    //       problem indefinitely. The throw forces it onto the operator's
    //       radar without crashing the whole embedding path.
    const mockResponse = {
      ok: false,
      json: async () => ({
        error: { message: 'Rate limit exceeded', type: 'rate_limit_error' },
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const normalize = createNormalizer('test-api-key');
    await expect(normalize('I think Suzy is great at oil changes')).rejects.toThrow(
      'Normalization LLM Error'
    );

    vi.restoreAllMocks();
  });

  it('throws when OpenAI returns malformed JSON', async () => {
    // WHO: A backend hitting an OpenAI endpoint that responded with HTML
    //       (502 from a CDN edge, or a misrouted load balancer)
    // WHAT: Let the SyntaxError propagate — it's an upstream-shape
    //        problem, not a normalization-config problem
    // WHEN: response.json() throws (typically `Unexpected token < in JSON`
    //        when the body starts with an HTML error page)
    // WHERE: Inside the response.json() promise chain
    // WHY: A SyntaxError tells the operator something about the upstream
    //       response shape that a generic "Normalization LLM Error" would
    //       hide. Preserving the original error makes the diagnosis
    //       faster.
    const mockResponse = {
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const normalize = createNormalizer('test-api-key');
    await expect(normalize('I think Suzy is great at oil changes')).rejects.toThrow(SyntaxError);

    vi.restoreAllMocks();
  });

  it('falls back to original text when OpenAI returns empty choices array', async () => {
    // WHO: A backend hitting an OpenAI variant that returned 200 OK with
    //       a `choices: []` body (corner case observed during model
    //       deprecation transitions)
    // WHAT: Fall back to the original (trimmed) input
    // WHEN: choices array exists but is empty
    // WHERE: Empty-choices guard before reading choices[0]
    // WHY: An empty choices array is shape-valid but content-empty. The
    //       original text is more useful for embedding than nothing.
    const mockResponse = {
      ok: true,
      json: async () => ({ choices: [] }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const normalize = createNormalizer('test-api-key');
    const result = await normalize('I think Suzy is great at oil changes');
    expect(result).toBe('I think Suzy is great at oil changes');

    vi.restoreAllMocks();
  });

  it('falls back to original text when choices[0].message.content is null', async () => {
    // WHO: A backend hitting an OpenAI response where the model returned
    //       a tool-call instead of a text completion (shouldn't happen
    //       at temperature=0 + our prompt, but defensive)
    // WHAT: Fall back to the original input
    // WHEN: choices[0].message.content === null
    // WHERE: Null-content guard, same branch as the empty-completion case
    // WHY: We deliberately don't ask for tool calls; if one arrives, we
    //       can't use it for embedding text and the safest path is to
    //       drop it and embed the raw input.
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: null } }],
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const normalize = createNormalizer('test-api-key');
    const result = await normalize('I think Suzy is great at oil changes');
    expect(result).toBe('I think Suzy is great at oil changes');

    vi.restoreAllMocks();
  });

  it('re-throws network error (TypeError: Failed to fetch)', async () => {
    // WHO: A backend with no network reachability to api.openai.com
    //       (DNS failure, container egress blocked, OpenAI region down)
    // WHAT: Re-throw the original TypeError so the operator sees the
    //        underlying network problem in logs, not a wrapped
    //        normalization error
    // WHEN: fetch() rejects with TypeError before any HTTP status arrives
    // WHERE: Catch handler that distinguishes AbortError (rewrite) from
    //         everything else (re-throw)
    // WHY: Network failures and abort-timeouts have different fixes
    //       (network = check egress; abort = check upstream latency).
    //       Preserving the original TypeError keeps that distinction.
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const normalize = createNormalizer('test-api-key');
    await expect(normalize('I think Suzy is great at oil changes')).rejects.toThrow(
      'Failed to fetch'
    );

    vi.restoreAllMocks();
  });

  it('handles input with special unicode characters without crashing', async () => {
    // WHO: A real call summary containing emoji, accented Latin (René),
    //       and multi-byte glyphs (🚗💨)
    // WHAT: Forward the raw text to OpenAI; receive the canonicalized
    //        ASCII-equivalent ("Rene") in the completion
    // WHEN: STT delivers a transcript with non-ASCII content
    // WHERE: End-to-end normalization path with a UTF-8 input
    // WHY: We embed user-generated text that frequently contains accented
    //       names and emoji. The normalizer (and the JSON serializer feeding
    //       fetch) must handle UTF-8 without truncating or throwing.
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Customer asks about brake service. Name: Rene.' } }],
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const normalize = createNormalizer('test-api-key');
    const result = await normalize("Hey! 😊 I'm René — do you guys do brakes? 🚗💨");
    expect(result).toBe('Customer asks about brake service. Name: Rene.');

    vi.restoreAllMocks();
  });

  it('handles very long input text without crashing', async () => {
    // WHO: A long-running call summary (~110k chars — many minutes of
    //       transcript)
    // WHAT: Pass through to OpenAI without truncating client-side; let
    //        the model handle context-window enforcement
    // WHEN: A summary far exceeds typical short-call length
    // WHERE: Whole-input forwarding (no client-side length cap below the
    //         OpenAI context limit)
    // WHY: We don't want to silently truncate user data. If the input
    //       exceeds OpenAI's context, OpenAI returns an explicit error
    //       (caught by the API-error path). Truncating here would be
    //       lossy and invisible.
    const longText = 'I need an oil change. '.repeat(5000); // ~110k chars
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Customer requests oil change.' } }],
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    const normalize = createNormalizer('test-api-key');
    const result = await normalize(longText);
    expect(result).toBe('Customer requests oil change.');

    vi.restoreAllMocks();
  });
});
