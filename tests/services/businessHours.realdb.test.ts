/**
 * Real-DB tests for derived business hours.
 *
 * There is no business-hours config in this system: the shop is open when someone
 * is scheduled. That's the right model, but it left the AI unable to TELL a caller
 * when that is — so on 2026-07-12 it asked "what day and time were you thinking?",
 * she named two impossible dates, and gave up after seven minutes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { getBusinessHours } from '../../src/services/businessHours';

let setup: Client;
let pool: Pool;
let dbAvailable = false;
let tenantId: string;
let employeeId: string;
const tenantsToClean: string[] = [];

async function hours() {
  return createWithTenantClient(pool)(tenantId, (c) => getBusinessHours(c, tenantId));
}

/** Next occurrence of a weekday (1=Mon), N weeks out. */
async function nextDow(dow: number): Promise<string> {
  const r = await setup.query<{ d: Date }>(
    `SELECT (CURRENT_DATE + 1 + (($1::int - EXTRACT(DOW FROM CURRENT_DATE + 1)::int + 7) % 7)::int)::date AS d`,
    [dow]
  );
  return r.rows[0].d.toISOString().slice(0, 10);
}

async function seed(date: string, start: string, end: string) {
  await setup.query(
    `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
     VALUES ($1,$2,$3,$4,$5,false) ON CONFLICT DO NOTHING`,
    [tenantId, employeeId, date, start, end]
  );
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    tenantId = await createTenant(setup, 'Hours Co', 'auto-shop');
    tenantsToClean.push(tenantId);
    const e = await setup.query<{ employee_id: string }>(
      `INSERT INTO employees (tenant_id, name, is_active) VALUES ($1,'Dale',true) RETURNING employee_id`,
      [tenantId]
    );
    employeeId = e.rows[0].employee_id;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
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
});

describe('getBusinessHours (real DB)', () => {
  it('HAPPY: collapses identical weekdays into a spoken range', async () => {
    // Thinking Hammer's actual shape. A person says "Monday to Friday, one to
    // five" — not five identical sentences.
    for (let d = 1; d <= 5; d++) await seed(await nextDow(d), '13:00', '17:00');

    const h = await hours();
    expect(h.spoken).toBe('Monday to Friday, 1:00 PM to 5:00 PM');
  });

  it('LIMITATION: one employee CANNOT have a lunch gap — the PK forbids a split shift', async () => {
    // WHAT: employee_schedule's PK is (tenant_id, employee_id, shift_date) — ONE
    //        row per person per day. A second row for the same person that day
    //        (8–12, then 1–5) is silently dropped by ON CONFLICT.
    // WHY THIS TEST EXISTS: "8 to 5, closed for lunch" is a completely ordinary
    //        way for a shop to be open, and this system CANNOT REPRESENT IT.
    //        Discovered 2026-07-12 while deriving business hours. The merge logic
    //        below handles gaps correctly — there is simply no way to STORE one.
    //        Pinned as a test so the limitation is visible rather than folklore.
    //        Fix requires a migration: PK → (tenant_id, employee_id, shift_date,
    //        start_time). See docs/TODO.md.
    const mon = await nextDow(1);
    await seed(mon, '08:00', '12:00');
    await seed(mon, '13:00', '17:00'); // ← silently discarded

    const h = await hours();
    expect(h.days[0].blocks).toHaveLength(1); // NOT 2 — the afternoon is gone
    expect(h.spoken).toBe('Monday, 8:00 AM to 12:00 PM');
  });

  it('HAPPY: a gap BETWEEN DIFFERENT staff is preserved (the merge logic is right)', async () => {
    // The gap-handling itself works — it just needs two people to express, because
    // one person cannot have two rows. Morning tech 8–12, afternoon tech 1–5:
    // the shop is open 8–12 and 1–5, and we say both.
    const mon = await nextDow(1);
    await seed(mon, '08:00', '12:00');
    const e2 = await setup.query<{ employee_id: string }>(
      `INSERT INTO employees (tenant_id, name, is_active) VALUES ($1,'Afternoon Sam',true) RETURNING employee_id`,
      [tenantId]
    );
    await setup.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1,$2,$3,'13:00','17:00',false)`,
      [tenantId, e2.rows[0].employee_id, mon]
    );

    const h = await hours();
    expect(h.days[0].blocks).toHaveLength(2); // the lunch gap survives
    expect(h.spoken).toContain('8:00 AM to 12:00 PM');
    expect(h.spoken).toContain('1:00 PM to 5:00 PM');
  });

  it('HAPPY: overlapping staff merge into ONE window (the shop, not each person)', async () => {
    // Two techs, 1–5 and 3–7. The shop is open 1–7. A caller does not care who is
    // on — offering "1 to 5 and 3 to 7" would be nonsense.
    const mon = await nextDow(1);
    await seed(mon, '13:00', '17:00');
    const e2 = await setup.query<{ employee_id: string }>(
      `INSERT INTO employees (tenant_id, name, is_active) VALUES ($1,'Sam',true) RETURNING employee_id`,
      [tenantId]
    );
    await setup.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1,$2,$3,'15:00','19:00',false)`,
      [tenantId, e2.rows[0].employee_id, mon]
    );

    const h = await hours();
    expect(h.days[0].blocks).toHaveLength(1);
    expect(h.spoken).toContain('1:00 PM to 7:00 PM');
  });

  it('SAD: nobody scheduled → NO hours, so the AI cannot claim to be open', async () => {
    const h = await hours();
    expect(h.spoken).toBe('');
    expect(h.days).toHaveLength(0);
    expect(h.bookableThrough).toBeNull();
  });

  it('HAPPY: reports the booking horizon (how far out we can actually go)', async () => {
    const mon = await nextDow(1);
    await seed(mon, '13:00', '17:00');
    const h = await hours();
    expect(h.bookableThrough).toBe(mon);
  });
});
