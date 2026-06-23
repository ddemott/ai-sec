/**
 * WHO:   POST /customers/:id/purge — GDPR/CCPA "right to erasure" for one customer.
 * WHAT:  env kill-switch, owner-only, typed-confirmation (echo current phone),
 *        ATOMIC anonymize + audit_log redact (single transaction), race guard,
 *        and a fail-safe when the audit redact touches nothing.
 * WHEN:  a customer exercises their right to erasure and the owner actions it.
 * WHERE: src/routes/customers.ts ('/customers/:id/purge' handler).
 * WHY:   erasure is irreversible and destroys PII; these tests pin the kill
 *        switch (inert until ENABLE_CUSTOMER_PURGE=true), the owner gate, the
 *        typed-confirmation guard, atomicity (BEGIN/COMMIT), the race rollback,
 *        and — critically — that a 0-row audit redact FAILS the whole purge so
 *        a PII snapshot can never be left behind.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerCustomerRoutes } from './customers';
import { buildRouteTestApp, type RouteTestAppHandle } from '../test-utils-mock';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CUSTOMER_ID = 'cccccccc-dddd-4eee-8fff-000000000000';
const CURRENT_PHONE = '+15559990000';

let handle: RouteTestAppHandle;
let app: FastifyInstance;
let priorEnable: string | undefined;

beforeAll(async () => {
  handle = buildRouteTestApp((a, pool, withTenantClient) => {
    registerCustomerRoutes(a, pool, withTenantClient);
  });
  app = handle.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  priorEnable = process.env.ENABLE_CUSTOMER_PURGE;
  process.env.ENABLE_CUSTOMER_PURGE = 'true'; // on for most tests
  handle.queries.length = 0;
  handle.queryResponses.length = 0;
  handle.tenantIdOverride.current = null;
  handle.auth.current = {
    user_id: '00000000-0000-0000-0000-000000000001',
    tenant_id: TENANT_ID,
    email: 'owner@test.local',
    role: 'owner',
  };
  vi.clearAllMocks();
});

afterEach(() => {
  if (priorEnable === undefined) delete process.env.ENABLE_CUSTOMER_PURGE;
  else process.env.ENABLE_CUSTOMER_PURGE = priorEnable;
});

const dataQueries = () =>
  handle.queries.filter((q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'));

// FIFO transaction script for the happy path: BEGIN, SELECT…FOR UPDATE,
// UPDATE customers, UPDATE audit_log, COMMIT.
function pushHappyTxn() {
  handle.queryResponses.push({ rows: [] }); // BEGIN
  handle.queryResponses.push({ rows: [{ phone: CURRENT_PHONE }] }); // SELECT FOR UPDATE
  handle.queryResponses.push({ rows: [], rowCount: 1 }); // UPDATE customers
  handle.queryResponses.push({ rows: [], rowCount: 2 }); // UPDATE audit_log
  handle.queryResponses.push({ rows: [] }); // COMMIT
}

describe('POST /customers/:id/purge', () => {
  it('SAD: kill-switch off (env unset) → 404, no DB work', async () => {
    delete process.env.ENABLE_CUSTOMER_PURGE;
    const res = await app.inject({
      method: 'POST',
      url: `/customers/${CUSTOMER_ID}/purge`,
      payload: { confirm_phone: CURRENT_PHONE },
    });
    expect(res.statusCode).toBe(404);
    expect(dataQueries().length).toBe(0);
  });

  it('HAPPY: owner + matching phone → atomic anonymize + audit redact', async () => {
    pushHappyTxn();

    const res = await app.inject({
      method: 'POST',
      url: `/customers/${CUSTOMER_ID}/purge`,
      payload: { confirm_phone: CURRENT_PHONE },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const q = dataQueries();
    // Atomicity: wrapped in BEGIN/COMMIT.
    expect(q.some((x) => x.text.trim() === 'BEGIN')).toBe(true);
    expect(q.some((x) => x.text.trim() === 'COMMIT')).toBe(true);
    // Row lock for the race guard.
    expect(q.some((x) => x.text.includes('FOR UPDATE'))).toBe(true);

    const anonymize = q.find((x) => x.text.includes('UPDATE customers'));
    expect(anonymize!.text).toContain('name = NULL');
    expect(anonymize!.text).toContain("phone = 'PURGED-' || customer_id::text");
    expect(anonymize!.text).toContain('is_deleted = true');
    // Guarded on the read phone ($4) to close the SELECT→UPDATE race.
    expect(anonymize!.text).toContain('AND phone = $4');
    expect(anonymize!.params).toEqual([CUSTOMER_ID, TENANT_ID, 'owner@test.local', CURRENT_PHONE]);

    const redact = q.find((x) => x.text.includes('UPDATE audit_log'));
    expect(redact!.text).toContain('old_data = NULL');
    expect(redact!.params).toEqual([TENANT_ID, CUSTOMER_ID]);
  });

  it('SAD: non-owner (front_desk) → 403, no DB work', async () => {
    handle.auth.current = {
      user_id: '00000000-0000-0000-0000-000000000002',
      tenant_id: TENANT_ID,
      email: 'frontdesk@test.local',
      role: 'front_desk',
    };
    const res = await app.inject({
      method: 'POST',
      url: `/customers/${CUSTOMER_ID}/purge`,
      payload: { confirm_phone: CURRENT_PHONE },
    });
    expect(res.statusCode).toBe(403);
    expect(dataQueries().length).toBe(0);
  });

  it('SAD: wrong confirm_phone → 400, ROLLBACK, no UPDATE', async () => {
    handle.queryResponses.push({ rows: [] }); // BEGIN
    handle.queryResponses.push({ rows: [{ phone: CURRENT_PHONE }] }); // SELECT FOR UPDATE
    handle.queryResponses.push({ rows: [] }); // ROLLBACK

    const res = await app.inject({
      method: 'POST',
      url: `/customers/${CUSTOMER_ID}/purge`,
      payload: { confirm_phone: '+15550000000' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('does not match');
    const q = dataQueries();
    expect(q.some((x) => x.text.includes('UPDATE customers'))).toBe(false);
    expect(q.some((x) => x.text.trim() === 'ROLLBACK')).toBe(true);
  });

  it('SAD: missing confirm_phone → 400 before any DB work', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/customers/${CUSTOMER_ID}/purge`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('confirm_phone');
    expect(dataQueries().length).toBe(0);
  });

  it('SAD: unknown customer → 404, ROLLBACK, no UPDATE', async () => {
    handle.queryResponses.push({ rows: [] }); // BEGIN
    handle.queryResponses.push({ rows: [] }); // SELECT FOR UPDATE → not found
    handle.queryResponses.push({ rows: [] }); // ROLLBACK

    const res = await app.inject({
      method: 'POST',
      url: `/customers/${CUSTOMER_ID}/purge`,
      payload: { confirm_phone: CURRENT_PHONE },
    });
    expect(res.statusCode).toBe(404);
    expect(dataQueries().some((x) => x.text.includes('UPDATE customers'))).toBe(false);
  });

  it('FAIL-SAFE: a 0-row audit redact aborts the purge (500 + ROLLBACK, no COMMIT)', async () => {
    // WHY: if the audit trigger snapshot can't be redacted, the PII may still be
    //      present — privacy must fail closed, not report a false success.
    handle.queryResponses.push({ rows: [] }); // BEGIN
    handle.queryResponses.push({ rows: [{ phone: CURRENT_PHONE }] }); // SELECT FOR UPDATE
    handle.queryResponses.push({ rows: [], rowCount: 1 }); // UPDATE customers (ok)
    handle.queryResponses.push({ rows: [], rowCount: 0 }); // UPDATE audit_log → 0 rows!
    handle.queryResponses.push({ rows: [] }); // ROLLBACK

    const res = await app.inject({
      method: 'POST',
      url: `/customers/${CUSTOMER_ID}/purge`,
      payload: { confirm_phone: CURRENT_PHONE },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('audit');
    expect(dataQueries().some((x) => x.text.trim() === 'ROLLBACK')).toBe(true);
    expect(dataQueries().some((x) => x.text.trim() === 'COMMIT')).toBe(false);
  });

  it('RACE: anonymize UPDATE hits 0 rows → 409, ROLLBACK, no audit redact', async () => {
    handle.queryResponses.push({ rows: [] }); // BEGIN
    handle.queryResponses.push({ rows: [{ phone: CURRENT_PHONE }] }); // SELECT FOR UPDATE
    handle.queryResponses.push({ rows: [], rowCount: 0 }); // UPDATE customers → 0 rows (raced)
    handle.queryResponses.push({ rows: [] }); // ROLLBACK

    const res = await app.inject({
      method: 'POST',
      url: `/customers/${CUSTOMER_ID}/purge`,
      payload: { confirm_phone: CURRENT_PHONE },
    });

    expect(res.statusCode).toBe(409);
    expect(dataQueries().some((x) => x.text.includes('UPDATE audit_log'))).toBe(false);
    expect(dataQueries().some((x) => x.text.trim() === 'ROLLBACK')).toBe(true);
  });
});
