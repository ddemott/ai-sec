/**
 * Real-DB companion for GET /reminders/delivery-stats.
 *
 * Motivation (docs/TEST_DB_AUDIT.md): the stats handler is a single
 * `COUNT(*) FILTER (WHERE status = … AND sent_at/updated_at > now() - interval)`
 * aggregate over reminder_schedules. The mocked suite asserts the handler
 * queries the table; it cannot prove the FILTER columns exist or that the
 * time-window buckets actually partition rows correctly. This suite seeds a
 * KNOWN set of reminder rows across every status + recency bucket and asserts
 * the exact counts against real Postgres.
 *
 * Strategy: real pg.Pool on API_DB_URL + a preHandler standing in for
 * tenantMiddleware (sets req.tenantId + owner req.auth). Rows are seeded with
 * the root (admin) client so RLS doesn't block the setup INSERTs. Fixtures
 * per-suite, cleaned in afterAll. Skips when DB down; hard-fails under
 * REQUIRE_DB_TESTS=1 (CI).
 *
 * 5W for sad-path failures:
 *   WHO  — an owner watching whether reminders are actually landing
 *   WHAT — GET /reminders/delivery-stats
 *   WHEN — any time
 *   WHERE — reminders.ts COUNT(*) FILTER aggregate over reminder_schedules
 *   WHY  — a wrong FILTER column or bucket boundary silently misreports
 *          delivery health, hiding a broken reminder pipeline
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Client, type PoolClient, Pool } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  createTenant,
  createResource,
  createCustomerFull,
  createAppointment,
  skipIfDbDown,
} from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerReminderRoutes } from '../../src/routes/reminders';

type TenantRequest = FastifyRequest & {
  tenantId?: string;
  auth?: { tenant_id: string; user_id: string; email: string; role: 'owner' | 'front_desk' };
};

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let appointmentId: string;
const tenantsToClean: string[] = [];

function hoursFromNow(h: number): string {
  const QUARTER = 900_000;
  const t = Math.round((Date.now() + h * 3_600_000) / QUARTER) * QUARTER;
  return new Date(t).toISOString();
}

/** Insert one reminder_schedules row with explicit status/timestamps (admin client, bypasses RLS). */
async function seedReminder(opts: {
  type: 'confirmation' | '72h' | '24h' | '2h';
  status: 'scheduled' | 'sent' | 'failed' | 'cancelled';
  daysAgoSent?: number;
  daysAgoUpdated?: number;
}): Promise<void> {
  const sentAt =
    opts.daysAgoSent != null
      ? new Date(Date.now() - opts.daysAgoSent * 86_400_000).toISOString()
      : null;
  const updatedAt =
    opts.daysAgoUpdated != null
      ? new Date(Date.now() - opts.daysAgoUpdated * 86_400_000).toISOString()
      : new Date().toISOString();
  await setup.query(
    `INSERT INTO reminder_schedules
       (appointment_id, tenant_id, reminder_type, scheduled_for, lead_minutes, sent_at, status, updated_at)
     VALUES ($1, $2, $3, now(), 1440, $4, $5, $6)`,
    [appointmentId, tenantId, opts.type, sentAt, opts.status, updatedAt]
  );
}

function statsReq() {
  return app.inject({
    method: 'GET',
    url: '/reminders/delivery-stats',
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
          user_id: '66666666-6666-4666-8666-666666666666',
          email: 'realdb-reminders@example.com',
          role: 'owner',
        };
      }
    });
    const withTenantClient = createWithTenantClient(pool);
    registerReminderRoutes(
      app,
      pool,
      withTenantClient as <T>(id: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
    );
    await app.ready();

    tenantId = await createTenant(setup, 'Reminders Stats Tenant', 'salon');
    tenantsToClean.push(tenantId);
    const resourceId = await createResource(setup, tenantId, 'Chair 1');
    const customerId = await createCustomerFull(setup, tenantId, '+15554440001', 'Rem Rita');
    appointmentId = await createAppointment(
      setup,
      tenantId,
      resourceId,
      customerId,
      hoursFromNow(48),
      hoursFromNow(49),
      'reminders appt'
    );

    // Known set. The partial unique index allows at most one 'scheduled' row
    // per (appointment, type), so the two scheduled rows use distinct types.
    await seedReminder({ type: '24h', status: 'sent', daysAgoSent: 1 }); // sent_total, 7d, 30d
    await seedReminder({ type: '72h', status: 'sent', daysAgoSent: 20 }); // sent_total, 30d (not 7d)
    await seedReminder({ type: '2h', status: 'sent', daysAgoSent: 40 }); // sent_total only
    await seedReminder({ type: 'confirmation', status: 'failed', daysAgoUpdated: 1 }); // failed_total, failed_7d
    await seedReminder({ type: '24h', status: 'failed', daysAgoUpdated: 10 }); // failed_total (not 7d)
    await seedReminder({ type: '24h', status: 'scheduled' }); // scheduled
    await seedReminder({ type: '72h', status: 'scheduled' }); // scheduled
    await seedReminder({ type: '2h', status: 'cancelled' }); // cancelled

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[reminders.deliveryStats.realdb.test] DB not available, skipping', err);
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

describe('GET /reminders/delivery-stats → real aggregate', () => {
  it('HAPPY: FILTER buckets partition the seeded rows exactly', async () => {
    // WHY: every count below maps to a specific seeded row set; a wrong FILTER
    // column or bucket boundary flips one of them.
    const res = await statsReq();
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.sent_total).toBe(3);
    expect(s.sent_7d).toBe(1);
    expect(s.sent_30d).toBe(2);
    expect(s.failed_total).toBe(2);
    expect(s.failed_7d).toBe(1);
    expect(s.scheduled).toBe(2);
    expect(s.cancelled).toBe(1);
  });

  it('HAPPY: a tenant with no reminders gets an all-zero row (COALESCE default path)', async () => {
    const emptyTenant = await createTenant(setup, 'Reminders Empty Tenant', 'salon');
    tenantsToClean.push(emptyTenant);
    const res = await app.inject({
      method: 'GET',
      url: '/reminders/delivery-stats',
      headers: { 'x-tenant-id': emptyTenant },
    });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.sent_total).toBe(0);
    expect(s.failed_total).toBe(0);
    expect(s.scheduled).toBe(0);
    expect(s.cancelled).toBe(0);
  });
});
