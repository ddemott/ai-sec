/**
 * Real-DB companion tests for the voice routes' dynamically-built SQL
 * (per docs/TODO.md "Verification blind spots" — P0 verification of mock-only blind spots).
 *
 * src/voice.test.ts mocks pg, so the dynamic `whereClause` + `paramIndex`
 * bumping in GET /voice/history (src/routes/voice.ts:291-324) is never
 * executed against a real parser: a wrong `$n` index (e.g. LIMIT bound to
 * the customer_id param) would ship green. This suite registers the real
 * route module against a real Postgres (API_DB_URL + createWithTenantClient,
 * same pattern as agentToolsBookingIntegration.test.ts /
 * agentToolsPreferences.test.ts) and executes every branch of the dynamic
 * statement: no filters, each filter alone, both combined, and pagination —
 * plus the `is_deleted = false` guards on /voice/active and /voice/history.
 *
 * Isolation: owns exactly one tenant; every fixture hangs off it; afterAll
 * deletes only that tenant (cascade). NEVER truncates — other suites share
 * this DB concurrently.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Client, Pool } from 'pg';
import type { PoolClient } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  createTenant,
  createCustomer,
  skipIfDbDown,
} from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerVoiceRoutes } from '../../src/routes/voice';

// Test-only request shape: the preHandler stands in for tenantMiddleware +
// the JWT hook (mirrors the hook in src/voice.test.ts). x-tenant-id sets
// req.tenantId + a minimal req.auth; omitting it = anonymous request.
type TenantRequest = FastifyRequest & {
  tenantId?: string;
  auth?: { tenant_id: string; user_id: string; email: string; role: 'owner' | 'front_desk' };
};

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let customerA: string; // "Alma Caller" — 3 live sessions + 1 soft-deleted
let customerB: string; // "Bert Caller" — 2 live sessions + 1 soft-deleted
const tenantsToClean: string[] = [];

// call_ids of the seeded sessions, newest-first by started_at. h* are live
// rows (expected visible); d* are soft-deleted rows (expected invisible).
const H1 = 'realdb-hist-1'; // customerA, completed, -1h
const H2 = 'realdb-hist-2'; // customerA, active,    -2h
const H3 = 'realdb-hist-3'; // customerB, completed, -3h
const H4 = 'realdb-hist-4'; // customerB, failed,    -4h
const H5 = 'realdb-hist-5'; // customerA, completed, -5h
const D1 = 'realdb-del-1'; //  customerA, completed, -6h, is_deleted
const D2 = 'realdb-del-2'; //  customerB, active,    -7h, is_deleted
const ALL_LIVE = [H1, H2, H3, H4, H5];

function getHistory(qs: string, withTenant = true) {
  return app.inject({
    method: 'GET',
    url: `/voice/history${qs}`,
    headers: withTenant ? { 'x-tenant-id': tenantId } : {},
  });
}

function callIds(res: { json: () => { calls: Array<{ call_id: string }> } }): string[] {
  return res.json().calls.map((c) => c.call_id);
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });

    app = Fastify({ logger: false });
    // Stand-in for tenantMiddleware/JWT hook: routes only read req.tenantId
    // (validated upstream in prod) and req.auth for owner gating.
    app.addHook('preHandler', async (request: TenantRequest) => {
      const tid = request.headers['x-tenant-id'] as string | undefined;
      if (tid) {
        request.tenantId = tid;
        request.auth = {
          tenant_id: tid,
          user_id: '99999999-9999-4999-8999-999999999999',
          email: 'realdb-voice@example.com',
          role: 'owner',
        };
      }
    });
    const withTenantClient = createWithTenantClient(pool);
    registerVoiceRoutes(
      app,
      pool,
      withTenantClient
    );
    await app.ready();

    tenantId = await createTenant(setup, 'RealDB Voice Routes Tenant', 'salon');
    tenantsToClean.push(tenantId);
    customerA = await createCustomer(setup, tenantId, 'Alma Caller', '+15559980001');
    customerB = await createCustomer(setup, tenantId, 'Bert Caller', '+15559980002');

    // Seed voice_sessions directly with the root client (bypasses RLS; the
    // routes under test read them back through the RLS-scoped api_user pool).
    // caller_phone is nullable since migration 20260624 but we set it — real
    // rows have it. started_at is staggered so ORDER BY started_at DESC is
    // deterministic: H1 newest → H5 oldest, deleted rows older still.
    const seed = async (
      callId: string,
      customerId: string,
      status: string,
      hoursAgo: number,
      isDeleted: boolean
    ) => {
      await setup.query(
        `INSERT INTO voice_sessions
           (tenant_id, call_id, caller_phone, customer_id, status, started_at,
            is_deleted, deleted_at, deleted_by)
         VALUES ($1, $2, $3, $4, $5, now() - make_interval(hours => $6),
                 $7, CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN 'realdb-test' END)`,
        [
          tenantId,
          callId,
          customerId === customerA ? '+15559980001' : '+15559980002',
          customerId,
          status,
          hoursAgo,
          isDeleted,
        ]
      );
    };
    await seed(H1, customerA, 'completed', 1, false);
    await seed(H2, customerA, 'active', 2, false);
    await seed(H3, customerB, 'completed', 3, false);
    await seed(H4, customerB, 'failed', 4, false);
    await seed(H5, customerA, 'completed', 5, false);
    await seed(D1, customerA, 'completed', 6, true);
    await seed(D2, customerB, 'active', 7, true);

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[voice.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      // Cascade removes this tenant's customers + voice_sessions only.
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

describe('GET /voice/history — dynamic whereClause against real Postgres', () => {
  it('HAPPY: no filters returns every live session newest-first, soft-deleted excluded', async () => {
    // WHO: an owner opening the dashboard Calls tab with no filters set.
    // WHAT: GET /voice/history — base whereClause only ($1 tenant), then
    //        LIMIT $2 OFFSET $3 (paramIndex never bumped).
    // WHEN: default page load (limit 50, offset 0).
    // WHERE: src/routes/voice.ts:291-324, count + list statements.
    // WHY: proves the trailing LIMIT/OFFSET indices are correct when NO
    //        dynamic filter bumped paramIndex, and that both the COUNT and
    //        the list honour is_deleted = false (a drift between the two
    //        would corrupt `total`/`has_more`).
    const res = await getHistory('');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(5);
    expect(callIds(res)).toEqual(ALL_LIVE); // newest-first, D1/D2 absent
    expect(body.has_more).toBe(false);
    // The LEFT JOIN customers resolves the display name.
    expect(body.calls[0].customer_name).toBe('Alma Caller');
    expect(body.calls[2].customer_name).toBe('Bert Caller');
  });

  it('HAPPY: customer_id filter alone binds $2 and returns only that customer', async () => {
    // WHO: an owner drilling into one customer's call history.
    // WHAT: whereClause += customer_id = $2; LIMIT $3 OFFSET $4.
    // WHEN: ?customer_id=<Alma> supplied, no status filter.
    // WHERE: the first dynamic branch at voice.ts:295-299.
    // WHY: a wrong index here (e.g. $3) would make Postgres reject or —
    //        worse — bind the LIMIT value as the customer_id. The mocked
    //        suite cannot see either failure.
    const res = await getHistory(`?customer_id=${customerA}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(3);
    expect(callIds(res)).toEqual([H1, H2, H5]); // D1 (deleted, same customer) excluded
  });

  it('HAPPY: status filter alone binds $2 and returns only that status', async () => {
    // WHO: an owner filtering the Calls tab to completed calls.
    // WHAT: whereClause += status = $2 (customer branch skipped, so status
    //        takes the paramIndex the customer filter would otherwise use).
    // WHEN: ?status=completed, no customer filter.
    // WHERE: the second dynamic branch at voice.ts:301-305.
    // WHY: proves paramIndex starts at 2 regardless of which branch fires —
    //        the exact "index depends on which filters are present" logic the
    //        blind-spot audit flagged.
    const res = await getHistory('?status=completed');
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(3);
    expect(callIds(res)).toEqual([H1, H3, H5]); // D1 (deleted completed) excluded
  });

  it('HAPPY: combined customer+status filters bind $2 and $3, LIMIT $4 OFFSET $5', async () => {
    // WHO: an owner filtering one customer's completed calls.
    // WHAT: both dynamic branches fire → customer_id = $2 AND status = $3,
    //        then LIMIT $4 OFFSET $5 — the deepest paramIndex the route builds.
    // WHEN: ?customer_id=<Alma>&status=completed.
    // WHERE: voice.ts:295-305 (both branches) + :315-324 (trailing indices).
    // WHY: this is the exact statement shape where an off-by-one in
    //        paramIndex ships green under mocks and 500s in prod.
    const res = await getHistory(`?customer_id=${customerA}&status=completed`);
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(2);
    expect(callIds(res)).toEqual([H1, H5]);
  });

  it('HAPPY: pagination without filters — page 2 returns different rows, has_more flips', async () => {
    // WHO: an owner paging through call history 2 rows at a time.
    // WHAT: LIMIT $2 OFFSET $3 with real values; page 1 vs page 2 vs last page.
    // WHEN: ?limit=2&offset=0 → ?limit=2&offset=2 → ?limit=2&offset=4.
    // WHERE: params.push(limit, offset) at voice.ts:315 + has_more math :337.
    // WHY: if LIMIT and OFFSET were swapped or bound to the wrong index,
    //        page 2 would repeat page 1 (or error) — only a real parser
    //        + real rows can catch it.
    const page1 = await getHistory('?limit=2&offset=0');
    expect(page1.statusCode).toBe(200);
    expect(callIds(page1)).toEqual([H1, H2]);
    expect(page1.json().has_more).toBe(true);

    const page2 = await getHistory('?limit=2&offset=2');
    expect(page2.statusCode).toBe(200);
    expect(callIds(page2)).toEqual([H3, H4]); // disjoint from page 1
    expect(page2.json().has_more).toBe(true);

    const page3 = await getHistory('?limit=2&offset=4');
    expect(page3.statusCode).toBe(200);
    expect(callIds(page3)).toEqual([H5]);
    expect(page3.json().has_more).toBe(false);
  });

  it('HAPPY: pagination WITH both filters — LIMIT $4 OFFSET $5 page 2 differs from page 1', async () => {
    // WHO: an owner paging a filtered view (one customer, completed only).
    // WHAT: the maximal statement — customer_id=$2, status=$3, LIMIT $4,
    //        OFFSET $5 — with offset actually advancing the window.
    // WHEN: ?customer_id=<Alma>&status=completed&limit=1, offset 0 then 1.
    // WHERE: voice.ts:291-324 end-to-end, all five params live.
    // WHY: the highest param indices only exist when both filters are
    //        present; this is the single most index-fragile shape the route
    //        can emit, so page 2 returning the OTHER matching row is the
    //        definitive proof every $n landed on the right value.
    const page1 = await getHistory(`?customer_id=${customerA}&status=completed&limit=1&offset=0`);
    expect(page1.statusCode).toBe(200);
    expect(callIds(page1)).toEqual([H1]);
    expect(page1.json()).toMatchObject({ total: 2, has_more: true });

    const page2 = await getHistory(`?customer_id=${customerA}&status=completed&limit=1&offset=1`);
    expect(page2.statusCode).toBe(200);
    expect(callIds(page2)).toEqual([H5]);
    expect(page2.json()).toMatchObject({ total: 2, has_more: false });
  });

  it('HAPPY: soft-deleted rows are invisible to /voice/history even when filters target them', async () => {
    // WHO: an owner who just deleted a call record, re-filtering the list.
    // WHAT: the is_deleted = false guard in the BASE whereClause must hold
    //        under every filter combination — D1 matches customerA+completed
    //        and D2 matches status=active, yet neither may surface.
    // WHEN: immediately after a soft delete (rows retained, deleted_at set).
    // WHERE: voice.ts:291 (`AND vs.is_deleted = false`).
    // WHY: soft delete is the privacy contract for the legal-held GDPR work —
    //        a deleted call reappearing in ANY filtered view is a PII leak.
    const almaCompleted = await getHistory(`?customer_id=${customerA}&status=completed`);
    expect(callIds(almaCompleted)).not.toContain(D1);

    const active = await getHistory('?status=active');
    expect(active.json().total).toBe(1);
    expect(callIds(active)).toEqual([H2]); // D2 (deleted active) hidden
  });

  it('SAD: request with no tenant context is rejected 401, no SQL executed', async () => {
    // WHO: an anonymous caller (no JWT/tenant) probing the history endpoint.
    // WHAT: GET /voice/history with no x-tenant-id → requireTenantId finds
    //        neither req.tenantId nor req.auth → 401 Authentication required.
    // WHEN: any unauthenticated hit (stale dashboard token, direct curl).
    // WHERE: requireTenantId in src/middleware.ts, called first in the route.
    // WHY: call history is caller PII; the route must fail closed before the
    //        dynamic SQL ever touches the pool.
    const res = await getHistory('', false);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ success: false, error: 'Authentication required' });
  });

  it('SAD: non-numeric limit/offset → clean 400, never reaches SQL (was a 500 via NaN)', async () => {
    // WHO: a buggy dashboard build or hand-crafted curl sending limit=abc.
    // WHAT: GET /voice/history?limit=abc (and offset=-5 — negative fails the
    //        digits-only gate too).
    // WHEN: any malformed pagination input.
    // WHERE: the validation added 2026-07-01 at the top of /voice/history —
    //        before the fix, parseInt('abc') = NaN which pg serialized as the
    //        string "NaN" → Postgres `invalid input syntax for type bigint` →
    //        500 (found by this suite's first run; mocks never parse params).
    // WHY: malformed input is a client error (400), not a server crash (500)
    //        — 500s here page the on-call and pollute errors_total.
    const bad = await getHistory('?limit=abc');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().success).toBe(false);

    const negative = await getHistory('?offset=-5');
    expect(negative.statusCode).toBe(400);
    expect(negative.json().success).toBe(false);
  });

  it('SAD: non-UUID customer_id filter → clean 400, never reaches SQL (was a 22P02 500)', async () => {
    // WHO: a stale bookmark or fuzzer with customer_id=not-a-uuid.
    // WHAT: GET /voice/history?customer_id=not-a-uuid.
    // WHEN: any malformed customer filter.
    // WHERE: requireValidUUID guard added 2026-07-01 — before it, the raw
    //        string hit `vs.customer_id = $2` → Postgres 22P02 → 500. The
    //        DELETE route in this file always had the guard; history didn't.
    // WHY: same client-error-not-server-crash contract as above.
    const res = await getHistory('?customer_id=not-a-uuid');
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });
});

describe('GET /voice/active — is_deleted guard against real Postgres', () => {
  it('HAPPY: returns only live active sessions; a soft-deleted active row is hidden', async () => {
    // WHO: the dashboard's live-calls panel polling for in-progress calls.
    // WHAT: GET /voice/active — static SQL but with the same
    //        `is_deleted = false AND status = 'active'` guard; D2 is an
    //        active-status row that was soft-deleted and must not appear.
    // WHEN: while H2 is mid-call.
    // WHERE: voice.ts:243-258.
    // WHY: the mocked suite returns whatever rows the mock is fed — it can't
    //        prove the WHERE actually excludes deleted/active rows; a leak
    //        here would resurrect "deleted" calls on the live board.
    const res = await app.inject({
      method: 'GET',
      url: '/voice/active',
      headers: { 'x-tenant-id': tenantId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.calls.map((c: { call_id: string }) => c.call_id)).toEqual([H2]);
    expect(body.calls[0].customer_name).toBe('Alma Caller'); // LEFT JOIN resolved
    expect(body.calls[0].status).toBe('active');
  });
});
