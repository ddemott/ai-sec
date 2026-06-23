/**
 * Tests for the LiveKit agent's HTTP client that calls /agent-tools/* on
 * the Fastify backend. Fetch is mocked; we never hit a real network.
 *
 * Happy + sad paths with 5W diagnostics per test.
 */
import { describe, it, expect } from 'vitest';
import { ToolsClient, type ToolResponse } from './toolsClient.js';

const BACKEND = 'http://localhost:4001';
const SECRET = 'test-secret-32-chars-minimum-xxxxx';

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue = [...responses];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error('mockFetch: no more responses queued');
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  return { fetchImpl, calls };
}

describe('ToolsClient.call', () => {
  it('HAPPY: success envelope → { ok: true, result }', async () => {
    // WHO: Worker asking the backend for the tenant's service catalog
    // WHAT: Client strips the envelope and returns the inner `result`,
    //        callers never have to deal with `success: true` boilerplate
    // WHY: Tool handlers read .ok directly; forcing them to peel the
    //        envelope at every call site would bloat tool handler code
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { success: true, result: { services: ['oil change'] } } },
    ]);
    const client = new ToolsClient({ backendUrl: BACKEND, agentSecret: SECRET, fetchImpl });

    const res: ToolResponse<{ services: string[] }> = await client.call(
      '/agent-tools/service-catalog',
      { tenant_id: 'abc' }
    );

    expect(res).toEqual({ ok: true, result: { services: ['oil change'] } });
    // WHY: Verify URL + auth header match contract. If the backend ever
    //       tightens auth, this test catches header drift immediately.
    expect(calls[0].url).toBe(`${BACKEND}/agent-tools/service-catalog`);
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-agent-secret']).toBe(SECRET);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ tenant_id: 'abc' });
  });

  it('HAPPY: conversational failure (success:false, HTTP 200) → { ok: false, error, errorCode }', async () => {
    // WHO: Booking RPC returned TIMESLOT_OCCUPIED for a just-taken slot
    // WHAT: Backend sends HTTP 200 + success:false on purpose so the LLM
    //        relays the message; client must NOT treat this as an HTTP
    //        error — it's a first-class response type
    // WHY: If we ever treat 200+success:false as a throw, the LLM loses
    //        the ability to speak the explanation to the caller
    const { fetchImpl } = mockFetch([
      {
        status: 200,
        body: {
          success: false,
          error: 'That time slot just got booked.',
          error_code: 'TIMESLOT_OCCUPIED',
        },
      },
    ]);
    const client = new ToolsClient({ backendUrl: BACKEND, agentSecret: SECRET, fetchImpl });

    const res = await client.call('/agent-tools/book-with-scheduling', {});

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('That time slot just got booked.');
      expect(res.errorCode).toBe('TIMESLOT_OCCUPIED');
    }
  });

  it('SAD: 401 unauthorized → client-friendly error about AGENT_SECRET', async () => {
    // WHO: AGENT_SECRET drifted between worker and backend (e.g., Railway
    //       env rotation that only hit one service)
    // WHAT: Client surfaces a config-specific message so the operator can
    //        diagnose quickly instead of staring at a generic 401
    // WHY: This is the most common "why isn't the voice AI working"
    //        symptom — make it self-describing in logs
    const { fetchImpl } = mockFetch([
      { status: 401, body: { success: false, error: 'Unauthorized' } },
    ]);
    const client = new ToolsClient({ backendUrl: BACKEND, agentSecret: SECRET, fetchImpl });

    const res = await client.call('/agent-tools/service-catalog', {});

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('AGENT_SECRET');
      expect(res.status).toBe(401);
    }
  });

  it('SAD: 500 backend error surfaces status + message', async () => {
    // WHO: Backend crashed mid-call (DB connection lost, OOM, etc.)
    // WHAT: Client returns a structured failure so the LLM can say
    //        "something's wrong on our end" instead of silently hanging
    const { fetchImpl } = mockFetch([{ status: 500, body: { error: 'Internal Server Error' } }]);
    const client = new ToolsClient({ backendUrl: BACKEND, agentSecret: SECRET, fetchImpl });

    const res = await client.call('/agent-tools/service-catalog', {});

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('500');
      expect(res.status).toBe(500);
    }
  });

  it('SAD: network error (fetch throws) → { ok: false } with message', async () => {
    // WHO: Backend process restarted mid-call; socket refused connection
    // WHAT: Client must not propagate the exception — tool handlers
    //        expect a ToolResponse, not a throw
    const fetchImpl: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const client = new ToolsClient({ backendUrl: BACKEND, agentSecret: SECRET, fetchImpl });

    const res = await client.call('/agent-tools/service-catalog', {});

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('ECONNREFUSED');
    }
  });

  it('SAD: timeout aborts and returns structured error', async () => {
    // WHO: Backend route is slow (e.g., Telnyx SMS send that takes 6s)
    // WHAT: With a short per-request timeout the client aborts and
    //        returns a distinctive message so ops can tell "slow" apart
    //        from "network down"
    // WHY: Voice UX can't tolerate long dead-air; we'd rather fail fast
    //        and let the LLM say "something's slow, let me try again"
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
        // never resolve → rely on abort
      });
    const client = new ToolsClient({
      backendUrl: BACKEND,
      agentSecret: SECRET,
      fetchImpl,
      timeoutMs: 50,
    });

    const start = Date.now();
    const res = await client.call('/agent-tools/service-catalog', {});
    const elapsed = Date.now() - start;

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('timed out');
      expect(res.error).toContain('50ms');
    }
    // Sanity: the abort fired quickly (give Node scheduler 500ms slack)
    expect(elapsed).toBeLessThan(500);
  });

  it('SAD: unexpected response shape → structured error (never throws)', async () => {
    // WHO: Backend ever drifts from the envelope contract (bug, different
    //       server somehow responding)
    // WHAT: Client returns a clear message instead of crashing the worker
    const { fetchImpl } = mockFetch([{ status: 200, body: { unexpected: 'shape' } }]);
    const client = new ToolsClient({ backendUrl: BACKEND, agentSecret: SECRET, fetchImpl });

    const res = await client.call('/agent-tools/service-catalog', {});

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Unexpected response shape');
    }
  });

  it('HAPPY: READ tool retries once on transient 5xx, then succeeds', async () => {
    // WHO: A read tool (e.g. service-catalog) hits the backend during a
    //       deploy blip — the first request lands on a pod mid-restart (502),
    //       the retry lands on a healthy pod
    // WHAT: With isReadOnly:true the client makes a SECOND attempt and returns
    //        the success envelope from it — the caller never sees the blip
    // WHY: Read tools are safe to retry (no state mutated); a one-shot
    //        transient 5xx shouldn't make the AI tell the caller "something
    //        went wrong" when an immediate retry would have worked
    const { fetchImpl, calls } = mockFetch([
      { status: 502, body: { error: 'Bad Gateway' } },
      { status: 200, body: { success: true, result: { services: ['oil change'] } } },
    ]);
    const client = new ToolsClient({ backendUrl: BACKEND, agentSecret: SECRET, fetchImpl });

    const res = await client.call('/agent-tools/service-catalog', {}, { isReadOnly: true });

    expect(res).toEqual({ ok: true, result: { services: ['oil change'] } });
    // WHY: Exactly two attempts — one retry, not an infinite loop
    expect(calls).toHaveLength(2);
  });

  it('SAD: READ tool retries once, both attempts 5xx → fails with "after 1 read retry"', async () => {
    // WHO: Backend is genuinely down (not a one-pod blip) during a read
    // WHAT: After the single retry also 5xxes, the client gives up and tags
    //        the error so logs show the retry already happened
    // WHY: The "(after 1 read retry)" suffix tells ops the client did its job
    //        and the backend is actually unhealthy — not a missing retry
    const { fetchImpl, calls } = mockFetch([
      { status: 500, body: { error: 'Internal Server Error' } },
      { status: 500, body: { error: 'Internal Server Error' } },
    ]);
    const client = new ToolsClient({ backendUrl: BACKEND, agentSecret: SECRET, fetchImpl });

    const res = await client.call('/agent-tools/service-catalog', {}, { isReadOnly: true });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('500');
      expect(res.error).toContain('after 1 read retry');
      expect(res.status).toBe(500);
    }
    expect(calls).toHaveLength(2);
  });

  it('SAD: MUTATION never retries on 5xx → exactly one attempt, no "read retry" tag', async () => {
    // WHO: A booking call (book-with-scheduling) gets a 500 — the request may
    //       have ALREADY succeeded server-side before the error response
    // WHAT: With isReadOnly omitted (default mutation), the client makes
    //        EXACTLY ONE attempt and surfaces the bare 500
    // WHY: Retrying a write that might have committed risks a DOUBLE-BOOKING.
    //        This is the whole reason the retry is gated on isReadOnly — this
    //        test is the guardrail against someone "helpfully" retrying writes
    const { fetchImpl, calls } = mockFetch([
      { status: 500, body: { error: 'Internal Server Error' } },
    ]);
    const client = new ToolsClient({ backendUrl: BACKEND, agentSecret: SECRET, fetchImpl });

    const res = await client.call('/agent-tools/book-with-scheduling', {});

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('500');
      expect(res.error).not.toContain('read retry');
    }
    // WHY: One call only — if a future change retries mutations this fails
    //       (mockFetch would also throw "no more responses queued")
    expect(calls).toHaveLength(1);
  });

  it('HAPPY: READ tool retries once on a network throw, then succeeds', async () => {
    // WHO: Backend socket drops on the first read attempt (ECONNRESET during
    //       a rolling deploy), recovers immediately after
    // WHAT: The catch-path retry (also gated on isReadOnly) makes a second
    //        attempt and returns its success
    // WHY: A dropped connection is as transient as a 5xx for a read — same
    //        safe-to-retry reasoning
    let attempts = 0;
    const fetchImpl: typeof fetch = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('ECONNRESET');
      return new Response(JSON.stringify({ success: true, result: 'ok' }), { status: 200 });
    };
    const client = new ToolsClient({ backendUrl: BACKEND, agentSecret: SECRET, fetchImpl });

    const res = await client.call('/agent-tools/service-catalog', {}, { isReadOnly: true });

    expect(res).toEqual({ ok: true, result: 'ok' });
    expect(attempts).toBe(2);
  });

  it('SAD: MUTATION never retries on a network throw → exactly one attempt', async () => {
    // WHO: A booking write throws mid-flight (connection refused) — the write
    //       may have reached Postgres before the socket died
    // WHAT: Mutation default makes ONE attempt only and returns the error
    // WHY: Same double-book guard as the 5xx case, but for the throw path
    //       (catch branch checks isReadOnly explicitly at toolsClient.ts:120)
    let attempts = 0;
    const fetchImpl: typeof fetch = async () => {
      attempts += 1;
      throw new Error('ECONNREFUSED');
    };
    const client = new ToolsClient({ backendUrl: BACKEND, agentSecret: SECRET, fetchImpl });

    const res = await client.call('/agent-tools/book-with-scheduling', {});

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('ECONNREFUSED');
    }
    expect(attempts).toBe(1);
  });

  it('HAPPY: normalizes paths — works with or without leading slash', async () => {
    // WHAT: Tool registration in tools.ts defines paths as "/agent-tools/x"
    //        but internal callers sometimes omit the slash; client should
    //        handle both
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { success: true, result: 'ok' } },
      { status: 200, body: { success: true, result: 'ok' } },
    ]);
    const client = new ToolsClient({ backendUrl: BACKEND, agentSecret: SECRET, fetchImpl });

    await client.call('/agent-tools/x', {});
    await client.call('agent-tools/x', {});

    expect(calls[0].url).toBe(`${BACKEND}/agent-tools/x`);
    expect(calls[1].url).toBe(`${BACKEND}/agent-tools/x`);
  });

  it('HAPPY: strips trailing slash from backendUrl so URLs never double-slash', async () => {
    // WHY: Railway internal URLs sometimes come with trailing slashes;
    //       `http://host/` + `/path` = `http://host//path` which some
    //       proxies 404 on. Defensive.
    const { fetchImpl, calls } = mockFetch([
      { status: 200, body: { success: true, result: 'ok' } },
    ]);
    const client = new ToolsClient({
      backendUrl: `${BACKEND}/`,
      agentSecret: SECRET,
      fetchImpl,
    });

    await client.call('/agent-tools/x', {});

    expect(calls[0].url).toBe(`${BACKEND}/agent-tools/x`);
  });
});
