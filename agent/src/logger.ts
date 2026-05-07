import pino, { type Logger } from 'pino';

/**
 * Pino logger for the LiveKit agent worker. Same shape as the backend's
 * logger (src/services/logger.ts) so a single Better Stack source can host
 * both services and a UI filter (`service: ai-sec-backend` vs
 * `service: ai-sec-agent`) splits them.
 *
 * Always writes JSON to stdout (Railway captures it). When
 * `BETTER_STACK_TOKEN` is set, also forwards via @logtail/pino. Falls back
 * cleanly to stdout-only when the token is absent — local dev / tests
 * don't need credentials, and a token outage / Better Stack downtime
 * never blocks the agent because Pino transports run in a worker thread.
 *
 * Filterable fields baked in:
 * - `service` — `ai-sec-agent`
 * - `env` — production / development / test
 * - per-call children add `tenant_id` + `call_id` so support can pull a
 *   specific call's full timeline with one filter.
 */
let cached: Logger | null = null;

export function getLogger(): Logger {
  if (cached) return cached;

  const token = process.env.BETTER_STACK_TOKEN;
  const env = process.env.NODE_ENV ?? 'development';
  const level = process.env.LOG_LEVEL ?? (env === 'production' ? 'info' : 'debug');
  const baseContext = { service: 'ai-sec-agent', env };

  if (!token) {
    cached = pino({ level, base: baseContext });
    return cached;
  }

  const transport = pino.transport({
    targets: [
      { target: 'pino/file', level, options: { destination: 1 } },
      { target: '@logtail/pino', level, options: { sourceToken: token } },
    ],
  });

  cached = pino({ level, base: baseContext }, transport);
  return cached;
}

/**
 * Test-only — reset the cached logger so a test that mutates env (e.g.
 * setting `BETTER_STACK_TOKEN`) gets a fresh build on the next call.
 * Production code should never call this.
 */
export function resetLoggerCacheForTesting(): void {
  cached = null;
}
