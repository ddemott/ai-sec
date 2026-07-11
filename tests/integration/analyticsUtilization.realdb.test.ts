/**
 * Real-DB test for GET /analytics/utilization (src/routes/analytics.ts) — the
 * weekday × hour staffed-vs-booked grid behind the dashboard Utilization panel
 * (GAPS §6 closure).
 *
 * Mocked pg cannot exercise this endpoint's SQL at all: the CTE chain
 * (tenant_tz → bounds → shift_segments UNION ALL night-shift legs → staffed /
 * booked LATERAL generate_series buckets → LEFT JOIN) is exactly the kind of
 * statement where a column typo, a bad EXTRACT, or broken minute math sails
 * through a mocked suite green and 500s (or silently mis-counts) on the live
 * Analytics tab. Same harness as analytics.realdb.test.ts: the REAL route
 * module on a throwaway Fastify app over a REAL pg.Pool (api_user,
 * RLS-scoped), fixtures created in beforeAll / deleted in afterAll, honest
 * skip when the DB is down (hard-fail under REQUIRE_DB_TESTS=1).
 *
 * Fixture timeline (tenant timezone Etc/UTC so wall clock == UTC):
 *   TUE  (a Tuesday 7-13 days ago, inside the default 28-day window)
 *        shift Tess 09:00-17:00
 *        appt  10:00-11:00Z 'scheduled'            → counts (60 min at hour 10)
 *        appt  13:00-14:00Z 'canceled'             → must NOT count
 *        appt  14:00-15:00Z 'scheduled' is_deleted → must NOT count
 *   WED  (TUE + 1 day) night shift Tess 22:00-02:00 (start > end, cross-midnight)
 *        appt  01:00-01:30Z 'completed'            → counts (30 min at hour 1;
 *        completed occupies staffed time just like the booking RPCs' 'scheduled')
 *   THU  (TUE + 2 days) is_off row (NULL times)    → contributes nothing
 *   OLD  (a Monday 56-62 days ago, OUTSIDE the default window)
 *        shift Tess 09:00-12:00 — visible only with an explicit From/To range
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Client, Pool } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  createTenant,
  createEmployee,
  createResource,
  createCustomer,
  createScheduleEntry,
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

/**
 * The most recent date with UTC day-of-week `targetDow` that is at least
 * `minDaysAgo` days in the past. Keeps the fixtures on KNOWN weekdays (the
 * grid is keyed by dow) without hardcoding calendar dates that go stale.
 */
function recentDateWithDow(targetDow: number, minDaysAgo: number): { iso: string; dow: number } {
  for (let daysAgo = minDaysAgo; daysAgo < minDaysAgo + 7; daysAgo++) {
    const d = new Date(NOW_MS - daysAgo * 86_400_000);
    if (d.getUTCDay() === targetDow) return { iso: d.toISOString().slice(0, 10), dow: targetDow };
  }
  throw new Error('unreachable: every 7-day span contains every weekday');
}

const TUE = recentDateWithDow(2, 7); // in-window Tuesday (7-13 days ago)
const WED = { iso: dayISO((NOW_MS - Date.parse(`${TUE.iso}T00:00:00Z`)) / 86_400_000 - 1), dow: 3 };
const THU = { iso: dayISO((NOW_MS - Date.parse(`${TUE.iso}T00:00:00Z`)) / 86_400_000 - 2), dow: 4 };
const OLD = recentDateWithDow(1, 56); // out-of-window Monday (56-62 days ago)

