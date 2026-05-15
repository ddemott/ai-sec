/**
 * Tests for agent/src/sentry.ts — env-gating + capture contract.
 * Mirrors src/services/sentry.test.ts in the backend.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type CapturedEvent = {
  err: unknown;
  extras: Record<string, unknown>;
  tags: Record<string, string>;
};

const captured: CapturedEvent[] = [];
let scopeTagsAccum: Record<string, string> = {};
let initCalls: number = 0;
let currentExtras: Record<string, unknown> = {};
let currentTags: Record<string, string> = {};

vi.mock('@sentry/node', () => {
  const Sentry = {
    init: vi.fn(() => {
      initCalls += 1;
    }),
    captureException: vi.fn((err: unknown) => {
      captured.push({ err, extras: { ...currentExtras }, tags: { ...currentTags } });
    }),
    setTag: vi.fn((key: string, value: string) => {
      scopeTagsAccum[key] = value;
    }),
    withScope: vi.fn(async (fn: (scope: unknown) => void) => {
      currentExtras = {};
      currentTags = {};
      const scope = {
        setExtra: (k: string, v: unknown) => { currentExtras[k] = v; },
        setTag: (k: string, v: string) => { currentTags[k] = v; },
      };
      await fn(scope);
    }),
  };
  return Sentry;
});

import { initSentry, captureException, resetSentryForTesting, isSentryInitializedForTesting } from './sentry.js';

describe('agent/src/sentry.ts', () => {
  beforeEach(() => {
    captured.length = 0;
    initCalls = 0;
    scopeTagsAccum = {};
    currentExtras = {};
    currentTags = {};
    delete process.env.SENTRY_DSN;
    resetSentryForTesting();
  });

  it('SAD: SENTRY_DSN unset — no-op, no init call, captureException drops events', () => {
    // WHO: agent running locally / under `npm test`
    // WHAT: initSentry called with no env var
    // WHY: agent test suite must run with zero external credentials
    initSentry();
    expect(isSentryInitializedForTesting()).toBe(false);
    expect(initCalls).toBe(0);
    captureException(new Error('boom'));
    expect(captured).toHaveLength(0);
  });

  it('HAPPY: SENTRY_DSN set — init runs once, tags with service=ai-sec-agent', () => {
    // WHO: production agent worker
    // WHAT: SENTRY_DSN is set on the Railway ai-sec-agent service
    // WHY: agent-side errors need the service tag to separate them
    //      from backend errors in the same Sentry project
    process.env.SENTRY_DSN = 'https://fake@sentry.io/12345';
    initSentry();
    expect(isSentryInitializedForTesting()).toBe(true);
    expect(initCalls).toBe(1);
    expect(scopeTagsAccum.service).toBe('ai-sec-agent');
  });

  it('HAPPY: captureException forwards call_id + tenant_id as both extras and tags', () => {
    // WHO: a tool handler or fallback path mid-call
    // WHAT: captureException with call context
    // WHY: support needs to filter Sentry events by call_id to match
    //      a specific reported incident; tenant_id is the natural
    //      cross-call grouping for "which tenant has the failure pattern"
    process.env.SENTRY_DSN = 'https://fake@sentry.io/12345';
    initSentry();
    const err = new Error('tool call failed');
    captureException(err, { tenant_id: 't-123', call_id: 'c-abc', tool: 'book-appointment' });
    expect(captured).toHaveLength(1);
    expect(captured[0].extras.tenant_id).toBe('t-123');
    expect(captured[0].extras.call_id).toBe('c-abc');
    expect(captured[0].extras.tool).toBe('book-appointment');
    expect(captured[0].tags.tenant_id).toBe('t-123');
    expect(captured[0].tags.call_id).toBe('c-abc');
  });

  it('HAPPY: wraps non-Error argument in Error before capture', () => {
    process.env.SENTRY_DSN = 'https://fake@sentry.io/12345';
    initSentry();
    captureException('plain string thrown');
    expect(captured).toHaveLength(1);
    expect(captured[0].err).toBeInstanceOf(Error);
    expect((captured[0].err as Error).message).toBe('plain string thrown');
  });

  it('SAD: silently drops when not initialized', () => {
    captureException(new Error('boom'), { tenant_id: 't-xyz' });
    expect(captured).toHaveLength(0);
  });

  it('HAPPY: initSentry is idempotent', () => {
    process.env.SENTRY_DSN = 'https://fake@sentry.io/12345';
    initSentry();
    initSentry();
    expect(initCalls).toBe(1);
  });
});
