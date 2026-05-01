/**
 * Tests for Fix #16 + #17: Edge function employee_schedule support
 * Verifies get_effective_shifts RPC returns correct data for date-specific queries
 * (simulating what the edge function repository does).
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from 'pg';
import {
  getRootClient, clearDB, createTenant, createEmployee, createResource,
  beginTestTransaction, rollbackTestTransaction,
} from './test-utils';

describe('Fix #16 + #17: Edge function employee_schedule support', () => {
  let client: Client;
  let tenantId: string;
  let employeeId: string;
  let dbAvailable = false;

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
    it.skip('HAPPY: returns pattern shifts for a weekday with no override', async () => {
      // SKIPPED 2026-04-30: this test pins behavior that no longer
      // exists. Migration 20260420000000 removed the
      // employee_shifts fallback from get_effective_shifts — the
      // function now reads employee_schedule exclusively. There is no
      // "weekly pattern with no override" path for it to return.
      // Owners populate employee_schedule via the wizard's expand-weekly
      // fan-out (see src/services/expandWeeklyToSchedule.ts) or the
      // copy-week button. A redesigned version of this test should
      // seed employee_schedule directly and assert get_effective_shifts
      // returns those rows.
      // WHO: Employee with Mon-Fri 8-5 pattern
      // WHAT: get_effective_shifts should return the pattern shift for Monday
      // WHEN: No override exists for that date
      // WHERE: get_effective_shifts RPC
      // WHY: Edge function needs correct shifts for availability checking
      if (!dbAvailable) return;

      // Find next Monday
      const monday = getNextDayOfWeek(1);
      const dateStr = toDateStr(monday);

      const res = await client.query(
        "SELECT * FROM get_effective_shifts($1, $2::UUID, $3::DATE, $3::DATE)",
        [tenantId, employeeId, dateStr]
      );

      expect(res.rows.length).toBe(1);
      expect(res.rows[0].is_override).toBe(false);
      expect(res.rows[0].is_off).toBe(false);
      expect(res.rows[0].start_time).toContain('08:00');
      expect(res.rows[0].end_time).toContain('17:00');
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

    it.skip('HAPPY: week range returns mixed pattern + overrides', async () => {
      // SKIPPED 2026-04-30: same reason as the test above —
      // get_effective_shifts no longer mixes pattern + override
      // sources. It reads employee_schedule only. A redesigned version
      // should seed employee_schedule rows for the days under test
      // and assert the function returns them.
      // WHO: Employee with pattern Mon-Fri + overrides on Wed and Sat
      // WHAT: Week query returns correct mix of sources
      // WHY: Edge function needs full week view for scheduling
      if (!dbAvailable) return;

      const monday = getNextDayOfWeek(1);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);

      const wednesday = new Date(monday);
      wednesday.setDate(wednesday.getDate() + 2);

      // Override Wednesday to half day
      await client.query(
        "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time) VALUES ($1, $2, $3, '08:00', '12:00')",
        [tenantId, employeeId, toDateStr(wednesday)]
      );

      const res = await client.query(
        "SELECT * FROM get_effective_shifts($1, $2::UUID, $3::DATE, $4::DATE)",
        [tenantId, employeeId, toDateStr(monday), toDateStr(sunday)]
      );

      // Should have 5 rows: Mon(pat), Tue(pat), Wed(ovr), Thu(pat), Fri(pat)
      expect(res.rows.length).toBe(5);

      const wedRow = res.rows.find((r: any) => toDateStr(new Date(r.shift_date)) === toDateStr(wednesday));
      expect(wedRow).toBeDefined();
      expect(wedRow.is_override).toBe(true);
      expect(wedRow.end_time).toContain('12:00');

      const patternRows = res.rows.filter((r: any) => !r.is_override);
      expect(patternRows.length).toBe(4);
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
      const working = res.rows.filter((r: any) => !r.is_off);
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

      const working = res.rows.filter((r: any) => !r.is_off);
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
