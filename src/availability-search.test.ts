/**
 * Real-DB tests for findNextAvailableSlots — the helper that powers
 * "next-available-time" suggestions when the originally-requested slot
 * has no qualified employee free.
 *
 * Why real DB (not mocks): the helper is a single SQL query that uses
 * generate_series + window functions + the same skill / shift / overlap
 * checks as book_with_scheduling_atomic. Mocking that surface would
 * mock the thing under test — we'd be proving the mock works, not the
 * SQL. Each test wraps in BEGIN / ROLLBACK so changes don't leak.
 *
 * Three flavors of scenario the helper must get right:
 *
 *   1. All employees idle — earliest slot is the requested time itself,
 *      assigned to the lowest-skill qualified employee.
 *   2. Lower-skill employees busy at requested time — earliest slot
 *      shifts forward to when the next lower-skill tech frees up; OR
 *      same time if a higher-skill tech is already idle.
 *   3. All employees busy at requested time — earliest slot is the
 *      first time ANY qualified employee finishes their current job.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { type Client } from 'pg';
import { getRootClient, clearDB, createTenant, createResource, createEmployee, createScheduleEntry, createCustomerFull, createAppointment, beginTestTransaction, rollbackTestTransaction, skipIfDbDown } from './test-utils';

import { findNextAvailableSlots } from './services/availabilitySearch';

let root: Client;
let dbAvailable = false;
beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

beforeAll(async () => {
  try {
    root = await getRootClient();
    dbAvailable = true;
    await clearDB(root);
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (root) await root.end();
});

beforeEach(async () => {
  if (dbAvailable) await beginTestTransaction(root);
});

afterEach(async () => {
  if (dbAvailable) await rollbackTestTransaction(root);
});

describe('findNextAvailableSlots', () => {
  it('HAPPY: all idle — first slot is the requested time, lowest-skill emp wins', async () => {
    if (!dbAvailable) return;
    // WHO: caller asks for tire rotation at 10:00; nobody is busy
    // WHAT: helper returns 10:00 as the first slot, paired with the
    //        3-skill employee (Carlos), not the 5-skill (Mike)
    // WHEN: typical "is there anything next-available?" call when the
    //        original window simply had nothing booked yet
    // WHERE: src/services/availabilitySearch.ts SQL ORDER BY
    // WHY: pin that the helper's per-slot ranking uses the same
    //        lowest-skill-first policy as the booking RPC. Without this,
    //        the helper would suggest Mike for jobs Carlos could do
    //        and waste senior-tech time on simple suggestions.

    const tenantId = await createTenant(root, 'TireCo', 'mobile_tire', 'America/Chicago');
    const _truck1 = await createResource(root, tenantId, 'Truck 1');
    const carlos = await createEmployee(root, tenantId, 'Carlos', ['flat-repair', 'tire-swap', 'tire-rotation']);
    const mike = await createEmployee(root, tenantId, 'Mike', ['flat-repair', 'tire-swap', 'tire-rotation', 'tire-install', 'balancing']);

    // Future weekday with shift coverage 9-17 for both.
    const date = '2026-06-15'; // Monday
    await createScheduleEntry(root, tenantId, carlos, date, '09:00', '17:00');
    await createScheduleEntry(root, tenantId, mike, date, '09:00', '17:00');

    const fromTime = `${date}T15:00:00.000Z`; // 10:00 CDT, in shift
    const slots = await findNextAvailableSlots(root as unknown as Parameters<typeof findNextAvailableSlots>[0], {
      tenantId,
      fromTime,
      durationMinutes: 30,
      requiredSkills: ['tire-rotation'],
      count: 3,
    });

    expect(slots.length).toBeGreaterThan(0);
    const first = slots[0];
    expect(first.start_time).toBe(new Date(fromTime).toISOString());
    // Carlos has 3 skills; Mike has 5. Carlos must win the first slot.
    expect(first.employee_id).toBe(carlos);
    expect(first.skill_count).toBe(3);
  });

  it('HAPPY: lower-skill busy — first slot uses higher-skill emp at SAME time', async () => {
    if (!dbAvailable) return;
    // WHO: Carlos is mid-job; Mike is idle; caller wants a tire rotation now
    // WHAT: helper returns the requested time itself, paired with Mike
    //        (only-available qualified employee at that moment)
    // WHY: this is exactly the scenario the user articulated — "if A and
    //        B (juniors) are busy and C (senior) is idle, pick C." The
    //        busy filter shifts the candidate set; the sort then picks
    //        from whoever's left.

    const tenantId = await createTenant(root, 'TireCo', 'mobile_tire', 'America/Chicago');
    const truck1 = await createResource(root, tenantId, 'Truck 1');
    const truck2 = await createResource(root, tenantId, 'Truck 2');
    const carlos = await createEmployee(root, tenantId, 'Carlos', ['tire-rotation']);
    const mike = await createEmployee(root, tenantId, 'Mike', ['flat-repair', 'tire-swap', 'tire-rotation', 'tire-install', 'balancing']);

    const date = '2026-06-15';
    await createScheduleEntry(root, tenantId, carlos, date, '09:00', '17:00');
    await createScheduleEntry(root, tenantId, mike, date, '09:00', '17:00');

    // Pre-book Carlos at 15:00-15:30 UTC on Truck 1 — he's mid-job at the
    // requested time. Mike is free.
    const cust = await createCustomerFull(root, tenantId, '+15551112222', 'Existing Customer');
    await createAppointment(
      root, tenantId, truck1, cust,
      `${date}T15:00:00.000Z`, `${date}T15:30:00.000Z`,
      'pre-book carlos', 'scheduled', carlos
    );

    const slots = await findNextAvailableSlots(root as unknown as Parameters<typeof findNextAvailableSlots>[0], {
      tenantId,
      fromTime: `${date}T15:00:00.000Z`,
      durationMinutes: 30,
      requiredSkills: ['tire-rotation'],
      count: 3,
    });

    expect(slots.length).toBeGreaterThan(0);
    const first = slots[0];
    expect(first.start_time).toBe(`${date}T15:00:00.000Z`);
    expect(first.employee_id, 'Mike (only available qualified employee) wins').toBe(mike);
    // Subsequent slots may still pair with Carlos as he frees up — that's fine.
    void truck2;
  });

  it('HAPPY: all busy at requested time — first slot is the next time someone frees up', async () => {
    if (!dbAvailable) return;
    // WHO: every qualified tech is mid-job at 15:00; caller wants a
    //        tire rotation
    // WHAT: helper returns the next 15-min boundary at which any tech
    //        finishes — Carlos at 15:30, then Mike at 16:00 etc.
    // WHEN: a fully-booked moment, common during a busy lunch rush
    // WHERE: SQL slot_starts × candidates predicate
    // WHY: pin the user's articulated principle — "if everyone's busy,
    //        find the next time someone is free, and pick THAT slot
    //        with whoever frees up first." The helper must skip
    //        forward through the 15-min grid, not return empty.

    const tenantId = await createTenant(root, 'TireCo', 'mobile_tire', 'America/Chicago');
    const truck1 = await createResource(root, tenantId, 'Truck 1');
    const truck2 = await createResource(root, tenantId, 'Truck 2');
    const carlos = await createEmployee(root, tenantId, 'Carlos', ['tire-rotation', 'flat-repair']);
    const mike = await createEmployee(root, tenantId, 'Mike', ['tire-rotation', 'flat-repair', 'tire-install', 'balancing']);

    const date = '2026-06-15';
    await createScheduleEntry(root, tenantId, carlos, date, '09:00', '17:00');
    await createScheduleEntry(root, tenantId, mike, date, '09:00', '17:00');

    // Pre-book BOTH techs covering 15:00. Carlos finishes at 15:30, Mike
    // at 16:00. Helper should return 15:30 first.
    const cust = await createCustomerFull(root, tenantId, '+15551112222', 'Existing Customer');
    await createAppointment(
      root, tenantId, truck1, cust,
      `${date}T15:00:00.000Z`, `${date}T15:30:00.000Z`,
      'carlos busy', 'scheduled', carlos
    );
    await createAppointment(
      root, tenantId, truck2, cust,
      `${date}T15:00:00.000Z`, `${date}T16:00:00.000Z`,
      'mike busy', 'scheduled', mike
    );

    const slots = await findNextAvailableSlots(root as unknown as Parameters<typeof findNextAvailableSlots>[0], {
      tenantId,
      fromTime: `${date}T15:00:00.000Z`,
      durationMinutes: 30,
      requiredSkills: ['tire-rotation'],
      count: 3,
    });

    expect(slots.length).toBeGreaterThan(0);
    const first = slots[0];
    // Earliest free 30-min window: Carlos 15:30-16:00 (he just finished).
    expect(first.start_time).toBe(`${date}T15:30:00.000Z`);
    expect(first.employee_id).toBe(carlos);
    // The 16:00 slot should also exist — Mike just freed.
    const sixteenSlot = slots.find((s) => s.start_time === `${date}T16:00:00.000Z`);
    expect(sixteenSlot).toBeTruthy();
  });

  it('SAD: nothing in the search horizon — empty array', async () => {
    if (!dbAvailable) return;
    // WHO: caller asks for a service nobody is qualified for, OR a
    //        time outside any employee's shift window
    // WHAT: helper returns [] — never throws, never returns garbage
    // WHY: callers (agent + dashboard) check the array length to decide
    //        whether to surface "no alternatives found" UX. Throwing
    //        would force them all to wrap in try/catch.

    const tenantId = await createTenant(root, 'TireCo', 'mobile_tire', 'America/Chicago');
    await createResource(root, tenantId, 'Truck 1');
    await createEmployee(root, tenantId, 'Carlos', ['tire-rotation']);
    // No shift entries — Carlos isn't on any day's schedule.

    const slots = await findNextAvailableSlots(root as unknown as Parameters<typeof findNextAvailableSlots>[0], {
      tenantId,
      fromTime: '2026-06-15T15:00:00.000Z',
      durationMinutes: 30,
      requiredSkills: ['tire-rotation'],
      count: 3,
    });

    expect(slots).toEqual([]);
  });

  it('HAPPY: requiredSkills empty — any qualified employee counts (open service)', async () => {
    if (!dbAvailable) return;
    // WHO: caller asks for a generic appointment with no specific skill
    //        required (walk-in, consultation, etc.)
    // WHAT: helper falls open and returns earliest free slots without
    //        a skill filter
    // WHY: the booking RPC has the same fall-open behavior; the helper
    //        must agree so suggestion lists match what the actual book
    //        will accept

    const tenantId = await createTenant(root, 'TireCo', 'mobile_tire', 'America/Chicago');
    const truck1 = await createResource(root, tenantId, 'Truck 1');
    const carlos = await createEmployee(root, tenantId, 'Carlos', []);
    const date = '2026-06-15';
    await createScheduleEntry(root, tenantId, carlos, date, '09:00', '17:00');

    const slots = await findNextAvailableSlots(root as unknown as Parameters<typeof findNextAvailableSlots>[0], {
      tenantId,
      fromTime: `${date}T15:00:00.000Z`,
      durationMinutes: 30,
      requiredSkills: [],
      count: 1,
    });

    expect(slots.length).toBe(1);
    expect(slots[0].employee_id).toBe(carlos);
    void truck1;
  });
});
