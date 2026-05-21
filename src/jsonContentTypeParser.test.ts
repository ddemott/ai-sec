/**
 * Unit tests for the production application/json content-type parser.
 *
 * WHO: every JSON-body POST/PUT/PATCH across the API (login, bookings,
 *      webhooks — literally all of them)
 * WHAT: parser preserves rawBody, parses valid JSON via done(null, body),
 *       and rejects invalid JSON via done(Error) — never a sync return
 * WHEN: every request with Content-Type: application/json
 * WHERE: src/jsonContentTypeParser.ts, registered in src/index.ts
 * WHY: a require-await lint sweep (eb65fd7, 2026-05-19) stripped `async`
 *      from this parser, turning it into a sync `return` that left Fastify
 *      waiting on done() forever — hanging EVERY JSON POST in production.
 *      The route-test harness (test-utils-mock.ts) registers a SEPARATE
 *      async parser, so it never exercised this code path and could not
 *      catch the regression. These tests pin the done()-callback contract
 *      against the real production function so the footgun can't return.
 */
import { describe, it, expect, vi } from 'vitest';
import { jsonContentTypeParser } from './jsonContentTypeParser';

describe('jsonContentTypeParser', () => {
  it('HAPPY: parses valid JSON and returns it via done(null, body)', () => {
    const req: { rawBody?: Buffer } = {};
    const raw = Buffer.from(JSON.stringify({ email: 'a@b.com', n: 7 }), 'utf8');
    const done = vi.fn();

    jsonContentTypeParser(req, raw, done);

    // done() MUST be called exactly once (sync return would never call it →
    // Fastify hangs). First arg null = no error; second = parsed object.
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(null, { email: 'a@b.com', n: 7 });
  });

  it('HAPPY: preserves the exact raw bytes on req.rawBody (webhook signature integrity)', () => {
    // WHY: webhook HMAC checks verify against the bytes received; the parser
    //      must not re-stringify. Pin that rawBody is the untouched buffer.
    const req: { rawBody?: Buffer } = {};
    const raw = Buffer.from('{"a":1,  "b":  2}', 'utf8'); // irregular whitespace
    const done = vi.fn();

    jsonContentTypeParser(req, raw, done);

    expect(req.rawBody).toBe(raw); // same buffer reference, not a copy
    expect(req.rawBody?.toString('utf8')).toBe('{"a":1,  "b":  2}');
  });

  it('SAD: invalid JSON returns done(Error("Invalid JSON")) — not a throw, not a hang', () => {
    const req: { rawBody?: Buffer } = {};
    const raw = Buffer.from('{not valid json', 'utf8');
    const done = vi.fn();

    // Must not throw synchronously — the error travels through done().
    expect(() => jsonContentTypeParser(req, raw, done)).not.toThrow();
    expect(done).toHaveBeenCalledTimes(1);
    const [err, body] = done.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Invalid JSON');
    // Tagged 400 so the global handler returns a client error, not a 500
    // that would pollute 5xx/errors_total alerting.
    expect((err as Error & { statusCode?: number }).statusCode).toBe(400);
    expect(body).toBeUndefined();
    // rawBody is still preserved even on parse failure (set before parsing).
    expect(req.rawBody).toBe(raw);
  });

  it('SAD: empty body is invalid JSON → done(Error), still no throw', () => {
    // WHY: an empty Content-Type: application/json POST must not crash the
    //      parser; JSON.parse('') throws → must be funneled through done().
    const req: { rawBody?: Buffer } = {};
    const done = vi.fn();

    jsonContentTypeParser(req, Buffer.from('', 'utf8'), done);

    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
