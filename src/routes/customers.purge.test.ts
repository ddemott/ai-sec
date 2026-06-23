/**
 * WHO:   POST /customers/:id/purge — GDPR/CCPA "right to erasure" for one customer.
 * WHAT:  owner-only, typed-confirmation (echo the current phone), anonymizes the
 *        customer row IN PLACE and redacts the audit_log PII snapshots for it.
 * WHEN:  a customer exercises their right to erasure and the owner actions it.
 * WHERE: src/routes/customers.ts ('/customers/:id/purge' handler).
 * WHY:   erasure is irreversible and destroys PII; these tests pin the owner
 *        gate, the typed-confirmation guard (wrong phone must NOT purge), the
 *        not-found path, and — critically — that the handler ALSO redacts
 *        audit_log (the audit trigger would otherwise copy the PII into
 *        old_data and defeat the whole erasure).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerCustomerRoutes } from './customers';
import { buildRouteTestApp, type RouteTestAppHandle } from '../test-utils-mock';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CUSTOMER_ID = 'cccccccc-dddd-4eee-8fff-000000000000';
const CURRENT_PHONE = '+15559990000';

let handle: RouteTestAppHandle;
let app: FastifyInstance;

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

const dataQueries = () =>
  handle.queries.filter((q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'));

describe('POST /customers/:id/purge', () => {
  it('HAPPY: owner with matching confirm_phone anonymizes the row AND redacts audit_log', async () => {
    // FIFO mock: (1) SELECT current phone, (2) UPDATE customers, (3) UPDATE audit_log.
    handle.queryResponses.push({ rows: [{ phone: CURRENT_PHONE }] }); // phone lookup
    handle.queryResponses.push({ rows: [], rowCount: 1 }); // anonymize UPDATE
    handle.queryResponses.push({ rows: [], rowCount: 2 }); // audit_log redact

    const res = await app.inject({
      method: 'POST',
      url: `/customers/${CUSTOMER_ID}/purge`,
      payload: { confirm_phone: CURRENT_PHONE },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const q = dataQueries();
    // The anonymize UPDATE nulls PII, tombstones the phone, flips is_deleted.
    const anonymize = q.find((x) => x.text.includes('UPDATE customers'));
    expect(anonymize, 'anonymize UPDATE should run').toBeTruthy();
    expect(anonymize!.text).toContain('name = NULL');
    expect(anonymize!.text).toContain('email = NULL');
    expect(anonymize!.text).toContain("metadata = '{}'::jsonb");
    expect(anonymize!.text).toContain("phone = 'PURGED-' || customer_id::text");
    expect(anonymize!.text).toContain('is_deleted = true');
    expect(anonymize!.params).toEqual([CUSTOMER_ID, TENANT_ID, 'owner@test.local']);

    // The audit_log redact drops the PII payload the trigger captured.
    const redact = q.find((x) => x.text.includes('UPDATE audit_log'));
    expect(redact, 'audit_log redact should run').toBeTruthy();
    expect(redact!.text).toContain('old_data = NULL');
    expect(redact!.text).toContain('new_data = NULL');
    expect(redact!.text).toContain("table_name = 'customers'");
    expect(redact!.params).toEqual([TENANT_ID, CUSTOMER_ID]);
  });

  it('SAD: a non-owner (front_desk) is rejected 403, nothing is purged', async () => {
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
    expect(res.json().success).toBe(false);
    expect(dataQueries().length).toBe(0); // never touched the DB
  });

  it('SAD: a wrong confirm_phone does NOT anonymize (400, no UPDATE)', async () => {
    // WHY: typed-confirmation guard — the row must survive a fat-finger on the
    //      wrong customer. Only the phone lookup runs; no UPDATE.
    handle.queryResponses.push({ rows: [{ phone: CURRENT_PHONE }] }); // phone lookup

    const res = await app.inject({
      method: 'POST',
      url: `/customers/${CUSTOMER_ID}/purge`,
      payload: { confirm_phone: '+15550000000' }, // mismatch
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('does not match');
    const q = dataQueries();
    expect(q.some((x) => x.text.includes('UPDATE customers'))).toBe(false);
    expect(q.some((x) => x.text.includes('UPDATE audit_log'))).toBe(false);
  });

  it('SAD: a missing confirm_phone is rejected 400 before any query', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/customers/${CUSTOMER_ID}/purge`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('confirm_phone');
    expect(dataQueries().length).toBe(0);
  });

  it('SAD: an unknown customer_id is 404 (no UPDATE)', async () => {
    handle.queryResponses.push({ rows: [] }); // phone lookup → not found

    const res = await app.inject({
      method: 'POST',
      url: `/customers/${CUSTOMER_ID}/purge`,
      payload: { confirm_phone: CURRENT_PHONE },
    });

    expect(res.statusCode).toBe(404);
    const q = dataQueries();
    expect(q.some((x) => x.text.includes('UPDATE customers'))).toBe(false);
  });
});
