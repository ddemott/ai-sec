/**
 * Real-DB regression: a business with NO resources still has availability.
 *
 * WHO: any tenant whose "resource" is just the owner's own time — a
 *      consultancy, a solo trade, an answering service. There is no bay, no
 *      chair, no room to allocate.
 * WHAT: findNextAvailableSlots joined resources with a plain CROSS JOIN, so
 *      zero resource rows meant zero candidates for every slot on every day.
 * WHEN: found 2026-08-15 while installing a business shape for a local test
 *      call — an employee, three services and four weeks of shifts, and the
 *      soonest-slots path answered "I'm not finding anything open in the next
 *      week" while the DATE path listed 31 open times for the same day.
 * WHERE: src/services/availabilitySearch.ts, the candidates CTE.
 * WHY: the soonest path is the OPENER the agent leads with, so this failure
 *      lands on the first thing a caller hears about their booking. And it
 *      hid behind the test suite, which seeds a resource specifically to make
 *      the join fire ("A resource must EXIST for the availability cross-join
 *      to produce slots" — availabilityFallback.realdb.test.ts).
 *
 * WHY REAL POSTGRES: the thing under test IS the SQL. A mock would assert the
 * mock.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { findNextAvailableSlots, type AvailableSlot } from '../../src/services/availabilitySearch';

let setup: Client;
let pool: Pool;
let dbAvailable = false;
let tenantId: string;
let employeeId: string;
const tenantsToClean: string[] = [];

function withTenant<T>(fn: Parameters<ReturnType<typeof createWithTenantClient>>[1]) {
  return createWithTenantClient(pool)(tenantId, fn) as Promise<T>;
}

/** ISO date N days out, per the DB's clock. */
async function dayOffset(n: number): Promise<string> {
  const r = await setup.query<{ d: Date }>(`SELECT (CURRENT_DATE + $1::int) AS d`, [n]);
  return r.rows[0].d.toISOString().slice(0, 10);
}

/** Search from tomorrow morning, so "today, already past" never decides a result. */
async function search(overrides: Record<string, unknown> = {}): Promise<AvailableSlot[]> {
  const from = await dayOffset(1);
  return withTenant<AvailableSlot[]>((client) =>
    findNextAvailableSlots(client, {
      tenantId,
      fromTime: `${from}T00:00:00Z`,
      durationMinutes: 30,
      count: 5,
      searchHorizonHours: 168,
      bufferMinutes: 0,
      ...overrides,
    })
  );
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    tenantId = await createTenant(setup, 'Resourceless Consulting', 'owner-for-hire');
    tenantsToClean.push(tenantId);

    const e = await setup.query<{ employee_id: string }>(
      `INSERT INTO employees (tenant_id, name, is_active) VALUES ($1,'Dale',true) RETURNING employee_id`,
      [tenantId]
    );
    employeeId = e.rows[0].employee_id;
    // DELIBERATELY NO RESOURCE ROW. That absence is the whole test.
    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[availabilityResourceless.realdb] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  if (!dbAvailable) return;
  await setup.query('DELETE FROM appointments WHERE tenant_id = $1', [tenantId]);
  await setup.query('DELETE FROM customers WHERE tenant_id = $1', [tenantId]);
  await setup.query('DELETE FROM resources WHERE tenant_id = $1', [tenantId]);
  await setup.query('DELETE FROM employee_schedule WHERE tenant_id = $1', [tenantId]);
  for (let i = 1; i <= 5; i++) {
    await setup.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1,$2,$3,'09:00','17:00',false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING`,
      [tenantId, employeeId, await dayOffset(i)]
    );
  }
});

describe('availability for a business that owns no resources', () => {
  it('THE BUG: staff and shifts and services, and the soonest search returned nothing', async () => {
    // WHAT: no resource row exists. Before the fix this asserted 0 slots —
    //       which is what the caller was told, in a week with 5 full workdays.
    const slots = await search();

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].employee_id).toBe(employeeId);
  });

  it('reports the missing resource as null rather than inventing one', async () => {
    // WHY: callers must be able to tell "no resource needed" from "resource X".
    //      A placeholder string would be a lie the dashboard would then render.
    const slots = await search();

    expect(slots[0].resource_id).toBeNull();
    expect(slots[0].resource_name).toBeNull();
  });

  it('a service that REQUIRES a capability still finds nothing — that refusal is correct', async () => {
    // WHY THIS IS THE IMPORTANT ONE: the fall-open must be narrow. If a service
    //      needs a lift and the shop owns no lift, "no availability" is the
    //      truthful answer. Widening the escape hatch to cover this case would
    //      book work the business cannot physically do.
    const slots = await search({ requiredCapabilities: ['lift'] });

    expect(slots).toHaveLength(0);
  });
});

describe('availability once the business DOES own a resource', () => {
  beforeEach(async () => {
    if (!dbAvailable) return;
    await setup.query(`INSERT INTO resources (tenant_id, name, is_active) VALUES ($1,'Bay 1',true)`, [
      tenantId,
    ]);
  });

  it('pairs the slot with the resource, exactly as before', async () => {
    const slots = await search();

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].resource_name).toBe('Bay 1');
  });

  it('GUARD: a tenant WITH resources is still blocked when its only one is busy', async () => {
    // WHY: this is what the fall-open must not break. The old CROSS JOIN got
    //      this right by accident of being strict; the new LATERAL has to get
    //      it right on purpose, or a single-bay shop double-books its bay.
    const day = await dayOffset(1);
    const resource = await setup.query<{ resource_id: string }>(
      `SELECT resource_id FROM resources WHERE tenant_id = $1`,
      [tenantId]
    );
    const customer = await setup.query<{ customer_id: string }>(
      `INSERT INTO customers (tenant_id, name, phone) VALUES ($1,'Bay Hogger','+15550000001')
       RETURNING customer_id`,
      [tenantId]
    );
    // Occupy the resource across the WHOLE working day, with NO employee on the
    // appointment, so only the resource — never the employee — is what rules
    // the slots out.
    await setup.query(
      `INSERT INTO appointments (tenant_id, customer_id, resource_id, start_time, end_time, status)
       VALUES ($1,$2,$3,$4::date + time '09:00', $4::date + time '17:00', 'scheduled')`,
      [tenantId, customer.rows[0].customer_id, resource.rows[0].resource_id, day]
    );

    const slots = await search({ fromTime: `${day}T00:00:00Z`, searchHorizonHours: 24 });

    expect(slots).toHaveLength(0);
  });
});
