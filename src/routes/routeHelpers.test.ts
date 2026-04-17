/**
 * Tests for routeHelpers — shared route validation, response envelopes, and query parsing.
 * Every test includes 5W diagnostic context explaining the real-world scenario it guards against.
 */
import { describe, it, expect } from 'vitest';
import {
  sendValidationError,
  sendNotFound,
  sendSuccess,
  sendConflict,
  assertRowAffected,
  requireValidUUID,
  parseDateRange,
  parsePagination,
} from './routeHelpers';

// ── Mock Reply ──────────────────────────────────────────────────────

function createMockReply() {
  const reply: any = {
    _status: 200,
    _body: null,
    status(code: number) { reply._status = code; return reply; },
    send(body: unknown) { reply._body = body; return reply; },
  };
  return reply;
}

// ── sendValidationError ─────────────────────────────────────────────

describe('sendValidationError', () => {
  it('HAPPY: sends 400 with Zod issues array so the dashboard can show field-level errors', () => {
    // WHO: tenant admin submitting the employee create form
    // WHAT: Zod rejects the body (e.g. missing required "name")
    // WHEN: POST /employees/create with invalid body
    // WHERE: any route using safeParse → sendValidationError
    // WHY: before this helper, 15+ routes hand-built the same 400 envelope — one typo in any of them
    //      would cause the dashboard to misparse the error and show a generic "Something went wrong"
    const reply = createMockReply();
    const issues = [{ code: 'invalid_type', path: ['name'], message: 'Required' }] as any;
    sendValidationError(reply, issues);
    expect(reply._status).toBe(400);
    expect(reply._body).toEqual({ success: false, error: 'Validation failed', details: issues });
  });

  it('SAD: empty issues array still returns the correct envelope shape', () => {
    // WHO: Zod schema that rejects at the top level (e.g. wrong content-type parsed as empty object)
    // WHAT: issues is [] — no field-level detail, but the envelope must still be { success, error, details }
    // WHEN: POST with Content-Type: text/plain to a JSON endpoint
    // WHERE: sendValidationError called with []
    // WHY: if the envelope shape changes when issues is empty, the dashboard error parser crashes
    //      with "Cannot read property 'map' of undefined" on the details array
    const reply = createMockReply();
    sendValidationError(reply, []);
    expect(reply._status).toBe(400);
    expect(reply._body.success).toBe(false);
    expect(reply._body.details).toEqual([]);
  });
});

// ── sendNotFound ────────────────────────────────────────────────────

describe('sendNotFound', () => {
  it('HAPPY: sends 404 with entity name so the operator knows WHAT was missing', () => {
    // WHO: tenant admin trying to update an employee that was already soft-deleted
    // WHAT: UPDATE returned 0 rows → route calls sendNotFound('Employee')
    // WHEN: POST /employees/:id/update where :id is deleted or wrong tenant
    // WHERE: any route after assertRowAffected fails
    // WHY: before zero-row guards, these routes returned { success: true } with undefined entity data,
    //      causing the dashboard to show a blank detail panel with no error message
    const reply = createMockReply();
    sendNotFound(reply, 'Employee');
    expect(reply._status).toBe(404);
    expect(reply._body).toEqual({ success: false, error: 'Employee not found' });
  });

  it('HAPPY: multi-word entity names render correctly in the error message', () => {
    // WHO: scheduler copying shifts for a week that has no overrides
    // WHAT: sendNotFound('Shift override') must produce "Shift override not found", not garbled text
    // WHEN: PUT /shifts/overrides/:id where the override was already deleted
    // WHERE: sendNotFound with a two-word entity name
    // WHY: if the message template broke on spaces, operators would see confusing error text in the toast
    const reply = createMockReply();
    sendNotFound(reply, 'Shift override');
    expect(reply._body.error).toBe('Shift override not found');
  });
});

// ── sendSuccess ─────────────────────────────────────────────────────

