import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client } from 'pg';
import { getRootClient, clearDB, createTenant, createService, skipIfDbDown } from '../utils';
import { resolveServiceForBooking } from '../../src/services/serviceResolver';

// ─────────────────────────────────────────────────────────────────────────
// WHO  : resolveServiceForBooking's fallthrough (branch 2) — the path taken
//        whenever the caller's spoken service does NOT name-match, so booking
//        falls back to the tenant's default_service_id.
// WHAT : that branch JOINs `services s` with `tenants t`. Both tables have a
//        `name` column, so a bare `name` in the projection is
//        "column reference \"name\" is ambiguous" — a real Postgres error that
//        500'd /agent-tools/available-slots (and any booking that fell through)
//        in prod on 2026-07-01, once default_service_id was backfilled.
// WHEN : regression guard for that fix (qualify every column with the s alias).
// WHERE: src/services/serviceResolver.ts branch 2.
// WHY  : the existing serviceResolver.test.ts uses a MOCK client, so the real
//        SQL never runs — it proved the branching, not that the query is valid.
//        This runs the actual query against Postgres, which is the only thing
//        that catches an ambiguous-column / bad-SQL regression.
// ─────────────────────────────────────────────────────────────────────────

let root: Client;
let dbAvailable = false;
beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

beforeAll(async () => {
  try {
    root = await getRootClient();
    dbAvailable = true;
    await clearDB(root);
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (root) await root.end();
});

describe('resolveServiceForBooking — real DB (SQL validity)', () => {
  it('FALLTHROUGH: an unmatched spoken type resolves to default_service_id without a SQL error', async () => {
    // The tenant name deliberately collides conceptually with the service name
    // space; the point is the JOIN of two tables that both have `name`.
    const tenantId = await createTenant(
      root,
      'Thinking Hammer LLC',
      'ai-platform',
      'America/Chicago'
    );
    const serviceId = await createService(root, tenantId, 'Personal Callback', 15, 0);
    await root.query('UPDATE tenants SET default_service_id = $1 WHERE tenant_id = $2', [
      serviceId,
      tenantId,
    ]);

    // "meeting" does NOT ILIKE-match "Personal Callback" → branch 1 empty →
    // branch 2 (the services⋈tenants fallthrough) runs. Pre-fix this threw
    // "column reference \"name\" is ambiguous"; post-fix it returns the default.
    const resolved = await resolveServiceForBooking(root, tenantId, 'meeting');
    expect(resolved).not.toBeNull();
    expect(resolved?.service_id).toBe(serviceId);
    expect(resolved?.name).toBe('Personal Callback');
    expect(resolved?.duration_minutes).toBe(15);
  });

  it('NAME MATCH: a spoken type that substring-matches still works (branch 1, single table)', async () => {
    // Guards that qualifying the projection didn't break the no-JOIN branch.
    const tenantId = await createTenant(root, 'Match Co', 'ai-platform', 'America/Chicago');
    const svc = await createService(root, tenantId, 'Programming Consultation', 30, 100);
    const resolved = await resolveServiceForBooking(root, tenantId, 'consultation');
    expect(resolved?.service_id).toBe(svc);
    expect(resolved?.price).toBe(100);
  });
});
