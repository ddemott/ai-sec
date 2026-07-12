/**
 * Tests for the session-start CRM prefetch.
 *
 * WHY this is critical coverage: this lookup sits on the critical path to the
 * greeting. Every failure mode here has to degrade to "greet without context",
 * never to a throw and never to a long wait — a throw propagates out of `entry`
 * and kills the LiveKit job (dead air), and a hang IS dead air. So the sad paths
 * below (5xx, timeout, malformed body) matter more than the happy one.
 */
import { describe, it, expect, vi } from 'vitest';
import { fetchCustomerContext } from './customerContext.js';
import type { ToolsClient, ToolResponse } from './toolsClient.js';

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const CALLER_PHONE = '+15551234567';

/** WHO: the backend. Mocked at the client boundary — no HTTP in unit tests. */
function makeClient(response: ToolResponse | (() => Promise<ToolResponse>)) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const client = {
    call: vi.fn(async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body });
      return typeof response === 'function' ? response() : response;
    }),
  } as unknown as ToolsClient;
  return { client, calls };
}

describe('fetchCustomerContext', () => {
  // HAPPY PATH — WHAT: a returning caller with saved preferences. WHY: this is
  // the whole point of the prefetch; the result feeds the prompt's
  // "# Who you're speaking to" section before the agent's first word.
  it('returns the caller record when the backend knows them', async () => {
    const { client, calls } = makeClient({
      ok: true,
      result: {
        name: 'Dale',
        history: 'Booked a cut on May 2; asked about color pricing',
        preferences: { preferred_stylist: 'Maria', last_service: 'balayage' },
      },
    });

    const result = await fetchCustomerContext(client, TENANT_ID, CALLER_PHONE);

    expect(result).toEqual({
      name: 'Dale',
      history: 'Booked a cut on May 2; asked about color pricing',
      preferences: { preferred_stylist: 'Maria', last_service: 'balayage' },
    });
    // WHERE: the same route the get_customer_context tool uses, so the prefetch
    // and the tool can never return differently-shaped context.
    expect(calls[0].path).toBe('/agent-tools/customer-context');
    expect(calls[0].body).toEqual({ tenant_id: TENANT_ID, phone: CALLER_PHONE });
  });

  // WHAT: blocked / withheld caller ID (or a forwarded line the guards nulled).
  // WHY: there is nothing to key the lookup on, so we must not spend a
  // round-trip — the prompt's blocked-caller path collects a number verbally.
  it('skips the round-trip entirely when there is no caller phone', async () => {
    const { client, calls } = makeClient({ ok: true, result: {} });

    const result = await fetchCustomerContext(client, TENANT_ID, null);

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  // SAD PATH — WHAT: an unknown caller. The route answers with the literal
  // STRING 'New caller - no history found.', not an object. WHY: if we trusted
  // the shape we'd bake a "# Who you're speaking to: undefined" section into the
  // prompt and the agent would greet a first-time caller as a regular.
  it('treats the unknown-caller string result as no context', async () => {
    const { client } = makeClient({ ok: true, result: 'New caller - no history found.' });

    expect(await fetchCustomerContext(client, TENANT_ID, CALLER_PHONE)).toBeNull();
  });

  // SAD PATH — WHAT: a row exists but carries nothing worth saying. WHY: a
  // section that says 'Name: Unknown, preferences: none' is noise that spends
  // prompt tokens and invites the model to claim familiarity it doesn't have.
  it('returns null when the record has neither a usable name nor preferences', async () => {
    const { client } = makeClient({
      ok: true,
      result: { name: 'Unknown', history: 'No history', preferences: {} },
    });

    expect(await fetchCustomerContext(client, TENANT_ID, CALLER_PHONE)).toBeNull();
  });

  // SAD PATH — WHAT: backend 5xx / 401 / unreachable. WHY: a config blip or a
  // deploy must never hang up a live caller. Degrade to "no context" and let
  // the model call get_customer_context itself.
  it('returns null (never throws) when the backend fails', async () => {
    const { client } = makeClient({ ok: false, error: 'Backend returned 503', status: 503 });

    await expect(fetchCustomerContext(client, TENANT_ID, CALLER_PHONE)).resolves.toBeNull();
  });

  // SAD PATH — WHAT: the client itself throws (network stack blew up). WHY:
  // ToolsClient normally resolves failures, but a throw here would propagate out
  // of `entry` and kill the job → dead air. Belt and braces.
  it('returns null when the client throws', async () => {
    const client = {
      call: vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    } as unknown as ToolsClient;

    await expect(fetchCustomerContext(client, TENANT_ID, CALLER_PHONE)).resolves.toBeNull();
  });

  // SAD PATH, THE IMPORTANT ONE — WHAT: the backend is slow (pool saturation,
  // cold start). WHEN: before the greeting. WHY: every ms here is silence on the
  // caller's ear. The deadline must win the race and let the greeting proceed;
  // the in-flight request is abandoned, not awaited.
  it('gives up at the deadline instead of delaying the greeting', async () => {
    const { client } = makeClient(
      () =>
        new Promise<ToolResponse>((resolve) =>
          setTimeout(() => resolve({ ok: true, result: { name: 'Too Late' } }), 5000)
        )
    );

    const result = await fetchCustomerContext(client, TENANT_ID, CALLER_PHONE, { timeoutMs: 20 });

    expect(result).toBeNull();
  });
});