describe('sendSuccess', () => {
  it('HAPPY: wraps entity data in { success: true } envelope for mutations', () => {
    // WHO: dashboard receiving the response after creating an employee
    // WHAT: response body must include success:true plus the created entity
    // WHEN: POST /employees/create succeeds
    // WHERE: sendSuccess(reply, { employee: row })
    // WHY: the dashboard Api client checks `res.success` before updating local state —
    //      if success is missing, the create appears to fail even though the DB write succeeded
    const reply = createMockReply();
    sendSuccess(reply, { employee: { id: '123', name: 'John' } });
    expect(reply._body).toEqual({ success: true, employee: { id: '123', name: 'John' } });
  });

  it('HAPPY: sends bare { success: true } for delete operations with no return data', () => {
    // WHO: dashboard after deleting a skill
    // WHAT: response should be exactly { success: true } with no extra fields
    // WHEN: DELETE /skills/:id succeeds
    // WHERE: sendSuccess(reply) with no data arg
    // WHY: if sendSuccess accidentally sent { success: true, undefined: undefined },
    //      JSON.stringify would include the key and bloat the response
    const reply = createMockReply();
    sendSuccess(reply);
    expect(reply._body).toEqual({ success: true });
    expect(Object.keys(reply._body)).toEqual(['success']);
  });
});

// ── sendConflict ────────────────────────────────────────────────────

describe('sendConflict', () => {
  it('HAPPY: sends 409 with a message the dashboard can show directly to the operator', () => {
    // WHO: super-admin creating a new tenant with a business name that already exists
    // WHAT: pre-check finds duplicate → route calls sendConflict with the reason
    // WHEN: POST /tenants/create with name "DynaTire" when DynaTire already exists
    // WHERE: tenant create route, customer create route (any flow with unique-name constraints)
    // WHY: without a dedicated 409 helper, some routes returned 400 for conflicts and others 500,
    //      making it impossible for the dashboard to distinguish "fix your input" from "server broke"
    const reply = createMockReply();
    sendConflict(reply, 'A tenant with this name already exists');
    expect(reply._status).toBe(409);
    expect(reply._body).toEqual({ success: false, error: 'A tenant with this name already exists' });
  });
});

// ── assertRowAffected ───────────────────────────────────────────────

describe('assertRowAffected', () => {
  it('HAPPY: returns true when UPDATE/DELETE affected at least one row', () => {
    // WHO: employee update route after UPDATE ... RETURNING *
    // WHAT: rowCount=1, rows has the updated entity → handler should continue to send success
    // WHEN: POST /employees/:id/update with a valid, in-scope employee id
    // WHERE: assertRowAffected called right after the query
    // WHY: this is the normal path — just confirming the guard does not block valid mutations
    const reply = createMockReply();
    const res = { rowCount: 1, rows: [{ id: '123' }] };
    expect(assertRowAffected(res, reply, 'Employee')).toBe(true);
    expect(reply._body).toBeNull();
  });

  it('SAD: returns false and sends 404 when zero rows were affected', () => {
    // WHO: tenant admin trying to delete an employee that belongs to a different tenant
    // WHAT: DELETE ... WHERE id=$1 AND tenant_id=$2 matched 0 rows
    // WHEN: DELETE /employees/:id/delete with valid UUID but wrong tenant scope
    // WHERE: assertRowAffected receives { rowCount: 0, rows: [] }
    // WHY: BUG — before this guard, the route returned { success: true } even when nothing was deleted.
    //      The dashboard showed "Employee deleted" toast, but the employee was still visible on refresh.
    //      Operators reported "delete doesn't work" — it was actually a silent cross-tenant no-op.
    const reply = createMockReply();
    const res = { rowCount: 0, rows: [] };
    expect(assertRowAffected(res, reply, 'Employee')).toBe(false);
    expect(reply._status).toBe(404);
    expect(reply._body).toEqual({ success: false, error: 'Employee not found' });
  });

  it('SAD: treats null rowCount with empty rows as zero-affected', () => {
    // WHO: any mutation route running against a Postgres connection pool
    // WHAT: some pg driver versions return null for rowCount on certain query types
    // WHEN: UPDATE with a CTE or complex subquery that confuses the driver's row counter
    // WHERE: assertRowAffected receives { rowCount: null, rows: [] }
    // WHY: if we only checked `rowCount === 0` without handling null, this edge case would
    //      slip through and return success with no entity data — same silent failure bug
    const reply = createMockReply();
    const res = { rowCount: null, rows: [] };
    expect(assertRowAffected(res, reply, 'Resource')).toBe(false);
    expect(reply._status).toBe(404);
  });

  it('HAPPY: trusts rows array when rowCount is null but RETURNING produced results', () => {
    // WHO: mutation route using RETURNING * with a pg driver that sets rowCount to null
    // WHAT: rowCount is null but rows has the returned entity — mutation DID succeed
    // WHEN: UPDATE ... RETURNING * on some pooler configurations (e.g. Supabase session mode)
    // WHERE: assertRowAffected with { rowCount: null, rows: [{...}] }
    // WHY: if we treated null rowCount as always-failed, valid mutations through Supabase pooler
    //      would incorrectly return 404 in production even though the write succeeded
    const reply = createMockReply();
    const res = { rowCount: null, rows: [{ id: 'abc' }] };
    expect(assertRowAffected(res, reply, 'Service')).toBe(true);
  });
});

