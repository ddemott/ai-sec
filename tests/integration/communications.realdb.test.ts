/**
 * Real-DB companion for GET /communications/history.
 *
 * Motivation (docs/TEST_DB_AUDIT.md): the history read is a tenant-scoped query
 * with a conditional channel filter (`$2 = 'all' OR channel = $2`), a
 * conditional delivery-status filter (`$3 = 'all' OR status = $3`), a
 * `COUNT(*) OVER()` total, and LIMIT/OFFSET pagination. A mock can't prove the
 * filter partitions rows, the window total is right, or pagination pages. This
 * suite seeds a known communications_history set and asserts the query.
 *
 * 5W for sad-path failures:
 *   WHO  — an owner reviewing sent emails/SMS
 *   WHAT — GET /communications/history?type=&limit=&offset=
 *   WHEN — communications history page load
 *   WHERE — communications.ts SELECT … COUNT(*) OVER() … channel filter
 *   WHY  — a wrong filter/total misreports what was actually sent
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Client, type PoolClient, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerCommunicationRoutes } from '../../src/routes/communications';

type TenantRequest = FastifyRequest & {
  tenantId?: string;
  auth?: { tenant_id: string; user_id: string; email: string; role: 'owner' | 'front_desk' };
};

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
const tenantsToClean: string[] = [];

async function seedComm(
  channel: 'email' | 'sms',
  recipient: string,
  opts: { status?: 'sent' | 'failed' | 'queued'; error?: string } = {}
): Promise<void> {
  await setup.query(
    `INSERT INTO communications_history
       (tenant_id, channel, direction, recipient, subject, body, status, error)
     VALUES ($1, $2, 'outbound', $3, 'hi', 'body', $4, $5)`,
    [tenantId, channel, recipient, opts.status ?? 'sent', opts.error ?? null]
  );
}

function history(qs: string) {
  return app.inject({
    method: 'GET',
    url: `/communications/history${qs}`,
    headers: { 'x-tenant-id': tenantId },
  });
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });

    app = Fastify({ logger: false });
    app.addHook('preHandler', async (request: TenantRequest) => {
      const tid = request.headers['x-tenant-id'] as string | undefined;
      if (tid) {
        request.tenantId = tid;
        request.auth = {
          tenant_id: tid,
          user_id: '44444444-4444-4444-8444-444444444444',
          email: 'realdb-comms@example.com',
          role: 'owner',
        };
      }
    });
    const withTenantClient = createWithTenantClient(pool);
    registerCommunicationRoutes(
      app,
      pool,
      withTenantClient as <T>(id: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
    );
    await app.ready();

    tenantId = await createTenant(setup, 'Comms History Tenant', 'salon');
    tenantsToClean.push(tenantId);
    // 3 email + 2 sms (all 'sent') + 1 failed sms carrying provider error
    // detail — the failed-delivery drill-down fixture. Total = 6.
    await seedComm('email', 'a@x.test');
    await seedComm('email', 'b@x.test');
    await seedComm('email', 'c@x.test');
    await seedComm('sms', '+15550000001');
    await seedComm('sms', '+15550000002');
    await seedComm('sms', '+15550000003', {
      status: 'failed',
      error: 'Carrier rejected: destination unreachable (30003)',
    });

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[communications.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

describe('GET /communications/history → real DB', () => {
  it('HAPPY: type=all returns every row with total=6', async () => {
    const res = await history('?type=all');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(6);
    expect(body.history).toHaveLength(6);
  });

  it('HAPPY: the channel filter partitions rows (type=sms → only the 3 sms)', async () => {
    const res = await history('?type=sms');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.history.every((r: { channel: string }) => r.channel === 'sms')).toBe(true);
  });

  it('HAPPY: pagination — limit=2&offset=0 returns 2 rows but total still reflects the full set (COUNT OVER)', async () => {
    // WHY: total_count comes from COUNT(*) OVER(), so it must be the unpaged
    // total (6), not the page size (2) — the classic window-vs-limit trap.
    const res = await history('?type=all&limit=2&offset=0');
    const body = res.json();
    expect(body.history).toHaveLength(2);
    expect(body.total).toBe(6);
  });

  it('HAPPY: status=failed returns only the failed row, with the provider error detail', async () => {
    // WHO: an owner drilling into failed deliveries (dashboard "Failed only")
    // WHAT: ($3 = 'all' OR status = $3) partitions on the real status column;
    //       the row carries the `error` text recorded at send time
    // WHEN: the failed-delivery drill-down loads
    // WHERE: GET /communications/history?status=failed, communications.ts
    // WHY: without the error detail the owner sees "failed" with no way to know
    //      why — the exact actionability gap this filter closes
    const res = await history('?status=failed');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({
      channel: 'sms',
      recipient: '+15550000003',
      status: 'failed',
      error: 'Carrier rejected: destination unreachable (30003)',
    });
  });

  it('HAPPY: status filter composes with the channel filter (type=sms&status=sent → 2 rows)', async () => {
    // WHY: both predicates are independent AND guards; a bug that made one
    // clobber the other would show failed rows under "sent" or vice versa.
    const res = await history('?type=sms&status=sent');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(
      body.history.every(
        (r: { channel: string; status: string }) => r.channel === 'sms' && r.status === 'sent'
      )
    ).toBe(true);
  });

  it('SAD: another tenant sees none of these rows (tenant scoping)', async () => {
    const other = await createTenant(setup, 'Comms Other Tenant', 'salon');
    tenantsToClean.push(other);
    const res = await app.inject({
      method: 'GET',
      url: '/communications/history?type=all',
      headers: { 'x-tenant-id': other },
    });
    expect(res.json().total).toBe(0);
  });
});
