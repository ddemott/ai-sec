import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
  skipIfDbDown,
} from '../utils';

// ─────────────────────────────────────────────────────────────────────────
// WHO  : the booking RPCs (book_appointment_atomic, book_with_scheduling_atomic)
//        and any owner who soft-deletes an appointment from the dashboard.
// WHAT : a SOFT-DELETED appointment (appointments.is_deleted = true) must NOT
//        occupy its time slot — a new booking on that slot must succeed and the
//        slot must show as available.
// WHEN : 2026-07-01. Migration 20260701000000_booking_rpc_filter_soft_deleted.
// WHERE: the appointment overlap / availability / "already booked" diagnostic
//        subqueries inside book_appointment_atomic + book_with_scheduling_atomic.
// WHY  : appointments are soft-deleted via the generic soft_delete_record() RPC
//        (POST /records/appointments/:id/soft-delete), which sets is_deleted=true
//        but LEAVES status='scheduled'. The overlap checks filtered status only,
//        not is_deleted, so a soft-deleted appointment kept blocking its slot.
//        (Cancellation is separate — it sets status='canceled', already excluded.)
//
// Each test anchors a 10:00–10:30 UTC appointment on a far-future date (avoids
// past-time rejection) and books the SAME slot (buffer 0).
// ─────────────────────────────────────────────────────────────────────────

const DATE = '2027-07-01';
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

// Fresh tenant + resource + employee + all-day shift + customer + one anchor
// appointment (status='scheduled') on the anchor slot. Returns the ids so a
// test can soft-delete the anchor and re-book its slot.
async function makeFixture() {
  const tenantId = await createTenant(root, 'SoftDelete Co', 'mobile-tire', 'UTC');
  // The business_type trigger (apply_business_template_defaults) auto-seeds
  // template resources/employees; clear them so ONLY our single resource +
  // employee exist, otherwise book_with_scheduling books a different free
  // resource and the anchor never blocks (masking the behavior under test).
  await root.query('DELETE FROM appointments WHERE tenant_id = $1', [tenantId]);
  await root.query('DELETE FROM resources WHERE tenant_id = $1', [tenantId]);
  await root.query('DELETE FROM employees WHERE tenant_id = $1', [tenantId]);
  const resourceId = await createResource(root, tenantId, 'Bay 1');
  const employeeId = await createEmployee(root, tenantId, 'Sam');
  await createScheduleEntry(root, tenantId, employeeId, DATE, '08:00', '18:00');
  const customerId = await createCustomerFull(root, tenantId, '+15550000001', 'Anchor Cust');
  const anchorApptId = await createAppointment(
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
  return { tenantId, resourceId, employeeId, anchorApptId };
}

async function bookSameSlot(tenantId: string, resourceId: string, phone: string) {
  const res = await root.query(
    `SELECT * FROM book_appointment_atomic(
       $1::UUID, $2::UUID, NULL, $3::TIMESTAMPTZ, $4::TIMESTAMPTZ, 'Test', 'call-sd',
       NULL, NULL, NULL::UUID, $5::TEXT, 'Cust', 0::INTEGER
     )`,
    [tenantId, resourceId, ANCHOR_START, ANCHOR_END, phone]
  );
  return res.rows[0];
}

describe('booking RPCs exclude soft-deleted appointments', () => {
  it('CONTROL: a LIVE scheduled appointment still blocks its slot (book_appointment_atomic)', async () => {
    // WHY: proves the overlap check is real — the fix must not disable it. A
    //      non-deleted scheduled appointment must still return a conflict.
    const { tenantId, resourceId } = await makeFixture();
    const r = await bookSameSlot(tenantId, resourceId, '+15559990002');
    expect(r.success).toBe(false); // slot occupied by the live anchor
    expect(r.appointment_id).toBeNull();
  });

  it('FIX: a SOFT-DELETED appointment does NOT block its slot (book_appointment_atomic)', async () => {
    // WHO: an owner who soft-deleted the anchor from the Deleted Records panel.
    // WHAT: is_deleted=true but status stays 'scheduled'; the slot must free up.
    // WHY: pre-fix the overlap check counted it (status='scheduled') and 500'd
    //      the caller with TIMESLOT_OCCUPIED on a slot that is actually free.
    const { tenantId, resourceId, anchorApptId } = await makeFixture();
    await root.query(
      `UPDATE appointments SET is_deleted = true, deleted_at = now() WHERE appointment_id = $1`,
      [anchorApptId]
    );
    // status is deliberately UNCHANGED — this is exactly what soft_delete_record does.
    const stillScheduled = await root.query(
      `SELECT status, is_deleted FROM appointments WHERE appointment_id = $1`,
      [anchorApptId]
    );
    expect(stillScheduled.rows[0].status).toBe('scheduled');
    expect(stillScheduled.rows[0].is_deleted).toBe(true);

    const r = await bookSameSlot(tenantId, resourceId, '+15559990003');
    expect(r.success).toBe(true); // the soft-deleted anchor no longer occupies the slot
    expect(r.appointment_id).not.toBeNull();
  });

  it('FIX: book_with_scheduling_atomic finds the slot once the appointment is soft-deleted', async () => {
    // WHO: the AI (book-with-scheduling path) offered a window whose only opening
    //      overlaps a soft-deleted appointment.
    // WHY: same gap in the availability NOT EXISTS + "already booked" diagnostics.
    const { tenantId, anchorApptId } = await makeFixture();

    // With the LIVE anchor, the exact-overlap window has no free slot.
    const blocked = await root.query(
      `SELECT * FROM book_with_scheduling_atomic(
         $1::UUID, '+15559990004', NULL, 'Test', 'call-sd2', NULL,
         NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, $2::TIMESTAMPTZ, $3::TIMESTAMPTZ,
         '{}'::TEXT[], '{}'::TEXT[], NULL::UUID, NULL, NULL, 30, 0::INTEGER
       )`,
      [tenantId, ANCHOR_START, ANCHOR_END]
    );
    expect(blocked.rows[0].success).toBe(false);

    // Soft-delete the anchor (status stays 'scheduled').
    await root.query(
      `UPDATE appointments SET is_deleted = true, deleted_at = now() WHERE appointment_id = $1`,
      [anchorApptId]
    );

    const freed = await root.query(
      `SELECT * FROM book_with_scheduling_atomic(
         $1::UUID, '+15559990005', NULL, 'Test', 'call-sd3', NULL,
         NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, $2::TIMESTAMPTZ, $3::TIMESTAMPTZ,
         '{}'::TEXT[], '{}'::TEXT[], NULL::UUID, NULL, NULL, 30, 0::INTEGER
       )`,
      [tenantId, ANCHOR_START, ANCHOR_END]
    );
    expect(freed.rows[0].success).toBe(true);
    expect(freed.rows[0].appointment_id).not.toBeNull();
  });
});
