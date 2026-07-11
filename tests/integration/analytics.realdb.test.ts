/**
 * Real-DB companion test for the analytics routes' date-range SQL
 * (src/routes/analytics.ts — /analytics/calls, /analytics/cohorts,
 * /coverage RPC, /analytics/ai-cost).
 *
 * Mandated by docs/TODO.md "Verification blind spots": the existing src/analytics.test.ts mocks
 * pg entirely — a queued Error merely "simulates a column missing", so the real
 * statements ($n::date casts, COALESCE(..., now() - interval), FILTER (WHERE),
 * GROUP BY, the abandonment_by_service JOIN on requested_service_id) never
 * execute. Mocked-API tests prove the mock works, not the integration: a column
 * typo, an ambiguous reference, or a bad cast in any of these queries would
 * sail through the mocked suite green and 500 on the live Analytics tab. This
 * suite registers the REAL route module on a throwaway Fastify app over a REAL
 * pg.Pool (api_user, RLS-scoped like prod) and drives it with app.inject, so a
 * SQL-shape bug fails CI.
 *
 * Strategy mirrors agentToolsBookingIntegration.test.ts /
 * agentToolsPreferences.test.ts: real Pool on API_DB_URL +
 * createWithTenantClient + per-suite fixtures created in beforeAll and deleted
 * in afterAll (only OUR tenant — other suites share this DB; never TRUNCATE).
 * Tenant context is injected via a preHandler hook setting req.tenantId (the
 * same seam the mocked analytics.test.ts uses), standing in for
 * tenantMiddleware. Skips honestly when the DB is down; hard-fails under
 * REQUIRE_DB_TESTS=1.
 *
 * Fixture timeline (all instants at 12:00Z; test DB session TimeZone is UTC):
 *   D60 (60 days ago)  vs3  caller +16305550002, outcome 'transferred', no appt
 *   D10 (10 days ago)  vs1  caller +16305550001, outcome 'booked', appt→Haircut
 *                      apptRita (Rita × Haircut $40), apptOtto next day (Otto × Color $100)
 *   D9  (9 days ago)   vs2  caller '630-555-0001' (same digits as vs1!), empty
 *                           outcome, NO appt, requested_service_id → Color
 *                      vs4  soft-deleted (is_deleted=true) — must appear NOWHERE
 *   D5  (5 days ago)   vs5  NULL caller_phone, NULL outcome, no appt
 *   Query window: start=D15 .. end=D5 (so vs5 sits exactly ON the inclusive
 *   end day, and vs3 is visible only all-time).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Client, Pool } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  createTenant,
  createService,
  createEmployee,
  createResource,
  createCustomer,
  createScheduleEntry,
  assignEmployeeToService,
  skipIfDbDown,
} from '../utils';
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
const D5 = dayISO(5);
const WINDOW_START = dayISO(15);
const WINDOW_END = D5; // vs5 lands exactly on the end day → proves inclusivity

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let serviceHairId: string;
let serviceColorId: string;
const tenantsToClean: string[] = [];

function get(path: string, withTenant = true) {
  return app.inject({
    method: 'GET',
    url: path,
    headers: withTenant ? { 'x-tenant-id': tenantId } : {},
  });
}

async function insertVoiceSession(opts: {
  call_id: string;
  caller_phone: string | null;
  started_at: string;
  outcome: string | null;
  appointment_id?: string;
  requested_service_id?: string;
  is_deleted?: boolean;
}): Promise<void> {
  await setup.query(
    `INSERT INTO voice_sessions
       (tenant_id, call_id, caller_phone, started_at, status, outcome,
        appointment_id, requested_service_id, is_deleted)
     VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, $8)`,
    [
      tenantId,
      opts.call_id,
      opts.caller_phone,
      opts.started_at,
      opts.outcome,
      opts.appointment_id ?? null,
      opts.requested_service_id ?? null,
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
    // Same tenant-injection seam the mocked analytics.test.ts uses: the real
    // tenantMiddleware would set req.tenantId after JWT validation; here the
    // x-tenant-id header plays that role so the ROUTE + SQL under test run
    // unmodified. Requests without the header exercise the unauthenticated
    // path (requireTenantId → 401).
    type TenantRequest = FastifyRequest & { tenantId?: string; auth?: { user_id: string } };
    app.addHook('preHandler', async (request: TenantRequest) => {
      const headerTenant = request.headers['x-tenant-id'];
      if (typeof headerTenant === 'string' && headerTenant) {
        request.tenantId = headerTenant;
        request.auth = { user_id: '00000000-0000-0000-0000-000000000001' };
      }
    });
    const withTenantClient = createWithTenantClient(pool);
    registerAnalyticsRoutes(app, pool, withTenantClient);
    await app.ready();

    // ── Business shape ──────────────────────────────────────────────
    tenantId = await createTenant(setup, 'Blindspot Analytics Salon', 'salon', 'Etc/UTC');
    tenantsToClean.push(tenantId);
    serviceHairId = await createService(setup, tenantId, 'Haircut', 30, 40);
    serviceColorId = await createService(setup, tenantId, 'Color', 60, 100);
    const resourceId = await createResource(setup, tenantId, 'Chair 1');
    const custRitaId = await createCustomer(setup, tenantId, 'Repeat Rita', '+16305550001');
    const custOttoId = await createCustomer(setup, tenantId, 'One-time Otto', '+16305550002');

    // Coverage fixtures: a skilled employee, on shift tomorrow, mapped to the
    // Haircut service — gives check_coverage_gaps() real inputs to chew on.
    await setup.query(
      `UPDATE services SET required_skills = ARRAY['haircut'] WHERE service_id = $1`,
      [serviceHairId]
    );
    const employeeId = await createEmployee(setup, tenantId, 'Coverage Cathy', ['haircut']);
    await assignEmployeeToService(setup, tenantId, serviceHairId, employeeId);
    await createScheduleEntry(setup, tenantId, employeeId, dayISO(-1), '09:00', '17:00');

    // ── Appointments (in the query window, with service_id for the joins) ──
    const apptRita = await setup.query(
      `INSERT INTO appointments
         (tenant_id, resource_id, customer_id, service_id, start_time, end_time, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'Haircut for Rita', 'scheduled')
       RETURNING appointment_id`,
      [tenantId, resourceId, custRitaId, serviceHairId, `${D10}T14:00:00Z`, `${D10}T14:30:00Z`]
    );
    const apptRitaId: string = apptRita.rows[0].appointment_id;
    await setup.query(
      `INSERT INTO appointments
         (tenant_id, resource_id, customer_id, service_id, start_time, end_time, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'Color for Otto', 'scheduled')`,
      [tenantId, resourceId, custOttoId, serviceColorId, `${D9}T14:00:00Z`, `${D9}T15:00:00Z`]
    );

    // ── Voice sessions (see the fixture timeline in the header) ──────
    await insertVoiceSession({
      call_id: 'blindspot-vs1',
      caller_phone: '+16305550001',
      started_at: `${D10}T12:00:00Z`,
      outcome: 'booked',
      appointment_id: apptRitaId,
    });
    await insertVoiceSession({
      call_id: 'blindspot-vs2',
      caller_phone: '630-555-0001', // same last-10 digits as vs1, different format
      started_at: `${D9}T12:00:00Z`,
      outcome: '', // empty string → 'no_outcome' bucket
      requested_service_id: serviceColorId, // abandoned while trying to book Color
    });
    await insertVoiceSession({
      call_id: 'blindspot-vs3',
      caller_phone: '+16305550002',
      started_at: `${D60}T12:00:00Z`, // outside the window; all-time only
      outcome: 'transferred',
    });
    await insertVoiceSession({
      call_id: 'blindspot-vs4',
      caller_phone: '+16305550003',
      started_at: `${D9}T13:00:00Z`,
      outcome: 'booked',
      is_deleted: true, // soft-deleted — must never surface
    });
    await insertVoiceSession({
      call_id: 'blindspot-vs5',
      caller_phone: null, // forwarded-line calls can have no caller ID
      started_at: `${D5}T12:00:00Z`, // exactly ON the inclusive end day
      outcome: null,
    });

    // ── AI cost events (month-to-date; created_at defaults to now()) ──
    await setup.query(
      `INSERT INTO ai_cost_events
         (tenant_id, source, provider, model, input_tokens, output_tokens,
          characters_count, audio_duration_ms, estimated_cost_usd)
       VALUES
         ($1, 'llm', 'openai', 'gpt-4o-mini', 100, 10, 0, 0, 0.001),
         ($1, 'llm', 'openai', 'gpt-4o-mini', 200, 20, 0, 0, 0.002),
         ($1, 'tts', 'openai', 'tts-1',       0,   0,  500, 0, 0.010)`,
      [tenantId]
    );

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[analytics.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    // Only OUR tenant — everything (voice_sessions, appointments, customers,
    // services, employees, schedule, ai_cost_events) cascades off tenants.
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

// ═════════════════════════════════════════════════════════════════════
// GET /analytics/calls — outcome breakdown + per-day volume + totals
// ═════════════════════════════════════════════════════════════════════

describe('GET /analytics/calls (real SQL)', () => {
  it('HAPPY: a valid From/To window returns totals/by_outcome/by_day, end day inclusive, soft-deleted + out-of-window excluded', async () => {
    // WHO: an owner narrowing the Analytics tab to a two-week window.
    // WHAT: the 3 voice_sessions queries with ($n::date IS NULL OR ...) guards
    //       actually execute — casts, FILTER (WHERE), GROUP BY, to_char.
    // WHEN: dashboard AnalyticsView sets From/To and refetches.
    // WHERE: /analytics/calls handler, analytics.ts ~149-181.
    // WHY a failure matters: a typo'd column or bad ::date cast here 500s the
    //     Analytics tab on every windowed load — invisible to the mocked suite.
    const res = await get(`/analytics/calls?start_date=${WINDOW_START}&end_date=${WINDOW_END}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // In-window live sessions: vs1 (booked), vs2 (no_outcome), vs5 (no_outcome,
    // ON the end day — proves `< end + interval '1 day'` inclusivity).
    // Excluded: vs3 (60 days ago), vs4 (soft-deleted).
    expect(body.totals).toEqual({ total: 3, booked: 1, abandoned: 2 });

    const outcomes = new Map(
      (body.by_outcome as Array<{ outcome: string; count: number; booked: number }>).map((r) => [
        r.outcome,
        r,
      ])
    );
    expect(outcomes.get('booked')).toEqual({ outcome: 'booked', count: 1, booked: 1 });
    // NULL and '' outcomes both collapse into the same no_outcome bucket.
    expect(outcomes.get('no_outcome')).toEqual({ outcome: 'no_outcome', count: 2, booked: 0 });
    expect(body.by_outcome).toHaveLength(2);
    // ORDER BY count DESC — the bigger bucket leads.
    expect(body.by_outcome[0].outcome).toBe('no_outcome');

    // Per-day sparkline: one call on each of D10/D9/D5 (session TZ is UTC and
    // fixtures sit at 12:00Z, so the day strings are exact).
    const byDay = new Map(
      (body.by_day as Array<{ day: string; total: number; booked: number }>).map((r) => [r.day, r])
    );
    expect(body.by_day).toHaveLength(3);
    expect(byDay.get(D10)).toEqual({ day: D10, total: 1, booked: 1 });
    expect(byDay.get(D9)).toEqual({ day: D9, total: 1, booked: 0 });
    expect(byDay.get(D5)).toEqual({ day: D5, total: 1, booked: 0 });
  });

  it('HAPPY: absent range = all-time totals, while by_day keeps its 30-day default floor', async () => {
    // WHO: an owner opening the Analytics tab fresh (no filters set).
    // WHAT: null bounds must drop out of the predicates (all-time totals
    //       include the 60-day-old vs3), while by_day's COALESCE($2::date,
    //       now() - interval '30 days') floor still hides it from the sparkline.
    // WHEN: first load of the Analytics tab.
    // WHERE: /analytics/calls, the ($2::date IS NULL OR ...) guard vs the
    //        by_day COALESCE lower bound — two DIFFERENT null behaviors.
    // WHY: if the guard mis-handles null the tab shows an empty (or erroring)
    //      all-time view; if COALESCE breaks, the sparkline goes blank/unbounded.
    const res = await get('/analytics/calls');
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // All 4 live sessions (vs3 now included); vs4 still soft-delete-excluded.
    // vs3 is 'transferred' with no appointment — NOT abandoned.
    expect(body.totals).toEqual({ total: 4, booked: 1, abandoned: 2 });
    const outcomes = new Map(
      (body.by_outcome as Array<{ outcome: string; count: number }>).map((r) => [r.outcome, r])
    );
    expect(outcomes.get('transferred')?.count).toBe(1);

    // by_day floors at 30 days when no start is supplied → vs3 (60d) absent.
    const days = (body.by_day as Array<{ day: string }>).map((r) => r.day);
    expect(days).toHaveLength(3);
    expect(days).not.toContain(D60);
  });

  it('SAD: calendar-invalid dates (2026-02-30 / garbage) degrade to all-time — 200, never a $n::date 500', async () => {
    // WHO: a user (or a stale bookmark) sending a correctly-SHAPED but
    //      calendar-invalid date.
    // WHAT: optionalDateBounds must reject "2026-02-30" (regex-valid, not a
    //       real date) to null BEFORE it reaches the $2::date cast — Postgres
    //       would throw 22008 'date/time field value out of range'.
    // WHEN: any manual URL edit or client bug.
    // WHERE: optionalDateBounds → /analytics/calls SQL params.
    // WHY: this is the exact class of bug the mocked suite could only
    //      "simulate" — here the real cast would really throw if the guard
    //      ever regressed.
    const res = await get('/analytics/calls?start_date=2026-02-30&end_date=not-a-date');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals).toEqual({ total: 4, booked: 1, abandoned: 2 }); // all-time
  });
});

// ═════════════════════════════════════════════════════════════════════
// GET /analytics/cohorts — repeat callers, by-service, CLV, abandonment
// ═════════════════════════════════════════════════════════════════════

describe('GET /analytics/cohorts (real SQL)', () => {
  it('HAPPY: windowed cohorts — phone-format collapse, booked-by-service, summary CTE, CLV ordering, abandonment_by_service', async () => {
    // WHO: an owner asking "who keeps calling, what books, what do we lose?"
    // WHAT: all 5 cohort queries execute for real — regexp_replace/right(...)
    //       grouping, the per_caller CTE, the appointments↔services joins, and
    //       the abandonment JOIN on voice_sessions.requested_service_id (the
    //       column whose pre-migration absence 500'd prod; a rename/typo today
    //       would fail HERE, not in the 42703 degrade path).
    // WHEN: Analytics tab with a From/To window set.
    // WHERE: /analytics/cohorts handler, analytics.ts ~204-345.
    // WHY: an ambiguous column or broken join in ANY of the Promise.all five
    //      rejects the whole endpoint — every cohort panel dies at once.
    const res = await get(`/analytics/cohorts?start_date=${WINDOW_START}&end_date=${WINDOW_END}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // vs1 (+16305550001) and vs2 (630-555-0001) collapse to one caller on the
    // last-10-digits key → the ONLY repeat caller. vs5 (NULL phone) excluded.
    expect(body.repeat_callers).toHaveLength(1);
    expect(body.repeat_callers[0]).toMatchObject({
      phone: '6305550001',
      call_count: 2,
      booked_count: 1,
    });

    // Booked calls → appointment → service: only vs1 booked (Haircut).
    expect(body.by_service).toEqual([{ service: 'Haircut', booked_count: 1 }]);

    // Summary CTE: 1 distinct caller in-window, who is repeat, 2 calls total.
    expect(body.summary).toEqual({
      distinct_callers: 1,
      repeat_callers: 1,
      repeat_call_volume: 2,
      total_calls: 2,
    });

    // CLV: Otto's $100 Color outranks Rita's $40 Haircut; revenue must be a
    // JSON NUMBER (::float8), not a Postgres numeric string.
    expect(body.top_customers).toHaveLength(2);
    expect(body.top_customers[0]).toMatchObject({ name: 'One-time Otto', visits: 1, revenue: 100 });
    expect(body.top_customers[1]).toMatchObject({ name: 'Repeat Rita', visits: 1, revenue: 40 });
    expect(typeof body.top_customers[0].revenue).toBe('number');

    // Abandonment: vs2 wanted Color but never booked; vs5 (no requested
    // service) and vs4 (soft-deleted) contribute nothing.
    expect(body.abandonment_by_service).toEqual([{ service: 'Color', abandoned_count: 1 }]);
  });

  it('HAPPY: absent range = all-time — the 60-day-old caller joins the summary', async () => {
    // WHO: owner on the default (unfiltered) cohorts view.
    // WHAT: null bounds include vs3 → a second distinct caller appears; that
    //       caller has only one call so repeat counts are unchanged.
    // WHEN: first Analytics load.
    // WHERE: /analytics/cohorts per_caller CTE date guards.
    // WHY: if a null bound accidentally filters (e.g. `>= NULL::date` semantics
    //      mishandled), all-time silently shrinks to "recent" and the owner
    //      makes decisions on truncated history.
    const res = await get('/analytics/cohorts');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary).toEqual({
      distinct_callers: 2, // 6305550001 + 6305550002 (vs5's NULL phone excluded)
      repeat_callers: 1,
      repeat_call_volume: 2,
      total_calls: 3,
    });
  });

  it('SAD: calendar-invalid bounds degrade to all-time — 200, not a cast error', async () => {
    // WHO: a client bug sending an impossible date to the cohorts endpoint.
    // WHAT: same optionalDateBounds guard as /analytics/calls, but a regression
    //       here rejects a 5-query Promise.all — the biggest blast radius in
    //       the analytics module.
    // WHEN: malformed query string on the Analytics tab.
    // WHERE: optionalDateBounds → all five cohort statements' $2/$3 params.
    // WHY: one bad cast = every cohort panel 500s simultaneously.
    const res = await get('/analytics/cohorts?start_date=2026-13-01&end_date=2026-02-30');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.distinct_callers).toBe(2); // all-time shape
  });
});

// ═════════════════════════════════════════════════════════════════════
// GET /coverage — check_coverage_gaps() RPC
// ═════════════════════════════════════════════════════════════════════

describe('GET /coverage (real check_coverage_gaps RPC)', () => {
  it('HAPPY: the RPC executes against the real schema and returns the declared row shape', async () => {
    // WHO: the dashboard coverage bars asking "is anyone able to do Haircuts
    //      tomorrow?"
    // WHAT: SELECT ... FROM check_coverage_gaps($1, $2::DATE, $3::DATE) — the
    //       function's declared TABLE(...) columns must still match what the
    //       route projects (service_name, gap_hours, coverage_pct, ...); a
    //       function-signature drift in a migration fails here, not in prod.
    // WHEN: My Team → coverage view load.
    // WHERE: /coverage handler → check_coverage_gaps() (SQL function).
    // WHY: the mocked suite cannot detect a dropped/renamed RPC column — the
    //      real call is the only thing that can.
    const start = dayISO(-1); // tomorrow — Coverage Cathy is on shift 09:00-17:00
    const end = dayISO(-1);
    const res = await get(`/coverage?start_date=${start}&end_date=${end}`);
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(Array.isArray(rows)).toBe(true);
    // The seeded skilled+scheduled+mapped employee guarantees the RPC has real
    // inputs; every returned row must carry the projected columns.
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toHaveProperty('service_name');
      expect(row).toHaveProperty('coverage_pct');
      expect(row).toHaveProperty('status');
      expect(row).toHaveProperty('gap_hours');
    }
    const haircut = rows.find((r: { service_name: string }) => r.service_name === 'Haircut');
    expect(haircut, `expected a Haircut coverage row; got: ${JSON.stringify(rows)}`).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════
// GET /analytics/ai-cost — month-to-date grouped usage
// ═════════════════════════════════════════════════════════════════════

describe('GET /analytics/ai-cost (real SQL)', () => {
  it('HAPPY: groups month-to-date events by source/provider/model and coerces bigint/numeric to JSON numbers', async () => {
    // WHO: an owner (or Dale watching platform spend) on the AI-cost panel.
    // WHAT: the SUM(...)::bigint + numeric aggregation over ai_cost_events with
    //       the date_trunc('month', now()) floor actually runs; the route then
    //       Number()-coerces the string bigints/numerics.
    // WHEN: Analytics/AI-cost view load, any day of the month (fixtures use
    //       created_at DEFAULT now(), so they are always month-to-date).
    // WHERE: /analytics/ai-cost handler, analytics.ts ~491-542.
    // WHY: a column rename in ai_cost_events (a young table) or a broken
    //      GROUP BY would 500 the cost panel; string-typed sums would render
    //      as NaN math in the dashboard.
    const res = await get('/analytics/ai-cost');
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.breakdown).toHaveLength(2); // (llm,openai,gpt-4o-mini) + (tts,openai,tts-1)
    const llm = body.breakdown.find((r: { model: string }) => r.model === 'gpt-4o-mini');
    expect(llm).toMatchObject({
      source: 'llm',
      provider: 'openai',
      input_tokens: 300, // 100 + 200 grouped
      output_tokens: 30,
    });
    expect(typeof llm.estimated_cost_usd).toBe('number');
    expect(llm.estimated_cost_usd).toBeCloseTo(0.003, 8);
    // Highest spend first (ORDER BY SUM(estimated_cost_usd) DESC).
    expect(body.breakdown[0].model).toBe('tts-1');
    expect(body.total_estimated_cost_usd).toBeCloseTo(0.013, 8);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Auth sad path — no tenant context
// ═════════════════════════════════════════════════════════════════════

describe('tenant-context guard', () => {
  it('SAD: request with no tenant context is rejected 401 before any SQL runs', async () => {
    // WHO: an unauthenticated caller (expired JWT, or a probe) hitting the
    //      analytics endpoints directly.
    // WHAT: requireTenantId sees neither req.tenantId nor req.auth → 401
    //       'Authentication required'; no tenant SQL executes.
    // WHEN: any request that skipped/failed the auth middleware.
    // WHERE: requireTenantId (middleware.ts) as invoked by every handler in
    //        analytics.ts.
    // WHY: if this ever returned data, analytics would leak cross-tenant call
    //      and revenue history to anonymous callers.
    for (const path of ['/analytics/calls', '/analytics/cohorts', '/analytics/ai-cost']) {
      const res = await get(path, false);
      expect(res.statusCode, `${path} must 401 without tenant context`).toBe(401);
      expect(res.json()).toEqual({ success: false, error: 'Authentication required' });
    }
  });
});
