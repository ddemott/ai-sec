/**
 * Real-DB companion for POST /tenants/:id/update-config.
 *
 * Motivation: this route is the backend the dashboard "Voice Settings" page
 * (AIConfigView) saves to, and it does three things a mocked test can't prove
 * against real Postgres:
 *   1. PARTIAL-UPDATE SAFETY — a body that omits a field must keep the prior DB
 *      value (undefined → keep, explicit null → clear). A column/type drift or a
 *      COALESCE mistake would silently wipe a hand-tuned persona.
 *   2. BUSINESS-TYPE RESEED CLEANUP — changing business_type DELETEs only the
 *      wizard-auto-seeded rows (is_auto_seeded = true) and PRESERVES user-typed
 *      rows. Destructive; must be exact.
 *   3. LOOP-GUARD ROLLBACK — a transfer number equal to the forwarded-from line
 *      is rejected 400 and the transaction rolls back (row unchanged).
 *
 * 5W for sad-path failures:
 *   WHO  — an owner saving their AI persona / call-forwarding config
 *   WHAT — POST /tenants/:id/update-config
 *   WHEN — every save from the Voice Settings page
 *   WHERE — tenants.ts update-config transaction (partial-merge + reseed + loop guard)
 *   WHY  — a silent field wipe or a preserved auto-seed row corrupts the tenant's setup
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Client, type PoolClient, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../test-utils';
import { createWithTenantClient } from '../database';
import { registerTenantRoutes } from './tenants';
import type { AppFastifyInstance } from '../types/fastify';

type TenantRequest = FastifyRequest & {
  tenantId?: string;
  auth?: { tenant_id: string; user_id: string; email: string; role: 'owner' | 'front_desk' };
};

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
const tenantsToClean: string[] = [];

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });

    app = Fastify({ logger: false });
    // Mirror the prod auth contract: the JWT preHandler sets req.auth. The
    // route allows a self-tenant update when req.auth.tenant_id === :id, so the
    // header tenant must equal the URL tenant for a 200.
    app.addHook('preHandler', async (request: TenantRequest) => {
      const tid = request.headers['x-tenant-id'] as string | undefined;
      if (tid) {
        request.tenantId = tid;
        request.auth = {
          tenant_id: tid,
          user_id: '55555555-5555-4555-8555-555555555555',
          email: 'realdb-tenants@example.com',
          role: 'owner',
        };
      }
    });
    const withTenantClient = createWithTenantClient(pool);
    registerTenantRoutes(
      app as unknown as AppFastifyInstance,
      pool,
      withTenantClient as <T>(id: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
    );
    await app.ready();
    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[tenants.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    // ON DELETE CASCADE on tenant FKs cleans services/resources too.
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

/** Provision an isolated throwaway tenant so each destructive test owns its data. */
async function freshTenant(name: string, businessType = 'salon'): Promise<string> {
  const id = await createTenant(setup, name, businessType);
  tenantsToClean.push(id);
  return id;
}

function hdr(tenantId: string) {
  return { 'x-tenant-id': tenantId };
}

