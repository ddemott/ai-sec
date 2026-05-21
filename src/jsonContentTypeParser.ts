/**
 * Fastify `application/json` content-type parser.
 *
 * Two responsibilities:
 *  1. Preserve the raw request buffer on `req.rawBody` so webhook routes
 *     (Stripe / HubSpot / Square / Jobber) can verify HMAC signatures
 *     against the exact bytes received — re-stringifying parsed JSON would
 *     change whitespace/key-order and break signature checks.
 *  2. Parse the JSON body and hand it back via the `done` callback.
 *
 * Why a `done` callback and not a sync return: a Fastify content-type
 * parser MUST be either async (return a promise) or call `done(err, body)`.
 * A plain synchronous `return value` leaves Fastify waiting on `done()`
 * forever, hanging EVERY JSON-body POST. A `require-await` lint sweep
 * (eb65fd7, 2026-05-19) stripped the `async` keyword here and assumed a
 * sync return would work as it does for route handlers — it does not.
 * Extracted from index.ts 2026-05-21 so the contract is unit-testable
 * (the route-test harness uses a separate async parser, so it never
 * exercised this production code path).
 */
export function jsonContentTypeParser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify content-parser types require raw request access for rawBody
  req: any,
  rawBody: Buffer,
  done: (err: Error | null, body?: unknown) => void
): void {
  req.rawBody = rawBody;
  try {
    done(null, JSON.parse(rawBody.toString('utf8')));
  } catch {
    // Tag the error 400: malformed JSON is a CLIENT error. Without an
    // explicit statusCode the global error handler defaults to 500, which
    // (a) misreports client garbage as a server fault and (b) pollutes the
    // 5xx / errors_total alerting that real incidents rely on. (2026-05-21)
    const err = new Error('Invalid JSON') as Error & { statusCode?: number };
    err.statusCode = 400;
    done(err);
  }
}