// ── requireValidUUID ────────────────────────────────────────────────

describe('requireValidUUID', () => {
  it('HAPPY: accepts valid lowercase UUID and lets the handler continue', () => {
    // WHO: dashboard sending an assign request with a service UUID from its local state
    // WHAT: UUID is well-formed → requireValidUUID returns true, no reply sent
    // WHEN: POST /services/:serviceId/employees/:employeeId/assign
    // WHERE: requireValidUUID called for both serviceId and employeeId
    // WHY: confirms the guard does not false-positive on valid input
    const reply = createMockReply();
    expect(requireValidUUID('f234e471-0e60-4163-86c9-93cfd9338e3a', reply, 'serviceId')).toBe(true);
    expect(reply._body).toBeNull();
  });

  it('HAPPY: accepts uppercase UUID (Postgres UUID type is case-insensitive)', () => {
    // WHO: external CRM webhook sending uppercase UUIDs
    // WHAT: uppercase hex should still pass — Postgres treats UUIDs case-insensitively
    // WHEN: any inbound request with uppercase UUID params
    // WHERE: requireValidUUID regex check
    // WHY: if the regex were lowercase-only, legitimate webhook payloads would be rejected at 400
    const reply = createMockReply();
    expect(requireValidUUID('F234E471-0E60-4163-86C9-93CFD9338E3A', reply, 'serviceId')).toBe(true);
  });

  it('SAD: rejects obviously non-UUID string with a message naming the bad param', () => {
    // WHO: attacker or buggy client sending "not-a-uuid" as a path parameter
    // WHAT: requireValidUUID returns false and sends 400 with the param name in the error
    // WHEN: POST /services/not-a-uuid/employees/also-bad/assign
    // WHERE: requireValidUUID for serviceId
    // WHY: without this guard, the non-UUID string would reach the SQL query and either throw
    //      a Postgres "invalid input syntax for type uuid" error (500) or worse, match nothing silently.
    //      The param name in the error message lets the client know WHICH id was bad.
    const reply = createMockReply();
    expect(requireValidUUID('not-a-uuid', reply, 'serviceId')).toBe(false);
    expect(reply._status).toBe(400);
    expect(reply._body).toEqual({ success: false, error: 'Invalid serviceId — must be UUID' });
  });

  it('SAD: rejects empty string — catches missing path params before they hit Postgres', () => {
    // WHO: client with a routing bug that sends an empty string for :employeeId
    // WHAT: empty string fails UUID regex → 400 with "employeeId" in the message
    // WHEN: POST /services/abc/employees//assign (double slash → empty param in some frameworks)
    // WHERE: requireValidUUID('', reply, 'employeeId')
    // WHY: empty string passed to Postgres as a UUID param causes "invalid input syntax" 500 error.
    //      Catching it here gives the client a clear 400 instead of an opaque 500.
    const reply = createMockReply();
    expect(requireValidUUID('', reply, 'employeeId')).toBe(false);
    expect(reply._status).toBe(400);
    expect(reply._body.error).toContain('employeeId');
  });

  it('SAD: rejects UUID with one character missing — near-miss that would corrupt data', () => {
    // WHO: client with a copy-paste error that truncated the UUID by one hex digit
    // WHAT: "f234e471-0e60-4163-86c9-93cfd9338e3" is 35 chars (UUID is 36)
    // WHEN: any endpoint receiving a nearly-valid UUID
    // WHERE: requireValidUUID regex — must match exact 8-4-4-4-12 pattern
    // WHY: Postgres would reject this with a 500 error. Catching it at the route level gives a clean 400.
    const reply = createMockReply();
    expect(requireValidUUID('f234e471-0e60-4163-86c9-93cfd9338e3', reply, 'id')).toBe(false);
    expect(reply._status).toBe(400);
  });
});

