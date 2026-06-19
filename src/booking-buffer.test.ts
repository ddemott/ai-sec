import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { type Client } from 'pg';
import {
  getRootClient,
  clearDB,
  createTenant,
  createResource,
  createEmployee,
  createScheduleEntry,
  createCustomerFull,
  createAppointment,
  beginTestTransaction,
  rollbackTestTransaction,
  skipIfDbDown,
} from './test-utils';
import { findNextAvailableSlots } from './services/availabilitySearch';
import { getTenantBufferMinutes } from './services/tenantBuffer';
import { selectAssignments } from '../shared/scheduling';
import type { PoolClient } from 'pg';

// ─────────────────────────────────────────────────────────────────────────
// WHO  : the per-tenant "default buffer between appointments" feature.
// WHAT : a gap (minutes) the AI must leave on BOTH sides of every existing
//        appointment, enforced identically in the booking RPCs AND in every
//        slot-offering path, so the AI never OFFERS a slot booking rejects.
// WHEN : 2026-06-07. Migrations 20260607000000 (column) + 20260607000001
//        (RPC enforcement).
// WHERE: book_with_scheduling_atomic / book_appointment_atomic /
//        check_availability_with_tz (SQL, via p_buffer_minutes), plus
//        findNextAvailableSlots + selectAssignments (TS, via bufferMinutes).
// WHY  : Dale's brother wants no back-to-back meetings (8-9 then 9-10) — he
//        needs time to gather notes / breathe between appointments.
//
// Anchor appointment in every DB test: 10:00–10:30 UTC on a far-future date
// (past-time rejection avoided). With a 15-minute buffer the first bookable
// "after" start is 10:45 (gap exactly 15 is allowed); 10:30 (gap 0) is not.
// ─────────────────────────────────────────────────────────────────────────

const DATE = '2027-06-01';
const ANCHOR_START = `${DATE}T10:00:00Z`;
const ANCHOR_END = `${DATE}T10:30:00Z`;

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

/** Tenant + one resource + one all-day employee, with the anchor appointment
 *  already booked 10:00–10:30 on that resource+employee. Returns the ids. */
async function setupWithAnchor() {
  const tenantId = await createTenant(root, 'Buffer Co', 'mobile-tire', 'UTC');
  // A tenant-insert trigger auto-seeds template resources/employees for the
  // business_type. Clear them so this tenant has EXACTLY one resource + one
  // employee — otherwise a free auto-seeded resource would satisfy a booking
  // the anchored resource can't, masking the buffer behavior under test.
  await root.query('DELETE FROM appointments WHERE tenant_id = $1', [tenantId]);
  await root.query('DELETE FROM resources WHERE tenant_id = $1', [tenantId]);
  await root.query('DELETE FROM employees WHERE tenant_id = $1', [tenantId]);
  const resourceId = await createResource(root, tenantId, 'Bay 1');
  const employeeId = await createEmployee(root, tenantId, 'Sam');
  await createScheduleEntry(root, tenantId, employeeId, DATE, '08:00', '18:00');
  const customerId = await createCustomerFull(root, tenantId, '+15550000001', 'Anchor Cust');
  await createAppointment(
    root,
    tenantId,
    resourceId,
    customerId,
    ANCHOR_START,
    ANCHOR_END,
    'Anchor',
    'scheduled',
    employeeId
  );
  return { tenantId, resourceId, employeeId };
}

async function bookWithScheduling(params: {
  tenant_id: string;
  window_from: string;
  window_to: string;
  buffer: number;
  phone?: string;
}) {
  const res = await root.query(
    `SELECT * FROM book_with_scheduling_atomic(
       $1::UUID, $2::TEXT, NULL::TEXT, 'Test'::TEXT, 'call-buf'::TEXT, NULL::TEXT,
       NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, $3::TIMESTAMPTZ, $4::TIMESTAMPTZ,
       '{}'::TEXT[], '{}'::TEXT[], NULL::UUID, NULL::TEXT, NULL::TEXT, 30::INTEGER, $5::INTEGER
     )`,
    [
      params.tenant_id,
      params.phone ?? '+15559990001',
      params.window_from,
      params.window_to,
      params.buffer,
    ]
  );
  return res.rows[0];
}

