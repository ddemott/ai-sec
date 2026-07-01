/**
 * Resolve the service a booking / availability call should use.
 *
 * Callers almost never say the exact service name — "a meeting", "consulting",
 * "talk to Dale" — none of which substring-match "Programming Consultation".
 * A strict name match therefore dead-ends the call ("couldn't find a service"
 * → the agent bails → no booking; this was THE reason bookings never worked).
 *
 * Resolution order (the tenant default is the guaranteed catch-all):
 *   1. spokenType matches a real service (shortest ILIKE match) → use it.
 *   2. else → the tenant's configured `default_service_id` — THE FALLTHROUGH.
 *      No matter what the caller says (or doesn't), an unmatched type lands
 *      here, on a real service that carries a duration + required_skills, so
 *      the booking RPC can assign a skilled employee instead of failing
 *      NO_SKILLED_EMPLOYEE or booking an employee-less bare slot.
 *   3. else (default unset — legacy tenant) → safety net: the bookable,
 *      non-deleted service whose duration is closest to a 30-minute meeting.
 *   4. else (tenant truly has no bookable service) → null; caller handles it.
 */

import type { PoolClient } from 'pg';

export interface ResolvedService {
  service_id: string;
  name: string;
  duration_minutes: number;
  price: number | null;
  required_skills: string[];
}

// Shared projection so every branch returns the identical shape/types.
// Every column is qualified with the `s` (services) alias — branch 2 JOINs
// `tenants t`, which ALSO has a `name` column, so a bare `name` there is
// "column reference \"name\" is ambiguous" (a prod 500 in availability/booking
// once default_service_id was backfilled and the fallthrough started running).
// Every branch below aliases services as `s` so this projection is valid.
const COLS = `s.service_id,
              s.name,
              s.duration_minutes::int AS duration_minutes,
              CASE WHEN s.price IS NULL THEN NULL ELSE s.price::float8 END AS price,
              COALESCE(s.required_skills, '{}') AS required_skills`;

export async function resolveServiceForBooking(
  client: PoolClient,
  tenantId: string,
  spokenType: string | null | undefined
): Promise<ResolvedService | null> {
  // 1. Name match — shortest ILIKE match wins (mirrors the analytics service
  //    mapping), so "consultation" prefers "Programming Consultation" over a
  //    longer incidental match.
  const trimmed = spokenType?.trim();
  if (trimmed) {
    const matched = await client.query<ResolvedService>(
      `SELECT ${COLS} FROM services s
        WHERE s.tenant_id = $1
          AND COALESCE(s.is_deleted, false) = false
          AND s.name ILIKE '%' || $2 || '%'
        ORDER BY length(s.name) ASC
        LIMIT 1`,
      [tenantId, trimmed]
    );
    if (matched.rows[0]) return matched.rows[0];
  }

  // 2. Tenant default — the fallthrough. Only if the referenced service still
  //    exists and isn't soft-deleted.
  const fallthrough = await client.query<ResolvedService>(
    `SELECT ${COLS} FROM services s
       JOIN tenants t ON t.default_service_id = s.service_id
      WHERE t.tenant_id = $1
        AND COALESCE(s.is_deleted, false) = false
      LIMIT 1`,
    [tenantId]
  );
  if (fallthrough.rows[0]) return fallthrough.rows[0];

  // 3. Safety net — a bookable service closest to a 30-minute meeting. Covers
  //    tenants provisioned before default_service_id existed / had it cleared.
  const safety = await client.query<ResolvedService>(
    `SELECT ${COLS} FROM services s
      WHERE s.tenant_id = $1
        AND COALESCE(s.is_deleted, false) = false
        AND EXISTS (SELECT 1 FROM service_employee se WHERE se.service_id = s.service_id)
      ORDER BY ABS(COALESCE(s.duration_minutes, 30) - 30) ASC, s.name ASC
      LIMIT 1`,
    [tenantId]
  );
  return safety.rows[0] ?? null;
}