// ── parseDateRange ──────────────────────────────────────────────────

describe('parseDateRange', () => {
  it('HAPPY: passes through valid YYYY-MM-DD dates unchanged', () => {
    // WHO: dashboard coverage view requesting a specific date range
    // WHAT: both start_date and end_date are valid ISO dates → return as-is
    // WHEN: GET /coverage?start_date=2026-04-01&end_date=2026-04-30
    // WHERE: parseDateRange in the coverage and calendar routes
    // WHY: confirms the parser does not mutate valid input
    const result = parseDateRange({ start_date: '2026-04-01', end_date: '2026-04-30' });
    expect(result.startDate).toBe('2026-04-01');
    expect(result.endDate).toBe('2026-04-30');
  });

  it('HAPPY: defaults startDate to today when not provided', () => {
    // WHO: dashboard coverage view opening without explicit date params
    // WHAT: no start_date in query → default to today's date
    // WHEN: GET /coverage (no query params)
    // WHERE: parseDateRange({})
    // WHY: without a default, the SQL query would receive NULL for start_date and either
    //      return all rows (performance bomb) or error on the ::DATE cast
    const result = parseDateRange({} as any);
    const today = new Date().toISOString().split('T')[0];
    expect(result.startDate).toBe(today);
    expect(result.endDate).toBeNull();
  });

  it('SAD: falls back to today when startDate is not YYYY-MM-DD format', () => {
    // WHO: client sending a human-readable date string instead of ISO format
    // WHAT: "April 1" does not match the /^\d{4}-\d{2}-\d{2}$/ regex → fall back to today
    // WHEN: GET /coverage?start_date=April%201&end_date=2026-04-30
    // WHERE: parseDateRange regex check
    // WHY: BUG — before this parser existed, analytics.ts passed the raw string to Postgres ::DATE cast.
    //      "April 1" actually parses in Postgres but as current-year, causing the coverage query
    //      to silently return data for the wrong date range. The regex ensures only ISO format passes.
    const result = parseDateRange({ start_date: 'April 1', end_date: '2026-04-30' });
    const today = new Date().toISOString().split('T')[0];
    expect(result.startDate).toBe(today);
    expect(result.endDate).toBe('2026-04-30');
  });

  it('SAD: returns null endDate when format is invalid', () => {
    // WHO: client sending end_date=bad
    // WHAT: invalid endDate → null (no upper bound on the query)
    // WHEN: GET /coverage?start_date=2026-04-01&end_date=bad
    // WHERE: parseDateRange
    // WHY: passing "bad" to Postgres ::DATE would throw "invalid input syntax" (500).
    //      Returning null lets the SQL use a NULL-safe pattern (WHERE date >= $1 AND ($2 IS NULL OR date <= $2))
    const result = parseDateRange({ start_date: '2026-04-01', end_date: 'bad' });
    expect(result.startDate).toBe('2026-04-01');
    expect(result.endDate).toBeNull();
  });
});

// ── parsePagination ─────────────────────────────────────────────────