async function bookAppointmentAtomic(params: {
  tenant_id: string;
  resource_id: string;
  start: string;
  end: string;
  buffer: number;
  phone?: string;
}) {
  const res = await root.query(
    `SELECT * FROM book_appointment_atomic(
       $1::UUID, $2::UUID, NULL::UUID, $3::TIMESTAMPTZ, $4::TIMESTAMPTZ, 'Test'::TEXT, 'call-buf'::TEXT,
       NULL::TEXT, NULL::TEXT, NULL::UUID, $5::TEXT, 'Cust'::TEXT, $6::INTEGER
     )`,
    [
      params.tenant_id,
      params.resource_id,
      params.start,
      params.end,
      params.phone ?? '+15559990002',
      params.buffer,
    ]
  );
  return res.rows[0];
}

async function checkAvailability(params: {
  tenant_id: string;
  resource_id: string;
  start: string;
  end: string;
  buffer: number;
}) {
  const res = await root.query(
    `SELECT * FROM check_availability_with_tz($1::UUID, $2::UUID, $3::TIMESTAMPTZ, $4::TIMESTAMPTZ, NULL, $5::INTEGER)`,
    [params.tenant_id, params.resource_id, params.start, params.end, params.buffer]
  );
  return res.rows[0];
}

describe('book_with_scheduling_atomic — buffer enforcement', () => {
  it('REJECTS a back-to-back booking (gap 0) when buffer=15', async () => {
    if (!dbAvailable) return;
    const { tenantId } = await setupWithAnchor();
    // 10:30 starts the instant the anchor ends — gap 0, less than the 15-min
    // buffer, so the only resource is treated as occupied → no availability.
    const r = await bookWithScheduling({
      tenant_id: tenantId,
      window_from: `${DATE}T10:30:00Z`,
      window_to: `${DATE}T11:00:00Z`,
      buffer: 15,
    });
    expect(r.success).toBe(false);
  });

  it('ALLOWS a booking exactly one buffer later (gap 15) when buffer=15', async () => {
    if (!dbAvailable) return;
    const { tenantId } = await setupWithAnchor();
    // 10:45 is exactly 15 min after the 10:30 anchor end — gap == buffer is
    // allowed (the rule is gap >= buffer, not strictly greater).
    const r = await bookWithScheduling({
      tenant_id: tenantId,
      window_from: `${DATE}T10:45:00Z`,
      window_to: `${DATE}T11:15:00Z`,
      buffer: 15,
    });
    expect(r.success).toBe(true);
  });

  it('REJECTS a booking ending too close BEFORE the anchor (gap 0) when buffer=15', async () => {
    if (!dbAvailable) return;
    const { tenantId } = await setupWithAnchor();
    // Ends 10:00 exactly when the anchor starts — buffer is symmetric, so the
    // "before" side is enforced too.
    const r = await bookWithScheduling({
      tenant_id: tenantId,
      window_from: `${DATE}T09:30:00Z`,
      window_to: `${DATE}T10:00:00Z`,
      buffer: 15,
    });
    expect(r.success).toBe(false);
  });

  it('ALLOWS the same back-to-back booking when buffer=0 (inert default preserves original behavior)', async () => {
    if (!dbAvailable) return;
    const { tenantId } = await setupWithAnchor();
    const r = await bookWithScheduling({
      tenant_id: tenantId,
      window_from: `${DATE}T10:30:00Z`,
      window_to: `${DATE}T11:00:00Z`,
      buffer: 0,
    });
    expect(r.success).toBe(true);
  });
});

describe('book_appointment_atomic — buffer enforcement', () => {
  it('REJECTS back-to-back (gap 0) when buffer=15', async () => {
    if (!dbAvailable) return;
    const { tenantId, resourceId } = await setupWithAnchor();
    const r = await bookAppointmentAtomic({
      tenant_id: tenantId,
      resource_id: resourceId,
      start: `${DATE}T10:30:00Z`,
      end: `${DATE}T11:00:00Z`,
      buffer: 15,
    });
    expect(r.success).toBe(false);
  });

  it('ALLOWS gap == buffer (15) when buffer=15', async () => {
    if (!dbAvailable) return;
    const { tenantId, resourceId } = await setupWithAnchor();
    const r = await bookAppointmentAtomic({
      tenant_id: tenantId,
      resource_id: resourceId,
      start: `${DATE}T10:45:00Z`,
      end: `${DATE}T11:15:00Z`,
      buffer: 15,
    });
    expect(r.success).toBe(true);
  });

  it('ALLOWS back-to-back when buffer=0 (owner manual path is unrestricted)', async () => {
    if (!dbAvailable) return;
    const { tenantId, resourceId } = await setupWithAnchor();
    const r = await bookAppointmentAtomic({
      tenant_id: tenantId,
      resource_id: resourceId,
      start: `${DATE}T10:30:00Z`,
      end: `${DATE}T11:00:00Z`,
      buffer: 0,
    });
    expect(r.success).toBe(true);
  });
});

