import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  getRootClient,
  clearDB,
  setupBasicTenant,
  createEmployee,
  createResource,
  beginTestTransaction,
  rollbackTestTransaction,
  skipIfDbDown,
} from '../utils';
import { type Client } from 'pg';

describe('Coverage Gaps', () => {
  let client: Client;
  let tenantId: string;
  let resourceId: string;
  let customerId: string;
  let dbAvailable = true;
  beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

  beforeAll(async () => {
    try {
      client = await getRootClient();
      await clearDB(client);
      const setup = await setupBasicTenant(client);
      tenantId = setup.tenantId;
      resourceId = setup.resourceId;
      customerId = setup.customerId;
    } catch (err) {
      dbAvailable = false;
      console.warn('[coverage-gaps.test] Skipping DB tests - connection failed', err);
    }
  });

  afterAll(async () => {
    if (dbAvailable && client) {
      await client.end();
    }
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await beginTestTransaction(client);
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await rollbackTestTransaction(client);
  });

  // ---------------------------------------------------------------
  // 1. Appointment Update (direct UPDATE path)
  // ---------------------------------------------------------------
  describe('Appointment Update', () => {
    let appointmentId: string;

    beforeEach(async () => {
      if (!dbAvailable) return;
      const res = await client.query(
        `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description)
                 VALUES ($1, $2, $3, '2026-04-01 09:00:00+00', '2026-04-01 10:00:00+00', 'Oil change')
                 RETURNING appointment_id`,
        [tenantId, resourceId, customerId]
      );
      appointmentId = res.rows[0].appointment_id;
    });

    it('should update start_time and end_time', async () => {
      if (!dbAvailable) return;
      await client.query(
        `UPDATE appointments SET start_time = '2026-04-01 11:00:00+00', end_time = '2026-04-01 12:00:00+00' WHERE appointment_id = $1`,
        [appointmentId]
      );
      const res = await client.query(
        'SELECT start_time, end_time FROM appointments WHERE appointment_id = $1',
        [appointmentId]
      );
      expect(new Date(res.rows[0].start_time).toISOString()).toBe('2026-04-01T11:00:00.000Z');
      expect(new Date(res.rows[0].end_time).toISOString()).toBe('2026-04-01T12:00:00.000Z');
    });

    it('should update description', async () => {
      if (!dbAvailable) return;
      await client.query(
        "UPDATE appointments SET description = 'Tire rotation' WHERE appointment_id = $1",
        [appointmentId]
      );
      const res = await client.query(
        'SELECT description FROM appointments WHERE appointment_id = $1',
        [appointmentId]
      );
      expect(res.rows[0].description).toBe('Tire rotation');
    });

    it('should update resource_id', async () => {
      if (!dbAvailable) return;
      const newResourceId = await createResource(client, tenantId, 'Truck 2');
      await client.query('UPDATE appointments SET resource_id = $1 WHERE appointment_id = $2', [
        newResourceId,
        appointmentId,
      ]);
      const res = await client.query(
        'SELECT resource_id FROM appointments WHERE appointment_id = $1',
        [appointmentId]
      );
      expect(res.rows[0].resource_id).toBe(newResourceId);
    });

    it('should update employee_id as UUID', async () => {
      if (!dbAvailable) return;
      const employeeId = await createEmployee(client, tenantId, 'John');
      await client.query('UPDATE appointments SET employee_id = $1 WHERE appointment_id = $2', [
        employeeId,
        appointmentId,
      ]);
      const res = await client.query(
        'SELECT employee_id FROM appointments WHERE appointment_id = $1',
        [appointmentId]
      );
      expect(res.rows[0].employee_id).toBe(employeeId);
      // Verify UUID format
      expect(employeeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should persist all updated values together', async () => {
      if (!dbAvailable) return;
      const employeeId = await createEmployee(client, tenantId, 'Jane');
      const newResourceId = await createResource(client, tenantId, 'Truck 3');

      await client.query(
        `UPDATE appointments
                 SET start_time = '2026-04-02 14:00:00+00',
                     end_time = '2026-04-02 15:00:00+00',
                     description = 'Full service',
                     resource_id = $1,
                     employee_id = $2
                 WHERE appointment_id = $3`,
        [newResourceId, employeeId, appointmentId]
      );

      const res = await client.query(
        'SELECT start_time, end_time, description, resource_id, employee_id FROM appointments WHERE appointment_id = $1',
        [appointmentId]
      );
      const row = res.rows[0];
      expect(new Date(row.start_time).toISOString()).toBe('2026-04-02T14:00:00.000Z');
      expect(new Date(row.end_time).toISOString()).toBe('2026-04-02T15:00:00.000Z');
      expect(row.description).toBe('Full service');
      expect(row.resource_id).toBe(newResourceId);
      expect(row.employee_id).toBe(employeeId);
    });
  });

  // ---------------------------------------------------------------
  // 2. Tenant Not Found handling
  // ---------------------------------------------------------------
  describe('Tenant Not Found', () => {
    it('should return 0 rows for non-existent tenant UUID', async () => {
      if (!dbAvailable) return;
      const fakeId = '00000000-aaaa-bbbb-cccc-000000000099';
      const res = await client.query('SELECT * FROM tenants WHERE tenant_id = $1', [fakeId]);
      expect(res.rows.length).toBe(0);
    });

    it('should fail RLS-scoped query when tenant context is set to non-existent UUID', async () => {
      if (!dbAvailable) return;
      const fakeId = '00000000-aaaa-bbbb-cccc-000000000099';
      await client.query("SET LOCAL app.current_tenant_id = '" + fakeId + "'");
      const res = await client.query('SELECT * FROM resources WHERE tenant_id = $1', [fakeId]);
      expect(res.rows.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // 3. Shift Split — REMOVED 2026-04-30
  // The two tests previously here exercised the old employee_shifts
  // weekly-CRUD frontend pattern (split a day into two ranges,
  // delete-and-recreate to replace an overlap). Both the table and
  // the routes are gone (historical major refactor; see RESOLVED.md, originally tracked as NEEDS-REFACTORING #4 Phase 2). Date-specific
  // schedule overlap is enforced at the employee_schedule UNIQUE
  // (tenant, employee, shift_date) constraint and tested via the
  // /shifts/overrides endpoints.

  // ---------------------------------------------------------------
  // 4. Appointment Cancel
  // ---------------------------------------------------------------
  describe('Appointment Cancel', () => {
    let appointmentId: string;

    beforeEach(async () => {
      if (!dbAvailable) return;
      const res = await client.query(
        `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, status)
                 VALUES ($1, $2, $3, '2026-04-05 10:00:00+00', '2026-04-05 11:00:00+00', 'scheduled')
                 RETURNING appointment_id`,
        [tenantId, resourceId, customerId]
      );
      appointmentId = res.rows[0].appointment_id;
    });

    it('should update status to canceled', async () => {
      if (!dbAvailable) return;
      await client.query("UPDATE appointments SET status = 'canceled' WHERE appointment_id = $1", [
        appointmentId,
      ]);
      const res = await client.query('SELECT status FROM appointments WHERE appointment_id = $1', [
        appointmentId,
      ]);
      expect(res.rows[0].status).toBe('canceled');
    });

    it('should still exist after cancellation', async () => {
      if (!dbAvailable) return;
      await client.query("UPDATE appointments SET status = 'canceled' WHERE appointment_id = $1", [
        appointmentId,
      ]);
      const res = await client.query(
        'SELECT appointment_id, status FROM appointments WHERE appointment_id = $1',
        [appointmentId]
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].status).toBe('canceled');
    });

    it('should be excluded by a status != canceled filter (calendar view pattern)', async () => {
      if (!dbAvailable) return;
      // Create a second appointment that stays scheduled
      await client.query(
        `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, status)
                 VALUES ($1, $2, $3, '2026-04-05 14:00:00+00', '2026-04-05 15:00:00+00', 'scheduled')`,
        [tenantId, resourceId, customerId]
      );

      // Cancel the first one
      await client.query("UPDATE appointments SET status = 'canceled' WHERE appointment_id = $1", [
        appointmentId,
      ]);

      // Calendar filter: exclude canceled
      const res = await client.query(
        "SELECT appointment_id FROM appointments WHERE tenant_id = $1 AND status != 'canceled' AND is_deleted = false",
        [tenantId]
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].appointment_id).not.toBe(appointmentId);
    });
  });
});