describe('parsePagination', () => {
  it('HAPPY: parses valid numeric limit and offset from query strings', () => {
    // WHO: dashboard appointments list requesting page 2 (50 items per page)
    // WHAT: limit=50, offset=50 → { limit: 50, offset: 50 }
    // WHEN: GET /appointments?limit=50&offset=50
    // WHERE: parsePagination called at the top of list routes
    // WHY: confirms string-to-number parsing works for normal pagination
    const result = parsePagination({ limit: '50', offset: '50' });
    expect(result).toEqual({ limit: 50, offset: 50 });
  });

  it('HAPPY: provides sensible defaults when no params are sent', () => {
    // WHO: dashboard opening a list view for the first time (no explicit pagination)
    // WHAT: no limit/offset → default to limit=100, offset=0
    // WHEN: GET /customers (no query params)
    // WHERE: parsePagination({})
    // WHY: without defaults, parseInt(undefined) returns NaN, and SQL would get "LIMIT NaN"
    //      which throws a Postgres syntax error (500) instead of returning the first page
    const result = parsePagination({} as any);
    expect(result).toEqual({ limit: 100, offset: 0 });
  });

  it('HAPPY: caps limit at maxLimit to prevent unbounded queries', () => {
    // WHO: attacker or buggy client sending limit=999999
    // WHAT: requested 5000 items → capped to 1000 (default maxLimit)
    // WHEN: GET /customers?limit=5000
    // WHERE: parsePagination Math.min check
    // WHY: without capping, a single request could SELECT 999999 rows, exhausting DB memory
    //      and blocking other queries. This was identified as a performance risk in load testing.
    const result = parsePagination({ limit: '5000', offset: '0' });
    expect(result.limit).toBe(1000);
  });

  it('HAPPY: respects custom defaults for routes with smaller page sizes', () => {
    // WHO: voice history route that shows 25 items per page by default
    // WHAT: caller passes custom { limit: 25, maxLimit: 200 } → defaults to 25 not 100
    // WHEN: GET /voice/history (no limit param, route default is 25)
    // WHERE: parsePagination with custom defaults object
    // WHY: different views need different default page sizes — the helper must not force 100 everywhere
    const result = parsePagination({} as any, { limit: 25, maxLimit: 200 });
    expect(result.limit).toBe(25);
  });

  it('SAD: falls back to default limit when limit is not a number', () => {
    // WHO: client sending limit=abc (non-numeric string)
    // WHAT: parseInt('abc') → NaN → fall back to default 100
    // WHEN: GET /customers?limit=abc
    // WHERE: parsePagination NaN check
    // WHY: without the NaN guard, SQL receives "LIMIT NaN" → Postgres syntax error → 500.
    //      The operator sees "Failed to fetch customers" with no way to fix it.
    const result = parsePagination({ limit: 'abc', offset: '0' });
    expect(result.limit).toBe(100);
  });

  it('SAD: clamps negative offset to 0 to prevent invalid SQL', () => {
    // WHO: client sending offset=-5 (negative number)
    // WHAT: negative offset → clamped to 0
    // WHEN: GET /appointments?offset=-5
    // WHERE: parsePagination offset >= 0 check
    // WHY: Postgres accepts negative OFFSET but returns 0 rows. The operator would see an empty
    //      list and think they have no appointments. Clamping to 0 shows the correct first page.
    const result = parsePagination({ limit: '10', offset: '-5' });
    expect(result.offset).toBe(0);
  });

  it('SAD: treats zero limit as invalid and uses default', () => {
    // WHO: client sending limit=0
    // WHAT: limit=0 means "return nothing" — useless query, so fall back to default
    // WHEN: GET /customers?limit=0
    // WHERE: parsePagination rawLimit > 0 check
    // WHY: SQL "LIMIT 0" is valid but returns empty results. The operator would see an empty list
    //      and file a bug report. Using the default ensures they see actual data.
    const result = parsePagination({ limit: '0', offset: '0' });
    expect(result.limit).toBe(100);
  });
});