describe('check_availability_with_tz — buffer enforcement', () => {
  it('reports a within-buffer slot UNAVAILABLE, a beyond-buffer slot AVAILABLE (buffer=15)', async () => {
    if (!dbAvailable) return;
    const { tenantId, resourceId } = await setupWithAnchor();

    const tooClose = await checkAvailability({
      tenant_id: tenantId,
      resource_id: resourceId,
      start: `${DATE}T10:30:00Z`,
      end: `${DATE}T11:00:00Z`,
      buffer: 15,
    });
    expect(tooClose.available).toBe(false);

    const farEnough = await checkAvailability({
      tenant_id: tenantId,
      resource_id: resourceId,
      start: `${DATE}T10:45:00Z`,
      end: `${DATE}T11:15:00Z`,
      buffer: 15,
    });
    expect(farEnough.available).toBe(true);
  });

  it('buffer=0 reports the back-to-back slot AVAILABLE (original behavior)', async () => {
    if (!dbAvailable) return;
    const { tenantId, resourceId } = await setupWithAnchor();
    const r = await checkAvailability({
      tenant_id: tenantId,
      resource_id: resourceId,
      start: `${DATE}T10:30:00Z`,
      end: `${DATE}T11:00:00Z`,
      buffer: 0,
    });
    expect(r.available).toBe(true);
  });
});

describe('findNextAvailableSlots — buffer-aware suggestions (offer↔book invariant)', () => {
  it('returns NO suggested slot that lands within the buffer of the anchor (buffer=15)', async () => {
    if (!dbAvailable) return;
    const { tenantId } = await setupWithAnchor();
    const anchorStart = new Date(ANCHOR_START).getTime();
    const anchorEnd = new Date(ANCHOR_END).getTime();
    const bufferMs = 15 * 60_000;

    const slots = await findNextAvailableSlots(root, {
      tenantId,
      fromTime: `${DATE}T08:00:00Z`,
      durationMinutes: 30,
      count: 20,
      searchHorizonHours: 4,
      bufferMinutes: 15,
    });

    expect(slots.length).toBeGreaterThan(0);
    // Invariant: every offered slot must clear the buffer on both sides — i.e.
    // it ends at/before (anchorStart - buffer) OR starts at/after (anchorEnd +
    // buffer). If any slot violated this, booking would reject what we offered.
    for (const s of slots) {
      const sStart = new Date(s.start_time).getTime();
      const sEnd = new Date(s.end_time).getTime();
      const clearsBefore = sEnd <= anchorStart - bufferMs;
      const clearsAfter = sStart >= anchorEnd + bufferMs;
      expect(clearsBefore || clearsAfter).toBe(true);
    }
  });

  it('with buffer=0 it MAY suggest the immediately-adjacent slot (original behavior)', async () => {
    if (!dbAvailable) return;
    const { tenantId } = await setupWithAnchor();
    const slots = await findNextAvailableSlots(root, {
      tenantId,
      fromTime: `${DATE}T08:00:00Z`,
      durationMinutes: 30,
      count: 20,
      searchHorizonHours: 4,
      bufferMinutes: 0,
    });
    // The 10:30 slot (back-to-back with the 10:00–10:30 anchor) is offered.
    const has1030 = slots.some(
      (s) => new Date(s.start_time).getTime() === new Date(ANCHOR_END).getTime()
    );
    expect(has1030).toBe(true);
  });
});

