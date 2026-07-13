/**
 * Real-DB regression for the alternatives-search fallback.
 *
 * THE CALL THIS COMES FROM (2026-07-12, a real customer): the caller asked for a
 * date PAST the end of the shop's schedule. The booking RPC correctly refused.
 * The backend then went looking for alternatives to offer her — starting AT HER
 * REQUESTED DATE and searching 24 hours forward, into a stretch of calendar where
 * no shift existed and none ever would. It found nothing, so the agent had nothing
 * to propose, so all it could say was "would you like a different day?" She
 * guessed blind, three times, and gave up after seven minutes — while dozens of
 * open slots sat in the following week, invisible, because nobody looked backward.
 *
 * The fix: when nothing is open near the requested time, search from NOW.
 *
 * WHY REAL POSTGRES: findNextAvailableSlots is a generate_series + cross-join over
 * shifts, appointments, skills, and buffers. Mocking it would test the mock.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { findNextAvailableSlots } from '../../src/services/availabilitySearch';

let setup: Client;
let pool: Pool;
let dbAvailable = false;
let tenantId: string;
let employeeId: string;
const tenantsToClean: string[] = [];

async function withTenant<T>(fn: Parameters<ReturnType<typeof createWithTenantClient>>[1]) {
  return createWithTenantClient(pool)(tenantId, fn) as Promise<T>;
}

/** ISO date N days out, per the DB's clock. */
async function dayOffset(n: number): Promise<string> {
  const r = await setup.query<{ d: Date }>(`SELECT (CURRENT_DATE + $1::int) AS d`, [n]);
  return r.rows[0].d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    tenantId = await createTenant(setup, 'Fallback Search Co', 'auto-shop');
    tenantsToClean.push(tenantId);

    const e = await setup.query<{ employee_id: string }>(
      `INSERT INTO employees (tenant_id, name, is_active) VALUES ($1,'Dale',true) RETURNING employee_id`,
      [tenantId]
    );
    employeeId = e.rows[0].employee_id;
    // A resource must EXIST for the availability cross-join to produce slots —
    // we never reference its id, only its presence.
    await setup.query(
      `INSERT INTO resources (tenant_id, name, is_active) VALUES ($1,'Bay 1',true)`,
      [tenantId]
    );
    dbAvailable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[availabilityFallback.realdb] DB not available, skipping', err);
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
  await setup.query('DELETE FROM employee_schedule WHERE tenant_id = $1', [tenantId]);
  // The shop works the next 5 days, 13:00–17:00. Nothing beyond that — exactly
  // Thinking Hammer's shape: a schedule with a cliff.
  for (let i = 1; i <= 5; i++) {
    await setup.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1,$2,$3,'13:00','17:00',false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING`,
      [tenantId, employeeId, await dayOffset(i)]
    );
  }
});

describe("alternatives search — searching from the caller's guess vs from NOW", () => {
  it('THE BUG: searching forward from a date past the schedule cliff finds NOTHING', async () => {
    // WHO: the 2026-07-12 caller, asking for a date a week past the last shift.
    // WHAT: this is the OLD behavior, preserved as a test so the reason for the
    //        fallback can never be forgotten. Search from her date, 24h ahead.
    // WHY: it returns [] — not because the shop is busy, but because we are
    //       looking at empty calendar. The agent then has literally nothing to
    //       offer, and the caller is asked to guess again.
    const pastTheCliff = await dayOffset(30); // 25 days past the last shift
    const slots = await withTenant<unknown[]>((client) =>
      findNextAvailableSlots(client, {
        tenantId,
        fromTime: `${pastTheCliff}T15:00:00Z`,
        durationMinutes: 30,
        count: 5,
        searchHorizonHours: 24, // the old default
        bufferMinutes: 0,
      })
    );

    expect(slots).toHaveLength(0); // ← seven minutes of a customer's life
  });

  it('THE FIX: searching from NOW finds the real openings that were there all along', async () => {
    // WHAT: same shop, same empty future date — but search from today instead.
    // WHY: the slots were never missing. We were looking in the wrong place. This
    //       is what lets the agent say "the soonest I can get you in is Monday at
    //       1" instead of "would you like a different day?"
    const slots = await withTenant<{ start_time: string; employee_name: string }[]>((client) =>
      findNextAvailableSlots(client, {
        tenantId,
        fromTime: new Date().toISOString(), // from NOW
        durationMinutes: 30,
        count: 3,
        searchHorizonHours: 168,
        bufferMinutes: 0,
      })
    );

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].employee_name).toBe('Dale');
    // Every slot offered must be real — inside the shop's actual working days.
    const firstDay = new Date(slots[0].start_time).toISOString().slice(0, 10);
    expect(firstDay >= (await dayOffset(1))).toBe(true);
    expect(firstDay <= (await dayOffset(5))).toBe(true);
  });

  it('HAPPY: a 7-day horizon near the requested time still prefers NEARBY slots', async () => {
    // WHY: the fallback must not hijack the normal case. Someone who asks for a
    //       time inside the schedule should be offered something CLOSE to it, not
    //       bounced to "the soonest we have." Stage 1 of the search exists for this.
    const dayThree = await dayOffset(3);
    const slots = await withTenant<{ start_time: string }[]>((client) =>
      findNextAvailableSlots(client, {
        tenantId,
        fromTime: `${dayThree}T18:00:00Z`, // 1pm Chicago on a working day
        durationMinutes: 30,
        count: 3,
        searchHorizonHours: 168,
        bufferMinutes: 0,
      })
    );

    expect(slots.length).toBeGreaterThan(0);
    // The first offer is on the requested day, not dragged back to day 1.
    expect(new Date(slots[0].start_time).toISOString().slice(0, 10)).toBe(dayThree);
  });

  it('SAD: a shop with NO schedule at all offers nothing — and must not pretend', async () => {
    // WHY: the fallback finds real slots or none. It must never invent a time for
    //       a business that has no staff scheduled — the caller would be booked
    //       into a slot nobody is there to work. "Let me take a message" is the
    //       honest answer, and the route says exactly that.
    await setup.query('DELETE FROM employee_schedule WHERE tenant_id = $1', [tenantId]);

    const slots = await withTenant<unknown[]>((client) =>
      findNextAvailableSlots(client, {
        tenantId,
        fromTime: new Date().toISOString(),
        durationMinutes: 30,
        count: 3,
        searchHorizonHours: 168,
        bufferMinutes: 0,
      })
    );

    expect(slots).toHaveLength(0);
  });
});
