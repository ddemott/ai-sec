import type { PoolClient } from 'pg';

/**
 * Conflict-row details surfaced when a booking RPC returns "already booked".
 *
 * The booking RPCs (book_appointment_atomic, book_with_scheduling_atomic)
 * return a plain string error message on overlap — they don't say WHICH
 * appointment is blocking the slot. For human-facing dashboard bookings,
 * the operator needs to see the conflicting appointment so they can decide
 * (pick another time, ask the existing customer to reschedule, etc.).
 *
 * findOverlappingAppointment() runs as a follow-up SELECT after the RPC
 * fails, mirroring the same overlap predicate the GiST exclusion constraint
 * uses (start_time < other.end_time AND end_time > other.start_time on the
 * scheduled+not-deleted row set). The race window between RPC failure and
 * this SELECT is bounded by the connection's snapshot — by the time the
 * caller sees the conflict block, it might be milliseconds stale, but for
 * "show the operator what's there" UX that's acceptable.
 */
export interface AppointmentConflict {
  appointment_id: string;
  start_time: string;
  end_time: string;
  customer_name: string | null;
  employee_name: string | null;
  resource_name: string | null;
  description: string | null;
}

/**
 * Detects whether an RPC error_message string indicates a slot-overlap
 * conflict (vs other failure modes like "past time", "no skilled employee",
 * etc.). The booking RPCs use these exact phrases:
 *   - "Resource already booked during this timeslot"
 *   - "Employee already booked"
 *   - "User already booked"
 * Match is case-insensitive on "already booked" — pinned by the RPC tests.
 */
export function isOverlapError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /already booked/i.test(message);
}

/**
 * Find the existing scheduled appointment overlapping the requested slot.
 *
 * Predicate mirrors the GiST exclusion constraints applied 2026-05-08:
 *   - same tenant
 *   - status = 'scheduled' AND not soft-deleted
 *   - half-open range overlap: a.start_time < requestedEnd AND a.end_time > requestedStart
 *   - matches if same resource OR (employeeId provided AND same employee)
 *
 * Returns the earliest-start conflict to give a deterministic answer when
 * multiple bookings somehow overlap. Returns null if no row matches — that
 * shouldn't happen post-RPC-overlap-error in practice, but defends the UI
 * from a stale-mid-flight edge (e.g. the conflicting row was just canceled).
 */
export async function findOverlappingAppointment(
  client: PoolClient,
  params: {
    tenantId: string;
    resourceId: string;
    employeeId: string | null;
    startTime: string | Date;
    endTime: string | Date;
  }
): Promise<AppointmentConflict | null> {
  const { tenantId, resourceId, employeeId, startTime, endTime } = params;

  const res = await client.query<AppointmentConflict>(
    `SELECT a.appointment_id::text AS appointment_id,
            a.start_time, a.end_time, a.description,
            c.name         AS customer_name,
            e.name         AS employee_name,
            r.name         AS resource_name
       FROM appointments a
       LEFT JOIN customers c ON c.customer_id = a.customer_id
       LEFT JOIN employees e ON e.employee_id = a.employee_id
       LEFT JOIN resources r ON r.resource_id = a.resource_id
      WHERE a.tenant_id = $1
        AND a.status   = 'scheduled'
        AND (a.is_deleted IS NULL OR a.is_deleted = false)
        AND a.start_time < $4::timestamptz
        AND a.end_time   > $3::timestamptz
        AND (a.resource_id = $2
             OR ($5::uuid IS NOT NULL AND a.employee_id = $5::uuid))
      ORDER BY a.start_time ASC
      LIMIT 1`,
    [tenantId, resourceId, startTime, endTime, employeeId]
  );

  return res.rows[0] ?? null;
}
