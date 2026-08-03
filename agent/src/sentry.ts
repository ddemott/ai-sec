/**
 * Sentry error monitoring for the LiveKit agent worker.
 *
 * Same shape as src/services/sentry.ts in the backend so a single DSN
 * can host both services; the `service: secretary-hq-agent` tag separates
 * them in the Sentry UI. Gated by `SENTRY_DSN` — when unset, every
 * export is a no-op so local dev / `npm test` don't make network
 * calls.
 *
 * Errors that escape the agent's `entry` (a TTS failure mid-call, a
 * tool handler throw, a malformed dispatch payload) currently surface
 * only as Pino log lines. Sentry adds grouping, deduplication, and a
 * "alert me when error-rate spikes" signal we don't get from logs.
 *
 * Sentry's default Node integrations install process-level
 * uncaughtException + unhandledRejection handlers — those fire even
 * when no other code path calls captureException.
 */
import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  if (initialized) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
  });

  Sentry.setTag('service', 'secretary-hq-agent');
  initialized = true;
}

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
      if (typeof context.call_id === 'string') {
        scope.setTag('call_id', context.call_id);
      }
    }
    Sentry.captureException(error);
  });
}

/** Test-only — reset the initialization flag. */
export function resetSentryForTesting(): void {
  initialized = false;
}

/** Test-only — read the initialization flag for assertions. */
export function isSentryInitializedForTesting(): boolean {
  return initialized;
}
