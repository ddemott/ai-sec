import type { PoolClient } from 'pg';

/**
 * Find the next N free time-slots when no employee is available at the
 * requested start time. Used by the agent flow ("2 PM is taken — I have
 * 2:30, 3:15, or 4:00 free, which works?") and the dashboard conflict
 * modal ("Pick another time" suggestions).
 *
 * Algorithm — single SQL query that:
 *   1. Generates every 15-minute slot from `fromTime` forward through
 *      the search horizon (default 24 hours).
 *   2. For each slot, cross-joins resources × employees, filtering by
 *      shift coverage, required skills, required capabilities, and
 *      no-overlap with existing scheduled+not-deleted appointments.
 *   3. Within each slot, ranks candidates by skill count ASC + random
 *      (mirrors book_with_scheduling_atomic's ORDER BY) and picks the
 *      lowest-skill qualified employee available at that time.
 *   4. Returns the earliest N slots.
 *
 * Returned slots can overlap each other on the timeline (14:00-14:30
 * and 14:15-14:45 are both valid 30-min windows). The caller may
 * dedupe by start-of-hour or other UX rule if desired.
 */

export interface AvailableSlot {
  /** ISO timestamp of slot start (UTC). */
  start_time: string;
  /** ISO timestamp of slot end (UTC). */
  end_time: string;
  /** UUID of the employee who would be auto-assigned at this slot. */
  employee_id: string;
  /** Display name of the assigned employee. */
  employee_name: string;
  /** UUID of the resource paired with the assignment. */
  resource_id: string;
  /** Display name of the resource. */
  resource_name: string;
  /** Number of skills the assigned employee has — for transparency in
   *  the UI ("Carlos, 3 skills" vs "Mike, 5 skills"). */
  skill_count: number;
}

export interface FindNextAvailableSlotsParams {
  tenantId: string;
  /** Earliest slot start to consider (typically the originally-requested
   *  time that turned out to be busy). */
  fromTime: Date | string;
  /** Slot duration in minutes (matches the service the caller wants). */
  durationMinutes: number;
  /** Required employee skills — must all be present in `employees.skills`.
   *  Empty array means no skill filter. */
  requiredSkills?: string[];
  /** Required resource capabilities — must all be present in
   *  `resources.capabilities`. Empty array means no capability filter. */
  requiredCapabilities?: string[];
  /** How many slots to return. Default 5. */
  count?: number;
  /** How far forward to search, in hours. Default 24h.
   *  Capped at 168 (7 days) to keep query bounded. */
  searchHorizonHours?: number;
  /** Minimum gap to leave on both sides of an existing appointment, in
   *  minutes (the tenant's default buffer). A slot within this many minutes
   *  of a booking is treated as unavailable, so suggestions match what the
   *  booking RPC will accept under the same buffer. Default 0 (no buffer). */
  bufferMinutes?: number;
}

