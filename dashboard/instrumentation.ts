/**
 * Next.js instrumentation hook — runs on every runtime (Node + Edge)
 * at process start. We use it to initialize Sentry for server-side
 * error capture. Gated by `SENTRY_DSN` so local dev / CI / preview
 * builds without the env var are no-ops.
 *
 * Same opt-in pattern as the backend (`src/services/sentry.ts`) and
 * agent (`agent/src/sentry.ts`). All three services can share one DSN;
 * the `service: secretary-hq-dashboard` tag separates them in the Sentry UI.
 */
import * as Sentry from '@sentry/nextjs';

export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || undefined,
      tracesSampleRate: 0,
      profilesSampleRate: 0,
      initialScope: { tags: { service: 'secretary-hq-dashboard', runtime: 'nodejs' } },
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || undefined,
      tracesSampleRate: 0,
      initialScope: { tags: { service: 'secretary-hq-dashboard', runtime: 'edge' } },
    });
  }
}

// Next.js calls this on uncaught request errors. Without the explicit
// export here, server-side error boundaries silently drop the event.
export const onRequestError = Sentry.captureRequestError;