describe('selectAssignments — buffer-aware resource availability (pure unit)', () => {
  const existing = [
    {
      resourceId: 'res-1',
      start: new Date(ANCHOR_START),
      end: new Date(ANCHOR_END),
    },
  ];
  const resources = [{ resource_id: 'res-1', capabilities: [] as string[] }];

  it('excludes a resource when the window is within the buffer (gap 0, buffer 15)', () => {
    const { options } = selectAssignments({
      requirements: { serviceType: 'x' },
      window: { from: new Date(`${DATE}T10:30:00Z`), to: new Date(`${DATE}T11:00:00Z`) },
      resources,
      existingAppointments: existing,
      bufferMinutes: 15,
    });
    expect(options.length).toBe(0);
  });

  it('includes the resource when the gap equals the buffer (gap 15, buffer 15)', () => {
    const { options } = selectAssignments({
      requirements: { serviceType: 'x' },
      window: { from: new Date(`${DATE}T10:45:00Z`), to: new Date(`${DATE}T11:15:00Z`) },
      resources,
      existingAppointments: existing,
      bufferMinutes: 15,
    });
    expect(options.length).toBe(1);
  });

  it('includes the back-to-back window when buffer=0 (inert default)', () => {
    const { options } = selectAssignments({
      requirements: { serviceType: 'x' },
      window: { from: new Date(`${DATE}T10:30:00Z`), to: new Date(`${DATE}T11:00:00Z`) },
      resources,
      existingAppointments: existing,
      bufferMinutes: 0,
    });
    expect(options.length).toBe(1);
  });
});

describe('getTenantBufferMinutes — the config→enforcement glue (real column)', () => {
  // This is the ONE link the rest of the suite stubs: every other test passes a
  // buffer value directly to an RPC/function. Here we set the actual column and
  // read it through the helper the agent routes call, then drive it end-to-end
  // into the booking RPC — so a typo'd column name or always-0 return (which
  // would ship the whole feature as a silent no-op) fails loudly.

  it('reads a non-zero default_buffer_minutes back from the tenants row', async () => {
    if (!dbAvailable) return;
    const { tenantId } = await setupWithAnchor();
    await root.query('UPDATE tenants SET default_buffer_minutes = 15 WHERE tenant_id = $1', [
      tenantId,
    ]);
    const buffer = await getTenantBufferMinutes(root as unknown as PoolClient, tenantId);
    expect(buffer).toBe(15);
  });

  it('returns 0 when the column is 0 (the inert default)', async () => {
    if (!dbAvailable) return;
    const { tenantId } = await setupWithAnchor();
    // default is already 0; assert the helper reports it as such.
    const buffer = await getTenantBufferMinutes(root as unknown as PoolClient, tenantId);
    expect(buffer).toBe(0);
  });

  it('returns 0 for an unknown tenant (degrade to no-buffer, never throw)', async () => {
    if (!dbAvailable) return;
    const buffer = await getTenantBufferMinutes(
      root as unknown as PoolClient,
      '00000000-0000-0000-0000-0000000000ff'
    );
    expect(buffer).toBe(0);
  });

  it('column → helper → RPC: a 15-min column rejects a back-to-back booking', async () => {
    if (!dbAvailable) return;
    const { tenantId } = await setupWithAnchor();
    await root.query('UPDATE tenants SET default_buffer_minutes = 15 WHERE tenant_id = $1', [
      tenantId,
    ]);
    // Exactly what the agent route does: read the column, pass it to the RPC.
    const buffer = await getTenantBufferMinutes(root as unknown as PoolClient, tenantId);
    const r = await bookWithScheduling({
      tenant_id: tenantId,
      window_from: `${DATE}T10:30:00Z`,
      window_to: `${DATE}T11:00:00Z`,
      buffer,
    });
    expect(buffer).toBe(15);
    expect(r.success).toBe(false);
  });

  it('owner path (12 positional args, no buffer) still resolves + stays unrestricted', async () => {
    // The dashboard owner-booking route (src/routes/appointments.ts) calls
    // book_appointment_atomic with EXACTLY 12 positional args — the new 13th
    // p_buffer_minutes must default to 0. Proves (a) the 12-arg call still
    // binds to the redefined 13-arg function (no "function does not exist"),
    // and (b) the owner is unrestricted: a back-to-back booking succeeds even
    // though the resource is occupied 10:00–10:30.
    if (!dbAvailable) return;
    const { tenantId, resourceId } = await setupWithAnchor();
    const customerId = await createCustomerFull(root, tenantId, '+15558887777', 'Owner Cust');
    const res = await root.query(
      `SELECT * FROM book_appointment_atomic(
         $1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, NULL, NULL
       )`,
      [
        tenantId,
        resourceId,
        customerId,
        `${DATE}T10:30:00Z`,
        `${DATE}T11:00:00Z`,
        'Owner manual booking',
        'manual-entry',
        null,
        null,
        null,
      ]
    );
    expect(res.rows[0].success).toBe(true);
  });
});
