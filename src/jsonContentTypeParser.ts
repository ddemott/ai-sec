/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * Fastify `application/json` content-type parser.
 *
 * Two responsibilities:
 *  1. Preserve the raw request buffer on `req.rawBody` so webhook routes
 *     (Stripe / Square) can verify HMAC signatures
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
  const text = rawBody.toString('utf8');
  // An empty (or whitespace-only) body with Content-Type: application/json is
  // treated as `{}`, matching express.json(). JSON.parse('') throws, so the
  // pre-2026-07-08 behavior was a cryptic 400 "Invalid JSON" raised before the
  // route ever ran — which is exactly how the production "Try live demo"
  // button broke: it declared the content-type but sent no body. Routes still
  // reject a genuinely empty payload via their own Zod schemas, with an error
  // that names the missing fields.
  //
  // Webhooks: `rawBody` (set above) is always the exact received bytes — empty
  // stays empty — so the verifiers that read it (billing.ts/Stripe, square.ts,
  // communications.ts/Telnyx) fail an empty body instead of being handed a
  // synthesized `{}`. Any new webhook must verify against `req.rawBody`, never
  // against a re-stringified `req.body`: JSON.stringify does not reproduce the
  // sender's key order or whitespace, so the HMAC input would not be the bytes
  // that were signed. (Telnyx did exactly that until 2026-07-09.)
  if (text.trim() === '') {
    done(null, {});
    return;
  }
  try {
    done(null, JSON.parse(text));
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