export async function findNextAvailableSlots(
  client: PoolClient,
  params: FindNextAvailableSlotsParams
): Promise<AvailableSlot[]> {
  const {
    tenantId,
    fromTime,
    durationMinutes,
    requiredSkills = [],
    requiredCapabilities = [],
    count = 5,
  } = params;
  const searchHorizonHours = Math.min(params.searchHorizonHours ?? 24, 168);
  const bufferMinutes = params.bufferMinutes && params.bufferMinutes > 0 ? params.bufferMinutes : 0;

  const tzRow = await client.query<{ timezone: string | null }>(
    `SELECT timezone FROM tenants WHERE tenant_id = $1`,
    [tenantId]
  );
  const tenantTz = tzRow.rows[0]?.timezone ?? 'UTC';

  const fromIso = typeof fromTime === 'string' ? fromTime : fromTime.toISOString();

  // The CTE `slot_starts` enumerates every 15-min boundary in the search
  // window. The CTE `candidates` does the same eligibility cross-join the
  // booking RPC does, ranks within each slot by skill count, and picks
  // the lowest-skill candidate per slot. The outer SELECT returns the N
  // earliest slots that had at least one candidate.
  const sql = `
    WITH grid_start AS (
      -- Snap the search origin UP to the next quarter-hour CLOCK boundary.
      -- generate_series steps 15 minutes from whatever instant it is given, so
      -- starting from a raw "now" made every suggested slot inherit now's
      -- minutes and seconds (a 4:34 AM search offered 1:04 PM) — times the
      -- appointments_start/end_time_15min CHECKs can never accept. The booking
      -- then 500'd on a slot WE suggested. Epoch/900 keeps the grid aligned to
      -- the same UTC quarter-hours the CHECK constraints measure.
      SELECT to_timestamp(ceil(extract(epoch from $1::timestamptz) / 900.0) * 900) AS g
    ),
    slot_starts AS (
      SELECT generate_series(
        gs.g,
        gs.g + ($2 || ' hours')::interval,
        interval '15 minutes'
      ) AS s
      FROM grid_start gs
    ),
    candidates AS (
      SELECT
        ss.s AS slot_start,
        ss.s + ($3 || ' minutes')::interval AS slot_end,
        emp.employee_id AS employee_id,
        emp.name AS employee_name,
        res.resource_id AS resource_id,
        res.name AS resource_name,
        COALESCE(array_length(emp.skills, 1), 0) AS skill_count,
        ROW_NUMBER() OVER (
          PARTITION BY ss.s
          ORDER BY
            COALESCE(array_length(emp.skills, 1), 0) ASC,
            random()
        ) AS rn
      FROM slot_starts ss
      CROSS JOIN resources res
      CROSS JOIN employees emp
      JOIN employee_schedule es
        ON es.employee_id = emp.employee_id
       AND es.tenant_id = $4
       AND es.shift_date = (ss.s AT TIME ZONE $5)::date
       AND es.is_off = false
       AND es.start_time <= (ss.s AT TIME ZONE $5)::time
       -- WRAP-AWARE (2026-07-17 22:13 CDT live call): a slot crossing local
       -- midnight has an end whose ::time is 00:00-ish — "before" any
       -- afternoon shift end once the date is dropped, so 11:30 PM was offered
       -- against a 1-5 PM shift (and only the midnight-wrapping slots leaked,
       -- which is why the offers were exactly 11:30/11:45 PM). '24:00:00' is a
       -- valid Postgres TIME: an end past the shift's local date now demands a
       -- shift ending at midnight sharp. The booking RPC ships the identical
       -- fix (migration 20260718003000) — suggest and enforce must read the
       -- same clock AND the same calendar.
       AND es.end_time >= CASE
             WHEN ((ss.s + ($3 || ' minutes')::interval) AT TIME ZONE $5)::date
                  > (ss.s AT TIME ZONE $5)::date
             THEN '24:00:00'::time
             ELSE ((ss.s + ($3 || ' minutes')::interval) AT TIME ZONE $5)::time
           END
      WHERE res.tenant_id = $4
        AND res.is_active = true
        AND (res.is_deleted IS NULL OR res.is_deleted = false)
        AND emp.tenant_id = $4
        AND emp.is_active = true
        AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
        AND (array_length($6::text[], 1) IS NULL OR res.capabilities @> $6::text[])
        AND (array_length($7::text[], 1) IS NULL OR emp.skills @> $7::text[])
        AND NOT EXISTS (
          SELECT 1 FROM appointments a
           WHERE a.resource_id = res.resource_id
             AND a.status = 'scheduled'
             AND (a.is_deleted IS NULL OR a.is_deleted = false)
             AND a.start_time < ss.s + ($3 || ' minutes')::interval + ($9 || ' minutes')::interval
             AND a.end_time > ss.s - ($9 || ' minutes')::interval
        )
        AND NOT EXISTS (
          SELECT 1 FROM appointments a
           WHERE a.employee_id = emp.employee_id
             AND a.status = 'scheduled'
             AND (a.is_deleted IS NULL OR a.is_deleted = false)
             AND a.start_time < ss.s + ($3 || ' minutes')::interval + ($9 || ' minutes')::interval
             AND a.end_time > ss.s - ($9 || ' minutes')::interval
        )
    )
    SELECT slot_start, slot_end,
           employee_id::text, employee_name,
           resource_id::text, resource_name,
           skill_count
      FROM candidates
     WHERE rn = 1
     ORDER BY slot_start ASC
     LIMIT $8
  `;

  const res = await client.query(sql, [
    fromIso,
    String(searchHorizonHours),
    String(durationMinutes),
    tenantId,
    tenantTz,
    requiredCapabilities.length === 0 ? [] : requiredCapabilities,
    requiredSkills.length === 0 ? [] : requiredSkills,
    String(count),
    String(bufferMinutes),
  ]);

  return res.rows.map(
    (r: {
      slot_start: Date;
      slot_end: Date;
      employee_id: string;
      employee_name: string;
      resource_id: string;
      resource_name: string;
      skill_count: number;
    }) => ({
      start_time: r.slot_start.toISOString(),
      end_time: r.slot_end.toISOString(),
      employee_id: r.employee_id,
      employee_name: r.employee_name,
      resource_id: r.resource_id,
      resource_name: r.resource_name,
      skill_count: Number(r.skill_count),
    })
  );
}
