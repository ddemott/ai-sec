/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import pino from 'pino';

/**
 * Build a Pino logger that always writes JSON to stdout (Railway captures
 * it for the live-tail UI) and optionally forwards to Better Stack when
 * `BETTER_STACK_TOKEN` is set.
 *
 * The transport is opt-in by env var so:
 * - Local dev / `npm test` / `npm run bootstrap` work with no extra
 *   credentials and no network calls from logging.
 * - Token rotation is "unset env var, restart" — no code change.
 * - A token outage / Better Stack downtime never blocks the main thread:
 *   Pino transports run in a worker thread and silently drop events when
 *   the destination is unreachable.
 *
 * Filterable fields baked into every line:
 * - `service` — `secretary-hq-backend` or `secretary-hq-agent` so the same Better Stack
 *   source can host both and a UI filter splits them.
 * - `env` — `production` / `development` / `test`.
 * - `tenant_id` (per-request) — added via Fastify's request-logger child;
 *   `tenantMiddleware` enriches `request.log` with tenant context.
 * - `call_id` — agent worker adds this from LiveKit room metadata.
 */
export function buildLogger(opts: { service: string }) {
  const token = process.env.BETTER_STACK_TOKEN;
  const env = process.env.NODE_ENV ?? 'development';
  const level = process.env.LOG_LEVEL ?? (env === 'production' ? 'info' : 'debug');

  const baseContext = { service: opts.service, env };

  if (!token) {
    return pino({ level, base: baseContext });
  }

  const transport = pino.transport({
    targets: [
      { target: 'pino/file', level, options: { destination: 1 } },
      { target: '@logtail/pino', level, options: { sourceToken: token } },
    ],
  });

  return pino({ level, base: baseContext }, transport);
}