describe('POST /tenants/:id/update-config → real DB', () => {
  it('HAPPY: a save persists the changed fields', async () => {
    const id = await freshTenant('Tenants Realdb Happy');
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${id}/update-config`,
      headers: hdr(id),
      payload: { system_prompt: 'You are Nova.', default_buffer_minutes: 15 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const row = await setup.query(
      'SELECT system_prompt, default_buffer_minutes FROM tenants WHERE tenant_id = $1',
      [id]
    );
    expect(row.rows[0].system_prompt).toBe('You are Nova.');
    expect(row.rows[0].default_buffer_minutes).toBe(15);
  });

  it('PARTIAL-UPDATE: a body omitting a field keeps the prior DB value', async () => {
    // WHY: the AIConfigView client sends the whole form, but the route supports
    // partial merge (undefined → keep prior). A regression here would let a save
    // that touches only the buffer silently blank out the tenant's system_prompt,
    // voice, and forward number. Send ONLY default_buffer_minutes and prove the
    // rest survive.
    const id = await freshTenant('Tenants Realdb Partial');
    await setup.query(
      `UPDATE tenants
         SET system_prompt = 'KEEP THIS PROMPT',
             tts_voice = 'onyx',
             forward_phone = '+16085550001',
             save_preferences_enabled = true
       WHERE tenant_id = $1`,
      [id]
    );

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${id}/update-config`,
      headers: hdr(id),
      payload: { default_buffer_minutes: 30 },
    });
    expect(res.statusCode).toBe(200);

    const row = await setup.query(
      `SELECT system_prompt, tts_voice, forward_phone, save_preferences_enabled, default_buffer_minutes
         FROM tenants WHERE tenant_id = $1`,
      [id]
    );
    const t = row.rows[0];
    expect(t.system_prompt).toBe('KEEP THIS PROMPT');
    expect(t.tts_voice).toBe('onyx');
    expect(t.forward_phone).toBe('+16085550001');
    expect(t.save_preferences_enabled).toBe(true);
    expect(t.default_buffer_minutes).toBe(30); // the one field we changed
  });

  it('RESEED: changing business_type deletes only auto-seeded services/resources', async () => {
    // WHY: the wizard re-seeds template defaults on a business_type switch, so
    // stale auto-seeded rows must be purged — but a customer's own hand-typed
    // service/resource (is_auto_seeded = false) must NEVER be deleted. This is
    // the destructive branch; it runs on an isolated tenant.
    const id = await freshTenant('Tenants Realdb Reseed', 'salon');
    await setup.query(
      `INSERT INTO services (tenant_id, name, duration_minutes, is_auto_seeded)
         VALUES ($1, 'auto-seeded-cut', 30, true), ($1, 'hand-typed-cut', 45, false)`,
      [id]
    );
    await setup.query(
      `INSERT INTO resources (tenant_id, name, is_auto_seeded)
         VALUES ($1, 'auto-seeded-chair', true), ($1, 'hand-typed-chair', false)`,
      [id]
    );

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${id}/update-config`,
      headers: hdr(id),
      payload: { business_type: 'automotive' },
    });
    expect(res.statusCode).toBe(200);

    // Membership, not exact list: creating a salon tenant fires a template
    // trigger that seeds a starter resource ("Styling Station 1") with
    // is_auto_seeded = false, so it legitimately survives the switch. Assert on
    // the rows THIS test owns: our auto-seeded row is purged, our hand-typed
    // row is preserved.
    const svc = await setup.query('SELECT name FROM services WHERE tenant_id = $1', [id]);
    const svcNames = svc.rows.map((r) => r.name);
    expect(svcNames).toContain('hand-typed-cut'); // user-typed preserved
    expect(svcNames).not.toContain('auto-seeded-cut'); // auto-seeded purged

    const rsc = await setup.query('SELECT name FROM resources WHERE tenant_id = $1', [id]);
    const rscNames = rsc.rows.map((r) => r.name);
    expect(rscNames).toContain('hand-typed-chair');
    expect(rscNames).not.toContain('auto-seeded-chair');

    const biz = await setup.query('SELECT business_type FROM tenants WHERE tenant_id = $1', [id]);
    expect(biz.rows[0].business_type).toBe('automotive');
  });

  it('LOOP-GUARD: forward == forwarded-from is rejected 400 and rolls back (row unchanged)', async () => {
    // WHY: routing the live transfer to the very line that forwards INTO the AI
    // loops the call back to the assistant. The route rejects it 400 and rolls
    // the transaction back — the prior forward_phone must be untouched.
    const id = await freshTenant('Tenants Realdb Loop');
    await setup.query(`UPDATE tenants SET forward_phone = '+16085559999' WHERE tenant_id = $1`, [
      id,
    ]);

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${id}/update-config`,
      headers: hdr(id),
      payload: { forward_phone: '+16085550001', forwarded_from_phone: '+16085550001' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/loop/i);

    const row = await setup.query(
      'SELECT forward_phone, forwarded_from_phone FROM tenants WHERE tenant_id = $1',
      [id]
    );
    expect(row.rows[0].forward_phone).toBe('+16085559999'); // rollback: prior kept
    expect(row.rows[0].forwarded_from_phone).toBeNull(); // never written
  });

  it('AUTH: a cross-tenant update is rejected 403', async () => {
    // WHY: req.auth.tenant_id must match the :id (or be super-admin). A mismatch
    // is a cross-tenant write attempt — the isolation boundary.
    const id = await freshTenant('Tenants Realdb Auth');
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${id}/update-config`,
      headers: { 'x-tenant-id': '99999999-9999-4999-8999-999999999999' },
      payload: { system_prompt: 'hijack' },
    });
    expect(res.statusCode).toBe(403);
  });
});