// Window-boundary fixture (its own tenant so it can't perturb the exact-cell
// assertions on the main tenant). BND is a recent Friday; BND_PREV is the day
// before it (a Thursday) — an appointment that STARTS on BND_PREV evening and
// spills past midnight into BND is the clamp's canonical case.
const BND = recentDateWithDow(5, 7); // a recent Friday (dow 5), 7-13 days ago
const BND_PREV = {
  iso: new Date(Date.parse(`${BND.iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10),
  dow: 4, // Thursday
};

interface Cell {
  dow: number;
  hour: number;
  staffed_minutes: number;
  booked_minutes: number;
  utilization: number | null;
}

function cellAt(cells: Cell[], dow: number, hour: number): Cell | undefined {
  return cells.find((c) => c.dow === dow && c.hour === hour);
}

let setup: Client;
let pool: Pool;
let app: FastifyInstance;
let dbAvailable = false;
let tenantId: string;
let emptyTenantId: string;
let boundaryTenantId: string;
const tenantsToClean: string[] = [];

function get(path: string, withTenant: string | false = 'main') {
  const headers: Record<string, string> = {};
  if (withTenant === 'main') headers['x-tenant-id'] = tenantId;
  else if (withTenant) headers['x-tenant-id'] = withTenant;
  return app.inject({ method: 'GET', url: path, headers });
}

async function insertAppointment(opts: {
  resourceId: string;
  customerId: string;
  start: string;
  end: string;
  status: string;
  isDeleted?: boolean;
  tenant?: string; // defaults to the main fixture tenant
}): Promise<void> {
  await setup.query(
    `INSERT INTO appointments
       (tenant_id, resource_id, customer_id, start_time, end_time, description, status, is_deleted)
     VALUES ($1, $2, $3, $4, $5, 'utilization fixture', $6, $7)`,
    [
      opts.tenant ?? tenantId,
      opts.resourceId,
      opts.customerId,
      opts.start,
      opts.end,
      opts.status,
      opts.isDeleted ?? false,
    ]
  );
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });

    app = Fastify({ logger: false });
    // Same tenant-injection seam as analytics.realdb.test.ts: x-tenant-id
    // stands in for tenantMiddleware so the ROUTE + SQL run unmodified;
    // requests without the header exercise requireTenantId → 401.
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
    tenantId = await createTenant(setup, 'Utilization Heatmap Salon', 'salon', 'Etc/UTC');
    tenantsToClean.push(tenantId);
    emptyTenantId = await createTenant(setup, 'Utilization Empty Tenant', 'salon', 'Etc/UTC');
    tenantsToClean.push(emptyTenantId);

    const employeeId = await createEmployee(setup, tenantId, 'Utilization Tess', ['haircut']);
    const resourceId = await createResource(setup, tenantId, 'Utilization Chair');
    const customerId = await createCustomer(setup, tenantId, 'Heatmap Hannah', '+16305557777');

    // ── Shifts ──────────────────────────────────────────────────────
    // Normal day shift: Tuesday 9-17 → 8 staffed hour-cells of 60 min each.
    await createScheduleEntry(setup, tenantId, employeeId, TUE.iso, '09:00', '17:00');
    // Cross-midnight night shift: Wednesday 22:00-02:00 (start > end). Under
    // the booking-RPC semantics the WED row covers WED [00:00,02:00) and
    // WED [22:00,24:00) — all four cells land on Wednesday's dow.
    await createScheduleEntry(setup, tenantId, employeeId, WED.iso, '22:00', '02:00');
    // Day off: NULL times, is_off=true — must contribute nothing.
    await createScheduleEntry(setup, tenantId, employeeId, THU.iso, '09:00', '17:00', true);
    // Old shift outside the default 28-day window: Monday 9-12, ~8 weeks ago.
    await createScheduleEntry(setup, tenantId, employeeId, OLD.iso, '09:00', '12:00');

    // ── Appointments ────────────────────────────────────────────────
    await insertAppointment({
      resourceId,
      customerId,
      start: `${TUE.iso}T10:00:00Z`,
      end: `${TUE.iso}T11:00:00Z`,
      status: 'scheduled',
    });
    await insertAppointment({
      resourceId,
      customerId,
      start: `${TUE.iso}T13:00:00Z`,
      end: `${TUE.iso}T14:00:00Z`,
      status: 'canceled', // canceled frees the slot — must NOT count as booked
    });
    await insertAppointment({
      resourceId,
      customerId,
      start: `${TUE.iso}T14:00:00Z`,
      end: `${TUE.iso}T15:00:00Z`,
      status: 'scheduled',
      isDeleted: true, // soft-deleted — must NOT count
    });
    await insertAppointment({
      resourceId,
      customerId,
      start: `${WED.iso}T01:00:00Z`,
      end: `${WED.iso}T01:30:00Z`,
      status: 'completed', // past appointments occupy staffed time too
    });

    // ── Boundary tenant (own tenant, isolated) ──────────────────────
    // BND staffed 00:00-08:00 (hours 0..7). A single appointment starts the
    // evening BEFORE the window (BND_PREV 23:30) and spills across midnight to
    // BND 00:30, so only its 30 in-window minutes (BND 00:00-00:30) belong to
    // the [BND, BND] query window — the 30 pre-midnight minutes fall on
    // BND_PREV, OUTSIDE the window, and must be clamped away.
    boundaryTenantId = await createTenant(setup, 'Utilization Boundary Tenant', 'salon', 'Etc/UTC');
    tenantsToClean.push(boundaryTenantId);
    const bndEmployeeId = await createEmployee(setup, boundaryTenantId, 'Boundary Bea', [
      'haircut',
    ]);
    const bndResourceId = await createResource(setup, boundaryTenantId, 'Boundary Chair');
    const bndCustomerId = await createCustomer(
      setup,
      boundaryTenantId,
      'Boundary Bob',
      '+16305558888'
    );
    await createScheduleEntry(setup, boundaryTenantId, bndEmployeeId, BND.iso, '00:00', '08:00');
    await insertAppointment({
      tenant: boundaryTenantId,
      resourceId: bndResourceId,
      customerId: bndCustomerId,
      start: `${BND_PREV.iso}T23:30:00Z`,
      end: `${BND.iso}T00:30:00Z`,
      status: 'scheduled',
    });

    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[analyticsUtilization.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (setup) {
    // Only OUR tenants — appointments/customers/employees/schedule cascade off tenants.
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

describe('GET /analytics/utilization (real SQL)', () => {
  it('HAPPY: default window — exact staffed/booked minutes per cell; canceled + soft-deleted excluded', async () => {
    // WHO: an owner opening the Utilization panel with no date filter.
    // WHAT: the staffed CTE buckets the Tue 9-17 shift into 8 hour-cells of 60
    //       staffed minutes; the booked CTE credits exactly the 60-min
    //       scheduled appointment to hour 10; the canceled (13:00) and
    //       soft-deleted (14:00) appointments leave their hours at 0 booked.
    // WHEN: default last-28-days window (TUE is 7-13 days ago → inside).
    // WHERE: /analytics/utilization CTE chain in src/routes/analytics.ts.
    // WHY: minute-math or occupancy-predicate drift here silently misleads
    //      staffing decisions — only real SQL over real rows can catch it.
    const res = await get('/analytics/utilization');
    expect(res.statusCode).toBe(200);
    const { cells } = res.json();

    // Tuesday: exactly hours 9..16 staffed (17:00 end is exclusive — no hour-17 cell).
    const tueCells = cells.filter((c) => c.dow === TUE.dow);
    expect(tueCells.map((c) => c.hour)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    for (const c of tueCells) expect(c.staffed_minutes).toBe(60);

    // Hour 10 carries the full 60-min booking; utilization = 1.
    expect(cellAt(cells, TUE.dow, 10)).toMatchObject({
      staffed_minutes: 60,
      booked_minutes: 60,
      utilization: 1,
    });
    // Canceled (hour 13) and soft-deleted (hour 14) appointments count nothing.
    expect(cellAt(cells, TUE.dow, 13)?.booked_minutes).toBe(0);
    expect(cellAt(cells, TUE.dow, 14)?.booked_minutes).toBe(0);
    expect(cellAt(cells, TUE.dow, 9)?.booked_minutes).toBe(0);

    // The old Monday shift (~8 weeks ago) is outside the default 28-day window.
    expect(cells.some((c) => c.dow === OLD.dow)).toBe(false);
    // The is_off Thursday row contributes no cells.
    expect(cells.some((c) => c.dow === THU.dow)).toBe(false);
  });

  it('HAPPY: cross-midnight night shift (22:00-02:00) yields both same-day legs, with a completed booking in the post-midnight leg', async () => {
    // WHO: a shop with a night crew (e.g. mobile tire rescue) reading the grid.
    // WHAT: a shift row with start_time > end_time splits into the two
    //       same-day segments the booking RPC recognizes — WED [22,24) and
    //       WED [00,02) — so the staffed cells are Wednesday hours 0,1,22,23
    //       (60 min each). The 01:00-01:30 'completed' appointment books 30
    //       minutes into hour 1 (utilization 0.5): completed status occupies
    //       staffed time, and the cross-midnight leg attributes it to the
    //       same weekday the RPC would validate it against.
    // WHEN: default window (WED is inside it).
    // WHERE: the two night-shift UNION ALL branches of shift_segments + the
    //        booked CTE's hour bucketing.
    // WHY: cross-midnight is THE historical scheduling foot-gun here (fix #30,
    //      20260404 migration) — a regression would zero out night-crew
    //      capacity or double-count it across weekdays.
    const res = await get('/analytics/utilization');
    expect(res.statusCode).toBe(200);
    const { cells } = res.json();

    const wedCells = cells.filter((c) => c.dow === WED.dow);
    expect(wedCells.map((c) => c.hour).sort((a, b) => a - b)).toEqual([0, 1, 22, 23]);
    for (const c of wedCells) expect(c.staffed_minutes).toBe(60);

    expect(cellAt(cells, WED.dow, 1)).toMatchObject({
      staffed_minutes: 60,
      booked_minutes: 30,
      utilization: 0.5,
    });
    expect(cellAt(cells, WED.dow, 22)?.booked_minutes).toBe(0);
  });

  it('HAPPY: explicit From/To range is respected — only the old Monday shift appears', async () => {
    // WHO: an owner narrowing the panel to a past period via the From/To filter.
    // WHAT: bounds bracketing only the ~8-week-old Monday shift must return
    //       exactly its cells (hours 9-11) and NONE of the recent Tue/Wed
    //       cells — proving the $2/$3 bounds actually reach both the shift
    //       and the appointment predicates.
    // WHEN: start/end set around OLD (a Monday 56-62 days ago).
    // WHERE: optionalDateBounds → the bounds CTE COALESCE defaults.
    // WHY: if bounds were ignored the filter UI would silently lie; if they
    //      over-applied, the default view would be empty.
    const start = dayISO(
      (NOW_MS - Date.parse(`${OLD.iso}T00:00:00Z`)) / 86_400_000 + 2 // 2 days before OLD
    );
    const end = dayISO((NOW_MS - Date.parse(`${OLD.iso}T00:00:00Z`)) / 86_400_000 - 2); // 2 after
    const res = await get(`/analytics/utilization?start_date=${start}&end_date=${end}`);
    expect(res.statusCode).toBe(200);
    const { cells } = res.json();

    expect(cells.map((c) => [c.dow, c.hour])).toEqual([
      [OLD.dow, 9],
      [OLD.dow, 10],
      [OLD.dow, 11],
    ]);
    for (const c of cells) expect(c.staffed_minutes).toBe(60);
    for (const c of cells) expect(c.booked_minutes).toBe(0);
  });

  it('HAPPY: a tenant with no shifts gets an empty grid, not an error', async () => {
    // WHO: a brand-new tenant that finished signup but never added shifts.
    // WHAT: { cells: [] } — the staffed CTE drives the result, so zero shift
    //       rows means zero cells (the dashboard renders EmptyState from it).
    // WHEN: first visit to the Analytics tab after onboarding.
    // WHERE: the LEFT JOIN direction (staffed → booked) in the final SELECT.
    // WHY: if the query errored (or drove from appointments instead), every
    //      new tenant's Analytics tab would break on day one.
    const res = await get('/analytics/utilization', emptyTenantId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cells: [] });
  });

  it('SAD: calendar-invalid dates degrade to the default window — 200, never a ::date 500', async () => {
    // WHO: a stale bookmark or client bug sending a correctly-SHAPED but
    //      impossible date.
    // WHAT: optionalDateBounds rejects "2026-02-30" to null BEFORE the
    //       $2::date cast (Postgres would throw 22008) → the default
    //       28-day window applies and the recent Tuesday cells come back.
    // WHEN: any manual URL edit.
    // WHERE: optionalDateBounds → the bounds CTE.
    // WHY: same guard class the other analytics realdb tests pin — a
    //      regression 500s the whole panel on a malformed query string.
    const res = await get('/analytics/utilization?start_date=2026-02-30&end_date=not-a-date');
    expect(res.statusCode).toBe(200);
    const { cells } = res.json();
    expect(cellAt(cells, TUE.dow, 10)?.booked_minutes).toBe(60);
  });

  it('EDGE: a boundary-crossing appointment contributes ONLY its in-window minutes (clamp)', async () => {
    // WHO: a shop whose late-night appointment straddles the first day of the
    //      owner's selected window.
    // WHAT: an appointment BND_PREV 23:30 → BND 00:30 overlaps the [BND, BND]
    //       window by exactly 30 minutes (BND 00:00-00:30). The appt_intervals
    //       CTE clamps its start up to the window start (00:00 BND) before the
    //       hour-bucketing, so hour 0 on BND shows 30 booked minutes — NOT 90
    //       (the whole appt) and NOT 0. The 30 pre-midnight minutes belong to
    //       BND_PREV (a different weekday) and must not leak into any cell.
    // WHEN: an explicit From/To window whose first day is mid-appointment.
    // WHERE: the GREATEST(start, window_start) clamp + the interval-overlap
    //        WHERE in the appt_intervals CTE (the LEAST/end side is symmetric).
    // WHY: WITHOUT the fix the old start-date-in-window WHERE excluded this
    //      appointment entirely (0 booked); an unclamped spill-over could also
    //      land on a same-weekday cell staffed elsewhere in the window and
    //      silently inflate utilization — exactly the correctness bug the
    //      clamp closes. A pure-mock suite cannot exercise this SQL at all.
    const res = await get(
      `/analytics/utilization?start_date=${BND.iso}&end_date=${BND.iso}`,
      boundaryTenantId
    );
    expect(res.statusCode).toBe(200);
    const { cells } = res.json();

    // Only BND's staffed hours 0..7 appear; hour 0 carries exactly the 30
    // in-window minutes (utilization 0.5), never 90 or 0.
    expect(cellAt(cells, BND.dow, 0)).toMatchObject({
      staffed_minutes: 60,
      booked_minutes: 30,
      utilization: 0.5,
    });
    // The pre-midnight leg (BND_PREV, a different weekday) never leaks in.
    expect(cells.some((c) => c.dow === BND_PREV.dow)).toBe(false);
    // Later staffed hours stay empty — no phantom minutes anywhere else.
    expect(cellAt(cells, BND.dow, 1)?.booked_minutes).toBe(0);
  });

  it('SAD: request with no tenant context is rejected 401 before any SQL runs', async () => {
    // WHO: an unauthenticated caller (expired JWT, or a probe).
    // WHAT: requireTenantId sees neither req.tenantId nor req.auth → 401;
    //       no tenant SQL executes.
    // WHEN: any request that skipped/failed the auth middleware.
    // WHERE: requireTenantId (middleware.ts) inside the utilization handler.
    // WHY: utilization exposes staffing patterns — cross-tenant leakage here
    //      would hand a competitor a tenant's entire operating schedule.
    const res = await get('/analytics/utilization', false);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ success: false, error: 'Authentication required' });
  });
});
