/**
 * T-006 — call counters wired to the routes that actually know.
 *
 * WHO: the voice agent, posting voice-session-start / voice-session-end.
 * WHAT: a started call increments calls_total; a FINALIZED call increments
 *       call_outcome_total once and observes its turn-latency samples.
 * WHEN: CI, on every change to routes/agentTools/session.ts.
 * WHERE: the real Fastify routes over a mocked pg client.
 * WHY: three specific ways this goes silently wrong, one test each —
 *      (1) counting the call after the INSERT, so a DB outage stops the
 *      denominator and looks like a quiet hour; (2) counting on every
 *      voice-session-end, which the agent sends TWICE per call (finalize +
 *      enrich), doubling every outcome; (3) dropping turn latency, which the
 *      backend cannot re-derive because it never sees a turn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { registerAgentToolRoutes } from '../../../src/routes/agentTools';
import { registry } from '../../../src/services/metrics';

const TENANT_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const SECRET = 'test-agent-secret';

/** Read a counter series out of the live exposition. */
function counterValue(metric: string, labels: Record<string, string>): number {
  const line = registry
    .expose()
    .split('\n')
    .find(
      (l) =>
        l.startsWith(`${metric}{`) &&
        Object.entries(labels).every(([k, v]) => l.includes(`${k}="${v}"`))
    );
  if (!line) return 0;
  const n = Number(line.trim().split(/\s+/).pop());
  return Number.isFinite(n) ? n : 0;
}

/** Read a histogram's observation count (the `_count` line, unlabeled). */
function histogramCount(metric: string): number {
  const line = registry
    .expose()
    .split('\n')
    .find((l) => l.startsWith(`${metric}_count`));
  if (!line) return 0;
  const n = Number(line.trim().split(/\s+/).pop());
  return Number.isFinite(n) ? n : 0;
}

