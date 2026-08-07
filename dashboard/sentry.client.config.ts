/**
 * Client-side Sentry initialization. Same opt-in pattern as
 * instrumentation.ts: no DSN means no init means no network calls,
 * which keeps local dev quiet and avoids leaking events when a build
 * is staged without prod credentials.
 *
 * Tagged `service: secretary-hq-dashboard` to match the server-side init.
 * Browser-side errors land in the same Sentry project as backend +
 * agent so a single alert can fire on cross-service error spikes.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    initialScope: { tags: { service: 'secretary-hq-dashboard', runtime: 'browser' } },
  });
}
