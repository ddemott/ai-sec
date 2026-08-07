/**
 * Tests for src/services/sentry.ts — env-gating + capture contract.
 *
 * The whole module is gated by `SENTRY_DSN`. Tests verify:
 *  - No DSN → init is a no-op, captureException silently drops events.
 *  - DSN set → init flips the flag, captureException forwards to the SDK.
 *  - Context fields land as scope extras + tags.
 *
 * Mocks `@sentry/node` so no network call happens. The mock collects
 * captured events into a module-local array we can assert against.
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

vi.mock('@sentry/node', () => {
  const Sentry = {
    init: vi.fn(() => {
      initCalls += 1;
    }),
    captureException: vi.fn((err: unknown) => {
      // pendingExtras/pendingTags get reset by withScope; the test fixture
      // pulls them off the per-call temp object.
      captured.push({ err, extras: { ...currentExtras }, tags: { ...currentTags } });
    }),
    setTag: vi.fn((key: string, value: string) => {
      scopeTagsAccum[key] = value;
    }),
    withScope: vi.fn(async (fn: (scope: unknown) => void) => {
      currentExtras = {};
      currentTags = {};
      const scope = {
        setExtra: (k: string, v: unknown) => {
          currentExtras[k] = v;
        },
        setTag: (k: string, v: string) => {
          currentTags[k] = v;
        },
      };
      await fn(scope);
    }),
  };
  return Sentry;
});

let currentExtras: Record<string, unknown> = {};
let currentTags: Record<string, string> = {};

import {
  initSentry,
  captureException,
  resetSentryForTesting,
  isSentryInitializedForTesting,
} from '../../src/services/sentry';

describe('src/services/sentry.ts', () => {
  beforeEach(() => {
    captured.length = 0;
    initCalls = 0;
    scopeTagsAccum = {};
    currentExtras = {};
    currentTags = {};
    delete process.env.SENTRY_DSN;
    resetSentryForTesting();
  });

  describe('initSentry', () => {
    it('SAD: SENTRY_DSN unset — no-op, no init call, captureException drops events', () => {
      // WHO: developer running tests locally / npm run bootstrap
      // WHAT: initSentry called with no env var
      // WHY: a credential-free path so the suite doesn't try to phone home
      initSentry();
      expect(isSentryInitializedForTesting()).toBe(false);
      expect(initCalls).toBe(0);

      captureException(new Error('boom'));
      expect(captured).toHaveLength(0);
    });

    it('HAPPY: SENTRY_DSN set — init runs once, marks initialized', () => {
      // WHO: production / staging
      // WHAT: SENTRY_DSN is set; init should flip the flag
      // WHY: subsequent captureException calls need to actually forward
      process.env.SENTRY_DSN = 'https://fake@sentry.io/12345';
      initSentry({ service: 'secretary-hq-backend' });
      expect(isSentryInitializedForTesting()).toBe(true);
      expect(initCalls).toBe(1);
      expect(scopeTagsAccum.service).toBe('secretary-hq-backend');
    });

    it('HAPPY: initSentry is idempotent — second call is a no-op', () => {
      // WHO: tests / dev tooling that calls init in a loop
      // WHAT: second initSentry call shouldn't re-init the SDK
      // WHY: Sentry SDK's own re-init isn't free; one init per process
      process.env.SENTRY_DSN = 'https://fake@sentry.io/12345';
      initSentry();
      initSentry();
      expect(initCalls).toBe(1);
    });
  });

  describe('captureException', () => {
    it('HAPPY: forwards Error through to Sentry when initialized', () => {
      // WHO: route handler / middleware logError path
      // WHAT: a real Error instance + tenant_id context
      // WHY: pin that the SDK sees both the error and the extras
      process.env.SENTRY_DSN = 'https://fake@sentry.io/12345';
      initSentry();
      const err = new Error('booking failed');
      captureException(err, { tenant_id: 't-123', route: '/appointments/create' });
      expect(captured).toHaveLength(1);
      expect(captured[0].err).toBe(err);
      expect(captured[0].extras.tenant_id).toBe('t-123');
      expect(captured[0].extras.route).toBe('/appointments/create');
      expect(captured[0].tags.tenant_id).toBe('t-123');
      expect(captured[0].tags.route).toBe('/appointments/create');
    });

    it('HAPPY: wraps non-Error argument in Error before capture', () => {
      // WHO: some downstream throws a string / object / null
      // WHAT: captureException should still produce a real Error
      // WHY: Sentry deduplication relies on Error.message + stack
      process.env.SENTRY_DSN = 'https://fake@sentry.io/12345';
      initSentry();
      captureException('plain string thrown', { tenant_id: 't-abc' });
      expect(captured).toHaveLength(1);
      expect(captured[0].err).toBeInstanceOf(Error);
      expect((captured[0].err as Error).message).toBe('plain string thrown');
    });

    it('SAD: silently drops when not initialized', () => {
      // WHO: production missing the env var, or local dev
      // WHAT: captureException called before/without init
      // WHY: nothing should crash; logs still go to Pino as the source of truth
      captureException(new Error('boom'), { tenant_id: 't-xyz' });
      expect(captured).toHaveLength(0);
    });

    it('SAD: handles capture call with no context', () => {
      // WHO: a path that doesn't have route/tenant available
      // WHAT: optional context omitted
      // WHY: extras + tags should both be empty maps, not crash
      process.env.SENTRY_DSN = 'https://fake@sentry.io/12345';
      initSentry();
      captureException(new Error('no context'));
      expect(captured).toHaveLength(1);
      expect(captured[0].extras).toEqual({});
      expect(captured[0].tags).toEqual({});
    });
  });
});
