/**
 * Real-DB companion test for the first-time-fix cohort metric
 * (src/routes/analytics.ts — the sixth query in /analytics/cohorts).
 *
 * First-time-fix = of distinct callers (voice_sessions keyed on the last 10
 * digits of caller_phone, NULL/empty phones excluded), the share whose FIRST
 * call (earliest started_at, within the optional From/To window) ended in a
 * booking. The ordering logic (DISTINCT ON + ORDER BY started_at) is exactly
 * the kind of SQL a mocked pg client cannot prove: a wrong ORDER BY direction
 * would count "ever booked" instead of "booked on first contact" and every
 * mocked test would still pass. This suite registers the REAL route over a
 * REAL pg.Pool (same pattern as analytics.realdb.test.ts) with its own tenant
 * so it cannot disturb that suite's exact-count assertions.
 *
 * Fixture timeline (all instants at 12:00Z; test DB session TimeZone is UTC):
 *   Caller A (+16305551001): D10 first call BOOKED, D9 second call not booked
 *     → counts in the numerator (first contact resolved).
 *   Caller B (+16305551002): D10 first call NOT booked, D9 second call BOOKED
 *     → denominator only (booked, but NOT on first contact).
 *   Caller C (+16305551003): D60 single call BOOKED — outside the window
 *     → excluded from the windowed cut entirely; joins the all-time cut.
 *   NULL-phone session at D8 → excluded from every first-time-fix cut.
 *   Soft-deleted booked session (caller D, D9) → must appear NOWHERE.
 *   Query window: start=D15 .. end=D5.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { registerAnalyticsRoutes } from '../../src/routes/analytics';

// One clock reading for the whole suite so every derived day is consistent
// even if the suite straddles midnight.
const NOW_MS = Date.now();

/** YYYY-MM-DD (UTC) for `daysAgo` days before the suite's fixed clock. */
function dayISO(daysAgo: number): string {
  return new Date(NOW_MS - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

const D60 = dayISO(60);
const D10 = dayISO(10);
const D9 = dayISO(9);
const D8 = dayISO(8);
const WINDOW_START = dayISO(15);
const WINDOW_END = dayISO(5);

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let emptyTenantId: string;
const tenantsToClean: string[] = [];

function getCohorts(qs = '', tenant?: string) {
  return app.inject({
    method: 'GET',
    url: `/analytics/cohorts${qs}`,
    headers: { 'x-tenant-id': tenant ?? tenantId },
  });
}

async function insertVoiceSession(opts: {
  call_id: string;
  caller_phone: string | null;
  started_at: string;
  outcome: string | null;
  is_deleted?: boolean;
}): Promise<void> {
  await setup.query(
    `INSERT INTO voice_sessions
       (tenant_id, call_id, caller_phone, started_at, status, outcome, is_deleted)
     VALUES ($1, $2, $3, $4, 'completed', $5, $6)`,
    [
      tenantId,
      opts.call_id,
      opts.caller_phone,
      opts.started_at,
      opts.outcome,
      opts.is_deleted ?? false,
    ]
  );
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });

    app = Fastify({ logger: false });
    // Same tenant-injection seam as analytics.realdb.test.ts: the x-tenant-id
    // header stands in for tenantMiddleware so the ROUTE + SQL under test run
    // unmodified.
    type TenantRequest = FastifyRequest & { tenantId?: string; auth?: { user_id: string } };
    app.addHook('preHandler', async (request: TenantRequest) => {
      const headerTenant = request.headers['x-tenant-id'];
      if (typeof headerTenant === 'string' && headerTenant) {
        request.tenantId = headerTenant;
        request.auth = { user_id: '00000000-0000-0000-0000-000000000002' };
      }
    });
    const withTenantClient = createWithTenantClient(pool);
    registerAnalyticsRoutes(app, pool, withTenantClient);
    await app.ready();

    tenantId = await createTenant(setup, 'First-Time-Fix Salon', 'salon', 'Etc/UTC');
    tenantsToClean.push(tenantId);
    emptyTenantId = await createTenant(setup, 'First-Time-Fix Empty', 'salon', 'Etc/UTC');
    tenantsToClean.push(emptyTenantId);

    // Caller A — first call booked, second not: the first-time-fix success.
    // outcome='booked' with no appointment_id proves the OR arm of the booked
    // signal (appointment_id IS NOT NULL OR outcome = 'booked') works.
    await insertVoiceSession({
      call_id: 'ftf-a1',
      caller_phone: '+16305551001',
      started_at: `${D10}T12:00:00Z`,
      outcome: 'booked',
    });
    await insertVoiceSession({
      call_id: 'ftf-a2',
      caller_phone: '630-555-1001', // same last-10 digits, different format
      started_at: `${D9}T12:00:00Z`,
      outcome: null,
    });
    // Caller B — first call NOT booked, second booked: must NOT count.
    await insertVoiceSession({
      call_id: 'ftf-b1',
      caller_phone: '+16305551002',
      started_at: `${D10}T12:00:00Z`,
      outcome: '',
    });
    await insertVoiceSession({
      call_id: 'ftf-b2',
      caller_phone: '+16305551002',
      started_at: `${D9}T12:00:00Z`,
      outcome: 'booked',
    });
    // Caller C — booked, but 60 days ago (outside the D15..D5 window).
    await insertVoiceSession({
      call_id: 'ftf-c1',
      caller_phone: '+16305551003',
      started_at: `${D60}T12:00:00Z`,
      outcome: 'booked',
    });
    // NULL caller phone — forwarded-line calls without caller ID; excluded.
    await insertVoiceSession({
      call_id: 'ftf-null-phone',
      caller_phone: null,
      started_at: `${D8}T12:00:00Z`,
      outcome: 'booked',
    });
    // Soft-deleted booked first call — must appear in NO cut.
    await insertVoiceSession({
      call_id: 'ftf-d1',
      caller_phone: '+16305551004',
      started_at: `${D9}T12:00:00Z`,
      outcome: 'booked',
      is_deleted: true,
    });

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[analytics.firstTimeFix.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    // Only OUR tenants — voice_sessions cascade off tenants.
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

describe('GET /analytics/cohorts → first_time_fix (real SQL)', () => {
  it('HAPPY: windowed — counts only callers whose FIRST in-window call booked', async () => {
    // WHO: an owner asking "how often do we resolve a caller on first contact?"
    // WHAT: the DISTINCT ON (phone) ... ORDER BY started_at ASC picks each
    //       caller's earliest in-window call; only Caller A's first call booked.
    //       Caller B booked on the SECOND call, so B is denominator-only.
    // WHEN: Analytics tab with a From/To window (D15..D5) set.
    // WHERE: the first_time_fix query in /analytics/cohorts (analytics.ts).
    // WHY: a wrong ORDER BY (or a missing DISTINCT ON) would silently count
    //      "ever booked" (2/2 here) instead of "first call booked" (1/2) — the
    //      metric would flatter the business and no mocked test would notice.
    const res = await getCohorts(`?start_date=${WINDOW_START}&end_date=${WINDOW_END}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.first_time_fix).toEqual({
      rate: 0.5, // Caller A yes, Caller B no
      first_call_booked: 1,
      distinct_callers: 2, // C outside window; NULL phone + soft-deleted excluded
    });
  });

  it('HAPPY: absent range = all-time — the 60-day-old booked caller joins the cut', async () => {
    // WHO: owner on the default (unfiltered) Analytics view.
    // WHAT: null bounds drop out of the predicates; Caller C (single booked
    //       call at D60) now counts as a first-call booking.
    // WHEN: first Analytics load, no From/To set.
    // WHERE: the ($2::date IS NULL OR ...) guards of the first_time_fix query.
    // WHY: mishandled null bounds would silently truncate all-time history to
    //      "recent" and the owner would act on the wrong resolution rate.
    const res = await getCohorts();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.first_time_fix).toEqual({
      rate: 2 / 3, // A + C booked first; B did not
      first_call_booked: 2,
      distinct_callers: 3,
    });
  });

  it('HAPPY: a tenant with no calls gets rate null (unknown), not 0', async () => {
    // WHO: a brand-new tenant opening Analytics before any call arrives.
    // WHAT: zero distinct callers → rate must be null; 0 would claim "nobody
    //       books on the first call", which is a different (false) fact.
    // WHEN: first Analytics load on a fresh tenant.
    // WHERE: the rate = count > 0 ? n/d : null guard in the cohorts handler.
    // WHY: the dashboard renders null as "no data yet" vs 0% as a real number —
    //      conflating them misleads the owner from day one.
    const res = await getCohorts('', emptyTenantId);
    expect(res.statusCode).toBe(200);
    expect(res.json().first_time_fix).toEqual({
      rate: null,
      first_call_booked: 0,
      distinct_callers: 0,
    });
  });

  it('SAD: calendar-invalid bounds degrade to all-time — 200, never a ::date 500', async () => {
    // WHO: a stale bookmark / client bug sending an impossible date.
    // WHAT: optionalDateBounds rejects "2026-02-30" to null before the $2::date
    //       cast; the first_time_fix query (now part of the 6-query
    //       Promise.all) must not be the one that 500s the whole endpoint.
    // WHEN: malformed query string on the Analytics tab.
    // WHERE: optionalDateBounds → the first_time_fix $2/$3 params.
    // WHY: one bad cast rejects the Promise.all — every cohort panel dies.
    const res = await getCohorts('?start_date=2026-02-30&end_date=2026-13-01');
    expect(res.statusCode).toBe(200);
    expect(res.json().first_time_fix.distinct_callers).toBe(3); // all-time shape
  });

  it('SAD: no tenant context → 401 before any SQL runs', async () => {
    // WHO: an unauthenticated probe hitting the cohorts endpoint directly.
    // WHAT: requireTenantId sees neither req.tenantId nor req.auth → 401.
    // WHEN: expired JWT / missing auth.
    // WHERE: requireTenantId (middleware.ts) in the cohorts handler.
    // WHY: first_time_fix aggregates caller behavior — cross-tenant leakage
    //      here would expose another business's conversion performance.
    const res = await app.inject({ method: 'GET', url: '/analytics/cohorts' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ success: false, error: 'Authentication required' });
  });
});
