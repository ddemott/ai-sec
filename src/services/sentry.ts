/**
 * Sentry error monitoring for the backend Fastify service.
 *
 * Gated by `SENTRY_DSN` — when unset, every export here is a no-op so
 * local dev / `npm test` / `npm run bootstrap` don't need credentials
 * and don't make network calls. Same opt-in pattern as the Pino +
 * `BETTER_STACK_TOKEN` wiring in `src/services/logger.ts`.
 *
 * Scope:
 * - Errors only. `tracesSampleRate: 0` and `profilesSampleRate: 0` so we
 *   don't pay for performance monitoring overhead. The metrics module
 *   (`src/services/metrics.ts`) already covers latency/throughput; this
 *   layer is for "alert me when error-rate spikes."
 * - Auto-installs process-level handlers (uncaughtException +
 *   unhandledRejection) — Sentry's default integrations cover those.
 * - Tagged with `service: ai-sec-backend` so when the agent (which
 *   uses the same DSN) sends events, a single Sentry UI filter splits
 *   them.
 *
 * `captureException` is the one place the rest of the codebase calls.
 * It's safe to call before init (silently drops the event); safe to
 * call when DSN is unset (no-op); safe to call with a non-Error
 * argument (wraps in Error first).
 */
import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry(opts: { service?: string } = {}): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  if (initialized) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    // The default integrations include uncaughtException +
    // unhandledRejection handlers — those will fire even if no other
    // code path calls captureException.
  });

  Sentry.setTag('service', opts.service || 'ai-sec-backend');
  initialized = true;
}

/**
 * Capture an error to Sentry. No-op when DSN is unset or init hasn't
 * run. Safe to call from anywhere — middleware, route handler, worker.
 *
 * `context` is merged into the event as a "extra" key block — use it
 * for things that aren't already auto-tagged (tenant_id, call_id,
 * route, customer_id, etc.).
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  const error = err instanceof Error ? err : new Error(String(err));
  Sentry.withScope((scope) => {
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        scope.setExtra(k, v);
      }
      if (typeof context.tenant_id === 'string') {
        scope.setTag('tenant_id', context.tenant_id);
      }
      if (typeof context.route === 'string') {
        scope.setTag('route', context.route);
      }
    }
    Sentry.captureException(error);
  });
}

/**
 * Test-only — reset the initialization flag so a test that mutates
 * `SENTRY_DSN` can re-init in the next call. Production code should
 * never call this.
 */
export function resetSentryForTesting(): void {
  initialized = false;
}

/**
 * Test-only — read the initialization flag for assertions.
 */
export function isSentryInitializedForTesting(): boolean {
  return initialized;
}
