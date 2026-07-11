/**
 * Real-DB companion for the token-gated self-service routes.
 *
 * Motivation (docs/TEST_DB_AUDIT.md): these routes are UNAUTHENTICATED — the
 * signed token IS the auth — and they write to `appointments`, which has
 * FORCE ROW LEVEL SECURITY. The handler's own comment warns that a bare
 * `pool.query` would be RLS-blocked even with an explicit `WHERE tenant_id`;
 * only `withTenantClient` (which sets `app.current_tenant_id`) lets the write
 * through. A mock can't exercise the RLS interaction OR prove that a token
 * scopes the write to exactly one appointment/tenant. This suite drives the
 * real routes → real Postgres with REAL signed tokens.
 *
 * Strategy: real pg.Pool on API_DB_URL + `generateSelfServiceToken` to mint
 * REAL tokens. Note: `selfServiceToken.ts` snapshots JWT_SECRET at module
 * load, so we DON'T try to override it at runtime — the signer and verifier
 * both use that same module-load secret (whatever the process env was at
 * import, falling back to the dev secret when unset), which is all this test
 * needs since generate + verify run in the same process. No preHandler — the
 * routes are registered without tenantMiddleware in prod. Fixtures per-suite,
 * cleaned in afterAll.
 *
 * 5W for sad-path failures:
 *   WHO  — a customer tapping a cancel/reschedule link from an SMS
 *   WHAT — GET /self/cancel|reschedule?token=…
 *   WHEN — within the 24h token window
 *   WHERE — selfService.ts UPDATE/SELECT under withTenantClient (FORCE RLS)
 *   WHY  — a wrong-type or cross-appointment token must NOT cancel; RLS must
 *          not silently block a legitimate cancel (dead link for the customer)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
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
import { registerSelfServiceRoutes } from '../../src/routes/selfService';
import { generateSelfServiceToken } from '../../src/services/selfServiceToken';

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let resourceId: string;
let customerId: string;
const tenantsToClean: string[] = [];

function hoursFromNow(h: number): string {
  const QUARTER = 900_000;
  const t = Math.round((Date.now() + h * 3_600_000) / QUARTER) * QUARTER;
  return new Date(t).toISOString();
}

function get(url: string) {
  return app.inject({ method: 'GET', url });
}

async function apptStatus(id: string): Promise<string | undefined> {
  const res = await setup.query(`SELECT status FROM appointments WHERE appointment_id = $1`, [id]);
  return res.rows[0]?.status as string | undefined;
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });

    app = Fastify({ logger: false });
    const withTenantClient = createWithTenantClient(pool);
    registerSelfServiceRoutes(
      app,
      withTenantClient as <T>(id: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
    );
    await app.ready();

    tenantId = await createTenant(setup, 'SelfService Realdb Tenant', 'salon');
    tenantsToClean.push(tenantId);
    resourceId = await createResource(setup, tenantId, 'Chair 1');
    customerId = await createCustomerFull(setup, tenantId, '+15559990001', 'Self Sam');

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[selfService.realdb.test] DB not available, skipping', err);
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

// Each appointment gets its own hour slot so a still-scheduled one from an
// earlier test can't collide with the next via appointments_no_resource_overlap.
let slotCursor = 48;
async function scheduledAppt(): Promise<string> {
  const from = hoursFromNow(slotCursor);
  const to = hoursFromNow(slotCursor + 0.5);
  slotCursor += 2;
  return createAppointment(setup, tenantId, resourceId, customerId, from, to, 'self-service appt');
}

describe('GET /self/cancel → real DB (FORCE RLS + token scope)', () => {
  it('HAPPY: a valid cancel token cancels the appointment through RLS', async () => {
    // WHY: proves withTenantClient sets app.current_tenant_id so the FORCE-RLS
    // UPDATE actually lands — the exact thing a mock can't verify.
    const id = await scheduledAppt();
    const token = generateSelfServiceToken(id, tenantId, 'cancel')!;
    const res = await get(`/self/cancel?token=${encodeURIComponent(token)}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(await apptStatus(id)).toBe('canceled');
  });

  it('IDEMPOTENT: canceling an already-canceled appointment returns 200, stays canceled', async () => {
    const id = await scheduledAppt();
    const token = generateSelfServiceToken(id, tenantId, 'cancel')!;
    await get(`/self/cancel?token=${encodeURIComponent(token)}`);
    const again = await get(`/self/cancel?token=${encodeURIComponent(token)}`);
    expect(again.statusCode).toBe(200);
    expect(again.json().success).toBe(true);
    expect(await apptStatus(id)).toBe('canceled');
  });

  it('SECURITY: a reschedule-type token is rejected on the cancel route — nothing cancels', async () => {
    // WHY: the action claim must gate the endpoint; a reschedule token must not
    // double as a cancel.
    const id = await scheduledAppt();
    const wrongToken = generateSelfServiceToken(id, tenantId, 'reschedule')!;
    const res = await get(`/self/cancel?token=${encodeURIComponent(wrongToken)}`);
    expect(res.statusCode).toBe(400);
    expect(await apptStatus(id)).toBe('scheduled');
  });

  it('SAD: a token for a nonexistent appointment → 404', async () => {
    const token = generateSelfServiceToken(
      '00000000-0000-4000-8000-000000000000',
      tenantId,
      'cancel'
    )!;
    const res = await get(`/self/cancel?token=${encodeURIComponent(token)}`);
    expect(res.statusCode).toBe(404);
  });

  it('SAD: a missing/garbage token → 400, no crash', async () => {
    expect((await get('/self/cancel')).statusCode).toBe(400);
    expect((await get('/self/cancel?token=not-a-jwt')).statusCode).toBe(400);
  });
});

describe('GET /self/reschedule → real DB (JOIN customers under RLS)', () => {
  it('HAPPY: a valid reschedule token resolves the appointment+customer JOIN and does NOT modify the appointment', async () => {
    // WHY: reschedule only NOTIFIES; the appointment must stay scheduled. Also
    // exercises the a JOIN c ON customer_id under RLS (a mock never runs it).
    const id = await scheduledAppt();
    const token = generateSelfServiceToken(id, tenantId, 'reschedule')!;
    const res = await get(`/self/reschedule?token=${encodeURIComponent(token)}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(await apptStatus(id)).toBe('scheduled');
  });

  it('SECURITY: a cancel-type token is rejected on the reschedule route', async () => {
    const id = await scheduledAppt();
    const wrongToken = generateSelfServiceToken(id, tenantId, 'cancel')!;
    const res = await get(`/self/reschedule?token=${encodeURIComponent(wrongToken)}`);
    expect(res.statusCode).toBe(400);
    expect(await apptStatus(id)).toBe('scheduled');
  });

  it('SAD: reschedule token for a canceled appointment → 404 (status=scheduled filter)', async () => {
    const id = await scheduledAppt();
    await setup.query(`UPDATE appointments SET status = 'canceled' WHERE appointment_id = $1`, [
      id,
    ]);
    const token = generateSelfServiceToken(id, tenantId, 'reschedule')!;
    const res = await get(`/self/reschedule?token=${encodeURIComponent(token)}`);
    expect(res.statusCode).toBe(404);
  });
});
