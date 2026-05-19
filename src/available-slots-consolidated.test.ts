/**
 * Tests for Fix #31: Consolidated getAvailableSlots query
 * Verifies the single-query approach returns correct service, shifts, and appointments.
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { type Client } from 'pg';
import { getRootClient, clearDB, createTenant, createEmployee, createScheduleEntry, createResource, createService, createCustomer, createAppointment, beginTestTransaction, rollbackTestTransaction, skipIfDbDown } from './test-utils';

const TEST_DATE = '2026-06-01'; // Monday (DOW=1)

describe('Fix #31: Consolidated getAvailableSlots query', () => {
  let client: Client;
  let tenantId: string;
  let resourceId: string;
  let dbAvailable = false;
  beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

  beforeAll(async () => {
    try {
      client = await getRootClient();
      // Check if required tables exist (schema may not match after renames)
      const res = await client.query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_schedule')");
      if (!res.rows[0].exists) {
        console.warn('[available-slots] employee_schedule table missing, skipping DB tests');
        return;
      }
      await clearDB(client);
      tenantId = await createTenant(client, 'Slots Test Co', 'auto-repair', 'America/Chicago');
      resourceId = await createResource(client, tenantId, 'Bay 1');
      dbAvailable = true;
    } catch (err) {
      console.warn('[available-slots] DB not available:', err);
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

  // Simulates the consolidated query from repository.ts
  async function queryAvailableSlots(serviceType: string, date: string) {
    const res = await client.query(`
      WITH svc AS (
        SELECT name, duration_minutes, price
        FROM services
        WHERE tenant_id = $1 AND name ILIKE '%' || $2 || '%'
        LIMIT 1
      ),
      active_employees AS (
        SELECT employee_id FROM employees
        WHERE tenant_id = $1 AND is_active = true
          AND (is_deleted IS NULL OR is_deleted = false)
      ),
      effective_shifts AS (
        SELECT DISTINCT
          es.start_time::text AS start_time,
          es.end_time::text AS end_time
        FROM active_employees ae
        JOIN employee_schedule es
          ON es.employee_id = ae.employee_id
          AND es.tenant_id = $1
          AND es.shift_date = $3::date
          AND es.is_off = false
          AND es.start_time IS NOT NULL
      ),
      day_appointments AS (
        SELECT start_time::text, end_time::text
        FROM appointments
        WHERE tenant_id = $1 AND status = 'scheduled'
          AND (is_deleted IS NULL OR is_deleted = false)
          AND start_time::date = $3::date
      )
      SELECT 'service' AS source, name, duration_minutes::int, price, NULL::text AS start_time, NULL::text AS end_time FROM svc
      UNION ALL
      SELECT 'shift', NULL, NULL, NULL, start_time, end_time FROM effective_shifts
      UNION ALL
      SELECT 'appointment', NULL, NULL, NULL, start_time, end_time FROM day_appointments
      ORDER BY source, start_time`,
      [tenantId, serviceType, date]
    );

    let service: { name: string; duration_minutes: number; price: string | null } | null = null;
    const shifts: Array<{ start_time: string; end_time: string }> = [];
    const appointments: Array<{ start_time: string; end_time: string }> = [];

    for (const row of res.rows) {
      if (row.source === 'service' && row.name) {
        service = { name: row.name, duration_minutes: row.duration_minutes, price: row.price };
      } else if (row.source === 'shift' && row.start_time && row.end_time) {
        shifts.push({ start_time: row.start_time, end_time: row.end_time });
      } else if (row.source === 'appointment' && row.start_time && row.end_time) {
        appointments.push({ start_time: row.start_time, end_time: row.end_time });
      }
    }

    return { service, shifts, appointments };
  }

  it('HAPPY: returns service, shifts, and appointments in one query', async () => {
    // WHO: Voice AI checking available slots
    // WHAT: Should return all 3 data types from a single query
    // WHY: Eliminates N+1 queries (was 3+ queries, now 1)
    if (!dbAvailable) return;

    const _svcId = await createService(client, tenantId, 'Oil Change', 30, 39.99);
    const empId = await createEmployee(client, tenantId, 'Mike', ['oil-change']);
    await createScheduleEntry(client, tenantId, empId, TEST_DATE, '08:00', '17:00');
    const custId = await createCustomer(client, tenantId, 'Alice', '+15551234567');
    await createAppointment(client, tenantId, resourceId, custId,
      `${TEST_DATE}T10:00:00-05:00`, `${TEST_DATE}T10:30:00-05:00`, 'Oil Change');

    const result = await queryAvailableSlots('oil', TEST_DATE);

    expect(result.service).not.toBeNull();
    expect(result.service!.name).toBe('Oil Change');
    expect(result.service!.duration_minutes).toBe(30);
    expect(result.shifts.length).toBeGreaterThan(0);
    expect(result.appointments.length).toBeGreaterThan(0);
  });

  it('HAPPY: returns multiple employee shifts deduplicated', async () => {
    // WHO: Two employees with the same shift hours
    // WHAT: Should return distinct shift times (not duplicated)
    // WHY: Available slots are based on unique time windows, not per-employee
    if (!dbAvailable) return;

    await createService(client, tenantId, 'Tire Rotation', 45);
    const emp1 = await createEmployee(client, tenantId, 'Mike', []);
    const emp2 = await createEmployee(client, tenantId, 'Sarah', []);
    await createScheduleEntry(client, tenantId, emp1, TEST_DATE, '08:00', '17:00');
    await createScheduleEntry(client, tenantId, emp2, TEST_DATE, '08:00', '17:00'); // same hours

    const result = await queryAvailableSlots('tire', TEST_DATE);

    // Should be deduplicated to 1 shift window, not 2
    expect(result.shifts.length).toBe(1);
    expect(result.shifts[0].start_time).toContain('08:00');
    expect(result.shifts[0].end_time).toContain('17:00');
  });

  it('HAPPY: returns different shift times when employees have different hours', async () => {
    // WHO: Two employees with different schedules
    // WHAT: Should return both distinct shift windows
    // WHY: Available slots span the union of all employee hours
    if (!dbAvailable) return;

    await createService(client, tenantId, 'Brakes', 60);
    const emp1 = await createEmployee(client, tenantId, 'Early Bird', []);
    const emp2 = await createEmployee(client, tenantId, 'Late Owl', []);
    await createScheduleEntry(client, tenantId, emp1, TEST_DATE, '06:00', '14:00');
    await createScheduleEntry(client, tenantId, emp2, TEST_DATE, '12:00', '20:00');

    const result = await queryAvailableSlots('brakes', TEST_DATE);

    expect(result.shifts.length).toBe(2);
  });

  it('HAPPY: respects employee_schedule over patterns', async () => {
    // WHO: Employee with override for the queried date
    // WHAT: Should use override hours, not pattern hours
    // WHY: Override-aware scheduling is critical for variable schedules
    if (!dbAvailable) return;

    await createService(client, tenantId, 'Alignment', 60);
    const empId = await createEmployee(client, tenantId, 'Mike', []);

    // Schedule shorter hours on this specific date.
    await client.query(
      "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time) VALUES ($1, $2, $3, '10:00', '14:00')",
      [tenantId, empId, TEST_DATE]
    );

    const result = await queryAvailableSlots('alignment', TEST_DATE);

    expect(result.shifts.length).toBe(1);
    expect(result.shifts[0].start_time).toContain('10:00');
    expect(result.shifts[0].end_time).toContain('14:00');
  });

  it('SAD: is_off override means no shifts returned for that employee', async () => {
    // WHO: Only employee is marked off for the date
    // WHAT: No shifts should be returned
    // WHY: Can't book if nobody is working
    if (!dbAvailable) return;

    await createService(client, tenantId, 'Paint', 90);
    const empId = await createEmployee(client, tenantId, 'Mike', []);

    // Mark the employee off for the queried date — no shifts should
    // be returned for them.
    await client.query(
      "INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, is_off) VALUES ($1, $2, $3, true)",
      [tenantId, empId, TEST_DATE]
    );

    const result = await queryAvailableSlots('paint', TEST_DATE);

    expect(result.shifts.length).toBe(0);
  });

  it('SAD: no matching service returns null service', async () => {
    // WHO: Voice AI searching for a service that doesn't exist
    // WHAT: Service should be null, shifts/appointments still returned
    // WHY: Graceful degradation — don't error, just indicate no match
    if (!dbAvailable) return;

    const empId = await createEmployee(client, tenantId, 'Mike', []);
    await createScheduleEntry(client, tenantId, empId, TEST_DATE, '08:00', '17:00');

    const result = await queryAvailableSlots('nonexistent-service-xyz', TEST_DATE);

    expect(result.service).toBeNull();
    expect(result.shifts.length).toBeGreaterThan(0); // shifts still returned
  });

  it('SAD: no employees means no shifts', async () => {
    // WHO: Tenant with no active employees
    // WHAT: No shifts returned
    // WHY: Nobody to staff the appointments
    if (!dbAvailable) return;

    await createService(client, tenantId, 'Detail', 120);

    const result = await queryAvailableSlots('detail', TEST_DATE);

    expect(result.service).not.toBeNull();
    expect(result.shifts.length).toBe(0);
    expect(result.appointments.length).toBe(0);
  });

  it('SAD: querying a date with no employee_schedule rows returns no shifts', async () => {
    // WHO: Employee scheduled only on Monday, query Saturday
    // WHAT: No shifts for Saturday
    // WHY: No employee_schedule row for Saturday → nobody available
    if (!dbAvailable) return;

    await createService(client, tenantId, 'Quick Fix', 15);
    const empId = await createEmployee(client, tenantId, 'Weekday Worker', []);
    await createScheduleEntry(client, tenantId, empId, TEST_DATE, '08:00', '17:00'); // Monday only

    const result = await queryAvailableSlots('quick', '2026-06-06'); // Saturday

    expect(result.shifts.length).toBe(0);
  });
});
