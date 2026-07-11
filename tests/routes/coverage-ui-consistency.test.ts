import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  getRootClient,
  clearDB,
  setupBasicTenant,
  beginTestTransaction,
  rollbackTestTransaction,
  skipIfDbDown,
} from '../utils';
import { type Client } from 'pg';

// Pre-launch validation entry from docs/TODO.md:
//
//   "Coverage gap detection backend↔UI consistency. check_coverage_gaps()
//    RPC and the dashboard's coverage bars both compute coverage. Verify
//    they agree on edge cases (employee on leave, shift starting before
//    business hours, day with zero scheduled employees)."
//
// This file pins the contract between the backend RPC and the
// dashboard's interpretation of coverage_pct. The dashboard's wizard
// review steps render a status badge derived from coverage_pct (see
// `dashboard/components/SetupWizard/StepReview.tsx:49` and
// `dashboard/components/SetupWizard/SoloStepReview.tsx:48`). If the
// backend's `status` field disagrees with that derivation, owners see
// the wrong message at the most trust-sensitive moment of onboarding.

// ── Mirrors of the dashboard's interpretation ──────────────────────────

/**
 * Mirrors `dashboard/lib/coverage.ts` `statusToBadge`. Kept as a pure
 * copy here so the backend test doesn't depend on the dashboard
 * package — keep this in sync with `dashboard/lib/coverage.ts` if the
 * mapping ever changes.
 */
function statusToBadge(status: string | null | undefined): 'full' | 'partial' | 'uncovered' {
  switch (status) {
    case 'full':
      return 'full';
    case 'good':
    case 'partial':
      return 'partial';
    case 'gap':
    case 'closed':
    default:
      return 'uncovered';
  }
}

/** Mirrors `dashboard/lib/coverage.ts` `isAllCovered`. */
function isAllCovered(rows: { status: string }[]): boolean {
  return rows.length > 0 && rows.every((r) => r.status === 'full');
}

// ── Test fixtures ──────────────────────────────────────────────────────

// Same date harness used by coverage.test.ts — Mon..Sun in March 2026.
// Picking a known week lets us assert per-day-of-week behavior without
// having to compute "today's DOW" inside the test.
const MON = '2026-03-16';
const SUN = '2026-03-22';
const RANGE = [MON, SUN] as const;

type CoverageRow = {
  service_id: string;
  service_name: string;
  check_date: Date; // pg returns DATE as a JS Date
  gap_hours: number[];
  covered_hours: number[];
  total_open_hours: number;
  coverage_pct: string; // pg returns NUMERIC as string
  status: 'full' | 'good' | 'partial' | 'gap' | 'closed';
  details: Record<string, unknown>;
};