function buildApp(opts: {
  responses?: Array<{ rows: unknown[]; rowCount?: number }>;
  queryThrows?: (text: string) => Error | null;
}): FastifyInstance {
  const responses = [...(opts.responses ?? [])];
  const mockClient = {
    query: vi.fn(async (text: string) => {
      const thrown = opts.queryThrows?.(typeof text === 'string' ? text : '');
      if (thrown) throw thrown;
      return responses.shift() || { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;

  const withTenantClient = async <T>(
    _tenantId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> => fn(mockClient);

  const app = Fastify({ logger: false });
  registerAgentToolRoutes(app, {} as never, withTenantClient, async () => new Array(1536).fill(0));
  return app;
}

const post = (app: FastifyInstance, path: string, payload: unknown) =>
  app.inject({ method: 'POST', url: path, headers: { 'x-agent-secret': SECRET }, payload });

beforeEach(() => {
  process.env.AGENT_SECRET = SECRET;
  registry.clearAll();
});

afterEach(() => {
  delete process.env.AGENT_SECRET;
  vi.restoreAllMocks();
});

describe('calls_total', () => {
  it('HAPPY: a started session counts once, labelled phone', async () => {
    const app = buildApp({ responses: [{ rows: [{ context: null }] }] });
    await post(app, '/agent-tools/voice-session-start', {
      tenant_id: TENANT_ID,
      call_id: 'SCL_abc123',
      caller_phone: null,
    });
    expect(counterValue('calls_total', { source: 'phone' })).toBe(1);
  });

  it('HAPPY: a browser caller-simulator session is labelled browser, not phone', async () => {
    // sessionContext.ts falls back to `room:<roomName>` when a dispatch has no
    // SIP participant — the browser harness. The label is DERIVED from that,
    // never claimed, so simulator traffic cannot inflate the phone numbers a
    // pricing decision is made from.
    const app = buildApp({ responses: [{ rows: [{ context: null }] }] });
    await post(app, '/agent-tools/voice-session-start', {
      tenant_id: TENANT_ID,
      call_id: 'room:sim-call-1787158785189',
      caller_phone: null,
    });
    expect(counterValue('calls_total', { source: 'browser' })).toBe(1);
    expect(counterValue('calls_total', { source: 'phone' })).toBe(0);
  });

  it('SAD: the call is still counted when start_voice_session throws', async () => {
    // THE POINT OF THE TEST. Increment after the INSERT and a database outage
    // silences the denominator, so "the DB is down" and "nobody called" render
    // as the same flat line. The call arrived; count it.
    const app = buildApp({
      responses: [],
      queryThrows: (text) =>
        text.includes('start_voice_session') ? new Error('db unreachable') : null,
    });
    const res = await post(app, '/agent-tools/voice-session-start', {
      tenant_id: TENANT_ID,
      call_id: 'SCL_dead',
      caller_phone: null,
    });
    // The route reports the failure (500, and the agent treats it as non-fatal
    // so the live call continues) — and the call is on the books either way.
    expect(res.statusCode).toBe(500);
    expect(counterValue('calls_total', { source: 'phone' })).toBe(1);
  });
});

describe('call_outcome_total + turn_latency_ms', () => {
  it('HAPPY: a finalized call records its outcome and every latency sample', async () => {
    const app = buildApp({ responses: [{ rows: [{ ended: true }] }] });
    const res = await post(app, '/agent-tools/voice-session-end', {
      tenant_id: TENANT_ID,
      call_id: 'SCL_abc123',
      duration_seconds: 124,
      outcome: 'booked',
      transcript: 'Caller [0:03]: hi\nAssistant [0:05]: hello',
      turn_latency_ms: [820, 1400, 3100],
    });
    expect(res.statusCode).toBe(200);
    expect(counterValue('call_outcome_total', { outcome: 'booked' })).toBe(1);
    expect(histogramCount('turn_latency_ms')).toBe(3);
  });

  it('HAPPY: a call with no outcome lands in `unknown`, not a missing series', async () => {
    const app = buildApp({ responses: [{ rows: [{ ended: true }] }] });
    await post(app, '/agent-tools/voice-session-end', {
      tenant_id: TENANT_ID,
      call_id: 'SCL_noout',
      duration_seconds: 30,
      transcript: 'Caller [0:03]: hi',
    });
    expect(counterValue('call_outcome_total', { outcome: 'unknown' })).toBe(1);
  });

  it('SAD: the enrich pass does not double-count the same call', async () => {
    // The agent posts voice-session-end TWICE — a finalize pass, then an enrich
    // pass carrying the summary. end_voice_session returns ended:false the
    // second time (the row is already closed), and that false is the only thing
    // standing between one call and two counted outcomes.
    const app = buildApp({
      responses: [{ rows: [{ ended: true }] }, { rows: [{ ended: false }] }],
    });
    const payload = {
      tenant_id: TENANT_ID,
      call_id: 'SCL_twice',
      duration_seconds: 60,
      outcome: 'message',
      transcript: 'Caller [0:03]: hi',
      turn_latency_ms: [900],
    };
    await post(app, '/agent-tools/voice-session-end', payload);
    await post(app, '/agent-tools/voice-session-end', { ...payload, summary: 'Took a message.' });
    expect(counterValue('call_outcome_total', { outcome: 'message' })).toBe(1);
    expect(histogramCount('turn_latency_ms')).toBe(1);
  });

  it('SAD: a call that measured no turns observes nothing rather than a zero', async () => {
    // A silent hang-up has no turns. Recording a 0ms sample would pull the p95
    // down and make the dead-air alert quieter exactly when calls are failing.
    const app = buildApp({ responses: [{ rows: [{ ended: true }] }] });
    await post(app, '/agent-tools/voice-session-end', {
      tenant_id: TENANT_ID,
      call_id: 'SCL_silent',
      duration_seconds: 8,
      outcome: 'no_answer',
    });
    expect(histogramCount('turn_latency_ms')).toBe(0);
    expect(counterValue('call_outcome_total', { outcome: 'no_answer' })).toBe(1);
  });

  it('SAD: more than 100 latency samples is rejected at the schema, not truncated silently', async () => {
    // The cap exists in two places on purpose (agent collector + Zod). If the
    // agent ever exceeds it, the call must fail loudly here rather than write a
    // partial distribution that reads as a complete one.
    const app = buildApp({ responses: [{ rows: [{ ended: true }] }] });
    const res = await post(app, '/agent-tools/voice-session-end', {
      tenant_id: TENANT_ID,
      call_id: 'SCL_flood',
      duration_seconds: 60,
      outcome: 'booked',
      turn_latency_ms: new Array(101).fill(500),
    });
    expect(res.json().success).toBe(false);
    expect(histogramCount('turn_latency_ms')).toBe(0);
  });
});
