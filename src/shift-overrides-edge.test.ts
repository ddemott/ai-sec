/**
 * Tests for Fix #16 + #17: Edge function employee_schedule support
 * Verifies get_effective_shifts RPC returns correct data for date-specific queries
 * (simulating what the edge function repository does).
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from 'pg';
import { getRootClient, clearDB, createTenant, createEmployee, createResource, beginTestTransaction, rollbackTestTransaction, skipIfDbDown } from './test-utils';

describe('Fix #16 + #17: Edge function employee_schedule support', () => {
  let client: Client;
  let tenantId: string;
  let employeeId: string;
  let dbAvailable = false;
  beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

  beforeAll(async () => {
    try {
      client = await getRootClient();
      const res = await client.query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_schedule')");
      if (!res.rows[0].exists) {
        console.warn('[shift-overrides-edge] employee_schedule table missing, skipping DB tests');
        return;
      }
      await clearDB(client);
      tenantId = await createTenant(client, 'Override Test Co', 'auto-repair', 'America/Chicago');
      employeeId = await createEmployee(client, tenantId, 'Mike Mechanic', ['oil-change']);
      // No global setup needed — tests that need a schedule entry seed
      // it themselves inside their savepoint. The two tests that
      // expected a Mon-Fri pattern fallback are .skip'd (the
      // get_effective_shifts function no longer falls back).
      dbAvailable = true;
    } catch (err) {
      console.warn('[shift-overrides-edge] DB not available:', err);
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    if (dbAvailable && client) await client.end();
  });

  beforeEach(async () => {
    if (dbAvailable) await beginTestTransaction(client);
  });

  afterEach(async () => {
    if (dbAvailable) await rollbackTestTransaction(client);
  });

  describe('get_effective_shifts RPC (used by edge function)', () => {
    it('HAPPY: multi-day range returns every employee_schedule row in date order', async () => {
      // WHO: scheduler view loading a week of an employee's shifts; voice AI
      //      reasoning over availability across multiple days at once
      // WHAT: get_effective_shifts called with a 5-day window returns one row
      //       per seeded employee_schedule entry, in ascending shift_date order
      // WHEN: business has owner-defined shifts for Mon–Fri (different hours
      //       per day) and the caller queries Mon..Fri
      // WHERE: get_effective_shifts RPC, range branch (start_date..end_date)
      // WHY: this is the load-bearing case for the redesigned RPC after
      //      migration 20260420000000 dropped the pattern-fallback branch.
      //      Single-day queries (lines 89-180) cover the per-day shape;
      //      this pins the date-range filter and ordering contract that the
      //      scheduler view depends on.
      // ORIGIN: replaces the skipped 2026-04-30 "returns pattern shifts" test
      //         whose pattern-fallback premise was retired by the migration.
      if (!dbAvailable) return;

      const monday = getNextDayOfWeek(1);
      const friday = new Date(monday);
      friday.setDate(friday.getDate() + 4);
      // Seed five weekday rows with distinct hours so order assertions are
      // unambiguous. Hours intentionally differ per day; `DISTINCT` shapes
      // would otherwise hide a row swap.
      const hours = [
        { start: '08:00', end: '12:00' }, // Mon
        { start: '09:00', end: '17:00' }, // Tue
        { start: '07:00', end: '15:00' }, // Wed
        { start: '10:00', end: '14:00' }, // Thu
        { start: '08:00', end: '16:00' }, // Fri
      ];
      for (let i = 0; i < 5; i++) {
        const day = new Date(monday);
        day.setDate(day.getDate() + i);
        await client.query(
          "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time) VALUES ($1, $2, $3, $4, $5)",
          [tenantId, employeeId, toDateStr(day), hours[i].start, hours[i].end]
        );
      }

      const res = await client.query(
        "SELECT shift_date, start_time::text AS start_time, end_time::text AS end_time, is_off FROM get_effective_shifts($1, $2::UUID, $3::DATE, $4::DATE) ORDER BY shift_date",
        [tenantId, employeeId, toDateStr(monday), toDateStr(friday)]
      );

      expect(res.rows.length).toBe(5);
      // Assert shape per row — start_time + end_time match what we seeded,
      // nothing is_off, dates are strictly increasing across the result.
      for (let i = 0; i < 5; i++) {
        expect(res.rows[i].is_off).toBe(false);
        expect(res.rows[i].start_time).toContain(hours[i].start);
        expect(res.rows[i].end_time).toContain(hours[i].end);
      }
      const shiftDates = res.rows.map((r: { shift_date: Date }) => toDateStr(new Date(r.shift_date)));
      const expectedDates = hours.map((_, i) => {
        const d = new Date(monday);
        d.setDate(d.getDate() + i);
        return toDateStr(d);
      });
      expect(shiftDates).toEqual(expectedDates);
    });

    it('HAPPY: returns nothing for a weekend with no override (no pattern)', async () => {
      // WHO: Employee with Mon-Fri pattern only
      // WHAT: Saturday should return no rows (no pattern, no override)
      // WHY: Employee doesn't work weekends by default
      if (!dbAvailable) return;

      const saturday = getNextDayOfWeek(6);
      const dateStr = toDateStr(saturday);

      const res = await client.query(
        "SELECT * FROM get_effective_shifts($1, $2::UUID, $3::DATE, $3::DATE)",
        [tenantId, employeeId, dateStr]
      );

      expect(res.rows.length).toBe(0);
    });

    it('HAPPY: override takes precedence over pattern', async () => {
      // WHO: Employee with pattern + date-specific override
      // WHAT: Override hours should be returned instead of pattern
      // WHY: Business needs to change an employee's hours for one day
      if (!dbAvailable) return;

      const monday = getNextDayOfWeek(1);
      const dateStr = toDateStr(monday);

      // Create override: work 10am-2pm instead of 8am-5pm
      await client.query(
        "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time) VALUES ($1, $2, $3, '10:00', '14:00')",
        [tenantId, employeeId, dateStr]
      );

      const res = await client.query(
        "SELECT * FROM get_effective_shifts($1, $2::UUID, $3::DATE, $3::DATE)",
        [tenantId, employeeId, dateStr]
      );

      expect(res.rows.length).toBe(1);
      expect(res.rows[0].is_override).toBe(true);
      expect(res.rows[0].is_off).toBe(false);
      expect(res.rows[0].start_time).toContain('10:00');
      expect(res.rows[0].end_time).toContain('14:00');
    });

    it('HAPPY: is_off override shows employee as off (not pattern hours)', async () => {
      // WHO: Employee with is_off override on a normally working day
      // WHAT: Should return the override with is_off=true
      // WHY: Employee took a day off — voice AI must not book them
      if (!dbAvailable) return;

      const tuesday = getNextDayOfWeek(2);
      const dateStr = toDateStr(tuesday);

      await client.query(
        "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, is_off) VALUES ($1, $2, $3, true)",
        [tenantId, employeeId, dateStr]
      );

      const res = await client.query(
        "SELECT * FROM get_effective_shifts($1, $2::UUID, $3::DATE, $3::DATE)",
        [tenantId, employeeId, dateStr]
      );

      expect(res.rows.length).toBe(1);
      expect(res.rows[0].is_override).toBe(true);
      expect(res.rows[0].is_off).toBe(true);
    });

    it('HAPPY: override can add work to a normally-off day', async () => {
      // WHO: Employee normally off on Saturday
      // WHAT: Override can schedule them to work Saturday
      // WHY: Business needs extra coverage on a specific Saturday
      if (!dbAvailable) return;

      const saturday = getNextDayOfWeek(6);
      const dateStr = toDateStr(saturday);

      await client.query(
        "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time) VALUES ($1, $2, $3, '09:00', '13:00')",
        [tenantId, employeeId, dateStr]
      );

      const res = await client.query(
        "SELECT * FROM get_effective_shifts($1, $2::UUID, $3::DATE, $3::DATE)",
        [tenantId, employeeId, dateStr]
      );

      expect(res.rows.length).toBe(1);
      expect(res.rows[0].is_override).toBe(true);
      expect(res.rows[0].start_time).toContain('09:00');
      expect(res.rows[0].end_time).toContain('13:00');
    });

    it('SAD: rows outside the queried date range are filtered out', async () => {
      // WHO: caller asking for shifts inside a narrow window when the
      //      employee has rows seeded both inside and outside it
      // WHAT: get_effective_shifts returns ONLY the rows whose shift_date
      //       falls within [start_date, end_date] inclusive — neighbors are
      //       not included as adjacent context
      // WHEN: scheduler views always pass an explicit window; voice AI passes
      //       a single-day window. Both depend on tight filtering — bleed
      //       would surface stale or future shifts to the caller
      // WHERE: get_effective_shifts RPC, WHERE shift_date BETWEEN clause
      // WHY: a date-filter regression would silently break availability
      //      checks (the AI agent could believe an employee is working a day
      //      they aren't); a unit-level pin makes the contract explicit
      // ORIGIN: replaces the skipped 2026-04-30 "week range mixed pattern +
      //         overrides" test whose pattern/override-merge premise was
      //         retired by the migration to employee_schedule-only.
      if (!dbAvailable) return;

      const monday = getNextDayOfWeek(1);
      const wednesday = new Date(monday);
      wednesday.setDate(wednesday.getDate() + 2);
      const friday = new Date(monday);
      friday.setDate(friday.getDate() + 4);

      // Seed three rows: Mon (before window), Wed (inside), Fri (after window).
      // Query window will be Wed..Wed only — Mon and Fri must be filtered out.
      await client.query(
        "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time) VALUES ($1, $2, $3, '08:00', '12:00')",
        [tenantId, employeeId, toDateStr(monday)]
      );
      await client.query(
        "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time) VALUES ($1, $2, $3, '09:00', '17:00')",
        [tenantId, employeeId, toDateStr(wednesday)]
      );
      await client.query(
        "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time) VALUES ($1, $2, $3, '07:00', '15:00')",
        [tenantId, employeeId, toDateStr(friday)]
      );

      const res = await client.query(
        "SELECT shift_date, start_time::text AS start_time, end_time::text AS end_time FROM get_effective_shifts($1, $2::UUID, $3::DATE, $3::DATE)",
        [tenantId, employeeId, toDateStr(wednesday)]
      );

      expect(res.rows.length).toBe(1);
      expect(toDateStr(new Date(res.rows[0].shift_date))).toBe(toDateStr(wednesday));
      expect(res.rows[0].start_time).toContain('09:00');
      expect(res.rows[0].end_time).toContain('17:00');
    });
  });

  describe('Available slots with overrides (simulated edge function query)', () => {
    it('HAPPY: available slots uses override hours, not pattern', async () => {
      // WHO: Voice AI checking available slots
      // WHAT: Should use override hours when present
      // WHERE: Simulates repository.getAvailableSlots logic
      // WHY: Customers should only see actually available times
      if (!dbAvailable) return;

      const resourceId = await createResource(client, tenantId, 'Bay 1');
      const monday = getNextDayOfWeek(1);
      const dateStr = toDateStr(monday);

      // Override: only 10am-2pm
      await client.query(
        "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time) VALUES ($1, $2, $3, '10:00', '14:00')",
        [tenantId, employeeId, dateStr]
      );

      // Query effective shifts (what the edge function does)
      const res = await client.query(
        "SELECT start_time::text, end_time::text, is_off FROM get_effective_shifts($1, $2::UUID, $3::DATE, $3::DATE)",
        [tenantId, employeeId, dateStr]
      );

      // Should show 10-2, not 8-5
      const working = res.rows.filter((r: { is_off: boolean }) => !r.is_off);
      expect(working.length).toBe(1);
      expect(working[0].start_time).toContain('10:00');
      expect(working[0].end_time).toContain('14:00');
    });

    it('SAD: is_off override means no available slots for that employee', async () => {
      // WHO: Voice AI checking slots on employee's day off
      // WHAT: No shifts should be returned
      // WHY: Can't book someone who's not working
      if (!dbAvailable) return;

      const monday = getNextDayOfWeek(1);
      const dateStr = toDateStr(monday);

      await client.query(
        "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, is_off) VALUES ($1, $2, $3, true)",
        [tenantId, employeeId, dateStr]
      );

      const res = await client.query(
        "SELECT start_time::text, end_time::text, is_off FROM get_effective_shifts($1, $2::UUID, $3::DATE, $3::DATE)",
        [tenantId, employeeId, dateStr]
      );

      const working = res.rows.filter((r: { is_off: boolean }) => !r.is_off);
      expect(working.length).toBe(0);
    });

    it('SAD: no employee, no shifts returns empty', async () => {
      // WHO: Nonexistent employee
      // WHAT: Should return empty result, not error
      // WHY: Edge function must handle gracefully
      if (!dbAvailable) return;

      const fakeId = '00000000-0000-0000-0000-000000000099';
      const res = await client.query(
        "SELECT * FROM get_effective_shifts($1, $2::UUID, CURRENT_DATE, CURRENT_DATE)",
        [tenantId, fakeId]
      );

      expect(res.rows.length).toBe(0);
    });
  });
});

// Helpers
function getNextDayOfWeek(dow: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7 || 7) + 7); // next week to avoid edge cases
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
