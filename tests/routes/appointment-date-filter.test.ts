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

describe('Appointment date-range filter', () => {
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
      console.warn('[appointment-date-filter.test] Skipping DB tests - connection failed', err);
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

  async function createAppointment(startTime: string, endTime: string) {
    const res = await client.query(
      `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description)
       VALUES ($1, $2, $3, $4, $5, 'Test appt') RETURNING appointment_id`,
      [tenantId, resourceId, customerId, startTime, endTime]
    );
    return res.rows[0].appointment_id;
  }

  async function queryAppointments(params: {
    tenant_id: string;
    start_date?: string;
    end_date?: string;
  }) {
    const conditions: string[] = ['a.tenant_id = $1'];
    const values: (string | number)[] = [params.tenant_id];
    let idx = 2;

    if (params.start_date) {
      conditions.push(`a.start_time >= $${idx}`);
      values.push(params.start_date);
      idx++;
    }
    if (params.end_date) {
      conditions.push(`a.start_time < $${idx}`);
      values.push(params.end_date);
      idx++;
    }

    const res = await client.query(
      `SELECT a.* FROM appointments a WHERE ${conditions.join(' AND ')} ORDER BY a.start_time ASC`,
      values
    );
    return res.rows;
  }

  it('returns all appointments when no date range is specified', async () => {
    if (!dbAvailable) return;

    await createAppointment('2026-03-19T09:00:00Z', '2026-03-19T10:00:00Z');
    await createAppointment('2026-03-20T09:00:00Z', '2026-03-20T10:00:00Z');
    await createAppointment('2026-03-21T09:00:00Z', '2026-03-21T10:00:00Z');

    const rows = await queryAppointments({ tenant_id: tenantId });
    expect(rows.length).toBe(3);
  });

  it('filters appointments by start_date only', async () => {
    if (!dbAvailable) return;

    await createAppointment('2026-03-18T09:00:00Z', '2026-03-18T10:00:00Z');
    await createAppointment('2026-03-19T09:00:00Z', '2026-03-19T10:00:00Z');
    await createAppointment('2026-03-20T09:00:00Z', '2026-03-20T10:00:00Z');

    const rows = await queryAppointments({
      tenant_id: tenantId,
      start_date: '2026-03-19T00:00:00Z',
    });
    expect(rows.length).toBe(2);
  });

  it('filters appointments by end_date only', async () => {
    if (!dbAvailable) return;

    await createAppointment('2026-03-18T09:00:00Z', '2026-03-18T10:00:00Z');
    await createAppointment('2026-03-19T09:00:00Z', '2026-03-19T10:00:00Z');
    await createAppointment('2026-03-20T09:00:00Z', '2026-03-20T10:00:00Z');

    const rows = await queryAppointments({ tenant_id: tenantId, end_date: '2026-03-20T00:00:00Z' });
    expect(rows.length).toBe(2);
  });

  it('filters appointments by both start_date and end_date for a single day', async () => {
    if (!dbAvailable) return;

    await createAppointment('2026-03-18T09:00:00Z', '2026-03-18T10:00:00Z');
    await createAppointment('2026-03-19T09:00:00Z', '2026-03-19T10:00:00Z');
    await createAppointment('2026-03-19T14:00:00Z', '2026-03-19T15:00:00Z');
    await createAppointment('2026-03-20T09:00:00Z', '2026-03-20T10:00:00Z');

    const rows = await queryAppointments({
      tenant_id: tenantId,
      start_date: '2026-03-19T00:00:00Z',
      end_date: '2026-03-20T00:00:00Z',
    });
    expect(rows.length).toBe(2);
  });

  it('returns empty array when no appointments match the date range', async () => {
    if (!dbAvailable) return;

    await createAppointment('2026-03-18T09:00:00Z', '2026-03-18T10:00:00Z');

    const rows = await queryAppointments({
      tenant_id: tenantId,
      start_date: '2026-03-20T00:00:00Z',
      end_date: '2026-03-21T00:00:00Z',
    });
    expect(rows.length).toBe(0);
  });

  it('orders results by start_time ascending', async () => {
    if (!dbAvailable) return;

    await createAppointment('2026-03-19T14:00:00Z', '2026-03-19T15:00:00Z');
    await createAppointment('2026-03-19T09:00:00Z', '2026-03-19T10:00:00Z');
    await createAppointment('2026-03-19T11:00:00Z', '2026-03-19T12:00:00Z');

    const rows = await queryAppointments({
      tenant_id: tenantId,
      start_date: '2026-03-19T00:00:00Z',
      end_date: '2026-03-20T00:00:00Z',
    });
    expect(rows.length).toBe(3);
    const times = rows.map((r: { start_time: string }) => new Date(r.start_time).getTime());
    expect(times[0]).toBeLessThan(times[1]);
    expect(times[1]).toBeLessThan(times[2]);
  });
});