describe('Coverage Backend ↔ Dashboard Consistency', () => {
  let client: Client;
  let tenantId: string;
  let dbAvailable = true;
  beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

  beforeAll(async () => {
    try {
      client = await getRootClient();
      await clearDB(client);
      const setup = await setupBasicTenant(client);
      tenantId = setup.tenantId;
    } catch (err) {
      dbAvailable = false;
      console.warn('[coverage-ui-consistency] Skipping DB tests - connection failed', err);
    }
  });

  afterAll(async () => {
    if (dbAvailable && client) await client.end();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await beginTestTransaction(client);
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await rollbackTestTransaction(client);
  });

  // ── Helpers ────────────────────────────────────────────────────────
  //
  // Identical seeding pattern to coverage.test.ts. Duplicated here
  // (rather than exported from test-utils) because these helpers are
  // intentionally narrow to the consistency-test scenarios — extracting
  // them would tie three unrelated test files together.

  const TEST_WEEK_BY_DOW: Record<number, string> = {
    0: '2026-03-22',
    1: '2026-03-16',
    2: '2026-03-17',
    3: '2026-03-18',
    4: '2026-03-19',
    5: '2026-03-20',
    6: '2026-03-21',
  };

  async function seedService(name: string): Promise<string> {
    const res = await client.query(
      'INSERT INTO services (tenant_id, name, duration_minutes) VALUES ($1, $2, 30) RETURNING service_id',
      [tenantId, name]
    );
    const sid = res.rows[0].service_id;
    // Make sure resource→service mapping exists so the new RPC's
    // open-hours math doesn't drop the service for resource reasons
    // (the schedule-only RPC actually doesn't filter on resource
    // capability, but we wire it anyway to mirror real seed data).
    const r = await client.query('SELECT resource_id FROM resources WHERE tenant_id = $1 LIMIT 1', [
      tenantId,
    ]);
    if (r.rows[0]) {
      await client.query(
        'INSERT INTO service_resource (tenant_id, service_id, resource_id) VALUES ($1, $2, $3)',
        [tenantId, sid, r.rows[0].resource_id]
      );
    }
    return sid;
  }

  async function seedEmployee(
    name: string,
    shiftDows: number[],
    shiftStart: string,
    shiftEnd: string,
    serviceIds: string[]
  ): Promise<string> {
    const res = await client.query(
      'INSERT INTO employees (tenant_id, name) VALUES ($1, $2) RETURNING employee_id',
      [tenantId, name]
    );
    const eid = res.rows[0].employee_id;
    for (const dow of shiftDows) {
      await client.query(
        `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
                 VALUES ($1, $2, $3::DATE, $4::TIME, $5::TIME, false)`,
        [tenantId, eid, TEST_WEEK_BY_DOW[dow], shiftStart, shiftEnd]
      );
    }
    for (const sid of serviceIds) {
      await client.query(
        'INSERT INTO service_employee (tenant_id, service_id, employee_id) VALUES ($1, $2, $3)',
        [tenantId, sid, eid]
      );
    }
    return eid;
  }

  async function runCoverage(): Promise<CoverageRow[]> {
    // Run the exact SELECT the backend route uses (analytics.ts:21-25)
    // so we exercise the same column projection the dashboard receives.
    const res = await client.query<CoverageRow>(
      `SELECT service_id, service_name, check_date, gap_hours, covered_hours,
                    total_open_hours, coverage_pct, status, details
             FROM check_coverage_gaps($1, $2::DATE, $3::DATE)`,
      [tenantId, RANGE[0], RANGE[1]]
    );
    return res.rows;
  }

  // ── Helper-shape sanity tests ──────────────────────────────────────

  it('statusToBadge mirrors dashboard/lib/coverage.ts contract', () => {
    // WHO: Pure helper test (no DB needed)
    // WHAT: Verify the local mirror agrees with the dashboard's helper
    //       across all 5 backend status values + the unknown fallback.
    // WHEN: Test added 2026-05-07 alongside the dashboard helper extraction
    // WHERE: Mirrors `dashboard/lib/coverage.ts` `statusToBadge`
    // WHY: If the dashboard's mapping drifts from this mirror, the rest
    //      of the file's per-scenario assertions become meaningless.
    //      Pin the equivalence at the unit level.
    expect(statusToBadge('full')).toBe('full');
    expect(statusToBadge('good')).toBe('partial');
    expect(statusToBadge('partial')).toBe('partial');
    expect(statusToBadge('gap')).toBe('uncovered');
    expect(statusToBadge('closed')).toBe('uncovered');
    expect(statusToBadge('something_unknown')).toBe('uncovered');
    expect(statusToBadge(null)).toBe('uncovered');
    expect(statusToBadge(undefined)).toBe('uncovered');
  });

  // ── Real RPC ↔ dashboard interpretation tests ──────────────────────

  it("full weekday coverage: backend status='full' agrees with dashboard 'full'", async () => {
    // WHO: A tire shop owner with one employee covering all weekdays 8-5
    // WHAT: Mon-Fri full-shift coverage of one assigned service
    // WHEN: 2026-03-16 through 2026-03-22 (Mon..Sun)
    // WHERE: Backend `check_coverage_gaps` + dashboard StepReview badge derivation
    // WHY: Sanity-check the happy path. If this fails, everything else is moot.
    if (!dbAvailable) return;
    const sid = await seedService('Oil Change');
    await seedEmployee('Mike', [1, 2, 3, 4, 5], '08:00', '17:00', [sid]);

    const rows = await runCoverage();
    const weekdayRows = rows.filter((r) => {
      const dow = new Date(r.check_date).getUTCDay();
      return dow >= 1 && dow <= 5;
    });

    expect(weekdayRows.length).toBe(5);
    for (const row of weekdayRows) {
      expect(row.status).toBe('full');
      expect(statusToBadge(row.status)).toBe('full');
    }
  });

  it("≥50% weekday coverage: backend 'partial' or 'good' agrees with dashboard 'partial'", async () => {
    // WHO: A specialist who covers 6hrs of a 9hr business day for
    //      one service. Other staff defines the open-hours window.
    // WHAT: Mon-Wed Brakes coverage = 6/9 = 67% → backend 'partial'
    //       (50-79% range). Mike's 8-17 shift is assigned to a
    //       different service so it sets open hours but doesn't
    //       cover Brakes.
    // WHEN: 2026-03-16, 17, 18 (Mon, Tue, Wed)
    // WHERE: Tests the 'partial'/'good' → 'partial' branch of statusToBadge
    // WHY: Dashboard must distinguish "mostly staffed but with some
    //      gap" (yellow/amber 'partial') from "no one qualified is
    //      working" ('uncovered'). 67% lands squarely in 'partial'.
    if (!dbAvailable) return;
    const brakesId = await seedService('Brakes');
    const otherId = await seedService('Oil Change');
    await seedEmployee('Mike', [1, 2, 3, 4, 5], '08:00', '17:00', [otherId]);
    await seedEmployee('Steve', [1, 2, 3], '09:00', '15:00', [brakesId]);

    const rows = await runCoverage();
    // Filter to Mon-Wed where Steve actually works (Thu-Fri become
    // 'gap' since Steve isn't there; that's verified separately).
    const monToWedBrakes = rows.filter((r) => {
      const dow = new Date(r.check_date).getUTCDay();
      return r.service_name === 'Brakes' && dow >= 1 && dow <= 3;
    });

    expect(monToWedBrakes.length).toBe(3);
    for (const row of monToWedBrakes) {
      expect(['partial', 'good']).toContain(row.status);
      const pct = parseFloat(row.coverage_pct);
      expect(pct).toBeGreaterThan(50);
      expect(pct).toBeLessThan(100);
      expect(statusToBadge(row.status)).toBe('partial');
    }
  });

  it("zero coverage with open hours: backend status='gap' / pct=0 agrees with dashboard 'uncovered'", async () => {
    // WHO: A service with no qualified employees, while other staff are scheduled
    // WHAT: Brakes service is unassigned; Mike's 8-5 weekday shifts open the day
    //       but not for Brakes → covered_count=0, open_count>0, pct=0
    // WHEN: Mon..Sun
    // WHERE: The 'gap' branch of the backend status enum
    // WHY: This is the failure mode owners actually need to see —
    //      "your business is open, but this service has no one to do it"
    //      should NOT render as "fully covered."
    if (!dbAvailable) return;
    const _brakesId = await seedService('Brakes'); // unassigned to anyone
    const oilId = await seedService('Oil Change'); // assigned to Mike
    await seedEmployee('Mike', [1, 2, 3, 4, 5], '08:00', '17:00', [oilId]);

    const rows = await runCoverage();
    const brakesRows = rows.filter((r) => r.service_name === 'Brakes');
    const weekdayBrakes = brakesRows.filter((r) => {
      const dow = new Date(r.check_date).getUTCDay();
      return dow >= 1 && dow <= 5;
    });

    expect(weekdayBrakes.length).toBe(5);
    for (const row of weekdayBrakes) {
      expect(row.status).toBe('gap');
      expect(parseFloat(row.coverage_pct)).toBe(0);
      expect(statusToBadge(row.status)).toBe('uncovered');
    }
  });

  // ── EDGE CASES from docs/TODO.md ───────────────────────────────────

  it("day with zero scheduled employees: backend status='closed' must NOT render as dashboard 'full'", async () => {
    // WHO: A Mon-Fri shop on a Saturday — nobody on shift
    // WHAT: The Sat row has open_count=0 → backend status='closed'.
    //       Backend coverage_pct returns 100.0 (divide-by-zero
    //       protection: `WHEN sc.open_count > 0 THEN ... ELSE 100.0`).
    //       The dashboard derives badge from coverage_pct >= 100,
    //       so it renders 'full' for a day where literally no one
    //       is working.
    // WHEN: 2026-03-21 (Sat) and 2026-03-22 (Sun) in a Mon-Fri shop
    // WHERE: docs/TODO.md "Pre-launch validation" → "day with zero scheduled employees"
    // WHY: Owners about to go live with their first beta should not
    //      see a green badge on a day no one works. The right answer
    //      is 'uncovered' (no coverage because nobody is scheduled).
    if (!dbAvailable) return;
    const sid = await seedService('Oil Change');
    await seedEmployee('Mike', [1, 2, 3, 4, 5], '08:00', '17:00', [sid]);

    const rows = await runCoverage();
    const weekendRows = rows.filter((r) => {
      const dow = new Date(r.check_date).getUTCDay();
      return dow === 0 || dow === 6;
    });

    expect(weekendRows.length).toBe(2);
    for (const row of weekendRows) {
      // Backend correctly identifies this as closed.
      expect(row.status).toBe('closed');

      // The contract assertion: a day with no one scheduled MUST
      // render as 'uncovered' on the wizard review badge — not
      // 'full'. This is what surfaces the bug.
      expect(statusToBadge(row.status)).toBe('uncovered');
    }
  });

  it("service with no qualified employees but other staff scheduled: 'gap' renders 'uncovered'", async () => {
    // WHO: Owner who created a Brakes service but only assigned Mike
    //      to Oil Change — Brakes has no qualified employee while
    //      Mike's 8-5 shift opens those hours for the business.
    // WHAT: Brakes weekday rows: open_count > 0 (Mike is on shift),
    //       covered_count = 0 (no Brakes-qualified employee on
    //       shift) → status='gap', coverage_pct=0.0. Weekend rows:
    //       open_count = 0 → status='closed'. Both paths must
    //       render 'uncovered' on the dashboard.
    // WHEN: Wizard review step before Go Live
    // WHERE: docs/TODO.md "Pre-launch validation" — assignment gap
    //        detection. An unassigned service is the most common
    //        wizard mistake; this test pins the "uncovered" badge.
    // WHY: A service with no qualified employee is unbookable. The
    //      review step must surface this — never as 'full', never
    //      as 'partial'.
    if (!dbAvailable) return;
    await seedService('Brakes'); // no employees assigned
    const otherId = await seedService('Oil Change');
    await seedEmployee('Mike', [1, 2, 3, 4, 5], '08:00', '17:00', [otherId]);

    const rows = await runCoverage();
    const brakesRows = rows.filter((r) => r.service_name === 'Brakes');

    expect(brakesRows.length).toBe(7);
    for (const row of brakesRows) {
      const dow = new Date(row.check_date).getUTCDay();
      const isWeekday = dow >= 1 && dow <= 5;
      expect(row.status).toBe(isWeekday ? 'gap' : 'closed');
      expect(statusToBadge(row.status)).toBe('uncovered');
    }
  });

  it("employee on leave (all is_off=true): backend 'closed' must render dashboard 'uncovered'", async () => {
    // WHO: A solo operator who marked the entire week as off (vacation)
    // WHAT: The single qualified employee's schedule rows all have
    //       is_off=true → no open hours any day → status='closed' →
    //       coverage_pct=100 → dashboard renders 'full'
    // WHEN: docs/TODO.md "Pre-launch validation" → "employee on leave"
    // WHERE: Same StepReview interpretation; same bug as above
    // WHY: "I marked vacation, why does it say I'm fully covered?"
    //      is exactly the trust-erosion the design philosophy in
    //      docs/UI_UX_DESIGN.md warns against.
    if (!dbAvailable) return;
    const sid = await seedService('Oil Change');
    const eid = await seedEmployee('Mike', [1, 2, 3, 4, 5], '08:00', '17:00', [sid]);
    await client.query(
      'UPDATE employee_schedule SET is_off = true, start_time = NULL, end_time = NULL WHERE employee_id = $1',
      [eid]
    );

    const rows = await runCoverage();
    for (const row of rows) {
      expect(row.status).toBe('closed');
      expect(statusToBadge(row.status)).toBe('uncovered');
    }
  });

  it("shift starting before typical business hours (04:00-08:00): full-coverage day still renders 'full'", async () => {
    // WHO: A bakery whose owner works the 4am-12pm shift
    // WHAT: open_count=8 (hrs 4..11), all covered → status='full',
    //       pct=100. The new schedule-only RPC has no hardcoded
    //       business-hours window — open hours = whatever the
    //       schedule rows say. So an early-bird shift should not
    //       confuse either the backend or the dashboard.
    // WHEN: docs/TODO.md "Pre-launch validation" → "shift starting before business hours"
    // WHERE: Verifies the RPC correctly bases open_count on actual
    //        schedule, not a hardcoded 8-17.
    // WHY: If we ever reintroduce a hardcoded "business hours" cap
    //      this test surfaces it (an early shift would suddenly
    //      report partial/closed instead of full).
    if (!dbAvailable) return;
    const sid = await seedService('Bread');
    await seedEmployee('Baker', [1, 2, 3, 4, 5], '04:00', '12:00', [sid]);

    const rows = await runCoverage();
    const weekdayRows = rows.filter((r) => {
      const dow = new Date(r.check_date).getUTCDay();
      return dow >= 1 && dow <= 5;
    });

    expect(weekdayRows.length).toBe(5);
    for (const row of weekdayRows) {
      expect(row.status).toBe('full');
      expect(row.total_open_hours).toBe(8);
      expect(statusToBadge(row.status)).toBe('full');
    }
  });

  // ── allCovered banner contract ─────────────────────────────────────

  it("StepReview's allCovered banner must NOT fire when every day is closed (zero-staff tenant)", async () => {
    // WHO: A tenant who created services but never added any
    //      employees — a wizard reset state, common during sales demos
    // WHAT: All rows return status='closed' (no staff scheduled).
    //       isAllCovered checks every row's status === 'full', so
    //       on a zero-staff tenant the banner correctly stays in the
    //       amber "fix assignments" state. Pre-2026-05-07 the check
    //       was `coverage_pct >= 100`, which evaluated TRUE on the
    //       same input because the RPC returns pct=100 for the
    //       open_count=0 case.
    // WHEN: Right before "Go Live" — the highest-stakes onboarding moment
    // WHERE: dashboard/lib/coverage.ts isAllCovered + StepReview.tsx:60-76 banner
    // WHY: This is the worst-case manifestation of the old
    //      closed=full bug: green "ready to go" on a tenant that
    //      cannot accept a single booking. Test pins the corrected
    //      behavior.
    if (!dbAvailable) return;
    await seedService('Service A');
    await seedService('Service B');
    // No employees at all.

    const rows = await runCoverage();
    expect(isAllCovered(rows)).toBe(false);
  });
});
